import { Prisma } from '@prisma/client';
import { parse, type Info } from 'csv-parse/sync';

/**
 * อ่าน/เขียน CSV ของตัวนำเข้าระบบเก่า — ใช้ร่วมกันทุกคำสั่ง
 *
 * ไฟล์ที่อ่านมีข้อมูลลูกค้าจริง ⇒ ข้อความ error บอกได้แค่บรรทัด ชื่อคอลัมน์ที่โค้ด/ผู้ใช้ระบุ และชนิดของปัญหา
 * **ห้ามยกค่าในช่องหรือแถวใดของไฟล์มาพิมพ์**
 */

type Decimal = Prisma.Decimal;

/** แถวของ CSV จาก `csv-parse` โหมด `info: true` — overload ของ type ไม่ครอบโหมดนี้ */
type ParsedRecord = { info: Info; record: string[] };

export type CsvRow<C extends string> = {
  /** เลขบรรทัดในไฟล์ (หัวคอลัมน์ = 1) */
  line: number;
  /** ค่าในช่อง (ตัดช่องว่างหัวท้ายแล้ว) · ช่องว่าง = `''` */
  cell(column: C): string;
  /** ค่าในช่องที่ต้องมี — ว่าง = throw */
  text(column: C): string;
  /** error ของช่องนี้: `<prefix>: บรรทัด N ช่อง <column> — <what>` */
  fail(column: C, what: string): Error;
};

/**
 * อ่าน CSV (UTF-8 มี BOM ได้) ที่แถวแรกเป็นหัวคอลัมน์และต้องมีทุกชื่อใน `columns` (ลำดับใดก็ได้
 * คอลัมน์อื่นไม่อ่าน · หัวที่ไม่ได้อ่านซ้ำกันได้) — ข้ามบรรทัดว่าง
 */
export function readCsv<C extends string>(
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

  // ตรวจเฉพาะชื่อที่อ่าน — ไฟล์ที่ไม่มีหัวคอลัมน์ แถวแรกคือข้อมูล การพิมพ์ "หัว" ที่ซ้ำ = พิมพ์ค่าในแถว
  const wanted = new Set<string>(columns);
  const index = new Map<string, number>();
  header.record.forEach((name, i) => {
    if (!wanted.has(name)) return;
    if (index.has(name)) throw new Error(`${prefix}: หัวคอลัมน์ ${name} ซ้ำ`);
    index.set(name, i);
  });
  const missing = columns.filter((name) => !index.has(name));
  if (missing.length > 0) {
    throw new Error(
      `${prefix}: ไม่มีคอลัมน์ ${missing.join(', ')} — แถวแรกของไฟล์ต้องเป็นหัวคอลัมน์`,
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

const AMOUNT_PATTERN = /^-?\d+(\.\d+)?$/;

/** จำนวนเงินในช่องที่ต้องมี — ตัด `,` และช่องว่างออก · ติดลบได้ · ผิดรูปแบบ = throw (บรรทัด + คอลัมน์) */
export function parseMoney<C extends string>(row: CsvRow<C>, column: C): Decimal {
  const raw = row.text(column).replace(/[,\s]/g, '');
  if (!AMOUNT_PATTERN.test(raw)) throw row.fail(column, 'จำนวนเงินผิดรูปแบบ');
  return new Prisma.Decimal(raw);
}

/** หนึ่งบรรทัดของ CSV (RFC 4180) */
export function csvLine(fields: readonly string[]): string {
  return fields.map((f) => (/[",\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f)).join(',');
}

/** ทั้งไฟล์: หัวคอลัมน์ + แถว · ลงท้ายด้วย `\n` */
export function csvText(header: readonly string[], rows: readonly string[][]): string {
  return [header, ...rows].map(csvLine).join('\n') + '\n';
}

/** จำนวนเงินในไฟล์ผลลัพธ์ — ทศนิยม 2 ตำแหน่ง */
export function formatMoney(value: Decimal): string {
  return value.toFixed(2);
}
