import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Resetting & Seeding database ===');

  // DELETE ALL DATA (reverse dependency order)
  console.log('Deleting all existing data...');
  await prisma.paymentEvidence.deleteMany();
  await prisma.paymentLink.deleteMany();
  await prisma.receipt.deleteMany();
  await prisma.documentAuditLog.deleteMany();
  await prisma.customerAccessToken.deleteMany();
  await prisma.dSARRequest.deleteMany();
  await prisma.pDPAConsent.deleteMany();
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
  await prisma.pricingTemplate.deleteMany();
  await prisma.productPhoto.deleteMany();
  await prisma.goodsReceivingItem.deleteMany();
  await prisma.goodsReceiving.deleteMany();
  await prisma.pOItem.deleteMany();
  await prisma.product.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.supplierPaymentMethod.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.systemConfig.deleteMany();
  await prisma.contractTemplate.deleteMany();
  await prisma.stickerTemplate.deleteMany();
  await prisma.companyInfo.deleteMany();
  console.log('All data deleted.');

  // ============================================================
  // STEP 1: CompanyInfo
  // ============================================================
  console.log('STEP 1: Creating CompanyInfo...');

  await prisma.companyInfo.create({
    data: {
      id: 'company-001',
      nameTh: 'เบสท์ชอยส์ โมบาย',
      nameEn: 'BESTCHOICE Mobile',
      taxId: '0105566012345',
      address: '99 ถ.วิภาวดีรังสิต แขวงจตุจักร เขตจตุจักร กรุงเทพฯ 10900',
      phone: '02-100-0000',
      directorName: 'สุรชัย เจ้าของร้าน',
      directorPosition: 'กรรมการผู้จัดการ',
      directorNationalId: '1100100100000',
      directorAddress: '99 ถ.วิภาวดีรังสิต แขวงจตุจักร เขตจตุจักร กรุงเทพฯ 10900',
    },
  });

  console.log('CompanyInfo created: 1');

  // ============================================================
  // STEP 2: SystemConfig (21 configs)
  // ============================================================
  console.log('STEP 2: Creating SystemConfig...');

  const configs = [
    { key: 'company_name', value: 'BEST CHOICE Mobile', label: 'ชื่อบริษัท' },
    { key: 'company_phone', value: '02-100-0000', label: 'เบอร์โทรบริษัท' },
    { key: 'late_fee_per_day', value: '50', label: 'ค่าปรับล่าช้า/วัน (บาท)' },
    { key: 'max_late_fee', value: '500', label: 'ค่าปรับล่าช้าสูงสุด (บาท)' },
    { key: 'default_interest_rate', value: '0.08', label: 'อัตราดอกเบี้ยเริ่มต้น' },
    { key: 'min_down_payment_pct', value: '0.20', label: 'เปอร์เซ็นต์เงินดาวน์ขั้นต่ำ' },
    { key: 'max_installment_months', value: '12', label: 'จำนวนงวดสูงสุด' },
    { key: 'contract_number_prefix', value: 'BCP', label: 'Prefix เลขสัญญา' },
    { key: 'receipt_number_prefix', value: 'RCP', label: 'Prefix เลขใบเสร็จ' },
    { key: 'po_number_prefix', value: 'PO', label: 'Prefix เลข PO' },
    { key: 'sale_number_prefix', value: 'SL', label: 'Prefix เลขขาย' },
    { key: 'overdue_notification_days', value: '3', label: 'แจ้งเตือนก่อนครบกำหนด (วัน)' },
    { key: 'default_threshold_days', value: '90', label: 'จำนวนวันก่อนเปลี่ยนสถานะผิดนัด' },
    { key: 'notification_line_enabled', value: 'true', label: 'เปิดแจ้งเตือน LINE' },
    { key: 'notification_sms_enabled', value: 'false', label: 'เปิดแจ้งเตือน SMS' },
    { key: 'line_channel_access_token', value: '', label: 'LINE Channel Access Token' },
    { key: 'line_channel_secret', value: '', label: 'LINE Channel Secret' },
    { key: 'promptpay_id', value: '', label: 'PromptPay ID' },
    { key: 'line_oa_welcome_message', value: 'ยินดีต้อนรับสู่ BESTCHOICE Mobile! พิมพ์เลขสัญญาเพื่อตรวจสอบยอดชำระ', label: 'ข้อความต้อนรับ LINE OA' },
    { key: 'line_oa_payment_reminder_template', value: 'แจ้งเตือน: สัญญา {contractNo} ครบกำหนดชำระงวดที่ {installment} จำนวน {amount} บาท ภายในวันที่ {dueDate}', label: 'เทมเพลตแจ้งเตือนชำระเงิน LINE OA' },
    { key: 'line_oa_overdue_template', value: 'แจ้งเตือน: สัญญา {contractNo} เลยกำหนดชำระ {overdueDays} วัน กรุณาชำระโดยเร็ว', label: 'เทมเพลตแจ้งเตือนค้างชำระ LINE OA' },
  ];

  for (const c of configs) {
    await prisma.systemConfig.create({ data: c });
  }

  console.log('SystemConfig created:', configs.length);

  // ============================================================
  // STEP 3: Branches (4 - 1 warehouse + 3 stores)
  // ============================================================
  console.log('STEP 3: Creating Branches...');

  const branch1 = await prisma.branch.create({
    data: { id: 'branch-001', name: 'คลังสินค้าหลัก (Main Warehouse)', location: '99 ถ.วิภาวดีรังสิต แขวงจตุจักร เขตจตุจักร กทม. 10900', phone: '02-100-0000', isMainWarehouse: true },
  });
  const branch2 = await prisma.branch.create({
    data: { id: 'branch-002', name: 'สาขาลาดพร้าว', location: '123 ถ.ลาดพร้าว แขวงจอมพล เขตจตุจักร กทม. 10900', phone: '02-111-1111' },
  });
  const branch3 = await prisma.branch.create({
    data: { id: 'branch-003', name: 'สาขารามคำแหง', location: '456 ถ.รามคำแหง แขวงหัวหมาก เขตบางกะปิ กทม. 10240', phone: '02-222-2222' },
  });
  const branch4 = await prisma.branch.create({
    data: { id: 'branch-004', name: 'สาขาบางแค', location: '789 ถ.เพชรเกษม แขวงบางแค เขตบางแค กทม. 10160', phone: '02-333-3333' },
  });

  console.log('Branches created: 4 (1 warehouse + 3 stores)');

  // ============================================================
  // STEP 4: Users (8 - 1 OWNER, 3 BRANCH_MANAGER, 3 SALES, 1 ACCOUNTANT)
  // ============================================================
  console.log('STEP 4: Creating Users...');

  const hashedPassword = await bcrypt.hash('admin1234', 10);

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
  // STEP 5: Suppliers (10 - Apple + accessories only, NO Samsung)
  // ============================================================
  console.log('STEP 5: Creating Suppliers...');

  const suppliersData = [
    // --- 3 Apple Authorized Resellers (new phones) ---
    { id: 'sup-001', name: 'Apple Authorized (สยามพารากอน)', contactName: 'คุณวิชัย', phone: '02-610-9999', address: '991 ถ.พระราม 1 แขวงปทุมวัน กทม. 10330', taxId: '0105555000001', hasVat: true, notes: 'ตัวแทนจำหน่าย Apple อย่างเป็นทางการ' },
    { id: 'sup-002', name: 'iStudio by Copperwired', contactName: 'คุณสมศรี', phone: '02-611-1111', address: 'เซ็นทรัลเวิลด์ ชั้น 4 แขวงปทุมวัน กทม. 10330', taxId: '0105555000002', hasVat: true, notes: 'Apple Premium Reseller' },
    { id: 'sup-003', name: 'Power Buy (Apple Section)', contactName: 'คุณธนา', phone: '02-612-2222', address: 'เซ็นทรัลลาดพร้าว ชั้น 3 กทม. 10900', taxId: '0105555000003', hasVat: true, notes: 'ร้านค้าเทคโนโลยี แผนก Apple' },
    // --- 3 Used phone shops (MBK, Pantip, etc.) ---
    { id: 'sup-004', name: 'ร้านมือสอง MBK (ชัยมงคล)', contactName: 'คุณชัย', nickname: 'ชัย MBK', phone: '081-234-5678', address: 'MBK Center ชั้น 4 ห้อง 4A-01 แขวงวังใหม่ กทม. 10330', notes: 'ร้านมือสอง MBK ขายส่ง iPhone มือสอง' },
    { id: 'sup-005', name: 'ร้านมือสอง พันธุ์ทิพย์ (สมบูรณ์โมบาย)', contactName: 'คุณสมบูรณ์', nickname: 'บูรณ์', phone: '089-876-5432', address: 'พันธุ์ทิพย์พลาซ่า ชั้น 2 ถ.เพชรบุรีตัดใหม่ กทม. 10400', notes: 'มือสอง iPhone/iPad เกรด A-B' },
    { id: 'sup-006', name: 'iCare Refurbished', contactName: 'คุณปิยะ', phone: '095-111-2222', lineId: 'icare_refurb', address: '55 ซ.ลาดพร้าว 35 กทม. 10900', notes: 'มือสอง Certified Refurbished' },
    // --- 2 iPad/Tablet distributors ---
    { id: 'sup-007', name: 'Apple Store Online TH', contactName: 'Apple Support', phone: '1800-019-900', address: 'Apple Southeast Asia Pte. Ltd.', taxId: '0105555000007', hasVat: true, notes: 'สั่งซื้อผ่าน apple.com/th - iPad, Mac' },
    { id: 'sup-008', name: 'ร้านมือสอง MBK (วิทยาโมบาย)', contactName: 'คุณวิทยา', nickname: 'วิท', phone: '082-333-4444', address: 'MBK Center ชั้น 4 ห้อง 4B-12 กทม. 10330', notes: 'มือสอง เกรดรวม A-D ราคาส่ง' },
    // --- 2 Accessory shops ---
    { id: 'sup-009', name: 'Spigen Thailand', contactName: 'คุณอาทิตย์', phone: '02-700-8888', address: '123 อาคารเมืองไทยภัทร ถ.รัชดาภิเษก กทม.', taxId: '0105555000009', hasVat: true, notes: 'เคส ฟิล์ม อุปกรณ์เสริม Apple' },
    { id: 'sup-010', name: 'Anker Official TH', contactName: 'คุณเจนนิเฟอร์', phone: '02-701-9999', address: '456 อาคารสาทรซิตี้ ถ.สาทร กทม.', taxId: '0105555000010', hasVat: true, notes: 'ที่ชาร์จ สายชาร์จ แบตสำรอง' },
  ];

  for (const s of suppliersData) {
    await prisma.supplier.create({ data: s });
  }

  console.log('Suppliers created:', suppliersData.length);

  // ============================================================
  // STEP 6: SupplierPaymentMethods (11)
  // ============================================================
  console.log('STEP 6: Creating SupplierPaymentMethods...');

  const spmData = [
    { id: 'spm-001', supplierId: 'sup-001', paymentMethod: 'BANK_TRANSFER' as const, bankName: 'กสิกรไทย', bankAccountName: 'บจก. แอปเปิ้ล เซาท์เอเชีย', bankAccountNumber: '123-4-56789-0', isDefault: true },
    { id: 'spm-002', supplierId: 'sup-002', paymentMethod: 'BANK_TRANSFER' as const, bankName: 'กรุงเทพ', bankAccountName: 'บจก. คอปเปอร์ไวร์ด', bankAccountNumber: '234-5-67890-1', isDefault: true },
    { id: 'spm-003', supplierId: 'sup-003', paymentMethod: 'BANK_TRANSFER' as const, bankName: 'ไทยพาณิชย์', bankAccountName: 'บมจ. พาวเวอร์บาย', bankAccountNumber: '345-6-78901-2', isDefault: true },
    { id: 'spm-004', supplierId: 'sup-004', paymentMethod: 'CASH' as const, isDefault: true },
    { id: 'spm-005', supplierId: 'sup-004', paymentMethod: 'BANK_TRANSFER' as const, bankName: 'กสิกรไทย', bankAccountName: 'นายชัยมงคล สุขดี', bankAccountNumber: '456-7-89012-3' },
    { id: 'spm-006', supplierId: 'sup-005', paymentMethod: 'CASH' as const, isDefault: true },
    { id: 'spm-007', supplierId: 'sup-006', paymentMethod: 'BANK_TRANSFER' as const, bankName: 'กรุงไทย', bankAccountName: 'บจก. ไอแคร์ รีเฟอร์บิช', bankAccountNumber: '567-8-90123-4', isDefault: true },
    { id: 'spm-008', supplierId: 'sup-007', paymentMethod: 'BANK_TRANSFER' as const, bankName: 'กสิกรไทย', bankAccountName: 'Apple SEA Pte Ltd', bankAccountNumber: '678-9-01234-5', creditTermDays: 30, isDefault: true },
    { id: 'spm-009', supplierId: 'sup-008', paymentMethod: 'CASH' as const, isDefault: true },
    { id: 'spm-010', supplierId: 'sup-009', paymentMethod: 'BANK_TRANSFER' as const, bankName: 'กรุงเทพ', bankAccountName: 'บจก. สปิเก้น ไทยแลนด์', bankAccountNumber: '789-0-12345-6', creditTermDays: 30, isDefault: true },
    { id: 'spm-011', supplierId: 'sup-010', paymentMethod: 'BANK_TRANSFER' as const, bankName: 'ไทยพาณิชย์', bankAccountName: 'บจก. แองเคอร์ ไทยแลนด์', bankAccountNumber: '890-1-23456-7', creditTermDays: 15, isDefault: true },
  ];

  for (const m of spmData) {
    await prisma.supplierPaymentMethod.create({ data: m });
  }

  console.log('SupplierPaymentMethods created:', spmData.length);

  // ============================================================
  // STEP 7: InterestConfig (4)
  // ============================================================
  console.log('STEP 7: Creating InterestConfig...');

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

  console.log('=== Part 1: Foundation data seeded successfully ===');

  // === CONTINUED IN NEXT SECTION ===

  // ============================================================
  // STEP 8: PurchaseOrders + POItems (9 POs)
  // ============================================================
  console.log('STEP 8: Creating PurchaseOrders...');

  const poData = [
    { id: 'po-001', poNumber: 'PO-2025-001', supplierId: 'sup-001', orderDate: new Date('2025-10-01'), expectedDate: new Date('2025-10-05'), status: 'FULLY_RECEIVED' as const, totalAmount: 247500, netAmount: 247500, paymentStatus: 'FULLY_PAID' as const, paidAmount: 247500, createdById: 'user-001', approvedById: 'user-001' },
    { id: 'po-002', poNumber: 'PO-2025-002', supplierId: 'sup-002', orderDate: new Date('2025-10-10'), expectedDate: new Date('2025-10-15'), status: 'FULLY_RECEIVED' as const, totalAmount: 155000, netAmount: 155000, paymentStatus: 'FULLY_PAID' as const, paidAmount: 155000, createdById: 'user-002', approvedById: 'user-001' },
    { id: 'po-003', poNumber: 'PO-2025-003', supplierId: 'sup-004', orderDate: new Date('2025-11-01'), expectedDate: new Date('2025-11-03'), status: 'FULLY_RECEIVED' as const, totalAmount: 98000, netAmount: 98000, paymentStatus: 'FULLY_PAID' as const, paidAmount: 98000, createdById: 'user-001', approvedById: 'user-001' },
    { id: 'po-004', poNumber: 'PO-2025-004', supplierId: 'sup-005', orderDate: new Date('2025-11-15'), expectedDate: new Date('2025-11-17'), status: 'FULLY_RECEIVED' as const, totalAmount: 56000, netAmount: 56000, paymentStatus: 'FULLY_PAID' as const, paidAmount: 56000, createdById: 'user-002', approvedById: 'user-001' },
    { id: 'po-005', poNumber: 'PO-2025-005', supplierId: 'sup-007', orderDate: new Date('2025-12-01'), expectedDate: new Date('2025-12-05'), status: 'FULLY_RECEIVED' as const, totalAmount: 85000, netAmount: 85000, paymentStatus: 'FULLY_PAID' as const, paidAmount: 85000, createdById: 'user-001', approvedById: 'user-001' },
    { id: 'po-006', poNumber: 'PO-2025-006', supplierId: 'sup-009', orderDate: new Date('2025-12-10'), status: 'FULLY_RECEIVED' as const, totalAmount: 18000, netAmount: 18000, paymentStatus: 'FULLY_PAID' as const, paidAmount: 18000, createdById: 'user-002', approvedById: 'user-001' },
    { id: 'po-007', poNumber: 'PO-2026-001', supplierId: 'sup-001', orderDate: new Date('2026-01-15'), expectedDate: new Date('2026-01-20'), status: 'FULLY_RECEIVED' as const, totalAmount: 142500, netAmount: 142500, paymentStatus: 'FULLY_PAID' as const, paidAmount: 142500, createdById: 'user-001', approvedById: 'user-001' },
    { id: 'po-008', poNumber: 'PO-2026-002', supplierId: 'sup-006', orderDate: new Date('2026-02-01'), expectedDate: new Date('2026-02-05'), status: 'PARTIALLY_RECEIVED' as const, totalAmount: 45000, netAmount: 45000, paymentStatus: 'DEPOSIT_PAID' as const, paidAmount: 20000, createdById: 'user-003', approvedById: 'user-001' },
    { id: 'po-009', poNumber: 'PO-2026-003', supplierId: 'sup-010', orderDate: new Date('2026-03-01'), status: 'APPROVED' as const, totalAmount: 12000, netAmount: 12000, paymentStatus: 'UNPAID' as const, paidAmount: 0, createdById: 'user-002', approvedById: 'user-001' },
  ];

  for (const po of poData) {
    await prisma.purchaseOrder.create({ data: po });
  }

  // POItems
  const poItemsData = [
    // PO-001: iPhone 16 Pro Max x3
    { id: 'poi-001', poId: 'po-001', brand: 'Apple', model: 'iPhone 16 Pro Max', color: 'Natural Titanium', storage: '256GB', category: 'PHONE_NEW', quantity: 3, unitPrice: 49500, receivedQty: 3 },
    // PO-001: iPhone 16 Pro x2
    { id: 'poi-002', poId: 'po-001', brand: 'Apple', model: 'iPhone 16 Pro', color: 'Black Titanium', storage: '256GB', category: 'PHONE_NEW', quantity: 2, unitPrice: 44500, receivedQty: 2 },
    // PO-002: iPhone 16 x3
    { id: 'poi-003', poId: 'po-002', brand: 'Apple', model: 'iPhone 16', color: 'Black', storage: '128GB', category: 'PHONE_NEW', quantity: 3, unitPrice: 32500, receivedQty: 3 },
    // PO-002: iPhone 15 x2
    { id: 'poi-004', poId: 'po-002', brand: 'Apple', model: 'iPhone 15', color: 'Blue', storage: '128GB', category: 'PHONE_NEW', quantity: 2, unitPrice: 27500, receivedQty: 2 },
    // PO-003: Used iPhone 14 Pro Max x3
    { id: 'poi-005', poId: 'po-003', brand: 'Apple', model: 'iPhone 14 Pro Max', color: 'Deep Purple', storage: '256GB', category: 'PHONE_USED', quantity: 3, unitPrice: 18000, receivedQty: 3 },
    // PO-003: Used iPhone 13 Pro x3
    { id: 'poi-006', poId: 'po-003', brand: 'Apple', model: 'iPhone 13 Pro', color: 'Silver', storage: '128GB', category: 'PHONE_USED', quantity: 3, unitPrice: 12000, receivedQty: 3 },
    // PO-003: Used iPhone 12 x1 (Grade D)
    { id: 'poi-007', poId: 'po-003', brand: 'Apple', model: 'iPhone 12', color: 'Black', storage: '64GB', category: 'PHONE_USED', quantity: 1, unitPrice: 8000, receivedQty: 1 },
    // PO-004: Used iPhone 14 Pro x2
    { id: 'poi-008', poId: 'po-004', brand: 'Apple', model: 'iPhone 14 Pro', color: 'Gold', storage: '128GB', category: 'PHONE_USED', quantity: 2, unitPrice: 16000, receivedQty: 2 },
    // PO-004: Used iPhone 13 x2
    { id: 'poi-009', poId: 'po-004', brand: 'Apple', model: 'iPhone 13', color: 'Midnight', storage: '128GB', category: 'PHONE_USED', quantity: 2, unitPrice: 12000, receivedQty: 2 },
    // PO-005: iPad Pro M2 x2
    { id: 'poi-010', poId: 'po-005', brand: 'Apple', model: 'iPad Pro 12.9 M2', color: 'Space Gray', storage: '256GB', category: 'TABLET', quantity: 2, unitPrice: 25000, receivedQty: 2 },
    // PO-005: iPad Air x2
    { id: 'poi-011', poId: 'po-005', brand: 'Apple', model: 'iPad Air M1', color: 'Starlight', storage: '256GB', category: 'TABLET', quantity: 2, unitPrice: 17500, receivedQty: 2 },
    // PO-006: Cases & screen protectors
    { id: 'poi-012', poId: 'po-006', accessoryType: 'เคส', accessoryBrand: 'Spigen', category: 'ACCESSORY', quantity: 10, unitPrice: 800, receivedQty: 10 },
    { id: 'poi-013', poId: 'po-006', accessoryType: 'ฟิล์มกระจก', accessoryBrand: 'Spigen', category: 'ACCESSORY', quantity: 10, unitPrice: 600, receivedQty: 10 },
    // PO-007: iPhone 16 Pro Max x3 (new batch)
    { id: 'poi-014', poId: 'po-007', brand: 'Apple', model: 'iPhone 16 Pro Max', color: 'Desert Titanium', storage: '512GB', category: 'PHONE_NEW', quantity: 3, unitPrice: 47500, receivedQty: 3 },
    // PO-008: Refurbished iPhone 14 x3 (partial)
    { id: 'poi-015', poId: 'po-008', brand: 'Apple', model: 'iPhone 14', color: 'Blue', storage: '128GB', category: 'PHONE_USED', quantity: 3, unitPrice: 15000, receivedQty: 2 },
    // PO-009: Chargers & cables (not yet received)
    { id: 'poi-016', poId: 'po-009', accessoryType: 'ที่ชาร์จ', accessoryBrand: 'Anker', category: 'ACCESSORY', quantity: 10, unitPrice: 700, receivedQty: 0 },
    { id: 'poi-017', poId: 'po-009', accessoryType: 'สายชาร์จ', accessoryBrand: 'Anker', category: 'ACCESSORY', quantity: 10, unitPrice: 500, receivedQty: 0 },
  ];

  for (const pi of poItemsData) {
    await prisma.pOItem.create({ data: pi });
  }

  console.log('PurchaseOrders created: 9, POItems:', poItemsData.length);

  // ============================================================
  // STEP 9: Products (33)
  // ============================================================
  console.log('STEP 9: Creating Products...');

  const productsData = [
    // --- 8 New Phones ---
    { id: 'prod-001', name: 'iPhone 16 Pro Max 256GB Natural Titanium', brand: 'Apple', model: 'iPhone 16 Pro Max', color: 'Natural Titanium', storage: '256GB', imeiSerial: '350000000000001', category: 'PHONE_NEW' as const, costPrice: 49500, supplierId: 'sup-001', poId: 'po-001', branchId: 'branch-002', status: 'SOLD_INSTALLMENT' as const, stockInDate: new Date('2025-10-05') },
    { id: 'prod-002', name: 'iPhone 16 Pro Max 256GB Natural Titanium', brand: 'Apple', model: 'iPhone 16 Pro Max', color: 'Natural Titanium', storage: '256GB', imeiSerial: '350000000000002', category: 'PHONE_NEW' as const, costPrice: 49500, supplierId: 'sup-001', poId: 'po-001', branchId: 'branch-003', status: 'SOLD_INSTALLMENT' as const, stockInDate: new Date('2025-10-05') },
    { id: 'prod-003', name: 'iPhone 16 Pro Max 256GB Natural Titanium', brand: 'Apple', model: 'iPhone 16 Pro Max', color: 'Natural Titanium', storage: '256GB', imeiSerial: '350000000000003', category: 'PHONE_NEW' as const, costPrice: 49500, supplierId: 'sup-001', poId: 'po-001', branchId: 'branch-002', status: 'IN_STOCK' as const, stockInDate: new Date('2025-10-05') },
    { id: 'prod-004', name: 'iPhone 16 Pro 256GB Black Titanium', brand: 'Apple', model: 'iPhone 16 Pro', color: 'Black Titanium', storage: '256GB', imeiSerial: '350000000000004', category: 'PHONE_NEW' as const, costPrice: 44500, supplierId: 'sup-001', poId: 'po-001', branchId: 'branch-003', status: 'SOLD_INSTALLMENT' as const, stockInDate: new Date('2025-10-05') },
    { id: 'prod-005', name: 'iPhone 16 Pro 256GB Black Titanium', brand: 'Apple', model: 'iPhone 16 Pro', color: 'Black Titanium', storage: '256GB', imeiSerial: '350000000000005', category: 'PHONE_NEW' as const, costPrice: 44500, supplierId: 'sup-001', poId: 'po-001', branchId: 'branch-002', status: 'IN_STOCK' as const, stockInDate: new Date('2025-10-05') },
    { id: 'prod-006', name: 'iPhone 16 128GB Black', brand: 'Apple', model: 'iPhone 16', color: 'Black', storage: '128GB', imeiSerial: '350000000000006', category: 'PHONE_NEW' as const, costPrice: 32500, supplierId: 'sup-002', poId: 'po-002', branchId: 'branch-002', status: 'SOLD_CASH' as const, stockInDate: new Date('2025-10-15') },
    { id: 'prod-007', name: 'iPhone 16 128GB Black', brand: 'Apple', model: 'iPhone 16', color: 'Black', storage: '128GB', imeiSerial: '350000000000007', category: 'PHONE_NEW' as const, costPrice: 32500, supplierId: 'sup-002', poId: 'po-002', branchId: 'branch-004', status: 'IN_STOCK' as const, stockInDate: new Date('2025-10-15') },
    { id: 'prod-008', name: 'iPhone 15 128GB Blue', brand: 'Apple', model: 'iPhone 15', color: 'Blue', storage: '128GB', imeiSerial: '350000000000008', category: 'PHONE_NEW' as const, costPrice: 27500, supplierId: 'sup-002', poId: 'po-002', branchId: 'branch-003', status: 'IN_STOCK' as const, stockInDate: new Date('2025-10-15') },

    // --- 7 Used Phones ---
    { id: 'prod-009', name: 'iPhone 14 Pro Max 256GB Deep Purple (มือสอง A)', brand: 'Apple', model: 'iPhone 14 Pro Max', color: 'Deep Purple', storage: '256GB', imeiSerial: '350000000000009', category: 'PHONE_USED' as const, costPrice: 18000, supplierId: 'sup-004', poId: 'po-003', branchId: 'branch-002', status: 'SOLD_INSTALLMENT' as const, batteryHealth: 92, stockInDate: new Date('2025-11-03') },
    { id: 'prod-010', name: 'iPhone 14 Pro Max 256GB Deep Purple (มือสอง A)', brand: 'Apple', model: 'iPhone 14 Pro Max', color: 'Deep Purple', storage: '256GB', imeiSerial: '350000000000010', category: 'PHONE_USED' as const, costPrice: 18000, supplierId: 'sup-004', poId: 'po-003', branchId: 'branch-003', status: 'SOLD_INSTALLMENT' as const, batteryHealth: 88, stockInDate: new Date('2025-11-03') },
    { id: 'prod-011', name: 'iPhone 14 Pro Max 256GB Deep Purple (มือสอง B)', brand: 'Apple', model: 'iPhone 14 Pro Max', color: 'Deep Purple', storage: '256GB', imeiSerial: '350000000000011', category: 'PHONE_USED' as const, costPrice: 18000, supplierId: 'sup-004', poId: 'po-003', branchId: 'branch-004', status: 'IN_STOCK' as const, batteryHealth: 85, stockInDate: new Date('2025-11-03') },
    { id: 'prod-012', name: 'iPhone 13 Pro 128GB Silver (มือสอง A)', brand: 'Apple', model: 'iPhone 13 Pro', color: 'Silver', storage: '128GB', imeiSerial: '350000000000012', category: 'PHONE_USED' as const, costPrice: 12000, supplierId: 'sup-004', poId: 'po-003', branchId: 'branch-002', status: 'IN_STOCK' as const, batteryHealth: 87, stockInDate: new Date('2025-11-03') },
    { id: 'prod-013', name: 'iPhone 13 Pro 128GB Silver (มือสอง B)', brand: 'Apple', model: 'iPhone 13 Pro', color: 'Silver', storage: '128GB', imeiSerial: '350000000000013', category: 'PHONE_USED' as const, costPrice: 12000, supplierId: 'sup-004', poId: 'po-003', branchId: 'branch-003', status: 'SOLD_INSTALLMENT' as const, batteryHealth: 82, stockInDate: new Date('2025-11-03') },
    { id: 'prod-014', name: 'iPhone 14 Pro 128GB Gold (มือสอง A)', brand: 'Apple', model: 'iPhone 14 Pro', color: 'Gold', storage: '128GB', imeiSerial: '350000000000014', category: 'PHONE_USED' as const, costPrice: 16000, supplierId: 'sup-005', poId: 'po-004', branchId: 'branch-002', status: 'IN_STOCK' as const, batteryHealth: 90, stockInDate: new Date('2025-11-17') },
    { id: 'prod-015', name: 'iPhone 13 128GB Midnight (มือสอง B)', brand: 'Apple', model: 'iPhone 13', color: 'Midnight', storage: '128GB', imeiSerial: '350000000000015', category: 'PHONE_USED' as const, costPrice: 12000, supplierId: 'sup-005', poId: 'po-004', branchId: 'branch-003', status: 'IN_STOCK' as const, batteryHealth: 79, stockInDate: new Date('2025-11-17') },

    // --- 4 Tablets ---
    { id: 'prod-016', name: 'iPad Pro 12.9 M2 256GB Space Gray', brand: 'Apple', model: 'iPad Pro 12.9 M2', color: 'Space Gray', storage: '256GB', imeiSerial: '350000000000016', category: 'TABLET' as const, costPrice: 25000, supplierId: 'sup-007', poId: 'po-005', branchId: 'branch-002', status: 'SOLD_INSTALLMENT' as const, stockInDate: new Date('2025-12-05') },
    { id: 'prod-017', name: 'iPad Pro 12.9 M2 256GB Space Gray', brand: 'Apple', model: 'iPad Pro 12.9 M2', color: 'Space Gray', storage: '256GB', imeiSerial: '350000000000017', category: 'TABLET' as const, costPrice: 25000, supplierId: 'sup-007', poId: 'po-005', branchId: 'branch-003', status: 'IN_STOCK' as const, stockInDate: new Date('2025-12-05') },
    { id: 'prod-018', name: 'iPad Air M1 256GB Starlight', brand: 'Apple', model: 'iPad Air M1', color: 'Starlight', storage: '256GB', imeiSerial: '350000000000018', category: 'TABLET' as const, costPrice: 17500, supplierId: 'sup-007', poId: 'po-005', branchId: 'branch-004', status: 'IN_STOCK' as const, stockInDate: new Date('2025-12-05') },
    { id: 'prod-019', name: 'iPad Air M1 256GB Starlight', brand: 'Apple', model: 'iPad Air M1', color: 'Starlight', storage: '256GB', imeiSerial: '350000000000019', category: 'TABLET' as const, costPrice: 17500, supplierId: 'sup-007', poId: 'po-005', branchId: 'branch-002', status: 'SOLD_INSTALLMENT' as const, stockInDate: new Date('2025-12-05') },

    // --- 6 Accessories (no IMEI) ---
    { id: 'prod-020', name: 'เคส Spigen iPhone 16 Pro Max', brand: 'Spigen', model: 'Ultra Hybrid', category: 'ACCESSORY' as const, costPrice: 800, accessoryType: 'เคส', accessoryBrand: 'Spigen', supplierId: 'sup-009', poId: 'po-006', branchId: 'branch-002', status: 'IN_STOCK' as const, stockInDate: new Date('2025-12-12') },
    { id: 'prod-021', name: 'เคส Spigen iPhone 16 Pro', brand: 'Spigen', model: 'Tough Armor', category: 'ACCESSORY' as const, costPrice: 800, accessoryType: 'เคส', accessoryBrand: 'Spigen', supplierId: 'sup-009', poId: 'po-006', branchId: 'branch-003', status: 'IN_STOCK' as const, stockInDate: new Date('2025-12-12') },
    { id: 'prod-022', name: 'ฟิล์มกระจก Spigen iPhone 16 Pro Max', brand: 'Spigen', model: 'GlasTR EZ Fit', category: 'ACCESSORY' as const, costPrice: 600, accessoryType: 'ฟิล์มกระจก', accessoryBrand: 'Spigen', supplierId: 'sup-009', poId: 'po-006', branchId: 'branch-002', status: 'IN_STOCK' as const, stockInDate: new Date('2025-12-12') },
    { id: 'prod-023', name: 'ฟิล์มกระจก Spigen iPhone 16', brand: 'Spigen', model: 'GlasTR EZ Fit', category: 'ACCESSORY' as const, costPrice: 600, accessoryType: 'ฟิล์มกระจก', accessoryBrand: 'Spigen', supplierId: 'sup-009', poId: 'po-006', branchId: 'branch-004', status: 'IN_STOCK' as const, stockInDate: new Date('2025-12-12') },
    { id: 'prod-024', name: 'ที่ชาร์จ Anker 20W USB-C', brand: 'Anker', model: 'Nano Pro 20W', category: 'ACCESSORY' as const, costPrice: 700, accessoryType: 'ที่ชาร์จ', accessoryBrand: 'Anker', supplierId: 'sup-010', branchId: 'branch-002', status: 'IN_STOCK' as const, stockInDate: new Date('2025-12-15') },
    { id: 'prod-025', name: 'สายชาร์จ Anker USB-C to Lightning', brand: 'Anker', model: 'PowerLine III', category: 'ACCESSORY' as const, costPrice: 500, accessoryType: 'สายชาร์จ', accessoryBrand: 'Anker', supplierId: 'sup-010', branchId: 'branch-003', status: 'IN_STOCK' as const, stockInDate: new Date('2025-12-15') },

    // --- 5 Demo products (for LINE OA demo contracts) ---
    { id: 'prod-026', name: 'iPhone 16 Pro Max 512GB Desert Titanium', brand: 'Apple', model: 'iPhone 16 Pro Max', color: 'Desert Titanium', storage: '512GB', imeiSerial: '350000000000026', category: 'PHONE_NEW' as const, costPrice: 47500, supplierId: 'sup-001', poId: 'po-007', branchId: 'branch-002', status: 'SOLD_INSTALLMENT' as const, stockInDate: new Date('2026-01-20') },
    { id: 'prod-027', name: 'iPhone 16 Pro Max 512GB Desert Titanium', brand: 'Apple', model: 'iPhone 16 Pro Max', color: 'Desert Titanium', storage: '512GB', imeiSerial: '350000000000027', category: 'PHONE_NEW' as const, costPrice: 47500, supplierId: 'sup-001', poId: 'po-007', branchId: 'branch-003', status: 'SOLD_INSTALLMENT' as const, stockInDate: new Date('2026-01-20') },
    { id: 'prod-028', name: 'iPhone 16 Pro Max 512GB Desert Titanium', brand: 'Apple', model: 'iPhone 16 Pro Max', color: 'Desert Titanium', storage: '512GB', imeiSerial: '350000000000028', category: 'PHONE_NEW' as const, costPrice: 47500, supplierId: 'sup-001', poId: 'po-007', branchId: 'branch-004', status: 'SOLD_INSTALLMENT' as const, stockInDate: new Date('2026-01-20') },
    { id: 'prod-029', name: 'iPhone 14 128GB Blue (Refurbished)', brand: 'Apple', model: 'iPhone 14', color: 'Blue', storage: '128GB', imeiSerial: '350000000000029', category: 'PHONE_USED' as const, costPrice: 15000, supplierId: 'sup-006', poId: 'po-008', branchId: 'branch-002', status: 'SOLD_INSTALLMENT' as const, batteryHealth: 94, stockInDate: new Date('2026-02-05') },
    { id: 'prod-030', name: 'iPhone 14 128GB Blue (Refurbished)', brand: 'Apple', model: 'iPhone 14', color: 'Blue', storage: '128GB', imeiSerial: '350000000000030', category: 'PHONE_USED' as const, costPrice: 15000, supplierId: 'sup-006', poId: 'po-008', branchId: 'branch-003', status: 'IN_STOCK' as const, batteryHealth: 91, stockInDate: new Date('2026-02-05') },

    // --- 2 Grade D / Damaged ---
    { id: 'prod-031', name: 'iPhone 12 64GB Black (มือสอง D)', brand: 'Apple', model: 'iPhone 12', color: 'Black', storage: '64GB', imeiSerial: '350000000000031', category: 'PHONE_USED' as const, costPrice: 8000, supplierId: 'sup-004', poId: 'po-003', branchId: 'branch-001', status: 'DAMAGED' as const, batteryHealth: 72, stockInDate: new Date('2025-11-03') },
    { id: 'prod-032', name: 'iPhone 14 Pro 128GB Gold (Repossessed)', brand: 'Apple', model: 'iPhone 14 Pro', color: 'Gold', storage: '128GB', imeiSerial: '350000000000032', category: 'PHONE_USED' as const, costPrice: 16000, supplierId: 'sup-005', poId: 'po-004', branchId: 'branch-001', status: 'REPOSSESSED' as const, batteryHealth: 85, stockInDate: new Date('2025-11-17') },

    // --- 1 extra used ---
    { id: 'prod-033', name: 'iPhone 13 128GB Midnight (มือสอง)', brand: 'Apple', model: 'iPhone 13', color: 'Midnight', storage: '128GB', imeiSerial: '350000000000033', category: 'PHONE_USED' as const, costPrice: 12000, supplierId: 'sup-005', poId: 'po-004', branchId: 'branch-004', status: 'IN_STOCK' as const, batteryHealth: 81, stockInDate: new Date('2025-11-17') },
  ];

  for (const p of productsData) {
    await prisma.product.create({ data: p });
  }

  console.log('Products created:', productsData.length);

  // ============================================================
  // STEP 10: ProductPrices (for products that need pricing)
  // ============================================================
  console.log('STEP 10: Creating ProductPrices...');

  const ppData = [
    // New phones
    { productId: 'prod-001', label: 'ราคาเงินสด', amount: 52900, isDefault: true }, { productId: 'prod-001', label: 'ราคาผ่อน', amount: 54900 },
    { productId: 'prod-002', label: 'ราคาเงินสด', amount: 52900, isDefault: true }, { productId: 'prod-002', label: 'ราคาผ่อน', amount: 54900 },
    { productId: 'prod-003', label: 'ราคาเงินสด', amount: 52900, isDefault: true }, { productId: 'prod-003', label: 'ราคาผ่อน', amount: 54900 },
    { productId: 'prod-004', label: 'ราคาเงินสด', amount: 47900, isDefault: true }, { productId: 'prod-004', label: 'ราคาผ่อน', amount: 49900 },
    { productId: 'prod-005', label: 'ราคาเงินสด', amount: 47900, isDefault: true }, { productId: 'prod-005', label: 'ราคาผ่อน', amount: 49900 },
    { productId: 'prod-006', label: 'ราคาเงินสด', amount: 34900, isDefault: true },
    { productId: 'prod-007', label: 'ราคาเงินสด', amount: 34900, isDefault: true }, { productId: 'prod-007', label: 'ราคาผ่อน', amount: 36900 },
    { productId: 'prod-008', label: 'ราคาเงินสด', amount: 29900, isDefault: true }, { productId: 'prod-008', label: 'ราคาผ่อน', amount: 31900 },
    // Used phones
    { productId: 'prod-009', label: 'ราคาเงินสด', amount: 22900, isDefault: true }, { productId: 'prod-009', label: 'ราคาผ่อน', amount: 24900 },
    { productId: 'prod-010', label: 'ราคาเงินสด', amount: 22900, isDefault: true }, { productId: 'prod-010', label: 'ราคาผ่อน', amount: 24900 },
    { productId: 'prod-011', label: 'ราคาเงินสด', amount: 21900, isDefault: true }, { productId: 'prod-011', label: 'ราคาผ่อน', amount: 23900 },
    { productId: 'prod-012', label: 'ราคาเงินสด', amount: 15900, isDefault: true }, { productId: 'prod-012', label: 'ราคาผ่อน', amount: 17900 },
    { productId: 'prod-013', label: 'ราคาเงินสด', amount: 14900, isDefault: true }, { productId: 'prod-013', label: 'ราคาผ่อน', amount: 16900 },
    { productId: 'prod-014', label: 'ราคาเงินสด', amount: 20900, isDefault: true }, { productId: 'prod-014', label: 'ราคาผ่อน', amount: 22900 },
    { productId: 'prod-015', label: 'ราคาเงินสด', amount: 14900, isDefault: true }, { productId: 'prod-015', label: 'ราคาผ่อน', amount: 16900 },
    // Tablets
    { productId: 'prod-016', label: 'ราคาเงินสด', amount: 32900, isDefault: true }, { productId: 'prod-016', label: 'ราคาผ่อน', amount: 34900 },
    { productId: 'prod-017', label: 'ราคาเงินสด', amount: 32900, isDefault: true }, { productId: 'prod-017', label: 'ราคาผ่อน', amount: 34900 },
    { productId: 'prod-018', label: 'ราคาเงินสด', amount: 22900, isDefault: true }, { productId: 'prod-018', label: 'ราคาผ่อน', amount: 24900 },
    { productId: 'prod-019', label: 'ราคาเงินสด', amount: 22900, isDefault: true }, { productId: 'prod-019', label: 'ราคาผ่อน', amount: 24900 },
    // Demo products
    { productId: 'prod-026', label: 'ราคาเงินสด', amount: 52900, isDefault: true }, { productId: 'prod-026', label: 'ราคาผ่อน', amount: 54900 },
    { productId: 'prod-027', label: 'ราคาเงินสด', amount: 52900, isDefault: true }, { productId: 'prod-027', label: 'ราคาผ่อน', amount: 54900 },
    { productId: 'prod-028', label: 'ราคาเงินสด', amount: 52900, isDefault: true }, { productId: 'prod-028', label: 'ราคาผ่อน', amount: 54900 },
    { productId: 'prod-029', label: 'ราคาเงินสด', amount: 19900, isDefault: true }, { productId: 'prod-029', label: 'ราคาผ่อน', amount: 21900 },
  ];

  for (const pp of ppData) {
    await prisma.productPrice.create({ data: pp });
  }

  console.log('ProductPrices created:', ppData.length);

  console.log('=== Part 2: Products & POs seeded ===');

  // ============================================================
  // STEP 11: PricingTemplates (8)
  // ============================================================
  console.log('STEP 11: Creating PricingTemplates...');

  const ptData = [
    { brand: 'Apple', model: 'iPhone 16 Pro Max', storage: '256GB', category: 'PHONE_NEW' as const, cashPrice: 52900, installmentBestchoicePrice: 54900, installmentFinancePrice: 52900 },
    { brand: 'Apple', model: 'iPhone 16 Pro Max', storage: '512GB', category: 'PHONE_NEW' as const, cashPrice: 57900, installmentBestchoicePrice: 59900, installmentFinancePrice: 57900 },
    { brand: 'Apple', model: 'iPhone 16 Pro', storage: '256GB', category: 'PHONE_NEW' as const, cashPrice: 47900, installmentBestchoicePrice: 49900, installmentFinancePrice: 47900 },
    { brand: 'Apple', model: 'iPhone 16', storage: '128GB', category: 'PHONE_NEW' as const, cashPrice: 34900, installmentBestchoicePrice: 36900, installmentFinancePrice: 34900 },
    { brand: 'Apple', model: 'iPhone 15', storage: '128GB', category: 'PHONE_NEW' as const, cashPrice: 29900, installmentBestchoicePrice: 31900, installmentFinancePrice: 29900 },
    { brand: 'Apple', model: 'iPad Pro 12.9 M2', storage: '256GB', category: 'TABLET' as const, cashPrice: 32900, installmentBestchoicePrice: 34900, installmentFinancePrice: 32900 },
    { brand: 'Apple', model: 'iPad Air M1', storage: '256GB', category: 'TABLET' as const, cashPrice: 22900, installmentBestchoicePrice: 24900, installmentFinancePrice: 22900 },
    { brand: 'Apple', model: 'iPhone 14 Pro Max', storage: '256GB', category: 'PHONE_USED' as const, cashPrice: 22900, installmentBestchoicePrice: 24900, installmentFinancePrice: 22900 },
  ];

  for (const pt of ptData) {
    await prisma.pricingTemplate.create({ data: pt });
  }

  console.log('PricingTemplates created:', ptData.length);

  // ============================================================
  // STEP 12: GoodsReceivings (6)
  // ============================================================
  console.log('STEP 12: Creating GoodsReceivings...');

  const grData = [
    { id: 'gr-001', poId: 'po-001', receivedById: 'user-001', notes: 'รับครบ 5 เครื่อง' },
    { id: 'gr-002', poId: 'po-002', receivedById: 'user-002', notes: 'รับครบ 5 เครื่อง' },
    { id: 'gr-003', poId: 'po-003', receivedById: 'user-001', notes: 'รับครบ 7 เครื่อง (มือสอง)' },
    { id: 'gr-004', poId: 'po-004', receivedById: 'user-002' },
    { id: 'gr-005', poId: 'po-005', receivedById: 'user-001', notes: 'iPad 4 เครื่อง' },
    { id: 'gr-006', poId: 'po-006', receivedById: 'user-002', notes: 'อุปกรณ์เสริม Spigen' },
  ];

  for (const gr of grData) {
    await prisma.goodsReceiving.create({ data: gr });
  }

  console.log('GoodsReceivings created:', grData.length);

  // ============================================================
  // STEP 13: Customers (15 = 12 regular + 3 LINE OA demo)
  // ============================================================
  console.log('STEP 13: Creating Customers...');

  const customersData = [
    { id: 'cust-001', nationalId: '1100100100001', prefix: 'นาย', name: 'สมชาย ใจดี', phone: '0812345001', occupation: 'พนักงานบริษัท', salary: 25000, addressCurrent: '12 ซ.สุขุมวิท 22 เขตคลองเตย กทม.', facebookName: 'Somchai Jaidee', facebookLink: 'https://facebook.com/somchai.jd' },
    { id: 'cust-002', nationalId: '1100100100002', prefix: 'นางสาว', name: 'วิภาวดี ขยันเรียน', phone: '0812345002', occupation: 'นักศึกษา', salary: 0, addressCurrent: '55 ม.3 ต.คลองหลวง อ.คลองหลวง ปทุมธานี' },
    { id: 'cust-003', nationalId: '1100100100003', prefix: 'นาย', name: 'ธนากร รวยล้น', phone: '0812345003', occupation: 'เจ้าของกิจการ', salary: 80000, addressCurrent: '99 ถ.พระราม 9 เขตห้วยขวาง กทม.', facebookName: 'Thanakorn Rich' },
    { id: 'cust-004', nationalId: '1100100100004', prefix: 'นาง', name: 'สุดารัตน์ แม่ค้าส้มตำ', phone: '0812345004', occupation: 'ค้าขาย', salary: 18000, addressCurrent: '33 ตลาดนัดจตุจักร กทม.' },
    { id: 'cust-005', nationalId: '1100100100005', prefix: 'นาย', name: 'ประยุทธ์ มั่นคง', phone: '0812345005', occupation: 'ข้าราชการ', salary: 35000, addressCurrent: '88 ซ.ราชวิถี เขตดุสิต กทม.' },
    { id: 'cust-006', nationalId: '1100100100006', prefix: 'นางสาว', name: 'แพรวา สวยใส', phone: '0812345006', occupation: 'พนักงานขาย', salary: 22000, addressCurrent: '15 ถ.รัชดาภิเษก เขตจตุจักร กทม.' },
    { id: 'cust-007', nationalId: '1100100100007', prefix: 'นาย', name: 'กิตติ ช่างซ่อม', phone: '0812345007', occupation: 'ช่างซ่อม', salary: 20000, addressCurrent: '77 ซ.ลาดพร้าว 71 เขตบางกะปิ กทม.', facebookName: 'Kitti Changsorn' },
    { id: 'cust-008', nationalId: '1100100100008', prefix: 'นาย', name: 'วรุฒม์ หนีหนี้', phone: '0812345008', occupation: 'ว่างงาน', salary: 0, addressCurrent: '999 ต.ท่าไม้ อ.กระทุ่มแบน สมุทรสาคร' },
    { id: 'cust-009', nationalId: '1100100100009', prefix: 'นางสาว', name: 'จิราภรณ์ ทำงานดี', phone: '0812345009', occupation: 'โปรแกรมเมอร์', salary: 55000, addressCurrent: '11 อาคาร The PARQ เขตคลองเตย กทม.' },
    { id: 'cust-010', nationalId: '1100100100010', prefix: 'นาย', name: 'พัฒนา สร้างบ้าน', phone: '0812345010', occupation: 'วิศวกร', salary: 45000, addressCurrent: '200 ม.5 ต.บ้านใหม่ อ.ปากเกร็ด นนทบุรี' },
    { id: 'cust-011', nationalId: '1100100100011', prefix: 'นาง', name: 'อารีย์ ใจบุญ', phone: '0812345011', occupation: 'พยาบาล', salary: 30000, addressCurrent: '50 ซ.รามอินทรา 34 เขตมีนบุรี กทม.' },
    { id: 'cust-012', nationalId: '1100100100012', prefix: 'นาย', name: 'สุทธิ ปลดหนี้แล้ว', phone: '0812345012', occupation: 'ค้าขาย', salary: 28000, addressCurrent: '123 ถ.จรัญสนิทวงศ์ เขตบางกอกน้อย กทม.' },

    // --- 3 LINE OA Demo Customers ---
    { id: 'cust-demo-001', nationalId: 'DEMO_LINE_001', prefix: 'นาย', name: 'เดโม่ ลูกค้าผ่อน (Demo 1)', phone: '0999999901', occupation: 'พนักงาน Demo', salary: 30000, addressCurrent: 'ที่อยู่ Demo 1' },
    { id: 'cust-demo-002', nationalId: 'DEMO_LINE_002', prefix: 'นางสาว', name: 'เดโม่ ค้างชำระ (Demo 2)', phone: '0999999902', occupation: 'พนักงาน Demo', salary: 25000, addressCurrent: 'ที่อยู่ Demo 2' },
    { id: 'cust-demo-003', nationalId: 'DEMO_LINE_003', prefix: 'นาย', name: 'เดโม่ ปิดสัญญา (Demo 3)', phone: '0999999903', occupation: 'พนักงาน Demo', salary: 35000, addressCurrent: 'ที่อยู่ Demo 3' },
  ];

  for (const c of customersData) {
    await prisma.customer.create({ data: c });
  }

  console.log('Customers created:', customersData.length);

  console.log('=== Part 3: Templates, GRs, Customers seeded ===');

  // ============================================================
  // STEP 14: Contracts (10 main + 5 demo = 15)
  // ============================================================
  console.log('STEP 14: Creating Contracts...');

  // Helper: calculate installment
  function calc(sellingPrice: number, downPayment: number, rate: number, months: number) {
    const financedAmount = sellingPrice - downPayment;
    const interestTotal = financedAmount * rate * months;
    const monthlyPayment = Math.ceil((financedAmount + interestTotal) / months);
    return { financedAmount, interestTotal, monthlyPayment };
  }

  // Contract 1: ACTIVE - สมชาย iPhone 16 Pro Max
  const c1 = calc(54900, 11000, 0.08, 10);
  await prisma.contract.create({ data: { id: 'cont-001', contractNumber: 'BCP-2025-001', customerId: 'cust-001', productId: 'prod-001', branchId: 'branch-002', salespersonId: 'user-004', planType: 'STORE_DIRECT', sellingPrice: 54900, downPayment: 11000, interestRate: 0.08, totalMonths: 10, interestTotal: c1.interestTotal, financedAmount: c1.financedAmount, monthlyPayment: c1.monthlyPayment, status: 'ACTIVE', workflowStatus: 'APPROVED', reviewedById: 'user-002', paymentDueDay: 5, interestConfigId: 'ic-001', hasOwnershipClause: true, hasRepossessionClause: true, hasEarlyPayoffClause: true, hasNoTransferClause: true, hasAcknowledgement: true } });

  // Contract 2: ACTIVE - วิภาวดี iPhone 16 Pro
  const c2 = calc(49900, 10000, 0.08, 10);
  await prisma.contract.create({ data: { id: 'cont-002', contractNumber: 'BCP-2025-002', customerId: 'cust-002', productId: 'prod-004', branchId: 'branch-003', salespersonId: 'user-005', planType: 'STORE_DIRECT', sellingPrice: 49900, downPayment: 10000, interestRate: 0.08, totalMonths: 10, interestTotal: c2.interestTotal, financedAmount: c2.financedAmount, monthlyPayment: c2.monthlyPayment, status: 'ACTIVE', workflowStatus: 'APPROVED', reviewedById: 'user-003', paymentDueDay: 15, interestConfigId: 'ic-001', hasOwnershipClause: true, hasRepossessionClause: true, hasEarlyPayoffClause: true, hasNoTransferClause: true, hasAcknowledgement: true } });

  // Contract 3: ACTIVE - ธนากร iPad Pro M2
  const c3 = calc(34900, 5000, 0.08, 10);
  await prisma.contract.create({ data: { id: 'cont-003', contractNumber: 'BCP-2025-003', customerId: 'cust-003', productId: 'prod-016', branchId: 'branch-002', salespersonId: 'user-004', planType: 'STORE_DIRECT', sellingPrice: 34900, downPayment: 5000, interestRate: 0.08, totalMonths: 10, interestTotal: c3.interestTotal, financedAmount: c3.financedAmount, monthlyPayment: c3.monthlyPayment, status: 'ACTIVE', workflowStatus: 'APPROVED', reviewedById: 'user-002', paymentDueDay: 25, interestConfigId: 'ic-003', hasOwnershipClause: true, hasRepossessionClause: true, hasEarlyPayoffClause: true, hasNoTransferClause: true, hasAcknowledgement: true } });

  // Contract 4: OVERDUE - สุดารัตน์ iPhone 14 Pro Max (used)
  const c4 = calc(24900, 5000, 0.1, 10);
  await prisma.contract.create({ data: { id: 'cont-004', contractNumber: 'BCP-2025-004', customerId: 'cust-004', productId: 'prod-009', branchId: 'branch-002', salespersonId: 'user-004', planType: 'STORE_DIRECT', sellingPrice: 24900, downPayment: 5000, interestRate: 0.10, totalMonths: 10, interestTotal: c4.interestTotal, financedAmount: c4.financedAmount, monthlyPayment: c4.monthlyPayment, status: 'OVERDUE', workflowStatus: 'APPROVED', reviewedById: 'user-002', paymentDueDay: 1, interestConfigId: 'ic-002', hasOwnershipClause: true, hasRepossessionClause: true, hasEarlyPayoffClause: true, hasNoTransferClause: true, hasAcknowledgement: true } });

  // Contract 5: OVERDUE - ประยุทธ์ iPhone 14 Pro Max (used)
  const c5 = calc(24900, 6000, 0.1, 10);
  await prisma.contract.create({ data: { id: 'cont-005', contractNumber: 'BCP-2025-005', customerId: 'cust-005', productId: 'prod-010', branchId: 'branch-003', salespersonId: 'user-005', planType: 'STORE_DIRECT', sellingPrice: 24900, downPayment: 6000, interestRate: 0.10, totalMonths: 10, interestTotal: c5.interestTotal, financedAmount: c5.financedAmount, monthlyPayment: c5.monthlyPayment, status: 'OVERDUE', workflowStatus: 'APPROVED', reviewedById: 'user-003', paymentDueDay: 10, interestConfigId: 'ic-002', hasOwnershipClause: true, hasRepossessionClause: true, hasEarlyPayoffClause: true, hasNoTransferClause: true, hasAcknowledgement: true } });

  // Contract 6: DEFAULT - วรุฒม์ iPhone 13 Pro (used) → repossessed
  const c6 = calc(16900, 4000, 0.1, 10);
  await prisma.contract.create({ data: { id: 'cont-006', contractNumber: 'BCP-2025-006', customerId: 'cust-008', productId: 'prod-013', branchId: 'branch-003', salespersonId: 'user-005', planType: 'STORE_DIRECT', sellingPrice: 16900, downPayment: 4000, interestRate: 0.10, totalMonths: 10, interestTotal: c6.interestTotal, financedAmount: c6.financedAmount, monthlyPayment: c6.monthlyPayment, status: 'DEFAULT', workflowStatus: 'APPROVED', reviewedById: 'user-003', paymentDueDay: 5, interestConfigId: 'ic-002', hasOwnershipClause: true, hasRepossessionClause: true, hasEarlyPayoffClause: true, hasNoTransferClause: true, hasAcknowledgement: true } });

  // Contract 7: COMPLETED - สุทธิ iPhone 16 Pro Max
  const c7 = calc(54900, 15000, 0.08, 8);
  await prisma.contract.create({ data: { id: 'cont-007', contractNumber: 'BCP-2025-007', customerId: 'cust-012', productId: 'prod-002', branchId: 'branch-003', salespersonId: 'user-005', planType: 'STORE_DIRECT', sellingPrice: 54900, downPayment: 15000, interestRate: 0.08, totalMonths: 8, interestTotal: c7.interestTotal, financedAmount: c7.financedAmount, monthlyPayment: c7.monthlyPayment, status: 'COMPLETED', workflowStatus: 'APPROVED', reviewedById: 'user-003', paymentDueDay: 20, interestConfigId: 'ic-001', hasOwnershipClause: true, hasRepossessionClause: true, hasEarlyPayoffClause: true, hasNoTransferClause: true, hasAcknowledgement: true } });

  // Contract 8: EARLY_PAYOFF - จิราภรณ์ iPad Air
  const c8 = calc(24900, 5000, 0.08, 10);
  await prisma.contract.create({ data: { id: 'cont-008', contractNumber: 'BCP-2025-008', customerId: 'cust-009', productId: 'prod-019', branchId: 'branch-002', salespersonId: 'user-004', planType: 'STORE_DIRECT', sellingPrice: 24900, downPayment: 5000, interestRate: 0.08, totalMonths: 10, interestTotal: c8.interestTotal, financedAmount: c8.financedAmount, monthlyPayment: c8.monthlyPayment, status: 'EARLY_PAYOFF', workflowStatus: 'APPROVED', reviewedById: 'user-002', paymentDueDay: 15, interestConfigId: 'ic-003', hasOwnershipClause: true, hasRepossessionClause: true, hasEarlyPayoffClause: true, hasNoTransferClause: true, hasAcknowledgement: true } });

  // Contract 9: DRAFT - แพรวา (ยังไม่เสร็จ)
  const c9 = calc(24900, 5000, 0.1, 10);
  await prisma.contract.create({ data: { id: 'cont-009', contractNumber: 'BCP-2026-001', customerId: 'cust-006', productId: 'prod-014', branchId: 'branch-002', salespersonId: 'user-004', planType: 'STORE_DIRECT', sellingPrice: 24900, downPayment: 5000, interestRate: 0.10, totalMonths: 10, interestTotal: c9.interestTotal, financedAmount: c9.financedAmount, monthlyPayment: c9.monthlyPayment, status: 'DRAFT', workflowStatus: 'CREATING', paymentDueDay: 1, interestConfigId: 'ic-002' } });

  // Contract 10: ACTIVE - กิตติ iPhone 14 refurbished
  const c10 = calc(21900, 4000, 0.1, 10);
  await prisma.contract.create({ data: { id: 'cont-010', contractNumber: 'BCP-2026-002', customerId: 'cust-007', productId: 'prod-029', branchId: 'branch-002', salespersonId: 'user-004', planType: 'STORE_DIRECT', sellingPrice: 21900, downPayment: 4000, interestRate: 0.10, totalMonths: 10, interestTotal: c10.interestTotal, financedAmount: c10.financedAmount, monthlyPayment: c10.monthlyPayment, status: 'ACTIVE', workflowStatus: 'APPROVED', reviewedById: 'user-002', paymentDueDay: 10, interestConfigId: 'ic-002', hasOwnershipClause: true, hasRepossessionClause: true, hasEarlyPayoffClause: true, hasNoTransferClause: true, hasAcknowledgement: true } });

  // --- 5 Demo contracts (LINE OA) ---
  const cd1 = calc(54900, 11000, 0.08, 10);
  await prisma.contract.create({ data: { id: 'cont-demo-001', contractNumber: 'BCP-DEMO-001', customerId: 'cust-demo-001', productId: 'prod-026', branchId: 'branch-002', salespersonId: 'user-004', planType: 'STORE_DIRECT', sellingPrice: 54900, downPayment: 11000, interestRate: 0.08, totalMonths: 10, interestTotal: cd1.interestTotal, financedAmount: cd1.financedAmount, monthlyPayment: cd1.monthlyPayment, status: 'ACTIVE', workflowStatus: 'APPROVED', reviewedById: 'user-002', paymentDueDay: 5, interestConfigId: 'ic-001', hasOwnershipClause: true, hasRepossessionClause: true, hasEarlyPayoffClause: true, hasNoTransferClause: true, hasAcknowledgement: true } });

  const cd2 = calc(54900, 11000, 0.08, 10);
  await prisma.contract.create({ data: { id: 'cont-demo-002', contractNumber: 'BCP-DEMO-002', customerId: 'cust-demo-001', productId: 'prod-027', branchId: 'branch-003', salespersonId: 'user-005', planType: 'STORE_DIRECT', sellingPrice: 54900, downPayment: 11000, interestRate: 0.08, totalMonths: 10, interestTotal: cd2.interestTotal, financedAmount: cd2.financedAmount, monthlyPayment: cd2.monthlyPayment, status: 'ACTIVE', workflowStatus: 'APPROVED', reviewedById: 'user-003', paymentDueDay: 15, interestConfigId: 'ic-001', hasOwnershipClause: true, hasRepossessionClause: true, hasEarlyPayoffClause: true, hasNoTransferClause: true, hasAcknowledgement: true } });

  const cd3 = calc(54900, 11000, 0.08, 10);
  await prisma.contract.create({ data: { id: 'cont-demo-003', contractNumber: 'BCP-DEMO-003', customerId: 'cust-demo-002', productId: 'prod-028', branchId: 'branch-004', salespersonId: 'user-007', planType: 'STORE_DIRECT', sellingPrice: 54900, downPayment: 11000, interestRate: 0.08, totalMonths: 10, interestTotal: cd3.interestTotal, financedAmount: cd3.financedAmount, monthlyPayment: cd3.monthlyPayment, status: 'OVERDUE', workflowStatus: 'APPROVED', reviewedById: 'user-008', paymentDueDay: 1, interestConfigId: 'ic-001', hasOwnershipClause: true, hasRepossessionClause: true, hasEarlyPayoffClause: true, hasNoTransferClause: true, hasAcknowledgement: true } });

  const cd4 = calc(21900, 4000, 0.1, 10);
  await prisma.contract.create({ data: { id: 'cont-demo-004', contractNumber: 'BCP-DEMO-004', customerId: 'cust-demo-002', productId: 'prod-032', branchId: 'branch-002', salespersonId: 'user-004', planType: 'STORE_DIRECT', sellingPrice: 21900, downPayment: 4000, interestRate: 0.10, totalMonths: 10, interestTotal: cd4.interestTotal, financedAmount: cd4.financedAmount, monthlyPayment: cd4.monthlyPayment, status: 'ACTIVE', workflowStatus: 'APPROVED', reviewedById: 'user-002', paymentDueDay: 10, interestConfigId: 'ic-002', hasOwnershipClause: true, hasRepossessionClause: true, hasEarlyPayoffClause: true, hasNoTransferClause: true, hasAcknowledgement: true } });

  const cd5 = calc(49900, 10000, 0.08, 10);
  await prisma.contract.create({ data: { id: 'cont-demo-005', contractNumber: 'BCP-DEMO-005', customerId: 'cust-demo-003', productId: 'prod-033', branchId: 'branch-004', salespersonId: 'user-007', planType: 'STORE_DIRECT', sellingPrice: 49900, downPayment: 10000, interestRate: 0.08, totalMonths: 10, interestTotal: cd5.interestTotal, financedAmount: cd5.financedAmount, monthlyPayment: cd5.monthlyPayment, status: 'COMPLETED', workflowStatus: 'APPROVED', reviewedById: 'user-008', paymentDueDay: 20, interestConfigId: 'ic-001', hasOwnershipClause: true, hasRepossessionClause: true, hasEarlyPayoffClause: true, hasNoTransferClause: true, hasAcknowledgement: true } });

  console.log('Contracts created: 15 (10 main + 5 demo)');

  // ============================================================
  // STEP 15: Payments (payment schedules for all contracts)
  // ============================================================
  console.log('STEP 15: Creating Payments...');

  const now = new Date();
  let paymentCount = 0;

  // Helper to create payment schedule
  async function createPayments(contractId: string, monthlyPayment: number, totalMonths: number, dueDay: number, startDate: Date, paidCount: number, overdueCount: number) {
    for (let i = 1; i <= totalMonths; i++) {
      const dueDate = new Date(startDate.getFullYear(), startDate.getMonth() + i, dueDay);
      let status: 'PAID' | 'PENDING' | 'OVERDUE' | 'PARTIALLY_PAID' = 'PENDING';
      let amountPaid = 0;
      let paidDate: Date | null = null;

      if (i <= paidCount) {
        status = 'PAID';
        amountPaid = monthlyPayment;
        paidDate = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDay - 2 + Math.floor(Math.random() * 5));
      } else if (i <= paidCount + overdueCount) {
        status = 'OVERDUE';
      } else if (dueDate < now && i === paidCount + 1) {
        // partially paid
        if (overdueCount > 0) {
          status = 'OVERDUE';
        }
      }

      await prisma.payment.create({
        data: {
          contractId,
          installmentNo: i,
          dueDate,
          amountDue: monthlyPayment,
          amountPaid,
          paidDate,
          status,
          paymentMethod: amountPaid > 0 ? 'CASH' : undefined,
          recordedById: amountPaid > 0 ? 'user-004' : undefined,
        },
      });
      paymentCount++;
    }
  }

  // Contract 1: ACTIVE - 3 paid, rest pending (started Oct 2025)
  await createPayments('cont-001', c1.monthlyPayment, 10, 5, new Date('2025-10-01'), 4, 0);
  // Contract 2: ACTIVE - 4 paid
  await createPayments('cont-002', c2.monthlyPayment, 10, 15, new Date('2025-10-01'), 4, 0);
  // Contract 3: ACTIVE - 2 paid
  await createPayments('cont-003', c3.monthlyPayment, 10, 25, new Date('2025-11-01'), 3, 0);
  // Contract 4: OVERDUE - 2 paid, 2 overdue
  await createPayments('cont-004', c4.monthlyPayment, 10, 1, new Date('2025-10-01'), 2, 2);
  // Contract 5: OVERDUE - 3 paid, 1 overdue
  await createPayments('cont-005', c5.monthlyPayment, 10, 10, new Date('2025-10-01'), 3, 1);
  // Contract 6: DEFAULT - 1 paid, 4 overdue
  await createPayments('cont-006', c6.monthlyPayment, 10, 5, new Date('2025-09-01'), 1, 4);
  // Contract 7: COMPLETED - all 8 paid
  await createPayments('cont-007', c7.monthlyPayment, 8, 20, new Date('2025-06-01'), 8, 0);
  // Contract 8: EARLY_PAYOFF - 4 paid (then paid off early)
  await createPayments('cont-008', c8.monthlyPayment, 10, 15, new Date('2025-10-01'), 4, 0);
  // Contract 10: ACTIVE - 1 paid
  await createPayments('cont-010', c10.monthlyPayment, 10, 10, new Date('2026-01-01'), 1, 0);

  // Demo contracts
  await createPayments('cont-demo-001', cd1.monthlyPayment, 10, 5, new Date('2026-01-01'), 2, 0);
  await createPayments('cont-demo-002', cd2.monthlyPayment, 10, 15, new Date('2026-01-01'), 1, 0);
  await createPayments('cont-demo-003', cd3.monthlyPayment, 10, 1, new Date('2026-01-01'), 1, 1);
  await createPayments('cont-demo-004', cd4.monthlyPayment, 10, 10, new Date('2026-02-01'), 0, 0);
  await createPayments('cont-demo-005', cd5.monthlyPayment, 10, 20, new Date('2025-04-01'), 10, 0);

  console.log('Payments created:', paymentCount);

  console.log('=== Part 4: Contracts & Payments seeded ===');

  // ============================================================
  // STEP 16: ContractDocuments (10)
  // ============================================================
  console.log('STEP 16: Creating ContractDocuments...');

  const cdDocs = [
    { id: 'cdoc-001', contractId: 'cont-001', documentType: 'SIGNED_CONTRACT' as const, fileName: 'contract-BCP-2025-001.pdf', fileUrl: '/uploads/contracts/contract-BCP-2025-001.pdf', uploadedById: 'user-004' },
    { id: 'cdoc-002', contractId: 'cont-001', documentType: 'ID_CARD_COPY' as const, fileName: 'idcard-cust001.jpg', fileUrl: '/uploads/documents/idcard-cust001.jpg', uploadedById: 'user-004' },
    { id: 'cdoc-003', contractId: 'cont-002', documentType: 'SIGNED_CONTRACT' as const, fileName: 'contract-BCP-2025-002.pdf', fileUrl: '/uploads/contracts/contract-BCP-2025-002.pdf', uploadedById: 'user-005' },
    { id: 'cdoc-004', contractId: 'cont-002', documentType: 'FACEBOOK_PROFILE' as const, fileName: 'fb-cust002.jpg', fileUrl: '/uploads/documents/fb-cust002.jpg', uploadedById: 'user-005' },
    { id: 'cdoc-005', contractId: 'cont-003', documentType: 'SIGNED_CONTRACT' as const, fileName: 'contract-BCP-2025-003.pdf', fileUrl: '/uploads/contracts/contract-BCP-2025-003.pdf', uploadedById: 'user-004' },
    { id: 'cdoc-006', contractId: 'cont-004', documentType: 'SIGNED_CONTRACT' as const, fileName: 'contract-BCP-2025-004.pdf', fileUrl: '/uploads/contracts/contract-BCP-2025-004.pdf', uploadedById: 'user-004' },
    { id: 'cdoc-007', contractId: 'cont-004', documentType: 'BANK_STATEMENT' as const, fileName: 'bank-cust004.pdf', fileUrl: '/uploads/documents/bank-cust004.pdf', uploadedById: 'user-004' },
    { id: 'cdoc-008', contractId: 'cont-005', documentType: 'SIGNED_CONTRACT' as const, fileName: 'contract-BCP-2025-005.pdf', fileUrl: '/uploads/contracts/contract-BCP-2025-005.pdf', uploadedById: 'user-005' },
    { id: 'cdoc-009', contractId: 'cont-006', documentType: 'SIGNED_CONTRACT' as const, fileName: 'contract-BCP-2025-006.pdf', fileUrl: '/uploads/contracts/contract-BCP-2025-006.pdf', uploadedById: 'user-005' },
    { id: 'cdoc-010', contractId: 'cont-007', documentType: 'SIGNED_CONTRACT' as const, fileName: 'contract-BCP-2025-007.pdf', fileUrl: '/uploads/contracts/contract-BCP-2025-007.pdf', uploadedById: 'user-005' },
  ];

  for (const d of cdDocs) {
    await prisma.contractDocument.create({ data: d });
  }

  console.log('ContractDocuments created:', cdDocs.length);

  // ============================================================
  // STEP 17: CreditChecks (7)
  // ============================================================
  console.log('STEP 17: Creating CreditChecks...');

  const ccData = [
    { id: 'cc-001', contractId: 'cont-001', customerId: 'cust-001', status: 'APPROVED' as const, aiScore: 78, aiSummary: 'รายได้สม่ำเสมอ มีความสามารถในการผ่อนชำระ', aiRecommendation: 'APPROVE', checkedById: 'user-002', checkedAt: new Date('2025-10-02') },
    { id: 'cc-002', contractId: 'cont-002', customerId: 'cust-002', status: 'APPROVED' as const, aiScore: 62, aiSummary: 'นักศึกษา รายได้ไม่แน่นอน แต่มีผู้ปกครองค้ำ', aiRecommendation: 'APPROVE_WITH_CONDITION', checkedById: 'user-003', checkedAt: new Date('2025-10-11') },
    { id: 'cc-003', contractId: 'cont-004', customerId: 'cust-004', status: 'APPROVED' as const, aiScore: 55, aiSummary: 'ค้าขาย รายได้ไม่แน่นอน', aiRecommendation: 'APPROVE_WITH_CONDITION', checkedById: 'user-002', checkedAt: new Date('2025-10-05') },
    { id: 'cc-004', contractId: 'cont-006', customerId: 'cust-008', status: 'MANUAL_REVIEW' as const, aiScore: 30, aiSummary: 'ว่างงาน ไม่มีรายได้ประจำ ความเสี่ยงสูง', aiRecommendation: 'REJECT', checkedById: 'user-003', reviewNotes: 'อนุมัติโดยมีผู้ค้ำประกัน' },
    { id: 'cc-005', contractId: 'cont-007', customerId: 'cust-012', status: 'APPROVED' as const, aiScore: 82, aiSummary: 'รายได้ดี ค้าขาย ประวัติการชำระดี', aiRecommendation: 'APPROVE', checkedById: 'user-003', checkedAt: new Date('2025-06-02') },
    { id: 'cc-006', contractId: 'cont-008', customerId: 'cust-009', status: 'APPROVED' as const, aiScore: 90, aiSummary: 'โปรแกรมเมอร์ เงินเดือนสูง ความเสี่ยงต่ำ', aiRecommendation: 'APPROVE', checkedById: 'user-002', checkedAt: new Date('2025-10-02') },
    { id: 'cc-007', customerId: 'cust-010', status: 'PENDING' as const, aiScore: null, aiSummary: null },
  ];

  for (const cc of ccData) {
    await prisma.creditCheck.create({ data: cc });
  }

  console.log('CreditChecks created:', ccData.length);

  // ============================================================
  // STEP 18: Signatures (8)
  // ============================================================
  console.log('STEP 18: Creating Signatures...');

  const sigData = [
    { contractId: 'cont-001', signerType: 'CUSTOMER' as const, signatureImage: 'data:image/png;base64,FAKE_SIG_CUSTOMER_001', signerName: 'สมชาย ใจดี' },
    { contractId: 'cont-001', signerType: 'COMPANY' as const, signatureImage: 'data:image/png;base64,FAKE_SIG_STAFF_001', signerName: 'สมศักดิ์ พนักงานขาย', staffUserId: 'user-004' },
    { contractId: 'cont-002', signerType: 'CUSTOMER' as const, signatureImage: 'data:image/png;base64,FAKE_SIG_CUSTOMER_002', signerName: 'วิภาวดี ขยันเรียน' },
    { contractId: 'cont-002', signerType: 'COMPANY' as const, signatureImage: 'data:image/png;base64,FAKE_SIG_STAFF_002', signerName: 'อารียา พนักงานขาย', staffUserId: 'user-005' },
    { contractId: 'cont-004', signerType: 'CUSTOMER' as const, signatureImage: 'data:image/png;base64,FAKE_SIG_CUSTOMER_004', signerName: 'สุดารัตน์ แม่ค้าส้มตำ' },
    { contractId: 'cont-004', signerType: 'COMPANY' as const, signatureImage: 'data:image/png;base64,FAKE_SIG_STAFF_004', signerName: 'สมศักดิ์ พนักงานขาย', staffUserId: 'user-004' },
    { contractId: 'cont-007', signerType: 'CUSTOMER' as const, signatureImage: 'data:image/png;base64,FAKE_SIG_CUSTOMER_007', signerName: 'สุทธิ ปลดหนี้แล้ว' },
    { contractId: 'cont-007', signerType: 'COMPANY' as const, signatureImage: 'data:image/png;base64,FAKE_SIG_STAFF_007', signerName: 'อารียา พนักงานขาย', staffUserId: 'user-005' },
  ];

  for (const s of sigData) {
    await prisma.signature.create({ data: s });
  }

  console.log('Signatures created:', sigData.length);

  // ============================================================
  // STEP 19: EDocuments (4)
  // ============================================================
  console.log('STEP 19: Creating EDocuments...');

  const eDocData = [
    { contractId: 'cont-001', documentType: 'CONTRACT', fileUrl: '/uploads/edocs/contract-BCP-2025-001.pdf', fileHash: 'sha256_fake_hash_001', createdById: 'user-004' },
    { contractId: 'cont-002', documentType: 'CONTRACT', fileUrl: '/uploads/edocs/contract-BCP-2025-002.pdf', fileHash: 'sha256_fake_hash_002', createdById: 'user-005' },
    { contractId: 'cont-001', documentType: 'RECEIPT_DOWN', fileUrl: '/uploads/edocs/receipt-down-BCP-2025-001.pdf', fileHash: 'sha256_fake_hash_003', createdById: 'user-004' },
    { contractId: 'cont-007', documentType: 'PAYOFF', fileUrl: '/uploads/edocs/payoff-BCP-2025-007.pdf', fileHash: 'sha256_fake_hash_004', createdById: 'user-005' },
  ];

  for (const ed of eDocData) {
    await prisma.eDocument.create({ data: ed });
  }

  console.log('EDocuments created:', eDocData.length);

  // ============================================================
  // STEP 20: Sales (6)
  // ============================================================
  console.log('STEP 20: Creating Sales...');

  const salesData = [
    { saleNumber: 'SL-2025-001', saleType: 'INSTALLMENT' as const, customerId: 'cust-001', productId: 'prod-001', branchId: 'branch-002', salespersonId: 'user-004', sellingPrice: 54900, netAmount: 54900, contractId: 'cont-001', downPaymentAmount: 11000 },
    { saleNumber: 'SL-2025-002', saleType: 'INSTALLMENT' as const, customerId: 'cust-002', productId: 'prod-004', branchId: 'branch-003', salespersonId: 'user-005', sellingPrice: 49900, netAmount: 49900, contractId: 'cont-002', downPaymentAmount: 10000 },
    { saleNumber: 'SL-2025-003', saleType: 'CASH' as const, customerId: 'cust-003', productId: 'prod-006', branchId: 'branch-002', salespersonId: 'user-004', sellingPrice: 34900, netAmount: 34900, paymentMethod: 'CASH' as const, amountReceived: 34900 },
    { saleNumber: 'SL-2025-004', saleType: 'INSTALLMENT' as const, customerId: 'cust-004', productId: 'prod-009', branchId: 'branch-002', salespersonId: 'user-004', sellingPrice: 24900, netAmount: 24900, contractId: 'cont-004', downPaymentAmount: 5000 },
    { saleNumber: 'SL-2025-005', saleType: 'EXTERNAL_FINANCE' as const, customerId: 'cust-010', productId: 'prod-008', branchId: 'branch-003', salespersonId: 'user-005', sellingPrice: 29900, netAmount: 29900, financeCompany: 'Krungthai Card', financeRefNumber: 'KTC-2025-88001', financeAmount: 24900, downPaymentAmount: 5000 },
    { saleNumber: 'SL-2025-006', saleType: 'CASH' as const, customerId: 'cust-011', productId: 'prod-015', branchId: 'branch-003', salespersonId: 'user-005', sellingPrice: 14900, discount: 500, netAmount: 14400, paymentMethod: 'BANK_TRANSFER' as const, amountReceived: 14400 },
  ];

  for (const s of salesData) {
    await prisma.sale.create({ data: s });
  }

  console.log('Sales created:', salesData.length);

  // ============================================================
  // STEP 21: Repossession (1)
  // ============================================================
  console.log('STEP 21: Creating Repossession...');

  await prisma.repossession.create({
    data: {
      id: 'repo-001',
      contractId: 'cont-006',
      productId: 'prod-032',
      repossessedDate: new Date('2026-02-15'),
      conditionGrade: 'C',
      appraisalPrice: 10000,
      appraisedById: 'user-002',
      repairCost: 2000,
      status: 'REPOSSESSED',
      notes: 'ยึดเครื่องจากลูกค้า วรุฒม์ หนีหนี้ - ค้างชำระ 4 งวด',
    },
  });

  console.log('Repossession created: 1');

  console.log('=== Part 5: Documents, Sales, Repossession seeded ===');

  // ============================================================
  // STEP 22: InspectionTemplates + Items (2 templates)
  // ============================================================
  console.log('STEP 22: Creating InspectionTemplates...');

  await prisma.inspectionTemplate.create({
    data: {
      id: 'insp-tmpl-001',
      name: 'ตรวจสอบโทรศัพท์มือถือ',
      deviceType: 'PHONE',
      items: {
        create: [
          { id: 'iti-001', category: 'หน้าจอ', itemName: 'หน้าจอแสดงผลปกติ', scoreType: 'PASS_FAIL', sortOrder: 1 },
          { id: 'iti-002', category: 'หน้าจอ', itemName: 'ทัชสกรีนทำงานปกติ', scoreType: 'PASS_FAIL', sortOrder: 2 },
          { id: 'iti-003', category: 'หน้าจอ', itemName: 'สภาพหน้าจอ', scoreType: 'GRADE', sortOrder: 3 },
          { id: 'iti-004', category: 'ตัวเครื่อง', itemName: 'สภาพตัวเครื่อง', scoreType: 'GRADE', sortOrder: 4 },
          { id: 'iti-005', category: 'ตัวเครื่อง', itemName: 'ปุ่มกดทำงานปกติ', scoreType: 'PASS_FAIL', sortOrder: 5 },
          { id: 'iti-006', category: 'กล้อง', itemName: 'กล้องหน้าทำงาน', scoreType: 'PASS_FAIL', sortOrder: 6 },
          { id: 'iti-007', category: 'กล้อง', itemName: 'กล้องหลังทำงาน', scoreType: 'PASS_FAIL', sortOrder: 7 },
          { id: 'iti-008', category: 'เสียง', itemName: 'ลำโพงทำงาน', scoreType: 'PASS_FAIL', sortOrder: 8 },
          { id: 'iti-009', category: 'เสียง', itemName: 'ไมโครโฟนทำงาน', scoreType: 'PASS_FAIL', sortOrder: 9 },
          { id: 'iti-010', category: 'เซ็นเซอร์', itemName: 'Face ID / Touch ID', scoreType: 'PASS_FAIL', sortOrder: 10 },
          { id: 'iti-011', category: 'เซ็นเซอร์', itemName: 'GPS ทำงาน', scoreType: 'PASS_FAIL', sortOrder: 11 },
          { id: 'iti-012', category: 'การเชื่อมต่อ', itemName: 'WiFi ทำงาน', scoreType: 'PASS_FAIL', sortOrder: 12 },
          { id: 'iti-013', category: 'การเชื่อมต่อ', itemName: 'Bluetooth ทำงาน', scoreType: 'PASS_FAIL', sortOrder: 13 },
          { id: 'iti-014', category: 'แบตเตอรี่', itemName: 'Battery Health (%)', scoreType: 'NUMBER', sortOrder: 14 },
          { id: 'iti-015', category: 'อื่นๆ', itemName: 'สภาพโดยรวม', scoreType: 'GRADE', sortOrder: 15 },
        ],
      },
    },
  });

  await prisma.inspectionTemplate.create({
    data: {
      id: 'insp-tmpl-002',
      name: 'ตรวจสอบแท็บเล็ต',
      deviceType: 'TABLET',
      items: {
        create: [
          { id: 'iti-101', category: 'หน้าจอ', itemName: 'หน้าจอแสดงผลปกติ', scoreType: 'PASS_FAIL', sortOrder: 1 },
          { id: 'iti-102', category: 'หน้าจอ', itemName: 'ทัชสกรีนทำงานปกติ', scoreType: 'PASS_FAIL', sortOrder: 2 },
          { id: 'iti-103', category: 'หน้าจอ', itemName: 'Apple Pencil ใช้ได้', scoreType: 'PASS_FAIL', sortOrder: 3, isRequired: false },
          { id: 'iti-104', category: 'ตัวเครื่อง', itemName: 'สภาพตัวเครื่อง', scoreType: 'GRADE', sortOrder: 4 },
          { id: 'iti-105', category: 'กล้อง', itemName: 'กล้องทำงาน', scoreType: 'PASS_FAIL', sortOrder: 5 },
          { id: 'iti-106', category: 'เสียง', itemName: 'ลำโพงทำงาน', scoreType: 'PASS_FAIL', sortOrder: 6 },
          { id: 'iti-107', category: 'แบตเตอรี่', itemName: 'Battery Health (%)', scoreType: 'NUMBER', sortOrder: 7 },
          { id: 'iti-108', category: 'อื่นๆ', itemName: 'สภาพโดยรวม', scoreType: 'GRADE', sortOrder: 8 },
        ],
      },
    },
  });

  console.log('InspectionTemplates created: 2 (Phone 15 items, Tablet 8 items)');

  // ============================================================
  // STEP 23: Inspections + Results (3)
  // ============================================================
  console.log('STEP 23: Creating Inspections...');

  // Inspection 1: Grade A - prod-009
  const insp1 = await prisma.inspection.create({
    data: {
      id: 'insp-001',
      productId: 'prod-009',
      templateId: 'insp-tmpl-001',
      inspectorId: 'user-001',
      inspectedAt: new Date('2025-11-03'),
      overallGrade: 'A',
      isCompleted: true,
      notes: 'เครื่องสภาพดีมาก',
    },
  });

  // Results for insp-001 (Grade A - all pass)
  const resultsA = [
    { inspectionId: 'insp-001', templateItemId: 'iti-001', passFail: true },
    { inspectionId: 'insp-001', templateItemId: 'iti-002', passFail: true },
    { inspectionId: 'insp-001', templateItemId: 'iti-003', grade: 'A' as const },
    { inspectionId: 'insp-001', templateItemId: 'iti-004', grade: 'A' as const },
    { inspectionId: 'insp-001', templateItemId: 'iti-005', passFail: true },
    { inspectionId: 'insp-001', templateItemId: 'iti-006', passFail: true },
    { inspectionId: 'insp-001', templateItemId: 'iti-007', passFail: true },
    { inspectionId: 'insp-001', templateItemId: 'iti-008', passFail: true },
    { inspectionId: 'insp-001', templateItemId: 'iti-009', passFail: true },
    { inspectionId: 'insp-001', templateItemId: 'iti-010', passFail: true },
    { inspectionId: 'insp-001', templateItemId: 'iti-011', passFail: true },
    { inspectionId: 'insp-001', templateItemId: 'iti-012', passFail: true },
    { inspectionId: 'insp-001', templateItemId: 'iti-013', passFail: true },
    { inspectionId: 'insp-001', templateItemId: 'iti-014', numberValue: 92 },
    { inspectionId: 'insp-001', templateItemId: 'iti-015', grade: 'A' as const },
  ];

  for (const r of resultsA) {
    await prisma.inspectionResult.create({ data: r });
  }

  // Inspection 2: Grade B - prod-012
  await prisma.inspection.create({
    data: {
      id: 'insp-002',
      productId: 'prod-012',
      templateId: 'insp-tmpl-001',
      inspectorId: 'user-001',
      inspectedAt: new Date('2025-11-03'),
      overallGrade: 'B',
      isCompleted: true,
      notes: 'รอยขีดข่วนเล็กน้อยที่ด้านหลัง',
    },
  });

  const resultsB = [
    { inspectionId: 'insp-002', templateItemId: 'iti-001', passFail: true },
    { inspectionId: 'insp-002', templateItemId: 'iti-002', passFail: true },
    { inspectionId: 'insp-002', templateItemId: 'iti-003', grade: 'B' as const },
    { inspectionId: 'insp-002', templateItemId: 'iti-004', grade: 'B' as const },
    { inspectionId: 'insp-002', templateItemId: 'iti-014', numberValue: 87 },
    { inspectionId: 'insp-002', templateItemId: 'iti-015', grade: 'B' as const },
  ];

  for (const r of resultsB) {
    await prisma.inspectionResult.create({ data: r });
  }

  // Inspection 3: Grade D - prod-031
  await prisma.inspection.create({
    data: {
      id: 'insp-003',
      productId: 'prod-031',
      templateId: 'insp-tmpl-001',
      inspectorId: 'user-001',
      inspectedAt: new Date('2025-11-03'),
      overallGrade: 'D',
      isCompleted: true,
      notes: 'หน้าจอแตก ตัวเครื่องบุบ',
    },
  });

  const resultsD = [
    { inspectionId: 'insp-003', templateItemId: 'iti-001', passFail: false, notes: 'หน้าจอแตก' },
    { inspectionId: 'insp-003', templateItemId: 'iti-003', grade: 'D' as const },
    { inspectionId: 'insp-003', templateItemId: 'iti-004', grade: 'D' as const, notes: 'ตัวเครื่องบุบหลายจุด' },
    { inspectionId: 'insp-003', templateItemId: 'iti-014', numberValue: 72 },
    { inspectionId: 'insp-003', templateItemId: 'iti-015', grade: 'D' as const },
  ];

  for (const r of resultsD) {
    await prisma.inspectionResult.create({ data: r });
  }

  console.log('Inspections created: 3 (Grade A, B, D) with results');

  console.log('=== Part 6: Inspections seeded ===');

  // ============================================================
  // STEP 24: StockTransfers (4)
  // ============================================================
  console.log('STEP 24: Creating StockTransfers...');

  await prisma.stockTransfer.create({
    data: { id: 'tf-001', batchNumber: 'TRF-2025-11-001', productId: 'prod-003', fromBranchId: 'branch-001', toBranchId: 'branch-002', transferredBy: 'user-001', status: 'CONFIRMED', confirmedById: 'user-002', confirmedAt: new Date('2025-11-10'), dispatchedById: 'user-001', dispatchedAt: new Date('2025-11-09') },
  });
  await prisma.stockTransfer.create({
    data: { id: 'tf-002', batchNumber: 'TRF-2025-12-001', productId: 'prod-007', fromBranchId: 'branch-001', toBranchId: 'branch-004', transferredBy: 'user-001', status: 'IN_TRANSIT', dispatchedById: 'user-001', dispatchedAt: new Date('2025-12-20'), expectedDeliveryDate: new Date('2025-12-22') },
  });
  await prisma.stockTransfer.create({
    data: { id: 'tf-003', batchNumber: 'TRF-2026-01-001', productId: 'prod-011', fromBranchId: 'branch-001', toBranchId: 'branch-004', transferredBy: 'user-001', status: 'PENDING' },
  });
  await prisma.stockTransfer.create({
    data: { id: 'tf-004', batchNumber: 'TRF-2026-02-001', productId: 'prod-012', fromBranchId: 'branch-002', toBranchId: 'branch-003', transferredBy: 'user-002', status: 'REJECTED', notes: 'สาขาปลายทางไม่ต้องการแล้ว' },
  });

  console.log('StockTransfers created: 4');

  // ============================================================
  // STEP 25: BranchReceiving (1)
  // ============================================================
  console.log('STEP 25: Creating BranchReceiving...');

  await prisma.branchReceiving.create({
    data: {
      id: 'br-001',
      transferId: 'tf-001',
      receivedById: 'user-002',
      status: 'COMPLETED',
      items: {
        create: [{
          productId: 'prod-003',
          imeiSerial: '350000000000003',
          status: 'PASS',
          conditionNotes: 'สภาพดี ตรงตาม IMEI',
        }],
      },
    },
  });

  console.log('BranchReceiving created: 1');

  // ============================================================
  // STEP 26: StockAdjustments (3)
  // ============================================================
  console.log('STEP 26: Creating StockAdjustments...');

  await prisma.stockAdjustment.create({
    data: { productId: 'prod-031', branchId: 'branch-001', reason: 'DAMAGED', previousStatus: 'IN_STOCK', notes: 'หน้าจอแตก ตัวเครื่องบุบ จากการตรวจสอบ', adjustedById: 'user-001' },
  });
  await prisma.stockAdjustment.create({
    data: { productId: 'prod-003', branchId: 'branch-002', reason: 'CORRECTION', previousStatus: 'IN_STOCK', notes: 'แก้ไขสถานะหลังโอนย้ายสาขา', adjustedById: 'user-002' },
  });
  await prisma.stockAdjustment.create({
    data: { productId: 'prod-033', branchId: 'branch-004', reason: 'FOUND', previousStatus: 'DAMAGED', notes: 'พบเครื่องที่แจ้งหาย สภาพดี', adjustedById: 'user-008' },
  });

  console.log('StockAdjustments created: 3');

  // ============================================================
  // STEP 27: ReorderPoints (4) + StockAlerts (3)
  // ============================================================
  console.log('STEP 27: Creating ReorderPoints & StockAlerts...');

  await prisma.reorderPoint.create({
    data: { id: 'rp-001', brand: 'Apple', model: 'iPhone 16 Pro Max', storage: '256GB', category: 'PHONE_NEW', branchId: 'branch-002', minQuantity: 2, reorderQuantity: 5 },
  });
  await prisma.reorderPoint.create({
    data: { id: 'rp-002', brand: 'Apple', model: 'iPhone 16 Pro', storage: '256GB', category: 'PHONE_NEW', branchId: 'branch-002', minQuantity: 2, reorderQuantity: 3 },
  });
  await prisma.reorderPoint.create({
    data: { id: 'rp-003', brand: 'Apple', model: 'iPhone 16', storage: '128GB', category: 'PHONE_NEW', branchId: 'branch-003', minQuantity: 2, reorderQuantity: 5 },
  });
  await prisma.reorderPoint.create({
    data: { id: 'rp-004', brand: 'Apple', model: 'iPad Air M1', storage: '256GB', category: 'TABLET', branchId: 'branch-004', minQuantity: 1, reorderQuantity: 3 },
  });

  // StockAlerts
  await prisma.stockAlert.create({
    data: { id: 'sa-001', reorderPointId: 'rp-001', brand: 'Apple', model: 'iPhone 16 Pro Max', storage: '256GB', category: 'PHONE_NEW', branchId: 'branch-002', currentStock: 1, minQuantity: 2, reorderQuantity: 5, status: 'ACTIVE' },
  });
  await prisma.stockAlert.create({
    data: { id: 'sa-002', reorderPointId: 'rp-002', brand: 'Apple', model: 'iPhone 16 Pro', storage: '256GB', category: 'PHONE_NEW', branchId: 'branch-002', currentStock: 1, minQuantity: 2, reorderQuantity: 3, status: 'PO_CREATED', poId: 'po-007' },
  });
  await prisma.stockAlert.create({
    data: { id: 'sa-003', reorderPointId: 'rp-003', brand: 'Apple', model: 'iPhone 16', storage: '128GB', category: 'PHONE_NEW', branchId: 'branch-003', currentStock: 0, minQuantity: 2, reorderQuantity: 5, status: 'RESOLVED', resolvedAt: new Date('2026-01-20') },
  });

  console.log('ReorderPoints created: 4, StockAlerts created: 3');

  // ============================================================
  // STEP 28: StockCounts (3)
  // ============================================================
  console.log('STEP 28: Creating StockCounts...');

  // StockCount 1: COMPLETED
  await prisma.stockCount.create({
    data: {
      id: 'sc-001',
      countNumber: 'SC-2026-01-001',
      branchId: 'branch-002',
      countedById: 'user-002',
      status: 'COMPLETED',
      startedAt: new Date('2026-01-28'),
      completedAt: new Date('2026-01-28'),
      notes: 'ตรวจนับประจำเดือน มกราคม',
      items: {
        create: [
          { productId: 'prod-003', expectedStatus: 'IN_STOCK', actualFound: true, scannedImei: '350000000000003' },
          { productId: 'prod-005', expectedStatus: 'IN_STOCK', actualFound: true, scannedImei: '350000000000005' },
          { productId: 'prod-014', expectedStatus: 'IN_STOCK', actualFound: true, scannedImei: '350000000000014' },
        ],
      },
    },
  });

  // StockCount 2: IN_PROGRESS
  await prisma.stockCount.create({
    data: {
      id: 'sc-002',
      countNumber: 'SC-2026-02-001',
      branchId: 'branch-003',
      countedById: 'user-003',
      status: 'IN_PROGRESS',
      startedAt: new Date('2026-02-25'),
      notes: 'ตรวจนับประจำเดือน กุมภาพันธ์',
      items: {
        create: [
          { productId: 'prod-008', expectedStatus: 'IN_STOCK', actualFound: true, scannedImei: '350000000000008' },
          { productId: 'prod-015', expectedStatus: 'IN_STOCK', actualFound: false, conditionNotes: 'ยังไม่พบ กำลังตรวจสอบ' },
        ],
      },
    },
  });

  // StockCount 3: DRAFT
  await prisma.stockCount.create({
    data: {
      id: 'sc-003',
      countNumber: 'SC-2026-03-001',
      branchId: 'branch-004',
      countedById: 'user-008',
      status: 'DRAFT',
      notes: 'เตรียมตรวจนับเดือนมีนาคม',
    },
  });

  console.log('StockCounts created: 3');

  console.log('=== Part 7: Stock operations seeded ===');

  // ============================================================
  // STEP 29: CallLogs (6)
  // ============================================================
  console.log('STEP 29: Creating CallLogs...');

  const callLogsData = [
    { contractId: 'cont-004', callerId: 'user-004', calledAt: new Date('2026-02-05'), result: 'ANSWERED', notes: 'ลูกค้าแจ้งจะชำระภายในสัปดาห์นี้' },
    { contractId: 'cont-004', callerId: 'user-004', calledAt: new Date('2026-02-12'), result: 'NO_ANSWER', notes: 'โทรไม่รับ 3 ครั้ง' },
    { contractId: 'cont-005', callerId: 'user-005', calledAt: new Date('2026-02-10'), result: 'PROMISED', notes: 'ลูกค้าสัญญาจะชำระวันที่ 15' },
    { contractId: 'cont-005', callerId: 'user-005', calledAt: new Date('2026-02-20'), result: 'ANSWERED', notes: 'ลูกค้าแจ้งว่าโอนเงินแล้ว รอตรวจสอบ' },
    { contractId: 'cont-006', callerId: 'user-005', calledAt: new Date('2026-01-15'), result: 'REFUSED', notes: 'ลูกค้าปฏิเสธการชำระ แจ้งไม่มีเงิน' },
    { contractId: 'cont-006', callerId: 'user-003', calledAt: new Date('2026-02-01'), result: 'NO_ANSWER', notes: 'โทรไม่รับ เตรียมดำเนินการยึดเครื่อง' },
  ];

  for (const cl of callLogsData) {
    await prisma.callLog.create({ data: cl });
  }

  console.log('CallLogs created:', callLogsData.length);

  // ============================================================
  // STEP 30: NotificationLogs (6)
  // ============================================================
  console.log('STEP 30: Creating NotificationLogs...');

  const notifData = [
    { channel: 'LINE' as const, recipient: 'U_fake_line_001', subject: 'แจ้งเตือนชำระเงิน', message: 'สัญญา BCP-2025-001 ครบกำหนดชำระงวดที่ 5 จำนวน 4,838 บาท ภายในวันที่ 5 มี.ค. 2569', status: 'SENT', relatedId: 'cont-001', sentAt: new Date('2026-03-01') },
    { channel: 'LINE' as const, recipient: 'U_fake_line_002', subject: 'แจ้งเตือนค้างชำระ', message: 'สัญญา BCP-2025-004 เลยกำหนดชำระ 30 วัน กรุณาชำระโดยเร็ว', status: 'SENT', relatedId: 'cont-004', sentAt: new Date('2026-02-01') },
    { channel: 'SMS' as const, recipient: '0812345004', subject: 'แจ้งเตือนชำระเงิน', message: 'BESTCHOICE: สัญญา BCP-2025-004 ครบกำหนดชำระ กรุณาชำระภายใน 7 วัน', status: 'SENT', relatedId: 'cont-004', sentAt: new Date('2026-01-08') },
    { channel: 'SMS' as const, recipient: '0812345008', subject: 'แจ้งเตือนค้างชำระ', message: 'BESTCHOICE: สัญญา BCP-2025-006 ค้างชำระ 4 งวด กรุณาติดต่อ 02-100-0000', status: 'FAILED', relatedId: 'cont-006', errorMsg: 'SMS gateway timeout' },
    { channel: 'IN_APP' as const, recipient: 'user-002', subject: 'Stock Alert', message: 'สินค้า iPhone 16 Pro Max 256GB ที่สาขาลาดพร้าวเหลือ 1 เครื่อง ต่ำกว่าขั้นต่ำ', status: 'SENT', relatedId: 'sa-001' },
    { channel: 'LINE' as const, recipient: 'U_fake_line_003', subject: 'แจ้งยึดเครื่อง', message: 'แจ้งเตือน: สัญญา BCP-2025-006 ถูกยกเลิกเนื่องจากผิดนัดชำระ', status: 'FAILED', relatedId: 'cont-006', errorMsg: 'LINE user blocked' },
  ];

  for (const n of notifData) {
    await prisma.notificationLog.create({ data: n });
  }

  console.log('NotificationLogs created:', notifData.length);

  // ============================================================
  // STEP 31: AuditLogs (10)
  // ============================================================
  console.log('STEP 31: Creating AuditLogs...');

  const auditData = [
    { userId: 'user-004', action: 'CREATE', entity: 'contract', entityId: 'cont-001', newValue: { contractNumber: 'BCP-2025-001', status: 'DRAFT' } },
    { userId: 'user-002', action: 'UPDATE', entity: 'contract', entityId: 'cont-001', oldValue: { status: 'DRAFT' }, newValue: { status: 'ACTIVE', workflowStatus: 'APPROVED' } },
    { userId: 'user-004', action: 'CREATE', entity: 'payment', entityId: 'cont-001', newValue: { installmentNo: 1, amountPaid: 4838 } },
    { userId: 'user-005', action: 'CREATE', entity: 'contract', entityId: 'cont-002', newValue: { contractNumber: 'BCP-2025-002', status: 'DRAFT' } },
    { userId: 'user-003', action: 'UPDATE', entity: 'contract', entityId: 'cont-002', oldValue: { status: 'DRAFT' }, newValue: { status: 'ACTIVE', workflowStatus: 'APPROVED' } },
    { userId: 'user-005', action: 'UPDATE', entity: 'contract', entityId: 'cont-006', oldValue: { status: 'OVERDUE' }, newValue: { status: 'DEFAULT' } },
    { userId: 'user-002', action: 'REPOSSESSION', entity: 'contract', entityId: 'cont-006', newValue: { repossessionId: 'repo-001', productId: 'prod-032' } },
    { userId: 'user-001', action: 'CREATE', entity: 'product', entityId: 'prod-001', newValue: { name: 'iPhone 16 Pro Max 256GB', status: 'IN_STOCK' } },
    { userId: 'user-001', action: 'UPDATE', entity: 'product', entityId: 'prod-031', oldValue: { status: 'IN_STOCK' }, newValue: { status: 'DAMAGED' } },
    { userId: 'user-004', action: 'UPDATE', entity: 'contract', entityId: 'cont-008', oldValue: { status: 'ACTIVE' }, newValue: { status: 'EARLY_PAYOFF' } },
  ];

  for (const a of auditData) {
    await prisma.auditLog.create({ data: a });
  }

  console.log('AuditLogs created:', auditData.length);

  // ============================================================
  // STEP 32: ContractTemplates (1)
  // ============================================================
  console.log('STEP 32: Creating ContractTemplates...');

  let contractHtml = '<h1>สัญญาเช่าซื้อ</h1><p>เนื้อหาสัญญาจำลอง...</p>';
  try {
    const htmlPath = path.join(__dirname, '../src/modules/documents/templates/hire-purchase-contract.html');
    if (fs.existsSync(htmlPath)) {
      contractHtml = fs.readFileSync(htmlPath, 'utf-8');
      console.log('  → Loaded contract HTML template from file');
    } else {
      console.log('  → Contract HTML file not found, using placeholder');
    }
  } catch {
    console.log('  → Error reading contract template, using placeholder');
  }

  await prisma.contractTemplate.create({
    data: {
      id: 'ct-001',
      name: 'สัญญาเช่าซื้อมาตรฐาน',
      type: 'STORE_DIRECT',
      contentHtml: contractHtml,
      placeholders: ['{{companyName}}', '{{customerName}}', '{{productName}}', '{{sellingPrice}}', '{{downPayment}}', '{{monthlyPayment}}', '{{totalMonths}}', '{{interestRate}}'],
      isActive: true,
    },
  });

  console.log('ContractTemplates created: 1');

  // ============================================================
  // STEP 33: StickerTemplates (2)
  // ============================================================
  console.log('STEP 33: Creating StickerTemplates...');

  await prisma.stickerTemplate.create({
    data: {
      id: 'st-001',
      name: 'สติ๊กเกอร์ราคาสินค้า',
      sizeWidthMm: 60,
      sizeHeightMm: 40,
      layoutConfig: {
        fields: [
          { type: 'text', key: 'productName', x: 5, y: 5, fontSize: 10, fontWeight: 'bold' },
          { type: 'text', key: 'cashPrice', x: 5, y: 18, fontSize: 12, fontWeight: 'bold', color: '#FF0000' },
          { type: 'text', key: 'installmentPrice', x: 5, y: 28, fontSize: 9 },
          { type: 'barcode', key: 'imei', x: 5, y: 35, width: 50, height: 15 },
        ],
      },
      placeholders: ['{{productName}}', '{{cashPrice}}', '{{installmentPrice}}', '{{imei}}'],
    },
  });

  await prisma.stickerTemplate.create({
    data: {
      id: 'st-002',
      name: 'สติ๊กเกอร์ QR Code',
      sizeWidthMm: 40,
      sizeHeightMm: 40,
      layoutConfig: {
        fields: [
          { type: 'qr', key: 'productUrl', x: 5, y: 2, size: 30 },
          { type: 'text', key: 'productName', x: 5, y: 34, fontSize: 7, align: 'center' },
        ],
      },
      placeholders: ['{{productUrl}}', '{{productName}}'],
    },
  });

  console.log('StickerTemplates created: 2');

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n========================================');
  console.log('=== SEED COMPLETED SUCCESSFULLY ===');
  console.log('========================================');
  console.log('CompanyInfo: 1');
  console.log('SystemConfig: 21');
  console.log('Branches: 4 (1 warehouse + 3 stores)');
  console.log('Users: 8 (1 OWNER, 3 BRANCH_MANAGER, 3 SALES, 1 ACCOUNTANT)');
  console.log('Suppliers: 10 (Apple + accessories only)');
  console.log('SupplierPaymentMethods: 11');
  console.log('InterestConfig: 4');
  console.log('PurchaseOrders: 9, POItems: 17');
  console.log('Products: 33');
  console.log('ProductPrices:', ppData.length);
  console.log('PricingTemplates: 8');
  console.log('GoodsReceivings: 6');
  console.log('Customers: 15 (12 regular + 3 LINE OA demo)');
  console.log('Contracts: 15 (10 main + 5 demo)');
  console.log('Payments:', paymentCount);
  console.log('ContractDocuments: 10');
  console.log('CreditChecks: 7');
  console.log('Signatures: 8');
  console.log('EDocuments: 4');
  console.log('Sales: 6');
  console.log('Repossession: 1');
  console.log('InspectionTemplates: 2 (Phone 15 items, Tablet 8 items)');
  console.log('Inspections: 3 (Grade A, B, D)');
  console.log('StockTransfers: 4');
  console.log('BranchReceiving: 1');
  console.log('StockAdjustments: 3');
  console.log('ReorderPoints: 4, StockAlerts: 3');
  console.log('StockCounts: 3');
  console.log('CallLogs: 6');
  console.log('NotificationLogs: 6');
  console.log('AuditLogs: 10');
  console.log('ContractTemplates: 1');
  console.log('StickerTemplates: 2');
  console.log('========================================\n');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
