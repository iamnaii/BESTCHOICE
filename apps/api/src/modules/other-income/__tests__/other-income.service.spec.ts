import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { OtherIncomeService } from '../other-income.service';
import { DocNumberService } from '../services/doc-number.service';
import { ValidationService } from '../services/validation.service';
import { AutoJournalService } from '../services/auto-journal.service';
import { OtherIncomeTemplate } from '../templates/other-income.template';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { StorageService } from '../../storage/storage.service';
import { JournalOverrideService } from '../services/journal-override.service';
import { AuditService } from '../../audit/audit.service';

const stubStorage = {
  upload: async () => undefined,
  delete: async () => undefined,
  getSignedUrl: async () => 'https://stub/url',
};

const D = (n: number | string) => new Prisma.Decimal(n);

// ============================================================
// Suite 1: CRUD (stub template — no real JE posts)
// ============================================================

describe('OtherIncomeService — CRUD', () => {
  let service: OtherIncomeService;
  let prisma: PrismaService;
  let userId: string;

  beforeAll(async () => {
    const stubTemplate = { post: async () => ({ id: 'stub-je', entryNumber: 'JE-STUB' }) };

    const module = await Test.createTestingModule({
      providers: [
        OtherIncomeService,
        DocNumberService,
        ValidationService,
        AutoJournalService,
        PrismaService,
        { provide: OtherIncomeTemplate, useValue: stubTemplate },
        { provide: StorageService, useValue: stubStorage },
        JournalOverrideService,
        AuditService,
      ],
    }).compile();
    await module.init();
    service = module.get(OtherIncomeService);
    prisma = module.get(PrismaService);

    // Ensure FINANCE CompanyInfo exists (may already be seeded in dev)
    await prisma.companyInfo.upsert({
      where: { companyCode: 'FINANCE' },
      update: {},
      create: {
        companyCode: 'FINANCE',
        nameTh: 'BESTCHOICE FINANCE',
        taxId: '0000000000001',
        address: 'TEST',
        directorName: 'ผู้อำนวยการ',
        vatRegistered: true,
      },
    });

    // Ensure required ChartOfAccount rows exist for test items
    await prisma.chartOfAccount.upsert({
      where: { code: '42-1102' },
      update: {},
      create: {
        code: '42-1102',
        name: 'รายได้ดอกเบี้ยฝากธนาคาร',
        type: 'รายได้',
        normalBalance: 'Cr',
        category: 'รายได้อื่น',
      },
    });
    await prisma.chartOfAccount.upsert({
      where: { code: '11-1201' },
      update: {},
      create: {
        code: '11-1201',
        name: 'ธนาคาร KBank',
        type: 'สินทรัพย์',
        normalBalance: 'Dr',
        category: 'เงินฝากธนาคาร',
      },
    });

    // Create a unique test user
    const user = await prisma.user.create({
      data: {
        email: `oi-test+${Date.now()}@bestchoice.test`,
        password: 'x',
        name: 'OI Tester',
        role: 'ACCOUNTANT',
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.otherIncomeItem.deleteMany({
      where: { otherIncome: { createdById: userId } },
    });
    await prisma.otherIncomeAdjustment.deleteMany({
      where: { otherIncome: { createdById: userId } },
    });
    await prisma.otherIncome.deleteMany({ where: { createdById: userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('creates a DRAFT with items and computes totals', async () => {
    const draft = await service.create(
      {
        issueDate: '2026-05-06',
        priceType: 'EXCLUSIVE',
        paymentAccountCode: '11-1201',
        amountReceived: 850,
        counterpartyName: 'KBank',
        items: [
          {
            accountCode: '42-1102',
            description: 'ดอกเบี้ยฝาก พ.ค. 69',
            quantity: 1,
            unitAmount: 1000,
            vatPct: 0,
            whtPct: 15,
          },
        ],
      },
      userId,
    );

    expect(draft.status).toBe('DRAFT');
    expect(draft.docNumber).toMatch(/^OI-20260506-\d{4}$/);
    expect(D(draft.incomeGross.toString()).eq(1000)).toBe(true);
    expect(D(draft.whtAmount.toString()).eq(150)).toBe(true);
    expect(D(draft.netReceived.toString()).eq(850)).toBe(true);
  });

  it('updates a DRAFT (replaces items wholesale)', async () => {
    const draft = await service.create(
      {
        issueDate: '2026-05-06',
        priceType: 'EXCLUSIVE',
        paymentAccountCode: '11-1201',
        amountReceived: 850,
        items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 1000, whtPct: 15 }],
      },
      userId,
    );

    const updated = await service.update(
      draft.id,
      {
        amountReceived: 1700,
        items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 2000, whtPct: 15 }],
      },
      userId,
    );

    expect(D(updated.incomeGross.toString()).eq(2000)).toBe(true);
    expect(D(updated.netReceived.toString()).eq(1700)).toBe(true);
  });

  it('refuses to update a POSTED doc (throws ConflictException with POSTED message)', async () => {
    const draft = await service.create(
      {
        issueDate: '2026-05-06',
        priceType: 'EXCLUSIVE',
        paymentAccountCode: '11-1201',
        amountReceived: 850,
        items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 1000, whtPct: 15 }],
      },
      userId,
    );
    await prisma.otherIncome.update({
      where: { id: draft.id },
      data: { status: 'POSTED', postedAt: new Date() },
    });

    await expect(
      service.update(draft.id, { amountReceived: 999 }, userId),
    ).rejects.toThrow(/POSTED/);
  });

  it('soft-deletes a DRAFT', async () => {
    const draft = await service.create(
      {
        issueDate: '2026-05-06',
        priceType: 'EXCLUSIVE',
        paymentAccountCode: '11-1201',
        amountReceived: 850,
        items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 1000, whtPct: 15 }],
      },
      userId,
    );

    await service.softDelete(draft.id, userId);

    const found = await prisma.otherIncome.findUnique({ where: { id: draft.id } });
    expect(found?.deletedAt).not.toBeNull();
  });

  it('refuses to delete a POSTED doc (throws ConflictException)', async () => {
    const draft = await service.create(
      {
        issueDate: '2026-05-06',
        priceType: 'EXCLUSIVE',
        paymentAccountCode: '11-1201',
        amountReceived: 850,
        items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 1000, whtPct: 15 }],
      },
      userId,
    );
    await prisma.otherIncome.update({
      where: { id: draft.id },
      data: { status: 'POSTED', postedAt: new Date() },
    });

    await expect(service.softDelete(draft.id, userId)).rejects.toThrow();
  });
});

// ============================================================
// Suite 2: post + reverse + copy (real OtherIncomeTemplate + JournalAutoService)
// ============================================================

describe('OtherIncomeService — post + reverse + copy', () => {
  let service: OtherIncomeService;
  let prisma: PrismaService;
  let userId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OtherIncomeService,
        DocNumberService,
        ValidationService,
        AutoJournalService,
        OtherIncomeTemplate,
        JournalAutoService,
        PrismaService,
        { provide: StorageService, useValue: stubStorage },
        JournalOverrideService,
        AuditService,
      ],
    }).compile();
    await module.init();
    service = module.get(OtherIncomeService);
    prisma = module.get(PrismaService);

    // Ensure FINANCE CompanyInfo
    await prisma.companyInfo.upsert({
      where: { companyCode: 'FINANCE' },
      update: {},
      create: {
        companyCode: 'FINANCE',
        nameTh: 'BESTCHOICE FINANCE',
        taxId: '0000000000001',
        address: 'TEST',
        directorName: 'ผู้อำนวยการ',
        vatRegistered: true,
      },
    });

    // Ensure system user (required by JournalAutoService.resolveSystemUserId)
    await prisma.user.upsert({
      where: { email: 'admin@bestchoice.com' },
      update: {},
      create: {
        email: 'admin@bestchoice.com',
        password: 'x',
        name: 'admin',
        role: 'OWNER',
      },
    });

    // Seed required CoA codes
    const coaSeeds = [
      { code: '42-1102', name: 'รายได้ดอกเบี้ยฝากธนาคาร', type: 'รายได้', normalBalance: 'Cr', category: 'รายได้อื่น' },
      { code: '11-1201', name: 'ธนาคาร KBank', type: 'สินทรัพย์', normalBalance: 'Dr', category: 'เงินฝากธนาคาร' },
      { code: '11-4103', name: 'ลูกหนี้ภาษีหัก ณ ที่จ่าย', type: 'สินทรัพย์', normalBalance: 'Dr', category: 'สินทรัพย์หมุนเวียน' },
    ];
    for (const seed of coaSeeds) {
      await prisma.chartOfAccount.upsert({
        where: { code: seed.code },
        update: {},
        create: seed,
      });
    }

    // Create a unique test user
    const user = await prisma.user.create({
      data: {
        email: `oi-post-test+${Date.now()}@bestchoice.test`,
        password: 'x',
        name: 'OI Post Tester',
        role: 'ACCOUNTANT',
      },
    });
    userId = user.id;
  }, 30_000);

  afterAll(async () => {
    // Clean up test data in dependency order
    // JournalLines and JournalEntries linked via journalEntryId
    const ois = await prisma.otherIncome.findMany({ where: { createdById: userId } });
    const jeIds = ois
      .filter((o) => o.journalEntryId)
      .map((o) => o.journalEntryId as string);

    // Reversal docs have a different createdById
    // Find via reversesId pointing to our docs
    const ourIds = ois.map((o) => o.id);
    const reversals = await prisma.otherIncome.findMany({
      where: { reversesId: { in: ourIds } },
    });
    const reversalJeIds = reversals
      .filter((r) => r.journalEntryId)
      .map((r) => r.journalEntryId as string);

    // Delete reversal docs first (they have reversesId FK)
    await prisma.otherIncomeItem.deleteMany({
      where: { otherIncomeId: { in: reversals.map((r) => r.id) } },
    });
    await prisma.otherIncome.deleteMany({ where: { id: { in: reversals.map((r) => r.id) } } });

    // Delete our docs
    await prisma.otherIncomeItem.deleteMany({ where: { otherIncomeId: { in: ourIds } } });
    await prisma.otherIncomeAdjustment.deleteMany({ where: { otherIncomeId: { in: ourIds } } });
    await prisma.otherIncome.deleteMany({ where: { createdById: userId } });

    // Delete JEs (lines cascade)
    const allJeIds = [...jeIds, ...reversalJeIds];
    if (allJeIds.length > 0) {
      await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: allJeIds } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: allJeIds } } });
    }

    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  }, 30_000);

  // Helper: create a DRAFT with the standard KBank interest doc
  async function createStandardDraft(issueDate = '2026-05-06') {
    return service.create(
      {
        issueDate,
        priceType: 'EXCLUSIVE',
        paymentAccountCode: '11-1201',
        amountReceived: 850,
        counterpartyName: 'KBank',
        items: [
          {
            accountCode: '42-1102',
            description: 'ดอกเบี้ยฝาก',
            quantity: 1,
            unitAmount: 1000,
            vatPct: 0,
            whtPct: 15,
          },
        ],
      },
      userId,
    );
  }

  // ----------------------------------------------------------------
  // Test 1: post() happy path
  // ----------------------------------------------------------------
  it('post(): DRAFT → POSTED with JE reference + receiptNo', async () => {
    const draft = await createStandardDraft();

    const posted = await service.post(draft.id, {}, userId);

    expect(posted.status).toBe('POSTED');
    expect(posted.journalEntryId).toBeTruthy();
    expect(posted.receiptNo).toMatch(/^RT-202605-\d{5}$/);
    expect(posted.postedAt).toBeTruthy();

    // Verify JE was created correctly
    const je = await prisma.journalEntry.findUnique({
      where: { id: posted.journalEntryId! },
      include: { lines: true },
    });
    expect(je).toBeDefined();
    expect(je!.status).toBe('POSTED');
    expect(je!.referenceId).toBe(draft.id);
    // 3 lines: Dr 11-1201 (bank), Dr 11-4103 (WHT), Cr 42-1102 (income)
    expect(je!.lines.length).toBe(3);
  }, 30_000);

  // ----------------------------------------------------------------
  // Test 2: post() rejects V10 validation error (mismatched amountReceived)
  // ----------------------------------------------------------------
  it('post(): rejects when V10 fails (amountReceived != netReceived, no adjustment)', async () => {
    // netReceived = 1000 - 150 = 850, but we set amountReceived = 800 (mismatch, no adj)
    const draft = await service.create(
      {
        issueDate: '2026-05-06',
        priceType: 'EXCLUSIVE',
        paymentAccountCode: '11-1201',
        amountReceived: 800,
        items: [
          {
            accountCode: '42-1102',
            quantity: 1,
            unitAmount: 1000,
            vatPct: 0,
            whtPct: 15,
          },
        ],
      },
      userId,
    );

    await expect(service.post(draft.id, {}, userId)).rejects.toMatchObject({
      response: expect.objectContaining({
        errors: expect.arrayContaining([
          expect.objectContaining({ rule: 'V10' }),
        ]),
      }),
    });
  }, 30_000);

  // ----------------------------------------------------------------
  // Test 3: reverse() — creates -R doc, flips JE, marks original REVERSED
  // ----------------------------------------------------------------
  it('reverse(): creates -R doc, flips JE, marks original REVERSED', async () => {
    const draft = await createStandardDraft();
    const posted = await service.post(draft.id, {}, userId);

    const reversal = await service.reverse(
      posted.id,
      { reason: 'INPUT_ERROR', note: 'ใส่ข้อมูลผิด ต้องกลับรายการ' },
      userId,
    );

    expect(reversal.status).toBe('POSTED');
    expect(reversal.reversesId).toBe(posted.id);
    expect(reversal.reverseReason).toBe('INPUT_ERROR');
    expect(reversal.journalEntryId).toBeTruthy();
    // W15 — reversal docNumber carries `-R` suffix so list views can flag it
    // without loading the detail page.
    expect(reversal.docNumber).toMatch(/-R$/);

    // Verify the original is now REVERSED
    const original = await prisma.otherIncome.findUnique({ where: { id: posted.id } });
    expect(original!.status).toBe('REVERSED');

    // Verify reversal JE has the same number of lines as original (flipped)
    const reversalJe = await prisma.journalEntry.findUnique({
      where: { id: reversal.journalEntryId! },
      include: { lines: true },
    });
    expect(reversalJe!.lines.length).toBe(3);

    // Verify Dr/Cr are flipped: original had Dr 11-1201, reversal should have Cr 11-1201
    const bankLine = reversalJe!.lines.find((l) => l.accountCode === '11-1201');
    expect(bankLine).toBeDefined();
    expect(new Prisma.Decimal(bankLine!.credit.toString()).gt(0)).toBe(true);
    expect(new Prisma.Decimal(bankLine!.debit.toString()).eq(0)).toBe(true);
  }, 30_000);

  // ----------------------------------------------------------------
  // Test 4: copy() — clones as new DRAFT with cleared amounts
  // ----------------------------------------------------------------
  it('copy(): clones as new DRAFT with cleared amountReceived and copiedFromId set', async () => {
    const draft = await createStandardDraft();

    const copied = await service.copy(draft.id, userId);

    expect(copied.status).toBe('DRAFT');
    expect(copied.copiedFromId).toBe(draft.id);
    expect(new Prisma.Decimal(copied.amountReceived.toString()).eq(0)).toBe(true);
    expect(copied.items.length).toBe(1);
    expect(copied.items[0].accountCode).toBe('42-1102');
    // Doc number should be different
    expect(copied.docNumber).not.toBe(draft.docNumber);
  }, 30_000);

  // ----------------------------------------------------------------
  // Test 5: dailySheet() — aggregates POSTED docs for a date
  // ----------------------------------------------------------------
  it('dailySheet(): aggregates POSTED docs for a given date', async () => {
    // Use a far-future distinct date to avoid pollution from other tests
    // and prevent collision with "today" when CI happens to run on the hardcoded date
    const testDate = '2099-12-31';

    // Create and post a doc on that date
    const draft = await service.create(
      {
        issueDate: testDate,
        priceType: 'EXCLUSIVE',
        paymentAccountCode: '11-1201',
        amountReceived: 850,
        counterpartyName: 'DailySheet Test',
        items: [
          {
            accountCode: '42-1102',
            quantity: 1,
            unitAmount: 1000,
            vatPct: 0,
            whtPct: 15,
          },
        ],
      },
      userId,
    );
    await service.post(draft.id, {}, userId);

    const sheet = await service.dailySheet(testDate);

    expect(sheet.date).toBe(testDate);
    expect(sheet.summary.docCount).toBeGreaterThanOrEqual(1);
    expect(new Prisma.Decimal(sheet.summary.incomeGross.toString()).gte(1000)).toBe(true);

    // byAccount should be an array (B1 fix) containing 42-1102
    expect(Array.isArray(sheet.byAccount)).toBe(true);
    expect(sheet.byAccount.some((r) => r.code === '42-1102')).toBe(true);

    // byPayment should be an array (B1 fix) containing 11-1201
    expect(Array.isArray(sheet.byPayment)).toBe(true);
    expect(sheet.byPayment.some((r) => r.code === '11-1201')).toBe(true);

    // summary should use vat/wht keys (B2 fix)
    expect(sheet.summary).toHaveProperty('vat');
    expect(sheet.summary).toHaveProperty('wht');
  }, 30_000);
});

// ============================================================
// Suite 3: post — period lock (B1)
// ============================================================

describe('OtherIncomeService — post — period lock (B1)', () => {
  let service: OtherIncomeService;
  let prisma: PrismaService;
  let userId: string;
  let financeCompanyId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OtherIncomeService,
        DocNumberService,
        ValidationService,
        AutoJournalService,
        OtherIncomeTemplate,
        JournalAutoService,
        PrismaService,
        { provide: StorageService, useValue: stubStorage },
        JournalOverrideService,
        AuditService,
      ],
    }).compile();
    await module.init();
    service = module.get(OtherIncomeService);
    prisma = module.get(PrismaService);

    // Ensure FINANCE CompanyInfo
    const company = await prisma.companyInfo.upsert({
      where: { companyCode: 'FINANCE' },
      update: {},
      create: {
        companyCode: 'FINANCE',
        nameTh: 'BESTCHOICE FINANCE',
        taxId: '0000000000001',
        address: 'TEST',
        directorName: 'ผู้อำนวยการ',
        vatRegistered: true,
      },
    });
    financeCompanyId = company.id;

    // Ensure system user
    await prisma.user.upsert({
      where: { email: 'admin@bestchoice.com' },
      update: {},
      create: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    });

    // Seed required CoA codes
    const coaSeeds = [
      { code: '42-1102', name: 'รายได้ดอกเบี้ยฝากธนาคาร', type: 'รายได้', normalBalance: 'Cr', category: 'รายได้อื่น' },
      { code: '11-1201', name: 'ธนาคาร KBank', type: 'สินทรัพย์', normalBalance: 'Dr', category: 'เงินฝากธนาคาร' },
      { code: '11-4103', name: 'ลูกหนี้ภาษีหัก ณ ที่จ่าย', type: 'สินทรัพย์', normalBalance: 'Dr', category: 'สินทรัพย์หมุนเวียน' },
    ];
    for (const seed of coaSeeds) {
      await prisma.chartOfAccount.upsert({ where: { code: seed.code }, update: {}, create: seed });
    }

    const user = await prisma.user.create({
      data: {
        email: `oi-period-lock+${Date.now()}@bestchoice.test`,
        password: 'x',
        name: 'OI Period Lock Tester',
        role: 'ACCOUNTANT',
      },
    });
    userId = user.id;
  }, 30_000);

  afterAll(async () => {
    const ois = await prisma.otherIncome.findMany({ where: { createdById: userId } });
    const ourIds = ois.map((o) => o.id);
    const jeIds = ois.filter((o) => o.journalEntryId).map((o) => o.journalEntryId as string);

    await prisma.otherIncomeItem.deleteMany({ where: { otherIncomeId: { in: ourIds } } });
    await prisma.otherIncomeAdjustment.deleteMany({ where: { otherIncomeId: { in: ourIds } } });
    await prisma.otherIncome.deleteMany({ where: { createdById: userId } });

    if (jeIds.length > 0) {
      await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
    }

    // Clean up accounting period rows created by this suite
    // (2026-04 for the post() tests + today's period for the reverse() test)
    const today = new Date();
    await prisma.accountingPeriod.deleteMany({
      where: {
        companyId: financeCompanyId,
        OR: [
          { year: 2026, month: 4 },
          { year: today.getFullYear(), month: today.getMonth() + 1 },
        ],
      },
    });

    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  }, 30_000);

  function createDraftOtherIncome(issueDate: string) {
    return service.create(
      {
        issueDate,
        priceType: 'EXCLUSIVE',
        paymentAccountCode: '11-1201',
        amountReceived: 850,
        counterpartyName: 'KBank',
        items: [
          {
            accountCode: '42-1102',
            description: 'ดอกเบี้ยฝาก',
            quantity: 1,
            unitAmount: 1000,
            vatPct: 0,
            whtPct: 15,
          },
        ],
      },
      userId,
    );
  }

  it('passes companyId so AccountingPeriod tier-1 check fires', async () => {
    // Arrange: a CLOSED FINANCE AccountingPeriod for the doc's month
    const doc = await createDraftOtherIncome('2026-04-15');
    await prisma.accountingPeriod.upsert({
      where: { companyId_year_month: { companyId: financeCompanyId, year: 2026, month: 4 } },
      update: { status: 'CLOSED' },
      create: { companyId: financeCompanyId, year: 2026, month: 4, status: 'CLOSED' },
    });

    // Act + Assert: should reject because period is CLOSED
    await expect(service.post(doc.id, {}, userId)).rejects.toThrow(/งวดที่ปิดแล้ว/);

    // Cleanup this doc (it was not posted, so no JE)
    await prisma.otherIncomeItem.deleteMany({ where: { otherIncomeId: doc.id } });
    await prisma.otherIncome.delete({ where: { id: doc.id } });
  }, 30_000);

  it('allows POST when period is OPEN', async () => {
    // Arrange: ensure AccountingPeriod is OPEN for 2026-04
    await prisma.accountingPeriod.upsert({
      where: { companyId_year_month: { companyId: financeCompanyId, year: 2026, month: 4 } },
      update: { status: 'OPEN' },
      create: { companyId: financeCompanyId, year: 2026, month: 4, status: 'OPEN' },
    });
    const doc = await createDraftOtherIncome('2026-04-15');

    const result = await service.post(doc.id, {}, userId);
    expect(result.status).toBe('POSTED');
  }, 30_000);

  it('reverse() rejects when today\'s period is CLOSED (B1 — reverse path)', async () => {
    // Arrange: today's year/month (reverse() uses new Date(), not original issueDate)
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth() + 1;

    // Step 1: ensure today's period is OPEN so we can POST the doc first
    await prisma.accountingPeriod.upsert({
      where: {
        companyId_year_month: {
          companyId: financeCompanyId,
          year: todayYear,
          month: todayMonth,
        },
      },
      update: { status: 'OPEN' },
      create: {
        companyId: financeCompanyId,
        year: todayYear,
        month: todayMonth,
        status: 'OPEN',
      },
    });

    // Step 2: create + POST a fresh doc dated today (so doc.issueDate also falls in OPEN period)
    const issueDate = today.toISOString().slice(0, 10);
    const draft = await createDraftOtherIncome(issueDate);
    const posted = await service.post(draft.id, {}, userId);
    expect(posted.status).toBe('POSTED');

    // Step 3: flip today's period to CLOSED — now reverse() should reject
    await prisma.accountingPeriod.update({
      where: {
        companyId_year_month: {
          companyId: financeCompanyId,
          year: todayYear,
          month: todayMonth,
        },
      },
      data: { status: 'CLOSED' },
    });

    // Act + Assert: reverse() must fail because today's period is CLOSED
    await expect(
      service.reverse(posted.id, { reason: 'INPUT_ERROR', note: 'test' }, userId),
    ).rejects.toThrow(/งวดที่ปิดแล้ว/);
  }, 30_000);
});
