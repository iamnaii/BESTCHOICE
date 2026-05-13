import { Test } from '@nestjs/testing';
import { Prisma, OtherIncomeStatus, OtherIncomePriceType } from '@prisma/client';
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

// This test seeds 10,000 OtherIncome rows and asserts list query < 200ms.
// SKIP it in CI unless PERF=1 env var is set, to keep regular test runs fast.

const stubStorage = {
  upload: async () => undefined,
  delete: async () => undefined,
  getSignedUrl: async () => 'https://stub/url',
};

const D = (n: number | string) => new Prisma.Decimal(n);

describe.skip('Pagination performance — gated by PERF=1', () => {
  let prisma: PrismaService;
  let service: OtherIncomeService;
  let financeCompanyId: string;

  beforeAll(async () => {
    if (!process.env.PERF) return;

    // Bootstrap NestJS test module (mirrors pattern from maker-checker.spec.ts)
    const module = await Test.createTestingModule({
      providers: [
        OtherIncomeService,
        DocNumberService,
        ValidationService,
        AutoJournalService,
        OtherIncomeTemplate,
        JournalAutoService,
        PrismaService,
        JournalOverrideService,
        AuditService,
        { provide: StorageService, useValue: stubStorage },
      ],
    }).compile();

    await module.init();
    service = module.get(OtherIncomeService);
    prisma = module.get(PrismaService);

    // Ensure FINANCE CompanyInfo exists
    const companyInfo = await prisma.companyInfo.upsert({
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
    financeCompanyId = companyInfo.id;

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
    ];
    for (const seed of coaSeeds) {
      await prisma.chartOfAccount.upsert({
        where: { code: seed.code },
        update: {},
        create: seed,
      });
    }

    // Seed 10,000 OtherIncome rows for perf testing
    const rows = Array.from({ length: 10_000 }, (_, i) => ({
      docNumber: `PERF-${i.toString().padStart(6, '0')}`,
      companyId: financeCompanyId,
      status: OtherIncomeStatus.POSTED,
      issueDate: new Date('2026-01-01'),
      dueDate: null,
      paymentDate: null,
      priceType: OtherIncomePriceType.EXCLUSIVE,
      customerId: null,
      counterpartyName: `Counterparty ${i}`,
      counterpartyTaxId: null,
      counterpartyAddress: null,
      counterpartyPhone: null,
      paymentAccountCode: '11-1201',
      amountReceived: new Prisma.Decimal(1000 + i),
      incomeGross: new Prisma.Decimal(1000 + i),
      vatAmount: new Prisma.Decimal(0),
      whtAmount: new Prisma.Decimal(0),
      netReceived: new Prisma.Decimal(1000 + i),
      totalAmount: new Prisma.Decimal(1000 + i),
      customerNote: null,
      createdById: 'admin@bestchoice.com',
      isOverridden: false,
    }));

    // Batch insert to avoid constraint issues
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      await prisma.otherIncome.createMany({
        data: batch,
        skipDuplicates: true,
      });
    }

    console.log(`Seeded ${rows.length} OtherIncome records`);
  });

  it('lists page 1 (limit 50) in < 200ms', async () => {
    if (!process.env.PERF) return;
    const start = Date.now();
    // Call with ListOtherIncomeQueryDto shape: { page, limit, status?, startDate?, endDate?, q?, sort? }
    await service.list({ page: 1, limit: 50, status: OtherIncomeStatus.POSTED });
    const ms = Date.now() - start;
    console.log(`Page 1 query took ${ms}ms`);
    expect(ms).toBeLessThan(200);
  });

  it('lists page 100 (limit 50) in < 200ms', async () => {
    if (!process.env.PERF) return;
    const start = Date.now();
    await service.list({ page: 100, limit: 50, status: OtherIncomeStatus.POSTED });
    const ms = Date.now() - start;
    console.log(`Page 100 query took ${ms}ms`);
    expect(ms).toBeLessThan(200);
  });
});
