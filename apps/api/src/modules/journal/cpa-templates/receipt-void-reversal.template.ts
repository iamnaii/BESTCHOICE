import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildAccrual2AReversalLines,
  isDueDateReached,
  sortAccrual2AReversalLines,
} from '../build-accrual-2a-lines';
import { ACCRUAL_TRIGGER_RECEIPT } from './installment-accrual-2a.template';

/** `metadata.flow` ของรายการกลับรายการตั้งลูกหนี้งวดที่ลงตอนยกเลิกใบเสร็จ. */
export const RECEIPT_ACCRUAL_VOID_FLOW = 'receipt-accrual-void';

/** ผลของ voidAccrualPostedAtReceipt — เก็บลง AuditLog `RECEIPT_VOID` ตามที่คืน. */
export type AccrualVoidResult =
  | { reversed: true; entryNo: string; accrualEntryNumber: string }
  | {
      reversed: false;
      reason:
        | 'NOT_ACCRUED'
        | 'DUE_DATE_REACHED'
        | 'ACCRUAL_NOT_FOUND'
        | 'NOT_POSTED_AT_RECEIPT'
        | 'ALREADY_REVERSED';
    };

/** บรรทัดของรายการบัญชีตามที่เก็บในสมุดบัญชี. */
type PostedLine = {
  accountCode: string;
  debit: { toString(): string };
  credit: { toString(): string };
  description: string | null;
};

/** บรรทัดที่ส่งให้ JournalAutoService.createAndPost. */
type MirroredLine = { accountCode: string; dr: Decimal; cr: Decimal; description: string };

/**
 * กระจกของบรรทัดที่ลงไว้ — สลับ debit/credit ทีละบรรทัด ตามลำดับเดิม. ยอดมาจากสมุดบัญชี ไม่คำนวณใหม่.
 * ใช้ร่วมกันโดยรายการกลับใบรับชำระ (voidReceipt) และรายการกลับรายการตั้งลูกหนี้งวด
 * (voidAccrualPostedAtReceipt).
 */
function mirrorPostedLines(lines: PostedLine[], prefix: string): MirroredLine[] {
  return lines.map((l) => ({
    accountCode: l.accountCode,
    dr: new Decimal(l.credit.toString()),
    cr: new Decimal(l.debit.toString()),
    description: `${prefix} ${l.description ?? ''}`.trim(),
  }));
}

/**
 * Template — Receipt Void Reversal.
 *
 * Voids a single 2B payment journal entry by posting its mirror (Dr/Cr swapped).
 * The caller (receipts.service) is responsible for marking the Payment/Receipt row
 * as VOIDED. This template only handles the JE side.
 *
 * Idempotent: skips if a reversal JE for the same originalEntryId already exists.
 */
@Injectable()
export class ReceiptVoidReversalTemplate {
  private readonly logger = new Logger(ReceiptVoidReversalTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * กลับรายการตั้งลูกหนี้งวด (2A) ที่ลง ณ วันรับเงิน — เรียกจาก ReceiptVoidService ในธุรกรรมของการยกเลิก
   * ใบเสร็จ หลังงวดไม่เหลือการรับชำระที่มีผล (คำตอบฝ่ายบัญชี 29/09/2569 ข้อ 4 ทางเลือก 1).
   *
   * กลับเมื่อครบทุกข้อ: งวดมีลิงก์ไปรายการตั้งลูกหนี้งวด · ยังไม่ถึงวันครบกำหนด ณ วันที่ยกเลิก (ปฏิทินไทย —
   * วันครบกำหนดเอง = ถึงแล้ว นิยามเดียวกับที่รอบกลางคืนใช้เลือกงวด) · รายการนั้นเป็น 2A ของงวดนี้
   * (`installmentScheduleId`) สถานะ POSTED ที่ลง ณ วันรับเงิน (`trigger`) มีบรรทัด และยังไม่ถูกกลับ.
   * รายการที่รอบกลางคืนลงไม่ถูกกลับที่นี่.
   *
   * รายการกลับ = กระจกของบรรทัดที่ลงไว้จริง (mirrorPostedLines — แบบเดียวกับ voidReceipt ข้างล่าง)
   * เรียงตามรูปที่เสนอฝ่ายบัญชี. ยอดมาจากสมุดบัญชี จึงหักล้างรายการเดิมได้พอดีเสมอ และการยกเลิกใบเสร็จ
   * ไม่ถูกปฏิเสธเพราะยอดที่ลงไว้ต่างจากยอดที่คำนวณจากสัญญา (คำตัดสินผู้คุมงาน R13). ตัวสร้างบรรทัดของ 2A
   * ใช้ตรวจทานหลังลงเท่านั้น (crossCheckAgainstBuilder).
   * ลงวันที่ยกเลิก (ไม่ส่ง postedAt) เหมือน voidReceipt; ด่านงวดบัญชีของวันนั้นอยู่ที่ ReceiptVoidService
   * ก่อนเปิดธุรกรรม. metadata ผูกกับสัญญาด้วย contractId อย่างเดียว — ห้ามใส่ installmentScheduleId /
   * paymentId / trigger: ผู้อ่านใบรับชำระและผู้อ่านรายการ 2A จะนับรายการนี้ผิด.
   *
   * รายการเดิมคงสถานะ POSTED และคง reference เดิม — การตั้งลูกหนี้งวดใหม่ของงวดนี้ใช้ reference ใหม่
   * (InstallmentAccrual2ATemplate.resolveAccrualReference).
   * ไม่จับ error ของฐานข้อมูล: ล้มแล้วการยกเลิกใบเสร็จล้มทั้งรายการ.
   * `asOf` ใช้ตัดสินเพียงว่า "ถึงวันครบกำหนดแล้วหรือยัง" — รายการกลับไม่ส่ง postedAt จึงลงวันที่ปัจจุบันเสมอ เหมือนรายการกลับใบรับชำระ.
   */
  async voidAccrualPostedAtReceipt(
    installmentScheduleId: string,
    tx: Prisma.TransactionClient,
    asOf: Date = new Date(),
  ): Promise<AccrualVoidResult> {
    const inst = await tx.installmentSchedule.findUniqueOrThrow({
      where: { id: installmentScheduleId },
      include: { contract: true },
    });
    if (!inst.accrualJournalEntryId) return { reversed: false, reason: 'NOT_ACCRUED' };
    if (isDueDateReached(inst.dueDate, asOf)) {
      return { reversed: false, reason: 'DUE_DATE_REACHED' };
    }

    const accrual = await tx.journalEntry.findFirst({
      where: { entryNumber: inst.accrualJournalEntryId, deletedAt: null },
      include: { lines: true },
    });
    const meta = (accrual?.metadata ?? {}) as Record<string, unknown>;
    const c = inst.contract;
    const skip = (reason: 'ACCRUAL_NOT_FOUND' | 'ALREADY_REVERSED'): AccrualVoidResult => {
      this.logger.warn(
        `[receipt-accrual-void] skipped (${reason}) — installment #${inst.installmentNo} of contract ` +
          `${c.contractNumber} links to ${inst.accrualJournalEntryId}`,
      );
      Sentry.captureMessage(
        '[receipt-accrual-void] accrual link does not resolve to a reversible 2A entry — not reversed',
        {
          level: 'warning',
          tags: { module: 'journal', action: 'receipt-accrual-void-skipped' },
          extra: {
            reason,
            contractId: c.id,
            contractNumber: c.contractNumber,
            installmentScheduleId: inst.id,
            installmentNo: inst.installmentNo,
            accrualJournalEntryId: inst.accrualJournalEntryId,
          },
        },
      );
      return { reversed: false, reason };
    };
    if (
      !accrual ||
      accrual.status !== 'POSTED' ||
      meta['tag'] !== '2A' ||
      meta['installmentScheduleId'] !== inst.id ||
      accrual.lines.length === 0
    ) {
      return skip('ACCRUAL_NOT_FOUND');
    }
    if (meta['trigger'] !== ACCRUAL_TRIGGER_RECEIPT) {
      return { reversed: false, reason: 'NOT_POSTED_AT_RECEIPT' };
    }
    if (meta['reversed'] === true) return skip('ALREADY_REVERSED');

    const lines = sortAccrual2AReversalLines(mirrorPostedLines(accrual.lines, '[กลับรายการ]'));

    const result = await this.journal.createAndPost(
      {
        description: `[ยกเลิกใบเสร็จ] กลับรายการตั้งลูกหนี้งวด #${inst.installmentNo} — สัญญา ${c.contractNumber} (${accrual.entryNumber})`,
        reference: `${accrual.id}:accrual-void`,
        metadata: {
          tag: 'REVERSAL',
          flow: RECEIPT_ACCRUAL_VOID_FLOW,
          idempotencyKey: `${RECEIPT_ACCRUAL_VOID_FLOW}:${accrual.id}`,
          originalEntryId: accrual.id,
          originalEntryNumber: accrual.entryNumber,
          contractId: c.id,
        },
        lines,
      },
      tx,
    );

    await tx.journalEntry.update({
      where: { id: accrual.id },
      data: {
        metadata: {
          ...(meta as Prisma.InputJsonObject),
          reversed: true,
          reversedByEntryNumber: result.entryNumber,
        },
      },
    });
    // ล้างลิงก์ + ยอดสะสมของงวด (accrued*) พร้อมกัน — รายการ 2A เขียนยอดสะสมทุกครั้ง (PR2ข) และรอบกลางคืน
    // ตั้ง "ยอดของงวด − ยอดสะสม": ถ้าล้างแค่ลิงก์ ส่วนที่เหลือจะเป็น 0 และงวดจะไม่ถูกตั้งลูกหนี้อีกเลย
    await tx.installmentSchedule.update({
      where: { id: inst.id },
      data: { accrualJournalEntryId: null, accruedAmount: 0, accruedVat: 0, accruedInterest: 0 },
    });

    this.logger.log(
      `[receipt-accrual-void] reversed 2A ${accrual.entryNumber} → ${result.entryNumber} ` +
        `(installment #${inst.installmentNo}, contract ${c.contractNumber})`,
    );
    this.crossCheckAgainstBuilder({
      contract: c,
      installmentScheduleId: inst.id,
      installmentNo: inst.installmentNo,
      accrualEntryNumber: accrual.entryNumber,
      reversalEntryNumber: result.entryNumber,
      lines,
    });
    return { reversed: true, entryNo: result.entryNumber, accrualEntryNumber: accrual.entryNumber };
  }

  /**
   * ตรวจทาน — ไม่ใช่ด่าน (คำตัดสินผู้คุมงาน R13): บรรทัดที่กลับไปแล้วควรเท่ากับที่ตัวสร้างบรรทัดของ 2A
   * ให้สำหรับงวดนี้. ต่างกัน = ส่งสัญญาณเตือนให้ฝ่ายบัญชีตรวจรายการตั้งลูกหนี้งวดใบนั้น — รายการกลับถูกลง
   * ตามบรรทัดที่ลงไว้จริงไปแล้ว และการยกเลิกใบเสร็จดำเนินต่อตามปกติ.
   * ใช้เฉพาะข้อมูลที่ธุรกรรมอ่านไว้แล้ว (ไม่อ่านฐานข้อมูล ไม่มีงานที่ต้องรอ) และไม่ throw ไม่ว่ากรณีใด.
   */
  private crossCheckAgainstBuilder(args: {
    contract: {
      id: string;
      contractNumber: string;
      financedAmount: { toString(): string };
      storeCommission: { toString(): string } | null;
      interestTotal: { toString(): string };
      vatAmount: { toString(): string } | null;
      totalMonths: number;
    };
    installmentScheduleId: string;
    installmentNo: number;
    accrualEntryNumber: string;
    reversalEntryNumber: string;
    lines: MirroredLine[];
  }): void {
    const c = args.contract;
    const key = (l: { accountCode: string; dr: Decimal; cr: Decimal }) =>
      `${l.accountCode}:${l.dr.toFixed(2)}:${l.cr.toFixed(2)}`;
    const extra = {
      contractId: c.id,
      contractNumber: c.contractNumber,
      installmentScheduleId: args.installmentScheduleId,
      installmentNo: args.installmentNo,
      accrualEntryNumber: args.accrualEntryNumber,
      reversalEntryNumber: args.reversalEntryNumber,
    };
    try {
      const expected = buildAccrual2AReversalLines({
        financedAmount: c.financedAmount.toString(),
        storeCommission: c.storeCommission != null ? c.storeCommission.toString() : null,
        interestTotal: c.interestTotal.toString(),
        vatAmount: c.vatAmount != null ? c.vatAmount.toString() : null,
        totalMonths: c.totalMonths,
        installmentNo: args.installmentNo,
      })
        .lines.map(key)
        .sort();
      const mirrored = args.lines.map(key).sort();
      if (mirrored.length === expected.length && mirrored.every((v, i) => v === expected[i])) {
        return;
      }
      this.logger.warn(
        `[receipt-accrual-void] posted lines of ${args.accrualEntryNumber} differ from the builder — ` +
          `reversal ${args.reversalEntryNumber} mirrors the posted lines`,
      );
      Sentry.captureMessage(
        '[receipt-accrual-void] posted 2A lines differ from the builder — reversal mirrors the posted lines',
        {
          level: 'warning',
          tags: { module: 'journal', action: 'receipt-accrual-void-crosscheck' },
          extra: { ...extra, mirrored, expected },
        },
      );
    } catch (err) {
      this.logger.warn(
        `[receipt-accrual-void] cross-check of ${args.accrualEntryNumber} could not run — ` +
          `reversal ${args.reversalEntryNumber} mirrors the posted lines`,
      );
      Sentry.captureException(err, {
        level: 'warning',
        tags: { module: 'journal', action: 'receipt-accrual-void-crosscheck-failed' },
        extra,
      });
    }
  }

  /**
   * Post a reversing JE for the given original journal entry.
   * @param originalJournalEntryId - ID of the POSTED 2B JE to reverse
   * @returns entryNo of the new reversal JE
   */
  async voidReceipt(
    originalJournalEntryId: string,
    tx?: Prisma.TransactionClient,
    opts?: { flow?: string },
  ): Promise<{ entryNo: string }> {
    const client = tx ?? this.prisma;
    const flow = opts?.flow ?? 'receipt-void';
    // Idempotency check
    const existingReversal = await client.journalEntry.findFirst({
      where: {
        AND: [
          {
            metadata: { path: ['originalEntryId'], equals: originalJournalEntryId },
          } as Prisma.JournalEntryWhereInput,
          { metadata: { path: ['flow'], equals: flow } } as Prisma.JournalEntryWhereInput,
        ],
        deletedAt: null,
      },
    });

    if (existingReversal) {
      this.logger.log(
        `[A.5a] ReceiptVoidReversal idempotency — reversal ${existingReversal.entryNumber} already exists for JE ${originalJournalEntryId}, skipping`,
      );
      return { entryNo: existingReversal.entryNumber };
    }

    // Load original JE + lines
    const originalJe = await client.journalEntry.findUnique({
      where: { id: originalJournalEntryId },
      include: { lines: true },
    });

    if (!originalJe) {
      throw new BadRequestException(`Journal entry not found: ${originalJournalEntryId}`);
    }

    if (originalJe.status !== 'POSTED') {
      throw new BadRequestException(
        `Cannot void a JE that is not POSTED (status=${originalJe.status})`,
      );
    }

    const existingMeta = (originalJe.metadata ?? {}) as Record<string, unknown>;
    if (existingMeta['reversed'] === true) {
      throw new BadRequestException(
        `JE ${originalJe.entryNumber} is already reversed — cannot void twice`,
      );
    }

    if (originalJe.lines.length === 0) {
      throw new BadRequestException(`JE ${originalJe.entryNumber} has no lines to reverse`);
    }

    // Build reversed lines
    const reversedLines = mirrorPostedLines(originalJe.lines, '[VOID]');

    const result = await this.journal.createAndPost(
      {
        description: `[ยกเลิกใบเสร็จ] ยกเลิก JE ${originalJe.entryNumber}`,
        reference: `${originalJournalEntryId}:void`,
        metadata: {
          tag: 'REVERSAL',
          flow,
          originalEntryId: originalJournalEntryId,
          originalEntryNumber: originalJe.entryNumber,
          // ผูกกับสัญญา (ฝ่ายบัญชี 2026-09-28) — glContractBalance รวมยอดตาม metadata.contractId
          // ถ้าไม่มี ยอดของใบที่ยกเลิกแล้วจะยังถูกนับว่าจ่ายอยู่. copy เฉพาะคีย์นี้เท่านั้น:
          // paymentId/installmentScheduleId/tag/idempotencyKey จะทำให้ผู้อ่านรายอื่นเข้าใจว่าเป็นใบรับชำระ
          ...(typeof existingMeta['contractId'] === 'string'
            ? { contractId: existingMeta['contractId'] }
            : {}),
        },
        lines: reversedLines,
      },
      tx,
    );

    // Mark original as reversed
    await client.journalEntry.update({
      where: { id: originalJournalEntryId },
      data: {
        metadata: {
          ...(existingMeta as Prisma.InputJsonObject),
          reversed: true,
          reversedByEntryNumber: result.entryNumber,
        },
      },
    });

    this.logger.log(
      `[A.5a] ReceiptVoidReversal — reversed JE ${originalJe.entryNumber} → ${result.entryNumber}`,
    );

    return { entryNo: result.entryNumber };
  }
}
