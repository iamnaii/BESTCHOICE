import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ContractAdvanceColumns, readContractCloseAdvances } from './contract-close-advances';
import type { DeferredWarning } from './deferred-warning';
import { glContractBalance } from './gl-contract-balance';
import { advanceVatOf, advanceVatOutstanding, consumeVatFor } from './advance-vat';

/**
 * Early-Payoff (JP4) journal entry — ล้างตามยอดในบัญชีของสัญญา (PR5 · คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 5.1–5.4, 29/09/2569).
 *
 * แหล่งเดียวของรายการ JP4 ที่ทุกผู้เรียกใช้ร่วมกัน (preview === posted ตามการสร้าง):
 *   A) ContractPaymentService.getEarlyPayoffQuote() — preview ที่ UI/LIFF/คำขออนุมัติเห็น (`buildEarlyPayoffJournal`)
 *   B) ContractPaymentService.earlyPayoff()         — รายการที่ลงจริง (`buildEarlyPayoffJournal` ตัวเดียวกัน)
 *   C) EarlyPayoffJP4Template.execute()             — template ที่ไม่มีผู้เรียกใน production (`buildEarlyPayoffJE`)
 *
 * ก่อน PR5 รายการนับ "งวดที่ยังไม่ PAID × ยอดต่องวด" (computeEarlyPayoffJE — ลบแล้ว): เงินสดในรายการไม่เท่าเงินที่รับ
 * (ACCOUNTANT NOTE Wave-1 #11), งวดที่ตั้งลูกหนี้แล้วถูกรับรู้ดอกเบี้ย/ภาษีขายซ้ำและ 11-2103 ไม่ถูกล้าง, เศษงวดสุดท้ายค้าง ·
 * PR2ข หักยอดที่ตั้งไปแล้วบางส่วน (`accruedUnpaid`) แทน — ไม่จำเป็นอีกเพราะยอดในบัญชีสะท้อนทุกการตั้งลูกหนี้งวดแล้ว.
 *
 * Policy A (CPA decision · 2026-05-09): VAT ไม่ลดตามส่วนลด — Cr 21-2101 = ภาษีขายรอเรียกเก็บคงเหลือเต็มจำนวน ·
 * ไม่ออกใบลดหนี้ (Credit Note); บริษัทรับภาระ VAT ส่วนเกินจากส่วนลดเอง.
 * Ref: docs/superpowers/specs/2026-05-09-cpa-policy-a-100-compliance-design.md
 */

type DecimalInput = Decimal | string | number;

/** One canonical JE line — money only (accountCode + dr + cr). Descriptions are
 * the caller's concern (UI preview vs ledger posting word them differently). */
export interface EarlyPayoffJeLine {
  accountCode: string;
  dr: Decimal;
  cr: Decimal;
  /**
   * บรรทัด Dr 21-1103 ของเงินรับล่วงหน้าถังรวม (PR5ข) — บัญชีเดียวกับบรรทัดเงินพักค่าปรับดิวแต่คนละบรรทัด ·
   * ผู้เรียกไม่ใส่คำอธิบายให้บรรทัดนี้ (การ์ดรายการแสดงชื่อบัญชีจากผังบัญชี — ไม่มีข้อความใหม่บนจอ)
   */
  generalAdvance?: true;
  /**
   * บรรทัดขากลับภาษีของเงินรับล่วงหน้า (PR4 ต8 — `Dr 21-2101 / Cr 21-2102`) ของเงินของลูกค้าที่ยอดปิดหัก ·
   * ผู้เรียกใส่คำอธิบาย `ADVANCE_VAT_CONSUME_DESCRIPTION` (ไม่ใช่คำอธิบายขาล้างของบัญชีเดียวกัน)
   */
  advanceVatReversal?: true;
  /**
   * บรรทัดรายได้ของเงินที่รับเกินยอดปิด (ฝ่ายบัญชี 18.2 · 16/10/2569) — `Cr 42-1106` (ยอดหลังหักภาษี) และ `Cr 21-2101`
   * (ภาษีขาย 7/107 ของส่วนเกิน) · ผู้เรียกใส่คำอธิบายของตัวเองให้สองบรรทัดนี้ (คนละความหมายกับขาล้าง 21-2101)
   */
  excessIncome?: true;
}

// ─── PR5 — ปิดยอดก่อนกำหนดล้างตามยอดในบัญชี (คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 5.1–5.4 · 29/09/2569) ───────────────
//
// 5.1 ล้าง 11-2103 (งวดที่ตั้งลูกหนี้แล้วแต่ยังค้าง รวมงวดที่จ่ายบางส่วน) ตามยอดค้างจริงโดยไม่รับรู้ดอกเบี้ย/ภาษีขายซ้ำ ·
//     ส่วนที่ยังไม่ถึงกำหนดรับรู้ดอกเบี้ยและภาษีขายในวันปิดยอด ⇒ ทุกขาล้างอ่านยอดในบัญชีของสัญญา (`glContractBalance`
//     — แบบเดียวกับ JP5) ไม่นับงวด × ยอดต่องวด
// 5.2 ส่วนลด 52-1106 เกี่ยวกับดอกเบี้ยของงวดที่ยังไม่ถึงกำหนด (หลักการ) — ยอดที่ลงตาม 5.3 รวมส่วนลดของดอกเบี้ยงวดที่
//     ตั้งลูกหนี้แล้วค้างด้วย (สูตรยอดปิดคิดส่วนลดจากทุกงวดค้าง) ⇒ บันทึกส่วนที่เกินฐาน 5.2 (% ส่วนลด × ดอกเบี้ยรอตัดบัญชี)
//     ไว้ใน `discountBeyondDeferredBase` ให้ฝ่ายบัญชีเห็น
// 5.3 เงินสดในรายการ = เงินที่รับจริง · 52-1106 = ลูกหนี้คงเหลือตามบัญชี − เงินที่รับจริง − เงินรับล่วงหน้าที่นำมาหัก
//     (ส่วนที่เหลือให้สมดุล — ไม่มีสูตรส่วนลดที่สอง)
// 5.4 เงินของลูกค้าที่ยอดปิดหักให้แล้วลงฝั่งเดบิตแทนเงินสด: เงินพักค่าปรับดิว 21-1103 (`parkRelief`) และเงินเกินของลูกค้า
//     21-5101 (`creditRelief`) · PR5ข (เจ้าของเคาะ 01/10/2569): เงินรับล่วงหน้าถังรวม 21-1103 (`advanceRelief` — บรรทัดของ
//     ตัวเอง) ที่ยอดปิดหักแบบเดียวกับเงินพัก

/** ยอดคงเหลือในสมุดบัญชีของสัญญา ณ วันปิดยอด — ขาที่ JP4 ล้าง (`glContractBalance`) */
export interface EarlyPayoffLedger {
  /** 11-2101 (Dr − Cr) — ลูกหนี้ gross ไม่รวม VAT ของส่วนที่ยังไม่ตั้งลูกหนี้งวด */
  gross: Decimal;
  /** 11-2103 (Dr − Cr) — ลูกหนี้งวดที่ตั้งแล้วแต่ยังไม่ได้รับ · ติดลบ = รับเงินก่อนรอบกลางคืนตั้งลูกหนี้งวด */
  accrued: Decimal;
  /** 11-2105 (Dr − Cr) — ลูกหนี้ภาษีขายรอเรียกเก็บ */
  vatReceivable: Decimal;
  /** 11-2106 (Cr − Dr) — ดอกเบี้ยรอตัดบัญชีของส่วนที่ยังไม่ถึงกำหนด */
  deferredInterest: Decimal;
  /** 21-2102 (Cr − Dr) — ภาษีขายรอเรียกเก็บของส่วนที่ยังไม่ถึงกำหนด */
  deferredVat: Decimal;
}

/** อ่านยอดในบัญชีของสัญญาที่ JP4 ล้าง (ในธุรกรรมของผู้เรียก) */
export async function readEarlyPayoffLedger(
  client: Prisma.TransactionClient | PrismaClient,
  contractId: string,
): Promise<EarlyPayoffLedger> {
  return {
    gross: await glContractBalance(client, contractId, '11-2101', 'dr'),
    accrued: await glContractBalance(client, contractId, '11-2103', 'dr'),
    vatReceivable: await glContractBalance(client, contractId, '11-2105', 'dr'),
    deferredInterest: await glContractBalance(client, contractId, '11-2106', 'cr'),
    deferredVat: await glContractBalance(client, contractId, '21-2102', 'cr'),
  };
}

/** เงินที่รับ + เงินของลูกค้าที่หัก เกินลูกหนี้ตามบัญชีไม่เกินยอดนี้ = เศษสตางค์ (Cr 53-1503) · เกินกว่านี้ = รายได้ 42-1106 */
export const EARLY_PAYOFF_ROUNDING_TOLERANCE = new Decimal('1.00');
/** บัญชีกำไร (ขาดทุน) จากการปัดเศษ — บัญชีเดียวกับเศษที่ใบรับชำระเก็บเกิน (adj_overpay ค่าเริ่มต้น) */
export const EARLY_PAYOFF_ROUNDING_ACCOUNT = '53-1503';
/**
 * บัญชีรายได้ของเงินที่รับเกินยอดปิดเกินเศษสตางค์ (ฝ่ายบัญชี 18.2 · 16/10/2569 — "ใช้ 42-1106 แทนปฏิเสธ" · เจ้าของ 16/10
 * "ไม่คืนลูกค้า") — บัญชีเดียวกับรอบกวาดเงินพักส่วนเกินหลังสัญญาปิด (PR4 ต6/ต7)
 */
export const EARLY_PAYOFF_EXCESS_INCOME_ACCOUNT = '42-1106';
/** คำอธิบายบรรทัด `Cr 42-1106` ของเงินที่รับเกินยอดปิด — ใช้ร่วมกันทั้ง preview และรายการที่ลง */
export const EARLY_PAYOFF_EXCESS_INCOME_DESCRIPTION =
  'เงินที่รับเกินยอดปิด — รับรู้เป็นรายได้ (ฝ่ายบัญชี 18.2)';
/** คำอธิบายบรรทัด `Cr 21-2101` ภาษีขายของเงินที่รับเกินยอดปิด (คนละบรรทัดกับขาล้าง 21-2102) */
export const EARLY_PAYOFF_EXCESS_VAT_DESCRIPTION = 'ภาษีขายของเงินที่รับเกินยอดปิด';
/** คำอธิบายของบรรทัดที่ติดธง `excessIncome` — บัญชีรายได้ / บัญชีภาษีขาย */
export function earlyPayoffExcessDescription(accountCode: string): string {
  return accountCode === EARLY_PAYOFF_EXCESS_INCOME_ACCOUNT
    ? EARLY_PAYOFF_EXCESS_INCOME_DESCRIPTION
    : EARLY_PAYOFF_EXCESS_VAT_DESCRIPTION;
}
/** 52-1106 ต่างจากส่วนลดบนหน้าจอเกิน `EARLY_PAYOFF_ROUNDING_TOLERANCE` → สัญญาณเตือนหลัง commit (ไม่หยุดงาน) */
export const EARLY_PAYOFF_DISCOUNT_VS_QUOTE_MESSAGE =
  '[early-payoff] 52-1106 differs from the payoff-screen discount by more than 1.00';

export interface BuildEarlyPayoffJeInput {
  /** บัญชีที่รับเงิน (ธนาคาร / 11-2107 เมื่อหน้าร้านรับแทน) */
  depositAccountCode: string;
  /** เงินที่รับจริง (ข้อ 5.3) = ยอดที่ลูกค้าจ่าย — `computePayoffQuote(...).totalPayoff` */
  cashReceived: DecimalInput;
  ledger: EarlyPayoffLedger;
  /** ค่าปรับที่ยังไม่เคยลง Cr 42-1103 (NETTED — `computeUnbookedLateFees`) */
  unpaidLateFees?: DecimalInput | null;
  /** Dr 21-1103 เงินพักค่าปรับดิวที่ยอดปิดหักให้ลูกค้า — ผู้เรียก clamp ด้วยคอลัมน์และยอดในบัญชีแล้ว */
  parkRelief?: DecimalInput | null;
  /** Dr 21-1103 (บรรทัดแยก) เงินรับล่วงหน้าถังรวมที่ยอดปิดหักให้ลูกค้า (PR5ข) — ผู้เรียก clamp ด้วยคอลัมน์และยอดในบัญชีแล้ว */
  advanceRelief?: DecimalInput | null;
  /** Dr 21-5101 เงินเกินของลูกค้าที่ยอดปิดหักให้ — ผู้เรียก clamp ด้วยคอลัมน์และยอดในบัญชีแล้ว */
  creditRelief?: DecimalInput | null;
  /** % ส่วนลดของยอดปิด (0–100) — ใช้วัดส่วนของ 52-1106 ที่เกินฐานข้อ 5.2 เท่านั้น (ไม่กระทบบรรทัดของรายการ) */
  discountPercent: DecimalInput;
  /**
   * PR4 (ต8): ภาษีขายของเงินรับล่วงหน้าที่รับรู้ตอนพักแล้วและยังค้างของสัญญา (p — `advanceVatOutstanding`) · ขาล้าง 21-2102
   * = ยอดในบัญชี + p (**ไม่ใช่** + ขากลับ — ถังใหญ่กว่ายอดปิด: 21-2102 หลังรายการ = −(p − r) ให้รอบกวาดเงินพักส่วนเกินล้าง)
   */
  advanceVatOutstanding?: DecimalInput | null;
  /** PR4 (ต8): ขากลับ `Dr 21-2101 / Cr 21-2102` (r — `consumeVatFor` ของเงินของลูกค้าที่หัก) — ต้องไม่เกิน p */
  advanceVatReversal?: DecimalInput | null;
}

/** รายการ JP4 ตามยอดในบัญชี + ยอดที่ใช้ประกอบ */
export interface EarlyPayoffJe {
  /** บรรทัดของรายการ (ไม่มีบรรทัดยอดศูนย์) — สมดุลเสมอ */
  lines: EarlyPayoffJeLine[];
  /** Dr บัญชีรับเงิน = เงินที่รับจริง */
  cashReceived: Decimal;
  /** ยอดในบัญชีที่ล้าง (ตัวเดียวกับที่ส่งเข้า) */
  ledger: EarlyPayoffLedger;
  /** ลูกหนี้คงเหลือตามบัญชีที่ล้าง (รวม VAT) = 11-2101 + 11-2103 + 11-2105 */
  receivableCleared: Decimal;
  /** Dr 11-2106 = Cr 41-1101 (0 = ไม่มีบรรทัด) */
  deferredInterest: Decimal;
  /** Dr 21-2102 = Cr 21-2101 (0 = ไม่มีบรรทัด) */
  deferredVat: Decimal;
  /** Cr 42-1103 */
  lateFees: Decimal;
  /** Dr 21-1103 (บรรทัดเงินพักค่าปรับดิว) */
  parkRelief: Decimal;
  /** Dr 21-1103 (บรรทัดเงินรับล่วงหน้าถังรวม — PR5ข) */
  advanceRelief: Decimal;
  /** Dr 21-5101 */
  creditRelief: Decimal;
  /** PR4: ภาษีของเงินรับล่วงหน้าที่ยังค้างก่อนรายการ (p) — บวกเข้าขาล้าง 21-2102 */
  advanceVatOutstanding: Decimal;
  /** PR4: Dr 21-2101 = Cr 21-2102 ขากลับ (r ≤ p · 0 = ไม่มีบรรทัด) */
  advanceVatReversal: Decimal;
  /** Dr 52-1106 — ส่วนลดที่ให้ลูกค้าจริง (ข้อ 5.3) */
  discount: Decimal;
  /** Cr 53-1503 — เงินที่รับเกินลูกหนี้ตามบัญชีไม่เกิน 1.00 (เศษสตางค์ของค่างวด) */
  roundingGain: Decimal;
  /**
   * เงินที่รับ + เงินของลูกค้าที่หัก เกินลูกหนี้ตามบัญชีเกิน 1.00 (ฝ่ายบัญชี 18.2) — รับรู้เป็นรายได้ทั้งก้อน:
   * Cr 42-1106 = `excessIncome − excessVat` · Cr 21-2101 = `excessVat` (0 = ไม่มีบรรทัด)
   */
  excessIncome: Decimal;
  /** ภาษีขาย 7/107 ของ `excessIncome` (`advanceVatOf` — สูตรเดียวกับเงินรับล่วงหน้า · กติกา 14 ภาษีของเงินที่รับ ณ วันรับ) */
  excessVat: Decimal;
  /** ฐานส่วนลดตามหลักการข้อ 5.2 = % ส่วนลด × ดอกเบี้ยรอตัดบัญชีคงเหลือ (ปัดครึ่งขึ้น 2 ตำแหน่ง) */
  deferredInterestDiscountBase: Decimal;
  /**
   * ส่วนของ 52-1106 ที่เกินฐานข้อ 5.2 (ไม่ติดลบ) = ส่วนลดของดอกเบี้ยงวดที่ตั้งลูกหนี้แล้วค้าง (สูตรยอดปิดคิดส่วนลดจาก
   * ทุกงวดค้าง) + เศษงวดสุดท้าย + ยอดอื่นที่ส่วนที่เหลือให้สมดุลรับไว้ — ผู้เรียกบันทึกใน metadata เมื่อเกิน 1.00 (ถ1)
   */
  discountBeyondDeferredBase: Decimal;
}

/** ยอดเงินที่ส่งเข้า: ไม่ติดลบ และไม่เกิน 2 ตำแหน่ง (ยอดที่เกินจะลงบัญชีเพี้ยนเมื่อฐานข้อมูลปัดเป็น 2 ตำแหน่ง) */
function moneyInput(name: string, v: DecimalInput | null | undefined): Decimal {
  const amount = new Decimal(v ?? 0);
  if (amount.isNegative() || amount.decimalPlaces() > 2) {
    throw new Error(
      `buildEarlyPayoffJE: ${name} must be a non-negative amount with at most 2 decimals (got ${amount.toString()})`,
    );
  }
  return amount;
}

/**
 * รายการปิดยอดก่อนกำหนด (JP4) ตามยอดในบัญชี — ฟังก์ชันบริสุทธิ์ (ไม่แตะฐาน) ที่ preview และรายการที่ลงจริงใช้ร่วมกัน.
 *
 *   Dr <บัญชีรับเงิน>  เงินที่รับจริง (0 = ไม่มีบรรทัด — เครดิต/เงินพักของลูกค้าครอบยอดปิดทั้งก้อน)
 *   Dr 11-2106        ดอกเบี้ยรอตัดบัญชีคงเหลือ          ┐ ส่วนที่ยังไม่ถึงกำหนด: รับรู้ดอกเบี้ยและภาษีขายวันปิดยอด
 *   Dr 21-2101 / Cr 21-2102  ขากลับภาษีของเงินรับล่วงหน้าที่ยอดปิดหัก (PR4 ต8 — r · วางก่อนขาล้าง · 0 = ไม่มีบรรทัด)
 *   Dr 21-2102        ภาษีขายรอเรียกเก็บคงเหลือ + ภาษีที่ยังค้างของเงินรับล่วงหน้า (p)  ┘
 *   Dr 52-1106        ส่วนลดที่ให้จริง (ส่วนที่เหลือให้สมดุล ≥ 0)
 *   Dr 21-1103        เงินพักค่าปรับดิวที่ยอดปิดหักให้
 *   Dr 21-1103        เงินรับล่วงหน้าถังรวมที่ยอดปิดหักให้ (PR5ข — บรรทัดแยก `generalAdvance`)
 *   Dr 21-5101        เงินเกินของลูกค้า
 *     Cr 11-2103      ลูกหนี้งวดที่ตั้งแล้วค้าง (ติดลบ → Dr)
 *     Cr 11-2101      ลูกหนี้ gross คงเหลือ (ติดลบ → Dr)
 *     Cr 11-2105      ลูกหนี้ภาษีขายรอเรียกเก็บคงเหลือ (ติดลบ → Dr)
 *     Cr 41-1101      = 11-2106
 *     Cr 21-2101      = 21-2102 (Policy A — ภาษีขายเต็มจำนวน ไม่ลดตามส่วนลด)
 *     Cr 42-1103      ค่าปรับ
 *     Cr 53-1503      เงินที่รับเกินลูกหนี้ตามบัญชี ≤ 1.00
 *     Cr 42-1106      เงินที่รับเกินลูกหนี้ตามบัญชี > 1.00 หักภาษี (ฝ่ายบัญชี 18.2 — บรรทัด `excessIncome`)
 *     Cr 21-2101      ภาษีขาย 7/107 ของเงินที่รับเกิน (บรรทัด `excessIncome` — คนละบรรทัดกับขาล้าง 21-2102)
 *
 * ส่วนที่เหลือให้สมดุล = ลูกหนี้ตามบัญชี + ค่าปรับ − เงินที่รับ − เงินพัก − ถังรวม − เงินเกินของลูกค้า:
 * ≥ 0 → 52-1106 · −1.00 ถึง < 0 → Cr 53-1503 · ต่ำกว่า −1.00 → รายได้ 42-1106 + ภาษีขาย 21-2101 (`excessIncome` /
 * `excessVat` — ฝ่ายบัญชี 16/10/2569 ข้อ 18.2 แทนการปฏิเสธ · เจ้าของ 16/10 ไม่คืนลูกค้า).
 */
export function buildEarlyPayoffJE(input: BuildEarlyPayoffJeInput): EarlyPayoffJe {
  const zero = new Decimal(0);
  const cashReceived = moneyInput('cashReceived', input.cashReceived);
  const lateFees = moneyInput('unpaidLateFees', input.unpaidLateFees);
  const parkRelief = moneyInput('parkRelief', input.parkRelief);
  const advanceRelief = moneyInput('advanceRelief', input.advanceRelief);
  const creditRelief = moneyInput('creditRelief', input.creditRelief);
  const advanceVatOutstanding = moneyInput('advanceVatOutstanding', input.advanceVatOutstanding);
  const advanceVatReversal = moneyInput('advanceVatReversal', input.advanceVatReversal);
  if (advanceVatReversal.gt(advanceVatOutstanding)) {
    throw new Error(
      `buildEarlyPayoffJE: advanceVatReversal (${advanceVatReversal.toFixed(2)}) exceeds advanceVatOutstanding (${advanceVatOutstanding.toFixed(2)})`,
    );
  }
  const { ledger } = input;
  const deferredInterest = Decimal.max(zero, ledger.deferredInterest);
  // PR4 (ต8): ขาล้างรวมภาษีที่ยังค้างของเงินรับล่วงหน้าทั้งก้อน (p) — ไม่ใช่เฉพาะส่วนที่กลับ (r)
  const deferredVat = Decimal.max(zero, ledger.deferredVat.plus(advanceVatOutstanding));
  const receivableCleared = ledger.gross.plus(ledger.accrued).plus(ledger.vatReceivable);
  const deferredInterestDiscountBase = deferredInterest
    .times(new Decimal(input.discountPercent))
    .div(100)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const plug = receivableCleared
    .plus(lateFees)
    .minus(cashReceived)
    .minus(parkRelief)
    .minus(advanceRelief)
    .minus(creditRelief);
  let discount = zero;
  let roundingGain = zero;
  let excessIncome = zero;
  let excessVat = zero;
  if (plug.gte(0)) discount = plug;
  else if (plug.abs().lte(EARLY_PAYOFF_ROUNDING_TOLERANCE)) roundingGain = plug.abs();
  else {
    // ฝ่ายบัญชี 16/10/2569 ข้อ 18.2 — เงินของลูกค้าที่เกินลูกหนี้ตามบัญชีเกินเศษสตางค์ = รายได้อื่น 42-1106 (ไม่คืนลูกค้า —
    // เจ้าของ 16/10) · ภาษีขาย 7/107 ของเงินที่รับรู้เป็นรายได้ตามกติกา 14 (ภาษีของเงินที่รับ ณ วันรับ) — สูตรเดียวกับเงินรับล่วงหน้า
    excessIncome = plug.abs();
    excessVat = advanceVatOf(excessIncome);
  }

  const lines: EarlyPayoffJeLine[] = [];
  const debit = (accountCode: string, amount: Decimal) => {
    if (amount.gt(0)) lines.push({ accountCode, dr: amount, cr: zero });
  };
  // เงินสด 0 (เงินของลูกค้าที่หักครอบยอดปิดทั้งก้อน — เกิดได้จริงตั้งแต่ 18.2) ไม่ลงบรรทัดยอดศูนย์
  debit(input.depositAccountCode, cashReceived);
  const credit = (accountCode: string, amount: Decimal) => {
    if (amount.gt(0)) lines.push({ accountCode, dr: zero, cr: amount });
  };
  // บัญชีลูกหนี้ล้างให้เป็นศูนย์ทั้งสองทิศ — ยอดติดลบ (รับเงินก่อนตั้งลูกหนี้งวด) ลงฝั่งเดบิต
  const clearReceivable = (accountCode: string, balance: Decimal) => {
    if (balance.gt(0)) credit(accountCode, balance);
    else debit(accountCode, balance.abs());
  };

  debit('11-2106', deferredInterest);
  // PR4 (ต8): ขากลับภาษีของเงินรับล่วงหน้าที่ยอดปิดหัก — วางก่อนขาล้าง 21-2102
  if (advanceVatReversal.gt(0)) {
    lines.push({
      accountCode: '21-2101',
      dr: advanceVatReversal,
      cr: zero,
      advanceVatReversal: true,
    });
    lines.push({
      accountCode: '21-2102',
      dr: zero,
      cr: advanceVatReversal,
      advanceVatReversal: true,
    });
  }
  debit('21-2102', deferredVat);
  debit('52-1106', discount);
  debit('21-1103', parkRelief);
  if (advanceRelief.gt(0)) {
    lines.push({ accountCode: '21-1103', dr: advanceRelief, cr: zero, generalAdvance: true });
  }
  debit('21-5101', creditRelief);
  clearReceivable('11-2103', ledger.accrued);
  clearReceivable('11-2101', ledger.gross);
  clearReceivable('11-2105', ledger.vatReceivable);
  credit('41-1101', deferredInterest);
  credit('21-2101', deferredVat);
  credit('42-1103', lateFees);
  credit(EARLY_PAYOFF_ROUNDING_ACCOUNT, roundingGain);
  if (excessIncome.gt(0)) {
    lines.push({
      accountCode: EARLY_PAYOFF_EXCESS_INCOME_ACCOUNT,
      dr: zero,
      cr: excessIncome.minus(excessVat),
      excessIncome: true,
    });
    if (excessVat.gt(0)) {
      lines.push({ accountCode: '21-2101', dr: zero, cr: excessVat, excessIncome: true });
    }
  }

  return {
    lines,
    cashReceived,
    ledger,
    receivableCleared,
    deferredInterest,
    deferredVat,
    lateFees,
    parkRelief,
    advanceRelief,
    creditRelief,
    advanceVatOutstanding,
    advanceVatReversal,
    discount,
    roundingGain,
    excessIncome,
    excessVat,
    deferredInterestDiscountBase,
    discountBeyondDeferredBase: Decimal.max(zero, discount.minus(deferredInterestDiscountBase)),
  };
}

export interface EarlyPayoffJournalInput {
  /** แถวสัญญา (คอลัมน์เงินของลูกค้าใช้ clamp เงินพักและเทียบกับบัญชีเพื่อเตือน) */
  contract: { id: string; contractNumber: string } & ContractAdvanceColumns;
  depositAccountCode: string;
  /** เงินที่รับจริง = `computePayoffQuote(...).totalPayoff` */
  cashReceived: DecimalInput;
  /** ค่าปรับ NETTED */
  unpaidLateFees: DecimalInput;
  /** เงินพักค่าปรับดิวที่ยอดปิดหักให้ลูกค้า = `computePayoffQuote(...).rescheduleAdvanceApplied` */
  parkReliefApplied: DecimalInput;
  /** เงินรับล่วงหน้าถังรวมที่ยอดปิดหักให้ลูกค้า = `computePayoffQuote(...).advanceBalanceApplied` (PR5ข) */
  advanceReliefApplied: DecimalInput;
  /** ส่วนลดบนหน้าจอ = `computePayoffQuote(...).discountAmount` — เทียบกับ 52-1106 เพื่อส่งสัญญาณเตือน */
  quoteDiscountAmount: DecimalInput;
  /** % ส่วนลดของยอดปิด = `computePayoffQuote(...).discountPercent` */
  discountPercent: DecimalInput;
}

/**
 * อ่านยอดในบัญชีแล้วสร้างรายการ JP4 — ตัวเดียวที่ preview (`getEarlyPayoffQuote`) และรายการที่ลงจริง (`earlyPayoff`) ใช้
 * ⇒ preview === posted. เงินของลูกค้าที่หัก = เท่าที่ยอดปิดหักให้และมีอยู่จริงในบัญชี (`readContractCloseAdvances` ของ PR6):
 * เงินพัก = min(ยอดที่ยอดปิดหักให้, คอลัมน์ถังพัก, ยอด 21-1103 ในบัญชี) · เงินรับล่วงหน้าถังรวม (PR5ข — เจ้าของเคาะ
 * 01/10/2569 หักแบบเดียวกับเงินพัก) = min(ยอดที่ยอดปิดหักให้, คอลัมน์ `advanceBalance`, ยอด 21-1103 ในบัญชี − เงินพักที่หัก) ·
 * เงินเกินของลูกค้า = min(คอลัมน์ `creditBalance` ที่ยอดปิดหักให้, ยอด 21-5101 ในบัญชี) — ยอดในบัญชีที่เกินยังเป็นเงินของ
 * ลูกค้า ค้างในบัญชีนั้น · `warnings` (ผู้เรียกส่งหลังธุรกรรม commit เท่านั้น) = คอลัมน์ไม่ตรงบัญชี + 52-1106 ต่างจาก
 * ส่วนลดบนหน้าจอเกิน 1.00 (ยอดในบัญชีไม่ตรงยอดค้างตามงวด / เงินของลูกค้าที่ยอดปิดหักแต่ไม่มีในบัญชี ไหลเข้า 52-1106).
 */
export async function buildEarlyPayoffJournal(
  client: Prisma.TransactionClient | PrismaClient,
  input: EarlyPayoffJournalInput,
): Promise<EarlyPayoffJe & { warnings: DeferredWarning[] }> {
  const ledger = await readEarlyPayoffLedger(client, input.contract.id);
  const advances = await readContractCloseAdvances(client, input.contract, 'early-payoff');
  const parkRelief = Decimal.max(
    0,
    Decimal.min(
      new Decimal(input.parkReliefApplied ?? 0),
      new Decimal((input.contract.rescheduleAdvanceBalance ?? 0).toString()),
      advances.advance,
    ),
  );
  // ถังรวมใช้ยอด 21-1103 ในบัญชีส่วนที่เหลือหลังบรรทัดเงินพัก (บัญชีเดียวกัน — ห้ามหักซ้ำ)
  const advanceRelief = Decimal.max(
    0,
    Decimal.min(
      new Decimal(input.advanceReliefApplied ?? 0),
      new Decimal((input.contract.advanceBalance ?? 0).toString()),
      advances.advance.minus(parkRelief),
    ),
  );
  const creditRelief = Decimal.max(
    0,
    Decimal.min(new Decimal((input.contract.creditBalance ?? 0).toString()), advances.credit),
  );
  // PR4 (ต8): ภาษีที่รับรู้ตอนพักแล้วและยังค้าง (p) อ่านจาก stamp ของรายการที่ POSTED · ขากลับ (r) ตามเงินของลูกค้าที่ยอดปิด
  // หัก — รายการนี้ทำให้ถัง (21-1103 + 21-5101) ของสัญญาเป็น 0 ⇒ r = p · ถังใหญ่กว่ายอดปิด ⇒ r = HALF_UP(ยอดที่หัก × 7/107)
  // ไม่เกิน p และ 21-2102 หลังรายการ = −(p − r) ให้รอบกวาดเงินพักส่วนเกินล้างเมื่อเงินที่เหลือออกจากถัง (G9)
  const vatOutstanding = await advanceVatOutstanding(client, input.contract.id);
  const release = parkRelief.plus(advanceRelief).plus(creditRelief);
  const emptiesBucket = advances.advance.plus(advances.credit).minus(release).lte(0);
  const vatReversal = consumeVatFor(vatOutstanding, release, emptiesBucket);
  const je = buildEarlyPayoffJE({
    depositAccountCode: input.depositAccountCode,
    cashReceived: input.cashReceived,
    ledger,
    unpaidLateFees: input.unpaidLateFees,
    parkRelief,
    advanceRelief,
    creditRelief,
    advanceVatOutstanding: vatOutstanding,
    advanceVatReversal: vatReversal,
    discountPercent: input.discountPercent,
  });
  const warnings: DeferredWarning[] = [...advances.warnings];
  const quoteDiscountAmount = new Decimal(input.quoteDiscountAmount);
  const discountVsQuote = je.discount.minus(quoteDiscountAmount);
  if (discountVsQuote.abs().gt(EARLY_PAYOFF_ROUNDING_TOLERANCE)) {
    warnings.push({
      message: EARLY_PAYOFF_DISCOUNT_VS_QUOTE_MESSAGE,
      tags: { module: 'journal', action: 'early-payoff-discount-vs-quote', flow: 'early-payoff' },
      extra: {
        contractId: input.contract.id,
        contractNumber: input.contract.contractNumber,
        discount: je.discount.toFixed(2),
        quoteDiscountAmount: quoteDiscountAmount.toFixed(2),
        difference: discountVsQuote.toFixed(2),
        receivableCleared: je.receivableCleared.toFixed(2),
        cashReceived: je.cashReceived.toFixed(2),
        parkRelief: je.parkRelief.toFixed(2),
        advanceRelief: je.advanceRelief.toFixed(2),
        creditRelief: je.creditRelief.toFixed(2),
      },
    });
  }
  return { ...je, warnings };
}
