import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create branches
  const branch1 = await prisma.branch.upsert({
    where: { id: 'branch-001' },
    update: {},
    create: {
      id: 'branch-001',
      name: 'สาขาลาดพร้าว',
      location: '123 ถ.ลาดพร้าว แขวงจอมพล เขตจตุจักร กทม. 10900',
      phone: '02-111-1111',
    },
  });

  const branch2 = await prisma.branch.upsert({
    where: { id: 'branch-002' },
    update: {},
    create: {
      id: 'branch-002',
      name: 'สาขารามคำแหง',
      location: '456 ถ.รามคำแหง แขวงหัวหมาก เขตบางกะปิ กทม. 10240',
      phone: '02-222-2222',
    },
  });

  const branch3 = await prisma.branch.upsert({
    where: { id: 'branch-003' },
    update: {},
    create: {
      id: 'branch-003',
      name: 'สาขาบางแค',
      location: '789 ถ.เพชรเกษม แขวงบางแค เขตบางแค กทม. 10160',
      phone: '02-333-3333',
    },
  });

  console.log('Branches created:', branch1.name, branch2.name, branch3.name);

  // Create admin user (owner)
  const hashedPassword = await bcrypt.hash('admin1234', 10);

  const owner = await prisma.user.upsert({
    where: { email: 'admin@bestchoice.com' },
    update: {},
    create: {
      email: 'admin@bestchoice.com',
      password: hashedPassword,
      name: 'เจ้าของร้าน',
      role: 'OWNER',
      branchId: branch1.id,
    },
  });

  // Create sample users for each role
  const manager = await prisma.user.upsert({
    where: { email: 'manager@bestchoice.com' },
    update: {},
    create: {
      email: 'manager@bestchoice.com',
      password: hashedPassword,
      name: 'ผู้จัดการสาขาลาดพร้าว',
      role: 'BRANCH_MANAGER',
      branchId: branch1.id,
    },
  });

  const sales = await prisma.user.upsert({
    where: { email: 'sales@bestchoice.com' },
    update: {},
    create: {
      email: 'sales@bestchoice.com',
      password: hashedPassword,
      name: 'พนักงานขาย',
      role: 'SALES',
      branchId: branch1.id,
    },
  });

  const accountant = await prisma.user.upsert({
    where: { email: 'accountant@bestchoice.com' },
    update: {},
    create: {
      email: 'accountant@bestchoice.com',
      password: hashedPassword,
      name: 'ฝ่ายบัญชี',
      role: 'ACCOUNTANT',
      branchId: null,
    },
  });

  console.log('Users created:', owner.name, manager.name, sales.name, accountant.name);

  // System config defaults
  const configs = [
    { key: 'interest_rate', value: '0.08', label: 'อัตราดอกเบี้ยต่อเดือน (Flat rate)' },
    { key: 'min_down_payment_pct', value: '0.15', label: 'เงินดาวน์ขั้นต่ำ (%)' },
    { key: 'late_fee_per_day', value: '100', label: 'ค่าปรับจ่ายช้าต่อวัน (บาท)' },
    { key: 'late_fee_cap', value: '200', label: 'ค่าปรับสูงสุดต่องวด (บาท)' },
    { key: 'early_payoff_discount', value: '0.5', label: 'ส่วนลดปิดบัญชีก่อนกำหนด (%)' },
    { key: 'min_installment_months', value: '6', label: 'จำนวนงวดขั้นต่ำ (เดือน)' },
    { key: 'max_installment_months', value: '12', label: 'จำนวนงวดสูงสุด (เดือน)' },
    { key: 'overdue_days_threshold', value: '7', label: 'จำนวนวันค้างก่อนเปลี่ยนสถานะ OVERDUE' },
    { key: 'default_consecutive_months', value: '2', label: 'จำนวนงวดค้างติดต่อกันก่อน DEFAULT' },
    { key: 'grade_a_threshold', value: '90', label: 'เกณฑ์ Grade A (%)' },
    { key: 'grade_b_threshold', value: '70', label: 'เกณฑ์ Grade B (%)' },
    { key: 'grade_c_threshold', value: '50', label: 'เกณฑ์ Grade C (%)' },
  ];

  for (const config of configs) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: { value: config.value, label: config.label },
      create: config,
    });
  }

  console.log('System config created:', configs.length, 'entries');

  // Create default inspection template for phones
  const phoneTemplate = await prisma.inspectionTemplate.create({
    data: {
      name: 'ตรวจเช็คมือถือมือสอง',
      deviceType: 'PHONE',
      items: {
        create: [
          { category: 'ภายนอก', itemName: 'สภาพตัวเครื่อง (รอยขีดข่วน/บุบ)', scoreType: 'GRADE', isRequired: true, weight: 15, sortOrder: 1 },
          { category: 'ภายนอก', itemName: 'สภาพหน้าจอ (รอยร้าว/dead pixel)', scoreType: 'GRADE', isRequired: true, weight: 20, sortOrder: 2 },
          { category: 'ภายนอก', itemName: 'สภาพปุ่มกด (Power, Volume)', scoreType: 'PASS_FAIL', isRequired: true, weight: 5, sortOrder: 3 },
          { category: 'ภายนอก', itemName: 'ช่องชาร์จ', scoreType: 'PASS_FAIL', isRequired: true, weight: 5, sortOrder: 4 },
          { category: 'การทำงาน', itemName: 'หน้าจอสัมผัส (touch ทุกจุด)', scoreType: 'PASS_FAIL', isRequired: true, weight: 10, sortOrder: 5 },
          { category: 'การทำงาน', itemName: 'ลำโพง/ไมค์', scoreType: 'PASS_FAIL', isRequired: true, weight: 5, sortOrder: 6 },
          { category: 'การทำงาน', itemName: 'กล้องหน้า/กล้องหลัง', scoreType: 'PASS_FAIL', isRequired: true, weight: 5, sortOrder: 7 },
          { category: 'การทำงาน', itemName: 'Wi-Fi / Bluetooth', scoreType: 'PASS_FAIL', isRequired: true, weight: 5, sortOrder: 8 },
          { category: 'การทำงาน', itemName: 'GPS / NFC', scoreType: 'PASS_FAIL', isRequired: false, weight: 3, sortOrder: 9 },
          { category: 'การทำงาน', itemName: 'Face ID / สแกนนิ้ว', scoreType: 'PASS_FAIL', isRequired: true, weight: 5, sortOrder: 10 },
          { category: 'แบตเตอรี่', itemName: 'สุขภาพแบตเตอรี่ (Battery Health %)', scoreType: 'NUMBER', isRequired: true, weight: 10, sortOrder: 11 },
          { category: 'แบตเตอรี่', itemName: 'ชาร์จเข้า', scoreType: 'PASS_FAIL', isRequired: true, weight: 5, sortOrder: 12 },
          { category: 'ซอฟต์แวร์', itemName: 'รีเซ็ตเครื่องแล้ว', scoreType: 'PASS_FAIL', isRequired: true, weight: 2, sortOrder: 13 },
          { category: 'ซอฟต์แวร์', itemName: 'ปลดล็อค iCloud/Google Account', scoreType: 'PASS_FAIL', isRequired: true, weight: 3, sortOrder: 14 },
          { category: 'ซอฟต์แวร์', itemName: 'IMEI ไม่ถูก block', scoreType: 'PASS_FAIL', isRequired: true, weight: 2, sortOrder: 15 },
        ],
      },
    },
  });

  console.log('Inspection template created:', phoneTemplate.name);

  console.log('Seeding completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
