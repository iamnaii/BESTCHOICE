import { Prisma } from '@prisma/client';
import { sqlBkkDate, sqlBkkLocal } from './bangkok-sql.util';
import { renderSqlCall } from './__tests__/raw-sql-call';

/**
 * ตัวช่วยแปลงคอลัมน์เวลาใน raw SQL เป็นเวลาไทย (2026-11-18) — คอลัมน์ DateTime ทุกตัวเป็น timestamp ไม่มี timezone
 * ที่เก็บเวลา UTC ⇒ date_trunc / EXTRACT / ::date ตรง ๆ แบ่งวันตาม UTC (ช้ากว่าไทย 7 ชั่วโมง)
 */
describe('sqlBkkLocal / sqlBkkDate', () => {
  it('sqlBkkLocal ห่อนิพจน์ด้วย AT TIME ZONE UTC แล้ว Asia/Bangkok และไม่เพิ่มพารามิเตอร์', () => {
    const sql = sqlBkkLocal('p.paid_date');
    expect(sql.sql).toBe("((p.paid_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')");
    expect(sql.values).toEqual([]);
  });

  it('รับนิพจน์ที่ไม่ใช่ชื่อคอลัมน์เดี่ยวได้ (COALESCE / MIN)', () => {
    expect(sqlBkkLocal('COALESCE(broken_at, settlement_date)').sql).toBe(
      "((COALESCE(broken_at, settlement_date) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')",
    );
    expect(sqlBkkLocal('MIN(c.created_at)').sql).toBe(
      "((MIN(c.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')",
    );
  });

  it('sqlBkkDate = วันตามปฏิทินไทยของคอลัมน์ (::date หลังแปลงเวลา)', () => {
    const sql = sqlBkkDate('p.due_date');
    expect(sql.sql).toBe("((p.due_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date");
    expect(sql.values).toEqual([]);
  });

  it('ฝังใน Prisma.sql แล้วพารามิเตอร์อื่นยังอยู่ครบและเรียงเดิม', () => {
    const since = new Date('2026-10-18T17:00:00.000Z');
    const q = Prisma.sql`SELECT date_trunc('day', ${sqlBkkLocal('created_at')}) AS d FROM t WHERE created_at >= ${since} AND id = ${'x'}`;
    expect(q.sql).toBe(
      "SELECT date_trunc('day', ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')) AS d FROM t WHERE created_at >= ? AND id = ?",
    );
    expect(q.values).toEqual([since, 'x']);
  });
});

describe('renderSqlCall (ตัวช่วยเทสต์)', () => {
  const capture = (strings: TemplateStringsArray, ...values: unknown[]) => [strings, ...values];

  it('tagged template: แทน fragment ซ้อนเป็นข้อความ และเหลือเฉพาะพารามิเตอร์จริง', () => {
    const since = new Date('2026-10-18T17:00:00.000Z');
    const call = capture`SELECT ${sqlBkkDate('x.at')} FROM x WHERE x.at >= ${since}`;
    expect(renderSqlCall(call)).toEqual({
      text: "SELECT ((x.at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date FROM x WHERE x.at >= ?",
      values: [since],
    });
  });

  it('$queryRaw(Prisma.sql`...`) และ $queryRawUnsafe(text, ...params)', () => {
    expect(renderSqlCall([Prisma.sql`SELECT ${1}`])).toEqual({ text: 'SELECT ?', values: [1] });
    expect(renderSqlCall(['SELECT $1::timestamp', '2026-10-31T17:00:00.000Z'])).toEqual({
      text: 'SELECT $1::timestamp',
      values: ['2026-10-31T17:00:00.000Z'],
    });
  });
});
