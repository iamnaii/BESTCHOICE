/**
 * Finance Bot business rules — single source of truth
 *
 * เปลี่ยนค่าเหล่านี้ครั้งเดียว → กระทบทุก service ที่เกี่ยวข้อง
 * (tools, slip-processing, auto-trigger, system-prompt)
 */

/** ค่าปรับชำระล่าช้า (บาท/วัน) */
export const LATE_FEE_PER_DAY = 50;

/** บัญชีรับชำระของบริษัท */
export const FINANCE_BANK = {
  bankName: 'ธนาคารกสิกรไทย',
  accountNumber: '203-1-16520-5',
  accountName: 'บจก. เบสท์ช้อยส์โฟน',
} as const;

/** เบอร์ติดต่อหลัก */
export const FINANCE_CONTACT_PHONE = '063-134-6356';

/** เวลาทำการ */
export const BUSINESS_HOURS = {
  start: '09:00',
  end: '18:00',
  days: 'จันทร์-เสาร์', // ปิดอาทิตย์
} as const;

/** Pre-formatted block for templates */
export const BANK_INFO_BLOCK = [
  '▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
  `🏦 ${FINANCE_BANK.bankName}`,
  `🔢 เลขที่: ${FINANCE_BANK.accountNumber}`,
  `👤 ชื่อ: ${FINANCE_BANK.accountName}`,
  '▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
].join('\n');

/** Match exactly digits-only against the canonical bank account */
export function isCompanyBankAccount(slipAccount: string | null | undefined): boolean {
  if (!slipAccount) return false;
  const slipDigits = slipAccount.replace(/\D/g, '');
  const expectedDigits = FINANCE_BANK.accountNumber.replace(/\D/g, '');
  return slipDigits === expectedDigits;
}
