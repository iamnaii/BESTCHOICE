import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

// PR 2 Task 1 — ผูก AfterSalesCase กับ ContractExchangeRequest + backfill คำขอเดิม +
// event kind APPROVED/REJECTED. เทสต์นี้ตรวจไฟล์ migration เป็นข้อความ (ไม่แตะ DB จริง —
// การ apply บนฐานทดสอบทิ้งทำแยกด้วยมือตาม brief Step 5) + ตรวจ schema.prisma ด้วย regex
// + รัน `npx prisma validate` จริงเพื่อยืนยันว่า schema ยัง parse ผ่านหลังแก้.

const API_ROOT = path.join(__dirname, '../../../../');
const SCHEMA_PATH = path.join(API_ROOT, 'prisma/schema.prisma');
const MIGRATION_PATH = path.join(
  API_ROOT,
  'prisma/migrations/20261009000000_after_sales_exchange_link/migration.sql',
);

describe('after-sales exchange link migration (PR2 Task 1)', () => {
  it('migration.sql เพิ่มค่า enum AfterSalesEventKind.APPROVED และ REJECTED แบบ IF NOT EXISTS', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    expect(sql).toContain(
      `ALTER TYPE "AfterSalesEventKind" ADD VALUE IF NOT EXISTS 'APPROVED'`,
    );
    expect(sql).toContain(
      `ALTER TYPE "AfterSalesEventKind" ADD VALUE IF NOT EXISTS 'REJECTED'`,
    );
  });

  it('migration.sql ไม่ใช้ "AfterSalesEventKind" (รวมค่าใหม่ APPROVED/REJECTED ของมัน) นอกบรรทัด ALTER TYPE — กันชน PostgreSQL restriction ที่ห้ามอ้างอิงค่า enum ใหม่ในทรานแซกชันเดียวกันที่เพิ่งเพิ่มมัน', () => {
    // หมายเหตุ: 'APPROVED'/'REJECTED' เป็นค่าที่มีอยู่แล้วใน ExchangeRequestStatus (คนละ enum)
    // ด้วย จึงต้องเช็คที่ชื่อ type "AfterSalesEventKind" ไม่ใช่ตัวสตริง 'APPROVED'/'REJECTED' เฉยๆ
    // ซึ่งจะ false-positive กับ CASE WHEN status = 'REJECTED' (ExchangeRequestStatus) ในตัว backfill
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    const codeLines = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .filter((line) => !line.trim().startsWith('ALTER TYPE'))
      .join('\n');
    expect(codeLines).not.toContain('AfterSalesEventKind');
  });

  it('migration.sql เพิ่ม FK exchange_request_id -> contract_exchange_requests', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    expect(sql).toContain('ADD CONSTRAINT "after_sales_cases_exchange_request_id_fkey"');
    expect(sql).toContain('FOREIGN KEY ("exchange_request_id")');
    expect(sql).toContain('REFERENCES "contract_exchange_requests"("id")');
  });

  it('migration.sql backfill เฉพาะคำขอที่ยังไม่มีเคส (NOT EXISTS ... exchange_request_id = r.id)', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    expect(sql).toMatch(
      /NOT EXISTS\s*\(\s*SELECT 1 FROM "after_sales_cases" a WHERE a\.exchange_request_id = r\.id\s*\)/,
    );
  });

  it('schema.prisma: AfterSalesCase มี relation exchangeRequest -> ContractExchangeRequest', () => {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    const caseModelMatch = schema.match(/model AfterSalesCase \{[\s\S]*?\n\}/);
    expect(caseModelMatch).not.toBeNull();
    const caseModel = caseModelMatch![0];
    expect(caseModel).toMatch(
      /exchangeRequest\s+ContractExchangeRequest\?\s+@relation\("AfterSalesCaseExchangeRequest",\s*fields:\s*\[exchangeRequestId\],\s*references:\s*\[id\]\)/,
    );
  });

  it('schema.prisma: ContractExchangeRequest มี relation ย้อนกลับ afterSalesCase', () => {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    const reqModelMatch = schema.match(/model ContractExchangeRequest \{[\s\S]*?\n\}/);
    expect(reqModelMatch).not.toBeNull();
    const reqModel = reqModelMatch![0];
    expect(reqModel).toMatch(
      /afterSalesCase\s+AfterSalesCase\?\s+@relation\("AfterSalesCaseExchangeRequest"\)/,
    );
  });

  it('schema.prisma: enum AfterSalesEventKind มี APPROVED และ REJECTED ต่อท้าย NOTE', () => {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    const enumMatch = schema.match(/enum AfterSalesEventKind \{[\s\S]*?\n\}/);
    expect(enumMatch).not.toBeNull();
    const enumBody = enumMatch![0];
    expect(enumBody).toMatch(/NOTE\s*\n\s*APPROVED\s*\n\s*REJECTED\s*\n\}/);
  });

  it('npx prisma validate ผ่าน', () => {
    // prisma validate ตรวจ syntax เท่านั้น ไม่ต่อ DB จริง — แต่ยังต้องมี DATABASE_URL ให้ resolve
    // env("DATABASE_URL") ในบล็อก datasource ได้ ใช้ฐานทดสอบทิ้งของ task นี้เป็นค่าตั้งต้นเมื่อ
    // ยังไม่มีตัวแปรแวดล้อมอยู่แล้ว (ห้ามชี้ฐาน bestchoice ของเจ้าของ)
    const result = spawnSync('npx', ['prisma', 'validate'], {
      cwd: API_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL:
          process.env.DATABASE_URL ??
          'postgresql://iamnaii@localhost:5432/after_sales_pr1_test?schema=public',
      },
    });
    if (result.status !== 0) {
      // eslint-disable-next-line no-console
      console.error(result.stdout, result.stderr);
    }
    expect(result.status).toBe(0);
  }, 30000);
});
