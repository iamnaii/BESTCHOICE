import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m, formatJEsAsBlocks } from '../__tests__/scenario-helpers';
import { loadCaseFromCsv } from '../__tests__/csv-fixture-loader';
import { diffGoldenJE } from '../__tests__/golden-je-matcher';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

describe('Template 1A — Contract Activation', () => {
  beforeAll(async () => {
    // Clean slate for JE-related tables
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    // Cascade: delete contracts after clearing child tables
    await prisma.contract.deleteMany({});
    await seedFinanceCoa(prisma);

    // Ensure the system user that JournalAutoService resolves exists in the test DB
    const systemEmail = 'admin@bestchoice.com';
    const existing = await prisma.user.findFirst({ where: { email: systemEmail } });
    if (!existing) {
      // Need a branch for the user — pick any or create a minimal one
      const anyBranch = await prisma.branch.findFirst({ where: { deletedAt: null } });
      let branchId = anyBranch?.id;
      if (!branchId) {
        const co = await prisma.companyInfo.findFirst({ where: { deletedAt: null } });
        let companyId = co?.id;
        if (!companyId) {
          const created = await prisma.companyInfo.create({
            data: {
              nameTh: 'System Co',
              taxId: '9999999999999',
              companyCode: 'SYSTEM',
              address: '1 System Rd',
              directorName: 'System',
              vatRegistered: false,
            },
          });
          companyId = created.id;
        }
        const b = await prisma.branch.create({ data: { name: '__system__', companyId } });
        branchId = b.id;
      }
      await prisma.user.create({
        data: {
          email: systemEmail,
          password: 'hashed_placeholder',
          name: 'Admin',
          role: 'OWNER',
          branchId,
        },
      });
    }
  });

  it('matches CSV golden case-1 block 1A', async () => {
    const contract = await seedStandard17k12m(prisma);

    // Wire up template with real PrismaService-shaped client
    const journal = new JournalAutoService(prisma as any);
    const tmpl = new ContractActivation1ATemplate(journal, prisma as any);
    await tmpl.execute(contract.id);

    // Load CSV golden and take first block (tagged "1" in CSV) → re-tag as "1A"
    const fixture = loadCaseFromCsv(
      path.join(
        __dirname,
        '../__tests__/fixtures/cpa-cases/case-1-overpay.csv',
      ),
    );
    const expected1A = [{ ...fixture.entries[0], tag: '1A' }];

    const actual = await formatJEsAsBlocks(prisma, contract.id);
    const actual1A = actual.filter((a) => a.tag === '1A');

    expect(actual1A.length).toBe(1);

    const diff = diffGoldenJE(expected1A, actual1A);
    expect(diff.diffs, diff.diffs.join('\n')).toEqual([]);
    expect(diff.ok).toBe(true);
  });
});
