import { PrismaClient, AccountGroup } from '@prisma/client';

interface ChartOfAccountSeed {
  code: string;
  nameTh: string;
  nameEn?: string;
  accountGroup: AccountGroup;
  parentCode?: string;
  level: number;
  allowedCompanies?: string[]; // [] หรือไม่ระบุ = ใช้ได้ทุกบริษัท
  peakAccountCode?: string;    // รหัสบัญชีฝั่ง PEAK (ถ้ามี)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CHART_OF_ACCOUNTS: ChartOfAccountSeed[] = [
  // ════════════════════════════════════════════════════════════
  // หมวด 1: สินทรัพย์ (ASSET) — PEAK format XX-XXXX
  // ════════════════════════════════════════════════════════════

  // ── สินทรัพย์หมุนเวียน ──
  { code: '11-0000', nameTh: 'สินทรัพย์หมุนเวียน', nameEn: 'Current Assets', accountGroup: AccountGroup.ASSET, level: 1 },

  // กลุ่มเงินสดและรายการเทียบเท่าเงินสด
  { code: '11-11XX', nameTh: 'กลุ่มเงินสดและรายการเทียบเท่าเงินสด', nameEn: 'Cash and Cash Equivalents', accountGroup: AccountGroup.ASSET, parentCode: '11-0000', level: 2 },
  { code: '11-1101', nameTh: 'เงินสด - สุทธิ/เงินย่อย', nameEn: 'Cash on Hand / Petty Cash', accountGroup: AccountGroup.ASSET, parentCode: '11-11XX', level: 3 },
  { code: '11-1102', nameTh: 'เงินสด - เอกสาร/ค่าส่ง', nameEn: 'Cash - Documents/Delivery', accountGroup: AccountGroup.ASSET, parentCode: '11-11XX', level: 3 },
  { code: '11-1103', nameTh: 'เงินสด - อิเล็กทรอนิกส์', nameEn: 'Cash - Electronic', accountGroup: AccountGroup.ASSET, parentCode: '11-11XX', level: 3 },

  // กลุ่มเงินฝากธนาคาร
  { code: '11-12XX', nameTh: 'กลุ่มเงินฝากธนาคาร', nameEn: 'Bank Deposits', accountGroup: AccountGroup.ASSET, parentCode: '11-0000', level: 2 },
  { code: '11-1201', nameTh: 'ธนาคาร - กสิกรไทย ออมทรัพย์', nameEn: 'Bank - KBank Savings', accountGroup: AccountGroup.ASSET, parentCode: '11-12XX', level: 3 },
  { code: '11-1202', nameTh: 'ธนาคาร - ไทยพาณิชย์ ออมทรัพย์', nameEn: 'Bank - SCB Savings', accountGroup: AccountGroup.ASSET, parentCode: '11-12XX', level: 3 },
  { code: '11-1203', nameTh: 'ธนาคาร - กรุงไทย ออมทรัพย์', nameEn: 'Bank - KTB Savings', accountGroup: AccountGroup.ASSET, parentCode: '11-12XX', level: 3 },

  // กลุ่มลูกหนี้การค้าและลูกหนี้อื่น
  { code: '11-21XX', nameTh: 'กลุ่มลูกหนี้การค้าและลูกหนี้อื่น', nameEn: 'Trade and Other Receivables', accountGroup: AccountGroup.ASSET, parentCode: '11-0000', level: 2 },
  { code: '11-2101', nameTh: 'ลูกหนี้การค้า', nameEn: 'Accounts Receivable', accountGroup: AccountGroup.ASSET, parentCode: '11-21XX', level: 3 },
  { code: '11-2102', nameTh: 'ลูกหนี้เช่าซื้อ', nameEn: 'Hire-Purchase Receivable', accountGroup: AccountGroup.ASSET, parentCode: '11-21XX', level: 3, allowedCompanies: ['FINANCE'] },
  { code: '11-2103', nameTh: 'หัก: ค่าเผื่อหนี้สงสัยจะสูญ', nameEn: 'Less: Allowance for Doubtful Accounts', accountGroup: AccountGroup.ASSET, parentCode: '11-21XX', level: 3 },
  { code: '11-2104', nameTh: 'ลูกหนี้ไฟแนนซ์ภายนอก', nameEn: 'External Finance Receivable', accountGroup: AccountGroup.ASSET, parentCode: '11-21XX', level: 3 },

  // กลุ่มต้นทุนสินค้าคงเหลือ
  { code: '11-31XX', nameTh: 'กลุ่มต้นทุนสินค้าคงเหลือ', nameEn: 'Inventory', accountGroup: AccountGroup.ASSET, parentCode: '11-0000', level: 2 },
  { code: '11-3101', nameTh: 'ต้นทุนมือถือ (ใหม่)', nameEn: 'Inventory - New Phones', accountGroup: AccountGroup.ASSET, parentCode: '11-31XX', level: 3 },
  { code: '11-3102', nameTh: 'ต้นทุนมือถือ (มือสอง)', nameEn: 'Inventory - Used Phones', accountGroup: AccountGroup.ASSET, parentCode: '11-31XX', level: 3 },
  { code: '11-3103', nameTh: 'สินค้ายึดคืน/ซ่อมแล้ว', nameEn: 'Repossessed/Refurbished Goods', accountGroup: AccountGroup.ASSET, parentCode: '11-31XX', level: 3 },

  // กลุ่มภาษีและสินทรัพย์หมุนเวียนอื่น
  { code: '11-41XX', nameTh: 'กลุ่มภาษีและสินทรัพย์หมุนเวียนอื่น', nameEn: 'Tax and Other Current Assets', accountGroup: AccountGroup.ASSET, parentCode: '11-0000', level: 2 },
  { code: '11-4101', nameTh: 'ภาษีซื้อ', nameEn: 'Input VAT', accountGroup: AccountGroup.ASSET, parentCode: '11-41XX', level: 3, allowedCompanies: ['FINANCE'] },
  { code: '11-4102', nameTh: 'ภาษีซื้อยังไม่ถึงกำหนด', nameEn: 'Input VAT Pending', accountGroup: AccountGroup.ASSET, parentCode: '11-41XX', level: 3, allowedCompanies: ['FINANCE'] },

  // ── สินทรัพย์ไม่หมุนเวียน ──
  { code: '12-0000', nameTh: 'สินทรัพย์ไม่หมุนเวียน', nameEn: 'Non-Current Assets', accountGroup: AccountGroup.ASSET, level: 1 },

  // กลุ่มที่ดิน อาคาร และอุปกรณ์
  { code: '12-21XX', nameTh: 'กลุ่มที่ดิน อาคาร และอุปกรณ์', nameEn: 'Property, Plant and Equipment', accountGroup: AccountGroup.ASSET, parentCode: '12-0000', level: 2 },
  { code: '12-2101', nameTh: 'อุปกรณ์สำนักงาน', nameEn: 'Office Equipment', accountGroup: AccountGroup.ASSET, parentCode: '12-21XX', level: 3 },
  { code: '12-2102', nameTh: 'หัก: ค่าเสื่อมราคาสะสม - อุปกรณ์สำนักงาน', nameEn: 'Less: Accum. Depr. - Office Equipment', accountGroup: AccountGroup.ASSET, parentCode: '12-21XX', level: 3 },
  { code: '12-2103', nameTh: 'ส่วนปรับปรุงอาคาร', nameEn: 'Leasehold Improvements', accountGroup: AccountGroup.ASSET, parentCode: '12-21XX', level: 3 },
  { code: '12-2104', nameTh: 'หัก: ค่าเสื่อมราคาสะสม - ส่วนปรับปรุงอาคาร', nameEn: 'Less: Accum. Depr. - Leasehold Improvements', accountGroup: AccountGroup.ASSET, parentCode: '12-21XX', level: 3 },
  { code: '12-2105', nameTh: 'เครื่องตกแต่งสำนักงาน', nameEn: 'Office Furniture and Fixtures', accountGroup: AccountGroup.ASSET, parentCode: '12-21XX', level: 3 },
  { code: '12-2106', nameTh: 'หัก: ค่าเสื่อมราคาสะสม - เครื่องตกแต่ง', nameEn: 'Less: Accum. Depr. - Furniture and Fixtures', accountGroup: AccountGroup.ASSET, parentCode: '12-21XX', level: 3 },
  { code: '12-2107', nameTh: 'ยานพาหนะ', nameEn: 'Vehicles', accountGroup: AccountGroup.ASSET, parentCode: '12-21XX', level: 3 },

  // ════════════════════════════════════════════════════════════
  // หมวด 2: หนี้สิน (LIABILITY)
  // ════════════════════════════════════════════════════════════

  // ── หนี้สินหมุนเวียน ──
  { code: '21-0000', nameTh: 'หนี้สินหมุนเวียน', nameEn: 'Current Liabilities', accountGroup: AccountGroup.LIABILITY, level: 1 },

  // กลุ่มเจ้าหนี้การค้าและเจ้าหนี้อื่น
  { code: '21-11XX', nameTh: 'กลุ่มเจ้าหนี้การค้าและเจ้าหนี้อื่น', nameEn: 'Trade and Other Payables', accountGroup: AccountGroup.LIABILITY, parentCode: '21-0000', level: 2 },
  { code: '21-1101', nameTh: 'เจ้าหนี้การค้า', nameEn: 'Accounts Payable', accountGroup: AccountGroup.LIABILITY, parentCode: '21-11XX', level: 3 },
  { code: '21-1103', nameTh: 'เจ้าหนี้ค่าใช้จ่ายบริการ', nameEn: 'Service Expense Payable', accountGroup: AccountGroup.LIABILITY, parentCode: '21-11XX', level: 3 },

  // กลุ่มภาษีมูลค่าเพิ่ม (VAT)
  { code: '21-21XX', nameTh: 'กลุ่มภาษีมูลค่าเพิ่ม (VAT)', nameEn: 'Value Added Tax (VAT)', accountGroup: AccountGroup.LIABILITY, parentCode: '21-0000', level: 2 },
  { code: '21-2101', nameTh: 'ภาษีขาย ภ.พ.30', nameEn: 'Output VAT (PP.30)', accountGroup: AccountGroup.LIABILITY, parentCode: '21-21XX', level: 3, allowedCompanies: ['FINANCE'] },
  { code: '21-2102', nameTh: 'ภ.พ.30 ค้างจ่าย', nameEn: 'VAT Payable (PP.30)', accountGroup: AccountGroup.LIABILITY, parentCode: '21-21XX', level: 3, allowedCompanies: ['FINANCE'] },

  // กลุ่มภาษีหัก ณ ที่จ่าย (WHT)
  { code: '21-31XX', nameTh: 'กลุ่มภาษีหัก ณ ที่จ่าย (WHT)', nameEn: 'Withholding Tax', accountGroup: AccountGroup.LIABILITY, parentCode: '21-0000', level: 2 },
  { code: '21-3101', nameTh: 'ภ.ง.ด.1 ค่าจ้าง (เงินเดือน)', nameEn: 'WHT PND.1 (Salary)', accountGroup: AccountGroup.LIABILITY, parentCode: '21-31XX', level: 3 },
  { code: '21-3102', nameTh: 'ภ.ง.ด.3 ค่าจ้าง (บุคคลธรรมดา)', nameEn: 'WHT PND.3 (Individual)', accountGroup: AccountGroup.LIABILITY, parentCode: '21-31XX', level: 3 },
  { code: '21-3103', nameTh: 'ภ.ง.ด.53 ค่าจ้าง (นิติบุคคล)', nameEn: 'WHT PND.53 (Juristic Person)', accountGroup: AccountGroup.LIABILITY, parentCode: '21-31XX', level: 3 },

  // กลุ่มเงินรับล่วงหน้า/รายจ่ายสรรพากร
  { code: '21-41XX', nameTh: 'กลุ่มเงินรับล่วงหน้า/รายจ่ายสรรพากร', nameEn: 'Advance Receipts / Revenue Dept.', accountGroup: AccountGroup.LIABILITY, parentCode: '21-0000', level: 2 },
  { code: '21-4201', nameTh: 'เงินรับล่วงหน้า', nameEn: 'Advance Receipts', accountGroup: AccountGroup.LIABILITY, parentCode: '21-41XX', level: 3 },
  { code: '21-4202', nameTh: 'เงินมัดจำรับ', nameEn: 'Deposits Received', accountGroup: AccountGroup.LIABILITY, parentCode: '21-41XX', level: 3 },

  // กลุ่มเจ้าหนี้อื่น
  { code: '21-51XX', nameTh: 'กลุ่มเจ้าหนี้อื่น', nameEn: 'Other Payables', accountGroup: AccountGroup.LIABILITY, parentCode: '21-0000', level: 2 },
  { code: '21-5101', nameTh: 'เงินเกินของลูกค้า', nameEn: 'Customer Credit Balance', accountGroup: AccountGroup.LIABILITY, parentCode: '21-51XX', level: 3 },

  // ── หนี้สินไม่หมุนเวียน ──
  { code: '22-0000', nameTh: 'หนี้สินไม่หมุนเวียน', nameEn: 'Non-Current Liabilities', accountGroup: AccountGroup.LIABILITY, level: 1 },
  { code: '22-1101', nameTh: 'เงินกู้ยืมระยะยาว', nameEn: 'Long-Term Loans', accountGroup: AccountGroup.LIABILITY, parentCode: '22-0000', level: 3 },

  // ════════════════════════════════════════════════════════════
  // หมวด 3: ส่วนของเจ้าของ (EQUITY)
  // ════════════════════════════════════════════════════════════
  { code: '31-0000', nameTh: 'ทุนที่ออกและชำระเต็มมูลค่าแล้ว', nameEn: 'Issued and Paid-up Capital', accountGroup: AccountGroup.EQUITY, level: 1 },
  { code: '31-1101', nameTh: 'ทุนสามัญ', nameEn: 'Common Stock', accountGroup: AccountGroup.EQUITY, parentCode: '31-0000', level: 2 },

  { code: '32-0000', nameTh: 'กำไร (ขาดทุน) สะสม', nameEn: 'Retained Earnings (Deficit)', accountGroup: AccountGroup.EQUITY, level: 1 },
  { code: '32-1001', nameTh: 'กำไร(ขาดทุน)สะสม', nameEn: 'Retained Earnings (Deficit)', accountGroup: AccountGroup.EQUITY, parentCode: '32-0000', level: 2 },

  // ════════════════════════════════════════════════════════════
  // หมวด 4: รายได้ (REVENUE)
  // ════════════════════════════════════════════════════════════

  // ── รายได้จากการขายและบริการ ──
  { code: '41-0000', nameTh: 'รายได้จากการขายและบริการ', nameEn: 'Sales and Service Revenue', accountGroup: AccountGroup.REVENUE, level: 1 },

  // กลุ่มรายได้จากการขาย
  { code: '41-11XX', nameTh: 'กลุ่มรายได้จากการขาย', nameEn: 'Sales Revenue', accountGroup: AccountGroup.REVENUE, parentCode: '41-0000', level: 2 },
  { code: '41-1101', nameTh: 'รายได้ มือถือ (ใหม่)', nameEn: 'Revenue - New Phones', accountGroup: AccountGroup.REVENUE, parentCode: '41-11XX', level: 3 },
  { code: '41-1102', nameTh: 'รายได้ มือสอง (มือสอง)', nameEn: 'Revenue - Used Phones', accountGroup: AccountGroup.REVENUE, parentCode: '41-11XX', level: 3 },
  { code: '41-1103', nameTh: 'รายได้จากขายผ่านไฟแนนซ์ภายนอก', nameEn: 'External Finance Sales Revenue', accountGroup: AccountGroup.REVENUE, parentCode: '41-11XX', level: 3 },

  // กลุ่มรายการปรับปรุงรายได้
  { code: '41-21XX', nameTh: 'กลุ่มรายการปรับปรุงรายได้', nameEn: 'Revenue Adjustments', accountGroup: AccountGroup.REVENUE, parentCode: '41-0000', level: 2 },
  { code: '41-2101', nameTh: '(หัก) ส่วนลดจ่าย', nameEn: 'Less: Sales Discounts', accountGroup: AccountGroup.REVENUE, parentCode: '41-21XX', level: 3 },

  // ── รายได้อื่น ──
  { code: '42-0000', nameTh: 'รายได้อื่น', nameEn: 'Other Income', accountGroup: AccountGroup.REVENUE, level: 1 },

  // กลุ่มรายได้ดอกเบี้ย/เครดิต
  { code: '42-11XX', nameTh: 'กลุ่มรายได้ดอกเบี้ย/เครดิต', nameEn: 'Interest and Credit Income', accountGroup: AccountGroup.REVENUE, parentCode: '42-0000', level: 2 },
  { code: '42-1101', nameTh: 'รายได้ดอกเบี้ยเช่าซื้อ', nameEn: 'Interest Income on Hire Purchase', accountGroup: AccountGroup.REVENUE, parentCode: '42-11XX', level: 3, allowedCompanies: ['FINANCE'] },
  { code: '42-1102', nameTh: 'ค่างวดเบี้ยปรับล่าช้า', nameEn: 'Late Payment Penalty Income', accountGroup: AccountGroup.REVENUE, parentCode: '42-11XX', level: 3, allowedCompanies: ['FINANCE'] },
  { code: '42-1103', nameTh: 'ค่ามัดจำ/เงินประกันที่ริบ', nameEn: 'Forfeited Deposits/Guarantees', accountGroup: AccountGroup.REVENUE, parentCode: '42-11XX', level: 3, allowedCompanies: ['FINANCE'] },
  { code: '42-1104', nameTh: 'รายได้จากการยึดเครื่อง', nameEn: 'Repossession Income', accountGroup: AccountGroup.REVENUE, parentCode: '42-11XX', level: 3, allowedCompanies: ['FINANCE'] },
  { code: '42-1105', nameTh: 'รายได้ค่านายหน้า/คอมมิชชัน', nameEn: 'Commission Income', accountGroup: AccountGroup.REVENUE, parentCode: '42-11XX', level: 3, allowedCompanies: ['SHOP'] },

  // ════════════════════════════════════════════════════════════
  // หมวด 5: ค่าใช้จ่าย (EXPENSE)
  // ════════════════════════════════════════════════════════════

  // ── ต้นทุนขาย ──
  { code: '51-0000', nameTh: 'ต้นทุนขาย', nameEn: 'Cost of Goods Sold', accountGroup: AccountGroup.EXPENSE, level: 1 },
  { code: '51-1101', nameTh: 'ต้นทุนมือถือ (ใหม่)', nameEn: 'COGS - New Phones', accountGroup: AccountGroup.EXPENSE, parentCode: '51-0000', level: 3 },
  { code: '51-1102', nameTh: 'ต้นทุนมือถือ (มือสอง)', nameEn: 'COGS - Used Phones', accountGroup: AccountGroup.EXPENSE, parentCode: '51-0000', level: 3 },

  // ── ค่าใช้จ่ายในการขาย ──
  { code: '52-0000', nameTh: 'ค่าใช้จ่ายในการขาย', nameEn: 'Selling Expenses', accountGroup: AccountGroup.EXPENSE, level: 1 },
  { code: '52-1101', nameTh: 'ค่าคอมมิชชั่น/นาย', nameEn: 'Sales Commission', accountGroup: AccountGroup.EXPENSE, parentCode: '52-0000', level: 3 },
  { code: '52-1102', nameTh: 'ค่าส่งเสริมการขาย', nameEn: 'Sales Promotion', accountGroup: AccountGroup.EXPENSE, parentCode: '52-0000', level: 3 },
  { code: '52-1103', nameTh: 'ค่าบริการส่ง SMS', nameEn: 'SMS Service', accountGroup: AccountGroup.EXPENSE, parentCode: '52-0000', level: 3 },
  { code: '52-1104', nameTh: 'ส่วนลดไม่จ่ายเนตศาสตร์', nameEn: 'Unclaimed Discount', accountGroup: AccountGroup.EXPENSE, parentCode: '52-0000', level: 3 },

  // ── ค่าใช้จ่ายในการบริหาร ──
  { code: '53-0000', nameTh: 'ค่าใช้จ่ายในการบริหาร', nameEn: 'Administrative Expenses', accountGroup: AccountGroup.EXPENSE, level: 1 },
  { code: '53-0102', nameTh: 'โบนัส', nameEn: 'Bonus', accountGroup: AccountGroup.EXPENSE, parentCode: '53-0000', level: 3 },
  { code: '53-0116', nameTh: 'ค่าสวัสดิการ', nameEn: 'Welfare', accountGroup: AccountGroup.EXPENSE, parentCode: '53-0000', level: 3 },
  { code: '53-0509', nameTh: 'ค่ากรรมสิทธิ์', nameEn: 'Proprietary Fee', accountGroup: AccountGroup.EXPENSE, parentCode: '53-0000', level: 3 },

  // กลุ่มค่าใช้จ่ายบุคลากร
  { code: '53-11XX', nameTh: 'กลุ่มค่าใช้จ่ายบุคลากร', nameEn: 'Personnel Expenses', accountGroup: AccountGroup.EXPENSE, parentCode: '53-0000', level: 2 },
  { code: '53-1101', nameTh: 'เงินเดือน ค่าจ้าง', nameEn: 'Salaries and Wages', accountGroup: AccountGroup.EXPENSE, parentCode: '53-11XX', level: 3 },
  { code: '53-1102', nameTh: 'ค่าคอมมิชชั่น พนักงาน', nameEn: 'Employee Commission', accountGroup: AccountGroup.EXPENSE, parentCode: '53-11XX', level: 3 },
  { code: '53-1103', nameTh: 'เงินสมทบประกันสังคม กองทุนเงินทดแทน', nameEn: 'Social Security and Compensation Fund', accountGroup: AccountGroup.EXPENSE, parentCode: '53-11XX', level: 3 },
  { code: '53-1104', nameTh: 'ค่าอบรม สัมมนา', nameEn: 'Training and Seminar', accountGroup: AccountGroup.EXPENSE, parentCode: '53-11XX', level: 3 },

  // กลุ่มวัสดุสิ้นเปลืองและอุปกรณ์
  { code: '53-12XX', nameTh: 'กลุ่มวัสดุสิ้นเปลืองและอุปกรณ์', nameEn: 'Consumables and Supplies', accountGroup: AccountGroup.EXPENSE, parentCode: '53-0000', level: 2 },
  { code: '53-1201', nameTh: 'ค่าเครื่องเขียน วัสดุสำนักงาน', nameEn: 'Stationery and Office Supplies', accountGroup: AccountGroup.EXPENSE, parentCode: '53-12XX', level: 3 },
  { code: '53-1202', nameTh: 'ค่าเครื่องเขียนแบบพิมพ์', nameEn: 'Printed Stationery', accountGroup: AccountGroup.EXPENSE, parentCode: '53-12XX', level: 3 },

  // กลุ่มสถานที่/สาธารณูปโภค
  { code: '53-13XX', nameTh: 'กลุ่มสถานที่/สาธารณูปโภค', nameEn: 'Premises and Utilities', accountGroup: AccountGroup.EXPENSE, parentCode: '53-0000', level: 2 },
  { code: '53-1301', nameTh: 'ค่าน้ำ', nameEn: 'Water', accountGroup: AccountGroup.EXPENSE, parentCode: '53-13XX', level: 3 },
  { code: '53-1302', nameTh: 'ค่าไฟฟ้า', nameEn: 'Electricity', accountGroup: AccountGroup.EXPENSE, parentCode: '53-13XX', level: 3 },
  { code: '53-1303', nameTh: 'ค่าโทรศัพท์สำนักงาน', nameEn: 'Telephone/Internet', accountGroup: AccountGroup.EXPENSE, parentCode: '53-13XX', level: 3 },
  { code: '53-1304', nameTh: 'ค่าไปรษณีย์ และขนส่ง', nameEn: 'Postage and Delivery', accountGroup: AccountGroup.EXPENSE, parentCode: '53-13XX', level: 3 },
  { code: '53-1305', nameTh: 'ค่าซ่อมแซม', nameEn: 'Repairs and Maintenance', accountGroup: AccountGroup.EXPENSE, parentCode: '53-13XX', level: 3 },

  // กลุ่มค่าจ้างบริการวิชาชีพ
  { code: '53-14XX', nameTh: 'กลุ่มค่าจ้างบริการวิชาชีพ', nameEn: 'Professional Service Fees', accountGroup: AccountGroup.EXPENSE, parentCode: '53-0000', level: 2 },
  { code: '53-1401', nameTh: 'ค่าบริการ AI', nameEn: 'AI Service', accountGroup: AccountGroup.EXPENSE, parentCode: '53-14XX', level: 3 },
  { code: '53-1402', nameTh: 'ค่าจ้างเขียนโปรแกรม', nameEn: 'Software Development', accountGroup: AccountGroup.EXPENSE, parentCode: '53-14XX', level: 3 },
  { code: '53-1403', nameTh: 'ค่าบริการทำบัญชี', nameEn: 'Accounting Service', accountGroup: AccountGroup.EXPENSE, parentCode: '53-14XX', level: 3 },
  { code: '53-1404', nameTh: 'ค่าบริการที่ปรึกษากฎหมาย', nameEn: 'Legal Advisory Service', accountGroup: AccountGroup.EXPENSE, parentCode: '53-14XX', level: 3 },
  { code: '53-1405', nameTh: 'ค่าบริการอื่น', nameEn: 'Other Services', accountGroup: AccountGroup.EXPENSE, parentCode: '53-14XX', level: 3 },

  // กลุ่มค่าธรรมเนียม/ค่าใช้จ่ายทางการเงิน
  { code: '53-15XX', nameTh: 'กลุ่มค่าธรรมเนียม/ค่าใช้จ่ายทางการเงิน', nameEn: 'Financial Fees and Charges', accountGroup: AccountGroup.EXPENSE, parentCode: '53-0000', level: 2 },
  { code: '53-1501', nameTh: 'ค่าธรรมเนียมธนาคาร', nameEn: 'Bank Charges', accountGroup: AccountGroup.EXPENSE, parentCode: '53-15XX', level: 3 },
  { code: '53-1502', nameTh: 'ค่าธรรมเนียมอื่น', nameEn: 'Other Fees', accountGroup: AccountGroup.EXPENSE, parentCode: '53-15XX', level: 3 },
  { code: '53-1503', nameTh: 'ขาดทุน(กำไร)จากการปิดสัญญา', nameEn: 'Loss (Gain) on Contract Closure', accountGroup: AccountGroup.EXPENSE, parentCode: '53-15XX', level: 3 },

  // กลุ่มค่าเสื่อมราคา
  { code: '53-16XX', nameTh: 'กลุ่มค่าเสื่อมราคา', nameEn: 'Depreciation', accountGroup: AccountGroup.EXPENSE, parentCode: '53-0000', level: 2 },
  { code: '53-1601', nameTh: 'ค่าเสื่อมราคา - อุปกรณ์สำนักงาน', nameEn: 'Depreciation - Office Equipment', accountGroup: AccountGroup.EXPENSE, parentCode: '53-16XX', level: 3 },
  { code: '53-1602', nameTh: 'ค่าเสื่อมราคา - ส่วนปรับปรุงอาคาร', nameEn: 'Depreciation - Leasehold Improvements', accountGroup: AccountGroup.EXPENSE, parentCode: '53-16XX', level: 3 },
  { code: '53-1603', nameTh: 'ค่าเสื่อมราคา - เครื่องตกแต่ง', nameEn: 'Depreciation - Furniture and Fixtures', accountGroup: AccountGroup.EXPENSE, parentCode: '53-16XX', level: 3 },
  { code: '53-1604', nameTh: 'ค่าเสื่อมราคา - ยานพาหนะ', nameEn: 'Depreciation - Vehicles', accountGroup: AccountGroup.EXPENSE, parentCode: '53-16XX', level: 3 },

  // ── ค่าใช้จ่ายอื่น / รายจ่ายต้องห้ามทางภาษี ──
  { code: '54-0000', nameTh: 'ค่าใช้จ่ายอื่น / รายจ่ายต้องห้ามทางภาษี', nameEn: 'Other Expenses / Non-Deductible Expenses', accountGroup: AccountGroup.EXPENSE, level: 1 },
  { code: '54-1101', nameTh: 'ภงด.ทางภาษี ภ.ง.ด.3', nameEn: 'Tax Expense - PND.3', accountGroup: AccountGroup.EXPENSE, parentCode: '54-0000', level: 3 },
  { code: '54-1102', nameTh: 'ภงด.ทางภาษี ภ.ง.ด.53', nameEn: 'Tax Expense - PND.53', accountGroup: AccountGroup.EXPENSE, parentCode: '54-0000', level: 3 },
  { code: '54-1103', nameTh: 'ภงด.ทางภาษี ภ.พ.30', nameEn: 'Tax Expense - PP.30', accountGroup: AccountGroup.EXPENSE, parentCode: '54-0000', level: 3 },
  { code: '54-1104', nameTh: 'เบี้ยปรับเงินเพิ่ม', nameEn: 'Surcharges and Penalties', accountGroup: AccountGroup.EXPENSE, parentCode: '54-0000', level: 3 },
];

export async function seedChartOfAccounts(prisma: PrismaClient): Promise<void> {
  console.log('Seeding Chart of Accounts (ผังบัญชี)...');

  for (const account of CHART_OF_ACCOUNTS) {
    await prisma.chartOfAccount.upsert({
      where: { code: account.code },
      update: {
        nameTh: account.nameTh,
        nameEn: account.nameEn,
        accountGroup: account.accountGroup,
        parentCode: account.parentCode,
        level: account.level,
        isActive: true,
        allowedCompanies: account.allowedCompanies ?? [],
        peakAccountCode: account.peakAccountCode ?? account.code,
      },
      create: {
        code: account.code,
        nameTh: account.nameTh,
        nameEn: account.nameEn ?? undefined,
        accountGroup: account.accountGroup,
        parentCode: account.parentCode ?? undefined,
        level: account.level,
        isActive: true,
        allowedCompanies: account.allowedCompanies ?? [],
        peakAccountCode: account.peakAccountCode ?? account.code,
      },
    });
  }

  console.log(`  ✓ Chart of Accounts: ${CHART_OF_ACCOUNTS.length} accounts seeded`);
}
