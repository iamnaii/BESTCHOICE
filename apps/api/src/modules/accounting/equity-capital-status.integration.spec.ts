import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GeneralLedgerReportService } from './general-ledger-report.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';

describe('getEquityStatementFromJournal — capitalStatus (2026-08-10)', () => {
  const prisma = new PrismaService();
  const service = new GeneralLedgerReportService(prisma, new CompanyResolverService(prisma));
  const journalAuto = new JournalAutoService(prisma);
  let jeId: string;

  beforeAll(async () => {
    await prisma.$connect();
    await seedFinanceCoa(prisma as never);
    const D = Prisma.Decimal;
    const je = await journalAuto.createAndPost({
      description: 'ทดสอบ capitalStatus — CAP_INIT partial',
      metadata: { flow: 'equity', idempotencyKey: `capstat-test-${Date.now()}` },
      lines: [
        { accountCode: '11-1201', dr: new D(700000), cr: new D(0) },
        { accountCode: '11-1310', dr: new D(300000), cr: new D(0) },
        { accountCode: '31-1101', dr: new D(0), cr: new D(1000000) },
      ],
    });
    jeId = je.id;
  });

  afterAll(async () => {
    await prisma.journalLine.deleteMany({ where: { journalEntryId: jeId } });
    await prisma.journalEntry.delete({ where: { id: jeId } });
    await prisma.$disconnect();
  });

  it('authorized/unpaid/paidUp สะท้อน GL 31-1101 กับ 11-1310', async () => {
    const now = new Date();
    const r = await service.getEquityStatementFromJournal(new Date(now.getFullYear(), 0, 1), now);
    expect(r.capitalStatus.authorized).toBeGreaterThanOrEqual(1000000);
    expect(r.capitalStatus.unpaid).toBeGreaterThanOrEqual(300000);
    expect(r.capitalStatus.paidUp).toBe(r.capitalStatus.authorized - r.capitalStatus.unpaid);
    expect(typeof r.caveat).toBe('string');
  });
});
