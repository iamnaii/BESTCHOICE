# แก้บัญชีตามผลตรวจ 2026-09-28 — PR1: ผูกรายการกลับรายการกับสัญญา + วันเริ่มตั้งค่าเผื่อฯ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) รายการกลับรายการตอนยกเลิกใบเสร็จ/คืนเงินต้องผูก `contractId` เพื่อให้ยอดคงเหลือรายสัญญา (`glContractBalance`) ถูกต้อง และ (2) ค่าเผื่อหนี้สงสัยจะสูญต้องเริ่มตั้งเมื่อพ้นวันครบกำหนดแล้วเท่านั้น (คำตัดสินฝ่ายบัญชี D7 + D1)

**Architecture:** สองเรื่องนี้เป็นอิสระต่อกันและไม่มีด่านรอคำตอบ จึงรวมเป็น PR เดียวขนาดเล็ก. เรื่อง (1) แก้ที่ `ReceiptVoidReversalTemplate` จุดเดียว (copy `contractId` อย่างเดียว) + ปิดช่องที่การแก้นี้จะเปิดใน `DefectExchangeReversalTemplate` (ต้องข้ามทุกรายการที่ `tag === 'REVERSAL'`) + migration เติมค่าให้แถวเดิม. เรื่อง (2) ย้ายเส้นตัด "เกินกำหนด" จากเวลาปัจจุบันไปเป็นต้นวันไทยของเวลาที่คำนวณ ในเครื่องยนต์ `computeInstallmentOutstanding` (สาขา DUE) และรวมการเรียกเครื่องยนต์ของ `BadDebtService` ทั้งสองทาง (รอบกลางคืน + ตอนรับชำระ) ไว้ใน helper เดียว `eclRows`.

**Tech Stack:** NestJS 11 + Prisma 6.19 (PostgreSQL 16) · jest (unit, mock Prisma) · vitest (ต่อฐานจริง — ทุกไฟล์ใต้ `cpa-templates/`) · ไม่มีงาน frontend

**Spec:** `docs/superpowers/specs/2026-09-28-accounting-review-fixes-design.md` ข้อ 5.1 และ 5.2

## Global Constraints

- เลขบรรทัดทุกตัวในแผนนี้ = **origin/main `ba80d3c9c`** — ถ้า main ขยับก่อนเริ่ม ให้หาบรรทัดด้วยข้อความที่ยกมา ไม่ใช่เลขบรรทัด
- ทำงานใน worktree ที่ Task 0 สร้าง (`~/Desktop/App/BESTCHOICE-acct-review-pr1`) เท่านั้น — checkout หลัก `~/Desktop/App/BESTCHOICE` เป็นของงานอื่น ห้ามแตะ
- **commit ในเครื่องได้ทุกท้าย task · ห้าม `git push` / เปิด PR / merge จนกว่าเจ้าของจะสั่ง** — merge เข้า main = ขึ้น prod ทันที
- เงินใช้ `Decimal` / `Prisma.Decimal` ห้าม `Number()` · ข้อความ error/log ที่ผู้ใช้เห็นเป็นภาษาไทย
- copy ลงรายการกลับรายการได้เฉพาะ **`contractId`** — ห้าม copy `paymentId`, `installmentScheduleId`, `tag`, `flow`, `idempotencyKey`, `deltaApplied`, `principalCleared`, `lateFeePortion`, `genericConsume`, `parkConsume`
- ห้ามใส่ตัวกรองวันที่ในสาขา **ACCRUED** ของ `computeInstallmentOutstanding` (ใบลดหนี้ `computeCnBreakdown` ใช้ร่วม) และห้ามแก้ `ConsecutiveMissedService`
- ห้ามแตะการคิดค่าปรับล่าช้า, การเปลี่ยนสถานะ OVERDUE/DEFAULT, ทวงถาม, VAT 60 วัน, รายงานอายุหนี้
- jest: `npm --prefix apps/api test -- <path ใต้ src/>` · vitest: `cd apps/api && npx vitest run --no-file-parallelism <path>` **บนฐานทดสอบแยกเท่านั้น** (spec ใต้ `cpa-templates/` ทำ `deleteMany` ตารางบัญชีทั้งตาราง)
- type-check: `./tools/check-types.sh api` ต้อง 0 error ทุก checkpoint · **ห้ามรัน** `npm --prefix apps/api run lint` (มี `--fix` แก้ไฟล์ทั้ง repo)
- Prettier: semi, singleQuote, printWidth 100, tabWidth 2
- migration: additive/ข้อมูลเท่านั้น ชื่อสื่อความหมาย timestamp หลัง `20261012000000_add_product_parts_history` — ใช้ `20261013000000` (branch `chore/remove-warranty-expiring-7d` ที่ยังไม่ merge จอง `20261012100000` ไว้แล้ว)

## Review Focus

1. **คืนเงิน (refund) แล้วเปลี่ยนเครื่องตำหนิ** — รายการ `refund-reversal` ที่มี `contractId` ต้องไม่ถูก `DefectExchangeReversalTemplate` mirror ซ้ำ (ไม่งั้นลงรับเงินปลอม Dr เงินสด / Cr 11-2103) → Task 5
2. **งวดที่ครบกำหนดวันนี้ ตอนรับชำระงวดอื่นกลางวัน** — `reverseStageOnPayment` เวลา 14:00 ของวันครบกำหนด ต้องไม่ถือว่างวดวันนี้ค้าง → Task 3 เทส (ง)
3. **สัญญา TERMINATED ที่งวดถูกตั้งหนี้แล้วและครบกำหนดวันนี้** — สาขา ACCRUED ไม่มีตัวกรองวันที่ในเครื่องยนต์ ต้องกรองที่ `BadDebtService` โดยไม่ทำให้ใบลดหนี้เสีย → Task 2 เทส ACCRUED + Task 3 เทส (จ)
4. **`dueDate` ที่ไม่ได้อยู่ที่เที่ยงคืนไทย** (ข้อมูลย้ายระบบ/test-pack เก็บเป็น 07:00 เวลาไทย) — จำนวนวันเกินกำหนดต้องนับเป็นวันปฏิทินไทย ไม่ใช่ปัด 24 ชั่วโมง → Task 1 + Task 2
5. **รายการเดิมที่ไม่มี `contractId` ใน metadata** (JE รุ่นเก่า) — template ต้องไม่ stamp `contractId: undefined` และ migration ต้องไม่แตะแถวที่ต้นทางไม่มีค่า → Task 4 เทส + Task 6 เทส

---

## อ่านก่อนเริ่ม

- **กติกาบัญชี:** `.claude/rules/accounting.md` หัวข้อ "Bad Debt Provision — ECL v4" (บรรทัด 2374–2546) และ "ใบลดหนี้ตอน void ใบเสร็จ" (810–830)
- **ผู้เรียก `ReceiptVoidReversalTemplate.voidReceipt` มี 2 ราย:** `receipts/services/receipt-void.service.ts:288` (flow เริ่มต้น `receipt-void`) และ `refunds/refunds.service.ts:321-323` (flow `refund-reversal`) — รายการเดิมของทั้งสองทางมี `contractId` เสมอ (`payment-receipt.template.ts:255-270`)
- **ทำไมต้องแก้ defect-exchange คู่กัน:** `defect-exchange-reversal.template.ts:46-56` กวาดทุก JE ที่ `metadata.contractId` ตรง แล้ว mirror ทุกใบที่ไม่ถูกข้าม · บรรทัด 86 ข้ามรายการกลับรายการเฉพาะ flow ใน `REVERSAL_FLOWS = ['defect-exchange', 'receipt-void']` · พอรายการ `refund-reversal` มี `contractId` มันจะถูกกวาดเจอและไม่ถูกข้าม
- **ตัวช่วยวันที่ที่มีอยู่แล้ว:** `apps/api/src/utils/date.util.ts:37` `bangkokStartOfDay(now)` — คืนเวลา UTC ของ 00:00 เวลาไทยของวันที่มี `now` อยู่ ไม่ขึ้นกับ TZ ของเครื่อง · `getCashForecast` ใช้อยู่แล้ว (`dashboard/services/dashboard-overview.service.ts:323`)
- **`Payment.dueDate` ในฐาน:** เก็บเป็น `timestamp` ของเที่ยงคืนเวลาไทยในรูป UTC — ครบกำหนด 27 ส.ค. 2569 เก็บเป็น `2026-08-26T17:00:00.000Z`
- **jest ไม่เห็นไฟล์ใต้ `cpa-templates/`** (`apps/api/package.json` `testPathIgnorePatterns`) — unit spec ของ template ต้องวางที่ `apps/api/src/modules/journal/` (แบบเดียวกับ `receipt-void-reversal-flow.spec.ts`)

---

### Task 0: worktree + ฐานทดสอบแยก + baseline

**Files:**
- Create (worktree): `~/Desktop/App/BESTCHOICE-acct-review-pr1` (branch `fix/acct-review-pr1-reversal-ecl` จาก `origin/main`)

**Interfaces:**
- Produces: worktree ที่ติดตั้งแล้ว, Prisma client 2 ตัว generate แล้ว, ฐานทดสอบ 2 ฐาน migrate แล้ว, ตัวแปร `DATABASE_URL` / `DATABASE_URL_FINANCE` ที่ทุก task ถัดไปใช้ตอนรัน vitest

- [ ] **Step 1: สร้าง worktree** (คำสั่งเดียวที่รันจาก checkout หลัก)

```bash
cd ~/Desktop/App/BESTCHOICE && git fetch origin main && \
  git worktree add ~/Desktop/App/BESTCHOICE-acct-review-pr1 -b fix/acct-review-pr1-reversal-ecl origin/main
```

Expected: `Preparing worktree (new branch 'fix/acct-review-pr1-reversal-ecl')` ตามด้วย `HEAD is now at …`

- [ ] **Step 2: คัดลอก spec + แผนเข้า worktree** (ยังไม่อยู่บน origin/main)

```bash
cd ~/Desktop/App/BESTCHOICE && \
  cp docs/superpowers/specs/2026-09-28-accounting-review-fixes-design.md \
     ~/Desktop/App/BESTCHOICE-acct-review-pr1/docs/superpowers/specs/ && \
  cp docs/superpowers/plans/2026-09-28-acct-review-pr1-reversal-link-ecl-dueday.md \
     ~/Desktop/App/BESTCHOICE-acct-review-pr1/docs/superpowers/plans/
```

- [ ] **Step 3: ติดตั้ง + generate Prisma**

```bash
cd ~/Desktop/App/BESTCHOICE-acct-review-pr1 && npm install && \
  cd apps/api && npx prisma generate && npm run prisma:finance:generate && cd ../..
```

Expected: `✔ Generated Prisma Client` สองครั้ง

- [ ] **Step 4: สร้างฐานทดสอบแยก 2 ฐานและ migrate** (ห้ามใช้ฐาน `bestchoice` ของเจ้าของ — ตามหลัง main และ spec จะลบข้อมูล)

```bash
createdb bestchoice_acct_pr1 && createdb bestchoice_acct_pr1_fin
export DATABASE_URL="postgresql://$USER@localhost:5432/bestchoice_acct_pr1?schema=public"
export DATABASE_URL_FINANCE="postgresql://$USER@localhost:5432/bestchoice_acct_pr1_fin?schema=public"
cd ~/Desktop/App/BESTCHOICE-acct-review-pr1/apps/api && npx prisma migrate deploy && \
  npm run prisma:finance:migrate:deploy && cd ../..
```

Expected: `All migrations have been successfully applied.` สองครั้ง. ถ้า Postgres ในเครื่องต้องใช้รหัสผ่าน ให้ใช้ host/user/password ชุดเดียวกับ `apps/api/.env` ของ checkout หลัก เปลี่ยนเฉพาะชื่อฐาน.

- [ ] **Step 5: baseline — เทสเดิมต้องเขียวก่อนแตะโค้ด**

```bash
cd ~/Desktop/App/BESTCHOICE-acct-review-pr1 && ./tools/check-types.sh api && \
  npm --prefix apps/api test -- src/utils/date.calendar.spec.ts \
    src/modules/journal/compute-installment-outstanding.spec.ts \
    src/modules/accounting/bad-debt.service.spec.ts \
    src/modules/journal/receipt-void-reversal-flow.spec.ts && \
  cd apps/api && npx vitest run --no-file-parallelism \
    src/modules/journal/cpa-templates/receipt-void-reversal.template.spec.ts && cd ../..
```

Expected: `API: OK` · jest 4 suites passed · vitest 1 file passed. ถ้า `tsc` แดงที่ type จาก `@installment/shared` ให้รัน `npm run build --workspace=packages/shared` แล้วลองใหม่.

---

### Task 1: `bangkokDayDiff` — นับวันเกินกำหนดเป็นวันปฏิทินไทย

**Files:**
- Modify: `apps/api/src/utils/date.util.ts` (ต่อท้าย `bangkokStartOfDay` บรรทัด 37-41)
- Test: `apps/api/src/utils/date.calendar.spec.ts`

**Interfaces:**
- Produces: `export function bangkokDayDiff(from: Date, to: Date): number` — Task 2 ใช้

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน** — แก้บรรทัด import บนสุดของ `apps/api/src/utils/date.calendar.spec.ts` แล้วต่อท้ายไฟล์

```ts
import { addBkkDays, addBkkMonths, bangkokDayDiff } from './date.util';
```

```ts
describe('bangkokDayDiff', () => {
  const DUE_27_AUG = new Date('2026-08-26T17:00:00.000Z'); // 27 ส.ค. 2569 00:00 เวลาไทย

  it('นับเป็นวันปฏิทินไทย ไม่ขึ้นกับเวลาในวัน', () => {
    expect(bangkokDayDiff(DUE_27_AUG, new Date('2026-08-26T17:30:00.000Z'))).toBe(0); // 27 ส.ค. 00:30
    expect(bangkokDayDiff(DUE_27_AUG, new Date('2026-08-27T16:59:59.999Z'))).toBe(0); // 27 ส.ค. 23:59
    expect(bangkokDayDiff(DUE_27_AUG, new Date('2026-08-27T17:00:00.000Z'))).toBe(1); // 28 ส.ค. 00:00
    expect(bangkokDayDiff(DUE_27_AUG, new Date('2026-08-27T17:30:00.000Z'))).toBe(1); // 28 ส.ค. 00:30
  });

  it('วันที่ต้นทางที่ไม่ได้อยู่ที่เที่ยงคืนไทย (ข้อมูลเก่าเก็บ 07:00) ได้ผลเท่ากัน', () => {
    const legacyDue = new Date('2026-08-27T00:00:00.000Z'); // 27 ส.ค. 07:00 เวลาไทย
    expect(bangkokDayDiff(legacyDue, new Date('2026-08-27T17:30:00.000Z'))).toBe(1);
    expect(bangkokDayDiff(legacyDue, new Date('2026-09-26T17:30:00.000Z'))).toBe(31);
  });

  it('คืนค่าติดลบเมื่อปลายทางอยู่ก่อนต้นทาง', () => {
    expect(bangkokDayDiff(DUE_27_AUG, new Date('2026-08-25T17:00:00.000Z'))).toBe(-1);
  });
});
```

- [ ] **Step 2: รันเทสให้เห็นว่าล้ม**

Run: `npm --prefix apps/api test -- src/utils/date.calendar.spec.ts`
Expected: FAIL — `Module '"./date.util"' has no exported member 'bangkokDayDiff'`

- [ ] **Step 3: เขียนโค้ด** — ใน `apps/api/src/utils/date.util.ts` เพิ่มต่อจากฟังก์ชัน `bangkokStartOfDay` (หลังปีกกาปิดบรรทัด 41)

```ts

/**
 * จำนวนวันปฏิทินไทยจาก `from` ถึง `to` (0 = วันเดียวกัน, ติดลบ = `to` อยู่ก่อน) — ไม่ขึ้นกับ
 * TZ ของเครื่องและไม่ขึ้นกับเวลาในวัน. ใช้กับ "เกินกำหนดกี่วัน" ของค่าเผื่อหนี้สงสัยจะสูญ
 * (คำตัดสินฝ่ายบัญชี 2026-09-28) เพราะ dueDate บางแถวไม่ได้เก็บที่เที่ยงคืนไทย.
 */
export function bangkokDayDiff(from: Date, to: Date): number {
  return Math.round(
    (bangkokStartOfDay(to).getTime() - bangkokStartOfDay(from).getTime()) / 86_400_000,
  );
}
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/utils/date.calendar.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/App/BESTCHOICE-acct-review-pr1 && git add apps/api/src/utils/date.util.ts apps/api/src/utils/date.calendar.spec.ts && \
  git commit -m "feat(utils): bangkokDayDiff — นับวันเป็นวันปฏิทินไทย"
```

---

### Task 2: เครื่องยนต์ค่าเผื่อ — เส้นตัด "เกินกำหนด" = ต้นวันไทย

**Files:**
- Modify: `apps/api/src/modules/journal/compute-cn-breakdown.ts` (บรรทัด 1-6 import, 99, 247, 314-316, 330-332, 339, 364, 369)
- Test: `apps/api/src/modules/journal/compute-installment-outstanding.spec.ts` (แก้เทสบรรทัด 87-116 + เพิ่ม 3 เทส)

**Interfaces:**
- Consumes: `bangkokDayDiff`, `bangkokStartOfDay` จาก `../../utils/date.util` (Task 1)
- Produces: `computeInstallmentOutstanding(..., { selection: 'DUE', asOf })` คืนเฉพาะงวดที่ `dueDate < bangkokStartOfDay(asOf)` และ `daysOverdue` เป็นวันปฏิทินไทย · สาขา `ACCRUED` คืนแถวชุดเดิมทุกแถว (เปลี่ยนเฉพาะสูตร `daysOverdue`) — Task 3 พึ่งพฤติกรรมนี้

- [ ] **Step 1: แก้เทสขอบเขตเดิมให้ตรงกติกาใหม่** — ใน `compute-installment-outstanding.spec.ts` แทนที่เทส `'DUE asOf boundary: dueDate >= asOf is excluded, dueDate < asOf is included'` ทั้งบล็อก (บรรทัด 87-116) ด้วย

```ts
  it('DUE: งวดที่ครบกำหนด "วันนี้" ตามปฏิทินไทยยังไม่นับ — นับเมื่อพ้นวันครบกำหนดแล้ว (ฝ่ายบัญชี 2026-09-28)', async () => {
    const client = mockClient();
    const asOf = new Date('2026-08-26T17:30:00.000Z'); // 27 ส.ค. 2569 00:30 เวลาไทย = รอบ cron
    const result = await computeInstallmentOutstanding(client, FIXTURE_17K_12M, {
      selection: 'DUE',
      asOf,
      preloaded: {
        payments: [
          {
            // ครบกำหนด 26 ส.ค. (เมื่อวาน) — พ้นวันแล้ว ต้องนับ เกินกำหนด 1 วัน
            installmentNo: 1,
            status: 'PENDING',
            amountDue: '1515.83',
            amountPaid: '0',
            dueDate: new Date('2026-08-25T17:00:00.000Z'),
          },
          {
            // ครบกำหนด 27 ส.ค. (วันนี้) — ลูกค้ายังจ่ายได้ทั้งวัน ต้องไม่นับ
            installmentNo: 2,
            status: 'PENDING',
            amountDue: '1515.83',
            amountPaid: '0',
            dueDate: new Date('2026-08-26T17:00:00.000Z'),
          },
        ],
      },
    });

    expect(result.rows.map((r) => r.installmentNo)).toEqual([1]);
    expect(result.rows[0].daysOverdue).toBe(1);
  });

  it('DUE: งวดเดียวกันเข้าฐานในรอบ 00:30 ของวันถัดไป และนับเป็นเกินกำหนด 1 วัน', async () => {
    const client = mockClient();
    const result = await computeInstallmentOutstanding(client, FIXTURE_17K_12M, {
      selection: 'DUE',
      asOf: new Date('2026-08-27T17:30:00.000Z'), // 28 ส.ค. 00:30 เวลาไทย
      preloaded: {
        payments: [
          {
            installmentNo: 2,
            status: 'PENDING',
            amountDue: '1515.83',
            amountPaid: '0',
            dueDate: new Date('2026-08-26T17:00:00.000Z'), // ครบกำหนด 27 ส.ค.
          },
        ],
      },
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].daysOverdue).toBe(1);
  });

  it('DUE (ทางคิวรี): ส่งต้นวันไทยของ asOf เป็นเส้นตัดให้ฐานข้อมูล', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const client = mockClient({ payment: findMany });
    await computeInstallmentOutstanding(client, FIXTURE_17K_12M, {
      selection: 'DUE',
      asOf: new Date('2026-08-26T17:30:00.000Z'),
    });

    expect(findMany.mock.calls[0][0].where.dueDate).toEqual({
      lt: new Date('2026-08-26T17:00:00.000Z'),
    });
  });

  it('ACCRUED: งวดที่ตั้งหนี้แล้วและครบกำหนดวันนี้ยังถูกคืน (ใบลดหนี้ต้องเห็นครบ) — daysOverdue = 0', async () => {
    const client = mockClient();
    const result = await computeInstallmentOutstanding(client, FIXTURE_17K_12M, {
      selection: 'ACCRUED',
      asOf: new Date('2026-08-27T07:00:00.000Z'), // 27 ส.ค. 14:00 เวลาไทย
      preloaded: {
        installments: [{ installmentNo: 1, accrualJournalEntryId: 'JE-1' }],
        payments: [
          {
            installmentNo: 1,
            status: 'PENDING',
            amountDue: '1515.83',
            amountPaid: '0',
            dueDate: new Date('2026-08-26T17:00:00.000Z'), // ครบกำหนด 27 ส.ค. = วันนี้
          },
        ],
      },
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].daysOverdue).toBe(0);
  });
```

- [ ] **Step 2: รันเทสให้เห็นว่าล้ม**

Run: `npm --prefix apps/api test -- src/modules/journal/compute-installment-outstanding.spec.ts`
Expected: FAIL 2 เทส — เทสแรกได้ `[1, 2]` แทน `[1]` · เทสทางคิวรีได้ `{ lt: 2026-08-26T17:30:00.000Z }`. (เทสที่สองและเทส ACCRUED ผ่านอยู่แล้วกับโค้ดเดิม — เป็นตัวกัน regression)

- [ ] **Step 3: แก้เครื่องยนต์** — ใน `apps/api/src/modules/journal/compute-cn-breakdown.ts`

(ก) เพิ่ม import ใต้ import เดิม (หลังบรรทัด 6):

```ts
import { bangkokDayDiff, bangkokStartOfDay } from '../../utils/date.util';
```

(ข) ลบบรรทัด 99 `const MS_PER_DAY = 24 * 60 * 60 * 1000;` (ไม่มีผู้ใช้อีกหลังแก้ข้อ ค และ ฉ)

(ค) สาขา ACCRUED — แทนที่บรรทัด 314-316

```ts
      const daysOverdue = dueDate
        ? Math.floor((asOf.getTime() - dueDate.getTime()) / MS_PER_DAY)
        : null;
```

ด้วย

```ts
      // วันปฏิทินไทย — ไม่มีตัวกรองวันที่ในสาขานี้โดยตั้งใจ (ใบลดหนี้ต้องเห็นงวดที่ตั้งหนี้แล้ว
      // ทุกงวด); ผู้เรียกฝั่งค่าเผื่อฯ กรองงวดที่ยังไม่พ้นวันครบกำหนดเองใน BadDebtService.eclRows
      const daysOverdue = dueDate ? bangkokDayDiff(dueDate, asOf) : null;
```

(ง) หลังบรรทัด 247 `const asOf = opts.asOf ?? new Date();` เพิ่ม

```ts
  // คำตัดสินฝ่ายบัญชี 2026-09-28: งวดนับเป็นเกินกำหนดเมื่อ "พ้นวันครบกำหนดแล้ว" เท่านั้น —
  // เส้นตัด = ต้นวันไทยของ asOf. งวดที่ครบกำหนดวันนี้ยังไม่เข้าฐานค่าเผื่อฯ (ลูกค้าจ่ายได้ทั้งวัน)
  const pastDueCutoff = bangkokStartOfDay(asOf);
```

(จ) สาขา DUE — แทนที่คอมเมนต์บรรทัด 330-332 และเงื่อนไขคิวรีบรรทัด 339

```ts
  // selection === 'DUE' — Payment-row-driven, does NOT require accrual (see
  // jsdoc above). status != 'PAID' + dueDate < asOf, same universe
  // `calculateProvisions` has always scanned.
```

ด้วย

```ts
  // selection === 'DUE' — Payment-row-driven, does NOT require accrual (see
  // jsdoc above). status != 'PAID' + dueDate < ต้นวันไทยของ asOf (พ้นวันครบกำหนดแล้ว),
  // same universe `calculateProvisions` scans.
```

และ `dueDate: { lt: asOf },` ด้วย `dueDate: { lt: pastDueCutoff },`

(ฉ) แทนที่บรรทัด 364 และ 369

```ts
    if (!(dueDate.getTime() < asOf.getTime())) continue;
```

ด้วย

```ts
    if (!(dueDate.getTime() < pastDueCutoff.getTime())) continue;
```

และ

```ts
    const daysOverdue = Math.floor((asOf.getTime() - dueDate.getTime()) / MS_PER_DAY);
```

ด้วย

```ts
    const daysOverdue = bangkokDayDiff(dueDate, asOf);
```

(ช) ใน jsdoc ของ `computeInstallmentOutstanding` (ราวบรรทัด 215-217) และของ `InstallmentOutstandingRow.daysOverdue` (ราวบรรทัด 172) แก้ข้อความ `dueDate < asOf` เป็น `dueDate < ต้นวันไทยของ asOf` และ `floor((asOf − dueDate) / 1 day)` เป็น `จำนวนวันปฏิทินไทยจาก dueDate ถึง asOf`

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/journal/compute-installment-outstanding.spec.ts src/modules/journal/compute-cn-breakdown.spec.ts`
Expected: PASS ทั้ง 2 suites (เทสเดิมที่ใช้ `ASOF` กับ `TEN_DAYS_BEFORE` ยังได้ `daysOverdue = 10`)

- [ ] **Step 5: type-check + Commit**

```bash
cd ~/Desktop/App/BESTCHOICE-acct-review-pr1 && ./tools/check-types.sh api && \
  git add apps/api/src/modules/journal/compute-cn-breakdown.ts apps/api/src/modules/journal/compute-installment-outstanding.spec.ts && \
  git commit -m "fix(ecl): งวดนับเป็นเกินกำหนดเมื่อพ้นวันครบกำหนดแล้ว (เส้นตัด = ต้นวันไทย)"
```

---

### Task 3: `BadDebtService` — รอบกลางคืนและตอนรับชำระใช้กติกาเดียวกันผ่าน `eclRows`

**Files:**
- Modify: `apps/api/src/modules/accounting/bad-debt.service.ts` (import บรรทัด 23; 338-354; 424; 460-470; 1057-1064; 1077; คอมเมนต์ 31-32, 341-343, 386-388)
- Test: `apps/api/src/modules/accounting/bad-debt.service.spec.ts` (เพิ่ม describe ใหม่ท้ายไฟล์ก่อน `});` ปิด describe หลัก)

**Interfaces:**
- Consumes: `computeInstallmentOutstanding` พฤติกรรมใหม่ (Task 2), `bangkokStartOfDay`
- Produces: `private async eclRows(db, contract, now, preloadedDuePayments?): Promise<InstallmentOutstandingRow[]>` — ใช้ภายใน service เท่านั้น

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน** — ต่อท้าย `bad-debt.service.spec.ts` (ภายใน `describe('BadDebtService', …)`)

```ts
  describe('คำตัดสินฝ่ายบัญชี 2026-09-28 — เริ่มตั้งค่าเผื่อเมื่อพ้นวันครบกำหนดแล้ว', () => {
    const DUE_27_AUG = new Date('2026-08-26T17:00:00.000Z'); // 27 ส.ค. 2569 00:00 เวลาไทย
    const RUN_ON_DUE_DAY = new Date('2026-08-26T17:30:00.000Z'); // 27 ส.ค. 00:30
    const RUN_NEXT_DAY = new Date('2026-08-27T17:30:00.000Z'); // 28 ส.ค. 00:30
    const AFTERNOON_ON_DUE_DAY = new Date('2026-08-27T07:00:00.000Z'); // 27 ส.ค. 14:00

    const dueToday = (status = 'ACTIVE') => ({
      id: 'pay-ct-1-1',
      contractId: 'ct-1',
      installmentNo: 1,
      amountDue: new Prisma.Decimal('1515.83'),
      amountPaid: new Prisma.Decimal(0),
      lateFee: new Prisma.Decimal(0),
      lateFeeWaived: false,
      status: 'PENDING',
      dueDate: DUE_27_AUG,
      contract: { id: 'ct-1', status, ...STD_CONTRACT_FIELDS },
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('(ก) รอบ 00:30 ของวันครบกำหนดเอง — คิวรีใช้ต้นวันไทยเป็นเส้นตัด และไม่ตั้งค่าเผื่อ', async () => {
      jest.useFakeTimers().setSystemTime(RUN_ON_DUE_DAY);
      // ฐานข้อมูลจริงจะไม่คืนงวดนี้ (dueDate ไม่น้อยกว่าเส้นตัด) — จำลองกรณีแย่สุดที่ยังคืนมา
      // เพื่อพิสูจน์ว่าเครื่องยนต์กรองซ้ำในหน่วยความจำ
      prisma.payment.findMany.mockResolvedValue([dueToday()]);

      const result = await service.calculateProvisions('user-1');

      expect(prisma.payment.findMany.mock.calls[0][0].where.dueDate).toEqual({ lt: DUE_27_AUG });
      expect(result.created).toBe(0);
      expect(result.byBucket['1-30']).toBeUndefined();
    });

    it('(ข) รอบ 00:30 ของวันถัดไป — เกินกำหนด 1 วัน เข้าช่วง 1-30 ตั้ง 30.32', async () => {
      jest.useFakeTimers().setSystemTime(RUN_NEXT_DAY);
      prisma.payment.findMany.mockResolvedValue([dueToday()]);

      const result = await service.calculateProvisions('user-1');

      expect(result.created).toBe(1);
      expect(result.byBucket['1-30'].amount).toBeCloseTo(30.32, 2);
      const row = prisma.badDebtProvision.createMany.mock.calls[0][0].data[0];
      expect(row.daysOverdue).toBe(1);
      expect(row.agingBucket).toBe('1-30');
    });

    it('(ค) ขอบช่วง 30/31 วัน นับจากเที่ยงคืนไทย', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-25T17:30:00.000Z')); // 26 ก.ย. 00:30 = เกิน 30 วัน
      prisma.payment.findMany.mockResolvedValue([dueToday()]);
      const at30 = await service.calculateProvisions('user-1');
      expect(at30.byBucket['1-30'].amount).toBeCloseTo(30.32, 2);

      jest.setSystemTime(new Date('2026-09-26T17:30:00.000Z')); // 27 ก.ย. 00:30 = เกิน 31 วัน
      prisma.payment.findMany.mockResolvedValue([dueToday()]);
      const at31 = await service.calculateProvisions('user-1');
      expect(at31.byBucket['31-60'].amount).toBeCloseTo(227.37, 2);
    });

    it('(ง) รับชำระกลางวันของวันครบกำหนด เหลือแต่งวดที่ครบกำหนดวันนี้ — คืนค่าเผื่อทั้งก้อน', async () => {
      jest.useFakeTimers().setSystemTime(AFTERNOON_ON_DUE_DAY);
      prisma.contract.findUnique.mockResolvedValue({
        id: 'ct-1',
        status: 'ACTIVE',
        ...STD_CONTRACT_FIELDS,
      });
      prisma.badDebtProvision.findFirst.mockResolvedValue({
        id: 'prov-1',
        contractId: 'ct-1',
        agingBucket: '31-60',
        daysOverdue: 31,
        outstandingAmount: new Prisma.Decimal('1515.83'),
        provisionRate: new Prisma.Decimal('0.15'),
        provisionAmount: new Prisma.Decimal('227.37'),
        status: 'ACTIVE',
      });
      // งวดเก่าถูกจ่ายแล้ว (ไม่อยู่ในผลคิวรี) — เหลืองวดที่ครบกำหนดวันนี้งวดเดียว
      prisma.payment.findMany.mockResolvedValue([dueToday()]);
      prisma.journalLine.findMany.mockResolvedValue([
        { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('227.37') },
      ]);

      const result = await service.reverseStageOnPayment('ct-1');

      expect(result).not.toBeNull();
      expect(result!.toBucket).toBe('CURRENT');
      expect(result!.reverseAmount).toBe('227.37');
    });

    it('(จ) สัญญา TERMINATED — งวดที่ตั้งหนี้แล้วแต่ครบกำหนดวันนี้ ยังไม่เข้าฐาน', async () => {
      jest.useFakeTimers().setSystemTime(AFTERNOON_ON_DUE_DAY);
      const overdue40 = {
        ...dueToday('TERMINATED'),
        id: 'pay-ct-1-0',
        installmentNo: 1,
        dueDate: new Date('2026-07-17T17:00:00.000Z'), // ครบกำหนด 18 ก.ค. = เกิน 40 วัน
      };
      const today = { ...dueToday('TERMINATED'), id: 'pay-ct-1-2', installmentNo: 2 };
      prisma.payment.findMany.mockResolvedValue([overdue40, today]);
      prisma.installmentSchedule.findMany.mockResolvedValue([
        { installmentNo: 1, accrualJournalEntryId: 'JE-1', dueDate: overdue40.dueDate },
        { installmentNo: 2, accrualJournalEntryId: 'JE-2', dueDate: DUE_27_AUG },
      ]);

      const result = await service.calculateProvisions('owner-1');

      // เฉพาะงวดเกิน 40 วัน: 1,515.83 × 15% = 227.37 — งวดที่ครบกำหนดวันนี้ (2%) ไม่ถูกนับ
      expect(result.totalProvision).toBeCloseTo(227.37, 2);
      expect(result.byBucket['1-30']).toBeUndefined();
    });

    it('(ฉ) streak floor ใช้เส้นตัดเดียวกัน', async () => {
      jest.useFakeTimers().setSystemTime(RUN_NEXT_DAY);
      prisma.systemConfig.findUnique.mockImplementation(({ where: { key } }: any) =>
        Promise.resolve(
          key === 'consecutive_missed_bucket_map' ? { key, value: '{"2":"31-60"}' } : null,
        ),
      );
      prisma.payment.findMany.mockResolvedValue([dueToday()]);

      await service.calculateProvisions('user-1');

      expect(consecutiveMissedMock.getStreaks).toHaveBeenCalledWith(
        { contractIds: ['ct-1'] },
        new Date('2026-08-27T17:00:00.000Z'), // ต้นวันไทยของ 28 ส.ค.
      );
    });
  });
```

- [ ] **Step 2: รันเทสให้เห็นว่าล้ม**

Run: `npm --prefix apps/api test -- src/modules/accounting/bad-debt.service.spec.ts -t "คำตัดสินฝ่ายบัญชี 2026-09-28"`
Expected: FAIL — (ก) `where.dueDate` เป็น `{ lt: 2026-08-26T17:30:00.000Z }` · (จ) `totalProvision` เป็น 257.69 (นับงวดวันนี้ 30.32 ด้วย) · (ฉ) `getStreaks` ถูกเรียกด้วย `2026-08-27T17:30:00.000Z`. (เทส (ข)(ค)(ง) ผ่านแล้วจาก Task 2 — เป็นตัวกัน regression ของชั้น service)

- [ ] **Step 3: แก้ `bad-debt.service.ts`**

(ก) เพิ่ม import ใต้บรรทัด 23 (`import { ConsecutiveMissedService } …`):

```ts
import { bangkokStartOfDay } from '../../utils/date.util';
```

(ข) เพิ่มเมธอด private ต่อจาก `computeOutstanding` (หลังปีกกาปิดราวบรรทัด 199):

```ts
  /**
   * แถวฐานค่าเผื่อฯ ของสัญญาหนึ่งใบ ณ เวลา `now` — แหล่งเดียวของทั้งรอบกลางคืน
   * (`calculateProvisions`) และตอนรับชำระ (`reverseStageOnPayment`).
   *
   * คำตัดสินฝ่ายบัญชี 2026-09-28: งวดนับเป็นเกินกำหนดเมื่อพ้นวันครบกำหนดแล้วเท่านั้น
   * (วันปฏิทินไทย). selection DUE กรองในเครื่องยนต์แล้ว; selection ACCRUED (สัญญา
   * TERMINATED) ไม่มีตัวกรองวันที่ในเครื่องยนต์เพราะใบลดหนี้ใช้ร่วม จึงกรองที่นี่.
   */
  private async eclRows(
    db: Prisma.TransactionClient | PrismaService,
    contract: CnBreakdownContractInput & { status: string },
    now: Date,
    preloadedDuePayments?: CnPaymentInput[],
  ): Promise<InstallmentOutstandingRow[]> {
    if (contract.status === 'TERMINATED') {
      const pastDueCutoff = bangkokStartOfDay(now);
      const { rows } = await computeInstallmentOutstanding(db, contract, {
        selection: 'ACCRUED',
        asOf: now,
      });
      return rows.filter(
        (r) => r.dueDate === null || r.dueDate.getTime() < pastDueCutoff.getTime(),
      );
    }
    const { rows } = await computeInstallmentOutstanding(db, contract, {
      selection: 'DUE',
      asOf: now,
      ...(preloadedDuePayments ? { preloaded: { payments: preloadedDuePayments } } : {}),
    });
    return rows;
  }
```

(ค) ใน `calculateProvisions` — หลังบรรทัด 338 `const now = new Date();` เพิ่ม

```ts
    // เส้นตัด "เกินกำหนด" = ต้นวันไทย (ฝ่ายบัญชี 2026-09-28) — งวดที่ครบกำหนดวันนี้ยังไม่เข้าฐาน
    const pastDueCutoff = bangkokStartOfDay(now);
```

แทนที่บรรทัด 354 `dueDate: { lt: now },` ด้วย `dueDate: { lt: pastDueCutoff },`

แทนที่บรรทัด 424 `? await this.consecutiveMissed.getStreaks({ contractIds: contractIdsInScope }, now)` ด้วย
`? await this.consecutiveMissed.getStreaks({ contractIds: contractIdsInScope }, pastDueCutoff)`

แทนที่บรรทัด 460-470

```ts
      const isTerminated = group.contract.status === 'TERMINATED';
      const { rows } = isTerminated
        ? await computeInstallmentOutstanding(this.prisma, group.contract, {
            selection: 'ACCRUED',
            asOf: now,
          })
        : await computeInstallmentOutstanding(this.prisma, group.contract, {
            selection: 'DUE',
            asOf: now,
            preloaded: { payments: group.payments },
          });
```

ด้วย

```ts
      const rows = await this.eclRows(this.prisma, group.contract, now, group.payments);
```

(ง) ใน `reverseStageOnPayment` — แทนที่บรรทัด 1061-1064

```ts
    const { rows } = await computeInstallmentOutstanding(db, contract, {
      selection: contract.status === 'TERMINATED' ? 'ACCRUED' : 'DUE',
      asOf: now,
    });
```

ด้วย

```ts
    const rows = await this.eclRows(db, contract, now);
```

และแทนที่บรรทัด 1077 `? await this.consecutiveMissed.getStreaks({ contractIds: [contractId] }, now, db)` ด้วย
`? await this.consecutiveMissed.getStreaks({ contractIds: [contractId] }, bangkokStartOfDay(now), db)`

(จ) แก้คอมเมนต์ให้ตรงกติกาใหม่: บรรทัด 341-343 (`dueDate < now` → `dueDate < ต้นวันไทยของ now`) · บรรทัด 386-388 · บรรทัด 31-32 เพิ่มท้าย `// (ฝ่ายบัญชี 2026-09-28: โค้ดทำตามนี้จริงแล้ว — งวดที่ครบกำหนดวันนี้ไม่เข้าฐาน)`

- [ ] **Step 4: รันเทสให้ผ่าน — ทั้งไฟล์**

Run: `npm --prefix apps/api test -- src/modules/accounting/bad-debt.service.spec.ts`
Expected: PASS ทุกเทส (เทสเดิมใช้ `Date.now() − N วัน` กับ N ≥ 5 จึงได้ N วันเท่าเดิม). ถ้า `contract.status` ใน `reverseStageOnPayment` แจ้ง type ไม่ตรงกับ `CnBreakdownContractInput & { status: string }` ให้ยืนยันว่า `select` ที่บรรทัด 1040-1051 มี `status: true` (มีอยู่แล้วบน main).

- [ ] **Step 5: type-check + เทส vitest ที่ต่อฐานจริงของค่าเผื่อฯ**

```bash
cd ~/Desktop/App/BESTCHOICE-acct-review-pr1 && ./tools/check-types.sh api && cd apps/api && \
  npx vitest run --no-file-parallelism \
    src/modules/journal/cpa-templates/ecl-terminated-base.spec.ts \
    src/modules/accounting/bad-debt.streak-provision.integration.spec.ts \
    src/modules/accounting/bad-debt.streak-reverse.integration.spec.ts \
    src/modules/dashboard/__tests__/cash-forecast-sql.integration.spec.ts && cd ../..
```

Expected: `API: OK` · 4 files passed (golden 2,122.16 / 2,273.76 / 454.74 ไม่เปลี่ยน)

- [ ] **Step 6: Commit**

```bash
cd ~/Desktop/App/BESTCHOICE-acct-review-pr1 && \
  git add apps/api/src/modules/accounting/bad-debt.service.ts apps/api/src/modules/accounting/bad-debt.service.spec.ts && \
  git commit -m "fix(ecl): รอบกลางคืนและตอนรับชำระใช้เส้นตัดต้นวันไทยผ่าน eclRows"
```

---

### Task 4: รายการกลับรายการ copy `contractId`

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.ts:92-105`
- Test (jest): `apps/api/src/modules/journal/receipt-void-reversal-flow.spec.ts`
- Test (vitest, ฐานจริง): `apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.spec.ts`

**Interfaces:**
- Produces: รายการกลับรายการมี `metadata.contractId` เมื่อรายการเดิมมี — Task 5 และ Task 6 พึ่งรูปนี้

- [ ] **Step 1: เขียนเทส jest ที่ยังไม่ผ่าน** — ใน `receipt-void-reversal-flow.spec.ts` แก้ `setup()` ให้รับ metadata ของรายการเดิม แล้วเพิ่ม 3 เทส

แทนที่บรรทัดแรกของฟังก์ชัน `function setup() {` และ `metadata: {},` ด้วย

```ts
  function setup(originalMetadata: Record<string, unknown> = {}) {
```

```ts
      metadata: originalMetadata,
```

ต่อท้ายใน `describe` เดิม:

```ts
  it('copy contractId จากรายการเดิมลงรายการกลับรายการ (ฝ่ายบัญชี 2026-09-28 ข้อ 7)', async () => {
    const { tpl, createAndPost } = setup({
      tag: 'receipt',
      flow: 'payment-receipt',
      contractId: 'ct-1',
      paymentId: 'pay-1',
      installmentScheduleId: 'inst-1',
      idempotencyKey: 'idem-1',
      deltaApplied: '6079',
      principalCleared: '6078.67',
      parkConsume: '100',
    });

    await tpl.voidReceipt('je-1');

    expect(createAndPost.mock.calls[0][0].metadata).toEqual({
      tag: 'REVERSAL',
      flow: 'receipt-void',
      originalEntryId: 'je-1',
      originalEntryNumber: 'JE-0001',
      contractId: 'ct-1',
    });
  });

  it('flow คืนเงินก็ได้ contractId เหมือนกัน', async () => {
    const { tpl, createAndPost } = setup({ tag: 'receipt', contractId: 'ct-9' });
    await tpl.voidReceipt('je-1', undefined, { flow: 'refund-reversal' });
    expect(createAndPost.mock.calls[0][0].metadata.contractId).toBe('ct-9');
    expect(createAndPost.mock.calls[0][0].metadata.flow).toBe('refund-reversal');
  });

  it('รายการเดิมไม่มี contractId (หรือไม่ใช่ string) → ไม่ stamp คีย์นี้เลย', async () => {
    const none = setup({ tag: 'receipt' });
    await none.tpl.voidReceipt('je-1');
    expect(none.createAndPost.mock.calls[0][0].metadata).not.toHaveProperty('contractId');

    const notString = setup({ tag: 'receipt', contractId: 123 });
    await notString.tpl.voidReceipt('je-1');
    expect(notString.createAndPost.mock.calls[0][0].metadata).not.toHaveProperty('contractId');
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `npm --prefix apps/api test -- src/modules/journal/receipt-void-reversal-flow.spec.ts`
Expected: FAIL 2 เทสแรก — metadata ไม่มี `contractId` (เทสที่สามผ่านอยู่แล้ว)

- [ ] **Step 3: แก้ template** — ใน `receipt-void-reversal.template.ts` แทนที่บล็อก `metadata: { … }` บรรทัด 96-101

```ts
        metadata: {
          tag: 'REVERSAL',
          flow,
          originalEntryId: originalJournalEntryId,
          originalEntryNumber: originalJe.entryNumber,
        },
```

ด้วย

```ts
        metadata: {
          tag: 'REVERSAL',
          flow,
          originalEntryId: originalJournalEntryId,
          originalEntryNumber: originalJe.entryNumber,
          // ผูกกับสัญญา (ฝ่ายบัญชี 2026-09-28) — glContractBalance รวมยอดตาม metadata.contractId
          // ถ้าไม่มี ยอดของใบที่ยกเลิกแล้วจะยังถูกนับว่าจ่ายอยู่. copy เฉพาะคีย์นี้เท่านั้น:
          // paymentId/installmentScheduleId/tag/idempotencyKey จะทำให้ผู้อ่านรายอื่นเข้าใจว่าเป็นใบรับชำระ
          ...(typeof existingMeta['contractId'] === 'string'
            ? { contractId: existingMeta['contractId'] }
            : {}),
        },
```

- [ ] **Step 4: รัน jest ให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/journal/receipt-void-reversal-flow.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: เพิ่มเทส vitest ที่ต่อฐานจริง — ยอดรายสัญญาต้องกลับมาค้างหลังยกเลิก** — ใน `receipt-void-reversal.template.spec.ts`

เพิ่ม import ใต้ import เดิม:

```ts
import { glContractBalance } from '../gl-contract-balance';
```

เพิ่มตัวแปรข้าง `let paymentJeId: string;`:

```ts
  let contractId: string;
```

ใน `beforeAll` หลังบรรทัด `const c = await seedStandard17k12m(prisma);` เพิ่ม:

```ts
    contractId = c.id;
```

เพิ่มเทสต่อจากเทส `'marks original JE as reversed'`:

```ts
  it('ยอด 11-2103 รายสัญญากลับมาค้างเต็มงวดหลังยกเลิกใบเสร็จ (รายการกลับรายการผูก contractId)', async () => {
    const reversalJe = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'receipt-void' } } as any,
          { metadata: { path: ['originalEntryId'], equals: paymentJeId } } as any,
        ],
      },
    });
    expect((reversalJe!.metadata as Record<string, unknown>)['contractId']).toBe(contractId);

    // 2A Dr 1,515.83 − ใบรับชำระ Cr 1,515.83 + กลับรายการ Dr 1,515.83 = ค้าง 1,515.83
    const bal = await glContractBalance(prisma, contractId, '11-2103', 'dr');
    expect(bal.toFixed(2)).toBe('1515.83');
    const cash = await glContractBalance(prisma, contractId, '11-1101', 'dr');
    expect(cash.toFixed(2)).toBe('0.00');
  });
```

- [ ] **Step 6: รัน vitest**

Run: `cd ~/Desktop/App/BESTCHOICE-acct-review-pr1/apps/api && npx vitest run --no-file-parallelism src/modules/journal/cpa-templates/receipt-void-reversal.template.spec.ts && cd ../..`
Expected: PASS (5 tests). ถ้าย้อนโค้ด Step 3 ออก เทสใหม่ต้องล้มด้วย `expected '0.00' to be '1515.83'` — ยืนยันหนึ่งครั้งว่าเทสจับบั๊กได้จริง แล้วคืนโค้ด.

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/App/BESTCHOICE-acct-review-pr1 && \
  git add apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.ts \
          apps/api/src/modules/journal/receipt-void-reversal-flow.spec.ts \
          apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.spec.ts && \
  git commit -m "fix(journal): รายการกลับรายการตอนยกเลิกใบเสร็จผูก contractId"
```

---

### Task 5: `DefectExchangeReversalTemplate` ข้ามรายการกลับรายการทุก flow

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/defect-exchange-reversal.template.ts:7-8, 78-91`
- Create (jest): `apps/api/src/modules/journal/defect-exchange-reversal-skip.spec.ts`

**Interfaces:**
- Consumes: รูป metadata ของรายการกลับรายการจาก Task 4 (`tag: 'REVERSAL'` + `contractId`)

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน** — สร้าง `apps/api/src/modules/journal/defect-exchange-reversal-skip.spec.ts`

```ts
// Jest unit test — วางนอก cpa-templates/ เพราะ jest ข้ามทุก spec ใต้โฟลเดอร์นั้น
// (ดู testPathIgnorePatterns ใน apps/api/package.json).
import { Prisma } from '@prisma/client';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DefectExchangeReversalTemplate } from './cpa-templates/defect-exchange-reversal.template';

const line = (accountCode: string, debit: number, credit: number) => ({
  accountCode,
  debit: new Prisma.Decimal(debit),
  credit: new Prisma.Decimal(credit),
  description: 'x',
});

function setup(entries: Array<Record<string, unknown>>) {
  const prisma = {
    contract: { findUniqueOrThrow: jest.fn().mockResolvedValue({ contractNumber: 'BCP-0001' }) },
    journalEntry: {
      findMany: jest.fn().mockResolvedValue(entries),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
  const createAndPost = jest.fn().mockResolvedValue({ entryNumber: 'JE-9999' });
  const journal = { createAndPost } as unknown as JournalAutoService;
  return { tpl: new DefectExchangeReversalTemplate(journal, prisma), createAndPost };
}

describe('DefectExchangeReversalTemplate — ข้ามรายการกลับรายการ', () => {
  const activation = {
    id: 'je-1a',
    entryNumber: 'JE-0001',
    metadata: { tag: '1A', contractId: 'ct-1' },
    lines: [line('11-2101', 17000, 0), line('21-1101', 0, 17000)],
  };

  it.each(['receipt-void', 'refund-reversal', 'defect-exchange', 'exchange-cancel'])(
    'ไม่ mirror รายการกลับรายการ flow %s ที่ผูก contractId',
    async (flow) => {
      const reversal = {
        id: 'je-rev',
        entryNumber: 'JE-0003',
        metadata: { tag: 'REVERSAL', flow, originalEntryId: 'je-2b', contractId: 'ct-1' },
        lines: [line('11-2103', 1515.83, 0), line('11-1101', 0, 1515.83)],
      };
      const { tpl, createAndPost } = setup([activation, reversal]);

      const result = await tpl.reverseContract('ct-1');

      expect(result.reversedCount).toBe(1);
      expect(createAndPost).toHaveBeenCalledTimes(1);
      expect(createAndPost.mock.calls[0][0].metadata.originalEntryId).toBe('je-1a');
    },
  );

  it('ใบรับชำระที่ถูกกลับรายการแล้ว (reversed: true) ยังถูกข้ามเหมือนเดิม', async () => {
    const reversedReceipt = {
      id: 'je-2b',
      entryNumber: 'JE-0002',
      metadata: { tag: 'receipt', contractId: 'ct-1', reversed: true },
      lines: [line('11-1101', 1515.83, 0), line('11-2103', 0, 1515.83)],
    };
    const { tpl, createAndPost } = setup([activation, reversedReceipt]);
    await tpl.reverseContract('ct-1');
    expect(createAndPost).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `npm --prefix apps/api test -- src/modules/journal/defect-exchange-reversal-skip.spec.ts`
Expected: FAIL 2 เคส — `refund-reversal` และ `exchange-cancel` ถูก mirror (`createAndPost` ถูกเรียก 2 ครั้ง)

- [ ] **Step 3: แก้ template** — ใน `defect-exchange-reversal.template.ts`

ลบบรรทัด 8 `const REVERSAL_FLOWS = ['defect-exchange', 'receipt-void'];`

แทนที่บรรทัด 86-91

```ts
      if (REVERSAL_FLOWS.includes(flow) && meta['tag'] === 'REVERSAL') {
        this.logger.log(
          `[A.5a] DefectExchangeReversal — JE ${je.entryNumber} is itself a reversal JE, skipping`,
        );
        continue;
      }
```

ด้วย

```ts
      // ข้ามรายการกลับรายการทุก flow (receipt-void / refund-reversal / defect-exchange /
      // exchange-cancel …) — ตั้งแต่ 2026-09-28 รายการเหล่านี้ผูก contractId จึงถูกกวาดเจอ;
      // mirror ซ้ำ = ลงรายการเดิมกลับเข้ามาใหม่โดยไม่มีเงินจริง
      if (meta['tag'] === 'REVERSAL') {
        this.logger.log(
          `[A.5a] DefectExchangeReversal — JE ${je.entryNumber} is itself a reversal JE (flow '${flow}'), skipping`,
        );
        continue;
      }
```

- [ ] **Step 4: รันให้ผ่าน + spec เดิมของโมดูลที่เกี่ยว**

```bash
cd ~/Desktop/App/BESTCHOICE-acct-review-pr1 && \
  npm --prefix apps/api test -- src/modules/journal/defect-exchange-reversal-skip.spec.ts \
    src/modules/defect-exchange/defect-exchange.service.spec.ts && \
  cd apps/api && npx vitest run --no-file-parallelism \
    src/modules/journal/cpa-templates/defect-exchange-reversal.template.spec.ts && cd ../..
```

Expected: PASS ทั้งหมด

- [ ] **Step 5: type-check + Commit**

```bash
cd ~/Desktop/App/BESTCHOICE-acct-review-pr1 && ./tools/check-types.sh api && \
  git add apps/api/src/modules/journal/cpa-templates/defect-exchange-reversal.template.ts \
          apps/api/src/modules/journal/defect-exchange-reversal-skip.spec.ts && \
  git commit -m "fix(defect-exchange): ข้ามรายการกลับรายการทุก flow ตอนกวาดสัญญา"
```

---

### Task 6: migration เติม `contractId` ให้รายการกลับรายการเดิม

**Files:**
- Create: `apps/api/prisma/migrations/20261013000000_backfill_reversal_contract_id/migration.sql`
- Create (vitest, ฐานจริง): `apps/api/src/modules/journal/cpa-templates/reversal-contract-id-backfill.spec.ts`

**Interfaces:**
- Consumes: รูป metadata จาก Task 4
- Produces: หลัง deploy รายการ `receipt-void` / `refund-reversal` เดิมทุกแถวที่ต้นทางมี `contractId` จะมี `contractId` (prod วันนี้มี 2 แถว: JE-202609-00042, JE-202609-00043)

- [ ] **Step 1: เขียน migration**

```sql
-- ผูก contractId ให้รายการกลับรายการ (ยกเลิกใบเสร็จ / คืนเงิน) ที่ลงก่อน 2026-09-28
-- คำตัดสินฝ่ายบัญชี 2026-09-28 ข้อ 7 — ดู docs/superpowers/specs/2026-09-28-accounting-review-fixes-design.md ข้อ 5.1
--
-- idempotent: แตะเฉพาะแถวที่ยังไม่มี contractId และรายการเดิมมี contractId เป็น string
-- ไม่แตะ flow อื่น (defect-exchange / exchange-cancel stamp contractId เองอยู่แล้ว)
UPDATE journal_entries AS rev
SET metadata = rev.metadata || jsonb_build_object('contractId', orig.metadata->>'contractId'),
    updated_at = NOW()
FROM journal_entries AS orig
WHERE rev.metadata->>'tag' = 'REVERSAL'
  AND rev.metadata->>'flow' IN ('receipt-void', 'refund-reversal')
  AND rev.metadata->>'originalEntryId' = orig.id
  AND NOT (rev.metadata ? 'contractId')
  AND jsonb_typeof(orig.metadata->'contractId') = 'string';
```

- [ ] **Step 2: เขียนเทส vitest** — สร้าง `reversal-contract-id-backfill.spec.ts`

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();
const SQL = readFileSync(
  join(
    __dirname,
    '../../../../prisma/migrations/20261013000000_backfill_reversal_contract_id/migration.sql',
  ),
  'utf8',
);

const lines = (amount: string, reversed = false) => [
  {
    accountCode: reversed ? '11-2103' : '11-1101',
    dr: new Decimal(amount),
    cr: new Decimal(0),
    description: 'dr',
  },
  {
    accountCode: reversed ? '11-1101' : '11-2103',
    dr: new Decimal(0),
    cr: new Decimal(amount),
    description: 'cr',
  },
];

async function metaOf(id: string) {
  const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id } });
  return je.metadata as Record<string, unknown>;
}

describe('migration 20261013000000 — เติม contractId ให้รายการกลับรายการเดิม', () => {
  let journal: JournalAutoService;
  const ids: Record<string, string> = {};
  // ไม่ล้างตารางบัญชี — spec นี้สร้างแถวของตัวเองและตรวจเฉพาะแถวนั้น. reference ต้องไม่ซ้ำข้ามรอบรัน
  // (unique index journal_entries_ref_unique) จึงผูกกับเวลาที่รัน
  const RUN = Date.now().toString(36);

  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    const admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) {
      await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      });
    }
    journal = new JournalAutoService(prisma as any);

    const post = async (key: string, metadata: Record<string, unknown>, reversed = false) => {
      const { id } = await journal.createAndPost({
        description: key,
        reference: `backfill-spec:${RUN}:${key}`,
        metadata,
        lines: lines('100.00', reversed),
      });
      ids[key] = id;
      return id;
    };

    // (1) ใบรับชำระปกติ + รายการกลับรายการแบบเก่า (ไม่มี contractId) → ต้องถูกเติม
    const orig1 = await post('orig1', { tag: 'receipt', contractId: `ct-A-${RUN}`, paymentId: 'p-1' });
    await post('rev1', { tag: 'REVERSAL', flow: 'receipt-void', originalEntryId: orig1 }, true);
    // (2) คืนเงิน → ต้องถูกเติมเหมือนกัน
    const orig2 = await post('orig2', { tag: 'receipt', contractId: 'ct-B' });
    await post('rev2', { tag: 'REVERSAL', flow: 'refund-reversal', originalEntryId: orig2 }, true);
    // (3) รายการเดิมไม่มี contractId → ห้ามแตะ
    const orig3 = await post('orig3', { tag: 'receipt' });
    await post('rev3', { tag: 'REVERSAL', flow: 'receipt-void', originalEntryId: orig3 }, true);
    // (4) มี contractId อยู่แล้ว → ห้ามเขียนทับ
    const orig4 = await post('orig4', { tag: 'receipt', contractId: 'ct-D' });
    await post(
      'rev4',
      { tag: 'REVERSAL', flow: 'receipt-void', originalEntryId: orig4, contractId: 'ct-KEEP' },
      true,
    );
    // (5) flow อื่น → ห้ามแตะ
    const orig5 = await post('orig5', { tag: '1A', contractId: 'ct-E' });
    await post('rev5', { tag: 'REVERSAL', flow: 'some-other-flow', originalEntryId: orig5 }, true);
  });

  it('เติมเฉพาะแถวที่เข้าเงื่อนไข และคงคีย์เดิมไว้ครบ', async () => {
    await prisma.$executeRawUnsafe(SQL);

    expect(await metaOf(ids.rev1)).toEqual({
      tag: 'REVERSAL',
      flow: 'receipt-void',
      originalEntryId: ids.orig1,
      contractId: `ct-A-${RUN}`,
    });
    expect((await metaOf(ids.rev2))['contractId']).toBe('ct-B');
    expect(await metaOf(ids.rev3)).not.toHaveProperty('contractId');
    expect((await metaOf(ids.rev4))['contractId']).toBe('ct-KEEP');
    expect(await metaOf(ids.rev5)).not.toHaveProperty('contractId');
    // รายการเดิมไม่ถูกแตะ
    expect(await metaOf(ids.orig1)).toEqual({
      tag: 'receipt',
      contractId: `ct-A-${RUN}`,
      paymentId: 'p-1',
    });
  });

  it('รันซ้ำได้ ไม่เปลี่ยนแถวใดอีก', async () => {
    // รอบแรกเติมทุกแถวที่เข้าเงื่อนไขในฐานไปแล้ว (รวมแถวของ spec อื่น) รอบสองจึงต้องเป็น 0
    const changed = await prisma.$executeRawUnsafe(SQL);
    expect(changed).toBe(0);
  });
});
```

- [ ] **Step 3: รันเทส**

Run: `cd ~/Desktop/App/BESTCHOICE-acct-review-pr1/apps/api && npx vitest run --no-file-parallelism src/modules/journal/cpa-templates/reversal-contract-id-backfill.spec.ts && cd ../..`
Expected: PASS (2 tests). ไฟล์อยู่ใต้ `cpa-templates/` จึงเข้า glob `FILES` ของ CI อยู่แล้ว (`.github/workflows/deploy-gcp.yml:263`) ไม่ต้องแก้ workflow.

- [ ] **Step 4: ยืนยันว่า migration ลงฐานเปล่าได้**

```bash
cd ~/Desktop/App/BESTCHOICE-acct-review-pr1/apps/api && npx prisma migrate deploy && \
  npx prisma migrate status && cd ../..
```

Expected: `1 migration … applied` แล้ว `Database schema is up to date!`

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/App/BESTCHOICE-acct-review-pr1 && \
  git add apps/api/prisma/migrations/20261013000000_backfill_reversal_contract_id \
          apps/api/src/modules/journal/cpa-templates/reversal-contract-id-backfill.spec.ts && \
  git commit -m "chore(db): เติม contractId ให้รายการกลับรายการเดิม"
```

---

### Task 7: กติกาบัญชี + เวอร์ชัน + regression ทั้งชุด

**Files:**
- Modify: `.claude/rules/accounting.md` (บรรทัด 2398, 2409, 2419, 2444 + หัวข้อใหม่ใต้ "ใบลดหนี้ตอน void ใบเสร็จ" หลังบรรทัด 830)
- Modify: `apps/web/package.json` (`version`)

**Interfaces:**
- Produces: branch พร้อมเปิด PR เมื่อเจ้าของสั่ง

- [ ] **Step 1: แก้ `.claude/rules/accounting.md` หัวข้อ ECL**

บรรทัด 2398 — แทนที่ `` `status != 'PAID' AND dueDate < asOf` `` ด้วย
`` `status != 'PAID' AND dueDate < bangkokStartOfDay(asOf)` (คำตัดสินฝ่ายบัญชี 2026-09-28 — งวดนับเป็นเกินกำหนดเมื่อ**พ้นวันครบกำหนดแล้ว**; งวดที่ครบกำหนดวันนี้ยังไม่เข้าฐาน) ``

บรรทัด 2409 — แทนที่ `` **daysOverdue** = `floor((asOf − Payment.dueDate) / 1 day)` `` ด้วย
`` **daysOverdue** = `bangkokDayDiff(Payment.dueDate, asOf)` (จำนวนวันปฏิทินไทย — รอบ 00:30 ของวันถัดจากวันครบกำหนด = 1 วัน) ``

บรรทัด 2419 — ต่อท้ายวงเล็บ `with \`dueDate < now\`` ด้วย
` — ฝั่งค่าเผื่อฯ ส่ง \`bangkokStartOfDay(now)\` เป็น \`asOf\` ตั้งแต่ 2026-09-28; ผู้เรียกฝั่งเปลี่ยนสถานะ DEFAULT ยังส่ง \`now\` ตามเดิม`

บรรทัด 2444 — แทนที่ `` only considers installments with `dueDate < now` `` ด้วย
`` only considers installments with `dueDate < bangkokStartOfDay(now)` — both paths go through `BadDebtService.eclRows` (TERMINATED/ACCRUED rows are date-filtered there because the engine's ACCRUED branch is shared with the CN util and must stay unfiltered) ``

เพิ่มใต้ตาราง golden (หลังบรรทัดที่ขึ้นต้น `- with floor` ในหัวข้อ "Golden fixtures"):

```markdown
- **วันครบกำหนดเอง (2026-09-28):** งวดครบกำหนด 27 ส.ค. · รอบ 27 ส.ค. 00:30 → ไม่มีค่าเผื่อ · รอบ 28 ส.ค. 00:30 → เกิน 1 วัน ช่วง `1-30` = 30.32 (`bad-debt.service.spec.ts` "คำตัดสินฝ่ายบัญชี 2026-09-28")
```

- [ ] **Step 2: เพิ่มหัวข้อกติการายการกลับรายการ** — ใน `.claude/rules/accounting.md` แทรกก่อนบรรทัด `## สรุปรายวัน = เงินสดที่รับจริง (receipt-based, 2026-08-18)`

```markdown
### รายการกลับรายการผูกกับสัญญา (คำตัดสินฝ่ายบัญชี 2026-09-28)

`ReceiptVoidReversalTemplate` (ผู้เรียก 2 ราย: ยกเลิกใบเสร็จ flow `receipt-void`, คืนเงิน flow
`refund-reversal`) copy **`contractId` อย่างเดียว** จากรายการเดิมลงรายการกลับรายการ — เพื่อให้
`glContractBalance` (JP5 / ตัดหนี้สูญ / ด่านเปลี่ยนเครื่อง / ด่านถังพักของ JP4) หักยอดของใบที่ยกเลิกแล้ว.

- **ห้าม copy** `paymentId`, `installmentScheduleId`, `tag`, `flow`, `idempotencyKey`, `deltaApplied`,
  `principalCleared`, `lateFeePortion`, `genericConsume`, `parkConsume` — ผู้อ่านใบรับชำระ
  (`reconstructPriorCleared`, `loadLateFeePaidByPaymentIds`, void/refund matcher) จะเข้าใจผิดว่าเป็นใบรับชำระ
- ผู้กวาดรายการตามสัญญา**ต้องข้ามทุกรายการที่ `tag === 'REVERSAL'`** —
  `DefectExchangeReversalTemplate` เคยข้ามเฉพาะ 2 flow และจะ mirror `refund-reversal` ซ้ำ (แก้แล้วรอบเดียวกัน)
- แถวเดิมเติมด้วย migration `20261013000000_backfill_reversal_contract_id`
- ผลที่เห็นได้: หลังยกเลิกใบเสร็จ ด่านเปลี่ยนเครื่องเห็น 11-2103 ค้างและบล็อก "มีงวดค้างชำระ" (ถูกต้อง)

```

- [ ] **Step 3: bump เวอร์ชันเว็บ** — เปิด `apps/web/package.json` ดูค่า `version` ปัจจุบันบน `origin/main` (`git show origin/main:apps/web/package.json | grep '"version"'`) แล้วเพิ่มเลขท้ายขึ้น 1 (ณ `ba80d3c9c` คือ `26.9.67` → `26.9.68`). ถ้า main ขยับไปแล้วให้ใช้เลขถัดจากค่าล่าสุดบน main.

- [ ] **Step 4: regression ทั้งชุด**

```bash
cd ~/Desktop/App/BESTCHOICE-acct-review-pr1 && ./tools/check-types.sh api && \
  npm --prefix apps/api test -- src/utils src/modules/journal src/modules/accounting \
    src/modules/receipts src/modules/refunds src/modules/defect-exchange src/modules/payments && \
  cd apps/api && npx vitest run --no-file-parallelism \
    $(ls src/modules/journal/cpa-templates/*.spec.ts | grep -v contract-cancellation.template.spec.ts) \
    $(ls src/modules/journal/cpa-templates/__tests__/*.spec.ts) \
    $(ls src/modules/accounting/*.integration.spec.ts) \
    $(ls src/modules/payments/services/*.integration.spec.ts) \
    $(ls src/modules/dashboard/__tests__/*.integration.spec.ts) && cd ../..
```

Expected: `API: OK` · jest ทุก suite ผ่าน · vitest ทุกไฟล์ผ่าน. ถ้ามีเทสล้ม ให้เทียบกับ `origin/main` ก่อน (`git stash && <รันไฟล์นั้น> && git stash pop`) — ล้มบน main ด้วย = ไม่ได้เกิดจาก PR นี้ ให้จดไว้ในข้อความ PR ไม่ต้องแก้.

- [ ] **Step 5: ตรวจ diff ว่าไม่มีไฟล์เกินขอบเขต**

Run: `cd ~/Desktop/App/BESTCHOICE-acct-review-pr1 && git fetch origin main && git diff --stat origin/main`
Expected: 15 ไฟล์โค้ด/กติกา — `date.util.ts`, `date.calendar.spec.ts`, `compute-cn-breakdown.ts`, `compute-installment-outstanding.spec.ts`, `bad-debt.service.ts`, `bad-debt.service.spec.ts`, `receipt-void-reversal.template.ts`, `receipt-void-reversal-flow.spec.ts`, `receipt-void-reversal.template.spec.ts`, `defect-exchange-reversal.template.ts`, `defect-exchange-reversal-skip.spec.ts`, `reversal-contract-id-backfill.spec.ts`, `migration.sql`, `.claude/rules/accounting.md`, `apps/web/package.json` + เอกสาร spec/แผน 2 ไฟล์

- [ ] **Step 6: Commit**

```bash
cd ~/Desktop/App/BESTCHOICE-acct-review-pr1 && \
  git add .claude/rules/accounting.md apps/web/package.json docs/superpowers && \
  git commit -m "docs(accounting): กติกาค่าเผื่อฯ และรายการกลับรายการตามคำตัดสิน 2026-09-28 + bump เวอร์ชัน"
```

- [ ] **Step 7: หยุดรอเจ้าของ** — รายงานผล regression แล้วถามว่าจะให้ push + เปิด PR หรือไม่. **ห้าม push เอง.**

---

## หลัง merge (ทำเมื่อเจ้าของสั่ง merge แล้ว CI deploy เขียว)

- [ ] ยืนยันเวอร์ชันเว็บบน prod ตรงกับที่ bump
- [ ] ตรวจ backfill ผ่าน MCP อ่านอย่างเดียว:

```sql
SELECT entry_number, metadata->>'flow' AS flow, metadata->>'contractId' AS contract_id
FROM journal_entries
WHERE deleted_at IS NULL AND metadata->>'tag' = 'REVERSAL'
  AND metadata->>'flow' IN ('receipt-void', 'refund-reversal')
ORDER BY entry_number;
```

Expected: JE-202609-00042 และ JE-202609-00043 มี `contract_id` = `0b018f77-5825-42ef-b55b-52ea3f9476da`

- [ ] ตรวจรายการกลับรายการที่อาจเกิดขึ้น**ระหว่าง**ขั้นตอน migration กับขั้นตอน deploy API
      (ต้องได้ **0 แถว**):

```sql
SELECT rev.entry_number
FROM journal_entries rev
JOIN journal_entries orig ON rev.metadata->>'originalEntryId' = orig.id
WHERE rev.deleted_at IS NULL
  AND rev.metadata->>'tag' = 'REVERSAL'
  AND rev.metadata->>'flow' IN ('receipt-void', 'refund-reversal')
  AND NOT (rev.metadata ? 'contractId')
  AND jsonb_typeof(orig.metadata->'contractId') = 'string';
```

  ถ้าได้แถว: ขออนุมัติเจ้าของก่อนรัน UPDATE ของ migration ซ้ำด้วยมือ (idempotent — รันซ้ำได้ ไม่กระทบแถวอื่น)

- [ ] เช้าวันถัดไป ตรวจว่ารอบค่าเผื่อฯ 00:30 รันปกติ (ไม่มี error ใน Sentry subsystem `bad-debt`)
  - หมายเหตุ: **prod ไม่มีสัญญาเปิดอยู่วันนี้** ⇒ รอบนี้จะว่างเปล่าและ**ไม่พิสูจน์อะไรเลย**เกี่ยวกับ
    เส้นตัดใหม่ — หลักฐานจริงของเส้นตัด "พ้นวันครบกำหนดแล้ว" บน prod คือ**สัญญาใหม่ใบแรกที่มีงวดครบ
    กำหนด**: วันครบกำหนดต้องยังไม่มีแถวค่าเผื่อฯ ของงวดนั้น แล้ววันถัดไปต้องมีแถวช่วง `1-30`

## เทสเดิมที่แตะ

| ไฟล์ | การเปลี่ยน |
|---|---|
| `compute-installment-outstanding.spec.ts:87-116` | เขียนเทสขอบเขตใหม่ตามกติกาวันปฏิทินไทย |
| `receipt-void-reversal-flow.spec.ts` | `setup()` รับ metadata ของรายการเดิม |
| `receipt-void-reversal.template.spec.ts` | เก็บ `contractId` + เทสยอดรายสัญญา |
| ที่เหลือ | ไม่เปลี่ยน — ยืนยันด้วย regression Task 7 Step 4 |
