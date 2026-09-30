import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  Accrual2AKind,
  Accrual2APartResult,
  accrual2AInputOf,
  accruedSoFarOf,
  buildPartialAccrual2ALines,
  buildRemainderAccrual2ALines,
  resolveAccrualPeriodCheckDate,
  resolveAccrualPostingDate,
} from '../build-accrual-2a-lines';
import { feeNettedOutstanding } from '../compute-cn-breakdown';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import {
  ADVANCE_CONSUME_ON_ACCRUAL_FLOW,
  RESCHEDULE_PARK_CONSUME_FLOW,
  reconstructPriorCleared,
} from '../reconstruct-prior';
// EIR utility removed — CPA Policy A revert (#783) reverted to straight-line allocation.

/** `metadata.trigger` ของรายการ 2A ที่ลง ณ วันรับเงิน (คำตัดสินฝ่ายบัญชี D2, 2026-09-28). */
export const ACCRUAL_TRIGGER_RECEIPT = 'receipt';

/**
 * `metadata.portion` ของรายการ 2A ที่ตั้งเพียงบางส่วนของงวด / ส่วนที่เหลือของงวดที่เคยตั้งบางส่วน
 * (คำตอบฝ่ายบัญชี ก1 29/09/2569). รายการที่ตั้งทั้งงวดในรายการเดียวไม่มีคีย์นี้ (เหมือนเดิมทุกตัวอักษร).
 */
export const ACCRUAL_PORTION_PARTIAL = 'partial';
export const ACCRUAL_PORTION_REMAINDER = 'remainder';

/**
 * `reference` ของรายการ 2A บางส่วนลำดับที่ k (เริ่มที่ 1) ของงวด. รายการที่ทำให้งวดตั้งครบใช้ reference
 * เดิม (`<id>` / `<id>:re-accrual:<n>` — resolveAccrualReference) เสมอ.
 */
export function receiptAccrualReference(installmentScheduleId: string, k: number): string {
  return `${installmentScheduleId}:receipt-accrual:${k}`;
}

type EntryWithLines = Prisma.JournalEntryGetPayload<{ include: { lines: true } }>;

/**
 * รายการ 2A บางส่วนทุกใบของงวด (ทั้งที่ยังมีผลและที่ถูกกลับแล้ว) ตามลำดับ k — อ่านด้วยค่าเท่ากันบน
 * (referenceType, referenceId) ทีละค่า หยุดที่ k แรกที่ไม่มีรายการถือ. ห้ามค้นแบบ "ขึ้นต้นด้วย" ในธุรกรรม
 * Serializable ของการรับชำระ/การยกเลิกใบเสร็จ. ใช้โดยการกลับรายการตอนยกเลิกใบเสร็จ.
 */
export async function findReceiptAccrualEntries(
  client: Pick<Prisma.TransactionClient, 'journalEntry'>,
  installmentScheduleId: string,
): Promise<EntryWithLines[]> {
  const entries: EntryWithLines[] = [];
  for (let k = 1; ; k += 1) {
    const entry = await client.journalEntry.findFirst({
      where: {
        referenceType: 'AUTO',
        referenceId: receiptAccrualReference(installmentScheduleId, k),
        deletedAt: null,
      },
      include: { lines: true },
    });
    if (!entry) return entries;
    entries.push(entry);
  }
}

type AccrualInstallment = Prisma.InstallmentScheduleGetPayload<Record<string, never>>;
type AccrualContract = Prisma.ContractGetPayload<Record<string, never>>;

export interface AccrueAtReceiptResult {
  entryNo: string;
  /** วันที่ลงรายการ 2A = min(วันครบกำหนด, วันที่รับเงิน). */
  postedAt: Date;
  /** FULL = ทั้งงวดในรายการเดียว · PARTIAL = เท่ายอดที่รับ · REMAINDER = ส่วนที่เหลือของงวด */
  kind: Accrual2AKind;
  /** ยอด Dr 11-2103 ของรายการนี้ */
  amount: Decimal;
  /** รายการนี้ทำให้งวดตั้งลูกหนี้ครบ (ประทับ accrualJournalEntryId แล้ว) */
  completes: boolean;
}

/**
 * Template 2A — Installment Accrual. The nightly job (InstallmentAccrualCron → `execute`) accrues
 * each installment on its due date; `accrueAtReceipt` accrues at the receipt that settles an
 * un-accrued installment (คำตัดสินฝ่ายบัญชี D2, 2026-09-28).
 *
 * Spec §6.2 — recognizes each installment as it comes due:
 *
 *   Dr 11-2103 ลูกหนี้ค้างชำระ          (installmentTotal = installmentExclVat + vatPerInst)
 *   Dr 21-2102 ล้างภาษีขายรอเรียกเก็บ   (vatPerInst)
 *   Dr 11-2106 ล้างรายได้รอตัดบัญชี      (interestPerInst)
 *     Cr 11-2101 ลูกหนี้ Gross (ลด)       (installmentExclVat)
 *     Cr 11-2105 ลูกหนี้ภาษีขายรอฯ (ล้าง) (vatPerInst)
 *     Cr 41-1101 รายได้ดอกเบี้ย (รับรู้)   (interestPerInst)
 *     Cr 21-2101 ภาษีขาย ภ.พ.30           (vatPerInst)
 *
 * ตั้งตามสัดส่วนยอดที่รับ (คำตอบฝ่ายบัญชี ก1 "แบบ ข" 29/09/2569): ใบรับชำระบางส่วนก่อนวันครบกำหนดตั้ง 2A
 * เท่ายอดที่รับ (buildPartialAccrual2ALines) — ส่วนที่เหลือตั้งโดยใบที่ทำให้งวดชำระครบ หรือโดยรอบกลางคืน
 * ณ วันครบกำหนด (buildRemainderAccrual2ALines). ยอดที่ตั้งไปแล้วเก็บใน InstallmentSchedule.accruedAmount /
 * accruedVat / accruedInterest (เขียนในธุรกรรมเดียวกับทุกรายการ 2A); accrualJournalEntryId = รายการที่ทำให้
 * งวด "ตั้งครบ" — ความหมายเดิมของผู้อ่านทุกราย.
 *
 * Rounding modes:
 *   installmentExclVat = grossExclVat / totalMonths → ROUND_DOWN  (17000/12 = 1416.66)
 *   vatPerInst         = vatTotal / totalMonths     → ROUND_HALF_UP (1190/12 = 99.17)
 *   interestPerInst    = interest / totalMonths     → ROUND_HALF_UP straight-line (CPA Policy A · #783)
 *
 * Recognition policy (Wave 4 / Task 2 — Info comments):
 *   - TFRS 15 §35(b): performance obligation satisfied "over time" — financing
 *     service is consumed by the customer through each due date, so revenue is
 *     recognised per period (this template, fired daily by accrual cron).
 *   - Interest recognition: straight-line allocation per period (NPAEs simplification
 *     per W-003 in CLAUDE.md). NOT effective interest method (EIR).
 *     Material deviation from EIR documented in audit report; owner+CPA approved
 *     NPAEs simplification (target adoption date TBD).
 *   - VAT recognition: deferred VAT (21-2102 booked at contract activation) is
 *     reclassified to settled VAT (21-2101) per period — matches TFRS 15
 *     pattern of recognising tax liability when service is performed.
 *
 * Idempotent: returns null if accrualJournalEntryId is already set on the installment (= งวดตั้งครบแล้ว).
 */
@Injectable()
export class InstallmentAccrual2ATemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    installmentScheduleId: string,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string } | null> {
    // Fast idempotency check outside the transaction (avoids opening a tx for
    // already-accrued installments — the common case on repeated cron ticks).
    // อ่านผ่านธุรกรรมของผู้เรียกเมื่อมี — client หลักมองไม่เห็นแถวตารางงวดที่เพิ่งสร้างและยังไม่ commit
    const instCheck = await (outerTx ?? this.prisma).installmentSchedule.findUniqueOrThrow({
      where: { id: installmentScheduleId },
      select: { accrualJournalEntryId: true },
    });
    if (instCheck.accrualJournalEntryId) return null;

    if (outerTx) {
      return this.run(installmentScheduleId, outerTx);
    }
    // No outer tx — self-wrap so the JE post + accrualJournalEntryId stamp +
    // advance-consume JE + contract/payment updates are one atomic unit.
    // A crash between any of these steps can no longer produce a duplicate
    // accrual JE on the next cron tick (the idempotency stamp is committed
    // atomically with the JE).
    //
    // Serializable isolation: the advance-consume leg reads contract.advanceBalance
    // then decrements it. The payment paths (PaySolutions webhook, recordPayment) also
    // decrement advanceBalance under Serializable — without matching isolation here a
    // concurrent accrual + payment could both read the same balance and double-consume.
    // On a serialization conflict the cron's per-installment try/catch retries next tick
    // (idempotent — accrualJournalEntryId is not stamped on a rolled-back tx).
    return this.prisma.$transaction((tx) => this.run(installmentScheduleId, tx), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  /**
   * ตั้งลูกหนี้งวด ณ วันรับเงิน (คำตัดสินฝ่ายบัญชี D2, 2026-09-28 + ก1, 2026-09-29) — เรียกจาก
   * PaymentReceiptTemplate ภายในธุรกรรมของการรับชำระเท่านั้น.
   *
   * `amountReceived` ไม่ส่ง = ใบที่ทำให้งวดชำระครบ → ตั้งส่วนที่เหลือของงวด (ยังไม่เคยตั้ง = ทั้งงวด).
   * ส่ง = ใบบางส่วนก่อนวันครบกำหนด → ตั้งเท่ายอดนี้ (split.principalCleared) ตามสูตร ก1; ยอดที่ถึงส่วนที่เหลือ
   * ของงวด = ตั้งส่วนที่เหลือทั้งหมดและงวดตั้งครบ.
   *
   * "แกนอย่างเดียว": ลงรายการ 2A + เขียนยอดสะสมของงวด (accruedAmount/Vat/Interest) และประทับ
   * accrualJournalEntryId เฉพาะเมื่อรายการนี้ทำให้งวดตั้งครบ (postPart) — ไม่หักเงินรับล่วงหน้า
   * (ทั้งถังรวมและถังพักงวดสุดท้าย) และไม่แตะแถว Payment เพราะเส้นทางรับชำระเป็นผู้จัดการสองอย่างนั้น.
   * ตรวจซ้ำ (idempotency) ด้วย `tx` ที่ส่งเข้ามา จึงเห็นตารางงวดที่เพิ่งสร้างในธุรกรรมเดียวกัน
   * (ensureInstallmentSchedules).
   *
   * ไม่ตรวจสถานะสัญญา: เส้นทางรับชำระเปลี่ยนสถานะสัญญาเป็น COMPLETED / EARLY_PAYOFF ก่อนเรียกมาถึงที่นี่
   * ผู้เรียก (PaymentReceiptTemplate) เป็นผู้ตัดสินจากสถานะก่อนรับเงิน.
   * ไม่จับ error ของฐานข้อมูล (P2002 / P2025 / P2034): ปล่อยให้ธุรกรรมของผู้เรียกล้มตามเดิม.
   *
   * คืน null เมื่องวดถูกตั้งลูกหนี้ครบไปแล้ว หรือไม่มียอดให้ตั้ง (ยอดที่รับ ≤ 0).
   */
  async accrueAtReceipt(
    installmentScheduleId: string,
    receiptDate: Date,
    tx: Prisma.TransactionClient,
    amountReceived?: Decimal,
  ): Promise<AccrueAtReceiptResult | null> {
    const inst = await tx.installmentSchedule.findUniqueOrThrow({
      where: { id: installmentScheduleId },
    });
    if (inst.accrualJournalEntryId) return null;

    const c = await tx.contract.findUniqueOrThrow({ where: { id: inst.contractId } });
    const part = this.buildPart(inst, c, amountReceived);
    if (!part.portion.total.gt(0)) return null;

    const postedAt = resolveAccrualPostingDate(inst.dueDate, receiptDate);
    await this.assertAccrualPeriodOpen(
      tx,
      inst.installmentNo,
      resolveAccrualPeriodCheckDate(inst.dueDate, receiptDate),
    );

    const posted = await this.postPart(inst, c, part, tx, {
      postedAt,
      extraMetadata: {
        trigger: ACCRUAL_TRIGGER_RECEIPT,
        receiptDate: receiptDate.toISOString(),
      },
    });
    return {
      entryNo: posted.entryNo,
      postedAt,
      kind: part.kind,
      amount: part.portion.total,
      completes: part.completes,
    };
  }

  /**
   * ส่วนของงวดที่รายการนี้จะตั้ง — จากตัวสร้างกลาง (ใช้ร่วมกับ preview และการตรวจทานตอนกลับรายการ)
   * ห้ามคำนวณยอดเองในไฟล์นี้. `amountReceived` ไม่ส่ง = ส่วนที่เหลือของงวด.
   */
  private buildPart(
    inst: AccrualInstallment,
    c: AccrualContract,
    amountReceived?: Decimal,
  ): Accrual2APartResult {
    const input = accrual2AInputOf(c, inst.installmentNo);
    const accrued = accruedSoFarOf(inst);
    return amountReceived === undefined
      ? buildRemainderAccrual2ALines(input, accrued)
      : buildPartialAccrual2ALines(input, accrued, amountReceived);
  }

  /**
   * ลงรายการ 2A + เขียนยอดสะสม (accruedAmount/Vat/Interest) + ประทับ accrualJournalEntryId เมื่อรายการนี้
   * ทำให้งวดตั้งครบ — ในธุรกรรมเดียวกัน.
   *
   * การเขียนแถวตารางงวดเป็น compare-and-set: ต้องยังไม่มีลิงก์ และ accruedAmount ต้องยังเท่ากับยอดที่
   * รายการนี้ใช้คำนวณ — ถ้ามีรายการ 2A ของงวดเดียวกันลงแทรกเข้ามา (ใบรับชำระอีกใบ / รอบกลางคืน)
   * การเขียนไม่พบแถว (P2025) และธุรกรรมล้มทั้งรายการ. ชั้นแรกคือ Serializable ของผู้เรียก และ unique index
   * ของ reference (`<id>:receipt-accrual:<k>` ตัวเดียวกันสำหรับสองใบที่แทรกกัน).
   */
  private async postPart(
    inst: AccrualInstallment,
    c: AccrualContract,
    part: Accrual2APartResult,
    tx: Prisma.TransactionClient,
    opts: { postedAt: Date; extraMetadata?: Record<string, string> },
  ): Promise<{ entryNo: string }> {
    const amountLabel = part.portion.total.toFixed(2);
    const description =
      part.kind === 'FULL'
        ? `Accrual งวด #${inst.installmentNo} — สัญญา ${c.contractNumber}`
        : part.kind === 'PARTIAL'
          ? `Accrual งวด #${inst.installmentNo} (ตั้งเท่ายอดที่รับ ${amountLabel}) — สัญญา ${c.contractNumber}`
          : `Accrual งวด #${inst.installmentNo} (ส่วนที่เหลือ ${amountLabel}) — สัญญา ${c.contractNumber}`;
    const portion =
      part.kind === 'PARTIAL'
        ? { portion: ACCRUAL_PORTION_PARTIAL }
        : part.kind === 'REMAINDER'
          ? { portion: ACCRUAL_PORTION_REMAINDER }
          : {};

    const result = await this.journal.createAndPost(
      {
        description,
        reference: part.completes
          ? await this.resolveAccrualReference(tx, inst.id)
          : await this.nextReceiptAccrualReference(tx, inst.id),
        metadata: {
          tag: '2A',
          contractId: c.id,
          installmentScheduleId: inst.id,
          ...portion,
          ...(opts.extraMetadata ?? {}),
        },
        postedAt: opts.postedAt,
        lines: part.lines,
      },
      tx,
    );

    await tx.installmentSchedule.update({
      where: {
        id: inst.id,
        accrualJournalEntryId: null,
        accruedAmount: accruedSoFarOf(inst).amount,
      },
      data: {
        accruedAmount: part.accruedAfter.amount,
        accruedVat: part.accruedAfter.vat,
        accruedInterest: part.accruedAfter.interest,
        ...(part.completes ? { accrualJournalEntryId: result.entryNumber } : {}),
      },
    });

    return { entryNo: result.entryNumber };
  }

  /**
   * `reference` ของรายการ 2A บางส่วนที่กำลังจะลง = `<id>:receipt-accrual:<k>` โดย k = เลขแรก (เริ่มที่ 1)
   * ที่ยังไม่มีรายการถือ — รายการที่ถูกกลับแล้วยังถือ reference ของตัวเอง จึงถูกข้าม. สองใบที่ลงพร้อมกันได้ k
   * เดียวกัน ฝ่ายหลังชน unique index. อ่านด้วยค่าเท่ากันทีละค่า (ไม่ค้นแบบ "ขึ้นต้นด้วย").
   */
  private async nextReceiptAccrualReference(
    tx: Prisma.TransactionClient,
    installmentScheduleId: string,
  ): Promise<string> {
    for (let k = 1; ; k += 1) {
      const reference = receiptAccrualReference(installmentScheduleId, k);
      const holder = await tx.journalEntry.findFirst({
        where: { referenceType: 'AUTO', referenceId: reference, deletedAt: null },
        select: { id: true }, // ถามแค่ว่ามีรายการถือ reference นี้หรือไม่
      });
      if (!holder) return reference;
    }
  }

  /**
   * `reference` ของรายการ 2A ที่ทำให้งวดตั้งครบ (ทั้งงวดในรายการเดียว / ส่วนที่เหลือ) — รายการบางส่วนใช้
   * nextReceiptAccrualReference.
   *
   * ปกติ = id ของแถวตารางงวด (เหมือนเดิมทุกตัวอักษร) — unique index `journal_entries_ref_unique`
   * จึงกันการตั้งลูกหนี้งวดเดียวกันสองครั้งในระดับฐานข้อมูล. เมื่อรายการ 2A ของงวดถูกกลับรายการตอน
   * ยกเลิกใบเสร็จ (ReceiptVoidReversalTemplate.voidAccrualPostedAtReceipt) รายการเดิมคง POSTED
   * และยังถือ reference เดิมอยู่ — รายการที่ตั้งใหม่จึงใช้ `<id>:re-accrual:<n>` โดย n = เลขแรก (เริ่มที่ 1)
   * ที่ยังไม่มีรายการถืออยู่ หรือรายการที่ถืออยู่ยังมีผล (ไม่ถูกกลับ). กรณีหลังได้ reference ของรายการที่ยัง
   * มีผลนั้นเอง ให้ unique index เป็นผู้กันการตั้งซ้ำ — ไม่ข้ามไปเลขถัดไป. สองธุรกรรมที่ตั้งใหม่พร้อมกัน
   * ได้ reference เดียวกัน ฝ่ายหลังจึงยังชน unique index เหมือนเดิม.
   *
   * อ่านด้วยค่าเท่ากันบน (referenceType, referenceId) ทีละค่าเท่านั้น — ใช้ unique index ตรง ๆ.
   * ห้ามค้นแบบ "ขึ้นต้นด้วย": อาจกลายเป็นการกวาดทั้งตาราง journal_entries ในธุรกรรม Serializable
   * ของการรับชำระ/รอบกลางคืน. จำนวนรอบ = จำนวนครั้งที่รายการตั้งลูกหนี้งวดของงวดนี้เคยถูกกลับ + 1.
   */
  private async resolveAccrualReference(
    tx: Prisma.TransactionClient,
    installmentScheduleId: string,
  ): Promise<string> {
    const isReversed = (entry: { metadata: Prisma.JsonValue } | null): boolean =>
      (entry?.metadata as Record<string, unknown> | null)?.reversed === true;
    const holderOf = (referenceId: string) =>
      tx.journalEntry.findFirst({
        where: { referenceType: 'AUTO', referenceId, deletedAt: null },
        select: { metadata: true },
      });

    if (!isReversed(await holderOf(installmentScheduleId))) return installmentScheduleId;

    for (let n = 1; ; n += 1) {
      const reference = `${installmentScheduleId}:re-accrual:${n}`;
      if (!isReversed(await holderOf(reference))) return reference;
    }
  }

  /**
   * งวดบัญชี FINANCE ของรายการ 2A ต้องยังเปิด — ถ้าปิดแล้ว ปฏิเสธการรับชำระทั้งรายการ (ธุรกรรมของ
   * ผู้เรียก roll back). `periodCheckDate` คือ Date ที่ใช้ตัดสินงวด (resolveAccrualPeriodCheckDate).
   *
   * ข้อความบอก**เฉพาะเดือนที่ปิด** อ่านจาก `periodCheckDate` ด้วย getter ชุดเดียวกับ validatePeriodOpen
   * (เวลาของโปรเซส) จึงเป็นเดือนเดียวกับที่ถูกตรวจเสมอ. ไม่ใส่วันที่ลงรายการ: บน prod โปรเซสรันด้วย
   * TZ=Asia/Bangkok สองค่าจึงตรงกัน แต่ในโปรเซสที่รันเป็น UTC (เช่น jest บน CI) งวดที่ครบกำหนดวันที่ 1 จะถูก
   * ตรวจกับเดือนก่อน — ถ้าใส่ทั้งวันที่ (เวลาไทย) และเดือน ข้อความจะอ่านขัดกันเอง.
   * ให้ติดต่อฝ่ายบัญชี — ไม่ชี้เมนู (การเปิดงวดเป็นสิทธิ์ของเจ้าของกิจการ) และไม่รับปากว่าเปิดได้เสมอ
   * (งวดที่ส่งเข้าโปรแกรมบัญชีภายนอกแล้วเปิดไม่ได้).
   */
  private async assertAccrualPeriodOpen(
    tx: Prisma.TransactionClient,
    installmentNo: number,
    periodCheckDate: Date,
  ): Promise<void> {
    const finance = await tx.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    try {
      await validatePeriodOpen(tx, periodCheckDate, finance?.id);
    } catch (e) {
      if (e instanceof BadRequestException) {
        const closedMonth =
          `${String(periodCheckDate.getMonth() + 1).padStart(2, '0')}/` +
          `${periodCheckDate.getFullYear() + 543}`;
        throw new BadRequestException(
          `ไม่สามารถรับชำระงวด #${installmentNo} ได้ — ระบบต้องตั้งลูกหนี้งวดนี้ในงวดบัญชีเดือน ${closedMonth} ซึ่งปิดแล้ว ` +
            'กรุณาติดต่อฝ่ายบัญชีเพื่อขอเปิดงวดบัญชีเดือนดังกล่าว เมื่อเปิดงวดแล้วจึงบันทึกรับชำระอีกครั้ง',
        );
      }
      throw e;
    }
  }

  private async run(
    installmentScheduleId: string,
    tx: Prisma.TransactionClient,
  ): Promise<{ entryNo: string } | null> {
    const inst = await tx.installmentSchedule.findUniqueOrThrow({
      where: { id: installmentScheduleId },
    });

    // Idempotency guard (re-check inside tx in case two concurrent cron ticks
    // both passed the outer fast-check before either committed).
    if (inst.accrualJournalEntryId) return null;

    const c = await tx.contract.findUniqueOrThrow({ where: { id: inst.contractId } });

    // รอบกลางคืน: ลงวันครบกำหนด — ส่วนที่เหลือของงวด (งวดที่ยังไม่เคยตั้ง = ทั้งงวด เหมือนเดิมทุกตัวอักษร;
    // งวดที่ใบรับชำระบางส่วนก่อนวันครบกำหนดตั้งไปแล้ว = ยอดของงวด − ยอดที่ตั้งไปแล้ว ทีละบัญชี)
    const part = this.buildPart(inst, c);
    if (!part.portion.total.gt(0)) return null;
    const core = await this.postPart(inst, c, part, tx, { postedAt: inst.dueDate });
    const installmentTotal = part.installmentTotal;
    const zero = new Decimal(0);

    // CPA Policy A — Auto-consume advance balance on accrual.
    //
    // If the contract has an advance parked in 21-1103 (from a payment
    // posted before this installment's due date — see PaymentReceipt2B
    // `advanceCredit` flow), immediately clear the part of this installment
    // that is still outstanding — capped by the two-layer ceiling below, not
    // the full installmentTotal — inside the same tx. Otherwise the trial
    // balance shows both the freshly-accrued 11-2103 receivable AND the
    // advance liability sitting alongside each other until the next 2B
    // receipt fires — which only happens if the customer pays again.
    // Auto-clearing here keeps the books accurate without requiring a
    // redundant manual payment touch.
    //
    // JE: Dr 21-1103 (consume advance) / Cr 11-2103 (clear receivable)
    //   for amount = min(advanceBalance, เพดานสองชั้นข้างล่าง).
    //
    // เพดาน (PR2ข — เดิมหักได้ถึง installmentTotal → งวดที่รับบางส่วนก่อนวันครบกำหนดถูกหักเงินรับล่วงหน้าเกิน,
    // 11-2103 ติดลบ และ amountPaid เกินยอดเรียกเก็บ — ข้อบกพร่องที่ PR2 ปักไว้ใน accrue-at-receipt.integration.spec.ts):
    //   (ก) ยอดที่ยังค้างบนแถว Payment ของงวด — feeNettedOutstanding (สูตร FEE-FIRST ที่ ECL/CN ใช้) ·
    //       ไม่มีแถว Payment = ค้างเต็มงวด
    //   (ข) ยอดลูกหนี้ของงวดที่ยังไม่ถูกล้างในสมุดบัญชี = installmentTotal − priorPrincipalCleared
    //       (reconstructPriorCleared ตัวเดียวกับที่ PaymentReceiptTemplate อ่านในธุรกรรมของมัน) — แถว Payment
    //       วัดจากยอดเรียกเก็บซึ่งอาจปัดเป็นเลขกลมสูงกว่ายอดในบัญชี (เช่น 1,516.00 กับ 1,515.83) จึงใช้เป็นเพดาน
    //       เดียวไม่ได้ (คำตัดสินผู้คุมงาน 2026-09-30)
    //
    // Atomicity: posted in the same tx as the accrual JE + schedule update,
    // so a JE-post failure rolls everything back — no partially-consumed
    // advance with the receivable still showing.
    const advanceBalance = new Decimal(c.advanceBalance.toString());
    let genericConsumed = zero;
    const paymentForGeneric = advanceBalance.gt(0)
      ? await tx.payment.findFirst({
          where: {
            contractId: c.id,
            installmentNo: inst.installmentNo,
            deletedAt: null,
          },
          select: {
            id: true,
            amountDue: true,
            amountPaid: true,
            lateFee: true,
            lateFeeWaived: true,
          },
        })
      : null;
    // (ข) อ่านครั้งเดียวเมื่อต้องใช้ (มีเงินรับล่วงหน้า หรือถังพักของงวดสุดท้าย) — ใช้ทั้งถังรวมและถังพัก
    let ledgerOutstanding: Decimal | null = null;
    const ledgerCap = async (): Promise<Decimal> => {
      if (ledgerOutstanding === null) {
        const { priorPrincipalCleared } = await reconstructPriorCleared(
          tx,
          inst.id,
          installmentTotal,
        );
        ledgerOutstanding = Decimal.max(zero, installmentTotal.minus(priorPrincipalCleared));
      }
      return ledgerOutstanding;
    };
    const genericCap = advanceBalance.gt(0)
      ? Decimal.min(
          paymentForGeneric
            ? feeNettedOutstanding(paymentForGeneric, installmentTotal)
            : installmentTotal,
          await ledgerCap(),
        )
      : zero;
    if (advanceBalance.gt(0) && genericCap.gt(0)) {
      const consume = Decimal.min(advanceBalance, genericCap);
      genericConsumed = consume;

      await this.journal.createAndPost(
        {
          description: `หักเงินรับล่วงหน้าเข้างวด #${inst.installmentNo} — สัญญา ${c.contractNumber}`,
          // Flow string + reference suffix come from the SAME constant
          // reconstructPriorCleared's always-include allow-list is built from, so
          // the reader and the writer can never drift (see reconstruct-prior.ts).
          reference: `${inst.id}:${ADVANCE_CONSUME_ON_ACCRUAL_FLOW}`,
          metadata: {
            tag: '2B',
            flow: ADVANCE_CONSUME_ON_ACCRUAL_FLOW,
            contractId: c.id,
            installmentScheduleId: inst.id,
            installmentNo: inst.installmentNo,
            consumeAmount: consume.toFixed(2),
          },
          postedAt: inst.dueDate,
          lines: [
            {
              accountCode: '21-1103',
              dr: consume,
              cr: zero,
              description: 'หักเงินรับล่วงหน้าเข้างวด',
            },
            {
              accountCode: '11-2103',
              dr: zero,
              cr: consume,
              description: 'ล้างลูกหนี้ค้างชำระ (จาก advance)',
            },
          ],
        },
        tx,
      );

      // Decrement contract's parked advance balance by the consumed amount.
      await tx.contract.update({
        where: { id: c.id },
        data: { advanceBalance: { decrement: consume } },
      });

      // Reflect the consume on the existing Payment row (if one was
      // pre-created when the advance was first received). Fully covered
      // installments flip to PAID; partial covers stay PARTIALLY_PAID.
      // แถวเดียวกับที่อ่านไว้ทำเพดานข้างบน (ยังไม่มีอะไรในธุรกรรมนี้แก้แถวนั้น)
      const payment = paymentForGeneric;
      if (payment) {
        const newAmountPaid = new Decimal(payment.amountPaid.toString()).plus(consume);
        const due = new Decimal((payment.amountDue ?? installmentTotal).toString());
        const isPaidInFull = newAmountPaid.gte(due);
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            amountPaid: newAmountPaid,
            status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID',
            paidDate: isPaidInFull ? new Date() : null,
            paidAt: isPaidInFull ? new Date() : null,
          },
        });
      } else {
        // No Payment row at accrual time. The advance-consume JE still posts
        // correctly (Dr 21-1103 / Cr 11-2103) — but the Payment row's amountPaid
        // stays at its prior value (0 when the row is created later). That timing
        // window makes FINAL-REVIEW BLOCKER 1 reachable: a subsequent receipt fired
        // against that 0-amountPaid Payment would re-clear an installment the
        // advance already cleared. Alert ops to backfill the Payment row so it
        // reflects the consume. Do NOT throw — that would break the accrual cron.
        Sentry.captureMessage('Advance consumed on accrual with no Payment row to update', {
          level: 'error',
          tags: {
            module: 'journal',
            action: 'advance-consume-no-payment-row',
          },
          extra: {
            contractId: c.id,
            contractNumber: c.contractNumber,
            installmentScheduleId: inst.id,
            installmentNo: inst.installmentNo,
            consume: consume.toFixed(2),
          },
        });
      }
    }

    // Park-at-last-installment (owner directive 2026-08-16) — Contract.
    // rescheduleAdvanceBalance is a SEPARATE bucket from the generic advance
    // above (reschedule fees, 6a/6b). It is relieved ONLY on the contract's
    // LAST installment, never FIFO'd into whichever installment accrues next
    // — every OTHER installment must leave this bucket untouched. Runs AFTER
    // the generic-advance block so its cap (installmentTotal minus whatever
    // the generic advance already cleared) reflects any generic consume that
    // happened above in this same tx.
    const parkBalance = new Decimal((c.rescheduleAdvanceBalance ?? 0).toString());
    const remainingAfterGeneric = installmentTotal.minus(genericConsumed);

    // Both "nothing parked" and "generic advance already covered the whole
    // installment" are decided BEFORE any Payment I/O: in either case
    // `parkConsume` would be 0 no matter what the row says, so reading it would
    // be a wasted query on every last-installment accrual of every contract that
    // has no park bucket (the overwhelming majority). Keeping the short-circuit
    // here also preserves the pre-park invariant that this branch performs zero
    // Payment reads when there is no park balance to relieve.
    if (inst.installmentNo === c.totalMonths && parkBalance.gt(0) && remainingAfterGeneric.gt(0)) {
      // Payment row read UP FRONT (was: after the JE post) — it is now an INPUT to
      // the cap, not just something to stamp afterwards. Reading it here is exactly
      // as fresh: the generic block above already committed its own
      // `payment.update` earlier in this same tx, and posting the park JE does not
      // touch Payment rows.
      const paymentForPark = await tx.payment.findFirst({
        where: {
          contractId: c.id,
          installmentNo: inst.installmentNo,
          deletedAt: null,
        },
        select: {
          id: true,
          amountDue: true,
          amountPaid: true,
          lateFee: true,
          lateFeeWaived: true,
        },
      });

      // I-3 (final review 2026-08-16) — cap by what is ACTUALLY still owed on the
      // row, not just by `installmentTotal − genericConsumed`.
      //
      // The last installment can legitimately be settled (or part-settled) BEFORE
      // its own accrual runs — that is จุดหัก 2 of the park spec (wizard/orchestrator
      // pays the last installment early and relieves the park bucket there). Without
      // this cap the accrual relieves the park a SECOND time: `Payment.amountPaid`
      // climbs above `amountDue` and 11-2103 goes NEGATIVE for the row.
      //
      // The remaining-balance formula is the house FEE-FIRST convention (PR #1313).
      // It is IMPORTED from `feeNettedOutstanding` in
      // `apps/api/src/modules/journal/compute-cn-breakdown.ts` — the single source of
      // truth shared by ECL (DUE) and CN (ACCRUED) — rather than re-derived here, per
      // that plan's Global Constraint that this formula must never exist in two
      // places. (Repair round 2, 2026-08-17: was a verbatim local copy.)
      // No Payment row at all → installment never touched → fully outstanding
      // (same convention as computeInstallmentOutstanding's ACCRUED branch).
      // PR2ข: ชั้นที่สาม = ยอดลูกหนี้ของงวดที่ยังไม่ถูกล้างในสมุดบัญชี หักส่วนที่ถังรวมเพิ่งล้างข้างบน
      // (เพดาน (ข) ของถังรวม — ยอดเรียกเก็บปัดเลขกลมต้องไม่ทำให้ถังพักล้างเกินยอดในบัญชีเช่นกัน)
      const rowOutstanding = paymentForPark
        ? feeNettedOutstanding(paymentForPark, installmentTotal)
        : installmentTotal;
      const parkCap = Decimal.min(
        remainingAfterGeneric,
        rowOutstanding,
        (await ledgerCap()).minus(genericConsumed),
      );

      // `parkBalance > 0` and `remainingAfterGeneric > 0` are already guaranteed by
      // the outer guard; only the row-outstanding / ledger parts of the cap can still
      // zero it out (last installment already settled early — จุดหัก 2).
      if (parkCap.gt(0)) {
        const parkConsume = Decimal.min(parkBalance, parkCap);

        await this.journal.createAndPost(
          {
            description: `หักเงินพักปรับดิวเข้างวดสุดท้าย #${inst.installmentNo} — สัญญา ${c.contractNumber}`,
            // Same constant reconstructPriorCleared's always-include allow-list is
            // built from — see reconstruct-prior.ts (C-1).
            reference: `${inst.id}:${RESCHEDULE_PARK_CONSUME_FLOW}`,
            metadata: {
              tag: '2B',
              flow: RESCHEDULE_PARK_CONSUME_FLOW,
              contractId: c.id,
              installmentScheduleId: inst.id,
              installmentNo: inst.installmentNo,
              consumeAmount: parkConsume.toFixed(2),
            },
            postedAt: inst.dueDate,
            lines: [
              {
                accountCode: '21-1103',
                dr: parkConsume,
                cr: zero,
                description: 'หักเงินพักปรับดิวเข้างวดสุดท้าย',
              },
              {
                accountCode: '11-2103',
                dr: zero,
                cr: parkConsume,
                description: 'ล้างลูกหนี้ค้างชำระ (จากเงินพักปรับดิว)',
              },
            ],
          },
          tx,
        );

        // Decrement contract's parked reschedule-fee balance by the consumed amount.
        await tx.contract.update({
          where: { id: c.id },
          data: { rescheduleAdvanceBalance: { decrement: parkConsume } },
        });

        // Reflect the consume on the Payment row — same stamping shape as the
        // generic consume above. Uses the row read UP FRONT for the cap (the
        // generic block's own update already landed before that read, and posting
        // the park JE does not touch Payment rows).
        if (paymentForPark) {
          const newAmountPaid = new Decimal(paymentForPark.amountPaid.toString()).plus(parkConsume);
          const due = new Decimal((paymentForPark.amountDue ?? installmentTotal).toString());
          const isPaidInFull = newAmountPaid.gte(due);
          await tx.payment.update({
            where: { id: paymentForPark.id },
            data: {
              amountPaid: newAmountPaid,
              status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID',
              paidDate: isPaidInFull ? new Date() : null,
              paidAt: isPaidInFull ? new Date() : null,
            },
          });
        } else {
          // Mirrors the generic-advance no-Payment-row alarm above — alert ops
          // instead of silently dropping the stamp (would let a later receipt
          // re-clear an installment the park consume already cleared).
          Sentry.captureMessage(
            'Reschedule park balance consumed on accrual with no Payment row to update',
            {
              level: 'error',
              tags: {
                module: 'journal',
                action: 'reschedule-park-consume-no-payment-row',
              },
              extra: {
                contractId: c.id,
                contractNumber: c.contractNumber,
                installmentScheduleId: inst.id,
                installmentNo: inst.installmentNo,
                consume: parkConsume.toFixed(2),
              },
            },
          );
        }
      }
    }

    return { entryNo: core.entryNo };
  }
}
