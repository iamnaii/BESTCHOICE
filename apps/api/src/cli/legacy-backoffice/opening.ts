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
import type { ContractMoney } from './money';

/**
 * รายการยกมารายสัญญา (Task 7 · สเปก 5.4 + 5.6 ร่าง 5) — ฟังก์ชันบริสุทธิ์ ไม่แตะฐานข้อมูล
 *
 * **หลัก:** จำลองสภาพที่สัญญาจะมี ณ วันตัด ถ้าเปิดใน BESTCHOICE ตั้งแต่แรก (1A + 2A + ใบรับชำระ) ด้วยตัวสร้างบรรทัด 2A
 * ของระบบ (`build-accrual-2a-lines.ts` — ไม่มีสูตรชุดที่สอง) แล้วเก็บเฉพาะบัญชียกมา (`CARRY_FORWARD_ACCOUNTS`) ส่วนต่างลง
 * `32-1101` ส่วนของเจ้าของฝั่ง FINANCE · **ไม่มีบรรทัด 41-1101 / 21-2101 / เงินสด** — PEAK รับรู้รายได้และยื่น VAT ไปแล้ว
 *
 * ต่องวด ("ถึงกำหนด" = `dueDate < cutoff` แบบเดียวกับ `classify.ts` / `payments.ts` — วันตัด 30 พ.ย. 23:59:59 กรุงเทพ
 * ⇒ งวดที่ครบกำหนด 30 พ.ย. ถึงกำหนดแล้ว · 1 ธ.ค. ยังไม่ถึง) · `ยอดตัด` = min(`paid`, ยอดของงวด):
 * - **ถึงกำหนดแล้ว** = รอบกลางคืนตั้ง 2A ทั้งงวดไปแล้ว → Dr 11-2103 ยอดของงวด · ดอกเบี้ยถือว่ารับรู้แล้ว (ไม่มีใน 11-2106)
 *   · stamp `accrued: true` ยอดสะสม = ทั้งงวด
 *   - จ่ายครบ → Cr 11-2103 ยอดที่จ่าย (หักกันเป็น 0)
 *   - ยังค้าง (รวมจ่ายบางส่วน) → 11-2103 คงเต็มยอด + marker ยอดที่จ่าย (ถ้ามี) · VAT ของส่วนที่ค้าง
 *     = HALF_UP(`vatPerInst` × ยอดค้าง ÷ ยอดของงวด) **คงไว้ใน Cr 21-2102** และอยู่ใน `catchUpLines`
 *     (Dr 21-2102 / Cr 21-2101 วันที่ 1 ธ.ค. — PEAK ยื่น VAT ตามเงินรับ ส่วนนี้ยังไม่เคยยื่น · โหมดเดียว)
 * - **ยังไม่ถึงกำหนด**
 *   - ไม่ได้จ่าย → กลับด้านของ 2A ทั้งงวด: Dr 11-2101 / Dr 11-2105 / Cr 11-2106 / Cr 21-2102 · stamp `accrued: false` ยอด 0
 *   - จ่ายล่วงหน้าบางส่วน → ส่วนที่ตั้งแล้ว = `buildPartialAccrual2ALines(…, ยอดที่จ่าย)` (ก1 — แบบเดียวกับใบรับชำระก่อน
 *     วันครบกำหนด) → Dr 11-2103 ส่วนที่ตั้งแล้ว + marker ยอดที่จ่าย · ส่วนที่ยังไม่ตั้ง = กลับด้านของ
 *     `buildRemainderAccrual2ALines` · stamp `accrued: false` ยอดสะสม = `accruedAfter` (รอบกลางคืนตั้งเฉพาะส่วนที่เหลือ)
 *   - จ่ายล่วงหน้าครบ → ตั้งครบแล้ว (เหมือนใบที่ทำให้งวดชำระครบ) → ไม่มีอะไรยกมา · stamp `accrued: true`
 *
 * **marker** (`priorReceiptMarkers`) = ยอดที่จ่ายของงวดที่ยังไม่ชำระครบ — Task 10 ลงเป็นรายการแยกต่องวด
 * Dr 32-1101 / Cr 11-2103 tag `2B` ให้ `reconstructPriorCleared` เห็นว่างวดนั้นถูกล้างไปแล้วเท่าไร ใบเสร็จใบแรกหลังวันตัดจึง
 * ตัดแค่ส่วนที่เหลือ · รายการยกมา + marker = สภาพของสัญญาที่เปิดในระบบตั้งแต่แรก
 *
 * **ด่าน:** Σ(11-2101 + 11-2103 + 11-2105 ของรายการยกมา) − Σ marker ต้อง = `peakRemain` พอดี ไม่งั้น
 * `OpeningMismatchError` (`OPENING_PEAK_MISMATCH`) — ยอดของงวดใช้ตัวคำนวณของระบบ ถ้าค่างวดระบบเก่าต่างจากนี้แม้สตางค์เดียว
 * สัญญานั้นยกมาไม่ได้จนกว่าจะแก้ (สเปก 6.2: ส่วนต่าง 0 บาท) · รายการยกมาต้องสมดุล (ตรวจในโค้ด)
 *
 * **`stampVat60`** = งวดถึงกำหนดก่อนวันตัด (ตามแบบงาน) — ⚠️ ผู้เขียน (Task 10) อย่าประทับ `vat60dayJournalEntryId` ด้วยเลขรายการ
 * ยกมา: ใบรับชำระ / 2A / JP4 / JP5 / ตัดหนี้สูญกลับรายการ VAT 60 วันของงวดที่มีค่านี้ (`payment-receipt-orchestrator.ts`
 * `if (instSched.vat60dayJournalEntryId)` → `Vat60dayReversalTemplate` ลง Dr 21-2103 / Cr 11-2104 ที่ไม่มีคู่) · รอบ VAT 60 วัน
 * ข้ามงวดที่มี `accrualJournalEntryId` อยู่แล้ว (`vat-60day.cron.ts` ข้อ 11.1) — `accrued: true` พอ
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

export type OpeningInstallment = { installmentNo: number; dueDate: Date; paid: Decimal };

export type OpeningInput = {
  money: ContractMoney;
  /** งวดครบทุกงวด 1..`money.totalMonths` · `paid` = ยอดที่จ่ายค่างวด (ไม่รวมค่าปรับ — `PaymentDraft.amountPaid`) */
  installments: OpeningInstallment[];
  /** วันตัด (2026-11-30 23:59:59 กรุงเทพ) */
  cutoff: Date;
  /** ยอดคงเหลือใบแจ้งหนี้ใน PEAK ของสัญญา */
  peakRemain: Decimal;
};

/** ค่าที่ต้องเขียนลงแถวตารางงวด — ความหมายเดียวกับคอลัมน์ `accrued*` (`AccruedSoFar`) */
export type InstallmentStamp = {
  installmentNo: number;
  /** ตั้งลูกหนี้งวดครบแล้ว → ประทับ `accrualJournalEntryId` */
  accrued: boolean;
  accruedAmount: Decimal;
  accruedVat: Decimal;
  accruedInterest: Decimal;
  /** งวดถึงกำหนดก่อนวันตัด — ดูคำเตือนในหัวไฟล์ก่อนใช้ */
  stampVat60: boolean;
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
};

/** ข้อมูลเข้าไม่ครบ/ผิดรูป — ข้อความบอกแค่เลขงวดและชนิดของปัญหา */
export class OpeningInputError extends Error {
  readonly code = 'OPENING_INPUT_INVALID';

  constructor(detail: string) {
    super(`OPENING_INPUT_INVALID: คำนวณรายการยกมาไม่ได้ — ${detail}`);
    this.name = 'OpeningInputError';
  }
}

/** ลูกหนี้ยกมาไม่เท่ายอดคงเหลือใน PEAK — ยอดอยู่ในช่องของ error ไม่อยู่ในข้อความ */
export class OpeningMismatchError extends Error {
  readonly code = 'OPENING_PEAK_MISMATCH';

  constructor(
    /** Σ(11-2101 + 11-2103 + 11-2105) ของรายการยกมา − Σ marker */
    readonly receivable: Decimal,
    readonly peakRemain: Decimal,
  ) {
    super(
      'OPENING_PEAK_MISMATCH: ลูกหนี้ยกมา (11-2101 + 11-2103 + 11-2105 หักยอดรับก่อนวันตัด) ไม่เท่ายอดคงเหลือใบแจ้งหนี้ใน PEAK' +
        ' — ค่างวดตามตัวคำนวณของระบบต่างจากยอดค้างที่ปรับตาม PEAK ต้องตรวจงวดของสัญญานี้',
    );
    this.name = 'OpeningMismatchError';
  }

  /** ลูกหนี้ยกมา − PEAK */
  get diff(): Decimal {
    return this.receivable.minus(this.peakRemain);
  }
}

const ZERO = new Prisma.Decimal(0);
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

  for (const inst of installments) {
    const contractInput = accrual2AInputOf(money, inst.installmentNo);
    const due = inst.dueDate.getTime() < cutoff.getTime();

    // 2A ที่ระบบลงไปแล้ว ณ วันตัด: ถึงกำหนด = รอบกลางคืนตั้งทั้งงวด · ยังไม่ถึงแต่จ่ายล่วงหน้า = ตั้งเท่ายอดที่รับ (ก1)
    let accruedPart: Accrual2APartResult | null = null;
    if (due) accruedPart = buildRemainderAccrual2ALines(contractInput, NOTHING_ACCRUED);
    else if (inst.paid.gt(0)) {
      accruedPart = buildPartialAccrual2ALines(contractInput, NOTHING_ACCRUED, inst.paid);
    }
    const accrued: AccruedSoFar = accruedPart?.accruedAfter ?? NOTHING_ACCRUED;
    const fullyAccrued = accruedPart?.completes ?? false;

    // ส่วนที่ยังไม่ตั้ง → กลับด้านของ 2A ส่วนที่เหลือ (Dr 11-2101 / Dr 11-2105 / Cr 11-2106 / Cr 21-2102)
    const rest = buildRemainderAccrual2ALines(contractInput, accrued);
    if (!fullyAccrued) {
      for (const line of rest.lines) {
        if (UNACCRUED_ACCOUNTS.has(line.accountCode)) {
          post(line.accountCode as CarryForwardAccount, line.cr, line.dr);
        }
      }
    }

    // ส่วนที่ตั้งแล้ว = Dr 11-2103 · ใบรับชำระของงวดที่ชำระครบล้างในรายการเดียวกัน · งวดที่ยังค้างล้างด้วย marker
    const installmentTotal = rest.installmentTotal;
    const cleared = Prisma.Decimal.min(inst.paid, installmentTotal);
    const settled = cleared.eq(installmentTotal);
    post('11-2103', accrued.amount, ZERO);
    if (settled) post('11-2103', ZERO, cleared);
    else if (cleared.gt(0)) {
      priorReceiptMarkers.push({ installmentNo: inst.installmentNo, amount: cleared });
    }

    // VAT ของงวดที่ถึงกำหนดแต่ยังค้าง — ยังไม่เคยยื่น: คงใน 21-2102 แล้วไล่เข้า 21-2101 วันที่ 1 ธ.ค.
    if (due && !settled) {
      const vat = dRound(
        rest.vatPerInst.times(installmentTotal.minus(cleared)).div(installmentTotal),
      );
      post('21-2102', ZERO, vat);
      catchUpVat = catchUpVat.plus(vat);
    }

    stamps.push({
      installmentNo: inst.installmentNo,
      accrued: fullyAccrued,
      accruedAmount: accrued.amount,
      accruedVat: accrued.vat,
      accruedInterest: accrued.interest,
      stampVat60: due,
    });
  }

  const receivable = sumOf(RECEIVABLE_ACCOUNTS.map((code) => net.get(code) ?? ZERO)).minus(
    sumOf(priorReceiptMarkers.map((m) => m.amount)),
  );
  if (!receivable.eq(peakRemain)) throw new OpeningMismatchError(receivable, peakRemain);

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

  return { openingLines, priorReceiptMarkers, catchUpLines, stamps };
}
