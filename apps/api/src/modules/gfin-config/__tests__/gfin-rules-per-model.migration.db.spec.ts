/**
 * Migration 20261121000000_gfin_rules_per_model — สเปก 2026-11-20 §3.2
 * fixture = snapshot ของระบบจริง 20/11/2026 14:53 (กติกา 8 กลุ่ม + ราคา 109 แถว · ไม่มีข้อมูลลูกค้า)
 * ทุกเคสรันในทรานแซกชันที่ย้อนกลับเสมอ — ไม่ทิ้งแถวไว้ในฐานทดสอบ
 *
 * รัน: DATABASE_URL=<test_db หรือ *_test ที่ migrate แล้ว> npx jest src/modules/gfin-config/__tests__/gfin-rules-per-model.migration.db.spec.ts --runInBand
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import Decimal from 'decimal.js';
import { Prisma, PrismaClient } from '@prisma/client';
import { findGfinOverpriceRule, resolveGfinDownPct } from '../../../utils/installment-calc.util';
import { assertTestDatabase } from '../../notifications/__tests__/finance-line-fixtures';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

const MIGRATION = join(__dirname, '../../../../prisma/migrations/20261121000000_gfin_rules_per_model/migration.sql');
const SNAPSHOT = JSON.parse(readFileSync(join(__dirname, 'fixtures/gfin-prod-snapshot-2026-11-20.json'), 'utf8')) as {
  mappings: Array<{ gfinSeries: string; storage: string; condition: 'HAND_1' | 'HAND_2'; maxPrice: string; modelMatchPattern: string }>;
  rules: Array<{ label: string; seriesPattern: string; condition: 'HAND_1' | 'HAND_2'; allowance: string; maxMonths: number | null; minDownPct: number | null; isActive: boolean; createdAt: string }>;
};

/** migration แยกคำสั่งด้วยบรรทัด `-- statement-break` (Prisma รันทั้งไฟล์ได้ · เทสรันทีละคำสั่ง) */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/^-- statement-break\r?$/m)
    .map((s) => s.trim())
    .filter((s) => s.replace(/^--.*$/gm, '').trim().length > 0);
}

class Rollback extends Error {}
async function inRolledBackTx<T>(prisma: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let out: T | undefined;
  try {
    await prisma.$transaction(async (tx) => {
      out = await fn(tx);
      throw new Rollback();
    }, { timeout: 60_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return out as T;
}

type Effective = { allowance: string; maxMonths: number | null; minDownPct: string } | null;

/** ค่าที่ระบบใช้จริงต่อ (รุ่น, ความจุ, มือ) — กติกาเดียวกับตัวคำนวณ (`findGfinOverpriceRule` + `resolveGfinDownPct` ค่ากลาง 25%) */
async function effective(tx: Prisma.TransactionClient): Promise<Record<string, Effective>> {
  const mappings = await tx.gfinModelMapping.findMany({ where: { deletedAt: null, gfinVariant: null, isActive: true } });
  const rules = await tx.gfinOverpriceRule.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' } });
  const ruleRows = rules.map((r) => ({
    id: r.id,
    label: r.label,
    seriesPattern: r.seriesPattern,
    condition: r.condition as 'HAND_1' | 'HAND_2',
    allowance: new Decimal(r.allowance.toString()),
    maxMonths: r.maxMonths,
    minDownPct: r.minDownPct,
    isActive: r.isActive,
  }));
  const out: Record<string, Effective> = {};
  for (const m of mappings) {
    const row = {
      id: m.id,
      gfinSeries: m.gfinSeries,
      gfinVariant: null,
      storage: m.storage,
      condition: m.condition as 'HAND_1' | 'HAND_2',
      maxPrice: new Decimal(m.maxPrice.toString()),
      modelMatchPattern: m.modelMatchPattern,
      isActive: true,
    };
    const rule = findGfinOverpriceRule(row, ruleRows);
    out[`${m.gfinSeries}|${m.storage}|${m.condition}`] = rule
      ? {
          allowance: rule.allowance.toFixed(2),
          maxMonths: rule.maxMonths ?? null,
          minDownPct: resolveGfinDownPct(rule, new Decimal('0.25')).toFixed(4),
        }
      : null;
  }
  return out;
}

/** ซ่อนแถวเดิมของฐานทดสอบ (ในทรานแซกชันที่ย้อนกลับ) แล้วใส่ fixture */
async function seed(tx: Prisma.TransactionClient, rules = SNAPSHOT.rules, mappings = SNAPSHOT.mappings) {
  const now = new Date();
  await tx.gfinOverpriceRule.updateMany({ where: { deletedAt: null }, data: { deletedAt: now } });
  await tx.gfinModelMapping.updateMany({ where: { deletedAt: null }, data: { deletedAt: now } });
  await tx.gfinModelMapping.createMany({
    data: mappings.map((m) => ({
      gfinSeries: m.gfinSeries,
      gfinVariant: null,
      storage: m.storage,
      condition: m.condition,
      maxPrice: new Prisma.Decimal(m.maxPrice),
      modelMatchPattern: m.modelMatchPattern,
      isActive: true,
    })),
  });
  for (const r of rules) {
    await tx.gfinOverpriceRule.create({
      data: {
        label: r.label,
        seriesPattern: r.seriesPattern,
        condition: r.condition,
        allowance: new Prisma.Decimal(r.allowance),
        maxMonths: r.maxMonths,
        minDownPct: r.minDownPct,
        isActive: r.isActive,
        createdAt: new Date(r.createdAt),
      },
    });
  }
}

async function runMigration(tx: Prisma.TransactionClient) {
  for (const stmt of migrationStatements()) await tx.$executeRawUnsafe(stmt);
}

describeDb('migration gfin_rules_per_model (snapshot ระบบจริง 20/11/2026)', () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    assertTestDatabase();
    prisma = new PrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('fixture ครบ: ราคา 109 แถว · กติกา 8 กลุ่ม', () => {
    expect(SNAPSHOT.mappings).toHaveLength(109);
    expect(SNAPSHOT.rules).toHaveLength(8);
  });

  it('ทุก (รุ่น, ความจุ, มือ) ได้ OVER / ผ่อนสูงสุด / ดาวน์ เท่าเดิม · iPhone 12 มือ 2 ไม่มีกติกาทั้งก่อนและหลัง', async () => {
    const { before, after } = await inRolledBackTx(prisma, async (tx) => {
      await seed(tx);
      const before = await effective(tx);
      await runMigration(tx);
      const after = await effective(tx);
      return { before, after };
    });
    expect(Object.keys(before)).toHaveLength(109);
    expect(after).toEqual(before);
    expect(before['iPhone 12|64GB|HAND_2']).toBeNull();
    // ตัวอย่างที่เป็นต้นเรื่อง: 17 Pro Max มือ 2 ยังเป็น 30% (แก้ข้อมูลเป็นงานของเจ้าของหลัง deploy)
    expect(after['iPhone 17 Pro Max|256GB|HAND_2']).toEqual({ allowance: '2000.00', maxMonths: 15, minDownPct: '0.3000' });
  });

  it('หลังแปลง: ไม่มีกติกาหลายรุ่นที่ยังไม่ลบ · หนึ่งกติกาต่อ (รุ่น, มือ) ที่มีราคา · label = "<รุ่น> มือ N"', async () => {
    const rules = await inRolledBackTx(prisma, async (tx) => {
      await seed(tx);
      await runMigration(tx);
      return tx.gfinOverpriceRule.findMany({ where: { deletedAt: null } });
    });
    expect(rules.some((r) => r.seriesPattern.includes('|'))).toBe(false);
    const keys = rules.map((r) => `${r.seriesPattern}|${r.condition}`);
    expect(new Set(keys).size).toBe(keys.length);
    const pairsWithPrice = new Set(SNAPSHOT.mappings.map((m) => `${m.gfinSeries}|${m.condition}`));
    pairsWithPrice.delete('iPhone 12|HAND_2');
    expect(new Set(keys)).toEqual(pairsWithPrice);
    const pm2 = rules.find((r) => r.seriesPattern === 'iPhone 17 Pro Max' && r.condition === 'HAND_2')!;
    expect(pm2.label).toBe('iPhone 17 Pro Max มือ 2');
  });

  it('รันซ้ำไม่สร้างแถวเพิ่ม (idempotent)', async () => {
    const [first, second] = await inRolledBackTx(prisma, async (tx) => {
      await seed(tx);
      await runMigration(tx);
      const first = await tx.gfinOverpriceRule.count({ where: { deletedAt: null } });
      await runMigration(tx);
      const second = await tx.gfinOverpriceRule.count({ where: { deletedAt: null } });
      return [first, second];
    });
    expect(second).toBe(first);
  });

  it('สองกลุ่มที่มีจำนวนรุ่นเท่ากันครอบรุ่นเดียวกัน → ใช้กลุ่มที่สร้างก่อน', async () => {
    const rules = [
      { label: 'ก', seriesPattern: 'iPhone 99|iPhone 98', condition: 'HAND_1' as const, allowance: '500', maxMonths: 10, minDownPct: null, isActive: true, createdAt: '2026-01-01T00:00:00Z' },
      { label: 'ข', seriesPattern: 'iPhone 99|iPhone 97', condition: 'HAND_1' as const, allowance: '900', maxMonths: 15, minDownPct: null, isActive: true, createdAt: '2026-02-01T00:00:00Z' },
    ];
    const mappings = [{ gfinSeries: 'iPhone 99', storage: '128GB', condition: 'HAND_1' as const, maxPrice: '10000', modelMatchPattern: 'iPhone 99' }];
    const row = await inRolledBackTx(prisma, async (tx) => {
      await seed(tx, rules, mappings);
      await runMigration(tx);
      return tx.gfinOverpriceRule.findFirst({ where: { deletedAt: null, seriesPattern: 'iPhone 99', condition: 'HAND_1' } });
    });
    expect(row?.allowance.toString()).toBe('500');
    expect(row?.maxMonths).toBe(10);
  });

  it('กติกาที่ปิดใช้ไม่ถูกนำมาแปลง (ตัวคำนวณไม่ใช้อยู่แล้ว)', async () => {
    const rules = [
      { label: 'ปิด', seriesPattern: 'iPhone 99|iPhone 98', condition: 'HAND_2' as const, allowance: '700', maxMonths: 12, minDownPct: null, isActive: false, createdAt: '2026-01-01T00:00:00Z' },
    ];
    const mappings = [{ gfinSeries: 'iPhone 99', storage: '128GB', condition: 'HAND_2' as const, maxPrice: '9000', modelMatchPattern: 'iPhone 99' }];
    const live = await inRolledBackTx(prisma, async (tx) => {
      await seed(tx, rules, mappings);
      await runMigration(tx);
      return tx.gfinOverpriceRule.count({ where: { deletedAt: null } });
    });
    expect(live).toBe(0);
  });
});
