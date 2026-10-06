import * as fs from 'fs';
import * as path from 'path';

// เจ้าของสั่งถอดแม่แบบ "ประกันใกล้หมด 7 วัน" (2026-09-27) — อ่านไฟล์ SQL เป็นข้อความแล้ว assert
// แบบเดียวกับ line-templates-migration.spec.ts

const MIGRATION_PATH = path.join(
  __dirname,
  '../../../../prisma/migrations/20261012100000_remove_warranty_expiring_template/migration.sql',
);

describe('migration ถอดแม่แบบ WARRANTY_EXPIRING_7D', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const statements = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

  it('soft delete เฉพาะแถว WARRANTY_EXPIRING_7D ที่ยังไม่ถูกลบ (รันซ้ำได้)', () => {
    expect(statements).toMatch(/UPDATE\s+"notification_templates"/);
    expect(statements).toMatch(/"deleted_at"\s*=\s*NOW\(\)/);
    expect(statements).toMatch(/"is_active"\s*=\s*false/);
    expect(statements).toMatch(/"event_type"\s*=\s*'WARRANTY_EXPIRING_7D'/);
    expect(statements).toMatch(/"deleted_at"\s+IS\s+NULL/);
  });

  it('ไม่ hard delete และไม่แตะแม่แบบหลังการขายตัวอื่น', () => {
    expect(statements).not.toMatch(/\bDELETE\b/i);
    expect(statements).not.toMatch(/AFTER_SALES_/);
  });
});
