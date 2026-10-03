import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AfterSalesOutcome,
  AfterSalesStage,
  ExchangeApprovalTier,
  ExchangeMode,
  ExchangeRequestStatus,
  Prisma,
  RepairStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { hasCrossBranchAccess } from '../../auth/branch-access.util';
import { deriveStage, isStale, stageSince } from '../utils/after-sales-stage.util';
import { reconcileStage } from './after-sales-stage-reconcile';
import { ListCasesDto } from '../dto/list-cases.dto';

type ReqUser = { id: string; role: string; branchId?: string | null };

const TAB_STAGES = {
  ACTIVE: ['RECEIVED', 'IN_REPAIR', 'AWAITING_APPROVAL'],
  AWAITING_APPROVAL: ['AWAITING_APPROVAL'],
  READY: ['READY_FOR_PICKUP'],
  DONE: ['CLOSED', 'CANCELLED'],
} as const;

/** R15 (fix round 1): เพดานจำนวนแถวที่ดึงมา sort ทั้งก้อนก่อน paginate — ต้อง sort ก่อนตัดหน้า
 * ไม่งั้นเคสค้างนานที่ `receivedAt` ช้ากว่าจะไม่มีวันโผล่มาก่อนถ้าจำนวนในแท็บเกิน limit */
export const LIST_FETCH_CAP = 500;

// PR 2 — deriveStage รุ่นสอง อ่าน exchangeRequest ของ PRICED_EXCHANGE ด้วย field ชุดนี้ (ตรงกับ
// StageInput['exchange'] + ReconcilableCase['exchangeRequest'] ทุกที่ที่ query แถวนี้) — Task 7
// ขยายเพิ่มฟิลด์ที่คอลัมน์แท็บรออนุมัติ/summary/timeline ต้องใช้ (ยังเป็น superset ของ
// ReconcilableCase['exchangeRequest'] เดิมทุกประการ — ไม่มีฟิลด์ไหนถูกถอด)
const EXCHANGE_REQUEST_SELECT = {
  status: true,
  mode: true,
  approvalTier: true, // Task 7 — approverRole (ESCALATE → OWNER)
  buybackPrice: true, // Task 7 — exchange.buybackPrice (Decimal → toFixed(2))
  ncvSnapshot: true, // Task 7 — exchange.ncvSnapshot
  memoAppliedAt: true,
  rejectionReason: true, // ใช้ทั้ง reconcileStage (cancelReason สังเคราะห์) และ timeline EXCHANGE_REJECTED
  cancelReason: true,
  canceledAt: true, // Task 7 — timeline EXCHANGE_CANCELED
  approvedAt: true, // Task 7 — timeline EXCHANGE_APPROVED
  createdAt: true, // Task 7 — timeline EXCHANGE_REQUESTED
  updatedAt: true, // Task 7 — at ของ timeline EXCHANGE_REJECTED
  newContract: { select: { id: true, contractNumber: true, status: true } },
} satisfies Prisma.ContractExchangeRequestSelect;

const ROW_SELECT = {
  id: true,
  caseNumber: true,
  source: true,
  outcome: true,
  stage: true,
  receivedAt: true,
  deviceBrand: true,
  deviceModel: true,
  deviceImei: true,
  branchId: true,
  closedAt: true, // PR 2: ทางออกเปลี่ยนเครื่องปิดด้วยการส่งมอบ — deriveStage/reconcileStage ต้องใช้ค่านี้
  replacementContractId: true, // R7: กิ่ง SAME_MODEL_EXCHANGE ของ deriveStage ต้องใช้ค่านี้
  productId: true, // Task 7 — เครื่องเดิม (ruling P-K): resolve ผ่าน batched product.findMany เดียวกับเครื่องทดแทน
  replacementProductId: true, // Task 7 — เครื่องทดแทน (newProduct)
  approvedAt: true, // R25 (d) — stageSince(READY_FOR_PICKUP) นับอายุจากอนุมัติ ไม่ใช่ตอนรับเรื่อง
  customer: { select: { id: true, name: true, phone: true } },
  branch: { select: { id: true, name: true } },
  receivedBy: { select: { id: true, name: true } },
  repairTicket: {
    select: {
      id: true,
      ticketNumber: true,
      status: true,
      payer: true,
      estimatedCost: true,
      actualCost: true,
      sentToRepairAt: true,
      repairedAt: true,
      repairSupplierId: true,
      deletedAt: true,
      returnedToCustomerAt: true, // R25 (d): reconcileStage ใช้เป็น closedAt แทน new Date()
    },
  },
  exchangeRequest: { select: EXCHANGE_REQUEST_SELECT },
} satisfies Prisma.AfterSalesCaseSelect;

/** row ที่ decorate() ต้องการอย่างน้อย — list/summary/getCase ต่างเลือกคอลัมน์เพิ่มกันคนละแบบ
 * แต่ทุกที่ต้องมีชุดนี้ (getCase ใช้ full model ผ่าน `include` ซึ่งเป็น superset ของ shape นี้เสมอ) */
interface DecorateInput {
  stage: AfterSalesStage;
  outcome: AfterSalesOutcome | null;
  cancelledAt?: Date | null;
  closedAt?: Date | null;
  receivedAt: Date;
  approvedAt?: Date | null; // R25 (d) — 4th arg ของ stageSince
  replacementContractId?: string | null;
  repairTicket: {
    status: RepairStatus;
    deletedAt: Date | null;
    sentToRepairAt: Date | null;
    repairedAt: Date | null;
  } | null;
  exchangeRequest?: {
    status: ExchangeRequestStatus;
    mode: ExchangeMode;
    memoAppliedAt: Date | null;
    newContract: { status: string } | null;
  } | null;
}

/** แถวขั้นต่ำที่ attachExchange() ต้องการ — ตัดจาก DecorateInput เพราะ deriveStage ไม่แตะฟิลด์
 * พวกนี้เลย (มีไว้ให้ `exchange` sub-object ของ CaseRow เท่านั้น) ROW_SELECT/getCase's include
 * เป็น superset เสมอ */
interface ExchangeAttachInput {
  id: string;
  outcome: AfterSalesOutcome | null;
  productId?: string | null;
  replacementProductId?: string | null;
  replacementContractId?: string | null;
  receivedBy?: { id: string; name: string } | null;
  exchangeRequest?: {
    status: ExchangeRequestStatus;
    mode: ExchangeMode;
    approvalTier: ExchangeApprovalTier | null;
    buybackPrice: Prisma.Decimal | null;
    ncvSnapshot: Prisma.Decimal | null;
    newContract: { id: string; contractNumber: string; status: string } | null;
  } | null;
}

export interface CaseExchangeInfo {
  kind: 'SAME_MODEL' | 'PRICED';
  mode: 'MEMO' | 'PRICED' | null;
  approvalTier: 'AUTO' | 'REVIEW' | 'ESCALATE' | null;
  requestStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED' | null;
  buybackPrice: string | null;
  ncvSnapshot: string | null;
  approverRole: 'BRANCH_MANAGER' | 'OWNER';
  oldProduct: {
    brand: string;
    model: string;
    storage: string | null;
    imeiSerial: string | null;
  } | null;
  newProduct: {
    id: string;
    brand: string;
    model: string;
    storage: string | null;
    imeiSerial: string | null;
  } | null;
  replacementContract: { id: string; contractNumber: string; status: string } | null;
  requestedBy: { id: string; name: string } | null;
}

/** เคสไหนถือ "เปลี่ยนเครื่อง" — ใช้แยกกันสองที่โดยตั้งใจ: กลุ่มนี้ (ใช้ตัดสิน exchange sub-object)
 * รวม CASH_SAME_MODEL_EXCHANGE ด้วยเพราะ deriveStage ปฏิบัติกับมันเหมือน SAME_MODEL_EXCHANGE ทุก
 * ประการ (OPEN_EXCHANGE_STAGE) — ส่วน summary() ข้อ openExchange/exchanges ใช้ EXCHANGE_OUTCOMES
 * แคบกว่า (ตามบรีฟข้อ verbatim: {SAME_MODEL_EXCHANGE, PRICED_EXCHANGE} เท่านั้น) */
const EXCHANGE_KIND: Partial<Record<AfterSalesOutcome, 'SAME_MODEL' | 'PRICED'>> = {
  SAME_MODEL_EXCHANGE: 'SAME_MODEL',
  CASH_SAME_MODEL_EXCHANGE: 'SAME_MODEL',
  PRICED_EXCHANGE: 'PRICED',
};

/** summary() เท่านั้น — verbatim ตามบรีฟ: openExchange/exchanges นับเฉพาะสองทางออกนี้
 * (ไม่รวม CASH_SAME_MODEL_EXCHANGE ต่างจาก EXCHANGE_KIND ข้างบนโดยตั้งใจ) */
const EXCHANGE_OUTCOMES = new Set<AfterSalesOutcome>(['SAME_MODEL_EXCHANGE', 'PRICED_EXCHANGE']);

@Injectable()
export class AfterSalesQueryService {
  constructor(private readonly prisma: PrismaService) {}

  private branchWhere(user: ReqUser, branchId?: string): Prisma.AfterSalesCaseWhereInput {
    if (!hasCrossBranchAccess(user)) {
      if (!user.branchId) throw new ForbiddenException('บัญชีไม่ได้ผูกสาขา');
      return { branchId: user.branchId };
    }
    return branchId ? { branchId } : {};
  }

  /** stage จริง ณ ตอนอ่าน (กันกรณีใบซ่อมถูกแก้จากหน้าเก่า) + ป้ายค้างนาน */
  private decorate<T extends DecorateInput>(row: T) {
    const stage = deriveStage({
      outcome: row.outcome,
      cancelledAt: row.cancelledAt ?? null,
      closedAt: row.closedAt ?? null,
      repairStatus: row.repairTicket?.status ?? null,
      repairDeleted: !!row.repairTicket?.deletedAt,
      replacementContractId: row.replacementContractId ?? null,
      exchange: row.exchangeRequest
        ? {
            status: row.exchangeRequest.status,
            mode: row.exchangeRequest.mode,
            memoAppliedAt: row.exchangeRequest.memoAppliedAt,
            newContractStatus: row.exchangeRequest.newContract?.status ?? null,
          }
        : null,
    });
    // R25 (d) — pass approvedAt เป็น arg ที่ 4: READY_FOR_PICKUP ของทางออกเปลี่ยนเครื่อง (ไม่มี
    // repairedAt เพราะไม่มีใบซ่อม) ต้องนับอายุจากวันที่อนุมัติ ไม่ใช่วันที่รับเรื่อง
    const since = stageSince(stage, row.repairTicket, row.receivedAt, row.approvedAt ?? null);
    return {
      ...row,
      stage,
      stageSince: since,
      stale: isStale(stage, since),
      daysInStage: Math.floor((Date.now() - since.getTime()) / 86400000),
    };
  }

  /**
   * Task 7 — batched lookup เดียวสำหรับข้อมูล "เปลี่ยนเครื่อง" ของ CaseRow: เครื่องเดิม/เครื่องทดแทน
   * (ruling P-K — ไม่มี relation `product`/`contract` บน AfterSalesCase มีแค่ scalar id คู่)
   * และสัญญาทดแทนของทางออก SAME_MODEL (ทางออก PRICED อ่านจาก exchangeRequest.newContract ที่ select
   * มาแล้ว ไม่ query ซ้ำ). เรียกครั้งเดียวต่อหน้า list()/getCase() — ไม่ query ต่อแถว (ไม่ N+1)
   * และไม่แตะ `prisma.product`/`prisma.contract` เลยเมื่อไม่มีแถวไหนเป็นเคสเปลี่ยนเครื่อง
   */
  private async attachExchange<T extends ExchangeAttachInput>(
    rows: T[],
  ): Promise<Map<string, CaseExchangeInfo>> {
    const kinds = new Map<string, 'SAME_MODEL' | 'PRICED'>();
    for (const r of rows) {
      const kind = r.outcome ? EXCHANGE_KIND[r.outcome] : undefined;
      if (kind) kinds.set(r.id, kind);
    }
    if (!kinds.size) return new Map();

    const productIds = new Set<string>();
    const replacementContractIds = new Set<string>();
    for (const r of rows) {
      const kind = kinds.get(r.id);
      if (!kind) continue;
      if (r.productId) productIds.add(r.productId);
      if (r.replacementProductId) productIds.add(r.replacementProductId);
      if (kind === 'SAME_MODEL' && r.replacementContractId) {
        replacementContractIds.add(r.replacementContractId);
      }
    }

    const [products, contracts] = await Promise.all([
      // database.md — ทุก query ใหม่ต้องกรอง deletedAt: null เมื่อโมเดลมีคอลัมน์นี้ (Product/Contract มี)
      productIds.size
        ? this.prisma.product.findMany({
            where: { id: { in: [...productIds] }, deletedAt: null },
            select: { id: true, brand: true, model: true, storage: true, imeiSerial: true },
          })
        : Promise.resolve([]),
      replacementContractIds.size
        ? this.prisma.contract.findMany({
            where: { id: { in: [...replacementContractIds] }, deletedAt: null },
            select: { id: true, contractNumber: true, status: true },
          })
        : Promise.resolve([]),
    ]);
    const productById = new Map(products.map((p) => [p.id, p] as const));
    const contractById = new Map(contracts.map((c) => [c.id, c] as const));

    const out = new Map<string, CaseExchangeInfo>();
    for (const r of rows) {
      const kind = kinds.get(r.id);
      if (!kind) continue;
      const oldProductRow = r.productId ? (productById.get(r.productId) ?? null) : null;
      const newProductRow = r.replacementProductId
        ? (productById.get(r.replacementProductId) ?? null)
        : null;
      const ex = kind === 'PRICED' ? r.exchangeRequest : null;
      const approvalTier = ex?.approvalTier ?? null;
      const replacementContract =
        kind === 'PRICED'
          ? (ex?.newContract ?? null)
          : r.replacementContractId
            ? (contractById.get(r.replacementContractId) ?? null)
            : null;
      out.set(r.id, {
        kind,
        mode: kind === 'PRICED' ? (ex?.mode ?? null) : null,
        approvalTier,
        requestStatus: kind === 'PRICED' ? (ex?.status ?? null) : null,
        buybackPrice: ex?.buybackPrice != null ? ex.buybackPrice.toFixed(2) : null,
        ncvSnapshot: ex?.ncvSnapshot != null ? ex.ncvSnapshot.toFixed(2) : null,
        // SAME_MODEL → BRANCH_MANAGER เสมอ · PRICED: ESCALATE → OWNER, อื่น (AUTO/REVIEW/null) → BRANCH_MANAGER
        approverRole: kind === 'PRICED' && approvalTier === 'ESCALATE' ? 'OWNER' : 'BRANCH_MANAGER',
        oldProduct: oldProductRow
          ? {
              brand: oldProductRow.brand,
              model: oldProductRow.model,
              storage: oldProductRow.storage,
              imeiSerial: oldProductRow.imeiSerial,
            }
          : null,
        newProduct: newProductRow
          ? {
              id: newProductRow.id,
              brand: newProductRow.brand,
              model: newProductRow.model,
              storage: newProductRow.storage,
              imeiSerial: newProductRow.imeiSerial,
            }
          : null,
        replacementContract,
        requestedBy: r.receivedBy ? { id: r.receivedBy.id, name: r.receivedBy.name } : null,
      });
    }
    return out;
  }

  async list(dto: ListCasesDto, user: ReqUser) {
    const tab = dto.tab ?? 'ACTIVE';
    const isDoneTab = tab === 'DONE';
    const where: Prisma.AfterSalesCaseWhereInput = {
      deletedAt: null,
      ...this.branchWhere(user, dto.branchId),
      stage: { in: [...TAB_STAGES[tab]] },
    };
    if (dto.q) {
      const or: Prisma.AfterSalesCaseWhereInput[] = [
        { caseNumber: { contains: dto.q, mode: 'insensitive' } },
        { deviceImei: { contains: dto.q } },
        { customer: { name: { contains: dto.q, mode: 'insensitive' } } },
        { customer: { phone: { contains: dto.q } } },
        {
          repairTicket: { contract: { contractNumber: { contains: dto.q, mode: 'insensitive' } } },
        },
      ];
      // M9 — เคสเปลี่ยนเครื่องไม่มีใบซ่อม: ค้นเลขสัญญาผ่าน `contractId` ของเคสเอง (ไม่มี relation
      // contract บน AfterSalesCase — ruling P-K) ด้วย query เพิ่มหนึ่งครั้ง
      const contracts = await this.prisma.contract.findMany({
        where: { contractNumber: { contains: dto.q, mode: 'insensitive' }, deletedAt: null },
        select: { id: true },
        take: LIST_FETCH_CAP,
      });
      if (contracts.length) or.push({ contractId: { in: contracts.map((c) => c.id) } });
      where.OR = or;
    }
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;
    // R15 (fix round 1 — Important finding): ต้อง sort ทั้งก้อนก่อน paginate ไม่ใช่ query
    // ทีละหน้าจาก DB แล้วค่อย sort เฉพาะหน้านั้น — ไม่งั้นเคสค้างนาน (stale) ที่ receivedAt
    // ช้ากว่าจะไปตกหน้า 2+ และไม่มีวันขึ้นก่อนเคสไม่ค้างของหน้า 1 เมื่อจำนวนในแท็บเกิน limit.
    // ดึงแบบไม่มี skip + เพดาน LIST_FETCH_CAP แถว, decorate ครบ, กรอง stale (ถ้าขอ),
    // sort จริง (ค้างนานก่อน แล้วค่อย stageSince เก่าสุดก่อน) แล้วค่อย slice หน้าที่ต้องการ.
    // `total` ยังเป็นยอดจริงของทั้งแท็บจาก DB count (ไม่กรอง stale) — ไม่ใช่ยอดหลัง cap.
    // R25 (a) — ข้อยกเว้นเดียว: เมื่อ `dto.stale=true` คำว่า "ยอดของแท็บ" ไม่มีความหมายอีกต่อไป
    // (ผู้ใช้ขอดูเฉพาะแถวค้างนาน ไม่ใช่ทั้งแท็บ) ⇒ `total` เปลี่ยนเป็นจำนวนหลังกรอง stale จริง
    // (`decorated.length` หลัง filter) ส่วน `truncated` ยังอิง DB count ตามเดิมเสมอ (ตอบคำถามคนละข้อ:
    // "หน้าเว็บตัดข้อมูลทิ้งไปหรือเปล่า" ไม่ใช่ "ตัวกรองที่ขอเจออะไรบ้าง")
    //
    // B1 (final-fix brief, 2026-09-24) — แท็บ "เสร็จแล้ว" (DONE) ต้องใหม่สุดก่อนตั้งแต่ระดับ DB
    // เพื่อให้ LIST_FETCH_CAP เก็บแถวใหม่สุดไว้เสมอ (ไม่ใช่แถวเก่าสุด) แท็บอื่นยังคง receivedAt
    // asc เหมือนเดิม — ลำดับในก้อนที่ดึงมาไม่สำคัญเพราะจะถูก sort ใหม่ทั้งหมดตาม stale/stageSince
    const orderBy: Prisma.AfterSalesCaseOrderByWithRelationInput[] = isDoneTab
      ? [
          { closedAt: { sort: 'desc', nulls: 'last' } },
          { cancelledAt: { sort: 'desc', nulls: 'last' } },
          { receivedAt: 'desc' },
        ]
      : [{ receivedAt: 'asc' }];
    const [rows, dbTotal] = await Promise.all([
      this.prisma.afterSalesCase.findMany({
        where,
        select: { ...ROW_SELECT, cancelledAt: true },
        orderBy,
        take: LIST_FETCH_CAP,
      }),
      this.prisma.afterSalesCase.count({ where }),
    ]);
    // A1 (final-fix brief) — stored `stage` เขียนแยกจากใบซ่อมจริง (sync() อาจไม่เคยรันถ้าใบซ่อม
    // ถูกแก้นอก proxy) ⇒ reconcile ผู้สมัคร (≤ LIST_FETCH_CAP แถว จึงทำได้ในราคาถูก) แล้วทิ้งแถวที่
    // derived stage ไม่ตรงแท็บนี้อีกต่อไป. ทิศตรงข้าม (แถวเก็บ CLOSED/CANCELLED แต่ derived เปิดอยู่)
    // ไม่มีทางเกิดผ่าน writer ชุดนี้ (การปิด/ยกเลิกเป็นทางเดียว) จึงไม่ต้องมองหา — แต่ PR 2 เพิ่มดริฟท์
    // อีกแบบที่เกิดได้จริง (R25 (d) ของ re-review): "เปิดอยู่→เปิดอยู่คนละ stage" เช่นเคส
    // PRICED_EXCHANGE ที่เก็บ AWAITING_APPROVAL แต่คำขอถูกอนุมัติ/ลงผลนอก proxy จน derived กลายเป็น
    // READY_FOR_PICKUP/CLOSED แล้ว — query นี้กรองด้วย stored stage ก่อน (`where.stage` ด้านบน) จึงยัง
    // ไม่ถูกดึงเข้าแท็บที่ถูกต้องในรอบที่มันดริฟท์ (มองไม่เห็นจากแท็บปลายทางชั่วคราว) แต่จะถูกแก้ทันทีที่
    // มีใครอ่านมันจากทางที่ไม่กรอง stage ก่อน (getCase/lookup) หรือจากแท็บที่ stored stage เดิมยังอยู่ —
    // residual ที่เหลือคือแถวที่เพิ่งดริฟท์และยังไม่มีใครอ่านมันเลยสักครั้ง (list/getCase/summary/lookup
    // ทุกตัว reconcile ก่อนใช้).
    const reconciled = await Promise.all(rows.map((r) => reconcileStage(this.prisma, r)));
    const tabStages = TAB_STAGES[tab] as readonly AfterSalesStage[];
    const inTab = reconciled.filter((r) => tabStages.includes(r.stage));
    let decorated = inTab.map((r) => this.decorate(r));
    if (dto.stale) decorated = decorated.filter((r) => r.stale);
    if (!isDoneTab) {
      decorated.sort(
        (a, b) =>
          Number(b.stale) - Number(a.stale) || a.stageSince.getTime() - b.stageSince.getTime(),
      ); // ค้างนานก่อน — แท็บ DONE คงลำดับจาก DB (ใหม่สุดก่อน) ไม่ re-sort ทับ (B1)
    }
    const data = decorated.slice((page - 1) * limit, page * limit);
    // Task 7 — batched exchange lookup ครั้งเดียวสำหรับหน้าที่กำลังส่งกลับจริง (ไม่ใช่ทั้ง 500
    // ผู้สมัคร) — ไม่มีใครเห็นแถวนอกหน้านี้ จึงไม่คุ้มเปิด product/contract query ให้มัน
    const exchangeMap = await this.attachExchange(data);
    const dataWithExchange = data.map((r) => ({ ...r, exchange: exchangeMap.get(r.id) ?? null }));
    return {
      data: dataWithExchange,
      // R25 (a) — โหมด stale: total = จำนวนที่ผ่านตัวกรองจริง ไม่ใช่ยอดทั้งแท็บจาก DB
      total: dto.stale ? decorated.length : dbTotal,
      page,
      limit,
      truncated: dbTotal > LIST_FETCH_CAP,
      summary: dto.summary ? await this.summary(user, dto.branchId) : undefined,
    };
  }

  /** แถบตัวเลขเจ้าของ (spec ข้อ 9) — PR 1 คิดจากใบซ่อมของเคส; PR 2 เติม openExchange/exchanges จริง */
  async summary(user: ReqUser, branchId?: string) {
    const scope = { deletedAt: null, ...this.branchWhere(user, branchId) };
    const monthStart = new Date(
      new Date().toLocaleString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7) +
        '-01T00:00:00+07:00',
    );
    // Task 7 — สามคำสั่งนี้ไม่ขึ้นต่อกัน (คนละ where/model) รันขนานได้เต็มที่
    const [openRaw, closed, exchangesCount] = await Promise.all([
      this.prisma.afterSalesCase.findMany({
        where: { ...scope, stage: { notIn: ['CLOSED', 'CANCELLED'] } },
        select: { ...ROW_SELECT, cancelledAt: true },
      }),
      this.prisma.repairTicket.findMany({
        where: {
          status: 'CLOSED',
          deletedAt: null,
          returnedToCustomerAt: { gte: monthStart },
          afterSalesCase: {
            isNot: null,
            ...(scope.branchId ? { is: { branchId: scope.branchId } } : {}),
          },
        },
        select: { payer: true, actualCost: true },
      }),
      // exchanges — เคสที่ outcome เปลี่ยนเครื่อง "ปิดจบ" ในเดือนนี้ (BKK) นับจาก closedAt ตรง ๆ
      // ไม่ต้อง reconcile/decorate ก่อน เพราะเป็นแค่ยอดนับ ไม่ใช่รายการที่ต้องแสดงสถานะปัจจุบัน
      this.prisma.afterSalesCase.count({
        // residual sweep — swap ที่ถูกยกเลิกหลังปิด (closedAt ยังอยู่) ไม่นับ
        where: {
          ...scope,
          outcome: { in: [...EXCHANGE_OUTCOMES] },
          closedAt: { gte: monthStart },
          cancelledAt: null,
        },
      }),
    ]);
    // A1 (final-fix brief) — เช่นเดียวกับ list(): reconcile ก่อนตัดสินว่า "เปิดอยู่" จริงไหม
    // ไม่งั้นเคสที่ใบซ่อมถูกปิดนอก proxy จะค้างอยู่ในตัวเลข "เปิดอยู่" ตลอดไป
    const reconciledOpen = await Promise.all(openRaw.map((r) => reconcileStage(this.prisma, r)));
    const open = reconciledOpen.filter((r) => !['CLOSED', 'CANCELLED'].includes(r.stage));
    const rows = open.map((r) => this.decorate(r));
    const sum = (p: string) =>
      closed.filter((t) => t.payer === p).reduce((s, t) => s + Number(t.actualCost ?? 0), 0);
    const money = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(user.role);
    return {
      open: rows.length,
      openRepair: rows.filter((r) => r.outcome === 'REPAIR').length,
      // openExchange — เคสเปิดที่ outcome ∈ {SAME_MODEL_EXCHANGE, PRICED_EXCHANGE} (verbatim ตามบรีฟ
      // — ไม่รวม CASH_SAME_MODEL_EXCHANGE)
      openExchange: rows.filter((r) => r.outcome != null && EXCHANGE_OUTCOMES.has(r.outcome))
        .length,
      stale: rows.filter((r) => r.stale).length,
      awaitingApproval: rows.filter((r) => r.stage === 'AWAITING_APPROVAL').length,
      repairCostShop: money ? sum('SHOP') : null,
      repairCostCustomer: money ? sum('CUSTOMER') : null,
      supplierClaims: closed.filter((t) => t.payer === 'SUPPLIER_CLAIM').length,
      exchanges: exchangesCount,
    };
  }

  async getCase(id: string, user: ReqUser) {
    const row = await this.prisma.afterSalesCase.findFirst({
      where: { id, deletedAt: null },
      include: {
        // lineIdShop: เจ้าของ LINE ฝั่งร้านของลูกค้า — ดูหมายเหตุที่ lineLinked ด้านล่าง
        customer: { select: { id: true, name: true, phone: true, lineIdShop: true } },
        branch: { select: { id: true, name: true } },
        receivedBy: { select: { id: true, name: true } },
        repairTicket: {
          include: {
            repairSupplier: { select: { id: true, name: true } },
            statusLogs: {
              orderBy: { createdAt: 'asc' },
              include: { changedBy: { select: { name: true } } },
            },
            expenseDocument: { select: { id: true, number: true } },
            otherIncome: { select: { id: true, docNumber: true } },
            contract: { select: { id: true, contractNumber: true } },
          },
        },
        exchangeRequest: { select: EXCHANGE_REQUEST_SELECT },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException('ไม่พบเคส');
    if (!hasCrossBranchAccess(user) && row.branchId !== user.branchId) {
      throw new ForbiddenException('ไม่สามารถเข้าถึงสาขาอื่นได้');
    }
    // A1 (final-fix brief) — reconcile ก่อน decorate เสมอ: sync() ของ proxy อาจไม่เคยรัน
    // (ใบซ่อมถูกแก้นอก proxy) ⇒ stored stage ค้างผิดไม่มีวันหาย ถ้าไม่มีใคร reconcile ตอนอ่าน
    const reconciled = await reconcileStage(this.prisma, row);
    // C1 (final-fix brief, PII) — เจ้าของ LINE ฝั่งร้าน = `customer.lineIdShop` เท่านั้น — ไม่มีโมเดล
    // "LINE link" แยกสำหรับฝั่งร้าน (ดูหมายเหตุ broadcast-audience.spec.ts) แต่ `lineIdShop` เป็น LINE
    // userId ดิบ (PII) ห้ามหลุดไปถึง browser — ส่งแค่ boolean `lineLinked` แล้วตัด lineIdShop ออกจาก
    // ก้อน customer ที่ส่งกลับ
    const lineLinked = !!reconciled.customer.lineIdShop;
    const customer = {
      id: reconciled.customer.id,
      name: reconciled.customer.name,
      phone: reconciled.customer.phone,
    };
    const d = this.decorate({ ...reconciled, customer });
    // Task 7 — เครื่อง include ทั้งก้อน (ROW_SELECT superset) จึงมี productId/replacementProductId/
    // exchangeRequest ครบให้ attachExchange ใช้เหมือน list() — เรียกด้วยแถวเดียวก็ยัง "batched"
    // (ไม่ query ต่อแถว) แค่ขนาด batch = 1
    const exchangeMap = await this.attachExchange([d]);
    const exchange = exchangeMap.get(d.id) ?? null;
    // C2 (final-fix brief) — AfterSalesEvent เก็บแค่ actorId (ไม่มี relation ไป User ใน schema)
    // ต้อง resolve ชื่อเองด้วย query เดียวต่อ id ที่ไม่ซ้ำกัน แล้วแปะ actorName ให้ทุกแถวในไทม์ไลน์
    // (ทั้งฝั่ง event ของเคส และฝั่ง statusLog ของใบซ่อมซึ่งมี actorName อยู่แล้วผ่าน changedBy)
    const actorIds = [
      ...new Set(reconciled.events.map((e) => e.actorId).filter((x): x is string => !!x)),
    ];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true },
        })
      : [];
    const actorNameById = new Map(actors.map((a) => [a.id, a.name] as const));
    // Task 7 — เหตุการณ์ของคำขอเปลี่ยนเครื่องมีราคา (PRICED_EXCHANGE เท่านั้น — SAME_MODEL ไม่มี
    // ContractExchangeRequest ผูกอยู่) รวมเข้าไทม์ไลน์เดียวกันแล้ว sort ตามเวลาจริง ไม่ใช่ต่อท้าย
    const req = reconciled.exchangeRequest;
    // M6 — ถ้าการกระทำมาทาง hub (proxy) เคสมี event ของตัวเองอยู่แล้ว (APPROVED/REJECTED/CANCELLED)
    // ภายใน ±60 วิ ของเวลาในคำขอ → ไม่สังเคราะห์ EXCHANGE_* ซ้ำ (สังเคราะห์เฉพาะที่มาจาก endpoint เก่า)
    const hasOwnEvent = (kind: string, at: Date) =>
      reconciled.events.some(
        (e) => e.kind === kind && Math.abs(e.createdAt.getTime() - at.getTime()) <= 60_000,
      );
    // I5 — engine `reject()` เขียน approvedAt ด้วย ⇒ approvedAt ไม่ได้แปลว่า "เคยอนุมัติ" เสมอ:
    // นับเป็นอนุมัติเฉพาะคำขอ APPROVED หรือ CANCELED ที่เคยอนุมัติมาก่อน (ยกเลิก swap หลังอนุมัติ)
    const wasApproved =
      !!req?.approvedAt && (req.status === 'APPROVED' || req.status === 'CANCELED');
    const exchangeEvents = req
      ? [
          {
            at: req.createdAt,
            kind: 'EXCHANGE_REQUESTED',
            note: `ยื่นคำขอ ${req.mode}`,
            actorName: undefined as string | undefined,
          },
          ...(wasApproved && req.approvedAt && !hasOwnEvent('APPROVED', req.approvedAt)
            ? [
                {
                  at: req.approvedAt,
                  kind: 'EXCHANGE_APPROVED',
                  note: null,
                  actorName: undefined as string | undefined,
                },
              ]
            : []),
          ...(req.canceledAt && !hasOwnEvent('CANCELLED', req.canceledAt)
            ? [
                {
                  at: req.canceledAt,
                  kind: 'EXCHANGE_CANCELED',
                  note: req.cancelReason,
                  actorName: undefined as string | undefined,
                },
              ]
            : []),
          ...(req.status === 'REJECTED' && !hasOwnEvent('REJECTED', req.updatedAt)
            ? [
                {
                  at: req.updatedAt,
                  kind: 'EXCHANGE_REJECTED',
                  note: req.rejectionReason,
                  actorName: undefined as string | undefined,
                },
              ]
            : []),
        ]
      : [];
    const timeline = [
      ...reconciled.events.map((e) => ({
        at: e.createdAt,
        kind: e.kind as string,
        note: e.note,
        actorName: e.actorId ? actorNameById.get(e.actorId) : undefined,
      })),
      ...(reconciled.repairTicket?.statusLogs ?? [])
        .filter((l) => !(l.fromStatus === 'OPEN' && l.toStatus === 'OPEN'))
        .map((l) => ({
          at: l.createdAt,
          kind: `REPAIR_${l.toStatus}`,
          note: l.note,
          actorName: l.changedBy?.name,
        })),
      ...exchangeEvents,
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    // Task 8 — เหตุการณ์ LINE ของเคสนี้สำหรับการ์ด "LINE ลูกค้า" บนเว็บพนักงาน: ทุกแถวที่
    // after-sales-line.service.ts เขียน (ส่งจริง/ข้ามเพราะไม่ผูก LINE/ปิดการส่ง/ส่งไม่สำเร็จ/ถูก
    // บล็อก) มี note ขึ้นต้นด้วย tag `[AFTER_SALES_*]` เสมอ (`lineEventTag()` ใน
    // after-sales-line-copy.util.ts) — กรองด้วย prefix ของ note ไม่ใช่ whitelist ของ kind เพราะ
    // event ที่ DISABLED/FAILED/BLOCKED ถูกเขียนเป็น kind 'NOTE' เหมือนบันทึกทั่วไปทุกประการ
    // (ต่างกันแค่ note). เรียงใหม่สุดก่อน จำกัด 5 แถวพอสำหรับการ์ด (การ์ดเองแสดงแค่ ≤3 บรรทัด)
    const lineEvents = reconciled.events
      .filter((e) => e.note?.startsWith('[AFTER_SALES_'))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 5)
      .map((e) => ({
        at: e.createdAt.toISOString(),
        kind: e.kind as string,
        note: e.note as string,
      }));
    return {
      ...d,
      exchange,
      lineLinked,
      lineEvents,
      timeline,
      photoCount: reconciled.photoKeys.length,
      purchasePhotoAngles: reconciled.purchasePhotoKeys.map(
        (k) => /purchase-([a-z]+)\./.exec(k)?.[1] ?? '',
      ),
      photoKeys: undefined,
      purchasePhotoKeys: undefined,
    };
  }

  async findByTicket(ticketId: string, user: ReqUser) {
    const row = await this.prisma.afterSalesCase.findFirst({
      where: { repairTicketId: ticketId, deletedAt: null },
      select: { id: true, branchId: true },
    });
    if (!row) throw new NotFoundException('ใบซ่อมนี้ยังไม่มีเคส');
    if (!hasCrossBranchAccess(user) && row.branchId !== user.branchId) {
      throw new ForbiddenException('ไม่สามารถเข้าถึงสาขาอื่นได้');
    }
    return { id: row.id };
  }
}
