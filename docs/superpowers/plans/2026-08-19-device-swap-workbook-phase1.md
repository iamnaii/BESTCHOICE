# Device Swap Workbook — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** วางรากฐานตาม spec `docs/superpowers/specs/2026-08-19-device-swap-netting-cancel-workbook-design.md` §3 — เปิดบัญชี S21-3001, เปลี่ยน A.4 เป็นซื้อคืนที่ราคารับซื้อ (+snapshot/restore costPrice), เปลี่ยน A.2 เป็นวิธีสุทธิ (ตัดขา Cr 41-1101), และติด reference types บน 11-2107 (`classifyShopReceivable`)

**Architecture:** แก้ JE template 2 ตัว (A.2, A.4) + caller (`finalizeAfterActivation`) + cancel restore + additive migration 1 คอลัมน์ + util ใหม่ 1 ไฟล์ ทั้งหมด forward-only ไม่ backfill JE เก่า — แถวเก่า classify ตอนอ่านผ่าน `metadata.flow` fallback

**Tech Stack:** NestJS + Prisma (Decimal เท่านั้น), jest (unit `*.spec.ts`), vitest (`*.integration.spec.ts` ต้องมี local DB ตาม docker setup)

## Global Constraints

- เงินใช้ `Decimal` (`@db.Decimal(12, 2)`) เท่านั้น — ห้าม `Number()`/float
- Error messages ภาษาไทย
- Migration เป็น additive เท่านั้น (nullable column) — ห้าม rewrite ตาราง
- Idempotency keys / flow strings เดิม **ห้ามเปลี่ยน** (`shop-exchange-return`, `exchange-close-old-21-1106`, `exchange-buyback-receivable-11-2107`)
- Forward-only: ห้าม backfill JE เก่า
- ทำงานบน branch `feat/device-swap-netting-workbook` (มีอยู่แล้ว)
- Prod rollout หลัง merge: ต้องรัน `seed:coa` (Cloud Run Job `bestchoice-seed-coa`) — บันทึกใน PR body
- Integration tests: รันจาก `apps/api` ด้วย `npx vitest run <file>` (ต้องมี local DB); unit tests: `npx jest <path>`

---

### Task 1: เพิ่มบัญชี S21-3001 ในผัง SHOP

**Files:**
- Modify: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/shop-coa.csv` (แทรกหลังบรรทัด `S21-2002,...` — ปัจจุบันคือบรรทัด 30, ก่อนบรรทัด `S21-31XX กลุ่มภาษีหัก...`)
- Test: `apps/api/src/modules/journal/exchange-coa.spec.ts` (เพิ่ม describe block)

**Interfaces:**
- Consumes: `loadCoaFromCsv(path)` จาก `apps/api/src/modules/journal/__tests__/csv-fixture-loader.ts` — คืน rows ที่มี `{ code, name, type, normalBalance, category, notes, peakCode }`
- Produces: บัญชี `S21-3001` ในผัง SHOP — Task 4 จะโพสต์ JE เข้าบัญชีนี้ (seeder `seed-coa-shop.ts` เป็น CSV-driven — ไม่ต้องแก้ seeder)

- [ ] **Step 1: เขียน failing test**

เพิ่มท้ายไฟล์ `apps/api/src/modules/journal/exchange-coa.spec.ts` (ถ้าไฟล์ยังไม่ import loader/path ให้เพิ่ม import ด้วย):

```ts
import * as path from 'path';
import { loadCoaFromCsv } from './__tests__/csv-fixture-loader';

describe('S21-3001 เจ้าหนี้-FINANCE ค่าเครื่องรับคืน (workbook 2026-08-19)', () => {
  it('shop-coa.csv มีบัญชี S21-3001 เป็นหนี้สิน ยอดปกติ Cr', () => {
    const rows = loadCoaFromCsv(
      path.join(__dirname, '__tests__/fixtures/cpa-cases/shop-coa.csv'),
    );
    const row = rows.find((r) => r.code === 'S21-3001');
    expect(row).toBeDefined();
    expect(row!.normalBalance).toBe('Cr');
    expect(row!.name).toContain('FINANCE');
  });
});
```

- [ ] **Step 2: รัน test ให้ fail**

Run: `cd apps/api && npx jest src/modules/journal/exchange-coa.spec.ts -t "S21-3001"`
Expected: FAIL — `row` เป็น undefined

- [ ] **Step 3: เพิ่มแถว CSV**

แทรก 2 บรรทัดนี้ใน `shop-coa.csv` หลังบรรทัด `S21-2002,เงินรับล่วงหน้า - มัดจำสินค้า,...` (ก่อนบรรทัด `S21-31XX กลุ่มภาษีหัก ณ ที่จ่าย...`):

```csv
S21-30XX กลุ่มเจ้าหนี้ระหว่างกิจการ (Inter-co payable — mirror ของ S11-30XX),,,,,,,,
S21-3001,เจ้าหนี้ - FINANCE ค่าเครื่องรับคืน,หนี้สิน,Cr,เจ้าหนี้,ไม่,เจ้าหนี้ระหว่างกิจการ — ราคารับซื้อเครื่องรับคืนจากเปลี่ยนเครื่อง/เงินเรียกคืนจากยกเลิกสัญญา รอหักกลบในรอบจ่าย INTER-CO (คำสั่งเจ้าของ 2026-08-19),ใช้งาน,
```

ข้อควรระวัง: ห้ามมี comma ในช่องหมายเหตุ (loader split ด้วย comma) — ข้อความข้างบนตรวจแล้วไม่มี

- [ ] **Step 4: รัน test ให้ผ่าน**

Run: `cd apps/api && npx jest src/modules/journal/exchange-coa.spec.ts`
Expected: PASS ทุกข้อ (รวม assertions เดิมเรื่อง 42-1106/42-1107)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/shop-coa.csv apps/api/src/modules/journal/exchange-coa.spec.ts
git commit -m "feat(coa): เพิ่ม S21-3001 เจ้าหนี้-FINANCE ค่าเครื่องรับคืน (workbook 2026-08-19 Phase 1)"
```

---

### Task 2: A.2 เปลี่ยนเป็นวิธีสุทธิ (ตัดขา Cr 41-1101)

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/exchange-close-old-21-1106.template.ts`
- Test (แก้ assertions): `apps/api/src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts`

**Interfaces:**
- Consumes: `ExchangeCloseOldInput` เดิม (ไม่เปลี่ยน signature)
- Produces: JE A.2 แบบวิธีสุทธิ — **ไม่มีบรรทัด 41-1101 อีกต่อไป**; plug ใหม่ = `(buyback + unearned + deferredVat) − (gross + vatRec×2)` (ติดลบ = ขาดทุน Dr 51-1102) — ตัวเลข workbook: loss 126.64; ตัวเลข fixture ใน integration spec: loss **126.68** (เดิม 4,126.68)

- [ ] **Step 1: แก้ assertions ใน integration spec ให้เป็น golden ใหม่ (failing test)**

ใน `exchange-priced-flow.integration.spec.ts`:

1. หา `expect(sumSide(je2Lines, '41-1101', 'cr').toFixed(2)).toBe('4000.00');` (ปัจจุบันบรรทัด ~549) → เปลี่ยนเป็น:
```ts
      // วิธีสุทธิ (workbook 2026-08-19): A.2 ไม่ตั้งรายได้ 41-1101 อีกต่อไป
      expect(sumSide(je2Lines, '41-1101', 'cr').toFixed(2)).toBe('0.00');
```
2. grep หา `4126.68` ทุกจุดในไฟล์ → เปลี่ยนเป็น `126.68` (คือ assertion ขา `51-1102` ของ JE2 และยอดรวม JE2 ถ้ามี — ยอดรวม Dr=Cr ของ JE2 จะลดลง 4,000.00 จากเดิม)
3. grep หา assertion ยอดรวม JE2 (ถ้าปักไว้) แล้วลด 4,000.00 — ถ้าไม่แน่ใจให้รัน test แล้วอ่านค่า actual จาก diff

- [ ] **Step 2: รัน integration ให้ fail**

Run: `cd apps/api && npx vitest run src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts`
Expected: FAIL ที่ assertion ใหม่ (actual ยังเป็น 4000.00 / 4126.68) — ต้องมี local DB; ถ้าไม่มี DB ให้ start docker ตาม README ก่อน

- [ ] **Step 3: แก้ template**

ใน `exchange-close-old-21-1106.template.ts`:

(a) แทน jsdoc block บรรทัด 23-39 ด้วย:

```ts
/**
 * Exchange A.2 — Close old contract, clearing all outstanding balances via the
 * 21-1106 internal clearing account, with a plug-balance for any gain/loss.
 *
 * วิธีสุทธิ (workbook เจ้าของ 2026-08-19 — spec 2026-08-19-device-swap-netting-
 * cancel-workbook-design.md Gap ข้อ 6): ไม่ตั้งรายได้ 41-1101 จากดอกเบี้ยรอตัด
 * ที่เหลือ — ขาดทุน/กำไร = ราคารับซื้อ เทียบมูลค่าตามบัญชีสุทธิรวม VAT เท่านั้น.
 * (เดิมเป็นวิธี gross: Cr 41-1101 [unearned] + plug พองขึ้นเท่ากัน — กำไรสุทธิ
 * เท่ากันแต่บรรทัด P&L พองเกินคู่ ซึ่ง workbook ระบุ "ห้ามสลับกัน" กับเคสปิดยอด
 * ที่ใช้วิธี gross ผ่าน 52-1106.)
 *
 *   diff = (buyback + unearned + deferredVat) − (gross + vatRec + vatRec)
 *        (ติดลบ = ขาดทุน; ตัวเลข workbook Case 8: 8,000 − 8,126.64 = −126.64)
 *
 *   Dr 21-1106   [buyback]                         — clearing account
 *   Dr 11-2106   [oldUnearnedInterestOutstanding]  — reverse contra-asset
 *   Dr 21-2102   [oldDeferredVatOutstanding]       — reverse deferred VAT
 *   Dr 51-1102   [|diff|]  if diff < 0 (LOSS)
 *     Cr 11-2101 [oldGrossOutstanding]             — clear HP receivable
 *     Cr 11-2105 [oldVatReceivableOutstanding]     — clear VAT receivable
 *     Cr 21-2101 [oldVatReceivableOutstanding]     — recognize VAT to ภ.พ.30
 *     Cr 41-1102 [diff]    if diff > 0 (GAIN — unreachable ภายใต้นโยบายธุรกิจ
 *                          ราคารับซื้อ < เจ้าหนี้เสมอ; คงไว้เป็น guard ตาม workbook.
 *                          workbook ระบุกลุ่ม 42-xxxx — คง 41-1102 จนกว่า CPA สั่งย้าย)
 */
```

(b) แทนบรรทัดคำนวณ `threshold`/`diff` (บรรทัด 51-52 เดิม):

```ts
    // วิธีสุทธิ: plug = balancing figure ของบรรทัดคงที่ทั้งหมด (ไม่มีขา 41-1101)
    const threshold = input.oldGrossOutstanding.plus(input.oldVatReceivableOutstanding);
    const drFixed = input.buyback
      .plus(input.oldUnearnedInterestOutstanding)
      .plus(input.oldDeferredVatOutstanding);
    const crFixed = input.oldGrossOutstanding
      .plus(input.oldVatReceivableOutstanding) // Cr 11-2105
      .plus(input.oldVatReceivableOutstanding); // Cr 21-2101
    const diff = drFixed.minus(crFixed); // signed: negative = loss, positive = gain
```

(c) ลบ object นี้ออกจาก `lines.push(...)` ท้าย template (บรรทัด 116-121 เดิม):

```ts
      {
        accountCode: '41-1101',
        dr: zero,
        cr: input.oldUnearnedInterestOutstanding,
        description: 'รับรู้ดอกเบี้ยที่เหลือทั้งหมด',
      },
```

(d) เพิ่ม `method: 'NET'` ใน metadata (ต่อจาก `threshold: threshold.toString(),`):

```ts
          method: 'NET', // วิธีสุทธิ (workbook 2026-08-19) — แถวเก่าไม่มี key นี้ = gross
```

- [ ] **Step 4: รัน integration ให้ผ่าน**

Run: `cd apps/api && npx vitest run src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts`
Expected: PASS (ถ้า assertion ยอดรวมอื่นพัง — เช่น TB scope=FINANCE — อ่าน actual แล้วปรับตามหลัก: JE2 เล็กลง 4,000 ทั้งสองข้าง, GL 41-1101 ของสัญญาเก่า = 0, GL 51-1102 = 126.68)

- [ ] **Step 5: เช็คว่า unit spec อื่นไม่พัง**

Run: `cd apps/api && npx jest src/modules/contract-exchange/contract-exchange.service.spec.ts`
Expected: PASS (service spec mock template — ไม่ปัก line values; ถ้าปักให้แก้ตามหลักเดียวกัน)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/exchange-close-old-21-1106.template.ts apps/api/src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts
git commit -m "feat(exchange): A.2 เปลี่ยนเป็นวิธีสุทธิ — ตัดขา Cr 41-1101 (workbook 2026-08-19, spec Gap ข้อ 6)"
```

---

### Task 3: Migration `previousCostPrice` บน ContractExchangeRequest

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `ContractExchangeRequest` — บรรทัด ~7606, แทรกใกล้ `buybackPrice`)
- Create: `apps/api/prisma/migrations/20260996000000_exchange_previous_cost_price/migration.sql`

**Interfaces:**
- Produces: `ContractExchangeRequest.previousCostPrice: Decimal | null` — Task 4 เขียนค่านี้ตอน finalize, Task 5 อ่านตอน cancel restore

- [ ] **Step 1: แก้ schema**

ใน model `ContractExchangeRequest` แทรกใต้บรรทัด `buybackPrice Decimal? @map("buyback_price") @db.Decimal(12, 2)`:

```prisma
  /// costPrice เดิมของเครื่องเก่า ก่อนถูกเขียนทับเป็นราคารับซื้อตอน A.4 finalize
  /// (workbook 2026-08-19 Phase 1) — cancel ใช้ restore กลับ. null = finalize ก่อนฟีเจอร์นี้
  previousCostPrice Decimal? @map("previous_cost_price") @db.Decimal(12, 2)
```

- [ ] **Step 2: สร้าง migration SQL (additive, มือ — ห้าม `migrate dev` เพราะ main มี schema drift)**

Create `apps/api/prisma/migrations/20260996000000_exchange_previous_cost_price/migration.sql`:

```sql
-- workbook 2026-08-19 Phase 1: snapshot costPrice เดิมของเครื่องเก่าก่อน A.4 เขียนทับเป็นราคารับซื้อ
ALTER TABLE "contract_exchange_requests"
  ADD COLUMN IF NOT EXISTS "previous_cost_price" DECIMAL(12,2);
```

- [ ] **Step 3: Apply migration + generate client**

Run: `cd apps/api && npx prisma migrate deploy && npx prisma generate`
Expected: migration applied, client generated ไม่มี error

- [ ] **Step 4: Type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260996000000_exchange_previous_cost_price/migration.sql
git commit -m "feat(schema): ContractExchangeRequest.previousCostPrice — snapshot ก่อน A.4 เขียนทับ (Phase 1)"
```

---

### Task 4: A.4 ใหม่ — ซื้อคืนที่ราคารับซื้อ + Cr S21-3001 + mutate/snapshot costPrice

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/shop-exchange-return.template.ts` (เขียนใหม่ทั้ง JE body)
- Modify: `apps/api/src/modules/contract-exchange/contract-exchange.service.ts:882-897` (A.4 call site), `:913-916` (product flip), `:919-928` (request update), `:949-959` (audit)
- Modify: `apps/api/prisma/schema.prisma` (คอมเมนต์ je4Id บรรทัด 7634-7636 — อัปเดตให้ตรง JE ใหม่)
- Test: `exchange-priced-flow.integration.spec.ts` (assertions A.4 + GL หลัง finalize)

**Interfaces:**
- Consumes: `previousCostPrice` จาก Task 3, บัญชี `S21-3001` จาก Task 1
- Produces: `ShopExchangeReturnInput` เปลี่ยน field `cost: Decimal` → `buyback: Decimal`; JE A.4 = `Dr S11-2002 [buyback] / Cr S21-3001 [buyback]` + `metadata.shopReceivableType = 'SWAP_CREDIT'`; `product.costPrice` (เครื่องเก่า) = buyback; `request.previousCostPrice` = costPrice เดิม

- [ ] **Step 1: แก้ integration assertions เป็น golden ใหม่ (failing test)**

ใน `exchange-priced-flow.integration.spec.ts` (fixture: buyback 8,000):

1. หา assertions ของ JE A.4 (grep `S50-1102` และ `S11-2002` ในส่วน je4) → เปลี่ยน: `S11-2002` Dr = `'8000.00'` (เดิม = costPrice เครื่องเก่าของ fixture), `S50-1102` Cr = `'0.00'` และเพิ่ม `S21-3001` Cr = `'8000.00'`
2. ในส่วนตาราง "ยอดค้างหลัง finalize" (มี `21-1101 15,000 / 21-1102 1,500 / S11-3001 15,000 / S11-3002 1,500`) เพิ่ม assertion:
```ts
      // A.4 ใหม่ (workbook 2026-08-19): SHOP ตั้งเจ้าหนี้ FINANCE = ราคารับซื้อ รอหักกลบรอบจ่าย
      expect(
        (await glContractBalance(prisma, oldContractId, 'S21-3001', 'cr')).toFixed(2),
      ).toBe('8000.00');
```
   (A.4 stamp `metadata.contractId = oldContractId` — ตรวจ metadata จริงตอนรัน ถ้า template ใช้ key อื่นให้ยึดตามที่ template ใหม่ stamp ใน Step 3)
3. เพิ่ม assertion costPrice หลัง finalize:
```ts
      const oldProdAfter = await prisma.product.findUniqueOrThrow({
        where: { id: oldProductId },
        select: { costPrice: true },
      });
      expect(new Decimal(oldProdAfter.costPrice!.toString()).toFixed(2)).toBe('8000.00');
```
4. grep GL assertions ของ `S50-1102` ทั้งไฟล์ — ค่าที่เคยรวมขา Cr จาก A.4 จะเปลี่ยน (ขา Cr หายไป) → ปรับตาม actual

- [ ] **Step 2: รันให้ fail**

Run: `cd apps/api && npx vitest run src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts`
Expected: FAIL ที่ assertions ใหม่

- [ ] **Step 3: เขียน template ใหม่**

แทนที่เนื้อหา `shop-exchange-return.template.ts` ทั้งไฟล์ด้วย:

```ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';

export interface ShopExchangeReturnInput {
  oldProductId: string;
  oldContractId: string;
  /**
   * ContractExchangeRequest.id — part of the idempotency key (C1b, final
   * review 2026-07-29): a canceled swap's still-POSTED A.4 must not block
   * the same product+contract's second exchange attempt.
   */
  requestId: string;
  /** ราคารับซื้อเครื่องเดิม (= ยอดที่ A.2/A.3 ใช้). Must be > 0. */
  buyback: Decimal;
}

/**
 * Exchange A.4 — SHOP ซื้อเครื่องเดิมคืนจาก FINANCE ที่ราคารับซื้อ
 * (workbook เจ้าของ 2026-08-19 Phase 1 — spec 2026-08-19-device-swap-netting-
 * cancel-workbook-design.md §3.2, คำตัดสินเจ้าของ D2)
 *
 *   Dr S11-2002 (used inventory)                    [buyback]
 *     Cr S21-3001 (เจ้าหนี้-FINANCE ค่าเครื่องรับคืน)  [buyback]
 *
 * เดิม (P3-SP5 → 2026-08-19): `Dr S11-2002 [costPrice] / Cr S50-1102 [costPrice]`
 * — กลับรายการต้นทุนที่ราคาทุนเดิม. เปลี่ยนเพราะ: (1) ต้นทุนจริงของ SHOP คือ
 * ราคาที่ซื้อคืนจาก FINANCE ไม่ใช่ costPrice เดิม (2) S21-3001 คือขาคู่ของ
 * 11-2107 SWAP_CREDIT ฝั่ง FINANCE — รอหักกลบในรอบจ่าย INTER-CO (Phase 2).
 * Forward-only: JE เก่ารูปแบบ costPrice/S50-1102 ปล่อยตามเดิม ไม่ backfill.
 *
 * Caller (`finalizeAfterActivation`) เป็นคน: set `product.costPrice = buyback`
 * + snapshot `request.previousCostPrice` (cancel restore ใช้) + flip
 * status/ownership — template นี้แตะเฉพาะ GL.
 *
 * Idempotency: `metadata.flow = 'shop-exchange-return'` (ชื่อเดิม — ห้ามเปลี่ยน)
 * + `idempotencyKey = <oldProductId>:<oldContractId>:<requestId>`.
 * `metadata.contractId = oldContractId` เดิม — ExchangeCancelReversalTemplate
 * sweep จับใบนี้ผ่าน je4Id ที่เก็บบน request row อยู่แล้ว.
 */
@Injectable()
export class ShopExchangeReturnTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  async execute(
    input: ShopExchangeReturnInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    const buyback = new Decimal(input.buyback.toString());
    if (buyback.lte(0)) {
      // Defense in depth — the caller should have already rejected this with
      // a clearer Thai message. If we reach this branch it's a programmer error.
      throw new InternalServerErrorException(
        'ShopExchangeReturn: buyback must be > 0 (received ' + buyback.toString() + ')',
      );
    }
    const zero = new Decimal(0);
    const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
    const idempotencyKey = `${input.oldProductId}:${input.oldContractId}:${input.requestId}`;

    return this.journal.createAndPost(
      {
        description: `Exchange A.4 — SHOP ซื้อเครื่องเดิมคืนที่ราคารับซื้อ (product ${input.oldProductId})`,
        // requestId suffix (C1b): journal_entries has a unique (referenceType,
        // referenceId) constraint — the canceled lifecycle's still-POSTED A.4
        // keeps its reference slot, so round 2 must not reuse the same string.
        reference: `contract:${input.oldContractId}:exchange-return:${input.requestId}`,
        metadata: {
          flow: 'shop-exchange-return',
          idempotencyKey,
          oldProductId: input.oldProductId,
          oldContractId: input.oldContractId,
          contractId: input.oldContractId,
          companyCode: 'SHOP',
          buyback: buyback.toFixed(2),
          shopReceivableType: 'SWAP_CREDIT',
        },
        companyId: shopCompanyId,
        lines: [
          {
            accountCode: 'S11-2002',
            dr: buyback,
            cr: zero,
            description: 'รับเครื่องเก่ากลับเข้าสต็อก SHOP (มือสอง — ราคารับซื้อ)',
          },
          {
            accountCode: 'S21-3001',
            dr: zero,
            cr: buyback,
            description: 'เจ้าหนี้-FINANCE ค่าเครื่องรับคืน (รอหักกลบรอบจ่าย INTER-CO)',
          },
        ],
      },
      tx,
    );
  }
}
```

หมายเหตุ: template เดิม**ไม่มี** `metadata.contractId` — เพิ่มใหม่ (= oldContractId) เพื่อให้ GL query per-contract ของ S21-3001 ใช้ pattern เดียวกับบัญชีอื่น. Cancel sweep ปัจจุบัน reverse ผ่าน `je4Id` ที่เก็บบน request row จึงไม่กระทบ (sweep เพิ่มเติมใช้ newContractId — ใบนี้ contractId = old จึงไม่โดนซ้ำสองรอบ)

- [ ] **Step 4: แก้ caller ใน `contract-exchange.service.ts`**

(a) บรรทัด 882-897 — แทนด้วย:

```ts
    // 7. JE A.4 — SHOP ซื้อเครื่องเดิมคืนที่ราคารับซื้อ (workbook 2026-08-19 Phase 1).
    // costPrice เดิมยังต้องมี (data quality) และถูก snapshot ไว้ให้ cancel restore.
    const oldProduct = await tx.product.findUniqueOrThrow({
      where: { id: request.oldProductId },
      select: { id: true, costPrice: true },
    });
    if (oldProduct.costPrice == null) {
      throw new InternalServerErrorException(
        'ไม่พบ costPrice ของเครื่องเดิม — ตั้งค่าก่อน finalize เปลี่ยนเครื่อง',
      );
    }
    const previousCostPrice = new Decimal(oldProduct.costPrice.toString());
    const je4 = await this.t4.execute(
      { oldProductId: request.oldProductId, oldContractId, requestId: request.id, buyback },
      tx,
    );
```

(b) บรรทัด 913-916 (product flip) — เพิ่ม costPrice:

```ts
    await tx.product.update({
      where: { id: request.oldProductId },
      // costPrice = ราคารับซื้อ (ต้นทุนจริงของ SHOP — COGS ตอนขายซ้ำใช้ค่านี้);
      // ค่าเดิม snapshot ไว้ที่ request.previousCostPrice ให้ cancel restore
      data: {
        status: 'REFURBISHED',
        ownedByCompanyId: shopCompanyId,
        costPrice: buyback,
      } as any,
    });
```

(c) บรรทัด 919-928 (request update) — เพิ่ม previousCostPrice:

```ts
    await (tx as any).contractExchangeRequest.update({
      where: { id: request.id },
      data: {
        je1aId: je1a.id,
        je2Id: je2.id,
        je3Id: je3.id,
        je4Id: je4.id,
        eclReversalJeId: je5?.id ?? null,
        previousCostPrice,
      },
    });
```

(d) audit log `EXCHANGE_DEVICE_RETURNED_TO_SHOP` (บรรทัด ~949-959) — เปลี่ยน `cost: cost.toString()` เป็น:

```ts
        buyback: buyback.toString(),
        previousCostPrice: previousCostPrice.toString(),
```

(e) ลบตัวแปร `const cost = new Decimal(oldProduct.costPrice.toString());` เดิม (ถูกแทนด้วย `previousCostPrice`)

- [ ] **Step 5: อัปเดตคอมเมนต์ schema je4Id (บรรทัด 7634-7636)**

```prisma
  /// SHOP re-intake JE — ตั้งแต่ 2026-08-19: Dr S11-2002 [buyback] / Cr S21-3001
  /// (เดิม: Dr S11-2002 / Cr S50-1102 ที่ costPrice — JE เก่าคงรูปเดิม forward-only)
  je4Id         String?   @map("je_4_id")
```

- [ ] **Step 6: แก้ unit spec ที่ mock t4**

Run: `cd apps/api && npx jest src/modules/contract-exchange/contract-exchange.service.spec.ts`
ถ้า FAIL เพราะ assert args `{ cost }` → เปลี่ยนเป็น `{ buyback }` ตาม signature ใหม่ แล้วรันซ้ำให้ PASS

- [ ] **Step 7: รัน integration ให้ผ่าน**

Run: `cd apps/api && npx vitest run src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts`
Expected: PASS ทั้งไฟล์ (รวม cancel cases — sweep reverse A.4 ใหม่ได้เพราะ reverse ผ่าน je4Id + mirror เป็น generic; net S21-3001 = 0 หลัง cancel)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/shop-exchange-return.template.ts apps/api/src/modules/contract-exchange/contract-exchange.service.ts apps/api/prisma/schema.prisma apps/api/src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts apps/api/src/modules/contract-exchange/contract-exchange.service.spec.ts
git commit -m "feat(exchange): A.4 ซื้อคืนที่ราคารับซื้อ Dr S11-2002 / Cr S21-3001 + snapshot previousCostPrice (Phase 1)"
```

---

### Task 5: Cancel restore `costPrice`

**Files:**
- Modify: `apps/api/src/modules/contract-exchange/contract-exchange-cancel.service.ts:205-208`
- Test: `exchange-priced-flow.integration.spec.ts` (cancel case — เพิ่ม assertion)

**Interfaces:**
- Consumes: `req.previousCostPrice` (Task 3/4)
- Produces: หลัง cancel — `product.costPrice` ของเครื่องเก่ากลับเป็นค่าก่อน finalize

- [ ] **Step 1: เพิ่ม assertion ใน cancel case (failing test)**

ใน integration spec ส่วน cancel วันที่ 15 (หลัง assertion net 0) เพิ่ม:

```ts
      // costPrice ของเครื่องเก่าต้องถูก restore กลับค่าก่อน finalize (scrutiny finding 3)
      const oldProdAfterCancel = await prisma.product.findUniqueOrThrow({
        where: { id: oldProductId },
        select: { costPrice: true },
      });
      expect(new Decimal(oldProdAfterCancel.costPrice!.toString()).toFixed(2)).toBe(
        originalCostPrice.toFixed(2), // ตัวแปร costPrice เดิมของ fixture — อ่านจาก setup ของ spec
      );
```

(ถ้า setup ของ spec ไม่มีตัวแปร costPrice เดิม ให้อ่านก่อน finalize เก็บไว้ใน `const originalCostPrice`)

- [ ] **Step 2: รันให้ fail**

Run: `cd apps/api && npx vitest run src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts -t "cancel"
`
Expected: FAIL — costPrice ยังเป็น 8000.00 (buyback)

- [ ] **Step 3: แก้ cancel service**

บรรทัด 205-208 แทนด้วย:

```ts
      await tx.product.update({
        where: { id: req.oldProductId },
        data: {
          status: 'SOLD_INSTALLMENT',
          ownedByCompanyId: financeCompanyId,
          // Restore costPrice เดิมก่อน A.4 เขียนทับเป็นราคารับซื้อ (workbook 2026-08-19
          // Phase 1) — null = finalize ก่อนฟีเจอร์นี้ ไม่แตะ (forward-only)
          ...(req.previousCostPrice != null ? { costPrice: req.previousCostPrice } : {}),
        } as any,
      });
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/api && npx vitest run src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts`
Expected: PASS ทั้งไฟล์

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/contract-exchange/contract-exchange-cancel.service.ts apps/api/src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts
git commit -m "fix(exchange): cancel restore product.costPrice จาก previousCostPrice (Phase 1)"
```

---

### Task 6: Reference types — stamp + `classifyShopReceivable`

**Files:**
- Create: `apps/api/src/modules/journal/shop-receivable-type.util.ts`
- Create: `apps/api/src/modules/journal/shop-receivable-type.util.spec.ts`
- Modify: `apps/api/src/modules/journal/cpa-templates/exchange-buyback-receivable-11-2107.template.ts` (metadata — เพิ่ม 1 key)
- Modify: `apps/api/src/modules/contracts/contract-payment.service.ts:487` และ `:546` (metadata shop-collect)
- Modify: `apps/api/src/modules/journal/cpa-templates/shop-collect-settlement.template.ts` (metadata block ~บรรทัด 240)
- Test เดิม: `apps/api/src/modules/journal/exchange-buyback-receivable-11-2107.template.spec.ts` (เพิ่ม assertion)

**Interfaces:**
- Produces:
  ```ts
  export type ShopReceivableType = 'SWAP_CREDIT' | 'PAYOUT_RECALL' | 'SHOP_COLLECT' | 'UNKNOWN';
  export function classifyShopReceivable(metadata: unknown): ShopReceivableType;
  ```
  Phase 2 (pending lens แยกประเภท) และ Phase 4 (รายงานอายุหนี้) เรียกฟังก์ชันนี้; `'PAYOUT_RECALL'` ยังไม่มีผู้ stamp จนถึง Phase 3 (ใส่ type ไว้ก่อนตาม spec §2)

- [ ] **Step 1: เขียน unit test (failing)**

Create `apps/api/src/modules/journal/shop-receivable-type.util.spec.ts`:

```ts
import { classifyShopReceivable } from './shop-receivable-type.util';

describe('classifyShopReceivable (spec 2026-08-19 §2)', () => {
  it('explicit stamp ชนะเสมอ', () => {
    expect(classifyShopReceivable({ shopReceivableType: 'SWAP_CREDIT' })).toBe('SWAP_CREDIT');
    expect(classifyShopReceivable({ shopReceivableType: 'PAYOUT_RECALL' })).toBe('PAYOUT_RECALL');
    expect(classifyShopReceivable({ shopReceivableType: 'SHOP_COLLECT' })).toBe('SHOP_COLLECT');
    // explicit ชนะ legacy fallback ที่ขัดกัน
    expect(
      classifyShopReceivable({ shopReceivableType: 'SWAP_CREDIT', collectedByShop: true }),
    ).toBe('SWAP_CREDIT');
  });

  it('แถวเก่า: map จาก metadata.flow (forward-only ไม่ backfill)', () => {
    expect(classifyShopReceivable({ flow: 'exchange-buyback-receivable-11-2107' })).toBe(
      'SWAP_CREDIT',
    );
    expect(classifyShopReceivable({ flow: 'shop-exchange-return' })).toBe('SWAP_CREDIT');
    expect(classifyShopReceivable({ flow: 'shop-collect-settlement' })).toBe('SHOP_COLLECT');
  });

  it('แถวเก่า JP4 shop-collect: จาก collectedByShop / shopReceivable', () => {
    expect(classifyShopReceivable({ collectedByShop: true })).toBe('SHOP_COLLECT');
    expect(classifyShopReceivable({ shopReceivable: '11-2107' })).toBe('SHOP_COLLECT');
  });

  it('ไม่รู้จัก = UNKNOWN (ห้ามเดา)', () => {
    expect(classifyShopReceivable({ flow: 'payment-receipt-2b' })).toBe('UNKNOWN');
    expect(classifyShopReceivable({})).toBe('UNKNOWN');
    expect(classifyShopReceivable(null)).toBe('UNKNOWN');
    expect(classifyShopReceivable('string')).toBe('UNKNOWN');
    expect(classifyShopReceivable({ shopReceivableType: 'INVALID' })).toBe('UNKNOWN');
  });
});
```

- [ ] **Step 2: รันให้ fail**

Run: `cd apps/api && npx jest src/modules/journal/shop-receivable-type.util.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: เขียน util**

Create `apps/api/src/modules/journal/shop-receivable-type.util.ts`:

```ts
/**
 * 11-2107 / S21-3001 reference types (workbook เจ้าของ 2026-08-19, spec §2).
 *
 * ทุก JE ใหม่ที่แตะสองบัญชีนี้ stamp `metadata.shopReceivableType` ตรงๆ;
 * แถวเก่า (ก่อน Phase 1) classify ตอนอ่านจาก `metadata.flow` /
 * `collectedByShop` — forward-only ไม่ backfill DB.
 *
 * | Type          | ความหมาย                                            | ล้างที่ |
 * |---------------|------------------------------------------------------|---------|
 * | SWAP_CREDIT   | เครดิตราคารับซื้อจากรับคืนเครื่อง (Flow B / A.3+A.4) | รอบจ่าย INTER-CO (Phase 2) หรือ shop-collect |
 * | PAYOUT_RECALL | เงินตัดจ่ายแล้วต้องเรียกคืน จากยกเลิกสัญญา (Flow C-2) | รอบจ่ายถัดไป หรือรับเงินสดคืน (Phase 3) |
 * | SHOP_COLLECT  | เงินลูกค้าที่หน้าร้านรับแทน (Flow D)                  | settleShopCollect — ไม่เข้ารอบจ่าย |
 */
export type ShopReceivableType = 'SWAP_CREDIT' | 'PAYOUT_RECALL' | 'SHOP_COLLECT' | 'UNKNOWN';

const EXPLICIT: ReadonlySet<string> = new Set(['SWAP_CREDIT', 'PAYOUT_RECALL', 'SHOP_COLLECT']);

/** Legacy flow → type (ตารางตายตัว — เพิ่มได้ ห้ามแก้ความหมายเดิม) */
const FLOW_MAP: Readonly<Record<string, ShopReceivableType>> = {
  'exchange-buyback-receivable-11-2107': 'SWAP_CREDIT',
  'shop-exchange-return': 'SWAP_CREDIT', // ขาคู่ S21-3001 ฝั่ง SHOP
  'shop-collect-settlement': 'SHOP_COLLECT',
};

export function classifyShopReceivable(metadata: unknown): ShopReceivableType {
  if (!metadata || typeof metadata !== 'object') return 'UNKNOWN';
  const m = metadata as Record<string, unknown>;

  const explicit = m['shopReceivableType'];
  if (typeof explicit === 'string' && EXPLICIT.has(explicit)) {
    return explicit as ShopReceivableType;
  }

  const flow = typeof m['flow'] === 'string' ? (m['flow'] as string) : '';
  const fromFlow = FLOW_MAP[flow];
  if (fromFlow) return fromFlow;

  // JP4/บันทึกชำระเส้นทางหน้าร้านรับแทน (แถวเก่า) — stamp เดิมของมันเอง
  if (m['collectedByShop'] === true || m['shopReceivable'] === '11-2107') {
    return 'SHOP_COLLECT';
  }

  return 'UNKNOWN';
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/api && npx jest src/modules/journal/shop-receivable-type.util.spec.ts`
Expected: PASS ทุกข้อ

- [ ] **Step 5: Stamp จุดกำเนิดทั้งหมด**

(a) `exchange-buyback-receivable-11-2107.template.ts` metadata (บรรทัด 76-82) — เพิ่มใต้ `buyback: buyback.toString(),`:

```ts
          shopReceivableType: 'SWAP_CREDIT',
```

(b) `contract-payment.service.ts:487` — เปลี่ยน:

```ts
            ...(dto.collectedByShop
              ? { collectedByShop: true, shopReceivable: '11-2107', shopReceivableType: 'SHOP_COLLECT' }
              : {}),
```

(c) `contract-payment.service.ts:546` — เพิ่มใต้ `shopReceivable: '11-2107',`:

```ts
                  shopReceivableType: 'SHOP_COLLECT',
```

(d) `shop-collect-settlement.template.ts` — ใน metadata block ของ JE (แถว `idempotencyKey` ~บรรทัด 240) เพิ่ม:

```ts
          shopReceivableType: 'SHOP_COLLECT',
```

(e) `exchange-buyback-receivable-11-2107.template.spec.ts` — เพิ่ม assertion ใน test ที่ตรวจ metadata:

```ts
    expect((je.metadata as any).shopReceivableType).toBe('SWAP_CREDIT');
```

(A.4 template stamp `SWAP_CREDIT` ไปแล้วใน Task 4)

- [ ] **Step 6: รัน suite ที่เกี่ยว**

Run: `cd apps/api && npx jest src/modules/journal/exchange-buyback-receivable-11-2107.template.spec.ts src/modules/contracts/shop-collect-settlement.template.spec.ts`
Expected: PASS (ถ้า shop-collect spec ปัก metadata ตายตัวให้เพิ่ม key ใหม่เข้า expected)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/journal/shop-receivable-type.util.ts apps/api/src/modules/journal/shop-receivable-type.util.spec.ts apps/api/src/modules/journal/cpa-templates/exchange-buyback-receivable-11-2107.template.ts apps/api/src/modules/contracts/contract-payment.service.ts apps/api/src/modules/journal/cpa-templates/shop-collect-settlement.template.ts apps/api/src/modules/journal/exchange-buyback-receivable-11-2107.template.spec.ts
git commit -m "feat(journal): 11-2107 reference types — stamp SWAP_CREDIT/SHOP_COLLECT + classifyShopReceivable (Phase 1)"
```

---

### Task 7: Docs + verification รวม

**Files:**
- Modify: `.claude/rules/accounting.md` (หัวข้อ "Device Swap — Priced Exchange")

**Interfaces:** — (เอกสารอย่างเดียว)

- [ ] **Step 1: อัปเดต accounting.md**

ในหัวข้อ "## Device Swap — Priced Exchange (2026-07-29)" (a) แก้บรรทัด PRICED mode: เปลี่ยนข้อความ "A.4 (SHOP re-intake)" เป็น "A.4 (SHOP ซื้อคืนที่ราคารับซื้อ — `Dr S11-2002 [buyback] / Cr S21-3001` ตั้งแต่ 2026-08-19, เดิม costPrice/Cr S50-1102)" และ (b) เพิ่ม bullet ใหม่ใต้ block นั้น:

```markdown
- **Workbook 2026-08-19 Phase 1** (spec `docs/superpowers/specs/2026-08-19-device-swap-netting-cancel-workbook-design.md`):
  (1) **A.2 = วิธีสุทธิ** — ไม่ตั้ง Cr 41-1101 จาก unearned อีกต่อไป; loss/gain = ราคารับซื้อ
  เทียบมูลค่าตามบัญชีสุทธิรวม VAT (ตัวเลข workbook: loss 126.64; fixture integration: 126.68 —
  เดิม 4,126.68). `metadata.method = 'NET'` (แถวเก่าไม่มี key = gross, forward-only).
  (2) **A.4 = ซื้อคืนที่ราคารับซื้อ** — `Dr S11-2002 [buyback] / Cr S21-3001` + caller set
  `product.costPrice = buyback` และ snapshot `ContractExchangeRequest.previousCostPrice`
  (cancel restore กลับ). S21-3001 คือขาคู่ฝั่ง SHOP ของ 11-2107 SWAP_CREDIT — รอหักกลบใน
  รอบจ่าย INTER-CO (Phase 2). Prod ต้องรัน `seed:coa` หลัง deploy (บัญชีใหม่ S21-3001).
  (3) **11-2107/S21-3001 reference types** — `metadata.shopReceivableType`
  (`SWAP_CREDIT` | `PAYOUT_RECALL` | `SHOP_COLLECT`) stamp ทุก JE ใหม่; แถวเก่า classify
  ตอนอ่านผ่าน `classifyShopReceivable()` (`apps/api/src/modules/journal/shop-receivable-type.util.ts`).
```

- [ ] **Step 2: Type check ทั้งหมด**

Run: `./tools/check-types.sh all`
Expected: 0 errors

- [ ] **Step 3: รัน test suites ที่แตะทั้งหมดรอบสุดท้าย**

Run:
```bash
cd apps/api && npx jest src/modules/journal src/modules/contract-exchange --silent
cd apps/api && npx vitest run src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts src/modules/contracts/shop-collect-settlement.integration.spec.ts src/modules/contracts/shop-collect-payoff.integration.spec.ts
```
Expected: PASS ทั้งหมด — shop-collect integration ต้องไม่แตก (แค่ metadata เพิ่ม key)

- [ ] **Step 4: Commit**

```bash
git add .claude/rules/accounting.md
git commit -m "docs(rules): บันทึก workbook 2026-08-19 Phase 1 — A.2 วิธีสุทธิ + A.4 S21-3001 + reference types"
```

---

## Self-Review Notes

- **Spec §3 coverage**: §3.1 → Task 1; §3.2 → Tasks 3+4+5; §3.3 → Task 6; §3.4 → Task 2 ✓ (Phase 2-5 ของ spec = plan ถัดไป ไม่อยู่ในไฟล์นี้)
- **Type consistency**: `ShopExchangeReturnInput.buyback` (Task 4) ↔ caller ส่ง `buyback` ที่ประกาศบรรทัด 799-801 อยู่แล้ว ✓; `previousCostPrice` ชื่อเดียวกันทั้ง schema/caller/cancel ✓
- **ลำดับ**: Task 2 (A.2) อิสระจาก Task 3-5 (A.4 chain) — แต่รันตามลำดับเพื่อให้ integration spec แก้ทีละส่วน; Task 1 ต้องมาก่อน Task 4 (JE โพสต์เข้า S21-3001 ต้องมีบัญชีใน dev DB — รัน `npm --prefix apps/api run seed:coa` หรือ reseed dev DB ก่อนรัน integration ของ Task 4 ถ้า DB เดิมยังไม่มีบัญชี)
