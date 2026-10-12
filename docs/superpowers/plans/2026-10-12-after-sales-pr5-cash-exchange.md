# หลังการขาย PR 5 — เปลี่ยนรุ่นเดิมสำหรับใบขายสด (CASH_SAME_MODEL_EXCHANGE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้ใบขายสด/ไฟแนนซ์นอกของมือสองที่มีปัญหาใน 7 วัน สลับเครื่องบนใบขายเดิมได้ ลงบัญชีสลับต้นทุนตามคำตอบฝ่ายบัญชีข้อ 10 ออกใบรับคืน + ใบส่งมอบเครื่องทดแทนตอนส่งมอบ และให้เครื่องเดิม (รอเคลม) ขอตัดจำหน่ายได้

**Architecture:** ต่อยอด hub หลังการขายเดิม (เคส → ทางออก → ยืนยัน → ส่งมอบ) ด้วย "ทาง ก": ไม่มีสัญญา/ใบขายใหม่ — `Sale.productId` ถูกสลับเป็นเครื่องทดแทนในธุรกรรมเดียวกับรายการบัญชี `ShopCashExchangeTemplate` (Dr S11-2002 ต้นทุนเดิม / Cr S50-1102 + Dr S50-1102 ต้นทุนใหม่ / Cr S11-2002) และ marker `AfterSalesCase.replacementSaleId` ทำให้ `deriveStage` รู้ว่าเคสยืนยันแล้ว สิทธิ์ 7 วันของใบขายคำนวณจาก `soldAt = Sale.shopWarrantyStartDate ?? createdAt` (วันส่งมอบตั้งค่าใหม่ ⇒ นับใหม่เอง) ส่วนหมวดเครื่อง (มือสองเท่านั้น) gate ที่ชั้นทางออก ไม่ใช่ชั้นสถานะประกัน

**Tech Stack:** NestJS 10 + Prisma + PostgreSQL · jest (unit, `*.spec.ts`) · vitest (DB integration, `*.integration.spec.ts`) · React 18 + TanStack Query + vitest/testing-library (web)

**Spec:** `docs/superpowers/specs/2026-10-12-after-sales-cash-same-model-exchange-design.md` (ร่าง 2 — commit `2b147c70c`)

## Global Constraints

- Worktree: `/Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5` · branch `feat/after-sales-pr5-cash-exchange` (แตกจาก `origin/main` `984b7a709`) · **ทุกคำสั่งใช้ absolute path** (cwd ของ harness เปลี่ยนเอง)
- jest หนึ่งไฟล์: `npm --prefix /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api run test --silent -- <path ใต้ apps/api>` · vitest DB: `source ~/Documents/BESTCHOICE-docs/pr4-advance-vat/test-env.sh && cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api && npx vitest run --no-file-parallelism <path>` · web: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/web && npx vitest run <path>` · type-check: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && ./tools/check-types.sh all`
- ห้ามรัน `apps/api run lint` (มี `--fix`) · ห้าม bare `git stash` · ห้าม push จนกว่าผู้ตรวจอิสระอ่านทั้งสาขา · merge = เจ้าของพิมพ์คำสั่งเอง
- Commit message ลงท้าย `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` · PR body ลงท้าย `🤖 Generated with [Claude Code](https://claude.com/claude-code)` · repo เป็น PUBLIC — ห้ามใส่ราคา/เอกสารภายในใน commit
- ข้อความผู้ใช้เป็นภาษาไทย · `Decimal` เท่านั้นสำหรับเงิน · ทุก query ใหม่กรอง `deletedAt: null` · AuditLog เขียน**หลัง** `$transaction` commit เท่านั้น (`AuditService.log` เปิด root tx เอง) · บรรทัด JE ยอด 0 ไม่ลง · idempotency ผ่าน `metadata.flow + metadata.idempotencyKey`
- ถ้อยคำบนเอกสาร: ห้ามคำว่า "รับเครื่อง" (ใช้ "รับฝาก"/"รับคืน"/"ส่งมอบ") · ไม่มีราคาเครื่อง/ต้นทุนบนเอกสาร · ไม่มีเลขที่เอกสารใหม่ (ใช้เลขเคส)
- ต้นทุน (`oldCost`/`newCost`/บรรทัด JE) ส่งถึง browser เฉพาะเมื่อ `canSeeCost(role)` (`apps/api/src/modules/products/cost-visibility.util.ts` — ทุก role ยกเว้น SALES)
- กรอบ 7 วันของใบขาย: ปุ่มเปิดเมื่อ `warrantyStatus === 'IN_7DAY_DEFECT' && daysRemainingIn7Day > 0` (วัน 0–6) · วันที่ 7 = ปิด "ครบกำหนด 7 วันแล้ว — ซ่อมเท่านั้น" · ไม่มี override ของ ผจก.
- สถานะเครื่องของใบขาย: `CASH → SOLD_CASH` · `EXTERNAL_FINANCE → SOLD_INSTALLMENT` (แผนที่เดียว `SALE_TYPE_PRODUCT_STATUS`)
- bump `apps/web/package.json` → `26.10.22` (PR #1691 ใช้ 26.10.21)

## Review Focus

1. **ยืนยันซ้อน 2 แท็บ / ผู้ใช้ 2 คน** — คนที่สองต้องได้ 409 และไม่มี JE ซ้ำ/เครื่องทดแทนถูก flip ซ้ำ (CAS บนเคส + `updateMany where status` + idempotency ของ JE) — เทสปักที่ Task 9 (unit: claim count 0 → 409 ก่อนแตะอะไร) และ Task 15 (DB: `Promise.allSettled` สองคำขอ)
2. **เครื่องทดแทนถูกขายที่ POS ระหว่างรอ ผจก. ยืนยัน** — ต้องได้ 409 "เครื่องทดแทนถูกขาย/จองไปแล้ว" และธุรกรรมย้อนกลับทั้งก้อน (ใบขายไม่ถูกสลับ) — เทส Task 9 (unit) + Task 15 (DB: ตั้งสถานะเป็น SOLD_CASH ก่อน confirm)
3. **เปิดหน้าเคสหลังยืนยันแล้ว stage ต้องไม่ถอย** — `reconcileStage` ต้องเห็น `replacementSaleId` ในทุก select — เทส Task 4 (unit) + Task 15 (DB: `getCase` ซ้ำหลัง confirm ยัง READY_FOR_PICKUP)
4. **ใบไฟแนนซ์นอก** — เครื่องเดิม/ใหม่เป็น `SOLD_INSTALLMENT` และ JE ลงปกติแม้ JE ขายเดิมไม่เคยลง — เทส Task 9 (unit) + Task 15 (DB)
5. **ส่งมอบเมื่อเครื่องทดแทนไม่มีนโยบายประกัน (`resolveShopWarrantyDays` คืน null)** — `shopWarrantyStartDate` ต้องตั้งเสมอ (ฐานกรอบ 7 วัน) และ `shopWarrantyEndDate = null` ไม่ล้ม — เทส Task 8 (util) + Task 9 (deliver)

## File Structure

**API (สร้างใหม่)**
- `apps/api/prisma/migrations/20261022000000_sale_exchange_case/migration.sql` — คอลัมน์ `sales.exchange_case_id` + FK + index
- `apps/api/src/modules/sales/services/sale-product-status.util.ts` — `SALE_TYPE_PRODUCT_STATUS` / `mainProductStatusFor` (ย้ายจาก sale-void)
- `apps/api/src/modules/repair-tickets/utils/sale-sold-at.ts` — `saleSoldAt(sale)`
- `apps/api/src/modules/after-sales/utils/assert-cash-replacement.ts` — ด่านเครื่องทดแทนของเคสขายสด (ใช้ทั้ง intake และ confirm)
- `apps/api/src/modules/journal/cpa-templates/shop-cash-exchange.template.ts` — JE สลับต้นทุน
- `apps/api/src/modules/sales/services/sale-shop-warranty.util.ts` — `shopWarrantyDatesFor(tx, product, soldAt)` (POS + ส่งมอบใช้ร่วม)
- `apps/api/src/modules/after-sales/dto/exchange-deliver.dto.ts` — อุปกรณ์/หมายเหตุตอนส่งมอบ
- `apps/api/src/modules/after-sales/__tests__/after-sales-cash-exchange.integration.spec.ts` — DB chain ทั้งเส้น

**API (แก้)** `detect-warranty-status.ts` · `repair-warranty.service.ts` · `after-sales-outcomes.util.ts` · `after-sales-lookup.service.ts` · `after-sales-stage.util.ts` · `after-sales-stage-reconcile.ts` · `after-sales-query.service.ts` · `after-sales-line.service.ts` · `after-sales-case.service.ts` · `create-case.dto.ts` · `after-sales-exchange.service.ts` · `after-sales.service.ts` · `after-sales.controller.ts` · `after-sales.module.ts` · `journal.module.ts` · `repair-ticket-lifecycle.service.ts` · `repair-tickets.service.ts` · `sale-writer.service.ts` · `sale-void.service.ts` · `stock-adjustments.service.ts` · `after-sales-doc-compose.ts` · `after-sales-doc-html.ts` · `after-sales-document.service.ts` · `sales-query.service.ts` · `schema.prisma`

**Web (แก้)** `pages/after-sales/after-sales.ts` · `ExchangeActionDialogs.tsx` · `ExchangeCard.tsx` · `AfterSalesCasePage.tsx` · `AfterSalesNewPage.tsx` · `SalesHistoryPage.tsx` · (ใหม่) `pages/sales-history/void-gate.ts`

**เอกสาร** `.claude/rules/accounting.md` (หัวข้อใหม่) · `apps/web/package.json` (version)

---

### Task 1: Schema — `Sale.exchangeCaseId` + แผนที่สถานะเครื่องตาม saleType

**Files:**
- Create: `apps/api/prisma/migrations/20261022000000_sale_exchange_case/migration.sql`
- Create: `apps/api/src/modules/sales/services/sale-product-status.util.ts`
- Create: `apps/api/src/modules/sales/services/sale-product-status.util.spec.ts`
- Create: `apps/api/src/modules/sales/__tests__/sale-exchange-case-migration.spec.ts`
- Modify: `apps/api/prisma/schema.prisma` (model `Sale` ~3049–3105 · model `AfterSalesCase` ~8124–8135)
- Modify: `apps/api/src/modules/sales/services/sale-void.service.ts:33-40`

**Interfaces:**
- Produces: `SALE_TYPE_PRODUCT_STATUS: Readonly<Record<'CASH' | 'EXTERNAL_FINANCE', ProductStatus>>` · `mainProductStatusFor(saleType: SaleType): ProductStatus | null` · Prisma `Sale.exchangeCaseId: string | null` + relation `Sale.exchangeCase` / `AfterSalesCase.exchangedSales`

- [ ] **Step 1: เขียนเทส migration (ตรวจข้อความ + `prisma validate`)**

`apps/api/src/modules/sales/__tests__/sale-exchange-case-migration.spec.ts`:
```ts
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
```

- [ ] **Step 2: รันให้เห็นว่าแดง**

Run: `npm --prefix /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api run test --silent -- src/modules/sales/__tests__/sale-exchange-case-migration.spec.ts`
Expected: FAIL — `ENOENT … migration.sql` และ regex ของ schema ไม่แมตช์

- [ ] **Step 3: เขียน migration + schema**

`apps/api/prisma/migrations/20261022000000_sale_exchange_case/migration.sql`:
```sql
-- PR 5 หลังการขาย (2026-10-12) — ใบขายสด/ไฟแนนซ์นอกที่สลับเครื่องแล้ว ชี้เคสหลังการขายครั้งล่าสุด
-- คอลัมน์เดียว nullable · forward-only · ไม่มี backfill (prod ไม่มีเคสขายสดที่เปลี่ยนเครื่อง)
ALTER TABLE "sales" ADD COLUMN "exchange_case_id" TEXT;
CREATE INDEX "sales_exchange_case_id_idx" ON "sales"("exchange_case_id");
ALTER TABLE "sales" ADD CONSTRAINT "sales_exchange_case_id_fkey"
  FOREIGN KEY ("exchange_case_id") REFERENCES "after_sales_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

`schema.prisma` — ใน `model Sale` หลังบรรทัด `voidedById` (ก่อน `createdAt`):
```prisma
  /// PR 5 หลังการขาย — เคสเปลี่ยนรุ่นเดิมขายสดครั้งล่าสุดที่สลับเครื่องบนใบนี้ (เครื่องเดิม/เวลา = case.productId/approvedAt)
  exchangeCaseId    String?        @map("exchange_case_id")
```
ในบล็อก relation ของ `Sale` (หลัง `contract …`):
```prisma
  exchangeCase             AfterSalesCase?           @relation("SaleExchangeCase", fields: [exchangeCaseId], references: [id], onDelete: Restrict)
```
ท้าย `model Sale` ก่อน `@@index([saleType])`:
```prisma
  @@index([exchangeCaseId])
```
ใน `model AfterSalesCase` หลัง `events        AfterSalesEvent[]`:
```prisma
  exchangedSales Sale[]            @relation("SaleExchangeCase")
```

- [ ] **Step 4: generate + apply ลงฐานทดสอบ แล้วรันเทส**

Run:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api && npx prisma generate && \
source ~/Documents/BESTCHOICE-docs/pr4-advance-vat/test-env.sh && npx prisma migrate deploy && \
npm --prefix /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api run test --silent -- src/modules/sales/__tests__/sale-exchange-case-migration.spec.ts
```
Expected: `migrate deploy` แจ้ง 1 migration applied · เทส PASS 3/3

- [ ] **Step 5: เทส util แผนที่สถานะ (แดงก่อน)**

`apps/api/src/modules/sales/services/sale-product-status.util.spec.ts`:
```ts
import { SALE_TYPE_PRODUCT_STATUS, mainProductStatusFor } from './sale-product-status.util';

describe('sale-product-status.util — สถานะเครื่องหลักที่ใบขายแต่ละแบบตั้ง', () => {
  it('CASH → SOLD_CASH · EXTERNAL_FINANCE → SOLD_INSTALLMENT (แผนที่เดียวกับด่าน G5 ของ void)', () => {
    expect(SALE_TYPE_PRODUCT_STATUS.CASH).toBe('SOLD_CASH');
    expect(SALE_TYPE_PRODUCT_STATUS.EXTERNAL_FINANCE).toBe('SOLD_INSTALLMENT');
    expect(mainProductStatusFor('CASH')).toBe('SOLD_CASH');
    expect(mainProductStatusFor('EXTERNAL_FINANCE')).toBe('SOLD_INSTALLMENT');
  });
  it('INSTALLMENT (ขายผ่อนของเรา) ไม่อยู่ในแผนที่ → null', () => {
    expect(mainProductStatusFor('INSTALLMENT')).toBeNull();
  });
});
```

Run: `npm --prefix /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api run test --silent -- src/modules/sales/services/sale-product-status.util.spec.ts`
Expected: FAIL — Cannot find module './sale-product-status.util'

- [ ] **Step 6: เขียน util แล้วให้ sale-void ใช้ตัวเดียวกัน**

`apps/api/src/modules/sales/services/sale-product-status.util.ts`:
```ts
import { ProductStatus, type SaleType } from '@prisma/client';

/**
 * สถานะที่ใบขายแต่ละแบบตั้งให้ **สินค้าหลัก** — `sale-writer.service.ts`: ขายสดตั้ง `SOLD_CASH`
 * (createCashSale) / ขายผ่านไฟแนนซ์ภายนอกตั้ง `SOLD_INSTALLMENT` (createExternalFinanceSale).
 * ผู้ใช้: ด่าน G5 ของ `SaleVoidService` และด่าน/การ flip เครื่องของเปลี่ยนรุ่นเดิมขายสด (PR 5) —
 * แผนที่เดียว ห้ามมีสำเนาที่สอง
 */
export const SALE_TYPE_PRODUCT_STATUS: Readonly<Record<'CASH' | 'EXTERNAL_FINANCE', ProductStatus>> = {
  CASH: ProductStatus.SOLD_CASH,
  EXTERNAL_FINANCE: ProductStatus.SOLD_INSTALLMENT,
};

/** null = ใบขายประเภทที่ไม่อยู่ในแผนที่ (INSTALLMENT ของเรา — เครื่องอยู่กับสัญญา ไม่ใช่ใบขาย) */
export function mainProductStatusFor(saleType: SaleType): ProductStatus | null {
  return saleType === 'CASH' || saleType === 'EXTERNAL_FINANCE'
    ? SALE_TYPE_PRODUCT_STATUS[saleType]
    : null;
}
```

ใน `sale-void.service.ts`: ลบบล็อก `const SALE_TYPE_PRODUCT_STATUS … = { CASH: …, EXTERNAL_FINANCE: … };` (บรรทัด ~37–40 — คง jsdoc ด้านบนไว้แล้วแก้เป็นชี้ไปที่ util) และเพิ่ม `import { SALE_TYPE_PRODUCT_STATUS } from './sale-product-status.util';` — ชื่อตัวแปรเดิมใช้ต่อได้ทุกจุด

- [ ] **Step 7: รันเทสทั้งสองไฟล์ + sale-void เดิม**

Run: `npm --prefix /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api run test --silent -- src/modules/sales/services/sale-product-status.util.spec.ts src/modules/sales/services/sale-void.service.spec.ts`
Expected: PASS ทั้งหมด (sale-void เดิมไม่เปลี่ยนพฤติกรรม)

- [ ] **Step 8: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && git add apps/api/prisma apps/api/src/modules/sales && git commit -m "feat(sales): Sale.exchangeCaseId + แผนที่สถานะเครื่องตาม saleType (PR5 T1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: สิทธิ์ 7 วันของใบขาย — `detectWarrantyStatus` + `RepairWarrantyService`

**Files:**
- Create: `apps/api/src/modules/repair-tickets/utils/sale-sold-at.ts`
- Modify: `apps/api/src/modules/repair-tickets/utils/detect-warranty-status.ts`
- Modify: `apps/api/src/modules/repair-tickets/services/repair-warranty.service.ts` (`computeDaysRemainingIn7Day` ~399 · `lookupByImei` ~317–397 · `warrantyLookup` contractless rows ~185–210 และ devices map ~252–268)
- Test: `apps/api/src/modules/repair-tickets/utils/__tests__/detect-warranty-status.spec.ts` · `apps/api/src/modules/repair-tickets/__tests__/lookup-by-imei.spec.ts`

**Interfaces:**
- Produces: `DetectWarrantyInput.sale?: { shopWarrantyEndDate?: Date | null; soldAt?: Date | null } | null` · `saleSoldAt(sale: { shopWarrantyStartDate?: Date | null; createdAt: Date } | null | undefined): Date | null` · `lookupByImei` คืน `daysRemainingIn7Day` ของใบขายไม่มีสัญญา (number | null) · `warrantyLookup.devices[].eligibility.forExchange` เป็น true ให้ใบขายมือสองใน 7 วัน

- [ ] **Step 1: เทส `detectWarrantyStatus` (แดงก่อน) — ต่อท้าย describe เดิม**

เพิ่มใน `detect-warranty-status.spec.ts`:
```ts
  describe('PR 5 — ใบขายไม่มีสัญญา นับ 7 วันจาก sale.soldAt (วันที่ล้วน ไม่ดูหมวดเครื่อง)', () => {
    it('ไม่มีสัญญา + soldAt 3 วันก่อน → IN_7DAY_DEFECT', () => {
      expect(
        detectWarrantyStatus({ sale: { soldAt: daysAgo(3), shopWarrantyEndDate: daysAhead(57) } }),
      ).toBe('IN_7DAY_DEFECT');
    });
    it('ไม่มีสัญญา + soldAt 7 วันพอดี (ปฏิทินไทย) → ยัง IN_7DAY_DEFECT (สูตรเดียวกับ deviceReceivedAt)', () => {
      expect(detectWarrantyStatus({ sale: { soldAt: bkkDaysAgo(7), shopWarrantyEndDate: daysAhead(50) } })).toBe(
        'IN_7DAY_DEFECT',
      );
      expect(detectWarrantyStatus({ sale: { soldAt: bkkDaysAgo(8), shopWarrantyEndDate: daysAhead(50) } })).toBe(
        'IN_SHOP_WARRANTY',
      );
    });
    it('มีสัญญาแต่ deviceReceivedAt ว่าง → ไม่ใช้ soldAt ของใบขาย (ใบขาย INSTALLMENT มี createdAt เสมอ)', () => {
      expect(
        detectWarrantyStatus({
          contract: { deviceReceivedAt: null, shopWarrantyEndDate: daysAhead(50) },
          sale: { soldAt: daysAgo(1), shopWarrantyEndDate: null },
        }),
      ).toBe('IN_SHOP_WARRANTY');
    });
  });
```

- [ ] **Step 2: รันให้แดง**

Run: `npm --prefix /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api run test --silent -- src/modules/repair-tickets/utils/__tests__/detect-warranty-status.spec.ts`
Expected: FAIL 2 เคส (ได้ `IN_SHOP_WARRANTY` แทน `IN_7DAY_DEFECT`) — เคสที่ 3 ผ่านอยู่แล้ว (เป็น guard กัน regression)

- [ ] **Step 3: แก้ `detectWarrantyStatus` + สร้าง `saleSoldAt`**

`detect-warranty-status.ts` — แก้ interface และบล็อก 7 วัน:
```ts
  sale?: { shopWarrantyEndDate?: Date | null; soldAt?: Date | null } | null;
```
```ts
  // 7-day defect window (inclusive, BKK calendar days). สัญญา = วันรับเครื่อง ·
  // ใบขายที่ไม่มีสัญญา (PR 5) = วันขาย `sale.soldAt` — ใช้เฉพาะเมื่อ **ไม่มีสัญญา** เพราะใบขาย
  // INSTALLMENT ของสัญญามี createdAt เสมอ แต่สัญญาที่ยังไม่รับเครื่องต้องไม่ได้สิทธิ์ 7 วัน.
  // หมวดเครื่อง (มือสองเท่านั้น) ไม่ตัดสินที่ชั้นนี้ — อยู่ที่ forExchange/computeOutcomes
  const anchor = c ? (c.deviceReceivedAt ?? null) : (input.sale?.soldAt ?? null);
  if (anchor) {
    const daysSinceReceipt =
      (toBkkCalendarDay(now).getTime() - toBkkCalendarDay(anchor).getTime()) / 86400_000;
    if (daysSinceReceipt <= 7) return 'IN_7DAY_DEFECT';
  }
```
(ลบบล็อก `if (c?.deviceReceivedAt) { … }` เดิม)

`apps/api/src/modules/repair-tickets/utils/sale-sold-at.ts`:
```ts
/**
 * วันขายของใบขายสด/ไฟแนนซ์นอก = ฐานกรอบ 7 วัน (PR 5): `shopWarrantyStartDate` ถูกตั้ง = เวลาขายโดย
 * `SaleWriterService.resolveSaleShopWarranty` และถูกตั้งใหม่ = วันส่งมอบตอนเปลี่ยนรุ่นเดิม ⇒ กรอบของ
 * เครื่องทดแทนนับใหม่เองโดยไม่ต้องมีคอลัมน์เพิ่ม · ใบที่ไม่มีนโยบายประกัน (start ว่าง) ใช้ createdAt
 */
export function saleSoldAt(
  sale: { shopWarrantyStartDate?: Date | null; createdAt: Date } | null | undefined,
): Date | null {
  if (!sale) return null;
  return sale.shopWarrantyStartDate ?? sale.createdAt;
}
```

- [ ] **Step 4: รันเทส detect ให้เขียว**

Run: เหมือน Step 2 · Expected: PASS ทั้งไฟล์

- [ ] **Step 5: เทส `lookupByImei` (แดงก่อน) — ต่อท้าย describe เดิมใน `lookup-by-imei.spec.ts`**

```ts
  describe('PR 5 — ใบขายไม่มีสัญญา: daysRemainingIn7Day จากวันขาย', () => {
    const product = {
      id: 'p-1', brand: 'Apple', model: 'iPhone 13', storage: '128GB',
      imeiSerial: '359000000000001', category: 'PHONE_USED', warrantyExpireDate: null,
    };
    it('ขายสด 3 วันก่อน (shopWarrantyStartDate ตั้ง) → IN_7DAY_DEFECT และ daysRemainingIn7Day = 4', async () => {
      const soldAt = new Date(Date.now() - 3 * 86400_000);
      prisma.product.findFirst.mockResolvedValue(product);
      prisma.sale.findFirst.mockResolvedValue({
        id: 's-1', saleType: 'CASH', createdAt: soldAt, shopWarrantyStartDate: soldAt,
        shopWarrantyEndDate: new Date(Date.now() + 57 * 86400_000),
        customer: { id: 'c-1', name: 'ก', phone: null }, contract: null,
      });
      const r = await service.lookupByImei('359000000000001', ownerUser);
      expect(r).toMatchObject({ found: true, warrantyStatus: 'IN_7DAY_DEFECT', daysRemainingIn7Day: 4 });
    });
    it('ขายสด 10 วันก่อน → IN_SHOP_WARRANTY และ daysRemainingIn7Day = 0', async () => {
      const soldAt = new Date(Date.now() - 10 * 86400_000);
      prisma.product.findFirst.mockResolvedValue(product);
      prisma.sale.findFirst.mockResolvedValue({
        id: 's-2', saleType: 'CASH', createdAt: soldAt, shopWarrantyStartDate: null,
        shopWarrantyEndDate: new Date(Date.now() + 50 * 86400_000),
        customer: { id: 'c-1', name: 'ก', phone: null }, contract: null,
      });
      const r = await service.lookupByImei('359000000000001', ownerUser);
      expect(r).toMatchObject({ warrantyStatus: 'IN_SHOP_WARRANTY', daysRemainingIn7Day: 0 });
    });
  });
```

- [ ] **Step 6: รันให้แดง**

Run: `npm --prefix /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api run test --silent -- src/modules/repair-tickets/__tests__/lookup-by-imei.spec.ts`
Expected: FAIL — `warrantyStatus` ได้ `IN_SHOP_WARRANTY` / `daysRemainingIn7Day` ได้ `null`

- [ ] **Step 7: แก้ `repair-warranty.service.ts`**

(ก) `import { saleSoldAt } from '../utils/sale-sold-at';`

(ข) `computeDaysRemainingIn7Day` เปลี่ยนให้รับวันฐานตรง ๆ:
```ts
  /** เหลืออีกกี่วันในกรอบ 7 วัน นับจากวันฐาน (วันรับเครื่องของสัญญา หรือวันขายของใบขายสด — PR 5) */
  private computeDaysRemainingIn7Day(anchor: Date | null | undefined): number | null {
    if (!anchor) return null;
    const bkkOffsetMs = 7 * 60 * 60 * 1000;
    const toBkkMidnight = (d: Date) => {
      const bkk = new Date(d.getTime() + bkkOffsetMs);
      return new Date(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate());
    };
    const daysSince =
      (toBkkMidnight(new Date()).getTime() - toBkkMidnight(new Date(anchor)).getTime()) / 86_400_000;
    const remaining = 7 - daysSince;
    return remaining < 0 ? 0 : Math.ceil(remaining);
  }
```

(ค) `lookupByImei`: ใน `select` ของ `sale.findFirst` เพิ่ม `shopWarrantyStartDate: true,` ใต้ `shopWarrantyEndDate: true,` · แก้การเรียก:
```ts
    const warrantyStatus = detectWarrantyStatus({
      contract: sale?.contract ?? null,
      sale: sale
        ? { shopWarrantyEndDate: sale.shopWarrantyEndDate, soldAt: sale.contract ? null : saleSoldAt(sale) }
        : null,
      product,
    });
```
และ `daysRemainingIn7Day: this.computeDaysRemainingIn7Day(sale?.contract ? sale.contract.deviceReceivedAt : saleSoldAt(sale)),`

(ง) `warrantyLookup` — contractless rows เพิ่ม `soldAt: saleSoldAt(s),` ต่อจาก `purchasedAt: s.createdAt,` · ใน devices map:
```ts
        const anchor: Date | null = c.deviceReceivedAt ?? c.soldAt ?? null;
        const warrantyWindows = this.computeWarrantyWindows(anchor, c.shopWarrantyEndDate, c.product?.warrantyExpireDate);
        const warrantyStatus = detectWarrantyStatus(
          c.id
            ? { contract: c, product: c.product }
            : { sale: { shopWarrantyEndDate: c.shopWarrantyEndDate, soldAt: c.soldAt ?? null }, product: c.product },
        );
        // สิทธิ์เปลี่ยนรุ่นเดิม: สัญญาต้อง ACTIVE · ใบขายสด (PR 5) ต้องมีใบขายจริง · ทั้งคู่เฉพาะมือสอง
        const forExchange =
          warrantyStatus === 'IN_7DAY_DEFECT' &&
          c.product?.category === 'PHONE_USED' &&
          (c.id ? c.status === 'ACTIVE' : !!c.saleId);
```
(แทนที่ `computeWarrantyWindows(c.deviceReceivedAt, …)` · `detectWarrantyStatus({ contract: c, product: c.product })` · บล็อก `forExchange` เดิม)

- [ ] **Step 8: รันเทสทั้งโมดูล repair-tickets**

Run: `npm --prefix /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api run test --silent -- src/modules/repair-tickets`
Expected: PASS ทั้งหมด (รวมเคสเก่าของสัญญา — คอมเมนต์ "สิทธิ์เปลี่ยนเครื่อง 7 วันผูกกับสัญญาเท่านั้น" ที่บรรทัด ~188 ให้แก้เป็น "PR 5: ใบขายได้สิทธิ์จาก soldAt")

- [ ] **Step 9: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && git add apps/api/src/modules/repair-tickets && git commit -m "feat(repair-tickets): สิทธิ์ 7 วันของใบขายสดจาก soldAt (PR5 T2)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: ทางออก `CASH_SAME_MODEL_EXCHANGE` เปิดใช้ใน `computeOutcomes` + lookup ส่งหมวดเครื่อง

**Files:**
- Modify: `apps/api/src/modules/after-sales/utils/after-sales-outcomes.util.ts:3-11,51-70`
- Modify: `apps/api/src/modules/after-sales/services/after-sales-lookup.service.ts:14-22,195-205`
- Test: `apps/api/src/modules/after-sales/__tests__/outcomes.spec.ts` (แก้ 3 เคสเดิม + เพิ่ม) · `apps/api/src/modules/after-sales/__tests__/lookup.spec.ts` · `apps/api/src/modules/after-sales/__tests__/after-sales-flow.integration.spec.ts:416-425`

**Interfaces:**
- Produces: `OutcomeInput.productCategory?: ProductCategory | null` · exports `CASH_EXCHANGE_NOTE = 'ผจก.สาขา ต้องยืนยัน'` · `CASH_DAY7_REASON = 'ครบกำหนด 7 วันแล้ว — ซ่อมเท่านั้น'` · `CASH_OUT_OF_WINDOW_REASON = 'เกินกรอบ 7 วันแล้ว — ซ่อมเท่านั้น'` · `CASH_NOT_USED_REASON = 'เปลี่ยนรุ่นเดิมเฉพาะมือสอง — เครื่องใหม่ส่งเคลมศูนย์'` · `LookupResult.product.category: ProductCategory`
- Consumes: Task 2 (`daysRemainingIn7Day` ของใบขาย)

- [ ] **Step 1: แก้/เพิ่มเทส outcomes (แดงก่อน)**

ใน `outcomes.spec.ts` แทนที่เคสเดิมที่บรรทัด ~126–150 (สองเคส CASH) และ ~162–168 ด้วย:
```ts
  describe('CASH_SALE (PR 5) — เปลี่ยนรุ่นเดิมขายสด', () => {
    const cash = { ...base, source: 'CASH_SALE' as const, contractStatus: undefined, productCategory: 'PHONE_USED' as const };
    it('มือสอง ใน 7 วัน (เหลือ 2 วัน) → เปิด + implemented · note ผจก.', () => {
      const o = computeOutcomes(cash);
      expect(o.map((x) => x.outcome)).toEqual(['REPAIR', 'CASH_SAME_MODEL_EXCHANGE']);
      expect(pick(o, 'CASH_SAME_MODEL_EXCHANGE')).toEqual({
        outcome: 'CASH_SAME_MODEL_EXCHANGE', enabled: true, implemented: true, note: CASH_EXCHANGE_NOTE,
      });
    });
    it('วันที่ 7 (status ยัง IN_7DAY_DEFECT แต่ daysRemaining 0) → ปิด "ครบกำหนด 7 วันแล้ว — ซ่อมเท่านั้น" แม้เป็น OWNER', () => {
      const o = computeOutcomes({ ...cash, daysRemainingIn7Day: 0, viewerRole: 'OWNER' });
      expect(pick(o, 'CASH_SAME_MODEL_EXCHANGE')).toMatchObject({ enabled: false, reason: CASH_DAY7_REASON });
    });
    it('เกิน 7 วัน (IN_SHOP_WARRANTY) → ปิด "เกินกรอบ 7 วันแล้ว — ซ่อมเท่านั้น" ไม่มี override ของ BM', () => {
      const o = computeOutcomes({ ...cash, warrantyStatus: 'IN_SHOP_WARRANTY', daysRemainingIn7Day: 0, viewerRole: 'BRANCH_MANAGER' });
      expect(pick(o, 'CASH_SAME_MODEL_EXCHANGE')).toMatchObject({ enabled: false, reason: CASH_OUT_OF_WINDOW_REASON });
    });
    it('เครื่องใหม่ขายสด ใน 7 วัน → ปิด "เปลี่ยนรุ่นเดิมเฉพาะมือสอง"', () => {
      const o = computeOutcomes({ ...cash, productCategory: 'PHONE_NEW' });
      expect(pick(o, 'CASH_SAME_MODEL_EXCHANGE')).toMatchObject({ enabled: false, reason: CASH_NOT_USED_REASON });
    });
    it('ไม่รู้หมวด (productCategory ว่าง) → ปิดแบบเดียวกับเครื่องใหม่ (fail-closed)', () => {
      const o = computeOutcomes({ ...cash, productCategory: null });
      expect(pick(o, 'CASH_SAME_MODEL_EXCHANGE')).toMatchObject({ enabled: false, reason: CASH_NOT_USED_REASON });
    });
  });
```
และแก้ import ให้รวม `CASH_EXCHANGE_NOTE, CASH_DAY7_REASON, CASH_OUT_OF_WINDOW_REASON, CASH_NOT_USED_REASON` · เคสเดิมที่ assert `implemented` ของ CASH `false` (บรรทัด ~162–168) ลบทิ้ง

- [ ] **Step 2: รันให้แดง**

Run: `npm --prefix /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api run test --silent -- src/modules/after-sales/__tests__/outcomes.spec.ts`
Expected: FAIL — export ไม่มี / `enabled` ยัง false

- [ ] **Step 3: แก้ `after-sales-outcomes.util.ts`**

import: `import type { AfterSalesOutcome, AfterSalesSource, ProductCategory, WarrantyStatus } from '@prisma/client';` · ใน `OutcomeInput` เพิ่ม `productCategory?: ProductCategory | null; // PR 5 — gate "มือสองเท่านั้น" ของขายสดอยู่ชั้นนี้ ไม่ใช่ใน warrantyStatus`

ก่อน `export function computeOutcomes`:
```ts
/** PR 5 — ถ้อยคำกิ่งขายสด (ปุ่ม/เหตุผลใต้ปุ่ม) — export ให้ UI/เทสอ้างตัวเดียวกัน */
export const CASH_EXCHANGE_NOTE = 'ผจก.สาขา ต้องยืนยัน';
export const CASH_DAY7_REASON = 'ครบกำหนด 7 วันแล้ว — ซ่อมเท่านั้น';
export const CASH_OUT_OF_WINDOW_REASON = 'เกินกรอบ 7 วันแล้ว — ซ่อมเท่านั้น';
export const CASH_NOT_USED_REASON = 'เปลี่ยนรุ่นเดิมเฉพาะมือสอง — เครื่องใหม่ส่งเคลมศูนย์';
```
แทนที่บล็อก `if (i.source === 'CASH_SALE') { … }`:
```ts
  if (i.source === 'CASH_SALE') {
    // PR 5 — ไม่มี override ของ ผจก. (คำตัดสินเจ้าของ ⑥) · วันที่ 7: status ยัง IN_7DAY_DEFECT (≤ 7)
    // แต่ daysRemaining = 0 ⇒ ปุ่มปิดด้วยถ้อยคำของตัวเอง ไม่ใช่ "เกินกรอบ"
    const used = i.productCategory === 'PHONE_USED';
    const cash: OutcomeOption = !used
      ? { outcome: 'CASH_SAME_MODEL_EXCHANGE', enabled: false, implemented: false, reason: CASH_NOT_USED_REASON }
      : within7
        ? { outcome: 'CASH_SAME_MODEL_EXCHANGE', enabled: true, implemented: true, note: CASH_EXCHANGE_NOTE }
        : i.warrantyStatus === 'IN_7DAY_DEFECT'
          ? { outcome: 'CASH_SAME_MODEL_EXCHANGE', enabled: false, implemented: false, reason: CASH_DAY7_REASON }
          : { outcome: 'CASH_SAME_MODEL_EXCHANGE', enabled: false, implemented: false, reason: CASH_OUT_OF_WINDOW_REASON };
    return [repair, cash];
  }
```

- [ ] **Step 4: รัน outcomes ให้เขียว** — Run เหมือน Step 2 · Expected: PASS

- [ ] **Step 5: เทส lookup ส่ง productCategory (แดงก่อน)** — เพิ่มใน `lookup.spec.ts` ท้าย describe:
```ts
  it('PR 5 — พบใบขายสดมือสอง ใน 7 วัน → ส่ง productCategory ให้ computeOutcomes และ CASH_SAME_MODEL_EXCHANGE เปิด', async () => {
    repair.lookupByImei.mockResolvedValue({
      found: true,
      product: { id: 'product-9', brand: 'Apple', model: 'iPhone 13', storage: '128GB', imeiSerial: '359000000000009', category: 'PHONE_USED' },
      sale: { id: 'sale-9', saleType: 'CASH' },
      customer: { id: 'cust-9', name: 'ข', phone: null },
      contract: null,
      warrantyStatus: 'IN_7DAY_DEFECT',
      daysRemainingIn7Day: 5,
      purchasedAt: new Date(), shopWarrantyEndDate: null, manufacturerWarrantyEndDate: null,
    });
    const result = await svc.lookup({ imei: '359000000000009' }, user);
    expect(result.source).toBe('CASH_SALE');
    expect(result.product).toMatchObject({ category: 'PHONE_USED' });
    expect(result.outcomes.find((o) => o.outcome === 'CASH_SAME_MODEL_EXCHANGE')).toMatchObject({ enabled: true, implemented: true });
    expect(defect.checkEligibility).not.toHaveBeenCalled();
  });
```

- [ ] **Step 6: รันให้แดง** — Run: `npm --prefix … run test --silent -- src/modules/after-sales/__tests__/lookup.spec.ts` · Expected: FAIL (`enabled` false)

- [ ] **Step 7: แก้ lookup service** — `LookupResult.product` เพิ่ม `category: ProductCategory;` (import type จาก `@prisma/client`) · ใน `computeOutcomes({...})` เพิ่ม `productCategory: r.product.category,`

- [ ] **Step 8: แก้ integration test เดิมที่ปักว่า CASH ปิด** — `after-sales-flow.integration.spec.ts` เคส 2 (บรรทัด ~416–425): fixture เป็น PHONE_USED ขาย 3 วันก่อน ⇒ เปลี่ยน expectation เป็น
```ts
    expect(result.outcomes[1]).toMatchObject({ outcome: 'CASH_SAME_MODEL_EXCHANGE', enabled: true, implemented: true });
```
และแก้ชื่อเทสเป็น `'2) lookup({imei}) → found=true, source=CASH_SALE, REPAIR เปิด, CASH_SAME_MODEL_EXCHANGE เปิด (PR 5 — มือสองใน 7 วัน)'`

- [ ] **Step 9: รัน unit + integration**

Run: `npm --prefix /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api run test --silent -- src/modules/after-sales/__tests__/lookup.spec.ts src/modules/after-sales/__tests__/outcomes.spec.ts` แล้ว `source ~/Documents/BESTCHOICE-docs/pr4-advance-vat/test-env.sh && cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api && npx vitest run --no-file-parallelism src/modules/after-sales/__tests__/after-sales-flow.integration.spec.ts`
Expected: PASS ทั้งสาม

- [ ] **Step 10: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && git add apps/api/src/modules/after-sales && git commit -m "feat(after-sales): เปิดทางออกเปลี่ยนรุ่นเดิมขายสด — มือสองใน 7 วัน ไม่มี override (PR5 T3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: stage ของเคสขายสด — `replacementSaleId` เป็น marker ใน `deriveStage` + ทุก select ที่ reconcile ใช้ + การ์ดสรุป

**Files:**
- Modify: `apps/api/src/modules/after-sales/utils/after-sales-stage.util.ts:3-17,40-47`
- Modify: `apps/api/src/modules/after-sales/services/after-sales-stage-reconcile.ts` (`ReconcilableCase` · `RECONCILE_SELECT` · การเรียก `deriveStage`)
- Modify: `apps/api/src/modules/after-sales/services/after-sales-query.service.ts` (`ROW_SELECT` ~50–90 · `DecorateInput` · `ExchangeAttachInput` · `CaseExchangeInfo` ~130–155 · `EXCHANGE_OUTCOMES` ~168 · `decorate()` ~178 · `attachExchange()` ~222–305)
- Modify: `apps/api/src/modules/after-sales/services/after-sales-lookup.service.ts:128-146` (select ของ `openCaseRaw`)
- Modify: `apps/api/src/modules/after-sales/services/after-sales-line.service.ts:48-75` (`CASE_FOR_LINE_SELECT`)
- Test: `__tests__/stage.spec.ts` · `__tests__/stage-reconcile.spec.ts` · `__tests__/query.spec.ts`

**Interfaces:**
- Produces: `StageInput.replacementSaleId?: string | null` · `ReconcilableCase.replacementSaleId: string | null` · `RECONCILE_SELECT.replacementSaleId: true` · `CaseExchangeInfo.sale: { id: string; saleNumber: string } | null` · `EXCHANGE_OUTCOMES` รวม `CASH_SAME_MODEL_EXCHANGE`
- Consumes: ไม่มี (ฐานให้ Task 9/14)

- [ ] **Step 1: เทส `deriveStage` (แดงก่อน)** — เพิ่มใน `stage.spec.ts` หลัง describe `SAME_MODEL_EXCHANGE outcome`:
```ts
  describe('CASH_SAME_MODEL_EXCHANGE (PR 5) — marker คือ replacementSaleId (ไม่มีสัญญาใหม่)', () => {
    it.each([
      [{ outcome: 'CASH_SAME_MODEL_EXCHANGE', cancelledAt: null, closedAt: null, repairStatus: null, replacementContractId: null, replacementSaleId: null }, 'AWAITING_APPROVAL'],
      [{ outcome: 'CASH_SAME_MODEL_EXCHANGE', cancelledAt: null, closedAt: null, repairStatus: null, replacementContractId: null, replacementSaleId: 'sale-1' }, 'READY_FOR_PICKUP'],
      [{ outcome: 'CASH_SAME_MODEL_EXCHANGE', cancelledAt: null, closedAt: new Date(), repairStatus: null, replacementContractId: null, replacementSaleId: 'sale-1' }, 'CLOSED'],
      [{ outcome: 'CASH_SAME_MODEL_EXCHANGE', cancelledAt: new Date(), closedAt: null, repairStatus: null, replacementContractId: null, replacementSaleId: 'sale-1' }, 'CANCELLED'],
      // เคสซ่อมของใบขายสดที่ซ่อมไม่ได้ → markReplacedBySale ตั้ง REPLACED + replacementSaleId
      [{ outcome: 'REPAIR', cancelledAt: null, closedAt: null, repairStatus: 'REPLACED', replacementContractId: null, replacementSaleId: 'sale-1' }, 'READY_FOR_PICKUP'],
    ] as const)('%j → %s', (input, expected) => {
      expect(deriveStage(input as never)).toBe(expected);
    });
  });
```

- [ ] **Step 2: รันให้แดง** — Run: `npm --prefix /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api run test --silent -- src/modules/after-sales/__tests__/stage.spec.ts` · Expected: FAIL 3 เคส (ได้ AWAITING_APPROVAL แทน READY/… )

- [ ] **Step 3: แก้ `after-sales-stage.util.ts`**

`StageInput` เพิ่ม:
```ts
  /** PR 5 — เคสขายสดไม่มีสัญญาใหม่: marker "ยืนยันแล้ว" คือ replacementSaleId (= ใบขายเดิมที่ถูกสลับเครื่อง)
   * เขียนใน tx เดียวกับการยืนยัน — ห้ามใช้ approvedAt (กิ่งสัญญาผ่อนตั้งมันตอนจองเคสก่อน engine สำเร็จ) */
  replacementSaleId?: string | null;
```
`OPEN_EXCHANGE_STAGE`:
```ts
const OPEN_EXCHANGE_STAGE = (i: StageInput): AfterSalesStage => {
  if (i.closedAt) return 'CLOSED';
  if (i.replacementContractId || i.replacementSaleId) return 'READY_FOR_PICKUP';
  return 'AWAITING_APPROVAL';
};
```

- [ ] **Step 4: รัน stage.spec ให้เขียว** — Expected: PASS

- [ ] **Step 5: เทส reconcile ส่ง replacementSaleId (แดงก่อน)** — เพิ่มใน `stage-reconcile.spec.ts`:
```ts
  it('PR 5 — เคสขายสดที่ยืนยันแล้ว (replacementSaleId ตั้ง, stored stage AWAITING_APPROVAL) → derived READY_FOR_PICKUP และ CAS เขียน', async () => {
    const row = buildRow({
      outcome: 'CASH_SAME_MODEL_EXCHANGE', stage: 'AWAITING_APPROVAL', repairTicket: null,
      replacementContractId: null, replacementSaleId: 'sale-1',
    });
    const result = await reconcileStage(client, row as ReconcilableCase);
    expect(result.stage).toBe('READY_FOR_PICKUP');
    expect(client.afterSalesCase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'as-1', stage: 'AWAITING_APPROVAL' }, data: expect.objectContaining({ stage: 'READY_FOR_PICKUP' }) }),
    );
  });
  it('RECONCILE_SELECT เลือก replacementSaleId (ทุกผู้อ่านต้องส่งให้ deriveStage)', () => {
    expect(RECONCILE_SELECT).toMatchObject({ replacementSaleId: true, replacementContractId: true });
  });
```
(เพิ่ม `RECONCILE_SELECT` ใน import และ `replacementSaleId: null` ใน `buildRow`)

- [ ] **Step 6: รันให้แดง** — Run: `… -- src/modules/after-sales/__tests__/stage-reconcile.spec.ts` · Expected: FAIL (stage ยัง AWAITING / select ไม่มีคีย์)

- [ ] **Step 7: แก้ reconcile + selects ทุกจุด**

`after-sales-stage-reconcile.ts`: `ReconcilableCase` เพิ่ม `replacementSaleId: string | null;` ใต้ `replacementContractId` · `RECONCILE_SELECT` เพิ่ม `replacementSaleId: true,` · ใน `reconcileStage` ส่ง `replacementSaleId: row.replacementSaleId,` ต่อจาก `replacementContractId: row.replacementContractId,`

`after-sales-query.service.ts`:
- `ROW_SELECT` เพิ่ม `saleId: true, // PR 5 — attachExchange ใช้หาเลขใบขายของเคสขายสด` และ `replacementSaleId: true, // PR 5 — marker ของ deriveStage (เคสขายสดไม่มีสัญญาใหม่)`
- `DecorateInput` เพิ่ม `replacementSaleId?: string | null;` · ใน `decorate()` ส่ง `replacementSaleId: row.replacementSaleId ?? null,`
- `ExchangeAttachInput` เพิ่ม `saleId?: string | null;`
- `CaseExchangeInfo` เพิ่ม `/** PR 5 — ใบขายที่ถูกสลับเครื่อง (เคสขายสด) */ sale: { id: string; saleNumber: string } | null;`
- `EXCHANGE_OUTCOMES = new Set<AfterSalesOutcome>(['SAME_MODEL_EXCHANGE', 'PRICED_EXCHANGE', 'CASH_SAME_MODEL_EXCHANGE'])` + แก้ jsdoc ("PR 5: นับเคสขายสดด้วย")
- `attachExchange`: หลัง `replacementContractIds` เพิ่ม `const saleIds = new Set<string>();` และในลูปแรก `if (kind === 'SAME_MODEL' && r.saleId) saleIds.add(r.saleId);` · ขยาย `Promise.all` เป็นสามตัว:
```ts
      saleIds.size
        ? this.prisma.sale.findMany({ where: { id: { in: [...saleIds] }, deletedAt: null }, select: { id: true, saleNumber: true } })
        : Promise.resolve([]),
```
`const saleById = new Map(sales.map((s) => [s.id, s] as const));` และใน `out.set(...)` เพิ่ม `sale: kind === 'SAME_MODEL' && r.saleId ? (saleById.get(r.saleId) ?? null) : null,`

`after-sales-lookup.service.ts` select ของ `openCaseRaw` เพิ่ม `replacementSaleId: true,` · `after-sales-line.service.ts` `CASE_FOR_LINE_SELECT` เพิ่ม `saleId: true,` และ `replacementSaleId: true,`

- [ ] **Step 8: เทส summary นับเคสขายสด (แดงก่อน)** — ใน `query.spec.ts` describe `(j)` เพิ่ม:
```ts
    it('PR 5 — openExchange นับ CASH_SAME_MODEL_EXCHANGE ด้วย และ count() ของ exchanges รวม outcome นี้', async () => {
      const openCash = buildCaseA({ id: 'as-9', outcome: 'CASH_SAME_MODEL_EXCHANGE', stage: 'AWAITING_APPROVAL', replacementContractId: null, replacementSaleId: null });
      prisma.afterSalesCase.findMany.mockResolvedValue([openCash]);
      prisma.repairTicket.findMany.mockResolvedValue([]);
      prisma.afterSalesCase.count.mockResolvedValue(0);
      const result = await svc.summary(owner);
      expect(result.openExchange).toBe(1);
      const countArgs = prisma.afterSalesCase.count.mock.calls[0][0];
      expect(countArgs.where.outcome).toEqual({ in: ['SAME_MODEL_EXCHANGE', 'PRICED_EXCHANGE', 'CASH_SAME_MODEL_EXCHANGE'] });
    });
```
และแก้เทสเดิมบรรทัด ~663 ให้คาดหวัง `{ in: ['SAME_MODEL_EXCHANGE', 'PRICED_EXCHANGE', 'CASH_SAME_MODEL_EXCHANGE'] }` · เพิ่ม `replacementSaleId: null` ใน `buildCaseA` · ถ้า `prisma.sale` ไม่มีใน mock ของไฟล์ ให้เพิ่ม `sale: { findMany: jest.fn().mockResolvedValue([]) }`

- [ ] **Step 9: รันสามไฟล์**

Run: `npm --prefix /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api run test --silent -- src/modules/after-sales/__tests__/stage.spec.ts src/modules/after-sales/__tests__/stage-reconcile.spec.ts src/modules/after-sales/__tests__/query.spec.ts src/modules/after-sales/__tests__/lookup.spec.ts src/modules/after-sales/__tests__/line-service.spec.ts`
Expected: PASS ทั้งหมด

- [ ] **Step 10: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && git add apps/api/src/modules/after-sales && git commit -m "feat(after-sales): deriveStage รู้จัก replacementSaleId + การ์ดสรุปนับเคสขายสด (PR5 T4)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `assertCashReplacement` + intake รับทางออกขายสด

**Files:**
- Create: `apps/api/src/modules/after-sales/utils/assert-cash-replacement.ts`
- Create: `apps/api/src/modules/after-sales/__tests__/assert-cash-replacement.spec.ts`
- Modify: `apps/api/src/modules/after-sales/dto/create-case.dto.ts:567-568` (IsIn)
- Modify: `apps/api/src/modules/after-sales/services/after-sales-case.service.ts:149-177,342-356`
- Test: `__tests__/case-create.spec.ts`

**Interfaces:**
- Produces:
```ts
export interface CashReplacementInput { sale: { id: string; productId: string; customerId: string }; caseBranchId: string }
export interface CashReplacementProduct { id: string; brand: string; model: string; storage: string | null; imeiSerial: string | null; costPrice: Prisma.Decimal; category: ProductCategory; status: ProductStatus; branchId: string | null }
export async function assertCashReplacement(client: Prisma.TransactionClient | PrismaService, input: CashReplacementInput, replacementProductId: string): Promise<CashReplacementProduct>
export const CASH_REPLACEMENT_MSG = { NOT_FOUND, SAME_DEVICE, NOT_USED, NOT_IN_STOCK, WRONG_BRANCH, MODEL_MISMATCH } as const
```
- Consumes: ไม่มี (Task 9 เรียกใน tx)

- [ ] **Step 1: เทส util (แดงก่อน)**

`apps/api/src/modules/after-sales/__tests__/assert-cash-replacement.spec.ts`:
```ts
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertCashReplacement, CASH_REPLACEMENT_MSG } from '../utils/assert-cash-replacement';

const OLD = { id: 'p-old', brand: 'Apple', model: 'iPhone 13', storage: '128GB' };
const CUSTOMER = { name: 'สมชาย ใจดี', phone: '0812345678', addressCurrent: 'ลพบุรี' };
const NEW = {
  id: 'p-new', brand: 'Apple', model: 'iPhone 13', storage: '128GB', imeiSerial: '359000000000002',
  costPrice: new Prisma.Decimal('10500.00'), category: 'PHONE_USED', status: 'IN_STOCK', branchId: 'b-1',
  deletedAt: null, name: 'iPhone 13 128GB', po: null,
};
const INPUT = { sale: { id: 's-1', productId: 'p-old', customerId: 'c-1' }, caseBranchId: 'b-1' };

function client(newProduct: Record<string, unknown> | null = NEW) {
  return {
    product: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'p-old' ? OLD : newProduct),
      ),
    },
    customer: { findUniqueOrThrow: jest.fn().mockResolvedValue(CUSTOMER) },
  };
}

describe('assertCashReplacement (PR 5 §3.3) — ด่านเครื่องทดแทนของเคสขายสด ใช้ทั้ง intake และ confirm', () => {
  it('ผ่านทุกข้อ → คืนเครื่องทดแทน (มี costPrice ให้ confirm ใช้)', async () => {
    const p = await assertCashReplacement(client() as never, INPUT, 'p-new');
    expect(p).toMatchObject({ id: 'p-new', costPrice: new Prisma.Decimal('10500.00') });
  });
  it.each([
    ['ไม่พบ/ถูกลบ', null, CASH_REPLACEMENT_MSG.NOT_FOUND],
    ['เครื่องเดิมของใบขายเอง', { ...NEW, id: 'p-old' }, CASH_REPLACEMENT_MSG.SAME_DEVICE],
    ['เครื่องใหม่ (PHONE_NEW)', { ...NEW, category: 'PHONE_NEW' }, CASH_REPLACEMENT_MSG.NOT_USED],
    ['ไม่ใช่ IN_STOCK', { ...NEW, status: 'SOLD_CASH' }, CASH_REPLACEMENT_MSG.NOT_IN_STOCK],
    ['คนละสาขากับเคส', { ...NEW, branchId: 'b-2' }, CASH_REPLACEMENT_MSG.WRONG_BRANCH],
    ['ความจุไม่ตรง', { ...NEW, storage: '256GB' }, CASH_REPLACEMENT_MSG.MODEL_MISMATCH],
  ])('%s → 400 %s', async (_label, product, msg) => {
    await expect(assertCashReplacement(client(product) as never, INPUT, product?.id === 'p-old' ? 'p-old' : 'p-new')).rejects.toThrow(
      new BadRequestException(msg),
    );
  });
  it('รั้วข้อมูลทดสอบ: ลูกค้าจริง + เครื่องทดสอบ (ชื่อขึ้นต้น TEST-) → โยนจาก assertSameTestSide', async () => {
    await expect(
      assertCashReplacement(client({ ...NEW, name: 'TEST-iPhone 13' }) as never, INPUT, 'p-new'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: รันให้แดง** — Run: `… -- src/modules/after-sales/__tests__/assert-cash-replacement.spec.ts` · Expected: FAIL (module not found)

- [ ] **Step 3: เขียน util**

`apps/api/src/modules/after-sales/utils/assert-cash-replacement.ts`:
```ts
import { BadRequestException } from '@nestjs/common';
import type { Prisma, ProductCategory, ProductStatus } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { assertSameTestSide, TEST_SIDE_CUSTOMER_SELECT } from '../../../utils/test-data-markers';

/**
 * PR 5 §3.3 — ด่านเครื่องทดแทนของเปลี่ยนรุ่นเดิม **ขายสด** (ไม่มีสัญญา จึงใช้ `DefectExchangeService.checkEligibility`
 * ไม่ได้). ฟังก์ชันเดียว เรียกสองจุด: ตอนแจ้งปัญหา (`AfterSalesCaseService.createCase`) และตอน ผจก. ยืนยัน
 * (`AfterSalesExchangeService.confirmCashSameModel` — ใน tx ด้วยข้อมูลสด). ไม่มีข้อไหนข้ามได้ (คำตัดสิน ⑥ ไม่มี override)
 */
export const CASH_REPLACEMENT_MSG = {
  NOT_FOUND: 'ไม่พบเครื่องทดแทนในระบบ',
  SAME_DEVICE: 'เครื่องทดแทนต้องไม่ใช่เครื่องเดิมของใบขาย',
  NOT_USED: 'เปลี่ยนรุ่นเดิมขายสดใช้ได้เฉพาะเครื่องมือสอง (PHONE_USED)',
  NOT_IN_STOCK: 'เครื่องทดแทนต้องอยู่ในสต๊อกพร้อมขาย (IN_STOCK)',
  WRONG_BRANCH: 'เครื่องทดแทนต้องอยู่สาขาเดียวกับเคส',
  MODEL_MISMATCH: 'เครื่องทดแทนต้องเป็นยี่ห้อ/รุ่น/ความจุเดียวกับเครื่องเดิม',
} as const;

export interface CashReplacementInput {
  sale: { id: string; productId: string; customerId: string };
  caseBranchId: string;
}

export interface CashReplacementProduct {
  id: string;
  brand: string;
  model: string;
  storage: string | null;
  imeiSerial: string | null;
  costPrice: Prisma.Decimal;
  category: ProductCategory;
  status: ProductStatus;
  branchId: string | null;
}

export async function assertCashReplacement(
  client: Prisma.TransactionClient | PrismaService,
  input: CashReplacementInput,
  replacementProductId: string,
): Promise<CashReplacementProduct> {
  if (replacementProductId === input.sale.productId) throw new BadRequestException(CASH_REPLACEMENT_MSG.SAME_DEVICE);
  const [old, next, customer] = await Promise.all([
    client.product.findUnique({ where: { id: input.sale.productId }, select: { id: true, brand: true, model: true, storage: true } }),
    // รั้วข้อมูลทดสอบต้องเห็น PO ต้นทาง (ชนิดของ TestSideProduct บังคับ) — รูปเดียวกับ DefectExchangeService
    client.product.findUnique({ where: { id: replacementProductId }, include: { po: { select: { poNumber: true } } } }),
    client.customer.findUniqueOrThrow({ where: { id: input.sale.customerId }, select: TEST_SIDE_CUSTOMER_SELECT }),
  ]);
  if (!old) throw new BadRequestException('ไม่พบเครื่องเดิมของใบขาย');
  if (!next || next.deletedAt) throw new BadRequestException(CASH_REPLACEMENT_MSG.NOT_FOUND);
  if (next.category !== 'PHONE_USED') throw new BadRequestException(CASH_REPLACEMENT_MSG.NOT_USED);
  if (next.status !== 'IN_STOCK') throw new BadRequestException(CASH_REPLACEMENT_MSG.NOT_IN_STOCK);
  if (next.branchId !== input.caseBranchId) throw new BadRequestException(CASH_REPLACEMENT_MSG.WRONG_BRANCH);
  if (next.brand !== old.brand || next.model !== old.model || (next.storage ?? null) !== (old.storage ?? null)) {
    throw new BadRequestException(CASH_REPLACEMENT_MSG.MODEL_MISMATCH);
  }
  assertSameTestSide(customer, next);
  return {
    id: next.id, brand: next.brand, model: next.model, storage: next.storage, imeiSerial: next.imeiSerial,
    costPrice: next.costPrice, category: next.category, status: next.status, branchId: next.branchId,
  };
}
```
(ถ้า `TEST_SIDE_CUSTOMER_SELECT` ไม่ได้ export จาก `test-data-markers.ts` ให้ใช้ `select: { name: true, phone: true, addressCurrent: true }` ตรง ๆ — ชนิด `TestSideCustomer` ต้องการสามฟิลด์นี้)

- [ ] **Step 4: รัน util ให้เขียว** — Expected: PASS 9/9

- [ ] **Step 5: เทส intake (แดงก่อน)** — ใน `case-create.spec.ts` เพิ่ม:
```ts
  describe('PR 5 — CASH_SAME_MODEL_EXCHANGE ตอนแจ้งปัญหา', () => {
    const cashLookup = () =>
      buildLookupResult({
        source: 'CASH_SALE', contract: null, sale: { id: 'sale-1', saleType: 'CASH' },
        product: { id: 'p-1', brand: 'Apple', model: 'iPhone 13', storage: '128GB', imeiSerial: BASE_DTO.imei, category: 'PHONE_USED' },
        warranty: { status: 'IN_7DAY_DEFECT', daysRemainingIn7Day: 4, purchasedAt: '2026-10-09T00:00:00.000Z', shopWarrantyEndDate: '2026-12-08T00:00:00.000Z', manufacturerWarrantyEndDate: null, checkedAt: '2026-10-12T00:00:00.000Z' },
        outcomes: [
          { outcome: 'REPAIR', enabled: true, implemented: true, payerDefault: 'SHOP' },
          { outcome: 'CASH_SAME_MODEL_EXCHANGE', enabled: true, implemented: true, note: 'ผจก.สาขา ต้องยืนยัน' },
        ],
      });
    const dto = { ...BASE_DTO, outcome: 'CASH_SAME_MODEL_EXCHANGE' as const, replacementProductId: 'p-new' };

    it('ไม่ส่ง replacementProductId → 400 ก่อนอัปโหลด/สร้างอะไร', async () => {
      lookupSvc.lookup.mockResolvedValue(cashLookup());
      await expect(svc.createCase({ ...dto, replacementProductId: undefined } as never, [mockFile()], USER)).rejects.toThrow(
        new BadRequestException('ต้องเลือกเครื่องทดแทนจากสต๊อก'),
      );
      expect(tx.afterSalesCase.create).not.toHaveBeenCalled();
    });

    it('ผ่านด่าน → สร้างเคส stage AWAITING_APPROVAL · outcome CASH · replacementProductId · event OUTCOME_SET ระบุเครื่องทดแทน · ไม่เรียก defect.checkEligibility', async () => {
      lookupSvc.lookup.mockResolvedValue(cashLookup());
      prisma.product.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'p-1'
          ? { id: 'p-1', brand: 'Apple', model: 'iPhone 13', storage: '128GB' }
          : { id: 'p-new', brand: 'Apple', model: 'iPhone 13', storage: '128GB', imeiSerial: REPLACEMENT_PRODUCT.imeiSerial, costPrice: 10500, category: 'PHONE_USED', status: 'IN_STOCK', branchId: 'b-1', deletedAt: null, name: 'iPhone 13', po: null }),
      );
      prisma.customer = { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'นาย ก', phone: '0800000000', addressCurrent: null }) };
      tx.afterSalesCase.create.mockResolvedValue({ id: 'as-c', caseNumber: 'AS-20261012-0001', repairTicketId: null });

      const result = await svc.createCase(dto as never, [mockFile()], USER);

      expect(result).toMatchObject({ outcome: 'CASH_SAME_MODEL_EXCHANGE', stage: 'AWAITING_APPROVAL', repairTicketId: null });
      expect(defect.checkEligibility).not.toHaveBeenCalled();
      const data = tx.afterSalesCase.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ outcome: 'CASH_SAME_MODEL_EXCHANGE', replacementProductId: 'p-new', stage: 'AWAITING_APPROVAL', saleId: 'sale-1', contractId: null });
      expect(data.events.create.map((e: { kind: string }) => e.kind)).toEqual(['RECEIVED', 'OUTCOME_SET']);
      expect(data.events.create[1].note).toContain(REPLACEMENT_PRODUCT.imeiSerial);
    });

    it('เครื่องทดแทนเป็น PHONE_NEW → 400 จาก assertCashReplacement และไม่สร้างเคส', async () => {
      lookupSvc.lookup.mockResolvedValue(cashLookup());
      prisma.product.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'p-1'
          ? { id: 'p-1', brand: 'Apple', model: 'iPhone 13', storage: '128GB' }
          : { id: 'p-new', brand: 'Apple', model: 'iPhone 13', storage: '128GB', imeiSerial: 'x', costPrice: 1, category: 'PHONE_NEW', status: 'IN_STOCK', branchId: 'b-1', deletedAt: null, name: 'iPhone 13', po: null }),
      );
      prisma.customer = { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'นาย ก', phone: null, addressCurrent: null }) };
      await expect(svc.createCase(dto as never, [mockFile()], USER)).rejects.toThrow(
        new BadRequestException('เปลี่ยนรุ่นเดิมขายสดใช้ได้เฉพาะเครื่องมือสอง (PHONE_USED)'),
      );
      expect(tx.afterSalesCase.create).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 6: รันให้แดง** — Run: `… -- src/modules/after-sales/__tests__/case-create.spec.ts` · Expected: FAIL (DTO/validation ไม่รู้จัก outcome → ได้ "ทางออกไม่ถูกต้อง" หรือ create ถูกเรียกโดยไม่มี OUTCOME_SET)

- [ ] **Step 7: แก้ DTO + intake**

`create-case.dto.ts`:
```ts
  @IsIn(['REPAIR', 'SAME_MODEL_EXCHANGE', 'PRICED_EXCHANGE', 'CASH_SAME_MODEL_EXCHANGE'], { message: 'ทางออกไม่ถูกต้อง' })
  outcome!: 'REPAIR' | 'SAME_MODEL_EXCHANGE' | 'PRICED_EXCHANGE' | 'CASH_SAME_MODEL_EXCHANGE'; // PR 2 + PR 5
```

`after-sales-case.service.ts` — import `assertCashReplacement` · หลัง `const isPriced = …`:
```ts
    // PR 5 — เปลี่ยนรุ่นเดิมขายสด: ไม่มีสัญญา ด่านเครื่องทดแทนเป็น assertCashReplacement (ตัวเดียวกับตอนยืนยัน)
    const isCashSameModel = dto.outcome === 'CASH_SAME_MODEL_EXCHANGE';
    if ((isSameModel || isPriced || isCashSameModel) && !dto.replacementProductId) {
      throw new BadRequestException('ต้องเลือกเครื่องทดแทนจากสต๊อก');
    }
    if ((isSameModel || isPriced) && !look.contract) {
      throw new BadRequestException('ทางออกนี้ใช้ได้กับสัญญาผ่อนเท่านั้น');
    }
    if (isCashSameModel && (!look.sale || look.contract || !look.product)) {
      throw new BadRequestException('ทางออกนี้ใช้ได้กับใบขายสด/ไฟแนนซ์นอกเท่านั้น');
    }
```
(ลบ `if ((isSameModel || isPriced) && !dto.replacementProductId) {…}` เดิม) · หลังบล็อก `if (isSameModel) {…}` เพิ่ม:
```ts
    if (isCashSameModel) {
      const p = await assertCashReplacement(
        this.prisma,
        { sale: { id: look.sale!.id, productId: look.product!.id, customerId }, caseBranchId: dto.branchId },
        dto.replacementProductId!,
      );
      replacementProduct = { brand: p.brand, model: p.model, storage: p.storage, imeiSerial: p.imeiSerial };
    }
```
ในกิ่งเปลี่ยนเครื่อง (~บรรทัด 346) `const exchangeEvents = isSameModel ? […] : […]` เปลี่ยนเงื่อนไขเป็น `isSameModel || isCashSameModel ? […] : […]` (note เดิม "เปลี่ยนรุ่นเดิม · รอ ผจก.สาขา ยืนยัน · เครื่องทดแทน …" ใช้ร่วมได้)

- [ ] **Step 8: รัน case-create + dto spec ให้เขียว**

Run: `npm --prefix /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api run test --silent -- src/modules/after-sales/__tests__/case-create.spec.ts src/modules/after-sales/__tests__/create-case-dto.spec.ts src/modules/after-sales/__tests__/case-create-real-validator.spec.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && git add apps/api/src/modules/after-sales && git commit -m "feat(after-sales): assertCashReplacement + intake รับทางออกเปลี่ยนรุ่นเดิมขายสด (PR5 T5)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `ShopCashExchangeTemplate` — รายการบัญชีสลับต้นทุน (ข้อ 10)

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/shop-cash-exchange.template.ts`
- Create: `apps/api/src/modules/journal/shop-templates/shop-cash-exchange.template.spec.ts`
- Modify: `apps/api/src/modules/journal/journal.module.ts` (import + providers ~124 + exports ~194)

**Interfaces:**
- Produces:
```ts
export interface ShopCashExchangeInput {
  afterSalesCaseId: string; caseNumber?: string; saleId: string; saleNumber?: string;
  oldProductId: string; newProductId: string;
  oldCost: Decimal; newCost: Decimal;
  oldAccounts: ShopProductAccounts; newAccounts: ShopProductAccounts; // จาก ShopAccountResolver.resolveProductAccounts(category)
  postedAt?: Date;
}
class ShopCashExchangeTemplate { execute(input, outerTx?): Promise<{ entryNo: string; journalEntryId: string } | null> }
```
metadata: `tag 'SHOP_CASH_EXCHANGE'` · `flow 'shop-cash-exchange'` · `idempotencyKey 'shop-cash-exchange:<caseId>'` · `saleId` · `afterSalesCaseId` · `oldProductId` · `newProductId` · `oldCost` · `newCost` · `companyCode 'SHOP'` · reference `sale:<saleId>:exchange:<caseId>` · **ไม่มี contractId**

- [ ] **Step 1: เทส golden (แดงก่อน)**

`apps/api/src/modules/journal/shop-templates/shop-cash-exchange.template.spec.ts`:
```ts
import { Prisma } from '@prisma/client';
import { ShopCashExchangeTemplate } from '../cpa-templates/shop-cash-exchange.template';
import { makeMockJournalAuto, makeMockPrisma, makeMockCompanyResolver, seedExistingJournalEntry } from './test-helpers';

const USED = { inventoryAccountCode: 'S11-2002', cogsAccountCode: 'S50-1102', revenueAccountCode: 'S41-1102' };
const base = {
  afterSalesCaseId: 'as-1', caseNumber: 'AS-20261012-0001', saleId: 'sale-1', saleNumber: 'SL-0001',
  oldProductId: 'p-old', newProductId: 'p-new', oldAccounts: USED, newAccounts: USED,
};

describe('ShopCashExchangeTemplate (PR 5 — คำตอบฝ่ายบัญชีข้อ 10)', () => {
  function build() {
    const journal = makeMockJournalAuto();
    const prisma = makeMockPrisma();
    const resolver = makeMockCompanyResolver();
    return { template: new ShopCashExchangeTemplate(journal.service, prisma.prisma, resolver), journal, prisma };
  }

  it('ตัวอย่างข้อ 10: ต้นทุนเดิม 10,700 / ใหม่ 10,500 → 4 บรรทัด สมดุล · ไม่แตะรายได้/เงินสด', async () => {
    const { template, journal } = build();
    const r = await template.execute({ ...base, oldCost: new Prisma.Decimal('10700.00'), newCost: new Prisma.Decimal('10500.00') });
    expect(r).toEqual({ entryNo: 'JE-je-1', journalEntryId: 'je-1' });
    const lines = journal.state.lastInput!.lines;
    expect(lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2)])).toEqual([
      ['S11-2002', '10700.00', '0.00'],
      ['S50-1102', '0.00', '10700.00'],
      ['S50-1102', '10500.00', '0.00'],
      ['S11-2002', '0.00', '10500.00'],
    ]);
    expect(lines.some((l) => l.accountCode.startsWith('S41') || l.accountCode.startsWith('S11-11') || l.accountCode.startsWith('S11-12'))).toBe(false);
    const input = (journal.service.createAndPost as jest.Mock).mock.calls[0][0];
    expect(input.reference).toBe('sale:sale-1:exchange:as-1');
    expect(input.metadata).toMatchObject({
      tag: 'SHOP_CASH_EXCHANGE', flow: 'shop-cash-exchange', idempotencyKey: 'shop-cash-exchange:as-1',
      saleId: 'sale-1', afterSalesCaseId: 'as-1', oldProductId: 'p-old', newProductId: 'p-new',
      oldCost: '10700.00', newCost: '10500.00', companyCode: 'SHOP',
    });
    expect(input.metadata).not.toHaveProperty('contractId');
    expect(input.companyId).toBe('shop-co-id');
  });

  it('ต้นทุนเดิม 0 (ไม่เคยลงตอนขาย) → ลงเฉพาะคู่ของเครื่องทดแทน (2 บรรทัด)', async () => {
    const { template, journal } = build();
    await template.execute({ ...base, oldCost: new Prisma.Decimal(0), newCost: new Prisma.Decimal('10500.00') });
    expect(journal.state.lastInput!.lines).toHaveLength(2);
  });

  it('ทั้งสองเป็น 0 → ไม่โพสต์ คืน null', async () => {
    const { template, journal } = build();
    const r = await template.execute({ ...base, oldCost: new Prisma.Decimal(0), newCost: new Prisma.Decimal(0) });
    expect(r).toBeNull();
    expect(journal.state.callCount).toBe(0);
  });

  it('ต้นทุนติดลบ → BadRequest ไม่โพสต์', async () => {
    const { template, journal } = build();
    await expect(template.execute({ ...base, oldCost: new Prisma.Decimal('-1'), newCost: new Prisma.Decimal(1) })).rejects.toThrow();
    expect(journal.state.callCount).toBe(0);
  });

  it('idempotent: มี JE flow+key เดิมแล้ว → คืนของเดิม ไม่โพสต์ซ้ำ', async () => {
    const { template, journal, prisma } = build();
    seedExistingJournalEntry(prisma.state, 'shop-cash-exchange', 'shop-cash-exchange:as-1', { id: 'je-old', entryNumber: 'JE-OLD' });
    const r = await template.execute({ ...base, oldCost: new Prisma.Decimal(1), newCost: new Prisma.Decimal(1) });
    expect(r).toEqual({ entryNo: 'JE-OLD', journalEntryId: 'je-old' });
    expect(journal.state.callCount).toBe(0);
  });
});
```
(ดูลายเซ็น `seedExistingJournalEntry` ใน `test-helpers.ts` — ถ้าเป็น `(state, flow, key, entry)` ตามนี้ใช้ได้เลย ไม่ใช่ให้ปรับอาร์กิวเมนต์ให้ตรง helper โดยคง assertion เดิม)

- [ ] **Step 2: รันให้แดง** — Run: `… -- src/modules/journal/shop-templates/shop-cash-exchange.template.spec.ts` · Expected: FAIL module not found

- [ ] **Step 3: เขียน template**

`apps/api/src/modules/journal/cpa-templates/shop-cash-exchange.template.ts`:
```ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';
import type { ShopProductAccounts } from '../shop-account-resolver.service';

/**
 * PR 5 หลังการขาย — เปลี่ยนรุ่นเดิมบนใบขายสด (คำตอบฝ่ายบัญชีฉบับรวม ข้อ 10 · 30/09/2569):
 * ราคาขาย/รายได้/เงินสดไม่แตะ · เครื่องเดิมกลับเข้าคลังที่ต้นทุนเดิมที่ลงตอนขาย · ต้นทุนขายของบิลนี้
 * เปลี่ยนเป็นของเครื่องทดแทน
 *
 *   Dr S11-200x [oldCost]  / Cr S50-110x [oldCost]      ← เครื่องเดิมกลับคลัง (รอเคลม)
 *   Dr S50-110x [newCost]  / Cr S11-200x [newCost]      ← ต้นทุนขายใหม่
 *
 * รหัสบัญชีมาจาก `ShopAccountResolver.resolveProductAccounts(category)` ของแต่ละเครื่อง (ผู้เรียกส่งมา) —
 * template ไม่ hardcode · คู่ที่ยอด 0 ไม่ลง · ทั้งสองคู่ 0 = ไม่มีรายการ (คืน null) · idempotent ต่อเคส
 * · metadata **ไม่ stamp contractId** (sweep ยกเลิกสัญญาต้องมองไม่เห็น) แต่ stamp `saleId` (sweep ยกเลิกใบขาย
 * มองเห็น — ด่าน G9 ปิดการยกเลิกก่อนถึง)
 */
export interface ShopCashExchangeInput {
  afterSalesCaseId: string;
  caseNumber?: string;
  saleId: string;
  saleNumber?: string;
  oldProductId: string;
  newProductId: string;
  oldCost: Decimal;
  newCost: Decimal;
  oldAccounts: ShopProductAccounts;
  newAccounts: ShopProductAccounts;
  postedAt?: Date;
}

export const SHOP_CASH_EXCHANGE_FLOW = 'shop-cash-exchange';

@Injectable()
export class ShopCashExchangeTemplate {
  private readonly logger = new Logger(ShopCashExchangeTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  async execute(
    input: ShopCashExchangeInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string } | null> {
    const zero = new Decimal(0);
    const oldCost = new Decimal(input.oldCost.toString());
    const newCost = new Decimal(input.newCost.toString());
    if (oldCost.lt(zero) || newCost.lt(zero)) {
      throw new BadRequestException('ShopCashExchange: ต้นทุนติดลบไม่ได้');
    }
    for (const code of [input.oldAccounts.inventoryAccountCode, input.oldAccounts.cogsAccountCode, input.newAccounts.inventoryAccountCode, input.newAccounts.cogsAccountCode]) {
      if (!code.startsWith('S')) throw new BadRequestException(`ShopCashExchange: ต้องเป็นบัญชีฝั่ง SHOP (S-prefix) — ${code}`);
    }

    const lines: JeLineInput[] = [];
    if (oldCost.gt(zero)) {
      lines.push({ accountCode: input.oldAccounts.inventoryAccountCode, dr: oldCost, cr: zero, description: 'รับคืนเครื่องเดิมเข้าคลัง (รอเคลม) — ต้นทุนเดิมที่ลงตอนขาย' });
      lines.push({ accountCode: input.oldAccounts.cogsAccountCode, dr: zero, cr: oldCost, description: 'กลับต้นทุนขายของเครื่องเดิม' });
    }
    if (newCost.gt(zero)) {
      lines.push({ accountCode: input.newAccounts.cogsAccountCode, dr: newCost, cr: zero, description: 'ต้นทุนขายของเครื่องทดแทน' });
      lines.push({ accountCode: input.newAccounts.inventoryAccountCode, dr: zero, cr: newCost, description: 'ตัดสต็อกเครื่องทดแทน' });
    }
    if (!lines.length) return null;

    const idempotencyKey = `${SHOP_CASH_EXCHANGE_FLOW}:${input.afterSalesCaseId}`;
    const run = async (tx: Prisma.TransactionClient) => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: SHOP_CASH_EXCHANGE_FLOW } as any },
            { metadata: { path: ['idempotencyKey'], equals: idempotencyKey } as any },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(`ShopCashExchangeTemplate idempotency — JE ${existing.entryNumber} already exists for ${idempotencyKey}`);
        return { entryNo: existing.entryNumber, journalEntryId: existing.id };
      }
      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: `เปลี่ยนรุ่นเดิมขายสด ${input.saleNumber ?? input.saleId} · เคส ${input.caseNumber ?? input.afterSalesCaseId} (SHOP)`,
          reference: `sale:${input.saleId}:exchange:${input.afterSalesCaseId}`,
          metadata: {
            tag: 'SHOP_CASH_EXCHANGE',
            flow: SHOP_CASH_EXCHANGE_FLOW,
            idempotencyKey,
            saleId: input.saleId,
            saleNumber: input.saleNumber ?? null,
            afterSalesCaseId: input.afterSalesCaseId,
            caseNumber: input.caseNumber ?? null,
            oldProductId: input.oldProductId,
            newProductId: input.newProductId,
            oldCost: oldCost.toFixed(2),
            newCost: newCost.toFixed(2),
            companyCode: 'SHOP',
          },
          postedAt: input.postedAt ?? new Date(),
          companyId: shopCompanyId,
          lines,
        },
        tx,
      );
      return { entryNo: result.entryNumber, journalEntryId: result.id };
    };
    return outerTx ? run(outerTx) : this.prisma.$transaction(run);
  }
}
```

`journal.module.ts`: `import { ShopCashExchangeTemplate } from './cpa-templates/shop-cash-exchange.template';` + เพิ่มใน `providers` (ติดกับ `ShopCashSaleTemplate`) และ `exports` (ติดกับ `ShopCashSaleTemplate`)

- [ ] **Step 4: รันให้เขียว** — Expected: PASS 5/5

- [ ] **Step 5: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && git add apps/api/src/modules/journal && git commit -m "feat(journal): ShopCashExchangeTemplate — สลับต้นทุนตามคำตอบบัญชีข้อ 10 (PR5 T6)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `markReplacedBySale` — ปิดใบซ่อมเป็น REPLACED โดยไม่มีสัญญาใหม่

**Files:**
- Modify: `apps/api/src/modules/repair-tickets/services/repair-ticket-lifecycle.service.ts` (ต่อจาก `markReplaced` ~626–690)
- Modify: `apps/api/src/modules/repair-tickets/repair-tickets.service.ts:116-123`
- Create: `apps/api/src/modules/repair-tickets/__tests__/mark-replaced-by-sale.spec.ts`

**Interfaces:**
- Produces: `RepairTicketsService.markReplacedBySale(id: string, ref: { caseNumber: string; saleNumber: string }, user: ReqUser, tx: Prisma.TransactionClient | PrismaService = this.prisma): Promise<{ fromStatus: RepairStatus }>` — **ไม่เรียก audit** (ผู้เรียกเขียน `REPAIR_TICKET_REPLACED_BY_SALE` หลัง commit)

- [ ] **Step 1: เทส (แดงก่อน)**

`apps/api/src/modules/repair-tickets/__tests__/mark-replaced-by-sale.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RepairTicketsService } from '../repair-tickets.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ExpenseDocumentsService } from '../../expense-documents/expense-documents.service';
import { OtherIncomeService } from '../../other-income/other-income.service';
import { SettingsService } from '../../settings/settings.service';
import { RepairTicketDocNumberService } from '../services/doc-number.service';

const USER = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'b-1' };
const REF = { caseNumber: 'AS-20261012-0001', saleNumber: 'SL-0001' };

describe('RepairTicketsService.markReplacedBySale (PR 5 — ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิมบนใบขายสด)', () => {
  let service: RepairTicketsService;
  let tx: any;
  let audit: any;

  beforeEach(async () => {
    tx = {
      repairTicket: {
        findUnique: jest.fn().mockResolvedValue({ status: 'IN_PROGRESS' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      repairStatusLog: { create: jest.fn().mockResolvedValue({}) },
    };
    audit = { log: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        RepairTicketsService,
        { provide: PrismaService, useValue: {} },
        { provide: AuditService, useValue: audit },
        { provide: ExpenseDocumentsService, useValue: {} },
        { provide: OtherIncomeService, useValue: {} },
        { provide: SettingsService, useValue: {} },
        { provide: RepairTicketDocNumberService, useValue: {} },
      ],
    }).compile();
    service = mod.get(RepairTicketsService);
  });

  it('CAS OPEN/IN_PROGRESS/READY_FOR_PICKUP → REPLACED + replacedAt · replacementContractId คง null · log note อ้างเคส/ใบขาย · ไม่ audit ใน tx', async () => {
    const r = await service.markReplacedBySale('rt-1', REF, USER, tx);
    expect(r).toEqual({ fromStatus: 'IN_PROGRESS' });
    expect(tx.repairTicket.updateMany).toHaveBeenCalledWith({
      where: { id: 'rt-1', status: { in: ['OPEN', 'IN_PROGRESS', 'READY_FOR_PICKUP'] }, deletedAt: null },
      data: { status: 'REPLACED', replacedAt: expect.any(Date) },
    });
    expect(tx.repairStatusLog.create).toHaveBeenCalledWith({
      data: { ticketId: 'rt-1', fromStatus: 'IN_PROGRESS', toStatus: 'REPLACED', changedById: 'u-bm', note: 'เปลี่ยนรุ่นเดิมบนใบขายสด SL-0001 · เคส AS-20261012-0001' },
    });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('ใบซ่อมปิดไปแล้ว (count 0) → 409 ไม่เขียน log', async () => {
    tx.repairTicket.findUnique.mockResolvedValue({ status: 'CLOSED' });
    tx.repairTicket.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.markReplacedBySale('rt-1', REF, USER, tx)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.repairStatusLog.create).not.toHaveBeenCalled();
  });

  it('ไม่พบใบซ่อม → 404', async () => {
    tx.repairTicket.findUnique.mockResolvedValue(null);
    await expect(service.markReplacedBySale('rt-x', REF, USER, tx)).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: รันให้แดง** — Run: `… -- src/modules/repair-tickets/__tests__/mark-replaced-by-sale.spec.ts` · Expected: FAIL (`markReplacedBySale is not a function`)

- [ ] **Step 3: เขียนเมธอด**

`repair-ticket-lifecycle.service.ts` ต่อท้าย `markReplaced` (ภายใน class):
```ts
  /**
   * PR 5 — ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิมบน **ใบขายสด** (ไม่มีสัญญาใหม่ให้ใส่ `replacementContractId` ซึ่งเป็น FK
   * @unique ไป Contract — `markReplaced` จึงใช้ไม่ได้). CAS เดียวกัน · `replacementContractId` คง null ·
   * **ไม่เรียก audit** — ผู้เรียก (`AfterSalesExchangeService.confirmCashSameModel`) เขียน
   * `REPAIR_TICKET_REPLACED_BY_SALE` หลัง tx commit (database.md: ห้าม audit.log ใน $transaction)
   */
  async markReplacedBySale(
    id: string,
    ref: { caseNumber: string; saleNumber: string },
    user: ReqUser,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<{ fromStatus: RepairStatus }> {
    const before = await tx.repairTicket.findUnique({ where: { id, deletedAt: null }, select: { status: true } });
    if (!before) throw new NotFoundException('ไม่พบ ticket');
    const updated = await tx.repairTicket.updateMany({
      where: { id, status: { in: ['OPEN', 'IN_PROGRESS', 'READY_FOR_PICKUP'] }, deletedAt: null },
      data: { status: 'REPLACED', replacedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new ConflictException('สถานะถูกเปลี่ยนไปแล้ว — replace ทำได้เฉพาะ OPEN/IN_PROGRESS/READY_FOR_PICKUP');
    }
    await tx.repairStatusLog.create({
      data: {
        ticketId: id,
        fromStatus: before.status,
        toStatus: 'REPLACED',
        changedById: user.id,
        note: `เปลี่ยนรุ่นเดิมบนใบขายสด ${ref.saleNumber} · เคส ${ref.caseNumber}`,
      },
    });
    return { fromStatus: before.status };
  }
```
(import `RepairStatus` type จาก `@prisma/client` ถ้ายังไม่มี)

`repair-tickets.service.ts` ต่อจาก `markReplaced`:
```ts
  /** PR 5 — ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิมบนใบขายสด (ไม่มีสัญญาใหม่) — ไม่เขียน audit ผู้เรียกเขียนหลัง commit */
  async markReplacedBySale(
    id: string,
    ref: { caseNumber: string; saleNumber: string },
    user: ReqUser,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return this.lifecycle.markReplacedBySale(id, ref, user, tx);
  }
```

- [ ] **Step 4: รันให้เขียว + spec เดิมของ repair-tickets** — Run: `… -- src/modules/repair-tickets` · Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && git add apps/api/src/modules/repair-tickets && git commit -m "feat(repair-tickets): markReplacedBySale — ปิดใบซ่อมเป็น REPLACED โดยไม่มีสัญญาใหม่ (PR5 T7)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `shopWarrantyDatesFor` — วันประกันร้านของใบขาย ใช้ร่วม POS + ส่งมอบ

**Files:**
- Create: `apps/api/src/modules/sales/services/sale-shop-warranty.util.ts`
- Create: `apps/api/src/modules/sales/services/sale-shop-warranty.util.spec.ts`
- Modify: `apps/api/src/modules/sales/services/sale-writer.service.ts:131-141`

**Interfaces:**
- Produces: `shopWarrantyDatesFor(tx: SystemConfigReader, product: { category: string; shopWarrantyDays?: number | null; deviceOrigin?; warrantyTerms?; partsHistory?; partsHistoryNote? }, soldAt: Date): Promise<{ days: number | null; shopWarrantyStartDate: Date; shopWarrantyEndDate: Date | null; productDisclosure }>` — `shopWarrantyStartDate` ตั้ง**เสมอ** (ฐานกรอบ 7 วัน) · `shopWarrantyEndDate` null เมื่อไม่มีนโยบาย

- [ ] **Step 1: เทส (แดงก่อน)**

`apps/api/src/modules/sales/services/sale-shop-warranty.util.spec.ts`:
```ts
import { shopWarrantyDatesFor } from './sale-shop-warranty.util';

const tx = (configValue: string | null) =>
  ({
    systemConfig: {
      findUnique: jest.fn().mockResolvedValue(configValue === null ? null : { value: configValue }),
      findFirst: jest.fn().mockResolvedValue(configValue === null ? null : { value: configValue }),
    },
  }) as never;
const soldAt = new Date('2026-10-12T05:00:00.000Z');

describe('shopWarrantyDatesFor (PR 5 T8 — ตัวเดียวสำหรับ POS และส่งมอบเครื่องทดแทน)', () => {
  it('มือสองไม่มีค่าเฉพาะเครื่อง + ไม่มี config → 60 วัน · start = soldAt', async () => {
    const r = await shopWarrantyDatesFor(tx(null), { category: 'PHONE_USED', shopWarrantyDays: null }, soldAt);
    expect(r.days).toBe(60);
    expect(r.shopWarrantyStartDate).toEqual(soldAt);
    expect(r.shopWarrantyEndDate).toEqual(new Date('2026-12-11T05:00:00.000Z'));
  });
  it('เครื่องใหม่ (ไม่มีนโยบายประกันร้าน) → days null · end null · **start ยังตั้ง** (ฐานกรอบ 7 วัน)', async () => {
    const r = await shopWarrantyDatesFor(tx(null), { category: 'PHONE_NEW', shopWarrantyDays: null }, soldAt);
    expect(r.days).toBeNull();
    expect(r.shopWarrantyEndDate).toBeNull();
    expect(r.shopWarrantyStartDate).toEqual(soldAt);
  });
  it('ค่าเฉพาะเครื่อง 0 = ไม่มีประกัน → end null', async () => {
    const r = await shopWarrantyDatesFor(tx('90'), { category: 'PHONE_USED', shopWarrantyDays: 0 }, soldAt);
    expect(r.days).toBeNull();
    expect(r.shopWarrantyEndDate).toBeNull();
  });
});
```

- [ ] **Step 2: รันให้แดง** — Run: `… -- src/modules/sales/services/sale-shop-warranty.util.spec.ts` · Expected: FAIL module not found

- [ ] **Step 3: เขียน util + ให้ sale-writer ใช้**

`apps/api/src/modules/sales/services/sale-shop-warranty.util.ts`:
```ts
import { addDays } from 'date-fns';
import { captureProductDisclosure } from '../../../utils/product-disclosure.util';
import { readStringFlag, type SystemConfigReader } from '../../../utils/config.util';
import { resolveShopWarrantyDays, SHOP_WARRANTY_DAYS_CONFIG_KEY } from '../../warranty/shop-warranty-policy';

type DisclosureProduct = Parameters<typeof captureProductDisclosure>[0] & { shopWarrantyDays?: number | null };

/**
 * วันประกันร้านของ "เครื่องหลัก" บนใบขาย — ตัวเดียวสำหรับ POS (`SaleWriterService`) และส่งมอบเครื่องทดแทน
 * (PR 5 `AfterSalesExchangeService.deliverCash`). `shopWarrantyStartDate` ตั้งเสมอ เพราะเป็นฐานกรอบ
 * 7 วันของใบขายสด (`saleSoldAt`) แม้เครื่องไม่มีนโยบายประกันร้าน (เช่นเครื่องใหม่ หรือค่าเฉพาะเครื่อง = 0)
 */
export async function shopWarrantyDatesFor(tx: SystemConfigReader, product: DisclosureProduct, soldAt: Date) {
  const defaultDays = await readStringFlag(tx, SHOP_WARRANTY_DAYS_CONFIG_KEY, '');
  const days = resolveShopWarrantyDays(product, defaultDays);
  const productDisclosure = captureProductDisclosure(product, defaultDays);
  return {
    days,
    shopWarrantyStartDate: soldAt,
    shopWarrantyEndDate: days === null ? null : addDays(soldAt, days),
    productDisclosure,
  };
}
```
(ถ้า `SystemConfigReader` ไม่ได้ export จาก `config.util.ts` ให้ export เพิ่ม — เป็น type ที่มีอยู่แล้วในไฟล์นั้น)

`sale-writer.service.ts` — แทนที่ body ของ `resolveSaleShopWarranty` ให้คงรูปผลลัพธ์เดิมทุกไบต์:
```ts
  private async resolveSaleShopWarranty(tx, product, soldAt) {
    const w = await shopWarrantyDatesFor(tx, product, soldAt);
    if (w.days === null) return { productDisclosure: w.productDisclosure };
    return { productDisclosure: w.productDisclosure, shopWarrantyStartDate: w.shopWarrantyStartDate, shopWarrantyEndDate: w.shopWarrantyEndDate! };
  }
```
(คง signature/ชนิดพารามิเตอร์เดิมไว้ · ลบ import `addDays`/`readStringFlag`/`resolveShopWarrantyDays`/`captureProductDisclosure` ที่ไม่ถูกใช้แล้วถ้า lint ฟ้อง — ตรวจด้วย type-check ไม่ใช่ `run lint`)

- [ ] **Step 4: รัน util + sale-writer spec** — Run: `… -- src/modules/sales/services/sale-shop-warranty.util.spec.ts src/modules/sales/services/sale-writer.service.spec.ts` · Expected: PASS (พฤติกรรม POS เท่าเดิม)

- [ ] **Step 5: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && git add apps/api/src/modules/sales apps/api/src/utils && git commit -m "refactor(sales): shopWarrantyDatesFor — วันประกันร้านของใบขาย ใช้ร่วม POS/ส่งมอบ (PR5 T8)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: ยืนยัน + ส่งมอบของเคสขายสด (`AfterSalesExchangeService`) + DTO/controller/facade/module

**Files:**
- Create: `apps/api/src/modules/after-sales/dto/exchange-deliver.dto.ts`
- Create: `apps/api/src/modules/after-sales/utils/cash-exchange-window.ts`
- Modify: `apps/api/src/modules/after-sales/services/after-sales-exchange.service.ts` (imports · `SAME_MODEL_PENDING_CAS` ~43 · constructor ~79 · `confirmSameModel` ~155 · `deliver` ~281 · `rejectSameModel` ~335 · `switchToRepair` ~378 · เมธอดใหม่)
- Modify: `apps/api/src/modules/after-sales/after-sales.service.ts:104` (`deliver`)
- Modify: `apps/api/src/modules/after-sales/after-sales.controller.ts:132-135`
- Modify: `apps/api/src/modules/after-sales/after-sales.module.ts` (import `JournalModule`)
- Test: `__tests__/exchange-service.spec.ts` (constructor + describe ใหม่) · `__tests__/after-sales-exchange.integration.spec.ts:197-207` (wiring) · `__tests__/cash-exchange-window.spec.ts`

**Interfaces:**
- Consumes: Task 1 `mainProductStatusFor` · Task 2 `saleSoldAt` · Task 4 marker · Task 5 `assertCashReplacement` · Task 6 `ShopCashExchangeTemplate` · Task 7 `markReplacedBySale` · Task 8 `shopWarrantyDatesFor`
- Produces:
```ts
class ExchangeDeliverDto { accessories?: { box?: boolean; charger?: boolean; case?: boolean; other?: string }; note?: string }
export function cashExchangeWindowOpen(soldAt: Date, now?: Date): boolean   // BKK day diff 0..6
export function deliveredAccessoriesText(a?: ExchangeDeliverDto['accessories']): string | null
AfterSalesExchangeService.confirmSameModel(caseId, dto, user)  // กิ่งขายสด: คืน { id, stage: 'READY_FOR_PICKUP', replacementSaleId, saleNumber, journalEntryNo }
AfterSalesExchangeService.deliver(caseId, user, dto?: ExchangeDeliverDto)
AfterSalesExchangeService.cashExchangePreview(caseId, replacementProductId: string | undefined, user)  // MGR เท่านั้น (ตัดฝั่ง server — ต้นทุนเห็นเฉพาะ role ที่ canSeeCost; MGR ทั้งสองเห็น) → { saleNumber, oldCost, newCost, replacementProductId, lines: { accountCode, dr, cr }[] }
GET /after-sales/:id/exchange/cash-preview?replacementProductId=   @Roles(MGR)
constructor(..., line, cashExchange: ShopCashExchangeTemplate, shopAccounts: ShopAccountResolver, companyResolver: CompanyResolverService)
Audit actions: 'AFTER_SALES_CASH_EXCHANGE_CONFIRMED' · 'AFTER_SALES_CASH_EXCHANGE_DELIVERED' · 'REPAIR_TICKET_REPLACED_BY_SALE'
Event notes: APPROVED "ยืนยันเปลี่ยนเครื่อง · ใบขาย <no> · เครื่องทดแทน IMEI <imei>[ · จากใบซ่อม (ซ่อมไม่ได้)]" · DELIVERED "ส่งมอบเครื่องทดแทน · ใบขาย <no>[ · อุปกรณ์: …][ · <note>]"
```

- [ ] **Step 1: เทส window util (แดงก่อน)**

`apps/api/src/modules/after-sales/__tests__/cash-exchange-window.spec.ts`:
```ts
import { cashExchangeWindowOpen } from '../utils/cash-exchange-window';

const bkkMidnight = (d: Date) => {
  const s = new Date(d.getTime() + 7 * 3600_000);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - 7 * 3600_000);
};
const now = new Date('2026-10-12T10:00:00.000Z');
const daysAgo = (n: number) => new Date(bkkMidnight(now).getTime() - n * 86_400_000 + 3_600_000);

describe('cashExchangeWindowOpen — วัน 0–6 เปิด · วันที่ 7 ปิด (สูตรเดียวกับ daysRemainingIn7Day > 0)', () => {
  it.each([[0, true], [3, true], [6, true], [7, false], [8, false]])('ขายเมื่อ %i วันก่อน → %s', (n, open) => {
    expect(cashExchangeWindowOpen(daysAgo(n), now)).toBe(open);
  });
});
```

- [ ] **Step 2: รันให้แดง** — Run: `… -- src/modules/after-sales/__tests__/cash-exchange-window.spec.ts` · Expected: FAIL module not found

- [ ] **Step 3: เขียน util + DTO**

`apps/api/src/modules/after-sales/utils/cash-exchange-window.ts`:
```ts
function toBkkCalendarDay(d: Date): number {
  const bkk = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate());
}

/**
 * PR 5 §3.4 — "ยังอยู่ในกรอบ" ตอนยืนยัน = วันขายถึงวันนี้ต่างกัน 0–6 วันปฏิทินไทย (= `daysRemainingIn7Day > 0`
 * ของ RepairWarrantyService — วันที่ 7 ป้ายยังขึ้น IN_7DAY_DEFECT แต่ปุ่มปิด; ขายสดไม่มี override)
 */
export function cashExchangeWindowOpen(soldAt: Date, now: Date = new Date()): boolean {
  const diff = (toBkkCalendarDay(now) - toBkkCalendarDay(soldAt)) / 86_400_000;
  return diff >= 0 && diff <= 6;
}
```

`apps/api/src/modules/after-sales/dto/exchange-deliver.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

class DeliveredAccessoriesDto {
  @IsOptional() @IsBoolean() box?: boolean;
  @IsOptional() @IsBoolean() charger?: boolean;
  @IsOptional() @IsBoolean() case?: boolean;
  @IsOptional() @IsString() @MaxLength(60) other?: string;
}

/** PR 5 — ส่งมอบเครื่องทดแทนของเคสขายสด: อุปกรณ์ที่ส่งมอบ (พิมพ์บนใบส่งมอบ) + หมายเหตุ · เคสสัญญาผ่อนไม่ใช้ */
export class ExchangeDeliverDto {
  @IsOptional() @ValidateNested() @Type(() => DeliveredAccessoriesDto)
  accessories?: DeliveredAccessoriesDto;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

export function deliveredAccessoriesText(a?: DeliveredAccessoriesDto | null): string | null {
  if (!a) return null;
  const parts = [a.box && 'กล่อง', a.charger && 'สายชาร์จ', a.case && 'เคส', a.other?.trim() && `อื่น ๆ — ${a.other.trim()}`].filter(Boolean) as string[];
  return parts.length ? parts.join(', ') : null;
}
```

- [ ] **Step 4: รัน window spec ให้เขียว** — Expected: PASS 5/5

- [ ] **Step 5: เทส exchange service (แดงก่อน)** — ใน `exchange-service.spec.ts`:

(ก) ขยาย `beforeEach`: `prisma.sale = { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({ saleNumber: 'SL-0001' }) }; prisma.product = { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) }; prisma.customer = { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'cust-1', name: 'ก', phone: null, addressCurrent: null }) }; prisma.systemConfig = { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null) }; prisma.$transaction = jest.fn().mockImplementation((cb: any) => cb(prisma));` · เพิ่ม `repair.markReplacedBySale = jest.fn().mockResolvedValue({ fromStatus: 'IN_PROGRESS' })` · deps ใหม่:
```ts
    cashExchange = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-CX-1', journalEntryId: 'je-cx-1' }) };
    shopAccounts = { resolveProductAccounts: jest.fn().mockReturnValue({ inventoryAccountCode: 'S11-2002', cogsAccountCode: 'S50-1102', revenueAccountCode: 'S41-1102' }) };
    companyResolver = { getShopCompanyId: jest.fn().mockResolvedValue('shop-co') };
    svc = new AfterSalesExchangeService(prisma, query, defect, repair, audit, contractExchange, exchangeCancel, lookup, line, cashExchange, shopAccounts, companyResolver);
```
บนสุดของไฟล์: `jest.mock('../../../utils/period-lock.util', () => ({ validatePeriodOpen: jest.fn().mockResolvedValue(undefined) }));` และ `jest.mock('../../../utils/reservation-preempt.util', () => ({ preemptReservationsInTx: jest.fn().mockResolvedValue(0) }));`

(ข) describe ใหม่:
```ts
  describe('confirmSameModel — กิ่งขายสด (PR 5)', () => {
    const SOLD_3_DAYS_AGO = new Date(Date.now() - 3 * 86_400_000);
    const SALE = {
      id: 'sale-1', saleNumber: 'SL-0001', saleType: 'CASH', productId: 'prod-old', customerId: 'cust-1', deletedAt: null,
      exchangeCaseId: null, shopWarrantyStartDate: SOLD_3_DAYS_AGO, createdAt: SOLD_3_DAYS_AGO,
      costSnapshot: { mainProductCost: { toString: () => '10700.00' } },
    };
    const NEW_PRODUCT = {
      id: 'prod-new', brand: 'Apple', model: 'iPhone 13', storage: '128GB', imeiSerial: '359000000000002', costPrice: { toString: () => '10500.00' },
      category: 'PHONE_USED', status: 'IN_STOCK', branchId: 'branch-1', deletedAt: null, name: 'iPhone 13', po: null,
    };
    const cashCase = (over: Record<string, unknown> = {}) =>
      buildCase({ contractId: null, saleId: 'sale-1', source: 'CASH_SALE', outcome: 'CASH_SAME_MODEL_EXCHANGE', replacementSaleId: null, ...over });

    beforeEach(() => {
      prisma.sale.findUnique.mockResolvedValue(SALE);
      prisma.product.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'prod-old' ? { id: 'prod-old', brand: 'Apple', model: 'iPhone 13', storage: '128GB', category: 'PHONE_USED' } : NEW_PRODUCT),
      );
    });

    it('ผ่านทุกด่าน → CAS จอง · flip เครื่องเดิม→DEFECT_RETURN / ทดแทน IN_STOCK→SOLD_CASH · JE ต้นทุน 10,700/10,500 · sale.productId สลับ + exchangeCaseId + snapshot ใหม่ · เคส READY + replacementSaleId · audit หลัง tx · LINE READY', async () => {
      query.getCase.mockResolvedValue(cashCase());
      const r = await svc.confirmSameModel('as-1', { note: 'ok' } as never, MGR);
      expect(r).toEqual({ id: 'as-1', stage: 'READY_FOR_PICKUP', replacementSaleId: 'sale-1', saleNumber: 'SL-0001', journalEntryNo: 'JE-CX-1' });
      expect(defect.execute).not.toHaveBeenCalled();
      expect(prisma.afterSalesCase.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'as-1', stage: { in: ['AWAITING_APPROVAL'] }, replacementSaleId: null, approvedAt: null });
      expect(prisma.product.updateMany).toHaveBeenNthCalledWith(1, { where: { id: 'prod-old', status: 'SOLD_CASH', deletedAt: null }, data: { status: 'DEFECT_RETURN' } });
      expect(prisma.product.updateMany).toHaveBeenNthCalledWith(2, { where: { id: 'prod-new', status: 'IN_STOCK', deletedAt: null }, data: { status: 'SOLD_CASH' } });
      expect(cashExchange.execute).toHaveBeenCalledWith(
        expect.objectContaining({ afterSalesCaseId: 'as-1', saleId: 'sale-1', oldProductId: 'prod-old', newProductId: 'prod-new' }),
        prisma,
      );
      const cx = cashExchange.execute.mock.calls[0][0];
      expect(cx.oldCost.toString()).toBe('10700.00');
      expect(cx.newCost.toString()).toBe('10500.00');
      expect(prisma.sale.update).toHaveBeenCalledWith({
        where: { id: 'sale-1' },
        data: { productId: 'prod-new', exchangeCaseId: 'as-1', costSnapshot: { upsert: { create: { mainProductCost: expect.anything() }, update: { mainProductCost: expect.anything() } } } },
        select: { saleNumber: true },
      });
      expect(prisma.afterSalesCase.update).toHaveBeenCalledWith({
        where: { id: 'as-1' },
        data: expect.objectContaining({ outcome: 'CASH_SAME_MODEL_EXCHANGE', replacementProductId: 'prod-new', replacementSaleId: 'sale-1', stage: 'READY_FOR_PICKUP', events: { create: expect.objectContaining({ kind: 'APPROVED', note: 'ยืนยันเปลี่ยนเครื่อง · ใบขาย SL-0001 · เครื่องทดแทน IMEI 359000000000002' }) } }),
      });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'AFTER_SALES_CASH_EXCHANGE_CONFIRMED', entityId: 'as-1', newValue: expect.objectContaining({ oldCost: '10700.00', newCost: '10500.00', journalEntryNo: 'JE-CX-1' }) }));
      expect(prisma.afterSalesCase.update.mock.invocationCallOrder[0]).toBeLessThan(audit.log.mock.invocationCallOrder[0]);
      expect(line.notifyMoment).toHaveBeenCalledWith('as-1', 'READY', MGR.id);
    });

    it('SALES กด → 403 ก่อนอ่านอะไร', async () => {
      await expect(svc.confirmSameModel('as-1', {} as never, SALES)).rejects.toBeInstanceOf(ForbiddenException);
      expect(query.getCase).not.toHaveBeenCalled();
    });

    it('CAS แพ้ (count 0) → 409 ไม่เปิด tx', async () => {
      query.getCase.mockResolvedValue(cashCase());
      prisma.afterSalesCase.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(svc.confirmSameModel('as-1', {} as never, MGR)).rejects.toThrow(new ConflictException('เคสนี้ถูกดำเนินการไปแล้ว'));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('ไม่มี SaleCostSnapshot → 400 "ไม่พบต้นทุนที่ลงบัญชีตอนขาย" และปล่อยการจองคืน', async () => {
      query.getCase.mockResolvedValue(cashCase());
      prisma.sale.findUnique.mockResolvedValue({ ...SALE, costSnapshot: null });
      await expect(svc.confirmSameModel('as-1', {} as never, MGR)).rejects.toThrow(new BadRequestException('ไม่พบต้นทุนที่ลงบัญชีตอนขาย — ให้ฝ่ายบัญชีตรวจก่อน'));
      expect(cashExchange.execute).not.toHaveBeenCalled();
      expect(prisma.afterSalesCase.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { approvedAt: null, approvedById: null } }));
    });

    it('เครื่องทดแทนถูกขายไปแล้ว (updateMany count 0) → 409 "เครื่องทดแทนถูกขาย/จองไปแล้ว" ไม่ลง JE', async () => {
      query.getCase.mockResolvedValue(cashCase());
      prisma.product.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
      await expect(svc.confirmSameModel('as-1', {} as never, MGR)).rejects.toThrow(new ConflictException('เครื่องทดแทนถูกขาย/จองไปแล้ว'));
      expect(cashExchange.execute).not.toHaveBeenCalled();
    });

    it('fromRepair นอกกรอบ (ขาย 9 วันก่อน) → 400 "เกินกรอบ 7 วันแล้ว — ซ่อมเท่านั้น" แม้เป็น OWNER', async () => {
      const soldAt = new Date(Date.now() - 9 * 86_400_000);
      prisma.sale.findUnique.mockResolvedValue({ ...SALE, shopWarrantyStartDate: soldAt, createdAt: soldAt });
      query.getCase.mockResolvedValue(cashCase({ outcome: 'REPAIR', stage: 'IN_REPAIR', replacementProductId: null, repairTicketId: 'rt-1', repairTicket: { id: 'rt-1', status: 'IN_PROGRESS' } }));
      await expect(svc.confirmSameModel('as-1', { replacementProductId: 'prod-new' } as never, OWNER)).rejects.toThrow(new BadRequestException('เกินกรอบ 7 วันแล้ว — ซ่อมเท่านั้น'));
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
    });

    it('fromRepair ในกรอบ → markReplacedBySale ใน tx + audit REPAIR_TICKET_REPLACED_BY_SALE หลัง commit + note "จากใบซ่อม"', async () => {
      query.getCase.mockResolvedValue(cashCase({ outcome: 'REPAIR', stage: 'IN_REPAIR', replacementProductId: null, repairTicketId: 'rt-1', repairTicket: { id: 'rt-1', status: 'IN_PROGRESS' } }));
      await svc.confirmSameModel('as-1', { replacementProductId: 'prod-new' } as never, MGR);
      expect(repair.markReplacedBySale).toHaveBeenCalledWith('rt-1', { caseNumber: expect.any(String), saleNumber: 'SL-0001' }, MGR, prisma);
      expect(prisma.afterSalesCase.update.mock.calls[0][0].data.events.create.note).toContain('จากใบซ่อม (ซ่อมไม่ได้)');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'REPAIR_TICKET_REPLACED_BY_SALE', entityId: 'rt-1' }));
    });

    it('ไฟแนนซ์นอก → ด่าน/flip ใช้ SOLD_INSTALLMENT · JE ยังลง', async () => {
      prisma.sale.findUnique.mockResolvedValue({ ...SALE, saleType: 'EXTERNAL_FINANCE' });
      query.getCase.mockResolvedValue(cashCase());
      await svc.confirmSameModel('as-1', {} as never, MGR);
      expect(prisma.product.updateMany).toHaveBeenNthCalledWith(1, { where: { id: 'prod-old', status: 'SOLD_INSTALLMENT', deletedAt: null }, data: { status: 'DEFECT_RETURN' } });
      expect(prisma.product.updateMany).toHaveBeenNthCalledWith(2, { where: { id: 'prod-new', status: 'IN_STOCK', deletedAt: null }, data: { status: 'SOLD_INSTALLMENT' } });
      expect(cashExchange.execute).toHaveBeenCalled();
    });

    it('cashExchangePreview (MGR) → ต้นทุนเดิม/ใหม่ + 4 บรรทัดที่จะลง · SALES → 403', async () => {
      query.getCase.mockResolvedValue(cashCase());
      const r = await svc.cashExchangePreview('as-1', undefined, MGR);
      expect(r).toEqual({
        saleNumber: 'SL-0001', oldCost: '10700.00', newCost: '10500.00', replacementProductId: 'prod-new',
        lines: [
          { accountCode: 'S11-2002', dr: '10700.00', cr: '0.00' },
          { accountCode: 'S50-1102', dr: '0.00', cr: '10700.00' },
          { accountCode: 'S50-1102', dr: '10500.00', cr: '0.00' },
          { accountCode: 'S11-2002', dr: '0.00', cr: '10500.00' },
        ],
      });
      await expect(svc.cashExchangePreview('as-1', undefined, SALES)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('deliver — กิ่งขายสด (PR 5)', () => {
    const cashReady = () =>
      buildCase({ contractId: null, saleId: 'sale-1', source: 'CASH_SALE', outcome: 'CASH_SAME_MODEL_EXCHANGE', stage: 'READY_FOR_PICKUP', replacementSaleId: 'sale-1', replacementProductId: 'prod-new', caseNumber: 'AS-1' });

    it('มือสอง → ตั้ง start = now · end = +60 วัน · ปิดเคส DELIVERED(อุปกรณ์)+CLOSED · audit · LINE CLOSED · ไม่แตะสัญญา', async () => {
      query.getCase.mockResolvedValue(cashReady());
      prisma.product.findUniqueOrThrow.mockResolvedValue({ category: 'PHONE_USED', shopWarrantyDays: null, deviceOrigin: null, warrantyTerms: null });
      prisma.afterSalesCase.update.mockResolvedValue({ id: 'as-1', stage: 'CLOSED' });
      const r = await svc.deliver('as-1', STAFF, { accessories: { box: true, charger: true } } as never);
      expect(r).toEqual({ id: 'as-1', stage: 'CLOSED' });
      const saleData = prisma.sale.update.mock.calls[0][0].data;
      expect(saleData.shopWarrantyStartDate).toBeInstanceOf(Date);
      expect(Math.round((saleData.shopWarrantyEndDate.getTime() - saleData.shopWarrantyStartDate.getTime()) / 86_400_000)).toBe(60);
      expect(prisma.afterSalesCase.update).toHaveBeenCalledWith({
        where: { id: 'as-1' },
        data: expect.objectContaining({ stage: 'CLOSED', closedAt: expect.any(Date), events: { create: [expect.objectContaining({ kind: 'DELIVERED', note: 'ส่งมอบเครื่องทดแทน · ใบขาย SL-0001 · อุปกรณ์: กล่อง, สายชาร์จ' }), expect.objectContaining({ kind: 'CLOSED' })] } }),
      });
      expect(prisma.contract.findUnique).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'AFTER_SALES_CASH_EXCHANGE_DELIVERED' }));
      expect(line.notifyMoment).toHaveBeenCalledWith('as-1', 'CLOSED', STAFF.id);
    });

    it('เครื่องไม่มีนโยบายประกัน (days null) → start ตั้ง · end null · ไม่ล้ม', async () => {
      query.getCase.mockResolvedValue(cashReady());
      prisma.product.findUniqueOrThrow.mockResolvedValue({ category: 'PHONE_USED', shopWarrantyDays: 0, deviceOrigin: null, warrantyTerms: null });
      await svc.deliver('as-1', STAFF, {} as never);
      const saleData = prisma.sale.update.mock.calls[0][0].data;
      expect(saleData.shopWarrantyStartDate).toBeInstanceOf(Date);
      expect(saleData.shopWarrantyEndDate).toBeNull();
    });

    it('ยังไม่ยืนยัน (ไม่มี replacementSaleId) → 400', async () => {
      query.getCase.mockResolvedValue(buildCase({ contractId: null, saleId: 'sale-1', outcome: 'CASH_SAME_MODEL_EXCHANGE', stage: 'AWAITING_APPROVAL', replacementSaleId: null }));
      await expect(svc.deliver('as-1', STAFF, {} as never)).rejects.toThrow(new BadRequestException('เคสนี้ยังไม่ได้ยืนยันเปลี่ยนเครื่อง'));
    });
  });
```
`buildCase` เพิ่ม `source: 'INSTALLMENT_CONTRACT', saleId: null, replacementSaleId: null, caseNumber: 'AS-20261012-0001'` เป็นค่าเริ่มต้น

- [ ] **Step 6: รันให้แดง** — Run: `… -- src/modules/after-sales/__tests__/exchange-service.spec.ts` · Expected: FAIL (constructor arity / `เปลี่ยนรุ่นเดิมใช้ได้กับสัญญาผ่อนเท่านั้น`)

- [ ] **Step 7: เขียนโค้ด service**

imports เพิ่มใน `after-sales-exchange.service.ts`:
```ts
import * as Sentry from '@sentry/nestjs';
import { ShopCashExchangeTemplate } from '../../journal/cpa-templates/shop-cash-exchange.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { preemptReservationsInTx } from '../../../utils/reservation-preempt.util';
import { canSeeCost } from '../../products/cost-visibility.util';
import { mainProductStatusFor } from '../../sales/services/sale-product-status.util';
import { shopWarrantyDatesFor } from '../../sales/services/sale-shop-warranty.util';
import { saleSoldAt } from '../../repair-tickets/utils/sale-sold-at';
import { assertCashReplacement } from '../utils/assert-cash-replacement';
import { cashExchangeWindowOpen } from '../utils/cash-exchange-window';
import { CASH_OUT_OF_WINDOW_REASON } from '../utils/after-sales-outcomes.util';
import { ExchangeDeliverDto, deliveredAccessoriesText } from '../dto/exchange-deliver.dto';
```
`SAME_MODEL_PENDING_CAS`:
```ts
const SAME_MODEL_PENDING_CAS = (id: string): Prisma.AfterSalesCaseWhereInput => ({
  id, deletedAt: null,
  outcome: { in: ['SAME_MODEL_EXCHANGE', 'CASH_SAME_MODEL_EXCHANGE'] }, // PR 5 — ปฏิเสธ/เปลี่ยนเป็นซ่อม ใช้กับเคสขายสดด้วย
  stage: 'AWAITING_APPROVAL', replacementContractId: null, replacementSaleId: null, approvedAt: null, cancelledAt: null,
});
```
constructor เพิ่มท้าย: `private readonly cashExchange: ShopCashExchangeTemplate, private readonly shopAccounts: ShopAccountResolver, private readonly companyResolver: CompanyResolverService,`

`confirmSameModel` — หลัง `const c = await this.query.getCase(caseId, user);` ใส่ `if (c.saleId && !c.contractId) return this.confirmCashSameModel(c, dto, user);` (ก่อน `if (!c.contractId) throw …`) · `rejectSameModel`/`switchToRepair`: เงื่อนไข `c.outcome !== 'SAME_MODEL_EXCHANGE'` เปลี่ยนเป็น `!['SAME_MODEL_EXCHANGE', 'CASH_SAME_MODEL_EXCHANGE'].includes(c.outcome ?? '')`

`deliver(caseId, user, dto?: ExchangeDeliverDto)` — หลัง `getCase`: `if (c.outcome === 'CASH_SAME_MODEL_EXCHANGE') return this.deliverCash(c, dto ?? {}, user);`

เมธอดใหม่ (วางหลัง `deliver`):
```ts
  /** PR 5 §5 — ยืนยันเปลี่ยนรุ่นเดิมบนใบขายสด/ไฟแนนซ์นอก (ทาง ก: สลับเครื่องบนใบขายเดิม + JE สลับต้นทุน) */
  private async confirmCashSameModel(c: ExchangeCase, dto: ExchangeConfirmDto, user: ReqUser) {
    const fromRepair = c.outcome === 'REPAIR';
    if (!fromRepair && c.outcome !== 'CASH_SAME_MODEL_EXCHANGE') throw new BadRequestException('เคสนี้ไม่ใช่ทางออกเปลี่ยนรุ่นเดิม');
    if (['CLOSED', 'CANCELLED'].includes(c.stage)) throw new BadRequestException('เคสนี้จบแล้ว');
    if (c.replacementSaleId) throw new ConflictException('ยืนยันไปแล้ว');
    const newProductId = fromRepair ? dto.replacementProductId : c.replacementProductId;
    if (!newProductId) throw new BadRequestException('ต้องเลือกเครื่องทดแทนจากสต๊อก');
    const saleId = c.saleId!;

    // CAS จองเคส (pattern M4) — ไม่มี engine ภายนอก แต่ยังต้องกันสองแท็บยืนยันซ้อนก่อนเปิด tx
    const claimedAt = new Date();
    const claim = await this.prisma.afterSalesCase.updateMany({
      where: {
        id: c.id, deletedAt: null,
        stage: { in: fromRepair ? REPAIR_CONFIRM_STAGES : ['AWAITING_APPROVAL'] },
        replacementContractId: null, replacementSaleId: null, cancelledAt: null, approvedAt: null,
      },
      data: { approvedAt: claimedAt, approvedById: user.id },
    });
    if (!claim.count) throw new ConflictException('เคสนี้ถูกดำเนินการไปแล้ว');

    let posted: Awaited<ReturnType<AfterSalesExchangeService['runCashConfirm']>>;
    try {
      posted = await this.prisma.$transaction(
        (tx) => this.runCashConfirm(tx, c, saleId, newProductId, fromRepair, user, claimedAt),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      await this.prisma.afterSalesCase
        .updateMany({ where: { id: c.id, approvedAt: claimedAt, replacementSaleId: null }, data: { approvedAt: null, approvedById: null } })
        .catch((releaseErr: unknown) => this.logger.error(`ปล่อยการจองยืนยันเปลี่ยนเครื่อง (ขายสด) ไม่สำเร็จ caseId=${c.id}: ${String(releaseErr)}`));
      if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2034' || err.code === 'P2002')) {
        Sentry.captureMessage('[after-sales cash-exchange] write-conflict translated to 409', { level: 'warning', extra: { caseId: c.id, code: err.code } });
        throw new ConflictException('ระบบกำลังประมวลผลรายการของเคสนี้อยู่ — ลองใหม่อีกครั้ง');
      }
      throw err;
    }

    await this.audit.log({
      userId: user.id, action: 'AFTER_SALES_CASH_EXCHANGE_CONFIRMED', entity: 'after_sales_case', entityId: c.id,
      newValue: {
        saleId, saleNumber: posted.saleNumber, oldProductId: posted.oldProductId, newProductId, journalEntryNo: posted.journalEntryNo, fromRepair,
        ...(canSeeCost(user.role) ? { oldCost: posted.oldCost, newCost: posted.newCost } : {}),
      },
    });
    if (fromRepair && posted.repairTicketId) {
      await this.audit.log({ userId: user.id, action: 'REPAIR_TICKET_REPLACED_BY_SALE', entity: 'repair_ticket', entityId: posted.repairTicketId, newValue: { saleId, afterSalesCaseId: c.id } });
    }
    void this.line.notifyMoment(c.id, 'READY', user.id).catch(() => undefined);
    return { id: c.id, stage: 'READY_FOR_PICKUP' as const, replacementSaleId: saleId, saleNumber: posted.saleNumber, journalEntryNo: posted.journalEntryNo };
  }

  private async runCashConfirm(
    tx: Prisma.TransactionClient, c: ExchangeCase, saleId: string, newProductId: string, fromRepair: boolean, user: ReqUser, claimedAt: Date,
  ) {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      select: { id: true, saleNumber: true, saleType: true, productId: true, customerId: true, deletedAt: true, exchangeCaseId: true, shopWarrantyStartDate: true, createdAt: true, costSnapshot: { select: { mainProductCost: true } } },
    });
    if (!sale || sale.deletedAt) throw new BadRequestException('ใบขายถูกยกเลิกไปแล้ว — เปลี่ยนเครื่องไม่ได้');
    if (sale.productId !== c.productId) throw new ConflictException('เครื่องของใบขายเปลี่ยนไปแล้ว — เปิดเคสใหม่');
    const expectedStatus = mainProductStatusFor(sale.saleType);
    if (!expectedStatus) throw new BadRequestException('ใบขายประเภทนี้ไม่รองรับการเปลี่ยนรุ่นเดิมขายสด');
    // §3.4 — ตรวจกรอบด้วยข้อมูลสด (ไม่ใช่ snapshot ตอนเปิดเคส) ทั้งเคสปกติและ fromRepair · ไม่มี override
    if (!cashExchangeWindowOpen(saleSoldAt(sale)!)) throw new BadRequestException(CASH_OUT_OF_WINDOW_REASON);
    const next = await assertCashReplacement(tx, { sale: { id: sale.id, productId: sale.productId, customerId: sale.customerId }, caseBranchId: c.branchId }, newProductId);
    if (!sale.costSnapshot) throw new BadRequestException('ไม่พบต้นทุนที่ลงบัญชีตอนขาย — ให้ฝ่ายบัญชีตรวจก่อน');
    const oldCost = new Prisma.Decimal(sale.costSnapshot.mainProductCost.toString());
    const newCost = new Prisma.Decimal(next.costPrice.toString());
    const oldProduct = await tx.product.findUnique({ where: { id: sale.productId }, select: { category: true } });
    if (!oldProduct) throw new BadRequestException('ไม่พบเครื่องเดิมของใบขาย');

    const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
    await validatePeriodOpen(tx, new Date(), shopCompanyId);

    const oldFlip = await tx.product.updateMany({ where: { id: sale.productId, status: expectedStatus, deletedAt: null }, data: { status: 'DEFECT_RETURN' } });
    if (oldFlip.count !== 1) throw new ConflictException('เครื่องเดิมไม่อยู่ในสถานะของใบขายนี้แล้ว');
    const newFlip = await tx.product.updateMany({ where: { id: newProductId, status: 'IN_STOCK', deletedAt: null }, data: { status: expectedStatus } });
    if (newFlip.count !== 1) throw new ConflictException('เครื่องทดแทนถูกขาย/จองไปแล้ว');
    await preemptReservationsInTx(tx, [newProductId]);

    const je = await this.cashExchange.execute(
      {
        afterSalesCaseId: c.id, caseNumber: c.caseNumber, saleId: sale.id, saleNumber: sale.saleNumber,
        oldProductId: sale.productId, newProductId, oldCost, newCost,
        oldAccounts: this.shopAccounts.resolveProductAccounts(oldProduct.category),
        newAccounts: this.shopAccounts.resolveProductAccounts(next.category),
      },
      tx,
    );

    const updatedSale = await tx.sale.update({
      where: { id: sale.id },
      data: { productId: newProductId, exchangeCaseId: c.id, costSnapshot: { upsert: { create: { mainProductCost: newCost }, update: { mainProductCost: newCost } } } },
      select: { saleNumber: true },
    });

    let repairTicketId: string | null = null;
    if (fromRepair && c.repairTicket?.id) {
      await this.repair.markReplacedBySale(c.repairTicket.id, { caseNumber: c.caseNumber, saleNumber: updatedSale.saleNumber }, user, tx);
      repairTicketId = c.repairTicket.id;
    }

    await tx.afterSalesCase.update({
      where: { id: c.id },
      data: {
        outcome: 'CASH_SAME_MODEL_EXCHANGE', replacementProductId: newProductId, replacementSaleId: sale.id,
        approvedById: user.id, approvedAt: claimedAt, stage: 'READY_FOR_PICKUP',
        events: { create: { kind: 'APPROVED', actorId: user.id, note: `ยืนยันเปลี่ยนเครื่อง · ใบขาย ${updatedSale.saleNumber} · เครื่องทดแทน IMEI ${next.imeiSerial ?? '—'}${fromRepair ? ' · จากใบซ่อม (ซ่อมไม่ได้)' : ''}` } },
      },
    });
    return { saleNumber: updatedSale.saleNumber, oldProductId: sale.productId, oldCost: oldCost.toFixed(2), newCost: newCost.toFixed(2), journalEntryNo: je?.entryNo ?? null, repairTicketId };
  }

  /** PR 5 §6 — ส่งมอบเครื่องทดแทนของเคสขายสด: ประกันร้าน + กรอบ 7 วันนับใหม่จากวันนี้ · ปิดเคส · ไม่มี JE */
  private async deliverCash(c: ExchangeCase, dto: ExchangeDeliverDto, user: ReqUser) {
    if (!c.replacementSaleId || !c.replacementProductId) throw new BadRequestException('เคสนี้ยังไม่ได้ยืนยันเปลี่ยนเครื่อง');
    if (c.stage !== 'READY_FOR_PICKUP') throw new BadRequestException('เคสนี้ยังไม่พร้อมส่งมอบ');
    const now = new Date();
    const { updated, saleNumber, shopWarrantyEndDate } = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUniqueOrThrow({ where: { id: c.replacementProductId! }, select: { category: true, shopWarrantyDays: true, deviceOrigin: true, warrantyTerms: true } });
      const w = await shopWarrantyDatesFor(tx, product, now);
      const sale = await tx.sale.update({ where: { id: c.replacementSaleId! }, data: { shopWarrantyStartDate: w.shopWarrantyStartDate, shopWarrantyEndDate: w.shopWarrantyEndDate }, select: { saleNumber: true } });
      const accessories = deliveredAccessoriesText(dto.accessories);
      const note = `ส่งมอบเครื่องทดแทน · ใบขาย ${sale.saleNumber}${accessories ? ` · อุปกรณ์: ${accessories}` : ''}${dto.note?.trim() ? ` · ${dto.note.trim()}` : ''}`;
      const updated = await tx.afterSalesCase.update({
        where: { id: c.id },
        data: { closedAt: now, stage: 'CLOSED', events: { create: [{ kind: 'DELIVERED', actorId: user.id, note }, { kind: 'CLOSED', actorId: user.id, note: 'ปิดเคส' }] } },
      });
      return { updated, saleNumber: sale.saleNumber, shopWarrantyEndDate: w.shopWarrantyEndDate };
    });
    await this.audit.log({ userId: user.id, action: 'AFTER_SALES_CASH_EXCHANGE_DELIVERED', entity: 'after_sales_case', entityId: c.id, newValue: { replacementSaleId: c.replacementSaleId, saleNumber, shopWarrantyEndDate: shopWarrantyEndDate?.toISOString() ?? null } });
    void this.line.notifyMoment(c.id, 'CLOSED', user.id).catch(() => undefined);
    return updated;
  }
```

เมธอด preview (วางหลัง `deliverCash`) — ใช้ตัวเดียวกับที่ confirm คำนวณ (snapshot + costPrice + resolver) แต่ไม่เขียนอะไร:
```ts
  /** PR 5 §11 — กล่อง "รายการบัญชีที่จะลง" ในกล่องยืนยัน (MGR) — คำนวณจากแหล่งเดียวกับ runCashConfirm ไม่เขียน DB */
  async cashExchangePreview(caseId: string, replacementProductId: string | undefined, user: ReqUser) {
    this.assertMgr(user);
    if (!canSeeCost(user.role)) throw new ForbiddenException('ไม่มีสิทธิ์ดูต้นทุน');
    const c: ExchangeCase = await this.query.getCase(caseId, user);
    if (!c.saleId || c.contractId) throw new BadRequestException('เคสนี้ไม่ใช่เคสขายสด');
    const newProductId = replacementProductId ?? c.replacementProductId;
    if (!newProductId) throw new BadRequestException('ต้องเลือกเครื่องทดแทนจากสต๊อก');
    const sale = await this.prisma.sale.findUnique({ where: { id: c.saleId }, select: { saleNumber: true, productId: true, customerId: true, costSnapshot: { select: { mainProductCost: true } } } });
    if (!sale) throw new NotFoundException('ไม่พบใบขาย');
    const next = await assertCashReplacement(this.prisma, { sale: { id: c.saleId, productId: sale.productId, customerId: sale.customerId }, caseBranchId: c.branchId }, newProductId);
    if (!sale.costSnapshot) throw new BadRequestException('ไม่พบต้นทุนที่ลงบัญชีตอนขาย — ให้ฝ่ายบัญชีตรวจก่อน');
    const oldProduct = await this.prisma.product.findUnique({ where: { id: sale.productId }, select: { category: true } });
    const oldA = this.shopAccounts.resolveProductAccounts(oldProduct?.category ?? 'PHONE_USED');
    const newA = this.shopAccounts.resolveProductAccounts(next.category);
    const oldCost = new Prisma.Decimal(sale.costSnapshot.mainProductCost.toString());
    const newCost = new Prisma.Decimal(next.costPrice.toString());
    const z = '0.00';
    const lines = [
      ...(oldCost.gt(0) ? [{ accountCode: oldA.inventoryAccountCode, dr: oldCost.toFixed(2), cr: z }, { accountCode: oldA.cogsAccountCode, dr: z, cr: oldCost.toFixed(2) }] : []),
      ...(newCost.gt(0) ? [{ accountCode: newA.cogsAccountCode, dr: newCost.toFixed(2), cr: z }, { accountCode: newA.inventoryAccountCode, dr: z, cr: newCost.toFixed(2) }] : []),
    ];
    return { saleNumber: sale.saleNumber, oldCost: oldCost.toFixed(2), newCost: newCost.toFixed(2), replacementProductId: newProductId, lines };
  }
```
(unit test ของ preview: `prisma.sale.findUnique` ใน spec คืน `SALE` ซึ่งมี `costSnapshot`/`productId`/`customerId` อยู่แล้ว)

facade `after-sales.service.ts`: `deliver(id: string, user: ReqUser, dto?: ExchangeDeliverDto) { return this.exchange.deliver(id, user, dto); }` และ `cashExchangePreview(id: string, replacementProductId: string | undefined, user: ReqUser) { return this.exchange.cashExchangePreview(id, replacementProductId, user); }` (import DTO) · controller (route แบบสองส่วนต้องอยู่**ก่อน** `@Get(':id')`):
```ts
  @Post(':id/exchange/deliver')
  @Roles(...STAFF)
  deliverExchange(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ExchangeDeliverDto, @CurrentUser() user: any) {
    return this.svc.deliver(id, user, dto);
  }

  @Get(':id/exchange/cash-preview')
  @Roles(...MGR)
  cashExchangePreview(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('replacementProductId') replacementProductId: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.svc.cashExchangePreview(id, replacementProductId || undefined, user);
  }
```
module: `import { JournalModule } from '../journal/journal.module';` เพิ่มใน `imports` (ตรวจว่าไม่ circular — `JournalModule` ไม่ import after-sales) · integration spec wiring (บรรทัด ~197–207): เพิ่ม `new ShopCashExchangeTemplate(journal, prisma as never, companyResolver), new ShopAccountResolver(prisma as never), companyResolver` ต่อท้าย `new AfterSalesExchangeService(...)` + import

- [ ] **Step 8: รัน unit + type-check**

Run: `npm --prefix /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api run test --silent -- src/modules/after-sales/__tests__/exchange-service.spec.ts src/modules/after-sales/__tests__/cash-exchange-window.spec.ts` แล้ว `cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && ./tools/check-types.sh api`
Expected: PASS · 0 TS errors

- [ ] **Step 9: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && git add apps/api/src/modules/after-sales && git commit -m "feat(after-sales): ยืนยัน/ส่งมอบเปลี่ยนรุ่นเดิมขายสด — สลับเครื่องบนใบขายเดิม + JE สลับต้นทุน (PR5 T9)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: LINE ปิดเคส — วันหมดประกันจาก `Sale` เมื่อเป็นเคสขายสด

**Files:**
- Modify: `apps/api/src/modules/after-sales/services/after-sales-line.service.ts:233-262` (`loadReplacement`)
- Test: `__tests__/line-service.spec.ts`

**Interfaces:** ไม่เปลี่ยน signature · consumes Task 4 (`CASE_FOR_LINE_SELECT.saleId/replacementSaleId`)

- [ ] **Step 1: เทส (แดงก่อน)** — ใน `line-service.spec.ts` เพิ่มเคส (mock `prisma.sale = { findFirst: jest.fn() }` ใน `beforeEach` ถ้ายังไม่มี):
```ts
  it('PR 5 — CLOSED ของเคสขายสด: วันหมดประกันร้านอ่านจาก Sale.shopWarrantyEndDate (ไม่มีสัญญา)', async () => {
    prisma.afterSalesCase.findFirst.mockResolvedValue(
      makeCase({ outcome: 'CASH_SAME_MODEL_EXCHANGE', stage: 'CLOSED', saleId: 'sale-1', replacementSaleId: 'sale-1', replacementProductId: 'prod-new', replacementContractId: null, repairTicket: null }),
    );
    prisma.product.findFirst.mockResolvedValue({ brand: 'Apple', model: 'iPhone 13', storage: '128GB', imeiSerial: '359000000000002' });
    prisma.sale.findFirst.mockResolvedValue({ shopWarrantyEndDate: new Date('2026-12-11T00:00:00.000Z') });
    await service.notifyMoment('case-1', 'CLOSED', 'u-1');
    expect(prisma.contract.findFirst).not.toHaveBeenCalled();
    expect(prisma.sale.findFirst).toHaveBeenCalledWith({ where: { id: 'sale-1', deletedAt: null }, select: { shopWarrantyEndDate: true } });
    const data = notifications.sendFromTemplate.mock.calls[0][0].data ?? notifications.sendFromTemplate.mock.calls[0][1];
    expect(JSON.stringify(data)).toContain('ประกันร้าน ถึง');
  });
```
(ปรับการอ่าน `data` ให้ตรงกับที่เทสเดิมในไฟล์ใช้ดึง payload ของ `sendFromTemplate` — ดูเคส CLOSED เดิมในไฟล์แล้วใช้รูปเดียวกัน)

- [ ] **Step 2: รันให้แดง** — Expected: FAIL (`prisma.sale.findFirst` ไม่ถูกเรียก / ประกัน '—')

- [ ] **Step 3: แก้ `loadReplacement`** — หลังบล็อก `if (coveringContractId) { … }` เพิ่ม:
```ts
    // PR 5 — เคสขายสดไม่มีสัญญา: ประกันร้านของเครื่องทดแทนอยู่บนใบขายเดิม (ตั้งใหม่ตอนส่งมอบ)
    if (!coveringContractId && c.outcome === 'CASH_SAME_MODEL_EXCHANGE' && c.saleId) {
      const sale = await this.prisma.sale.findFirst({ where: { id: c.saleId, deletedAt: null }, select: { shopWarrantyEndDate: true } });
      shopWarrantyEndDate = sale?.shopWarrantyEndDate ? sale.shopWarrantyEndDate.toISOString() : null;
    }
```

- [ ] **Step 4: รันให้เขียว** — Run: `… -- src/modules/after-sales/__tests__/line-service.spec.ts src/modules/after-sales/__tests__/line-copy.spec.ts` · Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && git add apps/api/src/modules/after-sales && git commit -m "feat(after-sales): LINE ปิดเคสขายสดอ่านประกันจากใบขาย (PR5 T10)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: เอกสาร 2 ใบ — ใบรับคืนเครื่อง + ใบส่งมอบเครื่องทดแทน + PDF 2 หน้า

**Files:**
- Modify: `apps/api/src/modules/after-sales/documents/after-sales-doc-compose.ts` (`DocSource.exchange` · ลบ `HANDOVER_CASH_UNSUPPORTED_MSG` · `handoverBlockReason` · ฟังก์ชันใหม่ 2 ตัว + `returnBlockReason`)
- Modify: `apps/api/src/modules/after-sales/documents/after-sales-doc-html.ts:346-377` (`buildAfterSalesDocHtml` รับ array + CSS page-break)
- Modify: `apps/api/src/modules/after-sales/services/after-sales-document.service.ts` (`AfterSalesDocKind` · `DOC_NOTE` · `render` · `renderCashExchangeDocs` · `loadSource` กิ่ง cash)
- Modify: `apps/api/src/modules/after-sales/after-sales.controller.ts` (2 routes)
- Test: `__tests__/doc-compose.spec.ts` · `__tests__/doc-html.spec.ts` · `__tests__/document-service.spec.ts` · `__tests__/doc-render.smoke.spec.ts`

**Interfaces:**
- Produces:
```ts
export type AfterSalesDocKind = 'RECEIPT' | 'HANDOVER' | 'RETURN' | 'REPLACEMENT_HANDOVER';
DocSource.exchange += { saleType: 'CASH' | 'EXTERNAL_FINANCE' | null; financeCompany: string | null; sevenDayEnd: Date | null; deliveredNote: string | null; approvedByName: string | null; approvedAt: Date | null; repairTicketNumber: string | null }
export function composeReturnDoc(s: DocSource): AfterSalesDoc
export function composeReplacementHandoverDoc(s: DocSource): AfterSalesDoc
export function returnBlockReason(c: { outcome; stage }): string | null   // 'ใบรับคืนเครื่องพิมพ์ได้เฉพาะเคสเปลี่ยนรุ่นเดิมขายสดที่ยืนยันแล้ว'
export function buildAfterSalesDocHtml(doc: AfterSalesDoc | AfterSalesDoc[]): string
AfterSalesDocumentService.renderCashExchangeDocs(caseId, user): Promise<{ pdf: Buffer; caseNumber: string }>
GET /after-sales/:id/return.pdf · GET /after-sales/:id/exchange-docs.pdf
```
- Consumes: Task 9 (DELIVERED note · `replacementSaleId` · `approvedById`)

- [ ] **Step 1: เทสถ้อยคำ (แดงก่อน)** — ใน `doc-compose.spec.ts` แทนเคส `HANDOVER_CASH_UNSUPPORTED_MSG` (บรรทัด ~455–462) ด้วย:
```ts
  describe('PR 5 — เคสขายสด: ใบรับคืนเครื่อง + ใบส่งมอบเครื่องทดแทน', () => {
    const cash = (): DocSource =>
      source({
        source: 'CASH_SALE', contractNumber: null, saleNumber: 'SL-0001', outcome: 'CASH_SAME_MODEL_EXCHANGE', stage: 'CLOSED',
        closedAt: new Date('2026-10-14T04:00:00.000Z'), repair: null,
        warranty: { purchasedAt: new Date('2026-10-09T05:00:00.000Z'), shopWarrantyEnd: new Date('2026-12-08T00:00:00.000Z'), manufacturerWarrantyEnd: null, within7Days: true },
        exchange: {
          mode: null, fromRepair: false, oldDeviceLabel: 'Apple iPhone 13 128GB', oldImei: '359000000000001',
          newDeviceLabel: 'Apple iPhone 13 128GB · Blue', newImei: '359000000000002', replacementContractNumber: null,
          newShopWarrantyEnd: new Date('2026-12-13T00:00:00.000Z'), newManufacturerWarrantyEnd: null,
          saleType: 'CASH', financeCompany: null, sevenDayEnd: new Date('2026-10-20T00:00:00.000Z'),
          deliveredNote: 'ส่งมอบเครื่องทดแทน · ใบขาย SL-0001 · อุปกรณ์: กล่อง, สายชาร์จ', approvedByName: 'นิภา', approvedAt: new Date('2026-10-12T06:00:00.000Z'), repairTicketNumber: null,
        },
      });
    const text = (d: AfterSalesDoc) => JSON.stringify(d);

    it('handoverBlockReason ของขายสด: READY/CLOSED พิมพ์ได้ · AWAITING ไม่ได้', () => {
      expect(handoverBlockReason({ outcome: 'CASH_SAME_MODEL_EXCHANGE', stage: 'CLOSED', hasRepairTicket: false })).toBeNull();
      expect(handoverBlockReason({ outcome: 'CASH_SAME_MODEL_EXCHANGE', stage: 'AWAITING_APPROVAL', hasRepairTicket: false })).toBe(HANDOVER_NOT_READY_MSG);
      expect(returnBlockReason({ outcome: 'CASH_SAME_MODEL_EXCHANGE', stage: 'READY_FOR_PICKUP' })).toBeNull();
      expect(returnBlockReason({ outcome: 'SAME_MODEL_EXCHANGE', stage: 'CLOSED' })).toBe('ใบรับคืนเครื่องพิมพ์ได้เฉพาะเคสเปลี่ยนรุ่นเดิมขายสดที่ยืนยันแล้ว');
    });

    it('ใบรับคืน: อ้างใบขาย · เหตุผล 7 วัน · ผลของการรับคืน 3 ข้อ · ลายเซ็นผู้ส่งคืน/ผู้รับคืน · ไม่มีราคา · ไม่มีคำว่า "รับเครื่อง"', () => {
      const d = composeReturnDoc(cash());
      expect(d.title).toBe('ใบรับคืนเครื่อง');
      expect(d.kicker).toContain('ใบที่ 1/2');
      expect(d.meta).toEqual(expect.arrayContaining([{ label: 'เลขเคส', value: 'AS-20260907-0004' }, { label: 'อ้างอิงใบขาย', value: 'SL-0001' }]));
      const t = text(d);
      expect(t).toContain('เครื่องมีปัญหาภายใน 7 วันนับจากวันซื้อ');
      expect(t).toContain('ไม่มีการคืนเงินหรือเงินเพิ่ม');
      expect(t).toContain('เครื่องเดิมเป็นของร้าน รอส่งเคลมผู้จัดจำหน่าย');
      expect(t).toContain('ใบขายเดิมยังเป็นหลักฐานการซื้อ');
      expect(d.signatures[0].role).toBe('ลูกค้า (ผู้ส่งคืน)');
      expect(d.signatures[1].role).toBe('พนักงานผู้รับคืน');
      expect(t).not.toMatch(/บาท/);
      expect(t).not.toContain('รับเครื่อง');
    });

    it('ใบรับคืน fromRepair → เหตุผล "ซ่อมไม่ได้ — เปลี่ยนรุ่นเดิมแทน (ใบซ่อม RT-…)"', () => {
      const s = cash();
      s.exchange!.fromRepair = true;
      s.exchange!.repairTicketNumber = 'RT-20261010-0003';
      expect(text(composeReturnDoc(s))).toContain('ซ่อมไม่ได้ — เปลี่ยนรุ่นเดิมแทน (ใบซ่อม RT-20261010-0003)');
    });

    it('ใบส่งมอบเครื่องทดแทน: ราคาขายเท่าเดิม · ไม่มีเงินเปลี่ยนมือ · ประกันร้าน/กรอบ 7 วันนับใหม่ · ประกันศูนย์ "— (มือสอง ไม่มี)" · อุปกรณ์จาก DELIVERED', () => {
      const d = composeReplacementHandoverDoc(cash());
      expect(d.title).toBe('ใบส่งมอบเครื่องทดแทน');
      expect(d.kicker).toContain('ใบที่ 2/2');
      const t = text(d);
      expect(t).toContain('ราคาขายเท่าเดิม');
      expect(t).toContain('ชำระแล้วตามใบขายเดิม ไม่มีเงินเปลี่ยนมือ');
      expect(t).toContain('กรอบ 7 วัน');
      expect(t).toContain('— (มือสอง ไม่มี)');
      expect(t).toContain('กล่อง, สายชาร์จ');
      expect(t).not.toMatch(/บาท/);
      expect(t).not.toContain('รับเครื่อง');
    });

    it('ไฟแนนซ์นอก → การชำระ "ตามใบขายเดิม (ไฟแนนซ์ GFIN)"', () => {
      const s = cash();
      s.exchange!.saleType = 'EXTERNAL_FINANCE';
      s.exchange!.financeCompany = 'GFIN';
      expect(text(composeReplacementHandoverDoc(s))).toContain('ตามใบขายเดิม (ไฟแนนซ์ GFIN)');
    });
  });
```
(ลบ `HANDOVER_CASH_UNSUPPORTED_MSG` ออกจาก import · เพิ่ม `composeReturnDoc, composeReplacementHandoverDoc, returnBlockReason` · fixture `source()` เดิม: เติม `exchange` ให้มีฟิลด์ใหม่ 7 ตัวเป็น null/false ในทุกที่ที่สร้าง `exchange`)

- [ ] **Step 2: เทส HTML 2 หน้า (แดงก่อน)** — ใน `doc-html.spec.ts`:
```ts
  it('PR 5 — รับ array → หน้าแรกจบด้วย page-break แล้วตามด้วยเอกสารที่สอง · title ของเอกสารแรก', () => {
    const html = buildAfterSalesDocHtml([doc({ title: 'ใบรับคืนเครื่อง' }), doc({ title: 'ใบส่งมอบเครื่องทดแทน' })]);
    expect(html).toContain('<title>ใบรับคืนเครื่อง</title>');
    expect(html).toContain('class="as-page-break"');
    expect(html.indexOf('ใบรับคืนเครื่อง')).toBeLessThan(html.indexOf('as-page-break'));
    expect(html.indexOf('as-page-break')).toBeLessThan(html.indexOf('ใบส่งมอบเครื่องทดแทน'));
    expect(html.match(/class="bc-doc-footer"/g)).toHaveLength(2);
    expect(html).toContain('.as-page-break { page-break-after: always; break-after: page; }');
  });
```

- [ ] **Step 3: รันให้แดง** — Run: `… -- src/modules/after-sales/__tests__/doc-compose.spec.ts src/modules/after-sales/__tests__/doc-html.spec.ts` · Expected: FAIL

- [ ] **Step 4: เขียน compose + html**

`after-sales-doc-compose.ts`:
- `DocSource.exchange` เพิ่ม:
```ts
    /** PR 5 — เคสขายสด */
    saleType: 'CASH' | 'EXTERNAL_FINANCE' | null;
    financeCompany: string | null;
    sevenDayEnd: Date | null; // วันสุดท้ายของกรอบ 7 วันของเครื่องทดแทน (วันส่งมอบ + 6)
    deliveredNote: string | null; // note ของ event DELIVERED (มีอุปกรณ์ที่ส่งมอบ)
    approvedByName: string | null;
    approvedAt: Date | null;
    repairTicketNumber: string | null;
```
- ลบ `HANDOVER_CASH_UNSUPPORTED_MSG` และบรรทัด `if (c.outcome === 'CASH_SAME_MODEL_EXCHANGE') return HANDOVER_CASH_UNSUPPORTED_MSG;` ใน `handoverBlockReason` · เพิ่ม:
```ts
export const RETURN_NOT_READY_MSG = 'ใบรับคืนเครื่องพิมพ์ได้เฉพาะเคสเปลี่ยนรุ่นเดิมขายสดที่ยืนยันแล้ว';
export function returnBlockReason(c: { outcome: AfterSalesOutcome | null; stage: AfterSalesStage }): string | null {
  if (c.outcome !== 'CASH_SAME_MODEL_EXCHANGE') return RETURN_NOT_READY_MSG;
  if (c.stage !== 'READY_FOR_PICKUP' && c.stage !== 'CLOSED') return RETURN_NOT_READY_MSG;
  return null;
}
```
- ฟังก์ชันใหม่ (วางหลัง `composeHandoverDoc`):
```ts
function cashReturnReason(s: DocSource): string {
  const ex = s.exchange;
  if (ex?.fromRepair) return `ซ่อมไม่ได้ — เปลี่ยนรุ่นเดิมแทน${ex.repairTicketNumber ? ` (ใบซ่อม ${ex.repairTicketNumber})` : ''}`;
  const purchased = s.warranty.purchasedAt ? ` (ซื้อ ${date(s.warranty.purchasedAt)} · แจ้ง ${date(s.receivedAt)})` : '';
  return `เครื่องมีปัญหาภายใน 7 วันนับจากวันซื้อ${purchased} — อาการ: ${clip(s.symptom, SYMPTOM_MAX)}`;
}

/** PR 5 ใบที่ 1/2 — ใบรับคืนเครื่อง (ออกตอนส่งมอบ คู่กับใบส่งมอบเครื่องทดแทน) */
export function composeReturnDoc(s: DocSource): AfterSalesDoc {
  const ex = s.exchange;
  const returnedAt = s.closedAt ?? s.printedAt;
  const blocks: DocBlock[] = [
    {
      type: 'pair',
      left: { title: 'ลูกค้า (ผู้ส่งคืน)', rows: customerRows(s) },
      right: {
        title: 'ใบขาย',
        rows: [
          { label: 'เลขที่', value: s.saleNumber ?? '—', strong: true },
          { label: 'วันซื้อ', value: date(s.warranty.purchasedAt) },
          { label: 'ราคาขาย', value: 'ไม่เปลี่ยน — ใบขายเดิมยังใช้อยู่' },
          { label: 'สาขา', value: s.branchName },
        ],
      },
    },
    {
      type: 'table', title: 'เครื่องที่รับคืน', head: ['เครื่อง', 'IMEI', 'Serial'],
      rows: [[ex?.oldDeviceLabel ?? s.deviceLabel, ex?.oldImei ?? s.deviceImei ?? '—', s.deviceSerial ?? '—']],
      nowrapCols: IMEI_SERIAL_COLS,
    },
    { type: 'checks', label: 'อุปกรณ์ที่คืนมาด้วย (ตามใบรับฝาก)', items: accessoryChecks(s.accessories), trailing: { text: 'ปิด Find My / ปลดล็อกแล้ว', checked: s.unlockConfirmed } },
    { type: 'box', title: 'เหตุผลการรับคืน', text: cashReturnReason(s) },
    {
      type: 'section',
      section: {
        title: 'สภาพเครื่อง ณ วันรับคืน',
        rows: [
          { label: 'อ้างอิง', value: `รูปตอนซื้อและรูปตอนรับฝาก ${s.photoCount} รูป (ในระบบ)` },
          { label: 'ผู้ยืนยัน', value: ex?.approvedByName ? `${ex.approvedByName}${ex.approvedAt ? ` · ${date(ex.approvedAt)}` : ''}` : '—' },
        ],
      },
    },
    {
      type: 'section',
      section: {
        title: 'ผลของการรับคืน',
        rows: [
          { label: 'เงิน', value: 'ไม่มีการคืนเงินหรือเงินเพิ่ม' },
          { label: 'เครื่องเดิม', value: 'เครื่องเดิมเป็นของร้าน รอส่งเคลมผู้จัดจำหน่าย' },
          { label: 'ใบขาย', value: 'ใบขายเดิมยังเป็นหลักฐานการซื้อ (เปลี่ยนเฉพาะเครื่อง)' },
        ],
      },
    },
  ];
  return {
    title: 'ใบรับคืนเครื่อง',
    kicker: 'เปลี่ยนรุ่นเดิม (ขายสด) · ใบที่ 1/2 · ต้นฉบับ — ร้านเก็บ',
    company: s.company,
    meta: [
      { label: 'เลขเคส', value: s.caseNumber },
      { label: 'วันที่รับคืน', value: dateTime(returnedAt) },
      { label: 'อ้างอิงใบขาย', value: s.saleNumber ?? '—' },
      { label: 'พนักงาน', value: s.printedByName },
    ],
    blocks,
    ack: 'ลูกค้าส่งคืนเครื่องเดิมพร้อมอุปกรณ์ตามรายการข้างต้นให้ร้าน และรับทราบว่าไม่มีการคืนเงินหรือเงินเพิ่ม',
    signatures: [
      { role: 'ลูกค้า (ผู้ส่งคืน)', name: s.customerName, sub: BLANK_DATE },
      { role: 'พนักงานผู้รับคืน', name: s.printedByName, sub: `${s.branchName} · ${formatThaiDateText(returnedAt)}` },
    ],
    footer: footer(s),
  };
}

/** PR 5 ใบที่ 2/2 — ใบส่งมอบเครื่องทดแทน (ขายสด: ไม่มีสัญญาใหม่ ไม่มีเงินเปลี่ยนมือ) */
export function composeReplacementHandoverDoc(s: DocSource): AfterSalesDoc {
  const ex = s.exchange;
  const handedOverAt = s.closedAt ?? s.printedAt;
  const paymentLine =
    ex?.saleType === 'EXTERNAL_FINANCE'
      ? `ตามใบขายเดิม (ไฟแนนซ์ ${ex.financeCompany ?? '—'})`
      : 'ชำระแล้วตามใบขายเดิม ไม่มีเงินเปลี่ยนมือ';
  const delivered = ex?.deliveredNote?.split(' · ').find((p) => p.startsWith('อุปกรณ์: '))?.replace('อุปกรณ์: ', '') ?? null;
  const blocks: DocBlock[] = [
    {
      type: 'pair',
      left: { title: 'ลูกค้า (ผู้รับมอบ)', rows: customerRows(s) },
      right: {
        title: 'ใบขาย',
        rows: [
          { label: 'เลขที่', value: s.saleNumber ?? '—', strong: true },
          { label: 'ราคาขาย', value: 'ราคาขายเท่าเดิม' },
          { label: 'การชำระ', value: paymentLine },
        ],
      },
    },
    {
      type: 'table', title: 'เปลี่ยนรุ่นเดิม ความจุเดิม ราคาเท่าเดิม', head: ['', 'เครื่อง', 'IMEI'],
      rows: [
        ['เครื่องเดิม — รับคืนแล้ว (ใบที่ 1/2)', ex?.oldDeviceLabel ?? s.deviceLabel, ex?.oldImei ?? s.deviceImei ?? '—'],
        ['เครื่องที่ส่งมอบ', ex?.newDeviceLabel ?? '—', ex?.newImei ?? '—'],
      ],
      strongRows: [1], nowrapCols: [2],
    },
    { type: 'box', title: 'อุปกรณ์ที่ส่งมอบ', text: delivered ?? 'ตามที่ระบุในระบบ' },
    {
      type: 'pair',
      left: { title: 'ค่าใช้จ่าย', rows: [{ label: 'ลูกค้าจ่าย', value: 'ไม่มี', strong: true }, { label: 'เหตุผล', value: ex?.fromRepair ? 'ซ่อมไม่ได้ — เปลี่ยนรุ่นเดิมแทน' : 'มีปัญหาภายใน 7 วันหลังซื้อ' }] },
      right: {
        title: 'ประกันของเครื่องที่ส่งมอบ (นับใหม่จากวันส่งมอบ)',
        rows: [
          { label: 'ประกันร้าน', value: ex?.newShopWarrantyEnd ? `ถึง ${date(ex.newShopWarrantyEnd)}` : 'ไม่มี' },
          { label: 'กรอบ 7 วัน', value: ex?.sevenDayEnd ? `ถึง ${date(ex.sevenDayEnd)}` : '—' },
          { label: 'ประกันศูนย์', value: ex?.newManufacturerWarrantyEnd ? `ถึง ${date(ex.newManufacturerWarrantyEnd)}` : '— (มือสอง ไม่มี)' },
        ],
      },
    },
    {
      type: 'section',
      section: { title: 'ผลต่อใบขาย', rows: [{ label: 'เลขที่/ราคา', value: 'ใบขายเดิม เลขเดิม ราคาเดิม — เปลี่ยนเฉพาะเครื่อง' }, { label: 'หลักฐาน', value: 'ใบขายเดิม + ใบนี้ + ใบรับคืน (ใบที่ 1/2)' }] },
    },
  ];
  return {
    title: 'ใบส่งมอบเครื่องทดแทน',
    kicker: 'เปลี่ยนรุ่นเดิม (ขายสด) · ใบที่ 2/2 · ต้นฉบับ — ร้านเก็บ',
    company: s.company,
    meta: [
      { label: 'เลขเคส', value: s.caseNumber },
      { label: 'วันที่ส่งมอบ', value: dateTime(handedOverAt) },
      { label: 'อ้างอิงใบขาย', value: s.saleNumber ?? '—' },
      { label: 'อ้างอิงใบรับคืน', value: `ใบที่ 1/2 · ${formatThaiDateText(handedOverAt)}` },
      { label: 'พนักงาน', value: s.printedByName },
    ],
    blocks,
    ack: 'ลูกค้าตรวจเครื่องที่ส่งมอบพร้อมอุปกรณ์ตามรายการข้างต้นแล้ว เปิดใช้งานได้ปกติ และรับทราบว่าใบขายเดิมยังเป็นหลักฐานการซื้อ',
    signatures: [
      { role: 'ลูกค้า (ผู้รับมอบ)', name: s.customerName, sub: BLANK_DATE },
      { role: 'พนักงานผู้ส่งมอบ', name: s.printedByName, sub: `${s.branchName} · ${formatThaiDateText(handedOverAt)}` },
    ],
    footer: `${footer(s)} · ใบขายเดิมยังเป็นหลักฐานการซื้อ`,
  };
}
```
(`DocBlock` type `'checks'` รองรับ `trailing` อยู่แล้ว · ถ้าใบรับฝากเดิมไม่ได้ใช้ `trailing` กับ Find My ให้คง `items` อย่างเดียวและใส่ Find My เป็น item ที่ 5 แทน)

`after-sales-doc-html.ts` — เปลี่ยน `buildAfterSalesDocHtml`:
```ts
const PAGE_BREAK = '<div class="as-page-break"></div>';
function renderDocBody(doc: AfterSalesDoc): string {
  return `${header(doc)}
${doc.blocks.map(renderBlock).join('\n')}
<div class="as-closing">
${doc.conditions ? renderConditions(doc.conditions) : ''}
<p class="as-ack">${escapeHtml(doc.ack)}</p>
${signatures(doc.signatures)}
<div class="bc-doc-footer"><span>${escapeHtml(doc.footer)}</span><span>${DOC_NOT_RECEIPT}</span></div>
</div>`;
}

/** PR 5 — รับหลายเอกสาร (ใบรับคืน + ใบส่งมอบเครื่องทดแทน) คั่นด้วย page-break ⇒ PDF เดียวหลายหน้า */
export function buildAfterSalesDocHtml(input: AfterSalesDoc | AfterSalesDoc[]): string {
  const docs = Array.isArray(input) ? input : [input];
  const hasPhotos = docs.some((doc) => doc.blocks.some((b) => b.type === 'photos' && b.photos.some((p) => !!p.dataUrl && SAFE_IMAGE_DATA_URL.test(p.dataUrl))));
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(docs[0].title)}</title>
<style>
${DOCUMENT_WEB_FONT_FACES}
${TRANSACTION_PAGE_CSS}
${transactionDocumentCss('body')}
html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
${AS_CSS}
.as-page-break { page-break-after: always; break-after: page; }
</style>
</head>
<body>
${docs.map(renderDocBody).join(`\n${PAGE_BREAK}\n`)}
${hasPhotos ? THUMB_SCRIPT : ''}
</body>
</html>`;
}
```

- [ ] **Step 5: รัน compose + html ให้เขียว** — Expected: PASS

- [ ] **Step 6: เทส document service (แดงก่อน)** — ใน `document-service.spec.ts` เพิ่ม (ใช้ `caseDetail()`/mock prisma ของไฟล์เดิม; เพิ่ม `prisma.sale.findUnique`, `prisma.user.findUnique` ตามที่ไฟล์ mock ไว้):
```ts
  describe('PR 5 — เคสขายสด', () => {
    const cashCase = (over: Record<string, unknown> = {}) =>
      caseDetail({
        source: 'CASH_SALE', contractId: null, saleId: 'sale-1', outcome: 'CASH_SAME_MODEL_EXCHANGE', stage: 'CLOSED',
        closedAt: new Date('2026-10-14T04:00:00.000Z'), replacementSaleId: 'sale-1', replacementProductId: 'p-new', approvedById: 'u-9', repairTicket: null,
        exchange: { kind: 'SAME_MODEL', mode: null, approvalTier: null, requestStatus: null, buybackPrice: null, ncvSnapshot: null, approverRole: 'BRANCH_MANAGER',
          oldProduct: { brand: 'Apple', model: 'iPhone 13', storage: '128GB', imeiSerial: '359000000000001' },
          newProduct: { id: 'p-new', brand: 'Apple', model: 'iPhone 13', storage: '128GB', imeiSerial: '359000000000002' },
          replacementContract: null, sale: { id: 'sale-1', saleNumber: 'SL-0001' }, requestedBy: null },
        timeline: [{ kind: 'DELIVERED', note: 'ส่งมอบเครื่องทดแทน · ใบขาย SL-0001 · อุปกรณ์: กล่อง', at: '2026-10-14T04:00:00.000Z' }],
        ...over,
      });

    it('HANDOVER ของเคสขายสด → compose ใบส่งมอบเครื่องทดแทน (ไม่ใช่ใบส่งมอบของสัญญา) · โหลด Sale · PRINTED note "ใบส่งมอบเครื่องทดแทน"', async () => {
      query.getCase.mockResolvedValue(cashCase());
      prisma.sale.findUnique.mockResolvedValue({ saleNumber: 'SL-0001', saleType: 'CASH', financeCompany: null, createdAt: new Date('2026-10-09T05:00:00.000Z'), shopWarrantyStartDate: new Date('2026-10-14T04:00:00.000Z'), shopWarrantyEndDate: new Date('2026-12-13T04:00:00.000Z') });
      const { pdf } = await service.render(CASE_ID, 'HANDOVER', user);
      expect(pdf).toBeInstanceOf(Buffer);
      const html = renderer.htmlToPdf.mock.calls[0][0] as string;
      expect(html).toContain('<title>ใบส่งมอบเครื่องทดแทน</title>');
      expect(html).toContain('กรอบ 7 วัน');
      expect(prisma.afterSalesEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'PRINTED', note: 'ใบส่งมอบเครื่องทดแทน' }) }));
    });

    it('RETURN ตอน AWAITING_APPROVAL → 400 ไม่แตะ Chromium', async () => {
      query.getCase.mockResolvedValue(cashCase({ stage: 'AWAITING_APPROVAL', replacementSaleId: null, closedAt: null }));
      await expect(service.render(CASE_ID, 'RETURN', user)).rejects.toBeInstanceOf(BadRequestException);
      expect(renderer.htmlToPdf).not.toHaveBeenCalled();
    });

    it('renderCashExchangeDocs → HTML มี 2 ใบคั่น page-break · PRINTED ใบเดียว note รวม', async () => {
      query.getCase.mockResolvedValue(cashCase());
      prisma.sale.findUnique.mockResolvedValue({ saleNumber: 'SL-0001', saleType: 'CASH', financeCompany: null, createdAt: new Date(), shopWarrantyStartDate: new Date(), shopWarrantyEndDate: null });
      await service.renderCashExchangeDocs(CASE_ID, user);
      const html = renderer.htmlToPdf.mock.calls[0][0] as string;
      expect(html).toContain('ใบรับคืนเครื่อง');
      expect(html).toContain('as-page-break');
      expect(html).toContain('ใบส่งมอบเครื่องทดแทน');
      expect(prisma.afterSalesEvent.create).toHaveBeenCalledTimes(1);
      expect(prisma.afterSalesEvent.create.mock.calls[0][0].data.note).toBe('พิมพ์ใบรับคืนเครื่อง + ใบส่งมอบเครื่องทดแทน');
    });
  });
```
(ดูว่า `renderer`/`prisma.afterSalesEvent` ถูก mock ชื่ออะไรในไฟล์เดิม แล้วใช้ชื่อเดียวกัน)

- [ ] **Step 7: รันให้แดง** — Expected: FAIL (`'RETURN'` ไม่ใช่ kind / `renderCashExchangeDocs is not a function`)

- [ ] **Step 8: เขียน document service + controller**

`after-sales-document.service.ts`:
```ts
export type AfterSalesDocKind = 'RECEIPT' | 'HANDOVER' | 'RETURN' | 'REPLACEMENT_HANDOVER';
const DOC_NOTE: Record<AfterSalesDocKind, string> = {
  RECEIPT: 'ใบรับฝากเครื่อง', HANDOVER: 'ใบส่งมอบ', RETURN: 'ใบรับคืนเครื่อง', REPLACEMENT_HANDOVER: 'ใบส่งมอบเครื่องทดแทน',
};
const CASH_DOCS_NOTE = 'พิมพ์ใบรับคืนเครื่อง + ใบส่งมอบเครื่องทดแทน';
```
`render()`:
```ts
  async render(caseId: string, kind: AfterSalesDocKind, user: ReqUser) {
    const c = await this.query.getCase(caseId, user);
    const isCash = c.outcome === 'CASH_SAME_MODEL_EXCHANGE';
    // PR 5 — route handover.pdf เดิมของเคสขายสดให้ใบส่งมอบเครื่องทดแทน
    const effective: AfterSalesDocKind = kind === 'HANDOVER' && isCash ? 'REPLACEMENT_HANDOVER' : kind;
    this.assertPrintable(c, effective);
    const source = await this.loadSource(c, effective, user);
    const doc = this.compose(source, effective);
    const pdf = await this.renderer.htmlToPdf(buildAfterSalesDocHtml(doc));
    await this.recordPrinted(caseId, DOC_NOTE[effective], user.id);
    return { pdf, caseNumber: c.caseNumber };
  }

  /** PR 5 — ปุ่ม "พิมพ์ใบรับคืน + ใบส่งมอบ (2 ใบ)": PDF เดียว 2 หน้า · PRINTED ใบเดียว */
  async renderCashExchangeDocs(caseId: string, user: ReqUser) {
    const c = await this.query.getCase(caseId, user);
    this.assertPrintable(c, 'RETURN');
    const source = await this.loadSource(c, 'REPLACEMENT_HANDOVER', user);
    const pdf = await this.renderer.htmlToPdf(buildAfterSalesDocHtml([composeReturnDoc(source), composeReplacementHandoverDoc(source)]));
    await this.recordPrinted(caseId, CASH_DOCS_NOTE, user.id);
    return { pdf, caseNumber: c.caseNumber };
  }

  private assertPrintable(c: CaseDetail, kind: AfterSalesDocKind) {
    const hasRepairTicket = !!c.repairTicket && !c.repairTicket.deletedAt;
    const reason =
      kind === 'HANDOVER' ? handoverBlockReason({ outcome: c.outcome, stage: c.stage, hasRepairTicket })
      : kind === 'RETURN' || kind === 'REPLACEMENT_HANDOVER' ? returnBlockReason({ outcome: c.outcome, stage: c.stage })
      : null;
    if (reason) throw new BadRequestException(reason);
  }

  private compose(source: DocSource, kind: AfterSalesDocKind) {
    switch (kind) {
      case 'RECEIPT': return composeReceiptDoc(source);
      case 'HANDOVER': return composeHandoverDoc(source);
      case 'RETURN': return composeReturnDoc(source);
      case 'REPLACEMENT_HANDOVER': return composeReplacementHandoverDoc(source);
    }
  }
```
`recordPrinted(caseId, note: string, actorId)` — เปลี่ยนพารามิเตอร์ที่สองจาก kind เป็น note (ผู้เรียกส่ง `DOC_NOTE[kind]`) · `loadSource(c, kind, user)`: ใน `Promise.all` ขยาย `sale` select เป็น `{ saleNumber: true, saleType: true, financeCompany: true, createdAt: true, shopWarrantyStartDate: true, shopWarrantyEndDate: true }` และเพิ่มตัวโหลดที่ 9 ท้ายอาร์เรย์ `c.approvedById ? this.prisma.user.findUnique({ where: { id: c.approvedById }, select: { name: true } }) : null` โดยแก้บรรทัด destructure เป็น `const [row, printer, company, contract, sale, product, newContract, newProduct, approver] = await Promise.all([…])` · `newProduct` โหลดเมื่อ `(kind === 'HANDOVER' || kind === 'REPLACEMENT_HANDOVER') && ex?.newProduct` · ใน `exchange: ex ? {...}` เพิ่ม:
```ts
            saleType: sale?.saleType === 'CASH' || sale?.saleType === 'EXTERNAL_FINANCE' ? sale.saleType : null,
            financeCompany: sale?.financeCompany ?? null,
            newShopWarrantyEnd: c.outcome === 'CASH_SAME_MODEL_EXCHANGE' ? (sale?.shopWarrantyEndDate ?? null) : (newContract?.shopWarrantyEndDate ?? contract?.shopWarrantyEndDate ?? shopWarrantyEnd),
            sevenDayEnd: c.outcome === 'CASH_SAME_MODEL_EXCHANGE' && sale?.shopWarrantyStartDate ? new Date(sale.shopWarrantyStartDate.getTime() + 6 * 86_400_000) : null,
            deliveredNote: c.timeline.find((e) => e.kind === 'DELIVERED')?.note ?? null,
            approvedByName: approver?.name ?? null,
            approvedAt: c.approvedAt ?? null,
            repairTicketNumber: t?.ticketNumber ?? null,
```
(`newShopWarrantyEnd` บรรทัดเดิมถูกแทนด้วยเงื่อนไขข้างบน · `c.approvedAt`/`approvedById` เป็นสกาลาร์ที่ `getCase` include คืนอยู่แล้ว) · `after-sales.controller.ts` เพิ่ม:
```ts
  @Get(':id/return.pdf')
  @Roles(...ALL)
  async returnPdf(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any, @Res() res: Response) {
    const { pdf, caseNumber } = await this.docs.render(id, 'RETURN', user);
    sendPdf(res, pdf, `after-sales-return-${caseNumber}.pdf`);
  }

  @Get(':id/exchange-docs.pdf')
  @Roles(...ALL)
  async exchangeDocsPdf(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any, @Res() res: Response) {
    const { pdf, caseNumber } = await this.docs.renderCashExchangeDocs(id, user);
    sendPdf(res, pdf, `after-sales-exchange-docs-${caseNumber}.pdf`);
  }
```

- [ ] **Step 9: smoke PDF 2 หน้า** — ใน `doc-render.smoke.spec.ts` เพิ่มเคส (ใช้ fixture `realistic` ของไฟล์ + `exchange` แบบ cash ของ Step 1): render `buildAfterSalesDocHtml([composeReturnDoc(s), composeReplacementHandoverDoc(s)])` ผ่าน `AfterSalesPdfRenderer` แล้ว `expect(pdf.length).toBeGreaterThan(0)` และนับหน้าด้วย `(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length` ต้องเป็น 2

- [ ] **Step 10: รันทั้งชุดเอกสาร**

Run: `npm --prefix /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api run test --silent -- src/modules/after-sales/__tests__/doc-compose.spec.ts src/modules/after-sales/__tests__/doc-html.spec.ts src/modules/after-sales/__tests__/document-service.spec.ts src/modules/after-sales/__tests__/doc-render.smoke.spec.ts src/modules/after-sales/__tests__/document-routes.http.spec.ts`
Expected: PASS (smoke ต้องมี Chromium — ถ้าไม่มีในเครื่องให้บันทึกใน ledger และพึ่ง CI)

- [ ] **Step 11: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && git add apps/api/src/modules/after-sales && git commit -m "feat(after-sales): ใบรับคืนเครื่อง + ใบส่งมอบเครื่องทดแทน · PDF 2 หน้า (PR5 T11)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: ด่าน G9 ยกเลิกใบขาย + ตัดจำหน่ายเครื่อง `DEFECT_RETURN`

**Files:**
- Modify: `apps/api/src/modules/sales/services/sale-void.service.ts:178-205` (select + ด่านหลัง G1)
- Modify: `apps/api/src/modules/inventory/stock-adjustments.service.ts:145,325-338`
- Test: `apps/api/src/modules/sales/services/sale-void.service.spec.ts` · `apps/api/src/modules/inventory/stock-adjustments.service.spec.ts`

**Interfaces:**
- Produces: ข้อความ G9 `ใบขาย <no> เปลี่ยนเครื่องแล้ว (เคส <caseNumber>) — ยกเลิกใบขายไม่ได้ ให้ฝ่ายบัญชีแก้รายการถ้าจำเป็น` · `WRITE_OFF` ขอได้จาก `DEFECT_RETURN`
- Consumes: Task 1 (`Sale.exchangeCaseId` + relation `exchangeCase`)

- [ ] **Step 1: เทส G9 (แดงก่อน)** — ใน `sale-void.service.spec.ts` ถัดจากเทส G1:
```ts
  it('G9 (PR 5): ใบขายที่เปลี่ยนเครื่องแล้ว (exchangeCaseId) → ปฏิเสธถาวร ระบุเลขเคส และไม่เขียนอะไร', async () => {
    tx.sale.findUnique.mockResolvedValue({ ...CASH_SALE, exchangeCaseId: 'as-1', exchangeCase: { caseNumber: 'AS-20261012-0001' } });
    await expect(service.voidSale('s1', 'ลูกค้าเปลี่ยนใจไม่ซื้อแล้ว', OWNER)).rejects.toThrow(
      new BadRequestException('ใบขาย SA-0001 เปลี่ยนเครื่องแล้ว (เคส AS-20261012-0001) — ยกเลิกใบขายไม่ได้ ให้ฝ่ายบัญชีแก้รายการถ้าจำเป็น'),
    );
    expectNothingWritten();
  });
```
(ดูลายเซ็น `voidSale(...)` ที่เทสเดิมเรียก แล้วใช้รูปเดียวกัน · `CASH_SALE` เพิ่ม `exchangeCaseId: null, exchangeCase: null`)

- [ ] **Step 2: รันให้แดง** — Run: `… -- src/modules/sales/services/sale-void.service.spec.ts` · Expected: FAIL (ไม่โยน / เขียนต่อ)

- [ ] **Step 3: แก้ sale-void** — ใน `select` ของ `tx.sale.findUnique` เพิ่ม `exchangeCaseId: true, exchangeCase: { select: { caseNumber: true } },` · หลังด่าน G1 (ก่อน "ขอบเขตสาขา"):
```ts
    // ── G9 (PR 5) — ใบขายที่สลับเครื่องแล้ว (เปลี่ยนรุ่นเดิมขายสด) ─────────────────
    // JE สลับต้นทุน stamp saleId จึงอยู่ใน sweep ด้านล่างได้ แต่เครื่องเดิมอยู่ DEFECT_RETURN/ถูกตัดจำหน่าย
    // และเครื่องทดแทนถูกส่งมอบไปแล้ว — ย้อนทั้งชุดเป็นงานฝ่ายบัญชี (คำตัดสินเจ้าของ ⑦ ปิดถาวร)
    if (sale.exchangeCaseId) {
      throw new BadRequestException(
        `ใบขาย ${sale.saleNumber} เปลี่ยนเครื่องแล้ว (เคส ${sale.exchangeCase?.caseNumber ?? sale.exchangeCaseId}) — ` +
          'ยกเลิกใบขายไม่ได้ ให้ฝ่ายบัญชีแก้รายการถ้าจำเป็น',
      );
    }
```

- [ ] **Step 4: รัน sale-void ให้เขียว** — Expected: PASS ทั้งไฟล์

- [ ] **Step 5: เทส stock-adjustments (แดงก่อน)** — ถัดจาก `(g4)`:
```ts
  it('(g4b PR 5) WRITE_OFF บนเครื่อง DEFECT_RETURN (รอเคลม) → ทำได้ · พักขายจากสถานะเดิม', async () => {
    const { service, prisma } = build(baseProduct({ status: 'DEFECT_RETURN' }));
    await service.createRequest({ productId: 'p1', reason: 'WRITE_OFF' }, [], OWNER);
    expect(prisma.stockAdjustment.create).toHaveBeenCalled();
    expect(prisma.product.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', status: 'DEFECT_RETURN', deletedAt: null }, data: { status: 'ADJUSTMENT_PENDING' } });
  });
  it('(g5b PR 5) LOST บนเครื่อง DEFECT_RETURN → 400 พร้อม hint ใหม่ "เครื่องรอเคลมผู้จัดจำหน่าย — เคลมไม่ได้ให้ขอตัดจำหน่าย"', async () => {
    const { service } = build(baseProduct({ status: 'DEFECT_RETURN' }));
    await expect(service.createRequest({ productId: 'p1', reason: 'LOST' }, [], OWNER)).rejects.toThrow(/เครื่องรอเคลมผู้จัดจำหน่าย — เคลมไม่ได้ให้ขอตัดจำหน่าย/);
  });
```

- [ ] **Step 6: รันให้แดง** — Run: `… -- src/modules/inventory/stock-adjustments.service.spec.ts` · Expected: FAIL

- [ ] **Step 7: แก้ stock-adjustments** — บรรทัด 325–327:
```ts
    const allowed =
      REQUESTABLE_STATUSES.EXIT.includes(product.status) ||
      // DAMAGED (ของเสียที่เก็บไว้) และ DEFECT_RETURN (เครื่องเดิมหลังเปลี่ยนรุ่นเดิม รอเคลม — PR 5 ③) ตัดจำหน่ายได้ทางเดียว
      (reason === 'WRITE_OFF' && (product.status === 'DAMAGED' || product.status === 'DEFECT_RETURN'));
```
ข้อความ 335–336: `(reason === 'WRITE_OFF' ? ', DAMAGED, DEFECT_RETURN' : '')` · `FOUND_POLICY.DEFECT_RETURN.hint` → `'เครื่องรอเคลมผู้จัดจำหน่าย — เคลมไม่ได้ให้ขอตัดจำหน่าย'`

- [ ] **Step 8: รันให้เขียว** — Run ทั้งสองไฟล์ · Expected: PASS

- [ ] **Step 9: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && git add apps/api/src/modules/sales apps/api/src/modules/inventory && git commit -m "feat: ด่าน G9 ยกเลิกใบขายที่เปลี่ยนเครื่องแล้ว + ตัดจำหน่ายจาก DEFECT_RETURN (PR5 T12)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: หน้าประวัติการขาย — ป้าย "เปลี่ยนเครื่องแล้ว" + ซ่อนปุ่มยกเลิก

**Files:**
- Modify: `apps/api/src/modules/sales/services/sales-query.service.ts:70-80,153-170` (include `exchangeCase`)
- Create: `apps/web/src/pages/sales-history/void-gate.ts` + `void-gate.test.ts`
- Modify: `apps/web/src/pages/SalesHistoryPage.tsx:38-70,535-560`

**Interfaces:**
- Produces: API `Sale.exchangeCase: { id, caseNumber, approvedAt, deviceImei } | null` (ทั้ง findAll/findOne) · web `voidGate(sale): { kind: 'button' } | { kind: 'text'; text: string; title: string } | { kind: 'none' }`

- [ ] **Step 1: เทส web (แดงก่อน)**

`apps/web/src/pages/sales-history/void-gate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { voidGate } from './void-gate';

const base = { saleType: 'CASH', deletedAt: null as string | null, exchangeCase: null as { caseNumber: string } | null };

describe('voidGate — ปุ่มยกเลิกใบขายบนหน้าประวัติการขาย', () => {
  it('ขายสดปกติ → ปุ่ม', () => expect(voidGate(base)).toEqual({ kind: 'button' }));
  it('ยกเลิกแล้ว → ไม่มีอะไร', () => expect(voidGate({ ...base, deletedAt: '2026-10-01T00:00:00Z' })).toEqual({ kind: 'none' }));
  it('ใบผ่อน → ข้อความ "ยกเลิกผ่านสัญญา"', () => expect(voidGate({ ...base, saleType: 'INSTALLMENT' })).toMatchObject({ kind: 'text', text: 'ยกเลิกผ่านสัญญา' }));
  it('PR 5 — เปลี่ยนเครื่องแล้ว → ข้อความ "เปลี่ยนเครื่องแล้ว · AS-…" ไม่มีปุ่ม', () =>
    expect(voidGate({ ...base, exchangeCase: { caseNumber: 'AS-20261012-0001' } })).toEqual({
      kind: 'text', text: 'เปลี่ยนเครื่องแล้ว · AS-20261012-0001', title: 'ใบขายที่เปลี่ยนรุ่นเดิมแล้วยกเลิกไม่ได้ — ให้ฝ่ายบัญชีแก้รายการถ้าจำเป็น',
    }));
});
```

- [ ] **Step 2: รันให้แดง** — Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/web && npx vitest run src/pages/sales-history/void-gate.test.ts` · Expected: FAIL module not found

- [ ] **Step 3: เขียน util + ต่อ UI + API include**

`apps/web/src/pages/sales-history/void-gate.ts`:
```ts
const VOIDABLE_SALE_TYPES = new Set(['CASH', 'EXTERNAL_FINANCE']);

export type VoidGate = { kind: 'button' } | { kind: 'text'; text: string; title: string } | { kind: 'none' };

/** mirror ของด่าน D1 + G9 ฝั่ง API (`SaleVoidService`) — ปุ่มโชว์เฉพาะตอนที่ API จะไม่ปฏิเสธแน่ ๆ */
export function voidGate(sale: { saleType: string; deletedAt?: string | null; exchangeCase?: { caseNumber: string } | null }): VoidGate {
  if (sale.deletedAt) return { kind: 'none' };
  if (!VOIDABLE_SALE_TYPES.has(sale.saleType)) {
    return { kind: 'text', text: 'ยกเลิกผ่านสัญญา', title: 'ใบขายผ่อนร้านยกเลิกผ่านหน้าสัญญา (ยกเลิกสัญญา) ไม่ใช่ที่นี่' };
  }
  if (sale.exchangeCase) {
    return { kind: 'text', text: `เปลี่ยนเครื่องแล้ว · ${sale.exchangeCase.caseNumber}`, title: 'ใบขายที่เปลี่ยนรุ่นเดิมแล้วยกเลิกไม่ได้ — ให้ฝ่ายบัญชีแก้รายการถ้าจำเป็น' };
  }
  return { kind: 'button' };
}
```
`SalesHistoryPage.tsx`: `Sale` เพิ่ม `exchangeCase?: { id: string; caseNumber: string; approvedAt: string; deviceImei: string | null } | null;` · ลบ `VOIDABLE_SALE_TYPES` local · คอลัมน์ actions:
```tsx
      render: (s: Sale) => {
        const gate = voidGate(s);
        if (gate.kind === 'none') return null;
        if (gate.kind === 'text') return <span className="text-2xs text-muted-foreground leading-snug" title={gate.title}>{gate.text}</span>;
        return (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openVoidDialog(s); }}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors whitespace-nowrap"
          >
            <Ban className="w-3 h-3" />
            ยกเลิกใบขาย
          </button>
        );
      },
```
และในคอลัมน์เครื่อง (ที่แสดง `s.product.imeiSerial`) เพิ่มใต้ IMEI เมื่อ `s.exchangeCase`: `<span className="block text-2xs text-muted-foreground leading-snug">เปลี่ยนเครื่อง {formatDateTime(s.exchangeCase.approvedAt)} · เดิม IMEI {s.exchangeCase.deviceImei ?? '—'}</span>` (ใช้ helper วันที่ที่ไฟล์ import อยู่แล้ว)

`sales-query.service.ts`: ใน `include` ของ `findAll` และ `findOne` เพิ่ม `exchangeCase: { select: { id: true, caseNumber: true, approvedAt: true, deviceImei: true } },`

- [ ] **Step 4: รันเทส web + sales-query spec + type-check**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/web && npx vitest run src/pages/sales-history/void-gate.test.ts` · `npm --prefix …/apps/api run test --silent -- src/modules/sales/services/sales-query.service.spec.ts` · `cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && ./tools/check-types.sh all`
Expected: PASS · 0 errors

- [ ] **Step 5: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && git add apps/api/src/modules/sales apps/web/src/pages && git commit -m "feat(sales): ป้ายเปลี่ยนเครื่องแล้วบนประวัติการขาย + ซ่อนปุ่มยกเลิก (PR5 T13)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: หน้าเว็บหลังการขาย — เปิดเคส · ยืนยัน · ส่งมอบ · พิมพ์ 2 ใบ (mockup กระดาน 11–14)

**Files:**
- Modify: `apps/web/src/pages/after-sales/after-sales.ts` (types ~76–100, 153–200 · `primaryAction` ~147–216 · `secondaryActions` ~223–327 · `CaseDocKind`/`CASE_DOC_LABEL`/`canPrintHandover` ~330–346)
- Modify: `apps/web/src/pages/after-sales/ExchangeActionDialogs.tsx` (`ConfirmExchangeDialog` กิ่งขายสด · ใหม่ `DeliverCashExchangeDialog`)
- Modify: `apps/web/src/pages/after-sales/ExchangeCard.tsx`
- Modify: `apps/web/src/pages/AfterSalesCasePage.tsx` (ปุ่มพิมพ์ ~329–338 · dialog ~591–600 · `docPreview` path)
- Modify: `apps/web/src/pages/AfterSalesNewPage.tsx` (~259–264, 293–300, 364–366, 706–720)
- Test: `after-sales.test.ts` · `ExchangeCard.test.tsx`

**Interfaces:**
- Produces: `CaseDetail.replacementSaleId: string | null` · `CaseExchangeInfo.sale: { id: string; saleNumber: string } | null` · `CaseDocKind = 'receipt' | 'handover' | 'return' | 'exchange-docs'` · `canPrintCashExchangeDocs(data): boolean` · `isCashCase(data): boolean` (= `data.source === 'CASH_SALE'`) · `DeliverCashExchangeDialog`
- Consumes: Task 9 (API response) · Task 11 (routes)

- [ ] **Step 1: เทส `after-sales.ts` (แดงก่อน)** — แทนเคส `'CASH_SAME_MODEL_EXCHANGE — ยังไม่มีปุ่มใดๆ'` (บรรทัด ~460) ด้วย:
```ts
  describe('PR 5 — CASH_SAME_MODEL_EXCHANGE', () => {
    const cash = (over: Partial<CaseDetail> = {}) =>
      detail({ source: 'CASH_SALE', contractId: null, saleId: 'sale-1', outcome: 'CASH_SAME_MODEL_EXCHANGE', stage: 'AWAITING_APPROVAL', replacementProductId: 'p-new', ...over });
    it('AWAITING_APPROVAL → MGR "ยืนยันเปลี่ยนเครื่อง" (exchange-confirm) · อื่นรอ ผจก.', () => {
      for (const role of ['OWNER', 'BRANCH_MANAGER']) expect(primaryAction(cash(), role)).toEqual({ label: 'ยืนยันเปลี่ยนเครื่อง', dialog: 'exchange-confirm' });
      for (const role of ['SALES', 'FINANCE_MANAGER', 'ACCOUNTANT']) expect(primaryAction(cash(), role)).toEqual({ waitingText: 'รอ ผจก.สาขา ยืนยัน' });
      expect(secondaryActions(cash(), 'BRANCH_MANAGER').map((a) => a.label)).toEqual(['ปฏิเสธ (ใส่เหตุผล)', "เปลี่ยนเป็น 'ซ่อม' แทน"]);
    });
    it('READY_FOR_PICKUP (replacementSaleId) → STAFF "ส่งมอบเครื่องทดแทน" (exchange-deliver) · FM/ACC ไม่มีปุ่ม · ไม่มีลิงก์สัญญา', () => {
      const d = cash({ stage: 'READY_FOR_PICKUP', replacementSaleId: 'sale-1' });
      for (const role of ['OWNER', 'BRANCH_MANAGER', 'SALES']) expect(primaryAction(d, role)).toEqual({ label: 'ส่งมอบเครื่องทดแทน', dialog: 'exchange-deliver' });
      for (const role of ['FINANCE_MANAGER', 'ACCOUNTANT']) expect(primaryAction(d, role)).toBeNull();
      expect(secondaryActions(d, 'OWNER')).toEqual([]);
    });
    it('REPAIR ของใบขายสด (RECEIVED/IN_REPAIR) → MGR มีปุ่มรอง "ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม"', () => {
      for (const stage of ['RECEIVED', 'IN_REPAIR'] as const) {
        const d = detail({ source: 'CASH_SALE', contractId: null, saleId: 'sale-1', outcome: 'REPAIR', stage, repairTicket: rt({ repairSupplier: { id: 's', name: 'ศูนย์' } }) });
        expect(secondaryActions(d, 'BRANCH_MANAGER').map((a) => a.label)).toContain('ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม');
        expect(secondaryActions(d, 'SALES').map((a) => a.label)).not.toContain('ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม');
      }
    });
    it('canPrintHandover / canPrintCashExchangeDocs: READY/CLOSED พิมพ์ได้ · AWAITING ไม่ได้', () => {
      for (const stage of ['READY_FOR_PICKUP', 'CLOSED'] as const) {
        expect(canPrintHandover({ outcome: 'CASH_SAME_MODEL_EXCHANGE', stage, repairTicket: null })).toBe(true);
        expect(canPrintCashExchangeDocs({ outcome: 'CASH_SAME_MODEL_EXCHANGE', stage })).toBe(true);
      }
      expect(canPrintCashExchangeDocs({ outcome: 'CASH_SAME_MODEL_EXCHANGE', stage: 'AWAITING_APPROVAL' })).toBe(false);
      expect(canPrintCashExchangeDocs({ outcome: 'SAME_MODEL_EXCHANGE', stage: 'CLOSED' })).toBe(false);
      expect(CASE_DOC_LABEL['exchange-docs']).toBe('ใบรับคืน + ใบส่งมอบ (2 ใบ)');
    });
  });
```
แก้เคส `canPrintHandover` เดิม (บรรทัด ~705–711) ที่ปัก CASH = false ให้ลบทิ้ง · import `canPrintCashExchangeDocs, CASE_DOC_LABEL` · `detail()` เพิ่ม `replacementSaleId: null`

- [ ] **Step 2: รันให้แดง** — Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/web && npx vitest run src/pages/after-sales/after-sales.test.ts` · Expected: FAIL

- [ ] **Step 3: แก้ `after-sales.ts`**

- `CaseExchangeInfo` เพิ่ม `sale: { id: string; saleNumber: string } | null;` · `CaseDetail` เพิ่ม `replacementSaleId: string | null;`
- `export const isCashCase = (d: Pick<CaseDetail, 'source'>) => d.source === 'CASH_SALE';`
- `primaryAction`: ก่อนกิ่ง `if (outcome === 'REPAIR')` เพิ่ม:
```ts
  // PR 5 — เคสขายสด: ไม่มีสัญญาใหม่ ส่งมอบได้ทันทีที่ยืนยัน (marker = replacementSaleId)
  if (outcome === 'CASH_SAME_MODEL_EXCHANGE') {
    if (stage === 'READY_FOR_PICKUP' && data.replacementSaleId) {
      if (!STAFF_SET.has(role)) return null;
      return { label: 'ส่งมอบเครื่องทดแทน', dialog: 'exchange-deliver' };
    }
    if (stage === 'AWAITING_APPROVAL') {
      if (MGR_SET.has(role)) return { label: 'ยืนยันเปลี่ยนเครื่อง', dialog: 'exchange-confirm' };
      return { waitingText: `รอ ${APPROVER_LABEL.BRANCH_MANAGER} ยืนยัน` };
    }
    return null;
  }
```
และลบคอมเมนต์/`return null` เดิมท้ายฟังก์ชันที่พูดถึง CASH (คง `return null`)
- `secondaryActions`: ในกิ่ง `REPAIR` ทั้งสองจุด เปลี่ยนเงื่อนไข `if (isMgr && data.contractId)` เป็น `if (isMgr && (data.contractId || isCashCase(data)))` · เพิ่มกิ่ง:
```ts
  if (outcome === 'CASH_SAME_MODEL_EXCHANGE') {
    if (stage === 'AWAITING_APPROVAL') {
      if (isMgr) out.push({ kind: 'dialog', label: 'ปฏิเสธ (ใส่เหตุผล)', dialog: 'exchange-reject', destructive: true });
      if (isStaff) out.push({ kind: 'dialog', label: "เปลี่ยนเป็น 'ซ่อม' แทน", dialog: 'switch-to-repair' });
    }
    return out;
  }
```
- เอกสาร:
```ts
export type CaseDocKind = 'receipt' | 'handover' | 'return' | 'exchange-docs';
export const CASE_DOC_LABEL: Record<CaseDocKind, string> = {
  receipt: 'ใบรับฝากเครื่อง', handover: 'ใบส่งมอบ', return: 'ใบรับคืนเครื่อง', 'exchange-docs': 'ใบรับคืน + ใบส่งมอบ (2 ใบ)',
};
export function canPrintHandover(data: Pick<CaseDetail, 'outcome' | 'stage' | 'repairTicket'>): boolean {
  if (!data.outcome) return false;
  if (data.stage !== 'READY_FOR_PICKUP' && data.stage !== 'CLOSED') return false;
  return data.outcome !== 'REPAIR' || !!data.repairTicket;
}
/** PR 5 — mirror ของ returnBlockReason ฝั่ง API */
export function canPrintCashExchangeDocs(data: Pick<CaseDetail, 'outcome' | 'stage'>): boolean {
  return data.outcome === 'CASH_SAME_MODEL_EXCHANGE' && (data.stage === 'READY_FOR_PICKUP' || data.stage === 'CLOSED');
}
```

- [ ] **Step 4: รัน after-sales.test ให้เขียว** — Expected: PASS

- [ ] **Step 5: เทส ExchangeCard กิ่งขายสด (แดงก่อน)** — ใน `ExchangeCard.test.tsx`:
```ts
  it('PR 5 — เคสขายสด: ชิป "ใบขาย SL-…" + "ราคาขายเท่าเดิม · ไม่มีเงินเปลี่ยนมือ" · นอกกรอบไม่อ้าง "ผจก. ยืนยันได้"', () => {
    render(<ExchangeCard data={detail({ source: 'CASH_SALE', contractId: null, saleId: 'sale-1', outcome: 'CASH_SAME_MODEL_EXCHANGE', warrantySnapshot: { status: 'IN_7DAY_DEFECT', daysRemainingIn7Day: 0, shopWarrantyEndDate: null, manufacturerWarrantyEndDate: null, checkedAt: '2026-10-12T00:00:00.000Z' }, exchange: { ...detail().exchange!, sale: { id: 'sale-1', saleNumber: 'SL-0001' } } })} />);
    expect(screen.getByText('ใบขาย SL-0001')).toBeInTheDocument();
    expect(screen.getByText('ราคาขายเท่าเดิม · ไม่มีเงินเปลี่ยนมือ')).toBeInTheDocument();
    expect(screen.queryByText(/ผจก\. ยืนยันได้/)).not.toBeInTheDocument();
    expect(screen.getByText('ครบกำหนด 7 วันแล้ว')).toBeInTheDocument();
  });
```
(`detail()` ของไฟล์นี้เพิ่ม `replacementSaleId: null` และ `exchange.sale: null`)

- [ ] **Step 6: รันให้แดง** — Run: `npx vitest run src/pages/after-sales/ExchangeCard.test.tsx` · Expected: FAIL

- [ ] **Step 7: แก้ ExchangeCard + dialogs + หน้าเคส + หน้าเปิดเคส**

`ExchangeCard.tsx` — import `isCashCase` · ในบล็อก `ex.kind === 'SAME_MODEL'`:
```tsx
        {ex.kind === 'SAME_MODEL' && (
          <>
            {stillInWindow ? (
              <span className="…primary chip…">อยู่ในกรอบ 7 วัน · เหลือ {daysRemaining} วัน</span>
            ) : isCashCase(data) ? (
              <span className="…warning chip…">ครบกำหนด 7 วันแล้ว</span>
            ) : (
              <span className="…warning chip…">พ้นกรอบ 7 วัน — ผจก. ยืนยันได้</span>
            )}
            <span className="…primary chip…">รุ่น+ความจุตรงกัน</span>
            {isCashCase(data) && ex.sale && <span className="…muted chip…">ใบขาย {ex.sale.saleNumber}</span>}
            {isCashCase(data) && <span className="…muted chip…">ราคาขายเท่าเดิม · ไม่มีเงินเปลี่ยนมือ</span>}
          </>
        )}
```
(ใช้ className เดียวกับชิปที่มีอยู่ในไฟล์ — primary/warning/muted ตามลำดับ)

`ExchangeActionDialogs.tsx` — `ConfirmExchangeDialog`: `const isCash = isCashCase(data);` · `valid = checkCondition && checkImei && (!fromRepair || !!replacementProductId)` (เหมือนเดิม — ไม่บังคับ checkSigned) · ซ่อน checkbox "ลูกค้าเซ็นใบส่งมอบแล้ว" เมื่อ `isCash` (เอกสารออกตอนส่งมอบ) · DialogDescription: `isCash ? 'ตรวจสอบเครื่องเดิม/เครื่องทดแทนก่อนยืนยัน — สลับเครื่องบนใบขายเดิม ราคาเท่าเดิม' : …เดิม` · กล่องเตือน: เมื่อ `isCash` แสดงรายการ 5 ข้อ (กระดาน 11):
```tsx
            {isCash ? (
              <ul className="list-disc space-y-0.5 pl-4">
                <li>สลับเครื่องบนใบขายเดิม — เลขใบขายเดิม ราคาเดิม ไม่มีเงินเปลี่ยนมือ</li>
                <li>ลงรายการบัญชีสลับต้นทุน (เครื่องเดิมกลับเข้าคลัง · ต้นทุนขายเป็นของเครื่องทดแทน)</li>
                <li>เครื่องเดิม → รอเคลมผู้จัดจำหน่าย (ขอตัดจำหน่ายได้ที่เมนูตัดสินค้า)</li>
                <li>ส่ง LINE "มารับได้แล้ว" ให้ลูกค้า</li>
                <li>บันทึกผู้ยืนยันในไทม์ไลน์ · ประกันร้านและกรอบ 7 วันนับใหม่ตอนส่งมอบ</li>
              </ul>
            ) : (
              <ul className="list-disc space-y-0.5 pl-4">
                <li>สัญญาเดิมปิดเป็น &quot;เปลี่ยนเครื่องชำรุด&quot; และกลับรายการบัญชีอัตโนมัติ</li>
                <li>เปิดสัญญาใหม่เงื่อนไขเดิมด้วยเครื่องที่เลือก — ต้องเปิดใช้ที่หน้าสัญญาก่อนส่งมอบ</li>
                <li>เครื่องเดิม → รอส่งเคลมผู้จัดจำหน่าย · บันทึกผู้ยืนยันในไทม์ไลน์</li>
              </ul>
            )}
```
`ReplacementProductPicker` แสดงเมื่อ `fromRepair` (ทั้งสองแบบ — เดิม) · กล่อง "รายการบัญชีที่จะลง" (เฉพาะ `isCash` — ผู้ใช้ dialog นี้เป็น MGR ซึ่งเห็นต้นทุนได้ทั้งคู่):
```tsx
  const previewId = fromRepair ? replacementProductId : data.replacementProductId;
  const preview = useQuery<{ saleNumber: string; oldCost: string; newCost: string; lines: { accountCode: string; dr: string; cr: string }[] }>({
    queryKey: ['after-sales', 'cash-preview', caseId, previewId],
    queryFn: async () => (await api.get(`/after-sales/${caseId}/exchange/cash-preview`, { params: previewId ? { replacementProductId: previewId } : {} })).data,
    enabled: open && isCash && !!previewId,
  });
  …
        {isCash && preview.data && (
          <div className="space-y-1 rounded-lg border border-border bg-muted p-3 text-xs leading-snug">
            <p className="font-semibold text-foreground">รายการบัญชีที่จะลง (ต้นทุนเดิม {baht(preview.data.oldCost)} → เครื่องทดแทน {baht(preview.data.newCost)})</p>
            <table className="w-full"><tbody>
              {preview.data.lines.map((l, i) => (
                <tr key={i}><td className="py-0.5 pr-2 font-mono">{l.accountCode}</td><td className="py-0.5 pr-2 text-right">{l.dr !== '0.00' ? `Dr ${baht(l.dr)}` : ''}</td><td className="py-0.5 text-right">{l.cr !== '0.00' ? `Cr ${baht(l.cr)}` : ''}</td></tr>
              ))}
            </tbody></table>
            <p className="text-muted-foreground">รายได้ {preview.data.saleNumber} และเงินสดไม่เปลี่ยน</p>
          </div>
        )}
        {isCash && preview.isError && <p className="text-xs leading-snug text-destructive">{getErrorMessage(preview.error)}</p>}
```
(import `useQuery` จาก `@tanstack/react-query` และ `baht` จาก `./after-sales` — มีอยู่แล้วในไฟล์)

เพิ่ม dialog ใหม่ท้ายไฟล์:
```tsx
/** PR 5 — ส่งมอบเครื่องทดแทนของเคสขายสด (กระดาน 12): พิมพ์ 2 ใบ · ติ๊ก 2 ข้อ · อุปกรณ์ · ปิดเคส */
export function DeliverCashExchangeDialog({ caseId, open, onOpenChange, onPrintDocs }: DialogBaseProps & { onPrintDocs: () => void }) {
  const queryClient = useQueryClient();
  const [checkedDocs, setCheckedDocs] = useState(false);
  const [checkedDevice, setCheckedDevice] = useState(false);
  const [acc, setAcc] = useState({ box: false, charger: false, case: false, other: '' });
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) { setCheckedDocs(false); setCheckedDevice(false); setAcc({ box: false, charger: false, case: false, other: '' }); setNote(''); }
  }, [open]);
  const mutate = useMutation({
    mutationFn: async () =>
      (await api.post(`/after-sales/${caseId}/exchange/deliver`, {
        accessories: { box: acc.box, charger: acc.charger, case: acc.case, ...(acc.other.trim() ? { other: acc.other.trim() } : {}) },
        ...(note.trim() ? { note: note.trim() } : {}),
      })).data,
    onSuccess: () => { toast.success('ส่งมอบเครื่องทดแทนแล้ว — ปิดเคส'); queryClient.invalidateQueries({ queryKey: afterSalesKeys.all }); onOpenChange(false); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const valid = checkedDocs && checkedDevice;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>ส่งมอบเครื่องทดแทน</DialogTitle>
          <DialogDescription>พิมพ์ใบรับคืน + ใบส่งมอบให้ลูกค้าเซ็นก่อน แล้วยืนยันส่งมอบ — ประกันร้านและกรอบ 7 วันเริ่มนับใหม่วันนี้</DialogDescription>
        </DialogHeader>
        <Button variant="outline" onClick={onPrintDocs}>พิมพ์ใบรับคืน + ใบส่งมอบ (2 ใบ)</Button>
        <fieldset className="space-y-2">
          <legend className="text-xs leading-snug text-muted-foreground">อุปกรณ์ที่ส่งมอบ</legend>
          {(['box', 'charger', 'case'] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm leading-snug text-foreground">
              <input type="checkbox" checked={acc[k]} onChange={(e) => setAcc({ ...acc, [k]: e.target.checked })} className="h-4.5 w-4.5" />
              {{ box: 'กล่อง', charger: 'สายชาร์จ', case: 'เคส' }[k]}
            </label>
          ))}
          <input className={inputClass} placeholder="อื่น ๆ" maxLength={60} value={acc.other} onChange={(e) => setAcc({ ...acc, other: e.target.value })} />
        </fieldset>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm leading-snug text-foreground">
            <input type="checkbox" checked={checkedDocs} onChange={(e) => setCheckedDocs(e.target.checked)} className="h-4.5 w-4.5" />
            ลูกค้าเซ็นใบรับคืน + ใบส่งมอบแล้ว
          </label>
          <label className="flex items-center gap-2 text-sm leading-snug text-foreground">
            <input type="checkbox" checked={checkedDevice} onChange={(e) => setCheckedDevice(e.target.checked)} className="h-4.5 w-4.5" />
            ลูกค้าตรวจเครื่องทดแทน IMEI ตรง เปิดใช้งานได้
          </label>
        </div>
        <textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={areaClass} placeholder="หมายเหตุ" />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutate.isPending}>ยกเลิก</Button>
          <Button variant="primary" disabled={!valid || mutate.isPending} onClick={() => mutate.mutate()}>
            {mutate.isPending ? 'กำลังบันทึก…' : 'ยืนยันส่งมอบ + ปิดเคส'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`AfterSalesCasePage.tsx`: import `DeliverCashExchangeDialog`, `canPrintCashExchangeDocs` · ปุ่มพิมพ์ (ข้างปุ่มใบส่งมอบ):
```tsx
                        {canPrintCashExchangeDocs(data) && (
                          <Button variant="outline" size="md" onClick={() => setDocPreview('exchange-docs')}>
                            <Printer aria-hidden className="h-4 w-4" />
                            พิมพ์ใบรับคืน + ใบส่งมอบ (2 ใบ)
                          </Button>
                        )}
```
(ปุ่ม "พิมพ์ใบส่งมอบ" เดิมยังโชว์สำหรับเคสขายสดด้วย — API คืนใบส่งมอบเครื่องทดแทนให้เอง) · dialog ส่งมอบ:
```tsx
            {data.outcome === 'CASH_SAME_MODEL_EXCHANGE' ? (
              <DeliverCashExchangeDialog caseId={data.id} open={dialog === 'exchange-deliver'} onOpenChange={(next) => setDialog(next ? 'exchange-deliver' : null)} onPrintDocs={() => setDocPreview('exchange-docs')} />
            ) : (
              <DeliverExchangeConfirm caseId={data.id} open={dialog === 'exchange-deliver'} onOpenChange={(next) => setDialog(next ? 'exchange-deliver' : null)} />
            )}
```
`PdfPreview path`: `/after-sales/${data.id}/${docPreview}.pdf` ใช้ได้กับ `return`/`exchange-docs` โดยตรง (route ชื่อตรงกัน)

`AfterSalesNewPage.tsx`: `needsReplacement` และการ `form.append('replacementProductId', …)` ครอบ `'CASH_SAME_MODEL_EXCHANGE'` ด้วย · `buildSummary` เพิ่มกิ่ง `outcome === 'CASH_SAME_MODEL_EXCHANGE'` → `ทางออก "${OUTCOME_LABEL.CASH_SAME_MODEL_EXCHANGE}" · รอ ผจก.สาขา ยืนยัน · เครื่องทดแทน ${replacementText}` · บล็อกเลือกเครื่อง:
```tsx
              {outcome === 'CASH_SAME_MODEL_EXCHANGE' && (
                <div className="space-y-3">
                  <ReplacementProductPicker imei={imei} sameModel value={replacementProductId} onChange={setReplacementProductId} onProductsChange={setReplacementProducts} />
                  <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm leading-snug text-warning-strong">
                    <p>ผจก.สาขา ต้องยืนยันก่อนเปลี่ยน · สลับเครื่องบนใบขายเดิม ราคาเท่าเดิม ไม่มีเงินเปลี่ยนมือ</p>
                    <p>ประกันร้านและกรอบ 7 วันของเครื่องทดแทนนับใหม่จากวันส่งมอบ</p>
                  </div>
                </div>
              )}
```

- [ ] **Step 8: รันเทส web ทั้งโฟลเดอร์ + type-check**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/web && npx vitest run src/pages/after-sales src/pages/AfterSalesCasePage.test.tsx src/pages/AfterSalesNewPage.test.tsx` แล้ว `cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && ./tools/check-types.sh web`
Expected: PASS · 0 errors

- [ ] **Step 9: ตรวจหน้าจอจริงกับ mockup (กระดาน 11–14)** — เปิด local ตาม `bestchoice-local-dev-gotchas` · เปิดเคสขายสดใน 7 วัน → ปุ่มเปิด · ยืนยัน (BM) → dialog 5 ข้อ · READY → ปุ่ม 2 ใบ + dialog ส่งมอบ · CLOSED → ชิป/ไทม์ไลน์ · ถ่าย screenshot เก็บใน `~/Documents/BESTCHOICE-docs/pr5/` (นอก repo)

- [ ] **Step 10: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && git add apps/web/src && git commit -m "feat(web): หลังการขาย — เปิด/ยืนยัน/ส่งมอบ/พิมพ์ 2 ใบ ของเคสขายสด (PR5 T14)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Integration บน DB จริง — ทั้งเส้นตามสเปก §12

**Files:**
- Create: `apps/api/src/modules/after-sales/__tests__/after-sales-cash-exchange.integration.spec.ts`

**Interfaces:** consumes ทุก task ก่อนหน้า · wiring ลอก `after-sales-exchange.integration.spec.ts` (บรรทัด 1–207) + `new ShopCashExchangeTemplate(journal, prisma, companyResolver)`, `new ShopAccountResolver(prisma)`, `companyResolver` ต่อท้าย `AfterSalesExchangeService` · ต้อง `seedShopCoa(prisma)` (ดู `exchange-priced-flow.integration.spec.ts` วิธี import) เพราะเคสนี้ลง JE จริง

- [ ] **Step 1: เขียน spec (แดงก่อน — รันแล้วต้องล้มที่ assertion ไม่ใช่ที่ wiring)**

โครง (ส่วน wiring 1–207 ลอกจาก `after-sales-exchange.integration.spec.ts` แล้วเพิ่ม 3 อาร์กิวเมนต์ท้าย `AfterSalesExchangeService` ตาม Task 9 · import เพิ่ม: `ShopCashExchangeTemplate`, `ShopStockWriteOffTemplate`, `StockAdjustmentsService`, `StockAdjustmentNumberService`, `SaleVoidService`, `ExchangeCancelReversalTemplate`, `AfterSalesDocumentService`, `AfterSalesPdfRenderer`, `seedShopCoa` (ดูวิธี import ใน `exchange-priced-flow.integration.spec.ts`), `CASH_DAY7_REASON`/`CASH_NOT_USED_REASON`/`CASH_OUT_OF_WINDOW_REASON`):
```ts
const PREFIX = 'AFCASHTEST-';
const USED_COST_OLD = '10700.00';
const USED_COST_NEW = '10500.00';
const createdCaseIds: string[] = [];
const createdSaleIds: string[] = [];
const createdProductIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdAdjustmentIds: string[] = [];

const cashExchangeTemplate = new ShopCashExchangeTemplate(journal, prisma as never, companyResolver);
const shopAccounts = new ShopAccountResolver(prisma as never);
const exchangeSvc = new AfterSalesExchangeService(
  prisma as never, querySvc, defect, repairTickets, audit, contractExchange, exchangeCancel, lookupSvc, line,
  cashExchangeTemplate, shopAccounts, companyResolver,
);
const svc = new AfterSalesService(lookupSvc, caseSvc, querySvc, repairSvc, exchangeSvc);
const saleVoid = new SaleVoidService(prisma as never, new ExchangeCancelReversalTemplate(journal, prisma as never));
const stockAdjust = new StockAdjustmentsService(
  prisma as never, new ShopStockWriteOffTemplate(journal, prisma as never, companyResolver), shopAccounts, companyResolver,
  storage, new StockAdjustmentNumberService(prisma as never), audit,
);
const docs = new AfterSalesDocumentService(prisma as never, storage, querySvc, new AfterSalesPdfRenderer());

async function seedCashSaleFixture(opts: { tag: string; daysAgo: number; saleType?: 'CASH' | 'EXTERNAL_FINANCE'; category?: 'PHONE_USED' | 'PHONE_NEW' }) {
  const soldAt = new Date(Date.now() - opts.daysAgo * 86_400_000);
  const saleType = opts.saleType ?? 'CASH';
  const customer = await prisma.customer.create({ data: { name: `${PREFIX}Customer-${opts.tag}-${RUN}`, phone: `097${RUN_NUM}`.slice(0, 9) + opts.tag.slice(0, 1) } });
  createdCustomerIds.push(customer.id);
  const product = await prisma.product.create({
    data: {
      name: `${PREFIX}Old-${opts.tag}`, brand: `${PREFIX}Brand`, model: `${PREFIX}Model-${opts.tag}`, storage: '128GB',
      imeiSerial: `${PREFIX}${RUN}-${opts.tag}-OLD`, category: opts.category ?? 'PHONE_USED',
      costPrice: new Prisma.Decimal(USED_COST_OLD), branchId, status: saleType === 'EXTERNAL_FINANCE' ? 'SOLD_INSTALLMENT' : 'SOLD_CASH',
    },
  });
  createdProductIds.push(product.id);
  const sale = await prisma.sale.create({
    data: {
      saleNumber: `${PREFIX}${RUN}-${opts.tag}-SL`, saleType, customerId: customer.id, productId: product.id, branchId, salespersonId: adminId,
      sellingPrice: new Prisma.Decimal('13900.00'), netAmount: new Prisma.Decimal('13900.00'), createdAt: soldAt,
      shopWarrantyStartDate: soldAt, shopWarrantyEndDate: new Date(soldAt.getTime() + 60 * 86_400_000),
      ...(saleType === 'EXTERNAL_FINANCE' ? { financeCompany: 'GFIN' } : {}),
      costSnapshot: { create: { mainProductCost: new Prisma.Decimal(USED_COST_OLD) } },
    },
  });
  createdSaleIds.push(sale.id);
  return { customerId: customer.id, productId: product.id, saleId: sale.id, imei: product.imeiSerial as string, brand: product.brand, model: product.model, saleNumber: sale.saleNumber };
}

async function seedReplacement(tag: string, fx: { brand: string; model: string }, over: { status?: 'IN_STOCK' | 'SOLD_CASH'; branch?: string } = {}) {
  const p = await prisma.product.create({
    data: {
      name: `${PREFIX}New-${tag}`, brand: fx.brand, model: fx.model, storage: '128GB', imeiSerial: `${PREFIX}${RUN}-${tag}-NEW`,
      category: 'PHONE_USED', costPrice: new Prisma.Decimal(USED_COST_NEW), branchId: over.branch ?? branchId, status: over.status ?? 'IN_STOCK',
    },
  });
  createdProductIds.push(p.id);
  return p;
}

/** Σ(debit − credit) ของบัญชี code ในรายการ POSTED ที่ metadata.saleId = saleId */
async function gl(code: string, saleId: string): Promise<string> {
  const lines = await prisma.journalLine.findMany({
    where: { accountCode: code, deletedAt: null, journalEntry: { status: 'POSTED', deletedAt: null, metadata: { path: ['saleId'], equals: saleId } } },
    select: { debit: true, credit: true },
  });
  return lines.reduce((s, l) => s.plus(l.debit).minus(l.credit), new Prisma.Decimal(0)).toFixed(2);
}

async function openCashCase(fx: { imei: string }, replacementId: string, user: ReturnType<typeof OWNER>) {
  const r = await svc.createCase(
    { imei: fx.imei, symptom: 'จอแตกมุมขวา กดไม่ติด', accessories: { box: true, charger: true }, unlockConfirmed: true, outcome: 'CASH_SAME_MODEL_EXCHANGE', branchId, replacementProductId: replacementId } as never,
    [fakeJpeg('intake.jpg')], user,
  );
  createdCaseIds.push(r.id);
  return r;
}

describe('after-sales — เปลี่ยนรุ่นเดิมขายสด (PR 5) บน DB จริง', () => {
  beforeAll(async () => {
    await seedShopCoa(prisma);
    // … branch/admin/sales/bm seed เหมือนไฟล์พี่ (บรรทัด 365–410) …
  });

  it('1) lookup: มือสอง 3 วัน → เปิด · เครื่องใหม่ → ปิด (มือสองเท่านั้น) · 10 วัน → เกินกรอบ · 7 วันพอดี → ครบกำหนด', async () => {
    const used3 = await seedCashSaleFixture({ tag: 'L1', daysAgo: 3 });
    const new3 = await seedCashSaleFixture({ tag: 'L2', daysAgo: 3, category: 'PHONE_NEW' });
    const used10 = await seedCashSaleFixture({ tag: 'L3', daysAgo: 10 });
    const used7 = await seedCashSaleFixture({ tag: 'L4', daysAgo: 7 });
    const pick = async (imei: string) => (await svc.lookup({ imei }, OWNER())).outcomes.find((o) => o.outcome === 'CASH_SAME_MODEL_EXCHANGE')!;
    expect(await pick(used3.imei)).toMatchObject({ enabled: true, implemented: true });
    expect(await pick(new3.imei)).toMatchObject({ enabled: false, reason: CASH_NOT_USED_REASON });
    expect(await pick(used10.imei)).toMatchObject({ enabled: false, reason: CASH_OUT_OF_WINDOW_REASON });
    expect(await pick(used7.imei)).toMatchObject({ enabled: false, reason: CASH_DAY7_REASON });
  });

  it('2) เปิดเคส → BM ยืนยัน → GL/ใบขาย/เครื่อง/เคส ถูกต้อง และ getCase ซ้ำไม่ถอย stage', async () => {
    const fx = await seedCashSaleFixture({ tag: 'C2', daysAgo: 3 });
    const next = await seedReplacement('C2', fx);
    const created = await openCashCase(fx, next.id, SALES_USER());
    expect(created).toMatchObject({ outcome: 'CASH_SAME_MODEL_EXCHANGE', stage: 'AWAITING_APPROVAL' });

    const r = await svc.confirmSameModel(created.id, {}, BM_USER());
    expect(r).toMatchObject({ stage: 'READY_FOR_PICKUP', replacementSaleId: fx.saleId, saleNumber: fx.saleNumber });
    expect(r.journalEntryNo).toMatch(/^JE-/);

    expect(await gl('S11-2002', fx.saleId)).toBe('200.00');
    expect(await gl('S50-1102', fx.saleId)).toBe('-200.00');
    expect(await gl('S41-1102', fx.saleId)).toBe('0.00');
    expect(await gl('S11-1201', fx.saleId)).toBe('0.00');

    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: fx.saleId }, include: { costSnapshot: true } });
    expect(sale.productId).toBe(next.id);
    expect(sale.exchangeCaseId).toBe(created.id);
    expect(sale.costSnapshot!.mainProductCost.toFixed(2)).toBe(USED_COST_NEW);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: fx.productId } })).status).toBe('DEFECT_RETURN');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: next.id } })).status).toBe('SOLD_CASH');

    const row = await prisma.afterSalesCase.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ stage: 'READY_FOR_PICKUP', replacementSaleId: fx.saleId, replacementProductId: next.id, replacementContractId: null });
    // Review Focus 3 — reconcile ตอนอ่านต้องไม่ดันกลับ
    const again = await svc.getCase(created.id, SALES_USER());
    expect(again.stage).toBe('READY_FOR_PICKUP');
    expect((await prisma.afterSalesCase.findUniqueOrThrow({ where: { id: created.id } })).stage).toBe('READY_FOR_PICKUP');
  });

  it('3) SALES ยืนยัน → 403 · สองคำขอพร้อมกัน → 1 สำเร็จ 1 ได้ 409 · JE 1 ใบ', async () => {
    const fx = await seedCashSaleFixture({ tag: 'C3', daysAgo: 2 });
    const next = await seedReplacement('C3', fx);
    const created = await openCashCase(fx, next.id, SALES_USER());
    await expect(svc.confirmSameModel(created.id, {}, SALES_USER())).rejects.toBeInstanceOf(ForbiddenException);
    const results = await Promise.allSettled([svc.confirmSameModel(created.id, {}, BM_USER()), svc.confirmSameModel(created.id, {}, OWNER())]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    const jes = await prisma.journalEntry.findMany({ where: { metadata: { path: ['afterSalesCaseId'], equals: created.id }, deletedAt: null } });
    expect(jes).toHaveLength(1);
  });

  it('4) เครื่องทดแทนถูกขายก่อนยืนยัน → 409 · ใบขายไม่สลับ · ไม่มี JE · การจองเคสถูกปล่อย', async () => {
    const fx = await seedCashSaleFixture({ tag: 'C4', daysAgo: 1 });
    const next = await seedReplacement('C4', fx);
    const created = await openCashCase(fx, next.id, SALES_USER());
    await prisma.product.update({ where: { id: next.id }, data: { status: 'SOLD_CASH' } });
    await expect(svc.confirmSameModel(created.id, {}, BM_USER())).rejects.toThrow(/เครื่องทดแทน/);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: fx.saleId } })).productId).toBe(fx.productId);
    expect(await prisma.journalEntry.count({ where: { metadata: { path: ['afterSalesCaseId'], equals: created.id } } })).toBe(0);
    expect((await prisma.afterSalesCase.findUniqueOrThrow({ where: { id: created.id } })).approvedAt).toBeNull();
  });

  it('5) ส่งมอบ → ประกัน/กรอบ 7 วันนับใหม่ · เคส CLOSED · DELIVERED มีอุปกรณ์ · เปิดเคสใหม่บนเครื่องทดแทนได้ทางออกเปิดอีกครั้ง', async () => {
    const fx = await seedCashSaleFixture({ tag: 'C5', daysAgo: 6 });
    const next = await seedReplacement('C5', fx);
    const created = await openCashCase(fx, next.id, SALES_USER());
    await svc.confirmSameModel(created.id, {}, BM_USER());
    const before = Date.now();
    await svc.deliver(created.id, SALES_USER(), { accessories: { box: true, charger: true }, note: 'ลูกค้ารับเอง' });
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: fx.saleId } });
    expect(sale.shopWarrantyStartDate!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(Math.round((sale.shopWarrantyEndDate!.getTime() - sale.shopWarrantyStartDate!.getTime()) / 86_400_000)).toBe(60);
    const row = await prisma.afterSalesCase.findUniqueOrThrow({ where: { id: created.id }, include: { events: true } });
    expect(row.stage).toBe('CLOSED');
    expect(row.closedAt).not.toBeNull();
    expect(row.events.find((e) => e.kind === 'DELIVERED')!.note).toContain('อุปกรณ์: กล่อง, สายชาร์จ');
    // เปลี่ยนซ้ำ: เครื่องทดแทนมีปัญหาอีก → lookup ด้วย IMEI ทดแทน → กรอบนับจากวันส่งมอบ (วันนี้) ⇒ เปิด
    const again = await svc.lookup({ imei: next.imeiSerial! }, OWNER());
    expect(again.sale?.id).toBe(fx.saleId);
    expect(again.outcomes.find((o) => o.outcome === 'CASH_SAME_MODEL_EXCHANGE')).toMatchObject({ enabled: true });
  });

  it('6) เอกสาร: AWAITING → 400 · READY/CLOSED → return.pdf / handover.pdf / exchange-docs.pdf ได้ Buffer', async () => {
    const fx = await seedCashSaleFixture({ tag: 'C6', daysAgo: 2 });
    const next = await seedReplacement('C6', fx);
    const created = await openCashCase(fx, next.id, SALES_USER());
    await expect(docs.render(created.id, 'RETURN', OWNER())).rejects.toBeInstanceOf(BadRequestException);
    await svc.confirmSameModel(created.id, {}, BM_USER());
    for (const kind of ['RETURN', 'HANDOVER'] as const) {
      const { pdf } = await docs.render(created.id, kind, OWNER());
      expect(pdf.length).toBeGreaterThan(1000);
    }
    const both = await docs.renderCashExchangeDocs(created.id, OWNER());
    expect(both.pdf.length).toBeGreaterThan(1000);
    const printed = await prisma.afterSalesEvent.findMany({ where: { caseId: created.id, kind: 'PRINTED' } });
    expect(printed.map((e) => e.note)).toEqual(expect.arrayContaining(['ใบรับคืนเครื่อง', 'ใบส่งมอบเครื่องทดแทน', 'พิมพ์ใบรับคืนเครื่อง + ใบส่งมอบเครื่องทดแทน']));
  });

  it('7) ยกเลิกใบขายที่เปลี่ยนเครื่องแล้ว → 400 G9', async () => {
    const fx = await seedCashSaleFixture({ tag: 'C7', daysAgo: 2 });
    const next = await seedReplacement('C7', fx);
    const created = await openCashCase(fx, next.id, SALES_USER());
    await svc.confirmSameModel(created.id, {}, BM_USER());
    await expect(saleVoid.voidSale(fx.saleId, 'ลูกค้าเปลี่ยนใจไม่ซื้อแล้ว', { id: adminId, role: 'OWNER' } as never)).rejects.toThrow(/เปลี่ยนเครื่องแล้ว/);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: fx.saleId } })).deletedAt).toBeNull();
  });

  it('8) ขอตัดจำหน่ายเครื่อง DEFECT_RETURN → เจ้าของอนุมัติ → Dr S53-1102 / Cr S11-2002 10,700', async () => {
    const fx = await seedCashSaleFixture({ tag: 'C8', daysAgo: 2 });
    const next = await seedReplacement('C8', fx);
    const created = await openCashCase(fx, next.id, SALES_USER());
    await svc.confirmSameModel(created.id, {}, BM_USER());
    const req = await stockAdjust.createRequest({ productId: fx.productId, reason: 'WRITE_OFF', note: 'เคลมไม่ได้' } as never, [], OWNER() as never);
    createdAdjustmentIds.push(req.id);
    await stockAdjust.approve(req.id, OWNER() as never);
    const adj = await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: req.id }, include: { journalEntry: { include: { lines: true } } } });
    expect(adj.status).toBe('APPROVED');
    const lines = adj.journalEntry!.lines;
    expect(lines.find((l) => l.accountCode === 'S53-1102')!.debit.toFixed(2)).toBe(USED_COST_OLD);
    expect(lines.find((l) => l.accountCode === 'S11-2002')!.credit.toFixed(2)).toBe(USED_COST_OLD);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: fx.productId } })).status).toBe('WRITTEN_OFF');
  });

  it('9) ไฟแนนซ์นอก → เครื่อง SOLD_INSTALLMENT ก่อน/หลัง · JE ลงตามปกติ', async () => {
    const fx = await seedCashSaleFixture({ tag: 'C9', daysAgo: 2, saleType: 'EXTERNAL_FINANCE' });
    const next = await seedReplacement('C9', fx);
    const created = await openCashCase(fx, next.id, SALES_USER());
    await svc.confirmSameModel(created.id, {}, BM_USER());
    expect((await prisma.product.findUniqueOrThrow({ where: { id: next.id } })).status).toBe('SOLD_INSTALLMENT');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: fx.productId } })).status).toBe('DEFECT_RETURN');
    expect(await gl('S11-2002', fx.saleId)).toBe('200.00');
  });

  it('10) งวดบัญชี SHOP ปิด → ยืนยัน 400 · ไม่มีอะไรเปลี่ยน', async () => {
    const fx = await seedCashSaleFixture({ tag: 'C10', daysAgo: 2 });
    const next = await seedReplacement('C10', fx);
    const created = await openCashCase(fx, next.id, SALES_USER());
    const shop = await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'SHOP', deletedAt: null } });
    const now = new Date();
    const period = await prisma.accountingPeriod.upsert({
      where: { companyId_year_month: { companyId: shop.id, year: now.getFullYear(), month: now.getMonth() + 1 } },
      create: { companyId: shop.id, year: now.getFullYear(), month: now.getMonth() + 1, status: 'CLOSED', closedAt: new Date(now.getTime() - 48 * 3600_000) },
      update: { status: 'CLOSED', closedAt: new Date(now.getTime() - 48 * 3600_000) },
    });
    try {
      await expect(svc.confirmSameModel(created.id, {}, BM_USER())).rejects.toBeInstanceOf(BadRequestException);
      expect((await prisma.sale.findUniqueOrThrow({ where: { id: fx.saleId } })).productId).toBe(fx.productId);
      expect((await prisma.product.findUniqueOrThrow({ where: { id: next.id } })).status).toBe('IN_STOCK');
    } finally {
      await prisma.accountingPeriod.update({ where: { id: period.id }, data: { status: 'OPEN', closedAt: null } });
    }
  });

  afterAll(async () => {
    const jes = await prisma.journalEntry.findMany({ where: { OR: [{ metadata: { path: ['flow'], equals: 'shop-cash-exchange' } }, { metadata: { path: ['flow'], equals: 'shop-stock-writeoff' } }], reference: { startsWith: 'sale:' } }, select: { id: true } });
    const jeIds = jes.map((j) => j.id);
    if (createdAdjustmentIds.length) await prisma.stockAdjustment.deleteMany({ where: { id: { in: createdAdjustmentIds } } });
    if (jeIds.length) { await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } }); await prisma.journalEntry.deleteMany({ where: { id: { in: jeIds } } }); }
    if (createdSaleIds.length) await prisma.sale.updateMany({ where: { id: { in: createdSaleIds } }, data: { exchangeCaseId: null } });
    if (createdCaseIds.length) { await prisma.afterSalesEvent.deleteMany({ where: { caseId: { in: createdCaseIds } } }); await prisma.afterSalesCase.deleteMany({ where: { id: { in: createdCaseIds } } }); }
    if (createdSaleIds.length) { await prisma.saleCostSnapshot.deleteMany({ where: { saleId: { in: createdSaleIds } } }); await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } }); }
    if (createdProductIds.length) await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    if (createdCustomerIds.length) await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await prisma.$disconnect();
  });
});
```
(`accountingPeriod` unique key ชื่อจริงดูใน `schema.prisma` ก่อนใช้ `upsert` — ถ้าชื่อไม่ใช่ `companyId_year_month` ให้ใช้ `findFirst` + `create`/`update` แทน · การล้าง JE ตัดจำหน่ายของเคส 8: กรองด้วย `metadata.adjustmentId in createdAdjustmentIds` แทน `reference startsWith 'sale:'` เพราะ reference ของมันคือ `sa:<id>` · `StockAdjustmentsService` constructor ลอกจาก `stock-adjustments.service.spec.ts` บรรทัด 104–111)

- [ ] **Step 2: รัน (แดงที่ assertion หรือเขียวทั้งหมด)**

Run: `source ~/Documents/BESTCHOICE-docs/pr4-advance-vat/test-env.sh && cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api && npx vitest run --no-file-parallelism src/modules/after-sales/__tests__/after-sales-cash-exchange.integration.spec.ts`
Expected: PASS 10/10 — ถ้าแดง = บั๊กจริงในโค้ด task ก่อนหน้า ใช้ systematic-debugging ห้ามแก้ assertion

- [ ] **Step 3: รัน integration ของ after-sales ทั้งโฟลเดอร์ + jest ทั้งโมดูลที่แตะ**

Run: `… npx vitest run --no-file-parallelism src/modules/after-sales/__tests__/*.integration.spec.ts src/modules/sales/__tests__/sale-void.integration.spec.ts` และ `npm --prefix …/apps/api run test --silent -- src/modules/after-sales src/modules/sales src/modules/inventory src/modules/repair-tickets src/modules/journal/shop-templates`
Expected: PASS ทั้งหมด

- [ ] **Step 4: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && git add apps/api/src/modules/after-sales/__tests__ && git commit -m "test(after-sales): integration เปลี่ยนรุ่นเดิมขายสดทั้งเส้นบน DB จริง (PR5 T15)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: กติกาบัญชี · bump version · regression ทั้งชุด

**Files:**
- Modify: `.claude/rules/accounting.md` (หัวข้อใหม่หลัง "ตัดสินค้า — สูญหาย/เสียหาย/ตัดจำหน่าย/พบของคืน")
- Modify: `apps/web/package.json` (`"version": "26.10.22"`)
- Modify: `docs/superpowers/plans/2026-10-12-after-sales-pr5-cash-exchange.md` (บรรทัดสถานะท้ายไฟล์)

- [ ] **Step 1: เขียนหัวข้อใน accounting.md** — ชื่อ `## เปลี่ยนรุ่นเดิมขายสด — สลับเครื่องบนใบขายเดิม + JE สลับต้นทุน (PR 5 · 2026-10-12)` ประกอบด้วย: อ้างสเปก/แผน/คำตอบข้อ 10 · JE 4 บรรทัดตัวอย่าง 10,700/10,500 · metadata/flow/key/reference ของ `ShopCashExchangeTemplate` (ตาราง SHOP templates เพิ่มแถว) · ต้นทุนเดิมมาจาก `SaleCostSnapshot` (ไม่มี = 400) · สถานะเครื่องตาม `SALE_TYPE_PRODUCT_STATUS` · ด่าน G9 ในตารางด่านของ void sale · `DEFECT_RETURN` ตัดจำหน่ายได้ (ข้อ ③) · marker `replacementSaleId` ของ deriveStage · กรอบ 7 วันจาก `soldAt` · วันที่ 7 ปิด · ไม่มี override · เอกสาร 2 ใบใช้เลขเคส · ที่ยังเปิดอยู่: "ได้เครื่องแทนจากผู้จัดจำหน่าย" / LIFF / ย้อนรายการ (ฝ่ายบัญชี)

- [ ] **Step 2: bump version** — `apps/web/package.json` `"version": "26.10.22"`

- [ ] **Step 3: regression ทั้งชุด**

Run (แยกกลุ่มกัน OOM — `NODE_OPTIONS=--max-old-space-size=8192`): `source ~/Documents/BESTCHOICE-docs/pr4-advance-vat/test-env.sh && cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5/apps/api && NODE_OPTIONS=--max-old-space-size=8192 npm run test --silent -- src/modules/after-sales src/modules/sales src/modules/inventory src/modules/repair-tickets src/modules/journal src/modules/defect-exchange` · web: `cd …/apps/web && npx vitest run` · `./tools/check-types.sh all` · vitest integration กลุ่ม after-sales/sales/inventory ตาม Task 15 Step 3
Expected: PASS ทั้งหมด · บันทึกผลลง ledger

- [ ] **Step 4: Commit + อัปเดตสถานะแผน**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales-pr5 && git add .claude/rules/accounting.md apps/web/package.json docs/superpowers/plans && git commit -m "docs(accounting): กติกาเปลี่ยนรุ่นเดิมขายสด (PR 5) + bump web 26.10.22 (PR5 T16)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## หลังจบทุก task

- ผู้ตรวจอิสระ (fresh context, โมเดลสูงสุด) อ่านทั้งสาขาจาก review package + สเปก + Review Focus ด้านบน + `Ruling:` ใน ledger · Critical/Important แก้ใน 1 รอบด้วย TDD · Minor ลง ledger
- push + เปิด PR base `main` (PR body: สรุป · ตาราง JE · คำตัดสินเจ้าของ ①–⑧ · สมมติฐาน 5 ข้อ · minor ที่ deferred · ลงท้าย `🤖 Generated with [Claude Code](https://claude.com/claude-code)`) · **merge = เจ้าของพิมพ์คำสั่งเอง**
