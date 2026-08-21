# Device Swap Workbook — Phase 4 Implementation Plan (รายงานอายุหนี้ + Alerts + Reconcile + ปิด carries)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ปิดวงจรตรวจสอบของ 11-2107/S21-3001 — รายงานอายุลูกหนี้หน้าร้านแยกประเภท, alert ค้างเกิน 30 วัน, cron กระทบยอดสองสมุดรายเดือน — และปิด carries ที่ค้างจาก Phase 2-3 (spec §6 + workbook "การกระทบยอด Inter-co และ Validation")

**Architecture:** service ใหม่ `IntercoAgingService` (grouped SQL twins ของ typed helpers — คิดทั้งระบบครั้งเดียว ไม่ใช่ N×5 queries ต่อสัญญา) + cron 2 ตัว (รายวัน aging alert / รายเดือน reconcile) ใช้ engine เดียวกัน + endpoint + UI section; carry fixes แยกเป็น task ของตัวเอง

**Tech Stack:** NestJS `@Cron` (ScheduleModule.forRoot มีแล้วใน app.module), Prisma `$queryRaw` group-by JSON path, Decimal, Todo + Sentry (pattern `alarmResidualParkOnCompletion`), jest + vitest `--no-file-parallelism`, React

**Base:** branch `feat/interco-reconcile-phase4` (แตกจาก main `3fb51cee3` — Phases 1-3 merged)

## Global Constraints

- เงิน `Prisma.Decimal` เท่านั้น; error/UI ภาษาไทย; ไม่มี migration ใหม่ในเฟสนี้ (ถ้าจำเป็นต้องมี → additive + timestamp ใหม่สุด)
- **SQL twins doctrine**: grouped SQL ทุกอันต้องสะท้อนเงื่อนไขของ `interco-typed-balance.ts` + เลนส์ใน `interco-pending.service.ts` เป๊ะ — แก้ที่ไหนต้องแก้ทุกที่ + คอมเมนต์ผูกไฟล์ถึงกัน
- **สถาปัตยกรรม gross-lens ยังยืน**: batch JE ไม่ stamp `contractId`/type → typed balance ต่อสัญญาเป็น **gross**; ยอดคงเหลือจริง = gross − Σ deduction ของ item ใน batch **POSTED** (ทุก itemType) — invariant ถือที่ **ระดับสัญญา** ไม่ใช่ระดับประเภท (บทเรียน Phase 3: swap ที่ถูกยกเลิกมี SWAP_CREDIT typed 0 แต่ deduction 8,000 ค้างถาวร)
- Alarm/Todo ทุกตัว: root `PrismaService` เท่านั้น, ห้ามอยู่บนเส้นทางเงิน, ห้าม throw (doctrine R-1); Todo dedup เสมอ; ไม่มี SYSTEM user → log + Sentry แล้วข้าม
- Cron ทุกตัวมี kill switch ผ่าน SystemConfig + outer try/catch + Sentry (pattern `ap-due-alerts.cron.ts`); เวลา BKK
- vitest integration `--no-file-parallelism` เสมอ; ทุก subagent ใช้ model fable
- ห้ามแตะพฤติกรรมเงินของ Phase 1-3 ยกเว้นที่ระบุใน Task 5/6

## ศัพท์ที่ใช้ทั้งแผน (นิยามครั้งเดียว)

| คำ | นิยาม |
|---|---|
| `swapCreditGross` | 11-2107 Σ(Dr−Cr) typed SWAP_CREDIT ของสัญญา (explicit stamp **หรือ** legacy flow `exchange-buyback-receivable-11-2107`) |
| `payoutRecallGross` | 11-2107 Σ(Dr−Cr) typed PAYOUT_RECALL (explicit stamp เท่านั้น) |
| `settledDeduction` | Σ(`swapCreditAmount` + `recallAmount`) ของ `InterCoSettlementItem` ทุก itemType ที่อยู่ใน batch สถานะ `POSTED` |
| `intercoNet` | (`swapCreditGross` + `payoutRecallGross`) − `settledDeduction` — **ยอดคงเหลือจริงของกลุ่มระหว่างกิจการ ระดับสัญญา** |
| `shopCollect` | 11-2107 Σ(Dr−Cr) typed SHOP_COLLECT — self-netting (ใบ settle stamp type เดียวกัน) จึงเป็นยอดจริงอยู่แล้ว |
| `shopMirrorNet` | ฝั่ง SHOP: (S21-3001 typed SWAP_CREDIT keyed `newContractId` + typed PAYOUT_RECALL keyed `contractId`, Σ(Cr−Dr)) − `settledDeduction` |
| `bookMismatch` | ค่าสัมบูรณ์ของ (`intercoNet` − `shopMirrorNet`) > 0.01 |

---

### Task 1: `IntercoAgingService` — grouped engine

**Files:**
- Create: `apps/api/src/modules/interco-settlement/interco-aging.service.ts`
- Modify: `apps/api/src/modules/interco-settlement/interco-settlement.module.ts` (provider + export)
- Test: `apps/api/src/modules/interco-settlement/__tests__/interco-aging.integration.spec.ts` (ใหม่ — setup pattern จาก `interco-netting.integration.spec.ts` prefix `AGINGTEST-`)

**Interfaces:**

```ts
export interface ShopReceivableAgingRow {
  contractId: string; contractNumber: string; customerName: string;
  swapCreditGross: Prisma.Decimal; payoutRecallGross: Prisma.Decimal;
  settledDeduction: Prisma.Decimal; intercoNet: Prisma.Decimal;
  shopCollect: Prisma.Decimal; shopMirrorNet: Prisma.Decimal;
  /** MIN(posted_at) ของ JE ที่มีขา Dr บน 11-2107 typed (กลุ่ม interco) */
  intercoOldestPostedAt: Date | null; intercoAgeDays: number | null;
  shopCollectOldestPostedAt: Date | null; shopCollectAgeDays: number | null;
  bookMismatch: boolean;
}

export interface ShopReceivableAgingResult {
  /** เฉพาะสัญญาที่ intercoNet > 0.01 หรือ shopCollect > 0.01 หรือ bookMismatch */
  rows: ShopReceivableAgingRow[];
  asOf: Date;
  totals: { intercoNet: Prisma.Decimal; shopCollect: Prisma.Decimal; overdueCount: number };
}

getShopReceivableAging(asOf?: Date, thresholdDays?: number): Promise<ShopReceivableAgingResult>
```

Task 2 (endpoint/UI), Task 3 (daily cron), Task 4 (reconcile cron) ใช้ method นี้ตัวเดียว — ห้ามคำนวณเอง

- [ ] **Step 1: เขียน failing integration tests**

Seed helpers (ผ่าน `JournalAutoService.createAndPost` จริงเท่านั้น):

```
(a) สัญญา swap ที่ยังไม่ถูกหัก: A.3 Dr 11-2107 8,000 [SWAP_CREDIT] + A.4 Cr S21-3001 8,000 [SWAP_CREDIT, newContractId]
(b) สัญญา C-2 ที่ถูกหักเครดิตไปแล้ว 8,000 ในรอบ POSTED + redirect 11,000 [PAYOUT_RECALL] สองสมุด → intercoNet = 3,000
(c) สัญญา shop-collect ค้าง 1,771 (Dr 11-2107 [SHOP_COLLECT] จาก JP4)
(d) สัญญาที่ settle ครบแล้ว → ไม่โผล่ในรายงาน
```

```ts
it('(a) swap ยังไม่หัก → intercoNet = gross 8,000, สองสมุดตรง, ไม่ mismatch', ...);
it('(b) C-2 หลังหัก 8,000 → intercoNet = 3,000 (ไม่ใช่ gross 11,000) และ shopMirrorNet = 3,000', ...);
it('(c) shop-collect ค้าง → shopCollect = 1,771 แยกคอลัมน์ ไม่ปนกลุ่ม interco', ...);
it('(d) สัญญาที่ล้างครบ → ไม่อยู่ใน rows', ...);
it('อายุ: JE ตั้งหนี้ backdate 45 วัน → intercoAgeDays = 45 (±1) และนับ overdueCount เมื่อ threshold 30', ...);
it('bookMismatch: ตั้ง S21-3001 ฝั่ง SHOP ขาดไป 500 → bookMismatch = true และแถวโผล่แม้ intercoNet เท่าเดิม', ...);
```

(backdate ผ่าน `postedAt` option ของ `createAndPost` — ตรวจ signature ก่อน; ถ้าไม่มีให้ update `posted_at` ตรงผ่าน prisma หลังโพสต์ แล้วบันทึกวิธีใน report)

- [ ] **Step 2: รันให้ fail** — `cd apps/api && npx vitest run src/modules/interco-settlement/__tests__/interco-aging.integration.spec.ts --no-file-parallelism`

- [ ] **Step 3: Implement service**

Jsdoc ที่ต้องมี (คัดลอกได้เลย):

```ts
/**
 * รายงานอายุลูกหนี้-หน้าร้าน 11-2107 / S21-3001 (Phase 4 — spec §6 ข้อ 1).
 *
 * SQL ในไฟล์นี้เป็น grouped twins ของ helper ต่อสัญญาใน
 * `interco-typed-balance.ts` และเลนส์ใน `interco-pending.service.ts` —
 * เงื่อนไข type ต้องตรงกันทุกตัวอักษร (แก้ที่ไหนแก้ทุกที่):
 *   - 11-2107 SWAP_CREDIT   = explicit stamp OR legacy flow 'exchange-buyback-receivable-11-2107'
 *   - 11-2107 PAYOUT_RECALL = explicit stamp เท่านั้น (type ใหม่ ไม่มี legacy)
 *   - 11-2107 SHOP_COLLECT  = explicit stamp ชนะ; ไม่มี stamp → flow/collectedByShop fallback
 *   - S21-3001 SWAP_CREDIT  key ด้วย metadata.newContractId (A.4 stamp)
 *   - S21-3001 PAYOUT_RECALL key ด้วย metadata.contractId (C-2 redirect / cash settle SHOP leg)
 *
 * ยอด "คงเหลือจริง" ของกลุ่มระหว่างกิจการ = typed gross ทั้งสองประเภทรวมกัน
 * ลบ Σ deduction ของ item ใน batch POSTED (สถาปัตยกรรม gross-lens: ขา Cr ของ
 * batch ไม่ stamp type/contractId จึงไม่ลด typed balance) — invariant ถือที่ระดับ
 * สัญญา ไม่ใช่ระดับประเภท (สัญญา swap ที่ถูกยกเลิกมีประวัติข้ามประเภท).
 */
```

โครงคิวรี (**7 queries คงที่ ไม่ขึ้นกับจำนวนสัญญา**):

1. **Query A — 11-2107 ทั้งบัญชี group by `metadata.contractId`**: `SUM(CASE WHEN <swap-cond> THEN debit-credit ELSE 0 END)`, `SUM(CASE WHEN <recall-cond> ...)`, `SUM(CASE WHEN <shopcollect-cond> ...)`, `MIN(CASE WHEN debit > 0 AND (<swap-cond> OR <recall-cond>) THEN posted_at END)`, `MIN(CASE WHEN debit > 0 AND <shopcollect-cond> THEN posted_at END)` — ทำ CASE รวมใน query เดียว
2. **Query B — S21-3001 group by key แบบมีเงื่อนไข**: group key = `CASE WHEN metadata->>'shopReceivableType' = 'SWAP_CREDIT' THEN metadata->>'newContractId' ELSE metadata->>'contractId' END`, ค่า = `SUM(credit-debit)` — **ระวัง double-count**: SWAP_CREDIT key ด้วย newContractId, PAYOUT_RECALL key ด้วย contractId (เทสเคส (b) ที่มีทั้งสองประเภทบนสัญญาเดียวคือด่านจับ)
3. **Query C — deductions**: `interCoSettlementItem.groupBy({ by: ['contractId'], where: { deletedAt: null, batch: { status: 'POSTED', deletedAt: null } }, _sum: { swapCreditAmount: true, recallAmount: true } })`
4. **Query D — hydrate contract** (`id/contractNumber/customer.name`) เฉพาะ id ที่เหลือหลัง filter — **ไม่กรอง status** (สัญญา CANCELED ต้องโผล่ในรายงานอายุหนี้ — นั่นคือประเด็นหลักของ C-2)

ประกอบผล: `intercoNet`/`shopMirrorNet`/`bookMismatch` ตามตารางศัพท์; `intercoAgeDays` = `floor((asOf − oldestPostedAt) / 86400000)`; `overdueCount` = rows ที่ `intercoAgeDays >= thresholdDays` (default 30) และ `intercoNet > 0.01` (เงื่อนไขเดียวกันฝั่ง shopCollect); เรียงอายุมากสุดก่อน

- [ ] **Step 4: รันให้ผ่าน** + `npx jest src/modules/interco-settlement --silent` + `./tools/check-types.sh api`
- [ ] **Step 5: Commit** — `feat(interco): IntercoAgingService — รายงานอายุลูกหนี้ 11-2107/S21-3001 แยกประเภท (Phase 4)`

---

### Task 2: Endpoint + UI section

**Files:**
- Modify: `apps/api/src/modules/interco-settlement/interco-settlement.controller.ts`
- Modify: `apps/web/src/pages/interco/types.ts`, `apps/web/src/pages/IntercompanySettlementPage.tsx` (แท็บใหม่ — อ่านโครงจริงก่อนตัดสิน)
- Create: `apps/web/src/pages/interco/AgingTab.tsx`
- Test: controller spec (jest) + web unit

**Interfaces:** `GET /interco-settlement/shop-receivable-aging?asOf&thresholdDays` — Roles `OWNER`, `FINANCE_MANAGER`, `ACCOUNTANT` (ชุดเดียวกับ `pending`)

- [ ] **Step 1: Failing tests** — controller spec: เรียก service + ส่ง query params ผ่าน (default asOf = now, thresholdDays = 30), invalid date → 400 ไทย; web: render ตารางประเภท + คอลัมน์อายุ + badge "ค้างเกิน N วัน" + badge "สองสมุดไม่ตรง" + empty state ภาษาไทย

- [ ] **Step 2: RED → Implement**

```ts
  /** รายงานอายุลูกหนี้-หน้าร้าน (11-2107) แยกประเภท + อายุ (Phase 4 — spec §6 ข้อ 1). */
  @Get('shop-receivable-aging')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  aging(@Query('asOf') asOf?: string, @Query('thresholdDays') thresholdDays?: string) {
    return this.agingService.getShopReceivableAging(
      asOf ? new Date(asOf) : undefined,
      thresholdDays ? Number(thresholdDays) : undefined,
    );
  }
```

(validate `asOf` เป็นวันที่ถูกต้อง — invalid → `BadRequestException` ไทย; `thresholdDays` จำนวนเต็ม 1-365)

UI `AgingTab.tsx`: ตารางคอลัมน์ `สัญญา | ลูกค้า | เครดิตเปลี่ยนเครื่อง | เรียกคืนจากยกเลิก | หักไปแล้ว | คงเหลือสุทธิ | หน้าร้านรับแทน | อายุ (วัน) | สถานะ` — แถว `bookMismatch` ติด badge destructive "สองสมุดไม่ตรง"; แถวเกิน threshold ติด badge warning; ทุกยอดผ่าน `fmtMoney`; tokens/ไทย/leading-snug ตามกติกา; `useQuery` + QueryBoundary ตาม pattern หน้านี้

- [ ] **Step 3: GREEN + `./tools/check-types.sh all` + web vitest interco**
- [ ] **Step 4: Commit** — `feat(interco-ui): แท็บอายุลูกหนี้หน้าร้าน 11-2107 (Phase 4)`

---

### Task 3: Daily aging alert cron

**Files:**
- Create: `apps/api/src/modules/interco-settlement/crons/shop-receivable-aging.cron.ts`
- Modify: module (provider)
- Test: `apps/api/src/modules/interco-settlement/__tests__/shop-receivable-aging.cron.spec.ts` (jest, mock service + prisma)

**Interfaces:** `tick(): Promise<{ enabled: boolean; flagged: number; todosCreated: number; skipped: number }>`

SystemConfig: `shop_receivable_aging_alerts_enabled` (default `'true'`), `shop_receivable_aging_alert_days` (default `30`) — อ่านผ่าน `readBoolFlag`/`readIntFlag` (`apps/api/src/utils/config.util.ts`)

- [ ] **Step 1: Failing tests**

```ts
it('kill switch ปิด → ไม่ทำอะไร (enabled: false)', ...);
it('แถวเกิน threshold → สร้าง Todo MEDIUM tag interco-aging + Sentry warning', ...);
it('dedup: รันซ้ำไม่สร้าง Todo ซ้ำ (มี Todo ที่ยังไม่ DONE ของสัญญานั้น)', ...);
it('ไม่มี SYSTEM user → log + ไม่ throw', ...);
it('service พัง → Sentry.captureException + ไม่ throw', ...);
```

- [ ] **Step 2: RED → Implement**

```ts
/** Daily 09:07 BKK — staggered หลัง 09:00/09:03 jobs (ตาม pattern ap-due-alerts). */
@Cron('7 9 * * *', { timeZone: 'Asia/Bangkok' })
async tick() { ... }
```

Todo: title `ลูกหนี้-หน้าร้าน ${contractNumber} ค้างเกิน ${days} วัน (${familyLabel} ${amount} บาท)`, description อธิบายวิธีล้างตามกลุ่ม (หักกลบรอบจ่าย / รับเงินสดคืน / รับโอนจากหน้าร้าน) + `contractId`, `tags: ['interco-aging']`, priority MEDIUM, `createdById = systemUser.id`
Dedup: `todo.findFirst({ where: { tags: { has: 'interco-aging' }, title: { contains: contractNumber }, status: { not: 'DONE' }, deletedAt: null } })`
Sentry: `captureMessage('Shop receivable aged past threshold', { level: 'warning', tags: { subsystem: 'interco-netting' }, extra: {...} })`
**ห้าม throw ออกจาก tick** — per-row try/catch + outer try/catch (pattern ap-due-alerts)

- [ ] **Step 3: GREEN + Commit** — `feat(interco): cron แจ้งเตือนลูกหนี้หน้าร้านค้างเกิน 30 วัน (Phase 4)`

---

### Task 4: Monthly reconcile cron (หัวใจของเฟส)

**Files:**
- Create: `apps/api/src/modules/interco-settlement/crons/interco-reconcile.cron.ts`
- Modify: module; อาจเพิ่ม method ใน `IntercoAgingService` สำหรับ payable pairing — **ห้ามคำนวณ typed ซ้ำในไฟล์ cron**
- Test: `apps/api/src/modules/interco-settlement/__tests__/interco-reconcile.cron.spec.ts` (jest) + เคส end-to-end ใน `interco-aging.integration.spec.ts`

**Interfaces:**

```ts
type ReconcileFindingKind =
  | 'BOOK_MISMATCH'         // intercoNet ≠ shopMirrorNet ต่อสัญญา (carry e)
  | 'SWAP_CREDIT_ONE_BOOK'  // 11-2107 SWAP_CREDIT > 0 แต่ S21-3001 = 0 ทั้งที่ A.4 เป็นยุค Phase 1+ (carry c)
  | 'PAYABLE_PAIR_MISMATCH' // (21-1101+21-1102) ≠ (S11-3001+S11-3002) ต่อสัญญา non-legacy
  | 'NEGATIVE_TYPED'        // typed balance หรือ net ติดลบ (over-settle — ตาข่ายของ carry d)
  | 'ACCOUNT_DRIFT';        // getReconcileTotals().drift ≠ 0 (JE ไม่มี contractId)

interface ReconcileFinding {
  kind: ReconcileFindingKind; contractId?: string; contractNumber?: string;
  detail: string; amounts: Record<string, string>;
}
tick(): Promise<{ enabled: boolean; findings: ReconcileFinding[]; todoCreated: boolean }>
```

**เกณฑ์แยก legacy (สำคัญ — อย่าให้ alert เท็จ):**
- `SWAP_CREDIT_ONE_BOOK` นับเป็น finding **เฉพาะเมื่อ** สัญญามี JE `flow = 'shop-exchange-return'` ที่ **มี** `metadata.newContractId` (stamp ของ Phase 2 = ยุคที่ต้องมี S21-3001) แต่ S21-3001 = 0 — swap ยุคก่อน Phase 1 (A.4 แบบ `Cr S50-1102`, ไม่มี stamp) เป็นสภาพปกติตาม spec §11.4 → ข้าม
- `PAYABLE_PAIR_MISMATCH` ข้ามสัญญา `legacyNoShop` (S11-3001+S11-3002 = 0 ทั้งคู่ — activate ก่อน 2026-06-23)

- [ ] **Step 1: Failing tests** — หนึ่งเคสต่อ finding kind (สร้างสภาพผิดปกติด้วย synthetic JE/hand-JV) + เคส "ทุกอย่างปกติ → findings ว่าง ไม่มี Todo" + เคส legacy (A.3-only ยุคเก่า / legacyNoShop) → **ไม่** เป็น finding + dedup รายเดือน

- [ ] **Step 2: RED → Implement**

```ts
/** เดือนละครั้ง วันที่ 1 เวลา 08:00 BKK (spec §6 ข้อ 3). */
@Cron('0 8 1 * *', { timeZone: 'Asia/Bangkok' })
async tick() { ... }
```

- kill switch `interco_reconcile_enabled` (default `'true'`)
- findings ว่าง → log + จบ (ไม่สร้าง Todo)
- มี findings → Todo **หนึ่งใบต่อเดือน** priority `HIGH`, tag `interco-reconcile`, title `กระทบยอดระหว่างกิจการ ${yyyy}-${mm} พบ ${n} รายการไม่ตรง`, description = สรุปต่อ finding (สัญญา + ประเภท + ยอด, จำกัด 20 บรรทัดแรก + "และอีก N รายการ") + Sentry `captureMessage` level `warning` `subsystem: 'interco-netting'` พร้อม extra สรุปจำนวนต่อ kind
- dedup: `title contains ${yyyy}-${mm}` + tag + `status != DONE`
- ห้าม throw; **ไม่แตะ GL ใดๆ** (รายงานอย่างเดียว — ห้ามเดา JE ปรับปรุงตาม doctrine)

- [ ] **Step 3: GREEN + Commit** — `feat(interco): cron กระทบยอดระหว่างกิจการรายเดือน (Phase 4 — ปิด carry c/e)`

---

### Task 5: `approveBatch` Serializable (ปิด carry d ที่ต้นเหตุ)

**Files:**
- Modify: `apps/api/src/modules/interco-settlement/interco-settlement.service.ts` (`approveBatch` `$transaction` options + P2034 catch)
- Test: `interco-netting.integration.spec.ts` (race test 2 connections — pattern จาก `settleRecallCash` race test ที่มีอยู่แล้วในไฟล์)

**เหตุผล:** `settleRecallCash` เป็น Serializable แล้ว แต่ `approveBatch` ยัง default isolation → หน้าต่าง TOCTOU: settle-cash commit ระหว่าง approve อ่าน drift แล้วยังไม่โพสต์ → หักซ้ำยอดเดียวกัน (carry d). Batch approve เป็น manual action ไม่กี่ครั้งต่อสัปดาห์ → ต้นทุน Serializable ต่ำมาก

- [ ] **Step 1: Failing test** — race: approve batch ที่มีแถว RECALL ของสัญญา X พร้อมกับ `settleRecallCash` ของ X (คนละ connection) → ต้องมีฝ่ายใดฝ่ายหนึ่งแพ้ (409/400) ไม่ใช่ทั้งคู่สำเร็จ และ typed net ของ X ไม่ติดลบ
- [ ] **Step 2: รันให้ fail** (ปัจจุบันทั้งคู่สำเร็จ = over-settle)
- [ ] **Step 3: Implement** — เพิ่ม `{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }` บน `$transaction` ของ `approveBatch` + catch `P2034` → `ConflictException` ไทย ("รอบจ่ายนี้ชนกับรายการอื่นที่กำลังบันทึก — กรุณาลองอนุมัติอีกครั้ง") วางคู่กับ catch `P2002` เดิม
- [ ] **Step 4: GREEN + regression** — netting integration ทั้งไฟล์ + `npx jest src/modules/interco-settlement --silent`
- [ ] **Step 5: Commit** — `fix(interco): approveBatch Serializable + P2034→409 (Phase 4 — ปิด carry d)`

---

### Task 6: Carry fixes เล็ก (precedence / 409 / fixture)

**Files:**
- Modify: `apps/api/src/modules/interco-settlement/interco-typed-balance.ts` (`swapCreditFinanceBalance` precedence)
- Modify: `apps/api/src/modules/contracts/services/contract-cancellation.service.ts` (P2002 → 409)
- Test: `interco-netting.integration.spec.ts` / `contract-cancellation.integration.spec.ts`

- [ ] **Step 1: Failing tests**

```ts
it('swapCreditFinanceBalance: JE flow A.3 ที่ stamp PAYOUT_RECALL ต้องไม่ถูกนับเป็น SWAP_CREDIT (explicit ชนะ flow)', ...);
it('approveCancellation ซ้ำพร้อมกัน → ผู้แพ้ได้ 409 ภาษาไทย (ไม่ใช่ 500 P2002)', ...);
it('C-2 ที่สัญญามีเงินดาวน์ → JE B mirror ครบ + cross-check ผ่าน + S21-2001 ค้าง Cr downAmount', ...);
```

- [ ] **Step 2: RED → Implement**
  - `swapCreditFinanceBalance`: เพิ่ม carve-out เหมือน `shopCollectTypedBalance` — `(stamp = 'SWAP_CREDIT') OR (stamp ไม่อยู่ในชุด valid AND flow = 'exchange-buyback-receivable-11-2107')` — **ต้องพิสูจน์ว่าแถวเก่าทุกชนิดให้ผลเดิม** (A.3 Phase 1+ มี stamp → branch 1; legacy A.3 ไม่มี stamp → fallback)
  - `approveCancellation`: wrap `$transaction` ด้วย try/catch — `P2002` → `ConflictException('คำขอยกเลิกนี้ถูกดำเนินการไปแล้ว (คำขอซ้ำ)')`
  - C-2-with-down fixture: เสริม seed เงินดาวน์ในเทส C-2 ที่มีอยู่ (ไม่สร้างชุดใหม่ถ้าเสริมของเดิมได้)
- [ ] **Step 3: GREEN + Commit** — `fix(interco+contracts): typed precedence + 409 ตอนยกเลิกซ้ำ + fixture C-2 มีเงินดาวน์ (Phase 4 carries)`

---

### Task 7: Docs + verification รวม

**Files:** `.claude/rules/accounting.md`, spec §6 sync

- [ ] **Step 1: accounting.md** — หัวข้อใหม่ "การกระทบยอดระหว่างกิจการ (Phase 4)": ตารางศัพท์ 7 คำ, endpoint + สิทธิ, cron สองตัว (เวลา/kill switch/SystemConfig keys/Todo tags), finding kinds 5 แบบ + เกณฑ์แยก legacy, สิ่งที่ cron **ไม่ทำ** (ไม่ตั้ง JE ปรับปรุงเอง — ต้องมนุษย์/CPA), approveBatch Serializable, และ **ปิดรายการ carry (c)(d)(e)** ในหัวข้อ Inter-Co (เขียนว่าปิดด้วยอะไร) + carry ที่เหลือ (ถ้ามี) ชี้ไป Phase 5
- [ ] **Step 2: spec §6 sync** — `[implemented]` annotations + จุดที่ต่างจริง (เช่น รายงานเป็น 2 กลุ่ม interco/shop-collect ไม่ใช่ 3 คอลัมน์ล้วน เพราะ invariant ระดับสัญญา)
- [ ] **Step 3: Verification**

```bash
./tools/check-types.sh all
cd apps/api && npx jest src/modules/interco-settlement src/modules/contracts src/modules/contract-exchange src/modules/journal --silent
cd apps/api && npx vitest run src/modules/interco-settlement/__tests__/interco-aging.integration.spec.ts src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts src/modules/contracts/__tests__/contract-cancellation.integration.spec.ts src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts --no-file-parallelism
cd apps/web && npx vitest run src --silent
```

- [ ] **Step 4: CI glob** — ตรวจ `deploy-gcp.yml` ว่า `interco-aging.integration.spec.ts` ถูกครอบโดย `INTERCO_FILES` glob เดิม (`src/modules/interco-settlement/__tests__/*.integration.spec.ts`) — ถ้าใช่ ไม่ต้องแก้ (บันทึกใน report); cron spec เป็น jest ปกติ
- [ ] **Step 5: Commit** — `docs(rules): กระทบยอดระหว่างกิจการ + รายงานอายุหนี้ (Phase 4)`

---

## Self-Review Notes

- **Spec §6 coverage:** ข้อ 1 → Tasks 1-2; ข้อ 2 → Task 3; ข้อ 3 → Task 4; ข้อ 4 (trial balance) → ไม่ต้องทำ (prefix S21 เข้า SECTION_MAP เอง — ยืนยันใน Task 7 docs)
- **Carries:** (c) → Task 4 `SWAP_CREDIT_ONE_BOOK`; (d) → Task 5 (ต้นเหตุ) + Task 4 `NEGATIVE_TYPED` (ตาข่าย); (e) → Task 4 `BOOK_MISMATCH`; precedence/409/fixture → Task 6
- **Type consistency:** `intercoNet`/`settledDeduction`/`bookMismatch` ชื่อเดียวกันทุกชั้น (service → endpoint → UI → cron)
- **ลำดับ:** 1 → 2 → 3 → 4 (ทั้งหมดพึ่ง engine ของ 1) → 5 → 6 → 7; Tasks 5-6 อิสระจาก 1-4 (สลับได้ถ้าจำเป็น)
- **ความเสี่ยงที่รู้:** grouped SQL ของ S21-3001 ใช้ group key แบบมีเงื่อนไข (newContractId สำหรับ SWAP_CREDIT, contractId สำหรับ PAYOUT_RECALL) — เขียนพลาดจะ double-count; Task 1 Step 1 เคส (b) ที่มีทั้งสองประเภทบนสัญญาเดียวคือด่านจับ
