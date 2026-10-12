import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

// PR 5 Task 1 — ใบขายที่สลับเครื่องแล้วชี้เคสหลังการขายครั้งล่าสุด (คอลัมน์เดียว nullable, forward-only)
const API_ROOT = path.join(__dirname, '../../../../');
const SCHEMA_PATH = path.join(API_ROOT, 'prisma/schema.prisma');
const MIGRATION_PATH = path.join(
  API_ROOT,
  'prisma/migrations/20261022000000_sale_exchange_case/migration.sql',
);

describe('sale exchange case migration (PR5 Task 1)', () => {
  it('migration.sql เพิ่มคอลัมน์ exchange_case_id แบบ nullable + index + FK ไป after_sales_cases', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    expect(sql).toContain('ALTER TABLE "sales" ADD COLUMN "exchange_case_id" TEXT;');
    expect(sql).toContain('CREATE INDEX "sales_exchange_case_id_idx" ON "sales"("exchange_case_id");');
    expect(sql).toContain('ADD CONSTRAINT "sales_exchange_case_id_fkey"');
    expect(sql).toContain('REFERENCES "after_sales_cases"("id") ON DELETE RESTRICT');
    expect(sql).not.toMatch(/NOT NULL/);
    expect(sql).not.toMatch(/UPDATE "sales"/);
  });

  it('schema.prisma: Sale มี exchangeCaseId + relation SaleExchangeCase ทั้งสองฝั่ง', () => {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    const sale = schema.match(/model Sale \{[\s\S]*?\n\}/)![0];
    expect(sale).toMatch(/exchangeCaseId\s+String\?\s+@map\("exchange_case_id"\)/);
    expect(sale).toMatch(
      /exchangeCase\s+AfterSalesCase\?\s+@relation\("SaleExchangeCase",\s*fields:\s*\[exchangeCaseId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict\)/,
    );
    expect(sale).toMatch(/@@index\(\[exchangeCaseId\]\)/);
    const asCase = schema.match(/model AfterSalesCase \{[\s\S]*?\n\}/)![0];
    expect(asCase).toMatch(/exchangedSales\s+Sale\[\]\s+@relation\("SaleExchangeCase"\)/);
  });

  it('npx prisma validate ผ่าน', () => {
    const r = spawnSync('npx', ['prisma', 'validate'], { cwd: API_ROOT, encoding: 'utf8' });
    expect(r.status).toBe(0);
  });
});
