import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import type { PrismaService } from '../../../../prisma/prisma.service';
import { hashImportValue, receiptDigest } from '../../../../cli/tooltify-cutover/canonicalize';
import { saleIdentity } from '../../../../cli/tooltify-cutover/plan-targets';
import { StockOverviewService } from '../stock-overview.service';
import { AccessResourceService } from '../../../employee-access/access-resource.service';
import { AccessSnapshotService } from '../../../employee-access/access-snapshot.service';

const url = process.env.DATABASE_URL ?? '';
if (
  !/^postgresql:\/\/vitest@localhost:\d+\/bc_vitest_test\?host=\/tmp\/bc-vitest-db\.[^/]+\/socket&schema=public$/.test(
    url,
  )
)
  throw Error('Use isolated tools/test-db-vitest.sh');
const db = new PrismaClient({ datasources: { db: { url } } });
const prisma = db as unknown as PrismaService;
const service = new StockOverviewService(prisma);
let branchId: string, otherBranchId: string, denied: string;
const now = new Date('2026-11-22T10:00:00Z');
beforeAll(async () => {
  const company = await db.companyInfo.upsert({
    where: { companyCode: 'SHOP' },
    update: {},
    create: {
      companyCode: 'SHOP',
      nameTh: 'Fixture',
      taxId: '0000000000000',
      address: 'Fixture',
      directorName: 'Fixture',
    },
  });
  branchId = (await db.branch.create({ data: { name: randomUUID(), companyId: company.id } })).id;
  otherBranchId = (await db.branch.create({ data: { name: randomUUID(), companyId: company.id } }))
    .id;
  const actor = await db.user.create({
    data: {
      name: 'Fixture',
      email: randomUUID() + '@test.invalid',
      password: 'unused',
      role: 'ACCOUNTANT',
      accessManaged: true,
    },
  });
  denied = actor.id;
  const position = await db.accessPosition.create({
    data: { code: randomUUID(), name: 'Stock only', permissions: ['products.read'] },
  });
  await db.employeeAccessAssignment.create({
    data: { userId: actor.id, positionId: position.id, companyCode: 'SHOP', scope: 'COMPANY' },
  });
  const customer = await db.customer.create({ data: { name: 'Fixture customer' } });
  const phone = await db.product.create({
    data: {
      branchId,
      name: 'Phone',
      brand: 'Fixture',
      model: 'Phone',
      category: 'PHONE_USED',
      status: 'IN_STOCK',
      costPrice: 50,
    },
  });
  const gift = await db.product.create({
    data: {
      branchId,
      name: 'Case',
      brand: 'Fixture',
      model: 'Case',
      category: 'ACCESSORY',
      status: 'IN_STOCK',
      costPrice: 5,
    },
  });
  for (const [i, deleted] of [false, false, true].entries())
    await db.sale.create({
      data: {
        saleNumber: randomUUID(),
        saleType: 'CASH',
        productId: phone.id,
        branchId,
        customerId: customer.id,
        salespersonId: actor.id,
        sellingPrice: 150,
        netAmount: 150,
        bundleProductIds: i === 0 ? [gift.id] : [],
        createdAt: new Date('2026-11-02T00:00:00+07:00'),
        deletedAt: deleted ? now : null,
      },
    });
  const batchId = randomUUID(),
    fileSha256 = hashImportValue(batchId);
  const rows = [
    {
      category: 'iPhone มือ 2',
      soldAt: new Date('2026-11-01T00:00:00+07:00'),
      occurrence: 1,
      price: 100,
    },
    {
      category: 'iPhone มือ 2',
      soldAt: new Date('2026-11-01T00:00:00+07:00'),
      occurrence: 2,
      price: 100,
    },
    {
      category: 'Accessories',
      soldAt: new Date('2026-11-01T00:00:00+07:00'),
      occurrence: 1,
      price: 0,
    },
    { category: '-', soldAt: new Date('2026-11-01T00:00:00+07:00'), occurrence: 1, price: 7 },
    {
      category: 'iPhone มือ 1',
      soldAt: new Date('2026-10-31T23:59:59.999+07:00'),
      occurrence: 1,
      price: 200,
    },
  ].map((r, i) => ({
    id: randomUUID(),
    source: 'TOOLTIFY',
    barcode: i < 2 ? 'same-imei' : String(i),
    orderNumber: 'BILL',
    productName: 'Imported ' + r.category,
    category: r.category,
    buyerLabel: 'Fixture',
    paymentType: 'CASH',
    priceGroup: 'Retail',
    saleChannel: 'CASH',
    salespersonName: 'Fixture',
    soldAt: r.soldAt,
    sourceOccurrence: r.occurrence,
    salePrice: r.price,
    listPrice: r.price,
    costTotal: 0,
    profit: r.price,
    importBatch: batchId,
  }));
  const items = rows.map((r, i) => ({
    batchId,
    sourceKey: hashImportValue([r.id]),
    disposition: 'CREATE' as const,
    targetType: 'IMPORTED_SALE' as const,
    targetId: r.id,
    identityHash: saleIdentity(r, r.sourceOccurrence),
    payloadHash: hashImportValue(r),
    afterFingerprint: hashImportValue(r),
    dependencyFingerprint: hashImportValue(null),
    sourceRefs: [{ fileSha256, sheet: 'Fixture', row: i + 1, storeKey: 'fixture' }],
  }));
  await db.tooltifyImportBatch.create({
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
      sourceCutoverAt: now,
      status: 'APPLIED',
      codeRevision: 'fixture',
    },
  });
  await db.importedSale.createMany({ data: rows });
  await db.tooltifyImportItem.createMany({ data: items });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
});
afterAll(async () => {
  vi.useRealTimers();
  await db.$disconnect();
});
it('combines actual sale occurrences and imported occurrences by Bangkok month without counting void sales', async () => {
  const d = await (service.getStockDashboard as any)(branchId, 'devices', { role: 'OWNER' });
  expect(d.stockTurnover.soldThisMonth).toBe(4);
  expect(d.stockTurnover.soldLastMonth).toBe(1);
  expect(d.salesAnalytics).toMatchObject({
    current: { count: 4, nativeCount: 2, importedCount: 2, revenue: '500', giftCount: 0 },
    importedIncluded: true,
  });
  const a = await (service.getStockDashboard as any)(branchId, 'accessories', { role: 'OWNER' });
  expect(a.salesAnalytics.current).toMatchObject({ count: 2, giftCount: 2, revenue: '0' });
  const all = await (service.getStockDashboard as any)(branchId, 'all', { role: 'OWNER' });
  expect(all.salesAnalytics.current).toMatchObject({ count: 7, unknownCount: 1, revenue: '507' });
  expect(all.stockMovement.at(-1).out).toBe(7);
});
it('does not assign imported history to an unrelated branch', async () => {
  const d = await (service.getStockDashboard as any)(otherBranchId, 'all', { role: 'OWNER' });
  expect(d.stockTurnover.soldThisMonth).toBe(0);
});
it('does not reveal imported or native sales to a stock-only reader', async () => {
  const resources = new AccessResourceService(prisma, new AccessSnapshotService(prisma));
  const result = await resources.execute(
    denied,
    'products.read',
    'SHOP',
    undefined,
    () => (service.getStockDashboard as any)(branchId, 'all'),
    false,
    { isolationLevel: 'Serializable' },
  );
  expect((result.result as any).salesAnalytics).toMatchObject({
    importedIncluded: false,
    nativeIncluded: false,
    current: { count: 0, revenue: '0' },
  });
});

it('fails closed without a principal, and enforces legacy source roles and branch scope', async () => {
  const read = (branch: string | undefined, actor?: object) =>
    (service.getStockDashboard as any)(branch, 'devices', actor);
  expect((await read(undefined)).salesAnalytics).toMatchObject({
    nativeIncluded: false,
    importedIncluded: false,
    current: { count: 0 },
  });
  for (const role of ['SALES', 'BRANCH_MANAGER']) {
    const own = await read(undefined, { role, branchId });
    expect(own.salesAnalytics).toMatchObject({
      nativeIncluded: true,
      importedIncluded: false,
      current: { count: 2, nativeCount: 2, importedCount: 0, revenue: '300' },
    });
    expect((await read(undefined, { role })).salesAnalytics.current.count).toBe(0);
    await expect(read(otherBranchId, { role, branchId })).rejects.toThrow('ไม่มีสิทธิ์');
  }
  for (const role of ['OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER']) {
    expect((await read(branchId, { role })).salesAnalytics.current).toMatchObject({
      count: 4,
      importedCount: 2,
    });
  }
  expect(
    (await read(branchId, { role: 'OWNER', access: { managed: true } })).salesAnalytics.current
      .count,
  ).toBe(0);
});
it('excludes a live sale linked to a draft contract just like the ordinary sales report', async () => {
  const sale = await db.sale.findFirstOrThrow({ where: { branchId, deletedAt: null } });
  const contract = await db.contract.create({
    data: {
      contractNumber: randomUUID(),
      customerId: sale.customerId,
      productId: sale.productId,
      branchId,
      salespersonId: sale.salespersonId,
      planType: 'STORE_DIRECT',
      sellingPrice: 100,
      downPayment: 0,
      interestRate: 0,
      totalMonths: 1,
      interestTotal: 0,
      financedAmount: 100,
      monthlyPayment: 100,
      status: 'DRAFT',
    },
  });
  const draftSale = await db.sale.create({
    data: {
      saleNumber: randomUUID(),
      saleType: 'INSTALLMENT',
      productId: sale.productId,
      branchId,
      customerId: sale.customerId,
      salespersonId: sale.salespersonId,
      sellingPrice: 100,
      netAmount: 100,
      contractId: contract.id,
      createdAt: now,
    },
  });
  try {
    expect(
      (await (service.getStockDashboard as any)(branchId, 'devices', { role: 'OWNER' }))
        .salesAnalytics.current.count,
    ).toBe(4);
  } finally {
    await db.sale.delete({ where: { id: draftSale.id } });
    await db.contract.delete({ where: { id: contract.id } });
  }
});
it('keeps authorized sale counts while hiding current product names outside independent product permissions', async () => {
  const reader = await db.user.create({
    data: {
      name: 'Reader',
      email: randomUUID() + '@test.invalid',
      password: 'unused',
      role: 'SALES',
      accessManaged: true,
    },
  });
  const position = await db.accessPosition.create({
    data: {
      code: randomUUID(),
      name: 'Scoped analytics',
      permissions: ['inventory.read', 'sales.read', 'products.read'],
    },
  });
  await db.employeeAccessAssignment.create({
    data: {
      userId: reader.id,
      positionId: position.id,
      companyCode: 'SHOP',
      scope: 'BRANCHES',
      branches: { create: [{ branchId }] },
    },
  });
  const product = await db.product.findFirstOrThrow({
    where: { branchId, category: 'PHONE_USED' },
  });
  await db.product.update({ where: { id: product.id }, data: { branchId: otherBranchId } });
  const resources = new AccessResourceService(prisma, new AccessSnapshotService(prisma));
  try {
    const result = await resources.execute(
      reader.id,
      'inventory.read',
      'SHOP',
      undefined,
      () => service.getStockDashboard(branchId, 'devices'),
      false,
      { isolationLevel: 'Serializable' },
    );
    expect((result.result as any).salesAnalytics.current.count).toBe(2);
    expect((result.result as any).salesAnalytics.topSellers).toEqual([]);
    await db.accessPosition.update({
      where: { id: position.id },
      data: { permissions: ['inventory.read', 'sales.read'] },
    });
    const noProducts = await resources.execute(
      reader.id,
      'inventory.read',
      'SHOP',
      undefined,
      () => service.getStockDashboard(branchId, 'all'),
      false,
      { isolationLevel: 'Serializable' },
    );
    expect((noProducts.result as any).salesAnalytics.current.count).toBe(3);
    expect((noProducts.result as any).salesAnalytics.topSellers).toEqual([]);
  } finally {
    await db.product.update({ where: { id: product.id }, data: { branchId } });
  }
});
