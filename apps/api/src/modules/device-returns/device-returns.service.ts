import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ContractStatus,
  DeviceReturnKind,
  DeviceReturnStatus,
  Prisma,
  ProductStatus,
} from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { getBranchScope } from '../auth/branch-access.util';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { CustomerTagsService } from '../customer-tags/customer-tags.service';
import { CreditNoteDeliveryService } from '../receipts/services/credit-note-delivery.service';
import {
  REPOSSESSION_RETURN_REASONS,
  RepossessionReturnReason,
} from '../repossessions/dto/create-repossession.dto';
import {
  RE_REPOSSESSION_MSG,
  RepossessionsService,
  RequestUser,
  ZERO_OUTSTANDING_MSG,
} from '../repossessions/repossessions.service';
import { lookupTableBase, TableBaseHint } from '../repossessions/table-base.util';
import { TradeInValuationService } from '../trade-in/services/trade-in-valuation.service';
import { d, dAdd, dSub } from '../../utils/decimal.util';
import { isFutureBkkDay } from '../../utils/date.util';
import { DeviceReturnNumberService } from './device-return-number.service';
import { DeviceReturnNotifyService } from './device-return-notify.service';
import { CreateDeviceReturnDto } from './dto/create-device-return.dto';

// ───────────────────────────── ข้อความคงที่ (ใช้ซ้ำใน preview.eligibility + create) ─────────────────────────────
export const NOT_RETURNABLE_MSG = 'สัญญานี้ไม่อยู่ในสถานะที่รับเครื่องคืนได้';
export const PENDING_EXISTS_MSG = 'สัญญานี้มีใบรับเครื่องคืนที่รอยืนยันอยู่แล้ว';
export const PENDING_REQUEST_MSG =
  'สัญญานี้มีคำขอเปลี่ยนเครื่องหรือคำขอยกเลิกสัญญาที่รอดำเนินการ — จัดการคำขอนั้นให้เสร็จก่อนรับเครื่องคืน';
export const CLOSED_MSG = 'ใบนี้ถูกยืนยัน/ส่งกลับ/ยกเลิกไปแล้ว';
export const NOT_FOUND_MSG = 'ไม่พบใบรับเครื่องคืน';

const VOLUNTARY_STATUSES: ContractStatus[] = ['ACTIVE', 'OVERDUE', 'DEFAULT'];
const VOLUNTARY_REASONS: RepossessionReturnReason[] = ['UNAFFORDABLE', 'NO_LONGER_NEEDED', 'OTHER'];
const REPOSSESSION_REASONS: RepossessionReturnReason[] = ['AFTER_TERMINATION'];
const SENTRY_TAGS = { subsystem: 'device-return' } as const;

/** spec §5.1 ข้อ 2 — ประเภทคืน/ยึด derive จากสถานะสัญญา ไม่ให้ผู้ใช้เลือก */
export function deriveReturnKind(status: ContractStatus): DeviceReturnKind | null {
  if (status === 'TERMINATED') return 'REPOSSESSION';
  if (VOLUNTARY_STATUSES.includes(status)) return 'VOLUNTARY';
  return null;
}

export function allowedReasonsFor(kind: DeviceReturnKind | null): RepossessionReturnReason[] {
  if (kind === 'REPOSSESSION') return [...REPOSSESSION_REASONS];
  if (kind === 'VOLUNTARY') return [...VOLUNTARY_REASONS];
  return [];
}

type PaymentLike = {
  status: string;
  amountDue: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  lateFee: Prisma.Decimal;
  lateFeeWaived: boolean;
};

/** ยอดค้าง = Σ (amountDue + lateFee ถ้าไม่ waive − amountPaid) ของงวดที่ไม่ PAID — สูตรเดียวกับ RepossessionsService.createInTx */
function outstandingOf(payments: PaymentLike[]): Prisma.Decimal {
  let total = new Prisma.Decimal(0);
  for (const p of payments) {
    if (p.status === 'PAID') continue;
    const lateFee = p.lateFeeWaived ? new Prisma.Decimal(0) : d(p.lateFee);
    total = dAdd(total, dSub(dAdd(d(p.amountDue), lateFee), d(p.amountPaid)));
  }
  return total;
}

/** include ของสัญญาที่ preview/create ใช้ร่วมกัน */
const CONTRACT_INCLUDE = {
  product: {
    select: { id: true, brand: true, model: true, storage: true, imeiSerial: true, status: true },
  },
  customer: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' as const } },
} satisfies Prisma.ContractInclude;
type ContractForIntake = Prisma.ContractGetPayload<{ include: typeof CONTRACT_INCLUDE }>;

type EligibilityContract = {
  id: string;
  status: ContractStatus;
  productId: string;
  product: { status: ProductStatus };
  payments: PaymentLike[];
};
type EligibilityCheck =
  | { ok: true }
  | { ok: false; reason: string; code: 'BAD_REQUEST' | 'CONFLICT' };

/** include ของแถวใบ — รูปเดียวที่ทุก endpoint คืน (เว็บ Phase 3 อ่านรูปนี้) */
export const DEVICE_RETURN_LIST_INCLUDE = {
  receivingBranch: { select: { id: true, name: true } },
  receivedBy: { select: { id: true, name: true } },
  contract: {
    select: {
      id: true,
      contractNumber: true,
      status: true,
      customer: { select: { id: true, name: true } },
      product: { select: { id: true, brand: true, model: true, imeiSerial: true } },
    },
  },
} satisfies Prisma.DeviceReturnInclude;
export type DeviceReturnWithRelations = Prisma.DeviceReturnGetPayload<{
  include: typeof DEVICE_RETURN_LIST_INCLUDE;
}>;

export interface DeviceReturnRow {
  id: string;
  docNumber: string;
  status: DeviceReturnStatus;
  returnKind: DeviceReturnKind;
  returnReason: string;
  deviceReceivedAt: Date;
  conditionGrade: string;
  appraisalPrice: string;
  tableBasePrice: string | null;
  repairCost: string;
  notes: string | null;
  lineNotifyStatus: string | null;
  lineNotifiedAt: Date | null;
  receivingBranch: { id: string; name: string };
  receivedBy: { id: string; name: string };
  contract: {
    id: string;
    contractNumber: string;
    status: ContractStatus;
    customer: { id: string; name: string };
    product: { id: string; brand: string; model: string; imeiSerial: string | null };
  };
  confirmedAt: Date | null;
  confirmedBy: { id: string; name: string } | null;
  repossessionId: string | null;
  rejectReason: string | null;
  createdAt: Date;
}

export interface DeviceReturnPreview {
  contract: {
    id: string;
    contractNumber: string;
    status: ContractStatus;
    customer: { id: string; name: string };
    product: {
      id: string;
      brand: string;
      model: string;
      storage: string | null;
      imeiSerial: string | null;
    };
    branch: { id: string; name: string };
  };
  returnKind: DeviceReturnKind | null;
  eligibility: { canCreate: boolean; reason: string | null };
  allowedReasons: RepossessionReturnReason[];
  valuation: TableBaseHint | null;
  deviationPct: number | null;
  outstandingBalance: string;
}

export interface DeviceReturnListQuery {
  status?: DeviceReturnStatus;
  contractId?: string;
  branchId?: string;
  page?: number;
  limit?: number;
}

const LOOKUP_MIN_LENGTH = 3;
const LOOKUP_TAKE = 20;
const AWAITING_TAKE = 100;

/**
 * ใบรับเครื่องคืน (spec docs/superpowers/specs/2026-09-20-device-return-intake-design.md §5).
 *
 * สาขาบันทึก (create) → สัญญาหยุดทันทีเมื่อคืนเอง (D4) → FINANCE ยืนยัน (confirm → RepossessionsService.createInTx
 * ลง JP5 + ขาคู่ SHOP typed DEVICE_RETURN) / ส่งกลับ (reject) / สาขายกเลิก (cancel). งานรอบข้างทุกตัว
 * (audit ผ่าน AuditService.log, tag, journey, ไลน์, ส่ง CN) ทำ **หลัง commit** และ best-effort — ห้ามทำให้
 * การรับเครื่อง/การยืนยันล้ม (doctrine R-1). ยกเว้น audit CONTRACT_STATUS_LEGAL ที่เขียนใน tx ด้วย
 * tx.auditLog.create เพราะต้อง atomic กับการ flip สถานะสัญญา (แถวนั้นหลุด Merkle chain โดยตั้งใจ —
 * pattern เดียวกับ contract-letter.service.ts:256-267).
 *
 * ขอบเขตสาขา (spec §9): route `/:id` BranchGuard ไม่ครอบ — BM/SALES อ่านได้เฉพาะใบที่ receivingBranchId
 * = user.branchId (404 ไม่ leak); create ผูก receivingBranchId = user.branchId (OWNER ระบุใน body);
 * ไม่มี branchId = 403 fail-closed. preview/lookup **ไม่จำกัดสาขา** (D7 รับเครื่องได้ทุกสาขา).
 */
@Injectable()
export class DeviceReturnsService {
  private readonly logger = new Logger(DeviceReturnsService.name);
  /** ตารางรับซื้อ — สร้างภายในเหมือน RepossessionsService (พึ่งแค่ PrismaService) */
  private readonly valuationService = new TradeInValuationService(this.prisma);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repossessions: RepossessionsService,
    private readonly numberService: DeviceReturnNumberService,
    private readonly notify: DeviceReturnNotifyService,
    private readonly customerTags: CustomerTagsService,
    private readonly journey: JourneyEntryWriter,
    private readonly audit: AuditService,
    private readonly cnDelivery: CreditNoteDeliveryService,
  ) {}

  // ───────────────────────────── preview / lookup ─────────────────────────────

  async preview(
    query: { contractId: string; conditionGrade?: string; appraisalPrice?: number },
    _user: RequestUser,
  ): Promise<DeviceReturnPreview> {
    // D7: สาขาใดรับเครื่องได้หมด — ไม่ scope สัญญาตามสาขาผู้ดู
    const contract = await this.prisma.contract.findUnique({
      where: { id: query.contractId },
      include: CONTRACT_INCLUDE,
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    const kind = deriveReturnKind(contract.status);
    const check = await this.evaluateEligibility(this.prisma, contract, kind);
    const valuation = query.conditionGrade
      ? await lookupTableBase(this.valuationService, contract.product, query.conditionGrade)
      : null;
    const table =
      valuation?.found && valuation.suggestedPrice != null && valuation.suggestedPrice > 0
        ? d(valuation.suggestedPrice)
        : null;
    const deviationPct =
      table && query.appraisalPrice != null
        ? d(query.appraisalPrice).sub(table).div(table).abs().mul(100).toDecimalPlaces(1).toNumber()
        : null;

    return {
      contract: {
        id: contract.id,
        contractNumber: contract.contractNumber,
        status: contract.status,
        customer: contract.customer,
        product: {
          id: contract.product.id,
          brand: contract.product.brand,
          model: contract.product.model,
          storage: contract.product.storage,
          imeiSerial: contract.product.imeiSerial,
        },
        branch: contract.branch,
      },
      returnKind: kind,
      eligibility: check.ok
        ? { canCreate: true, reason: null }
        : { canCreate: false, reason: check.reason },
      allowedReasons: allowedReasonsFor(kind),
      valuation,
      deviationPct,
      outstandingBalance: outstandingOf(contract.payments).toFixed(2),
    };
  }

  /** ค้นสัญญาด้วยเลขสัญญา / เบอร์ / IMEI — รายการสั้น ไม่มีเบอร์ในผลลัพธ์ (spec §5.0) */
  async lookup(q: string, _user: RequestUser) {
    const term = (q ?? '').trim();
    if (term.length < LOOKUP_MIN_LENGTH) return [];
    const rows = await this.prisma.contract.findMany({
      where: {
        deletedAt: null,
        OR: [
          { contractNumber: { contains: term, mode: 'insensitive' } },
          { customer: { phone: { contains: term } } },
          { product: { imeiSerial: { contains: term, mode: 'insensitive' } } },
        ],
      },
      take: LOOKUP_TAKE,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        contractNumber: true,
        status: true,
        customer: { select: { id: true, name: true } },
        product: { select: { id: true, brand: true, model: true, imeiSerial: true } },
        branch: { select: { id: true, name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      contractNumber: r.contractNumber,
      status: r.status,
      customer: { id: r.customer.id, name: r.customer.name },
      product: r.product
        ? {
            id: r.product.id,
            brand: r.product.brand,
            model: r.product.model,
            imeiSerial: r.product.imeiSerial,
          }
        : null,
      branch: r.branch ? { id: r.branch.id, name: r.branch.name } : null,
    }));
  }

  // ───────────────────────────── create (สาขา) ─────────────────────────────

  async create(dto: CreateDeviceReturnDto, user: RequestUser): Promise<DeviceReturnRow> {
    const deviceReceivedAt = new Date(dto.deviceReceivedAt);
    if (Number.isNaN(deviceReceivedAt.getTime())) {
      throw new BadRequestException('กรุณาระบุวันที่รับเครื่อง');
    }
    if (isFutureBkkDay(deviceReceivedAt)) {
      throw new BadRequestException('วันที่รับเครื่องต้องไม่เป็นวันในอนาคต');
    }
    const receivingBranchId = await this.resolveReceivingBranch(dto.receivingBranchId, user);

    const created = await this.prisma
      .$transaction(
        async (tx) => {
          const contract = await tx.contract.findUnique({
            where: { id: dto.contractId },
            include: CONTRACT_INCLUDE,
          });
          if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

          const kind = deriveReturnKind(contract.status);
          const check = await this.evaluateEligibility(tx, contract, kind);
          if (!check.ok) {
            throw check.code === 'CONFLICT'
              ? new ConflictException(check.reason)
              : new BadRequestException(check.reason);
          }
          // kind ไม่ null แล้ว (evaluateEligibility ปฏิเสธ null ด้วย NOT_RETURNABLE_MSG)
          const returnKind = kind as DeviceReturnKind;
          const returnReason = this.resolveReturnReason(returnKind, dto.returnReason, dto.notes);

          const appraisal = d(dto.appraisalPrice);
          if (appraisal.lte(0)) {
            throw new BadRequestException('กรุณาระบุราคาประเมินมากกว่า 0 บาท');
          }
          // ตารางรับซื้อเป็นตัวเทียบ ±15% (ชุดเดียวกับ createInTx / หน้ารับซื้อ) — snapshot ไว้บนใบ
          const table = await lookupTableBase(
            this.valuationService,
            contract.product,
            dto.conditionGrade,
          );
          const tableBase =
            table?.found && table.suggestedPrice != null ? d(table.suggestedPrice) : null;
          if (tableBase && tableBase.gt(0)) {
            const deviation = appraisal.sub(tableBase).div(tableBase).abs();
            if (deviation.gt(RepossessionsService.TABLE_DEVIATION_LIMIT) && !dto.notes?.trim()) {
              throw new BadRequestException(
                `ราคาประเมิน ${appraisal.toFixed(2)} ฿ ต่างจากตารางรับซื้อ (เกรด ${dto.conditionGrade}: ${tableBase.toFixed(2)} ฿) ` +
                  `${deviation.mul(100).toDecimalPlaces(0)}% เกิน 15% — กรุณาระบุเหตุผลในหมายเหตุ`,
              );
            }
          }

          const docNumber = await this.numberService.next(tx);
          const row = await tx.deviceReturn.create({
            data: {
              docNumber,
              contractId: contract.id,
              productId: contract.productId,
              customerId: contract.customerId,
              receivingBranchId,
              receivedById: user.id,
              returnKind,
              returnReason,
              deviceReceivedAt,
              conditionGrade: dto.conditionGrade,
              appraisalPrice: appraisal,
              tableBasePrice: tableBase,
              repairCost: d(dto.repairCost ?? 0),
              notes: dto.notes?.trim() || null,
              // เฉพาะคืนเอง — ใช้คืนสถานะเมื่อส่งกลับ/ยกเลิก (spec §4.1)
              previousContractStatus: returnKind === 'VOLUNTARY' ? contract.status : null,
              status: 'PENDING_CONFIRM',
            },
            include: DEVICE_RETURN_LIST_INCLUDE,
          });

          if (returnKind === 'VOLUNTARY') {
            // D4: สัญญาหยุดทันทีที่รับเครื่องคืน — TERMINATED ให้ accrual/ค่าปรับ/จดหมาย/ทวงถามหยุดเอง
            // (ไม่ยิง dunning event CONTRACT_TERMINATED — ข้อความนั้นสำหรับบอกเลิกฝ่ายเดียว)
            await tx.contract.update({
              where: { id: contract.id },
              data: { status: 'TERMINATED' },
            });
            // audit ใน tx — atomic กับการ flip (rollback แล้วต้องไม่เหลือแถว); หลุด Merkle chain โดยตั้งใจ
            // pattern contract-letter.service.ts:256-267
            await tx.auditLog.create({
              data: {
                userId: user.id,
                action: 'CONTRACT_STATUS_LEGAL',
                entity: 'contract',
                entityId: contract.id,
                newValue: {
                  from: contract.status,
                  to: 'TERMINATED',
                  reason: 'DEVICE_RETURN_INTAKE',
                  deviceReturnId: row.id,
                  docNumber,
                },
              },
            });
          }

          return {
            id: row.id,
            docNumber,
            contractNumber: contract.contractNumber,
            customerId: contract.customerId,
            returnKind,
            returnReason,
            conditionGrade: dto.conditionGrade,
            appraisal,
            tableBase,
            receivingBranchId,
          };
        },
        {
          // Eligibility is read before number allocation can wait. Reject a stale snapshot
          // instead of overwriting a concurrently committed contract closure (e.g. early payoff).
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      )
      .catch((err: unknown) => {
        // The transaction has aborted; ask the caller to refresh, never retry stale intake intent.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
          throw new ConflictException(
            'ข้อมูลสัญญาเปลี่ยนระหว่างรับเครื่องคืน กรุณาตรวจสอบแล้วลองใหม่',
          );
        }
        // ตาข่าย partial unique device_returns_one_open_per_contract — แพ้ race → 409 ไทย ไม่ใช่ raw 500
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException(PENDING_EXISTS_MSG);
        }
        throw err;
      });

    // หลัง commit (ลำดับตาม spec §5.1) — ทุกตัว best-effort
    await this.audit.log({
      userId: user.id,
      action: 'DEVICE_RETURN_CREATED',
      entity: 'device_return',
      entityId: created.id,
      newValue: {
        docNumber: created.docNumber,
        contractNumber: created.contractNumber,
        returnKind: created.returnKind,
        returnReason: created.returnReason,
        conditionGrade: created.conditionGrade,
        appraisalPrice: created.appraisal.toFixed(2),
        tableBasePrice: created.tableBase ? created.tableBase.toFixed(2) : null,
        receivingBranchId: created.receivingBranchId,
      },
    });
    await this.recomputeTags(created.customerId);
    await this.notify.notify(created.id, 'DEVICE_RETURNED');

    return this.findRow(created.id);
  }

  // ───────────────────────────── list / findOne / awaiting ─────────────────────────────

  async list(
    query: DeviceReturnListQuery,
    user: RequestUser,
  ): Promise<{ data: DeviceReturnRow[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(200, Math.max(1, query.limit || 50));
    const where: Prisma.DeviceReturnWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.contractId) where.contractId = query.contractId;

    const scope = getBranchScope(user);
    if (!scope.all) {
      // BM/SALES เห็นเฉพาะใบที่สาขาตัวเองรับ — ไม่สน branchId จาก client; ไม่มีสาขา = หน้าว่าง
      if (!scope.branchId) return { data: [], total: 0, page, limit };
      where.receivingBranchId = scope.branchId;
    } else if (query.branchId) {
      where.receivingBranchId = query.branchId;
    }

    const [rows, total] = await Promise.all([
      this.prisma.deviceReturn.findMany({
        where,
        include: DEVICE_RETURN_LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.deviceReturn.count({ where }),
    ]);
    return { data: await this.toRows(rows), total, page, limit };
  }

  async findOne(id: string, user: RequestUser): Promise<DeviceReturnRow> {
    const row = await this.loadScoped(id, user);
    return (await this.toRows([row]))[0];
  }

  /** รายการ "รอยึดเครื่อง" (spec §5.7): TERMINATED ที่ยังไม่มีแถวยึดและไม่มีใบ PENDING_CONFIRM */
  async awaitingRepossession(user: RequestUser) {
    const where: Prisma.ContractWhereInput = {
      deletedAt: null,
      status: 'TERMINATED',
      repossession: null,
      deviceReturns: { none: { status: 'PENDING_CONFIRM', deletedAt: null } },
    };
    const scope = getBranchScope(user);
    if (!scope.all) {
      if (!scope.branchId) return { data: [], total: 0 };
      where.branchId = scope.branchId;
    }
    const [rows, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: AWAITING_TAKE,
        select: {
          id: true,
          contractNumber: true,
          status: true,
          monthlyPayment: true,
          customer: { select: { id: true, name: true, phone: true } },
          product: { select: { id: true, name: true, brand: true, model: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.contract.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id,
        contractNumber: r.contractNumber,
        status: r.status,
        monthlyPayment: d(r.monthlyPayment).toFixed(2),
        customer: { id: r.customer.id, name: r.customer.name, phone: r.customer.phone ?? '' },
        product: r.product
          ? {
              id: r.product.id,
              name: r.product.name,
              brand: r.product.brand,
              model: r.product.model,
            }
          : null,
        branch: r.branch ? { id: r.branch.id, name: r.branch.name } : null,
      })),
      total,
    };
  }

  // ───────────────────────────── helpers ─────────────────────────────

  /**
   * ด่าน 2-6 ของ spec §5.1 — ใช้ทั้ง preview (คืนเหตุผล) และ create (โยน 400/409).
   * ลำดับคงที่: สถานะ → ยอดค้าง → เครื่องเคยยึด → ใบ PENDING ซ้ำ → คำขอเปลี่ยนเครื่อง/ยกเลิกค้าง
   */
  private async evaluateEligibility(
    client: Prisma.TransactionClient | PrismaService,
    contract: EligibilityContract,
    kind: DeviceReturnKind | null,
  ): Promise<EligibilityCheck> {
    if (!kind) return { ok: false, reason: NOT_RETURNABLE_MSG, code: 'BAD_REQUEST' };
    if (outstandingOf(contract.payments).lte(0)) {
      return { ok: false, reason: ZERO_OUTSTANDING_MSG, code: 'BAD_REQUEST' };
    }
    if (contract.product.status === 'REPOSSESSED') {
      return { ok: false, reason: RE_REPOSSESSION_MSG, code: 'CONFLICT' };
    }
    const prior = await client.repossession.findFirst({
      where: { productId: contract.productId, deletedAt: null },
      select: { id: true },
    });
    if (prior) return { ok: false, reason: RE_REPOSSESSION_MSG, code: 'CONFLICT' };
    const open = await client.deviceReturn.findFirst({
      where: { contractId: contract.id, status: 'PENDING_CONFIRM', deletedAt: null },
      select: { id: true, docNumber: true },
    });
    if (open) return { ok: false, reason: PENDING_EXISTS_MSG, code: 'CONFLICT' };
    const pendingExchange = await client.contractExchangeRequest.count({
      where: { oldContractId: contract.id, status: 'PENDING', deletedAt: null },
    });
    if (pendingExchange > 0) return { ok: false, reason: PENDING_REQUEST_MSG, code: 'BAD_REQUEST' };
    const pendingCancellation = await client.contractCancellation.count({
      where: { contractId: contract.id, status: 'PENDING', deletedAt: null },
    });
    if (pendingCancellation > 0) {
      return { ok: false, reason: PENDING_REQUEST_MSG, code: 'BAD_REQUEST' };
    }
    return { ok: true };
  }

  /** spec §5.1 ข้อ 2 — เหตุผลต้องตรงประเภท; TERMINATED ไม่ส่งมา = AFTER_TERMINATION; OTHER ต้องมี notes */
  private resolveReturnReason(
    kind: DeviceReturnKind,
    reason: RepossessionReturnReason | undefined,
    notes: string | undefined,
  ): RepossessionReturnReason {
    if (
      reason != null &&
      !Object.prototype.hasOwnProperty.call(REPOSSESSION_RETURN_REASONS, reason)
    ) {
      throw new BadRequestException('กรุณาเลือกเหตุผลคืนเครื่องที่ถูกต้อง');
    }
    if (kind === 'REPOSSESSION') {
      if (reason && reason !== 'AFTER_TERMINATION') {
        throw new BadRequestException(
          `สัญญาที่บอกเลิกแล้วต้องใช้เหตุผล "${REPOSSESSION_RETURN_REASONS.AFTER_TERMINATION}"`,
        );
      }
      return 'AFTER_TERMINATION';
    }
    if (!reason) throw new BadRequestException('กรุณาเลือกเหตุผลคืนเครื่อง');
    if (!VOLUNTARY_REASONS.includes(reason)) {
      throw new BadRequestException(
        'เหตุผลคืนเครื่องไม่ตรงกับประเภท — สัญญาที่ยังเดินอยู่ใช้ได้เฉพาะ "ผ่อนต่อไม่ไหว" "ไม่ประสงค์ใช้ต่อ" หรือ "อื่น ๆ"',
      );
    }
    if (reason === 'OTHER' && !notes?.trim()) {
      throw new BadRequestException('กรุณาระบุรายละเอียดเหตุผลคืนเครื่อง');
    }
    return reason;
  }

  /** D7: สาขาที่รับ = user.branchId (BM/SALES fail-closed 403) · OWNER ระบุใน body (ต้องมีจริง) */
  private async resolveReceivingBranch(bodyBranchId: string | undefined, user: RequestUser) {
    const scope = getBranchScope(user);
    if (!scope.all) {
      if (!scope.branchId) {
        throw new ForbiddenException('ผู้ใช้ไม่ได้สังกัดสาขา — บันทึกรับเครื่องคืนไม่ได้');
      }
      return scope.branchId;
    }
    if (!bodyBranchId) throw new BadRequestException('กรุณาระบุสาขาที่รับเครื่อง');
    const branch = await this.prisma.branch.findFirst({
      where: { id: bodyBranchId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('ไม่พบสาขาที่รับเครื่อง');
    return branch.id;
  }

  /** โหลดใบ + ขอบเขตสาขา (BM/SALES → 404 เมื่อไม่ใช่ใบของสาขาตัวเอง — ไม่ leak ว่ามีอยู่) */
  private async loadScoped(id: string, user: RequestUser): Promise<DeviceReturnWithRelations> {
    const row = await this.prisma.deviceReturn.findFirst({
      where: { id, deletedAt: null },
      include: DEVICE_RETURN_LIST_INCLUDE,
    });
    if (!row) throw new NotFoundException(NOT_FOUND_MSG);
    const scope = getBranchScope(user);
    if (!scope.all && (!scope.branchId || row.receivingBranchId !== scope.branchId)) {
      throw new NotFoundException(NOT_FOUND_MSG);
    }
    return row;
  }

  private async findRow(id: string): Promise<DeviceReturnRow> {
    const row = await this.prisma.deviceReturn.findUniqueOrThrow({
      where: { id },
      include: DEVICE_RETURN_LIST_INCLUDE,
    });
    return (await this.toRows([row]))[0];
  }

  /** แถวตอบกลับ — confirmedBy หาชื่อจาก users แบบ batch (ไม่มี relation บนคอลัมน์ confirmedById) */
  private async toRows(rows: DeviceReturnWithRelations[]): Promise<DeviceReturnRow[]> {
    const confirmerIds = [
      ...new Set(rows.map((r) => r.confirmedById).filter((x): x is string => !!x)),
    ];
    const confirmers = confirmerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: confirmerIds } },
          select: { id: true, name: true },
        })
      : [];
    const byId = new Map(confirmers.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      docNumber: r.docNumber,
      status: r.status,
      returnKind: r.returnKind,
      returnReason: r.returnReason,
      deviceReceivedAt: r.deviceReceivedAt,
      conditionGrade: r.conditionGrade,
      appraisalPrice: d(r.appraisalPrice).toFixed(2),
      tableBasePrice: r.tableBasePrice != null ? d(r.tableBasePrice).toFixed(2) : null,
      repairCost: d(r.repairCost).toFixed(2),
      notes: r.notes,
      lineNotifyStatus: r.lineNotifyStatus,
      lineNotifiedAt: r.lineNotifiedAt,
      receivingBranch: r.receivingBranch,
      receivedBy: r.receivedBy,
      contract: r.contract,
      confirmedAt: r.confirmedAt,
      confirmedBy: r.confirmedById ? (byId.get(r.confirmedById) ?? null) : null,
      repossessionId: r.repossessionId,
      rejectReason: r.rejectReason,
      createdAt: r.createdAt,
    }));
  }

  /** tag RETURNED_DEVICE เป็นกฎใน CustomerTagsService (spec §5.6) — เรียก recompute หลัง commit, best-effort */
  private async recomputeTags(customerId: string): Promise<void> {
    try {
      await this.customerTags.recomputeForCustomer(customerId);
    } catch (err) {
      this.logger.warn(
        `[device-return] recompute tag ของลูกค้า ${customerId} ล้มเหลว: ${err instanceof Error ? err.message : String(err)}`,
      );
      Sentry.captureException(err, { tags: { ...SENTRY_TAGS, step: 'recompute-tags' } });
    }
  }
}
