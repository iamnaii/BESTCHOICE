/**
 * ก้อน 7 (A16) — แคตตาล็อกเหตุการณ์ที่แจ้งพนักงานทาง LINE (Staff OA) พร้อมกติกาผู้รับเริ่มต้น
 * สเปก docs/superpowers/specs/2026-10-26-staff-line-notify-design.md §5 + §13
 * เพิ่มเหตุการณ์ = เพิ่มรายการที่นี่ แล้วเรียก StaffNotifyService.notify(key, payload) หลัง commit ที่จุดเกิดเหตุ
 */

export type StaffEventKey =
  | 'recurring_bill'
  | 'expense.pending_approval'
  | 'ap.due'
  | 'petty_cash.replenish'
  | 'chat.handoff'
  | 'chat.slip_review'
  | 'chat.slip_sla'
  | 'chat.web_inquiry'
  | 'stock.low'
  | 'cash_close.missed'
  | 'cash_close.awaiting'
  | 'sale.completed'
  | 'contract.activated'
  | 'overdue.owner_alert'
  | 'auth.new_device_login'
  | 'report.owner_daily'
  | 'collections.daily_summary'
  | 'sms.credit_low';

/** บทบาทที่ตั้งเป็นผู้รับได้ (ไม่มี VIEWER — อ่านอย่างเดียว ไม่รับงาน) */
export type StaffRole = 'OWNER' | 'FINANCE_MANAGER' | 'ACCOUNTANT' | 'BRANCH_MANAGER' | 'SALES';
export const STAFF_ROLES: readonly StaffRole[] = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES'];
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  OWNER: 'เจ้าของ',
  FINANCE_MANAGER: 'ผจก.การเงิน',
  ACCOUNTANT: 'บัญชี',
  BRANCH_MANAGER: 'ผจก.สาขา',
  SALES: 'พนักงานขาย',
};

export interface StaffNotifyRule {
  enabled: boolean;
  roles: StaffRole[];
  /** ผจก.สาขา/พนักงานขาย รับเฉพาะเมื่อ payload.branchId ตรงสาขาตน · บทบาทส่วนกลางรับทุกสาขา */
  branchScoped: boolean;
  /** ส่งถึง "กลุ่ม LINE" (notifyTargets ใน Integration Hub) ด้วย */
  includeGroup: boolean;
}

export interface StaffEventPayload {
  /** บรรทัดแรก — service เติม "📣 BESTCHOICE · " ให้เอง */
  title: string;
  /** รายละเอียดบรรทัดละข้อ */
  lines: string[];
  /** path ในเว็บ (service ต่อ FRONTEND_URL ให้) */
  link?: string;
  /** ใช้กรองผู้รับเมื่อกติกา branchScoped */
  branchId?: string | null;
  /** ข้อความเดียวกันถึงคนเดียวกันไม่ซ้ำภายใน dedupeWindowHours ของเหตุการณ์ */
  dedupeKey?: string;
  /** ผู้รับเฉพาะเจาะจงเพิ่มจากบทบาท (เช่น ผู้อนุมัติ) — ยังถูกกรอง active/lineStaffUserId */
  extraRecipientUserIds?: string[];
  /** ส่ง Flex แทนข้อความล้วน (รายงานรายวันเจ้าของ) */
  flex?: { altText: string; contents: unknown };
  /** LINE ล้ม → ส่ง SMS ไปเบอร์ของผู้รับ (เตือนเจ้าของจากงานติดตามหนี้) */
  smsFallback?: boolean;
}

export interface StaffEventCatalogItem {
  key: StaffEventKey;
  group: string;
  label: string;
  description: string;
  defaults: StaffNotifyRule;
  /** 0 = ไม่ตัดซ้ำ */
  dedupeWindowHours: number;
  /** ข้อความตัวอย่างสำหรับปุ่ม "ส่งทดสอบถึงฉัน" */
  sample: StaffEventPayload;
}

export const STAFF_NOTIFY_RULES_KEY = 'staff_notify_rules';
export const STAFF_NOTIFY_MONTHLY_CAP_KEY = 'staff_notify_monthly_cap';
/** OA แพ็กเกจฟรีส่งได้ ~300 ข้อความ/เดือน นับต่อผู้รับ — เว้นระยะไว้ให้ข้อความทดสอบ/ฉุกเฉิน */
export const STAFF_NOTIFY_DEFAULT_MONTHLY_CAP = 280;

const rule = (roles: StaffRole[], over: Partial<StaffNotifyRule> = {}): StaffNotifyRule => ({ enabled: true, roles, branchScoped: false, includeGroup: false, ...over });

export const STAFF_EVENT_CATALOG: readonly StaffEventCatalogItem[] = [
  {
    key: 'recurring_bill',
    group: 'บิลประจำ',
    label: 'บิลประจำใกล้ครบกำหนด / ครบวันนี้ / เกินกำหนด',
    description: 'จากระบบบิลประจำ · เตือนวันละครั้งต่อสถานะ',
    defaults: rule(['OWNER', 'ACCOUNTANT']),
    dedupeWindowHours: 20,
    sample: { title: 'บิลประจำครบกำหนดใน 3 วัน', lines: ['อินเทอร์เน็ต AIS Fibre · สาขาลาดพร้าว', 'ครบกำหนด 29 ต.ค. 69 · ยอดประมาณ 1,284.00', 'ร่าง EX-20261026-0001 สร้างไว้แล้ว'], link: '/expenses/recurring-bills' },
  },
  {
    key: 'expense.pending_approval',
    group: 'ใบรายจ่าย',
    label: 'ใบรายจ่ายรออนุมัติ',
    description: 'ส่งถึงผู้อนุมัติตามสิทธิ์เสมอ + บทบาทที่ติ๊กเพิ่ม',
    defaults: rule(['OWNER'], { branchScoped: true }),
    dedupeWindowHours: 20,
    sample: { title: 'ใบรายจ่ายรออนุมัติ EX-20261026-0007', lines: ['บจก.ลาดพร้าวพลาซ่า', 'ยอด 25,000.00 บาท · สาขาลาดพร้าว', 'โดย สมหญิง'], link: '/expenses' },
  },
  {
    key: 'ap.due',
    group: 'ใบรายจ่าย',
    label: 'เจ้าหนี้ครบกำหนดจ่าย',
    description: 'ทำงานเมื่อสวิตช์ ap_due_alerts_enabled เปิด',
    defaults: rule(['ACCOUNTANT', 'OWNER']),
    dedupeWindowHours: 20,
    sample: { title: 'เจ้าหนี้ครบกำหนดจ่าย EX-20261001-0003', lines: ['บจก.ลาดพร้าวพลาซ่า · 25,000.00 บาท', 'ครบกำหนด 26 ต.ค. 69'], link: '/expenses' },
  },
  {
    key: 'petty_cash.replenish',
    group: 'ใบรายจ่าย',
    label: 'เงินสดย่อยต่ำกว่าเกณฑ์เติม',
    description: 'ทุกวัน 09:00',
    defaults: rule(['OWNER', 'ACCOUNTANT']),
    dedupeWindowHours: 20,
    sample: { title: 'เงินสดย่อยต่ำกว่าเกณฑ์เติม', lines: ['คงเหลือ 3,200.00 บาท (เกณฑ์ 5,000.00)'], link: '/expenses' },
  },
  {
    key: 'chat.handoff',
    group: 'แชทลูกค้า',
    label: 'ลูกค้าขอคุยกับคน',
    description: 'ทันทีที่บอทส่งต่อ · ซ้ำห้องเดิมไม่เกิน 1 ชม.',
    defaults: rule(['OWNER', 'FINANCE_MANAGER'], { includeGroup: true }),
    dedupeWindowHours: 1,
    sample: { title: '🔴 ลูกค้ารอคุย [ด่วน]', lines: ['👤 คุณประสิทธิ์ ทองดี', '📌 เรื่อง: ถามเรื่องปิดยอดก่อนกำหนด'], link: '/inbox' },
  },
  {
    key: 'chat.slip_review',
    group: 'แชทลูกค้า',
    label: 'สลิปโอนยอดไม่ตรง / ผิดบัญชี',
    description: 'ทันทีที่ตรวจสลิปไม่ผ่าน',
    defaults: rule(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'], { includeGroup: true }),
    dedupeWindowHours: 20,
    sample: { title: '🧾 สลิปรอตรวจสอบ', lines: ['👤 คุณประสิทธิ์ ทองดี', '📋 สัญญา: CT-20261001-0012', '💰 ยอดในสลิป: 2,500 บาท', '💰 ยอดไม่ตรง'], link: '/slip-review' },
  },
  {
    key: 'chat.slip_sla',
    group: 'แชทลูกค้า',
    label: 'สลิปค้างตรวจเกิน SLA',
    description: 'สรุปวันละครั้ง',
    defaults: rule(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'], { includeGroup: true }),
    dedupeWindowHours: 20,
    sample: { title: '⏰ สลิปรอตรวจสอบเกิน SLA', lines: ['📋 จำนวน: 3 ใบ', '⏳ ใบเก่าสุดรอมาแล้ว 5.5 ชั่วโมง'], link: '/slip-review' },
  },
  {
    key: 'chat.web_inquiry',
    group: 'แชทลูกค้า',
    label: 'ข้อความสอบถามจากเว็บ',
    description: 'ฟอร์มติดต่อบนเว็บร้าน',
    defaults: rule(['OWNER'], { includeGroup: true }),
    dedupeWindowHours: 20,
    sample: { title: 'ข้อความสอบถามจากเว็บ', lines: ['คุณสมชาย · 08x-xxx-1234', 'สนใจ iPhone 15 ผ่อนได้ไหม'], link: '/inbox' },
  },
  {
    key: 'stock.low',
    group: 'สต๊อก',
    label: 'ของต่ำกว่าจุดสั่งซื้อซ้ำ',
    description: 'ต่อรายการ · ซ้ำไม่เกินวันละครั้ง',
    defaults: rule(['OWNER', 'BRANCH_MANAGER'], { branchScoped: true }),
    dedupeWindowHours: 20,
    sample: { title: 'ของต่ำกว่าจุดสั่งซื้อซ้ำ: iPhone 15 128GB ดำ', lines: ['สาขาลาดพร้าว', 'เหลือ 1 (จุดสั่งซื้อ 3)'], link: '/stock/reorder-points' },
  },
  {
    key: 'cash_close.missed',
    group: 'เงินสดหน้าร้าน',
    label: 'สาขาไม่ปิดยอดเงินสดของเมื่อวาน',
    description: 'ทุกวัน 10:00 · สาขาละ 1 ข้อความ',
    defaults: rule(['OWNER', 'BRANCH_MANAGER'], { branchScoped: true }),
    dedupeWindowHours: 20,
    sample: { title: 'สาขาบางนายังไม่ปิดยอดเงินสดของเมื่อวาน', lines: ['25 ต.ค. 69 เงินสดเข้า 12,500.00 บาท แต่ไม่มีใบปิดยอด'], link: '/shop/daily-cash' },
  },
  {
    key: 'cash_close.awaiting',
    group: 'เงินสดหน้าร้าน',
    label: 'เงินสดนับแล้ว รอยืนยันรับเงินเกิน 1 วัน',
    description: 'ทุกวัน 10:00',
    defaults: rule(['OWNER', 'ACCOUNTANT']),
    dedupeWindowHours: 20,
    sample: { title: 'มี 2 ยอดเงินสดที่นับแล้ว รอยืนยันรับเงินเกิน 1 วัน', lines: [], link: '/shop/daily-cash' },
  },
  {
    key: 'sale.completed',
    group: 'การขาย',
    label: 'ขายสดสำเร็จ (POS / ไฟแนนซ์นอก)',
    description: 'ทันทีหลังบันทึกใบขาย · ปิดเป็นค่าเริ่มต้นเพราะโควต้าข้อความ',
    defaults: rule(['OWNER'], { enabled: false, branchScoped: true }),
    dedupeWindowHours: 20,
    sample: { title: 'ขายสดสำเร็จ S-20261026-0012', lines: ['สาขาลาดพร้าว', 'iPhone 15 128GB · 28,900.00 บาท', 'โดย เอก'], link: '/sales' },
  },
  {
    key: 'contract.activated',
    group: 'การขาย',
    label: 'สัญญาผ่อนเปิดใช้',
    description: 'ทันทีที่สัญญาเป็น ACTIVE · ปิดเป็นค่าเริ่มต้นเพราะโควต้าข้อความ',
    defaults: rule(['OWNER'], { enabled: false, branchScoped: true }),
    dedupeWindowHours: 20,
    sample: { title: 'สัญญาผ่อนเปิดใช้ CT-20261026-0005', lines: ['ลูกค้า คุณประสิทธิ์ ทองดี', 'iPhone 15 128GB · ยอดจัด 24,000.00 บาท · 12 งวด', 'สาขาลาดพร้าว'], link: '/contracts' },
  },
  {
    key: 'overdue.owner_alert',
    group: 'ติดตามหนี้',
    label: 'แจ้งเจ้าของจากงานติดตามหนี้',
    description: 'เสนอล็อกเครื่อง / ออกจดหมายอัตโนมัติ / ด่านกำกับทวงหนี้ · LINE ล้มส่ง SMS แทน',
    defaults: rule(['OWNER']),
    dedupeWindowHours: 20,
    sample: { title: 'ระบบเสนอล็อกเครื่อง 3 สัญญา', lines: ['ค้างเกิน 30 วัน ไม่มีสัญญาจ่าย', 'เข้าไปอนุมัติที่หน้าติดตามหนี้'], link: '/overdue', smsFallback: true },
  },
  {
    key: 'auth.new_device_login',
    group: 'ระบบ',
    label: 'ล็อกอินจากอุปกรณ์ใหม่',
    description: 'ความปลอดภัย · ส่งทุกครั้ง ไม่ตัดซ้ำ',
    defaults: rule(['OWNER']),
    dedupeWindowHours: 0,
    sample: { title: 'ล็อกอินจากอุปกรณ์ใหม่', lines: ['ผู้ใช้: สมหญิง', 'อุปกรณ์: Chrome บน Windows', 'IP prefix: 171.96', 'หากไม่ใช่คุณ กรุณาติดต่อผู้ดูแลระบบทันที'] },
  },
  {
    key: 'report.owner_daily',
    group: 'รายงาน',
    label: 'รายงานรายวันถึงเจ้าของ',
    description: 'ทุกวัน 20:00 · การ์ดสรุปรับชำระ/ค้างชำระ/สัญญาใหม่',
    defaults: rule(['OWNER']),
    dedupeWindowHours: 20,
    sample: { title: 'รายงานประจำวัน 26 ต.ค. 69', lines: ['รับชำระวันนี้ 12 รายการ 48,500.00 บาท', 'ค้างชำระ 7 สัญญา', 'สัญญาใหม่ 2'], link: '/' },
  },
  {
    key: 'collections.daily_summary',
    group: 'รายงาน',
    label: 'สรุปติดตามหนี้รายวัน',
    description: 'ทุกวัน 18:00',
    defaults: rule(['OWNER', 'FINANCE_MANAGER']),
    dedupeWindowHours: 20,
    sample: { title: 'สรุปติดตามหนี้ 26 ต.ค. 69', lines: ['เอก: โทร 12 สาย · สัญญาจ่าย 3', 'สมหญิง: โทร 8 สาย · สัญญาจ่าย 1'], link: '/collections' },
  },
  {
    key: 'sms.credit_low',
    group: 'ระบบ',
    label: 'SMS credit ใกล้หมด',
    description: 'ทุกวัน 09:00 เมื่อต่ำกว่า 100',
    defaults: rule(['OWNER']),
    dedupeWindowHours: 20,
    sample: { title: 'SMS credit ใกล้หมด', lines: ['เหลือ 42 เครดิต'], link: '/notifications' },
  },
];

const BY_KEY = new Map(STAFF_EVENT_CATALOG.map((c) => [c.key, c]));

export function catalogItem(key: StaffEventKey): StaffEventCatalogItem {
  const item = BY_KEY.get(key);
  if (!item) throw new Error(`ไม่รู้จักเหตุการณ์แจ้งพนักงาน: ${String(key)}`);
  return item;
}

export function isStaffEventKey(key: unknown): key is StaffEventKey {
  return typeof key === 'string' && BY_KEY.has(key as StaffEventKey);
}
