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
 *
 * `Contract.legacyContractCode` ไม่ว่าง = "PEAK รับรู้รายได้ของสัญญานี้ไปแล้ว" — งานนำเข้าอื่นห้ามตั้งค่านี้ให้สัญญาที่
 * PEAK ยังไม่ได้รับรู้ ไม่งั้นดอกเบี้ยของสัญญานั้นจะหายจาก PEAK แบบเงียบ
 *
 * รายการกลับ / กระจก (คำตัดสินผู้คุมงาน M1 ทาง A · 29/10): ถือว่าเป็นของ**รายการต้นฉบับ** — ต้นฉบับ =
 * `metadata.originalEntryId` (เทมเพลตกลับรายการทุกตัว) หรือ `referenceId` เมื่อ `referenceType = 'REVERSAL'`
 * (`JournalService.void` ซึ่งไม่ใส่ metadata) · flow ของต้นฉบับใช้ตัดทั้งรายการ · contractId ของต้นฉบับใช้เมื่อรายการ
 * ไม่มี contractId ของตัวเอง · ดูต้นฉบับชั้นเดียว (กระจกของกระจกไม่ไล่ต่อ)
 */

/** รายการยกมาของสัญญาเก่า (1 รายการต่อสัญญา ณ วันตัด) — ตัดทั้งรายการ */
export const LEGACY_OPENING_FLOW = 'legacy-opening';

/** marker ยอดรับก่อนวันตัด (tag `2B`) — ตัดทั้งรายการ */
export const LEGACY_PRIOR_RECEIPT_FLOW = 'legacy-prior-receipt';

/**
 * รายการไล่ VAT (Dr 21-2102 / Cr 21-2101 วันที่ 1 ธ.ค.) — **ไม่ตัด** ต้องเข้า PEAK: VAT ของงวดที่ถึงกำหนดแล้วแต่ยังค้าง
 * PEAK ยังไม่เคยยื่น (ยังพักอยู่ใน 215102) รายการนี้ย้ายเข้า ภ.พ.30 เดือน ธ.ค. (สเปค §5.4) · อยู่ที่นี่เพื่อให้ตัวเขียน
 * import ชื่อ flow ทั้งสามจากที่เดียว ห้ามพิมพ์สตริงเอง
 */
export const LEGACY_VAT_CATCHUP_FLOW = 'legacy-vat-catchup';

export const PEAK_EXPORT_EXCLUDED_FLOWS = [LEGACY_OPENING_FLOW, LEGACY_PRIOR_RECEIPT_FLOW] as const;

export const LEGACY_INTEREST_ACCOUNTS = ['11-2106', '41-1101'] as const;

const EXCLUDED_FLOWS: ReadonlySet<string> = new Set(PEAK_EXPORT_EXCLUDED_FLOWS);
const INTEREST_ACCOUNTS: ReadonlySet<string> = new Set(LEGACY_INTEREST_ACCOUNTS);

type EntryMeta = { metadata: unknown };

function metaObject(metadata: unknown): Record<string, unknown> | null {
  return metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : null;
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function hasExcludedFlow(entry: EntryMeta): boolean {
  const flow = metaObject(entry.metadata)?.flow;
  return typeof flow === 'string' && EXCLUDED_FLOWS.has(flow);
}

/**
 * true = ทั้งรายการไม่ส่งเข้า PEAK: flow ของรายการเอง **หรือของรายการต้นฉบับ** (ถ้าเป็นรายการกลับ / กระจก) เป็นรายการ
 * ยกมา / marker ของสัญญาเก่า · metadata ที่ไม่ใช่ object = ไม่ตัด
 */
export function isExcludedFromPeakExport(entry: EntryMeta, original?: EntryMeta | null): boolean {
  return hasExcludedFlow(entry) || (original != null && hasExcludedFlow(original));
}

/**
 * id ของรายการต้นฉบับที่รายการนี้กลับ / สะท้อน: `metadata.originalEntryId` ก่อน แล้วจึง `referenceId` ของรายการกลับจาก
 * `JournalService.void` (`referenceType = 'REVERSAL'`) · ไม่ใช่รายการกลับ = null
 */
export function peakExportOriginalEntryId(entry: {
  metadata: unknown;
  referenceType?: string | null;
  referenceId?: string | null;
}): string | null {
  const fromMeta = nonEmptyString(metaObject(entry.metadata)?.originalEntryId);
  if (fromMeta) return fromMeta;
  return entry.referenceType === 'REVERSAL' ? nonEmptyString(entry.referenceId) : null;
}

/** สัญญาของรายการสำหรับตัวกรองดอกเบี้ย: `metadata.contractId` ของรายการเอง ถ้าไม่มีใช้ของรายการต้นฉบับ */
export function peakExportContractId(entry: EntryMeta, original?: EntryMeta | null): string | null {
  return (
    nonEmptyString(metaObject(entry.metadata)?.contractId) ??
    (original != null ? nonEmptyString(metaObject(original.metadata)?.contractId) : null)
  );
}

/** 11-2106 / 41-1101 — บัญชีดอกเบี้ยที่ PEAK รับรู้ไปแล้วสำหรับสัญญาเก่า */
export function isLegacyInterestAccount(accountCode: string): boolean {
  return INTEREST_ACCOUNTS.has(accountCode);
}

/**
 * true = บรรทัดนี้ไม่ส่งเข้า PEAK: บัญชี 11-2106 / 41-1101 ของสัญญาที่มีรหัสสัญญาเดิม (ไม่ว่างเปล่า)
 * `contract` = สัญญาจาก `peakExportContractId(...)` ของรายการ · ไม่มี / หาไม่เจอ = ไม่ใช่สัญญาเก่า
 */
export function isExcludedLegacyInterestLine(
  line: { accountCode: string },
  contract: { legacyContractCode: string | null } | null | undefined,
): boolean {
  if (!isLegacyInterestAccount(line.accountCode)) return false;
  return nonEmptyString(contract?.legacyContractCode) !== null;
}
