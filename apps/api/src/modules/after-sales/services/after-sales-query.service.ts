import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AfterSalesOutcome, AfterSalesStage, Prisma, RepairStatus } from '@prisma/client';
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
  replacementContractId: true, // R7: กิ่ง SAME_MODEL_EXCHANGE ของ deriveStage ต้องใช้ค่านี้
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
    },
  },
} satisfies Prisma.AfterSalesCaseSelect;

/** row ที่ decorate() ต้องการอย่างน้อย — list/summary/getCase ต่างเลือกคอลัมน์เพิ่มกันคนละแบบ
 * แต่ทุกที่ต้องมีชุดนี้ (getCase ใช้ full model ผ่าน `include` ซึ่งเป็น superset ของ shape นี้เสมอ) */
interface DecorateInput {
  stage: AfterSalesStage;
  outcome: AfterSalesOutcome | null;
  cancelledAt?: Date | null;
  receivedAt: Date;
  replacementContractId?: string | null;
  repairTicket: {
    status: RepairStatus;
    deletedAt: Date | null;
    sentToRepairAt: Date | null;
    repairedAt: Date | null;
  } | null;
}

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
      repairStatus: row.repairTicket?.status ?? null,
      repairDeleted: !!row.repairTicket?.deletedAt,
      replacementContractId: row.replacementContractId ?? null,
    });
    const since = stageSince(stage, row.repairTicket, row.receivedAt);
    return {
      ...row,
      stage,
      stageSince: since,
      stale: isStale(stage, since),
      daysInStage: Math.floor((Date.now() - since.getTime()) / 86400000),
    };
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
      where.OR = [
        { caseNumber: { contains: dto.q, mode: 'insensitive' } },
        { deviceImei: { contains: dto.q } },
        { customer: { name: { contains: dto.q, mode: 'insensitive' } } },
        { customer: { phone: { contains: dto.q } } },
        {
          repairTicket: { contract: { contractNumber: { contains: dto.q, mode: 'insensitive' } } },
        },
      ];
    }
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;
    // R15 (fix round 1 — Important finding): ต้อง sort ทั้งก้อนก่อน paginate ไม่ใช่ query
    // ทีละหน้าจาก DB แล้วค่อย sort เฉพาะหน้านั้น — ไม่งั้นเคสค้างนาน (stale) ที่ receivedAt
    // ช้ากว่าจะไปตกหน้า 2+ และไม่มีวันขึ้นก่อนเคสไม่ค้างของหน้า 1 เมื่อจำนวนในแท็บเกิน limit.
    // ดึงแบบไม่มี skip + เพดาน LIST_FETCH_CAP แถว, decorate ครบ, กรอง stale (ถ้าขอ),
    // sort จริง (ค้างนานก่อน แล้วค่อย stageSince เก่าสุดก่อน) แล้วค่อย slice หน้าที่ต้องการ.
    // `total` ยังเป็นยอดจริงของทั้งแท็บจาก DB count (ไม่กรอง stale) — ไม่ใช่ยอดหลัง cap.
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
    const [rows, total] = await Promise.all([
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
    // derived stage ไม่ตรงแท็บนี้อีกต่อไป. ทิศตรงข้าม (แถวเก็บ CLOSED แต่ derived เปิดอยู่) ไม่มีทาง
    // เกิดผ่าน writer ชุดนี้ (การปิดเป็นทางเดียว) จึงไม่ต้องมองหา — residual ที่เหลือคือแถวที่เพิ่งดริฟท์
    // และยังไม่มีใครอ่านมันเลยสักครั้ง (list/getCase/summary/lookup ทุกตัว reconcile ก่อนใช้).
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
    return {
      data,
      total,
      page,
      limit,
      truncated: total > LIST_FETCH_CAP,
      summary: dto.summary ? await this.summary(user, dto.branchId) : undefined,
    };
  }

  /** แถบตัวเลขเจ้าของ (spec ข้อ 9) — PR 1 คิดจากใบซ่อมของเคส; awaitingApproval/exchanges = 0 จน PR 2 */
  async summary(user: ReqUser, branchId?: string) {
    const scope = { deletedAt: null, ...this.branchWhere(user, branchId) };
    const openRaw = await this.prisma.afterSalesCase.findMany({
      where: { ...scope, stage: { notIn: ['CLOSED', 'CANCELLED'] } },
      select: { ...ROW_SELECT, cancelledAt: true },
    });
    // A1 (final-fix brief) — เช่นเดียวกับ list(): reconcile ก่อนตัดสินว่า "เปิดอยู่" จริงไหม
    // ไม่งั้นเคสที่ใบซ่อมถูกปิดนอก proxy จะค้างอยู่ในตัวเลข "เปิดอยู่" ตลอดไป
    const reconciledOpen = await Promise.all(openRaw.map((r) => reconcileStage(this.prisma, r)));
    const open = reconciledOpen.filter((r) => !['CLOSED', 'CANCELLED'].includes(r.stage));
    const rows = open.map((r) => this.decorate(r));
    const monthStart = new Date(
      new Date().toLocaleString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7) +
        '-01T00:00:00+07:00',
    );
    const closed = await this.prisma.repairTicket.findMany({
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
    });
    const sum = (p: string) =>
      closed.filter((t) => t.payer === p).reduce((s, t) => s + Number(t.actualCost ?? 0), 0);
    const money = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(user.role);
    return {
      open: rows.length,
      openRepair: rows.filter((r) => r.outcome === 'REPAIR').length,
      openExchange: 0,
      stale: rows.filter((r) => r.stale).length,
      awaitingApproval: rows.filter((r) => r.stage === 'AWAITING_APPROVAL').length,
      repairCostShop: money ? sum('SHOP') : null,
      repairCostCustomer: money ? sum('CUSTOMER') : null,
      supplierClaims: closed.filter((t) => t.payer === 'SUPPLIER_CLAIM').length,
      exchanges: 0,
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
    const timeline = [
      ...reconciled.events.map((e) => ({
        at: e.createdAt,
        kind: e.kind,
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
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    return {
      ...d,
      lineLinked,
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
