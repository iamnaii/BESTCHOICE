import { hashImportValue, receiptDigest } from '../../src/cli/tooltify-cutover/canonicalize';
import { saleIdentity } from '../../src/cli/tooltify-cutover/plan-targets';
import { PrismaService } from '../../src/prisma/prisma.service';
import { isDisposablePreviewDatabase } from './preview-database';

/** Disposable preview only. Stable unit IDs preserve edits across preview restarts. */
export async function seedPreviewStock(db: PrismaService) {
  if (!isDisposablePreviewDatabase()) {
    throw new Error('Stock fixtures require the disposable PostgreSQL harness');
  }
  const branch = await db.branch.findFirstOrThrow({
    where: { name: 'LOCAL PREVIEW BRANCH', deletedAt: null },
  });
  await seedPreviewStockHistory(db, branch.id);
  const secondBranch =
    (await db.branch.findFirst({ where: { name: '[ทดสอบระบบ] สาขาอุปกรณ์', deletedAt: null } })) ??
    (await db.branch.create({
      data: { name: '[ทดสอบระบบ] สาขาอุปกรณ์', companyId: branch.companyId },
    }));
  for (let index = 0; index < 6; index++) {
    const id = `51000000-0000-4000-8000-00000000000${index}`;
    await db.product.upsert({
      where: { id },
      update: {},
      create: {
        id,
        name: '[ทดสอบระบบ] เคสใส iPhone 16',
        brand: 'TEST',
        model: 'iPhone 16',
        category: 'ACCESSORY',
        accessoryType: 'เคส',
        accessoryBrand: 'TEST',
        color: index === 5 ? 'ชมพู' : 'ใส',
        branchId: index >= 3 && index < 5 ? secondBranch.id : branch.id,
        costPrice: index === 1 ? '120' : '100',
        cashPrice: index === 1 ? '290' : '250',
        status: index === 2 ? 'RESERVED' : index === 4 ? 'SOLD_CASH' : 'IN_STOCK',
        legacyProductCode: `TEST-LOCAL-ACCESSORY-${index + 1}`,
      },
    });
  }
  for (const [index, status] of ['QC_PENDING', 'IN_STOCK'].entries()) {
    const id = `55000000-0000-4000-8000-00000000000${index}`;
    await db.product.upsert({
      where: { id },
      update: {},
      create: {
        id,
        branchId: branch.id,
        name: '[ทดสอบระบบ] เครื่องตรวจสอบภาพรวม',
        brand: 'TEST',
        model: 'Overview',
        category: 'PHONE_USED',
        status: status as 'QC_PENDING' | 'IN_STOCK',
        costPrice: 10000,
        stockInDate: new Date(Date.now() - 92 * 86400000),
      },
    });
  }
  const devices = [
    { category: 'PHONE_NEW' as const, model: 'iPhone 16 (ทดสอบ)', age: 12 },
    { category: 'PHONE_USED' as const, model: 'iPhone 13 (ทดสอบ)', age: 48 },
    { category: 'TABLET' as const, model: 'iPad 10 Wi-Fi (ทดสอบ)', age: 90 },
  ];
  for (const [index, device] of devices.entries()) {
    const id = `52000000-0000-4000-8000-00000000000${index}`;
    const stockInDate = new Date();
    stockInDate.setDate(stockInDate.getDate() - device.age);
    await db.product.upsert({
      where: { id },
      update: {},
      create: {
        id,
        name: `[ทดสอบระบบ] ${device.model}`,
        model: device.model,
        brand: 'TEST',
        category: device.category,
        branchId: branch.id,
        status: 'IN_STOCK',
        stockInDate,
        color: 'Blue',
        storage: '128GB',
        imeiSerial: `TEST-STOCK-DATE-${index}`,
        costPrice: '10000',
        cashPrice: '15000',
        installmentPrice: '18000',
        ...(device.category === 'PHONE_USED'
          ? { batteryHealth: 89, hasBox: true, warrantyExpired: true }
          : {}),
      },
    });
  }
}

/** Synthetic, proven Tooltify events for exercising the real analytics reader. */
async function seedPreviewStockHistory(db: PrismaService, branchId: string) {
  const batchId = '53000000-0000-4000-8000-000000000001';
  if (await db.tooltifyImportBatch.findUnique({ where: { id: batchId } })) return;
  const soldAt = new Date();
  const fileSha256 = hashImportValue('preview-stock-history');
  const rows = Array.from({ length: 3 }, (_, i) => ({
    id: `54000000-0000-4000-8000-00000000000${i}`,
    source: 'TOOLTIFY',
    barcode: i < 2 ? 'TEST-REPEAT-IMEI' : 'TEST-GIFT',
    orderNumber: 'TEST-HISTORY',
    productName: i < 2 ? '[ทดสอบระบบ] iPhone ประวัติขาย' : '[ทดสอบระบบ] เคสของแถม',
    category: i < 2 ? 'iPhone มือ 2' : 'Accessories',
    buyerLabel: 'ข้อมูลจำลอง',
    paymentType: 'CASH',
    priceGroup: 'Retail',
    saleChannel: 'CASH',
    salespersonName: 'ข้อมูลจำลอง',
    soldAt,
    sourceOccurrence: i === 1 ? 2 : 1,
    salePrice: i < 2 ? 10000 : 0,
    listPrice: i < 2 ? 10000 : 0,
    costTotal: 0,
    profit: i < 2 ? 10000 : 0,
    importBatch: batchId,
  }));
  const items = rows.map((row, i) => ({
    batchId,
    sourceKey: hashImportValue(row.id),
    disposition: 'CREATE' as const,
    targetType: 'IMPORTED_SALE' as const,
    targetId: row.id,
    identityHash: saleIdentity(row, row.sourceOccurrence),
    payloadHash: hashImportValue(row),
    afterFingerprint: hashImportValue(row),
    dependencyFingerprint: hashImportValue(null),
    sourceRefs: [{ fileSha256, sheet: 'Synthetic preview', row: i + 1, storeKey: 'preview' }],
  }));
  await db.$transaction(async (tx) => {
    await tx.tooltifyImportBatch.create({
      data: {
        id: batchId,
        canonicalSetId: batchId,
        kind: 'SALES',
        manifestHash: fileSha256,
        planHash: hashImportValue(items),
        reconciliationSnapshot: {
          files: [{ fileSha256, branchId }],
          expectedReceiptsHash: receiptDigest(items),
        },
        sourceCutoverAt: soldAt,
        status: 'APPLIED',
        codeRevision: 'synthetic-preview',
      },
    });
    await tx.importedSale.createMany({ data: rows });
    await tx.tooltifyImportItem.createMany({ data: items });
  });
}
