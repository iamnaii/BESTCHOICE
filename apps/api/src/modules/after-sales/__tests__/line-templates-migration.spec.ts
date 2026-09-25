import * as fs from 'fs';
import * as path from 'path';
import {
  buildLineData,
  type AfterSalesLineMoment,
  type LineCaseRow,
} from '../utils/after-sales-line-copy.util';

// PR 3 Task 1 — migration seed ของแม่แบบ LINE 5 แถว
// แบบเดียวกับ exchange-link-migration.spec.ts (PR 2 Task 1): อ่านไฟล์ SQL เป็นข้อความแล้ว assert

const API_ROOT = path.join(__dirname, '../../../../');
const MIGRATION_PATH = path.join(
  API_ROOT,
  'prisma/migrations/20261010000000_seed_after_sales_line_templates/migration.sql',
);

function readSql(): string {
  return fs.readFileSync(MIGRATION_PATH, 'utf8');
}

/** ตัดสตริงย่อยของแถวหนึ่ง ๆ ออกมาจาก SQL เต็ม — เริ่มที่ตัว event_type จนถึงจุดเริ่มของแถวถัดไป
 * (หรือจนจบไฟล์สำหรับแถวสุดท้าย ซึ่งจะรวม `ON CONFLICT ...` ท้ายไฟล์ด้วย — ไม่กระทบ assertion) */
function rowFor(sql: string, eventType: string): string {
  const marker = `'${eventType}'`;
  const start = sql.indexOf(marker);
  if (start === -1) throw new Error(`ไม่พบ event_type ${eventType} ในไฟล์ migration`);
  const nextRowStart = sql.indexOf('(gen_random_uuid(),', start);
  const end = nextRowStart === -1 ? sql.length : nextRowStart;
  return sql.slice(start, end);
}

function extractMessage(row: string): string {
  // ต้องยึด `,` + ขึ้นบรรทัดใหม่ก่อน `E'` เสมอ (ตำแหน่งจริงของคอลัมน์ message_template ในไฟล์
  // migration) — regex ที่หา `E'...'` แบบลอย ๆ จะไปชนกับ "...'LINE', 'text',..." ก่อนหน้านั้น
  // เพราะคำว่า LINE ลงท้ายด้วย E แล้วตามด้วย quote ปิดพอดี กลายเป็น false match
  const m = row.match(/,\s*\n\s*E'([^']*)'/);
  if (!m) throw new Error("ไม่พบ message_template (E'...') ในแถวนี้");
  return m[1];
}

function extractSampleData(row: string): Record<string, unknown> {
  const m = row.match(/'(\{[^']*\})'::jsonb/);
  if (!m) throw new Error("ไม่พบ sample_data ('{...}'::jsonb) ในแถวนี้");
  return JSON.parse(m[1]);
}

function extractVars(text: string): string[] {
  const matches = [...text.matchAll(/\$\{([^}]+)\}/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

const EVENT_TYPES = [
  'AFTER_SALES_RECEIVED',
  'AFTER_SALES_READY',
  'AFTER_SALES_CLOSED',
  'AFTER_SALES_PICKUP_REMINDER',
  'WARRANTY_EXPIRING_7D',
] as const;

const EVENT_TO_MOMENT: Record<string, AfterSalesLineMoment> = {
  AFTER_SALES_RECEIVED: 'RECEIVED',
  AFTER_SALES_READY: 'READY',
  AFTER_SALES_CLOSED: 'CLOSED',
  AFTER_SALES_PICKUP_REMINDER: 'PICKUP_REMINDER',
};

// buildLineData คืนชุด key เดียวกันไม่ว่า moment ไหน (ดู after-sales-line-copy.util.ts) —
// fixture นี้ครบทุกฟิลด์เพื่อให้ Object.keys(...) เป็นซูเปอร์เซ็ตที่กว้างที่สุด
const FIXTURE: LineCaseRow = {
  caseNumber: 'AS-20260907-0004',
  outcome: 'REPAIR',
  symptom: 'เปิดไม่ติด ชาร์จไม่เข้า',
  deviceBrand: 'iPhone',
  deviceModel: '13',
  deviceStorage: '128GB',
  deviceImei: '356811111111111',
  branch: { name: 'สาขาลพบุรี' },
  warrantySnapshot: {
    status: 'IN_SHOP_WARRANTY',
    shopWarrantyEndDate: '2026-11-17T00:00:00.000Z',
    manufacturerWarrantyEndDate: '2027-03-01T00:00:00.000Z',
  },
  repairTicket: { payer: 'SHOP', estimatedCost: '1500', actualCost: '1500' },
  replacement: {
    brand: 'iPhone',
    model: '13',
    storage: '128GB',
    imeiSerial: '356812345678901',
    shopWarrantyEndDate: '2026-11-17T00:00:00.000Z',
  },
  readyAt: new Date('2026-11-17T03:00:00.000Z'),
};

// WARRANTY_EXPIRING_7D ไม่ได้มาจาก buildLineData (คนละ moment/คนละ builder — ดู jsdoc ของ
// AFTER_SALES_LINE_EVENT_TYPE ใน util) ตัวแปรของมันมาจาก sample_data ของ migration เอง
const WARRANTY_EXPIRING_ALLOWED_VARS = new Set([
  'warrantyType',
  'daysRemaining',
  'expireDate',
  'deviceName',
  'liffLine',
]);

describe('line templates migration (PR 3 Task 1)', () => {
  let sql: string;

  beforeAll(() => {
    sql = readSql();
  });

  it('ไฟล์ migration มีอยู่จริง', () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
  });

  it('idempotent ผ่าน ON CONFLICT (event_type) DO NOTHING', () => {
    expect(sql).toContain('ON CONFLICT (event_type) DO NOTHING');
  });

  it('มีครบ 5 event_type', () => {
    for (const eventType of EVENT_TYPES) {
      expect(sql).toContain(`'${eventType}'`);
    }
  });

  it('channel_key = line-shop ทุกแถว (5 ครั้งพอดี)', () => {
    const count = (sql.match(/'line-shop'/g) ?? []).length;
    expect(count).toBe(5);
  });

  it('channel = LINE ทุกแถว', () => {
    for (const eventType of EVENT_TYPES) {
      const row = rowFor(sql, eventType);
      expect(row).toContain("'LINE'");
    }
  });

  it('4 แถวแรก (AFTER_SALES_*) เป็น TRANSACTIONAL + is_active true', () => {
    for (const eventType of EVENT_TYPES.slice(0, 4)) {
      const row = rowFor(sql, eventType);
      expect(row).toContain("'TRANSACTIONAL'");
      expect(row).toMatch(/,\s*true,\s*now\(\),\s*now\(\)\)/);
    }
  });

  it('แถว WARRANTY_EXPIRING_7D เป็น REMINDER + is_active false', () => {
    const row = rowFor(sql, 'WARRANTY_EXPIRING_7D');
    expect(row).toContain("'REMINDER'");
    expect(row).toMatch(/,\s*false,\s*now\(\),\s*now\(\)\)/);
  });

  it('ไม่มี placeholder แบบ {{var}} หลงเหลือ', () => {
    expect(sql).not.toContain('{{');
  });

  it.each(Object.entries(EVENT_TO_MOMENT))(
    '%s: ทุก ${var} ในข้อความอยู่ในชุดตัวแปรที่ buildLineData ผลิต',
    (eventType, moment) => {
      const row = rowFor(sql, eventType);
      const message = extractMessage(row);
      const vars = extractVars(message);
      expect(vars.length).toBeGreaterThan(0);

      const produced = new Set(Object.keys(buildLineData(FIXTURE, moment, '')));
      for (const v of vars) {
        expect(produced.has(v)).toBe(true);
      }
    },
  );

  it('WARRANTY_EXPIRING_7D: ทุก ${var} อยู่ในชุดตัวแปรที่ประกาศไว้ (คนละ builder จาก buildLineData)', () => {
    const row = rowFor(sql, 'WARRANTY_EXPIRING_7D');
    const message = extractMessage(row);
    const vars = extractVars(message);
    expect(vars.length).toBeGreaterThan(0);
    for (const v of vars) {
      expect(WARRANTY_EXPIRING_ALLOWED_VARS.has(v)).toBe(true);
    }
  });

  it.each(EVENT_TYPES)(
    '%s: sample_data มีครบทุกตัวแปรที่ข้อความใช้ (เติมค่า preview ได้จริง)',
    (eventType) => {
      const row = rowFor(sql, eventType);
      const message = extractMessage(row);
      const vars = extractVars(message);
      const sampleData = extractSampleData(row);
      for (const v of vars) {
        expect(Object.prototype.hasOwnProperty.call(sampleData, v)).toBe(true);
        expect(typeof sampleData[v]).toBe('string');
      }
    },
  );

  it('migration ไม่ใช้คอลัมน์ deprecated (subject/flex_template) ที่ไม่มีข้อมูลจริง', () => {
    expect(sql).not.toMatch(/\bflex_template\b/);
    expect(sql).not.toMatch(/\bsubject\b/);
  });
});
