import { PrismaClient, AccountGroup } from '@prisma/client';

interface FinanceAccount {
  code: string;
  nameTh: string;
  nameEn: string;
  accountGroup: AccountGroup;
  parentCode?: string;
  level: number;
}

const FINANCE_ACCOUNTS: FinanceAccount[] = [
  // ─── 11-XXXX สินทรัพย์หมุนเวียน (12) — includes 2 new INVENTORY accounts ───
  { code: '11-1101', nameTh: 'เงินสด FINANCE', nameEn: 'Cash on Hand FINANCE', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-1201', nameTh: 'ธนาคาร FINANCE — บัญชีหลัก', nameEn: 'Bank — FINANCE Main', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-1202', nameTh: 'ธนาคาร FINANCE — รับชำระค่างวด', nameEn: 'Bank — Installment Collection', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-2102', nameTh: 'ลูกหนี้เช่าซื้อ', nameEn: 'Hire-Purchase Receivable', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-2103', nameTh: 'หัก: ค่าเผื่อหนี้สงสัยจะสูญ', nameEn: 'Less: Allowance for Doubtful Accounts', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-2104', nameTh: 'ลูกหนี้ไฟแนนซ์ภายนอก', nameEn: 'External Finance Receivable', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-3103', nameTh: 'สินค้ายึดคืน/ซ่อมแล้ว', nameEn: 'Repossessed/Refurbished Goods', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-3104', nameTh: 'สินค้าคงเหลือ FINANCE — เครื่องใหม่', nameEn: 'Inventory FINANCE New', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-3105', nameTh: 'สินค้าคงเหลือ FINANCE — มือสอง', nameEn: 'Inventory FINANCE Used', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-4101', nameTh: 'ภาษีซื้อ', nameEn: 'Input VAT', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-4102', nameTh: 'ภาษีซื้อยังไม่ถึงกำหนด', nameEn: 'Input VAT Pending', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-4103', nameTh: 'ภาษีถูกหัก ณ ที่จ่าย', nameEn: 'Withholding Tax Receivable', accountGroup: AccountGroup.ASSET, level: 3 },

  // ─── 21-XXXX หนี้สินหมุนเวียน (10) ───
  { code: '21-1102', nameTh: 'เจ้าหนี้คู่ค้า — SHOP (Due-to-SHOP)', nameEn: 'Inter-company Payable — SHOP', accountGroup: AccountGroup.LIABILITY, level: 3 },
  { code: '21-2101', nameTh: 'ภาษีขาย ภ.พ.30', nameEn: 'Output VAT (PP.30)', accountGroup: AccountGroup.LIABILITY, level: 3 },
  { code: '21-2102', nameTh: 'ภาษีขายรอเรียกเก็บ', nameEn: 'Output VAT Pending Invoice', accountGroup: AccountGroup.LIABILITY, level: 3 },
  { code: '21-2103', nameTh: 'ภ.พ.36 ค้างจ่าย', nameEn: 'PP.36 Payable', accountGroup: AccountGroup.LIABILITY, level: 3 },
  { code: '21-2104', nameTh: 'ภาษีขายดอกเบี้ยรอตัดบัญชี [DEFERRED CR-001]', nameEn: 'Deferred VAT on Interest', accountGroup: AccountGroup.LIABILITY, level: 3 },
  { code: '21-2202', nameTh: 'รายได้ดอกเบี้ยรอตัดบัญชี [DEFERRED W-003]', nameEn: 'Unearned Interest Income', accountGroup: AccountGroup.LIABILITY, level: 3 },
  { code: '21-3201', nameTh: 'เจ้าหนี้สรรพากร ภ.พ.30 รอชำระ', nameEn: 'VAT Payable to RD', accountGroup: AccountGroup.LIABILITY, level: 3 },
  { code: '21-3202', nameTh: 'เจ้าหนี้สรรพากร ภ.ง.ด.53 รอชำระ', nameEn: 'PND.53 Payable to RD', accountGroup: AccountGroup.LIABILITY, level: 3 },
  { code: '21-4201', nameTh: 'เงินรับล่วงหน้า', nameEn: 'Advance Receipts', accountGroup: AccountGroup.LIABILITY, level: 3 },
  { code: '21-5101', nameTh: 'เงินเกินของลูกค้า', nameEn: 'Customer Credit Balance', accountGroup: AccountGroup.LIABILITY, level: 3 },

  // ─── 31/32-XXXX ส่วนของผู้ถือหุ้น (2) ───
  { code: '31-1101', nameTh: 'ทุนสามัญ FINANCE', nameEn: 'Common Stock FINANCE', accountGroup: AccountGroup.EQUITY, level: 3 },
  { code: '32-1101', nameTh: 'กำไร(ขาดทุน)สะสม FINANCE', nameEn: 'Retained Earnings FINANCE', accountGroup: AccountGroup.EQUITY, level: 3 },

  // ─── 41-XXXX รายได้จากการขาย (2) — added for FINANCE-side contract activation ───
  { code: '41-2101', nameTh: 'รายได้ขายเช่าซื้อ FINANCE', nameEn: 'HP Sales Revenue FINANCE', accountGroup: AccountGroup.REVENUE, level: 3 },
  { code: '41-2102', nameTh: 'รายได้ขายเช่าซื้อมือสอง FINANCE', nameEn: 'HP Used Sales Revenue FINANCE', accountGroup: AccountGroup.REVENUE, level: 3 },

  // ─── 42-XXXX รายได้อื่น (5) ───
  { code: '42-2101', nameTh: 'รายได้ดอกเบี้ยเช่าซื้อ', nameEn: 'Hire-Purchase Interest Income', accountGroup: AccountGroup.REVENUE, level: 3 },
  { code: '42-2102', nameTh: 'ค่างวดเบี้ยปรับล่าช้า', nameEn: 'Late Payment Penalty Income', accountGroup: AccountGroup.REVENUE, level: 3 },
  { code: '42-2103', nameTh: 'ค่ามัดจำ/เงินประกันที่ริบ', nameEn: 'Forfeited Deposits', accountGroup: AccountGroup.REVENUE, level: 3 },
  { code: '42-2104', nameTh: 'รายได้จากการยึดเครื่อง', nameEn: 'Repossession Income', accountGroup: AccountGroup.REVENUE, level: 3 },
  { code: '42-2105', nameTh: 'รายได้ค่าคอมมิชชันจาก SHOP [A.1b]', nameEn: 'Commission Income from SHOP', accountGroup: AccountGroup.REVENUE, level: 3 },

  // ─── 51-XXXX ต้นทุนขาย (2) — added for FINANCE-side contract activation ───
  { code: '51-2101', nameTh: 'ต้นทุนขายเช่าซื้อ FINANCE — เครื่องใหม่', nameEn: 'COGS FINANCE New', accountGroup: AccountGroup.EXPENSE, level: 3 },
  { code: '51-2102', nameTh: 'ต้นทุนขายเช่าซื้อ FINANCE — มือสอง', nameEn: 'COGS FINANCE Used', accountGroup: AccountGroup.EXPENSE, level: 3 },

  // ─── 53-XXXX ค่าใช้จ่าย (6) ───
  { code: '53-1701', nameTh: 'หนี้สูญ', nameEn: 'Bad Debt Expense', accountGroup: AccountGroup.EXPENSE, level: 3 },
  { code: '53-1702', nameTh: 'หนี้สงสัยจะสูญ', nameEn: 'Doubtful Debt Expense', accountGroup: AccountGroup.EXPENSE, level: 3 },
  { code: '53-1801', nameTh: 'ค่านายหน้าจ่าย SHOP [A.1b]', nameEn: 'Commission Expense to SHOP', accountGroup: AccountGroup.EXPENSE, level: 3 },
  { code: '53-1802', nameTh: 'ค่าธรรมเนียม PaySolutions', nameEn: 'PaySolutions Fees', accountGroup: AccountGroup.EXPENSE, level: 3 },
  { code: '53-1803', nameTh: 'ค่าธรรมเนียมโอนเงิน', nameEn: 'Bank Transfer Fees', accountGroup: AccountGroup.EXPENSE, level: 3 },
  { code: '53-1601', nameTh: 'ค่าเสื่อมราคา — อุปกรณ์ FINANCE', nameEn: 'Depreciation — FINANCE Equipment', accountGroup: AccountGroup.EXPENSE, level: 3 },

  // ─── 54-XXXX รายจ่ายต้องห้ามทางภาษี (2) ───
  { code: '54-1101', nameTh: 'ภงด. ทางภาษี ภ.ง.ด.3', nameEn: 'Tax Expense — PND.3', accountGroup: AccountGroup.EXPENSE, level: 3 },
  { code: '54-1102', nameTh: 'ภงด. ทางภาษี ภ.ง.ด.53', nameEn: 'Tax Expense — PND.53', accountGroup: AccountGroup.EXPENSE, level: 3 },
];

export async function seedFinanceChartOfAccounts(prisma: PrismaClient, financeCompanyId: string): Promise<void> {
  console.log(`  → Seeding ${FINANCE_ACCOUNTS.length} FINANCE accounts...`);
  for (const acc of FINANCE_ACCOUNTS) {
    await prisma.chartOfAccount.upsert({
      where: { companyId_code: { companyId: financeCompanyId, code: acc.code } },
      update: {
        nameTh: acc.nameTh, nameEn: acc.nameEn, accountGroup: acc.accountGroup,
        level: acc.level, isActive: true, peakAccountCode: acc.code,
      },
      create: {
        code: acc.code, companyId: financeCompanyId, nameTh: acc.nameTh, nameEn: acc.nameEn,
        accountGroup: acc.accountGroup, parentCode: acc.parentCode, level: acc.level,
        isActive: true, peakAccountCode: acc.code,
      },
    });
  }
}
