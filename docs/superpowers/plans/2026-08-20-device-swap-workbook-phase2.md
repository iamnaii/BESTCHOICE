# Device Swap Workbook — Phase 2 Implementation Plan (จุดที่ 3: หักกลบรอบจ่าย INTER-CO)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** รอบจ่าย INTER-CO หักกลบ 11-2107 (SWAP_CREDIT + PAYOUT_RECALL) กับเจ้าหนี้หน้าร้าน แล้วโอนเงินสุทธิขาเดียว — ตาม workbook จุดที่ 3 + spec §4 (`docs/superpowers/specs/2026-08-19-device-swap-netting-cancel-workbook-design.md`)

**Architecture:** ขยาย 2 services เดิม (`IntercoPendingService` เลนส์ + `IntercoSettlementService` batch lifecycle/JE builders) + additive migration บน `InterCoSettlementItem`/`InterCoSettlementBatch` + typed-balance helpers ใหม่ 1 ไฟล์ + UI 5 ไฟล์เดิม. PAYOUT_RECALL producer (Flow C-2) มาใน Phase 3 — Phase 2 สร้าง**ฝั่งบริโภค**ครบ (เลนส์/JE/guards) ทดสอบด้วย synthetic JE ที่ stamp ตาม contract ของ spec §5.4

**Tech Stack:** NestJS + Prisma raw SQL (`$queryRaw` group-by JSON path), Decimal เท่านั้น; jest (unit), vitest `--no-file-parallelism` (integration, DB จริง); React + shadcn/ui

**Base:** branch `feat/device-swap-netting-phase2` (stack บน Phase 1 `feat/device-swap-netting-workbook` — PR #1453 ยังไม่ merge จึงแก้ metadata ของ Phase 1 ได้โดยไม่มี legacy บน prod)

## Global Constraints

- เงินใช้ `Prisma.Decimal` เท่านั้น — ห้าม `Number()`/float (FE ใช้ string + `fmtMoney`)
- Error messages ภาษาไทย
- Migration additive เท่านั้น (enum ใหม่ + คอลัมน์ default/nullable) — ห้าม rewrite ตาราง
- `metadata.flow`/`idempotencyKey` เดิมทั้งหมด **ห้ามเปลี่ยน** (`interco-settlement-batch`, `interco:{batchId}:FINANCE|SHOP`, `interco-settlement-batch-reverse`, `shop-exchange-return`, ฯลฯ)
- ยอดทุกตัวมาจาก GL — **ห้าม**อ่าน `Contract.financedAmount/storeCommission` (doctrine F4)
- Settlement-batch JE ห้าม stamp `metadata.contractId` ระดับใบ (จะรั่วเข้าเลนส์) — ใช้ `metadata.items[]` ตามเดิม
- Forward-only: batch เก่า (ก่อน Phase 2) `netTransferAmount = null` → UI/report ตีความ = `totalAmount`
- **กติกาหักกลบ (spec §4 + workbook):** ล้างเจ้าหนี้**เต็มจำนวน**เสมอ / Cr 11-2107 ต่อรายการหัก / เงินสด = สุทธิ; guard ราคารับซื้อ ≥ เจ้าหนี้สัญญานั้น → reject ("คงสูตร IF ห้ามลบ"); ยอดโอนสุทธิทั้งรอบ (ทั้ง FINANCE และ SHOP) ต้อง ≥ 0
- **Mixed-era (spec §11.4):** สัญญา swap ที่ finalize ก่อน Phase 1 (มี 11-2107 SWAP_CREDIT แต่ไม่มี S21-3001) **ไม่หักกลบ** — ล้างผ่าน shop-collect ตามเดิม; เกณฑ์ eligible = ทั้งสองสมุดมียอดและเท่ากัน ±0.01
- Alarm หลัง approve = fire-and-forget บน root prisma (doctrine R-1 — ห้าม throw/await บนเส้นทางเงิน)
- Integration ต้องรัน `npx vitest run <files> --no-file-parallelism` (parallel ชน dev DB — บทเรียน Phase 1)
- ทุก subagent ใช้ model fable (คำสั่งเจ้าของ 2026-08-19)

---

### Task 1: Metadata `newContractId` บน A.4 + cancel mirror (รากฐานเลนส์ฝั่ง SHOP)

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/shop-exchange-return.template.ts` (interface + metadata)
- Modify: `apps/api/src/modules/contract-exchange/contract-exchange.service.ts` (A.4 call site — anchor `this.t4.execute(`)
- Modify: `apps/api/src/modules/journal/cpa-templates/exchange-cancel-reversal.template.ts` (mirror copy)
- Test: `apps/api/src/modules/journal/cpa-templates/shop-exchange-return.template.spec.ts` + `apps/api/src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts`

**Interfaces:**
- Consumes: Phase 1's `ShopExchangeReturnInput { oldProductId, oldContractId, requestId, buyback }`
- Produces: `ShopExchangeReturnInput.newContractId: string` (required); JE A.4 + cancel-mirror มี `metadata.newContractId` — Task 3 ใช้ query S21-3001 ต่อสัญญาใหม่

เหตุผล: batch item = สัญญาใหม่ แต่ A.4 stamp `contractId = oldContractId` — เลนส์/drift guard ต้อง lookup S21-3001 ด้วย key ของสัญญาใหม่ตรงๆ (ไม่ join ผ่าน request row ใน SQL). ทำได้สะอาดเพราะ Phase 1 ยังไม่ deploy — ไม่มีแถว legacy รูปเก่า

- [ ] **Step 1: เขียน failing tests**

(a) ใน `shop-exchange-return.template.spec.ts` — เพิ่มใน test ที่ตรวจ metadata:
```ts
    expect((captured.metadata as any).newContractId).toBe('new-contract-1');
```
(และเติม `newContractId: 'new-contract-1'` ใน input ของทุก test ที่เรียก execute — จะ fail compile ก่อนถ้า interface บังคับ)

(b) ใน `exchange-priced-flow.integration.spec.ts` — จุดที่ assert metadata ของ JE A.4 (grep `je4`) เพิ่ม:
```ts
      expect((je4Full.metadata as any).newContractId).toBe(newContractId);
```
(c) ใน cancel case วันที่ 15 (จุดที่ Phase 1 assert mirror carry `shopReceivableType`) — mirror ของ je4Id เพิ่ม:
```ts
      expect((mirror.metadata as any).newContractId).toBe(newContractId);
```

- [ ] **Step 2: รันให้ fail**

Run: `cd apps/api && npx jest src/modules/journal/cpa-templates/shop-exchange-return.template.spec.ts`
Expected: FAIL (compile error จาก field ใหม่ หรือ assertion undefined)

- [ ] **Step 3: Implement**

(a) template — interface เพิ่ม (ใต้ `requestId`):
```ts
  /** สัญญาใหม่ที่เกิดจาก swap — key สำหรับเลนส์หักกลบรอบจ่าย (Phase 2: S21-3001 query ด้วย newContractId) */
  newContractId: string;
```
metadata เพิ่ม (ใต้ `contractId: input.oldContractId,`):
```ts
          newContractId: input.newContractId,
```
(b) caller `contract-exchange.service.ts` — จุด `this.t4.execute(`:
```ts
    const je4 = await this.t4.execute(
      {
        oldProductId: request.oldProductId,
        oldContractId,
        requestId: request.id,
        buyback,
        newContractId: newContract.id,
      },
      tx,
    );
```
(c) `exchange-cancel-reversal.template.ts` — ใน metadata ของ mirror (ข้างการ copy `shopReceivableType` ของ Phase 1) เพิ่ม:
```ts
            ...(typeof meta['newContractId'] === 'string'
              ? { newContractId: meta['newContractId'] }
              : {}),
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/api && npx jest src/modules/journal/cpa-templates/shop-exchange-return.template.spec.ts src/modules/contract-exchange/contract-exchange.service.spec.ts && npx vitest run src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts --no-file-parallelism`
Expected: PASS ทั้งหมด (service spec ถ้า mock t4 ปัก args ให้เพิ่ม newContractId ใน expected)

- [ ] **Step 5: Commit**

```bash
git add -A apps/api/src/modules/journal apps/api/src/modules/contract-exchange
git commit -m "feat(exchange): A.4 + cancel mirror stamp metadata.newContractId (Phase 2 เลนส์ S21-3001)"
```

---

### Task 2: Schema — itemType/swapCreditAmount/recallAmount + ยอดสุทธิบน batch

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (enum ใหม่ + model `InterCoSettlementItem` ~บรรทัด 4528 + `InterCoSettlementBatch` ~บรรทัด 4481)
- Create: `apps/api/prisma/migrations/20260997000000_interco_netting_columns/migration.sql`

**Interfaces:**
- Produces: `InterCoItemType` enum (`SETTLEMENT`|`RECALL`); item fields `itemType` (default SETTLEMENT), `swapCreditAmount`, `recallAmount` (Decimal(12,2) default 0); batch fields `totalDeduction` (default 0), `netTransferAmount Decimal?`, `shopNetAmount Decimal?` (null = รอบก่อนฟีเจอร์ → แสดง totalAmount/shopPostedAmount)

- [ ] **Step 1: แก้ schema**

เพิ่ม enum (ใกล้ `enum InterCoBatchStatus`):
```prisma
/// ประเภทแถวในรอบจ่าย (Phase 2 หักกลบ — workbook จุดที่ 3):
/// SETTLEMENT = สัญญาปกติ/สัญญา swap (จ่ายเจ้าหนี้ อาจมีหักเครดิตเปลี่ยนเครื่อง)
/// RECALL = สัญญายกเลิกหลังตัดจ่าย (Flow C-2) — หักเรียกคืนอย่างเดียว ไม่มีเจ้าหนี้
enum InterCoItemType {
  SETTLEMENT
  RECALL
}
```
ใน `InterCoSettlementItem` (ใต้ `legacyNoShop`):
```prisma
  itemType InterCoItemType @default(SETTLEMENT) @map("item_type")
  /// Snapshot เครดิตเปลี่ยนเครื่อง (11-2107 SWAP_CREDIT = S21-3001 ของสัญญานี้) — 0 เมื่อไม่ใช่ swap/ไม่ eligible
  swapCreditAmount Decimal @default(0) @map("swap_credit_amount") @db.Decimal(12, 2)
  /// Snapshot ยอดเรียกคืนจากยกเลิก (11-2107 PAYOUT_RECALL) — ใช้เฉพาะแถว RECALL
  recallAmount Decimal @default(0) @map("recall_amount") @db.Decimal(12, 2)
```
ใน `InterCoSettlementBatch` (ใต้ `shopPostedAmount`):
```prisma
  /// Σ swapCreditAmount + recallAmount ของทุก item (Phase 2 หักกลบ)
  totalDeduction Decimal @default(0) @map("total_deduction") @db.Decimal(12, 2)
  /// เงินโอนจริงฝั่ง FINANCE = totalAmount − totalDeduction; null = รอบก่อน Phase 2 (= totalAmount)
  netTransferAmount Decimal? @map("net_transfer_amount") @db.Decimal(12, 2)
  /// เงินรับจริงฝั่ง SHOP = shopPostedAmount − totalDeduction; null = รอบก่อน Phase 2 (= shopPostedAmount)
  shopNetAmount Decimal? @map("shop_net_amount") @db.Decimal(12, 2)
```

- [ ] **Step 2: Migration SQL (มือ — ห้าม migrate dev)**

Create `apps/api/prisma/migrations/20260997000000_interco_netting_columns/migration.sql`:
```sql
-- Phase 2 device-swap workbook: หักกลบ 11-2107 ในรอบจ่าย INTER-CO (additive only)
DO $$ BEGIN
  CREATE TYPE "InterCoItemType" AS ENUM ('SETTLEMENT', 'RECALL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "inter_co_settlement_items"
  ADD COLUMN IF NOT EXISTS "item_type" "InterCoItemType" NOT NULL DEFAULT 'SETTLEMENT',
  ADD COLUMN IF NOT EXISTS "swap_credit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "recall_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "inter_co_settlement_batches"
  ADD COLUMN IF NOT EXISTS "total_deduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "net_transfer_amount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "shop_net_amount" DECIMAL(12,2);
```

- [ ] **Step 3: Apply + generate + type check**

Run: `cd apps/api && npx prisma migrate deploy && npx prisma generate` แล้ว `./tools/check-types.sh api`
Expected: applied + 0 errors; ยืนยันคอลัมน์ผ่าน information_schema

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(schema): interco netting columns — itemType/swapCredit/recall + netTransferAmount (Phase 2)"
```

---

### Task 3: เลนส์ — swapCreditGl + recall queue + typed-balance helpers

**Files:**
- Create: `apps/api/src/modules/interco-settlement/interco-typed-balance.ts`
- Modify: `apps/api/src/modules/interco-settlement/interco-pending.service.ts`
- Test (new): `apps/api/src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts` (ส่วนเลนส์)

**Interfaces:**
- Produces (helpers — Task 5 drift guard ใช้):
```ts
export function swapCreditFinanceBalance(client, contractId): Promise<Prisma.Decimal>; // 11-2107 Σ(Dr−Cr), filter SWAP_CREDIT
export function swapCreditShopBalance(client, newContractId): Promise<Prisma.Decimal>; // S21-3001 Σ(Cr−Dr) by metadata.newContractId
export function recallFinanceBalance(client, contractId): Promise<Prisma.Decimal>;     // 11-2107 Σ(Dr−Cr), filter PAYOUT_RECALL
export function recallShopBalance(client, contractId): Promise<Prisma.Decimal>;        // S21-3001 Σ(Cr−Dr), filter PAYOUT_RECALL by metadata.contractId
```
- Produces (lens): `PendingContract` เพิ่ม `swapCreditGl`, `shopBuybackPayableGl`, `swapCreditEligible: boolean`; method ใหม่ `getPendingRecalls(tx?)` คืน `RecallCandidate { contractId, contractNumber, customerName, recallGl, shopRecallGl }`; `ReconcileTotals` เพิ่ม `glSwapCreditTotal`, `glRecallTotal`, `glShopBuybackTotal`

- [ ] **Step 1: Integration spec ส่วนเลนส์ (failing)**

Create `apps/api/src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts` — โครง (DB จริง, pattern setup เดียวกับ `exchange-priced-flow.integration.spec.ts`: Nest testing module + seed CoA + cleanup `INTERCO-NET-` prefix):

Synthetic seed helpers (ใช้ `JournalAutoService.createAndPost` — shape ตรง template จริง):
```ts
// สัญญา swap ตาม workbook Case 8: payable 10,000+1,000 / SHOP legs เท่ากัน / credit 8,000
async function seedSwapContract(id: string) {
  await journalAuto.createAndPost({ description: '1A synthetic', companyId: financeId,
    metadata: { flow: 'test-1a', idempotencyKey: `t1a:${id}`, contractId: id, tag: '1A' },
    lines: [
      { accountCode: '11-2101', dr: dec('17000'), cr: zero },
      { accountCode: '11-2105', dr: dec('1190'), cr: zero },
      { accountCode: '21-1101', dr: zero, cr: dec('10000') },
      { accountCode: '21-1102', dr: zero, cr: dec('1000') },
      { accountCode: '11-2106', dr: zero, cr: dec('6000') },
      { accountCode: '21-2102', dr: zero, cr: dec('1190') },
    ] });
  await journalAuto.createAndPost({ description: 'SHOP legs synthetic', companyId: shopId,
    metadata: { flow: 'test-shop-legs', idempotencyKey: `tsl:${id}`, contractId: id },
    lines: [
      { accountCode: 'S11-3001', dr: dec('10000'), cr: zero },
      { accountCode: 'S11-3002', dr: dec('1000'), cr: zero },
      { accountCode: 'S41-1101', dr: zero, cr: dec('10000') },
      { accountCode: 'S41-1201', dr: zero, cr: dec('1000') },
    ] });
  await journalAuto.createAndPost({ description: 'A.3 synthetic', companyId: financeId,
    metadata: { flow: 'exchange-buyback-receivable-11-2107', idempotencyKey: `ta3:${id}`,
      contractId: id, shopReceivableType: 'SWAP_CREDIT' },
    lines: [
      { accountCode: '11-2107', dr: dec('8000'), cr: zero },
      { accountCode: '21-1106', dr: zero, cr: dec('8000') },
    ] });
  await journalAuto.createAndPost({ description: 'A.4 synthetic', companyId: shopId,
    metadata: { flow: 'shop-exchange-return', idempotencyKey: `ta4:${id}`,
      contractId: `${id}-old`, newContractId: id, shopReceivableType: 'SWAP_CREDIT' },
    lines: [
      { accountCode: 'S11-2002', dr: dec('8000'), cr: zero },
      { accountCode: 'S21-3001', dr: zero, cr: dec('8000') },
    ] });
}
// สัญญายกเลิก C-2 (spec §5.4 shape — producer จริงมาใน Phase 3)
async function seedRecallContract(id: string) {
  await journalAuto.createAndPost({ description: 'C-2 recall synthetic', companyId: financeId,
    metadata: { flow: 'test-c2-recall', idempotencyKey: `tc2:${id}`, contractId: id,
      shopReceivableType: 'PAYOUT_RECALL' },
    lines: [
      { accountCode: '11-2107', dr: dec('11000'), cr: zero },
      { accountCode: '21-1103', dr: zero, cr: dec('11000') }, // ขาคู่ synthetic ให้ balance เท่านั้น
    ] });
  await journalAuto.createAndPost({ description: 'C-2 recall SHOP synthetic', companyId: shopId,
    metadata: { flow: 'test-c2-recall-shop', idempotencyKey: `tc2s:${id}`, contractId: id,
      shopReceivableType: 'PAYOUT_RECALL' },
    lines: [
      { accountCode: 'S21-3001', dr: zero, cr: dec('11000') },
      { accountCode: 'S11-1201', dr: dec('11000'), cr: zero }, // ขาคู่ synthetic
    ] });
}
```
(ต้องสร้าง Contract + Customer rows จริงด้วย — copy pattern จาก exchange integration spec; หมายเหตุ: ใช้ prefix `INTERCO-NET-` ใน contractNumber เพื่อ cleanup)

Lens tests:
```ts
it('เลนส์เห็น swapCreditGl + eligible บนสัญญา swap', async () => {
  const pending = await pendingService.getPendingContracts();
  const row = pending.find((p) => p.contractId === swapId)!;
  expect(row.swapCreditGl.toFixed(2)).toBe('8000.00');
  expect(row.shopBuybackPayableGl.toFixed(2)).toBe('8000.00');
  expect(row.swapCreditEligible).toBe(true);
});
it('สัญญา swap ยุคก่อน Phase 1 (ไม่มี S21-3001) → ไม่ eligible', async () => {
  // seed อีกสัญญา: A.3 อย่างเดียว ไม่มี A.4/S21-3001
  const row = pending.find((p) => p.contractId === legacySwapId)!;
  expect(row.swapCreditGl.toFixed(2)).toBe('8000.00');
  expect(row.shopBuybackPayableGl.toFixed(2)).toBe('0.00');
  expect(row.swapCreditEligible).toBe(false);
});
it('recall queue เห็นสัญญายกเลิก + ยอดสองสมุดตรง', async () => {
  const recalls = await pendingService.getPendingRecalls();
  const r = recalls.find((x) => x.contractId === recallId)!;
  expect(r.recallGl.toFixed(2)).toBe('11000.00');
  expect(r.shopRecallGl.toFixed(2)).toBe('11000.00');
});
it('typed-balance helpers ตรงกับเลนส์', async () => {
  expect((await swapCreditFinanceBalance(prisma, swapId)).toFixed(2)).toBe('8000.00');
  expect((await swapCreditShopBalance(prisma, swapId)).toFixed(2)).toBe('8000.00');
  expect((await recallFinanceBalance(prisma, recallId)).toFixed(2)).toBe('11000.00');
  expect((await recallShopBalance(prisma, recallId)).toFixed(2)).toBe('11000.00');
});
```

- [ ] **Step 2: รันให้ fail** — `cd apps/api && npx vitest run src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts --no-file-parallelism` → FAIL (fields/methods ไม่มี)

- [ ] **Step 3: Implement `interco-typed-balance.ts`**

```ts
import { Prisma, PrismaClient } from '@prisma/client';

type Client = Prisma.TransactionClient | PrismaClient;

/**
 * Typed GL balances สำหรับหักกลบรอบจ่าย (Phase 2 — spec §4).
 *
 * เงื่อนไข type ต้อง**สอดคล้อง**กับ `classifyShopReceivable` (shop-receivable-type.util.ts):
 * - SWAP_CREDIT ฝั่ง 11-2107: explicit stamp หรือ legacy flow 'exchange-buyback-receivable-11-2107'
 *   (mirror ตอน cancel carry stamp มาแล้วตั้งแต่ Phase 1 → net เป็นศูนย์เองในประเภทเดียวกัน)
 * - PAYOUT_RECALL: explicit stamp เท่านั้น (type ใหม่ ไม่มี legacy)
 * - S21-3001 SWAP_CREDIT: key ด้วย metadata.newContractId (A.4 stamp ตั้งแต่ Phase 2 Task 1)
 * - S21-3001 PAYOUT_RECALL: key ด้วย metadata.contractId (C-2 producer ใน Phase 3)
 */
async function sumTyped(
  client: Client,
  accountCode: string,
  sign: 'dr-cr' | 'cr-dr',
  where: Prisma.Sql,
): Promise<Prisma.Decimal> {
  const expr =
    sign === 'dr-cr'
      ? Prisma.sql`SUM(jl.debit - jl.credit)`
      : Prisma.sql`SUM(jl.credit - jl.debit)`;
  const rows = await client.$queryRaw<Array<{ balance: unknown }>>(Prisma.sql`
    SELECT COALESCE(${expr}, 0)::decimal AS balance
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.account_code = ${accountCode}
      AND jl.deleted_at IS NULL
      AND je.status = 'POSTED'
      AND je.deleted_at IS NULL
      AND ${where}
  `);
  return new Prisma.Decimal(String(rows[0]?.balance ?? 0));
}

export function swapCreditFinanceBalance(client: Client, contractId: string) {
  return sumTyped(client, '11-2107', 'dr-cr', Prisma.sql`
    je.metadata->>'contractId' = ${contractId}
    AND (je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
         OR je.metadata->>'flow' = 'exchange-buyback-receivable-11-2107')`);
}
export function swapCreditShopBalance(client: Client, newContractId: string) {
  return sumTyped(client, 'S21-3001', 'cr-dr', Prisma.sql`
    je.metadata->>'newContractId' = ${newContractId}
    AND je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'`);
}
export function recallFinanceBalance(client: Client, contractId: string) {
  return sumTyped(client, '11-2107', 'dr-cr', Prisma.sql`
    je.metadata->>'contractId' = ${contractId}
    AND je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL'`);
}
export function recallShopBalance(client: Client, contractId: string) {
  return sumTyped(client, 'S21-3001', 'cr-dr', Prisma.sql`
    je.metadata->>'contractId' = ${contractId}
    AND je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL'`);
}
```

- [ ] **Step 4: Implement lens (`interco-pending.service.ts`)**

(a) `PendingContract` เพิ่ม:
```ts
  /** เลนส์ 11-2107 SWAP_CREDIT — เครดิตเปลี่ยนเครื่องรอหักกลบ (0 = ไม่ใช่ swap) */
  swapCreditGl: Prisma.Decimal;
  /** เลนส์ S21-3001 (by newContractId) — ขาคู่ฝั่ง SHOP */
  shopBuybackPayableGl: Prisma.Decimal;
  /** หักกลบได้ = ทั้งสองสมุดมียอดและเท่ากัน ±0.01 (mixed-era spec §11.4: swap ก่อน Phase 1 → false) */
  swapCreditEligible: boolean;
```
(b) ใน `getPendingContracts` เพิ่ม 2 grouped queries (วางถัดจาก shopRows — shape เดียวกัน):
```ts
    const swapCreditRows = await client.$queryRaw<Array<{ contract_id: string | null; credit: unknown }>>`
      SELECT je.metadata->>'contractId' AS contract_id,
             COALESCE(SUM(jl.debit - jl.credit), 0)::decimal AS credit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = '11-2107'
        AND jl.deleted_at IS NULL AND je.status = 'POSTED' AND je.deleted_at IS NULL
        AND je.metadata->>'contractId' IS NOT NULL
        AND (je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
             OR je.metadata->>'flow' = 'exchange-buyback-receivable-11-2107')
      GROUP BY 1
    `;
    const shopBuybackRows = await client.$queryRaw<Array<{ contract_id: string | null; payable: unknown }>>`
      SELECT je.metadata->>'newContractId' AS contract_id,
             COALESCE(SUM(jl.credit - jl.debit), 0)::decimal AS payable
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = 'S21-3001'
        AND jl.deleted_at IS NULL AND je.status = 'POSTED' AND je.deleted_at IS NULL
        AND je.metadata->>'newContractId' IS NOT NULL
        AND je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
      GROUP BY 1
    `;
```
map เป็น `Map<string, Decimal>` แล้วตอนประกอบ result:
```ts
      const swapCreditGl = swapCreditByContract.get(contractId) ?? new Prisma.Decimal(0);
      const shopBuybackPayableGl = shopBuybackByContract.get(contractId) ?? new Prisma.Decimal(0);
      const swapCreditEligible =
        swapCreditGl.gt(0) &&
        shopBuybackPayableGl.gt(0) &&
        swapCreditGl.minus(shopBuybackPayableGl).abs().lte('0.01');
```
(c) `getPendingRecalls(tx?)` — method ใหม่ (pattern เดียวกับ getPendingContracts):
```ts
  /**
   * คิวรายการหักเรียกคืน (Flow C-2 — spec §4.1): สัญญาที่มี 11-2107 PAYOUT_RECALL
   * ค้าง > 0 และไม่อยู่ใน batch เปิด. producer ของ JE เหล่านี้คือ Phase 3 —
   * จนกว่าจะถึงตอนนั้นคิวนี้ว่างบน prod (ทดสอบด้วย synthetic ตาม spec §5.4).
   */
  async getPendingRecalls(tx?: Prisma.TransactionClient): Promise<RecallCandidate[]> { ... }
```
ใช้ query 11-2107 PAYOUT_RECALL group by contractId `HAVING SUM(jl.debit - jl.credit) > 0` + query S21-3001 PAYOUT_RECALL group by contractId + settled gate เดิม (interCoSettlementItem in OPEN_BATCH_STATUSES) + contract lookup — shape:
```ts
export interface RecallCandidate {
  contractId: string;
  contractNumber: string;
  customerName: string;
  recallGl: Prisma.Decimal;      // 11-2107 PAYOUT_RECALL คงเหลือ
  shopRecallGl: Prisma.Decimal;  // S21-3001 PAYOUT_RECALL คงเหลือ (ต้อง = recallGl จึงหักได้)
}
```
(d) `getReconcileTotals` เพิ่ม 3 ยอดทั้งบัญชี (no metadata filter ยกเว้น type):
```ts
  glSwapCreditTotal: Prisma.Decimal;   // 11-2107 typed SWAP_CREDIT ทั้งบัญชี (Dr−Cr)
  glRecallTotal: Prisma.Decimal;       // 11-2107 typed PAYOUT_RECALL ทั้งบัญชี (Dr−Cr)
  glShopBuybackTotal: Prisma.Decimal;  // S21-3001 ทั้งบัญชี (Cr−Dr)
```
(คำนวณด้วย raw query แบบเดียวกับ glFinanceTotal + เงื่อนไข type; glShopBuybackTotal ไม่กรอง type)

- [ ] **Step 5: Controller expose recalls**

`interco-settlement.controller.ts` — `GET pending` ปัจจุบันคืน `{ pending, reconcile }` (ดู handler จริงก่อนแก้): เพิ่ม `recalls: await this.pendingService.getPendingRecalls()` เข้า response object

- [ ] **Step 6: รันให้ผ่าน** — vitest ไฟล์ใหม่ + `npx jest src/modules/interco-settlement --silent` (unit เดิมถ้ามี — แก้ expected ที่เพิ่ม field)
- [ ] **Step 7: Commit** — `feat(interco): เลนส์หักกลบ — swapCreditGl/eligible + recall queue + typed balances (Phase 2)`

---

### Task 4: createBatch/updateBatch/submit — snapshot + guards + DTO

**Files:**
- Modify: `apps/api/src/modules/interco-settlement/interco-settlement.service.ts` (`BuiltSnapshot`, `buildSnapshot`, `assertNonNegativeGl`, `createBatch`, `updateBatch`)
- Modify: `apps/api/src/modules/interco-settlement/dto/create-batch.dto.ts`
- Test: `interco-netting.integration.spec.ts` (ส่วน snapshot/guards)

**Interfaces:**
- Consumes: Task 3 lens fields + `getPendingRecalls` + typed helpers
- Produces: `CreateBatchDto.recallContractIds?: string[]`; item rows มี itemType/swapCreditAmount/recallAmount; batch มี totalDeduction/netTransferAmount/shopNetAmount

- [ ] **Step 1: Failing tests (integration — ต่อไฟล์เดิม)**

```ts
it('createBatch: swap + recall → totals ถูก (workbook: 22,000 − 19,000 = 3,000)', async () => {
  const batch = await service.createBatch(
    { contractIds: [normalId, swapId], recallContractIds: [recallId],
      transferDate: '2026-08-20' } as any, makerId);
  expect(batch.totalAmount.toFixed(2)).toBe('22000.00');       // 11,000 + 11,000
  expect(batch.totalDeduction.toFixed(2)).toBe('19000.00');    // 8,000 + 11,000
  expect(batch.netTransferAmount!.toFixed(2)).toBe('3000.00');
  expect(batch.shopNetAmount!.toFixed(2)).toBe('3000.00');     // shopPosted 22,000 − 19,000
  const recallItem = batch.items.find((i) => i.contractId === recallId)!;
  expect(recallItem.itemType).toBe('RECALL');
  expect(recallItem.recallAmount.toFixed(2)).toBe('11000.00');
  const swapItem = batch.items.find((i) => i.contractId === swapId)!;
  expect(swapItem.swapCreditAmount.toFixed(2)).toBe('8000.00');
});
it('guard: เครดิต > เจ้าหนี้สัญญานั้น → reject', async () => {
  // seed swap ที่ payable 5,000 แต่ credit 8,000 → BadRequest มีคำว่า 'ราคารับซื้อ'
});
it('guard: ยอดสุทธิทั้งรอบติดลบ → reject', async () => {
  // batch ที่มีแต่ recall (ไม่มี settlement) → net = 0 − 11,000 < 0 → BadRequest
});
it('guard: สองสมุดไม่ตรง → reject', async () => {
  // synthetic: A.3 8,000 แต่ S21-3001 7,000 → BadRequest มีคำว่า 'ไม่ตรงกัน'
});
it('legacy swap (ไม่ eligible) → เข้ารอบได้แบบไม่หัก (swapCreditAmount = 0)', async () => {});
```

- [ ] **Step 2: รันให้ fail**

- [ ] **Step 3: DTO**

`create-batch.dto.ts` เพิ่ม:
```ts
  /** สัญญายกเลิก (C-2) ที่เลือกหักเรียกคืนในรอบนี้ — optional (Phase 2) */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'recallContractIds ต้องเป็น UUID' })
  recallContractIds?: string[];
```

- [ ] **Step 4: `buildSnapshot` — ขยาย**

`BuiltSnapshot` เพิ่ม: items ได้ field `itemType`, `swapCreditAmount`, `recallAmount`; totals เพิ่ม `totalDeduction`, `netTransferAmount`, `shopNetAmount`. Logic (โค้ดหลัก — วางแทนที่ลูป items เดิม + เพิ่มส่วน recall):

```ts
    const items = contractIds.map((contractId) => {
      const p = pendingByContractId.get(contractId)!;
      this.assertNonNegativeGl(p);
      // Workbook guard ("คงสูตร IF ห้ามลบ"): ราคารับซื้อต้องน้อยกว่าเจ้าหนี้ของสัญญานั้น
      const payable = p.financedGl.plus(p.commissionGl);
      if (p.swapCreditGl.gt(0) && p.shopBuybackPayableGl.gt(0) && !p.swapCreditEligible) {
        throw new BadRequestException(
          `ยอดเครดิตเปลี่ยนเครื่องสองสมุดไม่ตรงกัน สัญญา ${p.contractNumber} ` +
            `(FINANCE ${p.swapCreditGl.toFixed(2)} / SHOP ${p.shopBuybackPayableGl.toFixed(2)}) — ตรวจสอบ GL ก่อนสร้างรอบ`,
        );
      }
      const swapCreditAmount = p.swapCreditEligible ? p.swapCreditGl : new Prisma.Decimal(0);
      if (swapCreditAmount.gte(payable) && swapCreditAmount.gt(0)) {
        throw new BadRequestException(
          `ราคารับซื้อ (${swapCreditAmount.toFixed(2)}) ต้องน้อยกว่าเจ้าหนี้สัญญา ${p.contractNumber} ` +
            `(${payable.toFixed(2)}) — กรณีนี้ไม่เกิดตามนโยบายธุรกิจ ตรวจสอบ GL ก่อน`,
        );
      }
      ...
      return { contractId, itemType: 'SETTLEMENT' as const, ..., swapCreditAmount,
               recallAmount: new Prisma.Decimal(0) };
    });

    // RECALL rows
    const recallIds = [...new Set(recallContractIds ?? [])];
    if (recallIds.some((id) => contractIds.includes(id))) {
      throw new BadRequestException('สัญญาเดียวกันอยู่ทั้งรายการจ่ายและรายการเรียกคืนไม่ได้');
    }
    if (recallIds.length > 0) {
      const recalls = await this.pendingService.getPendingRecalls(tx);
      const byId = new Map(recalls.map((r) => [r.contractId, r]));
      for (const id of recallIds) {
        const r = byId.get(id);
        if (!r) {
          const labels = await this.resolveContractLabels(tx, [id]);
          throw new BadRequestException(
            `สัญญา ${labels[0]} ไม่อยู่ในคิวเรียกคืน หรืออยู่ในรอบจ่ายอื่นแล้ว`,
          );
        }
        if (r.recallGl.minus(r.shopRecallGl).abs().gt('0.01')) {
          throw new BadRequestException(
            `ยอดเรียกคืนสองสมุดไม่ตรงกัน สัญญา ${r.contractNumber} — ตรวจสอบ GL ก่อนสร้างรอบ`,
          );
        }
        items.push({ contractId: id, itemType: 'RECALL' as const,
          financedGl: zero, commissionGl: zero, shopFinancedGl: zero, shopCommissionGl: zero,
          legacyNoShop: false, swapCreditAmount: zero, recallAmount: r.recallGl });
      }
    }

    const totalDeduction = items.reduce((s, i) => s.plus(i.swapCreditAmount).plus(i.recallAmount), zero);
    const netTransferAmount = totalAmount.minus(totalDeduction);
    const shopNetAmount = shopPostedAmount.minus(totalDeduction);
    if (netTransferAmount.lt(0) || shopNetAmount.lt(0)) {
      throw new BadRequestException(
        `ยอดหักรวม (${totalDeduction.toFixed(2)}) เกินยอดจ่ายของรอบ — ` +
          'เลือกสัญญาเพิ่มให้ยอดพอ หรือเรียกเงินสดคืนผ่านช่องทางรับโอนจากหน้าร้านแทน',
      );
    }
```
หมายเหตุ: `buildSnapshot` เปลี่ยน signature เป็น `(tx, contractIds, recallContractIds?)` — `createBatch`/`updateBatch` ส่ง `dto.recallContractIds`; persist fields ใหม่ทั้งบน batch (`totalDeduction/netTransferAmount/shopNetAmount`) และ items; audit log เพิ่ม `totalDeduction`/`netTransferAmount`

- [ ] **Step 5: submitBatch** — ไม่ต้องแก้ logic (re-check เดิมครอบ recall rows ด้วยเพราะเป็น item ปกติ) — เพิ่ม test ว่า recall contract ที่ถูก batch อื่นจับไป → submit reject

- [ ] **Step 6: รันให้ผ่าน + Commit** — `feat(interco): snapshot หักกลบ — recall rows + guards เครดิต/สุทธิ (Phase 2)`

---

### Task 5: approveBatch/reverseBatch — drift guard + JE builders + residual alarm

**Files:**
- Modify: `interco-settlement.service.ts` (`approveBatch` step 3/5, `buildFinanceLines`, `buildShopLines`, method ใหม่ `alarmNettingResiduals`)
- Test: `interco-netting.integration.spec.ts` (ส่วน approve/reverse)

**Interfaces:**
- Consumes: typed-balance helpers (Task 3), snapshot fields (Task 4)
- Produces: JE สองสมุดแบบหักกลบตาม workbook จุดที่ 3; `metadata.items[]` เพิ่ม `type/swapCredit/recall`; batch metadata เพิ่ม `netTransferAmount`

- [ ] **Step 1: Failing tests (integration — ต่อไฟล์เดิม; ใช้ตัวเลขชุด Task 4)**

```ts
it('approve → FINANCE JE ตรง workbook จุดที่ 3 + GL ล้างครบ', async () => {
  await service.submitBatch(batchId, makerId);
  await service.approveBatch(batchId, approverId);
  const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id: posted.financeJournalEntryId! }, include: { lines: true } });
  expect(sumSide(je.lines, '21-1101', 'dr').toFixed(2)).toBe('20000.00');
  expect(sumSide(je.lines, '21-1102', 'dr').toFixed(2)).toBe('2000.00');
  expect(sumSide(je.lines, '11-2107', 'cr').toFixed(2)).toBe('19000.00'); // 8,000 + 11,000
  expect(sumSide(je.lines, '11-1201', 'cr').toFixed(2)).toBe('3000.00');  // สุทธิ
  // SHOP JE
  expect(sumSide(shopJe.lines, 'S21-3001', 'dr').toFixed(2)).toBe('19000.00');
  expect(sumSide(shopJe.lines, 'S11-1201', 'dr').toFixed(2)).toBe('3000.00');
  expect(sumSide(shopJe.lines, 'S11-3001', 'cr').toFixed(2)).toBe('20000.00');
  expect(sumSide(shopJe.lines, 'S11-3002', 'cr').toFixed(2)).toBe('2000.00');
  // Residuals = 0 (spec §4.7 + workbook validation)
  expect((await swapCreditFinanceBalance(prisma, swapId)).toFixed(2)).toBe('0.00');
  expect((await swapCreditShopBalance(prisma, swapId)).toFixed(2)).toBe('0.00');
  expect((await recallFinanceBalance(prisma, recallId)).toFixed(2)).toBe('0.00');
  expect((await recallShopBalance(prisma, recallId)).toFixed(2)).toBe('0.00');
});
it('drift guard: JE แทรกบน 11-2107 SWAP_CREDIT หลัง submit → approve reject', async () => {});
it('reverse → เครดิต/recall กลับเข้าคิวทั้งคู่', async () => {
  await service.reverseBatch(batchId, approverId, 'ทดสอบย้อนกลับรอบหักกลบ');
  expect((await swapCreditFinanceBalance(prisma, swapId)).toFixed(2)).toBe('8000.00');
  const recalls = await pendingService.getPendingRecalls();
  expect(recalls.some((r) => r.contractId === recallId)).toBe(true);
});
it('metadata.items ระบุ type/swapCredit/recall + netTransferAmount', async () => {});
```

- [ ] **Step 2: รันให้ fail**

- [ ] **Step 3: drift guard (approve step 3) — ขยาย**

แทนลูปเดิมด้วย (import helpers จาก `./interco-typed-balance`):
```ts
      for (const item of batch.items) {
        if (item.itemType === 'RECALL') {
          const [recallFin, recallShop] = await Promise.all([
            recallFinanceBalance(tx, item.contractId),
            recallShopBalance(tx, item.contractId),
          ]);
          if (
            recallFin.minus(item.recallAmount).abs().gt(DRIFT_TOLERANCE) ||
            recallShop.minus(item.recallAmount).abs().gt(DRIFT_TOLERANCE)
          ) {
            driftedContractNumbers.push(item.contract.contractNumber);
          }
          continue;
        }
        const checks = await Promise.all([
          glContractBalance(tx, item.contractId, '21-1101', 'cr'),
          glContractBalance(tx, item.contractId, '21-1102', 'cr'),
          glContractBalance(tx, item.contractId, 'S11-3001', 'dr'),
          glContractBalance(tx, item.contractId, 'S11-3002', 'dr'),
          swapCreditFinanceBalance(tx, item.contractId),
          swapCreditShopBalance(tx, item.contractId),
        ]);
        const [financedGl, commissionGl, shopFinancedGl, shopCommissionGl, scFin, scShop] = checks;
        const drifted =
          financedGl.minus(item.financedGl).abs().gt(DRIFT_TOLERANCE) ||
          commissionGl.minus(item.commissionGl).abs().gt(DRIFT_TOLERANCE) ||
          shopFinancedGl.minus(item.shopFinancedGl).abs().gt(DRIFT_TOLERANCE) ||
          shopCommissionGl.minus(item.shopCommissionGl).abs().gt(DRIFT_TOLERANCE) ||
          // เครดิตเปลี่ยนเครื่อง: snapshot 0 (ไม่ eligible/ไม่ใช่ swap) ก็ต้องยังเป็น 0 ฝั่ง SHOP
          scFin.minus(item.swapCreditAmount).abs().gt(DRIFT_TOLERANCE) === (item.swapCreditAmount.gt(0) || scFin.gt(0)) && scFin.minus(item.swapCreditAmount).abs().gt(DRIFT_TOLERANCE) ||
          (item.swapCreditAmount.gt(0) && scShop.minus(item.swapCreditAmount).abs().gt(DRIFT_TOLERANCE));
```
**หมายเหตุ implementer:** เงื่อนไขบรรทัด scFin ข้างบนเขียนให้เรียบง่ายกว่านี้ได้ — เจตนาคือ: (ก) ถ้า `swapCreditAmount > 0` → live ทั้งสองสมุดต้องเท่ากับ snapshot ±0.01; (ข) ถ้า `swapCreditAmount = 0` แต่ live `scFin > 0.01` → **drift เช่นกัน** (มีเครดิตโผล่หลัง snapshot — legacy swap ที่เพิ่งได้ S21-3001 หรือ JE แทรก) — เขียนเป็น if-branch ตรงๆ ตามเจตนานี้ อย่า copy expression ข้างบน

- [ ] **Step 4: JE builders**

`buildFinanceLines` — หลังลูป 21-1102 เพิ่ม (ก่อนบรรทัด bank):
```ts
    for (const item of batch.items) {
      const deduction = item.itemType === 'RECALL' ? item.recallAmount : item.swapCreditAmount;
      if (deduction.gt(0)) {
        lines.push({
          accountCode: '11-2107',
          dr: zero,
          cr: deduction,
          description:
            item.itemType === 'RECALL'
              ? `หักเรียกคืนจากยกเลิก ${item.contract.contractNumber}`
              : `หักเครดิตเปลี่ยนเครื่อง ${item.contract.contractNumber}`,
        });
      }
    }
    const netCash = batch.netTransferAmount ?? batch.totalAmount;
    if (netCash.gt(0)) {
      lines.push({ accountCode: batch.financeBankCode, dr: zero, cr: netCash, description });
    }
```
(ลบบรรทัด bank เดิมที่ใช้ `batch.totalAmount` ตรงๆ)

`buildShopLines` — เปลี่ยนเป็น:
```ts
    const shopItems = batch.items.filter((i) => i.itemType === 'SETTLEMENT' && !i.legacyNoShop);
    const deductionItems = batch.items.filter((i) =>
      (i.itemType === 'RECALL' ? i.recallAmount : i.swapCreditAmount).gt(0),
    );
    if (shopItems.length === 0 && deductionItems.length === 0) return [];

    const shopNet = batch.shopNetAmount ?? batch.shopPostedAmount;
    const lines: JeLineInput[] = [];
    if (shopNet.gt(0)) {
      lines.push({ accountCode: batch.shopBankCode, dr: shopNet, cr: zero,
        description: `รับโอนจาก FINANCE รอบ ${batch.batchNumber}` });
    }
    for (const item of deductionItems) {
      const deduction = item.itemType === 'RECALL' ? item.recallAmount : item.swapCreditAmount;
      lines.push({ accountCode: 'S21-3001', dr: deduction, cr: zero,
        description:
          item.itemType === 'RECALL'
            ? `ล้างเจ้าหนี้ FINANCE-เรียกคืนยกเลิก ${item.contract.contractNumber}`
            : `ล้างเจ้าหนี้ FINANCE-ค่าเครื่องรับคืน ${item.contract.contractNumber}` });
    }
    // Cr S11-3001 / S11-3002 ลูปเดิม (เฉพาะ shopItems) — ไม่เปลี่ยน
```
**Balance check (พิสูจน์ในตัวอย่าง):** SHOP Dr = 3,000 + 8,000 + 11,000 = 22,000 = Cr 20,000 + 2,000 ✓; FINANCE Dr 22,000 = Cr 19,000 + 3,000 ✓. `PairedJournalService` ยัง balance-check ทั้งสองใบก่อนโพสต์เหมือนเดิม

- [ ] **Step 5: metadata + alarm**

(a) `itemsMetadata` เปลี่ยนเป็น:
```ts
      const itemsMetadata = batch.items.map((i) => ({
        contractId: i.contractId,
        type: i.itemType,
        financed: i.financedGl.toFixed(2),
        commission: i.commissionGl.toFixed(2),
        swapCredit: i.swapCreditAmount.toFixed(2),
        recall: i.recallAmount.toFixed(2),
      }));
```
+ ใน metadata ทั้งสองใบเพิ่ม `netTransferAmount: (batch.netTransferAmount ?? batch.totalAmount).toFixed(2)`
(b) หลัง `$transaction` คืนค่า (นอก tx!) ใน `approveBatch`:
```ts
    // spec §4.7 — alarm อย่างเดียว ห้าม throw/await บนเส้นทางเงิน (doctrine R-1)
    void this.alarmNettingResiduals(id).catch((e) => Sentry.captureException(e));
    return result;
```
method ใหม่ (root prisma, ไม่รับ tx):
```ts
  /** ตรวจ residual หลัง approve: เครดิต/recall ของ item ที่หักในรอบนี้ต้องเหลือ 0 ทั้งสองสมุด */
  private async alarmNettingResiduals(batchId: string): Promise<void> {
    const batch = await this.prisma.interCoSettlementBatch.findUnique({
      where: { id: batchId },
      include: { items: { where: { deletedAt: null } } },
    });
    if (!batch || batch.status !== 'POSTED') return;
    for (const item of batch.items) {
      const deduction = item.itemType === 'RECALL' ? item.recallAmount : item.swapCreditAmount;
      if (deduction.lte(0)) continue;
      const [fin, shop] =
        item.itemType === 'RECALL'
          ? await Promise.all([
              recallFinanceBalance(this.prisma, item.contractId),
              recallShopBalance(this.prisma, item.contractId),
            ])
          : await Promise.all([
              swapCreditFinanceBalance(this.prisma, item.contractId),
              swapCreditShopBalance(this.prisma, item.contractId),
            ]);
      if (fin.abs().gt('0.01') || shop.abs().gt('0.01')) {
        Sentry.captureMessage('Interco netting: residual balance after approve', {
          level: 'warning',
          tags: { subsystem: 'interco-netting' },
          extra: { batchId, contractId: item.contractId, itemType: item.itemType,
            financeResidual: fin.toFixed(2), shopResidual: shop.toFixed(2) },
        });
      }
    }
  }
```
(c) `reverseBatch` — ไม่แก้ (mirror generic ครอบบรรทัดใหม่เอง) — test พิสูจน์

- [ ] **Step 6: รันให้ผ่าน + jest เดิมของ module + Commit** — `feat(interco): approve หักกลบ — JE สุทธิสองสมุด + drift guard typed + residual alarm (Phase 2)`

---

### Task 6: Integration E2E เต็ม + ผูกกับ exchange จริง + CI glob

**Files:**
- Modify: `interco-netting.integration.spec.ts` (E2E flow สมบูรณ์ + edge cases ที่ยังไม่ครอบ)
- Modify: `apps/api/src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts` (Case 2A tie-in)
- Modify: `.github/workflows/deploy-gcp.yml` (vitest glob)

- [ ] **Step 1: exchange tie-in** — ใน Case 2A หลัง finalize (จุดที่ assert คิวจ่าย `legacyNoShop = false` อยู่แล้ว) เพิ่ม:
```ts
      expect(pendingRow.swapCreditGl.toFixed(2)).toBe('8000.00');
      expect(pendingRow.shopBuybackPayableGl.toFixed(2)).toBe('8000.00');
      expect(pendingRow.swapCreditEligible).toBe(true);
```
(ผ่าน flow จริงทั้งเส้น — พิสูจน์ว่า A.3/A.4 stamps + เลนส์ต่อกันสนิท ไม่ใช่แค่ synthetic)

- [ ] **Step 2: edge cases เพิ่มใน interco spec** — (a) batch ไม่มี deduction เลย → JE รูปเดิมทุกบรรทัด (netTransferAmount = totalAmount — กันถอยหลัง); (b) legacy-swap ในรอบ → จ่ายเต็ม ไม่มีบรรทัด 11-2107; (c) net = 0 พอดี (payable 11,000 หัก 11,000) → ไม่มีบรรทัดธนาคารทั้งสองใบ แต่ JE balance และ approve ผ่าน

- [ ] **Step 3: CI glob** — ใน `.github/workflows/deploy-gcp.yml` หา vitest step (glob `src/modules/contract-exchange/__tests__/*.integration.spec.ts` อยู่แล้ว) เพิ่ม:
```
src/modules/interco-settlement/__tests__/*.integration.spec.ts
```
(ยืนยันว่า step นั้นรัน `--no-file-parallelism` อยู่แล้ว — ถ้าไม่ ให้เพิ่ม)

- [ ] **Step 4: รันครบ + Commit** — `test(interco): E2E หักกลบเต็ม flow + exchange tie-in + CI glob (Phase 2)`

---

### Task 7: UI — คิวรอจ่าย/รายการเรียกคืน/ยอดสุทธิ

**Files:**
- Modify: `apps/web/src/pages/interco/types.ts`, `PendingTab.tsx`, `CreateBatchDialog.tsx`, `BatchDetailSheet.tsx`, `ApproveConfirmDialog.tsx`
- Test: web unit ถ้ามีของ interco (ตรวจ `apps/web/src` — ถ้าไม่มี ให้เพิ่ม type-level ผ่าน check-types web)

- [ ] **Step 1: types.ts**

`PendingContract` เพิ่ม:
```ts
  /** เลนส์ 11-2107 SWAP_CREDIT — เครดิตเปลี่ยนเครื่องรอหักกลบ */
  swapCreditGl: string;
  /** เลนส์ S21-3001 — ขาคู่ฝั่ง SHOP */
  shopBuybackPayableGl: string;
  /** หักกลบได้ (สองสมุดมียอดเท่ากัน) — false บน swap ยุคก่อน Phase 1 */
  swapCreditEligible: boolean;
```
ใหม่:
```ts
export interface RecallCandidate {
  contractId: string;
  contractNumber: string;
  customerName: string;
  recallGl: string;
  shopRecallGl: string;
}
```
`PendingResponse` เพิ่ม `recalls: RecallCandidate[]`; `BatchListItem` เพิ่ม `totalDeduction: string; netTransferAmount: string | null; shopNetAmount: string | null;`; `BatchItem` เพิ่ม `itemType: 'SETTLEMENT' | 'RECALL'; swapCreditAmount: string; recallAmount: string;`
Helper:
```ts
/** เงินโอนจริงของรอบ — รอบก่อน Phase 2 (null) = totalAmount เต็ม */
export function netAmountOf(b: Pick<BatchListItem, 'totalAmount' | 'netTransferAmount'>): string {
  return b.netTransferAmount ?? b.totalAmount;
}
```

- [ ] **Step 2: PendingTab.tsx** — เพิ่มคอลัมน์ตาราง "หักเครดิตเปลี่ยนเครื่อง" (แสดง `fmtMoney(p.swapCreditGl)` เมื่อ eligible; ถ้า `swapCreditGl > 0` แต่ไม่ eligible แสดง badge "ล้างผ่านรับโอนหน้าร้าน" title อธิบาย mixed-era) + คอลัมน์ "โอนสุทธิ" = payable − (eligible ? credit : 0); ใต้ตารางหลักเพิ่ม section **"รายการเรียกคืน (ยกเลิกหลังตัดจ่าย)"** — ตาราง `recalls` พร้อม checkbox เลือกเข้ารอบ (state ส่งเข้า CreateBatchDialog); ว่าง → ไม่แสดง section

- [ ] **Step 3: CreateBatchDialog.tsx** — รับ `selectedRecalls` prop; สรุปท้าย dialog แสดง 3 บรรทัด: `ยอดเจ้าหนี้รวม` / `หักรวม (เครดิตเปลี่ยนเครื่อง + เรียกคืน)` / **`ยอดโอนสุทธิ`** (เน้น); POST body เพิ่ม `recallContractIds`

- [ ] **Step 4: BatchDetailSheet.tsx + ApproveConfirmDialog.tsx** — แสดง 3 ยอด (ใช้ `netAmountOf`; batch เก่า null → แสดงยอดเต็มไม่มีบรรทัดหัก); ตาราง items: แถว RECALL แสดง badge "เรียกคืน" + ยอดในคอลัมน์หัก; แถว swap แสดงยอดหักใต้ยอดจ่าย

- [ ] **Step 5: Verify** — `./tools/check-types.sh web` + `cd apps/web && npx vitest run src` (unit เดิมต้องไม่แตก) + เปิด dev ดูหน้า `/accounting/intercompany` ด้วยตาอย่างน้อย 1 รอบถ้าทำได้ (บันทึกใน report ถ้าไม่ได้)
- [ ] **Step 6: Commit** — `feat(interco-ui): คอลัมน์หักกลบ + รายการเรียกคืน + ยอดโอนสุทธิ (Phase 2)`

---

### Task 8: Docs + verification รวม

**Files:**
- Modify: `.claude/rules/accounting.md` (หัวข้อ "Inter-Co Settlement Batch")
- Modify: `docs/superpowers/specs/2026-08-19-device-swap-netting-cancel-workbook-design.md` (§4 sync ชื่อจริง ถ้า deviate)

- [ ] **Step 1: accounting.md** — ในหัวข้อ Inter-Co Settlement Batch: (a) อัปเดต "JE structure (both halves)" ด้วยรูปหักกลบใหม่ (บรรทัด Cr 11-2107 ต่อรายการหัก + เงินสด = `netTransferAmount`; SHOP Dr S21-3001 + Dr bank สุทธิ) + ตัวเลขตัวอย่าง workbook (22,000/19,000/3,000); (b) เพิ่ม bullet "**หักกลบ (Phase 2 workbook 2026-08-19)**": eligibility rule (สองสมุดเท่ากัน ±0.01; legacy swap ไม่หัก — ล้างผ่าน shop-collect), guards (เครดิต ≥ เจ้าหนี้ / สุทธิ < 0 → reject), RECALL rows (producer = Phase 3), `metadata.items[].type/swapCredit/recall` + `netTransferAmount`, residual alarm (`subsystem: 'interco-netting'`), batch เก่า netTransferAmount = null = จ่ายเต็ม; (c) หมายเหตุ `shopPostedAmount` ยังคงความหมายเดิม (ยอดล้างลูกหนี้ ไม่ใช่เงินสดอีกต่อไปเมื่อมีหัก)

- [ ] **Step 2: spec §4 sync** — เทียบชื่อ field/พฤติกรรมที่ implement จริง (เช่น `shopNetAmount`, eligibility, RECALL ผ่าน `recallContractIds`) — แก้ spec ให้ตรงของจริง (1-2 บรรทัดต่อจุด)

- [ ] **Step 3: Verification รวม**

```bash
./tools/check-types.sh all
cd apps/api && npx jest src/modules/interco-settlement src/modules/journal src/modules/contract-exchange --silent
cd apps/api && npx vitest run src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts src/modules/contracts/shop-collect-settlement.integration.spec.ts --no-file-parallelism
cd apps/web && npx vitest run src --silent
```
Expected: PASS ทั้งหมด; failure ที่ไม่เกี่ยว Phase 2 → บันทึกใน report ห้ามแก้เอง

- [ ] **Step 4: Commit** — `docs(rules): บันทึกหักกลบรอบจ่าย Phase 2 + sync spec §4`

---

## Self-Review Notes

- **Spec §4 coverage:** §4.1 → Task 3; §4.2 → Task 2 (+ยอด batch); §4.3 → Task 5 (ตัวเลข workbook พิสูจน์ balance ในแผน); §4.4 guards → Task 4 (เครดิต≥เจ้าหนี้, สุทธิ≥0) + Task 5 (drift typed); §4.5 reverse → Task 5 test; §4.6 UI → Task 7; §4.7 alarm → Task 5; §11.4 mixed-era → eligibility rule (Task 3/4) + test legacy-swap
- **Type consistency:** `swapCreditGl/shopBuybackPayableGl/swapCreditEligible` ชื่อเดียวกัน API↔lens↔UI; helpers 4 ตัวชื่อเดียวกันทุก task; `netTransferAmount` nullable ทุกชั้น (null = legacy batch)
- **ลำดับ:** 1→2→3→4→5→6→7→8; Task 3 integration spec สร้างไฟล์ที่ Task 4-6 ต่อยอด — ทุก task รันไฟล์เดียวกันสะสม
- **ความเสี่ยงที่รู้:** drift-guard expression ใน Task 5 Step 3 มีหมายเหตุ implementer ให้เขียน if-branch ตามเจตนา (แผนจงใจไม่ยัด expression ซับซ้อน); pending GET response เปลี่ยน shape (เพิ่ม `recalls`) — FE/BE ต้อง merge พร้อมกัน (อยู่ branch เดียว ✓)
