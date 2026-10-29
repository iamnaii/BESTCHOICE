import { Prisma } from '@prisma/client';
import { bangkokDateString, bangkokDayDiff, bangkokMidnight } from '../../utils/date.util';
import { csvText, formatMoney, parseMoney, readCsv, type CsvRow } from './csv';
import type { LegacyReceipt } from './legacy-book';

/**
 * จับคู่ statement ธนาคาร (เงินเข้า) กับรายการรับเงินของระบบเก่า (Task 3) — ฟังก์ชันบริสุทธิ์ ไม่แตะฐานข้อมูล
 *
 * ให้เจ้าของหาเงินที่เข้าบัญชีแต่ระบบเก่าไม่มีรายการรับเงิน (`unmatched`) และเงินที่ระบุคู่ไม่ได้ (`ambiguous`)
 *
 * กติกาจับคู่ (`matchStatement`):
 * 1. คู่ได้เมื่อยอดเท่ากันพอดี (`Decimal` เท่ากัน — ไม่ปัด) และวันที่ห่างกันไม่เกิน `dayWindow` วัน
 *    (นับวันตามปฏิทินกรุงเทพ ก่อนหรือหลังก็ได้) · ฝั่งระบบเก่าใช้ `amount` (เงินที่รับจริง) และ `date` (วันโอน)
 * 2. หนึ่งบรรทัดของ statement คู่กับรายการรับเงินได้รายการเดียว และกลับกัน
 * 3. จับคู่ทุกบรรทัดให้ได้ **มากที่สุด** (maximum matching — บรรทัดที่ "ไม่พบ" ทั้งที่มีทางจับคู่ เสี่ยงบันทึกซ้ำ):
 *    เริ่มแบบโลภใกล้วันก่อน (เสมอกัน = บรรทัดที่มาก่อน แล้วรายการรับเงินที่มาก่อนในอาร์เรย์) แล้วสลับคู่ให้บรรทัด
 *    ที่ยังไม่มีคู่ (augmenting path) — ระยะรวมมักน้อยที่สุดแต่ไม่รับประกัน
 * 4. **หลัง**จับคู่เสร็จ ตัดสินทีละกลุ่มของบรรทัดที่ยอดเท่ากันและวันเดียวกัน (แยกจากกันไม่ได้):
 *    ก. ได้คู่ครบทุกบรรทัด → `matched`
 *    ข. กลุ่มหลายบรรทัดที่มีรายการรับเงินในช่วงวันแต่ได้คู่ไม่ครบ (รวมไม่ได้เลยเพราะบรรทัดอื่นได้ไป) →
 *       **ทั้งกลุ่ม** `ambiguous` (รู้ว่ามีบรรทัดที่ไม่มีคู่ แต่ไม่รู้ว่าบรรทัดไหน) และรายการที่บรรทัดในกลุ่ม
 *       ได้ไปแล้ว **ไม่ถูกส่งต่อ** ให้บรรทัดอื่น
 *    ค. นอกนั้น (บรรทัดเดียวที่ไม่ได้คู่ · กลุ่มที่ไม่มีรายการในช่วงวันเลย) → `unmatched`
 *    ข้อจำกัด: เมื่อรายการรับเงินมีน้อยกว่าบรรทัดจริง ๆ คำตอบว่า "บรรทัดไหนไม่มีคู่" ไม่ได้มีคำตอบเดียว —
 *    ตัดสินตามลำดับข้อ 3 (ใกล้วันก่อน แล้วบรรทัดที่มาก่อน)
 * ทุกรายการที่คืนเรียงตามเลขบรรทัด
 *
 * อ่านไฟล์ (`parseStatementCsv`): หัวคอลัมน์ระบุผ่าน `--cols` · เก็บเฉพาะยอดเข้า (> 0) — บรรทัดที่ช่องยอดว่าง
 * ติดลบ หรือศูนย์ ข้ามโดยไม่ตรวจช่องอื่น · วันที่ `dd/mm/yyyy` (วัน/เดือนหลักเดียวได้) หรือ `yyyy-mm-dd`
 * ปี > 2400 = พ.ศ. (ลบ 543) · ยอดตัด `,` และช่องว่าง
 */

type Decimal = Prisma.Decimal;

export type StatementCredit = {
  /** เลขบรรทัดในไฟล์ statement (หัวคอลัมน์ = 1) */
  line: number;
  /** เที่ยงคืนกรุงเทพของวันที่ในบรรทัด */
  date: Date;
  /** ยอดเงินเข้า (> 0) */
  amount: Decimal;
  /** ข้อความรายการจากธนาคาร (อาจมีชื่อผู้โอน) · ไม่ระบุคอลัมน์ = `''` */
  description: string;
};

/** ชื่อหัวคอลัมน์ในไฟล์ statement */
export type StatementCols = { date: string; amount: string; description?: string };

export type StatementMatch = {
  matched: Array<[StatementCredit, LegacyReceipt]>;
  unmatched: StatementCredit[];
  ambiguous: StatementCredit[];
};

const STATEMENT_ERROR = 'อ่านไฟล์ statement ธนาคารไม่ได้';
const DMY_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/** ปีที่มากกว่านี้ = พุทธศักราช */
const BUDDHIST_ERA_FROM = 2400;
const BUDDHIST_ERA_OFFSET = 543;

/** วันที่ในช่อง → เที่ยงคืนกรุงเทพ · ผิดรูปแบบ / ไม่มีจริง = throw (บรรทัด + คอลัมน์ ไม่มีค่าในช่อง) */
function parseStatementDate<C extends string>(row: CsvRow<C>, column: C): Date {
  const raw = row.text(column);
  let ymdParts: [string, string, string];
  const dmy = DMY_PATTERN.exec(raw);
  if (dmy) ymdParts = [dmy[3], dmy[2], dmy[1]];
  else {
    const ymd = YMD_PATTERN.exec(raw);
    if (!ymd) throw row.fail(column, 'วันที่ต้องเป็น dd/mm/yyyy หรือ yyyy-mm-dd');
    ymdParts = [ymd[1], ymd[2], ymd[3]];
  }
  const [y, m, d] = ymdParts;

  let year = Number(y);
  if (year > BUDDHIST_ERA_FROM) year -= BUDDHIST_ERA_OFFSET;
  const date = bangkokMidnight(year, Number(m) - 1, Number(d));
  const expected = `${String(year).padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  if (bangkokDateString(date) !== expected) throw row.fail(column, 'วันที่ไม่มีจริง');
  return date;
}

/** อ่าน CSV statement ธนาคาร (`--statement`) — เฉพาะบรรทัดเงินเข้า */
export function parseStatementCsv(text: string, cols: StatementCols): StatementCredit[] {
  const columns = [cols.date, cols.amount];
  if (cols.description !== undefined) columns.push(cols.description);

  const credits: StatementCredit[] = [];
  for (const row of readCsv(text, columns, STATEMENT_ERROR)) {
    if (row.cell(cols.amount) === '') continue;
    const amount = parseMoney(row, cols.amount);
    if (amount.lte(0)) continue;
    credits.push({
      line: row.line,
      date: parseStatementDate(row, cols.date),
      amount,
      description: cols.description === undefined ? '' : row.cell(cols.description),
    });
  }
  return credits;
}

const COL_KEYS = ['date', 'amount', 'description'] as const;
type ColKey = (typeof COL_KEYS)[number];
const COLS_ERROR = '--cols';

/** ค่า `--cols date=<หัว>,amount=<หัว>[,description=<หัว>]` → ชื่อหัวคอลัมน์ (`=` ตัวแรกเป็นตัวคั่น) */
export function parseStatementCols(spec: string): StatementCols {
  const found: Partial<Record<ColKey, string>> = {};
  for (const part of spec.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) {
      throw new Error(
        `${COLS_ERROR}: ต้องเป็น ชื่อ=หัวคอลัมน์ คั่นด้วย , (เช่น date=วันที่,amount=ฝาก)`,
      );
    }
    const key = part.slice(0, eq).trim();
    const header = part.slice(eq + 1).trim();
    if (!(COL_KEYS as readonly string[]).includes(key)) {
      throw new Error(`${COLS_ERROR}: ไม่รู้จัก ${key} — ใช้ได้: ${COL_KEYS.join(', ')}`);
    }
    if (found[key as ColKey] !== undefined) throw new Error(`${COLS_ERROR}: ระบุ ${key} ซ้ำ`);
    if (header === '') throw new Error(`${COLS_ERROR}: ${key} ต้องมีชื่อหัวคอลัมน์`);
    found[key as ColKey] = header;
  }
  if (found.date === undefined) throw new Error(`${COLS_ERROR}: ต้องระบุ date=<หัวคอลัมน์วันที่>`);
  if (found.amount === undefined) {
    throw new Error(`${COLS_ERROR}: ต้องระบุ amount=<หัวคอลัมน์ยอดเงินเข้า>`);
  }
  return {
    date: found.date,
    amount: found.amount,
    ...(found.description === undefined ? {} : { description: found.description }),
  };
}

/** รายการรับเงินที่อยู่ในช่วงวันของบรรทัด — เรียงใกล้วันก่อน แล้วตามลำดับในอาร์เรย์ */
type ReceiptOption = { receipt: LegacyReceipt; receiptOrder: number; distance: number };

/** บรรทัดที่ยอดเท่ากันและวันเดียวกัน (ตามปฏิทินกรุงเทพ) — เรียงตามเลขบรรทัด · ทุกบรรทัดมีตัวเลือกชุดเดียวกัน */
type CreditGroup = { credits: StatementCredit[]; options: ReceiptOption[] };

/** ยอดในรูปที่เทียบได้ตรง ๆ — `Decimal` ตัดศูนย์ท้ายแล้ว (`1500.00` = `1500`) ไม่ใช้รูปเลขยกกำลัง */
const amountKey = (amount: Decimal) => amount.toFixed();

/** จับคู่ตามกติกาหัวไฟล์ */
export function matchStatement(
  credits: readonly StatementCredit[],
  receipts: readonly LegacyReceipt[],
  dayWindow = 3,
): StatementMatch {
  const receiptsByAmount = new Map<string, { receipt: LegacyReceipt; receiptOrder: number }[]>();
  receipts.forEach((receipt, receiptOrder) => {
    const key = amountKey(receipt.amount);
    const list = receiptsByAmount.get(key);
    if (list) list.push({ receipt, receiptOrder });
    else receiptsByAmount.set(key, [{ receipt, receiptOrder }]);
  });
  const optionsFor = (credit: StatementCredit): ReceiptOption[] =>
    (receiptsByAmount.get(amountKey(credit.amount)) ?? [])
      .map((r) => ({ ...r, distance: Math.abs(bangkokDayDiff(credit.date, r.receipt.date)) }))
      .filter((o) => o.distance <= dayWindow)
      .sort((a, b) => a.distance - b.distance || a.receiptOrder - b.receiptOrder);

  // Map วนตามบรรทัดแรกของกลุ่ม ⇒ ลำดับกลุ่ม = ลำดับบรรทัด
  const groups = new Map<string, CreditGroup>();
  for (const credit of [...credits].sort((a, b) => a.line - b.line)) {
    const key = `${amountKey(credit.amount)}|${bangkokDateString(credit.date)}`;
    const group = groups.get(key);
    if (group) group.credits.push(credit);
    else groups.set(key, { credits: [credit], options: optionsFor(credit) });
  }

  // ขั้น 1 — จับคู่ทุกบรรทัดให้ได้จำนวนมากที่สุด (maximum bipartite matching): เริ่มจากแบบโลภใกล้วันก่อน
  // แล้วหาทางสลับคู่ (augmenting path) ให้บรรทัดที่ยังไม่มีคู่ทีละบรรทัด — ลองรายการที่ใกล้กว่าก่อนเสมอ
  // (ระยะรวมมักน้อยที่สุด แต่ไม่รับประกัน)
  const optionsOf = new Map<StatementCredit, ReceiptOption[]>();
  const pairs: { credit: StatementCredit; option: ReceiptOption }[] = [];
  for (const group of groups.values()) {
    for (const credit of group.credits) {
      optionsOf.set(credit, group.options);
      for (const option of group.options) pairs.push({ credit, option });
    }
  }
  pairs.sort(
    (a, b) =>
      a.option.distance - b.option.distance ||
      a.credit.line - b.credit.line ||
      a.option.receiptOrder - b.option.receiptOrder,
  );
  const receiptOf = new Map<StatementCredit, LegacyReceipt>();
  const creditOf = new Map<LegacyReceipt, StatementCredit>();
  const assign = (credit: StatementCredit, receipt: LegacyReceipt) => {
    receiptOf.set(credit, receipt);
    creditOf.set(receipt, credit);
  };
  for (const { credit, option } of pairs) {
    if (!receiptOf.has(credit) && !creditOf.has(option.receipt)) assign(credit, option.receipt);
  }
  const augment = (credit: StatementCredit, visited: Set<LegacyReceipt>): boolean => {
    for (const { receipt } of optionsOf.get(credit) ?? []) {
      if (visited.has(receipt)) continue;
      visited.add(receipt);
      const holder = creditOf.get(receipt);
      if (holder === undefined || augment(holder, visited)) {
        assign(credit, receipt);
        return true;
      }
    }
    return false;
  };
  for (const credit of [...optionsOf.keys()].sort((a, b) => a.line - b.line)) {
    if (!receiptOf.has(credit)) augment(credit, new Set());
  }

  // ขั้น 2 — ตัดสินทีละกลุ่มหลังจับคู่เสร็จ: ได้ครบ = matched · กลุ่มหลายบรรทัดที่มีรายการในช่วงวันแต่ได้ไม่ครบ
  // = กำกวมทั้งกลุ่ม (รายการที่บรรทัดในกลุ่มได้ไปไม่ถูกส่งต่อ) · นอกนั้น = unmatched
  const result: StatementMatch = { matched: [], unmatched: [], ambiguous: [] };
  for (const group of groups.values()) {
    const got = group.credits.filter((credit) => receiptOf.has(credit)).length;
    if (got === group.credits.length) {
      for (const credit of group.credits) {
        result.matched.push([credit, receiptOf.get(credit) as LegacyReceipt]);
      }
    } else if (group.credits.length > 1 && group.options.length > 0) {
      result.ambiguous.push(...group.credits);
    } else result.unmatched.push(...group.credits);
  }
  result.matched.sort(([a], [b]) => a.line - b.line);
  result.unmatched.sort((a, b) => a.line - b.line);
  result.ambiguous.sort((a, b) => a.line - b.line);
  return result;
}

/** ข้อความที่ขึ้นต้นแบบสูตร (`=` `+` `-` `@`) ถูกเติม `'` — กันสเปรดชีตรันข้อความรายการเป็นสูตร */
const FORMULA_START = /^[=+\-@\t\r]/;
const textCell = (value: string) => (FORMULA_START.test(value) ? `'${value}` : value);

/**
 * `unmatched.csv` / `ambiguous.csv` — `line,date,amount,description` (วันที่ `yyyy-mm-dd` ตามปฏิทินกรุงเทพ)
 * · คำอธิบายเป็นข้อความจากธนาคาร (อาจมีชื่อผู้โอน) — ไฟล์อยู่นอก repo เท่านั้น
 */
export function statementCreditsCsv(credits: readonly StatementCredit[]): string {
  return csvText(
    ['line', 'date', 'amount', 'description'],
    credits.map((credit) => [
      String(credit.line),
      bangkokDateString(credit.date),
      formatMoney(credit.amount),
      textCell(credit.description),
    ]),
  );
}
