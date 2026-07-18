/**
 * ราคากลางรับซื้อ iPhone (เกรด A = ราคาสูงสุดหน้าเว็บ /sell)
 * ที่มา: ราคารับซื้อสูงสุดของ yellobe.com ณ 2026-07-18 (owner เลือกตั้งเท่าคู่แข่ง)
 * — owner ปรับรายรุ่นได้ตลอดในแท็บ "ตารางราคากลาง" ไม่ต้อง deploy
 *
 * Idempotent แบบไม่ทับของเดิม: ข้ามถ้า "เคยมี" แถว (brand,model,storage,condition)
 * รวม soft-deleted — รันซ้ำจะไม่ทับราคาที่ owner แก้แล้ว และไม่คืนชีพแถวที่ลบ
 *
 * รันบน prod: SEED_FILE=apps/api/prisma/seed-sell-valuations-yellobe.ts bash scripts/seed-sell-prod.sh
 */
import { Prisma, PrismaClient } from '@prisma/client';

type PrismaAny = PrismaClient & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PRICES: Array<{ model: string; storage: string; basePrice: number }> = [
  { model: 'iPhone 17 Pro Max', storage: '256GB', basePrice: 38500 },
  { model: 'iPhone 17 Pro Max', storage: '512GB', basePrice: 40500 },
  { model: 'iPhone 17 Pro Max', storage: '1TB', basePrice: 42500 },
  { model: 'iPhone 17 Pro Max', storage: '2TB', basePrice: 44500 },
  { model: 'iPhone 17 Pro', storage: '256GB', basePrice: 33500 },
  { model: 'iPhone 17 Pro', storage: '512GB', basePrice: 35500 },
  { model: 'iPhone 17 Pro', storage: '1TB', basePrice: 37500 },
  { model: 'iPhone 17 Pro', storage: '2TB', basePrice: 38500 },
  { model: 'iPhone 17', storage: '256GB', basePrice: 23000 },
  { model: 'iPhone 17', storage: '512GB', basePrice: 25000 },
  { model: 'iPhone 17', storage: '1TB', basePrice: 26000 },
  { model: 'iPhone 17e', storage: '256GB', basePrice: 14000 },
  { model: 'iPhone 17e', storage: '512GB', basePrice: 15000 },
  { model: 'iPhone 17e', storage: '1TB', basePrice: 16000 },
  { model: 'iPhone 16 Pro Max', storage: '256GB', basePrice: 29000 },
  { model: 'iPhone 16 Pro Max', storage: '512GB', basePrice: 30000 },
  { model: 'iPhone 16 Pro Max', storage: '1TB', basePrice: 31000 },
  { model: 'iPhone 16 Pro', storage: '128GB', basePrice: 23000 },
  { model: 'iPhone 16 Pro', storage: '256GB', basePrice: 24000 },
  { model: 'iPhone 16 Pro', storage: '512GB', basePrice: 25000 },
  { model: 'iPhone 16 Pro', storage: '1TB', basePrice: 25500 },
  { model: 'iPhone 16 Plus', storage: '128GB', basePrice: 21500 },
  { model: 'iPhone 16 Plus', storage: '256GB', basePrice: 22500 },
  { model: 'iPhone 16 Plus', storage: '512GB', basePrice: 23500 },
  { model: 'iPhone 16', storage: '128GB', basePrice: 18000 },
  { model: 'iPhone 16', storage: '256GB', basePrice: 19000 },
  { model: 'iPhone 16', storage: '512GB', basePrice: 20000 },
  { model: 'iPhone 16e', storage: '128GB', basePrice: 11500 },
  { model: 'iPhone 16e', storage: '256GB', basePrice: 12500 },
  { model: 'iPhone 16e', storage: '512GB', basePrice: 13500 },
  { model: 'iPhone 15 Pro Max', storage: '256GB', basePrice: 22000 },
  { model: 'iPhone 15 Pro Max', storage: '512GB', basePrice: 23000 },
  { model: 'iPhone 15 Pro Max', storage: '1TB', basePrice: 23500 },
  { model: 'iPhone 15 Pro', storage: '128GB', basePrice: 18500 },
  { model: 'iPhone 15 Pro', storage: '256GB', basePrice: 19500 },
  { model: 'iPhone 15 Pro', storage: '512GB', basePrice: 20500 },
  { model: 'iPhone 15 Pro', storage: '1TB', basePrice: 21000 },
  { model: 'iPhone 15 Plus', storage: '128GB', basePrice: 16000 },
  { model: 'iPhone 15 Plus', storage: '256GB', basePrice: 17000 },
  { model: 'iPhone 15 Plus', storage: '512GB', basePrice: 17500 },
  { model: 'iPhone 15', storage: '128GB', basePrice: 14500 },
  { model: 'iPhone 15', storage: '256GB', basePrice: 15000 },
  { model: 'iPhone 15', storage: '512GB', basePrice: 15500 },
  { model: 'iPhone 14 Pro Max', storage: '128GB', basePrice: 17500 },
  { model: 'iPhone 14 Pro Max', storage: '256GB', basePrice: 18500 },
  { model: 'iPhone 14 Pro Max', storage: '512GB', basePrice: 19500 },
  { model: 'iPhone 14 Pro Max', storage: '1TB', basePrice: 20000 },
  { model: 'iPhone 14 Pro', storage: '128GB', basePrice: 15500 },
  { model: 'iPhone 14 Pro', storage: '256GB', basePrice: 16500 },
  { model: 'iPhone 14 Pro', storage: '512GB', basePrice: 17500 },
  { model: 'iPhone 14 Pro', storage: '1TB', basePrice: 18000 },
  { model: 'iPhone 14 Plus', storage: '128GB', basePrice: 12500 },
  { model: 'iPhone 14 Plus', storage: '256GB', basePrice: 13500 },
  { model: 'iPhone 14 Plus', storage: '512GB', basePrice: 14000 },
  { model: 'iPhone 14', storage: '128GB', basePrice: 10500 },
  { model: 'iPhone 14', storage: '256GB', basePrice: 11500 },
  { model: 'iPhone 14', storage: '512GB', basePrice: 12000 },
  { model: 'iPhone 13 Pro Max', storage: '128GB', basePrice: 13500 },
  { model: 'iPhone 13 Pro Max', storage: '256GB', basePrice: 14500 },
  { model: 'iPhone 13 Pro Max', storage: '512GB', basePrice: 15000 },
  { model: 'iPhone 13 Pro Max', storage: '1TB', basePrice: 15500 },
  { model: 'iPhone 13 Pro', storage: '128GB', basePrice: 12000 },
  { model: 'iPhone 13 Pro', storage: '256GB', basePrice: 13000 },
  { model: 'iPhone 13 Pro', storage: '512GB', basePrice: 13500 },
  { model: 'iPhone 13', storage: '128GB', basePrice: 9000 },
  { model: 'iPhone 13', storage: '256GB', basePrice: 9500 },
  { model: 'iPhone 13', storage: '512GB', basePrice: 10000 },
  { model: 'iPhone 13 Mini', storage: '128GB', basePrice: 6000 },
  { model: 'iPhone 13 Mini', storage: '256GB', basePrice: 7000 },
  { model: 'iPhone 13 Mini', storage: '512GB', basePrice: 8000 },
  { model: 'iPhone 12 Pro Max', storage: '128GB', basePrice: 9500 },
  { model: 'iPhone 12 Pro Max', storage: '256GB', basePrice: 10500 },
  { model: 'iPhone 12 Pro Max', storage: '512GB', basePrice: 11000 },
  { model: 'iPhone 12 Pro', storage: '128GB', basePrice: 7500 },
  { model: 'iPhone 12 Pro', storage: '256GB', basePrice: 8500 },
  { model: 'iPhone 12 Pro', storage: '512GB', basePrice: 9000 },
  { model: 'iPhone 12', storage: '64GB', basePrice: 5500 },
  { model: 'iPhone 12', storage: '128GB', basePrice: 6000 },
  { model: 'iPhone 12', storage: '256GB', basePrice: 6500 },
  { model: 'iPhone 12 Mini', storage: '64GB', basePrice: 4500 },
  { model: 'iPhone 12 Mini', storage: '128GB', basePrice: 5000 },
  { model: 'iPhone 12 Mini', storage: '256GB', basePrice: 5200 },
  { model: 'iPhone 11 Pro Max', storage: '64GB', basePrice: 4500 },
  { model: 'iPhone 11 Pro Max', storage: '256GB', basePrice: 5000 },
  { model: 'iPhone 11 Pro Max', storage: '512GB', basePrice: 5500 },
  { model: 'iPhone 11 Pro', storage: '64GB', basePrice: 3500 },
  { model: 'iPhone 11 Pro', storage: '256GB', basePrice: 4000 },
  { model: 'iPhone 11 Pro', storage: '512GB', basePrice: 4500 },
  { model: 'iPhone 11', storage: '64GB', basePrice: 3500 },
  { model: 'iPhone 11', storage: '128GB', basePrice: 4000 },
  { model: 'iPhone 11', storage: '256GB', basePrice: 4500 },
  { model: 'iPhone 8 Plus', storage: '64GB', basePrice: 1300 },
  { model: 'iPhone 8 Plus', storage: '128GB', basePrice: 1500 },
  { model: 'iPhone 8 Plus', storage: '256GB', basePrice: 1600 },
  { model: 'iPhone 8', storage: '64GB', basePrice: 1000 },
  { model: 'iPhone 8', storage: '128GB', basePrice: 1100 },
  { model: 'iPhone 8', storage: '256GB', basePrice: 1200 },
  { model: 'iPhone Air', storage: '256GB', basePrice: 21000 },
  { model: 'iPhone Air', storage: '512GB', basePrice: 23000 },
  { model: 'iPhone Air', storage: '1TB', basePrice: 24000 },
  { model: 'iPhone SE 2020', storage: '64GB', basePrice: 1500 },
  { model: 'iPhone SE 2020', storage: '128GB', basePrice: 1700 },
  { model: 'iPhone SE 2020', storage: '256GB', basePrice: 1800 },
  { model: 'iPhone SE 2022', storage: '64GB', basePrice: 2000 },
  { model: 'iPhone SE 2022', storage: '128GB', basePrice: 2500 },
  { model: 'iPhone SE 2022', storage: '256GB', basePrice: 2700 },
  { model: 'iPhone X', storage: '64GB', basePrice: 1500 },
  { model: 'iPhone X', storage: '256GB', basePrice: 1700 },
  { model: 'iPhone Xr', storage: '64GB', basePrice: 1500 },
  { model: 'iPhone Xr', storage: '128GB', basePrice: 1700 },
  { model: 'iPhone Xr', storage: '256GB', basePrice: 2000 },
  { model: 'iPhone Xs', storage: '64GB', basePrice: 2200 },
  { model: 'iPhone Xs', storage: '256GB', basePrice: 2300 },
  { model: 'iPhone Xs', storage: '512GB', basePrice: 2400 },
  { model: 'iPhone Xs Max', storage: '64GB', basePrice: 2700 },
  { model: 'iPhone Xs Max', storage: '256GB', basePrice: 3000 },
  { model: 'iPhone Xs Max', storage: '512GB', basePrice: 3100 },
];

const prisma = new PrismaClient();

async function main() {
  console.log(`=== Sell Valuations Seed (Apple condition A × ${PRICES.length} rows) ===`);
  const db = prisma as unknown as PrismaAny;
  let created = 0;
  let skipped = 0;
  for (const e of PRICES) {
    const existing = await db.tradeInValuation.findFirst({
      where: {
        brand: { equals: 'Apple', mode: 'insensitive' },
        model: { equals: e.model, mode: 'insensitive' },
        storage: { equals: e.storage, mode: 'insensitive' },
        condition: 'A',
      },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await db.tradeInValuation.create({
      data: {
        brand: 'Apple',
        model: e.model,
        storage: e.storage,
        condition: 'A',
        basePrice: new Prisma.Decimal(e.basePrice),
        note: 'อ้างอิงราคาตลาด 2026-07-18',
      },
    });
    created++;
  }
  console.log(`✅ Done — created=${created} skipped=${skipped}`);
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
