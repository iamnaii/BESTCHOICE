/**
 * PR-2: Maker-Checker integration tests for OtherIncomeService.
 * Uses real DB (matches pattern in other-income.service.spec.ts).
 */

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

const stubStorage = {
  upload: async () => undefined,
  delete: async () => undefined,
  getSignedUrl: async () => 'https://stub/url',
};

const D = (n: number | string) => new Prisma.Decimal(n);

// ============================================================
// Suite: Maker-Checker lifecycle (requestApproval / approve / reject)
// ============================================================

describe('OtherIncomeService — Maker-Checker', () => {
  let service: OtherIncomeService;
  let prisma: PrismaService;
  let makerId: string;
  let approverId: string;

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
      ],
    }).compile();
    await module.init();
    service = module.get(OtherIncomeService);
    prisma = module.get(PrismaService);

    // Ensure FINANCE CompanyInfo exists
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

    // Create test users: maker and approver
    const ts = Date.now();
    const maker = await prisma.user.create({
      data: {
        email: `oi-maker+${ts}@bestchoice.test`,
        password: 'x',
        name: 'OI Maker',
        role: 'ACCOUNTANT',
      },
    });
    makerId = maker.id;

    const approverUser = await prisma.user.create({
      data: {
        email: `oi-approver+${ts}@bestchoice.test`,
        password: 'x',
        name: 'OI Approver',
        role: 'FINANCE_MANAGER',
      },
    });
    approverId = approverUser.id;

    // Enable Maker-Checker flag in SystemConfig
    await prisma.systemConfig.upsert({
      where: { key: 'OTHER_INCOME_MAKER_CHECKER_ENABLED' },
      update: { value: 'true' },
      create: { key: 'OTHER_INCOME_MAKER_CHECKER_ENABLED', value: 'true' },
    });
  }, 30_000);

  afterAll(async () => {
    // Clean up test data
    const ois = await prisma.otherIncome.findMany({
      where: { createdById: makerId },
    });
    const ourIds = ois.map((o) => o.id);
    const jeIds = ois.filter((o) => o.journalEntryId).map((o) => o.journalEntryId as string);

    await prisma.otherIncomeItem.deleteMany({ where: { otherIncomeId: { in: ourIds } } });
    await prisma.otherIncomeAdjustment.deleteMany({ where: { otherIncomeId: { in: ourIds } } });
    await prisma.otherIncome.deleteMany({ where: { createdById: makerId } });

    if (jeIds.length > 0) {
      await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
    }

    await prisma.user.delete({ where: { id: makerId } }).catch(() => {});
    await prisma.user.delete({ where: { id: approverId } }).catch(() => {});

    // Restore Maker-Checker flag to false (avoid polluting other test suites)
    await prisma.systemConfig.upsert({
      where: { key: 'OTHER_INCOME_MAKER_CHECKER_ENABLED' },
      update: { value: 'false' },
      create: { key: 'OTHER_INCOME_MAKER_CHECKER_ENABLED', value: 'false' },
    });

    await prisma.$disconnect();
  }, 30_000);

  // Helper: create a standard KBank interest DRAFT
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
      makerId,
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Task 3: requestApproval()
  // ─────────────────────────────────────────────────────────────

  it('requestApproval(): DRAFT → READY when flag enabled', async () => {
    const draft = await createStandardDraft();
    expect(draft.status).toBe('DRAFT');

    const ready = await service.requestApproval(draft.id, makerId);

    expect(ready.status).toBe('READY');
    // Rejection metadata should be cleared
    expect(ready.rejectedById).toBeNull();
    expect(ready.rejectedAt).toBeNull();
    expect(ready.rejectNote).toBeNull();
  }, 30_000);

  it('requestApproval(): 400 when Maker-Checker flag disabled', async () => {
    // Temporarily disable the flag
    await prisma.systemConfig.update({
      where: { key: 'OTHER_INCOME_MAKER_CHECKER_ENABLED' },
      data: { value: 'false' },
    });

    const draft = await createStandardDraft();

    await expect(service.requestApproval(draft.id, makerId)).rejects.toMatchObject({
      message: 'Maker-Checker disabled — use POST directly',
    });

    // Re-enable for subsequent tests
    await prisma.systemConfig.update({
      where: { key: 'OTHER_INCOME_MAKER_CHECKER_ENABLED' },
      data: { value: 'true' },
    });
  }, 30_000);

  it('requestApproval(): 409 when doc not in DRAFT', async () => {
    const draft = await createStandardDraft();
    // Force doc to POSTED state
    await prisma.otherIncome.update({
      where: { id: draft.id },
      data: { status: 'POSTED', postedAt: new Date() },
    });

    await expect(service.requestApproval(draft.id, makerId)).rejects.toMatchObject({
      status: 409,
    });
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // Task 4: approve()
  // ─────────────────────────────────────────────────────────────

  it('approve(): READY → POSTED atomically with approver metadata + receipt', async () => {
    const draft = await createStandardDraft();
    const ready = await service.requestApproval(draft.id, makerId);
    expect(ready.status).toBe('READY');

    const posted = await service.approve(ready.id, { note: 'อนุมัติแล้ว' }, approverId);

    expect(posted.status).toBe('POSTED');
    expect(posted.approverId).toBe(approverId);
    expect(posted.approvedAt).toBeTruthy();
    expect(posted.approveNote).toBe('อนุมัติแล้ว');
    expect(posted.journalEntryId).toBeTruthy();
    expect(posted.receiptNo).toMatch(/^RC-\d{8}-\d{3}$/);
    expect(posted.postedAt).toBeTruthy();

    // Verify JE was created
    const je = await prisma.journalEntry.findUnique({
      where: { id: posted.journalEntryId! },
      include: { lines: true },
    });
    expect(je).toBeDefined();
    expect(je!.status).toBe('POSTED');
    // 3 lines: Dr cash, Dr WHT receivable, Cr income
    expect(je!.lines.length).toBe(3);
  }, 30_000);

  it('approve(): V9 rejects self-approval (maker === approver)', async () => {
    const draft = await createStandardDraft();
    await service.requestApproval(draft.id, makerId);

    await expect(service.approve(draft.id, {}, makerId)).rejects.toMatchObject({
      response: expect.objectContaining({
        errors: expect.arrayContaining([
          expect.objectContaining({ rule: 'V9' }),
        ]),
      }),
    });
  }, 30_000);

  it('approve(): 409 when doc not in READY', async () => {
    const draft = await createStandardDraft();
    // Doc is DRAFT, not READY

    await expect(service.approve(draft.id, {}, approverId)).rejects.toMatchObject({
      status: 409,
    });
  }, 30_000);

  it('approve(): 400 when Maker-Checker flag disabled', async () => {
    const draft = await createStandardDraft();
    await service.requestApproval(draft.id, makerId);

    await prisma.systemConfig.update({
      where: { key: 'OTHER_INCOME_MAKER_CHECKER_ENABLED' },
      data: { value: 'false' },
    });

    await expect(service.approve(draft.id, {}, approverId)).rejects.toMatchObject({
      message: 'Maker-Checker disabled',
    });

    // Re-enable
    await prisma.systemConfig.update({
      where: { key: 'OTHER_INCOME_MAKER_CHECKER_ENABLED' },
      data: { value: 'true' },
    });
  }, 30_000);

  // ─────────────────────────────────────────────────────────────
  // Task 5: reject()
  // ─────────────────────────────────────────────────────────────

  it('reject(): READY → DRAFT with rejection metadata', async () => {
    const draft = await createStandardDraft();
    await service.requestApproval(draft.id, makerId);

    const rejected = await service.reject(draft.id, { note: 'รายการผิดพลาด' }, approverId);

    expect(rejected.status).toBe('DRAFT');
    expect(rejected.rejectedById).toBe(approverId);
    expect(rejected.rejectedAt).toBeTruthy();
    expect(rejected.rejectNote).toBe('รายการผิดพลาด');
  }, 30_000);

  it('reject(): requires non-empty note', async () => {
    const draft = await createStandardDraft();
    await service.requestApproval(draft.id, makerId);

    await expect(service.reject(draft.id, { note: '' }, approverId)).rejects.toMatchObject({
      message: 'กรุณาระบุหมายเหตุการปฏิเสธ',
    });
  }, 30_000);

  it('reject(): 409 when doc not in READY', async () => {
    const draft = await createStandardDraft();
    // Doc is DRAFT, not READY

    await expect(service.reject(draft.id, { note: 'หมายเหตุ' }, approverId)).rejects.toMatchObject({
      status: 409,
    });
  }, 30_000);

  it('reject(): 400 when Maker-Checker flag disabled', async () => {
    const draft = await createStandardDraft();
    await service.requestApproval(draft.id, makerId);

    await prisma.systemConfig.update({
      where: { key: 'OTHER_INCOME_MAKER_CHECKER_ENABLED' },
      data: { value: 'false' },
    });

    await expect(
      service.reject(draft.id, { note: 'ปฏิเสธ' }, approverId),
    ).rejects.toMatchObject({ message: 'Maker-Checker disabled' });

    // Re-enable
    await prisma.systemConfig.update({
      where: { key: 'OTHER_INCOME_MAKER_CHECKER_ENABLED' },
      data: { value: 'true' },
    });
  }, 30_000);

  it('reject() → requestApproval(): re-submission clears prior rejection metadata', async () => {
    const draft = await createStandardDraft();
    await service.requestApproval(draft.id, makerId);
    // Reject it first
    await service.reject(draft.id, { note: 'แก้ไขก่อน' }, approverId);

    // Verify rejection metadata is set
    const afterReject = await prisma.otherIncome.findUnique({ where: { id: draft.id } });
    expect(afterReject?.rejectNote).toBe('แก้ไขก่อน');

    // Re-submit for approval — should clear rejection metadata
    const resubmitted = await service.requestApproval(draft.id, makerId);
    expect(resubmitted.status).toBe('READY');
    expect(resubmitted.rejectedAt).toBeNull();
    expect(resubmitted.rejectedById).toBeNull();
    expect(resubmitted.rejectNote).toBeNull();
  }, 30_000);

  it('approve(): concurrent CAS-claim — only one approval wins on a single READY doc', async () => {
    // Regression for review feedback (TOCTOU race in approve()):
    // Two simultaneous approve() calls must not both succeed.
    const draft = await createStandardDraft();
    await service.requestApproval(draft.id, makerId);

    const [resA, resB] = await Promise.allSettled([
      service.approve(draft.id, { note: 'A' }, approverId),
      service.approve(draft.id, { note: 'B' }, approverId),
    ]);

    const fulfilled = [resA, resB].filter((r) => r.status === 'fulfilled');
    const rejected = [resA, resB].filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Loser must hit the CAS error, not pass silently
    const err = (rejected[0] as PromiseRejectedResult).reason;
    const msg = err?.message ?? err?.response?.message ?? '';
    expect(msg).toMatch(/ผู้อื่น|สถานะ/);

    // Doc lands in POSTED with exactly one journalEntryId
    const final = await prisma.otherIncome.findUnique({ where: { id: draft.id } });
    expect(final?.status).toBe('POSTED');
    expect(final?.journalEntryId).toBeTruthy();
  }, 30_000);
});
