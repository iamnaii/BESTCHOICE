# Device Swap — Priced Exchange Implementation Plan

> ⚠️ **ประวัติศาสตร์ — อย่าใช้แผนนี้เป็นแหล่งอ้างอิงสถานะปัจจุบัน.** แผนนี้ execute จบไปแล้ว
> และมี 3 จุดที่ถูกกลับคำสั่งภายหลัง:
> 1. **Task 2 เพิ่ม 42-1106/42-1107 เข้าผัง** — ทั้งสองบัญชี **ถูกลบออกจากผังแล้ว 2026-08-03**
>    (คำสั่ง CPA/owner) โดยไม่เคยมีรายการบัญชีจริงแม้แถวเดียว
> 2. **ECL reversal → 42-1106** (บรรทัด Goal ด้านล่าง) — ของจริงคือ **Cr 51-1103** ตั้งแต่ CPA
>    ruling 2026-08-01 (มาตรฐานเดียวทุกเส้นทาง)
> 3. **A.3 `ExchangeClearVendor21_1106Template` + ขาเงินสด (D5)** — ถูกแทนที่ด้วย
>    `ExchangeBuybackReceivable11_2107Template` (`Dr 11-2107 / Cr 21-1106`, ไม่มีขาเงินสด)
>    2026-08-03; ไฟล์ template + spec เดิมถูกลบ. ทุก snippet ในแผนนี้ที่อ้าง
>    `exchange-clear-vendor-21-1106.template.ts` คือโค้ดที่ไม่มีอยู่แล้ว
>
> สถานะปัจจุบันอยู่ที่ `.claude/rules/accounting.md` → "Device Swap — Priced Exchange" และ
> spec `docs/superpowers/specs/2026-07-29-device-swap-priced-exchange-design.md` §13

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ขยาย SP2 same-price exchange ให้ครบตาม DeviceSwap workbook: MEMO mode (ไม่มี JE), PRICED mode (ราคารับซื้อจริง + ขาเงินสด), approval 3 ระดับ, cancellation 7/30 วัน + ค่าปรับ 5%, ECL reversal → 42-1106

**Architecture:** ขยาย `contract-exchange` module in-place (spec §3). JE ทุกขาอ่านจาก ledger จริง. Plan math ของสัญญาใหม่คำนวณฝั่ง server (preview endpoint = single source, submit/approve recompute เอง ไม่เชื่อ client)

**Tech Stack:** NestJS + Prisma + PostgreSQL / React 18 + react-query / jest (API, DB tests = `*.integration.spec.ts`) + vitest (web)

**Spec:** `docs/superpowers/specs/2026-07-29-device-swap-priced-exchange-design.md` — อ่านก่อนเริ่มทุก task

## Global Constraints

- เงินใช้ `Prisma.Decimal` เท่านั้น — ห้าม `Number()` กับยอดเงิน
- Error messages ภาษาไทย, class-validator บน DTO
- Soft delete เท่านั้น (`deletedAt`), ห้าม hard delete
- JE idempotency = `metadata.flow` + `metadata.idempotencyKey` (DB partial unique index `journal_entries_idempotency_idx` มีอยู่แล้ว)
- JE ที่ต้องเข้า GL scope ของสัญญาต้อง stamp `metadata.contractId` (นี่คือ key ที่ `glContractBalance` ใช้)
- Rounding: `grossExclVat/months` = ROUND_DOWN, `vat/months` = ROUND_HALF_UP (accounting.md)
- วันที่/window = Asia/Bangkok เสมอ (no DST, +07:00 คงที่)
- ค่าปรับ 42-1107 ไม่มี VAT
- ⛔ **Merge gate: CoA changes (Task 2) ต้องได้ CPA sign-off ก่อน merge PR**
- Commit ทุก task; ทำงานบน branch `feat/device-swap-priced-exchange`
- Local DB ต้องรันอยู่ (docker per `project_local_dev_setup` memory) สำหรับ `prisma migrate dev` + integration specs

---

### Task 1: Prisma schema — enums + columns ใหม่

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (enum block ~line 70, model ~line 7412)
- Create: migration ผ่าน `prisma migrate dev` (อย่าเขียน SQL มือ)

**Interfaces:**
- Produces: enum `ExchangeMode { MEMO PRICED }`, enum `ExchangeApprovalTier { AUTO REVIEW ESCALATE }`, `ExchangeRequestStatus` + `CANCELED`, คอลัมน์ใหม่บน `ContractExchangeRequest` (ชื่อ field ตรงตาม code ด้านล่าง — Task 7-10 ใช้ทุกตัว)

- [ ] **Step 1: สร้าง branch**

```bash
git checkout -b feat/device-swap-priced-exchange
```

- [ ] **Step 2: แก้ enum block** — ที่ `enum ExchangeRequestStatus` (schema.prisma ~line 70) แทนที่:

```prisma
enum ExchangeRequestStatus {
  PENDING
  APPROVED
  REJECTED
  CANCELED // ยกเลิก swap (7/30-วัน window หรือ abort ก่อน finalize) — Device Swap 2026-07
}

enum ExchangeMode {
  MEMO // รุ่นเดิม+ราคาเดิม — ไม่มี JE, เปลี่ยน productId บนสัญญาเดิม (workbook Case 1)
  PRICED // มีราคารับซื้อจริง — derecognition ผ่าน 21-1106 (workbook Cases 2A-2G)
}

enum ExchangeApprovalTier {
  AUTO // ≥ NCV และผ่าน market check — อนุมัติอัตโนมัติ
  REVIEW // ผจก.สาขา (BRANCH_MANAGER)
  ESCALATE // < 70% NCV — OWNER เท่านั้น
}
```

- [ ] **Step 3: เพิ่ม fields ใน `model ContractExchangeRequest`** — วางหลังบรรทัด `je4Id String? @map("je_4_id")`:

```prisma
  // ===== Device Swap 2026-07 (priced exchange) =====
  mode               ExchangeMode          @default(PRICED) @map("mode")
  buybackPrice       Decimal?              @map("buyback_price") @db.Decimal(12, 2)
  deviceCondition    String?               @map("device_condition") // A-D → key เข้า TradeInValuation
  approvalTier       ExchangeApprovalTier? @map("approval_tier")
  ncvSnapshot        Decimal?              @map("ncv_snapshot") @db.Decimal(12, 2)
  basePriceSnapshot  Decimal?              @map("base_price_snapshot") @db.Decimal(12, 2)
  depositAccountCode String?               @map("deposit_account_code")
  // แผนผ่อนใหม่ (PRICED) — server-computed snapshot ตอน submit
  newTotalMonths     Int?                  @map("new_total_months")
  newInterestRate    Decimal?              @map("new_interest_rate") @db.Decimal(5, 4)
  newMonthlyPayment  Decimal?              @map("new_monthly_payment") @db.Decimal(12, 2)
  newInterestTotal   Decimal?              @map("new_interest_total") @db.Decimal(12, 2)
  newVatAmount       Decimal?              @map("new_vat_amount") @db.Decimal(12, 2)
  newStoreCommission Decimal?              @map("new_store_commission") @db.Decimal(12, 2)
  // ECL reversal (A.5)
  eclReversalJeId    String?               @map("ecl_reversal_je_id")
  // MEMO
  memoAppliedAt      DateTime?             @map("memo_applied_at")
  // Cancellation
  canceledAt         DateTime?             @map("canceled_at")
  canceledById       String?               @map("canceled_by_id")
  cancelReason       String?               @map("cancel_reason")
  cancelWindow       String?               @map("cancel_window") // FREE_7D | PENALTY_8_30D | PRE_FINALIZE
  penaltyAmount      Decimal?              @map("penalty_amount") @db.Decimal(12, 2)
  penaltyJeId        String?               @map("penalty_je_id")
  reversalJeIds      String[]              @default([]) @map("reversal_je_ids")
```

- [ ] **Step 4: รัน migration + generate**

```bash
cd apps/api && npx prisma migrate dev --name exchange_priced_mode
```

Expected: migration ใหม่ + client regenerated, ไม่มี data-loss warning (additive ทั้งหมด; row เดิมได้ `mode='PRICED'` จาก default — ถูกต้อง เพราะ row historical มี JE)

- [ ] **Step 5: ตรวจ TypeScript ยัง compile**

```bash
./tools/check-types.sh api
```

Expected: 0 errors (คอลัมน์ใหม่เป็น optional ทั้งหมด)

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(exchange): schema — ExchangeMode/ApprovalTier/CANCELED + priced-mode columns"
```

---

### Task 2: CoA — rename 42-1106, เพิ่ม 42-1107, SystemConfig seeds

**Files:**
- Modify: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv:96` (+ แถวใหม่หลัง 96)
- Modify: `apps/api/prisma/seed.ts` (~line 205 ย่าน SystemConfig array), `apps/api/prisma/seed-production.ts` (~line 199 ย่านเดียวกัน)
- Modify: `.claude/CLAUDE.md` (line ~451 — doc ผิด)
- Test: `apps/api/src/modules/journal/__tests__/exchange-coa.spec.ts` (ใหม่)

**Interfaces:**
- Produces: บัญชี `42-1106 รายได้จากการโอนกลับค่าเผื่อหนี้สงสัยจะสูญ` (Task 5 ใช้), `42-1107 รายได้ค่าปรับยกเลิกเปลี่ยนเครื่อง` (Task 10 ใช้), SystemConfig keys `exchange_cancel_penalty_pct`='5', `exchange_market_check_pct`='15' (Tasks 7, 10 อ่าน)

- [ ] **Step 1: เขียน failing test**

```ts
// apps/api/src/modules/journal/__tests__/exchange-coa.spec.ts
import * as path from 'path';
import { loadCoaFromCsv } from './csv-fixture-loader';

const CSV = path.join(__dirname, 'fixtures', 'cpa-cases', 'finance-coa.csv');

describe('Device Swap CoA (spec §10)', () => {
  const accounts = loadCoaFromCsv(CSV);
  const byCode = new Map(accounts.map((a: { code: string }) => [a.code, a]));

  it('42-1106 renamed to ECL-reversal income (repair-income orphan repurposed)', () => {
    const a = byCode.get('42-1106') as { name: string } | undefined;
    expect(a).toBeDefined();
    expect(a!.name).toBe('รายได้จากการโอนกลับค่าเผื่อหนี้สงสัยจะสูญ');
  });

  it('42-1107 exchange-cancel penalty income exists (Cr-normal, no VAT)', () => {
    const a = byCode.get('42-1107') as { name: string; normalBalance?: string } | undefined;
    expect(a).toBeDefined();
    expect(a!.name).toBe('รายได้ค่าปรับยกเลิกเปลี่ยนเครื่อง');
  });
});
```

หมายเหตุ: เปิด `csv-fixture-loader.ts` ดู field names จริงของ object ที่ return (`code`/`name`/`normalBalance` อาจสะกดต่าง) แล้วปรับ assertion ให้ตรง — **ห้ามปรับ loader**

- [ ] **Step 2: รันให้ fail**

```bash
npm --prefix apps/api run test -- --testPathPattern=exchange-coa
```

Expected: FAIL — 42-1106 ยังชื่อ "รายได้บริการซ่อม", 42-1107 undefined

- [ ] **Step 3: แก้ CSV** — แถว 96 เปลี่ยนเป็น (คงจำนวน column เท่าแถวอื่น — ลอก trailing commas จากแถว 95):

```csv
42-1106,รายได้จากการโอนกลับค่าเผื่อหนี้สงสัยจะสูญ,รายได้,Cr,รายได้อื่น,ไม่,"Device Swap 2026-07 — ECL reversal on exchange derecognition (Dr 11-2102 / Cr 42-1106, spec D2) — เดิมชื่อ รายได้บริการซ่อม (orphan: runtime repair ใช้ S42-1101)",ใช้งาน,,,,,,,,,,,,,,,
```

เพิ่มแถวใหม่ถัดไป:

```csv
42-1107,รายได้ค่าปรับยกเลิกเปลี่ยนเครื่อง,รายได้,Cr,รายได้อื่น,ไม่,"Device Swap 2026-07 — ค่าปรับยกเลิก swap วันที่ 8-30 (default 5% ของราคารับซื้อ, SystemConfig exchange_cancel_penalty_pct) — ไม่มี VAT (นโยบายค่าปรับ)",ใช้งาน,,,,,,,,,,,,,,,
```

- [ ] **Step 4: SystemConfig seeds** — ใน `apps/api/prisma/seed.ts` ต่อท้ายรายการย่าน line 205 (หลัง `REPAIR_INCOME_ACCOUNT_CODE`):

```ts
    // Device Swap 2026-07 — priced exchange (spec §10)
    { key: 'exchange_cancel_penalty_pct', value: '5', label: 'ค่าปรับยกเลิกเปลี่ยนเครื่อง วันที่ 8-30 (% ของราคารับซื้อ) → Cr 42-1107' },
    { key: 'exchange_market_check_pct', value: '15', label: 'เกณฑ์ตรวจราคาตลาด — ราคารับซื้อต่ำกว่า basePrice เกิน % นี้ → บังคับ REVIEW' },
```

และใน `apps/api/prisma/seed-production.ts` เพิ่ม object รูปแบบเดียวกับ entry ข้างเคียง (multi-line style ของไฟล์นั้น):

```ts
    {
      key: 'exchange_cancel_penalty_pct',
      value: '5',
      label: 'ค่าปรับยกเลิกเปลี่ยนเครื่อง วันที่ 8-30 (% ของราคารับซื้อ) → Cr 42-1107',
    },
    {
      key: 'exchange_market_check_pct',
      value: '15',
      label: 'เกณฑ์ตรวจราคาตลาด — ราคารับซื้อต่ำกว่า basePrice เกิน % นี้ → บังคับ REVIEW',
    },
```

- [ ] **Step 5: แก้ doc ผิดใน `.claude/CLAUDE.md`** — บรรทัด v6 ที่เขียน `REPAIR_INCOME_ACCOUNT_CODE (42-1106)` แก้เป็น `REPAIR_INCOME_ACCOUNT_CODE (S42-1101)` (ground truth: `repair-ticket-lifecycle.service.ts:27` + seed ทั้งคู่)

- [ ] **Step 6: รัน test ให้ผ่าน + reseed dev**

```bash
npm --prefix apps/api run test -- --testPathPattern=exchange-coa
npm --prefix apps/api run seed:coa
```

Expected: PASS / seeder upsert อัปเดตชื่อ 42-1106 + สร้าง 42-1107 (upsert ไม่ทับ peakCode เดิม)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/journal/__tests__ apps/api/prisma/seed.ts apps/api/prisma/seed-production.ts .claude/CLAUDE.md
git commit -m "feat(exchange): CoA — 42-1106 → ECL reversal income (rename orphan), add 42-1107 penalty + config seeds"
```

⚠️ **Prod pre-flight (จดใน PR description):** ก่อน deploy ต้องรัน `SELECT COUNT(*) FROM journal_lines WHERE account_code = '42-1106';` บน prod (ผ่าน cloud-sql-proxy) — ต้องได้ 0 แล้วค่อย merge (ยืนยัน orphan จริงบน prod ไม่ใช่แค่ในโค้ด)

---

### Task 3: Tier util (pure function) — approval matrix

**Files:**
- Create: `apps/api/src/modules/contract-exchange/exchange-tier.util.ts`
- Test: `apps/api/src/modules/contract-exchange/exchange-tier.util.spec.ts`

**Interfaces:**
- Produces: `computeExchangeTier(input: { buyback: Decimal; ncv: Decimal; basePrice: Decimal | null; marketCheckPct: number }): 'AUTO' | 'REVIEW' | 'ESCALATE'` — Task 7 (submit/preview) และ Task 8 (approve re-check) เรียกใช้

- [ ] **Step 1: เขียน failing tests**

```ts
// apps/api/src/modules/contract-exchange/exchange-tier.util.spec.ts
import { Decimal } from '@prisma/client/runtime/library';
import { computeExchangeTier } from './exchange-tier.util';

const d = (v: string | number) => new Decimal(v);
// Workbook fixture: NCV = 7,333.28, basePrice สมมติ 9,176.47 → marketMin(85%) = 7,800.00
const NCV = d('7333.28');
const BASE = d('9176.47');

describe('computeExchangeTier (spec §6)', () => {
  const t = (buyback: string, basePrice: Decimal | null = BASE) =>
    computeExchangeTier({ buyback: d(buyback), ncv: NCV, basePrice, marketCheckPct: 15 });

  it('Case 2A: 8,000 ≥ NCV และ ≥ marketMin → AUTO', () => expect(t('8000')).toBe('AUTO'));
  it('Case 2B: 9,000 → AUTO', () => expect(t('9000')).toBe('AUTO'));
  it('Case 2C resolved: = NCV แต่ตก market check (7,333.28 < 7,800) → REVIEW', () =>
    expect(t('7333.28')).toBe('REVIEW'));
  it('= NCV และไม่มี valuation row → REVIEW (force)', () =>
    expect(t('7333.28', null)).toBe('REVIEW'));
  it('Case 2D: 6,000 ∈ [70%NCV, NCV) → REVIEW', () => expect(t('6000')).toBe('REVIEW'));
  it('boundary: = 70%×NCV (5,133.296) → REVIEW ไม่ใช่ ESCALATE', () =>
    expect(t('5133.296')).toBe('REVIEW'));
  it('Case 2E: 3,200 < 70%×NCV → ESCALATE', () => expect(t('3200')).toBe('ESCALATE'));
  it('Case 2F/2G: 11,000 / 12,000 → AUTO', () => {
    expect(t('11000')).toBe('AUTO');
    expect(t('12000')).toBe('AUTO');
  });
  it('≥ NCV, มี valuation, ผ่าน marketMin พอดีเป๊ะ (7,800.00) → AUTO', () =>
    expect(t('7800')).toBe('AUTO'));
});
```

- [ ] **Step 2: รันให้ fail**

```bash
npm --prefix apps/api run test -- --testPathPattern=exchange-tier
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// apps/api/src/modules/contract-exchange/exchange-tier.util.ts
import { Decimal } from '@prisma/client/runtime/library';

export type ExchangeTier = 'AUTO' | 'REVIEW' | 'ESCALATE';

export interface ExchangeTierInput {
  buyback: Decimal;
  /** NCV = GL(11-2101) − GL(11-2106) ของสัญญาเก่า ณ เวลาคำนวณ */
  ncv: Decimal;
  /** ราคากลางจาก TradeInValuation (null = ไม่มี row ของรุ่น/สภาพนั้น) */
  basePrice: Decimal | null;
  /** SystemConfig exchange_market_check_pct (default 15) */
  marketCheckPct: number;
}

/**
 * Approval matrix (spec §6, แก้ความกำกวม workbook Case 2C แล้ว):
 *   ESCALATE : buyback < 70% × NCV                      (OWNER เท่านั้น)
 *   REVIEW   : 70%×NCV ≤ buyback < NCV                  (BRANCH_MANAGER+)
 *              หรือ ≥ NCV แต่ตก market check / ไม่มีราคากลาง
 *   AUTO     : buyback ≥ NCV และ buyback ≥ basePrice × (1 − pct/100)
 */
export function computeExchangeTier(input: ExchangeTierInput): ExchangeTier {
  const { buyback, ncv, basePrice, marketCheckPct } = input;
  if (buyback.lt(ncv.times('0.70'))) return 'ESCALATE';
  if (buyback.lt(ncv)) return 'REVIEW';
  if (basePrice === null) return 'REVIEW';
  const marketMin = basePrice.times(new Decimal(100).minus(marketCheckPct).div(100));
  if (buyback.lt(marketMin)) return 'REVIEW';
  return 'AUTO';
}
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
npm --prefix apps/api run test -- --testPathPattern=exchange-tier
```

Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/contract-exchange/exchange-tier.util.ts apps/api/src/modules/contract-exchange/exchange-tier.util.spec.ts
git commit -m "feat(exchange): tier util — NCV/market-check approval matrix (AUTO/REVIEW/ESCALATE)"
```

---

### Task 4: A.3 template — ขาเงินสด 2 ทิศ (Cases 2A-2E โอนเพิ่ม / 2G คืนลูกค้า)

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/exchange-clear-vendor-21-1106.template.ts` (ทั้งไฟล์ — replace)
- Test: `apps/api/src/modules/journal/exchange-clear-vendor-21-1106.template.spec.ts` (เพิ่ม describe ใหม่ — คง test เดิม)

**Interfaces:**
- Consumes: `JournalAutoService.createAndPost(input, tx)` (เดิม)
- Produces: `ExchangeClearVendorInput` เพิ่ม `depositAccountCode?: string` — Task 9 ส่งค่าจาก request; `CASH_ACCOUNT_CODES` export — Task 7 DTO ใช้ validate

- [ ] **Step 1: เพิ่ม failing tests** — เปิด spec ไฟล์เดิมดู pattern การ mock (`createAndPost` jest.fn ที่ capture input) แล้วเพิ่ม describe ต่อท้ายด้วย mock แบบเดียวกัน:

```ts
describe('A.3 with cash legs (Device Swap 2026-07, spec §7.3)', () => {
  // vendorSum = 10,000 + 1,000 = 11,000 (workbook fixture)
  const yodjat = new Decimal('10000');
  const comm = new Decimal('1000');

  it('Case 2A: buyback 8,000 < vendorSum → Cr เงินสด 3,000 (FINANCE โอนเพิ่มให้ SHOP)', async () => {
    await template.execute(
      { newContractId: 'nc1', buyback: new Decimal('8000'), newVendorYodjat: yodjat, newVendorCommission: comm, depositAccountCode: '11-1201' },
      undefined,
    );
    const input = createAndPost.mock.calls[0][0];
    const cash = input.lines.find((l: any) => l.accountCode === '11-1201');
    expect(cash.cr.toString()).toBe('3000');
    expect(cash.dr.toString()).toBe('0');
    // balance: Dr 11,000 = Cr 8,000 + 3,000
    const drSum = input.lines.reduce((s: Decimal, l: any) => s.plus(l.dr), new Decimal(0));
    const crSum = input.lines.reduce((s: Decimal, l: any) => s.plus(l.cr), new Decimal(0));
    expect(drSum.toString()).toBe(crSum.toString());
  });

  it('Case 2G: buyback 12,000 > vendorSum → Dr เงินสด 1,000 (คืนเงินลูกค้า)', async () => {
    await template.execute(
      { newContractId: 'nc1', buyback: new Decimal('12000'), newVendorYodjat: yodjat, newVendorCommission: comm, depositAccountCode: '11-1101' },
      undefined,
    );
    const input = createAndPost.mock.calls[0][0];
    const cash = input.lines.find((l: any) => l.accountCode === '11-1101');
    expect(cash.dr.toString()).toBe('1000');
  });

  it('Case 2F: buyback = vendorSum → ไม่มีขาเงินสด (พฤติกรรม SP2 เดิม)', async () => {
    await template.execute(
      { newContractId: 'nc1', buyback: new Decimal('11000'), newVendorYodjat: yodjat, newVendorCommission: comm },
      undefined,
    );
    const input = createAndPost.mock.calls[0][0];
    expect(input.lines).toHaveLength(3);
  });

  it('ต่างจาก vendorSum แต่ไม่ส่ง depositAccountCode → throw ภาษาไทย', async () => {
    await expect(
      template.execute(
        { newContractId: 'nc1', buyback: new Decimal('8000'), newVendorYodjat: yodjat, newVendorCommission: comm },
        undefined,
      ),
    ).rejects.toThrow('ต้องระบุบัญชีเงินสด');
  });

  it('idempotencyKey = newContractId + contractId stamped', async () => {
    await template.execute(
      { newContractId: 'nc1', buyback: new Decimal('11000'), newVendorYodjat: yodjat, newVendorCommission: comm },
      undefined,
    );
    const meta = createAndPost.mock.calls[0][0].metadata;
    expect(meta.idempotencyKey).toBe('nc1');
    expect(meta.contractId).toBe('nc1');
  });
});
```

- [ ] **Step 2: รันให้ fail**

```bash
npm --prefix apps/api run test -- --testPathPattern=exchange-clear-vendor
```

Expected: FAIL — describe ใหม่ทุกข้อ (test เดิม perfect-offset ยัง PASS)

- [ ] **Step 3: Replace template ทั้งไฟล์**

```ts
// apps/api/src/modules/journal/cpa-templates/exchange-clear-vendor-21-1106.template.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/** 6 cash/bank accounts (accounting.md — Cash Account Dimension) */
export const CASH_ACCOUNT_CODES = [
  '11-1101',
  '11-1102',
  '11-1103',
  '11-1201',
  '11-1202',
  '11-1203',
] as const;

export interface ExchangeClearVendorInput {
  newContractId: string;
  buyback: Decimal;
  newVendorYodjat: Decimal;
  newVendorCommission: Decimal;
  /** จำเป็นเมื่อ buyback ≠ vendorSum (มีขาเงินสด) — 1 ใน CASH_ACCOUNT_CODES */
  depositAccountCode?: string;
}

/**
 * Exchange A.3 — Clear 21-1106 ตัดกับเจ้าหนี้หน้าร้านของสัญญาใหม่ + ขาเงินสด
 * (Device Swap 2026-07, spec §7.3 — workbook JE จุดที่ 3)
 *
 *   Dr 21-1101 [newVendorYodjat]
 *   Dr 21-1102 [newVendorCommission]
 *   Dr {cash}  [buyback − vendorSum]   ← ถ้า buyback > vendorSum (คืนเงินลูกค้า — Case 2G)
 *     Cr 21-1106 [buyback]
 *     Cr {cash}  [vendorSum − buyback] ← ถ้า buyback < vendorSum (โอนเพิ่มให้ SHOP — Cases 2A-2E)
 *
 * buyback == vendorSum → ไม่มีขาเงินสด (SP2 เดิม / Case 2F)
 * D5: ขาเงินสด post ทันทีตอน finalize (สมมติฐานโอนวันเดียวกัน — owner decision 2026-07-29)
 */
@Injectable()
export class ExchangeClearVendor21_1106Template {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: ExchangeClearVendorInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    const vendorSum = input.newVendorYodjat.plus(input.newVendorCommission);
    const diff = input.buyback.minus(vendorSum); // + = คืนลูกค้า, − = โอนเพิ่มให้ SHOP
    const zero = new Decimal(0);

    if (!diff.isZero()) {
      if (!input.depositAccountCode) {
        throw new BadRequestException(
          'ต้องระบุบัญชีเงินสด (depositAccountCode) เมื่อราคารับซื้อไม่เท่ากับเจ้าหนี้สัญญาใหม่',
        );
      }
      if (!(CASH_ACCOUNT_CODES as readonly string[]).includes(input.depositAccountCode)) {
        throw new BadRequestException(`บัญชีเงินสดไม่ถูกต้อง: ${input.depositAccountCode}`);
      }
    }

    const lines: Array<{ accountCode: string; dr: Decimal; cr: Decimal; description?: string }> = [
      {
        accountCode: '21-1101',
        dr: input.newVendorYodjat,
        cr: zero,
        description: 'เจ้าหนี้-หน้าร้าน (ยอดจัดเครื่องใหม่)',
      },
      {
        accountCode: '21-1102',
        dr: input.newVendorCommission,
        cr: zero,
        description: 'เจ้าหนี้ค่าคอม-หน้าร้าน (เครื่องใหม่)',
      },
    ];

    if (diff.gt(0)) {
      lines.push({
        accountCode: input.depositAccountCode!,
        dr: diff,
        cr: zero,
        description: 'จ่ายคืนลูกค้า (ราคารับซื้อ > เจ้าหนี้สัญญาใหม่ — Case 2G)',
      });
    }

    lines.push({
      accountCode: '21-1106',
      dr: zero,
      cr: input.buyback,
      description: 'ล้างบัญชีพักเครดิตเปลี่ยนเครื่อง',
    });

    if (diff.lt(0)) {
      lines.push({
        accountCode: input.depositAccountCode!,
        dr: zero,
        cr: diff.abs(),
        description: 'เงินสด/ธนาคาร โอนเพิ่มให้หน้าร้าน (ราคารับซื้อ < เจ้าหนี้)',
      });
    }

    return this.journal.createAndPost(
      {
        description: `Exchange A.3 — clear 21-1106 (${diff.isZero() ? 'perfect offset' : diff.gt(0) ? 'refund customer' : 'top-up to SHOP'})`,
        metadata: {
          flow: 'exchange-clear-vendor-21-1106',
          idempotencyKey: input.newContractId,
          contractId: input.newContractId,
          newContractId: input.newContractId,
          buyback: input.buyback.toString(),
          cashDiff: diff.toString(),
        },
        lines,
      },
      tx,
    );
  }
}
```

หมายเหตุ: test เดิมของ perfect-offset ที่ assert throw เมื่อ `buyback != vendorSum` **ต้องแก้** — พฤติกรรมใหม่คือขาเงินสด ไม่ throw (throw เฉพาะไม่มี depositAccountCode) — อัปเดต assertion เดิมให้ตรงพฤติกรรมใหม่

- [ ] **Step 4: รันให้ผ่านทั้งไฟล์**

```bash
npm --prefix apps/api run test -- --testPathPattern=exchange-clear-vendor
```

Expected: PASS ทุกข้อ (เดิมที่แก้แล้ว + ใหม่ 5)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/journal
git commit -m "feat(exchange): A.3 cash legs — โอนเพิ่ม/คืนลูกค้า + idempotencyKey (workbook จุดที่ 3)"
```

---

### Task 5: A.5 — ExchangeEclReversalTemplate (Dr 11-2102 / Cr 42-1106)

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/exchange-ecl-reversal.template.ts`
- Test: `apps/api/src/modules/journal/exchange-ecl-reversal.template.spec.ts`
- Modify: `apps/api/src/modules/contract-exchange/contract-exchange.module.ts` (เพิ่ม provider)

**Interfaces:**
- Consumes: `glContractBalance(client, contractId, '11-2102', 'cr')` จาก `../gl-contract-balance`
- Produces: `execute(input: { oldContractId: string }, tx?): Promise<{ id: string; entryNumber: string } | null>` — null = ไม่มี provision (skip) — Task 9 เรียกหลัง A.4

- [ ] **Step 1: เขียน failing tests**

```ts
// apps/api/src/modules/journal/exchange-ecl-reversal.template.spec.ts
import { Decimal } from '@prisma/client/runtime/library';
import { ExchangeEclReversalTemplate } from './cpa-templates/exchange-ecl-reversal.template';

describe('ExchangeEclReversalTemplate (A.5 — workbook Case 4, spec §7.4)', () => {
  let createAndPost: jest.Mock;
  let findMany: jest.Mock;
  let template: ExchangeEclReversalTemplate;

  beforeEach(() => {
    createAndPost = jest.fn().mockResolvedValue({ id: 'je5', entryNumber: 'JE-202607-9999' });
    findMany = jest.fn();
    const journal = { createAndPost } as any;
    const prisma = { journalLine: { findMany } } as any;
    template = new ExchangeEclReversalTemplate(journal, prisma);
  });

  it('GL 11-2102 = 567 → Dr 11-2102 / Cr 42-1106 = 567.00 (workbook Case 4 golden)', async () => {
    findMany.mockResolvedValue([{ debit: new Decimal(0), credit: new Decimal('567') }]);
    const result = await template.execute({ oldContractId: 'c1' });
    expect(result).not.toBeNull();
    const input = createAndPost.mock.calls[0][0];
    const dr = input.lines.find((l: any) => l.accountCode === '11-2102');
    const cr = input.lines.find((l: any) => l.accountCode === '42-1106');
    expect(dr.dr.toString()).toBe('567');
    expect(cr.cr.toString()).toBe('567');
    expect(input.metadata.flow).toBe('exchange-ecl-reversal');
    expect(input.metadata.idempotencyKey).toBe('c1');
    expect(input.metadata.contractId).toBe('c1'); // ให้ glContractBalance เห็น → 11-2102 net 0
  });

  it('ไม่มี provision (GL = 0) → return null ไม่ post', async () => {
    findMany.mockResolvedValue([]);
    const result = await template.execute({ oldContractId: 'c1' });
    expect(result).toBeNull();
    expect(createAndPost).not.toHaveBeenCalled();
  });

  it('GL ติดลบ (anomaly) → return null + ไม่ post (Sentry warning)', async () => {
    findMany.mockResolvedValue([{ debit: new Decimal('100'), credit: new Decimal(0) }]);
    const result = await template.execute({ oldContractId: 'c1' });
    expect(result).toBeNull();
    expect(createAndPost).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: รันให้ fail**

```bash
npm --prefix apps/api run test -- --testPathPattern=exchange-ecl-reversal
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// apps/api/src/modules/journal/cpa-templates/exchange-ecl-reversal.template.ts
import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { glContractBalance } from '../gl-contract-balance';

/**
 * Exchange A.5 — ECL allowance reversal on derecognition (Device Swap 2026-07).
 *
 * TFRS 9 ฯ 5.5.8: derecognize สัญญา → reverse ค่าเผื่อฯ ของสัญญานั้น.
 * Workbook Case 4 + owner decision D2 (2026-07-29): Cr เข้า 42-1106
 * (รายได้จากการโอนกลับค่าเผื่อฯ) — เฉพาะ exchange path เท่านั้น;
 * JP5/write-off/stage-reverse ยังใช้ Cr 51-1103 ตาม convention เดิม (asymmetry by design).
 *
 *   Dr 11-2102 [GL balance ของสัญญาเก่า]
 *     Cr 42-1106 [เท่ากัน]
 *
 * เรียก synchronous ใน activation tx (workbook: "ถ้า error → swap rollback ทั้งหมด").
 * Null cases: GL = 0 (ไม่มี provision) / GL < 0 (anomaly → Sentry warning, ไม่ auto-heal — M1 pattern)
 */
@Injectable()
export class ExchangeEclReversalTemplate {
  private readonly logger = new Logger(ExchangeEclReversalTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: { oldContractId: string },
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string } | null> {
    const client = tx ?? this.prisma;
    const balance = await glContractBalance(client, input.oldContractId, '11-2102', 'cr');

    if (balance.lt(0)) {
      Sentry.captureMessage('Exchange A.5: negative 11-2102 balance — manual investigation required', {
        level: 'warning',
        tags: { subsystem: 'bad-debt' },
        extra: { contractId: input.oldContractId, balance: balance.toString() },
      });
      this.logger.warn(
        `A.5 skipped — negative 11-2102 balance ${balance.toString()} (contract ${input.oldContractId})`,
      );
      return null;
    }
    if (balance.lt('0.005')) {
      return null; // ไม่มี provision — ไม่ต้อง post
    }

    const zero = new Decimal(0);
    return this.journal.createAndPost(
      {
        description: `Exchange A.5 — reverse ECL allowance on derecognition (สัญญา ${input.oldContractId.slice(0, 8)})`,
        metadata: {
          tag: 'EXCHANGE-ECL-REVERSAL',
          flow: 'exchange-ecl-reversal',
          idempotencyKey: input.oldContractId,
          contractId: input.oldContractId,
          reversedProvision: balance.toFixed(2),
        },
        lines: [
          {
            accountCode: '11-2102',
            dr: balance,
            cr: zero,
            description: 'กลับค่าเผื่อหนี้สงสัยจะสูญ — derecognize จากเปลี่ยนเครื่อง (TFRS 9 ฯ 5.5.8)',
          },
          {
            accountCode: '42-1106',
            dr: zero,
            cr: balance,
            description: 'รายได้จากการโอนกลับค่าเผื่อหนี้สงสัยจะสูญ',
          },
        ],
      },
      tx,
    );
  }
}
```

- [ ] **Step 4: ลงทะเบียน provider** — ใน `contract-exchange.module.ts` เพิ่ม import + providers:

```ts
import { ExchangeEclReversalTemplate } from '../journal/cpa-templates/exchange-ecl-reversal.template';
// providers: [... , ExchangeEclReversalTemplate],
```

- [ ] **Step 5: รันให้ผ่าน + commit**

```bash
npm --prefix apps/api run test -- --testPathPattern=exchange-ecl-reversal
git add apps/api/src/modules/journal apps/api/src/modules/contract-exchange/contract-exchange.module.ts
git commit -m "feat(exchange): A.5 ECL reversal template — Dr 11-2102 / Cr 42-1106 (TFRS 9 5.5.8, D2)"
```

---

### Task 6: Idempotency + contractId tags บน A.1 / A.2 (ปิด latent bug JP5-on-EXCH-contract)

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/exchange-new-contract-1a.template.ts:63` (metadata)
- Modify: `apps/api/src/modules/journal/cpa-templates/exchange-close-old-21-1106.template.ts:120-125` (metadata)
- Test: เพิ่ม assertion ใน spec เดิมของทั้งสอง template

**Interfaces:**
- Produces: A.1 metadata `{ flow, idempotencyKey: newContractId, contractId: newContractId, newContractId }`; A.2 metadata `{ flow, idempotencyKey: oldContractId, contractId: oldContractId, oldContractId, buyback, threshold }`

**ทำไมต้อง `contractId`:** `glContractBalance` filter `metadata.contractId` เท่านั้น — ปัจจุบัน A.1 ไม่ stamp → สัญญา EXCH- ที่ถูกยึดภายหลัง JP5 จะอ่าน GL ได้ 0 ทุก leg (JE ผิดทั้งใบ). A.2 ไม่ stamp → `computeOldOutstanding` หลัง swap ยังเห็นยอดค้างเดิม (ไม่ net เป็น 0)

- [ ] **Step 1: เพิ่ม failing assertions** — ใน `exchange-close-old-21-1106.template.spec.ts` และ spec ของ A.1 (ถ้าไม่มี spec ของ A.1 ให้สร้าง `exchange-new-contract-1a.template.spec.ts` ด้วย mock pattern เดียวกับ A.2 spec):

```ts
it('stamps contractId + idempotencyKey (Device Swap Task 6)', async () => {
  // ...execute ด้วย fixture เดิมของไฟล์...
  const meta = createAndPost.mock.calls[0][0].metadata;
  expect(meta.contractId).toBe(/* oldContractId ใน A.2 / newContractId ใน A.1 */);
  expect(meta.idempotencyKey).toBe(meta.contractId);
});
```

- [ ] **Step 2: รันให้ fail แล้วแก้ metadata**

A.1 (`exchange-new-contract-1a.template.ts` line 63):

```ts
        metadata: {
          flow: 'exchange-new-contract-1a',
          idempotencyKey: newContractId,
          contractId: newContractId,
          newContractId,
        },
```

A.2 (`exchange-close-old-21-1106.template.ts` lines 120-125):

```ts
        metadata: {
          flow: 'exchange-close-old-21-1106',
          idempotencyKey: input.oldContractId,
          contractId: input.oldContractId,
          oldContractId: input.oldContractId,
          buyback: input.buyback.toString(),
          threshold: threshold.toString(),
        },
```

- [ ] **Step 3: รัน spec ทั้ง journal folder ให้เขียว + commit**

```bash
npm --prefix apps/api run test -- --testPathPattern="exchange-(new-contract|close-old)"
git add apps/api/src/modules/journal
git commit -m "fix(exchange): stamp metadata.contractId+idempotencyKey on A.1/A.2 — closes JP5-on-EXCH-contract GL blindspot"
```

---

### Task 7: Plan util + submit() routing (MEMO/PRICED) + preview endpoint

**Files:**
- Create: `apps/api/src/modules/contract-exchange/exchange-plan.util.ts`
- Test: `apps/api/src/modules/contract-exchange/exchange-plan.util.spec.ts`
- Modify: `apps/api/src/modules/contract-exchange/dto/submit-exchange-request.dto.ts`
- Modify: `apps/api/src/modules/contract-exchange/contract-exchange.service.ts` (`submit()` + helper ใหม่ + ทำ `computeOldOutstanding` ให้ถูกเรียกจาก preview ได้)
- Modify: `apps/api/src/modules/contract-exchange/contract-exchange.controller.ts` (GET `preview`)
- Test: เพิ่ม describe ใน `apps/api/src/modules/contract-exchange/contract-exchange.service.spec.ts`

**Interfaces:**
- Consumes: `computeExchangeTier` (Task 3), `CASH_ACCOUNT_CODES` (Task 4)
- Produces:
  - `computeExchangePlan({ newPrice: Decimal; months: number; monthlyRate: Decimal }): { financedAmount; storeCommission; interestTotal; vatAmount; monthlyPayment; grossExclVat }` (ทุกค่า Decimal 2dp)
  - `ContractExchangeService.buildPreview(params): Promise<ExchangePreview>` — Task 12 UI เรียกผ่าน `GET /insurance/exchange-requests/preview`
  - `submit()` สร้าง request พร้อม `mode/tier/snapshots/plan fields`; tier AUTO → auto-approve ทันที (return มี `newContractId`)

- [ ] **Step 1: Plan util — failing test (golden = ตัวเลข workbook เป๊ะ)**

```ts
// apps/api/src/modules/contract-exchange/exchange-plan.util.spec.ts
import { Decimal } from '@prisma/client/runtime/library';
import { computeExchangePlan } from './exchange-plan.util';

describe('computeExchangePlan (rounding per accounting.md)', () => {
  it('workbook fixture: 10,000 / 12 งวด / rate 0.05 → monthly 1,515.83', () => {
    const p = computeExchangePlan({
      newPrice: new Decimal('10000'),
      months: 12,
      monthlyRate: new Decimal('0.05'),
    });
    expect(p.financedAmount.toString()).toBe('10000');
    expect(p.storeCommission.toString()).toBe('1000');    // 10%
    expect(p.interestTotal.toString()).toBe('6000');      // 10000×0.05×12
    expect(p.grossExclVat.toString()).toBe('17000');
    expect(p.vatAmount.toString()).toBe('1190');          // 7% HALF_UP
    // 17000/12 ROUND_DOWN = 1416.66 + 1190/12 HALF_UP = 99.17 → 1515.83
    expect(p.monthlyPayment.toString()).toBe('1515.83');
  });
});
```

- [ ] **Step 2: รัน fail → implement**

```bash
npm --prefix apps/api run test -- --testPathPattern=exchange-plan
```

```ts
// apps/api/src/modules/contract-exchange/exchange-plan.util.ts
import { Decimal } from '@prisma/client/runtime/library';

export interface ExchangePlan {
  financedAmount: Decimal;
  storeCommission: Decimal;
  interestTotal: Decimal;
  vatAmount: Decimal;
  monthlyPayment: Decimal;
  grossExclVat: Decimal;
}

/**
 * แผนผ่อนสัญญาใหม่ (PRICED mode) — server-authoritative (spec §11).
 * Conventions ตรงกับ ExchangeNewContract1ATemplate + accounting.md:
 *   commission = financed × 10% (fallback convention เดียวกับ 1A)
 *   vat        = 7% × (financed + commission + interest), HALF_UP 2dp
 *   monthly    = grossExclVat/months ROUND_DOWN + vat/months ROUND_HALF_UP
 */
export function computeExchangePlan(input: {
  newPrice: Decimal;
  months: number;
  /** flat rate ต่อเดือน เช่น 0.05 */
  monthlyRate: Decimal;
}): ExchangePlan {
  const financedAmount = input.newPrice.toDecimalPlaces(2);
  const storeCommission = financedAmount.times('0.10').toDecimalPlaces(2);
  const interestTotal = financedAmount
    .times(input.monthlyRate)
    .times(input.months)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const grossExclVat = financedAmount.plus(storeCommission).plus(interestTotal);
  const vatAmount = grossExclVat.times('0.07').toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const monthlyPayment = grossExclVat
    .div(input.months)
    .toDecimalPlaces(2, Decimal.ROUND_DOWN)
    .plus(vatAmount.div(input.months).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
  return { financedAmount, storeCommission, interestTotal, vatAmount, monthlyPayment, grossExclVat };
}
```

- [ ] **Step 3: DTO — เพิ่ม fields (แทนที่ไฟล์เดิมทั้งไฟล์)**

```ts
// apps/api/src/modules/contract-exchange/dto/submit-exchange-request.dto.ts
import {
  IsUUID, IsString, IsArray, ArrayMaxSize, IsOptional, MinLength,
  IsIn, IsNumberString, IsInt, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CASH_ACCOUNT_CODES } from '../../journal/cpa-templates/exchange-clear-vendor-21-1106.template';

export class SubmitExchangeRequestDto {
  @IsUUID('all', { message: 'oldContractId ต้องเป็น UUID' })
  oldContractId!: string;

  @IsUUID('all', { message: 'oldProductId ต้องเป็น UUID' })
  oldProductId!: string;

  @IsUUID('all', { message: 'newProductId ต้องเป็น UUID' })
  newProductId!: string;

  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'หมายเหตุอย่างน้อย 3 ตัวอักษร' })
  conditionNote?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5, { message: 'ภาพถ่ายไม่เกิน 5 รูป' })
  @IsString({ each: true })
  conditionPhotos?: string[];

  // ===== PRICED mode (Device Swap 2026-07) =====
  @IsOptional()
  @IsNumberString({}, { message: 'ราคารับซื้อต้องเป็นตัวเลข' })
  buybackPrice?: string;

  @IsOptional()
  @IsIn(['A', 'B', 'C', 'D'], { message: 'สภาพเครื่องต้องเป็น A-D' })
  deviceCondition?: string;

  @IsOptional()
  @IsIn(CASH_ACCOUNT_CODES as unknown as string[], { message: 'บัญชีเงินสดไม่ถูกต้อง' })
  depositAccountCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'จำนวนงวดต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'จำนวนงวดอย่างน้อย 1' })
  @Max(48, { message: 'จำนวนงวดไม่เกิน 48' })
  newTotalMonths?: number;

  @IsOptional()
  @IsNumberString({}, { message: 'อัตราดอกเบี้ยต้องเป็นตัวเลข' })
  newInterestRate?: string;
}
```

- [ ] **Step 4: Service — เพิ่ม helper + แทนที่ `submit()`**

4a) imports เพิ่มบนหัวไฟล์ `contract-exchange.service.ts`:

```ts
import { computeExchangeTier, ExchangeTier } from './exchange-tier.util';
import { computeExchangePlan } from './exchange-plan.util';
import { glContractBalance } from '../journal/gl-contract-balance';
```

4b) เพิ่ม private helpers (วางเหนือ `computeOldOutstanding`):

```ts
  /** SystemConfig ตัวเลข — fallback เมื่อ row หาย/parse ไม่ได้ */
  private async configNumber(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.systemConfig.findFirst({
      where: { key, deletedAt: null },
      select: { value: true },
    });
    const n = row ? parseFloat(row.value) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  /** ราคากลางเครื่องเดิมจากตารางตีราคา (null = ไม่มี row) */
  private async lookupBasePrice(
    p: { brand: string; model: string; storage: string | null },
    condition: string,
  ): Promise<Decimal | null> {
    const row = await this.prisma.tradeInValuation.findFirst({
      where: {
        brand: p.brand,
        model: p.model,
        storage: p.storage ?? '',
        condition,
        deletedAt: null,
      },
      select: { basePrice: true },
    });
    return row ? new Decimal(row.basePrice.toString()) : null;
  }

  /** MEMO เมื่อรุ่นเดียวกันและราคาเครื่องใหม่ = ราคาบนสัญญาเดิม (spec §4 — กัน price-list drift) */
  private detectMode(
    oldProduct: { brand: string; model: string; storage: string | null },
    newProduct: { brand: string; model: string; storage: string | null },
    newPrice: Decimal,
    oldContractSellingPrice: Decimal,
  ): 'MEMO' | 'PRICED' {
    const sameModel =
      oldProduct.brand === newProduct.brand &&
      oldProduct.model === newProduct.model &&
      oldProduct.storage === newProduct.storage;
    return sameModel && newPrice.equals(oldContractSellingPrice) ? 'MEMO' : 'PRICED';
  }
```

4c) **แทนที่ `submit()` ทั้ง method**:

```ts
  async submit(dto: SubmitExchangeRequestDto, user: RequestUser) {
    const oldContract = await this.prisma.contract.findUnique({
      where: { id: dto.oldContractId },
    });
    if (!oldContract || oldContract.deletedAt) {
      throw new NotFoundException('ไม่พบสัญญาเดิม');
    }
    if (!hasCrossBranchAccess(user) && oldContract.branchId !== user.branchId) {
      throw new ForbiddenException('ไม่สามารถสร้างคำขอเปลี่ยนเครื่องของสาขาอื่นได้');
    }
    if (oldContract.status !== 'ACTIVE') {
      throw new BadRequestException(`สัญญาเดิมสถานะ ${oldContract.status} — ต้องเป็น ACTIVE`);
    }

    const [oldRaw, newRaw] = await Promise.all([
      this.prisma.product.findUnique({ where: { id: dto.oldProductId } }) as Promise<ProductPriceSnapshot | null>,
      this.prisma.product.findUnique({ where: { id: dto.newProductId } }) as Promise<ProductPriceSnapshot | null>,
    ]);
    if (!oldRaw) throw new NotFoundException('ไม่พบเครื่องเดิม');
    if (!newRaw) throw new NotFoundException('ไม่พบเครื่องใหม่');
    const oldProduct = oldRaw as any;
    const newProduct = newRaw as any;

    const resolvePriceOrNull = (p: any): Decimal | null => {
      const raw = p?.sellingPrice ?? p?.installmentPrice;
      if (raw === null || raw === undefined) return null;
      return new Decimal((raw as { toString(): string } | string).toString());
    };
    const newPrice = resolvePriceOrNull(newProduct);
    if (newPrice === null) {
      throw new BadRequestException('ราคาเครื่องใหม่ไม่ถูกตั้งค่า — ตรวจสอบเครื่องในระบบ');
    }
    if (newProduct.status !== 'IN_STOCK') {
      throw new BadRequestException('เครื่องใหม่ต้องอยู่ในสต็อก (IN_STOCK)');
    }

    const mode = this.detectMode(
      oldProduct,
      newProduct,
      newPrice,
      new Decimal(oldContract.sellingPrice.toString()),
    );

    // ---------- MEMO (workbook Case 1): ไม่มี JE, ไม่มีราคารับซื้อ ----------
    if (mode === 'MEMO') {
      if (dto.buybackPrice !== undefined) {
        throw new BadRequestException(
          'รุ่นเดิม+ราคาเดิม = เปลี่ยนแบบไม่มีรายการบัญชี (MEMO) — ห้ามระบุราคารับซื้อ',
        );
      }
      return (this.prisma as any).contractExchangeRequest.create({
        data: {
          oldContractId: dto.oldContractId,
          oldProductId: dto.oldProductId,
          newProductId: dto.newProductId,
          conditionNote: dto.conditionNote,
          conditionPhotos: dto.conditionPhotos ?? [],
          status: 'PENDING',
          mode: 'MEMO',
          requestedById: user.id,
        },
      });
    }

    // ---------- PRICED (workbook Cases 2A-2G) ----------
    if (!dto.buybackPrice) throw new BadRequestException('กรุณาระบุราคารับซื้อเครื่องเดิม');
    if (!dto.deviceCondition) throw new BadRequestException('กรุณาระบุสภาพเครื่องเดิม (A-D)');
    if (!dto.newTotalMonths) throw new BadRequestException('กรุณาระบุจำนวนงวดของสัญญาใหม่');
    const buyback = new Decimal(dto.buybackPrice);
    if (buyback.lte(0)) throw new BadRequestException('ราคารับซื้อต้องมากกว่า 0');

    const rate = dto.newInterestRate
      ? new Decimal(dto.newInterestRate)
      : new Decimal(oldContract.interestRate.toString());
    if (rate.lt(0) || rate.gt('0.15')) {
      throw new BadRequestException('อัตราดอกเบี้ยต่อเดือนต้องอยู่ระหว่าง 0 ถึง 0.15');
    }
    const plan = computeExchangePlan({ newPrice, months: dto.newTotalMonths, monthlyRate: rate });

    // Snapshot NCV + ราคากลาง + tier ณ ตอน submit (enforce ซ้ำตอน approve — spec §6)
    const outstanding = await this.computeOldOutstanding(this.prisma as any, dto.oldContractId);
    const ncv = outstanding.gross.minus(outstanding.unearnedInterest);
    const basePrice = await this.lookupBasePrice(oldProduct, dto.deviceCondition);
    const marketCheckPct = await this.configNumber('exchange_market_check_pct', 15);
    const tier: ExchangeTier = computeExchangeTier({ buyback, ncv, basePrice, marketCheckPct });

    // ขาเงินสดจะเกิดเมื่อ buyback ≠ vendorSum — บังคับเลือกบัญชีเงินตั้งแต่ submit
    const vendorSum = plan.financedAmount.plus(plan.storeCommission);
    if (!buyback.equals(vendorSum) && !dto.depositAccountCode) {
      throw new BadRequestException('กรุณาเลือกบัญชีเงินสด/ธนาคาร (ราคารับซื้อไม่เท่ากับเจ้าหนี้สัญญาใหม่)');
    }

    const request = await (this.prisma as any).contractExchangeRequest.create({
      data: {
        oldContractId: dto.oldContractId,
        oldProductId: dto.oldProductId,
        newProductId: dto.newProductId,
        conditionNote: dto.conditionNote,
        conditionPhotos: dto.conditionPhotos ?? [],
        status: 'PENDING',
        mode: 'PRICED',
        buybackPrice: buyback,
        deviceCondition: dto.deviceCondition,
        approvalTier: tier,
        ncvSnapshot: ncv,
        basePriceSnapshot: basePrice,
        depositAccountCode: dto.depositAccountCode,
        newTotalMonths: dto.newTotalMonths,
        newInterestRate: rate,
        newMonthlyPayment: plan.monthlyPayment,
        newInterestTotal: plan.interestTotal,
        newVatAmount: plan.vatAmount,
        newStoreCommission: plan.storeCommission,
        requestedById: user.id,
      },
    });

    // AUTO tier — อนุมัติทันที (audit ระบุ auto)
    if (tier === 'AUTO') {
      const approved = await this.approve(request.id, user.id, user.role ?? 'SALES', {});
      return { ...request, status: 'APPROVED', autoApproved: true, newContractId: approved.newContractId };
    }
    return request;
  }
```

หมายเหตุ: `computeOldOutstanding` เดิมรับ `tx: Prisma.TransactionClient` — เรียกด้วย `this.prisma as any` ได้ (โครง query เหมือนกัน) ตามที่โค้ดข้างบนทำ

4d) เพิ่ม `buildPreview` (public method ใหม่ วางหลัง `submit`):

```ts
  async buildPreview(params: {
    oldContractId: string;
    newProductId?: string;
    buybackPrice?: string;
    deviceCondition?: string;
    newTotalMonths?: number;
    newInterestRate?: string;
  }) {
    const oldContract = await this.prisma.contract.findUnique({ where: { id: params.oldContractId } });
    if (!oldContract || oldContract.deletedAt) throw new NotFoundException('ไม่พบสัญญาเดิม');
    const oldProduct = (await this.prisma.product.findUnique({
      where: { id: oldContract.productId },
    })) as any;

    const outstanding = await this.computeOldOutstanding(this.prisma as any, params.oldContractId);
    const ncv = outstanding.gross.minus(outstanding.unearnedInterest);
    const grossRemainingInclVat = outstanding.gross.plus(outstanding.vatReceivable);

    // Blockers (spec §7.0) — เตือนตั้งแต่ preview จะได้ไม่ไปตายตอน finalize
    const bal2103 = await glContractBalance(this.prisma as any, params.oldContractId, '11-2103', 'dr');
    const bal21_1103 = await glContractBalance(this.prisma as any, params.oldContractId, '21-1103', 'cr');
    const overdueBlocked = bal2103.abs().gte('0.005');
    const advanceBlocked =
      bal21_1103.gte('0.005') ||
      new Decimal(oldContract.advanceBalance.toString()).gt(0) ||
      new Decimal((oldContract as any).creditBalance?.toString() ?? '0').gt(0);
    const hasUnpaidLateFee = !!(await this.prisma.payment.findFirst({
      where: {
        contractId: params.oldContractId,
        status: { not: 'PAID' },
        dueDate: { lt: new Date() },
        lateFee: { gt: 0 },
        deletedAt: null,
      },
      select: { id: true },
    }));

    let mode: 'MEMO' | 'PRICED' | null = null;
    let plan: ReturnType<typeof computeExchangePlan> | null = null;
    if (params.newProductId) {
      const newProduct = (await this.prisma.product.findUnique({
        where: { id: params.newProductId },
      })) as any;
      if (newProduct) {
        const raw = newProduct.sellingPrice ?? newProduct.installmentPrice;
        const newPrice = raw != null ? new Decimal(raw.toString()) : null;
        if (newPrice) {
          mode = this.detectMode(oldProduct, newProduct, newPrice, new Decimal(oldContract.sellingPrice.toString()));
          if (mode === 'PRICED' && params.newTotalMonths) {
            const rate = params.newInterestRate
              ? new Decimal(params.newInterestRate)
              : new Decimal(oldContract.interestRate.toString());
            plan = computeExchangePlan({ newPrice, months: params.newTotalMonths, monthlyRate: rate });
          }
        }
      }
    }

    let tier: ExchangeTier | null = null;
    let basePrice: Decimal | null = null;
    let marketMin: Decimal | null = null;
    let expectedPl: Decimal | null = null;
    const marketCheckPct = await this.configNumber('exchange_market_check_pct', 15);
    if (params.buybackPrice && params.deviceCondition) {
      const buyback = new Decimal(params.buybackPrice);
      basePrice = await this.lookupBasePrice(oldProduct, params.deviceCondition);
      marketMin = basePrice
        ? basePrice.times(new Decimal(100).minus(marketCheckPct).div(100)).toDecimalPlaces(2)
        : null;
      tier = computeExchangeTier({ buyback, ncv, basePrice, marketCheckPct });
      expectedPl = buyback.minus(grossRemainingInclVat); // − = loss (Dr 51-1102), + = gain (Cr 41-1102)
    }

    return {
      mode,
      ncv: ncv.toFixed(2),
      grossRemainingInclVat: grossRemainingInclVat.toFixed(2),
      unearnedInterest: outstanding.unearnedInterest.toFixed(2),
      basePrice: basePrice?.toFixed(2) ?? null,
      marketMin: marketMin?.toFixed(2) ?? null,
      marketCheckPct,
      tier,
      expectedPl: expectedPl?.toFixed(2) ?? null,
      plan: plan
        ? {
            financedAmount: plan.financedAmount.toFixed(2),
            storeCommission: plan.storeCommission.toFixed(2),
            interestTotal: plan.interestTotal.toFixed(2),
            vatAmount: plan.vatAmount.toFixed(2),
            monthlyPayment: plan.monthlyPayment.toFixed(2),
          }
        : null,
      blockers: { overdueBlocked, advanceBlocked },
      hasUnpaidLateFee,
    };
  }
```

- [ ] **Step 5: Controller — เพิ่ม preview route** (วางเหนือ `@Get('pending')`):

```ts
  @Get('preview')
  @Roles('SALES', 'BRANCH_MANAGER', 'OWNER')
  preview(
    @Query('oldContractId') oldContractId: string,
    @Query('newProductId') newProductId?: string,
    @Query('buybackPrice') buybackPrice?: string,
    @Query('deviceCondition') deviceCondition?: string,
    @Query('newTotalMonths') newTotalMonths?: string,
    @Query('newInterestRate') newInterestRate?: string,
  ) {
    return this.svc.buildPreview({
      oldContractId,
      newProductId,
      buybackPrice,
      deviceCondition,
      newTotalMonths: newTotalMonths ? parseInt(newTotalMonths, 10) : undefined,
      newInterestRate,
    });
  }
```

(เพิ่ม `Query` เข้า import จาก `@nestjs/common`)

- [ ] **Step 6: Service unit tests — เพิ่ม describe ใน `contract-exchange.service.spec.ts`** (ใช้ mock harness เดิมของไฟล์; อัปเดต mock `contractExchangeRequest.create` ให้ echo `data`):

```ts
describe('submit() mode routing (Device Swap 2026-07)', () => {
  it('same model + ราคาเท่า contract.sellingPrice → MEMO (ไม่มี buybackPrice)', async () => {
    // fixture: oldContract.sellingPrice = 11000, newProduct ราคา 11000 รุ่นเดียวกัน
    const result = await service.submit(baseDto, user);
    expect(result.mode).toBe('MEMO');
  });

  it('MEMO + ส่ง buybackPrice มา → BadRequest ภาษาไทย', async () => {
    await expect(service.submit({ ...baseDto, buybackPrice: '8000' }, user)).rejects.toThrow(
      'MEMO',
    );
  });

  it('คนละรุ่น → PRICED: ไม่ส่ง buybackPrice → BadRequest "กรุณาระบุราคารับซื้อ"', async () => {
    await expect(service.submit(pricedDtoWithoutBuyback, user)).rejects.toThrow('ราคารับซื้อ');
  });

  it('PRICED ครบ field → เก็บ tier/ncv/plan snapshot; tier REVIEW ไม่ auto-approve', async () => {
    const result = await service.submit(pricedDtoReview, user);
    expect(result.mode).toBe('PRICED');
    expect(result.approvalTier).toBe('REVIEW');
    expect(result.status).toBe('PENDING');
  });

  it('tier AUTO → auto-approve ทันที (status APPROVED + newContractId)', async () => {
    const result = await service.submit(pricedDtoAuto, user);
    expect(result.autoApproved).toBe(true);
    expect(result.newContractId).toBeDefined();
  });
});
```

(ผู้ implement ประกอบ fixture `baseDto`/`pricedDto*` จาก mock harness เดิมของไฟล์ — สาระที่ต้อง assert คือ 5 ข้อนี้)

- [ ] **Step 7: รันทั้ง module ให้เขียว + commit**

```bash
npm --prefix apps/api run test -- --testPathPattern=contract-exchange
./tools/check-types.sh api
git add apps/api/src/modules/contract-exchange
git commit -m "feat(exchange): submit MEMO/PRICED routing + server-side plan math + preview endpoint"
```

---

### Task 8: approve() — tier-role enforcement + PRICED plan + MEMO apply

**Files:**
- Modify: `apps/api/src/modules/contract-exchange/contract-exchange.service.ts` (`approve()`)
- Create: `apps/api/src/modules/contract-exchange/dto/approve-exchange-request.dto.ts`
- Modify: `apps/api/src/modules/contract-exchange/contract-exchange.controller.ts` (roles + body)
- Test: เพิ่ม describe ใน service spec

**Interfaces:**
- Produces: `approve(id: string, userId: string, userRole: string, dto: ApproveExchangeRequestDto): Promise<{ id; newContractId: string | null; mode: string }>` — Task 7 (auto-approve) เรียกด้วย signature นี้แล้ว

- [ ] **Step 1: DTO ใหม่**

```ts
// apps/api/src/modules/contract-exchange/dto/approve-exchange-request.dto.ts
import { IsOptional, IsBoolean } from 'class-validator';

export class ApproveExchangeRequestDto {
  /** MEMO mode: ยืนยันพิมพ์+เซ็นบันทึกแนบท้ายสัญญา (ContractDocumentType.ADDENDUM มีอยู่แล้ว) */
  @IsOptional()
  @IsBoolean()
  memoAddendumSigned?: boolean;

  /** MEMO mode: ยืนยันถอน MDM เครื่องเก่า + ลงทะเบียน MDM เครื่องใหม่แล้ว */
  @IsOptional()
  @IsBoolean()
  memoMdmSwapped?: boolean;
}
```

- [ ] **Step 2: Failing tests**

```ts
describe('approve() tier authorization + MEMO apply (Device Swap 2026-07)', () => {
  it('ESCALATE tier + role BRANCH_MANAGER → Forbidden', async () => {
    // fixture: request PENDING, mode PRICED, approvalTier ESCALATE
    await expect(service.approve('req1', 'u1', 'BRANCH_MANAGER', {})).rejects.toThrow(
      'OWNER',
    );
  });

  it('REVIEW tier + BRANCH_MANAGER → ผ่าน', async () => {
    await expect(service.approve('req2', 'u1', 'BRANCH_MANAGER', {})).resolves.toBeDefined();
  });

  it('MEMO: checklist ไม่ครบ → BadRequest', async () => {
    await expect(
      service.approve('memoReq', 'u1', 'BRANCH_MANAGER', { memoAddendumSigned: true }),
    ).rejects.toThrow('checklist');
  });

  it('MEMO: checklist ครบ → เปลี่ยน productId บนสัญญาเดิม, ไม่สร้างสัญญาใหม่, ไม่มี JE', async () => {
    const result = await service.approve('memoReq', 'u1', 'OWNER', {
      memoAddendumSigned: true,
      memoMdmSwapped: true,
    });
    expect(result.newContractId).toBeNull();
    expect(txMock.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'oldC1' },
        data: expect.objectContaining({ productId: 'newP1' }),
      }),
    );
    expect(createAndPostSpy).not.toHaveBeenCalled();
  });

  it('PRICED: สัญญาใหม่ใช้แผนจาก request snapshot (ไม่ clone งวดเดิม)', async () => {
    await service.approve('pricedReq', 'u1', 'OWNER', {});
    const created = txMock.contract.create.mock.calls[0][0].data;
    expect(created.totalMonths).toBe(12);
    expect(created.monthlyPayment.toString()).toBe('1515.83');
    expect(created.financedAmount.toString()).toBe('10000');
    expect(created.interestTotal.toString()).toBe('6000');
    expect(created.downPayment.toString()).toBe('0');
  });
});
```

- [ ] **Step 3: Implement — แทนที่ `approve()` ด้วยเวอร์ชันใหม่**

```ts
  async approve(
    id: string,
    userId: string,
    userRole: string,
    dto: ApproveExchangeRequestDto,
  ) {
    // Tier-role enforcement ที่ service (spec §6) — controller เปิด OWNER+BM แล้ว
    const pre = await (this.prisma as any).contractExchangeRequest.findUnique({ where: { id } });
    if (!pre || pre.deletedAt) throw new NotFoundException('ไม่พบคำขอเปลี่ยนเครื่อง');
    if (
      pre.mode === 'PRICED' &&
      pre.approvalTier === 'ESCALATE' &&
      userRole !== 'OWNER'
    ) {
      throw new ForbiddenException(
        'ราคารับซื้อต่ำกว่า 70% ของมูลค่าคงเหลือ — ต้องให้ผู้จัดการใหญ่ (OWNER) อนุมัติเท่านั้น',
      );
    }

    if (pre.mode === 'MEMO') {
      return this.approveMemo(id, userId, dto);
    }
    return this.approvePriced(id, userId);
  }

  /** MEMO (workbook Case 1): เปลี่ยน device บนสัญญาเดิม — ไม่มี JE, ไม่มีสัญญาใหม่ (spec §8) */
  private async approveMemo(id: string, userId: string, dto: ApproveExchangeRequestDto) {
    if (!dto.memoAddendumSigned || !dto.memoMdmSwapped) {
      throw new BadRequestException(
        'ต้องยืนยัน checklist ก่อนอนุมัติ: บันทึกแนบท้ายสัญญา (ADDENDUM) + สลับ MDM เครื่องเก่า/ใหม่',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const lock = await (tx as any).contractExchangeRequest.updateMany({
        where: { id, status: 'PENDING', deletedAt: null },
        data: {
          status: 'APPROVED',
          approvedById: userId,
          approvedAt: new Date(),
          memoAppliedAt: new Date(),
        },
      });
      if (lock.count !== 1) {
        throw new ConflictException('คำขออาจถูกอนุมัติแล้ว หรือสถานะเปลี่ยน');
      }
      const req = await (tx as any).contractExchangeRequest.findUniqueOrThrow({
        where: { id },
        include: { oldContract: true },
      });
      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const oldProduct = await tx.product.findUniqueOrThrow({
        where: { id: req.oldProductId },
        select: { status: true, ownedByCompanyId: true },
      });

      // เครื่องใหม่รับสถานะ/ownership ของเครื่องเดิม (FINANCE ถือกรรมสิทธิ์ระหว่างผ่อน)
      await tx.product.update({
        where: { id: req.newProductId },
        data: { status: oldProduct.status, ownedByCompanyId: oldProduct.ownedByCompanyId } as any,
      });
      await tx.product.update({
        where: { id: req.oldProductId },
        data: { status: 'REFURBISHED', ownedByCompanyId: shopCompanyId } as any,
      });
      // หัวใจ MEMO: สัญญาเดิม-สถานะเดิม-ตารางเดิม แค่ชี้ product ใหม่
      await tx.contract.update({
        where: { id: req.oldContractId },
        data: { productId: req.newProductId },
      });

      await this.audit.log({
        action: 'EXCHANGE_MEMO_APPLIED',
        entity: 'contract_exchange_request',
        entityId: id,
        userId,
        newValue: {
          contractId: req.oldContractId,
          oldProductId: req.oldProductId,
          newProductId: req.newProductId,
          checklist: { addendumSigned: true, mdmSwapped: true },
          note: 'Memo-only swap — no JE (workbook Case 1, TFRS 9 modification)',
        },
      });
      return { id, newContractId: null, mode: 'MEMO' };
    });
  }

  /** PRICED: เดิมคือ approve() ทั้งก้อน — เปลี่ยนเฉพาะที่มาของแผนผ่อน */
  private async approvePriced(id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // ...โค้ดเดิมของ approve() ทั้งหมด (lock → re-fetch → PDPA clone → contract.create →
      //    reserve product → link → audit) ยกมาทั้งก้อน โดยแก้ 1 จุด: บล็อกคำนวณแผน...
      //
      // แทนที่บล็อก "3. Remaining-installment plan" (paidCount/remainingMonths/monthlyPayment/
      // newFinanced/newCommission/newInterest) ด้วย:
      const req0 = await (tx as any).contractExchangeRequest.findUniqueOrThrow({
        where: { id },
        include: { oldContract: true, newProduct: true },
      });
      const old = req0.oldContract;
      let planFields: {
        totalMonths: number;
        monthlyPayment: Decimal;
        financedAmount: Decimal;
        storeCommission: Decimal;
        interestTotal: Decimal;
        interestRate: Decimal;
        vatAmount: Decimal;
        sellingPrice: Decimal;
      };
      if (req0.newTotalMonths != null) {
        // Device Swap 2026-07: แผนใหม่จาก server-computed snapshot ตอน submit
        planFields = {
          totalMonths: req0.newTotalMonths,
          monthlyPayment: new Decimal(req0.newMonthlyPayment.toString()),
          financedAmount: new Decimal(req0.newProduct.installmentPrice.toString()),
          storeCommission: new Decimal(req0.newStoreCommission.toString()),
          interestTotal: new Decimal(req0.newInterestTotal.toString()),
          interestRate: new Decimal(req0.newInterestRate.toString()),
          vatAmount: new Decimal(req0.newVatAmount.toString()),
          sellingPrice: new Decimal(req0.newProduct.installmentPrice.toString()),
        };
      } else {
        // Legacy fallback (in-flight PENDING ก่อน deploy): clone งวดคงเหลือแบบ SP2 เดิม
        const paidCount = await tx.payment.count({
          where: { contractId: old.id, status: 'PAID', deletedAt: null },
        });
        const remainingMonths = old.totalMonths - paidCount;
        if (remainingMonths <= 0) {
          throw new BadRequestException('สัญญาเดิมจ่ายครบงวดแล้ว — เปลี่ยนเครื่องไม่ได้');
        }
        const monthlyPayment = new Decimal(old.monthlyPayment.toString());
        const newFinanced = new Decimal(old.financedAmount.toString());
        const newCommission = old.storeCommission
          ? new Decimal(old.storeCommission.toString())
          : new Decimal(0);
        planFields = {
          totalMonths: remainingMonths,
          monthlyPayment,
          financedAmount: newFinanced,
          storeCommission: newCommission,
          interestTotal: monthlyPayment.times(remainingMonths).minus(newFinanced),
          interestRate: new Decimal(old.interestRate.toString()),
          vatAmount: new Decimal(old.vatAmount?.toString() ?? '0'),
          sellingPrice: new Decimal(old.sellingPrice.toString()),
        };
      }
      // ...จากนั้น contract.create ใช้ planFields.* แทนตัวแปรเดิมทุกตัว
      // (totalMonths, monthlyPayment, financedAmount, storeCommission, interestTotal,
      //  interestRate, vatAmount, sellingPrice) — ที่เหลือคงเดิม 100%
      // และ return { id, newContractId: newContract.id, mode: 'PRICED' }
    });
  }
```

(ผู้ implement: ย้ายโค้ด body เดิมของ `approve()` เข้า `approvePriced()` ตาม comment — โครง lock/PDPA/create/reserve/audit **ห้ามเปลี่ยน** เปลี่ยนเฉพาะบล็อกแผน + return shape)

- [ ] **Step 4: Controller — เปิด BM + ส่ง role/body**

```ts
  @Post(':id/approve')
  @Roles('OWNER', 'BRANCH_MANAGER')
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveExchangeRequestDto,
    @Req() req: any,
  ) {
    return this.svc.approve(id, req.user.id, req.user.role, dto ?? {});
  }

  @Get('pending')
  @Roles('OWNER', 'BRANCH_MANAGER')
  listPending() {
    return this.svc.listPending();
  }
```

- [ ] **Step 5: รัน + commit**

```bash
npm --prefix apps/api run test -- --testPathPattern=contract-exchange
./tools/check-types.sh api
git add apps/api/src/modules/contract-exchange
git commit -m "feat(exchange): approve — tier-role enforcement, PRICED plan from snapshot, MEMO in-place apply"
```

---

### Task 9: finalize — guards + buyback จาก request + A.5 wiring

**Files:**
- Modify: `apps/api/src/modules/contract-exchange/contract-exchange.service.ts` (`finalizeAfterActivation`)
- Test: เพิ่ม describe ใน service spec

**Interfaces:**
- Consumes: `ExchangeEclReversalTemplate.execute({ oldContractId }, tx)` (Task 5), A.3 `depositAccountCode` (Task 4)
- Produces: return เพิ่ม `je5Id: string | null`; inject template ใหม่ใน constructor: `private readonly t5: ExchangeEclReversalTemplate`

- [ ] **Step 1: Failing tests**

```ts
describe('finalizeAfterActivation guards + A.5 (Device Swap 2026-07)', () => {
  it('GL 11-2103 > 0 (งวดค้าง accrued) → BadRequest ก่อน post JE ใดๆ', async () => {
    // mock journalLine.findMany สำหรับ 11-2103 ให้มี Dr 1515.83
    await expect(service.finalizeAfterActivation(newContract, txMock)).rejects.toThrow(
      'งวดค้าง',
    );
    expect(createAndPostSpy).not.toHaveBeenCalled();
  });

  it('advanceBalance > 0 → BadRequest "เงินรับล่วงหน้า"', async () => {
    await expect(service.finalizeAfterActivation(newContract, txMock)).rejects.toThrow(
      'เงินรับล่วงหน้า',
    );
  });

  it('PRICED: buyback = request.buybackPrice (ไม่ใช่ vendorSum) + ส่ง depositAccountCode เข้า A.3', async () => {
    // fixture: request.buybackPrice = 8000, depositAccountCode = '11-1201'
    await service.finalizeAfterActivation(newContract, txMock);
    expect(t3Execute).toHaveBeenCalledWith(
      expect.objectContaining({
        buyback: expect.objectContaining({}), // Decimal 8000 — assert .toString() === '8000'
        depositAccountCode: '11-1201',
      }),
      txMock,
    );
  });

  it('A.5 ถูกเรียกหลัง A.4 + je5Id เก็บบน request + provision rows → REVERSED', async () => {
    await service.finalizeAfterActivation(newContract, txMock);
    expect(t5Execute).toHaveBeenCalledWith({ oldContractId: 'oldC1' }, txMock);
    expect(txMock.badDebtProvision.updateMany).toHaveBeenCalledWith({
      where: { contractId: 'oldC1', status: 'ACTIVE', deletedAt: null },
      data: { status: 'REVERSED' },
    });
  });

  it('legacy request (buybackPrice null) → fallback buyback = newFinanced + newCommission', async () => {
    await service.finalizeAfterActivation(newContract, txMock);
    // assert A.2 ได้ buyback = 11000
  });
});
```

- [ ] **Step 2: Implement** — ใน `finalizeAfterActivation` หลังบรรทัด `if (!request) throw ...`:

```ts
    // ---- Pre-flight guards (spec §7.0) ----
    const bal2103 = await glContractBalance(tx, oldContractId, '11-2103', 'dr');
    if (bal2103.abs().gte('0.005')) {
      throw new BadRequestException(
        `มีงวดค้างชำระ (11-2103 = ${bal2103.toFixed(2)}) — เคลียร์งวดค้างก่อนเปลี่ยนเครื่อง`,
      );
    }
    const bal21_1103 = await glContractBalance(tx, oldContractId, '21-1103', 'cr');
    const oldC = await tx.contract.findUniqueOrThrow({
      where: { id: oldContractId },
      select: { advanceBalance: true, creditBalance: true },
    });
    if (
      bal21_1103.gte('0.005') ||
      new Decimal(oldC.advanceBalance.toString()).gt(0) ||
      new Decimal((oldC as any).creditBalance?.toString() ?? '0').gt(0)
    ) {
      throw new BadRequestException(
        'มีเงินรับล่วงหน้า/เครดิตค้างบนสัญญาเดิม — ใช้หรือคืนเงินก่อนเปลี่ยนเครื่อง',
      );
    }
```

แก้บรรทัดคำนวณ `buyback` (เดิม `const buyback = newFinanced.plus(newCommission);`):

```ts
    const buyback = request.buybackPrice
      ? new Decimal(request.buybackPrice.toString())
      : newFinanced.plus(newCommission); // legacy same-price fallback
```

แก้ call A.3 เพิ่ม `depositAccountCode`:

```ts
    const je3 = await this.t3.execute(
      {
        newContractId: newContract.id,
        buyback,
        newVendorYodjat: newFinanced,
        newVendorCommission: newCommission,
        depositAccountCode: request.depositAccountCode ?? undefined,
      },
      tx,
    );
```

หลัง JE A.4 (ก่อน "8. Old-side status flips") เพิ่ม:

```ts
    // JE A.5 — ECL reversal on derecognition (workbook Case 4, synchronous ใน tx เดียวกัน)
    const je5 = await this.t5.execute({ oldContractId }, tx);
    if (je5) {
      await (tx as any).badDebtProvision.updateMany({
        where: { contractId: oldContractId, status: 'ACTIVE', deletedAt: null },
        data: { status: 'REVERSED' },
      });
    }
```

อัปเดตการเขียน je ids + return + audit newValue ให้รวม `je5Id: je5?.id ?? null` และ `eclReversalJeId: je5?.id ?? null` (คอลัมน์ Task 1) — และ constructor เพิ่ม `private readonly t5: ExchangeEclReversalTemplate`

- [ ] **Step 3: รัน + commit**

```bash
npm --prefix apps/api run test -- --testPathPattern=contract-exchange
git add apps/api/src/modules/contract-exchange
git commit -m "feat(exchange): finalize guards (11-2103/advance) + real buyback + A.5 ECL reversal wiring"
```

---

### Task 10: Cancellation — reversal template + service + endpoint

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/exchange-cancel-reversal.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/exchange-cancel-penalty.template.ts`
- Create: `apps/api/src/modules/contract-exchange/contract-exchange-cancel.service.ts`
- Create: `apps/api/src/modules/contract-exchange/dto/cancel-exchange-request.dto.ts`
- Modify: `contract-exchange.controller.ts` (+`POST :id/cancel`), `contract-exchange.module.ts` (+providers)
- Test: `apps/api/src/modules/contract-exchange/contract-exchange-cancel.service.spec.ts` + template specs

**Interfaces:**
- Consumes: request fields จาก Task 1 (`je1aId..je4Id, eclReversalJeId, buybackPrice, depositAccountCode, mode, memoAppliedAt`), `CompanyResolverService`
- Produces: `ExchangeCancelService.cancel(id, reason, user): Promise<{ id; cancelWindow; penaltyAmount: string | null }>`

- [ ] **Step 1: Reversal template (mirror ตาม JE ids + sweep สัญญาใหม่)**

```ts
// apps/api/src/modules/journal/cpa-templates/exchange-cancel-reversal.template.ts
import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Device Swap 2026-07 — ยกเลิก swap (workbook Cases 3A/3B, spec §9).
 * Mirror-reverse ทุกบรรทัด (Corrective Control C1 — ห้ามแก้ JE เดิม):
 *   1. JE ตาม ids ที่ request บันทึกไว้ (A.1/A.2/A.3/A.4/A.5) — แม่นกว่า metadata sweep
 *   2. sweep JE อื่นที่ tag metadata.contractId = newContractId (เช่น 2A accrual
 *      ที่วิ่งบนสัญญาใหม่ระหว่าง window) — ยกเว้น payment flows (ถูก guard บล็อกก่อนแล้ว)
 * Mirror ต้อง copy companyId (A.4 = SHOP!) + metadata.contractId เดิม เพื่อให้
 * glContractBalance net เป็น 0 ทุกบัญชีทุกสัญญา
 */
@Injectable()
export class ExchangeCancelReversalTemplate {
  private readonly logger = new Logger(ExchangeCancelReversalTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async reverse(
    input: { jeIds: string[]; newContractId: string },
    tx?: Prisma.TransactionClient,
  ): Promise<{ reversalJeIds: string[] }> {
    const client = tx ?? this.prisma;
    const byId = await client.journalEntry.findMany({
      where: { id: { in: input.jeIds }, status: 'POSTED', deletedAt: null },
      include: { lines: true },
    });
    const swept = await client.journalEntry.findMany({
      where: {
        metadata: { path: ['contractId'], equals: input.newContractId } as any,
        status: 'POSTED',
        deletedAt: null,
      },
      include: { lines: true },
    });
    const all = new Map<string, (typeof byId)[number]>();
    for (const je of [...byId, ...swept]) all.set(je.id, je);

    const reversalJeIds: string[] = [];
    for (const je of all.values()) {
      const meta = (je.metadata ?? {}) as Record<string, unknown>;
      if (meta['reversed'] === true) continue;
      if (meta['flow'] === 'exchange-cancel') continue; // reversal ของตัวเองที่ sweep เจอ
      if (je.lines.length === 0) continue;

      const reversedLines = je.lines.map((l) => ({
        accountCode: l.accountCode,
        dr: new Decimal(l.credit.toString()),
        cr: new Decimal(l.debit.toString()),
        description: `[ยกเลิกเปลี่ยนเครื่อง] ${l.description ?? ''}`.trim(),
      }));

      const result = await this.journal.createAndPost(
        {
          description: `[ยกเลิกเปลี่ยนเครื่อง] กลับรายการ ${je.entryNumber}`,
          reference: `${je.id}:exchange-cancel`,
          companyId: je.companyId, // สำคัญ: A.4 เป็น SHOP company
          metadata: {
            tag: 'REVERSAL',
            flow: 'exchange-cancel',
            idempotencyKey: `cancel:${je.id}`,
            originalEntryId: je.id,
            reversesEntryId: je.id,
            contractId: (meta['contractId'] as string | undefined) ?? undefined,
          },
          lines: reversedLines,
        },
        tx,
      );

      await client.journalEntry.update({
        where: { id: je.id },
        data: {
          metadata: {
            ...(meta as Prisma.InputJsonObject),
            reversed: true,
            reversedByEntryNumber: result.entryNumber,
          },
        },
      });
      reversalJeIds.push(result.id);
    }
    this.logger.log(`Exchange cancel — reversed ${reversalJeIds.length} JE(s)`);
    return { reversalJeIds };
  }
}
```

- [ ] **Step 2: Penalty template**

```ts
// apps/api/src/modules/journal/cpa-templates/exchange-cancel-penalty.template.ts
import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * ค่าปรับยกเลิก swap วันที่ 8-30 (workbook Case 3B; บัญชีเปลี่ยนจาก 41-1199 → 42-1107 ตาม spec §2):
 *   Dr {cash} [penalty] / Cr 42-1107 [penalty] — ไม่มี VAT (นโยบายค่าปรับ)
 */
@Injectable()
export class ExchangeCancelPenaltyTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: { requestId: string; oldContractId: string; depositAccountCode: string; penalty: Decimal },
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    const zero = new Decimal(0);
    return this.journal.createAndPost(
      {
        description: `ค่าปรับยกเลิกเปลี่ยนเครื่อง (8-30 วัน) — คำขอ ${input.requestId.slice(0, 8)}`,
        metadata: {
          flow: 'exchange-cancel-penalty',
          idempotencyKey: input.requestId,
          contractId: input.oldContractId,
          requestId: input.requestId,
        },
        lines: [
          { accountCode: input.depositAccountCode, dr: input.penalty, cr: zero, description: 'รับเงินค่าปรับจากลูกค้า' },
          { accountCode: '42-1107', dr: zero, cr: input.penalty, description: 'รายได้ค่าปรับยกเลิกเปลี่ยนเครื่อง (ไม่มี VAT)' },
        ],
      },
      tx,
    );
  }
}
```

- [ ] **Step 3: Cancel service + DTO — failing tests ก่อน (หัวใจ 6 ข้อ)**

```ts
// contract-exchange-cancel.service.spec.ts — mock harness แบบเดียวกับ service spec เดิม
describe('ExchangeCancelService (spec §9)', () => {
  it('วันที่ 5 → FREE_7D: reverse ทุก JE, ไม่มี penalty, restore สัญญาเก่า ACTIVE', async () => {
    const r = await svc.cancel('req1', 'เครื่องมีปัญหา ลูกค้าขอยกเลิก', user);
    expect(r.cancelWindow).toBe('FREE_7D');
    expect(r.penaltyAmount).toBeNull();
    expect(txMock.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'oldC1' }, data: expect.objectContaining({ status: 'ACTIVE', exchangedAt: null }) }),
    );
  });
  it('วันที่ 15 → PENALTY_8_30D: penalty = 5% × buyback (8000 → 400.00) + JE Cr 42-1107', async () => {
    const r = await svc.cancel('req1', 'ลูกค้าเปลี่ยนใจหลังใช้งาน', user);
    expect(r.cancelWindow).toBe('PENALTY_8_30D');
    expect(r.penaltyAmount).toBe('400.00');
  });
  it('วันที่ 31 → BadRequest "เกิน 30 วัน"', async () => {
    await expect(svc.cancel('req1', 'สายเกินไปแล้วนะ', user)).rejects.toThrow('30 วัน');
  });
  it('สัญญาใหม่มี amountPaid > 0 → BadRequest ให้ void ใบเสร็จก่อน', async () => {
    await expect(svc.cancel('req1', 'มีจ่ายแล้วลองยกเลิก', user)).rejects.toThrow('void');
  });
  it('PRE_FINALIZE (DRAFT ยังไม่เซ็น): soft-delete สัญญาใหม่ + คืน product, ไม่มี reversal JE', async () => {
    const r = await svc.cancel('reqDraft', 'ลูกค้าไม่มาเซ็นสัญญา', user);
    expect(r.cancelWindow).toBe('PRE_FINALIZE');
  });
  it('MEMO cancel ≤30 วัน: สลับ productId กลับ, ไม่มี JE, ไม่มี penalty', async () => {
    const r = await svc.cancel('memoReq', 'ลูกค้าขอเครื่องเดิมคืน', user);
    expect(r.cancelWindow).toBe('FREE_7D');
    expect(createAndPostSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Implement service**

```ts
// apps/api/src/modules/contract-exchange/dto/cancel-exchange-request.dto.ts
import { IsString, MinLength } from 'class-validator';
export class CancelExchangeRequestDto {
  @IsString()
  @MinLength(10, { message: 'เหตุผลยกเลิกอย่างน้อย 10 ตัวอักษร' })
  reason!: string;
}
```

```ts
// apps/api/src/modules/contract-exchange/contract-exchange-cancel.service.ts
import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { ExchangeCancelReversalTemplate } from '../journal/cpa-templates/exchange-cancel-reversal.template';
import { ExchangeCancelPenaltyTemplate } from '../journal/cpa-templates/exchange-cancel-penalty.template';

/** จำนวนวันปฏิทิน BKK ระหว่าง 2 เวลา (0 = วันเดียวกัน) */
export function bkkDayDiff(from: Date, to: Date): number {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const [fy, fm, fd] = fmt(from).split('-').map(Number);
  const [ty, tm, td] = fmt(to).split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

@Injectable()
export class ExchangeCancelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly companyResolver: CompanyResolverService,
    private readonly reversalTemplate: ExchangeCancelReversalTemplate,
    private readonly penaltyTemplate: ExchangeCancelPenaltyTemplate,
  ) {}

  async cancel(id: string, reason: string, user: { id: string }) {
    return this.prisma.$transaction(async (tx) => {
      const req = await (tx as any).contractExchangeRequest.findUnique({
        where: { id },
        include: { oldContract: true, newContract: true },
      });
      if (!req || req.deletedAt) throw new NotFoundException('ไม่พบคำขอเปลี่ยนเครื่อง');
      if (req.status !== 'APPROVED') {
        throw new BadRequestException(`ยกเลิกได้เฉพาะคำขอที่อนุมัติแล้ว (สถานะปัจจุบัน: ${req.status})`);
      }
      const now = new Date();
      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const financeCompanyId = await this.companyResolver.getFinanceCompanyId(tx);

      // ---------- MEMO: สลับกลับ ไม่มี JE ----------
      if (req.mode === 'MEMO') {
        const days = bkkDayDiff(req.memoAppliedAt ?? req.approvedAt ?? req.createdAt, now);
        if (days > 30) throw new BadRequestException('เกิน 30 วันนับจากวันเปลี่ยน — ยกเลิกไม่ได้');
        const newProd = await tx.product.findUniqueOrThrow({
          where: { id: req.newProductId },
          select: { status: true, ownedByCompanyId: true },
        });
        await tx.contract.update({ where: { id: req.oldContractId }, data: { productId: req.oldProductId } });
        await tx.product.update({
          where: { id: req.oldProductId },
          data: { status: newProd.status, ownedByCompanyId: newProd.ownedByCompanyId } as any,
        });
        await tx.product.update({
          where: { id: req.newProductId },
          data: { status: 'IN_STOCK', ownedByCompanyId: shopCompanyId } as any,
        });
        await this.markCanceled(tx, id, user.id, reason, 'FREE_7D', null, [], now);
        await this.audit.log({
          action: 'EXCHANGE_MEMO_CANCELED', entity: 'contract_exchange_request', entityId: id,
          userId: user.id, newValue: { reason, days },
        });
        return { id, cancelWindow: 'FREE_7D', penaltyAmount: null };
      }

      // ---------- PRE_FINALIZE: อนุมัติแล้วแต่ยังไม่ activate (ไม่มี JE) ----------
      const finalized = !!req.oldContract.exchangedAt && req.newContract?.status === 'ACTIVE';
      if (!finalized) {
        if (req.newContractId) {
          await tx.contract.update({ where: { id: req.newContractId }, data: { deletedAt: now } });
          await tx.product.update({
            where: { id: req.newProductId },
            data: { status: 'IN_STOCK' } as any,
          });
        }
        await this.markCanceled(tx, id, user.id, reason, 'PRE_FINALIZE', null, [], now);
        await this.audit.log({
          action: 'EXCHANGE_CANCELED', entity: 'contract_exchange_request', entityId: id,
          userId: user.id, newValue: { reason, window: 'PRE_FINALIZE' },
        });
        return { id, cancelWindow: 'PRE_FINALIZE', penaltyAmount: null };
      }

      // ---------- FINALIZED (มี JE แล้ว) ----------
      const exchangedAt: Date = req.oldContract.exchangedAt;
      const days = bkkDayDiff(exchangedAt, now);
      if (days > 30) throw new BadRequestException('เกิน 30 วันนับจากวันเปลี่ยนเครื่อง — ยกเลิกไม่ได้');

      const paid = await tx.payment.findFirst({
        where: {
          contractId: req.newContractId,
          deletedAt: null,
          OR: [{ status: 'PAID' }, { amountPaid: { gt: 0 } }],
        },
        select: { id: true },
      });
      if (paid) {
        throw new BadRequestException('มีการชำระเงินบนสัญญาใหม่แล้ว — ต้อง void ใบเสร็จทั้งหมดก่อนยกเลิก');
      }

      // 1) mirror-reverse ทุก JE (รวม A.5 ECL — GL 11-2102 คืนทันที, ECL cron delta เป็น no-op)
      const jeIds = [req.je1aId, req.je2Id, req.je3Id, req.je4Id, req.eclReversalJeId].filter(
        (x: string | null): x is string => !!x,
      );
      const { reversalJeIds } = await this.reversalTemplate.reverse(
        { jeIds, newContractId: req.newContractId },
        tx,
      );

      // 2) penalty เฉพาะวันที่ 8-30 (workbook Case 3B)
      let penalty: Decimal | null = null;
      let penaltyJeId: string | null = null;
      const window = days <= 7 ? 'FREE_7D' : 'PENALTY_8_30D';
      if (window === 'PENALTY_8_30D') {
        if (!req.depositAccountCode) {
          throw new BadRequestException('คำขอนี้ไม่มีบัญชีเงินสด — ระบุ depositAccountCode ตอน submit');
        }
        const pctRow = await tx.systemConfig.findFirst({
          where: { key: 'exchange_cancel_penalty_pct', deletedAt: null }, select: { value: true },
        });
        const pct = pctRow && Number.isFinite(parseFloat(pctRow.value)) ? parseFloat(pctRow.value) : 5;
        penalty = new Decimal(req.buybackPrice.toString()).times(pct).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        const pje = await this.penaltyTemplate.execute(
          { requestId: id, oldContractId: req.oldContractId, depositAccountCode: req.depositAccountCode, penalty },
          tx,
        );
        penaltyJeId = pje.id;
      }

      // 3) restore states (spec §9 step 3)
      await tx.contract.update({
        where: { id: req.oldContractId },
        data: { status: 'ACTIVE', exchangedAt: null } as any, // overdue cron จัดสถานะจริงต่อ; 2A cron backfill งวดที่พลาดใน tick ถัดไป
      });
      await tx.product.update({
        where: { id: req.oldProductId },
        data: { status: 'SOLD_INSTALLMENT', ownedByCompanyId: financeCompanyId } as any,
      });
      await tx.contract.update({
        where: { id: req.newContractId },
        data: { status: 'CANCELED' } as any,
      });
      await tx.payment.updateMany({
        where: { contractId: req.newContractId, deletedAt: null }, data: { deletedAt: now },
      });
      await tx.installmentSchedule.updateMany({
        where: { contractId: req.newContractId, deletedAt: null }, data: { deletedAt: now },
      });
      await tx.product.update({
        where: { id: req.newProductId },
        data: { status: 'IN_STOCK', ownedByCompanyId: shopCompanyId } as any,
      });

      await this.markCanceled(tx, id, user.id, reason, window, penalty, reversalJeIds, now, penaltyJeId);
      await this.audit.log({
        action: 'EXCHANGE_CANCELED', entity: 'contract_exchange_request', entityId: id,
        userId: user.id,
        newValue: { reason, window, days, penaltyAmount: penalty?.toFixed(2) ?? null, reversalCount: reversalJeIds.length },
      });
      return { id, cancelWindow: window, penaltyAmount: penalty?.toFixed(2) ?? null };
    });
  }

  private async markCanceled(
    tx: Prisma.TransactionClient, id: string, userId: string, reason: string,
    window: string, penalty: Decimal | null, reversalJeIds: string[], now: Date, penaltyJeId: string | null = null,
  ) {
    const lock = await (tx as any).contractExchangeRequest.updateMany({
      where: { id, status: 'APPROVED', deletedAt: null },
      data: {
        status: 'CANCELED', canceledAt: now, canceledById: userId, cancelReason: reason,
        cancelWindow: window, penaltyAmount: penalty, penaltyJeId, reversalJeIds,
      },
    });
    if (lock.count !== 1) throw new ConflictException('คำขอถูกยกเลิกไปแล้ว หรือสถานะเปลี่ยน');
  }
}
```

- [ ] **Step 5: Controller + module wiring**

```ts
// controller — เพิ่ม
  @Post(':id/cancel')
  @Roles('OWNER', 'BRANCH_MANAGER')
  cancel(@Param('id') id: string, @Body() dto: CancelExchangeRequestDto, @Req() req: any) {
    return this.cancelSvc.cancel(id, dto.reason, req.user);
  }
```

(inject `private readonly cancelSvc: ExchangeCancelService` ใน controller constructor; module providers เพิ่ม `ExchangeCancelService, ExchangeCancelReversalTemplate, ExchangeCancelPenaltyTemplate`)

- [ ] **Step 6: รัน + commit**

```bash
npm --prefix apps/api run test -- --testPathPattern="contract-exchange|exchange-cancel"
./tools/check-types.sh api
git add apps/api/src/modules
git commit -m "feat(exchange): cancellation — 7d free / 8-30d penalty 42-1107, mirror-reverse all JEs, restore states"
```

---

### Task 11: Retire case-8 golden + อัปเดต spec เดิมที่ยึด same-price

**Files:**
- Delete: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-8-same-price.csv`
- Modify: tests ที่อ้างถึง (ค้นก่อน)

- [ ] **Step 1: หา consumers**

```bash
grep -rn "case-8" "apps/api/src" --include="*.ts"
```

- [ ] **Step 2: ลบ fixture + แก้ทุก consumer** — ถ้าเป็น loader spec ที่ iterate directory: ลบไฟล์แล้ว spec ผ่านเอง; ถ้ามี spec อ้างชื่อไฟล์ตรงๆ: ลบ test case นั้นพร้อม comment `// case-8 retired — same-price = MEMO mode (no JE) per Device Swap spec 2026-07-29 D1`
- [ ] **Step 3: แก้ test เดิมใน `contract-exchange.service.spec.ts`** ที่ assert "ราคาไม่เท่า → throw" — พฤติกรรมใหม่: ราคาไม่เท่า = PRICED mode (ไม่ throw) → เปลี่ยน assertion เป็น expect PRICED routing
- [ ] **Step 4: รัน jest ทั้ง api ให้เขียว + commit**

```bash
npm --prefix apps/api run test
git add -A apps/api
git commit -m "test(exchange): retire case-8 same-price golden — superseded by MEMO mode (D1)"
```

---

### Task 12: Web — ExchangeRequestForm (PRICED inputs + live preview)

**Files:**
- Modify: `apps/web/src/pages/insurance/ExchangeRequestForm.tsx` (rewrite ส่วน form)

**Interfaces:**
- Consumes: `GET /insurance/exchange-requests/preview` (Task 7), `POST /insurance/exchange-requests` (DTO ใหม่)

- [ ] **Step 1: แก้ replacement query** — เอา filter ราคา/รุ่นออก (PRICED เปลี่ยนรุ่นได้): ใน `replacementsQ.queryFn` เปลี่ยน filter เหลือ `rows.filter((r) => r.id !== p.id)` และเปลี่ยน `queryKey` เป็น `['exchange-replacements-all', contractQ.data?.product.id]`; query products ด้วย `status=IN_STOCK&limit=200` (ตัด `brand` ออกจาก qs)

- [ ] **Step 2: เพิ่ม state + preview query** (หลัง `const [conditionNote, setConditionNote] = useState('');`):

```tsx
  const [buybackPrice, setBuybackPrice] = useState('');
  const [deviceCondition, setDeviceCondition] = useState('B');
  const [depositAccountCode, setDepositAccountCode] = useState('11-1201');
  const [newTotalMonths, setNewTotalMonths] = useState('12');

  const previewQ = useQuery<{
    mode: 'MEMO' | 'PRICED' | null;
    ncv: string; grossRemainingInclVat: string;
    basePrice: string | null; marketMin: string | null; marketCheckPct: number;
    tier: 'AUTO' | 'REVIEW' | 'ESCALATE' | null;
    expectedPl: string | null;
    plan: { financedAmount: string; storeCommission: string; interestTotal: string; vatAmount: string; monthlyPayment: string } | null;
    blockers: { overdueBlocked: boolean; advanceBlocked: boolean };
    hasUnpaidLateFee: boolean;
  }>({
    queryKey: ['exchange-preview', contractId, newProductId, buybackPrice, deviceCondition, newTotalMonths],
    queryFn: async () => {
      const qs = new URLSearchParams({ oldContractId: contractId });
      if (newProductId) qs.set('newProductId', newProductId);
      if (buybackPrice) qs.set('buybackPrice', buybackPrice);
      if (deviceCondition) qs.set('deviceCondition', deviceCondition);
      if (newTotalMonths) qs.set('newTotalMonths', newTotalMonths);
      return (await api.get(`/insurance/exchange-requests/preview?${qs}`)).data;
    },
    enabled: !!contractId,
  });
  const isMemo = previewQ.data?.mode === 'MEMO';
```

- [ ] **Step 3: แก้ submit payload** — ใน `submitM.mutationFn` เพิ่ม fields เมื่อไม่ใช่ MEMO:

```tsx
      const res = await api.post('/insurance/exchange-requests', {
        oldContractId: contractId,
        oldProductId: contractQ.data!.product.id,
        newProductId,
        conditionNote: conditionNote.trim() || undefined,
        ...(isMemo
          ? {}
          : {
              buybackPrice,
              deviceCondition,
              depositAccountCode,
              newTotalMonths: parseInt(newTotalMonths, 10),
            }),
      });
```

- [ ] **Step 4: เพิ่ม UI blocks** (วางหลัง `<select>` เครื่องทดแทน, ก่อน textarea หมายเหตุ) — ธีม tokens เท่านั้น:

```tsx
          {/* Blockers จาก preview */}
          {previewQ.data?.blockers.overdueBlocked && (
            <p className="text-xs text-destructive leading-snug">⛔ มีงวดค้างชำระ — เคลียร์ก่อนเปลี่ยนเครื่อง</p>
          )}
          {previewQ.data?.blockers.advanceBlocked && (
            <p className="text-xs text-destructive leading-snug">⛔ มีเงินรับล่วงหน้า/เครดิตค้าง — ใช้หรือคืนก่อนเปลี่ยนเครื่อง</p>
          )}
          {previewQ.data?.hasUnpaidLateFee && (
            <p className="text-xs text-warning leading-snug">⚠ มีค่าปรับล่าช้าค้างเก็บ — แนะนำเก็บก่อนเปลี่ยนเครื่อง</p>
          )}

          {newProductId && isMemo && (
            <Card className="p-4 bg-primary/5 border-primary/30 text-sm leading-snug">
              รุ่นเดิม + ราคาเดิม → <strong>เปลี่ยนแบบไม่มีรายการบัญชี (MEMO)</strong> — สัญญาเดิมผ่อนต่อ ตารางเดิม
              ไม่ต้องตีราคา (ตอนอนุมัติต้องยืนยันบันทึกแนบท้าย + สลับ MDM)
            </Card>
          )}

          {newProductId && previewQ.data?.mode === 'PRICED' && (
            <div className="space-y-3 border border-border rounded-lg p-4">
              <h3 className="text-sm font-semibold leading-snug">ตีราคารับซื้อเครื่องเดิม</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">ราคารับซื้อ (บาท)</label>
                  <input type="number" min="1" value={buybackPrice} onChange={(e) => setBuybackPrice(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-input rounded-lg bg-background text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">สภาพเครื่อง</label>
                  <select value={deviceCondition} onChange={(e) => setDeviceCondition(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-input rounded-lg bg-background text-sm">
                    {['A', 'B', 'C', 'D'].map((c) => <option key={c} value={c}>เกรด {c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">จำนวนงวดสัญญาใหม่</label>
                  <input type="number" min="1" max="48" value={newTotalMonths} onChange={(e) => setNewTotalMonths(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-input rounded-lg bg-background text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">บัญชีรับ/จ่ายเงิน</label>
                  <select value={depositAccountCode} onChange={(e) => setDepositAccountCode(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-input rounded-lg bg-background text-sm">
                    {['11-1101', '11-1102', '11-1103', '11-1201', '11-1202', '11-1203'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              {previewQ.data.tier && (
                <div className="flex items-center gap-2 text-sm leading-snug">
                  <span className={
                    previewQ.data.tier === 'AUTO' ? 'inline-flex rounded-full bg-primary/15 text-primary px-2 py-0.5 text-xs font-medium'
                    : previewQ.data.tier === 'REVIEW' ? 'inline-flex rounded-full bg-warning/15 text-warning px-2 py-0.5 text-xs font-medium'
                    : 'inline-flex rounded-full bg-destructive/15 text-destructive px-2 py-0.5 text-xs font-medium'
                  }>
                    {previewQ.data.tier === 'AUTO' ? 'อนุมัติอัตโนมัติ' : previewQ.data.tier === 'REVIEW' ? 'ผจก.สาขาอนุมัติ' : 'ผจก.ใหญ่อนุมัติ'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    NCV ฿{previewQ.data.ncv}{previewQ.data.marketMin ? ` · ราคากลางขั้นต่ำ ฿${previewQ.data.marketMin}` : ' · ไม่มีราคากลางรุ่นนี้'}
                  </span>
                </div>
              )}

              {previewQ.data.expectedPl && (
                <p className={`text-sm leading-snug ${previewQ.data.expectedPl.startsWith('-') ? 'text-destructive' : 'text-primary'}`}>
                  {previewQ.data.expectedPl.startsWith('-')
                    ? `ขาดทุนจากการเปลี่ยนเครื่อง (51-1102): ฿${previewQ.data.expectedPl.slice(1)}`
                    : `กำไรจากการเปลี่ยนเครื่อง (41-1102): ฿${previewQ.data.expectedPl}`}
                </p>
              )}

              {previewQ.data.plan && (
                <div className="text-xs text-muted-foreground leading-snug">
                  สัญญาใหม่: ฿{previewQ.data.plan.financedAmount} · ดอกเบี้ย ฿{previewQ.data.plan.interestTotal} · VAT ฿{previewQ.data.plan.vatAmount} → ค่างวด <strong className="text-foreground">฿{previewQ.data.plan.monthlyPayment}</strong>/งวด
                </div>
              )}
            </div>
          )}
```

- [ ] **Step 5: ปรับปุ่ม submit disabled** — `disabled={!newProductId || submitM.isPending || previewQ.data?.blockers.overdueBlocked || previewQ.data?.blockers.advanceBlocked || (previewQ.data?.mode === 'PRICED' && !buybackPrice)}` + เปลี่ยน `PageHeader` title เป็น `"เปลี่ยนเครื่อง"` subtitle `"รุ่นเดิมราคาเดิม = ไม่มีรายการบัญชี / ต่างรุ่น-ต่างราคา = ตีราคารับซื้อ"`

- [ ] **Step 6: type-check + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/insurance/ExchangeRequestForm.tsx
git commit -m "feat(exchange-web): form — PRICED inputs, live tier badge + P/L preview, MEMO banner"
```

---

### Task 13: Web — ExchangeRequestsPage (tier chips + ยกเลิก swap)

**Files:**
- Modify: `apps/web/src/pages/insurance/ExchangeRequestsPage.tsx`
- Modify: `apps/api/src/modules/contract-exchange/contract-exchange.service.ts` + controller (`GET recent`)

**Interfaces:**
- Consumes: `POST /insurance/exchange-requests/:id/cancel` (Task 10), `POST :id/approve` body MEMO checklist (Task 8)
- Produces: `GET /insurance/exchange-requests/recent` — APPROVED 90 วันล่าสุด (id, mode, cancelWindow eligibility, exchangedAt/memoAppliedAt, contract numbers)

- [ ] **Step 1: Backend `listRecent()`** (service) + route:

```ts
  async listRecent(): Promise<any[]> {
    const since = new Date(Date.now() - 90 * 86_400_000);
    return (this.prisma as any).contractExchangeRequest.findMany({
      where: { status: 'APPROVED', deletedAt: null, updatedAt: { gte: since } },
      include: {
        oldContract: { select: { id: true, contractNumber: true, exchangedAt: true, customer: { select: { name: true } } } },
        newContract: { select: { id: true, contractNumber: true, status: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }
```

```ts
  @Get('recent')
  @Roles('OWNER', 'BRANCH_MANAGER')
  listRecent() {
    return this.svc.listRecent();
  }
```

- [ ] **Step 2: หน้า queue** — เพิ่ม (i) interface fields `mode: 'MEMO' | 'PRICED'; approvalTier: 'AUTO' | 'REVIEW' | 'ESCALATE' | null; buybackPrice: string | null` ใน `PendingExchangeRequest` + คอลัมน์ chips ในตาราง pending:

```tsx
<td className="p-3 whitespace-nowrap">
  <span className={item.mode === 'MEMO'
    ? 'inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
    : 'inline-flex rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary'}>
    {item.mode === 'MEMO' ? 'MEMO' : `฿${item.buybackPrice ?? '—'}`}
  </span>
  {item.approvalTier && item.approvalTier !== 'AUTO' && (
    <span className={`ml-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
      item.approvalTier === 'REVIEW' ? 'bg-warning/15 text-warning' : 'bg-destructive/15 text-destructive'}`}>
      {item.approvalTier === 'REVIEW' ? 'ผจก.สาขา' : 'ผจก.ใหญ่'}
    </span>
  )}
</td>
```

(ii) MEMO approve dialog: เมื่อ `target.action === 'approve'` และ row.mode === 'MEMO' → แทน ConfirmDialog ด้วย Dialog ที่มี checkbox 2 ตัว (`บันทึกแนบท้ายสัญญา (ADDENDUM) เซ็นแล้ว` / `สลับ MDM เครื่องเก่า→ใหม่แล้ว`) และ approve ส่ง body `{ memoAddendumSigned, memoMdmSwapped }` — ปุ่มยืนยัน disabled จนติ๊กครบ 2

(iii) ตาราง "อนุมัติแล้ว (ยกเลิกได้ภายใน 30 วัน)" ใต้ตาราง pending — query `['exchange-requests-recent']` → `GET /insurance/exchange-requests/recent`; แต่ละแถวแสดง contractNumber เดิม→ใหม่ + วันเปลี่ยน + จำนวนวันที่เหลือ (30 − diffDays) + ปุ่ม "ยกเลิก swap" → Dialog: เหตุผล ≥10 ตัวอักษร + ข้อความเตือน `วันที่ 8-30 มีค่าปรับ 5% ของราคารับซื้อ` เมื่อ diffDays ≥ 8 → `POST /insurance/exchange-requests/:id/cancel` → invalidate ทั้ง 2 queries + toast ผลรวม `penaltyAmount`

- [ ] **Step 3: type-check + commit**

```bash
./tools/check-types.sh all
git add apps/web/src/pages/insurance apps/api/src/modules/contract-exchange
git commit -m "feat(exchange-web): queue — tier chips, MEMO checklist dialog, cancel-within-30d table"
```

---

### Task 14: Integration spec + docs

**Files:**
- Create: `apps/api/src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts` (DB จริง — CI jest รัน integration แยก)
- Modify: `.claude/rules/accounting.md` (เพิ่ม section "Device Swap — Priced Exchange"), `.claude/CLAUDE.md` (Key Routes: `/exchange` → `/insurance/exchange-requests`)

- [ ] **Step 1: Integration spec** — seed contract 10,000/12 งวด (ผ่าน flow ปกติ: activate → จ่าย 4 งวดจริงผ่าน receipt flow) แล้ว:

```ts
// โครง (แต่ละ it ใช้ helper seed ของ integration suites เดิมในโปรเจกต์):
describe('Device Swap priced flow (workbook E2E)', () => {
  it('Case 2A: swap buyback 8,000 → A.1-A.5 posted, 21-1106 GL = 0, 11-2101/11-2105/11-2106/21-2102 ของสัญญาเก่า = 0, loss 51-1102 ตาม GL จริง', async () => {
    // assert: glContractBalance(old, '21-1106'-เทียบผ่าน journal lines รวม) — ยอด 21-1106 ทั้ง 2 JE net 0 (CRITICAL CHECK ของ workbook)
    // assert: บรรทัด Cr 11-2101 = GL จริง (11,333.36 สำหรับ fixture นี้ — ไม่ใช่ 11,333.28 สูตรคูณ)
  });
  it('ECL: สัญญาเก่ามี provision 30.32 (B1) → A.5 Dr 11-2102/Cr 42-1106 = 30.32 + BadDebtProvision REVERSED', async () => {});
  it('Cancel วันที่ 15: ทุก JE mirror-reversed (GL ทุกบัญชีทุกสัญญา net 0), penalty 400.00 → 42-1107, สัญญาเก่า ACTIVE + งวดที่ due ระหว่าง window ถูก 2A cron backfill ใน tick ถัดไป (เรียก cron.tick() ตรงๆ ใน test)', async () => {});
  it('MEMO: same model+price → ไม่มี JE ใหม่เลย (journal_entries count คงเดิม), contract.productId เปลี่ยน', async () => {});
});
```

(integration spec เขียนตาม harness ของ `*.integration.spec.ts` ที่มีอยู่ — ดู `payment` integration suites เป็น reference; ต้องรันกับ DB จริงเท่านั้น)

- [ ] **Step 2: accounting.md** — เพิ่ม section ท้ายไฟล์:

```markdown
## Device Swap — Priced Exchange (2026-07-29)

Spec: `docs/superpowers/specs/2026-07-29-device-swap-priced-exchange-design.md` (D1-D5 owner decisions)

- MEMO mode (รุ่นเดิม+ราคาเดิม): ไม่มี JE — เปลี่ยน `contract.productId` บนสัญญาเดิม (TFRS 9 modification, workbook Case 1). SP2 same-price + `case-8-same-price.csv` golden ถูก retire
- PRICED mode: A.1 (1A สัญญาใหม่) → A.2 (derecognize ผ่าน 21-1106, VAT due ทันที ม.78/1 ไม่ออก CN) → A.3 (ตัดเจ้าหนี้ + ขาเงินสดโอนเพิ่ม/คืนลูกค้า — D5 post ทันที) → A.4 (SHOP re-intake) → A.5 (ECL reversal Dr 11-2102 / Cr 42-1106 — D2; JP5/write-off ยังใช้ 51-1103)
- Approval: AUTO (≥NCV + ≥basePrice×0.85) / REVIEW (BM) / ESCALATE (<70% NCV — OWNER) — `exchange-tier.util.ts`
- Guards ก่อน finalize: GL 11-2103 = 0, ไม่มี advance/credit ค้าง
- Cancellation: ≤7 วันฟรี / 8-30 วัน ค่าปรับ `exchange_cancel_penalty_pct`% → Cr 42-1107 (ไม่มี VAT) / >30 วันไม่ได้ — mirror-reverse ทุก JE รวม A.5; 2A cron backfill งวดที่พลาดเอง (query dueDate < tomorrow)
- 42-1106 = รายได้จากการโอนกลับค่าเผื่อฯ (rename จาก orphan "รายได้บริการซ่อม" — runtime repair ใช้ S42-1101)
```

- [ ] **Step 3: CLAUDE.md Key Routes** — แก้ `/exchange` ใน "Collections & Risk" เป็น `/insurance/exchange-requests` (route จริง)

- [ ] **Step 4: Full verification + commit + PR**

```bash
./tools/check-types.sh all
npm --prefix apps/api run test
npm --prefix apps/web run test
git add -A
git commit -m "test(exchange): priced-flow integration spec + docs (accounting.md section, route fix)"
```

PR checklist (ใส่ใน description): ⛔ CPA sign-off CoA (42-1106 rename + 42-1107) / prod pre-flight `journal_lines` 42-1106 = 0 / code-reviewer agent + `/pre-deploy` ก่อน merge ตาม Build Workflow

---

## Coverage map (spec → task)

| Spec § | Task |
|---|---|
| §4 mode routing + §4.1 retire case-8 | 7, 11 |
| §5 data model | 1 |
| §6 approval matrix + tier-role | 3, 7, 8 |
| §7.0 guards | 9 |
| §7.3 A.3 cash legs (D5) | 4 |
| §7.4 A.5 ECL (D2) | 5, 9 |
| §7.5 idempotency | 4, 5, 6 |
| §8 MEMO (checklist/ADDENDUM/MDM) | 8, 13 |
| §9 cancellation ครบ 3 path + penalty (D4) | 10, 13 |
| §10 CoA + SystemConfig | 2 |
| §11 endpoints/UI/tests | 7, 12, 13, 14 |
| §12 follow-ups | นอก scope (บันทึกใน spec แล้ว) |

