import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * รายงานอายุลูกหนี้-หน้าร้าน 11-2107 / S21-3001 (Phase 4 — spec §6 ข้อ 1).
 *
 * SQL ในไฟล์นี้เป็น grouped twins ของ helper ต่อสัญญาใน
 * `interco-typed-balance.ts` และเลนส์ใน `interco-pending.service.ts` —
 * เงื่อนไข type ต้องตรงกันทุกตัวอักษร (แก้ที่ไหนแก้ทุกที่ — เงื่อนไข SWAP_CREDIT
 * ฝั่ง 11-2107 มี 4 จุด: swapCreditFinanceBalance, เลนส์ต่อสัญญา + glSwapCreditTotal
 * ใน interco-pending.service.ts, และ SWAP_COND ในไฟล์นี้):
 *   - 11-2107 SWAP_CREDIT   = explicit stamp **ชนะ**, flow เป็น fallback (ไม่ใช่ OR):
 *                             stamp = SWAP_CREDIT, หรือไม่มี/ไม่รู้จัก stamp แล้ว
 *                             flow = 'exchange-buyback-receivable-11-2107' (legacy A.3)
 *   - 11-2107 PAYOUT_RECALL = explicit stamp เท่านั้น (type ใหม่ ไม่มี legacy)
 *   - 11-2107 SHOP_COLLECT  = explicit stamp ชนะ; ไม่มี stamp → flow/collectedByShop fallback
 *   - S21-3001 SWAP_CREDIT  key ด้วย metadata.newContractId (A.4 stamp)
 *   - S21-3001 PAYOUT_RECALL key ด้วย metadata.contractId (C-2 redirect / cash settle SHOP leg)
 *
 * ยอด "คงเหลือจริง" ของกลุ่มระหว่างกิจการ = typed gross ทั้งสองประเภทรวมกัน
 * ลบ Σ deduction ของ item ใน batch POSTED (สถาปัตยกรรม gross-lens: ขา Cr ของ
 * batch ไม่ stamp type/contractId จึงไม่ลด typed balance) — invariant ถือที่ระดับ
 * สัญญา ไม่ใช่ระดับประเภท (สัญญา swap ที่ถูกยกเลิกมีประวัติข้ามประเภท).
 */
export interface ShopReceivableAgingRow {
  contractId: string;
  contractNumber: string;
  customerName: string;
  /** 11-2107 typed SWAP_CREDIT gross (Dr−Cr) ของสัญญา */
  swapCreditGross: Prisma.Decimal;
  /** 11-2107 typed PAYOUT_RECALL gross (Dr−Cr) ของสัญญา */
  payoutRecallGross: Prisma.Decimal;
  /** Σ (swapCreditAmount + recallAmount) ของ item ทุก itemType ใน batch POSTED */
  settledDeduction: Prisma.Decimal;
  /** ยอดกลุ่มระหว่างกิจการคงเหลือจริง = swapCreditGross + payoutRecallGross − settledDeduction */
  intercoNet: Prisma.Decimal;
  /** 11-2107 typed SHOP_COLLECT (Dr−Cr) — เงินลูกค้าที่หน้าร้านรับแทน แยกคอลัมน์ ไม่ปนกลุ่ม interco */
  shopCollect: Prisma.Decimal;
  /**
   * S21-3001 (Cr−Dr, conditional key) **ก่อนหัก deduction** — ยอดดิบของสมุด
   * SHOP. ใช้ตัดสิน "สมุดเดียว" (S21-3001 = 0) ตรงๆ โดยไม่ให้ deduction ของ
   * รอบจ่ายมาบังตัวเลข: `shopMirrorNet` ของสัญญาที่ถูกหักครบพอดีก็เป็น 0
   * เหมือนกัน แต่นั่นคือ "หักแล้ว" ไม่ใช่ "ไม่เคยมีขาคู่" (reconcile cron
   * Task 4 — SWAP_CREDIT_ONE_BOOK).
   */
  shopMirrorGross: Prisma.Decimal;
  /** S21-3001 (Cr−Dr, conditional key) − settledDeduction — กระจกฝั่ง SHOP ของ intercoNet */
  shopMirrorNet: Prisma.Decimal;
  /** MIN(posted_at) ของ JE ที่มีขา Dr บน 11-2107 typed (กลุ่ม interco) */
  intercoOldestPostedAt: Date | null;
  intercoAgeDays: number | null;
  shopCollectOldestPostedAt: Date | null;
  shopCollectAgeDays: number | null;
  /** |intercoNet − shopMirrorNet| > 0.01 — สองสมุดไม่ตรง (SHOP_COLLECT ไม่นับ: FINANCE-side-only) */
  bookMismatch: boolean;
  /**
   * Σ(Dr−Cr) ของบรรทัด 11-2107 ยุค legacy — flow
   * 'exchange-buyback-receivable-11-2107' โดย **ไม่มี** explicit stamp
   * (A.3 ก่อน Phase 1; ทุกใบยุค Phase 1+ รวม mirror มี stamp เสมอ).
   */
  legacySwapGross: Prisma.Decimal;
  /**
   * true = swap ยุค legacy สมุดเดียว (มีบรรทัด legacy ∧ S21-3001 = 0) —
   * spec §11.4 ถือเป็น**สภาพปกติ** ไม่ใช่ anomaly (pending lens โมเดลเป็น
   * `swapCreditEligible = false`): เครดิตของมันล้างผ่าน shop-collect ซึ่ง
   * stamp SHOP_COLLECT ⇒ typed columns ของแถวนี้ค้าง +/− ถาวรแม้ยอดบัญชีจริง
   * เป็น 0. `bookMismatch` ยังรายงานตามคณิตศาสตร์ (สองสมุดต่างกันจริง) —
   * flag นี้คือตัวแยกบริบทให้ Tasks 3/4 ใช้ label/ระงับ alert แทนเตือนแดง.
   */
  legacyOneBook: boolean;
}

export interface ShopReceivableAgingResult {
  /** เฉพาะสัญญาที่ intercoNet > 0.01 หรือ shopCollect > 0.01 หรือ bookMismatch */
  rows: ShopReceivableAgingRow[];
  asOf: Date;
  /**
   * intercoNet/shopCollect/overdueCount **ไม่รวมแถว `legacyOneBook`** —
   * typed columns ของแถว legacy โกหกเชิงประเภท (แถวผี +8,000/−8,000 บนสัญญา
   * ที่ยอดจริงเป็น 0 หลัง settle ผ่าน shop-collect) จึงห้ามปนกับหนี้ typed จริง.
   * หนี้ legacy ที่ยังค้างจริงไม่ถูกซ่อน: รายงานแยกใน `legacyOneBookNet` =
   * Σ(intercoNet + shopCollect) ต่อแถว legacy — สูตรนี้คือยอด 11-2107 จริง
   * ระดับสัญญา (legacy ยังไม่ล้าง = ยอดเต็ม, ล้างครบแล้ว = 0 พอดี).
   */
  totals: {
    intercoNet: Prisma.Decimal;
    shopCollect: Prisma.Decimal;
    overdueCount: number;
    legacyOneBookNet: Prisma.Decimal;
  };
}

/**
 * คู่เจ้าหนี้/ลูกหนี้รอบจ่ายต่อสัญญา (Phase 4 Task 4 — reconcile cron):
 * FINANCE 21-1101+21-1102 (Cr−Dr) ต้องเท่ากับ SHOP S11-3001+S11-3002 (Dr−Cr)
 * เสมอสำหรับสัญญายุคที่มีสมุด SHOP — รอบจ่ายล้างสองขาพร้อมกันด้วยยอดเดียวกัน
 * และขาล้างของ batch **ไม่ stamp contractId** ทั้งคู่ ⇒ เลนส์ทั้งสองฝั่งค้าง
 * ที่ยอด gross เหมือนกันตลอดอายุสัญญา (ต่างกัน = มีมือมาแก้ข้างเดียว).
 */
export interface PayablePairRow {
  contractId: string;
  contractNumber: string;
  customerName: string;
  /** 21-1101 (Cr−Dr) — เจ้าหนี้ยอดจัด */
  financedGl: Prisma.Decimal;
  /** 21-1102 (Cr−Dr) — เจ้าหนี้ค่าคอม */
  commissionGl: Prisma.Decimal;
  /** S11-3001 (Dr−Cr) — ลูกหนี้ FINANCE ยอดจัด ฝั่ง SHOP */
  shopFinancedGl: Prisma.Decimal;
  /** S11-3002 (Dr−Cr) — ลูกหนี้ FINANCE ค่าคอม ฝั่ง SHOP */
  shopCommissionGl: Prisma.Decimal;
  /** สมุด SHOP ว่างทั้งคู่ = สัญญา activate ก่อน 2026-06-23 (นิยามเดียวกับ pending lens) */
  legacyNoShop: boolean;
  /** financedGl − shopFinancedGl (แยกขาเพื่อชี้ว่าความต่างอยู่ที่ยอดจัดหรือค่าคอม) */
  financedDiff: Prisma.Decimal;
  /**
   * commissionGl − shopCommissionGl. **รูปแบบที่รู้จัก**: สัญญาที่
   * `storeCommission` ว่าง — `ContractActivation1ATemplate` ตั้งค่าคอม
   * fallback 10% ของยอดจัดบน 21-1102 ส่วน `ShopInventoryTransferTemplate`
   * รับค่ามาเป็น 0 (`contract.storeCommission ?? 0`) ⇒ ค่าคอมโผล่สมุดเดียว.
   * นี่คือ **ความต่างจริงในบัญชี** (เงินที่ FINANCE จ่ายให้หน้าร้านโดยสมุด
   * SHOP ไม่เคยตั้งลูกหนี้ — opening-balance gap ตาม interco spec §11)
   * ไม่ใช่ artifact ของการอ่าน จึงรายงานตามจริงพร้อมป้ายกำกับให้คนอ่านรู้ทันที
   * ว่าเป็นรูปแบบไหน.
   */
  commissionDiff: Prisma.Decimal;
  /** (financedGl + commissionGl) − (shopFinancedGl + shopCommissionGl) */
  diff: Prisma.Decimal;
  /** true = ไม่ใช่ legacy และสองสมุดต่างกันเกิน 0.01 */
  mismatch: boolean;
}

/**
 * กระทบยอด **ระดับบัญชี** ของ 11-2107 / S21-3001 (Phase 4 Task 4).
 *
 * สถาปัตยกรรม gross-lens: ขาล้างของรอบจ่าย (`Cr 11-2107` / `Dr S21-3001`)
 * **ไม่ stamp type/contractId** โดยตั้งใจ ⇒ เลนส์ต่อสัญญาเห็นแต่ขาตั้งหนี้.
 * ดังนั้นสมการที่ต้องเป็นจริงเสมอคือ
 *
 *   ยอดบัญชีจริง = Σ บรรทัดที่เลนส์ classify ได้ − Σ deduction ของ batch POSTED
 *
 * ส่วนต่าง (`drift`) = บรรทัดที่ **ไม่มีเลนส์ไหนมองเห็น** — เช่น mirror ตอน
 * ยกเลิก swap ยุค legacy ที่ต้นฉบับไม่มี stamp (mirror จึงไม่ได้ copy อะไรเลย
 * และ flow เปลี่ยนเป็น 'exchange-cancel') หรือ hand-JV. เคสนั้นทำให้เลนส์
 * รายงาน "ค้าง" ทั้งที่บัญชีจริงเป็นศูนย์ — จับได้ที่นี่ที่เดียว.
 */
export interface TypedAccountDriftRow {
  accountCode: string;
  label: string;
  /** ยอดบัญชีจริงทั้งบัญชี (11-2107 = Dr−Cr, S21-3001 = Cr−Dr) */
  accountTotal: Prisma.Decimal;
  /** Σ บรรทัดที่เลนส์ typed classify ได้ (มี key สัญญา) */
  lensTotal: Prisma.Decimal;
  /** Σ (swapCreditAmount + recallAmount) ของ item ทุกใบใน batch POSTED */
  settledDeduction: Prisma.Decimal;
  /** lensTotal − settledDeduction */
  expected: Prisma.Decimal;
  /** accountTotal − expected */
  drift: Prisma.Decimal;
  /** |drift| > 0.01 */
  mismatch: boolean;
}

/** ยอดที่ติดลบหนึ่งช่อง — ลูกหนี้ติดลบไม่ใช่สภาพปกติของยุคใดทั้งสิ้น */
export interface NegativeTypedField {
  field: string;
  label: string;
  value: Prisma.Decimal;
}

const EPS = new Prisma.Decimal('0.01');
const DAY_MS = 86_400_000;

/**
 * ป้ายของแถวที่ hydrate สัญญาไม่ได้ — **ตัวเดียวกันทั้ง `buildAllRows` และ
 * `getPayablePairing`** (Phase 5 Task 5 ข้อ 3 / M1). GL ที่ไม่มีสัญญารองรับคือ
 * สิ่งที่ต้อง "เห็น" ไม่ใช่สิ่งที่ต้องซ่อน: ก่อนหน้านี้รายงานอายุ `continue`
 * ทิ้งเงียบ ๆ ⇒ ยอดนั้นหายจากทั้ง rows / totals / `getNegativeTypedRows`
 * เหลือช่องทางเดียวคือ drift ระดับบัญชี ซึ่ง **ไม่มีเลขสัญญา** ให้ตามต่อ.
 */
export const MISSING_CONTRACT_LABEL = '(ไม่พบสัญญา)';

/** แขนของหนี้ที่แก่เกินเกณฑ์ — ใช้ตั้ง label/วิธีล้างใน alert (Task 3) */
export type ShopReceivableOverdueArm = 'INTERCO' | 'SHOP_COLLECT';

/** ฟิลด์ขั้นต่ำที่ predicate ต้องใช้ (รับได้ทั้งแถวเต็มและ subset ในเทสต์) */
export type OverdueCheckable = Pick<
  ShopReceivableAgingRow,
  'intercoAgeDays' | 'intercoNet' | 'shopCollectAgeDays' | 'shopCollect'
>;

/**
 * เกณฑ์ "ค้างเกินกำหนด" — **แหล่งเดียวของทั้งระบบ**: `totals.overdueCount` ของ
 * service, cron แจ้งเตือนรายวัน (Task 3) และ reconcile cron (Task 4) ต้องเรียก
 * ฟังก์ชันนี้เท่านั้น ห้าม inline สูตรซ้ำ (drift = เตือนไม่ตรงกับที่รายงานโชว์).
 *
 * แขนของหนี้แยกกัน: กลุ่มระหว่างกิจการ (`intercoNet`, อายุจากวันตั้งหนี้ typed
 * SWAP_CREDIT/PAYOUT_RECALL) กับหน้าร้านรับเงินแทน (`shopCollect`) — ยอดต้อง
 * มากกว่า 0.01 คู่กับอายุถึงเกณฑ์เสมอ (แถวที่โผล่เพราะ `bookMismatch` แต่ยอด
 * เป็นศูนย์ ไม่ใช่หนี้ค้าง).
 *
 * **แถว `legacyOneBook` เป็นหน้าที่ของ caller ที่จะกันออก** — ฟังก์ชันนี้ไม่รู้จัก
 * บริบท legacy โดยตั้งใจ (คณิตศาสตร์ล้วน) และทั้ง `totals` ที่นี่กับ cron
 * กรอง `!legacyOneBook` ก่อนเรียกเหมือนกัน (spec §11.4 = สภาพปกติ ห้าม alert).
 */
export function overdueArms(row: OverdueCheckable, thresholdDays: number): ShopReceivableOverdueArm[] {
  const arms: ShopReceivableOverdueArm[] = [];
  if (row.intercoAgeDays !== null && row.intercoAgeDays >= thresholdDays && row.intercoNet.gt(EPS)) {
    arms.push('INTERCO');
  }
  if (
    row.shopCollectAgeDays !== null &&
    row.shopCollectAgeDays >= thresholdDays &&
    row.shopCollect.gt(EPS)
  ) {
    arms.push('SHOP_COLLECT');
  }
  return arms;
}

/** true = แถวนี้มีหนี้ค้างเกินเกณฑ์อย่างน้อยหนึ่งแขน (ดู jsdoc ของ `overdueArms`) */
export function isShopReceivableOverdue(row: OverdueCheckable, thresholdDays: number): boolean {
  return overdueArms(row, thresholdDays).length > 0;
}

/**
 * แถวที่ **รายงานอายุลูกหนี้** จะแสดง = "หนี้ที่ต้องไปตาม": มียอดค้างฝั่งใดฝั่งหนึ่ง
 * หรือสองสมุดไม่ตรงกัน. **แถวที่ทุกยอดเป็นศูนย์หรือติดลบล้วนถูกตัดออกโดยตั้งใจ** —
 * ยอดติดลบไม่ใช่หนี้ และถ้าปล่อยเข้ามาจะไปหักล้าง `totals` บนหัวแท็บ (บั๊กคลาส
 * เดียวกับ carry ก). ความผิดปกติเหล่านั้นมีช่องทางของตัวเองคือ
 * `getNegativeTypedRows()` → reconcile cron รายเดือน.
 */
export function isReportableAgingRow(row: ShopReceivableAgingRow): boolean {
  return row.intercoNet.gt(EPS) || row.shopCollect.gt(EPS) || row.bookMismatch;
}

/** เรียงอายุมากสุดก่อน (effective age = max ของสองกลุ่ม; ไม่มีวันที่ = ท้ายสุด) */
export function sortAgingRows(rows: ShopReceivableAgingRow[]): void {
  const effectiveAge = (r: ShopReceivableAgingRow) =>
    Math.max(r.intercoAgeDays ?? -1, r.shopCollectAgeDays ?? -1);
  rows.sort(
    (a, b) => effectiveAge(b) - effectiveAge(a) || a.contractNumber.localeCompare(b.contractNumber),
  );
}

/** ฟิลด์ขั้นต่ำของ predicate ยอดติดลบ */
export type NegativeCheckable = Pick<
  ShopReceivableAgingRow,
  'intercoNet' | 'shopCollect' | 'shopMirrorNet' | 'legacyOneBook'
>;

/**
 * ช่องที่ยอดติดลบบนแถวหนึ่ง — **แหล่งเดียว** ของนิยาม "over-settle"
 * (reconcile cron Task 4 เรียกตัวนี้ ห้ามเขียนสูตรซ้ำในไฟล์ cron).
 *
 * แถว `legacyOneBook` ใช้ **ยอดรวมระดับสัญญา** (`intercoNet + shopCollect`)
 * ไม่ใช่ทีละช่อง: swap ยุคก่อน Phase 1 ตั้งหนี้ในคอลัมน์ SWAP_CREDIT แต่ล้าง
 * ผ่านใบ shop-collect ซึ่ง stamp `SHOP_COLLECT` ⇒ ทุกแถว legacy ที่ล้างแล้ว
 * มี `shopCollect` ติดลบเป็นปกติ (spec §11.4) — เช็คทีละช่องคือ alert เท็จ
 * ถาวร. ยอดรวมของแถว legacy คือยอด 11-2107 จริงระดับสัญญา ติดลบเมื่อไร =
 * ล้างเกินจริง (และนั่นคือตัวที่ไปหักล้างหนี้ค้างจริงในผลรวมรายวันของ
 * `totals.legacyOneBookNet` จนเงียบ — carry ก ของ Task 3).
 *
 * แถวปกติเช็คทีละช่อง: `intercoNet` ติดลบ = หักในรอบจ่าย/รับเงินสดคืนเกิน,
 * `shopMirrorNet` ติดลบ = สมุด SHOP ถูกล้างเกิน, `shopCollect` ติดลบ =
 * เงินหน้าร้านรับแทนถูกรับคืนเกินยอดตั้ง (หรือใบ settle ไปล้างเครดิตคนละ
 * ประเภทผ่านประตู shop-collect — `ShopCollectSettlementTemplate` วัดยอด
 * ค้างจาก 11-2107 **ทั้งสัญญา** ไม่แยกประเภท จึงเกิดได้จริง).
 */
export function negativeTypedFields(row: NegativeCheckable): NegativeTypedField[] {
  const neg = EPS.negated();
  if (row.legacyOneBook) {
    const combined = row.intercoNet.plus(row.shopCollect);
    return combined.lt(neg)
      ? [
          {
            field: 'legacyCombinedNet',
            label: 'ยอด 11-2107 สุทธิของสัญญา (swap ยุคก่อน Phase 1)',
            value: combined,
          },
        ]
      : [];
  }
  const out: NegativeTypedField[] = [];
  if (row.intercoNet.lt(neg)) {
    out.push({ field: 'intercoNet', label: 'กลุ่มระหว่างกิจการ (11-2107)', value: row.intercoNet });
  }
  if (row.shopMirrorNet.lt(neg)) {
    out.push({ field: 'shopMirrorNet', label: 'กระจกฝั่ง SHOP (S21-3001)', value: row.shopMirrorNet });
  }
  if (row.shopCollect.lt(neg)) {
    out.push({ field: 'shopCollect', label: 'หน้าร้านรับเงินแทน (11-2107)', value: row.shopCollect });
  }
  return out;
}

/**
 * true = เครดิตเปลี่ยนเครื่องค้างอยู่ **สมุดเดียว** ทั้งที่เป็นยุคที่ต้องมีสองสมุด.
 *
 * `isPhase2Era` มาจาก `getPhase2SwapContractIds()` (มี JE `shop-exchange-return`
 * ที่ stamp `newContractId`) — swap ยุคก่อน Phase 1 (A.4 ลง `Cr S50-1102`
 * ไม่มี stamp) เป็น **สภาพปกติ** ตาม spec §11.4 จึงต้องไม่เข้าเงื่อนไขนี้เลย
 * (pending lens ก็โมเดลมันเป็น `swapCreditEligible = false` ไม่ใช่ error).
 *
 * ใช้ `shopMirrorGross` (ก่อนหัก deduction) — สัญญาที่ถูกหักครบพอดีมี
 * `shopMirrorNet = 0` เหมือนกันแต่มีขาคู่ครบ ไม่ใช่ anomaly.
 */
export function isSwapCreditOneBook(
  row: Pick<ShopReceivableAgingRow, 'swapCreditGross' | 'shopMirrorGross'>,
  isPhase2Era: boolean,
): boolean {
  return isPhase2Era && row.swapCreditGross.gt(EPS) && row.shopMirrorGross.abs().lte(EPS);
}

// --- Typed conditions — VERBATIM twins ของ interco-typed-balance.ts ---------
// (composed เป็น Prisma.sql fragment เพื่อใช้ซ้ำใน CASE หลายคอลัมน์ของ Query A)
// บรรทัด legacy = flow A.3 เดิมโดย **ไม่มี** explicit stamp ที่ valid — ใช้ตรวจ
// จับ swap ยุคก่อน Phase 1 เพื่อ flag `legacyOneBook` (Fix Round 1). ตั้งแต่
// Phase 4 Task 6 มันคือ **branch fallback ของ SWAP_COND ตรงๆ** (ประกาศก่อนแล้ว
// ประกอบเข้า SWAP_COND) — เขียนซ้ำสองที่เมื่อไหร่คือประตู drift.
const LEGACY_SWAP_COND = Prisma.sql`((je.metadata->>'shopReceivableType' IS NULL
              OR je.metadata->>'shopReceivableType' NOT IN
                 ('SWAP_CREDIT', 'PAYOUT_RECALL', 'SHOP_COLLECT'))
         AND je.metadata->>'flow' = 'exchange-buyback-receivable-11-2107')`;
// explicit stamp **ชนะ** flow fallback (Phase 4 Task 6) — mirror
// `classifyShopReceivable` ที่เช็ค EXPLICIT ก่อน FLOW_MAP เหมือนที่
// SHOP_COLLECT_COND ทำอยู่แล้ว. ไม่งั้น JE รูป A.3 ที่ stamp ประเภทอื่นจะถูกนับ
// ทั้ง swap_gross และ recall_gross/shop_collect พร้อมกัน ⇒ intercoNet บวมเท่าตัว
const SWAP_COND = Prisma.sql`(je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
         OR ${LEGACY_SWAP_COND})`;
const RECALL_COND = Prisma.sql`(je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL')`;
const SHOP_COLLECT_COND = Prisma.sql`(je.metadata->>'shopReceivableType' = 'SHOP_COLLECT'
         OR ((je.metadata->>'shopReceivableType' IS NULL
              OR je.metadata->>'shopReceivableType' NOT IN
                 ('SWAP_CREDIT', 'PAYOUT_RECALL', 'SHOP_COLLECT'))
             AND (je.metadata->>'collectedByShop' = 'true'
                  OR je.metadata->>'shopReceivable' = '11-2107'
                  OR je.metadata->>'flow' = 'shop-collect-settlement')))`;

// Group key ของ S21-3001 — แบบมีเงื่อนไข (jsdoc ด้านบน): SWAP_CREDIT key ด้วย
// newContractId (A.4 stamp — contractId บนใบนั้นคือสัญญาเก่า), ประเภทอื่น key
// ด้วย contractId. เขียนพลาดเป็น key เดียว = double-count/แถวผี — ด่านจับคือ
// เทสเคส (b) ที่สัญญาเดียวมีทั้งสองประเภท.
const SHOP_KEY = Prisma.sql`CASE WHEN je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
         THEN je.metadata->>'newContractId'
         ELSE je.metadata->>'contractId' END`;

interface FinanceAgingRow {
  contract_id: string | null;
  swap_gross: unknown;
  recall_gross: unknown;
  shop_collect: unknown;
  legacy_swap_gross: unknown;
  interco_oldest: Date | null;
  collect_oldest: Date | null;
}

@Injectable()
export class IntercoAgingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * รายงานอายุลูกหนี้ต่อสัญญา — engine กลางของ Phase 4: Task 2 (endpoint),
   * Task 3 (daily cron), Task 4 (reconcile cron) เรียก method นี้ตัวเดียว
   * ห้ามคำนวณเอง.
   *
   * จำนวน query **คงที่** (4 ครั้ง — ไม่ขึ้นกับจำนวนสัญญา): Query A รวม 3
   * typed sums + 2 MIN(posted_at) ของ 11-2107 ใน CASE เดียว, Query B รวม
   * S21-3001 สองประเภทด้วย conditional group key, Query C = deductions
   * groupBy, Query D = hydrate contract. ห้าม refactor กลับไปเรียก helper
   * ต่อสัญญาในลูป (N×5).
   *
   * `asOf` ใช้คำนวณอายุเท่านั้น — ยอดคงเหลือเป็นยอดปัจจุบันเสมอ (ตรงกับ
   * twins ใน interco-typed-balance.ts ที่ไม่มี date filter; deduction gate
   * อ่านสถานะ batch ปัจจุบันซึ่ง time-travel ไม่ได้อยู่แล้ว).
   */
  async getShopReceivableAging(
    asOf: Date = new Date(),
    thresholdDays = 30,
  ): Promise<ShopReceivableAgingResult> {
    const rows = (await this.buildAllRows(asOf)).filter(isReportableAgingRow);
    sortAgingRows(rows);
    const zero = new Prisma.Decimal(0);

    // เกณฑ์ overdue อยู่ที่ `isShopReceivableOverdue` (module scope) — cron
    // Task 3/4 เรียกตัวเดียวกัน ห้ามมีสำเนาที่สอง
    const isOverdue = (r: ShopReceivableAgingRow) => isShopReceivableOverdue(r, thresholdDays);

    // totals กันแถว legacyOneBook ออก (ดู jsdoc บน interface): typed columns
    // ของแถว legacy โกหกเชิงประเภท — หนี้ legacy จริงรายงานแยกใน
    // legacyOneBookNet (= ยอด 11-2107 จริงระดับสัญญา ไม่ซ่อนหนี้). overdue ก็
    // ไม่นับแถว legacy — เป็น label ไม่ใช่ alert (Tasks 3/4).
    const nonLegacyRows = rows.filter((r) => !r.legacyOneBook);
    const legacyRows = rows.filter((r) => r.legacyOneBook);

    return {
      rows,
      asOf,
      totals: {
        intercoNet: nonLegacyRows.reduce((s, r) => s.plus(r.intercoNet), zero),
        shopCollect: nonLegacyRows.reduce((s, r) => s.plus(r.shopCollect), zero),
        overdueCount: nonLegacyRows.filter(isOverdue).length,
        legacyOneBookNet: legacyRows.reduce(
          (s, r) => s.plus(r.intercoNet).plus(r.shopCollect),
          zero,
        ),
      },
    };
  }

  /**
   * แถวที่มี **ยอดติดลบ** อย่างน้อยหนึ่งช่อง (นิยามใน `negativeTypedFields`) —
   * ตาข่ายของ reconcile cron รายเดือน. **จงใจไม่ใช้ `getShopReceivableAging`**
   * เพราะรายงานนั้นกรองด้วย `isReportableAgingRow` ซึ่งเก็บเฉพาะ "หนี้ที่ต้องไป
   * ตาม" (ยอดบวก หรือสองสมุดไม่ตรง):
   *
   *   เคสหักเกินแบบ **สมมาตร** (carry d — settleRecallCash ชนกับรอบที่หักซ้ำ)
   *   ทำให้ `intercoNet = shopMirrorNet = ติดลบเท่ากัน` ⇒ `bookMismatch = false`
   *   และไม่มียอดบวกเลย ⇒ ถ้าอ่านจากรายงานหลัก detector จะ **ไม่มีวันยิงเลย**
   *   (Fix Round 1 — พิสูจน์ด้วย integration test ระดับ DB).
   *
   * ทำไมไม่ขยาย filter ของรายงานหลักให้เก็บค่าติดลบด้วย: `totals.intercoNet` /
   * `totals.shopCollect` เป็นผลรวมของ `rows` ⇒ แถวติดลบจะไป **หักล้างหนี้ค้างจริง
   * ของสัญญาอื่น** บนหัวแท็บและใน log รายวัน — เป็นบั๊กคลาสเดียวกับ carry (ก)
   * ที่เพิ่งปิดไปใน Task 3 (gate ผลรวมกลบแถวเดี่ยว). แยก method จึงได้ทั้งสองอย่าง:
   * ตัวเลข "หนี้ที่ต้องตาม" ไม่ถูกความผิดปกติทำให้ดูดีขึ้น และความผิดปกติเองมี
   * ช่องทางรายงานของตัวเองทุกเดือน.
   */
  async getNegativeTypedRows(asOf: Date = new Date()): Promise<ShopReceivableAgingRow[]> {
    const rows = (await this.buildAllRows(asOf)).filter((r) => negativeTypedFields(r).length > 0);
    sortAgingRows(rows);
    return rows;
  }

  /**
   * Σ (financedGl + commissionGl) ของ item ในรอบที่ **ค้างอนุมัติ**
   * (`PENDING_APPROVAL`) — ยอดที่ใช้ "บวกกลับ" ก่อนสรุปว่า drift ของคิวรอจ่าย
   * ผิดปกติจริงหรือไม่.
   *
   * เหตุผล: `getReconcileTotals().drift = pendingTotal − glFinanceTotal` โดย
   * `pendingTotal` **กันสัญญาที่ถูกจองไว้ในรอบ `PENDING_APPROVAL` ออกแล้ว** แต่
   * รอบนั้น **ยังไม่โพสต์ JE** ⇒ ยอดบัญชี 21-1101/21-1102 ยังเต็ม ⇒ drift ติดลบ
   * เท่ากับยอดของรอบที่ค้างอยู่พอดี. นั่นคือ **สภาพปกติของกิจการที่มีรอบรออนุมัติ**
   * ไม่ใช่ "JE ที่ไม่ได้ stamp contractId" (รอบที่ POSTED ไปแล้วไม่มีปัญหานี้ —
   * ขา Dr ของ batch ลดยอดบัญชีจริงพร้อมกับที่ settled gate กันสัญญาออก).
   *
   * **แถว `RECALL` ไม่ถูกนับโดยตั้งใจ** (aggregate รวมทุก itemType ได้อย่างปลอดภัย
   * เพราะแถว RECALL มี `financedGl`/`commissionGl` = 0 ตามนิยาม snapshot): แถวนั้น
   * ไม่แตะ 21-1101/21-1102 เลย — มีแต่ขา 11-2107/S21-3001 — และ 21-1101+21-1102
   * คือ **คู่บัญชีเดียว** ที่ drift ตัวนี้คำนวณจาก. ห้าม "แก้" ให้บวก `recallAmount`
   * เข้ามา: จะกลายเป็นการบวกยอดของคนละบัญชีเข้าไปหักล้าง drift จนเพี้ยน.
   */
  async getOpenBatchPayableGross(): Promise<Prisma.Decimal> {
    const agg = await this.prisma.interCoSettlementItem.aggregate({
      where: {
        deletedAt: null,
        batch: { status: 'PENDING_APPROVAL', deletedAt: null },
      },
      _sum: { financedGl: true, commissionGl: true },
    });
    return new Prisma.Decimal(agg._sum.financedGl ?? 0).plus(agg._sum.commissionGl ?? 0);
  }

  /**
   * สร้างแถวดิบทุกสัญญาในจักรวาล 11-2107/S21-3001 — **ไม่กรองอะไรทั้งสิ้น**
   * (source เดียวของทั้ง `getShopReceivableAging` และ `getNegativeTypedRows`;
   * ห้ามคัดลอก SQL ไปไว้ที่อื่น). ดู jsdoc ของ `getShopReceivableAging`
   * เรื่องจำนวน query คงที่.
   */
  private async buildAllRows(asOf: Date): Promise<ShopReceivableAgingRow[]> {
    // Query A — 11-2107 ทั้งบัญชี group by metadata.contractId: typed sums
    // สามประเภท + MIN(posted_at) ของขา Dr (วันตั้งหนี้เก่าสุด) สองกลุ่ม.
    // WHERE กรองเฉพาะบรรทัดที่ classify ได้ (UNKNOWN ไม่เข้ารายงานนี้ —
    // เหมือน twins; drift ระดับบัญชีเป็นหน้าที่ reconcile totals).
    const financeRows = await this.prisma.$queryRaw<FinanceAgingRow[]>(Prisma.sql`
      SELECT je.metadata->>'contractId' AS contract_id,
             COALESCE(SUM(CASE WHEN ${SWAP_COND} THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS swap_gross,
             COALESCE(SUM(CASE WHEN ${RECALL_COND} THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS recall_gross,
             COALESCE(SUM(CASE WHEN ${SHOP_COLLECT_COND} THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS shop_collect,
             COALESCE(SUM(CASE WHEN ${LEGACY_SWAP_COND} THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS legacy_swap_gross,
             MIN(CASE WHEN jl.debit > 0 AND (${SWAP_COND} OR ${RECALL_COND}) THEN je.posted_at END) AS interco_oldest,
             MIN(CASE WHEN jl.debit > 0 AND ${SHOP_COLLECT_COND} THEN je.posted_at END) AS collect_oldest
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = '11-2107'
        AND jl.deleted_at IS NULL
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND je.metadata->>'contractId' IS NOT NULL
        AND (${SWAP_COND} OR ${RECALL_COND} OR ${SHOP_COLLECT_COND})
      GROUP BY 1
    `);

    // Query B — S21-3001 group by conditional key (SWAP_CREDIT → newContractId,
    // อื่น → contractId), Σ(Cr−Dr). WHERE จำกัดสองประเภท = union ของ twins
    // `swapCreditShopBalance` + `recallShopBalance` ตรงตัว.
    const shopRows = await this.prisma.$queryRaw<
      Array<{ contract_id: string | null; mirror_gross: unknown }>
    >(Prisma.sql`
      SELECT ${SHOP_KEY} AS contract_id,
             COALESCE(SUM(jl.credit - jl.debit), 0)::decimal AS mirror_gross
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = 'S21-3001'
        AND jl.deleted_at IS NULL
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND je.metadata->>'shopReceivableType' IN ('SWAP_CREDIT', 'PAYOUT_RECALL')
        AND (${SHOP_KEY}) IS NOT NULL
      GROUP BY 1
    `);
    const shopByContract = new Map<string, Prisma.Decimal>();
    for (const row of shopRows) {
      if (!row.contract_id) continue;
      shopByContract.set(row.contract_id, new Prisma.Decimal(String(row.mirror_gross ?? 0)));
    }

    const financeByContract = new Map<
      string,
      FinanceAgingRow & { contract_id: string }
    >();
    for (const row of financeRows) {
      if (!row.contract_id) continue;
      financeByContract.set(row.contract_id, row as FinanceAgingRow & { contract_id: string });
    }

    // Universe = สัญญาที่มี typed gross ฝั่งใดฝั่งหนึ่ง (Query A/B) — **ไม่รวม key
    // จาก Query C**. ผลที่ตามมาที่ต้องรู้: สัญญาที่ gross ถูกกลับรายการจนเหลือ 0
    // ทั้งสองสมุดแต่ยังมี deduction ของ batch POSTED ค้าง จะ net ติดลบเท่ากัน
    // สองสมุดและ **ไม่โผล่ทั้งในรายงานหลักและใน `getNegativeTypedRows`** —
    // ตาข่ายของเคสนี้คือ drift ระดับบัญชี (`getTypedAccountDrift`) ซึ่งจับได้แต่
    // **ไม่มีเลขสัญญา**. การขยาย universe ไปหา Query C เป็นงาน Phase 5 (ต้อง
    // hydrate สัญญาเพิ่ม + นิยาม "หนี้" ของแถวที่ไม่มี gross ให้ชัดก่อน).
    const universeIds = [...new Set([...financeByContract.keys(), ...shopByContract.keys()])];
    if (universeIds.length === 0) return [];

    // Query C — Σ deduction ต่อสัญญาจาก batch POSTED (item ทุก itemType —
    // สูตร NET ระดับสัญญา, สถาปัตยกรรม gross-lens: "หักแล้วเท่าไร" อยู่ที่
    // item table ไม่ใช่ GL metadata).
    const deductionGroups = await this.prisma.interCoSettlementItem.groupBy({
      by: ['contractId'],
      where: {
        contractId: { in: universeIds },
        deletedAt: null,
        batch: { status: 'POSTED', deletedAt: null },
      },
      _sum: { swapCreditAmount: true, recallAmount: true },
    });
    const deductionByContract = new Map<string, Prisma.Decimal>();
    for (const g of deductionGroups) {
      deductionByContract.set(
        g.contractId,
        new Prisma.Decimal(g._sum.swapCreditAmount ?? 0).plus(g._sum.recallAmount ?? 0),
      );
    }

    // Query D — hydrate contract. **ไม่กรอง status** — สัญญา CANCELED ต้องโผล่
    // ในรายงานอายุหนี้ (หัวใจของเคส C-2: สัญญายกเลิกหลังตัดจ่ายคือลูกหนี้
    // เรียกคืนตัวจริง). **ไม่กรอง soft-delete ด้วย** (Phase 5 M1 — นิยาม
    // เดียวกับ `getPayablePairing`): นี่คือรายงานกระทบยอด ไม่ใช่คิวงาน —
    // สัญญาที่ถูกลบทิ้งแต่ GL ยังค้างคือเคสที่ต้องเห็นที่สุด และการกรองมันออก
    // ทำให้ยอดหายจากรายงานโดยที่บัญชียังมีจริง (เห็นได้แค่ drift ระดับบัญชี
    // ที่ไม่มีเลขสัญญา). แถวที่หาไม่เจอจริง ๆ ใช้ป้าย MISSING_CONTRACT_LABEL.
    const contracts = await this.prisma.contract.findMany({
      where: { id: { in: universeIds } },
      select: { id: true, contractNumber: true, customer: { select: { name: true } } },
    });
    const contractById = new Map(contracts.map((c) => [c.id, c]));

    const zero = new Prisma.Decimal(0);
    const ageDays = (oldest: Date | null): number | null =>
      oldest ? Math.floor((asOf.getTime() - oldest.getTime()) / DAY_MS) : null;

    const rows: ShopReceivableAgingRow[] = [];
    for (const contractId of universeIds) {
      // คีย์ผี (JV มือ / สัญญาที่ถูกลบถาวรจากยุคก่อน) — **แสดง ไม่ทิ้ง**
      // (M1: สอดคล้องกับ getPayablePairing ที่ใช้ป้ายเดียวกัน)
      const contract = contractById.get(contractId);

      const fin = financeByContract.get(contractId);
      const swapCreditGross = new Prisma.Decimal(String(fin?.swap_gross ?? 0));
      const payoutRecallGross = new Prisma.Decimal(String(fin?.recall_gross ?? 0));
      const shopCollect = new Prisma.Decimal(String(fin?.shop_collect ?? 0));
      const legacySwapGross = new Prisma.Decimal(String(fin?.legacy_swap_gross ?? 0));
      const settledDeduction = deductionByContract.get(contractId) ?? zero;
      const shopGross = shopByContract.get(contractId) ?? zero;

      const intercoNet = swapCreditGross.plus(payoutRecallGross).minus(settledDeduction);
      const shopMirrorNet = shopGross.minus(settledDeduction);
      // ความหมายคณิตศาสตร์บริสุทธิ์ — legacy แยกบริบทด้วย flag ไม่ใช่แก้สูตร
      const bookMismatch = intercoNet.minus(shopMirrorNet).abs().gt(EPS);
      const legacyOneBook = legacySwapGross.abs().gt(EPS) && shopGross.abs().lte(EPS);

      const intercoOldestPostedAt = fin?.interco_oldest ?? null;
      const shopCollectOldestPostedAt = fin?.collect_oldest ?? null;

      rows.push({
        contractId,
        contractNumber: contract?.contractNumber ?? MISSING_CONTRACT_LABEL,
        customerName: contract?.customer.name ?? '',
        swapCreditGross,
        payoutRecallGross,
        settledDeduction,
        intercoNet,
        shopCollect,
        shopMirrorGross: shopGross,
        shopMirrorNet,
        intercoOldestPostedAt,
        intercoAgeDays: ageDays(intercoOldestPostedAt),
        shopCollectOldestPostedAt,
        shopCollectAgeDays: ageDays(shopCollectOldestPostedAt),
        bookMismatch,
        legacySwapGross,
        legacyOneBook,
      });
    }

    return rows;
  }

  /**
   * คู่เจ้าหนี้ FINANCE ↔ ลูกหนี้ SHOP ของรอบจ่าย ต่อสัญญา (Phase 4 Task 4).
   *
   * SQL เป็น twin ของสองเลนส์ใน `IntercoPendingService.getPendingContracts`
   * (เงื่อนไข WHERE ชุดเดียวกันทุกตัวอักษร) ต่างกันจงใจสองข้อ:
   *   1. **ไม่มี `HAVING SUM > 0`** — สัญญาที่ฝั่ง FINANCE ถูกล้างจนหมดแต่ฝั่ง
   *      SHOP ยังค้าง (หรือกลับกัน) ต้องโผล่ ไม่งั้นความไม่สมมาตรที่อันตราย
   *      ที่สุดคือสิ่งเดียวที่มองไม่เห็น
   *   2. **ไม่มี settled gate** — การกระทบยอดไม่เกี่ยวกับว่าถูกจัดเข้ารอบจ่าย
   *      แล้วหรือยัง (ขาล้างของ batch ไม่ stamp contractId ทั้งสองสมุด ⇒
   *      เลนส์ทั้งคู่ค้างที่ gross เท่ากันตลอด)
   *
   * สัญญาที่หา row ไม่เจอ (ถูก soft-delete) **ไม่ถูกตัดทิ้ง** — ต่างจาก
   * `getShopReceivableAging` (รายงานหนี้เพื่อไปตาม) เพราะที่นี่คือตาข่าย
   * กระทบยอด: GL ที่ไม่มีสัญญารองรับคือสิ่งที่ต้องเห็น ไม่ใช่สิ่งที่ต้องซ่อน.
   */
  async getPayablePairing(): Promise<PayablePairRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        contract_id: string | null;
        financed: unknown;
        commission: unknown;
        shop_financed: unknown;
        shop_commission: unknown;
      }>
    >(Prisma.sql`
      SELECT je.metadata->>'contractId' AS contract_id,
             COALESCE(SUM(CASE WHEN jl.account_code = '21-1101' THEN jl.credit - jl.debit ELSE 0 END), 0)::decimal AS financed,
             COALESCE(SUM(CASE WHEN jl.account_code = '21-1102' THEN jl.credit - jl.debit ELSE 0 END), 0)::decimal AS commission,
             COALESCE(SUM(CASE WHEN jl.account_code = 'S11-3001' THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS shop_financed,
             COALESCE(SUM(CASE WHEN jl.account_code = 'S11-3002' THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS shop_commission
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code IN ('21-1101', '21-1102', 'S11-3001', 'S11-3002')
        AND jl.deleted_at IS NULL
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND je.metadata->>'contractId' IS NOT NULL
      GROUP BY 1
    `);

    const parsed = rows
      .filter((r): r is typeof r & { contract_id: string } => !!r.contract_id)
      .map((r) => ({
        contractId: r.contract_id,
        financedGl: new Prisma.Decimal(String(r.financed ?? 0)),
        commissionGl: new Prisma.Decimal(String(r.commission ?? 0)),
        shopFinancedGl: new Prisma.Decimal(String(r.shop_financed ?? 0)),
        shopCommissionGl: new Prisma.Decimal(String(r.shop_commission ?? 0)),
      }))
      // ทุกยอดเป็นศูนย์ = ล้างครบทั้งสองสมุด ไม่มีอะไรให้กระทบยอด
      .filter(
        (r) =>
          r.financedGl.abs().gt(EPS) ||
          r.commissionGl.abs().gt(EPS) ||
          r.shopFinancedGl.abs().gt(EPS) ||
          r.shopCommissionGl.abs().gt(EPS),
      );
    if (parsed.length === 0) return [];

    const contracts = await this.prisma.contract.findMany({
      where: { id: { in: parsed.map((r) => r.contractId) } },
      select: { id: true, contractNumber: true, customer: { select: { name: true } } },
    });
    const contractById = new Map(contracts.map((c) => [c.id, c]));

    return parsed.map((r) => {
      const contract = contractById.get(r.contractId);
      const legacyNoShop = r.shopFinancedGl.abs().lte(EPS) && r.shopCommissionGl.abs().lte(EPS);
      const financedDiff = r.financedGl.minus(r.shopFinancedGl);
      const commissionDiff = r.commissionGl.minus(r.shopCommissionGl);
      const diff = financedDiff.plus(commissionDiff);
      return {
        ...r,
        contractNumber: contract?.contractNumber ?? MISSING_CONTRACT_LABEL,
        customerName: contract?.customer.name ?? '',
        legacyNoShop,
        financedDiff,
        commissionDiff,
        diff,
        // ต่อขา ไม่ใช่ผลรวม: misclassification ที่ย้ายเงินระหว่าง 21-1101 กับ
        // 21-1102 (หรือ S11-3001 กับ S11-3002) ทำให้ diff รวมเป็น 0 พอดี —
        // ถ้าเทียบผลรวมจะเงียบทั้งที่สองสมุดผูกกันผิดขา
        mismatch:
          !legacyNoShop && (financedDiff.abs().gt(EPS) || commissionDiff.abs().gt(EPS)),
      };
    });
  }

  /**
   * สัญญาใหม่ที่มี A.4 **ยุค Phase 2+** — JE `flow = 'shop-exchange-return'`
   * ที่ stamp `metadata.newContractId` (stamp นี้เกิดพร้อมบัญชี S21-3001 ใน
   * Phase 2 Task 1) ⇒ สัญญาในเซตนี้ **ต้อง** มีขาคู่ S21-3001 เสมอ.
   *
   * swap ยุคก่อน Phase 1 (A.4 ลง `Cr S50-1102` ไม่มี stamp) จะไม่อยู่ในเซตนี้
   * โดยโครงสร้าง — เกณฑ์แยก legacy ของ reconcile cron (spec §11.4).
   */
  async getPhase2SwapContractIds(): Promise<Set<string>> {
    const rows = await this.prisma.$queryRaw<Array<{ contract_id: string | null }>>(Prisma.sql`
      SELECT DISTINCT je.metadata->>'newContractId' AS contract_id
      FROM journal_entries je
      WHERE je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND je.metadata->>'flow' = 'shop-exchange-return'
        AND je.metadata->>'newContractId' IS NOT NULL
    `);
    return new Set(rows.map((r) => r.contract_id).filter((id): id is string => !!id));
  }

  /**
   * กระทบยอดระดับบัญชี 11-2107 / S21-3001 (ดู jsdoc ของ `TypedAccountDriftRow`
   * สำหรับสมการและเหตุผล). อ่านอย่างเดียว — ไม่มีการแตะ GL.
   */
  async getTypedAccountDrift(): Promise<TypedAccountDriftRow[]> {
    // Σ deduction ของ item ทุกใบใน batch POSTED = ขาล้างที่ไม่ stamp ทั้งสองสมุด
    // (ทุกแถวหักลง `Cr 11-2107` ฝั่ง FINANCE และ `Dr S21-3001` ฝั่ง SHOP ยอดเท่ากัน)
    const agg = await this.prisma.interCoSettlementItem.aggregate({
      where: { deletedAt: null, batch: { status: 'POSTED', deletedAt: null } },
      _sum: { swapCreditAmount: true, recallAmount: true },
    });
    const settledDeduction = new Prisma.Decimal(agg._sum.swapCreditAmount ?? 0).plus(
      agg._sum.recallAmount ?? 0,
    );

    const scalar = async (sql: Prisma.Sql): Promise<Prisma.Decimal> => {
      const rows = await this.prisma.$queryRaw<Array<{ balance: unknown }>>(sql);
      return new Prisma.Decimal(String(rows[0]?.balance ?? 0));
    };

    // 11-2107 (debit-normal): ยอดบัญชีทั้งหมด vs บรรทัดที่เลนส์ classify ได้
    // (WHERE ชุดเดียวกับ Query A ของ getShopReceivableAging ทุกตัวอักษร)
    const financeAccountTotal = await scalar(Prisma.sql`
      SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::decimal AS balance
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = '11-2107'
        AND jl.deleted_at IS NULL AND je.status = 'POSTED' AND je.deleted_at IS NULL
    `);
    const financeLensTotal = await scalar(Prisma.sql`
      SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::decimal AS balance
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = '11-2107'
        AND jl.deleted_at IS NULL AND je.status = 'POSTED' AND je.deleted_at IS NULL
        AND je.metadata->>'contractId' IS NOT NULL
        AND (${SWAP_COND} OR ${RECALL_COND} OR ${SHOP_COLLECT_COND})
    `);

    // S21-3001 (credit-normal): WHERE ชุดเดียวกับ Query B
    const shopAccountTotal = await scalar(Prisma.sql`
      SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::decimal AS balance
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = 'S21-3001'
        AND jl.deleted_at IS NULL AND je.status = 'POSTED' AND je.deleted_at IS NULL
    `);
    const shopLensTotal = await scalar(Prisma.sql`
      SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::decimal AS balance
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = 'S21-3001'
        AND jl.deleted_at IS NULL AND je.status = 'POSTED' AND je.deleted_at IS NULL
        AND je.metadata->>'shopReceivableType' IN ('SWAP_CREDIT', 'PAYOUT_RECALL')
        AND (${SHOP_KEY}) IS NOT NULL
    `);

    const build = (
      accountCode: string,
      label: string,
      accountTotal: Prisma.Decimal,
      lensTotal: Prisma.Decimal,
    ): TypedAccountDriftRow => {
      const expected = lensTotal.minus(settledDeduction);
      const drift = accountTotal.minus(expected);
      return {
        accountCode,
        label,
        accountTotal,
        lensTotal,
        settledDeduction,
        expected,
        drift,
        mismatch: drift.abs().gt(EPS),
      };
    };

    return [
      build('11-2107', 'ลูกหนี้-หน้าร้าน (FINANCE)', financeAccountTotal, financeLensTotal),
      build('S21-3001', 'เจ้าหนี้ FINANCE-ค่าเครื่องรับคืน (SHOP)', shopAccountTotal, shopLensTotal),
    ];
  }
}
