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
      contactName: 'คุณสมศรี วงศ์สุวรรณ',
      nickname: 'ABC',
      phone: '089-999-1111',
      phoneSecondary: '02-234-5678',
      lineId: 'abc_mobile',
      address: '100 ถ.เจริญกรุง เขตบางรัก กทม. 10500',
      taxId: '0105548012345',
      hasVat: true,
      notes: 'Supplier หลัก Apple - Authorized Reseller, สั่งล่วงหน้า 3 วัน',
    },
    {
      id: 'sup-002',
      name: 'Thai Phone Distributor Co., Ltd.',
      contactName: 'คุณวิทยา เจริญพร',
      nickname: 'Thai Phone',
      phone: '089-999-2222',
      phoneSecondary: '02-345-6789',
      lineId: 'thaiphone_dist',
      address: '200 ถ.พระราม 4 เขตคลองเตย กทม. 10110',
      taxId: '0105561023456',
      hasVat: true,
      notes: 'Supplier Samsung/Android ทุกรุ่น, มีเครดิต 30 วัน',
    },
    {
      id: 'sup-003',
      name: 'Mobile Accessories Plus',
      contactName: 'คุณนิดา พรหมมา',
      nickname: 'MAP',
      phone: '089-999-3333',
      lineId: 'nida_map',
      address: '300 ถ.สีลม เขตบางรัก กทม. 10500',
      taxId: '0105565034567',
      hasVat: false,
      notes: 'อุปกรณ์เสริม/เคส/ฟิล์มกระจก ราคาส่ง',
    },
    {
      id: 'sup-004',
      name: 'บริษัท สยามโมบาย เทรดดิ้ง จำกัด',
      contactName: 'คุณอนันต์ สยามรัฐ',
      nickname: 'สยามโมบาย',
      phone: '086-777-4444',
      phoneSecondary: '02-456-7890',
      lineId: 'siammobile_trading',
      address: '88/5 ถ.พญาไท แขวงถนนพญาไท เขตราชเทวี กทม. 10400',
      taxId: '0105557045678',
      hasVat: true,
      notes: 'มือถือ OPPO, Vivo, Realme ราคาดี เครดิต 15 วัน',
    },
    {
      id: 'sup-005',
      name: 'MBK Phone Center',
      contactName: 'คุณประยุทธ์ แซ่ลิ้ม',
      nickname: 'MBK',
      phone: '081-888-5555',
      lineId: 'mbk_phonecenter',
      address: 'ชั้น 4 ห้อง 4A-25 MBK Center ถ.พญาไท เขตปทุมวัน กทม. 10330',
      hasVat: false,
      notes: 'มือถือมือสองสภาพดี ราคาถูก รับเครื่องได้ทันที',
    },
    {
      id: 'sup-006',
      name: 'บริษัท ดิจิตอล โซลูชั่น จำกัด',
      contactName: 'คุณพิมพ์ลดา ศรีสุข',
      nickname: 'Digital Sol',
      phone: '092-666-6666',
      phoneSecondary: '02-567-8901',
      lineId: 'digitalsol_bkk',
      address: '55 อาคารไอทีสแควร์ ถ.แจ้งวัฒนะ แขวงทุ่งสองห้อง เขตหลักสี่ กทม. 10210',
      taxId: '0105563056789',
      hasVat: true,
      notes: 'Xiaomi, Huawei, OnePlus - นำเข้าตรง ราคา MBK -5%',
    },
    {
      id: 'sup-007',
      name: 'J&T Mobile Import',
      contactName: 'คุณจิราภา ตั้งศิริ',
      nickname: 'J&T',
      phone: '095-555-7777',
      phoneSecondary: '02-678-9012',
      lineId: 'jt_mobileimport',
      address: '123/45 ซ.นวมินทร์ 70 แขวงคลองกุ่ม เขตบึงกุ่ม กทม. 10230',
      taxId: '0105570067890',
      hasVat: true,
      notes: 'นำเข้ามือถือจากญี่ปุ่น/เกาหลี สินค้า Grade A เครดิต 7 วัน',
    },
    {
      id: 'sup-008',
      name: 'ร้านพี่หนึ่ง โทรศัพท์มือถือ',
      contactName: 'คุณหนึ่งฤทัย ใจเย็น',
      nickname: 'พี่หนึ่ง',
      phone: '063-444-8888',
      lineId: 'peenueng_mobile',
      address: 'ร้าน A12 ตลาดคลองถม เขตป้อมปราบฯ กทม. 10100',
      hasVat: false,
      notes: 'มือถือมือสอง iPhone เครื่องศูนย์ไทย ราคาต่อรองได้',
    },
    {
      id: 'sup-009',
      name: 'บริษัท แกดเจ็ท แอนด์ เกียร์ จำกัด',
      contactName: 'คุณธนกร วัฒนชัย',
      nickname: 'G&G',
      phone: '097-333-9999',
      phoneSecondary: '02-789-0123',
      lineId: 'gadget_gear_th',
      address: '999 ถ.ศรีนครินทร์ แขวงสวนหลวง เขตสวนหลวง กทม. 10250',
      taxId: '0105568078901',
      hasVat: true,
      notes: 'Tablet iPad/Samsung Tab/อุปกรณ์ IT ครบวงจร เครดิต 30 วัน',
    },
    {
      id: 'sup-010',
      name: 'iCare Refurbished',
      contactName: 'คุณศิริพร แจ่มใส',
      nickname: 'iCare',
      phone: '064-222-0000',
      lineId: 'icare_refurb',
      address: '77/3 ถ.รัชดาภิเษก แขวงดินแดง เขตดินแดง กทม. 10400',
      taxId: '0105572089012',
      hasVat: false,
      notes: 'iPhone Refurbished Grade A-B พร้อมรับประกัน 3 เดือน',
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
  // SUPPLIER PAYMENT METHODS
  // ============================================================
  const supplierPaymentMethods = [
    { id: 'spm-001', supplierId: 'sup-001', paymentMethod: 'BANK_TRANSFER', bankName: 'กสิกรไทย', bankAccountName: 'ABC Mobile Supply', bankAccountNumber: '123-4-56789-0', isDefault: true },
    { id: 'spm-002', supplierId: 'sup-001', paymentMethod: 'CREDIT', creditTermDays: 7, isDefault: false },
    { id: 'spm-003', supplierId: 'sup-002', paymentMethod: 'BANK_TRANSFER', bankName: 'ไทยพาณิชย์', bankAccountName: 'Thai Phone Distributor', bankAccountNumber: '222-3-44567-8', isDefault: true },
    { id: 'spm-004', supplierId: 'sup-002', paymentMethod: 'CREDIT', creditTermDays: 30, isDefault: false },
    { id: 'spm-005', supplierId: 'sup-004', paymentMethod: 'BANK_TRANSFER', bankName: 'กรุงเทพ', bankAccountName: 'บจ.สยามโมบาย เทรดดิ้ง', bankAccountNumber: '333-0-78901-2', isDefault: true },
    { id: 'spm-006', supplierId: 'sup-004', paymentMethod: 'CREDIT', creditTermDays: 15, isDefault: false },
    { id: 'spm-007', supplierId: 'sup-005', paymentMethod: 'CASH', isDefault: true },
    { id: 'spm-008', supplierId: 'sup-006', paymentMethod: 'BANK_TRANSFER', bankName: 'กรุงไทย', bankAccountName: 'บจ.ดิจิตอล โซลูชั่น', bankAccountNumber: '444-5-67890-1', isDefault: true },
    { id: 'spm-009', supplierId: 'sup-008', paymentMethod: 'CASH', isDefault: true },
    { id: 'spm-010', supplierId: 'sup-009', paymentMethod: 'BANK_TRANSFER', bankName: 'กสิกรไทย', bankAccountName: 'บจ.แกดเจ็ท แอนด์ เกียร์', bankAccountNumber: '555-6-78901-2', isDefault: true },
    { id: 'spm-011', supplierId: 'sup-009', paymentMethod: 'CREDIT', creditTermDays: 30, isDefault: false },
  ];

  for (const pm of supplierPaymentMethods) {
    await prisma.supplierPaymentMethod.upsert({
      where: { id: pm.id },
      update: {},
      create: pm,
    });
  }
  console.log('Supplier payment methods created:', supplierPaymentMethods.length, 'items');

  // ============================================================
  // SAMPLE PURCHASE ORDERS
  // ============================================================
  // PO-1: Apple order from ABC Mobile Supply (APPROVED, UNPAID)
  const po1 = await prisma.purchaseOrder.upsert({
    where: { id: 'po-001' },
    update: {},
    create: {
      id: 'po-001',
      poNumber: 'PO-2025-12-001',
      supplierId: 'sup-001',
      orderDate: new Date('2025-12-01'),
      expectedDate: new Date('2025-12-05'),
      dueDate: new Date('2025-12-08'),
      status: 'APPROVED',
      totalAmount: 214500,
      discount: 0,
      vatAmount: 15015,
      netAmount: 229515,
      paymentStatus: 'UNPAID',
      paymentMethod: 'BANK_TRANSFER',
      paidAmount: 0,
      notes: 'สั่ง iPhone 15 Pro Max เข้าสต็อกประจำเดือน',
      createdById: manager.id,
      approvedById: owner.id,
      items: {
        create: [
          { id: 'poi-001', brand: 'Apple', model: 'iPhone 15 Pro Max', storage: '256GB', category: 'PHONE_NEW', quantity: 3, unitPrice: 42900 },
          { id: 'poi-002', brand: 'Apple', model: 'iPhone 15 Pro', storage: '128GB', category: 'PHONE_NEW', quantity: 2, unitPrice: 38900, receivedQty: 0 },
        ],
      },
    },
  });
  console.log('PO-1 created:', po1.poNumber, '(APPROVED, UNPAID)');

  // PO-2: Samsung order from Thai Phone Distributor (FULLY_RECEIVED, FULLY_PAID)
  const po2 = await prisma.purchaseOrder.upsert({
    where: { id: 'po-002' },
    update: {},
    create: {
      id: 'po-002',
      poNumber: 'PO-2025-11-001',
      supplierId: 'sup-002',
      orderDate: new Date('2025-11-15'),
      expectedDate: new Date('2025-11-20'),
      dueDate: new Date('2025-12-15'),
      status: 'FULLY_RECEIVED',
      totalAmount: 105600,
      discount: 2000,
      vatAmount: 7252,
      netAmount: 110852,
      paymentStatus: 'FULLY_PAID',
      paymentMethod: 'BANK_TRANSFER',
      paidAmount: 110852,
      paymentNotes: 'โอนจ่ายครบ 25/11/2025',
      notes: 'สั่ง Samsung ล็อตพฤศจิกายน',
      createdById: owner.id,
      approvedById: owner.id,
      items: {
        create: [
          { id: 'poi-003', brand: 'Samsung', model: 'Galaxy S24 Ultra', storage: '256GB', category: 'PHONE_NEW', quantity: 2, unitPrice: 39900, receivedQty: 2 },
          { id: 'poi-004', brand: 'Samsung', model: 'Galaxy A55', storage: '128GB', category: 'PHONE_NEW', quantity: 2, unitPrice: 12900, receivedQty: 2 },
        ],
      },
    },
  });
  console.log('PO-2 created:', po2.poNumber, '(FULLY_RECEIVED, FULLY_PAID)');

  // PO-3: OPPO/Vivo from สยามโมบาย (PARTIALLY_RECEIVED, DEPOSIT_PAID)
  const po3 = await prisma.purchaseOrder.upsert({
    where: { id: 'po-003' },
    update: {},
    create: {
      id: 'po-003',
      poNumber: 'PO-2025-12-002',
      supplierId: 'sup-004',
      orderDate: new Date('2025-12-03'),
      expectedDate: new Date('2025-12-07'),
      dueDate: new Date('2025-12-18'),
      status: 'PARTIALLY_RECEIVED',
      totalAmount: 101940,
      discount: 0,
      vatAmount: 7135.8,
      netAmount: 109075.8,
      paymentStatus: 'DEPOSIT_PAID',
      paymentMethod: 'BANK_TRANSFER',
      paidAmount: 30000,
      paymentNotes: 'จ่ายมัดจำ 30,000',
      notes: 'สั่ง OPPO + Vivo เข้าสาขาลาดพร้าว',
      createdById: manager.id,
      approvedById: owner.id,
      items: {
        create: [
          { id: 'poi-005', brand: 'OPPO', model: 'Reno 11 Pro', storage: '256GB', category: 'PHONE_NEW', quantity: 3, unitPrice: 16990, receivedQty: 2 },
          { id: 'poi-006', brand: 'Vivo', model: 'V30 Pro', storage: '256GB', category: 'PHONE_NEW', quantity: 3, unitPrice: 16990, receivedQty: 1 },
        ],
      },
    },
  });
  console.log('PO-3 created:', po3.poNumber, '(PARTIALLY_RECEIVED, DEPOSIT_PAID)');

  // PO-4: Used iPhones from MBK (DRAFT, pending approval)
  const po4 = await prisma.purchaseOrder.upsert({
    where: { id: 'po-004' },
    update: {},
    create: {
      id: 'po-004',
      poNumber: 'PO-2025-12-003',
      supplierId: 'sup-005',
      orderDate: new Date('2025-12-05'),
      expectedDate: new Date('2025-12-05'),
      status: 'DRAFT',
      totalAmount: 87500,
      discount: 2500,
      vatAmount: 0,
      netAmount: 85000,
      paymentStatus: 'UNPAID',
      paymentMethod: 'CASH',
      paidAmount: 0,
      notes: 'มือสองจาก MBK ล็อตใหม่ ราคาต่อรองแล้ว',
      createdById: manager.id,
      items: {
        create: [
          { id: 'poi-007', brand: 'Apple', model: 'iPhone 14 Pro', storage: '128GB', category: 'PHONE_USED', quantity: 2, unitPrice: 22500 },
          { id: 'poi-008', brand: 'Apple', model: 'iPhone 13', storage: '128GB', category: 'PHONE_USED', quantity: 3, unitPrice: 14500 },
        ],
      },
    },
  });
  console.log('PO-4 created:', po4.poNumber, '(DRAFT, pending approval)');

  // PO-5: Xiaomi from ดิจิตอล โซลูชั่น (APPROVED, PARTIALLY_PAID)
  const po5 = await prisma.purchaseOrder.upsert({
    where: { id: 'po-005' },
    update: {},
    create: {
      id: 'po-005',
      poNumber: 'PO-2025-11-002',
      supplierId: 'sup-006',
      orderDate: new Date('2025-11-25'),
      expectedDate: new Date('2025-12-01'),
      dueDate: new Date('2025-12-25'),
      status: 'APPROVED',
      totalAmount: 104700,
      discount: 3000,
      vatAmount: 7119,
      netAmount: 108819,
      paymentStatus: 'PARTIALLY_PAID',
      paymentMethod: 'BANK_TRANSFER',
      paidAmount: 50000,
      paymentNotes: 'โอนแล้ว 50,000 จ่ายที่เหลือเมื่อรับของ',
      notes: 'Xiaomi + OnePlus เข้าสาขาบางแค',
      createdById: owner.id,
      approvedById: owner.id,
      items: {
        create: [
          { id: 'poi-009', brand: 'Xiaomi', model: '14 Ultra', storage: '512GB', category: 'PHONE_NEW', quantity: 2, unitPrice: 34900 },
          { id: 'poi-010', brand: 'OnePlus', model: '12', storage: '256GB', category: 'PHONE_NEW', quantity: 2, unitPrice: 17450 },
        ],
      },
    },
  });
  console.log('PO-5 created:', po5.poNumber, '(APPROVED, PARTIALLY_PAID)');

  // PO-6: Tablets from แกดเจ็ท แอนด์ เกียร์ (CANCELLED)
  const po6 = await prisma.purchaseOrder.upsert({
    where: { id: 'po-006' },
    update: {},
    create: {
      id: 'po-006',
      poNumber: 'PO-2025-10-001',
      supplierId: 'sup-009',
      orderDate: new Date('2025-10-20'),
      expectedDate: new Date('2025-10-28'),
      status: 'CANCELLED',
      totalAmount: 98700,
      discount: 0,
      vatAmount: 6909,
      netAmount: 105609,
      paymentStatus: 'UNPAID',
      paidAmount: 0,
      rejectReason: 'ราคาสูงกว่าที่ตกลง ยกเลิกสั่งใหม่',
      notes: 'Tablet ล็อตตุลาคม - ยกเลิกแล้ว',
      createdById: manager.id,
      approvedById: owner.id,
      items: {
        create: [
          { id: 'poi-011', brand: 'Apple', model: 'iPad Pro M4', storage: '256GB', category: 'TABLET', quantity: 2, unitPrice: 36900 },
          { id: 'poi-012', brand: 'Samsung', model: 'Galaxy Tab S9', storage: '128GB', category: 'TABLET', quantity: 1, unitPrice: 24900 },
        ],
      },
    },
  });
  console.log('PO-6 created:', po6.poNumber, '(CANCELLED)');

  // PO-7: Refurbished iPhones from iCare (FULLY_RECEIVED, FULLY_PAID)
  const po7 = await prisma.purchaseOrder.upsert({
    where: { id: 'po-007' },
    update: {},
    create: {
      id: 'po-007',
      poNumber: 'PO-2025-11-003',
      supplierId: 'sup-010',
      orderDate: new Date('2025-11-10'),
      expectedDate: new Date('2025-11-12'),
      status: 'FULLY_RECEIVED',
      totalAmount: 57000,
      discount: 2000,
      vatAmount: 0,
      netAmount: 55000,
      paymentStatus: 'FULLY_PAID',
      paymentMethod: 'CASH',
      paidAmount: 55000,
      paymentNotes: 'จ่ายเงินสดตอนรับของ',
      notes: 'iPhone Refurbished Grade A เข้าสาขารามคำแหง',
      createdById: owner.id,
      approvedById: owner.id,
      items: {
        create: [
          { id: 'poi-013', brand: 'Apple', model: 'iPhone 13 Pro', storage: '128GB', category: 'PHONE_USED', quantity: 2, unitPrice: 18500, receivedQty: 2 },
          { id: 'poi-014', brand: 'Apple', model: 'iPhone 12', storage: '64GB', category: 'PHONE_USED', quantity: 2, unitPrice: 10000, receivedQty: 2 },
        ],
      },
    },
  });
  console.log('PO-7 created:', po7.poNumber, '(FULLY_RECEIVED, FULLY_PAID)');

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

  // ============================================================
  // DEFAULT NOTIFICATION TEMPLATES
  // ============================================================
  const notificationTemplates = [
    {
      key: 'notification_template_payment_reminder_line',
      value: JSON.stringify({
        name: 'แจ้งเตือนชำระเงิน (LINE)',
        eventType: 'PAYMENT_REMINDER',
        channel: 'LINE',
        subject: 'แจ้งเตือนค่างวด',
        messageTemplate: 'สวัสดีค่ะ คุณ{customer_name}\nแจ้งเตือน: ค่างวดสัญญา {contract_number}\nจำนวน {amount} บาท\nครบกำหนดชำระ {due_date}\nกรุณาชำระตามกำหนด ขอบคุณค่ะ - Best Choice',
        description: 'ส่งเตือนผ่าน LINE ก่อนครบกำหนดชำระ 1-3 วัน',
        isActive: true,
      }),
      label: 'Template: แจ้งเตือนชำระเงิน (LINE)',
    },
    {
      key: 'notification_template_payment_reminder_sms',
      value: JSON.stringify({
        name: 'แจ้งเตือนชำระเงิน (SMS)',
        eventType: 'PAYMENT_REMINDER',
        channel: 'SMS',
        subject: 'แจ้งเตือนค่างวด',
        messageTemplate: 'BestChoice: คุณ{customer_name} ค่างวดสัญญา {contract_number} จำนวน {amount} บาท ครบกำหนด {due_date} กรุณาชำระตามกำหนด',
        description: 'ส่งเตือนผ่าน SMS สำหรับลูกค้าที่ไม่มี LINE',
        isActive: true,
      }),
      label: 'Template: แจ้งเตือนชำระเงิน (SMS)',
    },
    {
      key: 'notification_template_overdue_notice_line',
      value: JSON.stringify({
        name: 'แจ้งค้างชำระ (LINE)',
        eventType: 'OVERDUE_NOTICE',
        channel: 'LINE',
        subject: 'แจ้งค้างชำระ',
        messageTemplate: 'แจ้งเตือน: คุณ{customer_name}\nค่างวดสัญญา {contract_number} เลยกำหนดชำระ {days_overdue} วัน\nยอมค้างชำระ {amount} บาท (รวมค่าปรับ)\nกรุณาชำระโดยเร็ว - Best Choice',
        description: 'แจ้งเตือนค้างชำระผ่าน LINE วันที่ 1, 3, 7 หลังเลยกำหนด',
        isActive: true,
      }),
      label: 'Template: แจ้งค้างชำระ (LINE)',
    },
    {
      key: 'notification_template_overdue_notice_sms',
      value: JSON.stringify({
        name: 'แจ้งค้างชำระ (SMS)',
        eventType: 'OVERDUE_NOTICE',
        channel: 'SMS',
        subject: 'แจ้งค้างชำระ',
        messageTemplate: 'BestChoice: คุณ{customer_name} ค่างวดสัญญา {contract_number} เลยกำหนด {days_overdue} วัน ค้างชำระ {amount} บาท กรุณาชำระโดยเร็ว',
        description: 'แจ้งเตือนค้างชำระผ่าน SMS',
        isActive: true,
      }),
      label: 'Template: แจ้งค้างชำระ (SMS)',
    },
    {
      key: 'notification_template_payment_success_line',
      value: JSON.stringify({
        name: 'ยืนยันการชำระเงิน (LINE)',
        eventType: 'PAYMENT_SUCCESS',
        channel: 'LINE',
        subject: 'ชำระเงินสำเร็จ',
        messageTemplate: 'ขอบคุณค่ะ คุณ{customer_name}\nรับชำระค่างวดสัญญา {contract_number}\nจำนวน {amount} บาท เรียบร้อยแล้ว\nงวมคงเหลือ {remaining_installments} งวด\nขอบคุณที่ชำระตรงเวลาค่ะ - Best Choice',
        description: 'ยืนยันการชำระเงินสำเร็จผ่าน LINE',
        isActive: true,
      }),
      label: 'Template: ยืนยันการชำระเงิน (LINE)',
    },
    {
      key: 'notification_template_contract_default_line',
      value: JSON.stringify({
        name: 'แจ้งผิดนัดสัญญา (LINE)',
        eventType: 'CONTRACT_DEFAULT',
        channel: 'LINE',
        subject: 'แจ้งผิดนัดชำระ',
        messageTemplate: 'แจ้งเตือนสำคัญ: คุณ{customer_name}\nสัญญา {contract_number} ถูกเปลี่ยนสถานะเป็นผิดนัดชำระ\nเนื่องจากค้างชำระติดต่อกันเกิน 2 งวด\nกรุณาติดต่อสาขาเพื่อชำระ หรือโทร {branch_phone}\n- Best Choice',
        description: 'แจ้งเตือนเมื่อสัญญาเปลี่ยนเป็นสถานะ DEFAULT',
        isActive: true,
      }),
      label: 'Template: แจ้งผิดนัดสัญญา (LINE)',
    },
  ];

  for (const t of notificationTemplates) {
    await prisma.systemConfig.upsert({
      where: { key: t.key },
      update: { value: t.value, label: t.label },
      create: t,
    });
  }
  console.log('Notification templates created:', notificationTemplates.length, 'templates');

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
