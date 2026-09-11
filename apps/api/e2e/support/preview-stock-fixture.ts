import { PrismaService } from '../../src/prisma/prisma.service';

/** Disposable preview only. Stable unit IDs preserve edits across preview restarts. */
export async function seedPreviewStock(db: PrismaService) {
  if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) {
    throw new Error('Stock fixtures require the disposable PostgreSQL harness');
  }
  const branch = await db.branch.findFirstOrThrow({
    where: { name: 'LOCAL PREVIEW BRANCH', deletedAt: null },
  });
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
