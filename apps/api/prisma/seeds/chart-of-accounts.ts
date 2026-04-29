import { PrismaClient, AccountGroup } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { seedFinanceChartOfAccounts } from './chart-of-accounts-finance';

interface ChartOfAccountSeed {
  code: string;
  nameTh: string;
  nameEn?: string;
  accountGroup: AccountGroup;
  parentCode?: string;
  level: number;
}

function parseOwnerCsv(): ChartOfAccountSeed[] {
  const csvPath = path.resolve(__dirname, '../../../../docs/references/owner-chart-of-accounts.csv');
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim());

  const accounts: ChartOfAccountSeed[] = [];
  let currentGroup: AccountGroup | null = null;

  for (const line of lines) {
    const cols = line.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
    const first = cols[0] || '';

    if (first.startsWith('หมวดที่ 1')) { currentGroup = AccountGroup.ASSET; continue; }
    if (first.startsWith('หมวดที่ 2')) { currentGroup = AccountGroup.LIABILITY; continue; }
    if (first.startsWith('หมวดที่ 3')) { currentGroup = AccountGroup.EQUITY; continue; }
    if (first.startsWith('หมวดที่ 4')) { currentGroup = AccountGroup.REVENUE; continue; }
    if (first.startsWith('หมวดที่ 5')) { currentGroup = AccountGroup.EXPENSE; continue; }
    if (first === 'เลขบัญชี') continue;

    if (!currentGroup) continue;
    if (!/^\d{2}-\d{4,5}$/.test(first)) continue;

    const code = first;
    const nameTh = cols[1] || '';
    if (!nameTh) continue;

    let level = 3;
    if (code.endsWith('-0000') || code.endsWith('-1000') || code.endsWith('-2000')) level = 1;
    else if (code.endsWith('XX')) level = 2;

    accounts.push({ code, nameTh, accountGroup: currentGroup, level });
  }

  return accounts;
}

export async function seedChartOfAccounts(prisma: PrismaClient): Promise<void> {
  console.log('Seeding Chart of Accounts (Phase A.1a — SHOP + FINANCE split)...');

  const shopCompany = await prisma.companyInfo.findFirst({
    where: { companyCode: 'SHOP', deletedAt: null },
    select: { id: true },
  });
  const financeCompany = await prisma.companyInfo.findFirst({
    where: { companyCode: 'FINANCE', deletedAt: null },
    select: { id: true },
  });

  if (!shopCompany || !financeCompany) {
    throw new Error('SHOP and FINANCE companies must exist before seeding chart of accounts');
  }

  const shopAccounts = parseOwnerCsv();
  console.log(`  → Seeding ${shopAccounts.length} SHOP accounts from owner CSV...`);
  for (const acc of shopAccounts) {
    await prisma.chartOfAccount.upsert({
      where: { companyId_code: { companyId: shopCompany.id, code: acc.code } },
      update: {
        nameTh: acc.nameTh, nameEn: acc.nameEn, accountGroup: acc.accountGroup,
        level: acc.level, isActive: true, peakAccountCode: acc.code,
      },
      create: {
        code: acc.code, companyId: shopCompany.id, nameTh: acc.nameTh, nameEn: acc.nameEn,
        accountGroup: acc.accountGroup, parentCode: acc.parentCode, level: acc.level,
        isActive: true, peakAccountCode: acc.code,
      },
    });
  }

  await seedFinanceChartOfAccounts(prisma, financeCompany.id);

  // SHOP-side clearing account for inter-company (used in A.1b)
  await prisma.chartOfAccount.upsert({
    where: { companyId_code: { companyId: shopCompany.id, code: '11-2105' } },
    update: { nameTh: 'ลูกหนี้คู่ค้า — FINANCE (Due-from-FINANCE)' },
    create: {
      code: '11-2105', companyId: shopCompany.id,
      nameTh: 'ลูกหนี้คู่ค้า — FINANCE (Due-from-FINANCE)',
      nameEn: 'Inter-company Receivable — FINANCE',
      accountGroup: AccountGroup.ASSET, parentCode: '11-21XX', level: 3,
      isActive: true, peakAccountCode: '11-2105',
    },
  });

  console.log(`  ✓ Chart of Accounts: ${shopAccounts.length + 1} SHOP + 41 FINANCE seeded`);
}
