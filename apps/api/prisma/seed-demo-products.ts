/**
 * Standalone prod seeder: สินค้า DEMO สำหรับโชว์หน้าเว็บ shop (iPhone 7 เครื่อง / 6 รุ่น).
 *
 * ทำไมต้องมีไฟล์นี้: prod เป็น testing-phase แต่ catalog ว่าง (ไม่มีรูป/ราคา) ทำให้
 * ดูดีไซน์หน้า list/กรองรุ่น/มือ1-มือ2/detail/related ไม่ได้ — ชุดนี้เติมของ demo
 * ที่ mark ชัดเจน (ชื่อขึ้นต้น [DEMO], IMEI ขึ้นต้น 990000) เพื่อลบทิ้งง่ายก่อน launch จริง
 *
 * รูป = ภาพประกอบรุ่นจาก Wikimedia Commons (hotlink) — ไม่ใช่รูปถ่ายเครื่องจริงของร้าน
 *
 * Idempotent: อิง imeiSerial — มีอยู่แล้ว (รวม soft-deleted) = update/restore, ไม่มี = create
 * Cleanup:    npx tsx apps/api/prisma/seed-demo-products.ts --clean   (soft-delete ทั้งชุด)
 * รันบน prod: bash scripts/seed-demo-products-prod.sh          (pattern seed-sell-prod.sh)
 *             CLEAN=1 bash scripts/seed-demo-products-prod.sh  (ลบชุด demo บน prod)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const WIKI = 'https://upload.wikimedia.org/wikipedia/commons/thumb';

interface DemoUnit {
  imeiSerial: string;
  model: string;
  storage: string;
  color: string;
  category: 'PHONE_NEW' | 'PHONE_USED';
  conditionGrade: string | null;
  batteryHealth: number | null;
  costPrice: number;
  cashPrice: number;
  installmentPrice: number;
  gallery: string[];
  onlineDescription: string;
}

// IMEI ขึ้นต้น 990000 = ชุด demo เท่านั้น (ห้ามใช้กับเครื่องจริง)
const UNITS: DemoUnit[] = [
  {
    imeiSerial: '990000000000001',
    model: 'iPhone 16',
    storage: '128GB',
    color: 'Ultramarine',
    category: 'PHONE_NEW',
    conditionGrade: null,
    batteryHealth: null,
    costPrice: 27500,
    cashPrice: 29900,
    installmentPrice: 32900,
    gallery: [`${WIKI}/b/bf/Back_view_of_iPhone_16_Ultramarine.jpg/960px-Back_view_of_iPhone_16_Ultramarine.jpg`],
    onlineDescription: 'เครื่องใหม่ ซีล 100% ประกันศูนย์ Apple 1 ปี',
  },
  {
    imeiSerial: '990000000000002',
    model: 'iPhone 15',
    storage: '128GB',
    color: 'Blue',
    category: 'PHONE_USED',
    conditionGrade: 'A',
    batteryHealth: 92,
    costPrice: 17800,
    cashPrice: 19900,
    installmentPrice: 21900,
    gallery: [
      `${WIKI}/3/3c/Back_view_of_iPhone_15_Blue.jpg/960px-Back_view_of_iPhone_15_Blue.jpg`,
      `${WIKI}/5/5d/Back_view_of_iPhone_15_blue.jpg/960px-Back_view_of_iPhone_15_blue.jpg`,
    ],
    onlineDescription: 'สภาพนางฟ้า ไร้รอย แบต 92% อุปกรณ์ครบกล่อง',
  },
  {
    imeiSerial: '990000000000003',
    model: 'iPhone 15',
    storage: '128GB',
    color: 'Pink',
    category: 'PHONE_USED',
    conditionGrade: 'B',
    batteryHealth: 87,
    costPrice: 15600,
    cashPrice: 17500,
    installmentPrice: 19500,
    gallery: [
      `${WIKI}/0/00/Apple_iPhone_15_Pink_-_back_view_%28November_1%2C_2024%29.jpg/960px-Apple_iPhone_15_Pink_-_back_view_%28November_1%2C_2024%29.jpg`,
    ],
    onlineDescription: 'สภาพดี มีรอยใช้งานเล็กน้อย แบต 87%',
  },
  {
    imeiSerial: '990000000000004',
    model: 'iPhone 15 Pro',
    storage: '256GB',
    color: 'Natural Titanium',
    category: 'PHONE_USED',
    conditionGrade: 'A',
    batteryHealth: 94,
    costPrice: 29900,
    cashPrice: 32900,
    installmentPrice: 35900,
    gallery: [
      `${WIKI}/4/4a/Back_view_of_iPhone_15_Pro_Natural_titanium.jpg/960px-Back_view_of_iPhone_15_Pro_Natural_titanium.jpg`,
      `${WIKI}/2/23/About_iPhone_15_Pro_Max_Natural_Titanium.jpg/960px-About_iPhone_15_Pro_Max_Natural_Titanium.jpg`,
    ],
    onlineDescription: 'ไทเทเนียมสภาพสวย แบต 94% ครบกล่อง',
  },
  {
    imeiSerial: '990000000000005',
    model: 'iPhone 14',
    storage: '128GB',
    color: 'Blue',
    category: 'PHONE_USED',
    conditionGrade: 'A',
    batteryHealth: 90,
    costPrice: 14000,
    cashPrice: 15900,
    installmentPrice: 17500,
    gallery: [`${WIKI}/9/99/Back_view_of_iPhone_14_Blue.jpg/960px-Back_view_of_iPhone_14_Blue.jpg`],
    onlineDescription: 'สภาพสวย แบต 90% ใช้งานลื่นทุกแอป',
  },
  {
    imeiSerial: '990000000000006',
    model: 'iPhone 13 Pro Max',
    storage: '256GB',
    color: 'Gold',
    category: 'PHONE_USED',
    conditionGrade: 'B',
    batteryHealth: 85,
    costPrice: 14900,
    cashPrice: 16900,
    installmentPrice: 18500,
    gallery: [
      `${WIKI}/1/13/Back_view_of_iPhone_13_Pro_Max_Gold.jpg/960px-Back_view_of_iPhone_13_Pro_Max_Gold.jpg`,
    ],
    onlineDescription: 'จอใหญ่ แบต 85% มีรอยใช้งานตามสภาพ',
  },
  {
    imeiSerial: '990000000000007',
    model: 'iPhone 12',
    storage: '64GB',
    color: 'Black',
    category: 'PHONE_USED',
    conditionGrade: 'C',
    batteryHealth: 78,
    costPrice: 6700,
    cashPrice: 7900,
    installmentPrice: 8900,
    gallery: [
      `${WIKI}/c/cf/IPhone_12_Black_256g.jpg/960px-IPhone_12_Black_256g.jpg`,
      `${WIKI}/8/86/Rear_3_lenses_of_an_iPhone_12.jpg/960px-Rear_3_lenses_of_an_iPhone_12.jpg`,
    ],
    onlineDescription: 'เครื่องคุ้มค่า แบต 78% เหมาะใช้งานทั่วไป/เครื่องสำรอง',
  },
];

const DEMO_IMEIS = UNITS.map((u) => u.imeiSerial);

async function clean() {
  const res = await prisma.product.updateMany({
    where: { imeiSerial: { in: DEMO_IMEIS } },
    data: { deletedAt: new Date(), isOnlineVisible: false },
  });
  console.log(`🧹 Soft-deleted ${res.count} demo products`);
}

async function seed() {
  const branch = await prisma.branch.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (!branch) throw new Error('No active branch found — cannot seed products');
  console.log(`Using branch: ${branch.name} (${branch.id})`);

  let created = 0;
  let updated = 0;
  for (const u of UNITS) {
    const name = `[DEMO] Apple ${u.model} ${u.storage} ${u.color}`;
    const data = {
      name,
      brand: 'Apple',
      model: u.model,
      storage: u.storage,
      color: u.color,
      category: u.category,
      costPrice: u.costPrice,
      cashPrice: u.cashPrice,
      installmentPrice: u.installmentPrice,
      conditionGrade: u.conditionGrade,
      batteryHealth: u.batteryHealth,
      hasBox: true,
      shopWarrantyDays: 30,
      gallery: u.gallery,
      onlineDescription: u.onlineDescription,
      isOnlineVisible: true,
      status: 'IN_STOCK' as const,
      deletedAt: null,
    };
    const existing = await prisma.product.findFirst({
      where: { imeiSerial: u.imeiSerial },
      select: { id: true },
    });
    if (existing) {
      await prisma.product.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.product.create({
        data: { ...data, imeiSerial: u.imeiSerial, branchId: branch.id },
      });
      created++;
    }
  }
  console.log(`✅ Done — created ${created}, updated/restored ${updated} demo products`);
  const visible = await prisma.product.count({
    where: { imeiSerial: { in: DEMO_IMEIS }, deletedAt: null, isOnlineVisible: true },
  });
  console.log(`   Demo products online-visible: ${visible}/${UNITS.length}`);
}

async function main() {
  console.log('=== Web-shop DEMO products seed ===');
  if (process.argv.includes('--clean')) {
    await clean();
  } else {
    await seed();
  }
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
