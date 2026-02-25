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

  // ============================================================
  // SAMPLE SUPPLIERS
  // ============================================================
  const suppliers = [
    {
      id: 'sup-001',
      name: 'ABC Mobile Supply',
      contactName: 'คุณสมศรี',
      phone: '089-999-1111',
      address: '100 ถ.เจริญกรุง เขตบางรัก กทม. 10500',
      notes: 'Supplier หลัก Apple',
    },
    {
      id: 'sup-002',
      name: 'Thai Phone Distributor',
      contactName: 'คุณวิทยา',
      phone: '089-999-2222',
      address: '200 ถ.พระราม 4 เขตคลองเตย กทม. 10110',
      notes: 'Supplier Samsung/Android',
    },
    {
      id: 'sup-003',
      name: 'Mobile Accessories Plus',
      contactName: 'คุณนิดา',
      phone: '089-999-3333',
      address: '300 ถ.สีลม เขตบางรัก กทม. 10500',
      notes: 'อุปกรณ์เสริม/เคส',
    },
  ];

  for (const s of suppliers) {
    await prisma.supplier.upsert({
      where: { id: s.id },
      update: {},
      create: s,
    });
  }
  console.log('Suppliers created:', suppliers.length, 'items');

  // ============================================================
  // SAMPLE PRODUCTS
  // ============================================================
  const products = [
    {
      id: 'prod-001',
      name: 'iPhone 15 Pro Max 256GB',
      brand: 'Apple',
      model: 'iPhone 15 Pro Max',
      imeiSerial: '354567890123456',
      category: 'PHONE_NEW' as const,
      costPrice: 42900,
      branchId: branch1.id,
      status: 'IN_STOCK' as const,
      conditionGrade: null,
    },
    {
      id: 'prod-002',
      name: 'iPhone 14 Pro 128GB',
      brand: 'Apple',
      model: 'iPhone 14 Pro',
      imeiSerial: '354567890123457',
      category: 'PHONE_USED' as const,
      costPrice: 28500,
      branchId: branch1.id,
      status: 'IN_STOCK' as const,
      conditionGrade: 'A' as const,
    },
    {
      id: 'prod-003',
      name: 'Samsung Galaxy S24 Ultra 256GB',
      brand: 'Samsung',
      model: 'Galaxy S24 Ultra',
      imeiSerial: '354567890123458',
      category: 'PHONE_NEW' as const,
      costPrice: 39900,
      branchId: branch1.id,
      status: 'SOLD_INSTALLMENT' as const,
      conditionGrade: null,
    },
    {
      id: 'prod-004',
      name: 'Samsung Galaxy A55 128GB',
      brand: 'Samsung',
      model: 'Galaxy A55',
      imeiSerial: '354567890123459',
      category: 'PHONE_NEW' as const,
      costPrice: 12900,
      branchId: branch2.id,
      status: 'IN_STOCK' as const,
      conditionGrade: null,
    },
    {
      id: 'prod-005',
      name: 'iPhone 13 128GB',
      brand: 'Apple',
      model: 'iPhone 13',
      imeiSerial: '354567890123460',
      category: 'PHONE_USED' as const,
      costPrice: 15500,
      branchId: branch2.id,
      status: 'SOLD_INSTALLMENT' as const,
      conditionGrade: 'B' as const,
    },
    {
      id: 'prod-006',
      name: 'OPPO Reno 11 Pro 256GB',
      brand: 'OPPO',
      model: 'Reno 11 Pro',
      imeiSerial: '354567890123461',
      category: 'PHONE_NEW' as const,
      costPrice: 16990,
      branchId: branch1.id,
      status: 'IN_STOCK' as const,
      conditionGrade: null,
    },
    {
      id: 'prod-007',
      name: 'Xiaomi 14 Ultra 512GB',
      brand: 'Xiaomi',
      model: '14 Ultra',
      imeiSerial: '354567890123462',
      category: 'PHONE_NEW' as const,
      costPrice: 34900,
      branchId: branch3.id,
      status: 'IN_STOCK' as const,
      conditionGrade: null,
    },
    {
      id: 'prod-008',
      name: 'iPad Pro M4 11" 256GB',
      brand: 'Apple',
      model: 'iPad Pro M4',
      imeiSerial: '354567890123463',
      category: 'TABLET' as const,
      costPrice: 36900,
      branchId: branch3.id,
      status: 'IN_STOCK' as const,
      conditionGrade: null,
    },
    {
      id: 'prod-009',
      name: 'Samsung Galaxy Tab S9 128GB',
      brand: 'Samsung',
      model: 'Galaxy Tab S9',
      imeiSerial: '354567890123464',
      category: 'TABLET' as const,
      costPrice: 24900,
      branchId: branch1.id,
      status: 'SOLD_INSTALLMENT' as const,
      conditionGrade: null,
    },
    {
      id: 'prod-010',
      name: 'iPhone 12 64GB',
      brand: 'Apple',
      model: 'iPhone 12',
      imeiSerial: '354567890123465',
      category: 'PHONE_USED' as const,
      costPrice: 9500,
      branchId: branch2.id,
      status: 'RESERVED' as const,
      conditionGrade: 'C' as const,
    },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: {},
      create: p,
    });
  }
  console.log('Products created:', products.length, 'items');

  // ============================================================
  // SAMPLE CUSTOMERS
  // ============================================================
  const customers = [
    {
      id: 'cust-001',
      nationalId: 'ENC_1100100100001',
      name: 'สมชาย ใจดี',
      phone: '081-111-1111',
      phoneSecondary: '02-111-1112',
      lineId: 'somchai_j',
      addressIdCard: '11 ซ.ลาดพร้าว 15 แขวงจอมพล เขตจตุจักร กทม. 10900',
      addressCurrent: '11 ซ.ลาดพร้าว 15 แขวงจอมพล เขตจตุจักร กทม. 10900',
      occupation: 'พนักงานบริษัท',
      workplace: 'บจก. ไทยพาณิชย์',
    },
    {
      id: 'cust-002',
      nationalId: 'ENC_1100100100002',
      name: 'สมหญิง รักเรียน',
      phone: '082-222-2222',
      lineId: 'somying_r',
      addressIdCard: '22 ถ.รามคำแหง แขวงหัวหมาก เขตบางกะปิ กทม. 10240',
      addressCurrent: '22 ถ.รามคำแหง แขวงหัวหมาก เขตบางกะปิ กทม. 10240',
      occupation: 'ค้าขาย',
      workplace: 'ร้านค้าส่ง ตลาดนัด',
    },
    {
      id: 'cust-003',
      nationalId: 'ENC_1100100100003',
      name: 'วิชัย มั่งมี',
      phone: '083-333-3333',
      addressIdCard: '33 ถ.เพชรเกษม แขวงบางแค เขตบางแค กทม. 10160',
      occupation: 'รับราชการ',
      workplace: 'กรมสรรพากร',
    },
    {
      id: 'cust-004',
      nationalId: 'ENC_1100100100004',
      name: 'นภา แก้วใส',
      phone: '084-444-4444',
      lineId: 'napa_k',
      addressIdCard: '44 ซ.สุขุมวิท 71 แขวงคลองตัน เขตวัฒนา กทม. 10110',
      addressCurrent: '44 ซ.สุขุมวิท 71 แขวงคลองตัน เขตวัฒนา กทม. 10110',
      occupation: 'ฟรีแลนซ์',
    },
    {
      id: 'cust-005',
      nationalId: 'ENC_1100100100005',
      name: 'ประเสริฐ ทองคำ',
      phone: '085-555-5555',
      addressIdCard: '55 ถ.พหลโยธิน แขวงจตุจักร เขตจตุจักร กทม. 10900',
      occupation: 'พนักงานโรงงาน',
      workplace: 'บมจ. ปูนซิเมนต์ไทย',
    },
  ];

  for (const c of customers) {
    await prisma.customer.upsert({
      where: { id: c.id },
      update: {},
      create: c,
    });
  }
  console.log('Customers created:', customers.length, 'people');

  // ============================================================
  // SAMPLE CONTRACTS + PAYMENTS
  // ============================================================
  // Contract 1: Samsung Galaxy S24 Ultra - สมชาย (ACTIVE, 10 months)
  const contract1 = await prisma.contract.upsert({
    where: { id: 'cont-001' },
    update: {},
    create: {
      id: 'cont-001',
      contractNumber: 'BC-2025-0001',
      customerId: 'cust-001',
      productId: 'prod-003',
      branchId: branch1.id,
      salespersonId: sales.id,
      planType: 'STORE_DIRECT',
      sellingPrice: 49900,
      downPayment: 9900,
      interestRate: 0.08,
      totalMonths: 10,
      financedAmount: 40000,
      interestTotal: 32000,
      monthlyPayment: 7200,
      status: 'ACTIVE',
    },
  });

  // Generate payments for contract 1 (3 paid, 7 pending)
  for (let i = 1; i <= 10; i++) {
    const dueDate = new Date(2025, i, 15); // 15th of each month starting Feb 2025
    const isPaid = i <= 3;
    await prisma.payment.upsert({
      where: { id: `pay-001-${String(i).padStart(2, '0')}` },
      update: {},
      create: {
        id: `pay-001-${String(i).padStart(2, '0')}`,
        contractId: contract1.id,
        installmentNo: i,
        dueDate,
        amountDue: 7200,
        amountPaid: isPaid ? 7200 : 0,
        paidDate: isPaid ? new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate() - 2) : null,
        paymentMethod: isPaid ? 'BANK_TRANSFER' : null,
        status: isPaid ? 'PAID' : (dueDate < new Date() ? 'OVERDUE' : 'PENDING'),
        recordedById: isPaid ? sales.id : null,
      },
    });
  }
  console.log('Contract 1 created:', contract1.contractNumber, '(ACTIVE, 3/10 paid)');

  // Contract 2: iPhone 13 - สมหญิง (ACTIVE, 6 months)
  const contract2 = await prisma.contract.upsert({
    where: { id: 'cont-002' },
    update: {},
    create: {
      id: 'cont-002',
      contractNumber: 'BC-2025-0002',
      customerId: 'cust-002',
      productId: 'prod-005',
      branchId: branch2.id,
      salespersonId: sales.id,
      planType: 'STORE_DIRECT',
      sellingPrice: 19900,
      downPayment: 3900,
      interestRate: 0.08,
      totalMonths: 6,
      financedAmount: 16000,
      interestTotal: 7680,
      monthlyPayment: 3947,
      status: 'ACTIVE',
    },
  });

  // Generate payments for contract 2 (5 paid, 1 pending)
  for (let i = 1; i <= 6; i++) {
    const dueDate = new Date(2025, i - 1, 1); // 1st of each month starting Jan 2025
    const isPaid = i <= 5;
    await prisma.payment.upsert({
      where: { id: `pay-002-${String(i).padStart(2, '0')}` },
      update: {},
      create: {
        id: `pay-002-${String(i).padStart(2, '0')}`,
        contractId: contract2.id,
        installmentNo: i,
        dueDate,
        amountDue: 3947,
        amountPaid: isPaid ? 3947 : 0,
        paidDate: isPaid ? new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()) : null,
        paymentMethod: isPaid ? 'CASH' : null,
        status: isPaid ? 'PAID' : 'PENDING',
        recordedById: isPaid ? sales.id : null,
      },
    });
  }
  console.log('Contract 2 created:', contract2.contractNumber, '(ACTIVE, 5/6 paid)');

  // Contract 3: Samsung Galaxy Tab S9 - วิชัย (OVERDUE, 8 months)
  const contract3 = await prisma.contract.upsert({
    where: { id: 'cont-003' },
    update: {},
    create: {
      id: 'cont-003',
      contractNumber: 'BC-2025-0003',
      customerId: 'cust-003',
      productId: 'prod-009',
      branchId: branch1.id,
      salespersonId: sales.id,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: 29900,
      downPayment: 5900,
      interestRate: 0.08,
      totalMonths: 8,
      financedAmount: 24000,
      interestTotal: 15360,
      monthlyPayment: 4920,
      status: 'OVERDUE',
    },
  });

  // Generate payments for contract 3 (2 paid, 6 pending with some overdue)
  for (let i = 1; i <= 8; i++) {
    const dueDate = new Date(2025, i, 10); // 10th of each month
    const isPaid = i <= 2;
    const isOverdue = !isPaid && dueDate < new Date();
    await prisma.payment.upsert({
      where: { id: `pay-003-${String(i).padStart(2, '0')}` },
      update: {},
      create: {
        id: `pay-003-${String(i).padStart(2, '0')}`,
        contractId: contract3.id,
        installmentNo: i,
        dueDate,
        amountDue: 4920,
        amountPaid: isPaid ? 4920 : 0,
        paidDate: isPaid ? new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate() + 1) : null,
        paymentMethod: isPaid ? 'QR_EWALLET' : null,
        lateFee: isOverdue ? 200 : 0,
        status: isPaid ? 'PAID' : (isOverdue ? 'OVERDUE' : 'PENDING'),
        recordedById: isPaid ? sales.id : null,
      },
    });
  }
  console.log('Contract 3 created:', contract3.contractNumber, '(OVERDUE, 2/8 paid)');

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
