// apps/api/scripts/backfill-external-finance-fk.ts
import { PrismaClient } from '@prisma/client';
import { normalizeFinanceCompanyName } from '../src/modules/finance-receivable-contact-logs/finance-company-name-normalizer.util';

const prisma = new PrismaClient();

interface Report {
  receivablesMatched: number;
  receivablesNewCompany: number;
  contactsMigrated: number;
  contactsSkipped: number;
}

async function main(): Promise<Report> {
  const report: Report = {
    receivablesMatched: 0,
    receivablesNewCompany: 0,
    contactsMigrated: 0,
    contactsSkipped: 0,
  };

  // Step 1: index existing ExternalFinanceCompany by normalized name
  const allCompanies = await prisma.externalFinanceCompany.findMany({
    where: { deletedAt: null },
  });
  const byNormName = new Map<string, string>();
  for (const c of allCompanies) {
    byNormName.set(normalizeFinanceCompanyName(c.name), c.id);
  }

  // Step 2: resolve FK on every receivable that lacks one
  const orphans = await prisma.financeReceivable.findMany({
    where: { externalFinanceCompanyId: null, deletedAt: null },
    select: { id: true, financeCompany: true },
  });

  for (const r of orphans) {
    const norm = normalizeFinanceCompanyName(r.financeCompany);
    let companyId = byNormName.get(norm);
    if (!companyId) {
      const created = await prisma.externalFinanceCompany.create({
        data: { name: r.financeCompany, isActive: true },
      });
      companyId = created.id;
      byNormName.set(norm, companyId);
      report.receivablesNewCompany += 1;
    } else {
      report.receivablesMatched += 1;
    }
    await prisma.financeReceivable.update({
      where: { id: r.id },
      data: { externalFinanceCompanyId: companyId },
    });
  }

  // Step 3: migrate contactPerson/contactPhone → FinanceCompanyContact (idempotent)
  const legacy = await prisma.externalFinanceCompany.findMany({
    where: { deletedAt: null, contactPerson: { not: null } },
  });
  for (const co of legacy) {
    const existingPrimary = await prisma.financeCompanyContact.findFirst({
      where: { externalFinanceCompanyId: co.id, isPrimary: true, deletedAt: null },
    });
    if (existingPrimary) {
      report.contactsSkipped += 1;
      continue;
    }
    await prisma.financeCompanyContact.create({
      data: {
        externalFinanceCompanyId: co.id,
        name: co.contactPerson!,
        phone: co.contactPhone,
        isPrimary: true,
        isActive: true,
      },
    });
    report.contactsMigrated += 1;
  }

  return report;
}

main()
  .then((report) => {
    console.log('Backfill report:', JSON.stringify(report, null, 2));
    return prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
