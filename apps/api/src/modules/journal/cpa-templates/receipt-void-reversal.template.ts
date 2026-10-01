import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AccruedSoFar,
  NOTHING_ACCRUED,
  accrual2AInputOf,
  accruedSoFarOf,
  buildPartialAccrual2ALines,
  isDueDateReached,
  mirrorAccrual2APart,
  sortAccrual2AReversalLines,
} from '../build-accrual-2a-lines';
import { DeferredWarning } from '../deferred-warning';
import {
  ACCRUAL_TRIGGER_RECEIPT,
  findReceiptAccrualEntries,
} from './installment-accrual-2a.template';

/** `metadata.flow` ของรายการกลับรายการตั้งลูกหนี้งวดที่ลงตอนยกเลิกใบเสร็จ. */
export const RECEIPT_ACCRUAL_VOID_FLOW = 'receipt-accrual-void';

/**
 * ผลของ voidAccrualPostedAtReceipt — เก็บลง AuditLog `RECEIPT_VOID` ตามที่คืน. งวดหนึ่งมีรายการ 2A ที่ลง
 * ณ วันรับเงินได้หลายใบ (ใบบางส่วน + ใบที่ทำให้ครบ — ก1) จึงคืนเลขที่เป็นรายการ เรียงตามลำดับที่ลง.
 */
export type AccrualVoidResult =
  | { reversed: true; entryNos: string[]; accrualEntryNumbers: string[] }
  | {
      reversed: false;
      reason:
        | 'NOT_ACCRUED'
        | 'DUE_DATE_REACHED'
        | 'ACCRUAL_NOT_FOUND'
        | 'NOT_POSTED_AT_RECEIPT'
        | 'ALREADY_REVERSED';
    };

/** ผล + สัญญาณเตือนที่ผู้เรียกต้องส่งหลังธุรกรรมของการยกเลิกใบเสร็จ commit (emitDeferredWarnings). */
export interface AccrualVoidOutcome {
  result: AccrualVoidResult;
  warnings: DeferredWarning[];
}

type AccrualEntry = Prisma.JournalEntryGetPayload<{ include: { lines: true } }>;

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
   * กลับ **ทุกรายการ 2A ที่ลง ณ วันรับเงินของงวด** (ใบบางส่วน `<id>:receipt-accrual:<k>` ที่ยังมีผล + ใบที่ทำให้
   * งวดตั้งครบซึ่งลิงก์ชี้อยู่) เมื่อครบทุกข้อ: งวดมีรายการ 2A (ลิงก์ หรือยอดสะสม > 0) · ยังไม่ถึงวันครบกำหนด
   * ณ วันที่ยกเลิก (ปฏิทินไทย — วันครบกำหนดเอง = ถึงแล้ว) · ทุกรายการเป็น 2A ของงวดนี้ สถานะ POSTED
   * ที่ลง ณ วันรับเงิน มีบรรทัด และยังไม่ถูกกลับ. ใบที่ทำให้ครบเป็นรายการของรอบกลางคืน (วันครบกำหนดถูกเลื่อน
   * ไปภายหลัง) → ไม่กลับอะไรเลย รวมใบบางส่วน — "ลิงก์ = ตั้งครบ" ต้องจริงเสมอ.
   *
   * รายการกลับ = กระจกของบรรทัดที่ลงไว้จริง (mirrorPostedLines) เรียงตามรูปที่เสนอฝ่ายบัญชี หนึ่งใบต่อหนึ่ง
   * รายการเดิม. ยอดมาจากสมุดบัญชี การยกเลิกใบเสร็จจึงไม่ถูกปฏิเสธเพราะยอดที่ลงไว้ต่างจากสูตร (R13) — สูตร
   * ใช้ตรวจทานหลังลงเท่านั้น (crossCheckAgainstBuilder: เทียบแต่ละใบกับสูตรของยอดของใบนั้น).
   * ลงวันที่ยกเลิก (ไม่ส่ง postedAt); ด่านงวดบัญชีอยู่ที่ ReceiptVoidService ก่อนเปิดธุรกรรม. metadata ผูกกับ
   * สัญญาด้วย contractId อย่างเดียว — ห้ามใส่ installmentScheduleId / paymentId / trigger.
   * หลังกลับ: ล้างลิงก์ และคืนยอดสะสม (accruedAmount/Vat/Interest) เป็น 0 — งวดถูกตั้งใหม่ตามปกติ.
   *
   * รายการเดิมคงสถานะ POSTED และคง reference เดิม. ไม่จับ error ของฐานข้อมูล. สัญญาณเตือนทั้งหมดคืนใน
   * `warnings` ให้ผู้เรียกส่งหลังธุรกรรม commit (ไม่ส่งจากในธุรกรรม).
   * `asOf` ใช้ตัดสินเพียงว่า "ถึงวันครบกำหนดแล้วหรือยัง".
   */
  async voidAccrualPostedAtReceipt(
    installmentScheduleId: string,
    tx: Prisma.TransactionClient,
    asOf: Date = new Date(),
  ): Promise<AccrualVoidOutcome> {
    const inst = await tx.installmentSchedule.findUniqueOrThrow({
      where: { id: installmentScheduleId },
      include: { contract: true },
    });
    const accruedBefore = accruedSoFarOf(inst);
    if (!inst.accrualJournalEntryId && !accruedBefore.amount.gt(0)) {
      return { result: { reversed: false, reason: 'NOT_ACCRUED' }, warnings: [] };
    }
    if (isDueDateReached(inst.dueDate, asOf)) {
      return { result: { reversed: false, reason: 'DUE_DATE_REACHED' }, warnings: [] };
    }

    const c = inst.contract;
    const skip = (
      reason: 'ACCRUAL_NOT_FOUND' | 'ALREADY_REVERSED',
      entryNumber: string | null,
    ): AccrualVoidOutcome => {
      this.logger.warn(
        `[receipt-accrual-void] skipped (${reason}) — installment #${inst.installmentNo} of contract ` +
          `${c.contractNumber} (link ${inst.accrualJournalEntryId ?? '-'}, entry ${entryNumber ?? '-'})`,
      );
      return {
        result: { reversed: false, reason },
        warnings: [
          {
            message:
              '[receipt-accrual-void] accrual link does not resolve to a reversible 2A entry — not reversed',
            tags: { module: 'journal', action: 'receipt-accrual-void-skipped' },
            extra: {
              reason,
              contractId: c.id,
              contractNumber: c.contractNumber,
              installmentScheduleId: inst.id,
              installmentNo: inst.installmentNo,
              accrualJournalEntryId: inst.accrualJournalEntryId,
              accruedAmount: accruedBefore.amount.toFixed(2),
              entryNumber,
            },
          },
        ],
      };
    };
    const metaOf = (e: { metadata: Prisma.JsonValue }) =>
      (e.metadata ?? {}) as Record<string, unknown>;
    const isOwn2A = (e: AccrualEntry) =>
      e.status === 'POSTED' &&
      metaOf(e)['tag'] === '2A' &&
      metaOf(e)['installmentScheduleId'] === inst.id &&
      e.lines.length > 0;

    // (1) ใบที่ทำให้งวดตั้งครบ — ลิงก์ชี้อยู่
    let completing: AccrualEntry | null = null;
    if (inst.accrualJournalEntryId) {
      completing = await tx.journalEntry.findFirst({
        where: { entryNumber: inst.accrualJournalEntryId, deletedAt: null },
        include: { lines: true },
      });
      if (!completing || !isOwn2A(completing)) {
        return skip('ACCRUAL_NOT_FOUND', inst.accrualJournalEntryId);
      }
      if (metaOf(completing)['trigger'] !== ACCRUAL_TRIGGER_RECEIPT) {
        return { result: { reversed: false, reason: 'NOT_POSTED_AT_RECEIPT' }, warnings: [] };
      }
      if (metaOf(completing)['reversed'] === true) {
        return skip('ALREADY_REVERSED', completing.entryNumber);
      }
    }

    // (2) ใบบางส่วนที่ยังมีผล (ใบที่ถูกกลับไปแล้วเป็นประวัติ — ข้าม)
    const partials = (await findReceiptAccrualEntries(tx, inst.id)).filter(
      (e) => metaOf(e)['reversed'] !== true,
    );
    for (const p of partials) {
      if (!isOwn2A(p) || metaOf(p)['trigger'] !== ACCRUAL_TRIGGER_RECEIPT) {
        return skip('ACCRUAL_NOT_FOUND', p.entryNumber);
      }
    }
    const entries = [...partials, ...(completing ? [completing] : [])];
    if (entries.length === 0) return skip('ACCRUAL_NOT_FOUND', null);

    // (3) กระจกของแต่ละรายการ ตามลำดับที่ลง
    const reversals: { accrual: AccrualEntry; entryNo: string; lines: MirroredLine[] }[] = [];
    for (const accrual of entries) {
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
            ...(metaOf(accrual) as Prisma.InputJsonObject),
            reversed: true,
            reversedByEntryNumber: result.entryNumber,
          },
        },
      });
      reversals.push({ accrual, entryNo: result.entryNumber, lines });
    }

    // (4) งวดกลับไปเป็น "ยังไม่ได้ตั้งลูกหนี้งวด"
    await tx.installmentSchedule.update({
      where: { id: inst.id },
      data: { accrualJournalEntryId: null, accruedAmount: 0, accruedVat: 0, accruedInterest: 0 },
    });

    this.logger.log(
      `[receipt-accrual-void] reversed ${reversals.length} 2A entr${reversals.length === 1 ? 'y' : 'ies'} ` +
        `(${reversals.map((r) => `${r.accrual.entryNumber} → ${r.entryNo}`).join(', ')}) ` +
        `(installment #${inst.installmentNo}, contract ${c.contractNumber})`,
    );
    const warnings = this.crossCheckAgainstBuilder({
      contract: c,
      installmentScheduleId: inst.id,
      installmentNo: inst.installmentNo,
      reversals: reversals.map((r) => ({
        accrualEntryNumber: r.accrual.entryNumber,
        reversalEntryNumber: r.entryNo,
        lines: r.lines,
      })),
    });
    return {
      result: {
        reversed: true,
        entryNos: reversals.map((r) => r.entryNo),
        accrualEntryNumbers: reversals.map((r) => r.accrual.entryNumber),
      },
      warnings,
    };
  }

  /**
   * ตรวจทาน — ไม่ใช่ด่าน (คำตัดสินผู้คุมงาน R13): เล่นซ้ำรายการ 2A ของงวดตามลำดับที่ลง — แต่ละใบควรเท่ากับ
   * กระจกของ buildPartialAccrual2ALines(ยอด Dr 11-2103 ของใบนั้น, ยอดที่ลงไว้ก่อนหน้าใบนั้น) (ใบเดียวทั้งงวด =
   * สูตรเต็มงวดเดิม). ต่างกัน = สัญญาณเตือนให้ฝ่ายบัญชีตรวจรายการ 2A ใบนั้น — รายการกลับถูกลงตามบรรทัดที่
   * ลงไว้จริงไปแล้ว. ยอดสะสมของการเล่นซ้ำเดินตามยอดที่ลงไว้จริง (ใบที่ต่างไม่ลามไปใบถัดไป).
   * ใช้เฉพาะข้อมูลที่ธุรกรรมอ่านไว้แล้ว ไม่ throw — คืนสัญญาณเตือนให้ผู้เรียกส่งหลัง commit.
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
    reversals: { accrualEntryNumber: string; reversalEntryNumber: string; lines: MirroredLine[] }[];
  }): DeferredWarning[] {
    const c = args.contract;
    const key = (l: { accountCode: string; dr: Decimal; cr: Decimal }) =>
      `${l.accountCode}:${l.dr.toFixed(2)}:${l.cr.toFixed(2)}`;
    const creditOf = (lines: MirroredLine[], code: string) =>
      lines
        .filter((l) => l.accountCode === code)
        .reduce((sum, l) => sum.plus(l.cr), new Decimal(0));
    const warnings: DeferredWarning[] = [];
    let accrued: AccruedSoFar = NOTHING_ACCRUED;
    for (const r of args.reversals) {
      const extra = {
        contractId: c.id,
        contractNumber: c.contractNumber,
        installmentScheduleId: args.installmentScheduleId,
        installmentNo: args.installmentNo,
        accrualEntryNumber: r.accrualEntryNumber,
        reversalEntryNumber: r.reversalEntryNumber,
      };
      // ยอดที่ใบเดิมลงไว้ = ฝั่งเครดิตของกระจก (11-2103 = ยอด · 21-2102 = ภาษีขาย · 11-2106 = ดอกเบี้ย)
      const posted: AccruedSoFar = {
        amount: creditOf(r.lines, '11-2103'),
        vat: creditOf(r.lines, '21-2102'),
        interest: creditOf(r.lines, '11-2106'),
      };
      try {
        const expected = mirrorAccrual2APart(
          buildPartialAccrual2ALines(
            accrual2AInputOf(c, args.installmentNo),
            accrued,
            posted.amount,
          ),
        )
          .map(key)
          .sort();
        const mirrored = r.lines.map(key).sort();
        if (mirrored.length !== expected.length || mirrored.some((v, i) => v !== expected[i])) {
          this.logger.warn(
            `[receipt-accrual-void] posted lines of ${r.accrualEntryNumber} differ from the builder — ` +
              `reversal ${r.reversalEntryNumber} mirrors the posted lines`,
          );
          warnings.push({
            message:
              '[receipt-accrual-void] posted 2A lines differ from the builder — reversal mirrors the posted lines',
            tags: { module: 'journal', action: 'receipt-accrual-void-crosscheck' },
            extra: { ...extra, mirrored, expected },
          });
        }
      } catch (err) {
        this.logger.warn(
          `[receipt-accrual-void] cross-check of ${r.accrualEntryNumber} could not run — ` +
            `reversal ${r.reversalEntryNumber} mirrors the posted lines`,
        );
        warnings.push({
          message: '[receipt-accrual-void] cross-check could not run',
          tags: { module: 'journal', action: 'receipt-accrual-void-crosscheck-failed' },
          extra,
          error: err,
        });
      }
      accrued = {
        amount: accrued.amount.plus(posted.amount),
        vat: accrued.vat.plus(posted.vat),
        interest: accrued.interest.plus(posted.interest),
      };
    }
    return warnings;
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
