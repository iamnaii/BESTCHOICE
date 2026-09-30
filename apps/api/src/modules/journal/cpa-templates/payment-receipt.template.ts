import { Injectable, BadRequestException, Logger, Optional } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'crypto';
import { ContractStatus, Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountRoleService } from '../account-role.service';
import { decideAccrueAtReceipt } from '../accrue-at-receipt-decision';
import { accrual2AInputOf, isDueDateReached } from '../build-accrual-2a-lines';
import { DeferredWarning, emitDeferredWarnings } from '../deferred-warning';
import {
  AccrueAtReceiptResult,
  InstallmentAccrual2ATemplate,
} from './installment-accrual-2a.template';
import { computeInstallmentBreakdown } from '../compute-installment-breakdown';
import { splitReceipt, SplitReceiptResult } from '../split-receipt';
import { buildReceiptLines } from '../build-receipt-lines';
import { reconstructPriorCleared } from '../reconstruct-prior';
import { computeInstallmentReceiptTax, ReceiptTaxBreakdown } from '../receipt-tax-breakdown';

const TOLERANCE = new Decimal('1.00');

export interface PaymentReceiptPrimitiveInput {
  installmentScheduleId: string;
  /** Cash (or customer-credit) received THIS receipt for THIS installment. */
  delta: Decimal;
  /** Cash code (11-11xx / 11-12xx) OR '21-5101' for the credit-balance path. */
  debitAccountCode: string;
  /** Total (GROSS) late fee owed on this installment (default 0). */
  lateFee?: Decimal;
  /**
   * Waived portion of the late fee (D1 gross-waiver, default 0). Books to Dr 52-1105
   * and grosses up Cr 42-1103; splitReceipt is fed the NET (gross − waived) so cash
   * only needs to cover the un-waived portion. Must be ≤ lateFee.
   */
  lateFeeWaived?: Decimal;
  /** Existing 21-1103 advance consumed to supplement delta (default 0). */
  advanceConsume?: Decimal;
  /** Surplus parked as new 21-1103 advance (default 0). */
  advanceCredit?: Decimal;
  /** True when this receipt closes the installment (enables ≤1฿ underpay close). */
  isFinalReceipt?: boolean;
  /** Required when the final receipt underpays by ≤1฿ (52-1104 route). */
  toleranceApproverId?: string;
  /**
   * Set by callers when a ≤1฿ underpay-close is a SYSTEM rounding residual (the
   * payer covered the full billed amountDue but amountDue < installmentTotal by a
   * rounding artifact), NOT a customer underpayment. When true, the ≤1฿ underpay
   * routes to 52-1104 WITHOUT a toleranceApproverId. Genuine customer underpayments
   * must leave this false and supply an approver.
   */
  autoApproveSystemRounding?: boolean;
  /** Caller-owned Payment row id → stamped to metadata.paymentId (the canonical payment→JE key). */
  paymentId?: string;
  /**
   * Per-receipt idempotency key. When provided it is stamped to
   * metadata.idempotencyKey for traceability/queryability.
   *
   * PR-843/I2 Phase 3 PR 3.1: stamp-only for now (no unique constraint enforced).
   * Per-receipt-idempotency enforcement (a DB partial-unique index on
   * metadata.idempotencyKey so a retried partial/completion never double-posts)
   * is the 3a/3b follow-up where the payment paths pass real per-receipt keys.
   */
  idempotencyKey?: string;
  /**
   * Optional JE post date (D4 backdating). Defaults to now inside createAndPost.
   * Forwarded by recordPayment as the caller-supplied paidDate so a backdated
   * receipt's ledger entry is dated to the payment date, not "now".
   */
  postedAt?: Date;
  /**
   * สถานะของสัญญา "ก่อน" การรับเงินครั้งนี้ — ผู้เรียกส่งค่าที่อ่านไว้ก่อนแก้อะไรในธุรกรรมของตัวเอง.
   * จำเป็นเพราะเส้นทางรับชำระเปลี่ยนสถานะสัญญาเป็น COMPLETED / EARLY_PAYOFF ในธุรกรรมเดียวกัน
   * **ก่อน**เรียก template: ถ้า template อ่านสถานะเอง งวดที่การรับเงินครั้งนี้ปิดสัญญาจะไม่ถูกตั้งลูกหนี้งวด.
   * ไม่ส่ง = ใช้สถานะปัจจุบันของสัญญา (เครื่องมือ backfill, spec).
   */
  contractStatusBeforeReceipt?: ContractStatus;
}

export interface PaymentReceiptResult {
  entryNo: string;
  split: SplitReceiptResult;
  /** รายการตั้งลูกหนี้งวด (2A) ที่ลงก่อนใบรับชำระนี้ในธุรกรรมเดียวกัน — null = ไม่ได้ลง */
  accrual: AccrueAtReceiptResult | null;
  /**
   * สัญญาณเตือนที่ยังไม่ได้ส่ง — ผู้เรียกที่ส่งธุรกรรมของตัวเองเข้ามาต้องเรียก `emitDeferredWarnings`
   * หลังธุรกรรมนั้น commit. เมื่อ template ห่อธุรกรรมเอง template ส่งให้แล้วและคืนรายการว่าง.
   */
  warnings: DeferredWarning[];
  /**
   * ใบกำกับภาษีตามบัญชี (PR3) — ค่าที่ใบเสร็จของรายการนี้ต้องพิมพ์ (ประทับลง metadata.receiptTax ด้วย;
   * generateReceipt อ่านจากรายการบัญชีที่ผูก ผู้เรียกไม่ต้องส่งต่อเอง)
   */
  receiptTax: ReceiptTaxBreakdown;
}

/**
 * PaymentReceiptTemplate — the single "post a receipt for delta X" primitive
 * (PR-843 / I2). Generalises the applyCreditBalance custom-delta JE + the
 * 2B-split sumPriorPartials reconstruction. Every receipt clears only what it
 * covers, so Σ(Cr 11-2103) per installment == installmentTotal and
 * Σ(Cr 42-1103) == lateFee for ANY receipt sequence / ANY path.
 *
 * JE:
 *   Dr debitAccountCode      delta            (skip if 0)
 *   Dr 21-1103               advanceConsume   (if > 0)
 *   Dr 52-1104               underpayRounding (final ≤1฿ close; needs approver)
 *     Cr 11-2103             principalCleared
 *     Cr 42-1103             lateFeePortion   (if > 0)
 *     Cr 53-1503             overpayRounding  (if > 0)
 *     Cr 21-1103             advanceCredit    (if > 0)
 */
@Injectable()
export class PaymentReceiptTemplate {
  private readonly logger = new Logger(PaymentReceiptTemplate.name);
  private readonly accrual: InstallmentAccrual2ATemplate;

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    @Optional() private readonly roles?: AccountRoleService,
    // ตั้งลูกหนี้งวด ณ วันรับเงิน (D2, 2026-09-28). Nest ฉีดตัวที่ JournalModule ให้; จุดที่ `new` เอง
    // (สเปค / CLI) ไม่ต้องส่ง — สร้างจาก journal + prisma ชุดเดียวกัน จึงไม่มีทาง "ลืมต่อ" จนข้าม 2A
    @Optional() accrual?: InstallmentAccrual2ATemplate,
  ) {
    this.accrual = accrual ?? new InstallmentAccrual2ATemplate(journal, prisma);
  }

  /**
   * D1.1.6.3 (ported from PaymentReceipt2BTemplate, PR-843/I2 Phase 3 3a) —
   * read `adj_auto_route` flag (default TRUE).
   * Inlined direct SystemConfig read (PrismaService) to avoid pulling
   * SettingsModule into the journal module DI graph. Defaults to TRUE so
   * first-boot behaviour is unchanged.
   */
  private async readAdjAutoRouteFlag(
    tx: Prisma.TransactionClient | PrismaService,
  ): Promise<boolean> {
    try {
      const row = await tx.systemConfig.findFirst({
        where: { key: 'adj_auto_route', deletedAt: null },
        select: { value: true },
      });
      if (!row?.value) return true;
      const v = row.value.trim().toLowerCase();
      if (v === 'false' || v === '0') return false;
      if (v === 'true' || v === '1') return true;
      return true;
    } catch {
      return true;
    }
  }

  async execute(
    input: PaymentReceiptPrimitiveInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<PaymentReceiptResult> {
    if (outerTx) return this.executeInTx(input, outerTx);
    // ไม่มีธุรกรรมของผู้เรียก (สเปค/เครื่องมือ) — ห่อเองเพื่อให้รายการตั้งลูกหนี้งวด (2A) กับใบรับชำระ
    // เป็นหน่วยเดียวกัน: ใบรับชำระไม่ผ่าน = 2A ไม่ค้าง. เส้นทางจริงทุกเส้นส่ง outerTx มาเองอยู่แล้ว.
    const result = await this.prisma.$transaction((tx) => this.executeInTx(input, tx), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    emitDeferredWarnings(result.warnings);
    return { ...result, warnings: [] };
  }

  /**
   * ตั้งลูกหนี้งวด ณ วันรับเงิน (คำตัดสินฝ่ายบัญชี D2, 2026-09-28 + ก1 "แบบ ข", 2026-09-29) — เรียกหลังด่าน
   * ของ template และ splitReceipt ผ่านแล้ว ก่อนลงใบรับชำระ. วันที่รับเงิน = postedAt ของใบรับชำระ
   * (ไม่ส่ง = ตอนนี้).
   *
   * กติกาอยู่ที่ decideAccrueAtReceipt ตัวเดียว (ใช้ร่วมกับ preview):
   *   - ใบที่ทำให้งวดชำระครบ → ตั้งส่วนที่เหลือของงวด (ยังไม่เคยตั้ง = ทั้งงวด)
   *   - ใบบางส่วนก่อนวันครบกำหนด → ตั้งเท่ายอดที่ใบนี้ล้างลูกหนี้ของงวด (split.principalCleared — ไม่รวม
   *     ค่าปรับ 42-1103 เศษปัด 53-1503 และเงินรับล่วงหน้าที่พักเข้า 21-1103)
   *   - ใบบางส่วนตั้งแต่วันครบกำหนด / ใบที่ไม่ได้ล้างลูกหนี้ของงวด → ไม่ลง (รอบกลางคืนตั้งส่วนที่เหลือ)
   *   - สัญญาในสถานะที่รอบกลางคืนไม่ดูแล (ACCRUAL_EXCLUDED_CONTRACT_STATUSES — บอกเลิก/ตัดหนี้สูญ/ปิด/
   *     เปลี่ยนเครื่อง/ร่าง/ยกเลิก) → ไม่ลง ลงใบรับชำระตามเดิม + สัญญาณเตือนที่ส่ง**หลังธุรกรรม commit**
   *
   * ไม่จับ error ของฐานข้อมูล: ชนกับรอบกลางคืน/ใบรับชำระอีกใบ (P2002 จาก unique index ของ reference,
   * P2025 จากการเขียนยอดสะสมแบบ compare-and-set หรือ P2034) ต้องผ่านออกไปตามเดิม — webhook ของ
   * PaySolutions อาศัยคำตอบ 5xx เพื่อให้ส่งซ้ำ.
   */
  private async accrueBeforeReceipt(
    inst: {
      id: string;
      installmentNo: number;
      dueDate: Date;
      accrualJournalEntryId: string | null;
    },
    contract: { id: string; contractNumber: string; status: ContractStatus },
    input: PaymentReceiptPrimitiveInput,
    split: SplitReceiptResult,
    tx: Prisma.TransactionClient,
  ): Promise<{ accrual: AccrueAtReceiptResult | null; warnings: DeferredWarning[] }> {
    const statusAtReceipt = input.contractStatusBeforeReceipt ?? contract.status;
    const isFinalReceipt = input.isFinalReceipt ?? false;
    const receiptDate = input.postedAt ?? new Date();
    const decision = decideAccrueAtReceipt({
      alreadyAccrued: !!inst.accrualJournalEntryId,
      contractStatusBeforeReceipt: statusAtReceipt,
      isFinalReceipt,
      principalRemainingAfter: split.principalRemainingAfter,
      principalCleared: split.principalCleared,
      dueDateReached: isDueDateReached(inst.dueDate, receiptDate),
    });
    if (decision === 'ACCRUE') {
      return {
        accrual: await this.accrual.accrueAtReceipt(inst.id, receiptDate, tx),
        warnings: [],
      };
    }
    if (decision === 'ACCRUE_RECEIVED') {
      return {
        accrual: await this.accrual.accrueAtReceipt(
          inst.id,
          receiptDate,
          tx,
          split.principalCleared,
        ),
        warnings: [],
      };
    }
    if (decision !== 'CONTRACT_NOT_SERVED') return { accrual: null, warnings: [] };

    this.logger.warn(
      `[accrue-at-receipt] skipped — contract ${contract.contractNumber} was ${statusAtReceipt} before this receipt; ` +
        `receipt posts without a 2A accrual (installmentScheduleId=${inst.id})`,
    );
    return {
      accrual: null,
      warnings: [
        {
          message:
            '[accrue-at-receipt] receipt on a contract the accrual does not serve — 2A not posted',
          tags: { module: 'journal', action: 'accrue-at-receipt-skipped-status' },
          extra: {
            contractId: contract.id,
            contractNumber: contract.contractNumber,
            contractStatus: statusAtReceipt,
            installmentScheduleId: inst.id,
            installmentNo: inst.installmentNo,
            dueDate: inst.dueDate.toISOString(),
            paymentId: input.paymentId ?? null,
            isFinalReceipt,
            principalRemainingAfter: split.principalRemainingAfter.toFixed(2),
          },
        },
      ],
    };
  }

  private async executeInTx(
    input: PaymentReceiptPrimitiveInput,
    outerTx: Prisma.TransactionClient,
  ): Promise<PaymentReceiptResult> {
    const readClient: Prisma.TransactionClient = outerTx;

    const inst = await readClient.installmentSchedule.findUniqueOrThrow({
      where: { id: input.installmentScheduleId },
      include: { contract: true },
    });
    const c = inst.contract;

    const basis = computeInstallmentBreakdown(accrual2AInputOf(c, inst.installmentNo));
    const { installmentTotal } = basis;

    // Shared with the wizard's PARTIAL preview (reconstruct-prior.ts) so the
    // preview's allocation can't drift from what this template posts.
    const { priorPrincipalCleared, priorLateFeeBooked, priorClearings } =
      await reconstructPriorCleared(readClient, inst.id, installmentTotal);

    const delta = input.delta;
    const lateFeeGross = input.lateFee ?? new Decimal(0);
    const lateFeeWaived = input.lateFeeWaived ?? new Decimal(0);
    // Gross-waiver (D1): splitReceipt is fed the NET late fee (cash must cover only
    // the un-waived portion); the waived portion books to Dr 52-1105 + grosses up
    // Cr 42-1103 inside buildReceiptLines.
    const netLateFee = lateFeeGross.minus(lateFeeWaived);
    if (netLateFee.lt(0)) {
      throw new BadRequestException(
        `lateFeeWaived ${lateFeeWaived.toFixed(2)} exceeds late fee ${lateFeeGross.toFixed(2)}`,
      );
    }
    const advanceConsume = input.advanceConsume ?? new Decimal(0);
    const advanceCredit = input.advanceCredit ?? new Decimal(0);

    // Precondition for splitReceipt (review I-1): funds to allocate must be ≥0.
    // A mis-computed advanceCredit must never silently produce a negative JE line.
    if (advanceCredit.gt(delta.plus(advanceConsume))) {
      throw new BadRequestException(
        `advanceCredit ${advanceCredit.toFixed(2)} exceeds available funds (delta + advanceConsume ${delta
          .plus(advanceConsume)
          .toFixed(2)})`,
      );
    }

    const split = splitReceipt({
      delta,
      installmentTotal,
      lateFee: netLateFee,
      priorPrincipalCleared,
      priorLateFeeBooked,
      advanceConsume,
      advanceCredit,
      isFinalReceipt: input.isFinalReceipt ?? false,
    });

    // Tolerance enforcement (template-side; the pure fn stays Nest-free).
    if (split.overpayRounding.gt(TOLERANCE)) {
      throw new BadRequestException(
        `Payment difference ${split.overpayRounding.toFixed(2)} exceeds tolerance 1.00`,
      );
    }
    if ((input.isFinalReceipt ?? false) && split.principalRemainingAfter.gt(TOLERANCE)) {
      throw new BadRequestException(
        `Cannot close installment — residual ${split.principalRemainingAfter.toFixed(2)} exceeds tolerance 1.00`,
      );
    }
    // The ≤1฿ underpay-close (Dr 52-1104) still posts unconditionally; this guard
    // only waives the APPROVER REQUIREMENT. When `autoApproveSystemRounding` is set
    // the caller has certified that the payer covered the full billed amountDue and
    // the residual is a pure amountDue↔installmentTotal rounding artifact (Phase 5b),
    // so no toleranceApproverId is needed. A GENUINE customer underpayment leaves the
    // flag false and STILL requires an approver.
    if (
      split.underpayRounding.gt(0) &&
      !input.toleranceApproverId &&
      !input.autoApproveSystemRounding
    ) {
      throw new BadRequestException('Underpay tolerance requires approver (toleranceApproverId)');
    }

    // D1.1.6.3 (ported from 2B, PR-843/I2 Phase 3 3a) — when `adj_auto_route`
    // is off, refuse to auto-route a non-zero rounding remainder to the
    // adj_overpay (53-1503) / adj_underpay (52-1104) accounts. The owner must
    // clear the diff manually (e.g. via a manual JV) before the receipt posts.
    // Mirrors the 2B guard exactly so the most-used money path keeps the same
    // behaviour after the primitive swap.
    if (split.overpayRounding.gt(0) || split.underpayRounding.gt(0)) {
      if (!(await this.readAdjAutoRouteFlag(readClient))) {
        throw new BadRequestException('Auto-routing disabled — manual adjustment required');
      }
    }

    const overpayCode = this.roles?.tryCode('adj_overpay') ?? '53-1503';
    const underpayCode = this.roles?.tryCode('adj_underpay') ?? '52-1104';

    // Shared pure builder (also used by the wizard preview so the two can't drift).
    const lines = buildReceiptLines({
      split,
      debitAccountCode: input.debitAccountCode,
      delta,
      advanceConsume,
      advanceCredit,
      lateFeeWaived,
      overpayCode,
      underpayCode,
    });

    // Review I-1: refuse to post a meaningless zero-line JE. Reachable when a
    // caller issues a receipt against an already fully-cleared installment
    // (delta/advance all 0 and principalRemaining 0 → every line skipped).
    if (lines.length === 0) {
      throw new BadRequestException(
        `ไม่มีรายการบัญชีที่ต้องบันทึก — งวดนี้ถูกชำระครบแล้ว (installmentScheduleId: ${input.installmentScheduleId})`,
      );
    }

    // ตั้งลูกหนี้งวด ณ วันรับเงิน — ตรงนี้เท่านั้น: ทุกด่านข้างบนผ่านแล้ว (ใบที่ถูกปฏิเสธไม่ทิ้ง 2A ไว้) และ
    // `split` คือผลที่ใบรับชำระจะลงจริง. 2A ถูกลงก่อนใบรับชำระ ในธุรกรรมเดียวกัน (ทั้งงวด / ส่วนที่เหลือ /
    // เท่ายอดที่รับ).
    const { accrual, warnings } = await this.accrueBeforeReceipt(inst, c, input, split, outerTx);

    // ใบกำกับภาษีตามบัญชี (PR3 — D3–D5): ค่าที่ใบเสร็จของรายการนี้ต้องพิมพ์ — กติกาเดียวกับ 2A (7/107 · ใบที่ทำให้
    // ยอดสะสมของงวดครบรับส่วนที่เหลือ) เล่นซ้ำจากรายการก่อนหน้าของงวดที่ยังมีผล ในธุรกรรมนี้ (ลำดับแน่นอน)
    const tax = computeInstallmentReceiptTax({
      basis,
      priorClearings,
      delta,
      split,
      lateFeeWaived,
      advanceConsume,
      advanceCredit,
    });
    // ตรวจทาน (ไม่ใช่ด่าน): ภาษีของแถวค่างวดต้องเท่าภาษีขายของ 2A ที่ลงพร้อมกัน — ต่างกันได้เมื่องวดมีใบรับบางส่วน
    // ที่ไม่ได้ตั้ง 2A ของตัวเอง: ใบก่อน PR2ข · หรือใบตั้งแต่วันครบกำหนดในวันที่รอบกลางคืนไม่ได้ตั้งลูกหนี้งวด (ใบที่ทำให้
    // ครบจึงได้ 2A ทั้งงวด). ต่าง = สัญญาณเตือนหลัง commit ห้ามหยุดการรับชำระ
    const taxWarnings: DeferredWarning[] =
      accrual?.vat && !accrual.vat.eq(tax.installmentVat)
        ? [
            {
              message: '[receipt-tax] receipt VAT differs from the 2A output VAT posted with it',
              tags: { module: 'journal', action: 'receipt-vat-accrual-mismatch' },
              extra: {
                contractId: c.id,
                contractNumber: c.contractNumber,
                installmentScheduleId: inst.id,
                installmentNo: inst.installmentNo,
                paymentId: input.paymentId ?? null,
                accrualEntryNumber: accrual.entryNo,
                accrualVat: accrual.vat.toFixed(2),
                receiptInstallmentVat: tax.installmentVat.toFixed(2),
                principalCleared: split.principalCleared.toFixed(2),
              },
            },
          ]
        : [];

    // companyId intentionally omitted: every line here is a FINANCE account
    // (11-2103 / 42-1103 / 53-1503 / 52-1104 / 21-1103 / deposit), so createAndPost's
    // FINANCE default is correct — matches PaymentReceipt2B(Split)Template. (Review I-2)
    const result = await this.journal.createAndPost(
      {
        description: `รับชำระงวด #${inst.installmentNo} — สัญญา ${c.contractNumber}`,
        // PR-843/I2 Phase 3 PR 3.1 — the JE `reference` is ALWAYS a fresh UUID, never
        // `input.paymentId`. The epic posts MULTIPLE receipt JEs per Payment (a partial
        // then a completion on one installment) sharing the SAME paymentId; keying the
        // JE reference off paymentId would collide on the partial-unique index
        // `journal_entries_ref_unique (reference_type, reference_id)`. The canonical
        // payment→JE link is `metadata.paymentId` (below) — that is what voidReceipt /
        // markReversed query to reverse EVERY receipt JE of a payment.
        reference: randomUUID(),
        postedAt: input.postedAt,
        metadata: {
          tag: 'receipt',
          // Traceability/queryability for the per-receipt flow (PR 3.1).
          flow: 'payment-receipt',
          contractId: c.id,
          installmentScheduleId: inst.id,
          // Canonical payment→JE key. N receipt JEs of one payment all share this.
          paymentId: input.paymentId ?? null,
          // Stamped-only per-receipt idempotency key (no unique constraint in PR 3.1 —
          // enforcement is the 3a/3b follow-up; see PaymentReceiptPrimitiveInput JSDoc).
          idempotencyKey: input.idempotencyKey ?? null,
          deltaApplied: delta.toString(),
          principalCleared: split.principalCleared.toString(),
          lateFeePortion: split.lateFeePortion.toString(),
          lateFeeWaived: lateFeeWaived.toString(),
          // เลขที่รายการ 2A ที่ใบนี้ทำให้ลง (ก1) — ให้เอกสาร/รายงานภาษีขายต่อใบเสร็จอ่านยอดจากสมุดบัญชีได้
          ...(accrual ? { accrualEntryNumber: accrual.entryNo } : {}),
          // ใบกำกับภาษีตามบัญชี (PR3): ค่าที่ใบเสร็จของรายการนี้ต้องพิมพ์ — generateReceipt คัดลอกลงแถว Receipt
          receiptTax: { ...tax.breakdown },
        },
        lines,
      },
      outerTx,
    );

    return {
      entryNo: result.entryNumber,
      split,
      accrual,
      warnings: [...warnings, ...taxWarnings],
      receiptTax: tax.breakdown,
    };
  }
}
