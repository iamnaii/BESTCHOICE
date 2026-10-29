import { Prisma } from '@prisma/client';
import {
  accrual2AInputOf,
  buildPartialAccrual2ALines,
  buildRemainderAccrual2ALines,
  NOTHING_ACCRUED,
  type Accrual2APartResult,
  type AccruedSoFar,
} from '../../modules/journal/build-accrual-2a-lines';
import type { JeLineInput } from '../../modules/journal/journal-auto.service';
import { dRound } from '../../utils/decimal.util';
import {
  INSTALLMENT_AMOUNT_TOLERANCE,
  LAST_INSTALLMENT_AMOUNT_TOLERANCE,
  type ContractMoney,
} from './money';

/**
 * รายการยกมารายสัญญา (Task 7 · สเปก 5.4 + 5.6 ร่าง 5) — ฟังก์ชันบริสุทธิ์ ไม่แตะฐานข้อมูล
 *
 * **หลัก:** จำลองสภาพที่สัญญาจะมี ณ วันตัด ถ้าเปิดใน BESTCHOICE ตั้งแต่แรก (1A + 2A + ใบรับชำระ) ด้วยตัวสร้างบรรทัด 2A
 * ของระบบ (`build-accrual-2a-lines.ts` — ไม่มีสูตรชุดที่สอง) แล้วเก็บเฉพาะบัญชียกมา (`CARRY_FORWARD_ACCOUNTS`) ส่วนต่างลง
 * `32-1101` ส่วนของเจ้าของฝั่ง FINANCE · **ไม่มีบรรทัด 41-1101 / 21-2101 / เงินสด** — PEAK รับรู้รายได้และยื่น VAT ไปแล้ว
 *
 * ต่องวด ("ถึงกำหนด" = `dueDate < cutoff` แบบเดียวกับ `classify.ts` / `payments.ts` — วันตัด 30 พ.ย. 23:59:59 กรุงเทพ
 * ⇒ งวดที่ครบกำหนด 30 พ.ย. ถึงกำหนดแล้ว · 1 ธ.ค. ยังไม่ถึง) · `T` = ยอดของงวดตามตัวคำนวณ · **ชำระครบ** = `paid ≥ amountDue`
 * (ยอดเรียกเก็บ — แถวงวดเป็น `PAID`) หรือ `paid ≥ T` (ลูกหนี้ในบัญชีล้างครบ):
 * - **ชำระครบ** = ตั้งครบและล้างครบ → ไม่มีอะไรยกมา ไม่มี marker · stamp `accrued: true` ยอดสะสม = ทั้งงวด
 *   (ส่วนต่างระหว่าง `T` กับยอดที่จ่ายไม่ยกมา — เหมือนใบรับชำระที่ทำให้งวดครบด้วยเศษไม่เกิน 1 บาท)
 * - **ถึงกำหนดแล้ว ยังค้าง** = รอบกลางคืนตั้ง 2A ทั้งงวดไปแล้ว → Dr 11-2103 `T` + marker ยอดที่จ่าย (ถ้ามี) · ดอกเบี้ยถือว่า
 *   รับรู้แล้ว (ไม่มีใน 11-2106) · VAT ของส่วนที่ค้าง = HALF_UP(`vatPerInst` × (`T` − ยอดที่จ่าย) ÷ `T`) **คงไว้ใน Cr 21-2102**
 *   และอยู่ใน `catchUpLines` (Dr 21-2102 / Cr 21-2101 วันที่ 1 ธ.ค. — PEAK ยื่น VAT ตามเงินรับ ส่วนนี้ยังไม่เคยยื่น · โหมดเดียว)
 *   · stamp `accrued: true` ยอดสะสม = ทั้งงวด
 * - **ยังไม่ถึงกำหนด ไม่ได้จ่าย** → กลับด้านของ 2A ทั้งงวด: Dr 11-2101 / Dr 11-2105 / Cr 11-2106 / Cr 21-2102 ·
 *   stamp `accrued: false` ยอด 0
 * - **ยังไม่ถึงกำหนด จ่ายล่วงหน้าบางส่วน** → ส่วนที่ตั้งแล้ว = `buildPartialAccrual2ALines(…, ยอดที่จ่าย)` (ก1 — แบบเดียวกับ
 *   ใบรับชำระก่อนวันครบกำหนด) → Dr 11-2103 ส่วนที่ตั้งแล้ว + marker ยอดที่จ่าย · ส่วนที่ยังไม่ตั้ง = กลับด้านของ
 *   `buildRemainderAccrual2ALines` · stamp `accrued: false` ยอดสะสม = `accruedAfter` (รอบกลางคืนตั้งเฉพาะส่วนที่เหลือ)
 *
 * **marker** (`priorReceiptMarkers`) = ยอดที่จ่ายของงวดที่ยังไม่ชำระครบ (< `T` เสมอ) — Task 10 ลงเป็นรายการแยกต่องวด
 * Dr 32-1101 / Cr 11-2103 tag `2B` ให้ `reconstructPriorCleared` เห็นว่างวดนั้นถูกล้างไปแล้วเท่าไร (นับเพราะ < ยอดของงวด)
 * ใบเสร็จใบแรกหลังวันตัดจึงตัดแค่ส่วนที่เหลือ · รายการยกมา + marker = สภาพของสัญญาที่เปิดในระบบตั้งแต่แรก
 *
 * **ด่าน (คำตัดสินผู้คุมงาน C1 — ทางเลือก A):** บัญชีใช้ยอดของตัวสร้าง 2A เสมอ ยอดเรียกเก็บของระบบเก่า (`amountDue` = PEAK)
 * ต่างได้แค่เศษปัด ⇒ (Σ(11-2101 + 11-2103 + 11-2105 ของรายการยกมา) − Σ marker) − `peakRemain` ต้อง = `roundingDiff`
 * = Σ ต่องวดของ (ลูกหนี้ในบัญชี − ยอดค้างตามยอดเรียกเก็บ) = Σ(`T` − `amountDue`) ของงวดที่ยังไม่ชำระครบ และเศษต่องวด / รวม
 * ทั้งสัญญาต้องอยู่ในเกณฑ์เดียวกับ `checkInstallmentAmounts` ไม่งั้น `OpeningMismatchError` (`OPENING_PEAK_MISMATCH`) ·
 * `roundingDiff` (บัญชี − PEAK) ส่งออกไปลงตารางเชื่อมยอด · รายการยกมาต้องสมดุล (ตรวจในโค้ด)
 *
 * ข้อความ error ไม่มียอดเงินและไม่มีข้อมูลลูกค้า — ยอดอยู่ในช่องของ error ให้ผู้เรียกลงรายงาน (นอก repo)
 */

type Decimal = Prisma.Decimal;

/** บัญชีที่ยกมาได้ (ร่าง 5) — ไม่มี 11-2102 (ค่าเผื่อยกมา 0) ไม่มี 41-1101 / 21-2101 (PEAK รับรู้/ยื่นแล้ว) */
export const CARRY_FORWARD_ACCOUNTS = [
  '11-2101',
  '11-2103',
  '11-2105',
  '11-2106',
  '21-2102',
] as const;
export type CarryForwardAccount = (typeof CARRY_FORWARD_ACCOUNTS)[number];

/** ส่วนต่างของรายการยกมา — ส่วนของเจ้าของฝั่ง FINANCE (ไม่ใช่ S32-1101 ของ SHOP) */
export const OPENING_EQUITY_ACCOUNT = '32-1101';

export type OpeningInstallment = {
  installmentNo: number;
  dueDate: Date;
  /** ยอดเรียกเก็บของงวดตามระบบเก่า/PEAK (`PaymentDraft.amountDue`) — ใช้ตัดสิน "ชำระครบ" และส่วนต่างปัดเศษ */
  amountDue: Decimal;
  /** ยอดที่จ่ายค่างวด (ไม่รวมค่าปรับ — `PaymentDraft.amountPaid`) */
  paid: Decimal;
};

export type OpeningInput = {
  money: ContractMoney;
  /** งวดครบทุกงวด 1..`money.totalMonths` */
  installments: OpeningInstallment[];
  /** วันตัด (2026-11-30 23:59:59 กรุงเทพ) */
  cutoff: Date;
  /** ยอดคงเหลือใบแจ้งหนี้ใน PEAK ของสัญญา */
  peakRemain: Decimal;
};

/**
 * ค่าที่ต้องเขียนลงแถวตารางงวด — ความหมายเดียวกับคอลัมน์ `accrued*` (`AccruedSoFar`)
 * ไม่มีป้าย VAT 60 วัน (คำตัดสิน C2): ลิงก์ `vat60dayJournalEntryId` ทำให้ใบรับชำระ / 2A / JP4 / JP5 / ตัดหนี้สูญถัดไปเรียก
 * `Vat60dayReversalTemplate` กลับ VAT ที่ไม่เคยลง และรอบ VAT 60 วันข้ามงวดที่มี `accrualJournalEntryId` อยู่แล้ว
 */
export type InstallmentStamp = {
  installmentNo: number;
  /** ตั้งลูกหนี้งวดครบแล้ว → ประทับ `accrualJournalEntryId` */
  accrued: boolean;
  accruedAmount: Decimal;
  accruedVat: Decimal;
  accruedInterest: Decimal;
};

export type PriorReceiptMarker = { installmentNo: number; amount: Decimal };

export type OpeningResult = {
  /** รายการยกมา (สมดุล) — ว่าง = ไม่มีอะไรยกมา */
  openingLines: JeLineInput[];
  /** ยอดรับก่อนวันตัดของงวดที่ยังไม่ชำระครบ (เรียงตามงวด) */
  priorReceiptMarkers: PriorReceiptMarker[];
  /** VAT ของงวดที่ถึงกำหนดก่อนวันตัดแต่ยังค้าง: Dr 21-2102 / Cr 21-2101 (ว่าง = ไม่มี) */
  catchUpLines: JeLineInput[];
  /** ทุกงวด เรียงตามงวด */
  stamps: InstallmentStamp[];
  /**
   * ลูกหนี้ยกมา (หัก marker) − `peakRemain` = Σ(`T` − `amountDue`) ของงวดที่ยังไม่ชำระครบ — มีเครื่องหมาย 2 ตำแหน่ง ·
   * ลงตารางเชื่อมยอดบัญชีกับ PEAK (ยอดเรียกเก็บตรงตัวคำนวณ = 0)
   */
  roundingDiff: Decimal;
};

/** ข้อมูลเข้าไม่ครบ/ผิดรูป — ข้อความบอกแค่เลขงวดและชนิดของปัญหา */
export class OpeningInputError extends Error {
  readonly code = 'OPENING_INPUT_INVALID';

  constructor(detail: string) {
    super(`OPENING_INPUT_INVALID: คำนวณรายการยกมาไม่ได้ — ${detail}`);
    this.name = 'OpeningInputError';
  }
}

/**
 * - `GAP_NOT_ROUNDING` — ส่วนต่างบัญชีกับ PEAK ไม่เท่าส่วนต่างปัดเศษของยอดเรียกเก็บ (ยอดคงเหลือใน PEAK ≠ ยอดค้างของงวดที่ส่งมา)
 * - `ROUNDING_BEYOND_TOLERANCE` — อธิบายได้ด้วยยอดเรียกเก็บ แต่เศษต่องวดหรือรวมทั้งสัญญาเกินเกณฑ์ของ `checkInstallmentAmounts`
 */
export type OpeningMismatchReason = 'GAP_NOT_ROUNDING' | 'ROUNDING_BEYOND_TOLERANCE';

const MISMATCH_MESSAGE: Record<OpeningMismatchReason, string> = {
  GAP_NOT_ROUNDING:
    'OPENING_PEAK_MISMATCH: ลูกหนี้ยกมา (11-2101 + 11-2103 + 11-2105 หักยอดรับก่อนวันตัด) ต่างจากยอดคงเหลือใบแจ้งหนี้ใน PEAK' +
    ' มากกว่าส่วนต่างปัดเศษของยอดเรียกเก็บ — ยอดคงเหลือใน PEAK ไม่เท่ายอดค้างของงวดที่ส่งมา ต้องตรวจงวดของสัญญานี้',
  ROUNDING_BEYOND_TOLERANCE:
    'OPENING_PEAK_MISMATCH: ยอดเรียกเก็บของงวดต่างจากยอดของงวดตามตัวคำนวณเกินเกณฑ์ปัดเศษ (ต่องวดหรือรวมทั้งสัญญา' +
    ' — เกณฑ์เดียวกับ checkInstallmentAmounts) — ต้องแก้ยอดเงินของสัญญาด้วย --money-overrides หรือตรวจงวดของสัญญานี้',
};

/** ลูกหนี้ยกมาไม่เท่ายอดคงเหลือใน PEAK — ยอดอยู่ในช่องของ error ไม่อยู่ในข้อความ */
export class OpeningMismatchError extends Error {
  readonly code = 'OPENING_PEAK_MISMATCH';

  constructor(
    /** Σ(11-2101 + 11-2103 + 11-2105) ของรายการยกมา − Σ marker */
    readonly receivable: Decimal,
    readonly peakRemain: Decimal,
    /** Σ(`T` − `amountDue`) ของงวดที่ยังไม่ชำระครบ — ส่วนต่างที่อธิบายได้ด้วยยอดเรียกเก็บ */
    readonly expectedRoundingDiff: Decimal,
    readonly reason: OpeningMismatchReason,
  ) {
    super(MISMATCH_MESSAGE[reason]);
    this.name = 'OpeningMismatchError';
  }

  /** ลูกหนี้ยกมา − PEAK (ไม่หักส่วนต่างปัดเศษ) */
  get diff(): Decimal {
    return this.receivable.minus(this.peakRemain);
  }
}

const ZERO = new Prisma.Decimal(0);
/** เศษปัดรวมทั้งสัญญาไม่เกินเพดานงวดสุดท้ายของ `checkInstallmentAmounts` (ไม่ตั้งค่าที่สอง) */
const CONTRACT_ROUNDING_TOLERANCE = LAST_INSTALLMENT_AMOUNT_TOLERANCE;
const RECEIVABLE_ACCOUNTS: readonly CarryForwardAccount[] = ['11-2101', '11-2103', '11-2105'];
/** บัญชีของส่วนที่ยังไม่ตั้งลูกหนี้งวด — กลับด้านของบรรทัด 2A ส่วนที่เหลือ */
const UNACCRUED_ACCOUNTS: ReadonlySet<string> = new Set<CarryForwardAccount>([
  '11-2101',
  '11-2105',
  '11-2106',
  '21-2102',
]);

const OPENING_DESCRIPTION: Record<CarryForwardAccount | typeof OPENING_EQUITY_ACCOUNT, string> = {
  '11-2101': 'ยกมาจากระบบเก่า: ลูกหนี้ Gross ส่วนที่ยังไม่ถึงกำหนด',
  '11-2103': 'ยกมาจากระบบเก่า: ลูกหนี้ค้างชำระ (งวดที่ตั้งลูกหนี้แล้ว)',
  '11-2105': 'ยกมาจากระบบเก่า: ลูกหนี้ภาษีขายรอเรียกเก็บ ส่วนที่ยังไม่ถึงกำหนด',
  '11-2106': 'ยกมาจากระบบเก่า: รายได้รอตัดบัญชี-ดอกเบี้ย ส่วนที่ยังไม่ถึงกำหนด',
  '21-2102': 'ยกมาจากระบบเก่า: ภาษีขายรอเรียกเก็บ (รวมภาษีของงวดค้างที่รอไล่ 1 ธ.ค.)',
  '32-1101': 'ยกมาจากระบบเก่า: ส่วนของเจ้าของ (ผลต่างยอดยกมา)',
};

function validate(input: OpeningInput): OpeningInstallment[] {
  const { money, installments, cutoff } = input;
  if (!Number.isInteger(money.totalMonths) || money.totalMonths < 1) {
    throw new OpeningInputError('จำนวนงวดของสัญญา (totalMonths) ต้องเป็นจำนวนเต็มบวก');
  }
  if (Number.isNaN(cutoff.getTime())) throw new OpeningInputError('วันตัดไม่ใช่วันที่');
  if (installments.length !== money.totalMonths) {
    throw new OpeningInputError(
      `มีงวด ${installments.length} งวด แต่สัญญามี ${money.totalMonths} งวด — ต้องส่งครบทุกงวด`,
    );
  }
  const seen = new Set<number>();
  for (const inst of installments) {
    const no = inst.installmentNo;
    if (!Number.isInteger(no) || no < 1 || no > money.totalMonths) {
      throw new OpeningInputError(`เลขงวด ${no} อยู่นอกช่วง 1..${money.totalMonths}`);
    }
    if (seen.has(no)) throw new OpeningInputError(`เลขงวด ${no} ซ้ำ`);
    seen.add(no);
    if (Number.isNaN(inst.dueDate.getTime())) {
      throw new OpeningInputError(`งวด ${no}: วันครบกำหนดไม่ใช่วันที่`);
    }
    if (!inst.paid.isFinite() || inst.paid.isNegative() || inst.paid.decimalPlaces() > 2) {
      throw new OpeningInputError(`งวด ${no}: ยอดจ่ายต้องเป็นจำนวนเงินไม่ติดลบ ไม่เกิน 2 ตำแหน่ง`);
    }
    if (!inst.amountDue.isFinite() || !inst.amountDue.gt(0) || inst.amountDue.decimalPlaces() > 2) {
      throw new OpeningInputError(
        `งวด ${no}: ยอดเรียกเก็บต้องเป็นจำนวนเงินมากกว่า 0 ไม่เกิน 2 ตำแหน่ง`,
      );
    }
  }
  return [...installments].sort((a, b) => a.installmentNo - b.installmentNo);
}

/** บรรทัดหนึ่งบัญชีจากยอดสุทธิ Dr − Cr · ศูนย์ = ไม่มีบรรทัด */
function netLine(accountCode: string, net: Decimal, description: string): JeLineInput[] {
  if (net.isZero()) return [];
  return net.isPositive()
    ? [{ accountCode, dr: net, cr: ZERO, description }]
    : [{ accountCode, dr: ZERO, cr: net.negated(), description }];
}

const sumOf = (values: readonly Decimal[]) => values.reduce((s, v) => s.plus(v), ZERO);

export function computeOpening(input: OpeningInput): OpeningResult {
  const installments = validate(input);
  const { money, cutoff, peakRemain } = input;

  /** ยอดสุทธิ Dr − Cr ต่อบัญชียกมา */
  const net = new Map<CarryForwardAccount, Decimal>();
  const post = (code: CarryForwardAccount, dr: Decimal, cr: Decimal) =>
    net.set(code, (net.get(code) ?? ZERO).plus(dr).minus(cr));

  const priorReceiptMarkers: PriorReceiptMarker[] = [];
  const stamps: InstallmentStamp[] = [];
  let catchUpVat = ZERO;
  let roundingDiff = ZERO;
  let roundingBeyondTolerance = false;

  for (const inst of installments) {
    const contractInput = accrual2AInputOf(money, inst.installmentNo);
    const due = inst.dueDate.getTime() < cutoff.getTime();
    const whole = buildRemainderAccrual2ALines(contractInput, NOTHING_ACCRUED);
    const installmentTotal = whole.installmentTotal;
    const settled = inst.paid.gte(inst.amountDue) || inst.paid.gte(installmentTotal);

    // 2A ที่ระบบลงไปแล้ว ณ วันตัด: ถึงกำหนดหรือชำระครบ = ทั้งงวด · ยังไม่ถึงแต่จ่ายล่วงหน้า = ตั้งเท่ายอดที่รับ (ก1)
    let accruedPart: Accrual2APartResult | null = null;
    if (due || settled) accruedPart = whole;
    else if (inst.paid.gt(0)) {
      accruedPart = buildPartialAccrual2ALines(contractInput, NOTHING_ACCRUED, inst.paid);
    }
    const accrued: AccruedSoFar = accruedPart?.accruedAfter ?? NOTHING_ACCRUED;
    const fullyAccrued = accruedPart?.completes ?? false;

    // ส่วนที่ยังไม่ตั้ง → กลับด้านของ 2A ส่วนที่เหลือ (Dr 11-2101 / Dr 11-2105 / Cr 11-2106 / Cr 21-2102)
    if (!fullyAccrued) {
      for (const line of buildRemainderAccrual2ALines(contractInput, accrued).lines) {
        if (UNACCRUED_ACCOUNTS.has(line.accountCode)) {
          post(line.accountCode as CarryForwardAccount, line.cr, line.dr);
        }
      }
    }

    // ส่วนที่ตั้งแล้ว = Dr 11-2103 · งวดที่ชำระครบล้างในรายการเดียวกัน · งวดที่ยังค้างล้างด้วย marker (ยอดที่จ่าย < T)
    post('11-2103', accrued.amount, ZERO);
    if (settled) post('11-2103', ZERO, accrued.amount);
    else if (inst.paid.gt(0)) {
      priorReceiptMarkers.push({ installmentNo: inst.installmentNo, amount: inst.paid });
    }

    // VAT ของงวดที่ถึงกำหนดแต่ยังค้าง — ยังไม่เคยยื่น: คงใน 21-2102 แล้วไล่เข้า 21-2101 วันที่ 1 ธ.ค.
    if (due && !settled) {
      const vat = dRound(
        whole.vatPerInst.times(installmentTotal.minus(inst.paid)).div(installmentTotal),
      );
      post('21-2102', ZERO, vat);
      catchUpVat = catchUpVat.plus(vat);
    }

    // ส่วนต่างปัดเศษของงวด = ลูกหนี้ในบัญชี − ยอดค้างตามยอดเรียกเก็บ (งวดที่ยังไม่ชำระครบ = T − amountDue)
    const ledgerOutstanding = settled ? ZERO : installmentTotal.minus(inst.paid);
    const billedOutstanding = Prisma.Decimal.max(inst.amountDue.minus(inst.paid), ZERO);
    const rounding = ledgerOutstanding.minus(billedOutstanding);
    const tolerance =
      inst.installmentNo === money.totalMonths
        ? LAST_INSTALLMENT_AMOUNT_TOLERANCE
        : INSTALLMENT_AMOUNT_TOLERANCE;
    if (rounding.abs().gt(tolerance)) roundingBeyondTolerance = true;
    roundingDiff = roundingDiff.plus(rounding);

    stamps.push({
      installmentNo: inst.installmentNo,
      accrued: fullyAccrued,
      accruedAmount: accrued.amount,
      accruedVat: accrued.vat,
      accruedInterest: accrued.interest,
    });
  }

  const receivable = sumOf(RECEIVABLE_ACCOUNTS.map((code) => net.get(code) ?? ZERO)).minus(
    sumOf(priorReceiptMarkers.map((m) => m.amount)),
  );
  const mismatch = (reason: OpeningMismatchReason) =>
    new OpeningMismatchError(receivable, peakRemain, roundingDiff, reason);
  if (!receivable.minus(peakRemain).eq(roundingDiff)) throw mismatch('GAP_NOT_ROUNDING');
  if (roundingBeyondTolerance || roundingDiff.abs().gt(CONTRACT_ROUNDING_TOLERANCE)) {
    throw mismatch('ROUNDING_BEYOND_TOLERANCE');
  }

  const openingLines: JeLineInput[] = [];
  for (const code of CARRY_FORWARD_ACCOUNTS) {
    openingLines.push(...netLine(code, net.get(code) ?? ZERO, OPENING_DESCRIPTION[code]));
  }
  const imbalance = sumOf(openingLines.map((l) => l.dr.minus(l.cr)));
  openingLines.push(
    ...netLine(
      OPENING_EQUITY_ACCOUNT,
      imbalance.negated(),
      OPENING_DESCRIPTION[OPENING_EQUITY_ACCOUNT],
    ),
  );
  const totalDr = sumOf(openingLines.map((l) => l.dr));
  const totalCr = sumOf(openingLines.map((l) => l.cr));
  if (!totalDr.eq(totalCr)) {
    throw new Error('computeOpening: รายการยกมาไม่สมดุล — ตรวจตัวสร้างบรรทัด');
  }

  const catchUpLines: JeLineInput[] = catchUpVat.gt(0)
    ? [
        {
          accountCode: '21-2102',
          dr: catchUpVat,
          cr: ZERO,
          description: 'ล้าง ภาษีขายรอเรียกเก็บ ของงวดที่ค้างก่อนวันตัดระบบ',
        },
        {
          accountCode: '21-2101',
          dr: ZERO,
          cr: catchUpVat,
          description: 'ภาษีขาย ภ.พ.30 ของงวดที่ค้างก่อนวันตัดระบบ',
        },
      ]
    : [];

  return { openingLines, priorReceiptMarkers, catchUpLines, stamps, roundingDiff };
}
