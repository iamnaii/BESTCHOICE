import { STOCK_SORT_KEYS, computeDefaultBcInstallment } from '@installment/shared';
import { resolveBcConfig } from '../src/modules/interest-config/resolve-bc-config';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProductsController } from '../src/modules/products/products.controller';
import { ProductsService } from '../src/modules/products/products.service';
import { ProductsPricingService } from '../src/modules/products/products-pricing.service';
import { ProductsStockService } from '../src/modules/products/products-stock.service';
import { ProductsOnlineListingService } from '../src/modules/products/products-online-listing.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';

if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) {
  throw new Error('Run tools/test-chat-credit.sh with its disposable database');
}

describe('Stock accessory groups on isolated PostgreSQL', () => {
  const db = new PrismaService();
  let app: INestApplication;
  let branchA: string;
  let branchB: string;
  let otherBranchGroupKey: string;
  let groupRepresentativeId: string;
  let groupId: string;
  let legacySerial: string;
  let actor: { role: string; branchId: string | null };
  const name = `TEST-STOCK-${randomUUID()}`;
  const read = (query: Record<string, string | number> = {}) =>
    request(app.getHttpServer())
      .get('/products')
      .query({ groupAccessories: 'true', search: name, ...query });

  beforeAll(async () => {
    await db.$connect();
    branchA = (await db.branch.create({ data: { name: `${name} A` } })).id;
    branchB = (await db.branch.create({ data: { name: `${name} B` } })).id;
    actor = { role: 'OWNER', branchId: null };
    const base = {
      name,
      model: 'iPhone 16',
      brand: 'TEST',
      category: 'ACCESSORY' as const,
      accessoryType: 'TEST-CASE-16',
      accessoryBrand: 'TEST',
      color: 'Black',
      branchId: branchA,
      costPrice: '110',
      cashPrice: '280',
    };
    for (let index = 0; index < 55; index++) {
      const unit = await db.product.create({
        data: {
          ...base,
          legacyProductCode: `${name}-${index}`,
          imeiSerial: `${name}-serial-${index}-end`,
          costPrice: index === 0 ? '100' : index === 1 ? '120' : '110',
          cashPrice:
            index === 0 ? '250' : index === 1 ? '300' : index === 2 || index === 3 ? null : '280',
          status: index === 53 ? 'RESERVED' : index === 54 ? 'SOLD_CASH' : 'IN_STOCK',
        },
      });
      if (index === 3) {
        legacySerial = unit.imeiSerial!;
        await db.productPrice.createMany({
          data: [
            { productId: unit.id, label: 'ราคาเงินสด', amount: '900', deletedAt: new Date() },
            { productId: unit.id, label: 'ราคาเงินสด พิเศษ', amount: '260' },
            { productId: unit.id, label: 'ราคาเงินสด', amount: '270' },
          ],
        });
      }
    }
    await db.product.create({ data: { ...base, color: 'Pink' } });
    await db.product.create({ data: { ...base, branchId: branchB } });
    await db.product.create({
      data: { ...base, name: `${name} screen protector`, accessoryType: 'TEST-FILM-16' },
    });
    await db.product.create({ data: { ...base, deletedAt: new Date() } });
    await db.product.createMany({
      data: [0, 1].map((index) => ({
        ...base,
        name: `${name} phone`,
        category: 'PHONE_NEW' as const,
        imeiSerial: `${name}-phone-${index}`,
      })),
    });
    const module = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: db },
        { provide: ProductsPricingService, useValue: {} },
        { provide: ProductsStockService, useValue: {} },
        { provide: ProductsOnlineListingService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: { switchToHttp(): { getRequest(): { user: unknown } } }) => {
          context.switchToHttp().getRequest().user = actor;
          return true;
        },
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
  });

  it('aggregates every unit before pagination, with separate colours, branches and product types', async () => {
    const response = await read().expect(200);
    expect(response.body.total).toBe(6);
    const group = response.body.data.find(
      (row: { stockGroup?: { unitCount: number } }) => row.stockGroup?.unitCount === 55,
    );
    groupId = group.stockGroup.key;
    groupRepresentativeId = group.id;
    otherBranchGroupKey = response.body.data.find(
      (row: { branchId: string }) => row.branchId === branchB,
    ).stockGroup.key;
    expect(group).toMatchObject({
      cashPrice: '250',
      costPrice: '100',
      legacyProductCode: null,
      imeiSerial: null,
      stockGroup: {
        unitCount: 55,
        inStockQuantity: 53,
        cashPriceMax: '300',
        costPriceMax: '120',
        cashPriceMissingCount: 1,
        statuses: ['IN_STOCK', 'RESERVED', 'SOLD_CASH'],
      },
    });
    expect(
      response.body.data.filter((row: { category: string }) => row.category === 'PHONE_NEW'),
    ).toHaveLength(2);
    const pages = await Promise.all(
      Array.from({ length: 6 }, (_, index) => read({ page: index + 1, limit: 1 }).expect(200)),
    );
    expect(new Set(pages.map((page) => page.body.data[0].id)).size).toBe(6);
    expect(pages.every((page) => page.body.total === 6 && page.body.totalPages === 6)).toBe(true);
    const empty = await read({ page: 7, limit: 1 }).expect(200);
    expect(empty.body).toMatchObject({ total: 6, data: [] });
  });

  it('drills into the exact SKU and branch, retaining status filters and unit pagination', async () => {
    const units = await read({
      groupAccessories: 'false',
      accessoryGroupId: groupId,
      limit: 10,
    }).expect(200);
    expect(units.body.total).toBe(55);
    expect(units.body.data).toHaveLength(10);
    expect(
      units.body.data.every(
        (row: { branchId: string; color: string; stockGroup?: unknown }) =>
          row.branchId === branchA && row.color === 'Black' && !row.stockGroup,
      ),
    ).toBe(true);
    const available = await read({
      groupAccessories: 'false',
      accessoryGroupId: groupId,
      status: 'IN_STOCK',
    }).expect(200);
    expect(available.body.total).toBe(53);
    const reserved = await read({ status: 'RESERVED' }).expect(200);
    expect(reserved.body.data[0].stockGroup).toMatchObject({
      unitCount: 1,
      inStockQuantity: 0,
      statuses: ['RESERVED'],
    });
  });

  it('uses live legacy cash prices and searches product codes and serials', async () => {
    const legacy = await read({ search: legacySerial }).expect(200);
    expect(legacy.body.data[0]).toMatchObject({
      cashPrice: '270',
      stockGroup: { cashPriceMax: '270', cashPriceMissingCount: 0 },
    });
    const code = await read({ search: `${name}-0` }).expect(200);
    expect(code.body.data[0].stockGroup.unitCount).toBe(1);
    const literal = await read({ search: `${name}%` }).expect(200);
    expect(literal.body.total).toBe(0);
  });

  it('scopes grouped reads and drill-down to the staff branch and redacts all cost figures', async () => {
    actor = { role: 'SALES', branchId: branchA };
    const response = await read().expect(200);
    expect(response.body.data.every((row: { branchId: string }) => row.branchId === branchA)).toBe(
      true,
    );
    for (const row of response.body.data) {
      expect(row.costPrice).toBeUndefined();
      if (row.stockGroup) expect(row.stockGroup.costPriceMax).toBeNull();
    }
    await read({ branchId: branchB }).expect(403);
    await read({ accessoryGroupId: otherBranchGroupKey }).expect(404);
    actor = { role: 'SALES', branchId: null };
    await read().expect(403);
    actor = { role: 'OWNER', branchId: null };
  });

  it('retains the original group when its representative unit moves branch', async () => {
    await db.product.update({ where: { id: groupRepresentativeId }, data: { branchId: branchB } });
    try {
      const original = await read({ accessoryGroupId: groupId }).expect(200);
      expect(original.body.total).toBe(54);
      expect(
        original.body.data.every((row: { branchId: string }) => row.branchId === branchA),
      ).toBe(true);
    } finally {
      await db.product.update({
        where: { id: groupRepresentativeId },
        data: { branchId: branchA },
      });
    }
  });

  it('rejects invalid grouping input', async () => {
    await read({ groupAccessories: 'invalid' }).expect(400);
    await read({ accessoryGroupId: 'invalid' }).expect(400);
  });

  it('sorts aggregate quantity and starting prices before pagination and validates every sortable column', async () => {
    const first = await read({ sortBy: 'quantity', sortDirection: 'desc', limit: 1 }).expect(200);
    expect(first.body.data[0].stockGroup.inStockQuantity).toBe(53);
    const cheapest = await read({ sortBy: 'cashPrice', sortDirection: 'asc', limit: 1 }).expect(
      200,
    );
    expect(cheapest.body.data[0].cashPrice).toBe('250');
    const pages = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        read({ sortBy: 'cashPrice', sortDirection: 'desc', page: index + 1, limit: 1 }).expect(200),
      ),
    );
    expect(new Set(pages.map((page) => page.body.data[0].id)).size).toBe(6);
    expect(pages.map((page) => page.body.data[0].cashPrice)).toEqual([
      '280',
      '280',
      '280',
      '280',
      '280',
      '250',
    ]);
    for (const sortBy of STOCK_SORT_KEYS) {
      await read({ sortBy, sortDirection: 'asc', limit: 1 }).expect(200);
    }
    const units = await read({
      accessoryGroupId: groupId,
      sortBy: 'cashPrice',
      sortDirection: 'desc',
      limit: 1,
    }).expect(200);
    expect(units.body.data[0].cashPrice).toBe('300');
    expect(units.body.data[0].stockGroup).toBeNull();
    expect(units.body.total).toBe(55);
    await read({ sortBy: 'name; DROP TABLE products' }).expect(400);
    await read({ sortDirection: 'wrong' }).expect(400);
    actor = { role: 'SALES', branchId: branchA };
    try {
      const defaultPhones = await read({ category: 'PHONE_NEW' }).expect(200);
      const sortedPhones = await read({ category: 'PHONE_NEW', sortBy: 'name' }).expect(200);
      expect(sortedPhones.body.total).toBe(defaultPhones.body.total);
      expect(sortedPhones.body.data.map((row: { id: string }) => row.id).sort()).toEqual(
        defaultPhones.body.data.map((row: { id: string }) => row.id).sort(),
      );
      await read({ sortBy: 'costPrice' }).expect(403);
      const scoped = await read({ sortBy: 'name' }).expect(200);
      expect(scoped.body.data.every((row: { branchId: string }) => row.branchId === branchA)).toBe(
        true,
      );
    } finally {
      actor = { role: 'OWNER', branchId: null };
    }
  });

  it('sorts actual stock entry dates before pagination for all device tabs with missing dates last', async () => {
    const dateName = `TEST-STOCK-DATE-${randomUUID()}`;
    const dates = [new Date('2026-08-20T17:30:00Z'), new Date('2026-08-01T03:00:00Z'), null];
    for (const category of ['PHONE_NEW', 'PHONE_USED', 'TABLET'] as const) {
      const units: { id: string }[] = [];
      for (const [index, stockInDate] of dates.entries()) {
        units.push(
          await db.product.create({
            data: {
              name: dateName,
              model: `Device ${index}`,
              brand: 'TEST',
              category,
              branchId: branchA,
              costPrice: '100',
              status: 'IN_STOCK',
              stockInDate,
              // Record creation order must not replace stock entry order or fill a missing date.
              createdAt: new Date(`2020-01-0${index + 1}T00:00:00Z`),
            },
          }),
        );
      }
      for (const sortDirection of ['asc', 'desc']) {
        const pages = await Promise.all(
          [1, 2, 3].map((page) =>
            read({
              search: dateName,
              category,
              sortBy: 'stockInDate',
              sortDirection,
              limit: 1,
              page,
            }).expect(200),
          ),
        );
        expect(pages.map((response) => response.body.data[0].id)).toEqual(
          (sortDirection === 'asc'
            ? [units[1], units[0], units[2]]
            : [units[0], units[1], units[2]]
          ).map((unit) => unit.id),
        );
        expect(pages.every((response) => response.body.total === 3)).toBe(true);
        expect(pages[2].body.data[0].stockInDate).toBeNull();
      }
    }
  });

  it('orders natural model names, numeric capacities, missing prices and category-specific monthly quotes', async () => {
    const sortName = `TEST-SORT-${randomUUID()}`;
    const base = {
      name: sortName,
      brand: 'TEST',
      branchId: branchA,
      costPrice: '100',
      status: 'IN_STOCK' as const,
    };
    const deviceConfig = await db.interestConfig.create({
      data: {
        name: sortName,
        productCategories: ['PHONE_NEW'],
        interestRate: '0.01',
        minDownPaymentPct: '0.20',
        minInstallmentMonths: 12,
        maxInstallmentMonths: 12,
        createdAt: new Date('1900-01-01'),
        rates: { create: [{ months: 12, ratePct: '0.20' }] },
      },
    });
    const tabletConfig = await db.interestConfig.create({
      data: {
        name: sortName,
        productCategories: ['TABLET'],
        interestRate: '0.01',
        minDownPaymentPct: '0.10',
        minInstallmentMonths: 6,
        maxInstallmentMonths: 6,
        createdAt: new Date('1900-01-01'),
        rates: { create: [{ months: 6, ratePct: '0.40' }] },
      },
    });
    try {
      const definitions = [
        {
          model: 'Device 10',
          category: 'PHONE_NEW' as const,
          storage: '128GB',
          cashPrice: '1000',
          installmentPrice: '10000',
        },
        {
          model: 'Device 2',
          category: 'TABLET' as const,
          storage: '1TB',
          cashPrice: '900',
          installmentPrice: '8000',
        },
        {
          model: 'Device 3',
          category: 'PHONE_NEW' as const,
          storage: '512GB',
          cashPrice: null,
          installmentPrice: null,
        },
      ];
      for (const definition of definitions)
        await db.product.create({ data: { ...base, ...definition } });
      const sorted = async (sortBy: string, sortDirection = 'asc') =>
        (
          await read({ search: sortName, groupAccessories: 'false', sortBy, sortDirection }).expect(
            200,
          )
        ).body.data;
      expect((await sorted('name')).map((row: { model: string }) => row.model)).toEqual([
        'Device 2',
        'Device 3',
        'Device 10',
      ]);
      expect((await sorted('storage')).map((row: { storage: string }) => row.storage)).toEqual([
        '128GB',
        '512GB',
        '1TB',
      ]);
      expect(
        (await sorted('cashPrice')).map((row: { cashPrice: string | null }) => row.cashPrice),
      ).toEqual(['900', '1000', null]);
      expect(
        (await sorted('cashPrice', 'desc')).map(
          (row: { cashPrice: string | null }) => row.cashPrice,
        ),
      ).toEqual(['1000', '900', null]);
      const phoneQuote = computeDefaultBcInstallment(
        10000,
        await resolveBcConfig(db, 'PHONE_NEW'),
      )!;
      const tabletQuote = computeDefaultBcInstallment(8000, await resolveBcConfig(db, 'TABLET'))!;
      expect(phoneQuote.monthlyPayment).toBeLessThan(tabletQuote.monthlyPayment);
      expect((await sorted('monthlyPayment')).map((row: { model: string }) => row.model)).toEqual([
        'Device 10',
        'Device 2',
        'Device 3',
      ]);
      expect((await sorted('downPayment')).map((row: { model: string }) => row.model)).toEqual([
        'Device 2',
        'Device 10',
        'Device 3',
      ]);
    } finally {
      await db.interestConfig.updateMany({
        where: { id: { in: [deviceConfig.id, tabletConfig.id] } },
        data: { deletedAt: new Date() },
      });
    }
  });

  it('uses the same deterministic legacy prefix price for sorting and the returned price rows', async () => {
    const legacyName = `TEST-LEGACY-SORT-${randomUUID()}`;
    const unit = await db.product.create({
      data: {
        name: legacyName,
        model: 'Legacy device',
        brand: 'TEST',
        category: 'PHONE_NEW',
        branchId: branchA,
        costPrice: '10',
      },
    });
    const ids = [randomUUID(), randomUUID()].sort();
    const timestamp = new Date('2026-01-01');
    await db.productPrice.createMany({
      data: [
        {
          id: ids[1],
          productId: unit.id,
          label: 'ราคาเงินสด B',
          amount: '900',
          createdAt: timestamp,
        },
        {
          id: ids[0],
          productId: unit.id,
          label: 'ราคาเงินสด A',
          amount: '100',
          createdAt: timestamp,
        },
      ],
    });
    const grouped = await read({ search: legacyName, sortBy: 'cashPrice' }).expect(200);
    expect(grouped.body.data[0].prices.map((row: { id: string }) => row.id)).toEqual(ids);
    const other = await db.product.create({
      data: {
        name: legacyName,
        model: 'Other device',
        brand: 'TEST',
        category: 'PHONE_NEW',
        branchId: branchA,
        costPrice: '10',
        cashPrice: '500',
      },
    });
    const sorted = await read({ search: legacyName, sortBy: 'cashPrice' }).expect(200);
    expect(sorted.body.data.map((row: { id: string }) => row.id)).toEqual([unit.id, other.id]);
  });
});
