import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { INPUT_VAT_INSTALLMENT_FLOW } from './contract-cancellation.template';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

const PAYMENT_FLOWS = ['payment', 'split-payment', 'early-payoff', 'reschedule'];

/** flow ของรายการย้ายเครดิตตอนเปลี่ยนเครื่องตำหนิ (15ข) — ผู้กวาดรายการตามสัญญาต้องข้าม */
export const DEFECT_EXCHANGE_CREDIT_OUT_FLOW = 'defect-exchange-credit-out';
export const DEFECT_EXCHANGE_CREDIT_IN_FLOW = 'defect-exchange-credit-in';
const CREDIT_TRANSFER_FLOWS: readonly string[] = [DEFECT_EXCHANGE_CREDIT_OUT_FLOW, DEFECT_EXCHANGE_CREDIT_IN_FLOW];

/** บัญชีเงินสด/ธนาคารของ FINANCE — รายการที่แตะบัญชีกลุ่มนี้ห้ามถูก mirror (เงินจริงไม่ได้ออก) */
export const CASH_ACCOUNT_PREFIXES = ['11-11', '11-12'] as const;
/** บัญชีเงินของลูกค้า + ภาษีที่พักคู่กัน — รายการเงินสดที่คู่อยู่ในกลุ่มนี้ล้วน = เงินลูกค้าที่ขั้น ข ของเปลี่ยนเครื่องจะย้ายออกเอง */
export const CUSTOMER_MONEY_ACCOUNTS = ['21-1103', '21-5101', '21-2101', '21-2102'] as const;

const isCashAccount = (code: string) => CASH_ACCOUNT_PREFIXES.some((p) => code.startsWith(p));

/**
 * Template — Defect Exchange Reversal.
 *
 * When a defective device is exchanged within the 7-day window, all previously
 * posted JEs for the old contract must be reversed so the accounting footprint
 * is zeroed out before the new contract's 1A is posted.
 *
 * Strategy: find all POSTED JEs tagged with contractId (via metadata), skip any
 * already-reversed JEs, skip payment-side JEs (2B/early-payoff — business rules
 * state no payments exist within the 7-day window, but we guard defensively),
 * and skip every entry with `tag === 'REVERSAL'` (any flow — receipt-void,
 * refund-reversal, defect-exchange, exchange-cancel, …). For each remaining
 * eligible JE, post a mirror JE with Dr/Cr swapped.
 */
@Injectable()
export class DefectExchangeReversalTemplate {
  private readonly logger = new Logger(DefectExchangeReversalTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Reverse all contract-activation JEs for the given contract.
   * Idempotent: skips JEs already marked reversed.
   */
  async reverseContract(
    contractId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ reversedCount: number; entryNos: string[] }> {
    const client = tx ?? this.prisma;
    const contract = await client.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: { contractNumber: true },
    });

    // Find all posted JEs tagged to this contract (metadata.contractId)
    const originalJes = await client.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['contractId'], equals: contractId } } as Prisma.JournalEntryWhereInput,
        ],
        status: 'POSTED',
        deletedAt: null,
      },
      include: { lines: true },
      orderBy: { createdAt: 'asc' },
    });

    if (originalJes.length === 0) {
      this.logger.warn(
        `[A.5a] DefectExchangeReversal — no posted JEs found for contract ${contract.contractNumber} (${contractId}). Nothing to reverse.`,
      );
      return { reversedCount: 0, entryNos: [] };
    }

    const entryNos: string[] = [];

    // 15ข — จำแนกก่อน post ใบใดเลย: รายการที่ต้องปฏิเสธ (ขาเงินสดที่คู่ไม่ใช่เงินลูกค้า) ทำให้ทั้งรายการล้มตั้งแต่ต้น
    // ไม่ทิ้งกระจกบางใบไว้ก่อน throw (tx rollback ครอบอยู่แล้ว แต่ fail-fast ชัดกว่า — แบบ tripwire ของ C-1)
    const candidates: typeof originalJes = [];
    for (const je of originalJes) {
      const meta = (je.metadata ?? {}) as Record<string, unknown>;

      // Skip already reversed
      if (meta['reversed'] === true) {
        this.logger.log(
          `[A.5a] DefectExchangeReversal — JE ${je.entryNumber} already reversed, skipping`,
        );
        continue;
      }

      // Skip payment-side JEs (still a defensive guard — business rules say no
      // payments exist within the 7-day window). Reversal JEs are handled by the
      // dedicated tag check below, which is load-bearing, not defensive — see
      // that check's own comment.
      const flow = (meta['flow'] as string | undefined) ?? '';
      // ข้อ 6 (ฝ่ายบัญชี 13/10/2569): ภาษีซื้อของเครื่องเดิมไม่กลับรายการตอนเปลี่ยนเครื่องตำหนิ —
      // การเคลมติดกับใบกำกับ เครื่องเดิมที่กลับมาขายผ่อนอีกจะไม่เคลมซ้ำ (ALREADY_CLAIMED)
      if (flow === INPUT_VAT_INSTALLMENT_FLOW) {
        this.logger.log(`[A.5a] DefectExchangeReversal — JE ${je.entryNumber} is the input-VAT claim (kept, not reversed)`);
        continue;
      }
      if (PAYMENT_FLOWS.includes(flow)) {
        this.logger.warn(
          `[A.5a] DefectExchangeReversal — JE ${je.entryNumber} has payment flow '${flow}', skipping (unexpected in 7-day window)`,
        );
        continue;
      }
      // 15ข: การย้ายเครดิตของเปลี่ยนเครื่อง (ขั้น ข/ง) ไม่ใช่รายการของสัญญาที่ต้องถอน — mirror = เครดิตหาย/ซ้ำ
      if (CREDIT_TRANSFER_FLOWS.includes(flow)) {
        this.logger.log(`[A.5a] DefectExchangeReversal — JE ${je.entryNumber} is a credit transfer (${flow}), skipping`);
        continue;
      }
      // ข้ามรายการกลับรายการทุก flow (receipt-void / refund-reversal / defect-exchange /
      // exchange-cancel …) — ตั้งแต่ 2026-09-28 รายการเหล่านี้ผูก contractId จึงถูกกวาดเจอ;
      // mirror ซ้ำ = ลงรายการเดิมกลับเข้ามาใหม่โดยไม่มีเงินจริง
      if (meta['tag'] === 'REVERSAL') {
        this.logger.log(
          `[A.5a] DefectExchangeReversal — JE ${je.entryNumber} is itself a reversal JE (flow '${flow}'), skipping`,
        );
        continue;
      }
      // 15ข: รายการที่แตะเงินสด/ธนาคาร — mirror จะทำให้เงินออกจากธนาคารทั้งที่ไม่มีการคืนเงินจริง.
      //   คู่เป็นเงินของลูกค้าล้วน (จ่ายเกิน → 21-5101 · ส่วนเกินลิงก์ชำระ → 21-1103 + ภาษีพัก) = ข้าม:
      //   ขั้น ข ของเปลี่ยนเครื่องอ่านยอด 21-1103/21-5101 ในบัญชีแล้วย้ายเป็นเครดิตเอง.
      //   คู่เป็นอย่างอื่น (เช่น ใบรับชำระที่ไม่มีใบเสร็จจึงไม่ถูกยกเลิกในขั้น ก) = ปฏิเสธ ไม่เดา.
      //   (ตรวจหลังข้าม tag REVERSAL — กระจกใบรับชำระก็มีขาเงินสด แต่ถูกข้ามด้วยกติกาข้างบนอยู่แล้ว)
      const cashLines = je.lines.filter((l) => isCashAccount(l.accountCode));
      if (cashLines.length > 0) {
        const others = je.lines.filter((l) => !isCashAccount(l.accountCode));
        const customerMoneyOnly = others.every((l) =>
          (CUSTOMER_MONEY_ACCOUNTS as readonly string[]).includes(l.accountCode),
        );
        if (customerMoneyOnly) {
          this.logger.log(
            `[A.5a] DefectExchangeReversal — JE ${je.entryNumber} is customer money (cash ↔ 21-1103/21-5101), left for the credit transfer`,
          );
          continue;
        }
        throw new BadRequestException(
          `รายการบัญชี ${je.entryNumber} ของสัญญา ${contract.contractNumber} มีขาเงินสด/ธนาคารที่ระบบกลับรายการให้ไม่ได้ ` +
            '(เช่น ใบรับชำระที่ยังไม่มีใบเสร็จ) — ให้ฝ่ายบัญชีตรวจรายการนี้ก่อนเปลี่ยนเครื่อง',
        );
      }
      candidates.push(je);
    }

    for (const je of candidates) {
      const meta = (je.metadata ?? {}) as Record<string, unknown>;

      // Idempotency: check if reversal JE already exists for this original
      const existingReversal = await client.journalEntry.findFirst({
        where: {
          AND: [
            {
              metadata: { path: ['originalEntryId'], equals: je.id },
            } as Prisma.JournalEntryWhereInput,
            {
              metadata: { path: ['flow'], equals: 'defect-exchange' },
            } as Prisma.JournalEntryWhereInput,
          ],
          deletedAt: null,
        },
      });

      if (existingReversal) {
        this.logger.log(
          `[A.5a] DefectExchangeReversal — reversal for JE ${je.entryNumber} already exists (${existingReversal.entryNumber}), skipping`,
        );
        entryNos.push(existingReversal.entryNumber);
        continue;
      }

      if (je.lines.length === 0) {
        this.logger.warn(`[A.5a] DefectExchangeReversal — JE ${je.entryNumber} has no lines, skipping`);
        continue;
      }

      // Build reversed lines (swap Dr/Cr)
      const reversedLines = je.lines.map((l) => ({
        accountCode: l.accountCode,
        dr: new Decimal(l.credit.toString()),
        cr: new Decimal(l.debit.toString()),
        description: `[REVERSAL] ${l.description ?? ''}`.trim(),
      }));

      const result = await this.journal.createAndPost(
        {
          description: `[เปลี่ยนเครื่องตำหนิ] ยกเลิก JE ${je.entryNumber} — สัญญา ${contract.contractNumber}`,
          reference: `${je.id}:reversal`,
          metadata: {
            tag: 'REVERSAL',
            flow: 'defect-exchange',
            originalEntryId: je.id,
            contractId,
          },
          lines: reversedLines,
        },
        tx,
      );

      // Mark original as reversed
      await client.journalEntry.update({
        where: { id: je.id },
        data: {
          metadata: {
            ...(meta as Prisma.InputJsonObject),
            reversed: true,
            reversedByEntryNumber: result.entryNumber,
          },
        },
      });

      entryNos.push(result.entryNumber);
    }

    this.logger.log(
      `[A.5a] DefectExchangeReversal — reversed ${entryNos.length} JEs for contract ${contract.contractNumber}`,
    );

    return { reversedCount: entryNos.length, entryNos };
  }
}
