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
 * กติกาจับคู่ (เจ้าของยืนยัน 29/10):
 * 1. ใบที่มี IMEI → สัญญาที่ IMEI ตรงกัน (14 ตัวท้าย · สั้นกว่า 14 ตัวเทียบทั้งค่า) — หนึ่ง IMEI มีได้หลายสัญญา
 *    (เครื่องยึดคืน/เทิร์นแล้วขายต่อ) จึงคัดตามลำดับ:
 *    ก. ยอดผ่อนรวม (Σ ค่างวด) เท่า `net_amount` ±1.00 — ไม่มีเลย = กำกวม (IMEI ตรงแต่ยอดไม่ตรง)
 *    ข. ยังเหลือหลายสัญญา → สัญญาที่ผ่อนอยู่ (`statusCode '2'`)
 *    ค. ยังเหลือหลายสัญญา → วันที่ทำสัญญาใกล้วันออกใบที่สุด (นับวันตามปฏิทินกรุงเทพ) — เสมอกัน = กำกวม
 *    IMEI ไม่ตรงสัญญาใดเลย = ไม่พบคู่ (ไม่ถอยไปจับด้วยยอด)
 * 2. ใบที่ไม่มี IMEI → ยอดผ่อนรวมเท่า `net_amount` ±1.00 และวันที่ทำสัญญาห่างวันออกใบไม่เกิน 3 วัน
 *    — มากกว่าหนึ่งสัญญา = กำกวม · ไม่มี = ไม่พบคู่
 * 3. หนึ่งสัญญามีได้ใบเดียว: สัญญาที่ถูกเลือกโดยหลายใบ → ทุกใบนั้นกำกวม และสัญญาไม่มีคู่
 *
 * สัญญาที่เป็นคู่ได้ = สถานะ 2–5 (ผ่อนอยู่ / สิ้นสุด / ยกเลิก / หนี้เสีย) — สถานะ 0 (ไม่มีสถานะ) และ 1
 * (รอทำสัญญา) ยังไม่เคยเป็นสัญญาจึงไม่มีใบแจ้งหนี้ใน PEAK (`classify.ts` ให้ SKIP)
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

export type PeakMatch = {
  invoice: PeakInvoice;
  /** Σ `balance` ของงวดที่ยังมียอดคงเหลือ (> 0) */
  legacyOutstanding: Decimal;
  /** `remainAmount − legacyOutstanding` */
  diff: Decimal;
  /** Σ `amount` ของทุกงวด */
  legacyInstallmentTotal: Decimal;
  /** `netAmount − legacyInstallmentTotal` (อยู่ในช่วง ±1.00 เสมอ) */
  grossDiff: Decimal;
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
type PeakArColumn = (typeof PEAK_AR_COLUMNS)[number];

const ERROR_PREFIX = 'อ่านไฟล์ยอดลูกหนี้ PEAK ไม่ได้';
const ACTIVE_STATUS = '2';
const MATCHABLE_STATUSES: ReadonlySet<string> = new Set(['2', '3', '4', '5']);
const AMOUNT_TOLERANCE = new Prisma.Decimal(1);
const NO_IMEI_DAY_WINDOW = 3;
const IMEI_COMPARE_LENGTH = 14;
/** `yyyyMMdd` หรือ `yyyy-mm-dd` — ตัวคั่นต้องเหมือนกันทั้งสองที่ */
const DATE_PATTERN = /^(\d{4})(-?)(\d{2})\2(\d{2})$/;
const AMOUNT_PATTERN = /^-?\d+(\.\d+)?$/;

/** แถวของ CSV จาก `csv-parse` โหมด `info: true` — overload ของ type ไม่ครอบโหมดนี้ */
type ParsedRecord = { info: Info; record: string[] };

/** อ่าน CSV ยอดลูกหนี้จาก PEAK (UTF-8 มี BOM ได้) — ค่าที่อ่านไม่ได้ = throw บอกบรรทัดและคอลัมน์ ไม่มีค่า */
export function parsePeakArCsv(text: string): PeakInvoice[] {
  let records: ParsedRecord[];
  try {
    records = parse(text, {
      bom: true,
      info: true,
      skip_empty_lines: true,
      trim: true,
    }) as unknown as ParsedRecord[];
  } catch (error) {
    throw new Error(`${ERROR_PREFIX}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const [header, ...rows] = records;
  if (!header) throw new Error(`${ERROR_PREFIX}: ไฟล์ว่าง`);

  const index = new Map<string, number>();
  header.record.forEach((name, i) => {
    if (index.has(name)) throw new Error(`${ERROR_PREFIX}: หัวคอลัมน์ ${name} ซ้ำ`);
    index.set(name, i);
  });
  const missing = PEAK_AR_COLUMNS.filter((name) => !index.has(name));
  if (missing.length > 0) {
    throw new Error(
      `${ERROR_PREFIX}: ไม่มีคอลัมน์ ${missing.join(', ')} — คอลัมน์ที่มี: ${header.record.join(', ')}`,
    );
  }

  const lineOfInvoice = new Map<string, number>();
  return rows.map(({ info, record }) => {
    const line = info.lines;
    const fail = (column: PeakArColumn, what: string) =>
      new Error(`${ERROR_PREFIX}: บรรทัด ${line} ช่อง ${column} — ${what}`);
    const cell = (column: PeakArColumn) => record[index.get(column) as number] ?? '';
    const text = (column: PeakArColumn) => {
      const value = cell(column);
      if (value === '') throw fail(column, 'ไม่มีค่า');
      return value;
    };
    const money = (column: PeakArColumn): Decimal => {
      const raw = text(column).replace(/[,\s]/g, '');
      if (!AMOUNT_PATTERN.test(raw)) throw fail(column, 'จำนวนเงินผิดรูปแบบ');
      return new Prisma.Decimal(raw);
    };

    const invoiceCode = text('invoice_code');
    const previous = lineOfInvoice.get(invoiceCode);
    if (previous !== undefined) throw fail('invoice_code', `ใบแจ้งหนี้ซ้ำกับบรรทัด ${previous}`);
    lineOfInvoice.set(invoiceCode, line);

    const match = DATE_PATTERN.exec(text('issued_date'));
    if (!match) throw fail('issued_date', 'วันที่ต้องเป็น yyyyMMdd หรือ yyyy-mm-dd');
    const [, y, , m, d] = match;
    const issuedDate = bangkokMidnight(Number(y), Number(m) - 1, Number(d));
    if (bangkokDateString(issuedDate) !== `${y}-${m}-${d}`)
      throw fail('issued_date', 'วันที่ไม่มีจริง');

    return {
      invoiceCode,
      contactCode: text('contact_code'),
      issuedDate,
      netAmount: money('net_amount'),
      remainAmount: money('remain_amount'),
      imei: cell('imei') || null,
    };
  });
}

/** IMEI สำหรับเทียบ: ตัดอักขระที่ไม่ใช่ตัวอักษร/ตัวเลข ตัวพิมพ์ใหญ่ แล้วเอา 14 ตัวท้าย (สั้นกว่าใช้ทั้งค่า) */
function imeiKey(raw: string | null | undefined): string | null {
  const normalized = (raw ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return normalized === '' ? null : normalized.slice(-IMEI_COMPARE_LENGTH);
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
  total: Decimal;
  outstanding: Decimal;
  day: number;
};

/** ตัดเหลือตัวที่ค่า `score` ต่ำสุด */
function keepLowest(candidates: Candidate[], score: (c: Candidate) => number): Candidate[] {
  const best = Math.min(...candidates.map(score));
  return candidates.filter((c) => score(c) === best);
}

/** จับคู่ใบแจ้งหนี้ PEAK กับสัญญาใน `book` ตามกติกาหัวไฟล์ */
export function reconcileWithPeak(book: LegacyBook, invoices: PeakInvoice[]): PeakRecon {
  const candidates: Candidate[] = book.contracts
    .filter((contract) => MATCHABLE_STATUSES.has(contract.statusCode))
    .map((contract) => ({
      contract,
      total: installmentTotal(contract),
      outstanding: legacyOutstanding(contract),
      day: bangkokDay(contract.createdAt),
    }));
  const byImei = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = imeiKey(candidate.contract.detail.mobile_imei);
    if (key === null) continue;
    const list = byImei.get(key);
    if (list) list.push(candidate);
    else byImei.set(key, [candidate]);
  }

  /** สัญญาที่ใบนี้ชี้ · `'none'` = ไม่พบ · `'ambiguous'` = หาคู่เดียวไม่ได้ */
  const resolve = (invoice: PeakInvoice): Candidate | 'none' | 'ambiguous' => {
    const issuedDay = bangkokDay(invoice.issuedDate);
    const totalFits = (c: Candidate) =>
      c.total.minus(invoice.netAmount).abs().lte(AMOUNT_TOLERANCE);
    const key = imeiKey(invoice.imei);

    if (key === null) {
      const fits = candidates.filter(
        (c) => totalFits(c) && Math.abs(c.day - issuedDay) <= NO_IMEI_DAY_WINDOW,
      );
      if (fits.length === 0) return 'none';
      return fits.length === 1 ? fits[0] : 'ambiguous';
    }

    const sameImei = byImei.get(key) ?? [];
    if (sameImei.length === 0) return 'none';
    let fits = sameImei.filter(totalFits);
    if (fits.length > 1)
      fits = keepLowest(fits, (c) => (c.contract.statusCode === ACTIVE_STATUS ? 0 : 1));
    if (fits.length > 1) fits = keepLowest(fits, (c) => Math.abs(c.day - issuedDay));
    return fits.length === 1 ? fits[0] : 'ambiguous';
  };

  const ambiguous = new Set<PeakInvoice>();
  const unmatchedInvoices: string[] = [];
  const claims = new Map<Candidate, PeakInvoice[]>();
  for (const invoice of invoices) {
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

  const matched = new Map<string, PeakMatch>();
  for (const [candidate, claimants] of claims) {
    if (claimants.length > 1) {
      for (const invoice of claimants) ambiguous.add(invoice);
      continue;
    }
    const [invoice] = claimants;
    matched.set(candidate.contract.contractId, {
      invoice,
      legacyOutstanding: candidate.outstanding,
      diff: invoice.remainAmount.minus(candidate.outstanding),
      legacyInstallmentTotal: candidate.total,
      grossDiff: invoice.netAmount.minus(candidate.total),
    });
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
