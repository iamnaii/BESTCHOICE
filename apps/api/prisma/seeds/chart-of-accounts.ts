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
  // Path resolution: works for both dev (tsx from prisma/seeds/) and CI (compiled to dist/prisma/seeds/).
  // Try multiple candidates because __dirname depth varies (4 levels up in dev, 5 in CI compiled).
  const candidates = [
    path.resolve(__dirname, '../../../../docs/references/owner-chart-of-accounts.csv'),     // dev: prisma/seeds/ → repo root
    path.resolve(__dirname, '../../../../../docs/references/owner-chart-of-accounts.csv'),  // CI: dist/prisma/seeds/ → repo root
    path.resolve(process.cwd(), 'docs/references/owner-chart-of-accounts.csv'),             // fallback: relative to cwd
  ];
  const csvPath = candidates.find((p) => fs.existsSync(p));
  if (!csvPath) {
    throw new Error(
      `Owner CoA CSV not found. Tried: ${candidates.join(', ')}. ` +
      `__dirname=${__dirname}, cwd=${process.cwd()}`,
    );
  }
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

  // SHOP-side accounts required by Phase A.1b inter-company JEs +
  // Phase A.2 unearned commission deferred recognition.
  // Owner CSV does not include these — explicit upserts ensure they exist.
  const shopExtraAccounts: Array<{
    code: string;
    nameTh: string;
    nameEn: string;
    accountGroup: AccountGroup;
    parentCode: string;
  }> = [
    {
      code: '11-2105',
      nameTh: 'ลูกหนี้คู่ค้า — FINANCE (Due-from-FINANCE)',
      nameEn: 'Inter-company Receivable — FINANCE',
      accountGroup: AccountGroup.ASSET,
      parentCode: '11-21XX',
    },
    {
      code: '42-1105',
      nameTh: 'รายได้ค่านายหน้า/คอมมิชชัน — FINANCE',
      nameEn: 'Commission Income from FINANCE',
      accountGroup: AccountGroup.REVENUE,
      parentCode: '42-11XX',
    },
    {
      code: '21-2201',
      nameTh: 'รายได้ค่านายหน้ารอตัดบัญชี (Unearned Commission)',
      nameEn: 'Unearned Commission Income',
      accountGroup: AccountGroup.LIABILITY,
      parentCode: '21-22XX',
    },
    {
      code: '53-1801',
      nameTh: 'ส่วนลดให้ลูกค้า — คอมมิชชัน',
      nameEn: 'Sales Discount on Commission',
      accountGroup: AccountGroup.EXPENSE,
      parentCode: '53-18XX',
    },
  ];

  for (const acc of shopExtraAccounts) {
    await prisma.chartOfAccount.upsert({
      where: { companyId_code: { companyId: shopCompany.id, code: acc.code } },
      update: { nameTh: acc.nameTh, nameEn: acc.nameEn, isActive: true },
      create: {
        code: acc.code,
        companyId: shopCompany.id,
        nameTh: acc.nameTh,
        nameEn: acc.nameEn,
        accountGroup: acc.accountGroup,
        parentCode: acc.parentCode,
        level: 3,
        isActive: true,
        peakAccountCode: acc.code,
      },
    });
  }

  console.log(`  ✓ Chart of Accounts: ${shopAccounts.length + shopExtraAccounts.length} SHOP + 41 FINANCE seeded`);
}
