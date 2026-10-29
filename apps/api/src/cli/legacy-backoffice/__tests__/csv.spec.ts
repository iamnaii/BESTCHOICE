import { Prisma } from '@prisma/client';
import { csvLine, csvText, formatMoney, parseMoney, readCsv } from '../csv';

/** ตัวช่วยอ่าน/เขียน CSV ที่ใช้ร่วมกันทุกคำสั่ง — ข้อมูลสังเคราะห์ทั้งหมด */

const PREFIX = 'อ่านไฟล์ทดสอบไม่ได้';

describe('readCsv', () => {
  it('finds the columns by header name (any order, BOM, extra columns) and reports the line', () => {
    const rows = readCsv('﻿other,b,a\nx, 2 ,1\n\ny,4,3\n', ['a', 'b'], PREFIX);
    expect(rows.map((r) => [r.line, r.cell('a'), r.text('b')])).toEqual([
      [2, '1', '2'],
      [4, '3', '4'],
    ]);
  });

  it('names only the missing columns — never echoes a row of a file without a header', () => {
    const firstDataRow = '05/10/2569,1500.00,โอนเงิน ทดสอบ';
    let message = '';
    try {
      readCsv(`${firstDataRow}\n06/10/2569,200.00,โอนเงิน ทดสอบ\n`, ['วันที่', 'ฝาก'], PREFIX);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain(`${PREFIX}: ไม่มีคอลัมน์ วันที่, ฝาก`);
    expect(message).not.toContain('1500.00');
    expect(message).not.toContain('โอนเงิน');
  });

  it('ignores a repeated header it does not read, so a header-less row is never echoed', () => {
    // ไม่มีหัวคอลัมน์ + ยอดซ้ำในแถวแรก — เดิมขึ้น "หัวคอลัมน์ 1500 ซ้ำ" (ยกค่าในแถวมาพิมพ์)
    expect(() => readCsv('1500,1500,โอนเงิน ทดสอบ\n', ['date', 'amount'], PREFIX)).toThrow(
      /^อ่านไฟล์ทดสอบไม่ได้: ไม่มีคอลัมน์ date, amount/,
    );
    expect(() => readCsv('1500,1500,โอนเงิน ทดสอบ\n', ['date', 'amount'], PREFIX)).not.toThrow(
      /1500/,
    );
    // หัวที่ไม่ได้อ่านซ้ำกัน (เช่น ช่องว่างท้ายบรรทัด) ไม่ใช่ปัญหา
    expect(readCsv('a,,\n1,,\n', ['a'], PREFIX).map((r) => r.cell('a'))).toEqual(['1']);
  });

  it('rejects a column it reads appearing twice, naming that column', () => {
    expect(() => readCsv('a,b,a\n1,2,3\n', ['a', 'b'], PREFIX)).toThrow(
      `${PREFIX}: หัวคอลัมน์ a ซ้ำ`,
    );
  });

  it('rejects an empty file and an empty required cell (line + column, not the value)', () => {
    expect(() => readCsv('', ['a'], PREFIX)).toThrow(`${PREFIX}: ไฟล์ว่าง`);
    const [row] = readCsv('a,b\n,ข้อมูลทดสอบ\n', ['a', 'b'], PREFIX);
    expect(() => row.text('a')).toThrow(`${PREFIX}: บรรทัด 2 ช่อง a — ไม่มีค่า`);
  });
});

describe('parseMoney', () => {
  const row = (value: string) => readCsv(`amount\n"${value}"\n`, ['amount'], PREFIX)[0];

  it.each([
    ['1,500.00', '1500'],
    [' 12 345.5 ', '12345.5'],
    ['-20', '-20'],
  ])('reads %s as a Decimal', (raw, expected) => {
    const value = parseMoney(row(raw), 'amount');
    expect(value).toBeInstanceOf(Prisma.Decimal);
    expect(value.eq(expected)).toBe(true);
  });

  it.each(['1e3', '12.3.4', 'abc', '+5'])('rejects %s with the line and column only', (raw) => {
    expect(() => parseMoney(row(raw), 'amount')).toThrow(
      `${PREFIX}: บรรทัด 2 ช่อง amount — จำนวนเงินผิดรูปแบบ`,
    );
  });
});

describe('CSV writers', () => {
  it('quotes fields with a comma, a quote or a line break (RFC 4180)', () => {
    expect(csvLine(['a', 'b,c', 'd"e', 'f\ng'])).toBe('a,"b,c","d""e","f\ng"');
    expect(csvText(['h1', 'h2'], [['1', '2']])).toBe('h1,h2\n1,2\n');
  });

  it('formats money with two decimals', () => {
    expect(formatMoney(new Prisma.Decimal('1500'))).toBe('1500.00');
    expect(formatMoney(new Prisma.Decimal('-0.5'))).toBe('-0.50');
  });
});
