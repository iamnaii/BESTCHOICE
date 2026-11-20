# GFIN เงื่อนไขรายรุ่น — PR 1 (API + ตัวคำนวณ) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แปลงกติกา GFIN 8 กลุ่มเป็น 1 แถวต่อรุ่นต่อมือด้วย migration ที่ค่าเท่าเดิมทุกเครื่อง + เพิ่ม API ที่หน้าใหม่ (PR 2) ต้องใช้ + ให้ "มีราคาแต่ไม่มีเงื่อนไข" คิดผ่อน GFIN ไม่ได้

**Architecture:** ไม่แก้ schema ของตารางหลัก — `GfinOverpriceRule.seriesPattern` เก็บชื่อรุ่นเดียวหลังแปลง (`findGfinOverpriceRule` รองรับอยู่แล้ว) · migration SQL 3 คำสั่ง (สร้างรายรุ่น → ลบกลุ่มแบบกู้คืนได้ → partial unique index) ตรวจด้วยเทส DB ที่ใช้ snapshot ของระบบจริง · endpoint ใหม่ 2 ตัว (`overprice-rules/bulk-upsert`, `max-prices/close`) + ค่าตั้งเวอร์ชันใบเงื่อนไข · ตัวคำนวณ 3 ที่คืนเหตุผล `NO_RULE` เมื่อไม่มีกติกา · แยก `resolveGfinQuote` ออกจาก `resolveQuotes` ให้แท็บทดลองคำนวณ (PR 2) ใช้ตัวเดียวกับหน้าสินค้า

**Tech Stack:** NestJS + Prisma + PostgreSQL (`apps/api`) · React + Vite + vitest (`apps/web`) · `packages/shared` (vitest) · jest (API unit + `.db.spec.ts`)

**Spec:** `docs/superpowers/specs/2026-11-20-gfin-settings-redesign-design.md` (§3, §4, §5, §7, §8)

## Global Constraints

- ข้อความ error/validation ทั้งหมดเป็นภาษาไทย และชี้ทางที่ทำได้จริง (`.claude/rules/coding-standards.md`)
- เงินใช้ `Prisma.Decimal` / `decimal.js` เท่านั้น ห้าม `Number()` กับยอดเงินฝั่ง API
- soft delete เท่านั้น (`deletedAt`) ห้าม hard delete
- audit: `await this.auditService.log(...)` **หลัง** `$transaction` commit เท่านั้น ห้ามเรียกภายใน tx (`.claude/rules/database.md` หัวข้อ AuditLog)
- ทุก endpoint ใหม่: `@Roles('OWNER')` + ลงทะเบียนใน `apps/api/src/modules/employee-access/access-policy.manifest.json` (`classification: staff`, `permission: settings.finance.manage`) ให้ `node tools/check-access-coverage.mjs` ผ่าน
- ห้ามแตะ MDM · ห้าม deploy training เอง · ห้ามรันอะไรกับฐานข้อมูลจริง
- commit message ลงท้าย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` · PR body ลงท้าย `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- เหตุผลไม่พร้อมใช้ใหม่: shared `NO_RULE` ข้อความ `ยังไม่ได้ตั้งเงื่อนไข GFIN ของรุ่นนี้` · web `no_rule` · API หน้าร้าน `no_gfin_rule`
- ป้ายในการ์ดคำนวณหน้าสินค้า: `GFIN: รุ่นนี้ยังไม่ได้ตั้งเงื่อนไข — ตั้งใน ตั้งค่า → GFIN`

---

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `apps/api/prisma/migrations/20261121000000_gfin_rules_per_model/migration.sql` (สร้าง) | แปลงกลุ่ม → รายรุ่น · ลบกลุ่ม · unique index |
| `apps/api/src/modules/gfin-config/__tests__/fixtures/gfin-prod-snapshot-2026-11-20.json` (สร้าง) | กติกา 8 กลุ่ม + ราคา 109 แถวของระบบจริง |
| `apps/api/src/modules/gfin-config/__tests__/gfin-rules-per-model.migration.db.spec.ts` (สร้าง) | พิสูจน์ค่าเท่าเดิมทุกเครื่อง · idempotent · ตัดสินคู่เท่ากัน |
| `packages/shared/src/model-quote.ts` (แก้) | `NO_RULE` |
| `apps/api/src/modules/shop-catalog/installment-preview.service.ts` (แก้) | `no_gfin_rule` |
| `apps/web/src/pages/ProductDetailPage/utils/gfinQuote.ts` (แก้) | `no_rule` + `resolveGfinQuote` + `ResolvedGfin` |
| `apps/web/src/pages/ProductDetailPage/utils/resolveQuotes.ts` (แก้) | เรียก `resolveGfinQuote` |
| `apps/web/src/pages/ProductDetailPage/components/InstallmentCalculatorCard.tsx` (แก้) | ข้อความ `no_rule` |
| `apps/api/src/modules/gfin-config/gfin-config.service.ts` (แก้) | ด่านกติกาหลายรุ่น · bulk-upsert · close · settings |
| `apps/api/src/modules/gfin-config/dto/bulk-upsert-overprice-rules.dto.ts` (สร้าง) | DTO bulk-upsert |
| `apps/api/src/modules/gfin-config/dto/close-max-prices.dto.ts` (สร้าง) | DTO close |
| `apps/api/src/modules/gfin-config/dto/gfin-settings.dto.ts` (แก้) | `sheetVersion`, `sheetEffectiveDate` |
| `apps/api/src/modules/gfin-config/gfin-settings.util.ts` (แก้) | คีย์ + `loadGfinSheetInfo` |
| `apps/api/src/modules/gfin-config/gfin-config.controller.ts` (แก้) | 2 route ใหม่ |
| `apps/api/src/modules/trash/trash-registry.ts` (แก้) | ด่านกู้กติกา |
| `apps/api/src/modules/employee-access/access-policy.manifest.json` (แก้) | 2 route ใหม่ |

---

### Task 0: Worktree

- [ ] **Step 1: สร้าง worktree จาก origin/main**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
git fetch origin main
git worktree add .worktrees/gfin-rules-per-model -b feat/gfin-rules-per-model origin/main
cd .worktrees/gfin-rules-per-model
```

ถ้า `npm install` ใน worktree ไม่ได้ ให้ทำ junction ของ `node_modules` (PowerShell):
`New-Item -ItemType Junction -Path node_modules -Target "d:\BESTCHOICE APP\BESTCHOICE\node_modules"` และแบบเดียวกันที่ `apps/web/node_modules`, `apps/api/node_modules`, `packages/shared/node_modules` (เฉพาะโฟลเดอร์ที่มีอยู่ในต้นทาง)

ทุกคำสั่งในแผนนี้รันจากราก worktree ยกเว้นที่ระบุ `cd`

---

### Task 1: Migration แปลงเป็นรายรุ่น + เทสด้วย snapshot ของระบบจริง

**Files:**
- Create: `apps/api/prisma/migrations/20261121000000_gfin_rules_per_model/migration.sql`
- Create: `apps/api/src/modules/gfin-config/__tests__/fixtures/gfin-prod-snapshot-2026-11-20.json`
- Test: `apps/api/src/modules/gfin-config/__tests__/gfin-rules-per-model.migration.db.spec.ts`

**Interfaces:**
- Produces: หลัง migration — ไม่มีกติกาที่ยังไม่ลบที่มี `|` · คู่ `(series_pattern, condition)` ที่ยังไม่ลบไม่ซ้ำ (index `gfin_overprice_rules_one_per_series`) · label รูป `<รุ่น> มือ 1|2`

- [ ] **Step 1: สร้าง fixture จาก snapshot ของระบบจริง**

ไฟล์ต้นทาง (อ่านอย่างเดียว ไม่มีข้อมูลลูกค้า): `C:\Users\what_\AppData\Local\Temp\claude\c6d66c95ab04b146\8930e9c8-75d7-4071-8d49-abc3f8867cb7\scratchpad\p-mp3.json` (ราคา) และ `...\scratchpad\rules.json` (กติกา)

```bash
node -e '
const fs=require("fs");const S="C:/Users/what_/AppData/Local/Temp/claude/c6d66c95ab04b146/8930e9c8-75d7-4071-8d49-abc3f8867cb7/scratchpad/";
const arr=x=>Array.isArray(x)?x:(x.data||x.items);
const maps=arr(JSON.parse(fs.readFileSync(S+"p-mp3.json","utf8"))).filter(r=>r.isActive&&!r.gfinVariant&&!r.deletedAt)
  .map(r=>({gfinSeries:r.gfinSeries,storage:r.storage,condition:r.condition,maxPrice:String(r.maxPrice),modelMatchPattern:r.modelMatchPattern}));
const rules=arr(JSON.parse(fs.readFileSync(S+"rules.json","utf8"))).filter(r=>!r.deletedAt)
  .map(r=>({label:r.label,seriesPattern:r.seriesPattern,condition:r.condition,allowance:String(r.allowance),maxMonths:r.maxMonths,minDownPct:r.minDownPct,isActive:r.isActive,createdAt:r.createdAt}));
fs.writeFileSync("apps/api/src/modules/gfin-config/__tests__/fixtures/gfin-prod-snapshot-2026-11-20.json",JSON.stringify({source:"prod 2026-11-20 14:53 (read-only export, no customer data)",mappings:maps,rules},null,1)+"\n");
console.log(maps.length,"mappings",rules.length,"rules");'
```

Expected: `109 mappings 8 rules` (ถ้าไฟล์ต้นทางไม่มีแล้ว ให้หยุดแล้วแจ้ง — ห้ามสร้าง fixture เอง)

- [ ] **Step 2: เขียนเทส (ยังไม่มี migration → ล้ม)**

```ts
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
    .split(/^-- statement-break$/m)
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
```

- [ ] **Step 3: รันเทส — ต้องล้ม**

ต้องมีฐานทดสอบที่ `prisma migrate deploy` แล้ว (ชื่อ `test_db` หรือลงท้าย `_test`):

```bash
cd apps/api
DATABASE_URL="postgresql://test:test@localhost:5432/test_db?schema=public" npx jest src/modules/gfin-config/__tests__/gfin-rules-per-model.migration.db.spec.ts --runInBand
```

Expected: FAIL — `ENOENT ... migration.sql`. ถ้าเครื่องไม่มีฐานทดสอบ: เทสจะ skip (ไม่มี `DATABASE_URL`) — แจ้งในรายงานว่า "ตรวจได้ใน CI job test-api เท่านั้น" แล้วทำต่อ (CI รันไฟล์นี้หลัง `migrate deploy`)

- [ ] **Step 4: เขียน migration**

```sql
-- สเปก 2026-11-20 §3.2 — แปลงกติกา GFIN แบบกลุ่ม (series_pattern มี '|') เป็นหนึ่งแถวต่อ (รุ่น, สภาพ)
-- เลือกกติกาด้วยวิธีเดียวกับ findGfinOverpriceRule: เปิดใช้ · ไม่ถูกลบ · สภาพตรง · มีรุ่นนี้ในรายการ · รุ่นน้อยสุดชนะ (เท่ากัน = สร้างก่อน)
-- สร้างเฉพาะคู่ที่มีแถวราคา (gfin_variant IS NULL ไม่ถูกลบ) · คู่ที่มีกติการายรุ่นอยู่แล้วไม่แตะ · รันซ้ำได้
WITH pairs AS (
  SELECT DISTINCT m.gfin_series AS series, m.condition
  FROM gfin_model_mappings m
  WHERE m.deleted_at IS NULL AND m.gfin_variant IS NULL
),
candidates AS (
  SELECT p.series, p.condition, r.allowance, r.max_months, r.min_down_pct, r.created_at,
         cardinality(string_to_array(r.series_pattern, '|')) AS size
  FROM pairs p
  JOIN gfin_overprice_rules r
    ON r.condition = p.condition
   AND r.deleted_at IS NULL
   AND r.is_active = true
   AND p.series IN (SELECT btrim(s) FROM unnest(string_to_array(r.series_pattern, '|')) AS s)
),
best AS (
  SELECT DISTINCT ON (series, condition) *
  FROM candidates
  ORDER BY series, condition, size ASC, created_at ASC
)
INSERT INTO gfin_overprice_rules
  (id, label, series_pattern, condition, allowance, max_months, min_down_pct, is_active, created_at, updated_at)
SELECT gen_random_uuid()::text,
       b.series || CASE WHEN b.condition = 'HAND_1' THEN ' มือ 1' ELSE ' มือ 2' END,
       b.series, b.condition, b.allowance, b.max_months, b.min_down_pct, true, now(), now()
FROM best b
WHERE b.size > 1
  AND NOT EXISTS (
    SELECT 1 FROM gfin_overprice_rules x
    WHERE x.deleted_at IS NULL AND x.series_pattern = b.series AND x.condition = b.condition
  );
-- statement-break
-- กติกากลุ่มเดิมลบแบบกู้คืนได้ (ถังขยะจะไม่ให้กู้กลับ — trash-registry ด่าน '|')
UPDATE gfin_overprice_rules
SET deleted_at = now(), updated_at = now()
WHERE deleted_at IS NULL AND series_pattern LIKE '%|%';
-- statement-break
-- หนึ่งกติกาที่ยังไม่ลบต่อ (รุ่น, สภาพ) — Prisma เขียน partial unique ไม่ได้ (precedent products_imei_serial_active_unique)
CREATE UNIQUE INDEX IF NOT EXISTS "gfin_overprice_rules_one_per_series"
  ON "gfin_overprice_rules" ("series_pattern", "condition")
  WHERE "deleted_at" IS NULL;
```

หมายเหตุ: ตรวจชื่อคอลัมน์จริงด้วย `grep -n "model GfinOverpriceRule" -A16 apps/api/prisma/schema.prisma` (ต้องมี `@map("series_pattern")`, `@map("max_months")`, `@map("min_down_pct")`, `@map("is_active")`, `@map("created_at")`, `@map("updated_at")`, `@map("deleted_at")` · `allowance`, `condition`, `label`, `id` ไม่มี map) · ถ้าต่างให้แก้ SQL ตามจริง

- [ ] **Step 5: รัน migration บนฐานทดสอบ แล้วรันเทส**

```bash
cd apps/api
DATABASE_URL="postgresql://test:test@localhost:5432/test_db?schema=public" npx prisma migrate deploy
DATABASE_URL="postgresql://test:test@localhost:5432/test_db?schema=public" npx jest src/modules/gfin-config/__tests__/gfin-rules-per-model.migration.db.spec.ts --runInBand
```

Expected: PASS 6 tests

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/migrations/20261121000000_gfin_rules_per_model apps/api/src/modules/gfin-config/__tests__
git commit -m "feat(gfin): migration แปลงกติกา 8 กลุ่มเป็นรายรุ่นรายมือ + เทสด้วย snapshot ระบบจริง

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: ไม่มีกติกา = คิดผ่อน GFIN ไม่ได้ (3 ตัวคำนวณ + ข้อความการ์ด)

**Files:**
- Modify: `packages/shared/src/model-quote.ts` (union เหตุผล ~บรรทัด 88, 140 · `buildRate2` ~บรรทัด 152-156)
- Test: `packages/shared/src/model-quote.test.ts`
- Modify: `apps/api/src/modules/shop-catalog/installment-preview.service.ts` (~บรรทัด 198)
- Test: `apps/api/src/modules/shop-catalog/installment-preview.service.spec.ts`
- Modify: `apps/web/src/pages/ProductDetailPage/utils/gfinQuote.ts` (type `GfinQuote` ~บรรทัด 82-86 · `buildGfinQuote` ~บรรทัด 188)
- Test: `apps/web/src/pages/ProductDetailPage/utils/gfinQuote.test.ts`
- Modify: `apps/web/src/pages/ProductDetailPage/components/InstallmentCalculatorCard.tsx` (~บรรทัด 78-91)
- Test: `apps/web/src/pages/ProductDetailPage/components/__tests__/InstallmentCalculatorCard.test.tsx`

**Interfaces:**
- Produces: `Rate2Quote` unavailable reason เพิ่ม `'NO_RULE'` · `GfinQuote` unavailable reason เพิ่ม `'no_rule'` · `PreviewResult.reason = 'no_gfin_rule'`

- [ ] **Step 1: เทส shared (ล้ม)** — เพิ่มใน `describe('buildModelQuote — กติกาเพิ่มเติม'` ของ `packages/shared/src/model-quote.test.ts`

```ts
  it('มีราคาในใบราคาแต่ไม่มีเงื่อนไขของรุ่น → NO_RULE (ไม่คิดแบบไม่จำกัดงวด)', () => {
    const row = golden('iPhone 15', '128GB', 'PHONE_NEW');
    const q = buildModelQuote(inputFor(row, { gfin: { ...gfinFor(row), rules: [] } }));
    expect(q.rate2).toEqual({ available: false, reason: 'NO_RULE', message: 'ยังไม่ได้ตั้งเงื่อนไข GFIN ของรุ่นนี้' });
  });
```

- [ ] **Step 2: รัน (ล้ม)**

```bash
cd packages/shared && npx vitest run src/model-quote.test.ts
```

Expected: FAIL — rate2 เป็น `available: true`

- [ ] **Step 3: แก้ `packages/shared/src/model-quote.ts`**

แทนที่ union ทั้งสองที่:

```ts
  | { available: false; reason: 'NO_PRICE_LIST' | 'NO_RULE' | 'NO_RATE' | 'NO_PRICE' | 'NO_CONFIG'; message: string };
```

```ts
  reason: 'NO_PRICE_LIST' | 'NO_RULE' | 'NO_RATE' | 'NO_PRICE' | 'NO_CONFIG',
```

ใน `buildRate2` แทนที่

```ts
  const rule = findGfinOverpriceRule(mapping, g.rules);
  // งวดกำหนดเองของรุ่น · ไม่มี = งวดสูงสุดของกติกา OVER · ไม่มีกติกา = 12
  const months = positive(input.rate2TermMonths) ?? rule?.maxMonths ?? 12;
```

ด้วย

```ts
  const rule = findGfinOverpriceRule(mapping, g.rules);
  // สเปก 2026-11-20 §4: มีราคาแต่ไม่มีเงื่อนไขของรุ่น = ยังคิดไม่ได้ (เดิมคิดแบบไม่จำกัดงวด + OVER 0)
  if (!rule) return unavailable('NO_RULE', 'ยังไม่ได้ตั้งเงื่อนไข GFIN ของรุ่นนี้');
  // งวดกำหนดเองของรุ่น · ไม่มี = งวดสูงสุดของกติกา OVER · กติกาไม่จำกัดงวด = 12
  const months = positive(input.rate2TermMonths) ?? rule.maxMonths ?? 12;
```

- [ ] **Step 4: รัน shared ทั้งชุด**

```bash
cd packages/shared && npx vitest run
```

Expected: PASS ทั้งหมด

- [ ] **Step 5: เทส API หน้าร้าน (ล้ม)** — ใน `installment-preview.service.spec.ts` แก้เทส iPad (`'GFIN: iPad (TABLET) ใช้เรทของคอม 5% และแมปเป็นมือ 1'`) ให้มีกติกา (ค่าเทียบเท่าไม่มีกติกาเดิม):

```ts
    prisma.gfinOverpriceRule.findMany.mockResolvedValue([
      {
        id: 'rt',
        label: 'iPad 10 มือ 1',
        seriesPattern: 'iPad 10',
        condition: 'HAND_1',
        allowance: new Prisma.Decimal('0'),
        maxMonths: null,
        minDownPct: null,
        isActive: true,
      },
    ]);
```

แล้วเพิ่มเทสถัดจากเทส iPad:

```ts
  it('GFIN: มีราคาในใบราคาแต่ไม่มีเงื่อนไขของรุ่น → available:false reason no_gfin_rule', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'p12',
      installmentPrice: new Prisma.Decimal('11000'),
      prices: [],
      category: 'PHONE_USED',
      brand: 'Apple',
      model: 'iPhone 12',
      storage: '64GB',
      deviceOrigin: 'THAI',
      deletedAt: null,
    });
    prisma.gfinModelMapping.findMany.mockResolvedValue([
      {
        id: 'm12',
        gfinSeries: 'iPhone 12',
        gfinVariant: null,
        storage: '64GB',
        condition: 'HAND_2',
        maxPrice: new Prisma.Decimal('9000'),
        modelMatchPattern: 'iPhone 12',
        isActive: true,
      },
    ]);
    prisma.gfinOverpriceRule.findMany.mockResolvedValue([]);

    const result = await service.preview({ productId: 'p12', provider: 'GFIN', months: 12 });
    expect(result).toEqual({ available: false, reason: 'no_gfin_rule' });
    expect(prisma.gfinRateFactor.findFirst).not.toHaveBeenCalled();
  });
```

- [ ] **Step 6: รัน (ล้ม)**

```bash
cd apps/api && npx jest src/modules/shop-catalog/installment-preview.service.spec.ts
```

Expected: FAIL เฉพาะเทสใหม่

- [ ] **Step 7: แก้ `installment-preview.service.ts`** — แทนที่

```ts
    const rule = findGfinOverpriceRule(mapping, ruleObjects);
```

ด้วย

```ts
    const rule = findGfinOverpriceRule(mapping, ruleObjects);
    // สเปก 2026-11-20 §4: มีราคาแต่ไม่มีเงื่อนไขของรุ่น = ยังคิดไม่ได้ (เว็บ shop ไม่โชว์ GFIN)
    if (!rule) return { available: false, reason: 'no_gfin_rule' };
```

แล้วเปลี่ยน `rule?.` ที่เหลือในฟังก์ชันนั้นเป็น `rule.` (TypeScript จะบอกว่า `?.` ไม่จำเป็นแล้วหรือไม่ — ถ้า lint ไม่บังคับ ปล่อย `?.` ไว้ได้)

- [ ] **Step 8: รัน API หน้าร้าน**

```bash
cd apps/api && npx jest src/modules/shop-catalog
```

Expected: PASS

- [ ] **Step 9: เทสเว็บ (ล้ม)** — เพิ่มใน `describe('buildGfinQuote'` ของ `gfinQuote.test.ts`

```ts
  it('มีราคาในใบราคาแต่ไม่มีกติกาของรุ่น → no_rule', () => {
    const q = buildGfinQuote({ ...tables, rules: [] }, {
      product: iphone15,
      installmentPrice: 25000,
      months: 12,
      downPct: 25,
      commissionPct: 15,
    });
    expect(q).toEqual({ available: false, reason: 'no_rule', maxMonths: null, monthsOptions: [] });
  });
```

และใน `InstallmentCalculatorCard.test.tsx` ถัดจากเทส `'รุ่นไม่อยู่ในตารางราคา GFIN → แท็บ GFIN กดไม่ได้ + บอกเหตุผล'`:

```tsx
  it('มีราคาแต่ยังไม่ตั้งเงื่อนไข GFIN → แท็บ GFIN กดไม่ได้ + บอกให้ตั้งเงื่อนไข', () => {
    renderCard({ tables: { ...gfinTables, rules: [] } });
    expect(screen.getByRole('tab', { name: /GFIN/ })).toBeDisabled();
    expect(screen.getByText('GFIN: รุ่นนี้ยังไม่ได้ตั้งเงื่อนไข — ตั้งใน ตั้งค่า → GFIN')).toBeInTheDocument();
  });
```

- [ ] **Step 10: รัน (ล้ม)**

```bash
cd apps/web && npx vitest run src/pages/ProductDetailPage
```

Expected: FAIL 2 เทสใหม่

- [ ] **Step 11: แก้ `gfinQuote.ts`**

ใน type `GfinQuote`:

```ts
      reason: 'unsupported_category' | 'no_mapping' | 'no_rule' | 'no_factor';
```

ใน `buildGfinQuote` แทนที่

```ts
  const ruleRow = findGfinOverpriceRule(mappingRow, tables.rules.map(toRuleRow));
  const rule = ruleRow ? (tables.rules.find((r) => r.id === ruleRow.id) ?? null) : null;
  const maxMonths = ruleRow?.maxMonths ?? null;
```

ด้วย

```ts
  const ruleRow = findGfinOverpriceRule(mappingRow, tables.rules.map(toRuleRow));
  // สเปก 2026-11-20 §4: มีราคาแต่ไม่มีเงื่อนไขของรุ่น = ยังคิดไม่ได้
  if (!ruleRow) {
    return { available: false, reason: 'no_rule', maxMonths: null, monthsOptions: [] };
  }
  const rule = tables.rules.find((r) => r.id === ruleRow.id) ?? null;
  const maxMonths = ruleRow.maxMonths ?? null;
```

- [ ] **Step 12: แก้ `InstallmentCalculatorCard.tsx`** — ใน `switch (gfinQuote.reason)` เพิ่มหลังเคส `'no_mapping'`:

```tsx
      case 'no_rule':
        return 'GFIN: รุ่นนี้ยังไม่ได้ตั้งเงื่อนไข — ตั้งใน ตั้งค่า → GFIN';
```

- [ ] **Step 13: รันเว็บ + แก้ fixture ที่พังเพราะไม่มีกติกา**

```bash
cd apps/web && npx vitest run src/pages/ProductDetailPage src/pages/ProductCreatePage src/pages/StickerPage 2>&1 | tail -40
```

Expected: PASS · ถ้ามีเทสเดิมล้มเพราะ fixture มีแถวราคาแต่ `rules: []` และเทสนั้นคาดว่า GFIN "คิดได้" → เพิ่มกติกาของรุ่นนั้นใน fixture (ไม่แก้ค่าคาดหวัง):
`{ id: 'r-<รุ่น>', label: '<รุ่น> มือ N', seriesPattern: '<gfinSeries ของแถวราคา>', condition: '<HAND_1|HAND_2 เดียวกับแถวราคา>', allowance: '0', maxMonths: null, minDownPct: null, isActive: true }` (ให้ผลเท่ากับไม่มีกติกาแบบเดิม) · ถ้า `src/pages/StickerPage` ไม่มี ตัดออกจากคำสั่ง

- [ ] **Step 14: รันทั้ง API ที่เกี่ยว (บอท/หน้าราคา)**

```bash
cd apps/api && npx jest src/modules/pricing-templates src/modules/sales-bot src/modules/shop-catalog
```

Expected: PASS · fixture ที่ล้มแบบเดียวกัน แก้ตามสูตรใน Step 13 (`allowance: new Prisma.Decimal('0')` ฝั่ง API)

- [ ] **Step 15: Commit**

```bash
git add packages/shared/src/model-quote.ts packages/shared/src/model-quote.test.ts apps/api/src/modules/shop-catalog apps/web/src/pages/ProductDetailPage
git add -u apps/api/src apps/web/src
git commit -m "feat(gfin): มีราคาแต่ไม่มีเงื่อนไขของรุ่น = คิดผ่อน GFIN ไม่ได้ (NO_RULE)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: แยก `resolveGfinQuote` (ตัวเดียวของหน้าสินค้าและแท็บทดลองคำนวณ)

**Files:**
- Modify: `apps/web/src/pages/ProductDetailPage/utils/gfinQuote.ts`
- Modify: `apps/web/src/pages/ProductDetailPage/utils/resolveQuotes.ts` (~บรรทัด 49-57 `ResolvedGfin` · ~บรรทัด 123-170 ส่วน GFIN)
- Test: `apps/web/src/pages/ProductDetailPage/utils/gfinQuote.test.ts`

**Interfaces:**
- Produces:
```ts
export interface ResolvedGfin {
  months: number | null;
  downPct: number;
  minDownPct: number;
  commissionPct: number;
  quote: GfinQuote;
}
export interface GfinOverrides {
  months: number | null;
  downPct: number | null;
  commissionPct: number | null;
  /** งวดเรท 2 ของราคากลาง (หน้าสินค้า) — แท็บทดลองคำนวณส่ง null */
  templateMonths?: number | null;
}
export function resolveGfinQuote(
  tables: GfinTables,
  product: GfinQuoteInput['product'],
  salePrice: number,
  overrides: GfinOverrides,
): ResolvedGfin;
```
- `resolveQuotes.ts` ยัง export `ResolvedGfin` (re-export) — ผู้ใช้เดิมไม่ต้องแก้ import

- [ ] **Step 1: เทส (ล้ม)** — เพิ่มท้าย `gfinQuote.test.ts` (เพิ่ม `resolveGfinQuote` ใน import ด้านบน)

```ts
describe('resolveGfinQuote — ตัวเดียวของหน้าสินค้าและแท็บทดลองคำนวณ', () => {
  const none = { months: null, downPct: null, commissionPct: null };

  it('ไม่ส่งค่าเอง → ดาวน์ขั้นต่ำของรุ่น (ค่ากลาง 25) · งวด = ผ่อนสูงสุดของกติกา (12) · คอมมือถือ 15', () => {
    const r = resolveGfinQuote(tables, iphone15, 25000, none);
    expect(r).toMatchObject({ months: 12, downPct: 25, minDownPct: 25, commissionPct: 15 });
    expect(r.quote.available).toBe(true);
  });

  it('กติกาของรุ่นตั้งดาวน์ 30 → ดาวน์เริ่ม 30', () => {
    const t30: GfinTables = { ...tables, rules: [{ ...tables.rules[0], minDownPct: 30 }] };
    expect(resolveGfinQuote(t30, iphone15, 25000, none)).toMatchObject({ downPct: 30, minDownPct: 30 });
  });

  it('งวดของราคากลางมาก่อนผ่อนสูงสุดของกติกา · ค่าที่ผู้ใช้เลือกมาก่อนทั้งหมด', () => {
    expect(resolveGfinQuote(tables, iphone15, 25000, { ...none, templateMonths: 10 }).months).toBe(10);
    expect(resolveGfinQuote(tables, iphone15, 25000, { ...none, months: 10, templateMonths: 12 }).months).toBe(10);
  });

  it('งวดที่เลือกไม่มีเรท → ถอยไปงวดใกล้ 12 ที่สุดที่มี', () => {
    const r = resolveGfinQuote(tables, iphone15, 25000, { ...none, months: 9 });
    expect(r.months).toBe(12);
    expect(r.quote.available).toBe(true);
  });

  it('ไม่มีกติกาของรุ่น → no_rule และ months = null', () => {
    const r = resolveGfinQuote({ ...tables, rules: [] }, iphone15, 25000, none);
    expect(r.months).toBeNull();
    expect(r.quote).toMatchObject({ available: false, reason: 'no_rule' });
  });
});
```

- [ ] **Step 2: รัน (ล้ม)**

```bash
cd apps/web && npx vitest run src/pages/ProductDetailPage/utils/gfinQuote.test.ts
```

Expected: FAIL — `resolveGfinQuote is not a function`

- [ ] **Step 3: เพิ่มใน `gfinQuote.ts`** (ท้ายไฟล์ · เพิ่ม `import { pickDefaultMonths } from './monthsOptions';` ด้านบนถ้ายังไม่มี)

```ts
export interface ResolvedGfin {
  /** null = ไม่มีงวดให้เลือกเลย (ตารางเรทว่าง / คิดไม่ได้) */
  months: number | null;
  downPct: number;
  /** ดาวน์ขั้นต่ำของรุ่นนี้ (เต็มร้อย) — กติกา OVER ก่อน ไม่มีแล้วค่าตั้ง GFIN · ตัวเลือก % ในการ์ดเริ่มที่ค่านี้ */
  minDownPct: number;
  commissionPct: number;
  quote: GfinQuote;
}

export interface GfinOverrides {
  months: number | null;
  downPct: number | null;
  commissionPct: number | null;
  /** งวดเรท 2 ของราคากลาง (หน้าสินค้า) — แท็บทดลองคำนวณส่ง null */
  templateMonths?: number | null;
}

/**
 * ประกอบใบเสนอ GFIN ของเครื่องหนึ่งเครื่อง — ตัวเดียวของหน้าสินค้า (การ์ด · สติกเกอร์ · สรุปส่งลูกค้า) และแท็บทดลองคำนวณ
 * (สเปก 2026-11-20 §6.4 — ห้ามเรียก buildGfinQuote ตรง เพราะดาวน์/งวดตั้งต้นต้องมาจากกติกาของรุ่น)
 * ดาวน์ = ที่ผู้ใช้เลือก ไม่งั้นขั้นต่ำของรุ่น · งวด = ที่ผู้ใช้เลือก → งวดเรท 2 ของราคากลาง → ผ่อนสูงสุดของกติกา → 12
 * งวดที่ได้ไม่มีเรท/เกินเพดาน → ถอยไปงวดใกล้ 12 ที่สุดในตัวเลือกที่มี
 */
export function resolveGfinQuote(
  tables: GfinTables,
  product: GfinQuoteInput['product'],
  salePrice: number,
  overrides: GfinOverrides,
): ResolvedGfin {
  const commissionPct = overrides.commissionPct ?? defaultCommissionPct(tables.settings, product.category);
  const minDownPct = gfinMinDownPctFor(tables, product);
  const downPct = overrides.downPct ?? minDownPct;
  const preferred =
    overrides.months ?? overrides.templateMonths ?? gfinMaxMonthsFor(tables, product) ?? 12;
  let months: number | null = preferred;
  let quote = buildGfinQuote(tables, { product, installmentPrice: salePrice, months: preferred, downPct, commissionPct });
  if (!quote.available && quote.reason === 'no_factor') {
    months = pickDefaultMonths(
      quote.monthsOptions.map((o) => o.months),
      preferred,
    );
    if (months != null) {
      quote = buildGfinQuote(tables, { product, installmentPrice: salePrice, months, downPct, commissionPct });
    }
  }
  return { months: quote.available ? months : null, downPct, minDownPct, commissionPct, quote };
}
```

ตรวจว่า `pickDefaultMonths` ไม่ได้ import `gfinQuote.ts` กลับ (กัน import วน): `grep -n "import" apps/web/src/pages/ProductDetailPage/utils/monthsOptions.ts`

- [ ] **Step 4: แก้ `resolveQuotes.ts`**

import ด้านบนเปลี่ยนเป็น:

```ts
import {
  resolveGfinQuote,
  type GfinTables,
  type ResolvedGfin,
} from './gfinQuote';
```

ลบ `export interface ResolvedGfin { ... }` เดิมทั้งก้อน แล้วเพิ่มบรรทัด (ผู้ใช้เดิม import จากไฟล์นี้):

```ts
export type { ResolvedGfin } from './gfinQuote';
```

แทนที่ส่วนตั้งแต่ `if (gfinTables && gfinSalePrice != null) {` จนจบบล็อก (ก่อน `return { installmentPrice, ...`) ด้วย

```ts
  if (gfinTables && gfinSalePrice != null) {
    gfin = resolveGfinQuote(
      gfinTables,
      {
        brand: product.brand,
        model: product.model,
        storage: product.storage,
        category: product.category,
        deviceOrigin: product.deviceOrigin,
      },
      gfinSalePrice,
      { ...state.gfin, templateMonths: terms?.rate2TermMonths ?? null },
    );
    gfinAvailable = gfin.quote.available;
  }
```

ลบ import ที่ไม่ใช้แล้ว (`buildGfinQuote`, `defaultCommissionPct`, `gfinMaxMonthsFor`, `gfinMinDownPctFor`, `GfinQuote`, `pickDefaultMonths`) ถ้า `tsc` บอกว่าไม่ใช้ · ถ้า `GfinQuote` ยังใช้ใน type อื่นของไฟล์ ให้คงไว้

- [ ] **Step 5: รันเว็บ (ต้องผ่านโดยไม่แก้ค่าคาดหวังของเทสเดิม)**

```bash
cd apps/web && npx vitest run src/pages/ProductDetailPage src/pages/ProductCreatePage && npx tsc --noEmit -p tsconfig.json
```

Expected: PASS ทั้งหมด · tsc 0 error

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ProductDetailPage/utils
git commit -m "refactor(gfin): แยก resolveGfinQuote ให้หน้าสินค้าและแท็บทดลองคำนวณใช้ตัวเดียวกัน

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: ด่านกติกาหลายรุ่น + 409 คู่ซ้ำ + ด่านถังขยะ

**Files:**
- Modify: `apps/api/src/modules/gfin-config/gfin-config.service.ts` (`createOverpriceRule`, `updateOverpriceRule`)
- Test: `apps/api/src/modules/gfin-config/gfin-config.service.spec.ts`
- Modify: `apps/api/src/modules/trash/trash-registry.ts` (entry `gfin_overprice_rule` ~บรรทัด 403)
- Test: `apps/api/src/modules/trash/__tests__/trash-registry.checks.spec.ts`

**Interfaces:**
- Produces (export จาก `gfin-config.service.ts` ให้ Task 5 ใช้):
```ts
export const PER_MODEL_ONLY_MESSAGE = 'เงื่อนไขเก็บรายรุ่นแล้ว — แก้ทีละรุ่น (ใส่ชื่อรุ่นเดียว ไม่ใช้ |)';
export const RULE_EXISTS_MESSAGE = 'รุ่นนี้มีเงื่อนไขของสภาพนี้อยู่แล้ว — แก้แถวที่มีอยู่แทน';
export function isUniqueViolation(e: unknown): boolean;
```

- [ ] **Step 1: เทส service (ล้ม)** — เพิ่ม `import { BadRequestException, ConflictException } from '@nestjs/common';` (รวมกับ import เดิม) แล้วเพิ่ม describe:

```ts
  describe('กติการายรุ่นเท่านั้น (สเปก 2026-11-20 §5)', () => {
    const base = { label: 'x', seriesPattern: 'iPhone 17', condition: 'HAND_2' as const, allowance: 2000, maxMonths: 15 };

    it('สร้างกติกาหลายรุ่น → 400 ไม่เขียน', async () => {
      await expect(service.createOverpriceRule({ ...base, seriesPattern: 'iPhone 17|iPhone Air' }, 'u1'))
        .rejects.toThrow(new BadRequestException('เงื่อนไขเก็บรายรุ่นแล้ว — แก้ทีละรุ่น (ใส่ชื่อรุ่นเดียว ไม่ใช้ |)'));
      expect(prisma.gfinOverpriceRule.create).not.toHaveBeenCalled();
    });

    it('แก้เป็นหลายรุ่น → 400 ไม่เขียน', async () => {
      prisma.gfinOverpriceRule.findUnique.mockResolvedValue({ id: 'r1', deletedAt: null });
      await expect(service.updateOverpriceRule('r1', { seriesPattern: 'iPhone 17|iPhone Air' }, 'u1'))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.gfinOverpriceRule.update).not.toHaveBeenCalled();
    });

    it('ชน unique index (รุ่น+สภาพซ้ำ) → 409', async () => {
      prisma.gfinOverpriceRule.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
      );
      await expect(service.createOverpriceRule(base, 'u1'))
        .rejects.toThrow(new ConflictException('รุ่นนี้มีเงื่อนไขของสภาพนี้อยู่แล้ว — แก้แถวที่มีอยู่แทน'));
      expect(audit.log).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: รัน (ล้ม)**

```bash
cd apps/api && npx jest src/modules/gfin-config/gfin-config.service.spec.ts
```

Expected: FAIL 3 เทสใหม่

- [ ] **Step 3: แก้ service** — import บนสุดเป็น `import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';` แล้วเพิ่มก่อน `@Injectable()`:

```ts
export const PER_MODEL_ONLY_MESSAGE = 'เงื่อนไขเก็บรายรุ่นแล้ว — แก้ทีละรุ่น (ใส่ชื่อรุ่นเดียว ไม่ใช้ |)';
export const RULE_EXISTS_MESSAGE = 'รุ่นนี้มีเงื่อนไขของสภาพนี้อยู่แล้ว — แก้แถวที่มีอยู่แทน';

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/** สเปก 2026-11-20 §5: กติกากลุ่มใหม่ไม่มีผล (กติการายรุ่นชนะเสมอใน findGfinOverpriceRule) → ปฏิเสธตั้งแต่ต้น */
function assertSingleSeries(seriesPattern: string | undefined): void {
  if (seriesPattern !== undefined && seriesPattern.includes('|')) {
    throw new BadRequestException(PER_MODEL_ONLY_MESSAGE);
  }
}
```

ใน `createOverpriceRule` บรรทัดแรกเพิ่ม `assertSingleSeries(dto.seriesPattern);` และห่อ `create`:

```ts
  async createOverpriceRule(dto: CreateOverpriceRuleDto, userId: string) {
    assertSingleSeries(dto.seriesPattern);
    let row;
    try {
      row = await this.prisma.gfinOverpriceRule.create({
        data: {
          label: dto.label,
          seriesPattern: dto.seriesPattern.trim(),
          condition: dto.condition,
          allowance: new Prisma.Decimal(dto.allowance),
          maxMonths: dto.maxMonths ?? null,
          minDownPct: dto.minDownPct ?? null,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(RULE_EXISTS_MESSAGE);
      throw e;
    }
    await this.auditService.log({
      action: 'GFIN_OVERPRICE_RULE_CREATED',
      entity: 'gfin_overprice_rule',
      entityId: row.id,
      userId,
      newValue: row as unknown as Record<string, unknown>,
    });
    return row;
  }
```

ใน `updateOverpriceRule` เพิ่ม `assertSingleSeries(dto.seriesPattern);` เป็นบรรทัดแรก · เปลี่ยน `data.seriesPattern = dto.seriesPattern` เป็น `data.seriesPattern = dto.seriesPattern.trim()` · ห่อ `update` แบบเดียวกัน:

```ts
    let updated;
    try {
      updated = await this.prisma.gfinOverpriceRule.update({ where: { id }, data });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(RULE_EXISTS_MESSAGE);
      throw e;
    }
```

- [ ] **Step 4: เทสถังขยะ (ล้ม)** — เพิ่มใน `describe('trash registry — per-type restore rules'` ของ `trash-registry.checks.spec.ts`:

```ts
  it('G1 gfin_overprice_rule: กติกากลุ่มเดิม (มี |) กู้ไม่ได้ — เงื่อนไขเก็บรายรุ่นแล้ว', async () => {
    const h = tx({ gfinOverpriceRule: { findFirst: jest.fn().mockResolvedValue(null) } });
    const err = await trashEntry('gfin_overprice_rule')!.check!(ctx(h.tx), { id: 'g1', label: 'มือ2 17/Air', seriesPattern: 'iPhone 17|iPhone Air', condition: 'HAND_2', allowance: '2000', deletedAt: NOW }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe('กติกากลุ่มเดิมกู้ไม่ได้ — เงื่อนไขเก็บรายรุ่นแล้ว (ดูค่าเดิมในรายการนี้ได้)');
  });

  it('G2 gfin_overprice_rule: กติการายรุ่นที่มีแถวของรุ่น+สภาพเดียวกันอยู่แล้ว → 409', async () => {
    const h = tx({ gfinOverpriceRule: { findFirst: jest.fn().mockResolvedValue({ id: 'live' }) } });
    const err = await trashEntry('gfin_overprice_rule')!.check!(ctx(h.tx), { id: 'g2', label: 'iPhone 17 มือ 2', seriesPattern: 'iPhone 17', condition: 'HAND_2', allowance: '2000', deletedAt: NOW }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe('กู้ไม่ได้: iPhone 17 มือ 2 มีเงื่อนไขอยู่แล้ว — แก้แถวที่มีอยู่แทน');
    expect(h.m('gfinOverpriceRule').findFirst).toHaveBeenCalledWith({
      where: { seriesPattern: 'iPhone 17', condition: 'HAND_2', deletedAt: null, id: { not: 'g2' } },
      select: { id: true },
    });
  });

  it('G3 gfin_overprice_rule: กติการายรุ่นที่ไม่มีแถวซ้ำ → กู้ได้', async () => {
    const h = tx({ gfinOverpriceRule: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(trashEntry('gfin_overprice_rule')!.check!(ctx(h.tx), { id: 'g3', label: 'iPhone 17 มือ 1', seriesPattern: 'iPhone 17', condition: 'HAND_1', allowance: '2000', deletedAt: NOW })).resolves.toBeUndefined();
  });
```

- [ ] **Step 5: แก้ entry ใน `trash-registry.ts`**

```ts
  {
    type: 'gfin_overprice_rule', label: 'GFIN — กฎราคาเกิน', group: 'ตั้งค่า', model: 'gfinOverpriceRule',
    select: { ...BASE_SELECT, label: true, seriesPattern: true, condition: true, allowance: true },
    searchFields: ['label'],
    auditEntities: ['gfin-config'],
    toRow: (r) => ({ title: r.label, subtitle: joinParts(r.condition, `เผื่อ ${money(r.allowance)}`) }),
    restorable: true,
    // สเปก 2026-11-20 §5: เงื่อนไขเก็บรายรุ่นแล้ว — กติกากลุ่มเดิม (ลบตอน migration) กู้กลับไม่มีผล · คู่ (รุ่น, สภาพ) ห้ามซ้ำ
    check: async ({ tx }, r) => {
      if (r.seriesPattern.includes('|')) {
        throw new BadRequestException('กติกากลุ่มเดิมกู้ไม่ได้ — เงื่อนไขเก็บรายรุ่นแล้ว (ดูค่าเดิมในรายการนี้ได้)');
      }
      const dup = await tx.gfinOverpriceRule.findFirst({
        where: { seriesPattern: r.seriesPattern, condition: r.condition, deletedAt: null, id: { not: r.id } },
        select: { id: true },
      });
      if (dup) {
        const hand = r.condition === 'HAND_1' ? 'มือ 1' : 'มือ 2';
        throw new ConflictException(`กู้ไม่ได้: ${r.seriesPattern} ${hand} มีเงื่อนไขอยู่แล้ว — แก้แถวที่มีอยู่แทน`);
      }
    },
  },
```

(แทนที่ entry เดิมทั้งก้อน — คงตำแหน่งในอาร์เรย์)

- [ ] **Step 6: รัน**

```bash
cd apps/api && npx jest src/modules/gfin-config src/modules/trash
```

Expected: PASS (รวมเทส R2 ที่บังคับว่า select ตรง schema)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/gfin-config/gfin-config.service.ts apps/api/src/modules/gfin-config/gfin-config.service.spec.ts apps/api/src/modules/trash
git commit -m "feat(gfin): ปฏิเสธกติกาหลายรุ่น · 409 เมื่อรุ่น+สภาพซ้ำ · ถังขยะไม่กู้กติกากลุ่ม

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `POST /gfin-config/overprice-rules/bulk-upsert`

**Files:**
- Create: `apps/api/src/modules/gfin-config/dto/bulk-upsert-overprice-rules.dto.ts`
- Modify: `apps/api/src/modules/gfin-config/dto/index.ts`
- Modify: `apps/api/src/modules/gfin-config/gfin-config.service.ts`
- Modify: `apps/api/src/modules/gfin-config/gfin-config.controller.ts`
- Modify: `apps/api/src/modules/employee-access/access-policy.manifest.json`
- Test: `apps/api/src/modules/gfin-config/gfin-config.service.spec.ts`

**Interfaces:**
- Consumes: `isUniqueViolation`, `RULE_EXISTS_MESSAGE` (Task 4)
- Produces:
```ts
// body
{ items: Array<{ series: string; condition: 'HAND_1' | 'HAND_2' }>; allowance?: number; maxMonths?: number; minDownPct?: number | null }
// response
{ created: number; updated: number; rows: GfinOverpriceRule[] }
// service
bulkUpsertOverpriceRules(dto: BulkUpsertOverpriceRulesDto, userId: string): Promise<{ created: number; updated: number; rows: GfinOverpriceRule[] }>
```

- [ ] **Step 1: DTO** — `dto/bulk-upsert-overprice-rules.dto.ts`

```ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { GfinCondition } from '@prisma/client';

export class BulkRuleTargetDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุรุ่น' })
  @MaxLength(80)
  series!: string;

  @IsEnum(GfinCondition)
  condition!: GfinCondition;
}

/** แก้เงื่อนไขหลายรุ่นพร้อมกัน (สเปก 2026-11-20 §5) — ฟิลด์ที่ไม่ส่ง = ไม่เปลี่ยน · minDownPct: null = ใช้ค่ากลาง */
export class BulkUpsertOverpriceRulesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'กรุณาเลือกอย่างน้อย 1 รุ่น' })
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BulkRuleTargetDto)
  items!: BulkRuleTargetDto[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  allowance?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(36)
  maxMonths?: number;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(80)
  minDownPct?: number | null;
}
```

เพิ่มใน `dto/index.ts`: `export * from './bulk-upsert-overprice-rules.dto';`

- [ ] **Step 2: เทส service (ล้ม)** — ใน `beforeEach` ของ spec เพิ่มใน `prisma`: `gfinOverpriceRule.findMany` มีแล้ว · เพิ่ม `$transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),` และ `gfinModelMapping.findMany` มีแล้ว แล้วเพิ่ม describe:

```ts
  describe('bulkUpsertOverpriceRules', () => {
    const live = (over: Record<string, unknown> = {}) => ({
      id: 'r17', label: 'iPhone 17 มือ 2', seriesPattern: 'iPhone 17', condition: 'HAND_2',
      allowance: new Prisma.Decimal(2000), maxMonths: 15, minDownPct: 30, isActive: true, deletedAt: null, ...over,
    });
    beforeEach(() => {
      prisma.gfinModelMapping.findMany.mockResolvedValue([{ gfinSeries: 'iPhone 17' }, { gfinSeries: 'iPhone 17e' }]);
      prisma.gfinOverpriceRule.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => live(data));
      prisma.gfinOverpriceRule.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new', ...data }));
    });

    it('แก้แถวเดิม: ส่งเฉพาะ minDownPct: null → ตั้งเป็นค่ากลาง ไม่แตะ OVER/งวด · เปิดใช้ · audit ครั้งเดียวหลังบันทึก', async () => {
      prisma.gfinOverpriceRule.findMany.mockResolvedValue([live()]);
      const res = await service.bulkUpsertOverpriceRules({ items: [{ series: 'iPhone 17', condition: 'HAND_2' }], minDownPct: null }, 'u1');
      expect(prisma.gfinOverpriceRule.update).toHaveBeenCalledWith({ where: { id: 'r17' }, data: { minDownPct: null, isActive: true } });
      expect(res).toMatchObject({ created: 0, updated: 1 });
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'GFIN_RULES_BULK_UPSERTED', entity: 'gfin_overprice_rule', entityId: 'bulk' }));
    });

    it('คู่ที่ยังไม่มีกติกา + ส่ง OVER และผ่อนสูงสุด → สร้าง label "<รุ่น> มือ N" ดาวน์ = ค่ากลาง', async () => {
      prisma.gfinOverpriceRule.findMany.mockResolvedValue([]);
      await service.bulkUpsertOverpriceRules({ items: [{ series: 'iPhone 17e', condition: 'HAND_1' }], allowance: 2000, maxMonths: 15 }, 'u1');
      expect(prisma.gfinOverpriceRule.create).toHaveBeenCalledWith({
        data: {
          label: 'iPhone 17e มือ 1', seriesPattern: 'iPhone 17e', condition: 'HAND_1',
          allowance: new Prisma.Decimal(2000), maxMonths: 15, minDownPct: null, isActive: true,
        },
      });
    });

    it('คู่ที่ยังไม่มีกติกา แต่ไม่ส่งผ่อนสูงสุด → 400 ไม่เขียนอะไร', async () => {
      prisma.gfinOverpriceRule.findMany.mockResolvedValue([]);
      await expect(service.bulkUpsertOverpriceRules({ items: [{ series: 'iPhone 17e', condition: 'HAND_1' }], allowance: 2000 }, 'u1'))
        .rejects.toThrow(new BadRequestException('iPhone 17e มือ 1 ยังไม่มีเงื่อนไข — ต้องระบุ OVER และผ่อนสูงสุด'));
      expect(prisma.gfinOverpriceRule.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('รุ่นไม่มีในใบราคา → 400', async () => {
      await expect(service.bulkUpsertOverpriceRules({ items: [{ series: 'iPhone 71', condition: 'HAND_1' }], maxMonths: 12 }, 'u1'))
        .rejects.toThrow(new BadRequestException('ไม่พบรุ่น iPhone 71 ในใบราคา — นำเข้าใบราคาที่มีรุ่นนี้ก่อน'));
    });

    it('ไม่ส่งค่าที่จะเปลี่ยนเลย → 400', async () => {
      await expect(service.bulkUpsertOverpriceRules({ items: [{ series: 'iPhone 17', condition: 'HAND_2' }] }, 'u1'))
        .rejects.toThrow(new BadRequestException('ไม่มีค่าที่จะเปลี่ยน — เลือก OVER ผ่อนสูงสุด หรือดาวน์อย่างน้อยหนึ่งอย่าง'));
    });

    it('รุ่น+สภาพซ้ำในคำขอ → 400', async () => {
      await expect(service.bulkUpsertOverpriceRules({ items: [{ series: 'iPhone 17', condition: 'HAND_2' }, { series: 'iPhone 17', condition: 'HAND_2' }], maxMonths: 12 }, 'u1'))
        .rejects.toThrow(new BadRequestException('เลือก iPhone 17 มือ 2 ซ้ำ'));
    });

    it('ชน unique ระหว่างบันทึก (มีคนแก้พร้อมกัน) → 409', async () => {
      prisma.gfinOverpriceRule.findMany.mockResolvedValue([]);
      prisma.gfinOverpriceRule.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }));
      await expect(service.bulkUpsertOverpriceRules({ items: [{ series: 'iPhone 17e', condition: 'HAND_1' }], allowance: 0, maxMonths: 12 }, 'u1'))
        .rejects.toThrow(new ConflictException('มีการแก้เงื่อนไขของรุ่นเดียวกันพร้อมกัน — โหลดหน้าใหม่แล้วลองอีกครั้ง'));
      expect(audit.log).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 3: รัน (ล้ม)**

```bash
cd apps/api && npx jest src/modules/gfin-config/gfin-config.service.spec.ts -t bulkUpsertOverpriceRules
```

Expected: FAIL — `service.bulkUpsertOverpriceRules is not a function`

- [ ] **Step 4: เขียน service method** — import `BulkUpsertOverpriceRulesDto` จาก `./dto` แล้วเพิ่มหลัง `softDeleteOverpriceRule`:

```ts
  /**
   * แก้เงื่อนไขหลายรุ่นพร้อมกัน (สเปก 2026-11-20 §5) — ทั้งชุดใน transaction เดียว (พลาดแถวเดียว = ไม่บันทึกเลย)
   * คู่ที่มีกติกาแล้ว (รวมที่ปิดใช้) = แก้แถวเดิม + เปิดใช้ · คู่ใหม่ต้องมี OVER และผ่อนสูงสุด · audit ครั้งเดียวหลัง commit
   */
  async bulkUpsertOverpriceRules(dto: BulkUpsertOverpriceRulesDto, userId: string) {
    const hand = (c: string) => (c === 'HAND_1' ? 'มือ 1' : 'มือ 2');
    const items = dto.items.map((i) => ({ series: i.series.trim(), condition: i.condition }));
    if (dto.allowance === undefined && dto.maxMonths === undefined && dto.minDownPct === undefined) {
      throw new BadRequestException('ไม่มีค่าที่จะเปลี่ยน — เลือก OVER ผ่อนสูงสุด หรือดาวน์อย่างน้อยหนึ่งอย่าง');
    }
    const seen = new Set<string>();
    for (const i of items) {
      const key = `${i.series}|${i.condition}`;
      if (seen.has(key)) throw new BadRequestException(`เลือก ${i.series} ${hand(i.condition)} ซ้ำ`);
      seen.add(key);
    }
    const seriesList = [...new Set(items.map((i) => i.series))];

    let result: {
      created: number;
      updated: number;
      rows: Prisma.GfinOverpriceRuleGetPayload<object>[];
      changes: Array<{ series: string; condition: string; before: unknown; after: unknown }>;
    };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const priced = await tx.gfinModelMapping.findMany({
          where: { deletedAt: null, gfinVariant: null, gfinSeries: { in: seriesList } },
          select: { gfinSeries: true },
        });
        const pricedSet = new Set(priced.map((p) => p.gfinSeries));
        const missing = seriesList.find((s) => !pricedSet.has(s));
        if (missing) throw new BadRequestException(`ไม่พบรุ่น ${missing} ในใบราคา — นำเข้าใบราคาที่มีรุ่นนี้ก่อน`);

        const existing = await tx.gfinOverpriceRule.findMany({
          where: { deletedAt: null, seriesPattern: { in: seriesList } },
        });
        const out = { created: 0, updated: 0, rows: [] as Prisma.GfinOverpriceRuleGetPayload<object>[], changes: [] as Array<{ series: string; condition: string; before: unknown; after: unknown }> };
        for (const i of items) {
          const ex = existing.find((r) => r.seriesPattern === i.series && r.condition === i.condition);
          if (ex) {
            const data: Prisma.GfinOverpriceRuleUpdateInput = {};
            if (dto.allowance !== undefined) data.allowance = new Prisma.Decimal(dto.allowance);
            if (dto.maxMonths !== undefined) data.maxMonths = dto.maxMonths;
            if (dto.minDownPct !== undefined) data.minDownPct = dto.minDownPct;
            data.isActive = true;
            const row = await tx.gfinOverpriceRule.update({ where: { id: ex.id }, data });
            out.updated++;
            out.rows.push(row);
            out.changes.push({ series: i.series, condition: i.condition, before: ex, after: row });
          } else {
            if (dto.allowance === undefined || dto.maxMonths === undefined) {
              throw new BadRequestException(`${i.series} ${hand(i.condition)} ยังไม่มีเงื่อนไข — ต้องระบุ OVER และผ่อนสูงสุด`);
            }
            const row = await tx.gfinOverpriceRule.create({
              data: {
                label: `${i.series} ${hand(i.condition)}`,
                seriesPattern: i.series,
                condition: i.condition,
                allowance: new Prisma.Decimal(dto.allowance),
                maxMonths: dto.maxMonths,
                minDownPct: dto.minDownPct ?? null,
                isActive: true,
              },
            });
            out.created++;
            out.rows.push(row);
            out.changes.push({ series: i.series, condition: i.condition, before: null, after: row });
          }
        }
        return out;
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException('มีการแก้เงื่อนไขของรุ่นเดียวกันพร้อมกัน — โหลดหน้าใหม่แล้วลองอีกครั้ง');
      }
      throw e;
    }
    await this.auditService.log({
      action: 'GFIN_RULES_BULK_UPSERTED',
      entity: 'gfin_overprice_rule',
      entityId: 'bulk',
      userId,
      newValue: { changes: result.changes } as unknown as Record<string, unknown>,
    });
    return { created: result.created, updated: result.updated, rows: result.rows };
  }
```

ถ้า `Prisma.GfinOverpriceRuleGetPayload<object>` ไม่ผ่าน tsc ให้ใช้ `import type { GfinOverpriceRule } from '@prisma/client';` แทนทั้งสองที่

- [ ] **Step 5: Route** — ใน controller เพิ่ม import `BulkUpsertOverpriceRulesDto` แล้วเพิ่มหลัง `createOverpriceRule`:

```ts
  @Post('overprice-rules/bulk-upsert')
  @Roles('OWNER')
  bulkUpsertOverpriceRules(@Body() dto: BulkUpsertOverpriceRulesDto, @Req() req: { user: { id: string } }) {
    return this.service.bulkUpsertOverpriceRules(dto, req.user.id);
  }
```

- [ ] **Step 6: ลงทะเบียนใน access manifest**

```bash
node --input-type=module -e "
import crypto from 'node:crypto';
import { inventory } from './tools/lib/access-entrypoints.mjs';
const s = e => crypto.createHash('sha256').update(JSON.stringify([...e.classDecorators, ...e.decorators].filter(d => /^(Controller|WebSocketGateway|UseGuards|Roles|Public|Entity|RequireAudience|AccessPolicy|Get|Post|Put|Patch|Delete|Head|Options|All|Sse|SubscribeMessage)\(/.test(d)))).digest('hex').slice(0, 20);
for (const e of inventory()) if (e.controller === 'GfinConfigController' && e.method === 'bulkUpsertOverpriceRules') console.log(e.transport, s(e));"
```

เพิ่มบรรทัดใน `access-policy.manifest.json` (เรียงตามตัวอักษรของคีย์ — ถัดจาก `GfinConfigController.createRateFactor` ถ้าไฟล์เรียงแบบนั้น) โดยใช้ transport/surface ที่พิมพ์ออกมา:

```json
  "GfinConfigController.bulkUpsertOverpriceRules": {"classification":"staff","permission":"settings.finance.manage","resource":"none","company":"not-applicable","file":"apps/api/src/modules/gfin-config/gfin-config.controller.ts","transport":"Post('overprice-rules/bulk-upsert')","surface":"<ค่าที่พิมพ์>","resolution":"none"},
```

```bash
node tools/check-access-coverage.mjs
```

Expected: บรรทัด `Access inventory: ...` ไม่มี error

- [ ] **Step 7: รันเทส + typecheck**

```bash
cd apps/api && npx jest src/modules/gfin-config src/modules/employee-access && npx tsc --noEmit -p tsconfig.json
```

Expected: PASS · 0 error

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/gfin-config apps/api/src/modules/employee-access/access-policy.manifest.json
git commit -m "feat(gfin): POST overprice-rules/bulk-upsert แก้เงื่อนไขหลายรุ่นพร้อมกัน

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `POST /gfin-config/max-prices/close`

**Files:**
- Create: `apps/api/src/modules/gfin-config/dto/close-max-prices.dto.ts`
- Modify: `apps/api/src/modules/gfin-config/dto/index.ts`, `gfin-config.service.ts`, `gfin-config.controller.ts`, `access-policy.manifest.json`
- Test: `apps/api/src/modules/gfin-config/gfin-config.service.spec.ts`

**Interfaces:**
- Produces: body `{ ids: string[] }` → `{ closed: number }` · `closeMaxPrices(dto: CloseMaxPricesDto, userId: string): Promise<{ closed: number }>`

- [ ] **Step 1: DTO**

```ts
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

/** ปิดราคาหลายช่องพร้อมกัน (ตอนนำเข้า: ราคาที่มีในระบบแต่ไม่มีในไฟล์ — สเปก 2026-11-20 §5, §6.3) */
export class CloseMaxPricesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'กรุณาเลือกราคาที่จะปิดอย่างน้อย 1 ช่อง' })
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[];
}
```

`dto/index.ts`: `export * from './close-max-prices.dto';`

- [ ] **Step 2: เทส (ล้ม)** — เพิ่ม `updateMany: jest.fn()` ใน `prisma.gfinModelMapping` ของ `beforeEach` แล้วเพิ่ม:

```ts
  describe('closeMaxPrices', () => {
    it('ปิดเฉพาะแถวที่ยังเปิดและไม่ถูกลบ · audit หลังบันทึก', async () => {
      prisma.gfinModelMapping.updateMany.mockResolvedValue({ count: 3 });
      const res = await service.closeMaxPrices({ ids: ['a', 'b', 'c'] }, 'u1');
      expect(prisma.gfinModelMapping.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['a', 'b', 'c'] }, deletedAt: null, isActive: true },
        data: { isActive: false },
      });
      expect(res).toEqual({ closed: 3 });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'GFIN_MAX_PRICES_CLOSED', entity: 'gfin_model_mapping', entityId: 'batch',
        newValue: { ids: ['a', 'b', 'c'], closed: 3 },
      }));
    });
  });
```

- [ ] **Step 3: รัน (ล้ม)** — `cd apps/api && npx jest src/modules/gfin-config/gfin-config.service.spec.ts -t closeMaxPrices` → FAIL

- [ ] **Step 4: service** (หลัง `importMaxPrices` · import `CloseMaxPricesDto`)

```ts
  /** ปิดราคาที่ GFIN ไม่รับแล้ว (สเปก 2026-11-20 §5) — ปิดแล้วไม่หาย เปิดคืนได้ด้วย PATCH max-prices/:id */
  async closeMaxPrices(dto: CloseMaxPricesDto, userId: string) {
    const ids = [...new Set(dto.ids)];
    const { count } = await this.prisma.gfinModelMapping.updateMany({
      where: { id: { in: ids }, deletedAt: null, isActive: true },
      data: { isActive: false },
    });
    await this.auditService.log({
      action: 'GFIN_MAX_PRICES_CLOSED',
      entity: 'gfin_model_mapping',
      entityId: 'batch',
      userId,
      newValue: { ids, closed: count },
    });
    return { closed: count };
  }
```

- [ ] **Step 5: route** (หลัง `importMaxPrices` ใน controller · import `CloseMaxPricesDto`)

```ts
  @Post('max-prices/close')
  @Roles('OWNER')
  closeMaxPrices(@Body() dto: CloseMaxPricesDto, @Req() req: { user: { id: string } }) {
    return this.service.closeMaxPrices(dto, req.user.id);
  }
```

- [ ] **Step 6: manifest** — รันสคริปต์ใน Task 5 Step 6 โดยเปลี่ยน `'bulkUpsertOverpriceRules'` เป็น `'closeMaxPrices'` แล้วเพิ่ม:

```json
  "GfinConfigController.closeMaxPrices": {"classification":"staff","permission":"settings.finance.manage","resource":"none","company":"not-applicable","file":"apps/api/src/modules/gfin-config/gfin-config.controller.ts","transport":"Post('max-prices/close')","surface":"<ค่าที่พิมพ์>","resolution":"none"},
```

`node tools/check-access-coverage.mjs` → ไม่มี error

- [ ] **Step 7: รัน + commit**

```bash
cd apps/api && npx jest src/modules/gfin-config && npx tsc --noEmit -p tsconfig.json
cd ../.. && git add apps/api/src/modules/gfin-config apps/api/src/modules/employee-access/access-policy.manifest.json
git commit -m "feat(gfin): POST max-prices/close ปิดราคาหลายช่องพร้อมกัน

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: ค่าตั้งเวอร์ชันใบเงื่อนไข + ด่านค่าคอมที่ไม่มีตารางค่างวด

**Files:**
- Modify: `apps/api/src/modules/gfin-config/gfin-settings.util.ts`
- Modify: `apps/api/src/modules/gfin-config/dto/gfin-settings.dto.ts`
- Modify: `apps/api/src/modules/gfin-config/gfin-config.service.ts` (`getSettings`, `updateSettings`)
- Test: `apps/api/src/modules/gfin-config/gfin-config.service.spec.ts`

**Interfaces:**
- Produces: `GET /gfin-config/settings` คืน `GfinSettings & { sheetVersion: string | null; sheetEffectiveDate: string | null }` (`GfinSettingsView`) · PATCH รับ `sheetVersion?: string`, `sheetEffectiveDate?: string` (`''` = ล้าง) · `GfinSettings` เดิม**ไม่เปลี่ยน** (ผู้ใช้อื่นของ `loadGfinSettings` ไม่กระทบ)

- [ ] **Step 1: เทส (ล้ม)** — เพิ่ม `gfinRateFactor.count: jest.fn().mockResolvedValue(1)` ใน `beforeEach` แล้วเพิ่ม:

```ts
  describe('settings — เวอร์ชันใบเงื่อนไข + ด่านค่าคอม (สเปก 2026-11-20 §3.3, §5)', () => {
    const cfg = (values: Record<string, string>) =>
      prisma.systemConfig.findFirst.mockImplementation(({ where }: { where: { key: string } }) =>
        Promise.resolve(where.key in values ? { value: values[where.key] } : null));

    it('GET คืนเวอร์ชัน/วันที่ · ไม่ตั้ง = null', async () => {
      cfg({ 'gfin.sheetVersion': '6.5', 'gfin.sheetEffectiveDate': '2026-10-16' });
      await expect(service.getSettings()).resolves.toMatchObject({ sheetVersion: '6.5', sheetEffectiveDate: '2026-10-16', minDownPct: 25 });
      cfg({});
      await expect(service.getSettings()).resolves.toMatchObject({ sheetVersion: null, sheetEffectiveDate: null });
    });

    it('PATCH เวอร์ชัน/วันที่ → upsert คีย์ gfin.sheetVersion / gfin.sheetEffectiveDate', async () => {
      await service.updateSettings({ sheetVersion: '6.6', sheetEffectiveDate: '2027-01-01' }, 'u1');
      expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'gfin.sheetVersion' }, update: { value: '6.6', deletedAt: null } }));
      expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'gfin.sheetEffectiveDate' }, update: { value: '2027-01-01', deletedAt: null } }));
    });

    it('เปลี่ยนค่าคอม iPhone เป็น % ที่ไม่มีตารางค่างวด → 400 ไม่บันทึก', async () => {
      prisma.gfinRateFactor.count.mockResolvedValue(0);
      await expect(service.updateSettings({ commissionPhone: 10 }, 'u1'))
        .rejects.toThrow(new BadRequestException('ยังไม่มีตารางค่างวดของคอม 10% — เพิ่มตารางค่างวดก่อน แล้วค่อยเปลี่ยนค่าคอม'));
      expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
    });

    it('ส่งค่าคอมเดิม (15) หรือค่าคอม iPad 5% → ไม่ตรวจตารางค่างวด', async () => {
      prisma.gfinRateFactor.count.mockResolvedValue(0);
      await service.updateSettings({ commissionPhone: 15, commissionTablet: 5 }, 'u1');
      expect(prisma.gfinRateFactor.count).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: รัน (ล้ม)** — `cd apps/api && npx jest src/modules/gfin-config/gfin-config.service.spec.ts -t settings` → FAIL

- [ ] **Step 3: `gfin-settings.util.ts`** — import `readStringFlag` เพิ่ม แล้ว:

```ts
export const GFIN_SETTINGS_KEYS = {
  minDownPct: 'gfin.minDownPct',
  commissionPhone: 'gfin.commissionPct.PHONE',
  commissionTablet: 'gfin.commissionPct.TABLET',
  contractFee: 'gfin.contractFee',
  sheetVersion: 'gfin.sheetVersion',
  sheetEffectiveDate: 'gfin.sheetEffectiveDate',
} as const;

/** เวอร์ชัน/วันเริ่มใช้ของใบเงื่อนไข G Finn (สเปก 2026-11-20 §3.3) — ไม่ตั้ง = null */
export interface GfinSheetInfo {
  sheetVersion: string | null;
  sheetEffectiveDate: string | null;
}

export async function loadGfinSheetInfo(prisma: SystemConfigReader): Promise<GfinSheetInfo> {
  const [version, date] = await Promise.all([
    readStringFlag(prisma, GFIN_SETTINGS_KEYS.sheetVersion, ''),
    readStringFlag(prisma, GFIN_SETTINGS_KEYS.sheetEffectiveDate, ''),
  ]);
  return { sheetVersion: version || null, sheetEffectiveDate: date || null };
}

export type GfinSettingsView = GfinSettings & GfinSheetInfo;
```

- [ ] **Step 4: DTO** — เพิ่มใน `UpdateGfinSettingsDto` (import `IsString`, `Matches`, `MaxLength`, `ValidateIf`):

```ts
  /** เวอร์ชันใบเงื่อนไข G Finn เช่น "6.5" — "" = ล้าง */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  sheetVersion?: string;

  /** วันเริ่มใช้ใบเงื่อนไข YYYY-MM-DD — "" = ล้าง */
  @IsOptional()
  @IsString()
  @ValidateIf((_o, v) => v !== '')
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'วันที่ต้องเป็นรูปแบบ ปปปป-ดด-วว' })
  sheetEffectiveDate?: string;
```

- [ ] **Step 5: service** — import `loadGfinSheetInfo`, `type GfinSettingsView` แล้วแทนที่ `getSettings` และ `updateSettings`:

```ts
  async getSettings(): Promise<GfinSettingsView> {
    const [settings, sheet] = await Promise.all([loadGfinSettings(this.prisma), loadGfinSheetInfo(this.prisma)]);
    return { ...settings, ...sheet };
  }

  async updateSettings(dto: UpdateGfinSettingsDto, userId: string): Promise<GfinSettingsView> {
    const before = await this.getSettings();
    // สเปก 2026-11-20 §5: ตรวจเฉพาะเมื่อค่าคอม iPhone เปลี่ยน — ไม่มีตารางค่างวดของ % ใหม่ = GFIN คิดผ่อนไม่ได้ทุกเครื่อง
    if (dto.commissionPhone !== undefined && dto.commissionPhone !== before.commissionPctByCategory.PHONE) {
      const factors = await this.prisma.gfinRateFactor.count({
        where: { shopCommissionPct: dto.commissionPhone, isActive: true, deletedAt: null },
      });
      if (factors === 0) {
        throw new BadRequestException(
          `ยังไม่มีตารางค่างวดของคอม ${dto.commissionPhone}% — เพิ่มตารางค่างวดก่อน แล้วค่อยเปลี่ยนค่าคอม`,
        );
      }
    }
    const writes: Array<[string, string | number | undefined, string]> = [
      [GFIN_SETTINGS_KEYS.minDownPct, dto.minDownPct, 'GFIN: % ดาวน์ขั้นต่ำที่ GFIN ตั้งให้ร้าน'],
      [GFIN_SETTINGS_KEYS.commissionPhone, dto.commissionPhone, 'GFIN: % คอมมิชชั่นตั้งต้น มือถือ'],
      [GFIN_SETTINGS_KEYS.commissionTablet, dto.commissionTablet, 'GFIN: % คอมมิชชั่นตั้งต้น iPad'],
      [GFIN_SETTINGS_KEYS.contractFee, dto.contractFee, 'GFIN: ค่าทำสัญญาที่หักจากยอดโอนให้ร้าน'],
      [GFIN_SETTINGS_KEYS.sheetVersion, dto.sheetVersion?.trim(), 'GFIN: เวอร์ชันใบเงื่อนไข G Finn'],
      [GFIN_SETTINGS_KEYS.sheetEffectiveDate, dto.sheetEffectiveDate, 'GFIN: วันเริ่มใช้ใบเงื่อนไข G Finn'],
    ];
    for (const [key, value, label] of writes) {
      if (value === undefined) continue;
      await this.prisma.systemConfig.upsert({
        where: { key },
        create: { key, value: String(value), label },
        update: { value: String(value), deletedAt: null },
      });
    }
    const after = await this.getSettings();
    await this.auditService.log({
      action: 'GFIN_SETTINGS_UPDATED',
      entity: 'system_config',
      entityId: 'gfin',
      userId,
      oldValue: before as unknown as Record<string, unknown>,
      newValue: after as unknown as Record<string, unknown>,
    });
    return after;
  }
```

(ค่าว่าง `''` ถูกเขียนเป็น `''` → `readStringFlag` อ่านเป็นไม่ตั้ง = null)

- [ ] **Step 6: รัน + typecheck + commit**

```bash
cd apps/api && npx jest src/modules/gfin-config && npx tsc --noEmit -p tsconfig.json
cd ../.. && git add apps/api/src/modules/gfin-config
git commit -m "feat(gfin): ค่าตั้งเวอร์ชัน/วันเริ่มใช้ใบเงื่อนไข · กันเปลี่ยนค่าคอมเป็น % ที่ไม่มีตารางค่างวด

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: ตรวจรวม + PR body (backup + SQL หลัง deploy)

**Files:**
- Create: `docs/superpowers/plans/2026-11-21-gfin-rules-per-model-pr1-body.md` (ร่าง PR body — ไม่ commit ถ้าเจ้าของไม่สั่ง)

- [ ] **Step 1: เทส + type ทั้งระบบ**

```bash
./tools/check-types.sh all
cd packages/shared && npx vitest run && cd ../..
cd apps/web && npx vitest run && cd ../..
cd apps/api && npx jest --runInBand 2>&1 | tail -30 && cd ../..
node tools/check-access-coverage.mjs
```

Expected: ทุกคำสั่งผ่าน · ถ้ามีเทสอื่นล้มเพราะ fixture ไม่มีกติกา ให้แก้ตามสูตรใน Task 2 Step 13 แล้ว commit แยก `test: เติมกติกาใน fixture ...`

- [ ] **Step 2: ร่าง PR body** — เขียนไฟล์ข้างบนด้วยเนื้อหานี้ (ภาษาไทย):

```markdown
## สรุป
- แปลงกติกา GFIN 8 กลุ่มเป็นรายรุ่นรายมือด้วย migration `20261121000000_gfin_rules_per_model` — ค่าที่ใช้คิดเท่าเดิมทุก (รุ่น, ความจุ, มือ) พิสูจน์ด้วยเทส DB ที่ใช้ snapshot ระบบจริง 20/11/2026
- มีราคาแต่ไม่มีเงื่อนไขของรุ่น = คิดผ่อน GFIN ไม่ได้ (หน้าสินค้า · หน้าร้าน · หน้าราคา/บอท) — วันนี้กระทบเฉพาะ iPhone 12 มือ 2 ถ้ายังเปิดอยู่
- API ใหม่สำหรับหน้าตั้งค่าใหม่ (PR 2): `POST /gfin-config/overprice-rules/bulk-upsert` · `POST /gfin-config/max-prices/close` · เวอร์ชัน/วันเริ่มใช้ใบเงื่อนไขใน settings
- สร้าง/แก้กติกาหลายรุ่น (`|`) ได้ 400 · ถังขยะไม่กู้กติกากลุ่ม · เปลี่ยนค่าคอมเป็น % ที่ไม่มีตารางค่างวดได้ 400

## ก่อนกด merge (บังคับ)
1. `gcloud sql backups create --instance=bestchoice-db --description="before gfin_rules_per_model"` (PITR ปิดอยู่)
2. job test-api ผ่าน (รัน `gfin-rules-per-model.migration.db.spec.ts`)

## ตรวจหลัง deploy (อ่านอย่างเดียว)
```sql
-- 1) ไม่มีกติกาหลายรุ่นเหลือ
SELECT count(*) FROM gfin_overprice_rules WHERE deleted_at IS NULL AND series_pattern LIKE '%|%'; -- 0
-- 2) ไม่มีคู่ซ้ำ
SELECT series_pattern, condition, count(*) FROM gfin_overprice_rules WHERE deleted_at IS NULL GROUP BY 1,2 HAVING count(*) > 1; -- ไม่มีแถว
-- 3) คู่ที่มีราคาแต่ไม่มีกติกา (คาดว่าเหลือแค่ iPhone 12 HAND_2 ถ้ายังเปิด)
SELECT DISTINCT m.gfin_series, m.condition FROM gfin_model_mappings m
WHERE m.deleted_at IS NULL AND m.gfin_variant IS NULL AND m.is_active
  AND NOT EXISTS (SELECT 1 FROM gfin_overprice_rules r WHERE r.deleted_at IS NULL AND r.is_active AND r.series_pattern = m.gfin_series AND r.condition = m.condition);
-- 4) จำนวนกติกาต่อสภาพ
SELECT condition, count(*) FROM gfin_overprice_rules WHERE deleted_at IS NULL GROUP BY 1;
```

## ระหว่างรอ PR 2
หน้าตั้งค่า GFIN เดิม แท็บ "ส่วนเพิ่มราคา" จะเห็นกติการาว 45 แถว (รายรุ่น) แก้ทีละแถวได้ตามเดิม · สร้างกติกากลุ่มไม่ได้

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 3: รายงาน** — สรุปผลเทส/type และบอกว่ายังไม่ได้ push/เปิด PR (รอคำสั่ง)
