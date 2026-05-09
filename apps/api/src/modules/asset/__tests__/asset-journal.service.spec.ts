import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaClient, AssetCategory, AssetStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { AssetJournalService } from '../asset-journal.service';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';

const prisma = new PrismaClient();
let service: AssetJournalService;
let userId: string;
let companyId: string;

// Unique tag per test run to scope listing results away from other test data
const RUN_TAG = `AJ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

beforeAll(async () => {
  await seedFinanceCoa(prisma);
  let user = await prisma.user.findFirst({
    where: { email: 'asset-journal-test@bestchoice.local' },
  });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'asset-journal-test@bestchoice.local',
        name: 'AJ Tester',
        password: 'x',
        role: 'OWNER',
      },
    });
  }
  userId = user.id;
  const finance = await prisma.companyInfo.findFirst({
    where: { companyCode: 'FINANCE', deletedAt: null },
  });
  companyId = finance!.id;

  const moduleRef = await Test.createTestingModule({
    providers: [AssetJournalService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  service = moduleRef.get(AssetJournalService);
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete`,
  );
  try {
    await prisma.auditLog.deleteMany({ where: { userId } });
  } finally {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete`,
    );
  }
  await prisma.journalLine.deleteMany({
    where: { journalEntry: { createdById: userId } },
  });
  await prisma.journalEntry.deleteMany({ where: { createdById: userId } });
  await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.journalLine.deleteMany({
    where: { journalEntry: { createdById: userId } },
  });
  await prisma.journalEntry.deleteMany({ where: { createdById: userId } });
  await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
});

async function createTestAsset(nameSuffix = '') {
  const name = `${RUN_TAG}-asset${nameSuffix}`;
  return prisma.fixedAsset.create({
    data: {
      assetCode: `${RUN_TAG}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      docNo: `ASSET-${RUN_TAG}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      category: 'EQUIPMENT' as AssetCategory,
      basePrice: new Decimal(10000),
      shippingCost: new Decimal(0),
      installationCost: new Decimal(0),
      otherCapitalized: new Decimal(0),
      vatAmount: new Decimal(0),
      whtAmount: new Decimal(0),
      purchaseCost: new Decimal(10000),
      residualValue: new Decimal(0),
      usefulLifeMonths: 12,
      monthlyDepr: new Decimal(833.33),
      netBookValue: new Decimal(10000),
      purchaseDate: new Date('2026-04-01'),
      paymentAccount: '11-1201',
      status: 'POSTED' as AssetStatus,
      createdById: userId,
    },
  });
}

let jeCounter = 0;
function nextEntryNumber() {
  jeCounter += 1;
  return `JE-202604-${String(Date.now() % 100000).padStart(5, '0')}-${jeCounter}`;
}

async function createTestJe(flow: string, assetId: string) {
  return prisma.journalEntry.create({
    data: {
      entryNumber: nextEntryNumber(),
      companyId,
      entryDate: new Date('2026-04-15'),
      description: `Test ${flow} JE`,
      status: 'POSTED',
      createdById: userId,
      metadata: { flow, assetId },
      lines: {
        create: [
          { accountCode: '12-2101', debit: new Decimal(10000), credit: new Decimal(0) },
          { accountCode: '11-1201', debit: new Decimal(0), credit: new Decimal(10000) },
        ],
      },
    },
    include: { lines: true },
  });
}

describe('AssetJournalService.list', () => {
  it('returns asset-related JEs only (filtered by metadata.flow)', async () => {
    const a = await createTestAsset();
    await createTestJe('asset-purchase', a.id);
    await createTestJe('depreciation', a.id);
    await prisma.journalEntry.create({
      data: {
        entryNumber: nextEntryNumber(),
        companyId,
        entryDate: new Date('2026-04-15'),
        description: 'unrelated payment JE',
        status: 'POSTED',
        createdById: userId,
        metadata: { flow: 'payment', assetId: a.id },
        lines: {
          create: [
            { accountCode: '11-1201', debit: new Decimal(100), credit: new Decimal(0) },
            { accountCode: '11-2101', debit: new Decimal(0), credit: new Decimal(100) },
          ],
        },
      },
    });
    // search by RUN_TAG scopes results to JEs created in this run only
    const result = await service.list({ search: RUN_TAG });
    expect(result.data.length).toBe(2);
    expect(
      result.data.every((r) => ['asset-purchase', 'depreciation'].includes(r.flow)),
    ).toBe(true);
  });

  it('flowType filter narrows to specific flow', async () => {
    const a = await createTestAsset();
    await createTestJe('asset-purchase', a.id);
    await createTestJe('depreciation', a.id);
    const result = await service.list({ flowType: 'depreciation', search: RUN_TAG });
    expect(result.data.length).toBe(1);
    expect(result.data[0].flow).toBe('depreciation');
  });

  it('search matches asset.assetCode / name', async () => {
    const a = await createTestAsset('-A');
    const b = await createTestAsset('-B');
    const uniqueName = `SpecialAlpha-${RUN_TAG}`;
    await prisma.fixedAsset.update({ where: { id: a.id }, data: { name: uniqueName } });
    await createTestJe('asset-purchase', a.id);
    await createTestJe('asset-purchase', b.id);
    const result = await service.list({ search: uniqueName });
    expect(result.data.length).toBe(1);
    expect(result.data[0].assetId).toBe(a.id);
  });

  it('date range filter on entryDate', async () => {
    const a = await createTestAsset();
    const je1 = await createTestJe('asset-purchase', a.id);
    await prisma.journalEntry.update({
      where: { id: je1.id },
      data: { entryDate: new Date('2026-03-01') },
    });
    await createTestJe('depreciation', a.id);
    const result = await service.list({
      fromDate: '2026-04-01',
      toDate: '2026-04-30',
      search: RUN_TAG,
    });
    expect(result.data.length).toBe(1);
    expect(result.data[0].flow).toBe('depreciation');
  });

  it('paginates correctly', async () => {
    const a = await createTestAsset();
    for (let i = 0; i < 7; i++) await createTestJe('asset-purchase', a.id);
    const page1 = await service.list({ page: 1, limit: 5, search: RUN_TAG });
    expect(page1.data.length).toBe(5);
    expect(page1.total).toBe(7);
    const page2 = await service.list({ page: 2, limit: 5, search: RUN_TAG });
    expect(page2.data.length).toBe(2);
  });

  it('rejects invalid flowType', async () => {
    await expect(service.list({ flowType: 'invalid-flow' })).rejects.toThrow(
      /ไม่ถูกต้อง|flowType/i,
    );
  });
});
