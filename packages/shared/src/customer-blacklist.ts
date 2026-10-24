/**
 * ก้อน 5 C3 — ด่าน blacklist ตอนทำสัญญา (spec docs/superpowers/specs/2026-10-23-contract-blacklist-gate-design.md)
 * ชนิด/ค่าคงที่ที่ API และ web ใช้ร่วมกัน — API ประเมินเหตุผล, web แสดงและส่งเหตุผลปลด SOFT
 */
export type BlacklistLevel = 'NONE' | 'SOFT' | 'HARD';

export type BlacklistReasonCode =
  | 'ACTIVE_CONTRACT'
  | 'BAD_DEBT'
  | 'REPOSSESSED'
  | 'TERMINATED_UNRETURNED'
  | 'MANUAL_TAG'
  | 'PHONE_MATCH'
  | 'REFERENCES_BLACKLISTED'
  | 'REFERENCED_BY_BLACKLISTED';

/** เหตุผลระดับ HARD — ไม่มีใครปลดได้ (รวม OWNER) */
export const HARD_BLACKLIST_CODES: ReadonlySet<BlacklistReasonCode> = new Set<BlacklistReasonCode>([
  'ACTIVE_CONTRACT',
  'BAD_DEBT',
  'REPOSSESSED',
  'TERMINATED_UNRETURNED',
  'MANUAL_TAG',
  'PHONE_MATCH',
]);

export interface BlacklistReason {
  code: BlacklistReasonCode;
  level: 'HARD' | 'SOFT';
  /** ข้อความไทยพร้อมแสดง — มีชื่อคนที่จับคู่ได้ ไม่มีเบอร์/เลขบัตร */
  message: string;
  contractNumber?: string | null;
  related?: { customerId: string; name: string } | null;
}

export interface CustomerBlacklistResult {
  level: BlacklistLevel;
  reasons: BlacklistReason[];
  checkedAt: string;
}

/** บทบาทที่ปลดระดับ SOFT ได้ (คำตัดสินเจ้าของ 2026-10-23) */
export const BLACKLIST_OVERRIDE_ROLES = ['OWNER', 'BRANCH_MANAGER'] as const;
export const BLACKLIST_OVERRIDE_REASON_MIN = 10;
export const BLACKLIST_OVERRIDE_REASON_MAX = 500;
/** จำนวน id สูงสุดต่อคำขอ GET /customers/blacklist?ids= */
export const BLACKLIST_BATCH_MAX = 100;

/** โค้ดใน response 409 ของด่านทั้งสองจุด (create / activate) */
export const BLACKLIST_ERROR_CODE = {
  HARD: 'CUSTOMER_BLACKLISTED',
  SOFT: 'CUSTOMER_BLACKLIST_REVIEW',
} as const;

export function resolveBlacklistLevel(reasons: Pick<BlacklistReason, 'level'>[]): BlacklistLevel {
  if (reasons.some((r) => r.level === 'HARD')) return 'HARD';
  if (reasons.length > 0) return 'SOFT';
  return 'NONE';
}

export function canOverrideBlacklist(role: string | null | undefined): boolean {
  return !!role && (BLACKLIST_OVERRIDE_ROLES as readonly string[]).includes(role);
}

/** เหตุผลปลด SOFT ใช้ได้เมื่อ trim แล้วยาว 10–500 ตัวอักษร */
export function isValidBlacklistOverrideReason(reason: string | null | undefined): reason is string {
  if (typeof reason !== 'string') return false;
  const n = reason.trim().length;
  return n >= BLACKLIST_OVERRIDE_REASON_MIN && n <= BLACKLIST_OVERRIDE_REASON_MAX;
}
