import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { hashImportValue, receiptDigest } from '../../../cli/tooltify-cutover/canonicalize';
import type { PrismaService } from '../../../prisma/prisma.service';
import { AccessResourceService } from '../../employee-access/access-resource.service';
import { AccessSnapshotService } from '../../employee-access/access-snapshot.service';
import { QueryImportedSalesDto } from '../dto/query-imported-sales.dto';
import { ImportedSalesService } from '../imported-sales.service';

const url = process.env.DATABASE_URL ?? '';
if (
  !/^postgresql:\/\/vitest@localhost:\d+\/bc_vitest_test\?host=\/tmp\/bc-vitest-db\.[^/]+\/socket&schema=public$/.test(
    url,
  )
) {
  throw new Error('Use tools/test-db-vitest.sh with an isolated PostgreSQL database');
}
const db = new PrismaClient({ datasources: { db: { url } } });
const prisma = db as unknown as PrismaService;
const service = new ImportedSalesService(prisma);
const resources = new AccessResourceService(prisma, new AccessSnapshotService(prisma));
const imei = '012345678901234';
const midnight = new Date('2026-11-01T00:00:00+07:00');
const october = new Date('2026-10-31T23:59:59.999+07:00');
const legacyBatch = randomUUID();
const firstId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
let reader: string;
let denied: string;
let trustedIds: string[];
let octoberId: string;
let unknownId: string;

function sale(data: Partial<Prisma.ImportedSaleCreateManyInput> = {}) {
  return {
    id: randomUUID(),
    source: 'TOOLTIFY',
    barcode: imei,
    orderNumber: 'NO-BILL',
    soldAt: midnight,
    productName: 'Fixture phone',
    buyerLabel: 'Fixture buyer',
    shopLabel: 'Counterparty A',
    category: 'Phone',
    saleChannel: 'CASH',
    paymentType: 'CASH',
    priceGroup: 'Retail',
    salespersonName: 'Fixture seller',
    salePrice: '100.00',
    listPrice: '100.00',
    costTotal: '70.01',
    profit: '29.99',
    importBatch: legacyBatch,
    ...data,
  };
}

async function user(permission: 'imported-sales.read' | 'shop-tenders.read') {
  const { id: userId } = await db.user.create({
    data: {
      name: 'History test actor',
      email: randomUUID() + '@test.invalid',
      password: 'unused',
      role: 'ACCOUNTANT',
      accessManaged: true,
    },
  });
  const { id: positionId } = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'History test position', permissions: [permission] },
  });
  await db.employeeAccessAssignment.create({
    data: { userId, positionId, companyCode: 'SHOP', scope: 'COMPANY' },
  });
  return userId;
}

async function ownedBatch(
  storeKey: string,
  branchId: string,
  creates: ReturnType<typeof sale>[],
  matches: ReturnType<typeof sale>[] = [],
) {
  const batchId = randomUUID();
  const fileSha256 = hashImportValue(storeKey);
  const items = [...creates, ...matches].map((s, index) => ({
    batchId,
    sourceKey: hashImportValue([storeKey, s.id]),
    disposition: index < creates.length ? ('CREATE' as const) : ('MATCH' as const),
    targetType: 'IMPORTED_SALE' as const,
    targetId: s.id,
    identityHash: hashImportValue(['TOOLTIFY', s.barcode, s.orderNumber, s.soldAt]),
    payloadHash: hashImportValue(s),
    dependencyFingerprint: hashImportValue(null),
    afterFingerprint: hashImportValue(s),
    sourceRefs: [{ fileSha256, sheet: 'Synthetic sales', row: index + 1, storeKey }],
  }));
  await db.$transaction([
    db.tooltifyImportBatch.create({
      data: {
        id: batchId,
        canonicalSetId: randomUUID(),
        kind: 'SALES',
        manifestHash: fileSha256,
        planHash: hashImportValue(items),
        reconciliationSnapshot: {
          files: [{ fileSha256, branchId }],
          expectedReceiptsHash: receiptDigest(items),
        },
        sourceCutoverAt: midnight,
        status: 'APPLIED',
        codeRevision: 'synthetic-fixture',
      },
    }),
    db.importedSale.createMany({ data: creates.map((s) => ({ ...s, importBatch: batchId })) }),
    db.tooltifyImportItem.createMany({ data: items }),
  ]);
}

async function query(input: Record<string, string> = {}) {
  const dto = plainToInstance(QueryImportedSalesDto, input);
  expect(await validate(dto, { whitelist: true })).toEqual([]);
  return dto;
}

async function read<T>(handler: () => Promise<T>) {
  return (
    await resources.execute(reader, 'imported-sales.read', 'SHOP', undefined, handler, false, {
      isolationLevel: 'Serializable',
    })
  ).result;
}

beforeAll(async () => {
  reader = await user('imported-sales.read');
  denied = await user('shop-tenders.read');
  const cash = [
    sale({ id: firstId, orderNumber: 'NOV-A' }),
    sale({ id: secondId, orderNumber: 'NOV-B' }),
    sale({ soldAt: october, orderNumber: 'OCT-A' }),
  ];
  octoberId = cash[2].id;
  const rows = [
    ...cash,
    sale({ orderNumber: 'NOV-CREDIT', saleChannel: 'INSTALLMENT' }),
    sale({ barcode: imei + '5', orderNumber: 'NOV-OTHER' }),
    sale({ barcode: '1357', orderNumber: 'QUERY_40%-ALPHA' }),
    sale({ barcode: '1358', orderNumber: 'QUERYX40Z-ALPHA' }),
    sale({ barcode: '1359', orderNumber: 'SHARED-213', shopLabel: 'Counterparty A' }),
    sale({
      barcode: '1360',
      orderNumber: 'SHARED-213',
      shopLabel: 'Counterparty B',
      importBatch: randomUUID(),
    }),
  ];
  const unknown = sale({ source: 'UNKNOWN', orderNumber: 'NOV-UNKNOWN' });
  unknownId = unknown.id;
  await db.importedSale.createMany({ data: [...rows, unknown] });
  const shop = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const branchA = await db.branch.create({
    data: { companyId: shop.id, name: 'Fixture branch A' },
  });
  const branchB = await db.branch.create({
    data: { companyId: shop.id, name: 'Fixture branch B' },
  });
  const fromA = [
    sale({ barcode: '1361', orderNumber: 'SHARED-213', shopLabel: 'Counterparty A' }),
    sale({ barcode: '1362', orderNumber: 'SHARED-213', shopLabel: 'Counterparty B' }),
  ];
  const fromB = sale({ barcode: '1363', orderNumber: 'SHARED-213', shopLabel: 'Counterparty A' });
  // Isolated history with distinct legacy row keys and later MATCH references. The live import
  // planner may reject ambiguous cross-store collisions even though the schema can retain them.
  await ownedBatch('store-a', branchA.id, fromA);
  await ownedBatch('store-b', branchB.id, [fromB], fromA);
  trustedIds = [...rows, ...fromA, fromB].map((row) => row.id);
});

afterAll(() => db.$disconnect());

it('keeps the same exact IMEI across multiple bills and sale times', async () => {
  const dto = await query({ barcode: ` ${imei} ` });
  const result = await read(() => service.list(dto));
  expect(result.total).toBe(4);
  expect(result.data.map((r) => r.orderNumber).sort()).toEqual([
    'NOV-A',
    'NOV-B',
    'NOV-CREDIT',
    'OCT-A',
  ]);
  expect((await read(() => service.summary(dto))).totals).toMatchObject({
    billCount: 4,
    lineCount: 4,
    count: 4,
  });
});

it('matches a literal substring of the bill number', async () => {
  const dto = await query({ orderNumber: '  Y_40%  ' });
  const result = await read(() => service.list(dto));
  expect(result.data.map((r) => r.orderNumber)).toEqual(['QUERY_40%-ALPHA']);
  expect((await read(() => service.summary(dto))).totals).toMatchObject({
    billCount: 1,
    lineCount: 1,
    count: 1,
  });
});

it('counts a shared bill number once per original store and once for legacy lines', async () => {
  const dto = await query({ orderNumber: 'SHARED-213', page: '2', limit: '1' });
  const result = await read(() => service.list(dto));
  expect(result).toMatchObject({ total: 5, page: 2, limit: 1 });
  expect(result.data).toHaveLength(1);
  expect((await read(() => service.summary(dto))).totals).toMatchObject({
    billCount: 3,
    lineCount: 5,
    count: 5,
    sales: '500',
  });
});

it('uses the same Bangkok date, IMEI and channel filters for both endpoints', async () => {
  const dto = await query({
    startDate: '2026-11-01',
    endDate: '2026-11-01',
    barcode: imei,
    saleChannel: 'CASH',
    limit: '1',
  });
  const firstPage = await read(() => service.list(dto));
  expect(firstPage).toMatchObject({ total: 2, page: 1, limit: 1 });
  expect(firstPage.data.map((r) => r.id)).toEqual([secondId]);
  const secondPage = await read(() => service.list({ ...dto, page: 2 }));
  expect(secondPage.data.map((r) => r.id)).toEqual([firstId]);
  expect((await read(() => service.list({ ...dto, page: 3 }))).data).toEqual([]);
  const summary = await read(() => service.summary(dto));
  expect(summary.totals).toMatchObject({ billCount: 2, lineCount: 2, count: 2, sales: '200' });
  expect(summary.byMonth).toEqual([{ key: '2026-11', count: 2, sales: '200', profit: null }]);
  const priorMonth = await query({ endDate: '2026-10-31', barcode: imei });
  expect((await read(() => service.list(priorMonth))).data.map((r) => r.id)).toEqual([octoberId]);
});

it('rejects a reader with an unrelated SHOP grant', async () => {
  const dto = await query({ barcode: imei });
  for (const method of ['list', 'summary'] as const) {
    await expect(
      resources.execute(
        denied,
        'shop-tenders.read',
        'SHOP',
        undefined,
        async () => {
          await service[method](dto);
        },
        false,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  }
});

it('keeps source restrictions and nullable money on an empty query', async () => {
  const dto = await query();
  const list = await read(() => service.list(dto));
  expect(list.total).toBe(trustedIds.length);
  expect(list.data.map((r) => r.id).sort()).toEqual([...trustedIds].sort());
  expect(list.data.some((r) => r.id === unknownId)).toBe(false);
  expect(list.data.every((r) => r.costTotal === null && r.profit === null)).toBe(true);
  const summary = await read(() => service.summary(dto));
  expect(summary.totals).toMatchObject({ lineCount: trustedIds.length, cost: null, profit: null });
  for (const bucket of [
    summary.byMonth,
    summary.byChannel,
    summary.bySalesperson,
    summary.byCategory,
  ]) {
    expect(bucket.length).toBeGreaterThan(0);
    expect(bucket.every((row) => row.profit === null)).toBe(true);
  }
});

it('returns a zero summary when the authorized filters find no rows', async () => {
  const dto = await query({ barcode: '123' });
  expect(await read(() => service.summary(dto))).toEqual({
    totals: { billCount: 0, lineCount: 0, count: 0, sales: '0', cost: null, profit: null },
    byMonth: [],
    byChannel: [],
    bySalesperson: [],
    byCategory: [],
  });
});

it('summarizes enough matched rows to exceed one PostgreSQL bind batch', async () => {
  await db.$executeRaw`
    INSERT INTO imported_sales (
      id, source, barcode, product_name, category, buyer_label, order_number,
      payment_type, price_group, sale_channel, cost_total, list_price,
      sale_price, profit, salesperson_name, sold_at, import_batch
    )
    SELECT gen_random_uuid(), 'TOOLTIFY', i, 'Fixture phone', 'Phone', 'Fixture buyer', 'SCALE-' || i,
           'CASH', 'Retail', 'CASH', 70.01, 100, 100, 29.99, 'Fixture seller',
           timestamp '2026-11-01 10:00:00', 'scale-fixture'
    FROM generate_series(1, 34000) i
  `;
  try {
    const dto = await query({ orderNumber: 'SCALE-' });
    expect((await read(() => service.summary(dto))).totals).toMatchObject({
      billCount: 34_000,
      lineCount: 34_000,
      count: 34_000,
      sales: '3400000',
    });
  } finally {
    await db.importedSale.deleteMany({ where: { importBatch: 'scale-fixture' } });
  }
}, 15_000);
