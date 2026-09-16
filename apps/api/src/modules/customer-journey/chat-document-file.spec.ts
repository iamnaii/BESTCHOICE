import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { CHAT_DOCUMENT_FILE_PATTERN, CUSTOMER_DOCUMENT_FILE_FRAGMENT, CUSTOMER_DOCUMENT_FILE_SQL } from './chat-document-file';

/** ไฟล์ .ts / .sql ของโมดูลนี้ที่ไม่ใช่ spec — ใช้ตรวจว่าไม่มีใครเขียนกติกาไฟล์เอกสารซ้ำ */
function moduleSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return moduleSourceFiles(path);
    return /\.(ts|sql)$/.test(name) && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

/**
 * "ลูกค้าส่งไฟล์เอกสารในแชท" มีนิยามเดียว (คำตัดสินผู้ควบคุม R-P1 2026-09-15)
 * TS ใช้ค่าคงที่จาก chat-document-file.ts · journey-state.sql import ไม่ได้จึงเขียนข้อความเดียวกันตรงตัวอักษร — spec นี้ปักว่าตรงกัน
 * พฤติกรรมกับ Postgres จริงอยู่ที่ journey-state.signals.db.spec.ts
 */
describe('chat-document-file — เงื่อนไขไฟล์เอกสารที่ลูกค้าส่งในแชท (R-P1)', () => {
  it('pattern = นามสกุล pdf / doc / docx / xls / xlsx ตามด้วย ? หรือจบสตริง · เงื่อนไข SQL เต็มใช้ alias m', () => {
    expect(CHAT_DOCUMENT_FILE_PATTERN).toBe('\\.(pdf|docx?|xlsx?)(\\?|$)');
    expect(CUSTOMER_DOCUMENT_FILE_SQL).toBe("m.role = 'CUSTOMER' AND m.type = 'FILE' AND m.media_url ~* '\\.(pdf|docx?|xlsx?)(\\?|$)'");
  });

  it('fragment ของ $queryRaw = ข้อความเดียวกันทุกตัวอักษร ไม่มีพารามิเตอร์', () => {
    expect(CUSTOMER_DOCUMENT_FILE_FRAGMENT.text).toBe(CUSTOMER_DOCUMENT_FILE_SQL);
    expect(CUSTOMER_DOCUMENT_FILE_FRAGMENT.values).toEqual([]);
  });

  it("journey-state.sql เขียนเงื่อนไขเดียวกันตรงตัวอักษรครั้งเดียว และไม่มี 'FILE' นอกเงื่อนไขนี้", () => {
    const sql = readFileSync(join(__dirname, 'sql', 'journey-state.sql'), 'utf8');
    expect(sql.split(CUSTOMER_DOCUMENT_FILE_SQL)).toHaveLength(2);
    expect(sql.split("'FILE'")).toHaveLength(2);
  });

  it("ไฟล์อื่นของโมดูลไม่เขียน 'FILE' หรือ regex นามสกุลเอกสารซ้ำ — ต้อง import จาก chat-document-file.ts", () => {
    const owners = moduleSourceFiles(__dirname)
      .filter((path) => {
        const text = readFileSync(path, 'utf8');
        return text.includes("'FILE'") || text.includes('pdf|docx');
      })
      .map((path) => relative(__dirname, path))
      .sort();
    expect(owners).toEqual(['chat-document-file.ts', 'sql/journey-state.sql']);
  });
});
