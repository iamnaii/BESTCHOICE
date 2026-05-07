import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { loadCaseFromCsv } from '../__tests__/csv-fixture-loader';
import { diffGoldenJE } from '../__tests__/golden-je-matcher';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { VendorClearanceTemplate } from './vendor-clearance.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

describe('VendorClearanceTemplate', () => {
  beforeAll(async () => {
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.receipt.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.contract.deleteMany({});
    await seedFinanceCoa(prisma);
    const exists = await prisma.user.findUnique({ where: { email: 'admin@bestchoice.com' } });
    if (!exists) {
      await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      });
    }
  });

  it('clears 21-1101 + 21-1102 by paying vendor 11,000', async () => {
    const c = await seedStandard17k12m(prisma);
    const journal = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const tmpl = new VendorClearanceTemplate(journal, prisma as any);
    await tmpl.execute({ contractId: c.id, depositAccountCode: '11-1101' });

    // CSV — find the block with 21-1101 Dr (vendor clearance, last block in case-1)
    const expected = loadCaseFromCsv(
      path.join(__dirname, '../__tests__/fixtures/cpa-cases/case-1-overpay.csv'),
    );
    const vendorBlock = expected.entries.find((e) =>
      e.lines.some((l) => l.code === '21-1101' && new Decimal(l.dr).gt(0)),
    );
    expect(vendorBlock).toBeDefined();

    const entries = await prisma.journalEntry.findMany({
      where: { metadata: { path: ['flow'], equals: 'vendor-clearance' } } as any,
      include: { lines: true },
    });
    expect(entries.length).toBe(1);
    const actual = [
      {
        tag: vendorBlock!.tag,
        lines: entries[0].lines.map((l) => ({
          code: l.accountCode,
          dr: new Decimal(l.debit.toString()),
          cr: new Decimal(l.credit.toString()),
        })),
      },
    ];

    const diff = diffGoldenJE([vendorBlock!], actual);
    expect(diff.diffs, diff.diffs.join('\n')).toEqual([]);
  });
});
