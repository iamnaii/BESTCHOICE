import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { TemplateService } from '../services/template.service';

// ============================================================
// Real-DB integration tests against bestchoice_oi_test
// ============================================================

describe('TemplateService — integration', () => {
  let service: TemplateService;
  let prisma: PrismaService;
  let userId: string;
  let companyId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [TemplateService, PrismaService],
    }).compile();
    await module.init();
    service = module.get(TemplateService);
    prisma = module.get(PrismaService);

    // Ensure FINANCE CompanyInfo exists
    const co = await prisma.companyInfo.upsert({
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
    companyId = co.id;

    // Create a unique test user
    const user = await prisma.user.create({
      data: {
        email: `tpl-test+${Date.now()}@bestchoice.test`,
        password: 'x',
        name: 'Tpl Tester',
        role: 'ACCOUNTANT',
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.otherIncomeTemplate.deleteMany({ where: { createdById: userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  const baseItems = [
    {
      lineNo: 1,
      accountCode: '42-1102',
      description: 'ดอกเบี้ยฝาก {เดือนปี}',
      quantity: 1,
      unitAmount: 1000,
      discountAmount: 0,
      vatPct: 0,
      whtPct: 15,
    },
  ];

  it('1. create() creates template', async () => {
    const tpl = await service.create(
      { name: 'ดอกเบี้ยธนาคาร', itemsJson: baseItems, priceType: 'EXCLUSIVE' },
      userId,
    );
    expect(tpl.id).toBeDefined();
    expect(tpl.name).toBe('ดอกเบี้ยธนาคาร');
    expect(tpl.priceType).toBe('EXCLUSIVE');
    expect(tpl.useCount).toBe(0);
    expect(tpl.isFavorite).toBe(false);
  });

  it('2. list() shows newly created', async () => {
    // Create a distinctly named template
    await service.create(
      { name: 'รายได้อื่น-test-list', itemsJson: baseItems, priceType: 'EXCLUSIVE' },
      userId,
    );
    const list = await service.list({});
    const found = list.find((t) => t.name === 'รายได้อื่น-test-list');
    expect(found).toBeDefined();
  });

  it('3. soft-deleted template excluded from list', async () => {
    const tpl = await service.create(
      { name: 'to-delete-template', itemsJson: baseItems, priceType: 'EXCLUSIVE' },
      userId,
    );
    await service.softDelete(tpl.id);
    const list = await service.list({});
    const found = list.find((t) => t.id === tpl.id);
    expect(found).toBeUndefined();
  });

  it('4. list sorted favorites-first then lastUsedAt desc', async () => {
    // Create a non-favorite then a favorite
    const normal = await service.create(
      { name: 'normal-sort-test', itemsJson: baseItems, priceType: 'EXCLUSIVE' },
      userId,
    );
    const fav = await service.create(
      { name: 'fav-sort-test', itemsJson: baseItems, priceType: 'EXCLUSIVE' },
      userId,
    );
    await service.update(fav.id, { isFavorite: true });

    const list = await service.list({});
    const favIdx = list.findIndex((t) => t.id === fav.id);
    const normIdx = list.findIndex((t) => t.id === normal.id);
    expect(favIdx).toBeLessThan(normIdx);
  });

  it('5. use() increments useCount + sets lastUsedAt', async () => {
    const tpl = await service.create(
      { name: 'use-count-test', itemsJson: baseItems, priceType: 'EXCLUSIVE' },
      userId,
    );
    expect(tpl.useCount).toBe(0);

    const now = new Date('2026-05-12T10:00:00Z');
    await service.use(tpl.id, now);

    const updated = await prisma.otherIncomeTemplate.findUnique({ where: { id: tpl.id } });
    expect(updated?.useCount).toBe(1);
    expect(updated?.lastUsedAt).not.toBeNull();
  });

  it('6. use() applies variable replacement on item.description', async () => {
    const tpl = await service.create(
      {
        name: 'var-replace-test',
        itemsJson: [{ ...baseItems[0], description: 'รายได้ {เดือน} {ปี}' }],
        priceType: 'EXCLUSIVE',
      },
      userId,
    );

    // 2026-05-12 BKK → เดือน = พ.ค., ปี = 2569
    const fixedDate = new Date('2026-05-12T03:00:00Z'); // 10:00 BKK
    const result = await service.use(tpl.id, fixedDate);

    expect(result.items[0].description).toContain('พ.ค.');
    expect(result.items[0].description).toContain('2569');
  });

  it('7. createFromDoc() snapshots all item fields', async () => {
    // Create a real OtherIncome doc first via prisma direct insert
    const co = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE', deletedAt: null } });
    expect(co).not.toBeNull();

    const doc = await prisma.otherIncome.create({
      data: {
        docNumber: `OI-TEST-${Date.now()}`,
        companyId: co!.id,
        createdById: userId,
        issueDate: new Date('2026-05-06'),
        priceType: 'EXCLUSIVE',
        paymentAccountCode: '11-1201',
        amountReceived: new (require('@prisma/client').Prisma.Decimal)(850),
        incomeGross: new (require('@prisma/client').Prisma.Decimal)(1000),
        vatAmount: new (require('@prisma/client').Prisma.Decimal)(0),
        whtAmount: new (require('@prisma/client').Prisma.Decimal)(150),
        netReceived: new (require('@prisma/client').Prisma.Decimal)(850),
        items: {
          create: [
            {
              lineNo: 1,
              accountCode: '42-1102',
              accountName: 'รายได้ดอกเบี้ยฝากธนาคาร',
              description: 'ดอกเบี้ย พ.ค.',
              quantity: new (require('@prisma/client').Prisma.Decimal)(1),
              unitAmount: new (require('@prisma/client').Prisma.Decimal)(1000),
              discountAmount: new (require('@prisma/client').Prisma.Decimal)(0),
              vatPct: new (require('@prisma/client').Prisma.Decimal)(0),
              whtPct: new (require('@prisma/client').Prisma.Decimal)(15),
              amountBeforeVat: new (require('@prisma/client').Prisma.Decimal)(1000),
              vatAmount: new (require('@prisma/client').Prisma.Decimal)(0),
              whtAmount: new (require('@prisma/client').Prisma.Decimal)(150),
            },
          ],
        },
      },
    });

    const tpl = await service.createFromDoc(doc.id, 'snapshot-from-doc', userId);

    expect(tpl.name).toBe('snapshot-from-doc');
    const items = tpl.itemsJson as any[];
    expect(items).toHaveLength(1);
    expect(items[0].accountCode).toBe('42-1102');
    expect(items[0].description).toBe('ดอกเบี้ย พ.ค.');
    expect(items[0].whtPct).toBe(15);

    // cleanup
    await prisma.otherIncomeItem.deleteMany({ where: { otherIncomeId: doc.id } });
    await prisma.otherIncome.delete({ where: { id: doc.id } });
  });
});
