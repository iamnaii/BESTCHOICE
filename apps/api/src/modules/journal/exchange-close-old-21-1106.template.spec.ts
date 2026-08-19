import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { ExchangeCloseOld21_1106Template } from './cpa-templates/exchange-close-old-21-1106.template';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ExchangeCloseOld21_1106Template', () => {
  let template: ExchangeCloseOld21_1106Template;
  let journal: any;

  beforeEach(async () => {
    journal = { createAndPost: jest.fn().mockResolvedValue({ id: 'je-uuid', entryNumber: 'JV-X' }) };
    const mod = await Test.createTestingModule({
      providers: [
        ExchangeCloseOld21_1106Template,
        { provide: PrismaService, useValue: {} },
        { provide: JournalAutoService, useValue: journal },
      ],
    }).compile();
    template = mod.get(ExchangeCloseOld21_1106Template);
  });

  // วิธีสุทธิ (workbook 2026-08-19): diff = (buyback + unearned + deferredVat)
  // − (gross + vatRec×2). Break-even buyback for this fixture =
  // 12,920.00 − 3,460.00 = 9,460.00.
  it('LOSS branch (วิธีสุทธิ): buyback 8,333.36 < break-even 9,460.00 → Dr 51-1102 1,126.64, no 41-1101 line', async () => {
    await template.execute({
      oldContractId: 'old',
      requestId: 'req-1',
      buyback: new Decimal('8333.36'),
      oldGrossOutstanding: new Decimal('11333.28'),
      oldVatReceivableOutstanding: new Decimal('793.36'),
      oldUnearnedInterestOutstanding: new Decimal('2666.64'),
      oldDeferredVatOutstanding: new Decimal('793.36'),
    });

    const lines = journal.createAndPost.mock.calls[0][0].lines;
    const loss = lines.find((l: any) => l.accountCode === '51-1102');
    expect(loss).toBeDefined();
    expect(loss.dr.toFixed(2)).toBe('1126.64');
    const gain = lines.find((l: any) => l.accountCode === '41-1102');
    expect(gain).toBeUndefined();
    // วิธีสุทธิ: ไม่มีขา Cr 41-1101 อีกต่อไป (anti-regression, workbook 2026-08-19)
    expect(lines.find((l: any) => l.accountCode === '41-1101')).toBeUndefined();
    // Balance
    const drSum = lines.reduce((s: Decimal, l: any) => s.plus(l.dr), new Decimal(0));
    const crSum = lines.reduce((s: Decimal, l: any) => s.plus(l.cr), new Decimal(0));
    expect(drSum.toFixed(2)).toBe(crSum.toFixed(2));
  });

  it('GAIN branch (วิธีสุทธิ): buyback 10,333.36 > break-even 9,460.00 → Cr 41-1102 873.36', async () => {
    await template.execute({
      oldContractId: 'old',
      requestId: 'req-1',
      buyback: new Decimal('10333.36'),
      oldGrossOutstanding: new Decimal('11333.28'),
      oldVatReceivableOutstanding: new Decimal('793.36'),
      oldUnearnedInterestOutstanding: new Decimal('2666.64'),
      oldDeferredVatOutstanding: new Decimal('793.36'),
    });
    const lines = journal.createAndPost.mock.calls[0][0].lines;
    const gain = lines.find((l: any) => l.accountCode === '41-1102');
    expect(gain.cr.toFixed(2)).toBe('873.36');
    expect(lines.find((l: any) => l.accountCode === '51-1102')).toBeUndefined();
  });

  it('PERFECT branch (วิธีสุทธิ): buyback 9,460.00 == break-even → no P&L line', async () => {
    await template.execute({
      oldContractId: 'old',
      requestId: 'req-1',
      buyback: new Decimal('9460.00'),
      oldGrossOutstanding: new Decimal('11333.28'),
      oldVatReceivableOutstanding: new Decimal('793.36'),
      oldUnearnedInterestOutstanding: new Decimal('2666.64'),
      oldDeferredVatOutstanding: new Decimal('793.36'),
    });
    const lines = journal.createAndPost.mock.calls[0][0].lines;
    expect(lines.find((l: any) => l.accountCode === '51-1102')).toBeUndefined();
    expect(lines.find((l: any) => l.accountCode === '41-1102')).toBeUndefined();
  });

  it('stamps contractId + request-scoped idempotencyKey (Device Swap Task 6 + C1b)', async () => {
    // Why: glContractBalance filters journal entries by metadata.contractId ONLY.
    // Without this stamp, computeOldOutstanding after a device swap would still
    // see the old contract's outstanding balance (never nets to 0).
    // C1b: key includes requestId — a canceled swap's still-POSTED JE must not
    // block the same contract's second exchange attempt.
    await template.execute({
      oldContractId: 'old',
      requestId: 'req-1',
      buyback: new Decimal('11000'),
      oldGrossOutstanding: new Decimal('11333.28'),
      oldVatReceivableOutstanding: new Decimal('793.36'),
      oldUnearnedInterestOutstanding: new Decimal('2666.64'),
      oldDeferredVatOutstanding: new Decimal('793.36'),
    });

    const meta = journal.createAndPost.mock.calls[0][0].metadata;
    expect(meta.contractId).toBe('old');
    expect(meta.idempotencyKey).toBe('old:req-1');
    // วิธีสุทธิ marker (workbook 2026-08-19) — แถวเก่าไม่มี key นี้ = gross
    expect(meta.method).toBe('NET');
  });
});
