import { Prisma } from '@prisma/client';
import { parse, type Info } from 'csv-parse/sync';
import { bangkokDateString, bangkokMidnight } from '../../utils/date.util';
import type { LegacyBook, LegacyContract } from './legacy-book';

/**
 * จับคู่ใบแจ้งหนี้ใน PEAK กับสัญญาระบบเก่า (Task 2b) — ฟังก์ชันบริสุทธิ์ ไม่แตะฐานข้อมูล
 *
 * ยอดค้างรายสัญญาที่นำเข้าต้องเท่ายอดคงเหลือของใบแจ้งหนี้ใน PEAK — ไฟล์นี้หาว่าใบไหนคือสัญญาไหน
 * และรายงานส่วนต่างกับระบบเก่า (`diff = remainAmount − legacyOutstanding`: ลบ = PEAK ต่ำกว่า
 * (PEAK มีใบเสร็จ/ใบลดหนี้ที่ระบบเก่าไม่มี) · บวก = PEAK สูงกว่า)
 *
 * กติกาจับคู่:
 * 0. คู่ที่เจ้าของกำหนดเอง (`--peak-pairs`) มาก่อน — ข้ามกติกาอัตโนมัติ (`source: 'manual'`) และสัญญานั้น
 *    ออกจากกองให้ใบอื่น · IMEI ทั้งสองฝั่งมีค่าแต่ไม่ตรงกัน → ยังจับคู่ แต่ติด `note: 'imei-mismatch'`
 * 1. ใบที่มี IMEI → สัญญาที่ IMEI ตรงกัน (`imeiEqual`) — หนึ่ง IMEI มีได้หลายสัญญา (เครื่องยึดคืน/เทิร์น
 *    แล้วขายต่อ) จึงคัดตามลำดับ (เจ้าของยืนยัน 29/10):
 *    ก. ยอดผ่อนรวม (Σ ค่างวด) เท่า `net_amount` ±1.00 — ไม่มีเลย = กำกวม (IMEI ตรงแต่ยอดไม่ตรง)
 *    ข. ยังเหลือหลายสัญญา → สัญญาที่ผ่อนอยู่ (`statusCode '2'`)
 *    ค. ยังเหลือหลายสัญญา → วันที่ทำสัญญาใกล้วันออกใบที่สุด (นับวันตามปฏิทินกรุงเทพ) — เสมอกัน = กำกวม
 *    IMEI ไม่ตรงสัญญาใดเลย = ไม่พบคู่ (ไม่ถอยไปจับด้วยยอด)
 * 2. ใบที่ไม่มี IMEI → ยอดผ่อนรวมเท่า `net_amount` ±1.00 และวันที่ทำสัญญาห่างวันออกใบไม่เกิน 3 วัน
 *    — มากกว่าหนึ่งสัญญา = กำกวม · ไม่มี = ไม่พบคู่
 * 3. หนึ่งสัญญามีได้ใบเดียว: สัญญาที่ถูกเลือกโดยหลายใบ → ทุกใบนั้นกำกวม และสัญญาไม่มีคู่
 *
 * สัญญาที่จับคู่อัตโนมัติได้ = สถานะ 2–5 (ผ่อนอยู่ / สิ้นสุด / ยกเลิก / หนี้เสีย) — สถานะ 0 (ไม่มีสถานะ) และ 1
 * (รอทำสัญญา) ยังไม่เคยเป็นสัญญาจึงไม่มีใบแจ้งหนี้ใน PEAK (`classify.ts` ให้ SKIP) · คู่ที่กำหนดเองใช้สัญญาใดก็ได้
 *
 * ไม่นับเป็นส่วนต่าง: ใบที่ยอดคงเหลือ 0 ที่ไม่พบคู่หรือกำกวม (ไม่อยู่ใน `unmatchedInvoices` / `ambiguous`)
 * และสัญญาที่ปิดแล้วที่ไม่มีคู่ (`unmatchedContracts` มีเฉพาะสัญญาผ่อนอยู่) · คู่ที่จับได้อยู่ใน `matched`
 * ทุกคู่ไม่ว่าสถานะใด
 */

type Decimal = Prisma.Decimal;

export type PeakInvoice = {
  invoiceCode: string;
  contactCode: string;
  /** เที่ยงคืนกรุงเทพของวันออกใบ */
  issuedDate: Date;
  netAmount: Decimal;
  remainAmount: Decimal;
  /** IMEI / serial จากคำอธิบายบรรทัดรายได้ 410102 / 410103 ตามที่เขียนใน CSV · ช่องว่าง = null */
  imei: string | null;
};

/** คู่ที่เจ้าของกำหนดเอง (`--peak-pairs`) */
export type PeakPair = { invoiceCode: string; legacyCode: string };

export type PeakMatch = {
  invoice: PeakInvoice;
  /** Σ `balance` ของงวดที่ยังมียอดคงเหลือ (> 0) */
  legacyOutstanding: Decimal;
  /** `remainAmount − legacyOutstanding` */
  diff: Decimal;
  /** Σ `amount` ของทุกงวด */
  legacyInstallmentTotal: Decimal;
  /** `netAmount − legacyInstallmentTotal` (คู่อัตโนมัติอยู่ในช่วง ±1.00 เสมอ) */
  grossDiff: Decimal;
  /** `manual` = จากไฟล์ `--peak-pairs` · `auto` = ตามกติกา */
  source: 'auto' | 'manual';
  /** `imei-mismatch` = คู่ที่กำหนดเองที่ IMEI ทั้งสองฝั่งมีค่าแต่ไม่ตรงกัน */
  note: 'imei-mismatch' | null;
};

export type PeakRecon = {
  /** `LegacyContract.contractId` → ใบแจ้งหนี้ที่เป็นคู่ */
  matched: Map<string, PeakMatch>;
  /** `contractId` ของสัญญาผ่อนอยู่ (สถานะ 2) ที่ไม่มีคู่ — เรียงตามลำดับใน dump */
  unmatchedContracts: string[];
  /** `invoiceCode` ที่ยอดคงเหลือ ≠ 0 และไม่พบสัญญา — เรียงตามลำดับใน CSV */
  unmatchedInvoices: string[];
  /** `invoiceCode` ที่ยอดคงเหลือ ≠ 0 และหาคู่เดียวไม่ได้ — เรียงตามลำดับใน CSV */
  ambiguous: string[];
};

/** หัวคอลัมน์ที่ต้องมีในไฟล์ `--peak-ar` (คอลัมน์อื่นไม่อ่าน) */
export const PEAK_AR_COLUMNS = [
  'invoice_code',
  'contact_code',
  'issued_date',
  'net_amount',
  'remain_amount',
  'imei',
] as const;

/** หัวคอลัมน์ที่ต้องมีในไฟล์ `--peak-pairs` (คอลัมน์อื่นไม่อ่าน) */
export const PEAK_PAIRS_COLUMNS = ['invoice_code', 'legacy_code'] as const;

const AR_ERROR = 'อ่านไฟล์ยอดลูกหนี้ PEAK ไม่ได้';
const PAIRS_ERROR = 'อ่านไฟล์จับคู่ใบแจ้งหนี้ PEAK ไม่ได้';
const RECON_ERROR = 'จับคู่ใบแจ้งหนี้ PEAK ไม่ได้';
const ACTIVE_STATUS = '2';
const MATCHABLE_STATUSES: ReadonlySet<string> = new Set(['2', '3', '4', '5']);
const AMOUNT_TOLERANCE = new Prisma.Decimal(1);
const NO_IMEI_DAY_WINDOW = 3;
const IMEI_PARTIAL_DIGITS = 14;
/** `yyyyMMdd` หรือ `yyyy-mm-dd` — ตัวคั่นต้องเหมือนกันทั้งสองที่ */
const DATE_PATTERN = /^(\d{4})(-?)(\d{2})\2(\d{2})$/;
const AMOUNT_PATTERN = /^-?\d+(\.\d+)?$/;

/** แถวของ CSV จาก `csv-parse` โหมด `info: true` — overload ของ type ไม่ครอบโหมดนี้ */
type ParsedRecord = { info: Info; record: string[] };

type CsvRow<C extends string> = {
  line: number;
  /** ค่าในช่อง (ตัดช่องว่างหัวท้ายแล้ว) · ช่องว่าง = `''` */
  cell(column: C): string;
  /** ค่าในช่องที่ต้องมี — ว่าง = throw */
  text(column: C): string;
  fail(column: C, what: string): Error;
};

/**
 * อ่าน CSV (UTF-8 มี BOM ได้) ที่ต้องมีหัวคอลัมน์ `columns` (ลำดับใดก็ได้ คอลัมน์อื่นไม่อ่าน)
 * — error บอกบรรทัดและคอลัมน์ ไม่มีค่าในช่อง
 */
function readCsv<C extends string>(
  text: string,
  columns: readonly C[],
  prefix: string,
): CsvRow<C>[] {
  let records: ParsedRecord[];
  try {
    records = parse(text, {
      bom: true,
      info: true,
      skip_empty_lines: true,
      trim: true,
    }) as unknown as ParsedRecord[];
  } catch (error) {
    throw new Error(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const [header, ...rows] = records;
  if (!header) throw new Error(`${prefix}: ไฟล์ว่าง`);

  const index = new Map<string, number>();
  header.record.forEach((name, i) => {
    if (index.has(name)) throw new Error(`${prefix}: หัวคอลัมน์ ${name} ซ้ำ`);
    index.set(name, i);
  });
  const missing = columns.filter((name) => !index.has(name));
  if (missing.length > 0) {
    throw new Error(
      `${prefix}: ไม่มีคอลัมน์ ${missing.join(', ')} — คอลัมน์ที่มี: ${header.record.join(', ')}`,
    );
  }

  return rows.map(({ info, record }) => {
    const line = info.lines;
    const fail = (column: C, what: string) =>
      new Error(`${prefix}: บรรทัด ${line} ช่อง ${column} — ${what}`);
    const cell = (column: C) => record[index.get(column) as number] ?? '';
    const required = (column: C) => {
      const value = cell(column);
      if (value === '') throw fail(column, 'ไม่มีค่า');
      return value;
    };
    return { line, cell, text: required, fail };
  });
}

/** อ่าน CSV ยอดลูกหนี้จาก PEAK (`--peak-ar`) */
export function parsePeakArCsv(text: string): PeakInvoice[] {
  const lineOfInvoice = new Map<string, number>();
  return readCsv(text, PEAK_AR_COLUMNS, AR_ERROR).map((row) => {
    const money = (column: (typeof PEAK_AR_COLUMNS)[number]): Decimal => {
      const raw = row.text(column).replace(/[,\s]/g, '');
      if (!AMOUNT_PATTERN.test(raw)) throw row.fail(column, 'จำนวนเงินผิดรูปแบบ');
      return new Prisma.Decimal(raw);
    };

    const invoiceCode = row.text('invoice_code');
    const previous = lineOfInvoice.get(invoiceCode);
    if (previous !== undefined) {
      throw row.fail('invoice_code', `ใบแจ้งหนี้ซ้ำกับบรรทัด ${previous}`);
    }
    lineOfInvoice.set(invoiceCode, row.line);

    const match = DATE_PATTERN.exec(row.text('issued_date'));
    if (!match) throw row.fail('issued_date', 'วันที่ต้องเป็น yyyyMMdd หรือ yyyy-mm-dd');
    const [, y, , m, d] = match;
    const issuedDate = bangkokMidnight(Number(y), Number(m) - 1, Number(d));
    if (bangkokDateString(issuedDate) !== `${y}-${m}-${d}`) {
      throw row.fail('issued_date', 'วันที่ไม่มีจริง');
    }

    return {
      invoiceCode,
      contactCode: row.text('contact_code'),
      issuedDate,
      netAmount: money('net_amount'),
      remainAmount: money('remain_amount'),
      imei: row.cell('imei') || null,
    };
  });
}

/** อ่าน CSV คู่ที่เจ้าของกำหนดเอง (`--peak-pairs` หัวคอลัมน์ `invoice_code,legacy_code`) */
export function parsePeakPairsCsv(text: string): PeakPair[] {
  return readCsv(text, PEAK_PAIRS_COLUMNS, PAIRS_ERROR).map((row) => ({
    invoiceCode: row.text('invoice_code'),
    legacyCode: row.text('legacy_code'),
  }));
}

/** IMEI ที่อ่านแล้ว: `whole` = ตัวอักษร/ตัวเลขล้วน ตัวพิมพ์ใหญ่ · `digits` = ตัวเลขล้วนเมื่อมี ≥ 14 หลัก */
type Imei = { whole: string; digits: string | null };

function readImei(raw: string | null | undefined): Imei | null {
  const whole = (raw ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (whole === '') return null;
  const digits = whole.replace(/\D/g, '');
  return { whole, digits: digits.length >= IMEI_PARTIAL_DIGITS ? digits : null };
}

/**
 * IMEI ตรงกัน = เท่ากันทั้งค่า · หรือทั้งคู่มีตัวเลข ≥ 14 หลักและ 14 หลักแรกเท่ากัน (PEAK พิมพ์หลักตรวจผิด)
 * · หรือทั้งคู่มีตัวเลข ≥ 14 หลักและ 14 หลักท้ายเท่ากัน — สั้นกว่า 14 หลัก (serial 12 หลัก) เทียบทั้งค่าเท่านั้น
 */
function imeiEqual(a: Imei, b: Imei): boolean {
  if (a.whole === b.whole) return true;
  if (a.digits === null || b.digits === null) return false;
  const n = IMEI_PARTIAL_DIGITS;
  return a.digits.slice(0, n) === b.digits.slice(0, n) || a.digits.slice(-n) === b.digits.slice(-n);
}

/** ลำดับวันตามปฏิทินกรุงเทพ — ใช้นับระยะห่างเป็นวัน */
function bangkokDay(date: Date): number {
  return Date.parse(`${bangkokDateString(date)}T00:00:00Z`) / 86_400_000;
}

/** Σ ค่างวดทุกงวด */
function installmentTotal(c: LegacyContract): Decimal {
  return c.installments.reduce((sum, i) => sum.plus(i.amount), new Prisma.Decimal(0));
}

/** ยอดค้างระบบเก่า = Σ `balance` ของงวดที่ยังมียอดคงเหลือ (งวดที่จ่ายเกินไม่หักลบ) */
function legacyOutstanding(c: LegacyContract): Decimal {
  return c.installments.reduce(
    (sum, i) => (i.balance.gt(0) ? sum.plus(i.balance) : sum),
    new Prisma.Decimal(0),
  );
}

type Candidate = {
  contract: LegacyContract;
  imei: Imei | null;
  total: Decimal;
  outstanding: Decimal;
  day: number;
};

/** ตัดเหลือตัวที่ค่า `score` ต่ำสุด */
function keepLowest(candidates: Candidate[], score: (c: Candidate) => number): Candidate[] {
  const best = Math.min(...candidates.map(score));
  return candidates.filter((c) => score(c) === best);
}

function toMatch(
  candidate: Candidate,
  invoice: PeakInvoice,
  source: PeakMatch['source'],
  note: PeakMatch['note'],
): PeakMatch {
  return {
    invoice,
    legacyOutstanding: candidate.outstanding,
    diff: invoice.remainAmount.minus(candidate.outstanding),
    legacyInstallmentTotal: candidate.total,
    grossDiff: invoice.netAmount.minus(candidate.total),
    source,
    note,
  };
}

/**
 * จับคู่ใบแจ้งหนี้ PEAK กับสัญญาใน `book` ตามกติกาหัวไฟล์ · `pairs` = คู่ที่เจ้าของกำหนดเอง
 * — รหัสที่ไม่มีจริง หรือใบ/สัญญาที่อยู่ใน `pairs` มากกว่าหนึ่งแถว = throw บอกรหัส
 */
export function reconcileWithPeak(
  book: LegacyBook,
  invoices: PeakInvoice[],
  pairs: readonly PeakPair[] = [],
): PeakRecon {
  const all: Candidate[] = book.contracts.map((contract) => ({
    contract,
    imei: readImei(contract.detail.mobile_imei),
    total: installmentTotal(contract),
    outstanding: legacyOutstanding(contract),
    day: bangkokDay(contract.createdAt),
  }));
  const matched = new Map<string, PeakMatch>();

  // 0. คู่ที่เจ้าของกำหนดเอง
  const contractByCode = new Map(all.map((c) => [c.contract.code, c]));
  const invoiceByCode = new Map(invoices.map((i) => [i.invoiceCode, i]));
  const manualInvoices = new Set<PeakInvoice>();
  const manualContracts = new Set<Candidate>();
  for (const pair of pairs) {
    const invoice = invoiceByCode.get(pair.invoiceCode);
    if (!invoice) {
      throw new Error(`${RECON_ERROR}: ไม่พบใบแจ้งหนี้ ${pair.invoiceCode} ในไฟล์ยอดลูกหนี้ PEAK`);
    }
    const candidate = contractByCode.get(pair.legacyCode);
    if (!candidate) throw new Error(`${RECON_ERROR}: ไม่พบสัญญา ${pair.legacyCode} ในระบบเก่า`);
    if (manualInvoices.has(invoice)) {
      throw new Error(
        `${RECON_ERROR}: ใบแจ้งหนี้ ${pair.invoiceCode} อยู่ในไฟล์จับคู่มากกว่าหนึ่งแถว`,
      );
    }
    if (manualContracts.has(candidate)) {
      throw new Error(`${RECON_ERROR}: สัญญา ${pair.legacyCode} อยู่ในไฟล์จับคู่มากกว่าหนึ่งแถว`);
    }
    manualInvoices.add(invoice);
    manualContracts.add(candidate);
    const invoiceImei = readImei(invoice.imei);
    const mismatch =
      invoiceImei !== null && candidate.imei !== null && !imeiEqual(invoiceImei, candidate.imei);
    matched.set(
      candidate.contract.contractId,
      toMatch(candidate, invoice, 'manual', mismatch ? 'imei-mismatch' : null),
    );
  }

  // 1–3. จับคู่อัตโนมัติจากสัญญาที่เหลือ
  const pool = all.filter(
    (c) => MATCHABLE_STATUSES.has(c.contract.statusCode) && !manualContracts.has(c),
  );

  /** สัญญาที่ใบนี้ชี้ · `'none'` = ไม่พบ · `'ambiguous'` = หาคู่เดียวไม่ได้ */
  const resolve = (invoice: PeakInvoice): Candidate | 'none' | 'ambiguous' => {
    const issuedDay = bangkokDay(invoice.issuedDate);
    const totalFits = (c: Candidate) =>
      c.total.minus(invoice.netAmount).abs().lte(AMOUNT_TOLERANCE);
    const imei = readImei(invoice.imei);

    if (imei === null) {
      const fits = pool.filter(
        (c) => totalFits(c) && Math.abs(c.day - issuedDay) <= NO_IMEI_DAY_WINDOW,
      );
      if (fits.length === 0) return 'none';
      return fits.length === 1 ? fits[0] : 'ambiguous';
    }

    const sameImei = pool.filter((c) => c.imei !== null && imeiEqual(c.imei, imei));
    if (sameImei.length === 0) return 'none';
    let fits = sameImei.filter(totalFits);
    if (fits.length > 1) {
      fits = keepLowest(fits, (c) => (c.contract.statusCode === ACTIVE_STATUS ? 0 : 1));
    }
    if (fits.length > 1) fits = keepLowest(fits, (c) => Math.abs(c.day - issuedDay));
    return fits.length === 1 ? fits[0] : 'ambiguous';
  };

  const ambiguous = new Set<PeakInvoice>();
  const unmatchedInvoices: string[] = [];
  const claims = new Map<Candidate, PeakInvoice[]>();
  for (const invoice of invoices) {
    if (manualInvoices.has(invoice)) continue;
    const result = resolve(invoice);
    if (result === 'ambiguous') ambiguous.add(invoice);
    else if (result === 'none') {
      if (!invoice.remainAmount.isZero()) unmatchedInvoices.push(invoice.invoiceCode);
    } else {
      const list = claims.get(result);
      if (list) list.push(invoice);
      else claims.set(result, [invoice]);
    }
  }
  for (const [candidate, claimants] of claims) {
    if (claimants.length > 1) {
      for (const invoice of claimants) ambiguous.add(invoice);
      continue;
    }
    matched.set(candidate.contract.contractId, toMatch(candidate, claimants[0], 'auto', null));
  }

  return {
    matched,
    unmatchedContracts: book.contracts
      .filter((c) => c.statusCode === ACTIVE_STATUS && !matched.has(c.contractId))
      .map((c) => c.contractId),
    unmatchedInvoices,
    ambiguous: invoices
      .filter((invoice) => ambiguous.has(invoice) && !invoice.remainAmount.isZero())
      .map((invoice) => invoice.invoiceCode),
  };
}

/** หนึ่งบรรทัดของ CSV (RFC 4180) */
function csvLine(fields: readonly string[]): string {
  return fields.map((f) => (/[",\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f)).join(',');
}

function csvText(header: readonly string[], rows: readonly string[][]): string {
  return [header, ...rows].map(csvLine).join('\n') + '\n';
}

const money = (value: Decimal) => value.toFixed(2);

/**
 * `peak-recon.csv` — หนึ่งแถวต่อคู่ที่จับได้ เรียงตามเลขสัญญาเดิม · มีแต่รหัสและยอดเงิน ไม่มีชื่อลูกค้า
 */
export function peakReconCsv(book: LegacyBook, recon: PeakRecon): string {
  const rows = book.contracts
    .filter((c) => recon.matched.has(c.contractId))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((c) => {
      const m = recon.matched.get(c.contractId) as PeakMatch;
      return [
        c.code,
        m.invoice.invoiceCode,
        m.invoice.contactCode,
        c.statusCode,
        money(m.legacyInstallmentTotal),
        money(m.invoice.netAmount),
        money(m.grossDiff),
        money(m.legacyOutstanding),
        money(m.invoice.remainAmount),
        money(m.diff),
        m.source,
        m.note ?? '',
      ];
    });
  return csvText(
    [
      'legacy_code',
      'invoice_code',
      'peak_contact_code',
      'legacy_status',
      'legacy_installment_total',
      'peak_net_amount',
      'gross_diff',
      'legacy_outstanding',
      'peak_remain',
      'diff',
      'source',
      'note',
    ],
    rows,
  );
}

/**
 * `peak-recon-unmatched.csv` — สัญญาผ่อนอยู่ที่ไม่มีคู่ (พร้อมยอดค้างระบบเก่า) · ใบที่กำกวม · ใบที่ไม่พบสัญญา
 */
export function peakReconUnmatchedCsv(book: LegacyBook, recon: PeakRecon): string {
  const byId = new Map(book.contracts.map((c) => [c.contractId, c]));
  return csvText(
    ['kind', 'code', 'legacy_outstanding'],
    [
      ...recon.unmatchedContracts.map((id) => {
        const c = byId.get(id) as LegacyContract;
        return ['unmatched-contract', c.code, money(legacyOutstanding(c))];
      }),
      ...recon.ambiguous.map((code) => ['ambiguous-invoice', code, '']),
      ...recon.unmatchedInvoices.map((code) => ['unmatched-invoice', code, '']),
    ],
  );
}
