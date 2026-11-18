import { Prisma } from '@prisma/client';

/**
 * SQL ที่ mock ของ `$queryRaw` / `$queryRawUnsafe` / `$executeRaw` ได้รับจริง รวมเป็นข้อความเดียว
 * (fragment ซ้อนจาก Prisma.sql ถูกแทนที่แล้ว · ตัวแปรเป็น `?` ยกเว้นรูป `$queryRawUnsafe` ที่คงข้อความเดิม)
 * รองรับสามรูปการเรียก: tagged template (`$queryRaw\`...\``) · `$queryRaw(Prisma.sql\`...\`)` · `$queryRawUnsafe(text, ...params)`
 */
export function renderSqlCall(call: readonly unknown[]): { text: string; values: unknown[] } {
  const [first, ...rest] = call;
  if (typeof first === 'string') return { text: first, values: rest };
  if (Array.isArray(first)) {
    const sql = Prisma.sql(first as readonly string[], ...rest);
    return { text: sql.sql, values: sql.values };
  }
  const sql = first as Prisma.Sql;
  return { text: sql.sql, values: sql.values };
}
