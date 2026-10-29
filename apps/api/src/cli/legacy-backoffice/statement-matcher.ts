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
 * 3. บรรทัดที่ยอดเท่ากันและวันเดียวกันแยกจากกันไม่ได้ จึงจับเป็นกลุ่ม: เลือกรายการรับเงินให้แบบโลภ
 *    ใกล้วันที่สุดก่อน (เสมอกัน = กลุ่มที่บรรทัดแรกมาก่อน แล้วรายการรับเงินที่มาก่อนในอาร์เรย์)
 *    - ได้ครบทุกบรรทัด → `matched` (บรรทัดเรียงตามลำดับ คู่กับรายการที่ได้มาตามลำดับความใกล้)
 *    - ไม่ได้เลย → `unmatched`
 *    - ได้น้อยกว่าจำนวนบรรทัด → **ทั้งกลุ่ม** `ambiguous` (รู้ว่ามีบรรทัดที่ไม่มีคู่ แต่ไม่รู้ว่าบรรทัดไหน)
 *      และรายการรับเงินที่กลุ่มนั้นได้ไปแล้ว **ไม่ถูกส่งต่อ** ให้บรรทัดอื่น
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

/** บรรทัดที่ยอดเท่ากันและวันเดียวกัน (ตามปฏิทินกรุงเทพ) — เรียงตามเลขบรรทัด */
type CreditGroup = {
  credits: StatementCredit[];
  amountKey: string;
  date: Date;
  /** รายการรับเงินที่กลุ่มได้ไป เรียงตามลำดับที่ได้ (ใกล้วันก่อน) */
  claimed: LegacyReceipt[];
};

/** คู่ที่เป็นไปได้ระหว่างกลุ่มกับรายการรับเงิน · `*Order` = ลำดับไว้ตัดสินเมื่อระยะเท่ากัน */
type Candidate = {
  group: CreditGroup;
  groupOrder: number;
  receipt: LegacyReceipt;
  receiptOrder: number;
  distance: number;
};

/** ยอดในรูปที่เทียบได้ตรง ๆ — `Decimal` ตัดศูนย์ท้ายแล้ว (`1500.00` = `1500`) ไม่ใช้รูปเลขยกกำลัง */
const amountKey = (amount: Decimal) => amount.toFixed();

/** จับคู่ตามกติกาหัวไฟล์ */
export function matchStatement(
  credits: readonly StatementCredit[],
  receipts: readonly LegacyReceipt[],
  dayWindow = 3,
): StatementMatch {
  const byLine = [...credits].sort((a, b) => a.line - b.line);
  const groups = new Map<string, CreditGroup>();
  for (const credit of byLine) {
    const key = `${amountKey(credit.amount)}|${bangkokDateString(credit.date)}`;
    const group = groups.get(key);
    if (group) group.credits.push(credit);
    else {
      groups.set(key, {
        credits: [credit],
        amountKey: amountKey(credit.amount),
        date: credit.date,
        claimed: [],
      });
    }
  }

  const receiptsByAmount = new Map<string, { receipt: LegacyReceipt; receiptOrder: number }[]>();
  receipts.forEach((receipt, receiptOrder) => {
    const key = amountKey(receipt.amount);
    const list = receiptsByAmount.get(key);
    if (list) list.push({ receipt, receiptOrder });
    else receiptsByAmount.set(key, [{ receipt, receiptOrder }]);
  });

  // คู่ที่เป็นไปได้ทั้งหมด เรียงใกล้วันที่สุดก่อน · Map วนกลุ่มตามบรรทัดแรก ⇒ groupOrder = ลำดับบรรทัด
  const candidates: Candidate[] = [];
  [...groups.values()].forEach((group, groupOrder) => {
    for (const { receipt, receiptOrder } of receiptsByAmount.get(group.amountKey) ?? []) {
      const distance = Math.abs(bangkokDayDiff(group.date, receipt.date));
      if (distance <= dayWindow) {
        candidates.push({ group, groupOrder, receipt, receiptOrder, distance });
      }
    }
  });
  candidates.sort(
    (a, b) =>
      a.distance - b.distance || a.groupOrder - b.groupOrder || a.receiptOrder - b.receiptOrder,
  );

  const taken = new Set<LegacyReceipt>();
  for (const { group, receipt } of candidates) {
    if (taken.has(receipt) || group.claimed.length >= group.credits.length) continue;
    group.claimed.push(receipt);
    taken.add(receipt);
  }

  const result: StatementMatch = { matched: [], unmatched: [], ambiguous: [] };
  for (const group of groups.values()) {
    if (group.claimed.length === group.credits.length) {
      group.credits.forEach((credit, i) => result.matched.push([credit, group.claimed[i]]));
    } else if (group.claimed.length === 0) result.unmatched.push(...group.credits);
    else result.ambiguous.push(...group.credits);
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
