import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { POPaymentKind, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ShopSupplierPaymentTemplate,
  SupplierPaymentJeKind,
} from '../../journal/cpa-templates/shop-supplier-payment.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { isPeriodClosedForBackdating } from './supplier-doc.util';
import {
  PayableLine,
  SupplierPaymentPosition,
  allocatePayable,
  parsePaidAt,
  splitSettlement,
  supplierPaymentPosition,
} from './supplier-payment.util';
import { bangkokCalendarParts } from '../../../utils/date.util';
import { formatDateShort, formatMonthName } from '../../../utils/thai-date.util';

/**
 * จ่ายเงินผู้จัดจำหน่าย / มัดจำ (ก้อน 2 · คำตัดสินเจ้าของ 2026-10-05 · คำตอบฝ่ายบัญชี 2026-10-05 ข้อ 4 "ให้โปรแกรมสร้างเมนู
 * จ่ายเงินผู้จัดจำหน่าย … ก่อนใช้งานจริง").
 *
 * กติกา:
 *   - โอนธนาคารเท่านั้น จากบัญชีธนาคารหน้าร้าน (จ่ายออก) S11-1202 — ไม่มีเงินสด · สลิปบังคับ (ข้อสมมติ ก)
 *   - ชนิดรายการโปรแกรมตัดสินเอง: มีเจ้าหนี้คงเหลือ (รับของแล้ว) → ชำระค่าสินค้าไม่เกินเจ้าหนี้ ส่วนที่เกิน = มัดจำ (ข้อสมมติ ข);
 *     ยังไม่มีเจ้าหนี้ → มัดจำ. มัดจำถูกหักเข้าเจ้าหนี้อัตโนมัติตอนรับของ (`applyDepositInTx` — ข้อสมมติ ค)
 *   - เพดาน: มัดจำ + ชำระ − มัดจำที่ได้คืน ≤ ยอดสุทธิของใบสั่งซื้อ
 *   - วันที่โอน ≤ วันนี้ และย้อนหลัง ≤ 365 วัน · งวดของวันโอนปิดแล้ว → ลงวันที่บันทึก + แจ้งฝ่ายบัญชี (ข้อสมมติ ฉ)
 *   - ยกเลิกรายการที่บันทึกผิด = กลับรายการเต็มจำนวน ลงวันที่ที่กด (ข้อสมมติ ง) · มัดจำที่ถูกหักเข้าเจ้าหนี้แล้วยกเลิกไม่ได้
 *   - `PurchaseOrder.paidAmount` / `paymentStatus` = ผลรวมที่ service นี้เขียนทับหลังทุกรายการ ห้ามเขียนตรง
 *
 * Plain class (ไม่ใช่ @Injectable) — facade `PurchaseOrdersService` สร้างให้ และ `ReceivingAcceptanceJournal` สร้างเองได้
 * (แบบเดียวกับ template) เพราะผู้สร้าง service รับของมีหลายสิบที่
 */
export interface SupplierPaymentDeps {
  template: ShopSupplierPaymentTemplate;
  accounts: ShopAccountResolver;
  companies: CompanyResolverService;
}

export interface RecordSupplierPaymentInput {
  /** YYYY-MM-DD (ปฏิทินไทย) */
  paidAt: string;
  amount: number;
  /** สลิปโอน (URL หรือ data URL) — บังคับ */
  slipUrl: string;
  reference?: string;
  note?: string;
}

export interface DepositOutcomeInput {
  depositOutcome: 'REFUNDED' | 'FORFEITED';
  /** REFUNDED: วันที่ได้รับเงินคืน YYYY-MM-DD (ไม่ส่ง = วันนี้) */
  refundedAt?: string;
  /** REFUNDED: จำนวนที่ได้คืน (ไม่ส่ง = ทั้งหมด) — ได้คืนไม่ครบ ส่วนต่างลง S53-1105 */
  refundAmount?: number;
  slipUrl?: string;
  /** FORFEITED: เหตุผล (บังคับ) · REFUNDED: หมายเหตุ */
  reason?: string;
}

export interface SupplierPaymentView {
  id: string;
  kind: POPaymentKind;
  amount: string;
  paidAt: Date;
  postedAt: Date;
  bankAccountCode: string | null;
  reference: string | null;
  slipUrl: string | null;
  note: string | null;
  receivingId: string | null;
  journalEntryId: string | null;
  journalEntryNo: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: Date;
  voidedAt: Date | null;
  voidedBy: { id: string; name: string } | null;
  voidReason: string | null;
  reversalJournalEntryId: string | null;
  reversalJournalEntryNo: string | null;
}

export interface SupplierPaymentSummary {
  netAmount: string;
  paidTotal: string;
  remainingOnPo: string;
  payableOutstanding: string;
  payableByAccount: Record<string, string>;
  depositOutstanding: string;
  hasBookedPayable: boolean;
  status: string;
}

export interface RecordSupplierPaymentResult {
  poId: string;
  poNumber: string;
  payments: SupplierPaymentView[];
  periodClosed: boolean;
  postedAt: Date;
  summary: SupplierPaymentSummary;
}

export const SUPPLIER_PAYMENT_PERIOD_TODO_TAG = 'supplier-payment-period';
export const supplierPaymentTodoKey = (paymentId: string) => `po-payment:${paymentId}`;

/** สถานะใบสั่งซื้อที่บันทึกการจ่ายได้ — ร่างยังไม่อนุมัติ / รออนุมัติ / ยกเลิก ไม่ได้ */
const PAYABLE_PO_STATUSES = ['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED'];
const VOIDABLE_KINDS: POPaymentKind[] = ['DEPOSIT', 'SETTLEMENT'];
const ZERO = new Decimal(0);

type PoHead = {
  id: string;
  poNumber: string;
  status: string;
  netAmount: Decimal;
  supplierId: string;
  paidAmount: Decimal;
  deletedAt: Date | null;
  supplier: { name: string };
};
type PaymentRow = Prisma.PurchaseOrderPaymentGetPayload<Record<string, never>>;

function toMoney(value: number, label = 'จำนวนเงิน'): Decimal {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new BadRequestException(`${label}ไม่ถูกต้อง`);
  const amount = new Decimal(value).toDecimalPlaces(2);
  if (!amount.gt(ZERO)) throw new BadRequestException(`${label}ต้องมากกว่า 0`);
  return amount;
}

export class SupplierPaymentService {
  private readonly logger = new Logger(SupplierPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deps: SupplierPaymentDeps,
  ) {}

  // ───────────────────────────── บันทึกการจ่าย ─────────────────────────────

  async recordPayment(poId: string, input: RecordSupplierPaymentInput, userId: string) {
    const result = await this.prisma.$transaction((tx) => this.recordInTx(tx, poId, input, userId), { timeout: 30_000 });
    return { ...result, accountingNotified: await this.notifyIfPeriodClosed(result, userId) };
  }

  /**
   * ใน tx ของผู้เรียก (บันทึกจากหน้าจ่ายเงิน หรือจ่ายทันทีตอนรับเข้าตรง) — ล็อกแถวใบสั่งซื้อก่อนอ่านฐานะ
   * กดพร้อมกัน 2 คนจึงต่อคิว ไม่จ่ายเกินเพดานทั้งคู่
   */
  async recordInTx(
    tx: Prisma.TransactionClient,
    poId: string,
    input: RecordSupplierPaymentInput,
    userId: string,
    now: Date = new Date(),
  ): Promise<RecordSupplierPaymentResult> {
    const amount = toMoney(input.amount);
    if (!input.slipUrl?.trim()) throw new BadRequestException('กรุณาแนบสลิปโอนเงิน');
    const paidAt = parsePaidAt(input.paidAt, now);

    const po = await this.lockPo(tx, poId);
    if (!PAYABLE_PO_STATUSES.includes(po.status)) {
      throw new BadRequestException('บันทึกการจ่ายได้เฉพาะใบสั่งซื้อที่อนุมัติแล้วและยังไม่ถูกยกเลิก');
    }
    const before = await this.positionInTx(tx, po);
    if (before.paidTotal.add(amount).gt(po.netAmount)) {
      throw new BadRequestException(
        `ยอดจ่ายรวมเกินยอดสุทธิของใบสั่งซื้อ — จ่ายได้อีกไม่เกิน ${before.remainingOnPo.toFixed(2)} บาท`,
      );
    }
    const shopCompanyId = await this.deps.companies.getShopCompanyId(tx);
    const periodClosed = await isPeriodClosedForBackdating(tx, paidAt, shopCompanyId);
    const postedAt = periodClosed ? now : paidAt;

    const plan: { kind: SupplierPaymentJeKind; amount: Decimal; payableLines?: PayableLine[] }[] = [];
    if (before.payableOutstanding.gt(ZERO)) {
      const split = splitSettlement(amount, before.payableByAccount);
      plan.push({ kind: 'SETTLEMENT', amount: split.settled, payableLines: split.lines });
      if (split.excess.gt(ZERO)) plan.push({ kind: 'DEPOSIT', amount: split.excess });
    } else {
      plan.push({ kind: 'DEPOSIT', amount });
    }

    const payments: SupplierPaymentView[] = [];
    for (const step of plan) {
      const row = await tx.purchaseOrderPayment.create({
        data: {
          poId: po.id,
          supplierId: po.supplierId,
          kind: step.kind,
          amount: step.amount,
          paidAt,
          postedAt,
          bankAccountCode: ShopAccountResolver.SHOP_PAYING_BANK,
          reference: input.reference?.trim() || null,
          slipUrl: input.slipUrl.trim(),
          note: input.note?.trim() || null,
          createdById: userId,
        },
      });
      const je = await this.deps.template.execute(
        {
          idempotencyKey: `po-payment:${row.id}`,
          kind: step.kind,
          poId: po.id,
          poNumber: po.poNumber,
          supplierId: po.supplierId,
          supplierName: po.supplier.name,
          paymentId: row.id,
          amount: step.amount,
          payableLines: step.payableLines,
          bankAccountCode: ShopAccountResolver.SHOP_PAYING_BANK,
          postedAt,
        },
        tx,
      );
      const saved = await tx.purchaseOrderPayment.update({ where: { id: row.id }, data: { journalEntryId: je.journalEntryId } });
      payments.push(this.toView(saved, { journalEntryNo: je.entryNo, createdBy: null, voidedBy: null, reversalJournalEntryNo: null }));
    }

    const after = await this.positionInTx(tx, po);
    await this.refreshPoSummaryInTx(tx, po.id, after);
    return { poId: po.id, poNumber: po.poNumber, payments, periodClosed, postedAt, summary: this.toSummary(po.netAmount, after) };
  }

  // ───────────────────────────── หักมัดจำตอนรับของ ─────────────────────────────

  /**
   * เรียกหลังตั้งเจ้าหนี้จากการรับของใน tx เดียวกัน (ข้อสมมติ ค): มัดจำค้าง > 0 → หักเข้าเจ้าหนี้ที่เพิ่งเกิด
   * ไม่เกินทั้งสองฝั่ง · ไม่มีมัดจำ = คืน null ไม่มีรายการ
   */
  async applyDepositInTx(
    tx: Prisma.TransactionClient,
    poId: string,
    newPayable: PayableLine[],
    ctx: { receivingId: string; grNumber: string; postedAt: Date; userId: string },
  ): Promise<{ paymentId: string; amount: string; journalEntryNo: string; lines: PayableLine[] } | null> {
    const fresh = newPayable.filter((line) => line.amount.gt(ZERO));
    if (fresh.length === 0) return null;
    // ทางลัด: ใบที่ไม่เคยมัดจำเลย (กรณีส่วนใหญ่) ไม่ต้องล็อกแถว/อ่านสมุดบัญชี
    const anyDeposit = await tx.purchaseOrderPayment.findFirst({
      where: { poId, kind: 'DEPOSIT', voidedAt: null, deletedAt: null },
      select: { id: true },
    });
    if (!anyDeposit) return null;
    const po = await this.lockPo(tx, poId);
    const position = await this.positionInTx(tx, po);
    if (!position.depositOutstanding.gt(ZERO)) return null;
    const lines = allocatePayable(position.depositOutstanding, fresh);
    const amount = lines.reduce((sum, line) => sum.add(line.amount), ZERO);
    if (!amount.gt(ZERO)) return null;

    const row = await tx.purchaseOrderPayment.create({
      data: {
        poId: po.id,
        supplierId: po.supplierId,
        kind: 'DEPOSIT_APPLIED',
        amount,
        paidAt: ctx.postedAt,
        postedAt: ctx.postedAt,
        receivingId: ctx.receivingId,
        note: `หักมัดจำเข้าเจ้าหนี้ตอนรับของ ${ctx.grNumber}`,
        createdById: ctx.userId,
      },
    });
    const je = await this.deps.template.execute(
      {
        idempotencyKey: `po-payment:${row.id}`,
        kind: 'DEPOSIT_APPLIED',
        poId: po.id,
        poNumber: po.poNumber,
        supplierId: po.supplierId,
        supplierName: po.supplier.name,
        paymentId: row.id,
        amount,
        payableLines: lines,
        receivingId: ctx.receivingId,
        grNumber: ctx.grNumber,
        postedAt: ctx.postedAt,
      },
      tx,
    );
    await tx.purchaseOrderPayment.update({ where: { id: row.id }, data: { journalEntryId: je.journalEntryId } });
    await this.refreshPoSummaryInTx(tx, po.id, await this.positionInTx(tx, po));
    return { paymentId: row.id, amount: amount.toFixed(2), journalEntryNo: je.entryNo, lines };
  }

  // ───────────────────────────── ยกเลิกรายการที่บันทึกผิด ─────────────────────────────

  async voidPayment(poId: string, paymentId: string, userId: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('กรุณาระบุเหตุผลที่ยกเลิกรายการ');
    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const po = await this.lockPo(tx, poId);
        const row = await tx.purchaseOrderPayment.findFirst({ where: { id: paymentId, poId: po.id, deletedAt: null } });
        if (!row) throw new NotFoundException('ไม่พบรายการจ่ายเงิน');
        if (row.voidedAt) throw new BadRequestException('รายการนี้ถูกยกเลิกไปแล้ว');
        if (!VOIDABLE_KINDS.includes(row.kind)) {
          throw new BadRequestException('ยกเลิกได้เฉพาะรายการมัดจำและชำระค่าสินค้าที่บันทึกเอง — รายการที่ระบบสร้างยกเลิกไม่ได้');
        }
        if (!row.journalEntryId) throw new BadRequestException('รายการนี้ไม่มีรายการบัญชีให้กลับ');
        const position = await this.positionInTx(tx, po);
        if (row.kind === 'DEPOSIT' && position.depositOutstanding.lt(row.amount)) {
          throw new BadRequestException('มัดจำรายการนี้ถูกหักเข้าเจ้าหนี้ตอนรับของแล้ว ยกเลิกรายการไม่ได้');
        }
        const reversal = await this.deps.template.reverse(
          { journalEntryId: row.journalEntryId, idempotencyKey: `po-payment-void:${row.id}`, reason: reason.trim(), postedAt: now },
          tx,
        );
        const saved = await tx.purchaseOrderPayment.update({
          where: { id: row.id },
          data: { voidedAt: now, voidedById: userId, voidReason: reason.trim(), reversalJournalEntryId: reversal.journalEntryId },
        });
        const after = await this.positionInTx(tx, po);
        await this.refreshPoSummaryInTx(tx, po.id, after);
        const names = await this.userNames(tx, [saved.createdById, saved.voidedById]);
        const original = await tx.journalEntry.findUnique({ where: { id: row.journalEntryId }, select: { entryNumber: true } });
        return {
          payment: this.toView(saved, {
            journalEntryNo: original?.entryNumber ?? null,
            reversalJournalEntryNo: reversal.entryNo,
            createdBy: names.get(saved.createdById ?? '') ?? null,
            voidedBy: names.get(saved.voidedById ?? '') ?? null,
          }),
          reversalJournalEntryNo: reversal.entryNo,
          summary: this.toSummary(po.netAmount, after),
        };
      },
      { timeout: 30_000 },
    );
  }

  // ───────────────────────────── ปิดมัดจำตอนยกเลิกใบสั่งซื้อ ─────────────────────────────

  /**
   * ยกเลิกใบสั่งซื้อที่ยังมีมัดจำค้าง (คำตัดสินเจ้าของ 05/10 ข้อ 6): ต้องบอกว่าได้คืน (→ S11-1201 · ส่วนที่ได้คืนไม่ครบ → S53-1105)
   * หรือไม่ได้คืน (→ S53-1105) — ไม่มีมัดจำค้างคืน null (ยกเลิกได้เหมือนเดิม)
   */
  async closeDepositsOnCancelInTx(
    tx: Prisma.TransactionClient,
    poId: string,
    outcome: DepositOutcomeInput | undefined,
    userId: string,
    now: Date = new Date(),
  ): Promise<{ payments: SupplierPaymentView[]; depositOutstanding: string; periodClosed: boolean } | null> {
    const po = await this.lockPo(tx, poId);
    const position = await this.positionInTx(tx, po);
    const outstanding = position.depositOutstanding;
    if (!outstanding.gt(ZERO)) return null;
    if (!outcome?.depositOutcome) {
      throw new BadRequestException(
        `ใบสั่งซื้อนี้มีเงินมัดจำค้าง ${outstanding.toFixed(2)} บาท — ต้องระบุว่าได้เงินคืนหรือไม่ก่อนยกเลิก`,
      );
    }
    const shopCompanyId = await this.deps.companies.getShopCompanyId(tx);
    const steps: { kind: SupplierPaymentJeKind; amount: Decimal; paidAt: Date; bank?: string; slipUrl?: string | null; note: string | null }[] = [];
    if (outcome.depositOutcome === 'REFUNDED') {
      const refunded = outcome.refundAmount === undefined ? outstanding : toMoney(outcome.refundAmount, 'จำนวนที่ได้คืน');
      if (refunded.gt(outstanding)) {
        throw new BadRequestException(`จำนวนที่ได้คืนต้องไม่เกินมัดจำค้าง ${outstanding.toFixed(2)} บาท`);
      }
      if (!outcome.slipUrl?.trim()) throw new BadRequestException('กรุณาแนบหลักฐานการโอนคืน');
      const refundedAt = outcome.refundedAt ? parsePaidAt(outcome.refundedAt, now) : parsePaidAt(this.todayString(now), now);
      steps.push({ kind: 'DEPOSIT_REFUND', amount: refunded, paidAt: refundedAt, bank: ShopAccountResolver.SHOP_RECEIVING_BANK, slipUrl: outcome.slipUrl.trim(), note: outcome.reason?.trim() || null });
      const shortfall = outstanding.sub(refunded);
      if (shortfall.gt(ZERO)) {
        steps.push({ kind: 'DEPOSIT_FORFEIT', amount: shortfall, paidAt: refundedAt, note: 'ส่วนที่ได้คืนไม่ครบ' });
      }
    } else if (outcome.depositOutcome === 'FORFEITED') {
      if (!outcome.reason?.trim()) throw new BadRequestException('กรุณาระบุเหตุผลที่ไม่ได้เงินมัดจำคืน');
      steps.push({ kind: 'DEPOSIT_FORFEIT', amount: outstanding, paidAt: parsePaidAt(this.todayString(now), now), note: outcome.reason.trim() });
    } else {
      throw new BadRequestException('ผลของเงินมัดจำไม่ถูกต้อง (ได้คืน / ไม่ได้คืน)');
    }

    let periodClosed = false;
    const payments: SupplierPaymentView[] = [];
    for (const step of steps) {
      const closed = await isPeriodClosedForBackdating(tx, step.paidAt, shopCompanyId);
      periodClosed = periodClosed || closed;
      const postedAt = closed ? now : step.paidAt;
      const row = await tx.purchaseOrderPayment.create({
        data: {
          poId: po.id,
          supplierId: po.supplierId,
          kind: step.kind,
          amount: step.amount,
          paidAt: step.paidAt,
          postedAt,
          bankAccountCode: step.bank ?? null,
          slipUrl: step.slipUrl ?? null,
          note: step.note,
          createdById: userId,
        },
      });
      const je = await this.deps.template.execute(
        {
          idempotencyKey: `po-payment:${row.id}`,
          kind: step.kind,
          poId: po.id,
          poNumber: po.poNumber,
          supplierId: po.supplierId,
          supplierName: po.supplier.name,
          paymentId: row.id,
          amount: step.amount,
          bankAccountCode: step.bank,
          postedAt,
        },
        tx,
      );
      const saved = await tx.purchaseOrderPayment.update({ where: { id: row.id }, data: { journalEntryId: je.journalEntryId } });
      payments.push(this.toView(saved, { journalEntryNo: je.entryNo, createdBy: null, voidedBy: null, reversalJournalEntryNo: null }));
    }
    const after = await this.positionInTx(tx, po);
    await this.refreshPoSummaryInTx(tx, po.id, after);
    return { payments, depositOutstanding: outstanding.toFixed(2), periodClosed };
  }

  // ───────────────────────────── อ่าน ─────────────────────────────

  async listPayments(poId: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: { id: true, poNumber: true, status: true, netAmount: true, supplierId: true, paidAmount: true, deletedAt: true, supplier: { select: { name: true } } },
    });
    if (!po || po.deletedAt) throw new NotFoundException('ไม่พบใบสั่งซื้อ');
    const client = this.prisma as unknown as Prisma.TransactionClient;
    const rows = await client.purchaseOrderPayment.findMany({
      where: { poId: po.id, deletedAt: null },
      orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
    });
    const position = await this.positionInTx(client, po);
    const names = await this.userNames(client, rows.flatMap((r) => [r.createdById, r.voidedById]));
    const jeIds = rows.flatMap((r) => [r.journalEntryId, r.reversalJournalEntryId]).filter((id): id is string => !!id);
    const entries = jeIds.length
      ? await client.journalEntry.findMany({ where: { id: { in: jeIds } }, select: { id: true, entryNumber: true } })
      : [];
    const entryNo = new Map(entries.map((e) => [e.id, e.entryNumber]));
    const legacyPaidAmount = rows.length === 0 && po.paidAmount.gt(ZERO) ? po.paidAmount.toFixed(2) : '0.00';
    return {
      summary: this.toSummary(po.netAmount, position),
      payments: rows.map((row) =>
        this.toView(row, {
          journalEntryNo: row.journalEntryId ? (entryNo.get(row.journalEntryId) ?? null) : null,
          reversalJournalEntryNo: row.reversalJournalEntryId ? (entryNo.get(row.reversalJournalEntryId) ?? null) : null,
          createdBy: names.get(row.createdById ?? '') ?? null,
          voidedBy: names.get(row.voidedById ?? '') ?? null,
        }),
      ),
      /** ยอดจ่ายที่กรอกไว้ก่อนมีเมนูนี้ (ไม่ได้ลงบัญชี) — แสดงเป็นป้ายเท่านั้น */
      legacyPaidAmount,
    };
  }

  /** ฐานะของใบสั่งซื้อจากสมุดบัญชี + แถวการจ่าย (ใช้ทั้งก่อน/หลังเขียน) */
  async positionInTx(tx: Prisma.TransactionClient, po: { id: string; netAmount: Decimal }): Promise<SupplierPaymentPosition> {
    const rows = await tx.purchaseOrderPayment.findMany({
      where: { poId: po.id, deletedAt: null },
      select: { kind: true, amount: true, voidedAt: true },
    });
    const entries = await tx.journalEntry.findMany({
      where: {
        deletedAt: null,
        status: 'POSTED',
        AND: [{ metadata: { path: ['poId'], equals: po.id } as any }],
        OR: [
          { metadata: { path: ['flow'], equals: 'shop-goods-receiving' } as any },
          { metadata: { path: ['flow'], equals: 'shop-supplier-payment' } as any },
        ],
      },
      select: { lines: { where: { deletedAt: null }, select: { accountCode: true, debit: true, credit: true } } },
    });
    return supplierPaymentPosition(po.netAmount, rows, entries.flatMap((e) => e.lines));
  }

  /** คอลัมน์สรุปบนใบสั่งซื้อ = ผลรวมจากตารางการจ่าย (หน้าเดิมยังอ่านได้ แต่ห้ามเขียนตรง) */
  async refreshPoSummaryInTx(tx: Prisma.TransactionClient, poId: string, position: SupplierPaymentPosition) {
    await tx.purchaseOrder.update({
      where: { id: poId },
      data: {
        paidAmount: position.paidTotal,
        paymentStatus: position.status,
        ...(position.paidTotal.gt(ZERO) ? { paymentMethod: 'BANK_TRANSFER' } : {}),
      },
    });
  }

  // ───────────────────────────── ภายใน ─────────────────────────────

  private async lockPo(tx: Prisma.TransactionClient, poId: string): Promise<PoHead> {
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${poId} FOR UPDATE`;
    const po = await tx.purchaseOrder.findUnique({
      where: { id: poId },
      select: { id: true, poNumber: true, status: true, netAmount: true, supplierId: true, paidAmount: true, deletedAt: true, supplier: { select: { name: true } } },
    });
    if (!po || po.deletedAt) throw new NotFoundException('ไม่พบใบสั่งซื้อ');
    return po;
  }

  private async userNames(tx: Prisma.TransactionClient, ids: (string | null | undefined)[]) {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (wanted.length === 0) return new Map<string, { id: string; name: string }>();
    const users = await tx.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, { id: u.id, name: u.name }]));
  }

  private todayString(now: Date) {
    const { year, month, day } = bangkokCalendarParts(now);
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  private toSummary(netAmount: Decimal, position: SupplierPaymentPosition): SupplierPaymentSummary {
    return {
      netAmount: new Decimal(netAmount.toString()).toFixed(2),
      paidTotal: position.paidTotal.toFixed(2),
      remainingOnPo: position.remainingOnPo.toFixed(2),
      payableOutstanding: position.payableOutstanding.toFixed(2),
      payableByAccount: Object.fromEntries(Object.entries(position.payableByAccount).map(([k, v]) => [k, v.toFixed(2)])),
      depositOutstanding: position.depositOutstanding.toFixed(2),
      hasBookedPayable: position.hasBookedPayable,
      status: position.status,
    };
  }

  private toView(
    row: PaymentRow,
    extra: {
      journalEntryNo: string | null;
      reversalJournalEntryNo: string | null;
      createdBy: { id: string; name: string } | null;
      voidedBy: { id: string; name: string } | null;
    },
  ): SupplierPaymentView {
    return {
      id: row.id,
      kind: row.kind,
      amount: row.amount.toFixed(2),
      paidAt: row.paidAt,
      postedAt: row.postedAt,
      bankAccountCode: row.bankAccountCode,
      reference: row.reference,
      slipUrl: row.slipUrl,
      note: row.note,
      receivingId: row.receivingId,
      journalEntryId: row.journalEntryId,
      journalEntryNo: extra.journalEntryNo,
      createdBy: extra.createdBy,
      createdAt: row.createdAt,
      voidedAt: row.voidedAt,
      voidedBy: extra.voidedBy,
      voidReason: row.voidReason,
      reversalJournalEntryId: row.reversalJournalEntryId,
      reversalJournalEntryNo: extra.reversalJournalEntryNo,
    };
  }

  /** หลัง commit: งวดของวันโอนปิดแล้ว → งานแจ้งฝ่ายบัญชี (ห้าม throw — เงินจ่ายและลงบัญชีไปแล้ว) */
  private async notifyIfPeriodClosed(result: RecordSupplierPaymentResult, userId: string): Promise<boolean> {
    if (!result.periodClosed || result.payments.length === 0) return false;
    try {
      const paidAt = result.payments[0].paidAt;
      const month = `${formatMonthName(paidAt)} ${bangkokCalendarParts(paidAt).year + 543}`;
      const total = result.payments.reduce((sum, p) => sum.add(p.amount), ZERO);
      await this.prisma.todo.create({
        data: {
          title: `จ่ายเงินผู้จัดจำหน่าย ${result.poNumber} ลงบัญชีวันที่บันทึกแทนวันที่โอน (งวด${month}ปิดแล้ว)`,
          description:
            `โอนวันที่ ${formatDateShort(paidAt)} ${total.toFixed(2)} บาท อยู่ในงวดบัญชีที่ปิดแล้ว — ระบบลงบัญชีด้วยวันที่บันทึก ` +
            `${formatDateShort(result.postedAt)} แทน และเก็บวันที่โอนไว้ตามจริง\n` +
            result.payments.map((p) => `${p.kind} ${p.amount} บาท · รายการบัญชี ${p.journalEntryNo ?? '-'}`).join('\n') +
            '\nตรวจว่าต้องปรับปรุงรายการหรือไม่ — ระบบไม่ลงรายการปรับปรุงให้อัตโนมัติ',
          priority: 'MEDIUM',
          tags: [SUPPLIER_PAYMENT_PERIOD_TODO_TAG, ...result.payments.map((p) => supplierPaymentTodoKey(p.id))],
          createdById: userId,
        },
      });
      return true;
    } catch (error) {
      this.logger.error(
        `สร้างงานแจ้งฝ่ายบัญชีไม่สำเร็จ (${result.poNumber} งวดของวันโอนปิดแล้ว)`,
        error instanceof Error ? error.stack : String(error),
      );
      Sentry.captureException(error, { tags: { subsystem: 'supplier-payment-period' }, extra: { poNumber: result.poNumber } });
      return false;
    }
  }
}
