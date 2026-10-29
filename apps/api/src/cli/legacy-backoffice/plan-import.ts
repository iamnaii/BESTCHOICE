import { Prisma } from '@prisma/client';
import type { ContractStatus, ProductCategory } from '@prisma/client';
import { isValidThaiNationalId } from '@installment/shared';
import { bangkokCalendarParts, bangkokDateString, bangkokStartOfDay } from '../../utils/date.util';
import { dRound } from '../../utils/decimal.util';
import { classifyContract, isOldForm, type CanceledResolution } from './classify';
import { formatMoney } from './csv';
import { toLegacyCustomerInput, type LegacyCustomerInput } from './customer';
import type { DumpRow } from './dump-reader';
import type { LegacyFileDetail } from './files';
import type { LegacyBook, LegacyContract, LegacyInstallment } from './legacy-book';
import {
  applyPeakBalance,
  checkInstallmentAmounts,
  LegacyMoneyError,
  mapContractMoney,
  type ContractMoney,
  type MoneyOverride,
} from './money';
import {
  computeOpening,
  OpeningInputError,
  OpeningMismatchError,
  type OpeningResult,
} from './opening';
import {
  mapContractDocuments,
  mapPayments,
  type DocumentDraft,
  type EvidenceDraft,
  type PaymentDraft,
} from './payments';
import type { PeakRecon } from './peak-recon';
import { buildImportSchedule } from './schedule';

/**
 * แผนนำเข้าสัญญาระบบเก่า (Task 10) — ฟังก์ชันบริสุทธิ์ ไม่แตะฐานข้อมูล: รวมทุกขั้นของ Task 2–9 เป็นรายการที่ตัวเขียน
 * (`writer.ts`) เขียนลงฐานได้ทันที และแถวตัวบล็อก (`blockers`) ที่ต้องแก้ก่อนนำเข้า
 *
 * ต่อสัญญา (ลำดับ = ลำดับที่ตัวบล็อกแรกหยุดสัญญานั้น):
 * 1. `classifyContract` — SKIP = `skipped` (ยกเลิก/หนี้เสียที่เจ้าของยังไม่ยืนยัน = ตัวบล็อก `CANCELED_UNCONFIRMED`)
 * 2. `mapContractMoney` (+ `moneyOverrides`) — `LegacyMoneyError` = ตัวบล็อก
 * 3. **ACTIVE เท่านั้น:**
 *    - ค่างวดระบบเก่าไม่ตรงตัวคำนวณ (`checkInstallmentAmounts`) = ตัวบล็อก (ไม่ว่ามี override หรือไม่)
 *    - ไม่มีคู่ใบแจ้งหนี้ PEAK (ไม่พบ / กำกวม — `peakRecon.matched` ไม่มี) = ตัวบล็อก
 *    - `applyPeakBalance` ด้วยยอดคงเหลือ PEAK จริง (งวดปัด 2 ตำแหน่งก่อน — float ของระบบเก่า) — PEAK สูงกว่าไม่เกิน 1.00 =
 *      เศษสตางค์ของยอดผ่อนรวม บวกเข้าค่างวดงวดสุดท้ายที่ยังค้าง (`peak.satangGap` + หมายเหตุสัญญา) · เกินนั้น `PEAK_HIGHER` = ตัวบล็อก
 *    - `buildImportSchedule` · `mapPayments` — ข้อเตือน `BLOCK:` / งวดจ่ายเกินค่างวด / ค่างวดไม่เป็นบวก = ตัวบล็อก
 *    - `computeOpening` (ยอดเรียกเก็บ = `PaymentDraft.amountDue` · ยอดจ่าย = `amountPaid` · วันครบกำหนดเดียวกับแถวตารางงวด)
 *      — `OpeningMismatchError` / `OpeningInputError` = ตัวบล็อก (ช่อง `diff` / `expectedRoundingDiff` / `installmentNos`)
 *    - ไม่มีอะไรยกมาเลย (ทุกงวดชำระครบ) = ตัวบล็อก `ACTIVE_NOTHING_OUTSTANDING` — สถานะ 2 แต่ไม่มียอดค้าง ถ้านำเข้าเป็น
 *      ACTIVE ต้องมี stamp ทุกงวด (ไม่งั้นรอบกลางคืนตั้ง 2A ให้งวดที่จ่ายแล้ว) แต่ไม่มีรายการยกมาให้ลิงก์ — เจ้าของตัดสินก่อน
 * 4. **HISTORY:** `mapPayments(…, 'HISTORY')` (เฉพาะงวดที่มียอดจ่าย) · ไม่มีตารางงวด ไม่มีรายการยกมา ไม่มี stamp ·
 *    ใบแจ้งหนี้ PEAK ที่จับคู่ได้ยังมียอดคงเหลือ > 0 = ตัวบล็อก `HISTORY_WITH_PEAK_REMAIN`
 * 5. ลูกค้า: `toLegacyCustomerInput(สมาชิก, คำสั่งซื้อล่าสุดของสมาชิกในบรรดาสัญญาที่นำเข้า, { รหัส PEAK ของใบแจ้งหนี้ของสัญญานี้,
 *    overrides })` — ตรวจแยกจากข้อ 2–4 (สัญญาหนึ่งมีตัวบล็อกได้ทั้งสองฝั่ง): เลขบัตรว่าง/ผิด checksum โดยไม่มี override ·
 *    สมาชิกหนึ่งคนที่สัญญาได้รหัส PEAK ต่างกัน (ลูกค้าหนึ่งคนมีรหัส PEAK ได้รหัสเดียว — `customer.ts` จะให้ `PEAK_CODE_CONFLICT`)
 *
 * ตรวจทั้งแผน: รหัสในไฟล์ของเจ้าของ (`canceledMap` / `moneyOverrides` / `customerOverrides`) ที่ไม่มีในระบบเก่า ·
 * IMEI ซ้ำระหว่างสัญญา ACTIVE · รหัสงวดเดิม (`Payment.legacyInstallmentCode` unique) ซ้ำ
 *
 * **เครื่อง:** `legacyProductCode = <เลขสัญญาเดิม>/<IMEI>` (unique ต่อสัญญา — เครื่องที่ขายต่อหลายสัญญาได้หนึ่งแถวต่อสัญญา) ·
 * `imeiSerial` ใส่**เฉพาะสัญญา ACTIVE** — index unique ของ IMEI (`deleted_at IS NULL`) ห้ามสองแถวที่ยังไม่ถูกลบถือ IMEI
 * เดียวกัน และ dump 29/10 มี 48 IMEI ที่อยู่หลายสัญญา (ACTIVE คู่กับประวัติ) · สัญญาประวัติเก็บ IMEI ไว้ใน
 * `legacyProductCode` (เครื่องของสัญญาที่ปิดแล้วไม่ถูก MDM/ยึดคืน และรับเครื่องเดิมเข้าร้านได้โดยไม่ชน IMEI)
 *
 * **วันชำระ:** งวด `PAID` ที่ไม่มีวันจากใบรับเงิน (ยอดตามบันทึกงวด หรือปรับตาม PEAK) → `paidDate` = วันตัด + หมายเหตุ
 * (คำตัดสินผู้คุมงาน) · `lateFee` 0 เสมอ (ค่าปรับที่เก็บแล้วอยู่ใน notes จาก `mapPayments`)
 *
 * ข้อความตัวบล็อก/ข้อเตือนมีแค่เลขสัญญา รหัสสมาชิก รหัสใบแจ้งหนี้ เลขงวด และยอดในช่องที่ระบุ — ไม่มีข้อมูลลูกค้า
 */

type Decimal = Prisma.Decimal;

const ZERO = new Prisma.Decimal(0);
const OLD_FORM_NOTE = '[สัญญาฉบับเก่า: ค่าปรับตามสัญญาเดิม หลัง 3 วัน วันละ 50 บาท]';
const NO_PAID_DATE_NOTE =
  'ไม่มีวันชำระจากใบรับเงิน (ยอดตามบันทึกงวดของระบบเก่าหรือปรับตาม PEAK) — ใช้วันตัดระบบ';
/** รายการไล่ VAT ลง 00:05 ของวันถัดจากวันตัด (กรุงเทพ) */
const CATCH_UP_OFFSET_MS = 5 * 60 * 1000;
const DAY_MS = 86_400_000;

export type ImportOptions = {
  /** วันตัด (2026-11-30 23:59:59 กรุงเทพ) */
  cutoff: Date;
  peakRecon: PeakRecon;
  /** เลขสัญญาเดิม → ผลที่เจ้าของยืนยัน (สัญญาสถานะ 4/5) */
  canceledMap: ReadonlyMap<string, CanceledResolution>;
  /** เลขสัญญาเดิม → ยอดที่แก้ (`--money-overrides`) */
  moneyOverrides: ReadonlyMap<string, MoneyOverride>;
  /** รหัสสมาชิก → id ลูกค้า (`--customer-overrides`) */
  customerOverrides: ReadonlyMap<string, string>;
  /**
   * ผลอัปโหลดไฟล์แนบ (`uploadLegacyFiles(...).details`) — ส่งมา = เติม `missingAttachments` ต่อสัญญา · ไม่ส่ง = ว่าง
   * (ตัวเขียนตรวจกับไฟล์ที่ได้รับอีกครั้งและรายงานใน `WriteReport.missingAttachments`)
   */
  files?: ReadonlyMap<string, LegacyFileDetail>;
};

export const IMPORT_BLOCKER_REASONS = [
  'CANCELED_UNCONFIRMED',
  'CANCELED_MAP_UNKNOWN_CONTRACT',
  'CANCELED_MAP_NOT_CANCELED',
  'MONEY_OVERRIDE_UNKNOWN_CONTRACT',
  'CUSTOMER_OVERRIDE_UNKNOWN_MEMBER',
  'LEGACY_MONEY_INVALID',
  'MONEY_READ_ERROR',
  'INSTALLMENT_AMOUNT_MISMATCH',
  'PEAK_UNMATCHED',
  'PEAK_NEGATIVE_REMAIN',
  'PEAK_HIGHER',
  'HISTORY_WITH_PEAK_REMAIN',
  'PAYMENTS_BLOCK',
  'INSTALLMENT_OVERPAID',
  'INSTALLMENT_NONPOSITIVE',
  'OPENING_MISMATCH',
  'OPENING_INPUT_INVALID',
  'ACTIVE_NOTHING_OUTSTANDING',
  'MEMBER_NOT_FOUND',
  'CUSTOMER_INPUT_INVALID',
  'CUSTOMER_INVALID_NATIONAL_ID',
  'CUSTOMER_PEAK_CODE_CONFLICT',
  'DUPLICATE_ACTIVE_IMEI',
  'DUPLICATE_INSTALLMENT_CODE',
  'PLAN_ERROR',
  // ── ตัวเขียน (ต้องเห็นฐานข้อมูล) — `LegacyWriteBlocked.rows` ──
  'CUSTOMER_PHONE_TAKEN',
  'CUSTOMER_NATIONAL_ID_CONFLICT',
  'CUSTOMER_LINK_ERROR',
  'CONTRACT_NUMBER_TAKEN',
  'CONTRACT_CODE_DELETED',
  'PRODUCT_CODE_TAKEN',
  'IMEI_TAKEN',
  'INSTALLMENT_CODE_TAKEN',
] as const;
export type ImportBlockerReason = (typeof IMPORT_BLOCKER_REASONS)[number];

/**
 * แถวตัวบล็อก — `code` = เลขสัญญาเดิม (แถวที่มาจากไฟล์ของเจ้าของ = รหัสในไฟล์ + `detail.source`) ·
 * `detail` = ค่าที่ช่วยแก้ (เลขงวด ยอดส่วนต่าง รหัสสมาชิก id ลูกค้า) ไม่มีข้อมูลส่วนบุคคล
 */
export type ImportBlocker = {
  code: string;
  reason: ImportBlockerReason;
  detail?: Record<string, string>;
};

/** คำอธิบายภาษาไทยของตัวบล็อก — ให้ Task 13 พิมพ์ใน `blockers.csv` */
export const BLOCKER_REASON_TEXT: Record<ImportBlockerReason, string> = {
  CANCELED_UNCONFIRMED: 'สัญญายกเลิก/หนี้เสียที่เจ้าของยังไม่ยืนยันผล (--canceled-map)',
  CANCELED_MAP_UNKNOWN_CONTRACT: 'ไฟล์ --canceled-map มีเลขสัญญาที่ไม่มีในระบบเก่า',
  CANCELED_MAP_NOT_CANCELED: 'ไฟล์ --canceled-map มีสัญญาที่ไม่ใช่สถานะยกเลิก/หนี้เสีย',
  MONEY_OVERRIDE_UNKNOWN_CONTRACT: 'ไฟล์ --money-overrides มีเลขสัญญาที่ไม่มีในระบบเก่า',
  CUSTOMER_OVERRIDE_UNKNOWN_MEMBER: 'ไฟล์ --customer-overrides มีรหัสสมาชิกที่ไม่มีในระบบเก่า',
  LEGACY_MONEY_INVALID: 'ยอดจัดหรือค่างวดของสัญญาไม่เป็นบวก (แก้ยอดจัดด้วย --money-overrides)',
  MONEY_READ_ERROR: 'อ่านยอดเงินของสัญญาไม่ได้',
  INSTALLMENT_AMOUNT_MISMATCH:
    'ค่างวดในระบบเก่าไม่ตรงกับตัวคำนวณ (เกินเกณฑ์ปัดเศษ) — แก้ด้วย --money-overrides หรือตรวจสัญญา',
  PEAK_UNMATCHED: 'สัญญาผ่อนอยู่ที่ไม่มีคู่ใบแจ้งหนี้ใน PEAK หรือคู่กำกวม (เติม --peak-pairs)',
  PEAK_NEGATIVE_REMAIN: 'ยอดคงเหลือใบแจ้งหนี้ PEAK ติดลบ',
  PEAK_HIGHER:
    'ยอดคงเหลือใน PEAK มากกว่ายอดค้างของระบบเก่าเกิน 1.00 หรือไม่มีงวดค้างให้รับเศษ (ห้ามทวงงวดที่จ่ายแล้ว)',
  HISTORY_WITH_PEAK_REMAIN:
    'สัญญาปิดแล้วในระบบเก่าแต่ใบแจ้งหนี้ PEAK ยังมียอดคงเหลือ — ต้องตรวจกับสำนักงานบัญชีก่อนนำเข้า',
  PAYMENTS_BLOCK: 'ข้อมูลการรับเงินขัดกัน (เช่น สัญญาผ่อนอยู่ที่มีรายการปิดบัญชี)',
  INSTALLMENT_OVERPAID: 'งวดของสัญญาผ่อนอยู่ที่ยอดจ่ายเกินค่างวด',
  INSTALLMENT_NONPOSITIVE: 'งวดของสัญญาผ่อนอยู่ที่ค่างวดไม่เป็นบวก',
  OPENING_MISMATCH: 'รายการยกมาไม่เท่ายอดคงเหลือใน PEAK (ดู mismatch / diff / installmentNos)',
  OPENING_INPUT_INVALID: 'คำนวณรายการยกมาไม่ได้ (ข้อมูลงวดผิดรูป)',
  ACTIVE_NOTHING_OUTSTANDING:
    'สัญญาสถานะผ่อนอยู่แต่ไม่มียอดค้าง — เจ้าของตัดสินว่าปิดสัญญาในระบบเก่าหรือนำเข้าอย่างไร',
  MEMBER_NOT_FOUND: 'ไม่พบสมาชิกของคำสั่งซื้อในระบบเก่า',
  CUSTOMER_INPUT_INVALID: 'อ่านข้อมูลลูกค้าระบบเก่าไม่ได้',
  CUSTOMER_INVALID_NATIONAL_ID:
    'เลขบัตรประชาชนว่างหรือผิด checksum — ผูกลูกค้าเองด้วย --customer-overrides',
  CUSTOMER_PEAK_CODE_CONFLICT:
    'ลูกค้าคนเดียวได้รหัสผู้ติดต่อ PEAK สองรหัส — สำนักงานบัญชีต้องรวมผู้ติดต่อใน PEAK ก่อน',
  DUPLICATE_ACTIVE_IMEI: 'IMEI เดียวกันอยู่ในสัญญาผ่อนอยู่มากกว่าหนึ่งสัญญา',
  DUPLICATE_INSTALLMENT_CODE: 'รหัสงวดเดิมซ้ำกันระหว่างสัญญาที่นำเข้า',
  PLAN_ERROR: 'คำนวณแผนนำเข้าของสัญญานี้ไม่ได้',
  CUSTOMER_PHONE_TAKEN:
    'เบอร์หลักของลูกค้าเป็นของลูกค้าคนอื่นใน BESTCHOICE — ผูกเองด้วย --customer-overrides',
  CUSTOMER_NATIONAL_ID_CONFLICT:
    'เลขบัตร/รหัสสมาชิกชนกับลูกค้าใน BESTCHOICE — ตรวจคู่ที่ชน แล้วผูกเองด้วย --customer-overrides',
  CUSTOMER_LINK_ERROR: 'ผูกลูกค้าไม่สำเร็จ (ข้อผิดพลาดของฐานข้อมูลหรือไฟล์ override)',
  CONTRACT_NUMBER_TAKEN: 'เลขสัญญาเดิมถูกใช้เป็นเลขสัญญาใน BESTCHOICE แล้ว',
  CONTRACT_CODE_DELETED:
    'เลขสัญญาเดิมนี้ถูกนำเข้าแล้วและถูกลบ (soft delete) — ต้องตรวจก่อนนำเข้าใหม่',
  PRODUCT_CODE_TAKEN: 'รหัสเครื่องเดิม (legacyProductCode) ผูกกับสัญญาอื่นใน BESTCHOICE แล้ว',
  IMEI_TAKEN: 'IMEI ของสัญญาผ่อนอยู่เป็นของสินค้าอื่นใน BESTCHOICE (ยังไม่ถูกลบ)',
  INSTALLMENT_CODE_TAKEN: 'รหัสงวดเดิมมีอยู่แล้วใน BESTCHOICE',
};

export type PlannedProduct = {
  /** `<เลขสัญญาเดิม>/<IMEI>` — unique · IMEI ว่าง = `<เลขสัญญาเดิม>/NO-IMEI` */
  legacyProductCode: string;
  name: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  category: ProductCategory;
  /** เฉพาะสัญญา ACTIVE (ดูหัวไฟล์) */
  imeiSerial: string | null;
  serialNumber: string | null;
};

/** แถว `installment_schedules` ที่ยังไม่มี `contractId` (ตัวเขียนใส่) — ยอดจาก `buildImportSchedule` */
export type PlannedScheduleRow = {
  installmentNo: number;
  dueDate: Date;
  principal: Decimal;
  interest: Decimal;
  amountDue: Decimal | null;
};

export type PlannedContract = {
  /** `contract_id` ของระบบเก่า */
  legacyId: string;
  /** เลขสัญญาเดิม → `Contract.legacyContractCode` และ `Contract.contractNumber` */
  code: string;
  kind: 'ACTIVE' | 'HISTORY';
  status: ContractStatus;
  /** วันที่ทำสัญญาเดิม → `createdAt` และ `deviceReceivedAt` */
  contractDate: Date;
  oldForm: boolean;
  memberCode: string;
  customer: LegacyCustomerInput;
  money: ContractMoney;
  /** วันครบกำหนดตามงวดแรก (ปฏิทินกรุงเทพ) */
  paymentDueDay: number | null;
  /** คู่ใบแจ้งหนี้ PEAK (ACTIVE มีเสมอ · HISTORY มีเมื่อจับคู่ได้) */
  peak: {
    invoiceCode: string;
    contactCode: string;
    remain: Decimal;
    /** PEAK − ระบบเก่า (≤ 0) ที่ `applyPeakBalance` ลงเป็นยอดจ่ายเพิ่ม (HISTORY = 0) */
    adjustment: Decimal;
    /** เศษสตางค์ที่ PEAK สูงกว่า (≤ 1.00) บวกเข้าค่างวดงวดสุดท้ายที่ยังค้าง (HISTORY = 0) */
    satangGap: Decimal;
    /** งวดที่รับเศษสตางค์ (`satangGap` = 0 → null) */
    satangGapInstallmentNo: number | null;
  } | null;
  product: PlannedProduct;
  /** ACTIVE: ทุกงวด · HISTORY: ว่าง */
  schedule: PlannedScheduleRow[];
  /** ACTIVE: ทุกงวด · HISTORY: เฉพาะงวดที่มียอดจ่าย — `paidDate` เติมแล้ว (ดูหัวไฟล์) */
  payments: PaymentDraft[];
  evidences: EvidenceDraft[];
  documents: DocumentDraft[];
  /** ACTIVE เท่านั้น */
  opening: OpeningResult | null;
  /** บัญชี − PEAK (ตารางเชื่อมยอด) · HISTORY = 0 */
  roundingDiff: Decimal;
  notes: string;
  warnings: string[];
  /** ทุก path ของไฟล์แนบ + สลิปที่ต้องอัปโหลด (ไม่ซ้ำ) */
  attachmentPaths: string[];
  /** path ที่ไม่อยู่ใน `ImportOptions.files` (ไม่ส่ง `files` = ว่าง) — ไม่ใช่ตัวบล็อก */
  missingAttachments: string[];
};

export type ImportTotals = {
  /** รวมกัน = จำนวนสัญญาใน book · `blocked` = สัญญาที่ไม่อยู่ใน `items` เพราะตัวบล็อก */
  contracts: { active: number; history: number; skipped: number; blocked: number };
  /** สถานะ BESTCHOICE → จำนวนสัญญาที่นำเข้า */
  byStatus: Record<string, number>;
  schedules: number;
  payments: number;
  evidences: number;
  documents: number;
  attachmentFiles: number;
  missingAttachments: number;
  markers: number;
  markerAmount: Decimal;
  /** ยอดสุทธิ Dr − Cr ต่อบัญชีของรายการยกมาทุกสัญญา */
  openingByAccount: Record<string, Decimal>;
  catchUpVat: Decimal;
  /** Σ(`amountDue − amountPaid`) ของงวดสัญญา ACTIVE (= Σ PEAK remain เมื่อทุกสัญญาผ่าน) */
  outstanding: Decimal;
  peakRemain: Decimal;
  peakAdjustment: Decimal;
  /** Σ เศษสตางค์ที่บวกเข้าค่างวดตามใบแจ้งหนี้ PEAK (ตารางเชื่อมยอด) */
  satangGap: Decimal;
  satangGapContracts: number;
  roundingDiff: Decimal;
  roundingContracts: number;
  /** งวด PAID ที่ใช้วันตัดเป็นวันชำระ */
  paidDateFromCutoff: number;
};

export type ImportPlan = {
  cutoff: Date;
  /** วันที่ของรายการไล่ VAT = 00:05 วันถัดจากวันตัด (กรุงเทพ) */
  catchUpAt: Date;
  /** เรียงตามวันที่ทำสัญญา แล้วเลขสัญญา */
  items: PlannedContract[];
  blockers: ImportBlocker[];
  /** เลขสัญญาฉบับเก่า (ทำสัญญาก่อน 2025-11-14) ของสัญญาผ่อนอยู่ — รายชื่อให้พนักงาน/เจ้าของเทียบกระดาษ */
  oldFormCodes: string[];
  skipped: Array<{ code: string; reason: string }>;
  /** ข้อเตือนทุกสัญญา (ไม่ใช่ตัวบล็อก) */
  warnings: string[];
  totals: ImportTotals;
};

/** ตัวบล็อกที่ทำให้สัญญาหยุด — โยนภายในแล้วเก็บเป็นแถว */
class Blocked extends Error {
  constructor(readonly row: ImportBlocker) {
    super(row.reason);
  }
}

const block = (code: string, reason: ImportBlockerReason, detail?: Record<string, string>) =>
  new Blocked(detail ? { code, reason, detail } : { code, reason });

/** ชื่อคลาส/รหัสของ error ที่ไม่ได้คาดไว้ — ไม่ใช้ข้อความ (อาจมีค่าในแถว) */
function errorLabel(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  const name = error instanceof Error ? error.name || error.constructor?.name : 'Error';
  return typeof code === 'string' ? `${name}:${code}` : name;
}

function text(row: DumpRow, column: string): string | null {
  const value = row[column]?.trim();
  return value ? value : null;
}

/** `product_type` (สินค้ามือ1,2 และ 3=จำนำ iCloud) → หมวดสินค้า */
function productCategory(c: LegacyContract, warnings: string[]): ProductCategory {
  const type = text(c.detail, 'product_type');
  if (type === '1') return 'PHONE_NEW';
  if (type === '2') return 'PHONE_USED';
  warnings.push(
    `สัญญา ${c.code}: ประเภทสินค้า product_type=${type ?? 'NULL'} ไม่ใช่มือ 1/มือ 2 — นำเข้าเป็นมือสอง`,
  );
  return 'PHONE_USED';
}

function planProduct(c: LegacyContract, kind: 'ACTIVE' | 'HISTORY', warnings: string[]) {
  const imei = text(c.detail, 'mobile_imei');
  if (!imei) warnings.push(`สัญญา ${c.code}: ไม่มี IMEI ในระบบเก่า`);
  const name = text(c.detail, 'ref_product_name') ?? `เครื่องจากระบบเก่า ${c.code}`;
  return {
    legacyProductCode: `${c.code}/${imei ?? 'NO-IMEI'}`,
    name,
    brand: text(c.detail, 'ref_product_brand') ?? 'ไม่ระบุ',
    model: name,
    color: text(c.detail, 'ref_product_color'),
    storage: text(c.detail, 'ref_product_storage'),
    category: productCategory(c, warnings),
    imeiSerial: kind === 'ACTIVE' ? imei : null,
    serialNumber: text(c.detail, 'mobile_serial_no'),
  } satisfies PlannedProduct;
}

/** ยอดของระบบเก่าเป็น float — ปัด 2 ตำแหน่งก่อนเทียบกับ PEAK (เศษต่ำกว่าสตางค์ทำให้ `PEAK_HIGHER` ปลอม) */
function roundInstallments(inst: readonly LegacyInstallment[]): LegacyInstallment[] {
  return inst.map((i) => ({
    ...i,
    amount: dRound(i.amount),
    paid: dRound(i.paid),
    balance: dRound(i.balance),
  }));
}

function contractNotes(
  c: LegacyContract,
  money: ContractMoney,
  oldForm: boolean,
  peak: PlannedContract['peak'],
): string {
  const lines: string[] = [];
  if (oldForm) lines.push(OLD_FORM_NOTE);
  const admin = text(c.order, 'created_by');
  lines.push(
    [
      `ยกมาจากระบบเก่า (backoffice) · สัญญาเดิม ${c.code}`,
      `ทำสัญญา ${bangkokDateString(c.createdAt)}`,
      ...(admin ? [`แอดมินเดิม ${admin}`] : []),
    ].join(' · '),
  );
  lines.push(
    `ยอดจัดเดิม ${formatMoney(money.financedAmount)} · ดอกเบี้ยเดิม ${formatMoney(money.interestTotal)}` +
      ` · ค่าคอม ${formatMoney(money.storeCommission)} · VAT ${formatMoney(money.vatAmount)}`,
  );
  if (peak && !peak.adjustment.isZero()) {
    lines.push(
      `ยอดค้างปรับตามใบแจ้งหนี้ PEAK ${peak.invoiceCode} (${formatMoney(peak.adjustment)})`,
    );
  }
  if (peak && peak.satangGap.gt(0)) {
    lines.push(
      `ค่างวด ${peak.satangGapInstallmentNo} รวมเศษสตางค์ ${formatMoney(peak.satangGap)} ตามยอดผ่อนรวมในใบแจ้งหนี้ PEAK ${peak.invoiceCode}`,
    );
  }
  if (c.close) {
    lines.push(
      `ปิดบัญชีก่อนกำหนดในระบบเก่า ${bangkokDateString(c.close.createdAt)} · ยอด ${formatMoney(
        dRound(c.close.amount),
      )} · ส่วนลด ${formatMoney(dRound(c.close.discount))}`,
    );
  }
  return lines.join('\n');
}

/** งวด PAID ที่ไม่มีวันชำระ → วันตัด + หมายเหตุ */
function withPaidDates(payments: PaymentDraft[], cutoff: Date): PaymentDraft[] {
  return payments.map((p) =>
    p.status === 'PAID' && p.paidDate === null
      ? { ...p, paidDate: cutoff, notes: `${p.notes} · ${NO_PAID_DATE_NOTE}` }
      : p,
  );
}

const sumOf = (values: readonly Decimal[]) => values.reduce((s, v) => s.plus(v), ZERO);

type Accounting = Pick<
  PlannedContract,
  'money' | 'peak' | 'schedule' | 'payments' | 'evidences' | 'opening' | 'roundingDiff' | 'status'
>;

function planActive(
  c: LegacyContract,
  money: ContractMoney,
  opts: ImportOptions,
  warnings: string[],
): Accounting {
  const mismatches = checkInstallmentAmounts(money, c.installments);
  if (mismatches.length > 0) {
    throw block(c.code, 'INSTALLMENT_AMOUNT_MISMATCH', {
      installmentNos: mismatches.map((m) => m.installmentNo).join(','),
      override: opts.moneyOverrides.has(c.code) ? 'yes' : 'no',
    });
  }

  const match = opts.peakRecon.matched.get(c.contractId);
  if (!match) throw block(c.code, 'PEAK_UNMATCHED');
  if (match.note === 'imei-mismatch') {
    warnings.push(
      `สัญญา ${c.code}: คู่ใบแจ้งหนี้ PEAK ${match.invoice.invoiceCode} ที่กำหนดเอง IMEI ไม่ตรงกัน`,
    );
  }
  const remain = match.invoice.remainAmount;
  if (remain.isNegative()) {
    throw block(c.code, 'PEAK_NEGATIVE_REMAIN', { invoiceCode: match.invoice.invoiceCode });
  }
  const rounded = roundInstallments(c.installments);
  const balanced = applyPeakBalance(rounded, remain);
  if ('blocked' in balanced) {
    throw block(c.code, 'PEAK_HIGHER', {
      invoiceCode: match.invoice.invoiceCode,
      diff: formatMoney(balanced.diff),
    });
  }
  const installments = balanced.installments;
  const adjusted: LegacyContract = { ...c, installments };

  const schedule = buildImportSchedule(c.contractId, money, installments, c.createdAt).map(
    (row) => ({
      installmentNo: row.installmentNo,
      dueDate: row.dueDate as Date,
      principal: new Prisma.Decimal(String(row.principal)),
      interest: new Prisma.Decimal(String(row.interest)),
      amountDue: row.amountDue == null ? null : new Prisma.Decimal(String(row.amountDue)),
    }),
  );

  const mapping = mapPayments(adjusted, 'ACTIVE', opts.cutoff);
  const blockWarning = mapping.warnings.find((w) => w.startsWith('BLOCK:'));
  if (blockWarning) {
    throw block(c.code, 'PAYMENTS_BLOCK', { message: blockWarning.replace(/^BLOCK:\s*/, '') });
  }
  warnings.push(...mapping.warnings);
  const nonPositive = mapping.payments.filter((p) => !p.amountDue.gt(0));
  if (nonPositive.length > 0) {
    throw block(c.code, 'INSTALLMENT_NONPOSITIVE', {
      installmentNos: nonPositive.map((p) => p.installmentNo).join(','),
    });
  }
  const overpaid = mapping.payments.filter((p) => p.amountPaid.gt(p.amountDue));
  if (overpaid.length > 0) {
    throw block(c.code, 'INSTALLMENT_OVERPAID', {
      installmentNos: overpaid.map((p) => p.installmentNo).join(','),
    });
  }

  const scheduleDue = new Map(schedule.map((row) => [row.installmentNo, row.dueDate]));
  let opening: OpeningResult;
  try {
    opening = computeOpening({
      money,
      installments: mapping.payments.map((p) => ({
        installmentNo: p.installmentNo,
        dueDate: scheduleDue.get(p.installmentNo) ?? p.dueDate,
        amountDue: p.amountDue,
        paid: p.amountPaid,
      })),
      cutoff: opts.cutoff,
      peakRemain: remain,
    });
  } catch (error) {
    if (error instanceof OpeningMismatchError) {
      throw block(c.code, 'OPENING_MISMATCH', {
        mismatch: error.reason,
        diff: formatMoney(error.diff),
        expectedRoundingDiff: formatMoney(error.expectedRoundingDiff),
        installmentNos: error.installmentNos.join(','),
      });
    }
    if (error instanceof OpeningInputError) {
      throw block(c.code, 'OPENING_INPUT_INVALID', { message: error.message });
    }
    throw error;
  }
  if (opening.openingLines.length === 0) throw block(c.code, 'ACTIVE_NOTHING_OUTSTANDING');

  // สถานะตามงวดหลังปรับตาม PEAK (กติกาเดียวกับ classify.ts) — งวดที่ PEAK ปิดให้ไม่ทำให้สัญญาค้าง
  const status = classifyContract(adjusted, opts.cutoff, opts.canceledMap).status as ContractStatus;
  return {
    money,
    status,
    peak: {
      invoiceCode: match.invoice.invoiceCode,
      contactCode: match.invoice.contactCode,
      remain,
      adjustment: balanced.adjustment,
      satangGap: balanced.satangGap,
      satangGapInstallmentNo: balanced.satangGap.gt(0)
        ? installments.findIndex((inst, i) => !inst.amount.eq(rounded[i].amount)) + 1
        : null,
    },
    schedule,
    payments: withPaidDates(mapping.payments, opts.cutoff),
    evidences: mapping.evidences,
    opening,
    roundingDiff: opening.roundingDiff,
  };
}

function planHistory(
  c: LegacyContract,
  money: ContractMoney,
  status: ContractStatus,
  opts: ImportOptions,
  warnings: string[],
): Accounting {
  const mapping = mapPayments(c, 'HISTORY', opts.cutoff);
  const blockWarning = mapping.warnings.find((w) => w.startsWith('BLOCK:'));
  if (blockWarning) {
    throw block(c.code, 'PAYMENTS_BLOCK', { message: blockWarning.replace(/^BLOCK:\s*/, '') });
  }
  warnings.push(...mapping.warnings);
  const match = opts.peakRecon.matched.get(c.contractId);
  // ปิดแล้วในระบบเก่าแต่ PEAK ยังมีลูกหนี้ = ตัวบล็อก (คำตัดสินผู้คุมงาน 29/10 — PEAK คือตัวตั้ง)
  if (match && match.invoice.remainAmount.gt(0)) {
    throw block(c.code, 'HISTORY_WITH_PEAK_REMAIN', {
      invoiceCode: match.invoice.invoiceCode,
      remain: formatMoney(match.invoice.remainAmount),
    });
  }
  if (match && match.invoice.remainAmount.isNegative()) {
    warnings.push(
      `สัญญา ${c.code}: ปิดแล้วในระบบเก่าแต่ใบแจ้งหนี้ PEAK ${match.invoice.invoiceCode} ยอดคงเหลือติดลบ — นำเข้าเป็นประวัติ ไม่มียอดยกมา`,
    );
  }
  return {
    money,
    status,
    peak: match
      ? {
          invoiceCode: match.invoice.invoiceCode,
          contactCode: match.invoice.contactCode,
          remain: match.invoice.remainAmount,
          adjustment: ZERO,
          satangGap: ZERO,
          satangGapInstallmentNo: null,
        }
      : null,
    schedule: [],
    payments: withPaidDates(mapping.payments, opts.cutoff),
    evidences: mapping.evidences,
    opening: null,
    roundingDiff: ZERO,
  };
}

/** แผนนำเข้าทั้ง book — ดูหัวไฟล์ */
export function planImport(book: LegacyBook, opts: ImportOptions): ImportPlan {
  const blockers: ImportBlocker[] = [];
  const skipped: ImportPlan['skipped'] = [];
  const oldFormCodes: string[] = [];
  const byCode = new Map(book.contracts.map((c) => [c.code, c]));

  // ── ไฟล์ของเจ้าของ: รหัสที่ไม่มีในระบบเก่า ──
  for (const [code] of opts.canceledMap) {
    const c = byCode.get(code);
    if (!c) {
      blockers.push({
        code,
        reason: 'CANCELED_MAP_UNKNOWN_CONTRACT',
        detail: { source: 'canceled-map' },
      });
    } else if (c.statusCode !== '4' && c.statusCode !== '5') {
      blockers.push({
        code,
        reason: 'CANCELED_MAP_NOT_CANCELED',
        detail: { source: 'canceled-map', legacyStatus: c.statusCode },
      });
    }
  }
  for (const [code] of opts.moneyOverrides) {
    if (!byCode.has(code)) {
      blockers.push({
        code,
        reason: 'MONEY_OVERRIDE_UNKNOWN_CONTRACT',
        detail: { source: 'money-overrides' },
      });
    }
  }
  const memberCodes = new Set<string>();
  for (const member of book.members.values()) {
    const memberCode = text(member, 'member_code');
    if (memberCode) memberCodes.add(memberCode);
  }
  for (const [memberCode] of opts.customerOverrides) {
    if (!memberCodes.has(memberCode)) {
      blockers.push({
        code: memberCode,
        reason: 'CUSTOMER_OVERRIDE_UNKNOWN_MEMBER',
        detail: { source: 'customer-overrides' },
      });
    }
  }

  // ── จัดประเภท · คำสั่งซื้อล่าสุดของสมาชิก (ในบรรดาสัญญาที่นำเข้า) ──
  const classified = book.contracts.map((c) => ({
    c,
    cls: classifyContract(c, opts.cutoff, opts.canceledMap),
  }));
  const latestOrder = new Map<string, LegacyContract>();
  for (const { c, cls } of classified) {
    if (cls.kind === 'SKIP') continue;
    const member = text(c.order, 'ref_member') ?? '';
    const current = latestOrder.get(member);
    if (!current || c.createdAt.getTime() > current.createdAt.getTime()) latestOrder.set(member, c);
  }

  const items: PlannedContract[] = [];
  const peakCodes: PeakCodeRequest[] = [];
  for (const { c, cls } of classified) {
    if (cls.kind === 'SKIP') {
      if (cls.reason === 'canceled-unconfirmed') {
        blockers.push({
          code: c.code,
          reason: 'CANCELED_UNCONFIRMED',
          detail: { legacyStatus: c.statusCode },
        });
      } else {
        skipped.push({ code: c.code, reason: cls.reason ?? 'skip' });
      }
      continue;
    }
    const kind = cls.kind;
    const oldForm = isOldForm(c);
    if (kind === 'ACTIVE' && oldForm) oldFormCodes.push(c.code);
    const warnings: string[] = [];
    const contractBlockers: ImportBlocker[] = [];

    // ลูกค้า — ตรวจแยกจากฝั่งบัญชี
    const memberId = text(c.order, 'ref_member') ?? '';
    const member = book.members.get(memberId);
    let customer: LegacyCustomerInput | null = null;
    let memberCode = '';
    if (!member) {
      contractBlockers.push({ code: c.code, reason: 'MEMBER_NOT_FOUND' });
    } else {
      try {
        customer = toLegacyCustomerInput(member, (latestOrder.get(memberId) ?? c).order, {
          peakContactCode: opts.peakRecon.matched.get(c.contractId)?.invoice.contactCode ?? null,
          overrides: opts.customerOverrides,
        });
        memberCode = customer.legacyMemberCode;
        if (customer.peakContactCode) {
          peakCodes.push({
            code: c.code,
            memberCode,
            peakCode: customer.peakContactCode,
            date: c.createdAt.getTime(),
          });
        }
        if (
          !customer.overrideCustomerId &&
          (!customer.nationalId || !isValidThaiNationalId(customer.nationalId))
        ) {
          contractBlockers.push({
            code: c.code,
            reason: 'CUSTOMER_INVALID_NATIONAL_ID',
            detail: { memberCode },
          });
        }
        if (customer.phoneInvalid) {
          warnings.push(
            `สัญญา ${c.code}: สมาชิก ${memberCode} มีเบอร์ในระบบเก่าแต่ผิดรูปแบบ — นำเข้าแบบไม่มีเบอร์`,
          );
        }
      } catch (error) {
        contractBlockers.push({
          code: c.code,
          reason: 'CUSTOMER_INPUT_INVALID',
          detail: { message: error instanceof Error ? error.message : String(error) },
        });
      }
    }

    // บัญชี
    let accounting: Accounting | null = null;
    try {
      let money: ContractMoney;
      try {
        money = mapContractMoney(c, opts.moneyOverrides.get(c.code));
      } catch (error) {
        if (error instanceof LegacyMoneyError) {
          throw block(c.code, 'LEGACY_MONEY_INVALID', { fields: error.fields.join(',') });
        }
        throw block(c.code, 'MONEY_READ_ERROR', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
      accounting =
        kind === 'ACTIVE'
          ? planActive(c, money, opts, warnings)
          : planHistory(c, money, cls.status as ContractStatus, opts, warnings);
    } catch (error) {
      contractBlockers.push(
        error instanceof Blocked
          ? error.row
          : { code: c.code, reason: 'PLAN_ERROR', detail: { error: errorLabel(error) } },
      );
    }

    if (contractBlockers.length > 0 || !accounting || !customer) {
      blockers.push(...contractBlockers);
      continue;
    }

    const documents = mapContractDocuments(c);
    const attachmentPaths = [
      ...new Set([...documents.map((d) => d.path), ...accounting.evidences.map((e) => e.slipPath)]),
    ];
    const files = opts.files;
    const firstDue = c.installments[0]?.dueDate;
    items.push({
      legacyId: c.contractId,
      code: c.code,
      kind,
      status: accounting.status,
      contractDate: c.createdAt,
      oldForm,
      memberCode,
      customer,
      money: accounting.money,
      paymentDueDay: firstDue ? bangkokCalendarParts(firstDue).day : null,
      peak: accounting.peak,
      product: planProduct(c, kind, warnings),
      schedule: accounting.schedule,
      payments: accounting.payments,
      evidences: accounting.evidences,
      documents,
      opening: accounting.opening,
      roundingDiff: accounting.roundingDiff,
      notes: contractNotes(c, accounting.money, oldForm, accounting.peak),
      warnings,
      attachmentPaths,
      missingAttachments: files ? attachmentPaths.filter((p) => !files.has(p)) : [],
    });
  }

  items.sort(
    (a, b) =>
      a.contractDate.getTime() - b.contractDate.getTime() ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
  );
  const kept = crossContractBlockers(items, blockers, peakCodes);

  return {
    cutoff: opts.cutoff,
    catchUpAt: new Date(bangkokStartOfDay(opts.cutoff).getTime() + DAY_MS + CATCH_UP_OFFSET_MS),
    items: kept,
    blockers,
    oldFormCodes,
    skipped,
    warnings: kept.flatMap((i) => i.warnings),
    totals: totalsOf(kept, skipped.length, book.contracts.length - kept.length - skipped.length),
  };
}

/** รหัส PEAK ที่สัญญาหนึ่งจะตั้งให้ลูกค้า — เก็บจากทุกสัญญาที่นำเข้า (รวมที่ติดตัวบล็อกอื่น) */
type PeakCodeRequest = { code: string; memberCode: string; peakCode: string; date: number };

/**
 * ตัวบล็อกที่ต้องเห็นหลายสัญญาพร้อมกัน — คืนรายการที่เหลือ:
 * รหัส PEAK ของสมาชิกเดียวกันไม่ตรงกัน (นับทุกสัญญาที่นำเข้า แม้ติดตัวบล็อกอื่น — สัญญาแรกตามวันที่ทำสัญญาตั้งรหัส
 * ตัวอื่นที่ต่างเป็นตัวบล็อก) · IMEI ซ้ำระหว่าง ACTIVE ·
 * รหัสงวดเดิมซ้ำ (`Payment.legacyInstallmentCode` unique ทั้งตาราง)
 */
function crossContractBlockers(
  items: PlannedContract[],
  blockers: ImportBlocker[],
  peakCodes: readonly PeakCodeRequest[],
): PlannedContract[] {
  const out = new Set<PlannedContract>();
  const itemByCode = new Map(items.map((i) => [i.code, i]));
  const firstPeakCode = new Map<string, string>();
  for (const request of [...peakCodes].sort((a, b) => a.date - b.date)) {
    const first = firstPeakCode.get(request.memberCode);
    if (first === undefined) firstPeakCode.set(request.memberCode, request.peakCode);
    else if (first !== request.peakCode) {
      blockers.push({
        code: request.code,
        reason: 'CUSTOMER_PEAK_CODE_CONFLICT',
        detail: {
          memberCode: request.memberCode,
          peakContactCode: request.peakCode,
          otherPeakContactCode: first,
        },
      });
      const item = itemByCode.get(request.code);
      if (item) out.add(item);
    }
  }

  const duplicates = <K>(key: (item: PlannedContract) => K[]) => {
    const holders = new Map<K, PlannedContract[]>();
    for (const item of items) {
      for (const k of key(item)) {
        const list = holders.get(k);
        if (list) list.push(item);
        else holders.set(k, [item]);
      }
    }
    return [...holders.entries()].filter(([, list]) => list.length > 1);
  };
  for (const [imei, holders] of duplicates((i) =>
    i.product.imeiSerial ? [i.product.imeiSerial] : [],
  )) {
    for (const item of holders) {
      blockers.push({
        code: item.code,
        reason: 'DUPLICATE_ACTIVE_IMEI',
        detail: { imei, contracts: holders.map((h) => h.code).join(',') },
      });
      out.add(item);
    }
  }
  for (const [installmentCode, holders] of duplicates((i) =>
    i.payments.map((p) => p.legacyInstallmentCode),
  )) {
    for (const item of new Set(holders)) {
      blockers.push({
        code: item.code,
        reason: 'DUPLICATE_INSTALLMENT_CODE',
        detail: { installmentCode },
      });
      out.add(item);
    }
  }
  return items.filter((item) => !out.has(item));
}

function totalsOf(items: PlannedContract[], skipped: number, blocked: number): ImportTotals {
  const byStatus: Record<string, number> = {};
  const openingByAccount: Record<string, Decimal> = {};
  let markers = 0;
  let markerAmount = ZERO;
  let catchUpVat = ZERO;
  let outstanding = ZERO;
  let peakRemain = ZERO;
  let peakAdjustment = ZERO;
  let satangGap = ZERO;
  let satangGapContracts = 0;
  let roundingDiff = ZERO;
  let roundingContracts = 0;
  let paidDateFromCutoff = 0;
  for (const item of items) {
    byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
    paidDateFromCutoff += item.payments.filter((p) => p.notes.endsWith(NO_PAID_DATE_NOTE)).length;
    if (item.kind !== 'ACTIVE' || !item.opening || !item.peak) continue;
    for (const line of item.opening.openingLines) {
      openingByAccount[line.accountCode] = (openingByAccount[line.accountCode] ?? ZERO)
        .plus(line.dr)
        .minus(line.cr);
    }
    markers += item.opening.priorReceiptMarkers.length;
    markerAmount = markerAmount.plus(sumOf(item.opening.priorReceiptMarkers.map((m) => m.amount)));
    catchUpVat = catchUpVat.plus(
      sumOf(item.opening.catchUpLines.filter((l) => l.accountCode === '21-2101').map((l) => l.cr)),
    );
    outstanding = outstanding.plus(
      sumOf(item.payments.map((p) => p.amountDue.minus(p.amountPaid))),
    );
    peakRemain = peakRemain.plus(item.peak.remain);
    peakAdjustment = peakAdjustment.plus(item.peak.adjustment);
    satangGap = satangGap.plus(item.peak.satangGap);
    if (item.peak.satangGap.gt(0)) satangGapContracts++;
    roundingDiff = roundingDiff.plus(item.roundingDiff);
    if (!item.roundingDiff.isZero()) roundingContracts++;
  }
  const active = items.filter((i) => i.kind === 'ACTIVE').length;
  return {
    contracts: { active, history: items.length - active, skipped, blocked },
    byStatus,
    schedules: sumCount(items, (i) => i.schedule.length),
    payments: sumCount(items, (i) => i.payments.length),
    evidences: sumCount(items, (i) => i.evidences.length),
    documents: sumCount(items, (i) => i.documents.length),
    attachmentFiles: new Set(items.flatMap((i) => i.attachmentPaths)).size,
    missingAttachments: new Set(items.flatMap((i) => i.missingAttachments)).size,
    markers,
    markerAmount,
    openingByAccount,
    catchUpVat,
    outstanding,
    peakRemain,
    peakAdjustment,
    satangGap,
    satangGapContracts,
    roundingDiff,
    roundingContracts,
    paidDateFromCutoff,
  };
}

function sumCount(items: PlannedContract[], count: (item: PlannedContract) => number): number {
  return items.reduce((n, item) => n + count(item), 0);
}
