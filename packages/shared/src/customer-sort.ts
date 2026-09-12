/**
 * คีย์เรียงลำดับของหน้า /customers — ใช้ร่วมกันระหว่าง web (allow-list ของ ?sortBy=)
 * และ API (whitelist ใน CustomerQueryService.findAll) เพื่อไม่ให้สองฝั่งหลุดจากกัน
 *
 * 🔴 กติกา: คีย์ที่อยู่ในรายการนี้ต้องเรียงได้จริงที่ฐานข้อมูล
 * ถ้าใส่คีย์ที่ API เรียงไม่ได้ หัวคอลัมน์จะกดได้แต่ไม่มีอะไรเกิดขึ้น
 * (findAll ปล่อยค่า sortBy ที่ไม่รู้จักผ่านไปเงียบ ๆ แล้วใช้ createdAt desc)
 */

/** แท็บ "ลูกค้า" — คนที่ซื้อกับเราแล้ว */
export const CUSTOMER_SORT_KEYS = [
  'name',
  'createdAt',
  'contractCount',
  'creditScore',
  'lastPurchaseAt',
] as const;
export type CustomerSortKey = (typeof CUSTOMER_SORT_KEYS)[number];

/** แท็บ "ผู้สนใจ" — รายชื่อที่ยังไม่เคยซื้อ */
export const PROSPECT_SORT_KEYS = [
  'name',
  'createdAt',
  'creditScore',
  'lastContactAt',
] as const;
export type ProspectSortKey = (typeof PROSPECT_SORT_KEYS)[number];

export type CustomerListSortKey = CustomerSortKey | ProspectSortKey;
export type CustomerSortDirection = 'asc' | 'desc';

/** มุมมองของหน้า /customers — ไม่ใส่ = ทุกคน (ตัวเลือกคนในหน้าอื่นพึ่งค่านี้) */
export const CUSTOMER_VIEWS = ['customers', 'prospects'] as const;
export type CustomerView = (typeof CUSTOMER_VIEWS)[number];

/** ตัวกรอง "การซื้อ" ของแท็บลูกค้า */
export const CUSTOMER_PURCHASE_KINDS = ['INSTALLMENT', 'CASH', 'EXTERNAL_FINANCE'] as const;
export type CustomerPurchaseKind = (typeof CUSTOMER_PURCHASE_KINDS)[number];

/** สถานะย่อยของ "ผ่อนกับเรา" — จับกลุ่มจาก ContractStatus */
export const CUSTOMER_INSTALLMENT_STATES = ['ACTIVE', 'OVERDUE', 'CLOSED', 'BAD_DEBT'] as const;
export type CustomerInstallmentState = (typeof CUSTOMER_INSTALLMENT_STATES)[number];

/**
 * แผนที่สถานะย่อย → ContractStatus จริง (schema.prisma enum ContractStatus)
 * DRAFT / EXCHANGED / DEFECT_EXCHANGED จงใจไม่อยู่ในกลุ่มไหน — ดู CUSTOMER_BOUGHT_CONTRACT_STATUSES
 */
export const CUSTOMER_INSTALLMENT_STATE_STATUSES: Record<CustomerInstallmentState, readonly string[]> = {
  ACTIVE: ['ACTIVE'],
  OVERDUE: ['OVERDUE', 'DEFAULT'],
  CLOSED: ['COMPLETED', 'EARLY_PAYOFF'],
  BAD_DEBT: ['CANCELED', 'TERMINATED', 'CLOSED_BAD_DEBT'],
};

/**
 * สัญญาที่นับว่า "ซื้อกับเราแล้ว"
 * ตัด DRAFT ออกเพราะใบขายถูกสร้างตอน activate เท่านั้น (contract-workflow.service.ts)
 * ⇒ คนที่มีแต่สัญญาร่างยังไม่ได้ซื้ออะไร และ SalesQueryService ก็ตัด DRAFT ทิ้งเหมือนกัน
 * ตัด EXCHANGED / DEFECT_EXCHANGED เพราะเป็นสัญญาที่ถูกแทนที่ด้วยใบใหม่แล้ว
 */
export const CUSTOMER_BOUGHT_CONTRACT_STATUSES = [
  'ACTIVE',
  'OVERDUE',
  'DEFAULT',
  'COMPLETED',
  'EARLY_PAYOFF',
  'CANCELED',
  'TERMINATED',
  'CLOSED_BAD_DEBT',
] as const;

/** ใบขายที่นับว่า "ซื้อกับเราแล้ว" — INSTALLMENT ผูกกับสัญญาอยู่แล้ว จึงไม่นับซ้ำ */
export const CUSTOMER_BOUGHT_SALE_TYPES = ['CASH', 'EXTERNAL_FINANCE'] as const;

/** ช่วงเวลา "ซื้อล่าสุด" ของแท็บลูกค้า */
export const CUSTOMER_PURCHASED_WITHIN = ['30d', '90d', 'ytd', 'over1y'] as const;
export type CustomerPurchasedWithin = (typeof CUSTOMER_PURCHASED_WITHIN)[number];

/** ช่วงเวลา "ติดต่อล่าสุด" ของแท็บผู้สนใจ */
export const PROSPECT_CONTACTED_WITHIN = ['today', '7d', '30d', 'silent30', 'none'] as const;
export type ProspectContactedWithin = (typeof PROSPECT_CONTACTED_WITHIN)[number];

/**
 * "ที่มา" ของผู้สนใจ — เป็นค่าที่ "อนุมาน" ไม่ใช่คอลัมน์ในฐานข้อมูล
 * customers.acquisition_source เป็น VarChar(50) อิสระ และมีผู้เขียนจริงแค่บอทขาย
 * (capture-lead.tool.ts เขียน 'AI_CHAT' / 'AI_CHAT_RETURN' เท่านั้น)
 * ลำดับการอนุมาน: acquisitionSource ขึ้นต้น AI_CHAT → BOT · ไม่งั้นดูช่องทางห้องแชทล่าสุด
 * · ไม่งั้นถ้ามีคนแนะนำ → REFERRAL · ไม่งั้น WALK_IN
 */
export const PROSPECT_SOURCES = [
  'BOT',
  'FACEBOOK',
  'LINE',
  'TIKTOK',
  'WEB',
  'REFERRAL',
  'WALK_IN',
] as const;
export type ProspectSource = (typeof PROSPECT_SOURCES)[number];

/** โลโก้ช่องทางแชท — LINE_FINANCE กับ LINE_SHOP ยุบเป็น LINE ตัวเดียว */
export const CHAT_LOGOS = ['LINE', 'FACEBOOK', 'TIKTOK', 'WEB'] as const;
export type ChatLogo = (typeof CHAT_LOGOS)[number];

export function chatLogoOf(channel: string): ChatLogo {
  if (channel === 'FACEBOOK') return 'FACEBOOK';
  if (channel === 'TIKTOK') return 'TIKTOK';
  if (channel === 'LINE_FINANCE' || channel === 'LINE_SHOP') return 'LINE';
  return 'WEB';
}
