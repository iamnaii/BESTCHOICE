/**
 * ตัวกรองไฟล์ส่งออก PEAK ของสัญญาที่ย้ายจากระบบเก่า (backoffice) — สเปค ร่าง 5 §5.6
 * (เจ้าของอนุมัติ 29/10 ค่ำ) · ด่านตรวจ 6.6 และ 6.10 ต้องเรียกฟังก์ชันชุดนี้ตัวเดียวกับไฟล์ส่งออก
 *
 * PEAK (เล่มที่ใช้ยื่น) ตั้งลูกหนี้ 113101 และรับรู้รายได้ทั้งก้อน (รวมดอกเบี้ย) ของสัญญาเก่าไปแล้วตอนทำสัญญา
 * ส่วน BESTCHOICE นำเข้าสัญญาพร้อมดอกเบี้ยตามจริง: ยกยอดมาด้วยรายการเดียวต่อสัญญา (Cr 11-2106) แล้วรับรู้
 * 41-1101 ทีละงวดผ่าน 2A ⇒ ถ้าไฟล์ส่งออกส่งสองอย่างนี้เข้า PEAK รายได้จะซ้ำ:
 *   1. รายการยกมา / marker ยอดรับก่อนวันตัด ทั้งรายการ — ดูจาก `metadata.flow`
 *      (ห้ามดูจาก `tag`: marker ใช้ tag `2B` เหมือนใบรับเงินจริง เพราะตัวรับเงินนับงวดจาก tag นี้)
 *   2. บรรทัด 11-2106 / 41-1101 ของสัญญาที่มี `Contract.legacyContractCode` — ทุกรายการ ทุกเทมเพลต
 *      สัญญาใหม่ (ไม่มีรหัสเดิม) ส่งตามปกติ
 */

export const PEAK_EXPORT_EXCLUDED_FLOWS = ['legacy-opening', 'legacy-prior-receipt'] as const;

export const LEGACY_INTEREST_ACCOUNTS = ['11-2106', '41-1101'] as const;

const EXCLUDED_FLOWS: ReadonlySet<string> = new Set(PEAK_EXPORT_EXCLUDED_FLOWS);
const INTEREST_ACCOUNTS: ReadonlySet<string> = new Set(LEGACY_INTEREST_ACCOUNTS);

/** true = ทั้งรายการไม่ส่งเข้า PEAK (รายการยกมา / marker ของสัญญาเก่า) — metadata ที่ไม่ใช่ object = false */
export function isExcludedFromPeakExport(entry: { metadata: unknown }): boolean {
  const meta = entry.metadata;
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return false;
  const flow = (meta as Record<string, unknown>).flow;
  return typeof flow === 'string' && EXCLUDED_FLOWS.has(flow);
}

/**
 * true = บรรทัดนี้ไม่ส่งเข้า PEAK: บัญชี 11-2106 / 41-1101 ของสัญญาที่มีรหัสสัญญาเดิม (ไม่ว่างเปล่า)
 * `contract` = สัญญาจาก `metadata.contractId` ของรายการ · ไม่มี / หาไม่เจอ = ไม่ใช่สัญญาเก่า
 */
export function isExcludedLegacyInterestLine(
  line: { accountCode: string },
  contract: { legacyContractCode: string | null } | null | undefined,
): boolean {
  if (!INTEREST_ACCOUNTS.has(line.accountCode)) return false;
  const code = contract?.legacyContractCode;
  return typeof code === 'string' && code.length > 0;
}
