import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { OtherIncomeService } from '../other-income.service';
import { DocNumberService } from '../services/doc-number.service';
import { ValidationService } from '../services/validation.service';
import { AutoJournalService } from '../services/auto-journal.service';
import { OtherIncomeTemplate } from '../templates/other-income.template';

const D = (n: number | string) => new Prisma.Decimal(n);

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
