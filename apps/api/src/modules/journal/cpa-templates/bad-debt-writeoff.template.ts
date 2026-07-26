import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { computeCnBreakdown } from '../compute-cn-breakdown';
import { glContractBalance } from '../gl-contract-balance';

export interface BadDebtWriteOffInput {
  contractId: string;
  writeOffReason?: string;
}

/**
 * Template — Bad Debt Write-Off.
 *
 * Mirrors RepossessionJP5Template minus the cash/inventory legs: clears EVERY
 * GL balance the 1A activation + 2A accrual cycle can leave on this contract
 * (accrued receivable, deferred receivable, deferred/settled VAT, unearned
 * interest), consumes existing provision first, and issues a ม.82/5 credit
 * note for the VAT portion of any accrued-but-unpaid installment.
 *
 * Cr legs use the GL balance (not a re-derived formula) so any rounding
 * residual parked by the last-installment true-up in 2A gets swept to zero
 * along with everything else — no orphaned cents left on the ledger.
 *
 * JE:
 *   Dr 21-2101  cnVat (pro-rated per accrued+unpaid installment — computeCnBreakdown)   ← ใบลดหนี้ VAT (ม.82/5), only if any accrued+unpaid
 *   Dr 11-2106  glBalance(11-2106)                          ← ล้าง unearned interest คงเหลือ
 *   Dr 21-2102  glBalance(21-2102, cr side)                 ← ล้างภาษีขายรอเรียกเก็บคงเหลือ
 *   Dr 11-2102  provisionConsumed                           ← ใช้ค่าเผื่อก่อน (เดิม)
 *   Dr 51-1102  plug (loss ส่วนเกินค่าเผื่อ)                    ← ส่วนที่เหลือให้ JE balance
 *     Cr 11-2103  glBalance(11-2103)                        ← ล้างลูกหนี้ค้าง (accrued)
 *     Cr 11-2101  glBalance(11-2101)                        ← ล้างลูกหนี้ Gross (deferred)
 *     Cr 11-2105  glBalance(11-2105)                        ← ล้างลูกหนี้ภาษีขายรอฯ
 *     Cr 21-2101  glBalance(21-2102, cr side)                ← VAT deferred ถึงกำหนดนำส่ง (ม.82/3)
 *     Cr 41-1101  glBalance(11-2106)                        ← รับรู้ดอกเบี้ยงวด deferred (แบบ JP5)
 */
@Injectable()
export class BadDebtWriteOffTemplate {
  private readonly logger = new Logger(BadDebtWriteOffTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: BadDebtWriteOffInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const { contractId, writeOffReason } = input;
    const client = tx ?? this.prisma;

    // Idempotency check
    const existingWo = await client.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'write-off' } } as any,
          { metadata: { path: ['contractId'], equals: contractId } } as any,
        ],
        deletedAt: null,
      },
    });
    if (existingWo) {
      this.logger.log(
        `[A.5a] BadDebtWriteOff idempotency — JE ${existingWo.entryNumber} already exists for contract ${contractId}, skipping`,
      );
      return { entryNo: existingWo.entryNumber };
    }

    const contract = await client.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: { id: true, contractNumber: true },
    });

    // ---- GL balances (เก็บกวาดจริงถึงศูนย์ รวมเศษ rounding งวดสุดท้าย) ----
    // Shared helper (2026-07-26, Task 5) — single source of truth with
    // RepossessionJP5Template + BadDebtService's ECL delta cron.
    const glBal = (accountCode: string, side: 'dr' | 'cr'): Promise<Decimal> =>
      glContractBalance(client, contractId, accountCode, side);

    const bal2103 = await glBal('11-2103', 'dr');
    const bal2101 = await glBal('11-2101', 'dr');
    const bal2106 = await glBal('11-2106', 'cr');
    const bal2105 = await glBal('11-2105', 'dr');
    const bal21_2102 = await glBal('21-2102', 'cr');
    const provisionBalance = await glBal('11-2102', 'cr');

    const totalReceivable = bal2103.plus(bal2101);
    if (totalReceivable.lte(0)) {
      throw new Error(
        `[A.5a] BadDebtWriteOff — no outstanding receivable balance for contract ${contract.contractNumber}`,
      );
    }

    // ---- CN VAT (ม.82/5) — งวด accrued ที่ยังไม่จ่าย (mirror JP5) ----
    const c = await client.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: {
        id: true,
        contractNumber: true,
        totalMonths: true,
        financedAmount: true,
        storeCommission: true,
        interestTotal: true,
        vatAmount: true,
      },
    });
    // CPA pro-rate ruling (2026-07-26, docs/superpowers/plans/2026-07-26-cn-prorate-cpa.md):
    // a partially-paid accrued installment's CN VAT is pro-rated to its
    // outstanding balance instead of the full vatPerInst. computeCnBreakdown is
    // the single source of truth shared with RepossessionJP5Template and
    // CreditNoteDocumentService so the JE and the CN document never drift.
    // opts omitted (unlike JP5) — this template doesn't already have the
    // installments/payments loaded in memory, so let the util query them.
    const cnBreakdown = await computeCnBreakdown(client, c);
    const cnVat = cnBreakdown.totalCnVat;
    // CPA pro-rate: key off the actual amount, not the raw count, so this flag
    // stays truthful on the (theoretical) fully-paid-but-still-accrued edge case
    // (matches RepossessionJP5Template's identical fix).
    const creditNoteIssued = cnVat.gt(0);

    // ---- สร้าง lines: Dr ทั้งหมดก่อน แล้ว plug 51-1102 ให้ balance ----
    const zero = new Decimal(0);
    const lines: { accountCode: string; dr: Decimal; cr: Decimal; description?: string }[] = [];

    if (creditNoteIssued) {
      lines.push({
        accountCode: '21-2101',
        dr: cnVat,
        cr: zero,
        description: `ใบลดหนี้ VAT ${cnBreakdown.count} งวด (ม.82/5)`,
      });
    }
    if (bal2106.gt(0)) {
      lines.push({
        accountCode: '11-2106',
        dr: bal2106,
        cr: zero,
        description: 'ยกเลิกรายได้รอตัดบัญชี-ดอกเบี้ย',
      });
    }
    if (bal21_2102.gt(0)) {
      lines.push({
        accountCode: '21-2102',
        dr: bal21_2102,
        cr: zero,
        description: 'ล้างภาษีขายรอเรียกเก็บ',
      });
    }

    if (bal2103.gt(0)) {
      lines.push({
        accountCode: '11-2103',
        dr: zero,
        cr: bal2103,
        description: 'ล้างลูกหนี้ค้างชำระ (accrued)',
      });
    }
    if (bal2101.gt(0)) {
      lines.push({
        accountCode: '11-2101',
        dr: zero,
        cr: bal2101,
        description: 'ล้างลูกหนี้ผ่อนชำระ (Gross)',
      });
    }
    if (bal2105.gt(0)) {
      lines.push({
        accountCode: '11-2105',
        dr: zero,
        cr: bal2105,
        description: 'ล้างลูกหนี้ภาษีขายรอฯ',
      });
    }
    if (bal21_2102.gt(0)) {
      lines.push({
        accountCode: '21-2101',
        dr: zero,
        cr: bal21_2102,
        description: 'ภาษีขาย ภ.พ.30 ถึงกำหนด (deferred, ม.82/3)',
      });
    }
    if (bal2106.gt(0)) {
      lines.push({
        accountCode: '41-1101',
        dr: zero,
        cr: bal2106,
        description: 'รับรู้รายได้ดอกเบี้ย (deferred)',
      });
    }

    // loss = ΣCr − ΣDr(ที่มีอยู่) → consume ค่าเผื่อก่อน แล้ว plug 51-1102
    const sumDr = lines.reduce((s, l) => s.plus(l.dr), new Decimal(0));
    const sumCr = lines.reduce((s, l) => s.plus(l.cr), new Decimal(0));
    let loss = sumCr.minus(sumDr);
    if (loss.lt(0)) {
      throw new Error(
        `[A.5a] BadDebtWriteOff — negative loss plug (${loss.toFixed(2)}) for contract ${contract.contractNumber}; GL state ผิดปกติ ต้องตรวจก่อน`,
      );
    }
    const provisionConsumed = Decimal.min(
      provisionBalance.gt(0) ? provisionBalance : new Decimal(0),
      loss,
    );
    if (provisionConsumed.gt(0)) {
      lines.push({
        accountCode: '11-2102',
        dr: provisionConsumed,
        cr: zero,
        description: 'ล้างค่าเผื่อหนี้สงสัยจะสูญ',
      });
      loss = loss.minus(provisionConsumed);
    }
    if (loss.gt(0)) {
      lines.push({
        accountCode: '51-1102',
        dr: loss,
        cr: zero,
        description: `หนี้สูญ — ${writeOffReason ?? 'ตัดหนี้สูญ'}`,
      });
    }

    // I3 — DB-level defense-in-depth (journal_entries_idempotency_idx,
    // P3-SP5 W8): partial unique index on (metadata->>'flow',
    // metadata->>'idempotencyKey'). write-off is single-shot per contract, so
    // the key is just the contractId (no runDate component).
    const idempotencyKey = contractId;

    try {
      const result = await this.journal.createAndPost(
        {
          description: `ตัดหนี้สูญ — สัญญา ${contract.contractNumber}`,
          reference: `${contractId}:bad-debt-write-off`,
          metadata: {
            tag: 'BAD-DEBT',
            flow: 'write-off',
            idempotencyKey,
            contractId,
            totalReceivable: totalReceivable.toFixed(2),
            provisionConsumed: provisionConsumed.toFixed(2),
            writeOffExpense: loss.toFixed(2),
            creditNoteIssued,
            creditNoteVatAmount: cnVat.toFixed(2),
            writeOffReason: writeOffReason ?? null,
          },
          lines,
        },
        tx,
      );

      return { entryNo: result.entryNumber };
    } catch (err) {
      // A concurrent run can race past the findFirst probe above and lose
      // the unique-index race. Translate the P2002 into the same
      // idempotency-hit return shape the probe above would have returned,
      // instead of surfacing a raw constraint error to the caller.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const race = await client.journalEntry.findFirst({
          where: {
            AND: [
              { metadata: { path: ['flow'], equals: 'write-off' } } as any,
              { metadata: { path: ['idempotencyKey'], equals: idempotencyKey } } as any,
            ],
            deletedAt: null,
          },
        });
        if (race) {
          this.logger.log(
            `[A.5a] BadDebtWriteOff race — JE ${race.entryNumber} already exists for idempotencyKey ${idempotencyKey} (P2002), returning existing`,
          );
          return { entryNo: race.entryNumber };
        }
      }
      throw err;
    }
  }
}
