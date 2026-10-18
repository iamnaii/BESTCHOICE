import { ShopAccountResolver } from './shop-account-resolver.service';

/**
 * บัญชีที่จ่ายผู้จัดจำหน่ายได้ (เมนูจ่ายเงิน ก้อน 2 · ขยาย 2026-10-13 ตามคำถามฝ่ายบัญชี "เงินสดย่อย/อื่น ๆ"):
 * ธนาคารต้องแนบสลิป · เงินสดแนบหลักฐานได้ไม่บังคับ. ค่าเริ่มต้น = ธนาคารหน้าร้าน (จ่ายออก) S11-1202 (คำตัดสินเจ้าของ 2026-10-05).
 * S11-1106 เงินสด - เงินสดย่อย เป็น**ข้อเสนอ** (migration 20261026 + shop-coa.csv) — ถ้าฝ่ายบัญชีให้รหัสอื่น ต้องย้ายรายการที่ลงไปแล้วด้วย.
 * ไม่มี S11-1104 เงินสดเจ้าของ / S11-1105 ตู้เซฟ / S11-110x ลิ้นชักสาขา — ยอดของบัญชีเหล่านั้นเดินตามสมุดปิดยอดลิ้นชัก/นำฝาก
 * (`shop-cash-holding.service.ts` อ่าน FIFO จากตาราง ไม่ใช่ GL) การเครดิตจากเมนูนี้จะทำให้สองสมุดไม่ตรงกันถาวร (ผู้ตรวจอิสระ 13/10 ข้อ 1).
 * เงินสด (CASH) จ่ายได้ไม่เกินยอดในบัญชี (service ตรวจ) — บัญชีเงินสดย่อยยังไม่มีเมนูเติมเงิน ต้องลงรายการโอนเข้า (`Dr S11-1106 / Cr ธนาคาร`) ก่อน.
 */
export type SupplierPaymentAccountKind = 'BANK' | 'CASH';

export const SHOP_PETTY_CASH_ACCOUNT = 'S11-1106';

export const SUPPLIER_PAYMENT_ACCOUNTS: Record<string, { label: string; kind: SupplierPaymentAccountKind }> = {
  [ShopAccountResolver.SHOP_PAYING_BANK]: { label: 'ธนาคารหน้าร้าน (จ่ายออก)', kind: 'BANK' },
  [ShopAccountResolver.SHOP_RECEIVING_BANK]: { label: 'ธนาคารหน้าร้าน (รับเข้า)', kind: 'BANK' },
  [SHOP_PETTY_CASH_ACCOUNT]: { label: 'เงินสด - เงินสดย่อย', kind: 'CASH' },
};

export const SUPPLIER_PAYMENT_ACCOUNT_CODES = Object.keys(SUPPLIER_PAYMENT_ACCOUNTS);

export const isSupplierPaymentAccount = (code: string | null | undefined): code is string =>
  !!code && Object.prototype.hasOwnProperty.call(SUPPLIER_PAYMENT_ACCOUNTS, code);

/** ธนาคาร = ต้องมีสลิป · เงินสด = ไม่บังคับ แต่จ่ายได้ไม่เกินยอดในบัญชี */
export const isBankSupplierPaymentAccount = (code: string | null | undefined): boolean =>
  isSupplierPaymentAccount(code) && SUPPLIER_PAYMENT_ACCOUNTS[code].kind === 'BANK';
export const isCashSupplierPaymentAccount = (code: string | null | undefined): boolean =>
  isSupplierPaymentAccount(code) && SUPPLIER_PAYMENT_ACCOUNTS[code].kind === 'CASH';
