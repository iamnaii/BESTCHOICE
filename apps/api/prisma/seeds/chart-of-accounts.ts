import { PrismaClient, AccountGroup } from '@prisma/client';

interface ChartOfAccountSeed {
  code: string;
  nameTh: string;
  nameEn?: string;
  accountGroup: AccountGroup;
  parentCode?: string;
  level: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CHART_OF_ACCOUNTS: ChartOfAccountSeed[] = [
  // ════════════════════════════════════════════════════════════
  // 1xxx สินทรัพย์ (ASSET)
  // ════════════════════════════════════════════════════════════
  { code: '1000', nameTh: 'สินทรัพย์', nameEn: 'Assets', accountGroup: AccountGroup.ASSET, level: 1 },

  // 1100 เงินสดและเงินฝากธนาคาร
  { code: '1100', nameTh: 'เงินสดและเงินฝากธนาคาร', nameEn: 'Cash and Bank Deposits', accountGroup: AccountGroup.ASSET, parentCode: '1000', level: 2 },
  { code: '1110', nameTh: 'เงินสด', nameEn: 'Cash on Hand', accountGroup: AccountGroup.ASSET, parentCode: '1100', level: 3 },
  { code: '1120', nameTh: 'เงินฝากธนาคาร', nameEn: 'Bank Deposits', accountGroup: AccountGroup.ASSET, parentCode: '1100', level: 3 },

  // 1200 ลูกหนี้การค้า
  { code: '1200', nameTh: 'ลูกหนี้การค้า', nameEn: 'Accounts Receivable', accountGroup: AccountGroup.ASSET, parentCode: '1000', level: 2 },
  { code: '1210', nameTh: 'ลูกหนี้การค้า - เงินสด', nameEn: 'Accounts Receivable - Cash Sales', accountGroup: AccountGroup.ASSET, parentCode: '1200', level: 3 },
  { code: '1220', nameTh: 'ลูกหนี้เช่าซื้อ', nameEn: 'Hire-Purchase Receivable', accountGroup: AccountGroup.ASSET, parentCode: '1200', level: 3 },
  { code: '1229', nameTh: 'หัก: ค่าเผื่อหนี้สงสัยจะสูญ', nameEn: 'Less: Allowance for Doubtful Accounts', accountGroup: AccountGroup.ASSET, parentCode: '1200', level: 3 },
  { code: '1230', nameTh: 'ลูกหนี้ไฟแนนซ์ภายนอก', nameEn: 'External Finance Receivable', accountGroup: AccountGroup.ASSET, parentCode: '1200', level: 3 },

  // 1300 สินค้าคงเหลือ
  { code: '1300', nameTh: 'สินค้าคงเหลือ', nameEn: 'Inventory', accountGroup: AccountGroup.ASSET, parentCode: '1000', level: 2 },
  { code: '1310', nameTh: 'สินค้าสำเร็จรูป (มือถือใหม่)', nameEn: 'Finished Goods (New Phones)', accountGroup: AccountGroup.ASSET, parentCode: '1300', level: 3 },
  { code: '1320', nameTh: 'สินค้ามือสอง', nameEn: 'Used Goods', accountGroup: AccountGroup.ASSET, parentCode: '1300', level: 3 },
  { code: '1330', nameTh: 'สินค้ายึดคืน/ซ่อมแล้ว', nameEn: 'Repossessed/Refurbished Goods', accountGroup: AccountGroup.ASSET, parentCode: '1300', level: 3 },

  // 1400 ภาษีซื้อ
  { code: '1400', nameTh: 'ภาษีซื้อ', nameEn: 'Input VAT', accountGroup: AccountGroup.ASSET, parentCode: '1000', level: 2 },
  { code: '1410', nameTh: 'ภาษีซื้อ', nameEn: 'Input VAT', accountGroup: AccountGroup.ASSET, parentCode: '1400', level: 3 },
  { code: '1420', nameTh: 'ภาษีซื้อรอเคลม', nameEn: 'Input VAT Pending Claim', accountGroup: AccountGroup.ASSET, parentCode: '1400', level: 3 },

  // 1500 สินทรัพย์หมุนเวียนอื่น
  { code: '1500', nameTh: 'สินทรัพย์หมุนเวียนอื่น', nameEn: 'Other Current Assets', accountGroup: AccountGroup.ASSET, parentCode: '1000', level: 2 },
  { code: '1510', nameTh: 'เงินมัดจำ', nameEn: 'Deposits', accountGroup: AccountGroup.ASSET, parentCode: '1500', level: 3 },
  { code: '1520', nameTh: 'ค่าใช้จ่ายจ่ายล่วงหน้า', nameEn: 'Prepaid Expenses', accountGroup: AccountGroup.ASSET, parentCode: '1500', level: 3 },

  // 1600 ดอกเบี้ยรอรับรู้
  { code: '1600', nameTh: 'ดอกเบี้ยรอรับรู้', nameEn: 'Unearned Interest Receivable', accountGroup: AccountGroup.ASSET, parentCode: '1000', level: 2 },

  // ════════════════════════════════════════════════════════════
  // 2xxx หนี้สิน (LIABILITY)
  // ════════════════════════════════════════════════════════════
  { code: '2000', nameTh: 'หนี้สิน', nameEn: 'Liabilities', accountGroup: AccountGroup.LIABILITY, level: 1 },

  { code: '2100', nameTh: 'เจ้าหนี้การค้า', nameEn: 'Accounts Payable', accountGroup: AccountGroup.LIABILITY, parentCode: '2000', level: 2 },

  // 2200 ภาษีขาย
  { code: '2200', nameTh: 'ภาษีขาย', nameEn: 'Output VAT', accountGroup: AccountGroup.LIABILITY, parentCode: '2000', level: 2 },
  { code: '2210', nameTh: 'ภาษีขาย', nameEn: 'Output VAT', accountGroup: AccountGroup.LIABILITY, parentCode: '2200', level: 3 },
  { code: '2220', nameTh: 'ภาษีมูลค่าเพิ่มค้างจ่าย', nameEn: 'VAT Payable', accountGroup: AccountGroup.LIABILITY, parentCode: '2200', level: 3 },

  { code: '2300', nameTh: 'ภาษีหัก ณ ที่จ่ายค้างจ่าย', nameEn: 'Withholding Tax Payable', accountGroup: AccountGroup.LIABILITY, parentCode: '2000', level: 2 },

  { code: '2400', nameTh: 'เงินรับล่วงหน้า / เงินมัดจำรับ', nameEn: 'Advance Receipts / Deposits Received', accountGroup: AccountGroup.LIABILITY, parentCode: '2000', level: 2 },

  // 2500 เจ้าหนี้อื่น
  { code: '2500', nameTh: 'เจ้าหนี้อื่น', nameEn: 'Other Payables', accountGroup: AccountGroup.LIABILITY, parentCode: '2000', level: 2 },
  { code: '2510', nameTh: 'เงินเกินของลูกค้า', nameEn: 'Customer Credit Balance', accountGroup: AccountGroup.LIABILITY, parentCode: '2500', level: 3 },

  { code: '2600', nameTh: 'ค่าใช้จ่ายค้างจ่าย', nameEn: 'Accrued Expenses', accountGroup: AccountGroup.LIABILITY, parentCode: '2000', level: 2 },

  // ════════════════════════════════════════════════════════════
  // 3xxx ส่วนของเจ้าของ (EQUITY)
  // ════════════════════════════════════════════════════════════
  { code: '3000', nameTh: 'ส่วนของเจ้าของ', nameEn: 'Equity', accountGroup: AccountGroup.EQUITY, level: 1 },
  { code: '3100', nameTh: 'ทุนจดทะเบียน', nameEn: 'Registered Capital', accountGroup: AccountGroup.EQUITY, parentCode: '3000', level: 2 },
  { code: '3200', nameTh: 'กำไร(ขาดทุน)สะสม', nameEn: 'Retained Earnings (Deficit)', accountGroup: AccountGroup.EQUITY, parentCode: '3000', level: 2 },
  { code: '3300', nameTh: 'กำไร(ขาดทุน)สุทธิประจำปี', nameEn: 'Net Income (Loss) for the Year', accountGroup: AccountGroup.EQUITY, parentCode: '3000', level: 2 },

  // ════════════════════════════════════════════════════════════
  // 4xxx รายได้ (REVENUE)
  // ════════════════════════════════════════════════════════════
  { code: '4000', nameTh: 'รายได้', nameEn: 'Revenue', accountGroup: AccountGroup.REVENUE, level: 1 },

  // 4100 รายได้จากการขาย
  { code: '4100', nameTh: 'รายได้จากการขาย', nameEn: 'Sales Revenue', accountGroup: AccountGroup.REVENUE, parentCode: '4000', level: 2 },
  { code: '4110', nameTh: 'รายได้จากการขายเงินสด', nameEn: 'Cash Sales Revenue', accountGroup: AccountGroup.REVENUE, parentCode: '4100', level: 3 },
  { code: '4120', nameTh: 'รายได้จากการขายผ่อนชำระ', nameEn: 'Installment Sales Revenue', accountGroup: AccountGroup.REVENUE, parentCode: '4100', level: 3 },
  { code: '4130', nameTh: 'รายได้จากขายผ่านไฟแนนซ์ภายนอก', nameEn: 'External Finance Sales Revenue', accountGroup: AccountGroup.REVENUE, parentCode: '4100', level: 3 },
  { code: '4140', nameTh: 'รายได้จากขายสินค้ามือสอง', nameEn: 'Used Goods Sales Revenue', accountGroup: AccountGroup.REVENUE, parentCode: '4100', level: 3 },
  { code: '4199', nameTh: 'หัก: ส่วนลดจ่าย', nameEn: 'Less: Sales Discounts', accountGroup: AccountGroup.REVENUE, parentCode: '4100', level: 3 },

  // 4200 รายได้ดอกเบี้ย
  { code: '4200', nameTh: 'รายได้ดอกเบี้ย', nameEn: 'Interest Income', accountGroup: AccountGroup.REVENUE, parentCode: '4000', level: 2 },
  { code: '4210', nameTh: 'รายได้ดอกเบี้ยเช่าซื้อ', nameEn: 'Hire-Purchase Interest Income', accountGroup: AccountGroup.REVENUE, parentCode: '4200', level: 3 },

  { code: '4300', nameTh: 'รายได้ค่าปรับล่าช้า', nameEn: 'Late Payment Penalty Income', accountGroup: AccountGroup.REVENUE, parentCode: '4000', level: 2 },
  { code: '4400', nameTh: 'รายได้ค่านายหน้า', nameEn: 'Commission Income', accountGroup: AccountGroup.REVENUE, parentCode: '4000', level: 2 },
  { code: '4500', nameTh: 'รายได้อื่น', nameEn: 'Other Income', accountGroup: AccountGroup.REVENUE, parentCode: '4000', level: 2 },

  // ════════════════════════════════════════════════════════════
  // 5xxx ค่าใช้จ่าย (EXPENSE)
  // ════════════════════════════════════════════════════════════
  { code: '5000', nameTh: 'ค่าใช้จ่าย', nameEn: 'Expenses', accountGroup: AccountGroup.EXPENSE, level: 1 },

  // 5100 ต้นทุนขาย
  { code: '5100', nameTh: 'ต้นทุนขาย', nameEn: 'Cost of Goods Sold', accountGroup: AccountGroup.EXPENSE, parentCode: '5000', level: 2 },
  { code: '5101', nameTh: 'ต้นทุนสินค้า', nameEn: 'Cost of Products', accountGroup: AccountGroup.EXPENSE, parentCode: '5100', level: 3 },
  { code: '5102', nameTh: 'ต้นทุนอะไหล่ซ่อม', nameEn: 'Cost of Repair Parts', accountGroup: AccountGroup.EXPENSE, parentCode: '5100', level: 3 },

  // 5200 ค่าใช้จ่ายในการขาย
  { code: '5200', nameTh: 'ค่าใช้จ่ายในการขาย', nameEn: 'Selling Expenses', accountGroup: AccountGroup.EXPENSE, parentCode: '5000', level: 2 },
  { code: '5201', nameTh: 'ค่าคอมมิชชั่นการขาย', nameEn: 'Sales Commission', accountGroup: AccountGroup.EXPENSE, parentCode: '5200', level: 3 },
  { code: '5202', nameTh: 'ค่าโฆษณา', nameEn: 'Advertising Expense', accountGroup: AccountGroup.EXPENSE, parentCode: '5200', level: 3 },
  { code: '5203', nameTh: 'ค่าขนส่ง', nameEn: 'Transportation Expense', accountGroup: AccountGroup.EXPENSE, parentCode: '5200', level: 3 },
  { code: '5204', nameTh: 'ค่าบรรจุภัณฑ์', nameEn: 'Packaging Expense', accountGroup: AccountGroup.EXPENSE, parentCode: '5200', level: 3 },

  // 5300 ค่าใช้จ่ายในการบริหาร
  { code: '5300', nameTh: 'ค่าใช้จ่ายในการบริหาร', nameEn: 'Administrative Expenses', accountGroup: AccountGroup.EXPENSE, parentCode: '5000', level: 2 },
  { code: '5301', nameTh: 'เงินเดือนและค่าจ้าง', nameEn: 'Salaries and Wages', accountGroup: AccountGroup.EXPENSE, parentCode: '5300', level: 3 },
  { code: '5302', nameTh: 'ประกันสังคม', nameEn: 'Social Security', accountGroup: AccountGroup.EXPENSE, parentCode: '5300', level: 3 },
  { code: '5303', nameTh: 'ค่าเช่าสำนักงาน', nameEn: 'Office Rent', accountGroup: AccountGroup.EXPENSE, parentCode: '5300', level: 3 },
  { code: '5304', nameTh: 'ค่าน้ำ/ค่าไฟ', nameEn: 'Utilities', accountGroup: AccountGroup.EXPENSE, parentCode: '5300', level: 3 },
  { code: '5305', nameTh: 'วัสดุสำนักงาน', nameEn: 'Office Supplies', accountGroup: AccountGroup.EXPENSE, parentCode: '5300', level: 3 },
  { code: '5306', nameTh: 'ค่าเสื่อมราคา', nameEn: 'Depreciation', accountGroup: AccountGroup.EXPENSE, parentCode: '5300', level: 3 },
  { code: '5307', nameTh: 'ค่าประกันภัย', nameEn: 'Insurance', accountGroup: AccountGroup.EXPENSE, parentCode: '5300', level: 3 },
  { code: '5308', nameTh: 'ค่าภาษีอากร', nameEn: 'Taxes and Fees', accountGroup: AccountGroup.EXPENSE, parentCode: '5300', level: 3 },
  { code: '5309', nameTh: 'ค่าซ่อมแซมบำรุงรักษา', nameEn: 'Repairs and Maintenance', accountGroup: AccountGroup.EXPENSE, parentCode: '5300', level: 3 },
  { code: '5310', nameTh: 'ค่าเดินทาง', nameEn: 'Travel Expense', accountGroup: AccountGroup.EXPENSE, parentCode: '5300', level: 3 },
  { code: '5311', nameTh: 'ค่าโทรศัพท์/อินเทอร์เน็ต', nameEn: 'Telephone/Internet', accountGroup: AccountGroup.EXPENSE, parentCode: '5300', level: 3 },

  // 5800 หนี้สูญและค่าเผื่อหนี้สงสัยจะสูญ
  { code: '5800', nameTh: 'หนี้สูญและค่าเผื่อหนี้สงสัยจะสูญ', nameEn: 'Bad Debts and Allowance for Doubtful Accounts', accountGroup: AccountGroup.EXPENSE, parentCode: '5000', level: 2 },
  { code: '5810', nameTh: 'หนี้สูญ', nameEn: 'Bad Debts', accountGroup: AccountGroup.EXPENSE, parentCode: '5800', level: 3 },
  { code: '5820', nameTh: 'ค่าเผื่อหนี้สงสัยจะสูญ', nameEn: 'Allowance for Doubtful Accounts', accountGroup: AccountGroup.EXPENSE, parentCode: '5800', level: 3 },

  // 5900 ค่าใช้จ่ายอื่น
  { code: '5900', nameTh: 'ค่าใช้จ่ายอื่น', nameEn: 'Other Expenses', accountGroup: AccountGroup.EXPENSE, parentCode: '5000', level: 2 },
  { code: '5901', nameTh: 'ดอกเบี้ยจ่าย', nameEn: 'Interest Expense', accountGroup: AccountGroup.EXPENSE, parentCode: '5900', level: 3 },
  { code: '5902', nameTh: 'ขาดทุนจากการจำหน่ายสินทรัพย์', nameEn: 'Loss on Disposal of Assets', accountGroup: AccountGroup.EXPENSE, parentCode: '5900', level: 3 },
  { code: '5903', nameTh: 'ค่าปรับ', nameEn: 'Fines and Penalties', accountGroup: AccountGroup.EXPENSE, parentCode: '5900', level: 3 },
  { code: '5999', nameTh: 'ค่าใช้จ่ายเบ็ดเตล็ด', nameEn: 'Miscellaneous Expenses', accountGroup: AccountGroup.EXPENSE, parentCode: '5900', level: 3 },
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
      },
      create: {
        code: account.code,
        nameTh: account.nameTh,
        nameEn: account.nameEn ?? undefined,
        accountGroup: account.accountGroup,
        parentCode: account.parentCode ?? undefined,
        level: account.level,
        isActive: true,
      },
    });
  }

  console.log(`  ✓ Chart of Accounts: ${CHART_OF_ACCOUNTS.length} accounts seeded`);
}
