import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface ExchangeCloseOldInput {
  oldContractId: string;
  /**
   * ContractExchangeRequest.id — part of the idempotency key (C1b, final review
   * 2026-07-29). Keying on oldContractId alone bricked re-exchange after a
   * cancel: the first lifecycle's JE stays POSTED (mirror-reversed, not
   * deleted) so its key still occupies journal_entries_idempotency_idx.
   */
  requestId: string;
  buyback: Decimal;
  oldGrossOutstanding: Decimal;
  oldVatReceivableOutstanding: Decimal;
  oldUnearnedInterestOutstanding: Decimal;
  oldDeferredVatOutstanding: Decimal;
}

/**
 * Exchange A.2 — Close old contract, clearing all outstanding balances via the
 * 21-1106 internal clearing account, with a plug-balance for any gain/loss.
 *
 * วิธีสุทธิ (workbook เจ้าของ 2026-08-19 — spec 2026-08-19-device-swap-netting-
 * cancel-workbook-design.md Gap ข้อ 6): ไม่ตั้งรายได้ 41-1101 จากดอกเบี้ยรอตัด
 * ที่เหลือ — ขาดทุน/กำไร = ราคารับซื้อ เทียบมูลค่าตามบัญชีสุทธิรวม VAT เท่านั้น.
 * (เดิมเป็นวิธี gross: Cr 41-1101 [unearned] + plug พองขึ้นเท่ากัน — กำไรสุทธิ
 * เท่ากันแต่บรรทัด P&L พองเกินคู่ ซึ่ง workbook ระบุ "ห้ามสลับกัน" กับเคสปิดยอด
 * ที่ใช้วิธี gross ผ่าน 52-1106.)
 *
 *   diff = (buyback + unearned + deferredVat) − (gross + vatRec + vatRec)
 *        (ติดลบ = ขาดทุน; ตัวเลข workbook Case 8: 8,000 − 8,126.64 = −126.64)
 *
 *   Dr 21-1106   [buyback]                         — clearing account
 *   Dr 11-2106   [oldUnearnedInterestOutstanding]  — reverse contra-asset
 *   Dr 21-2102   [oldDeferredVatOutstanding]       — reverse deferred VAT
 *   Dr 51-1102   [|diff|]  if diff < 0 (LOSS)
 *     Cr 11-2101 [oldGrossOutstanding]             — clear HP receivable
 *     Cr 11-2105 [oldVatReceivableOutstanding]     — clear VAT receivable
 *     Cr 21-2101 [oldVatReceivableOutstanding]     — recognize VAT to ภ.พ.30
 *     Cr 41-1102 [diff]    if diff > 0 (GAIN — unreachable ภายใต้นโยบายธุรกิจ
 *                          ราคารับซื้อ < เจ้าหนี้เสมอ; คงไว้เป็น guard ตาม workbook.
 *                          workbook ระบุกลุ่ม 42-xxxx — คง 41-1102 จนกว่า CPA สั่งย้าย)
 */
@Injectable()
export class ExchangeCloseOld21_1106Template {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: ExchangeCloseOldInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    // วิธีสุทธิ: plug = balancing figure ของบรรทัดคงที่ทั้งหมด (ไม่มีขา 41-1101)
    const threshold = input.oldGrossOutstanding.plus(input.oldVatReceivableOutstanding);
    const drFixed = input.buyback
      .plus(input.oldUnearnedInterestOutstanding)
      .plus(input.oldDeferredVatOutstanding);
    const crFixed = input.oldGrossOutstanding
      .plus(input.oldVatReceivableOutstanding) // Cr 11-2105
      .plus(input.oldVatReceivableOutstanding); // Cr 21-2101
    const diff = drFixed.minus(crFixed); // signed: negative = loss, positive = gain
    const zero = new Decimal(0);

    const lines: Array<{
      accountCode: string;
      dr: Decimal;
      cr: Decimal;
      description?: string;
    }> = [
      {
        accountCode: '21-1106',
        dr: input.buyback,
        cr: zero,
        description: 'ยอดจ่ายคืนเครื่องเก่า (clearing account)',
      },
      {
        accountCode: '11-2106',
        dr: input.oldUnearnedInterestOutstanding,
        cr: zero,
        description: 'ล้างดอกเบี้ยรอตัดบัญชีที่เหลือ',
      },
      {
        accountCode: '21-2102',
        dr: input.oldDeferredVatOutstanding,
        cr: zero,
        description: 'ล้างภาษีขายรอเรียกเก็บที่เหลือ',
      },
    ];

    if (diff.lessThan(0)) {
      lines.push({
        accountCode: '51-1102',
        dr: diff.abs(),
        cr: zero,
        description: 'ขาดทุนจากการเปลี่ยนเครื่อง (plug)',
      });
    } else if (diff.greaterThan(0)) {
      lines.push({
        accountCode: '41-1102',
        dr: zero,
        cr: diff,
        description: 'กำไรจากการเปลี่ยนเครื่อง (plug)',
      });
    }

    lines.push(
      {
        accountCode: '11-2101',
        dr: zero,
        cr: input.oldGrossOutstanding,
        description: 'ล้างลูกหนี้ผ่อนชำระ Gross เครื่องเก่า',
      },
      {
        accountCode: '11-2105',
        dr: zero,
        cr: input.oldVatReceivableOutstanding,
        description: 'ล้างลูกหนี้ภาษีขายรอเรียกเก็บ',
      },
      {
        accountCode: '21-2101',
        dr: zero,
        cr: input.oldVatReceivableOutstanding,
        description: 'รับรู้ภาษีขายเข้า ภ.พ.30',
      },
    );

    return this.journal.createAndPost(
      {
        description: `Exchange A.2 — close old contract ${input.oldContractId}`,
        metadata: {
          flow: 'exchange-close-old-21-1106',
          // Keyed per exchange REQUEST — a canceled swap's still-POSTED JE must
          // not block the same contract's second exchange attempt (C1b).
          idempotencyKey: `${input.oldContractId}:${input.requestId}`,
          contractId: input.oldContractId,
          oldContractId: input.oldContractId,
          buyback: input.buyback.toString(),
          threshold: threshold.toString(),
          method: 'NET', // วิธีสุทธิ (workbook 2026-08-19) — แถวเก่าไม่มี key นี้ = gross
        },
        lines,
      },
      tx,
    );
  }
}
