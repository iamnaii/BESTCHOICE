import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Resetting & Seeding database ===');

  // ============================================================
  // STEP 0: DELETE ALL DATA (reverse dependency order)
  // ============================================================
  console.log('Deleting all existing data...');
  await prisma.stockCountItem.deleteMany();
  await prisma.stockCount.deleteMany();
  await prisma.branchReceivingItem.deleteMany();
  await prisma.branchReceiving.deleteMany();
  await prisma.stockAlert.deleteMany();
  await prisma.reorderPoint.deleteMany();
  await prisma.stockAdjustment.deleteMany();
  await prisma.stockTransfer.deleteMany();
  await prisma.inspectionResult.deleteMany();
  await prisma.inspection.deleteMany();
  await prisma.inspectionTemplateItem.deleteMany();
  await prisma.inspectionTemplate.deleteMany();
  await prisma.repossession.deleteMany();
  await prisma.callLog.deleteMany();
  await prisma.notificationLog.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.signature.deleteMany();
  await prisma.eDocument.deleteMany();
  await prisma.contractDocument.deleteMany();
  await prisma.creditCheck.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.interestConfig.deleteMany();
  await prisma.productPrice.deleteMany();
  await prisma.goodsReceivingItem.deleteMany();
  await prisma.goodsReceiving.deleteMany();
  await prisma.pOItem.deleteMany();
  await prisma.product.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.supplierPaymentMethod.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.systemConfig.deleteMany();
  await prisma.contractTemplate.deleteMany();
  await prisma.stickerTemplate.deleteMany();
  console.log('All data deleted.');

  // ============================================================
  // STEP 1: BRANCHES
  // ============================================================
  const hashedPassword = await bcrypt.hash('admin1234', 10);

  const branch1 = await prisma.branch.create({
    data: {
      id: 'branch-001',
      name: 'คลังสินค้าหลัก (Main Warehouse)',
      location: '99 ถ.วิภาวดีรังสิต แขวงจตุจักร เขตจตุจักร กทม. 10900',
      phone: '02-100-0000',
      isMainWarehouse: true,
    },
  });

  const branch2 = await prisma.branch.create({
    data: {
      id: 'branch-002',
      name: 'สาขาลาดพร้าว',
      location: '123 ถ.ลาดพร้าว แขวงจอมพล เขตจตุจักร กทม. 10900',
      phone: '02-111-1111',
    },
  });

  const branch3 = await prisma.branch.create({
    data: {
      id: 'branch-003',
      name: 'สาขารามคำแหง',
      location: '456 ถ.รามคำแหง แขวงหัวหมาก เขตบางกะปิ กทม. 10240',
      phone: '02-222-2222',
    },
  });

  const branch4 = await prisma.branch.create({
    data: {
      id: 'branch-004',
      name: 'สาขาบางแค',
      location: '789 ถ.เพชรเกษม แขวงบางแค เขตบางแค กทม. 10160',
      phone: '02-333-3333',
    },
  });

  console.log('Branches created: 4 (1 warehouse + 3 branches)');

  // ============================================================
  // STEP 2: USERS (6 users across branches)
  // ============================================================
  const owner = await prisma.user.create({
    data: { id: 'user-001', email: 'admin@bestchoice.com', password: hashedPassword, name: 'สุรชัย เจ้าของร้าน', role: 'OWNER', branchId: branch1.id },
  });
  const mgr1 = await prisma.user.create({
    data: { id: 'user-002', email: 'manager.ladprao@bestchoice.com', password: hashedPassword, name: 'วิภา ผู้จัดการลาดพร้าว', role: 'BRANCH_MANAGER', branchId: branch2.id },
  });
  const mgr2 = await prisma.user.create({
    data: { id: 'user-003', email: 'manager.ramkham@bestchoice.com', password: hashedPassword, name: 'ธนา ผู้จัดการรามคำแหง', role: 'BRANCH_MANAGER', branchId: branch3.id },
  });
  const sales1 = await prisma.user.create({
    data: { id: 'user-004', email: 'sales1@bestchoice.com', password: hashedPassword, name: 'สมศักดิ์ พนักงานขาย', role: 'SALES', branchId: branch2.id },
  });
  const sales2 = await prisma.user.create({
    data: { id: 'user-005', email: 'sales2@bestchoice.com', password: hashedPassword, name: 'อารียา พนักงานขาย', role: 'SALES', branchId: branch3.id },
  });
  const accountant = await prisma.user.create({
    data: { id: 'user-006', email: 'accountant@bestchoice.com', password: hashedPassword, name: 'พิมพ์ใจ ฝ่ายบัญชี', role: 'ACCOUNTANT', branchId: null },
  });
  const sales3 = await prisma.user.create({
    data: { id: 'user-007', email: 'sales3@bestchoice.com', password: hashedPassword, name: 'กิตติ พนักงานขาย', role: 'SALES', branchId: branch4.id },
  });
  const mgr3 = await prisma.user.create({
    data: { id: 'user-008', email: 'manager.bangkhae@bestchoice.com', password: hashedPassword, name: 'ประภา ผู้จัดการบางแค', role: 'BRANCH_MANAGER', branchId: branch4.id },
  });
  console.log('Users created: 8');


  // ============================================================
  // STEP 3: SYSTEM CONFIG
  // ============================================================
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
    { key: 'notification_template_payment_reminder_line', value: JSON.stringify({ name: 'แจ้งเตือนชำระเงิน (LINE)', eventType: 'PAYMENT_REMINDER', channel: 'LINE', subject: 'แจ้งเตือนค่างวด', messageTemplate: 'สวัสดีค่ะ คุณ{customer_name}\nค่างวด {contract_number} จำนวน {amount} บาท ครบกำหนด {due_date}\n- Best Choice', isActive: true }), label: 'Template: แจ้งเตือนชำระเงิน (LINE)' },
    { key: 'notification_template_payment_reminder_sms', value: JSON.stringify({ name: 'แจ้งเตือนชำระเงิน (SMS)', eventType: 'PAYMENT_REMINDER', channel: 'SMS', messageTemplate: 'BestChoice: คุณ{customer_name} ค่างวด {contract_number} {amount}บาท ครบกำหนด {due_date}', isActive: true }), label: 'Template: แจ้งเตือนชำระเงิน (SMS)' },
    { key: 'notification_template_overdue_notice_line', value: JSON.stringify({ name: 'แจ้งค้างชำระ (LINE)', eventType: 'OVERDUE_NOTICE', channel: 'LINE', messageTemplate: 'แจ้งเตือน: คุณ{customer_name} ค่างวด {contract_number} เลยกำหนด {days_overdue} วัน ยอด {amount} บาท\n- Best Choice', isActive: true }), label: 'Template: แจ้งค้างชำระ (LINE)' },
    { key: 'notification_template_payment_success_line', value: JSON.stringify({ name: 'ยืนยันชำระเงิน (LINE)', eventType: 'PAYMENT_SUCCESS', channel: 'LINE', messageTemplate: 'ขอบคุณค่ะ คุณ{customer_name} ชำระ {contract_number} {amount}บาท สำเร็จ คงเหลือ {remaining_installments} งวด\n- Best Choice', isActive: true }), label: 'Template: ยืนยันชำระเงิน (LINE)' },
    { key: 'notification_template_contract_default_line', value: JSON.stringify({ name: 'แจ้งผิดนัด (LINE)', eventType: 'CONTRACT_DEFAULT', channel: 'LINE', messageTemplate: 'สำคัญ: คุณ{customer_name} สัญญา {contract_number} เปลี่ยนสถานะผิดนัดชำระ กรุณาติดต่อสาขา {branch_phone}\n- Best Choice', isActive: true }), label: 'Template: แจ้งผิดนัดสัญญา (LINE)' },
  ];
  for (const c of configs) { await prisma.systemConfig.create({ data: c }); }
  console.log('SystemConfig created:', configs.length);

  // ============================================================
  // STEP 4: SUPPLIERS (10)
  // ============================================================
  const suppliersData = [
    { id: 'sup-001', name: 'ABC Mobile Supply', contactName: 'คุณสมศรี วงศ์สุวรรณ', nickname: 'ABC', phone: '089-999-1111', phoneSecondary: '02-234-5678', lineId: 'abc_mobile', address: '100 ถ.เจริญกรุง เขตบางรัก กทม. 10500', taxId: '0105548012345', hasVat: true, notes: 'Apple Authorized Reseller' },
    { id: 'sup-002', name: 'iStore Premium Co., Ltd.', contactName: 'คุณวิทยา เจริญพร', nickname: 'iStore', phone: '089-999-2222', phoneSecondary: '02-345-6789', lineId: 'istore_prem', address: '200 ถ.พระราม 4 เขตคลองเตย กทม. 10110', taxId: '0105561023456', hasVat: true, notes: 'Apple Premium Reseller เครดิต 30 วัน' },
    { id: 'sup-003', name: 'Mobile Accessories Plus', contactName: 'คุณนิดา พรหมมา', nickname: 'MAP', phone: '089-999-3333', lineId: 'nida_map', address: '300 ถ.สีลม เขตบางรัก กทม. 10500', taxId: '0105565034567', hasVat: false, notes: 'อุปกรณ์เสริม/เคส/ฟิล์ม ราคาส่ง' },
    { id: 'sup-004', name: 'บจก. แอปเปิล เซ็นทรัล ซัพพลาย', contactName: 'คุณอนันต์ สยามรัฐ', nickname: 'ACS', phone: '086-777-4444', phoneSecondary: '02-456-7890', lineId: 'acs_apple', address: '88/5 ถ.พญาไท เขตราชเทวี กทม. 10400', taxId: '0105557045678', hasVat: true, notes: 'Apple iPhone ทุกรุ่น เครดิต 15 วัน' },
    { id: 'sup-005', name: 'MBK Phone Center', contactName: 'คุณประยุทธ์ แซ่ลิ้ม', nickname: 'MBK', phone: '081-888-5555', lineId: 'mbk_phone', address: 'ชั้น 4 MBK Center ถ.พญาไท เขตปทุมวัน กทม. 10330', hasVat: false, notes: 'มือสองสภาพดี รับเครื่องทันที' },
    { id: 'sup-006', name: 'บจก. ไอโฟน พลัส', contactName: 'คุณพิมพ์ลดา ศรีสุข', nickname: 'iPhone+', phone: '092-666-6666', phoneSecondary: '02-567-8901', lineId: 'iphoneplus', address: '55 อาคารไอทีสแควร์ ถ.แจ้งวัฒนะ เขตหลักสี่ กทม. 10210', taxId: '0105563056789', hasVat: true, notes: 'Apple iPhone/iPad นำเข้าตรง' },
    { id: 'sup-007', name: 'J&T Mobile Import', contactName: 'คุณจิราภา ตั้งศิริ', nickname: 'J&T', phone: '095-555-7777', phoneSecondary: '02-678-9012', lineId: 'jt_mobile', address: '123/45 ซ.นวมินทร์ 70 เขตบึงกุ่ม กทม. 10230', taxId: '0105570067890', hasVat: true, notes: 'นำเข้าจากญี่ปุ่น/เกาหลี Grade A เครดิต 7 วัน' },
    { id: 'sup-008', name: 'ร้านพี่หนึ่ง โทรศัพท์มือถือ', contactName: 'คุณหนึ่งฤทัย ใจเย็น', nickname: 'พี่หนึ่ง', phone: '063-444-8888', lineId: 'peenueng', address: 'ร้าน A12 ตลาดคลองถม เขตป้อมปราบฯ กทม. 10100', hasVat: false, notes: 'iPhone มือสอง เครื่องศูนย์ไทย' },
    { id: 'sup-009', name: 'บจก. แกดเจ็ท แอนด์ เกียร์', contactName: 'คุณธนกร วัฒนชัย', nickname: 'G&G', phone: '097-333-9999', phoneSecondary: '02-789-0123', lineId: 'gadget_gear', address: '999 ถ.ศรีนครินทร์ เขตสวนหลวง กทม. 10250', taxId: '0105568078901', hasVat: true, notes: 'iPad ทุกรุ่น เครดิต 30 วัน' },
    { id: 'sup-010', name: 'iCare Refurbished', contactName: 'คุณศิริพร แจ่มใส', nickname: 'iCare', phone: '064-222-0000', lineId: 'icare_refurb', address: '77/3 ถ.รัชดาภิเษก เขตดินแดง กทม. 10400', taxId: '0105572089012', hasVat: false, notes: 'iPhone Refurbished Grade A-B รับประกัน 3 เดือน' },
  ];
  for (const s of suppliersData) { await prisma.supplier.create({ data: s }); }
  console.log('Suppliers created: 10');

  // ============================================================
  // STEP 5: SUPPLIER PAYMENT METHODS (11)
  // ============================================================
  const spmData = [
    { id: 'spm-001', supplierId: 'sup-001', paymentMethod: 'BANK_TRANSFER', bankName: 'กสิกรไทย', bankAccountName: 'ABC Mobile Supply', bankAccountNumber: '123-4-56789-0', isDefault: true },
    { id: 'spm-002', supplierId: 'sup-001', paymentMethod: 'CREDIT', creditTermDays: 7, isDefault: false },
    { id: 'spm-003', supplierId: 'sup-002', paymentMethod: 'BANK_TRANSFER', bankName: 'ไทยพาณิชย์', bankAccountName: 'iStore Premium', bankAccountNumber: '222-3-44567-8', isDefault: true },
    { id: 'spm-004', supplierId: 'sup-002', paymentMethod: 'CREDIT', creditTermDays: 30, isDefault: false },
    { id: 'spm-005', supplierId: 'sup-004', paymentMethod: 'BANK_TRANSFER', bankName: 'กรุงเทพ', bankAccountName: 'บจก.แอปเปิล เซ็นทรัล ซัพพลาย', bankAccountNumber: '333-0-78901-2', isDefault: true },
    { id: 'spm-006', supplierId: 'sup-004', paymentMethod: 'CREDIT', creditTermDays: 15, isDefault: false },
    { id: 'spm-007', supplierId: 'sup-005', paymentMethod: 'CASH', isDefault: true },
    { id: 'spm-008', supplierId: 'sup-006', paymentMethod: 'BANK_TRANSFER', bankName: 'กรุงไทย', bankAccountName: 'บจก.ไอโฟน พลัส', bankAccountNumber: '444-5-67890-1', isDefault: true },
    { id: 'spm-009', supplierId: 'sup-008', paymentMethod: 'CASH', isDefault: true },
    { id: 'spm-010', supplierId: 'sup-009', paymentMethod: 'BANK_TRANSFER', bankName: 'กสิกรไทย', bankAccountName: 'บจก.แกดเจ็ท แอนด์ เกียร์', bankAccountNumber: '555-6-78901-2', isDefault: true },
    { id: 'spm-011', supplierId: 'sup-009', paymentMethod: 'CREDIT', creditTermDays: 30, isDefault: false },
  ];
  for (const pm of spmData) { await prisma.supplierPaymentMethod.create({ data: pm }); }
  console.log('SupplierPaymentMethods created: 11');


  // ============================================================
  // STEP 6: PRODUCTS (25 products)
  // ============================================================
  const productsData = [
    // PHONE_NEW (8)
    { id: 'prod-001', name: 'iPhone 15 Pro Max 256GB', brand: 'Apple', model: 'iPhone 15 Pro Max', color: 'Natural Titanium', storage: '256GB', imeiSerial: '354567890123456', serialNumber: 'F2LXK1A2B3', category: 'PHONE_NEW' as const, costPrice: 42900, branchId: 'branch-002', status: 'IN_STOCK' as const, supplierId: 'sup-001', stockInDate: new Date('2026-01-15') },
    { id: 'prod-002', name: 'iPhone 15 Pro 128GB', brand: 'Apple', model: 'iPhone 15 Pro', color: 'Black Titanium', storage: '128GB', imeiSerial: '354567890123457', serialNumber: 'F2LXK1A2B4', category: 'PHONE_NEW' as const, costPrice: 38900, branchId: 'branch-002', status: 'IN_STOCK' as const, supplierId: 'sup-001', stockInDate: new Date('2026-01-15') },
    { id: 'prod-003', name: 'iPhone 16 Pro Max 256GB', brand: 'Apple', model: 'iPhone 16 Pro Max', color: 'Desert Titanium', storage: '256GB', imeiSerial: '354567890123458', serialNumber: 'F2LXK2A2B1', category: 'PHONE_NEW' as const, costPrice: 44900, branchId: 'branch-002', status: 'SOLD_INSTALLMENT' as const, supplierId: 'sup-002', stockInDate: new Date('2026-01-10') },
    { id: 'prod-004', name: 'iPhone 16 128GB', brand: 'Apple', model: 'iPhone 16', color: 'Ultramarine', storage: '128GB', imeiSerial: '354567890123459', serialNumber: 'F2LXK2C2D1', category: 'PHONE_NEW' as const, costPrice: 29900, branchId: 'branch-003', status: 'IN_STOCK' as const, supplierId: 'sup-002', stockInDate: new Date('2026-01-20') },
    { id: 'prod-005', name: 'iPhone 15 128GB', brand: 'Apple', model: 'iPhone 15', color: 'Blue', storage: '128GB', imeiSerial: '354567890123461', serialNumber: 'F2LXK3A2B1', category: 'PHONE_NEW' as const, costPrice: 28900, branchId: 'branch-002', status: 'IN_STOCK' as const, supplierId: 'sup-004', stockInDate: new Date('2026-02-01') },
    { id: 'prod-006', name: 'iPhone 16 Pro 256GB', brand: 'Apple', model: 'iPhone 16 Pro', color: 'Black Titanium', storage: '256GB', imeiSerial: '354567890123462', serialNumber: 'F2LXK2E2F1', category: 'PHONE_NEW' as const, costPrice: 39900, branchId: 'branch-004', status: 'IN_STOCK' as const, supplierId: 'sup-006', stockInDate: new Date('2026-02-05') },
    { id: 'prod-007', name: 'iPhone 14 128GB', brand: 'Apple', model: 'iPhone 14', color: 'Midnight', storage: '128GB', imeiSerial: '354567890123470', serialNumber: 'F2LXK3C2D1', category: 'PHONE_NEW' as const, costPrice: 22900, branchId: 'branch-003', status: 'SOLD_CASH' as const, supplierId: 'sup-004', stockInDate: new Date('2026-01-25') },
    { id: 'prod-008', name: 'iPhone 15 Plus 256GB', brand: 'Apple', model: 'iPhone 15 Plus', color: 'Pink', storage: '256GB', imeiSerial: '354567890123471', serialNumber: 'F2LXK3E2F1', category: 'PHONE_NEW' as const, costPrice: 32900, branchId: 'branch-004', status: 'SOLD_INSTALLMENT' as const, supplierId: 'sup-002', stockInDate: new Date('2026-02-10') },
    // PHONE_USED (15)
    { id: 'prod-009', name: 'iPhone 14 Pro 128GB (มือสอง)', brand: 'Apple', model: 'iPhone 14 Pro', color: 'Deep Purple', storage: '128GB', imeiSerial: '354567890123463', serialNumber: 'F2LXK1C2D3', category: 'PHONE_USED' as const, costPrice: 22500, branchId: 'branch-002', status: 'IN_STOCK' as const, batteryHealth: 92, warrantyExpired: true, hasBox: true, supplierId: 'sup-005', stockInDate: new Date('2026-02-01') },
    { id: 'prod-010', name: 'iPhone 13 128GB (มือสอง)', brand: 'Apple', model: 'iPhone 13', color: 'Midnight', storage: '128GB', imeiSerial: '354567890123464', serialNumber: 'F2LXK1E2F3', category: 'PHONE_USED' as const, costPrice: 15500, branchId: 'branch-003', status: 'SOLD_INSTALLMENT' as const, batteryHealth: 85, warrantyExpired: true, hasBox: false, supplierId: 'sup-008', stockInDate: new Date('2026-01-20') },
    { id: 'prod-011', name: 'iPhone 12 64GB (มือสอง)', brand: 'Apple', model: 'iPhone 12', color: 'Blue', storage: '64GB', imeiSerial: '354567890123465', serialNumber: 'F2LXK1G2H3', category: 'PHONE_USED' as const, costPrice: 9500, branchId: 'branch-003', status: 'SOLD_INSTALLMENT' as const, batteryHealth: 78, warrantyExpired: true, hasBox: false, supplierId: 'sup-010', stockInDate: new Date('2026-01-10') },
    { id: 'prod-012', name: 'iPhone 13 Pro 128GB (มือสอง)', brand: 'Apple', model: 'iPhone 13 Pro', color: 'Sierra Blue', storage: '128GB', imeiSerial: '354567890123466', serialNumber: 'F2LXK1I2J3', category: 'PHONE_USED' as const, costPrice: 18500, branchId: 'branch-002', status: 'IN_STOCK' as const, batteryHealth: 90, warrantyExpired: true, hasBox: true, supplierId: 'sup-010', stockInDate: new Date('2026-02-05') },
    { id: 'prod-013', name: 'iPhone 12 Pro Max 128GB (มือสอง)', brand: 'Apple', model: 'iPhone 12 Pro Max', color: 'Pacific Blue', storage: '128GB', imeiSerial: '354567890123467', serialNumber: 'F2LXK4A2B1', category: 'PHONE_USED' as const, costPrice: 14500, branchId: 'branch-004', status: 'IN_STOCK' as const, batteryHealth: 88, warrantyExpired: false, warrantyExpireDate: new Date('2026-06-15'), hasBox: true, supplierId: 'sup-007', stockInDate: new Date('2026-02-08') },
    { id: 'prod-014', name: 'iPhone 14 128GB (มือสอง)', brand: 'Apple', model: 'iPhone 14', color: 'Product Red', storage: '128GB', imeiSerial: '354567890123472', serialNumber: 'F2LXK1K2L3', category: 'PHONE_USED' as const, costPrice: 18000, branchId: 'branch-002', status: 'REPOSSESSED' as const, batteryHealth: 82, warrantyExpired: true, hasBox: false, stockInDate: new Date('2026-01-05') },
    { id: 'prod-015', name: 'iPhone 11 64GB (มือสอง)', brand: 'Apple', model: 'iPhone 11', color: 'White', storage: '64GB', imeiSerial: '354567890123473', serialNumber: 'F2LXK1M2N3', category: 'PHONE_USED' as const, costPrice: 6500, branchId: 'branch-003', status: 'DAMAGED' as const, batteryHealth: 65, warrantyExpired: true, hasBox: false, supplierId: 'sup-008', stockInDate: new Date('2025-12-20') },
    // PHONE_USED เพิ่มเติม (8)
    { id: 'prod-026', name: 'iPhone 15 Pro 256GB (มือสอง)', brand: 'Apple', model: 'iPhone 15 Pro', color: 'White Titanium', storage: '256GB', imeiSerial: '354567890123477', serialNumber: 'F2LXK5A2B1', category: 'PHONE_USED' as const, costPrice: 32000, branchId: 'branch-002', status: 'IN_STOCK' as const, batteryHealth: 95, warrantyExpired: false, warrantyExpireDate: new Date('2026-09-15'), hasBox: true, supplierId: 'sup-005', stockInDate: new Date('2026-02-20') },
    { id: 'prod-027', name: 'iPhone 14 Pro Max 256GB (มือสอง)', brand: 'Apple', model: 'iPhone 14 Pro Max', color: 'Space Black', storage: '256GB', imeiSerial: '354567890123478', serialNumber: 'F2LXK5C2D1', category: 'PHONE_USED' as const, costPrice: 27000, branchId: 'branch-004', status: 'IN_STOCK' as const, batteryHealth: 93, warrantyExpired: true, hasBox: true, supplierId: 'sup-010', stockInDate: new Date('2026-02-18') },
    { id: 'prod-028', name: 'iPhone 13 mini 128GB (มือสอง)', brand: 'Apple', model: 'iPhone 13 mini', color: 'Pink', storage: '128GB', imeiSerial: '354567890123479', serialNumber: 'F2LXK5E2F1', category: 'PHONE_USED' as const, costPrice: 12500, branchId: 'branch-003', status: 'IN_STOCK' as const, batteryHealth: 86, warrantyExpired: true, hasBox: false, supplierId: 'sup-008', stockInDate: new Date('2026-02-10') },
    { id: 'prod-029', name: 'iPhone 15 128GB (มือสอง)', brand: 'Apple', model: 'iPhone 15', color: 'Green', storage: '128GB', imeiSerial: '354567890123480', serialNumber: 'F2LXK5G2H1', category: 'PHONE_USED' as const, costPrice: 22000, branchId: 'branch-002', status: 'SOLD_INSTALLMENT' as const, batteryHealth: 88, warrantyExpired: false, warrantyExpireDate: new Date('2026-12-01'), hasBox: true, supplierId: 'sup-005', stockInDate: new Date('2026-02-12') },
    { id: 'prod-030', name: 'iPhone 12 mini 64GB (มือสอง)', brand: 'Apple', model: 'iPhone 12 mini', color: 'Purple', storage: '64GB', imeiSerial: '354567890123481', serialNumber: 'F2LXK5I2J1', category: 'PHONE_USED' as const, costPrice: 7500, branchId: 'branch-003', status: 'IN_STOCK' as const, batteryHealth: 75, warrantyExpired: true, hasBox: false, supplierId: 'sup-008', stockInDate: new Date('2026-01-25') },
    { id: 'prod-031', name: 'iPhone 13 256GB (มือสอง)', brand: 'Apple', model: 'iPhone 13', color: 'Starlight', storage: '256GB', imeiSerial: '354567890123482', serialNumber: 'F2LXK5K2L1', category: 'PHONE_USED' as const, costPrice: 14000, branchId: 'branch-004', status: 'IN_STOCK' as const, batteryHealth: 79, warrantyExpired: true, hasBox: false, supplierId: 'sup-010', stockInDate: new Date('2026-01-30') },
    { id: 'prod-032', name: 'iPhone XR 64GB (มือสอง)', brand: 'Apple', model: 'iPhone XR', color: 'Coral', storage: '64GB', imeiSerial: '354567890123483', serialNumber: 'F2LXK5M2N1', category: 'PHONE_USED' as const, costPrice: 4500, branchId: 'branch-003', status: 'DAMAGED' as const, batteryHealth: 62, warrantyExpired: true, hasBox: false, supplierId: 'sup-008', stockInDate: new Date('2025-11-15') },
    { id: 'prod-033', name: 'iPhone SE 3 64GB (มือสอง)', brand: 'Apple', model: 'iPhone SE 3', color: 'Midnight', storage: '64GB', imeiSerial: '354567890123484', serialNumber: 'F2LXK5O2P1', category: 'PHONE_USED' as const, costPrice: 8000, branchId: 'branch-002', status: 'IN_STOCK' as const, batteryHealth: 68, warrantyExpired: true, hasBox: false, supplierId: 'sup-005', stockInDate: new Date('2025-12-10') },
    // TABLET (4)
    { id: 'prod-016', name: 'iPad Pro M4 11" 256GB', brand: 'Apple', model: 'iPad Pro M4', color: 'Space Black', storage: '256GB', imeiSerial: '354567890123468', serialNumber: 'IPADM4001', category: 'TABLET' as const, costPrice: 36900, branchId: 'branch-004', status: 'IN_STOCK' as const, supplierId: 'sup-009', stockInDate: new Date('2026-02-10') },
    { id: 'prod-017', name: 'iPad 10th Gen 64GB', brand: 'Apple', model: 'iPad 10th Gen', color: 'Silver', storage: '64GB', imeiSerial: '354567890123469', serialNumber: 'IPAD10G001', category: 'TABLET' as const, costPrice: 14900, branchId: 'branch-002', status: 'SOLD_INSTALLMENT' as const, supplierId: 'sup-009', stockInDate: new Date('2026-01-05') },
    { id: 'prod-018', name: 'iPad Air M2 11" 128GB', brand: 'Apple', model: 'iPad Air M2', color: 'Starlight', storage: '128GB', imeiSerial: '354567890123474', serialNumber: 'IPADA2001', category: 'TABLET' as const, costPrice: 27900, branchId: 'branch-003', status: 'IN_STOCK' as const, supplierId: 'sup-009', stockInDate: new Date('2026-02-15') },
    { id: 'prod-019', name: 'iPad mini 6th Gen 64GB', brand: 'Apple', model: 'iPad mini 6', color: 'Space Gray', storage: '64GB', imeiSerial: '354567890123475', serialNumber: 'IPADM6001', category: 'TABLET' as const, costPrice: 16900, branchId: 'branch-004', status: 'SOLD_CASH' as const, supplierId: 'sup-009', stockInDate: new Date('2026-01-28') },
    // ACCESSORY (6)
    { id: 'prod-020', name: 'เคส iPhone 15 Pro Max MagSafe', brand: 'Apple', model: 'MagSafe Case', color: 'Clear', category: 'ACCESSORY' as const, costPrice: 890, branchId: 'branch-002', status: 'IN_STOCK' as const, accessoryType: 'CASE', accessoryBrand: 'Apple', supplierId: 'sup-003', stockInDate: new Date('2026-02-01') },
    { id: 'prod-021', name: 'ฟิล์มกระจก iPhone 16 Pro Max', brand: 'Apple', model: 'iPhone 16 Pro Max Screen Protector', category: 'ACCESSORY' as const, costPrice: 290, branchId: 'branch-002', status: 'IN_STOCK' as const, accessoryType: 'SCREEN_PROTECTOR', accessoryBrand: 'Nillkin', supplierId: 'sup-003', stockInDate: new Date('2026-02-01') },
    { id: 'prod-022', name: 'สายชาร์จ USB-C 2m', brand: 'Anker', model: 'PowerLine III', category: 'ACCESSORY' as const, costPrice: 350, branchId: 'branch-003', status: 'IN_STOCK' as const, accessoryType: 'CABLE', accessoryBrand: 'Anker', supplierId: 'sup-003', stockInDate: new Date('2026-02-01') },
    { id: 'prod-023', name: 'หูฟัง AirPods Pro 2', brand: 'Apple', model: 'AirPods Pro 2', color: 'White', imeiSerial: '354567890123476', serialNumber: 'AIRPODS001', category: 'ACCESSORY' as const, costPrice: 7900, branchId: 'branch-002', status: 'SOLD_CASH' as const, accessoryType: 'EARPHONE', accessoryBrand: 'Apple', supplierId: 'sup-001', stockInDate: new Date('2026-01-15') },
    { id: 'prod-024', name: 'ที่ชาร์จไร้สาย MagSafe', brand: 'Apple', model: 'MagSafe Charger', color: 'White', category: 'ACCESSORY' as const, costPrice: 1290, branchId: 'branch-004', status: 'IN_STOCK' as const, accessoryType: 'CHARGER', accessoryBrand: 'Apple', supplierId: 'sup-003', stockInDate: new Date('2026-02-10') },
    { id: 'prod-025', name: 'Power Bank 20000mAh', brand: 'Anker', model: 'PowerCore 20K', color: 'Black', category: 'ACCESSORY' as const, costPrice: 990, branchId: 'branch-003', status: 'IN_STOCK' as const, accessoryType: 'POWER_BANK', accessoryBrand: 'Anker', supplierId: 'sup-003', stockInDate: new Date('2026-02-01') },
  ];
  for (const p of productsData) { await prisma.product.create({ data: p }); }
  console.log('Products created: 33');

  // ============================================================
  // STEP 7: PRODUCT PRICES
  // ============================================================
  const pricesData = [
    { id: 'pp-001', productId: 'prod-001', label: 'ราคาเงินสด', amount: 46900, isDefault: true },
    { id: 'pp-002', productId: 'prod-001', label: 'ราคาผ่อน', amount: 49900, isDefault: false },
    { id: 'pp-003', productId: 'prod-002', label: 'ราคาเงินสด', amount: 42900, isDefault: true },
    { id: 'pp-004', productId: 'prod-002', label: 'ราคาผ่อน', amount: 45900, isDefault: false },
    { id: 'pp-005', productId: 'prod-003', label: 'ราคาเงินสด', amount: 49900, isDefault: true },
    { id: 'pp-006', productId: 'prod-003', label: 'ราคาผ่อน', amount: 54900, isDefault: false },
    { id: 'pp-007', productId: 'prod-004', label: 'ราคาเงินสด', amount: 34900, isDefault: true },
    { id: 'pp-008', productId: 'prod-009', label: 'ราคาเงินสด', amount: 26900, isDefault: true },
    { id: 'pp-009', productId: 'prod-009', label: 'ราคาผ่อน', amount: 29900, isDefault: false },
    { id: 'pp-010', productId: 'prod-010', label: 'ราคาเงินสด', amount: 18900, isDefault: true },
    { id: 'pp-011', productId: 'prod-010', label: 'ราคาผ่อน', amount: 19900, isDefault: false },
    { id: 'pp-012', productId: 'prod-011', label: 'ราคาเงินสด', amount: 11900, isDefault: true },
    { id: 'pp-013', productId: 'prod-016', label: 'ราคาเงินสด', amount: 41900, isDefault: true },
    { id: 'pp-014', productId: 'prod-016', label: 'ราคาผ่อน', amount: 44900, isDefault: false },
    { id: 'pp-015', productId: 'prod-017', label: 'ราคาเงินสด', amount: 18900, isDefault: true },
    { id: 'pp-016', productId: 'prod-005', label: 'ราคาเงินสด', amount: 33900, isDefault: true },
    { id: 'pp-017', productId: 'prod-006', label: 'ราคาเงินสด', amount: 44900, isDefault: true },
    { id: 'pp-018', productId: 'prod-012', label: 'ราคาเงินสด', amount: 22900, isDefault: true },
    { id: 'pp-019', productId: 'prod-013', label: 'ราคาเงินสด', amount: 18900, isDefault: true },
    { id: 'pp-020', productId: 'prod-020', label: 'ราคาขาย', amount: 1590, isDefault: true },
    { id: 'pp-021', productId: 'prod-021', label: 'ราคาขาย', amount: 590, isDefault: true },
    { id: 'pp-022', productId: 'prod-022', label: 'ราคาขาย', amount: 590, isDefault: true },
    { id: 'pp-023', productId: 'prod-023', label: 'ราคาขาย', amount: 8990, isDefault: true },
    { id: 'pp-024', productId: 'prod-024', label: 'ราคาขาย', amount: 1790, isDefault: true },
    { id: 'pp-025', productId: 'prod-025', label: 'ราคาขาย', amount: 1490, isDefault: true },
    // มือสอง - ราคาตามเกรดสภาพ
    { id: 'pp-026', productId: 'prod-026', label: 'ราคาเงินสด', amount: 37900, isDefault: true },
    { id: 'pp-027', productId: 'prod-026', label: 'ราคาผ่อน', amount: 41900, isDefault: false },
    { id: 'pp-028', productId: 'prod-027', label: 'ราคาเงินสด', amount: 32900, isDefault: true },
    { id: 'pp-029', productId: 'prod-027', label: 'ราคาผ่อน', amount: 35900, isDefault: false },
    { id: 'pp-030', productId: 'prod-028', label: 'ราคาเงินสด', amount: 15900, isDefault: true },
    { id: 'pp-031', productId: 'prod-029', label: 'ราคาเงินสด', amount: 26900, isDefault: true },
    { id: 'pp-032', productId: 'prod-029', label: 'ราคาผ่อน', amount: 29900, isDefault: false },
    { id: 'pp-033', productId: 'prod-030', label: 'ราคาเงินสด', amount: 9900, isDefault: true },
    { id: 'pp-034', productId: 'prod-031', label: 'ราคาเงินสด', amount: 17900, isDefault: true },
    { id: 'pp-035', productId: 'prod-032', label: 'ราคาเงินสด', amount: 5900, isDefault: true },
    { id: 'pp-036', productId: 'prod-033', label: 'ราคาเงินสด', amount: 9900, isDefault: true },
    // Products that were missing prices
    { id: 'pp-037', productId: 'prod-007', label: 'ราคาเงินสด', amount: 26900, isDefault: true },
    { id: 'pp-038', productId: 'prod-007', label: 'ราคาผ่อน', amount: 29900, isDefault: false },
    { id: 'pp-039', productId: 'prod-008', label: 'ราคาเงินสด', amount: 37900, isDefault: true },
    { id: 'pp-040', productId: 'prod-008', label: 'ราคาผ่อน', amount: 41900, isDefault: false },
    { id: 'pp-041', productId: 'prod-014', label: 'ราคาเงินสด', amount: 22900, isDefault: true },
    { id: 'pp-042', productId: 'prod-015', label: 'ราคาเงินสด', amount: 8900, isDefault: true },
    { id: 'pp-043', productId: 'prod-018', label: 'ราคาเงินสด', amount: 32900, isDefault: true },
    { id: 'pp-044', productId: 'prod-018', label: 'ราคาผ่อน', amount: 35900, isDefault: false },
    { id: 'pp-045', productId: 'prod-019', label: 'ราคาเงินสด', amount: 19900, isDefault: true },
  ];
  for (const pp of pricesData) { await prisma.productPrice.create({ data: pp }); }
  console.log('ProductPrices created:', pricesData.length);


  // ============================================================
  // STEP 8: PURCHASE ORDERS + PO ITEMS (7 POs)
  // ============================================================
  await prisma.purchaseOrder.create({
    data: {
      id: 'po-001', poNumber: 'PO-2026-01-001', supplierId: 'sup-001', orderDate: new Date('2026-01-10'), expectedDate: new Date('2026-01-15'), dueDate: new Date('2026-01-17'),
      status: 'FULLY_RECEIVED', totalAmount: 214500, discount: 0, vatAmount: 15015, netAmount: 229515, paymentStatus: 'FULLY_PAID', paymentMethod: 'BANK_TRANSFER', paidAmount: 229515,
      paymentNotes: 'โอนจ่ายครบ 15/01/2026', notes: 'iPhone 15 Pro Max + Pro เข้าสต็อก', createdById: 'user-002', approvedById: 'user-001',
      items: { create: [
        { id: 'poi-001', brand: 'Apple', model: 'iPhone 15 Pro Max', color: 'Natural Titanium', storage: '256GB', category: 'PHONE_NEW', quantity: 3, unitPrice: 42900, receivedQty: 3 },
        { id: 'poi-002', brand: 'Apple', model: 'iPhone 15 Pro', color: 'Black Titanium', storage: '128GB', category: 'PHONE_NEW', quantity: 2, unitPrice: 38900, receivedQty: 2 },
      ]},
    },
  });

  await prisma.purchaseOrder.create({
    data: {
      id: 'po-002', poNumber: 'PO-2026-01-002', supplierId: 'sup-002', orderDate: new Date('2026-01-08'), expectedDate: new Date('2026-01-12'),
      status: 'FULLY_RECEIVED', totalAmount: 149600, discount: 2000, vatAmount: 10332, netAmount: 157932, paymentStatus: 'FULLY_PAID', paymentMethod: 'BANK_TRANSFER', paidAmount: 157932,
      paymentNotes: 'โอนครบ 20/01/2026', notes: 'iPhone ล็อตมกราคม', createdById: 'user-001', approvedById: 'user-001',
      items: { create: [
        { id: 'poi-003', brand: 'Apple', model: 'iPhone 16 Pro Max', color: 'Desert Titanium', storage: '256GB', category: 'PHONE_NEW', quantity: 2, unitPrice: 44900, receivedQty: 2 },
        { id: 'poi-004', brand: 'Apple', model: 'iPhone 16', color: 'Ultramarine', storage: '128GB', category: 'PHONE_NEW', quantity: 2, unitPrice: 29900, receivedQty: 2 },
      ]},
    },
  });

  await prisma.purchaseOrder.create({
    data: {
      id: 'po-003', poNumber: 'PO-2026-02-001', supplierId: 'sup-004', orderDate: new Date('2026-01-28'), expectedDate: new Date('2026-02-03'), dueDate: new Date('2026-02-12'),
      status: 'PARTIALLY_RECEIVED', totalAmount: 155400, discount: 0, vatAmount: 10878, netAmount: 166278, paymentStatus: 'DEPOSIT_PAID', paymentMethod: 'BANK_TRANSFER', paidAmount: 30000,
      paymentNotes: 'จ่ายมัดจำ 30,000', notes: 'iPhone 15 + iPhone 14 เข้าสาขาลาดพร้าว+รามคำแหง', createdById: 'user-002', approvedById: 'user-001',
      items: { create: [
        { id: 'poi-005', brand: 'Apple', model: 'iPhone 15', color: 'Blue', storage: '128GB', category: 'PHONE_NEW', quantity: 3, unitPrice: 28900, receivedQty: 2 },
        { id: 'poi-006', brand: 'Apple', model: 'iPhone 14', color: 'Midnight', storage: '128GB', category: 'PHONE_NEW', quantity: 3, unitPrice: 22900, receivedQty: 1 },
      ]},
    },
  });

  await prisma.purchaseOrder.create({
    data: {
      id: 'po-004', poNumber: 'PO-2026-02-002', supplierId: 'sup-005', orderDate: new Date('2026-02-05'), expectedDate: new Date('2026-02-05'),
      status: 'DRAFT', totalAmount: 87500, discount: 2500, vatAmount: 0, netAmount: 85000, paymentStatus: 'UNPAID', paymentMethod: 'CASH', paidAmount: 0,
      notes: 'มือสอง MBK ล็อตใหม่ รอ approve', createdById: 'user-002',
      items: { create: [
        { id: 'poi-007', brand: 'Apple', model: 'iPhone 14 Pro', color: 'Deep Purple', storage: '128GB', category: 'PHONE_USED', quantity: 2, unitPrice: 22500 },
        { id: 'poi-008', brand: 'Apple', model: 'iPhone 13', color: 'Midnight', storage: '128GB', category: 'PHONE_USED', quantity: 3, unitPrice: 14500 },
      ]},
    },
  });

  await prisma.purchaseOrder.create({
    data: {
      id: 'po-005', poNumber: 'PO-2026-02-003', supplierId: 'sup-006', orderDate: new Date('2026-02-01'), expectedDate: new Date('2026-02-07'), dueDate: new Date('2026-03-01'),
      status: 'APPROVED', totalAmount: 153600, discount: 3000, vatAmount: 10542, netAmount: 161142, paymentStatus: 'PARTIALLY_PAID', paymentMethod: 'BANK_TRANSFER', paidAmount: 50000,
      paymentNotes: 'โอนแล้ว 50,000', notes: 'iPhone 16 Pro + iPad Pro เข้าสาขาบางแค', createdById: 'user-001', approvedById: 'user-001',
      items: { create: [
        { id: 'poi-009', brand: 'Apple', model: 'iPhone 16 Pro', color: 'Black Titanium', storage: '256GB', category: 'PHONE_NEW', quantity: 2, unitPrice: 39900 },
        { id: 'poi-010', brand: 'Apple', model: 'iPad Pro M4', color: 'Space Black', storage: '256GB', category: 'TABLET', quantity: 2, unitPrice: 36900 },
      ]},
    },
  });

  await prisma.purchaseOrder.create({
    data: {
      id: 'po-006', poNumber: 'PO-2025-12-001', supplierId: 'sup-009', orderDate: new Date('2025-12-20'), expectedDate: new Date('2025-12-28'),
      status: 'CANCELLED', totalAmount: 88700, discount: 0, vatAmount: 6209, netAmount: 94909, paymentStatus: 'UNPAID', paidAmount: 0,
      rejectReason: 'ราคาสูงกว่าที่ตกลง', notes: 'Tablet ล็อตธันวาคม - ยกเลิก', createdById: 'user-002', approvedById: 'user-001',
      items: { create: [
        { id: 'poi-011', brand: 'Apple', model: 'iPad Pro M4', storage: '256GB', category: 'TABLET', quantity: 2, unitPrice: 36900 },
        { id: 'poi-012', brand: 'Apple', model: 'iPad 10th Gen', storage: '64GB', category: 'TABLET', quantity: 1, unitPrice: 14900 },
      ]},
    },
  });

  await prisma.purchaseOrder.create({
    data: {
      id: 'po-007', poNumber: 'PO-2026-01-003', supplierId: 'sup-010', orderDate: new Date('2026-01-05'), expectedDate: new Date('2026-01-07'),
      status: 'FULLY_RECEIVED', totalAmount: 57000, discount: 2000, vatAmount: 0, netAmount: 55000, paymentStatus: 'FULLY_PAID', paymentMethod: 'CASH', paidAmount: 55000,
      paymentNotes: 'จ่ายเงินสดตอนรับของ', notes: 'iPhone Refurbished Grade A เข้ารามคำแหง', createdById: 'user-001', approvedById: 'user-001',
      items: { create: [
        { id: 'poi-013', brand: 'Apple', model: 'iPhone 13 Pro', color: 'Sierra Blue', storage: '128GB', category: 'PHONE_USED', quantity: 2, unitPrice: 18500, receivedQty: 2 },
        { id: 'poi-014', brand: 'Apple', model: 'iPhone 12', color: 'Blue', storage: '64GB', category: 'PHONE_USED', quantity: 2, unitPrice: 10000, receivedQty: 2 },
      ]},
    },
  });
  // PO-008: มือสอง ล็อตใหม่ เกรดหลากหลาย (FULLY_RECEIVED)
  await prisma.purchaseOrder.create({
    data: {
      id: 'po-008', poNumber: 'PO-2026-02-004', supplierId: 'sup-005', orderDate: new Date('2026-02-15'), expectedDate: new Date('2026-02-18'),
      status: 'FULLY_RECEIVED', totalAmount: 128000, discount: 3000, vatAmount: 0, netAmount: 125000, paymentStatus: 'FULLY_PAID', paymentMethod: 'CASH', paidAmount: 125000,
      paymentNotes: 'จ่ายเงินสดตอนรับของ', notes: 'iPhone มือสอง เกรดรวม A-D จาก MBK', createdById: 'user-002', approvedById: 'user-001',
      items: { create: [
        { id: 'poi-015', brand: 'Apple', model: 'iPhone 15 Pro', color: 'White Titanium', storage: '256GB', category: 'PHONE_USED', quantity: 1, unitPrice: 32000, receivedQty: 1 },
        { id: 'poi-016', brand: 'Apple', model: 'iPhone 14 Pro Max', color: 'Space Black', storage: '256GB', category: 'PHONE_USED', quantity: 1, unitPrice: 27000, receivedQty: 1 },
        { id: 'poi-017', brand: 'Apple', model: 'iPhone 13 mini', color: 'Pink', storage: '128GB', category: 'PHONE_USED', quantity: 1, unitPrice: 12500, receivedQty: 1 },
        { id: 'poi-018', brand: 'Apple', model: 'iPhone 15', color: 'Green', storage: '128GB', category: 'PHONE_USED', quantity: 1, unitPrice: 22000, receivedQty: 1 },
        { id: 'poi-019', brand: 'Apple', model: 'iPhone 12 mini', color: 'Purple', storage: '64GB', category: 'PHONE_USED', quantity: 1, unitPrice: 7500, receivedQty: 1 },
        { id: 'poi-020', brand: 'Apple', model: 'iPhone 13', color: 'Starlight', storage: '256GB', category: 'PHONE_USED', quantity: 1, unitPrice: 14000, receivedQty: 1 },
      ]},
    },
  });

  // PO-009: มือสอง เกรด D ราคาถูก (FULLY_RECEIVED)
  await prisma.purchaseOrder.create({
    data: {
      id: 'po-009', poNumber: 'PO-2025-12-002', supplierId: 'sup-008', orderDate: new Date('2025-11-10'), expectedDate: new Date('2025-11-12'),
      status: 'FULLY_RECEIVED', totalAmount: 12500, discount: 0, vatAmount: 0, netAmount: 12500, paymentStatus: 'FULLY_PAID', paymentMethod: 'CASH', paidAmount: 12500,
      paymentNotes: 'จ่ายเงินสดครบ', notes: 'iPhone มือสอง เกรด D ราคาถูก ต้องซ่อม/เช็คสภาพ', createdById: 'user-001', approvedById: 'user-001',
      items: { create: [
        { id: 'poi-021', brand: 'Apple', model: 'iPhone XR', color: 'Coral', storage: '64GB', category: 'PHONE_USED', quantity: 1, unitPrice: 4500, receivedQty: 1 },
        { id: 'poi-022', brand: 'Apple', model: 'iPhone SE 3', color: 'Midnight', storage: '64GB', category: 'PHONE_USED', quantity: 1, unitPrice: 8000, receivedQty: 1 },
      ]},
    },
  });
  console.log('PurchaseOrders created: 9 (with POItems)');

  // ============================================================
  // STEP 9: GOODS RECEIVINGS + ITEMS
  // ============================================================
  // GR for PO-001 (fully received)
  await prisma.goodsReceiving.create({
    data: {
      id: 'gr-001', poId: 'po-001', receivedById: 'user-002', notes: 'รับของครบ ตรวจสอบแล้ว',
      items: { create: [
        { id: 'gri-001', poItemId: 'poi-001', imeiSerial: '354567890123456', serialNumber: 'F2LXK1A2B3', status: 'PASS', productId: 'prod-001', batteryHealth: 100, hasBox: true },
        { id: 'gri-002', poItemId: 'poi-002', imeiSerial: '354567890123457', serialNumber: 'F2LXK1A2B4', status: 'PASS', productId: 'prod-002', batteryHealth: 100, hasBox: true },
      ]},
    },
  });

  // GR for PO-002 (fully received)
  await prisma.goodsReceiving.create({
    data: {
      id: 'gr-002', poId: 'po-002', receivedById: 'user-002', notes: 'iPhone ล็อต มค. รับครบ',
      items: { create: [
        { id: 'gri-003', poItemId: 'poi-003', imeiSerial: '354567890123458', serialNumber: 'F2LXK2A2B1', status: 'PASS', productId: 'prod-003', batteryHealth: 100, hasBox: true },
        { id: 'gri-004', poItemId: 'poi-004', imeiSerial: '354567890123459', serialNumber: 'F2LXK2C2D1', status: 'PASS', productId: 'prod-004', batteryHealth: 100, hasBox: true },
      ]},
    },
  });

  // GR for PO-003 (partially received)
  await prisma.goodsReceiving.create({
    data: {
      id: 'gr-003', poId: 'po-003', receivedById: 'user-003', notes: 'รับ iPhone 15 จำนวน 2 เครื่อง + iPhone 14 จำนวน 1 เครื่อง',
      items: { create: [
        { id: 'gri-005', poItemId: 'poi-005', imeiSerial: '354567890123461', serialNumber: 'F2LXK3A2B1', status: 'PASS', productId: 'prod-005', batteryHealth: 100, hasBox: true },
        { id: 'gri-006', poItemId: 'poi-006', imeiSerial: '354567890123470', serialNumber: 'F2LXK3C2D1', status: 'PASS', productId: 'prod-007', batteryHealth: 100, hasBox: true },
      ]},
    },
  });

  // GR for PO-007 (refurbished iPhones)
  await prisma.goodsReceiving.create({
    data: {
      id: 'gr-004', poId: 'po-007', receivedById: 'user-003', notes: 'iPhone มือสอง iCare รับครบ ตรวจแล้ว',
      items: { create: [
        { id: 'gri-007', poItemId: 'poi-013', imeiSerial: '354567890123466', serialNumber: 'F2LXK1I2J3', status: 'PASS', productId: 'prod-012', batteryHealth: 90, hasBox: true, warrantyExpired: true },
        { id: 'gri-008', poItemId: 'poi-014', imeiSerial: '354567890123465', serialNumber: 'F2LXK1G2H3', status: 'PASS', productId: 'prod-011', batteryHealth: 78, hasBox: false, warrantyExpired: true },
      ]},
    },
  });
  // GR for PO-008 (มือสอง เกรดรวม)
  await prisma.goodsReceiving.create({
    data: {
      id: 'gr-005', poId: 'po-008', receivedById: 'user-002', notes: 'รับมือสอง MBK ล็อตใหม่ ตรวจเกรดแล้ว',
      items: { create: [
        { id: 'gri-009', poItemId: 'poi-015', imeiSerial: '354567890123477', serialNumber: 'F2LXK5A2B1', status: 'PASS', productId: 'prod-026', batteryHealth: 95, hasBox: true, warrantyExpired: false },
        { id: 'gri-010', poItemId: 'poi-016', imeiSerial: '354567890123478', serialNumber: 'F2LXK5C2D1', status: 'PASS', productId: 'prod-027', batteryHealth: 93, hasBox: true, warrantyExpired: true },
        { id: 'gri-011', poItemId: 'poi-017', imeiSerial: '354567890123479', serialNumber: 'F2LXK5E2F1', status: 'PASS', productId: 'prod-028', batteryHealth: 86, hasBox: false, warrantyExpired: true },
        { id: 'gri-012', poItemId: 'poi-018', imeiSerial: '354567890123480', serialNumber: 'F2LXK5G2H1', status: 'PASS', productId: 'prod-029', batteryHealth: 88, hasBox: true, warrantyExpired: false },
        { id: 'gri-013', poItemId: 'poi-019', imeiSerial: '354567890123481', serialNumber: 'F2LXK5I2J1', status: 'PASS', productId: 'prod-030', batteryHealth: 75, hasBox: false, warrantyExpired: true },
        { id: 'gri-014', poItemId: 'poi-020', imeiSerial: '354567890123482', serialNumber: 'F2LXK5K2L1', status: 'PASS', productId: 'prod-031', batteryHealth: 79, hasBox: false, warrantyExpired: true },
      ]},
    },
  });

  // GR for PO-009 (มือสอง เกรด D)
  await prisma.goodsReceiving.create({
    data: {
      id: 'gr-006', poId: 'po-009', receivedById: 'user-003', notes: 'รับมือสอง เกรด D ต้องซ่อม/ตรวจสภาพ',
      items: { create: [
        { id: 'gri-015', poItemId: 'poi-021', imeiSerial: '354567890123483', serialNumber: 'F2LXK5M2N1', status: 'PASS', productId: 'prod-032', batteryHealth: 62, hasBox: false, warrantyExpired: true },
        { id: 'gri-016', poItemId: 'poi-022', imeiSerial: '354567890123484', serialNumber: 'F2LXK5O2P1', status: 'PASS', productId: 'prod-033', batteryHealth: 68, hasBox: false, warrantyExpired: true },
      ]},
    },
  });
  console.log('GoodsReceivings created: 6 (with items)');


  // ============================================================
  // STEP 10: CUSTOMERS (12)
  // ============================================================
  const customersData = [
    { id: 'cust-001', nationalId: 'ENC_1100100100001', prefix: 'นาย', name: 'สมชาย ใจดี', nickname: 'ชาย', phone: '081-111-1111', phoneSecondary: '02-111-1112', lineId: 'somchai_j', facebookName: 'สมชาย ใจดี', facebookLink: 'https://facebook.com/somchai', facebookFriends: '1,234', addressIdCard: '11 ซ.ลาดพร้าว 15 แขวงจอมพล เขตจตุจักร กทม. 10900', addressCurrent: '11 ซ.ลาดพร้าว 15 แขวงจอมพล เขตจตุจักร กทม. 10900', occupation: 'พนักงานบริษัท', occupationDetail: 'เจ้าหน้าที่ IT', salary: 35000, workplace: 'บจก. ไทยพาณิชย์', addressWork: '9 ถ.รัชดาภิเษก เขตจตุจักร กทม.', birthDate: new Date('1990-05-15'), references: JSON.parse('[{"prefix":"นาง","firstName":"สมศรี","lastName":"ใจดี","phone":"082-111-2222","relationship":"มารดา"},{"prefix":"นาย","firstName":"วิชัย","lastName":"ดีใจ","phone":"083-111-3333","relationship":"เพื่อน"}]') },
    { id: 'cust-002', nationalId: 'ENC_1100100100002', prefix: 'นางสาว', name: 'สมหญิง รักเรียน', nickname: 'หญิง', phone: '082-222-2222', lineId: 'somying_r', facebookName: 'สมหญิง รักเรียน', facebookFriends: '567', addressIdCard: '22 ถ.รามคำแหง แขวงหัวหมาก เขตบางกะปิ กทม. 10240', addressCurrent: '22 ถ.รามคำแหง แขวงหัวหมาก เขตบางกะปิ กทม. 10240', occupation: 'ค้าขาย', occupationDetail: 'ขายของออนไลน์', salary: 25000, workplace: 'ร้านค้าออนไลน์', birthDate: new Date('1995-08-20'), references: JSON.parse('[{"prefix":"นาย","firstName":"สมศักดิ์","lastName":"รักเรียน","phone":"081-222-3333","relationship":"พ่อ"}]') },
    { id: 'cust-003', nationalId: 'ENC_1100100100003', prefix: 'นาย', name: 'วิชัย มั่งมี', nickname: 'ชัย', phone: '083-333-3333', addressIdCard: '33 ถ.เพชรเกษม แขวงบางแค เขตบางแค กทม. 10160', addressCurrent: '33 ถ.เพชรเกษม แขวงบางแค เขตบางแค กทม. 10160', occupation: 'รับราชการ', occupationDetail: 'เจ้าพนักงานสรรพากร', salary: 28000, workplace: 'กรมสรรพากร', addressWork: 'ถ.พหลโยธิน เขตจตุจักร กทม.', birthDate: new Date('1988-03-10'), references: JSON.parse('[{"prefix":"นาง","firstName":"สุดา","lastName":"มั่งมี","phone":"084-333-4444","relationship":"ภรรยา"}]') },
    { id: 'cust-004', nationalId: 'ENC_1100100100004', prefix: 'นางสาว', name: 'นภา แก้วใส', nickname: 'นภา', phone: '084-444-4444', lineId: 'napa_k', facebookName: 'Napa Kaewsai', facebookFriends: '2,345', addressIdCard: '44 ซ.สุขุมวิท 71 แขวงคลองตัน เขตวัฒนา กทม. 10110', addressCurrent: '44 ซ.สุขุมวิท 71 แขวงคลองตัน เขตวัฒนา กทม. 10110', occupation: 'ฟรีแลนซ์', occupationDetail: 'กราฟิกดีไซเนอร์', salary: 40000, birthDate: new Date('1992-11-25'), references: JSON.parse('[{"prefix":"นาย","firstName":"ปิติ","lastName":"แก้วใส","phone":"085-444-5555","relationship":"พี่ชาย"}]') },
    { id: 'cust-005', nationalId: 'ENC_1100100100005', prefix: 'นาย', name: 'ประเสริฐ ทองคำ', phone: '085-555-5555', addressIdCard: '55 ถ.พหลโยธิน แขวงจตุจักร เขตจตุจักร กทม. 10900', occupation: 'พนักงานโรงงาน', salary: 18000, workplace: 'บมจ. ปูนซิเมนต์ไทย', birthDate: new Date('1985-07-03'), references: JSON.parse('[{"prefix":"นาย","firstName":"ทวี","lastName":"ทองคำ","phone":"086-555-6666","relationship":"น้องชาย"}]') },
    { id: 'cust-006', nationalId: 'ENC_1100100100006', prefix: 'นาง', name: 'มาลี ดอกไม้', nickname: 'มาลี', phone: '086-666-6666', lineId: 'malee_d', addressIdCard: '66 ซ.อารีย์ แขวงพญาไท เขตพญาไท กทม. 10400', addressCurrent: '66 ซ.อารีย์ แขวงพญาไท เขตพญาไท กทม. 10400', occupation: 'แม่บ้าน', salary: 15000, birthDate: new Date('1980-12-01'), references: JSON.parse('[{"prefix":"นาย","firstName":"ประสิทธิ์","lastName":"ดอกไม้","phone":"087-666-7777","relationship":"สามี"}]') },
    { id: 'cust-007', nationalId: 'ENC_1100100100007', prefix: 'นาย', name: 'ธนกร สุขสม', nickname: 'กร', phone: '087-777-7777', lineId: 'thanakorn_s', facebookName: 'Thanakorn Suksom', facebookFriends: '890', addressIdCard: '77 ถ.ศรีนครินทร์ แขวงหนองบอน เขตประเวศ กทม. 10250', occupation: 'พนักงานบริษัท', occupationDetail: 'วิศวกร', salary: 55000, workplace: 'บมจ. ปตท.', addressWork: 'ถ.วิภาวดี กทม.', birthDate: new Date('1991-04-18'), references: JSON.parse('[{"prefix":"นาง","firstName":"รัตนา","lastName":"สุขสม","phone":"088-777-8888","relationship":"มารดา"}]') },
    { id: 'cust-008', nationalId: 'ENC_1100100100008', prefix: 'นางสาว', name: 'พิมพ์ชนก ศรีวิไล', nickname: 'พิมพ์', phone: '088-888-8888', lineId: 'pimchanok_s', facebookName: 'พิมพ์ชนก ศรีวิไล', facebookFriends: '3,456', addressIdCard: '88 ซ.รามอินทรา 5 แขวงอนุสาวรีย์ เขตบางเขน กทม. 10220', occupation: 'นักศึกษา', occupationDetail: 'ป.ตรี ปี 4 มหาวิทยาลัยเกษตรศาสตร์', birthDate: new Date('2002-09-30'), references: JSON.parse('[{"prefix":"นาย","firstName":"สมชาย","lastName":"ศรีวิไล","phone":"089-888-9999","relationship":"บิดา"}]') },
    { id: 'cust-009', nationalId: 'ENC_1100100100009', prefix: 'นาย', name: 'อดิศร จันทร์เจริญ', nickname: 'อดิ', phone: '089-999-9999', addressIdCard: '99 ถ.นวมินทร์ แขวงนวลจันทร์ เขตบึงกุ่ม กทม. 10230', occupation: 'ขับรถแท็กซี่', salary: 20000, birthDate: new Date('1978-01-22'), references: JSON.parse('[{"prefix":"นาย","firstName":"สมบัติ","lastName":"จันทร์เจริญ","phone":"090-999-0000","relationship":"พี่ชาย"}]') },
    { id: 'cust-010', nationalId: 'ENC_1100100100010', prefix: 'นาย', name: 'ภูมิพัฒน์ เอกชัย', nickname: 'ภูมิ', phone: '090-000-0000', lineId: 'phumipat_e', facebookName: 'Phumipat Ekachai', facebookFriends: '1,678', addressIdCard: '100 ม.10 ต.บางพูน อ.เมือง จ.ปทุมธานี 12000', addressCurrent: '100 ม.10 ต.บางพูน อ.เมือง จ.ปทุมธานี 12000', occupation: 'เจ้าของกิจการ', occupationDetail: 'ร้านซ่อมมือถือ', salary: 60000, workplace: 'ร้าน Fix Phone Pro', birthDate: new Date('1993-06-12'), references: JSON.parse('[{"prefix":"นางสาว","firstName":"วิภา","lastName":"เอกชัย","phone":"091-000-1111","relationship":"น้องสาว"}]') },
    { id: 'cust-011', nationalId: 'ENC_1100100100011', prefix: 'นางสาว', name: 'กัญญา เทพสวัสดิ์', nickname: 'แจง', phone: '091-111-1111', lineId: 'kanya_t', addressIdCard: '111 ถ.บรมราชชนนี แขวงศาลาธรรมสพน์ เขตทวีวัฒนา กทม. 10170', occupation: 'พยาบาล', salary: 32000, workplace: 'รพ.ศิริราช', birthDate: new Date('1994-02-14'), references: JSON.parse('[{"prefix":"นาง","firstName":"สุรีย์","lastName":"เทพสวัสดิ์","phone":"092-111-2222","relationship":"มารดา"}]') },
    { id: 'cust-012', nationalId: 'ENC_1100100100012', prefix: 'นาย', name: 'ชานนท์ วงษ์พิทักษ์', nickname: 'นนท์', isForeigner: false, phone: '092-222-2222', addressIdCard: '222 ม.5 ต.คลองหนึ่ง อ.คลองหลวง จ.ปทุมธานี 12120', occupation: 'ช่างไฟฟ้า', salary: 22000, birthDate: new Date('1987-10-08'), references: JSON.parse('[{"prefix":"นางสาว","firstName":"สมใจ","lastName":"วงษ์พิทักษ์","phone":"093-222-3333","relationship":"ภรรยา"}]') },
  ];
  for (const c of customersData) { await prisma.customer.create({ data: c }); }
  console.log('Customers created: 12');

  // ============================================================
  // STEP 11: INTEREST CONFIG
  // ============================================================
  const ic1 = await prisma.interestConfig.create({
    data: { id: 'ic-001', name: 'มือถือใหม่', productCategories: ['PHONE_NEW'], interestRate: 0.0800, minDownPaymentPct: 0.2000, maxInstallmentMonths: 12, minInstallmentMonths: 6 },
  });
  const ic2 = await prisma.interestConfig.create({
    data: { id: 'ic-002', name: 'มือถือมือสอง', productCategories: ['PHONE_USED'], interestRate: 0.1000, minDownPaymentPct: 0.2500, maxInstallmentMonths: 10, minInstallmentMonths: 6 },
  });
  const ic3 = await prisma.interestConfig.create({
    data: { id: 'ic-003', name: 'แท็บเล็ต', productCategories: ['TABLET'], interestRate: 0.0800, minDownPaymentPct: 0.1500, maxInstallmentMonths: 12, minInstallmentMonths: 6 },
  });
  await prisma.interestConfig.create({
    data: { id: 'ic-004', name: 'อุปกรณ์เสริม', productCategories: ['ACCESSORY'], interestRate: 0.0500, minDownPaymentPct: 0.3000, maxInstallmentMonths: 6, minInstallmentMonths: 3, isActive: false },
  });
  console.log('InterestConfigs created: 4');


  // ============================================================
  // STEP 12: CONTRACTS (8 contracts, various statuses)
  // ============================================================
  // Contract 1: iPhone 16 Pro Max - สมชาย (ACTIVE, APPROVED)
  await prisma.contract.create({
    data: {
      id: 'cont-001', contractNumber: 'BCP2601-00001', customerId: 'cust-001', productId: 'prod-003', branchId: 'branch-002', salespersonId: 'user-004',
      planType: 'STORE_DIRECT', sellingPrice: 54900, downPayment: 10900, interestRate: 0.0800, totalMonths: 10, financedAmount: 44000, interestTotal: 35200, monthlyPayment: 7920,
      status: 'ACTIVE', workflowStatus: 'APPROVED', reviewedById: 'user-002', reviewedAt: new Date('2026-01-12'), reviewNotes: 'ตรวจเอกสารครบ อนุมัติ', paymentDueDay: 15,
      interestConfigId: 'ic-001',
    },
  });

  // Contract 2: iPhone 13 มือสอง - สมหญิง (ACTIVE, APPROVED)
  await prisma.contract.create({
    data: {
      id: 'cont-002', contractNumber: 'BCP2601-00002', customerId: 'cust-002', productId: 'prod-010', branchId: 'branch-003', salespersonId: 'user-005',
      planType: 'STORE_DIRECT', sellingPrice: 19900, downPayment: 3900, interestRate: 0.1000, totalMonths: 6, financedAmount: 16000, interestTotal: 9600, monthlyPayment: 4267,
      status: 'ACTIVE', workflowStatus: 'APPROVED', reviewedById: 'user-003', reviewedAt: new Date('2026-01-22'), paymentDueDay: 1,
      interestConfigId: 'ic-002',
    },
  });

  // Contract 3: iPad 10th Gen - วิชัย (OVERDUE, APPROVED)
  await prisma.contract.create({
    data: {
      id: 'cont-003', contractNumber: 'BCP2601-00003', customerId: 'cust-003', productId: 'prod-017', branchId: 'branch-002', salespersonId: 'user-004',
      planType: 'STORE_WITH_INTEREST', sellingPrice: 18900, downPayment: 3900, interestRate: 0.0800, totalMonths: 8, financedAmount: 15000, interestTotal: 9600, monthlyPayment: 3075,
      status: 'OVERDUE', workflowStatus: 'APPROVED', reviewedById: 'user-002', reviewedAt: new Date('2026-01-08'), paymentDueDay: 10,
      interestConfigId: 'ic-003',
    },
  });

  // Contract 4: iPhone 12 มือสอง - นภา (DEFAULT - ค้างชำระหลายงวด)
  await prisma.contract.create({
    data: {
      id: 'cont-004', contractNumber: 'BCP2601-00004', customerId: 'cust-004', productId: 'prod-011', branchId: 'branch-003', salespersonId: 'user-005',
      planType: 'STORE_DIRECT', sellingPrice: 12900, downPayment: 2900, interestRate: 0.1000, totalMonths: 6, financedAmount: 10000, interestTotal: 6000, monthlyPayment: 2667,
      status: 'DEFAULT', workflowStatus: 'APPROVED', reviewedById: 'user-003', reviewedAt: new Date('2025-12-20'), paymentDueDay: 5,
      interestConfigId: 'ic-002', notes: 'ลูกค้าติดต่อไม่ได้ ค้างชำระ 3 งวดติด',
    },
  });

  // Contract 5: iPhone 14 มือสอง - ประเสริฐ (COMPLETED)
  await prisma.contract.create({
    data: {
      id: 'cont-005', contractNumber: 'BCP2507-00001', customerId: 'cust-005', productId: 'prod-014', branchId: 'branch-002', salespersonId: 'user-004',
      planType: 'STORE_DIRECT', sellingPrice: 24900, downPayment: 5900, interestRate: 0.1000, totalMonths: 6, financedAmount: 19000, interestTotal: 11400, monthlyPayment: 5067,
      status: 'COMPLETED', workflowStatus: 'APPROVED', reviewedById: 'user-002', reviewedAt: new Date('2025-07-10'), paymentDueDay: 20,
      interestConfigId: 'ic-002',
    },
  });

  // Contract 6: DRAFT - ธนกร กำลังทำสัญญา
  await prisma.contract.create({
    data: {
      id: 'cont-006', contractNumber: 'BCP2602-00001', customerId: 'cust-007', productId: 'prod-001', branchId: 'branch-002', salespersonId: 'user-004',
      planType: 'STORE_DIRECT', sellingPrice: 49900, downPayment: 14900, interestRate: 0.0800, totalMonths: 10, financedAmount: 35000, interestTotal: 28000, monthlyPayment: 6300,
      status: 'DRAFT', workflowStatus: 'CREATING', paymentDueDay: 25,
      interestConfigId: 'ic-001',
    },
  });

  // Contract 7: EARLY_PAYOFF - มาลี ปิดบัญชีก่อนกำหนด (iPhone 15 Plus)
  await prisma.contract.create({
    data: {
      id: 'cont-007', contractNumber: 'BCP2509-00001', customerId: 'cust-006', productId: 'prod-008', branchId: 'branch-004', salespersonId: 'user-007',
      planType: 'STORE_DIRECT', sellingPrice: 39900, downPayment: 9900, interestRate: 0.0800, totalMonths: 8, financedAmount: 30000, interestTotal: 19200, monthlyPayment: 6150,
      status: 'EARLY_PAYOFF', workflowStatus: 'APPROVED', reviewedById: 'user-008', reviewedAt: new Date('2025-09-05'), paymentDueDay: 10,
      interestConfigId: 'ic-001', notes: 'ปิดบัญชีก่อนกำหนด งวดที่ 5/8 ลดดอกเบี้ยให้ 50%',
    },
  });

  // Contract 8: PENDING_REVIEW - อดิศร รอตรวจสอบ
  await prisma.contract.create({
    data: {
      id: 'cont-008', contractNumber: 'BCP2603-00001', customerId: 'cust-009', productId: 'prod-009', branchId: 'branch-002', salespersonId: 'user-004',
      planType: 'STORE_DIRECT', sellingPrice: 29900, downPayment: 6900, interestRate: 0.1000, totalMonths: 8, financedAmount: 23000, interestTotal: 18400, monthlyPayment: 5175,
      status: 'DRAFT', workflowStatus: 'PENDING_REVIEW', paymentDueDay: 15,
      interestConfigId: 'ic-002', notes: 'รอผู้จัดการตรวจสอบเอกสาร',
    },
  });
  // Contract 9: CREATING - ธนา กำลังสร้างสัญญาใหม่ (iPad Air M2)
  await prisma.contract.create({
    data: {
      id: 'cont-009', contractNumber: 'BCP2603-00002', customerId: 'cust-008', productId: 'prod-018', branchId: 'branch-003', salespersonId: 'user-005',
      planType: 'STORE_DIRECT', sellingPrice: 35900, downPayment: 5000, interestRate: 0.0800, totalMonths: 10, financedAmount: 30900, interestTotal: 24720, monthlyPayment: 5562,
      status: 'DRAFT', workflowStatus: 'CREATING', paymentDueDay: 5,
      interestConfigId: 'ic-001',
    },
  });

  // Contract 10: REJECTED - พรทิพย์ สัญญาถูกปฏิเสธ
  await prisma.contract.create({
    data: {
      id: 'cont-010', contractNumber: 'BCP2603-00003', customerId: 'cust-010', productId: 'prod-005', branchId: 'branch-002', salespersonId: 'user-004',
      planType: 'STORE_DIRECT', sellingPrice: 33900, downPayment: 3000, interestRate: 0.1000, totalMonths: 10, financedAmount: 30900, interestTotal: 30900, monthlyPayment: 6180,
      status: 'DRAFT', workflowStatus: 'REJECTED', reviewedById: 'user-002', reviewedAt: new Date('2026-03-07'), reviewNotes: 'เอกสารไม่ครบ กรุณาแนบสำเนาบัตรประชาชน',
      paymentDueDay: 15, interestConfigId: 'ic-002',
    },
  });
  console.log('Contracts created: 10');

  // ============================================================
  // STEP 13: PAYMENTS
  // ============================================================
  // Contract 1 payments (3 paid, 7 pending, 10 total)
  for (let i = 1; i <= 10; i++) {
    const dueDate = new Date(2026, i, 15);
    const isPaid = i <= 3;
    await prisma.payment.create({
      data: {
        id: `pay-001-${String(i).padStart(2, '0')}`, contractId: 'cont-001', installmentNo: i, dueDate,
        amountDue: 7920, amountPaid: isPaid ? 7920 : 0,
        paidDate: isPaid ? new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate() - 2) : null,
        paymentMethod: isPaid ? 'BANK_TRANSFER' : null,
        status: isPaid ? 'PAID' : (dueDate < new Date() ? 'OVERDUE' : 'PENDING'),
        recordedById: isPaid ? 'user-004' : null,
      },
    });
  }

  // Contract 2 payments (5 paid, 1 pending, 6 total)
  for (let i = 1; i <= 6; i++) {
    const dueDate = new Date(2026, i, 1);
    const isPaid = i <= 5;
    await prisma.payment.create({
      data: {
        id: `pay-002-${String(i).padStart(2, '0')}`, contractId: 'cont-002', installmentNo: i, dueDate,
        amountDue: 4267, amountPaid: isPaid ? 4267 : 0,
        paidDate: isPaid ? new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()) : null,
        paymentMethod: isPaid ? 'CASH' : null,
        status: isPaid ? 'PAID' : 'PENDING',
        recordedById: isPaid ? 'user-005' : null,
      },
    });
  }

  // Contract 3 payments (2 paid, 2 overdue, 4 pending, 8 total)
  for (let i = 1; i <= 8; i++) {
    const dueDate = new Date(2026, i, 10);
    const isPaid = i <= 2;
    const isOverdue = !isPaid && dueDate < new Date();
    await prisma.payment.create({
      data: {
        id: `pay-003-${String(i).padStart(2, '0')}`, contractId: 'cont-003', installmentNo: i, dueDate,
        amountDue: 3075, amountPaid: isPaid ? 3075 : (i === 3 ? 1500 : 0),
        paidDate: isPaid ? new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate() + 1) : null,
        paymentMethod: isPaid ? 'QR_EWALLET' : null,
        lateFee: isOverdue ? 200 : 0,
        status: isPaid ? 'PAID' : (i === 3 ? 'PARTIALLY_PAID' : (isOverdue ? 'OVERDUE' : 'PENDING')),
        recordedById: isPaid ? 'user-004' : null,
      },
    });
  }

  // Contract 4 payments (1 paid, 3 overdue, 2 pending, 6 total - DEFAULT)
  for (let i = 1; i <= 6; i++) {
    const dueDate = new Date(2026, i - 1, 5);
    const isPaid = i <= 1;
    const isOverdue = !isPaid && dueDate < new Date();
    await prisma.payment.create({
      data: {
        id: `pay-004-${String(i).padStart(2, '0')}`, contractId: 'cont-004', installmentNo: i, dueDate,
        amountDue: 2667, amountPaid: isPaid ? 2667 : 0,
        paidDate: isPaid ? new Date(2026, 0, 5) : null,
        paymentMethod: isPaid ? 'CASH' : null,
        lateFee: isOverdue ? 200 : 0,
        status: isPaid ? 'PAID' : (isOverdue ? 'OVERDUE' : 'PENDING'),
        recordedById: isPaid ? 'user-005' : null,
      },
    });
  }

  // Contract 5 payments (6/6 paid - COMPLETED)
  for (let i = 1; i <= 6; i++) {
    const dueDate = new Date(2025, 7 + i, 20);
    await prisma.payment.create({
      data: {
        id: `pay-005-${String(i).padStart(2, '0')}`, contractId: 'cont-005', installmentNo: i, dueDate,
        amountDue: 5067, amountPaid: 5067,
        paidDate: new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate() - 1),
        paymentMethod: i % 2 === 0 ? 'BANK_TRANSFER' : 'CASH',
        status: 'PAID',
        recordedById: 'user-004',
      },
    });
  }

  // Contract 7 payments (5 paid out of 8 - EARLY_PAYOFF, last payment is lump sum)
  for (let i = 1; i <= 5; i++) {
    const dueDate = new Date(2025, 9 + i, 10);
    await prisma.payment.create({
      data: {
        id: `pay-007-${String(i).padStart(2, '0')}`, contractId: 'cont-007', installmentNo: i, dueDate,
        amountDue: i === 5 ? 12000 : 6150, amountPaid: i === 5 ? 12000 : 6150,
        paidDate: new Date(dueDate.getFullYear(), dueDate.getMonth(), i === 5 ? 8 : dueDate.getDate()),
        paymentMethod: 'BANK_TRANSFER',
        status: 'PAID',
        recordedById: 'user-007',
        notes: i === 5 ? 'ปิดบัญชีก่อนกำหนด ชำระยอมรวม' : null,
      },
    });
  }
  console.log('Payments created for all contracts');


  // ============================================================
  // STEP 14: CONTRACT DOCUMENTS
  // ============================================================
  const contractDocs = [
    { id: 'cdoc-001', contractId: 'cont-001', documentType: 'SIGNED_CONTRACT' as const, fileName: 'contract_BCP2601-00001.pdf', fileUrl: '/uploads/contracts/cont-001/contract.pdf', fileSize: 245000, uploadedById: 'user-004' },
    { id: 'cdoc-002', contractId: 'cont-001', documentType: 'ID_CARD_COPY' as const, fileName: 'id_card_somchai.jpg', fileUrl: '/uploads/contracts/cont-001/id_card.jpg', fileSize: 180000, uploadedById: 'user-004' },
    { id: 'cdoc-003', contractId: 'cont-001', documentType: 'FACEBOOK_PROFILE' as const, fileName: 'fb_somchai.png', fileUrl: '/uploads/contracts/cont-001/facebook.png', fileSize: 320000, uploadedById: 'user-004' },
    { id: 'cdoc-004', contractId: 'cont-002', documentType: 'SIGNED_CONTRACT' as const, fileName: 'contract_BCP2601-00002.pdf', fileUrl: '/uploads/contracts/cont-002/contract.pdf', fileSize: 230000, uploadedById: 'user-005' },
    { id: 'cdoc-005', contractId: 'cont-002', documentType: 'ID_CARD_COPY' as const, fileName: 'id_card_somying.jpg', fileUrl: '/uploads/contracts/cont-002/id_card.jpg', fileSize: 165000, uploadedById: 'user-005' },
    { id: 'cdoc-006', contractId: 'cont-003', documentType: 'SIGNED_CONTRACT' as const, fileName: 'contract_BCP2601-00003.pdf', fileUrl: '/uploads/contracts/cont-003/contract.pdf', fileSize: 250000, uploadedById: 'user-004' },
    { id: 'cdoc-007', contractId: 'cont-003', documentType: 'BANK_STATEMENT' as const, fileName: 'bank_stmt_wichai.pdf', fileUrl: '/uploads/contracts/cont-003/bank_statement.pdf', fileSize: 450000, uploadedById: 'user-004' },
    { id: 'cdoc-008', contractId: 'cont-004', documentType: 'SIGNED_CONTRACT' as const, fileName: 'contract_BCP2601-00004.pdf', fileUrl: '/uploads/contracts/cont-004/contract.pdf', fileSize: 240000, uploadedById: 'user-005' },
    { id: 'cdoc-009', contractId: 'cont-005', documentType: 'SIGNED_CONTRACT' as const, fileName: 'contract_BCP2507-00001.pdf', fileUrl: '/uploads/contracts/cont-005/contract.pdf', fileSize: 235000, uploadedById: 'user-004' },
    { id: 'cdoc-010', contractId: 'cont-005', documentType: 'DEVICE_RECEIPT_PHOTO' as const, fileName: 'receipt_phone.jpg', fileUrl: '/uploads/contracts/cont-005/receipt.jpg', fileSize: 280000, uploadedById: 'user-004' },
  ];
  for (const d of contractDocs) { await prisma.contractDocument.create({ data: d }); }
  console.log('ContractDocuments created:', contractDocs.length);

  // ============================================================
  // STEP 15: CREDIT CHECKS
  // ============================================================
  await prisma.creditCheck.create({
    data: {
      id: 'cc-001', contractId: 'cont-001', customerId: 'cust-001', status: 'APPROVED', bankName: 'กสิกรไทย',
      statementFiles: ['/uploads/credit/cc-001/stmt1.pdf', '/uploads/credit/cc-001/stmt2.pdf'], statementMonths: 3,
      aiScore: 82, aiSummary: 'ลูกค้ามีรายได้สม่ำเสมอ เงินเดือนเข้าตรงเวลา ไม่มีประวัติเช็คคืน', aiRecommendation: 'อนุมัติ - ความเสี่ยงต่ำ',
      aiAnalysis: { incomeStability: 'HIGH', averageBalance: 45000, monthlyIncome: 35000, suspiciousTransactions: 0 },
      checkedById: 'user-002', checkedAt: new Date('2026-01-11'),
    },
  });
  await prisma.creditCheck.create({
    data: {
      id: 'cc-002', contractId: 'cont-002', customerId: 'cust-002', status: 'APPROVED', bankName: 'กรุงเทพ',
      statementFiles: ['/uploads/credit/cc-002/stmt1.pdf'], statementMonths: 3,
      aiScore: 68, aiSummary: 'รายได้ไม่สม่ำเสมอ แต่มียอมเงินในบัญชีเพียงพอ', aiRecommendation: 'อนุมัติ - ความเสี่ยงปานกลาง',
      aiAnalysis: { incomeStability: 'MEDIUM', averageBalance: 22000, monthlyIncome: 25000, suspiciousTransactions: 0 },
      checkedById: 'user-003', checkedAt: new Date('2026-01-21'),
    },
  });
  await prisma.creditCheck.create({
    data: {
      id: 'cc-003', contractId: 'cont-004', customerId: 'cust-004', status: 'APPROVED', bankName: 'กรุงไทย',
      statementFiles: ['/uploads/credit/cc-003/stmt1.pdf'], statementMonths: 3,
      aiScore: 55, aiSummary: 'รายได้ฟรีแลนซ์ ไม่แน่นอน แต่มียอดเงินสะสม', aiRecommendation: 'อนุมัติแบบมีเงื่อนไข - ดาวน์สูงขึ้น',
      aiAnalysis: { incomeStability: 'LOW', averageBalance: 18000, monthlyIncome: 40000, suspiciousTransactions: 1 },
      checkedById: 'user-003', checkedAt: new Date('2025-12-19'),
    },
  });
  await prisma.creditCheck.create({
    data: {
      id: 'cc-004', customerId: 'cust-009', status: 'PENDING',
      statementFiles: ['/uploads/credit/cc-004/stmt1.pdf'], statementMonths: 3,
      reviewNotes: 'รอตรวจสอบเพิ่มเติม',
    },
  });
  await prisma.creditCheck.create({
    data: {
      id: 'cc-005', contractId: 'cont-003', customerId: 'cust-003', status: 'APPROVED', bankName: 'ไทยพาณิชย์',
      statementFiles: ['/uploads/credit/cc-005/stmt1.pdf', '/uploads/credit/cc-005/stmt2.pdf'], statementMonths: 3,
      aiScore: 72, aiSummary: 'รายได้มั่นคง ภาระหนี้ต่ำ', aiRecommendation: 'อนุมัติ - ความเสี่ยงต่ำ',
      aiAnalysis: { incomeStability: 'HIGH', averageBalance: 38000, monthlyIncome: 30000, suspiciousTransactions: 0 },
      checkedById: 'user-002', checkedAt: new Date('2026-02-05'),
    },
  });
  await prisma.creditCheck.create({
    data: {
      id: 'cc-006', customerId: 'cust-005', status: 'REJECTED', bankName: 'ออมสิน',
      statementFiles: ['/uploads/credit/cc-006/stmt1.pdf'], statementMonths: 3,
      aiScore: 32, aiSummary: 'รายได้ไม่สม่ำเสมอ ยอดเงินในบัญชีต่ำ', aiRecommendation: 'ไม่แนะนำอนุมัติ - ความเสี่ยงสูง',
      aiAnalysis: { incomeStability: 'LOW', averageBalance: 5000, monthlyIncome: 12000, suspiciousTransactions: 2 },
      checkedById: 'user-003', checkedAt: new Date('2026-01-28'),
    },
  });
  await prisma.creditCheck.create({
    data: {
      id: 'cc-007', customerId: 'cust-006', status: 'MANUAL_REVIEW', bankName: 'กสิกรไทย',
      statementFiles: ['/uploads/credit/cc-007/stmt1.pdf', '/uploads/credit/cc-007/stmt2.pdf', '/uploads/credit/cc-007/stmt3.pdf'], statementMonths: 3,
      aiScore: 48, aiSummary: 'รายได้ปานกลาง แต่มีรายจ่ายสูง ควรตรวจสอบเพิ่มเติม', aiRecommendation: 'พิจารณาเพิ่มเติม - สอบถามแหล่งรายได้เสริม',
      aiAnalysis: { incomeStability: 'MEDIUM', averageBalance: 15000, monthlyIncome: 28000, suspiciousTransactions: 0 },
    },
  });
  console.log('CreditChecks created: 7');

  // ============================================================
  // STEP 16: SIGNATURES
  // ============================================================
  const sigData = [
    { id: 'sig-001', contractId: 'cont-001', signerType: 'CUSTOMER' as const, signatureImage: '/uploads/signatures/sig-001.png', ipAddress: '192.168.1.100', deviceInfo: 'iPad Safari 17.0' },
    { id: 'sig-002', contractId: 'cont-001', signerType: 'STAFF' as const, signatureImage: '/uploads/signatures/sig-002.png', ipAddress: '192.168.1.10', deviceInfo: 'Chrome 120 Windows' },
    { id: 'sig-003', contractId: 'cont-002', signerType: 'CUSTOMER' as const, signatureImage: '/uploads/signatures/sig-003.png', ipAddress: '192.168.1.101', deviceInfo: 'iPhone Safari 17.2' },
    { id: 'sig-004', contractId: 'cont-002', signerType: 'STAFF' as const, signatureImage: '/uploads/signatures/sig-004.png', ipAddress: '192.168.1.11', deviceInfo: 'Chrome 120 Windows' },
    { id: 'sig-005', contractId: 'cont-003', signerType: 'CUSTOMER' as const, signatureImage: '/uploads/signatures/sig-005.png', ipAddress: '192.168.1.102', deviceInfo: 'Android Chrome 120' },
    { id: 'sig-006', contractId: 'cont-003', signerType: 'STAFF' as const, signatureImage: '/uploads/signatures/sig-006.png', ipAddress: '192.168.1.10', deviceInfo: 'Chrome 120 Windows' },
    { id: 'sig-007', contractId: 'cont-005', signerType: 'CUSTOMER' as const, signatureImage: '/uploads/signatures/sig-007.png', ipAddress: '192.168.1.103', deviceInfo: 'Samsung Internet 20' },
    { id: 'sig-008', contractId: 'cont-005', signerType: 'STAFF' as const, signatureImage: '/uploads/signatures/sig-008.png', ipAddress: '192.168.1.10', deviceInfo: 'Chrome 120 Windows' },
  ];
  for (const s of sigData) { await prisma.signature.create({ data: s }); }
  console.log('Signatures created:', sigData.length);

  // ============================================================
  // STEP 17: E-DOCUMENTS
  // ============================================================
  const eDocsData = [
    { id: 'edoc-001', contractId: 'cont-001', documentType: 'CONTRACT', fileUrl: '/uploads/edocs/cont-001/contract.pdf', fileHash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2', createdById: 'user-004' },
    { id: 'edoc-002', contractId: 'cont-001', documentType: 'RECEIPT_DOWN', fileUrl: '/uploads/edocs/cont-001/receipt_down.pdf', fileHash: 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3', createdById: 'user-004' },
    { id: 'edoc-003', contractId: 'cont-002', documentType: 'CONTRACT', fileUrl: '/uploads/edocs/cont-002/contract.pdf', fileHash: 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4', createdById: 'user-005' },
    { id: 'edoc-004', contractId: 'cont-005', documentType: 'PAYOFF', fileUrl: '/uploads/edocs/cont-005/payoff.pdf', fileHash: 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5', createdById: 'user-004' },
  ];
  for (const e of eDocsData) { await prisma.eDocument.create({ data: e }); }
  console.log('EDocuments created:', eDocsData.length);


  // ============================================================
  // STEP 18: SALES (6 sales)
  // ============================================================
  // Sale 1: INSTALLMENT - iPhone 16 Pro Max (linked to cont-001)
  await prisma.sale.create({
    data: {
      id: 'sale-001', saleNumber: 'SL-2026-0001', saleType: 'INSTALLMENT', customerId: 'cust-001', productId: 'prod-003',
      branchId: 'branch-002', salespersonId: 'user-004', sellingPrice: 54900, discount: 0, netAmount: 54900,
      paymentMethod: 'CASH', amountReceived: 10900, contractId: 'cont-001', downPaymentAmount: 10900,
      notes: 'ลูกค้าจ่ายดาวน์เงินสด', createdAt: new Date('2026-01-12'),
    },
  });

  // Sale 2: INSTALLMENT - iPhone 13 (linked to cont-002)
  await prisma.sale.create({
    data: {
      id: 'sale-002', saleNumber: 'SL-2026-0002', saleType: 'INSTALLMENT', customerId: 'cust-002', productId: 'prod-010',
      branchId: 'branch-003', salespersonId: 'user-005', sellingPrice: 19900, discount: 0, netAmount: 19900,
      paymentMethod: 'CASH', amountReceived: 3900, contractId: 'cont-002', downPaymentAmount: 3900,
      createdAt: new Date('2026-01-22'),
    },
  });

  // Sale 3: CASH - iPhone 14
  await prisma.sale.create({
    data: {
      id: 'sale-003', saleNumber: 'SL-2026-0003', saleType: 'CASH', customerId: 'cust-007', productId: 'prod-007',
      branchId: 'branch-003', salespersonId: 'user-005', sellingPrice: 27900, discount: 1000, netAmount: 26900,
      paymentMethod: 'BANK_TRANSFER', amountReceived: 26900,
      notes: 'ลดราคาพิเศษ ลูกค้าประจำ', createdAt: new Date('2026-02-10'),
    },
  });

  // Sale 4: CASH - AirPods Pro 2
  await prisma.sale.create({
    data: {
      id: 'sale-004', saleNumber: 'SL-2026-0004', saleType: 'CASH', customerId: 'cust-010', productId: 'prod-023',
      branchId: 'branch-002', salespersonId: 'user-004', sellingPrice: 8990, discount: 0, netAmount: 8990,
      paymentMethod: 'QR_EWALLET', amountReceived: 8990,
      createdAt: new Date('2026-02-15'),
    },
  });

  // Sale 5: EXTERNAL_FINANCE - iPad mini 6
  await prisma.sale.create({
    data: {
      id: 'sale-005', saleNumber: 'SL-2026-0005', saleType: 'EXTERNAL_FINANCE', customerId: 'cust-011', productId: 'prod-019',
      branchId: 'branch-004', salespersonId: 'user-007', sellingPrice: 19900, discount: 0, netAmount: 19900,
      financeCompany: 'KTC', financeRefNumber: 'KTC-2026-00123', financeAmount: 19900,
      createdAt: new Date('2026-02-01'),
    },
  });

  // Sale 6: INSTALLMENT - iPad 10th Gen (linked to cont-003)
  await prisma.sale.create({
    data: {
      id: 'sale-006', saleNumber: 'SL-2026-0006', saleType: 'INSTALLMENT', customerId: 'cust-003', productId: 'prod-017',
      branchId: 'branch-002', salespersonId: 'user-004', sellingPrice: 18900, discount: 0, netAmount: 18900,
      paymentMethod: 'CASH', amountReceived: 3900, contractId: 'cont-003', downPaymentAmount: 3900,
      createdAt: new Date('2026-01-08'),
    },
  });
  console.log('Sales created: 6');

  // ============================================================
  // STEP 19: REPOSSESSION
  // ============================================================
  await prisma.repossession.create({
    data: {
      id: 'repo-001', contractId: 'cont-004', productId: 'prod-014',
      repossessedDate: new Date('2026-03-01'), conditionGrade: 'B', appraisalPrice: 15000,
      appraisedById: 'user-002', repairCost: 2000, resellPrice: 18000,
      photos: ['/uploads/repossessions/repo-001/front.jpg', '/uploads/repossessions/repo-001/back.jpg'],
      status: 'READY_FOR_SALE', notes: 'เครื่องสภาพดี เปลี่ยนแบตใหม่ พร้อมขายต่อ',
    },
  });
  console.log('Repossessions created: 1');


  // ============================================================
  // STEP 20: INSPECTION TEMPLATES + ITEMS
  // ============================================================
  const phoneTemplate = await prisma.inspectionTemplate.create({
    data: {
      id: 'insp-tmpl-001', name: 'ตรวจเช็คมือถือมือสอง', deviceType: 'PHONE',
      items: { create: [
        { id: 'iti-001', category: 'ภายนอก', itemName: 'สภาพตัวเครื่อง (รอยขีดข่วน/บุบ)', scoreType: 'GRADE', isRequired: true, weight: 15, sortOrder: 1 },
        { id: 'iti-002', category: 'ภายนอก', itemName: 'สภาพหน้าจอ (รอยร้าว/dead pixel)', scoreType: 'GRADE', isRequired: true, weight: 20, sortOrder: 2 },
        { id: 'iti-003', category: 'ภายนอก', itemName: 'สภาพปุ่มกด (Power, Volume)', scoreType: 'PASS_FAIL', isRequired: true, weight: 5, sortOrder: 3 },
        { id: 'iti-004', category: 'ภายนอก', itemName: 'ช่องชาร์จ', scoreType: 'PASS_FAIL', isRequired: true, weight: 5, sortOrder: 4 },
        { id: 'iti-005', category: 'การทำงาน', itemName: 'หน้าจอสัมผัส (touch ทุกจุด)', scoreType: 'PASS_FAIL', isRequired: true, weight: 10, sortOrder: 5 },
        { id: 'iti-006', category: 'การทำงาน', itemName: 'ลำโพง/ไมค์', scoreType: 'PASS_FAIL', isRequired: true, weight: 5, sortOrder: 6 },
        { id: 'iti-007', category: 'การทำงาน', itemName: 'กล้องหน้า/กล้องหลัง', scoreType: 'PASS_FAIL', isRequired: true, weight: 5, sortOrder: 7 },
        { id: 'iti-008', category: 'การทำงาน', itemName: 'Wi-Fi / Bluetooth', scoreType: 'PASS_FAIL', isRequired: true, weight: 5, sortOrder: 8 },
        { id: 'iti-009', category: 'การทำงาน', itemName: 'GPS / NFC', scoreType: 'PASS_FAIL', isRequired: false, weight: 3, sortOrder: 9 },
        { id: 'iti-010', category: 'การทำงาน', itemName: 'Face ID / สแกนนิ้ว', scoreType: 'PASS_FAIL', isRequired: true, weight: 5, sortOrder: 10 },
        { id: 'iti-011', category: 'แบตเตอรี่', itemName: 'สุขภาพแบตเตอรี่ (Battery Health %)', scoreType: 'NUMBER', isRequired: true, weight: 10, sortOrder: 11 },
        { id: 'iti-012', category: 'แบตเตอรี่', itemName: 'ชาร์จเข้า', scoreType: 'PASS_FAIL', isRequired: true, weight: 5, sortOrder: 12 },
        { id: 'iti-013', category: 'ซอฟต์แวร์', itemName: 'รีเซ็ตเครื่องแล้ว', scoreType: 'PASS_FAIL', isRequired: true, weight: 2, sortOrder: 13 },
        { id: 'iti-014', category: 'ซอฟต์แวร์', itemName: 'ปลดล็อค iCloud/Google Account', scoreType: 'PASS_FAIL', isRequired: true, weight: 3, sortOrder: 14 },
        { id: 'iti-015', category: 'ซอฟต์แวร์', itemName: 'IMEI ไม่ถูก block', scoreType: 'PASS_FAIL', isRequired: true, weight: 2, sortOrder: 15 },
      ]},
    },
  });

  const tabletTemplate = await prisma.inspectionTemplate.create({
    data: {
      id: 'insp-tmpl-002', name: 'ตรวจเช็คแท็บเล็ตมือสอง', deviceType: 'TABLET',
      items: { create: [
        { id: 'iti-016', category: 'ภายนอก', itemName: 'สภาพตัวเครื่อง', scoreType: 'GRADE', isRequired: true, weight: 15, sortOrder: 1 },
        { id: 'iti-017', category: 'ภายนอก', itemName: 'สภาพหน้าจอ', scoreType: 'GRADE', isRequired: true, weight: 20, sortOrder: 2 },
        { id: 'iti-018', category: 'การทำงาน', itemName: 'หน้าจอสัมผัส', scoreType: 'PASS_FAIL', isRequired: true, weight: 15, sortOrder: 3 },
        { id: 'iti-019', category: 'การทำงาน', itemName: 'ลำโพง', scoreType: 'PASS_FAIL', isRequired: true, weight: 10, sortOrder: 4 },
        { id: 'iti-020', category: 'การทำงาน', itemName: 'กล้อง', scoreType: 'PASS_FAIL', isRequired: true, weight: 10, sortOrder: 5 },
        { id: 'iti-021', category: 'แบตเตอรี่', itemName: 'สุขภาพแบตเตอรี่', scoreType: 'NUMBER', isRequired: true, weight: 15, sortOrder: 6 },
        { id: 'iti-022', category: 'อุปกรณ์เสริม', itemName: 'Apple Pencil ใช้งานได้', scoreType: 'PASS_FAIL', isRequired: false, weight: 5, sortOrder: 7 },
        { id: 'iti-023', category: 'อุปกรณ์เสริม', itemName: 'Keyboard ใช้งานได้', scoreType: 'PASS_FAIL', isRequired: false, weight: 5, sortOrder: 8 },
      ]},
    },
  });
  console.log('InspectionTemplates created: 2 (Phone: 15 items, Tablet: 8 items)');

  // ============================================================
  // STEP 21: INSPECTIONS + RESULTS
  // ============================================================
  // Inspection 1: iPhone 14 Pro (Grade A)
  await prisma.inspection.create({
    data: {
      id: 'insp-001', productId: 'prod-009', templateId: 'insp-tmpl-001', inspectorId: 'user-002',
      inspectedAt: new Date('2026-02-01'), overallGrade: 'A', isCompleted: true,
      photos: ['/uploads/inspections/insp-001/front.jpg', '/uploads/inspections/insp-001/back.jpg'],
      notes: 'สภาพดีมาก มีรอยขีดข่วนเล็กน้อยด้านหลัง',
      results: { create: [
        { id: 'ir-001', templateItemId: 'iti-001', grade: 'A', notes: 'รอยนิดเดียวด้านหลัง' },
        { id: 'ir-002', templateItemId: 'iti-002', grade: 'A', notes: 'จอสวย ไม่มี dead pixel' },
        { id: 'ir-003', templateItemId: 'iti-003', passFail: true },
        { id: 'ir-004', templateItemId: 'iti-004', passFail: true },
        { id: 'ir-005', templateItemId: 'iti-005', passFail: true },
        { id: 'ir-006', templateItemId: 'iti-006', passFail: true },
        { id: 'ir-007', templateItemId: 'iti-007', passFail: true },
        { id: 'ir-008', templateItemId: 'iti-008', passFail: true },
        { id: 'ir-009', templateItemId: 'iti-009', passFail: true },
        { id: 'ir-010', templateItemId: 'iti-010', passFail: true },
        { id: 'ir-011', templateItemId: 'iti-011', numberValue: 92, notes: 'Battery Health 92%' },
        { id: 'ir-012', templateItemId: 'iti-012', passFail: true },
        { id: 'ir-013', templateItemId: 'iti-013', passFail: true },
        { id: 'ir-014', templateItemId: 'iti-014', passFail: true },
        { id: 'ir-015', templateItemId: 'iti-015', passFail: true },
      ]},
    },
  });

  // Inspection 2: iPhone 13 (Grade B)
  await prisma.inspection.create({
    data: {
      id: 'insp-002', productId: 'prod-010', templateId: 'insp-tmpl-001', inspectorId: 'user-003',
      inspectedAt: new Date('2026-01-20'), overallGrade: 'B', isCompleted: true,
      notes: 'มีรอยตามการใช้งาน แบตลดลงบ้าง',
      results: { create: [
        { id: 'ir-016', templateItemId: 'iti-001', grade: 'B', notes: 'รอยขีดข่วนหลายจุด' },
        { id: 'ir-017', templateItemId: 'iti-002', grade: 'A' },
        { id: 'ir-018', templateItemId: 'iti-003', passFail: true },
        { id: 'ir-019', templateItemId: 'iti-004', passFail: true },
        { id: 'ir-020', templateItemId: 'iti-005', passFail: true },
        { id: 'ir-021', templateItemId: 'iti-006', passFail: true },
        { id: 'ir-022', templateItemId: 'iti-007', passFail: true },
        { id: 'ir-023', templateItemId: 'iti-008', passFail: true },
        { id: 'ir-024', templateItemId: 'iti-011', numberValue: 85 },
        { id: 'ir-025', templateItemId: 'iti-012', passFail: true },
        { id: 'ir-026', templateItemId: 'iti-013', passFail: true },
        { id: 'ir-027', templateItemId: 'iti-014', passFail: true },
        { id: 'ir-028', templateItemId: 'iti-015', passFail: true },
      ]},
    },
  });

  // Inspection 3: iPhone 11 (Grade D - damaged)
  await prisma.inspection.create({
    data: {
      id: 'insp-003', productId: 'prod-015', templateId: 'insp-tmpl-001', inspectorId: 'user-003',
      inspectedAt: new Date('2025-12-20'), overallGrade: 'D', isCompleted: true,
      notes: 'จอมีรอยร้าว ลำโพงเสีย',
      results: { create: [
        { id: 'ir-029', templateItemId: 'iti-001', grade: 'C' },
        { id: 'ir-030', templateItemId: 'iti-002', grade: 'D', notes: 'จอร้าวมุมขวาล่าง' },
        { id: 'ir-031', templateItemId: 'iti-003', passFail: true },
        { id: 'ir-032', templateItemId: 'iti-004', passFail: true },
        { id: 'ir-033', templateItemId: 'iti-005', passFail: false, notes: 'touch ไม่ตอบสนองมุมขวาล่าง' },
        { id: 'ir-034', templateItemId: 'iti-006', passFail: false, notes: 'ลำโพงซ้ายเสีย' },
        { id: 'ir-035', templateItemId: 'iti-007', passFail: true },
        { id: 'ir-036', templateItemId: 'iti-011', numberValue: 65 },
        { id: 'ir-037', templateItemId: 'iti-012', passFail: true },
        { id: 'ir-038', templateItemId: 'iti-013', passFail: true },
        { id: 'ir-039', templateItemId: 'iti-014', passFail: true },
        { id: 'ir-040', templateItemId: 'iti-015', passFail: true },
      ]},
    },
  });
  // Link inspections to products
  await prisma.product.update({ where: { id: 'prod-009' }, data: { inspectionId: 'insp-001' } });
  await prisma.product.update({ where: { id: 'prod-010' }, data: { inspectionId: 'insp-002' } });
  await prisma.product.update({ where: { id: 'prod-015' }, data: { inspectionId: 'insp-003' } });
  console.log('Inspections created: 3 (with results)');


  // ============================================================
  // STEP 22: STOCK TRANSFERS + BRANCH RECEIVINGS
  // ============================================================
  // Transfer 1: Warehouse -> ลาดพร้าว (CONFIRMED)
  await prisma.stockTransfer.create({
    data: {
      id: 'st-001', productId: 'prod-005', fromBranchId: 'branch-001', toBranchId: 'branch-002',
      transferredBy: 'user-001', status: 'CONFIRMED',
      dispatchedById: 'user-001', dispatchedAt: new Date('2026-02-01'), trackingNote: 'ส่งรถบริษัท',
      confirmedById: 'user-002', confirmedAt: new Date('2026-02-01'),
      notes: 'โอนจากคลังไปลาดพร้าว',
    },
  });
  await prisma.branchReceiving.create({
    data: {
      id: 'br-001', transferId: 'st-001', receivedById: 'user-002', status: 'COMPLETED', notes: 'รับเรียบร้อย',
      items: { create: [
        { id: 'bri-001', productId: 'prod-005', imeiSerial: '354567890123461', status: 'PASS' },
      ]},
    },
  });

  // Transfer 2: ลาดพร้าว -> รามคำแหง (IN_TRANSIT)
  await prisma.stockTransfer.create({
    data: {
      id: 'st-002', productId: 'prod-012', fromBranchId: 'branch-002', toBranchId: 'branch-003',
      transferredBy: 'user-002', status: 'IN_TRANSIT',
      dispatchedById: 'user-002', dispatchedAt: new Date('2026-03-05'), trackingNote: 'ส่ง Grab Express',
      expectedDeliveryDate: new Date('2026-03-06'),
      notes: 'ลูกค้ารามคำแหงต้องการเครื่องนี้',
    },
  });

  // Transfer 3: Warehouse -> บางแค (PENDING)
  await prisma.stockTransfer.create({
    data: {
      id: 'st-003', productId: 'prod-024', fromBranchId: 'branch-001', toBranchId: 'branch-004',
      transferredBy: 'user-001', status: 'PENDING',
      notes: 'รอจัดส่งที่ชาร์จ MagSafe ไปบางแค',
    },
  });

  // Transfer 4: รามคำแหง -> ลาดพร้าว (REJECTED)
  await prisma.stockTransfer.create({
    data: {
      id: 'st-004', productId: 'prod-022', fromBranchId: 'branch-003', toBranchId: 'branch-002',
      transferredBy: 'user-003', status: 'REJECTED',
      dispatchedById: 'user-003', dispatchedAt: new Date('2026-02-20'),
      confirmedById: 'user-002', confirmedAt: new Date('2026-02-21'),
      notes: 'ลาดพร้าวมีสายชาร์จเพียงพอแล้ว',
    },
  });
  console.log('StockTransfers created: 4 (with BranchReceiving)');

  // ============================================================
  // STEP 23: STOCK ADJUSTMENTS
  // ============================================================
  await prisma.stockAdjustment.create({
    data: {
      id: 'sa-001', productId: 'prod-015', branchId: 'branch-003', reason: 'DAMAGED', previousStatus: 'IN_STOCK',
      notes: 'จอร้าว ลำโพงเสีย ตรวจสอบจาก inspection แล้ว',
      photos: ['/uploads/adjustments/sa-001/damage.jpg'],
      adjustedById: 'user-003',
    },
  });
  await prisma.stockAdjustment.create({
    data: {
      id: 'sa-002', productId: 'prod-014', branchId: 'branch-002', reason: 'CORRECTION', previousStatus: 'SOLD_INSTALLMENT',
      notes: 'แก้สถานะเป็น REPOSSESSED หลังยึดเครื่องคืน',
      adjustedById: 'user-002',
    },
  });
  await prisma.stockAdjustment.create({
    data: {
      id: 'sa-003', productId: 'prod-008', branchId: 'branch-004', reason: 'FOUND', previousStatus: 'IN_STOCK',
      notes: 'สแกนพบเครื่องที่เคยบันทึกหาย คืนสถานะแล้ว',
      adjustedById: 'user-008',
    },
  });
  console.log('StockAdjustments created: 3');


  // ============================================================
  // STEP 24: REORDER POINTS + STOCK ALERTS
  // ============================================================
  await prisma.reorderPoint.create({
    data: {
      id: 'rp-001', brand: 'Apple', model: 'iPhone 15 Pro Max', storage: '256GB', category: 'PHONE_NEW',
      branchId: 'branch-002', minQuantity: 2, reorderQuantity: 5,
    },
  });
  await prisma.reorderPoint.create({
    data: {
      id: 'rp-002', brand: 'Apple', model: 'iPhone 16 Pro Max', storage: '256GB', category: 'PHONE_NEW',
      branchId: 'branch-002', minQuantity: 2, reorderQuantity: 3,
    },
  });
  await prisma.reorderPoint.create({
    data: {
      id: 'rp-003', brand: 'Apple', model: 'iPhone 14 Pro', storage: '128GB', category: 'PHONE_USED',
      branchId: 'branch-002', minQuantity: 3, reorderQuantity: 5,
    },
  });
  await prisma.reorderPoint.create({
    data: {
      id: 'rp-004', brand: 'Apple', model: 'iPhone 13', storage: '128GB', category: 'PHONE_USED',
      branchId: 'branch-003', minQuantity: 2, reorderQuantity: 4,
    },
  });
  console.log('ReorderPoints created: 4');

  // Stock Alerts
  await prisma.stockAlert.create({
    data: {
      id: 'sa-alert-001', reorderPointId: 'rp-002', brand: 'Apple', model: 'iPhone 16 Pro Max', storage: '256GB',
      category: 'PHONE_NEW', branchId: 'branch-002', currentStock: 0, minQuantity: 2, reorderQuantity: 3,
      status: 'ACTIVE',
    },
  });
  await prisma.stockAlert.create({
    data: {
      id: 'sa-alert-002', reorderPointId: 'rp-003', brand: 'Apple', model: 'iPhone 14 Pro', storage: '128GB',
      category: 'PHONE_USED', branchId: 'branch-002', currentStock: 1, minQuantity: 3, reorderQuantity: 5,
      status: 'PO_CREATED', poId: 'po-004',
    },
  });
  await prisma.stockAlert.create({
    data: {
      id: 'sa-alert-003', reorderPointId: 'rp-004', brand: 'Apple', model: 'iPhone 13', storage: '128GB',
      category: 'PHONE_USED', branchId: 'branch-003', currentStock: 0, minQuantity: 2, reorderQuantity: 4,
      status: 'RESOLVED', resolvedAt: new Date('2026-02-15'),
    },
  });
  console.log('StockAlerts created: 3');

  // ============================================================
  // STEP 25: STOCK COUNTS + ITEMS
  // ============================================================
  // Stock Count 1: Completed count at ลาดพร้าว
  await prisma.stockCount.create({
    data: {
      id: 'sc-001', countNumber: 'SC-2026-03-001', branchId: 'branch-002', countedById: 'user-002',
      status: 'COMPLETED', notes: 'ตรวจนับสต็อกประจำเดือน มีนาคม', startedAt: new Date('2026-03-01 09:00:00'), completedAt: new Date('2026-03-01 12:00:00'),
      items: { create: [
        { id: 'sci-001', productId: 'prod-001', expectedStatus: 'IN_STOCK', actualFound: true, scannedImei: '354567890123456' },
        { id: 'sci-002', productId: 'prod-002', expectedStatus: 'IN_STOCK', actualFound: true, scannedImei: '354567890123457' },
        { id: 'sci-003', productId: 'prod-005', expectedStatus: 'IN_STOCK', actualFound: true, scannedImei: '354567890123461' },
        { id: 'sci-004', productId: 'prod-009', expectedStatus: 'IN_STOCK', actualFound: true, scannedImei: '354567890123463' },
        { id: 'sci-005', productId: 'prod-012', expectedStatus: 'IN_STOCK', actualFound: true, scannedImei: '354567890123466' },
        { id: 'sci-006', productId: 'prod-020', expectedStatus: 'IN_STOCK', actualFound: true },
        { id: 'sci-007', productId: 'prod-021', expectedStatus: 'IN_STOCK', actualFound: true },
      ]},
    },
  });

  // Stock Count 2: In progress at รามคำแหง
  await prisma.stockCount.create({
    data: {
      id: 'sc-002', countNumber: 'SC-2026-03-002', branchId: 'branch-003', countedById: 'user-003',
      status: 'IN_PROGRESS', notes: 'กำลังนับ', startedAt: new Date('2026-03-05 10:00:00'),
      items: { create: [
        { id: 'sci-008', productId: 'prod-004', expectedStatus: 'IN_STOCK', actualFound: true, scannedImei: '354567890123459' },
        { id: 'sci-009', productId: 'prod-018', expectedStatus: 'IN_STOCK', actualFound: false, conditionNotes: 'ยังไม่พบ กำลังค้นหา' },
        { id: 'sci-010', productId: 'prod-022', expectedStatus: 'IN_STOCK', actualFound: true },
        { id: 'sci-011', productId: 'prod-025', expectedStatus: 'IN_STOCK', actualFound: true },
      ]},
    },
  });

  // Stock Count 3: Draft at บางแค
  await prisma.stockCount.create({
    data: {
      id: 'sc-003', countNumber: 'SC-2026-03-003', branchId: 'branch-004', countedById: 'user-008',
      status: 'DRAFT', notes: 'เตรียมนับสต็อก สัปดาห์หน้า',
    },
  });
  console.log('StockCounts created: 3 (with items)');


  // ============================================================
  // STEP 26: CALL LOGS
  // ============================================================
  const callLogsData = [
    { id: 'cl-001', contractId: 'cont-003', callerId: 'user-004', calledAt: new Date('2026-03-01 10:30:00'), result: 'ANSWERED', notes: 'ลูกค้าบอกจะมาจ่ายสัปดาห์หน้า' },
    { id: 'cl-002', contractId: 'cont-003', callerId: 'user-004', calledAt: new Date('2026-03-04 14:00:00'), result: 'NO_ANSWER', notes: 'โทรไม่รับ 3 ครั้ง' },
    { id: 'cl-003', contractId: 'cont-004', callerId: 'user-005', calledAt: new Date('2026-02-10 11:00:00'), result: 'NO_ANSWER', notes: 'ติดต่อไม่ได้' },
    { id: 'cl-004', contractId: 'cont-004', callerId: 'user-005', calledAt: new Date('2026-02-15 09:00:00'), result: 'REFUSED', notes: 'ลูกค้าปฏิเสธจ่าย อ้างไม่มีเงิน' },
    { id: 'cl-005', contractId: 'cont-004', callerId: 'user-002', calledAt: new Date('2026-02-20 15:30:00'), result: 'PROMISED', notes: 'โทรจากผู้จัดการ ลูกค้าสัญญาจะจ่ายภายในสิ้นเดือน แต่ไม่มา' },
    { id: 'cl-006', contractId: 'cont-001', callerId: 'user-004', calledAt: new Date('2026-02-13 16:00:00'), result: 'ANSWERED', notes: 'แจ้งเตือนครบกำหนดงวด 3 ลูกค้ารับทราบ' },
  ];
  for (const cl of callLogsData) { await prisma.callLog.create({ data: cl }); }
  console.log('CallLogs created:', callLogsData.length);

  // ============================================================
  // STEP 27: NOTIFICATION LOGS
  // ============================================================
  const notifData = [
    { id: 'noti-001', channel: 'LINE' as const, recipient: 'somchai_j', subject: 'แจ้งเตือนค่างวด', message: 'สวัสดีค่ะ คุณสมชาย ค่างวด BCP2601-00001 จำนวน 7,920 บาท ครบกำหนด 15/02/2026', status: 'SENT', relatedId: 'cont-001', sentAt: new Date('2026-02-12') },
    { id: 'noti-002', channel: 'LINE' as const, recipient: 'somchai_j', subject: 'ชำระเงินสำเร็จ', message: 'ขอบคุณค่ะ คุณสมชาย ชำระค่างวด BCP2601-00001 จำนวน 7,920 บาท สำเร็จ คงเหลือ 7 งวด', status: 'SENT', relatedId: 'cont-001', sentAt: new Date('2026-02-13') },
    { id: 'noti-003', channel: 'SMS' as const, recipient: '083-333-3333', subject: 'แจ้งค้างชำระ', message: 'BestChoice: คุณวิชัย ค่างวด BCP2601-00003 เลยกำหนด 5 วัน ค้างชำระ 3,275 บาท', status: 'SENT', relatedId: 'cont-003', sentAt: new Date('2026-03-05') },
    { id: 'noti-004', channel: 'LINE' as const, recipient: 'napa_k', subject: 'แจ้งผิดนัดชำระ', message: 'สำคัญ: คุณนภา สัญญา BCP2601-00004 เปลี่ยนสถานะผิดนัดชำระ กรุณาติดต่อสาขา', status: 'SENT', relatedId: 'cont-004', sentAt: new Date('2026-02-25') },
    { id: 'noti-005', channel: 'SMS' as const, recipient: '084-444-4444', subject: 'แจ้งผิดนัดชำระ', message: 'BestChoice: คุณนภา สัญญา BCP2601-00004 ผิดนัดชำระ กรุณาติดต่อสาขา 02-222-2222', status: 'FAILED', relatedId: 'cont-004', errorMsg: 'SMS gateway timeout' },
    { id: 'noti-006', channel: 'IN_APP' as const, recipient: 'user-002', message: 'Stock Alert: iPhone 16 Pro Max 256GB ที่สาขาลาดพร้าว เหลือ 0 เครื่อง (ต่ำกว่าขั้นต่ำ 2)', status: 'SENT', relatedId: 'sa-alert-001', sentAt: new Date('2026-03-01') },
  ];
  for (const n of notifData) { await prisma.notificationLog.create({ data: n }); }
  console.log('NotificationLogs created:', notifData.length);

  // ============================================================
  // STEP 28: AUDIT LOGS
  // ============================================================
  const auditData = [
    { id: 'audit-001', userId: 'user-004', action: 'CREATE', entity: 'contract', entityId: 'cont-001', newValue: { contractNumber: 'BCP2601-00001', status: 'DRAFT' }, ipAddress: '192.168.1.10', userAgent: 'Chrome/120 Windows', duration: 250 },
    { id: 'audit-002', userId: 'user-002', action: 'UPDATE', entity: 'contract', entityId: 'cont-001', oldValue: { workflowStatus: 'PENDING_REVIEW' }, newValue: { workflowStatus: 'APPROVED' }, ipAddress: '192.168.1.11', userAgent: 'Chrome/120 macOS', duration: 180 },
    { id: 'audit-003', userId: 'user-004', action: 'CREATE', entity: 'payment', entityId: 'pay-001-01', newValue: { amountPaid: 7200, status: 'PAID' }, ipAddress: '192.168.1.10', userAgent: 'Chrome/120 Windows', duration: 120 },
    { id: 'audit-004', userId: 'user-005', action: 'CREATE', entity: 'contract', entityId: 'cont-004', newValue: { contractNumber: 'BCP2601-00004', status: 'DRAFT' }, ipAddress: '192.168.1.12', userAgent: 'Safari/17 iPad', duration: 300 },
    { id: 'audit-005', userId: 'user-001', action: 'UPDATE', entity: 'contract', entityId: 'cont-004', oldValue: { status: 'OVERDUE' }, newValue: { status: 'DEFAULT' }, ipAddress: '192.168.1.1', userAgent: 'Chrome/120 Windows', duration: 150 },
    { id: 'audit-006', userId: 'user-002', action: 'REPOSSESSION', entity: 'product', entityId: 'prod-014', newValue: { status: 'REPOSSESSED', repossessionId: 'repo-001' }, ipAddress: '192.168.1.11', userAgent: 'Chrome/120 macOS', duration: 200 },
    { id: 'audit-007', userId: 'user-001', action: 'CREATE', entity: 'purchase_order', entityId: 'po-001', newValue: { poNumber: 'PO-2026-01-001', status: 'DRAFT' }, ipAddress: '192.168.1.1', userAgent: 'Chrome/120 Windows', duration: 280 },
    { id: 'audit-008', userId: 'user-001', action: 'UPDATE', entity: 'purchase_order', entityId: 'po-001', oldValue: { status: 'DRAFT' }, newValue: { status: 'APPROVED' }, ipAddress: '192.168.1.1', userAgent: 'Chrome/120 Windows', duration: 100 },
    { id: 'audit-009', userId: 'user-002', action: 'CREATE', entity: 'goods_receiving', entityId: 'gr-001', newValue: { poId: 'po-001', itemCount: 2 }, ipAddress: '192.168.1.11', userAgent: 'Chrome/120 macOS', duration: 350 },
    { id: 'audit-010', userId: 'user-001', action: 'CREATE', entity: 'stock_transfer', entityId: 'st-001', newValue: { productId: 'prod-005', from: 'branch-001', to: 'branch-002' }, ipAddress: '192.168.1.1', userAgent: 'Chrome/120 Windows', duration: 130 },
  ];
  for (const a of auditData) { await prisma.auditLog.create({ data: a }); }
  console.log('AuditLogs created:', auditData.length);

  // ============================================================
  // STEP 29: CONTRACT TEMPLATES
  // ============================================================
  const templateHtml = fs.readFileSync(path.join(__dirname, '../src/modules/documents/templates/hire-purchase-contract.html'), 'utf-8');
  await prisma.contractTemplate.create({
    data: {
      id: 'ct-001', name: 'สัญญาเช่าซื้อโทรศัพท์มือถือ', type: 'STORE_DIRECT',
      contentHtml: templateHtml,
      placeholders: [
        'contract_number', 'contract_date', 'contract_date_day', 'contract_date_month', 'contract_date_year',
        'customer_name', 'customer_prefix', 'national_id', 'customer_phone', 'customer_phone_secondary',
        'customer_address_id_card', 'customer_address_current', 'customer_line_id', 'customer_facebook',
        'customer_references', 'brand', 'model', 'product_color', 'product_storage', 'product_category',
        'imei', 'serial_number', 'selling_price', 'down_payment', 'monthly_payment', 'total_months',
        'financed_amount', 'interest_rate', 'interest_total', 'payment_schedule_table',
        'branch_name', 'branch_address', 'salesperson_name', 'customer_signature', 'staff_signature',
      ],
    },
  });
  console.log('ContractTemplates created: 1 (สัญญาเช่าซื้อโทรศัพท์มือถือ)');

  // ============================================================
  // STEP 30: STICKER TEMPLATES
  // ============================================================
  await prisma.stickerTemplate.create({
    data: {
      id: 'stk-001', name: 'สติ๊กเกอร์ราคา มาตรฐาน', sizeWidthMm: 50, sizeHeightMm: 30,
      layoutConfig: { rows: [{ type: 'text', field: 'product_name', fontSize: 10, bold: true }, { type: 'text', field: 'price', fontSize: 14, bold: true, color: 'red' }, { type: 'barcode', field: 'imei_serial', height: 15 }] },
      placeholders: ['product_name', 'price', 'imei_serial', 'branch_name'],
    },
  });
  await prisma.stickerTemplate.create({
    data: {
      id: 'stk-002', name: 'สติ๊กเกอร์ QR สินค้า', sizeWidthMm: 40, sizeHeightMm: 40,
      layoutConfig: { rows: [{ type: 'qrcode', field: 'product_url', size: 30 }, { type: 'text', field: 'product_name', fontSize: 8 }] },
      placeholders: ['product_url', 'product_name', 'product_id'],
    },
  });
  console.log('StickerTemplates created: 2');

  // ============================================================
  // DONE
  // ============================================================
  console.log('');
  console.log('=== Seeding completed! ===');
  console.log('Summary:');
  console.log('  Branches: 4 (1 warehouse + 3 stores)');
  console.log('  Users: 8 (1 owner, 3 managers, 3 sales, 1 accountant)');
  console.log('  Suppliers: 10 (with 11 payment methods)');
  console.log('  Products: 25 (8 new phones, 7 used phones, 4 tablets, 6 accessories)');
  console.log('  ProductPrices: 25');
  console.log('  PurchaseOrders: 7 (with PO items)');
  console.log('  GoodsReceivings: 4 (with items)');
  console.log('  Customers: 12');
  console.log('  InterestConfigs: 4');
  console.log('  Contracts: 10 (ACTIVE, OVERDUE, DEFAULT, COMPLETED, EARLY_PAYOFF, DRAFT, CREATING, REJECTED)');
  console.log('  Payments: 41');
  console.log('  ContractDocuments: 10');
  console.log('  CreditChecks: 7');
  console.log('  Signatures: 8');
  console.log('  EDocuments: 4');
  console.log('  Sales: 6 (CASH, INSTALLMENT, EXTERNAL_FINANCE)');
  console.log('  Repossessions: 1');
  console.log('  InspectionTemplates: 2 (Phone 15 items, Tablet 8 items)');
  console.log('  Inspections: 3 (with results)');
  console.log('  StockTransfers: 4 (CONFIRMED, IN_TRANSIT, PENDING, REJECTED)');
  console.log('  BranchReceivings: 1 (with items)');
  console.log('  StockAdjustments: 3');
  console.log('  ReorderPoints: 4');
  console.log('  StockAlerts: 3 (ACTIVE, PO_CREATED, RESOLVED)');
  console.log('  StockCounts: 3 (COMPLETED, IN_PROGRESS, DRAFT)');
  console.log('  CallLogs: 6');
  console.log('  NotificationLogs: 6');
  console.log('  AuditLogs: 10');
  console.log('  ContractTemplates: 3');
  console.log('  StickerTemplates: 2');
  console.log('  SystemConfig: 18');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
