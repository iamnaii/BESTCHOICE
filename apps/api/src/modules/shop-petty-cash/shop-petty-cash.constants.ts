import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { SHOP_PETTY_CASH_ACCOUNT, SUPPLIER_PAYMENT_ACCOUNTS } from '../journal/supplier-payment-accounts';

/**
 * เงินสดย่อยหน้าร้าน S11-1106 — เมนูเติม/คืน (ข้อ 20.2 · คำตอบฝ่ายบัญชี 16/10/2569 · เจ้าของเคาะ 18/10/2569):
 * กองเดียวทั้งร้าน ไม่แยกสาขา ไม่ระบุผู้ถือ · วงเงินเป็นค่าตั้งค่าตัวเดียว (`shop_petty_cash_limit` — ไม่มี = 20,000)
 * · ธนาคารต้นทาง/ปลายทางเลือกได้ระหว่างสองบัญชีธนาคารหน้าร้าน · หลักฐานไม่บังคับ (20.3)
 */
export const SHOP_PETTY_CASH_LIMIT_KEY = 'shop_petty_cash_limit';
export const SHOP_PETTY_CASH_DEFAULT_LIMIT = 20000;
/** เพดานค่าตั้งค่า — กันพิมพ์ผิด (เงินสดย่อยหน้าร้านไม่ควรเกินหลักแสน) */
export const SHOP_PETTY_CASH_MAX_LIMIT = 1_000_000;
export const SHOP_PETTY_CASH_EVIDENCE_PREFIX = 'shop-petty-cash';
/** Todo แจ้งฝ่ายบัญชีเมื่อวันที่ที่เลือกอยู่ในงวดที่ปิดแล้ว (ลงวันที่บันทึกแทน) — แบบเดียวกับจ่ายผู้จัดจำหน่าย */
export const SHOP_PETTY_CASH_PERIOD_TODO_TAG = 'shop-petty-cash-period';
export const SHOP_PETTY_CASH_AUDIT = {
  TOP_UP: 'SHOP_PETTY_CASH_TOP_UP',
  RETURN: 'SHOP_PETTY_CASH_RETURN',
  LIMIT: 'SHOP_PETTY_CASH_LIMIT_SET',
} as const;

export { SHOP_PETTY_CASH_ACCOUNT };

export interface ShopPettyCashBank {
  code: string;
  label: string;
}

/** ธนาคารหน้าร้านที่เติม/คืนได้ — เรียงตามค่าเริ่มต้นของการเติม (จ่ายออกก่อน) */
export const SHOP_PETTY_CASH_BANKS: readonly ShopPettyCashBank[] = [
  ShopAccountResolver.SHOP_PAYING_BANK,
  ShopAccountResolver.SHOP_RECEIVING_BANK,
].map((code) => ({ code, label: SUPPLIER_PAYMENT_ACCOUNTS[code].label }));

/** ค่าเริ่มต้นของกล่อง: เติม = จ่ายออก S11-1202 (เหมือนเมนูจ่ายผู้จัดจำหน่าย) · คืน = รับเข้า S11-1201 (ที่เงินหน้าร้านฝากเข้าอยู่แล้ว) */
export const SHOP_PETTY_CASH_DEFAULT_BANK = {
  TOP_UP: ShopAccountResolver.SHOP_PAYING_BANK,
  RETURN: ShopAccountResolver.SHOP_RECEIVING_BANK,
} as const;

export const shopPettyCashBankLabel = (code: string | null | undefined): string =>
  (code && SUPPLIER_PAYMENT_ACCOUNTS[code]?.label) || (code ?? '');
