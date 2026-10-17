# เปลี่ยนเครื่องตำหนิ 7 วัน — ใบลดหนี้ + เครดิต 21-5101 (15ข / 18.3ข) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปลี่ยนเครื่องตำหนิภายใน 7 วันทำได้แม้สัญญาเดิมมีการชำระแล้ว — ใบรับเงินทุกใบของสัญญาเดิมได้ใบลดหนี้ เงินของลูกค้าเดินผ่านบัญชีพัก 21-1106 ไปเป็นเครดิต 21-5101 ของสัญญาใหม่ และถูกใช้ชำระงวดอัตโนมัติตอนเปิดใช้ (ใบกำกับภาษีใหม่).

**Architecture:** แยก "ส่วนที่ทำใน tx" ของการยกเลิกใบเสร็จออกเป็นฟังก์ชัน `voidReceiptInTx` (ไม่มีด่านอนุมัติ/งวด/tx ของตัวเอง) ให้ `ReceiptVoidService` เดิมและ `DefectExchangeService` ใช้ร่วมกัน — กระจกรับชำระรับ `redirect` ย้ายขาเงินสดไป 21-1106. `DefectExchangeService.execute` ลงรายการ 4 ขั้นในธุรกรรม Serializable เดิม (ก ยกเลิกใบ · ค `reverseContract` ที่ข้าม flow เงินลูกค้า · ข ย้ายเงินค้าง · ง ตั้งเครดิตสัญญาใหม่) แล้ว `ContractWorkflowService.activate` เรียก `applyCreditBalance` หลัง commit. เอกสาร 3 ชิ้นตาม mockup `https://claude.ai/artifact/7dMBBNTYVZLGDvgG1pk2Yo`.

**Tech Stack:** NestJS + Prisma (Serializable tx) · jest (mock specs — `npx jest --runInBand`) · vitest (DB integration — `source ~/Documents/BESTCHOICE-docs/pr4-advance-vat/test-env.sh`) · React + vitest/testing-library (web)

**Spec:** `docs/superpowers/specs/2026-10-17-defect-exchange-credit-note-design.md` (commit `3f84c5ac4`)

## Global Constraints

- Worktree `/Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange` branch `feat/defect-exchange-credit-note` จาก origin/main `c5d26edcf` — **ใช้ absolute path ทุกคำสั่ง** (Bash ขนานเปลี่ยน cwd ได้)
- `apps/web/package.json` version → **`26.10.36`** (Task 12) · repo PUBLIC — ห้าม push เอกสารภายใน/ราคา (spec/plan ใต้ `docs/` ตามแบบ PR ก่อน ๆ)
- TDD ทุกงาน: เขียนเทส → ดูแดง → แก้ → ดูเขียว · commit ลงท้าย `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` · PR body ลงท้าย `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- jest: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand <paths>` · jest **ข้าม** ทุก spec ใต้ `journal/cpa-templates/` (testPathIgnorePatterns) ⇒ unit spec ของ template วางที่ `src/modules/journal/*.spec.ts`
- vitest DB: `source ~/Documents/BESTCHOICE-docs/pr4-advance-vat/test-env.sh && npx vitest run --root /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api --no-file-parallelism <file>` · **ห้ามรัน jest DB specs พร้อม vitest DB**
- lint: `cd apps/api && npx eslint --no-fix <absolute files>` — **ห้าม** `npm run lint` (มี --fix) · types: `./tools/check-types.sh api` / `web` / `all` จาก root
- ข้อความ error ภาษาไทย ชี้ทางที่ทำได้จริง (`.claude/rules/coding-standards.md`) · เงิน `Prisma.Decimal` เท่านั้น · soft delete เท่านั้น
- AuditLog ใน tx = `tx.auditLog.create` (เดิมของโมดูลนี้) · สัญญาณเตือน Sentry ส่ง**หลัง** commit ผ่าน `emitDeferredWarnings`
- ห้ามเดา JE: บัญชี/บรรทัดตาม spec §3 เท่านั้น · ไม่ stamp `advanceVatPark` บนรายการ ง (spec §7)
- ไม่มี migration · ไม่มี backfill · forward-only

## Review Focus

1. **รายการรับชำระที่ไม่มีใบเสร็จ** (ใบออกไม่สำเร็จหลัง commit): ขั้น ก ไม่เห็น (วนตามใบ) ⇒ ขั้น ค ต้องปฏิเสธทั้ง tx ไม่ใช่ mirror เงินสด — Task 3 เทส (c)
2. **สัญญาเดิมเป็นลูกของการเปลี่ยนเครื่องครั้งก่อน (A→B→C)**: B มีรายการ `defect-exchange-credit-in` (Dr 21-1106) ของตัวเอง ⇒ T ของ C ต้องคิดจาก Σ ใบ + เงินค้าง และตรวจทาน 21-1106 ของ B **บวกยอด credit-in ของ B** — Task 7 เคส 7
3. **งวดที่จ่ายหลังวันครบกำหนด** (2A ของรอบกลางคืน/ใบที่ทำให้ครบหลังครบกำหนด): ก กลับ 2A ไม่ได้ (`DUE_DATE_REACHED`) ⇒ ค ต้อง mirror 2A นั้น และ T ยังเท่ายอดใบ — Task 7 เคส 4
4. **ใบรับบางส่วน** (PARTIALLY_PAID + 2A เท่ายอดที่รับ): ใบลดหนี้เท่ายอดใบ · 2A บางส่วนถูกกลับ · T = ยอดใบ — Task 7 เคส 5
5. **ใบเสร็จอายุเกิน 30 วัน** (ทางใบซ่อมข้ามกรอบ): กฎ W-006 ของ void ต้องไม่ใช้กับทางนี้ — Task 2 เทส "skipAgeLimit"

---

## File map

| ไฟล์ | หน้าที่ |
|---|---|
| `apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.ts` (แก้) | `voidReceipt(id, tx, { flow?, redirect? })` — redirect ขาเงินสดของกระจก |
| `apps/api/src/modules/receipts/services/receipt-void-core.ts` (ใหม่) | `voidReceiptInTx(tx, deps, input)` — ส่วนใน tx ของการยกเลิกใบเสร็จ (ย้ายจาก service) + `VoidReceiptPolicy` |
| `apps/api/src/modules/receipts/services/receipt-void.service.ts` (แก้) | เหลือด่านนอก tx (อนุมัติ/งวด/legacy money) → เรียก core · re-export ค่าคงที่เดิม |
| `apps/api/src/modules/journal/cpa-templates/defect-exchange-reversal.template.ts` (แก้) | ข้าม flow เครดิต + นโยบายรายการเงินสด (ข้าม/ปฏิเสธ) |
| `apps/api/src/modules/journal/contract-close-advances.ts` (แก้) | `ContractCloseFlow` + `'defect-exchange'` |
| `apps/api/src/modules/defect-exchange/defect-exchange-credit.ts` (ใหม่) | ค่าคงที่ · บรรทัด JE ข/ง · เลือกใบ · ด่านเงิน (`exchangeMoneyBlockers`) · `creditInAmountOf` |
| `apps/api/src/modules/defect-exchange/defect-exchange.service.ts` (แก้) | `checkEligibility` + `execute` ขั้น ก/ค/ข/ง · ctor + 2 deps |
| `apps/api/src/modules/defect-exchange/defect-exchange.module.ts` (แก้) | provide `ReceiptNumberService` |
| `apps/api/src/modules/defect-exchange/__tests__/defect-exchange-credit.integration.spec.ts` (ใหม่) | DB chain ทั้งสาย + CI glob `DEFECT_FILES` |
| `apps/api/src/modules/contracts/services/exchange-credit-autoapply.ts` (ใหม่) | `applyExchangeCreditAfterActivation` |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` · `contracts.module.ts` · `contracts.controller.ts` (แก้) | `activate(id, actorId?)` + `@Optional` PaymentsService |
| `apps/api/src/modules/receipts/services/exchange-credit-source.ts` (ใหม่) | ที่มาของเครดิตบนใบใช้เครดิต (pure + query) |
| `apps/api/src/modules/receipts/services/receipt-query.service.ts` · `receipt-pdf.service.ts` (แก้) | `exchangeTarget` / `exchangeCreditSource` + HTML |
| `apps/api/src/modules/after-sales/utils/exchange-confirm-note.ts` (ใหม่) · `after-sales-exchange.service.ts` (แก้) | ข้อความ event + ส่งผลเครดิต |
| `apps/web/src/pages/after-sales/ExchangeActionDialogs.tsx` (แก้) + `ExchangeActionDialogs.credit.test.tsx` (ใหม่) | ตารางใบเสร็จ + ยอดเครดิตในกล่องยืนยัน |
| `.claude/rules/accounting.md` · `.claude/CLAUDE.md` · `apps/web/package.json` | เอกสาร + เวอร์ชัน |

---

### Task 1: กระจกรับชำระรับ `redirect` ขาเงินสด → 21-1106

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.ts` (`voidReceipt` L356–452 · `MirroredLine` L58)
- Test: `apps/api/src/modules/journal/receipt-void-reversal.redirect.spec.ts` (ใหม่ — jest วางนอก cpa-templates/)

**Interfaces:**
- Produces: `export interface ReceiptVoidRedirect { accountPrefixes: readonly string[]; to: string; description: string }` · `export function redirectMirroredLines(lines, redirect?)` · `voidReceipt(originalJournalEntryId, tx?, opts?: { flow?: string; redirect?: ReceiptVoidRedirect })` — metadata ของกระจกมี `redirectedTo` เมื่อมีบรรทัดถูกย้าย

- [ ] **Step 1: เขียนเทสที่ล้ม**

```ts
// apps/api/src/modules/journal/receipt-void-reversal.redirect.spec.ts
// jest — วางนอก cpa-templates/ (jest ข้าม spec ใต้โฟลเดอร์นั้น)
import { Prisma } from '@prisma/client';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ReceiptVoidReversalTemplate,
  redirectMirroredLines,
  type ReceiptVoidRedirect,
} from './cpa-templates/receipt-void-reversal.template';

const line = (accountCode: string, debit: string, credit: string, description = 'x') => ({
  accountCode,
  debit: new Prisma.Decimal(debit),
  credit: new Prisma.Decimal(credit),
  description,
});

const REDIRECT: ReceiptVoidRedirect = {
  accountPrefixes: ['11-11', '11-12'],
  to: '21-1106',
  description: 'โอนเป็นเครดิตเปลี่ยนเครื่อง',
};

function setup() {
  const original = {
    id: 'je-receipt',
    entryNumber: 'JE-0007',
    status: 'POSTED',
    metadata: { tag: 'receipt', flow: 'payment-receipt', contractId: 'ct-old', paymentId: 'pay-1' },
    lines: [line('11-1201', '1515.83', '0'), line('11-2103', '0', '1515.83')],
  };
  const prisma = {
    journalEntry: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(original),
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
  const createAndPost = jest.fn().mockResolvedValue({ entryNumber: 'JE-0008' });
  const journal = { createAndPost } as unknown as JournalAutoService;
  return { tpl: new ReceiptVoidReversalTemplate(journal, prisma), createAndPost };
}

describe('redirectMirroredLines (pure)', () => {
  it('ย้ายเฉพาะบรรทัดที่บัญชีขึ้นต้นด้วย prefix — ยอด/ฝั่งเท่าเดิม ต่อท้ายคำอธิบาย', () => {
    const mirrored = [
      { accountCode: '11-2103', dr: new Prisma.Decimal('1515.83'), cr: new Prisma.Decimal(0), description: '[VOID] x' },
      { accountCode: '11-1201', dr: new Prisma.Decimal(0), cr: new Prisma.Decimal('1515.83'), description: '[VOID] x' },
    ];
    const out = redirectMirroredLines(mirrored, REDIRECT);
    expect(out.redirected).toBe(true);
    expect(out.lines.map((l) => l.accountCode)).toEqual(['11-2103', '21-1106']);
    expect(out.lines[1].cr.toFixed(2)).toBe('1515.83');
    expect(out.lines[1].description).toBe('[VOID] x · โอนเป็นเครดิตเปลี่ยนเครื่อง');
  });

  it('ไม่ส่ง redirect = บรรทัดเดิมทุกตัวอักษร', () => {
    const mirrored = [{ accountCode: '11-1201', dr: new Prisma.Decimal(0), cr: new Prisma.Decimal('1'), description: 'd' }];
    const out = redirectMirroredLines(mirrored, undefined);
    expect(out).toEqual({ lines: mirrored, redirected: false });
  });
});

describe('ReceiptVoidReversalTemplate.voidReceipt — redirect', () => {
  it('มี redirect: กระจกลง Cr 21-1106 แทน 11-1201 และ stamp redirectedTo', async () => {
    const { tpl, createAndPost } = setup();
    await tpl.voidReceipt('je-receipt', undefined, { redirect: REDIRECT });
    const input = createAndPost.mock.calls[0][0];
    const codes = input.lines.map((l: { accountCode: string }) => l.accountCode);
    expect(codes).toEqual(['11-2103', '21-1106']);
    expect(codes).not.toContain('11-1201');
    expect(input.metadata.redirectedTo).toBe('21-1106');
    expect(input.metadata.flow).toBe('receipt-void');
    expect(input.metadata.contractId).toBe('ct-old');
  });

  it('ไม่มี redirect: กระจก 11-1201 ตามเดิม ไม่มี redirectedTo', async () => {
    const { tpl, createAndPost } = setup();
    await tpl.voidReceipt('je-receipt');
    const input = createAndPost.mock.calls[0][0];
    expect(input.lines.map((l: { accountCode: string }) => l.accountCode)).toEqual(['11-2103', '11-1201']);
    expect(input.metadata).not.toHaveProperty('redirectedTo');
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/journal/receipt-void-reversal.redirect.spec.ts`
Expected: FAIL — `redirectMirroredLines is not a function` (export ยังไม่มี)

- [ ] **Step 3: แก้ template**

ใน `receipt-void-reversal.template.ts` หลัง `type MirroredLine = …` (L58) เพิ่ม:

```ts
/** ย้ายบรรทัดกระจกที่บัญชีขึ้นต้นด้วย prefix ไปบัญชีปลายทาง — ใช้โดยเปลี่ยนเครื่องตำหนิ (ขาเงินสด → 21-1106) */
export interface ReceiptVoidRedirect {
  accountPrefixes: readonly string[];
  to: string;
  description: string;
}

/**
 * บรรทัดกระจกหลัง redirect: บัญชีเปลี่ยน ยอด/ฝั่งเท่าเดิม คำอธิบายต่อท้าย ` · <description>`.
 * ไม่ส่ง redirect = คืน array เดิม (ไม่ copy) และ `redirected: false`.
 */
export function redirectMirroredLines(
  lines: MirroredLine[],
  redirect: ReceiptVoidRedirect | undefined,
): { lines: MirroredLine[]; redirected: boolean } {
  if (!redirect) return { lines, redirected: false };
  let redirected = false;
  const out = lines.map((l) => {
    if (!redirect.accountPrefixes.some((p) => l.accountCode.startsWith(p))) return l;
    redirected = true;
    return { ...l, accountCode: redirect.to, description: `${l.description} · ${redirect.description}` };
  });
  return { lines: out, redirected };
}
```

ใน `voidReceipt`: เปลี่ยนลายเซ็น `opts?: { flow?: string; redirect?: ReceiptVoidRedirect }` · แทนบรรทัด `const reversedLines = mirrorPostedLines(originalJe.lines, '[VOID]');` ด้วย

```ts
    const { lines: reversedLines, redirected } = redirectMirroredLines(
      mirrorPostedLines(originalJe.lines, '[VOID]'),
      opts?.redirect,
    );
```

และใน `metadata` ของ `createAndPost` เพิ่มหลังบล็อก `...(typeof existingMeta['contractId'] === 'string' ? … : {})`:

```ts
          // เปลี่ยนเครื่องตำหนิ: ขาเงินสดถูกย้ายไปบัญชีพัก — บอกผู้อ่านรายการว่าไม่มีเงินสดออกจริง
          ...(redirected && opts?.redirect ? { redirectedTo: opts.redirect.to } : {}),
```

- [ ] **Step 4: รันให้ผ่าน + spec เดิมของ template**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/journal/receipt-void-reversal.redirect.spec.ts src/modules/journal/receipt-accrual-void.spec.ts src/modules/receipts/services/receipt-void.accrual-reversal.spec.ts src/modules/receipts/services/receipt-void.sibling-credit-note.spec.ts`
Expected: PASS ทั้ง 4 ไฟล์

- [ ] **Step 5: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && git add apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.ts apps/api/src/modules/journal/receipt-void-reversal.redirect.spec.ts && git commit -q -F - <<'MSG'
feat(journal): กระจกรับชำระรับ redirect ขาเงินสด → บัญชีพัก (เปลี่ยนเครื่องตำหนิ 15ข)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 2: แยกส่วนใน tx ของการยกเลิกใบเสร็จเป็น `voidReceiptInTx`

**Files:**
- Create: `apps/api/src/modules/receipts/services/receipt-void-core.ts`
- Modify: `apps/api/src/modules/receipts/services/receipt-void.service.ts` (ย้ายบรรทัด 250–757 ออก)
- Test: `apps/api/src/modules/receipts/services/receipt-void-core.spec.ts` (ใหม่) · spec เดิม 2 ไฟล์ต้องเขียวโดยไม่แก้

**Interfaces:**
- Consumes: `ReceiptVoidRedirect` (Task 1)
- Produces (ทั้งหมด `export` จาก `receipt-void-core.ts`): `JE_ADVANCE_SPLIT_META`, `RESCHEDULE_ADVANCE_UNPARKED`, `UNPAY_BLOCKED_CONTRACT_STATUSES`, `type CreditNoteMoney`, `storedTaxColumnsOf(row: Receipt): Partial<CreditNoteMoney>`, `interface VoidReceiptPolicy { skipAgeLimit?: boolean; cnSource?: string; redirect?: ReceiptVoidRedirect }`, `interface VoidReceiptInTxInput { receipt: Receipt; reason: string; issuedById: string; approvedById: string; userRole?: string | null; creditNoteMoney: (row: Receipt) => Partial<CreditNoteMoney>; policy?: VoidReceiptPolicy }`, `interface VoidReceiptInTxResult { voidedReceipt: Receipt; creditNote: Receipt; paymentReverted: PaymentReverted | null; siblingCreditNoteNumbers: string[]; siblingReceiptNumbers: string[]; accrualReversal: AccrualVoidResult | null; warnings: readonly DeferredWarning[] }`, `voidReceiptInTx(tx: Prisma.TransactionClient, deps: { reversal: ReceiptVoidReversalTemplate; numbers: ReceiptNumberService }, input: VoidReceiptInTxInput): Promise<VoidReceiptInTxResult>`
- `receipt-void.service.ts` ยัง `export { JE_ADVANCE_SPLIT_META, RESCHEDULE_ADVANCE_UNPARKED }` (ผู้ import เดิม: `payment-receipt-orchestrator.ts`, `reschedule-collect.service.ts`, `park-void-restore.integration.spec.ts`)

- [ ] **Step 1: เขียนเทสที่ล้ม**

```ts
// apps/api/src/modules/receipts/services/receipt-void-core.spec.ts
import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { voidReceiptInTx, storedTaxColumnsOf } from './receipt-void-core';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

const dec = (n: string | number) => new Prisma.Decimal(n);
const DAY_MS = 86_400_000;

function receiptRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'rcpt-1',
    receiptNumber: 'RT-202610-00031',
    contractId: 'ct-old',
    paymentId: 'pay-1',
    receiptType: 'INSTALLMENT',
    payerName: 'ลูกค้า',
    receiverName: 'พนักงาน',
    amount: dec('1515.83'),
    amountBeforeVat: dec('1416.66'),
    vatAmount: dec('99.17'),
    roundingAmount: dec('0'),
    lateFeeAmount: dec('0'),
    lateFeeWaivedAmount: dec('0'),
    advanceAmount: dec('0'),
    advanceVatAmount: dec('0'),
    installmentNo: 1,
    paymentMethod: 'BANK_TRANSFER',
    paidDate: new Date(Date.now() - 2 * DAY_MS),
    createdAt: new Date(Date.now() - 2 * DAY_MS),
    isVoided: false,
    deletedAt: null,
    ...overrides,
  } as never;
}

function setup(opts: { receiptEntries?: unknown[] } = {}) {
  const tx = {
    receipt: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...data, id: `cn-${String(data.receiptNumber)}` }),
      ),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    contract: {
      findUnique: jest.fn().mockResolvedValue({ id: 'ct-old', status: 'ACTIVE' }),
      update: jest.fn().mockResolvedValue({ advanceBalance: dec(0), rescheduleAdvanceBalance: dec(0) }),
    },
    journalEntry: {
      // 1) ด่าน advance-excess-income · 2) ใบรับชำระของ Payment · 3) reconstructPriorCleared
      findMany: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(opts.receiptEntries ?? [])
        .mockResolvedValueOnce([]),
    },
    payment: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'pay-1', status: 'PAID', amountPaid: dec('1515.83'), amountDue: dec('1515.83'),
        dueDate: new Date(Date.now() + 20 * DAY_MS), contractId: 'ct-old', installmentNo: 1, deletedAt: null,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    installmentSchedule: { findUnique: jest.fn().mockResolvedValue({ id: 'inst-1' }) },
    loyaltyPoint: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) },
  };
  const reversal = {
    voidReceipt: jest.fn().mockResolvedValue({ entryNo: 'JE-VOID' }),
    voidAccrualPostedAtReceipt: jest.fn().mockResolvedValue({
      result: { reversed: true, entryNos: ['JE-RV'], accrualEntryNumbers: ['JE-2A'] },
      warnings: [],
    }),
  };
  const numbers = { generateReceiptNumber: jest.fn().mockResolvedValue('RT-202610-00044') };
  return { tx, reversal, numbers };
}

const REDIRECT = { accountPrefixes: ['11-11', '11-12'], to: '21-1106', description: 'โอนเป็นเครดิตเปลี่ยนเครื่อง' };

describe('voidReceiptInTx — นโยบายของเปลี่ยนเครื่องตำหนิ', () => {
  it('ใบลดหนี้ได้ cnSource · คัดลอกค่าที่เก็บ · กระจกรับชำระถูกเรียกพร้อม redirect', async () => {
    const { tx, reversal, numbers } = setup({
      receiptEntries: [{ id: 'je-receipt', metadata: { tag: 'receipt', paymentId: 'pay-1' }, lines: [] }],
    });
    const out = await voidReceiptInTx(tx as never, { reversal: reversal as never, numbers: numbers as never }, {
      receipt: receiptRow(),
      reason: 'เปลี่ยนเครื่องตำหนิภายใน 7 วัน → สัญญา CT-NEW',
      issuedById: 'mgr-1',
      approvedById: 'mgr-1',
      userRole: 'BRANCH_MANAGER',
      creditNoteMoney: storedTaxColumnsOf,
      policy: { skipAgeLimit: true, cnSource: 'DEFECT_EXCHANGE', redirect: REDIRECT },
    });
    const cnData = tx.receipt.create.mock.calls[0][0].data;
    expect(cnData.receiptType).toBe('CREDIT_NOTE');
    expect(cnData.cnSource).toBe('DEFECT_EXCHANGE');
    expect(cnData.voidedReceiptId).toBe('rcpt-1');
    expect(cnData.vatAmount.toFixed(2)).toBe('99.17');
    expect(reversal.voidReceipt).toHaveBeenCalledWith('je-receipt', tx, { redirect: REDIRECT });
    expect(out.creditNote.receiptNumber).toBe('RT-202610-00044');
    expect(out.accrualReversal).toEqual({ reversed: true, entryNos: ['JE-RV'], accrualEntryNumbers: ['JE-2A'] });
    expect(tx.auditLog.create.mock.calls.at(-1)[0].data.action).toBe('RECEIPT_VOID');
  });

  it('skipAgeLimit: ใบอายุ 45 วันยกเลิกได้ · ไม่ส่ง policy = ปฏิเสธเกิน 30 วันตามเดิม', async () => {
    const old = receiptRow({ createdAt: new Date(Date.now() - 45 * DAY_MS) });
    const base = { reason: 'x', issuedById: 'u', approvedById: 'u', creditNoteMoney: storedTaxColumnsOf };
    const a = setup();
    await expect(
      voidReceiptInTx(a.tx as never, { reversal: a.reversal as never, numbers: a.numbers as never }, { ...base, receipt: old, policy: { skipAgeLimit: true } }),
    ).resolves.toBeDefined();
    const b = setup();
    await expect(
      voidReceiptInTx(b.tx as never, { reversal: b.reversal as never, numbers: b.numbers as never }, { ...base, receipt: old }),
    ).rejects.toThrow(new BadRequestException('ไม่สามารถยกเลิกใบเสร็จที่ออกเกิน 30 วัน'));
  });

  it('ไม่มี policy: กระจกถูกเรียก 2 อาร์กิวเมนต์ (พฤติกรรม void เดิม) และใบลดหนี้ไม่มี cnSource', async () => {
    const { tx, reversal, numbers } = setup({
      receiptEntries: [{ id: 'je-receipt', metadata: { tag: 'receipt', paymentId: 'pay-1' }, lines: [] }],
    });
    await voidReceiptInTx(tx as never, { reversal: reversal as never, numbers: numbers as never }, {
      receipt: receiptRow(), reason: 'x', issuedById: 'u', approvedById: 'a', creditNoteMoney: storedTaxColumnsOf,
    });
    expect(reversal.voidReceipt).toHaveBeenCalledWith('je-receipt', tx);
    expect(tx.receipt.create.mock.calls[0][0].data).not.toHaveProperty('cnSource');
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/receipts/services/receipt-void-core.spec.ts`
Expected: FAIL — `Cannot find module './receipt-void-core'`

- [ ] **Step 3: สร้าง core โดย "ย้าย" โค้ด (ไม่เขียนใหม่)**

สร้าง `receipt-void-core.ts` ด้วยโครงนี้ แล้ว**ตัด**บล็อกจาก `receipt-void.service.ts` มาวาง:

```ts
// apps/api/src/modules/receipts/services/receipt-void-core.ts
import { BadRequestException } from '@nestjs/common';
import { Prisma, type Receipt } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import {
  ReceiptVoidReversalTemplate,
  type AccrualVoidResult,
  type ReceiptVoidRedirect,
} from '../../journal/cpa-templates/receipt-void-reversal.template';
import type { DeferredWarning } from '../../journal/deferred-warning';
import { assertNoAdvanceExcessIncome } from '../../journal/advance-excess-income.util';
import { reconstructPriorCleared } from '../../journal/reconstruct-prior';
import { ReceiptNumberService } from './receipt-number.service';
import { INSTALLMENT_MONEY_RECEIPT_TYPES } from '../receipt-types.constants';
import { documentMoneyColumns } from './receipt-document-money';

/** ตัวเลขที่ใบลดหนี้เก็บ — ทุกบรรทัดของเอกสารใบที่ถูกยกเลิก (PR3 · Q5) */
export type CreditNoteMoney = ReturnType<typeof documentMoneyColumns>;

/** ค่าที่ใบที่ออกตั้งแต่ PR3 เก็บไว้ ณ ตอนออกใบ — ใบลดหนี้คัดลอกตรงตัว */
export const storedTaxColumnsOf = (row: Receipt): Partial<CreditNoteMoney> => ({
  amountBeforeVat: row.amountBeforeVat ?? undefined,
  vatAmount: row.vatAmount ?? undefined,
  roundingAmount: row.roundingAmount ?? undefined,
  lateFeeAmount: row.lateFeeAmount ?? undefined,
  lateFeeWaivedAmount: row.lateFeeWaivedAmount ?? undefined,
  advanceAmount: row.advanceAmount ?? undefined,
  advanceVatAmount: row.advanceVatAmount ?? undefined,
});

// ⬇ ย้าย (ตัด-วาง) จาก receipt-void.service.ts ทั้งสามก้อนพร้อม docblock เดิม:
//   `export const JE_ADVANCE_SPLIT_META = …`
//   `export const RESCHEDULE_ADVANCE_UNPARKED = …`
//   `const UNPAY_BLOCKED_CONTRACT_STATUSES = […]` → เปลี่ยนเป็น `export const`

/** นโยบายของผู้เรียก — ค่าเริ่มต้น (ไม่ส่ง) = พฤติกรรมยกเลิกใบเสร็จเดิมทุกตัวอักษร */
export interface VoidReceiptPolicy {
  /** ข้ามกฎ W-006 (30 วัน) — ใช้โดยเปลี่ยนเครื่องตำหนิ (ผู้ยืนยันรับผิดชอบ · spec §5) */
  skipAgeLimit?: boolean;
  /** `Receipt.cnSource` ของใบลดหนี้ทุกใบที่ออกในรอบนี้ (ใบเป้าหมาย + ใบพี่น้อง) */
  cnSource?: string;
  /** ส่งต่อให้ `ReceiptVoidReversalTemplate.voidReceipt` — ย้ายขาเงินสดของกระจก */
  redirect?: ReceiptVoidRedirect;
}

export interface PaymentReverted {
  paymentId: string;
  fromStatus: string;
  toStatus: string;
  previousAmountPaid: string;
  survivingAmountPaid: string;
}

export interface VoidReceiptInTxInput {
  /** แถวที่ผู้เรียกอ่านมาแล้วใน tx เดียวกัน — ยังไม่ถูกยกเลิก ไม่ถูกลบ */
  receipt: Receipt;
  reason: string;
  issuedById: string;
  approvedById: string;
  userRole?: string | null;
  creditNoteMoney: (row: Receipt) => Partial<CreditNoteMoney>;
  policy?: VoidReceiptPolicy;
}

export interface VoidReceiptInTxResult {
  voidedReceipt: Receipt;
  creditNote: Receipt;
  paymentReverted: PaymentReverted | null;
  siblingCreditNoteNumbers: string[];
  siblingReceiptNumbers: string[];
  accrualReversal: AccrualVoidResult | null;
  /** สัญญาณเตือนของการกลับรายการตั้งลูกหนี้งวด — ผู้เรียกส่งหลังธุรกรรม commit */
  warnings: readonly DeferredWarning[];
}

/**
 * ส่วน "ใน tx" ของการยกเลิกใบเสร็จ — ย้ายมาจาก `ReceiptVoidService.voidReceipt` (2026-10-17) เพื่อให้
 * เปลี่ยนเครื่องตำหนิ (15ข) ใช้กลไกเดียวกันในธุรกรรมของตัวเอง. ด่านที่อยู่นอก tx (เหตุผล · คำขออนุมัติ ·
 * งวดบัญชี · อ่านตัวเลขใบเก่า) เป็นหน้าที่ผู้เรียก. ลำดับการทำงานข้างในเท่าเดิมทุกบรรทัด.
 */
export async function voidReceiptInTx(
  tx: Prisma.TransactionClient,
  deps: { reversal: ReceiptVoidReversalTemplate; numbers: ReceiptNumberService },
  input: VoidReceiptInTxInput,
): Promise<VoidReceiptInTxResult> {
  const { receipt, issuedById, approvedById, userRole, creditNoteMoney } = input;
  const policy = input.policy ?? {};
  const reason = input.reason.trim();
  const id = receipt.id;
  const siblingReceiptNumbers: string[] = [];
  let accrualWarnings: readonly DeferredWarning[] = [];

  // ⬇ วางบล็อกที่ตัดจาก receipt-void.service.ts: ตั้งแต่บรรทัด
  //      `// A credit note is itself the reversal document — voiding one would try to`
  //   จนถึงบรรทัดก่อน `return { voidedReceipt: receipt, creditNote, paymentReverted };` (ไม่รวม)
  //   แล้วแก้ตามรายการ "substitutions" ข้างล่าง

  return {
    voidedReceipt: receipt,
    creditNote,
    paymentReverted,
    siblingCreditNoteNumbers,
    siblingReceiptNumbers,
    accrualReversal,
    warnings: accrualWarnings,
  };
}
```

**Substitutions ในบล็อกที่ย้าย (ทำทุกข้อ ตรวจด้วย grep ว่าไม่เหลือ `this.`):**
1. `this.receiptVoidReversalTemplate.voidReceipt(originalEntry.id, tx)` → `policy.redirect ? await deps.reversal.voidReceipt(originalEntry.id, tx, { redirect: policy.redirect }) : await deps.reversal.voidReceipt(originalEntry.id, tx)` (คง `await` หน้าเดิม — เขียนเป็น `if/else` สองบรรทัดก็ได้)
2. `this.receiptVoidReversalTemplate.voidAccrualPostedAtReceipt(` → `deps.reversal.voidAccrualPostedAtReceipt(`
3. `this.numbers.generateReceiptNumber(tx)` (2 แห่ง) → `deps.numbers.generateReceiptNumber(tx)`
4. บล็อก W-006: ครอบด้วย `if (!policy.skipAgeLimit) { … }` (ทั้ง `daysSinceIssue` และ `throw`)
5. `tx.receipt.create({ data: { … receiptType: 'CREDIT_NOTE', … } })` ทั้ง 2 แห่ง (ใบเป้าหมาย + ใบพี่น้อง): เพิ่ม `...(policy.cnSource ? { cnSource: policy.cnSource } : {}),` หลัง `voidedReceiptId: …,`
6. ในลูป `for (const sibling of siblingReceipts)` เพิ่ม `siblingReceiptNumbers.push(sibling.receiptNumber);` หลัง `siblingCreditNoteNumbers.push(siblingCreditNoteNumber);`
7. `reason.trim()` ทุกแห่ง → `reason` (trim แล้วข้างบน)
8. บรรทัด `let accrualWarnings: readonly DeferredWarning[] = [];` ของ service **ไม่ย้าย** (ประกาศใหม่ใน core แล้ว) — บรรทัด `accrualWarnings = accrualVoid.warnings;` ในบล็อกย้ายมาตามเดิม

**`receipt-void.service.ts` หลังย้าย** — `voidReceipt` เหลือ:

```ts
    const voided = await this.prisma.$transaction(
      async (tx) => {
        const receipt = await tx.receipt.findUnique({ where: { id } });
        if (!receipt || receipt.deletedAt) throw new NotFoundException('ไม่พบใบเสร็จ');
        const approval = await consumePaymentApproval(tx, approvalContext, 'VOID_RECEIPT', id);
        if (approval.requestedById !== issuedById)
          throw new ForbiddenException('ผู้ขออนุมัติไม่ตรงกับผู้ทำรายการ');
        if (receipt.isVoided) throw new BadRequestException('ใบเสร็จนี้ถูกยกเลิกแล้ว');

        const out = await voidReceiptInTx(
          tx,
          { reversal: this.receiptVoidReversalTemplate, numbers: this.numbers },
          { receipt, reason, issuedById, approvedById, userRole, creditNoteMoney },
        );
        accrualWarnings = out.warnings;
        return { voidedReceipt: out.voidedReceipt, creditNote: out.creditNote, paymentReverted: out.paymentReverted };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    emitDeferredWarnings(accrualWarnings);
    return voided;
```

import ที่ไม่ใช้แล้วใน service ลบออก (`Sentry`, `assertNoAdvanceExcessIncome`, `reconstructPriorCleared`, `INSTALLMENT_MONEY_RECEIPT_TYPES`, `documentMoneyColumns`, `AccrualVoidResult`) · เพิ่ม `import { voidReceiptInTx, storedTaxColumnsOf, type CreditNoteMoney } from './receipt-void-core';` · เพิ่มบรรทัด `export { JE_ADVANCE_SPLIT_META, RESCHEDULE_ADVANCE_UNPARKED } from './receipt-void-core';` · `storedTaxColumnsOf` ท้องถิ่นลบ (ใช้ของ core)

- [ ] **Step 4: รันเทสใหม่ + เทสเดิมทั้งหมดที่แตะ void**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/receipts/services/receipt-void-core.spec.ts src/modules/receipts/services/receipt-void.accrual-reversal.spec.ts src/modules/receipts/services/receipt-void.sibling-credit-note.spec.ts src/modules/payments/services/reschedule-collect.service.spec.ts && grep -c "this\." src/modules/receipts/services/receipt-void-core.ts`
Expected: PASS ทั้ง 4 · grep = `0`

- [ ] **Step 5: types + lint**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && ./tools/check-types.sh api && cd apps/api && npx eslint --no-fix /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api/src/modules/receipts/services/receipt-void-core.ts /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api/src/modules/receipts/services/receipt-void.service.ts`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && git add apps/api/src/modules/receipts/services/receipt-void-core.ts apps/api/src/modules/receipts/services/receipt-void-core.spec.ts apps/api/src/modules/receipts/services/receipt-void.service.ts && git commit -q -F - <<'MSG'
refactor(receipts): แยก voidReceiptInTx (ส่วนใน tx ของการยกเลิกใบเสร็จ) + นโยบาย cnSource/redirect/skipAgeLimit

พฤติกรรม voidReceipt เดิมไม่เปลี่ยน — spec เดิม 2 ไฟล์เขียวโดยไม่แก้

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 3: `reverseContract` ข้าม flow เครดิต + นโยบายรายการเงินสด

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/defect-exchange-reversal.template.ts`
- Test: `apps/api/src/modules/journal/defect-exchange-reversal-credit-flows.spec.ts` (ใหม่ — jest)

**Interfaces:**
- Produces: `export const DEFECT_EXCHANGE_CREDIT_OUT_FLOW = 'defect-exchange-credit-out'` · `export const DEFECT_EXCHANGE_CREDIT_IN_FLOW = 'defect-exchange-credit-in'` · `export const CUSTOMER_MONEY_ACCOUNTS = ['21-1103', '21-5101', '21-2101', '21-2102'] as const` · `export const CASH_ACCOUNT_PREFIXES = ['11-11', '11-12'] as const` · `reverseContract(contractId, tx?)` ลายเซ็นเดิม — พฤติกรรมใหม่: ข้าม 2 flow + รายการเงินสดที่คู่เป็นเงินลูกค้าล้วน = ข้าม · รายการเงินสดอื่น = `BadRequestException`

- [ ] **Step 1: เขียนเทสที่ล้ม**

```ts
// apps/api/src/modules/journal/defect-exchange-reversal-credit-flows.spec.ts
// jest — วางนอก cpa-templates/ (jest ข้าม spec ใต้โฟลเดอร์นั้น)
import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DefectExchangeReversalTemplate,
  DEFECT_EXCHANGE_CREDIT_IN_FLOW,
  DEFECT_EXCHANGE_CREDIT_OUT_FLOW,
} from './cpa-templates/defect-exchange-reversal.template';

const line = (accountCode: string, debit: number, credit: number) => ({
  accountCode,
  debit: new Prisma.Decimal(debit),
  credit: new Prisma.Decimal(credit),
  description: 'x',
});

function setup(entries: Array<Record<string, unknown>>) {
  const prisma = {
    contract: { findUniqueOrThrow: jest.fn().mockResolvedValue({ contractNumber: 'CT-OLD' }) },
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

const activation = {
  id: 'je-1a',
  entryNumber: 'JE-0001',
  metadata: { tag: '1A', contractId: 'ct-1' },
  lines: [line('11-2101', 17000, 0), line('21-1101', 0, 17000)],
};

describe('DefectExchangeReversalTemplate — flow เครดิตเปลี่ยนเครื่อง + รายการเงินสด (15ข)', () => {
  it.each([DEFECT_EXCHANGE_CREDIT_OUT_FLOW, DEFECT_EXCHANGE_CREDIT_IN_FLOW])(
    'ข้าม flow %s (ไม่ mirror การย้ายเครดิต)',
    async (flow) => {
      const credit = {
        id: 'je-credit',
        entryNumber: 'JE-0005',
        metadata: { tag: 'DEFECT_EXCHANGE', flow, contractId: 'ct-1' },
        lines: [line('21-1106', 1515.83, 0), line('21-5101', 0, 1515.83)],
      };
      const { tpl, createAndPost } = setup([activation, credit]);
      const result = await tpl.reverseContract('ct-1');
      expect(result.reversedCount).toBe(1);
      expect(createAndPost.mock.calls[0][0].metadata.originalEntryId).toBe('je-1a');
    },
  );

  it('รายการเงินสดที่คู่เป็นเงินของลูกค้าล้วน (overpayment-credit: Dr ธนาคาร / Cr 21-5101 + ภาษีพัก) = ข้าม ไม่ mirror', async () => {
    const overpay = {
      id: 'je-over',
      entryNumber: 'JE-0006',
      metadata: { tag: 'overpayment-credit', contractId: 'ct-1', paymentId: 'pay-1', advanceVatPark: '19.63' },
      lines: [line('11-1201', 300, 0), line('21-5101', 0, 300), line('21-2102', 19.63, 0), line('21-2101', 0, 19.63)],
    };
    const { tpl, createAndPost } = setup([activation, overpay]);
    const result = await tpl.reverseContract('ct-1');
    expect(result.reversedCount).toBe(1);
    expect(createAndPost).toHaveBeenCalledTimes(1);
  });

  it('รายการเงินสดอื่น (ใบรับชำระที่ไม่ถูกยกเลิกก่อน: Dr ธนาคาร / Cr 11-2103) = ปฏิเสธทั้งรายการ ระบุเลขที่', async () => {
    const orphanReceipt = {
      id: 'je-rc',
      entryNumber: 'JE-0007',
      metadata: { tag: 'receipt', flow: 'payment-receipt', contractId: 'ct-1', paymentId: 'pay-2' },
      lines: [line('11-1201', 1515.83, 0), line('11-2103', 0, 1515.83)],
    };
    const { tpl, createAndPost } = setup([activation, orphanReceipt]);
    await expect(tpl.reverseContract('ct-1')).rejects.toThrow(BadRequestException);
    await expect(tpl.reverseContract('ct-1')).rejects.toThrow(/JE-0007/);
    expect(createAndPost).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/journal/defect-exchange-reversal-credit-flows.spec.ts`
Expected: FAIL — `DEFECT_EXCHANGE_CREDIT_OUT_FLOW` undefined / เทสเงินสด: createAndPost ถูกเรียก 2 ครั้ง

- [ ] **Step 3: แก้ template**

เพิ่ม import `BadRequestException` จาก `@nestjs/common` และค่าคงที่ใต้ `PAYMENT_FLOWS`:

```ts
/** flow ของรายการย้ายเครดิตตอนเปลี่ยนเครื่องตำหนิ (15ข) — ผู้กวาดรายการตามสัญญาต้องข้าม */
export const DEFECT_EXCHANGE_CREDIT_OUT_FLOW = 'defect-exchange-credit-out';
export const DEFECT_EXCHANGE_CREDIT_IN_FLOW = 'defect-exchange-credit-in';
const CREDIT_TRANSFER_FLOWS: readonly string[] = [DEFECT_EXCHANGE_CREDIT_OUT_FLOW, DEFECT_EXCHANGE_CREDIT_IN_FLOW];

/** บัญชีเงินสด/ธนาคารของ FINANCE — รายการที่แตะบัญชีกลุ่มนี้ห้ามถูก mirror (เงินจริงไม่ได้ออก) */
export const CASH_ACCOUNT_PREFIXES = ['11-11', '11-12'] as const;
/** บัญชีเงินของลูกค้า + ภาษีที่พักคู่กัน — รายการเงินสดที่คู่อยู่ในกลุ่มนี้ล้วน = เงินลูกค้าที่ขั้น ข ของเปลี่ยนเครื่องจะย้ายออกเอง */
export const CUSTOMER_MONEY_ACCOUNTS = ['21-1103', '21-5101', '21-2101', '21-2102'] as const;

const isCashAccount = (code: string) => CASH_ACCOUNT_PREFIXES.some((p) => code.startsWith(p));
```

ในลูป `for (const je of originalJes)` หลังบล็อก `if (PAYMENT_FLOWS.includes(flow)) { … continue; }` เพิ่ม:

```ts
      // 15ข: การย้ายเครดิตของเปลี่ยนเครื่อง (ขั้น ข/ง) ไม่ใช่รายการของสัญญาที่ต้องถอน — mirror = เครดิตหาย/ซ้ำ
      if (CREDIT_TRANSFER_FLOWS.includes(flow)) {
        this.logger.log(`[A.5a] DefectExchangeReversal — JE ${je.entryNumber} is a credit transfer (${flow}), skipping`);
        continue;
      }
      // 15ข: รายการที่แตะเงินสด/ธนาคาร — mirror จะทำให้เงินออกจากธนาคารทั้งที่ไม่มีการคืนเงินจริง.
      //   คู่เป็นเงินของลูกค้าล้วน (จ่ายเกิน → 21-5101 · ส่วนเกินลิงก์ชำระ → 21-1103 + ภาษีพัก) = ข้าม:
      //   ขั้น ข ของเปลี่ยนเครื่องอ่านยอด 21-1103/21-5101 ในบัญชีแล้วย้ายเป็นเครดิตเอง.
      //   คู่เป็นอย่างอื่น (เช่น ใบรับชำระที่ไม่มีใบเสร็จจึงไม่ถูกยกเลิกในขั้น ก) = ปฏิเสธ ไม่เดา.
      const cashLines = je.lines.filter((l) => isCashAccount(l.accountCode));
      if (cashLines.length > 0) {
        const others = je.lines.filter((l) => !isCashAccount(l.accountCode));
        const customerMoneyOnly = others.every((l) =>
          (CUSTOMER_MONEY_ACCOUNTS as readonly string[]).includes(l.accountCode),
        );
        if (customerMoneyOnly) {
          this.logger.log(
            `[A.5a] DefectExchangeReversal — JE ${je.entryNumber} is customer money (cash ↔ 21-1103/21-5101), left for the credit transfer`,
          );
          continue;
        }
        throw new BadRequestException(
          `รายการบัญชี ${je.entryNumber} ของสัญญา ${contract.contractNumber} มีขาเงินสด/ธนาคารที่ระบบกลับรายการให้ไม่ได้ ` +
            '(เช่น ใบรับชำระที่ยังไม่มีใบเสร็จ) — ให้ฝ่ายบัญชีตรวจรายการนี้ก่อนเปลี่ยนเครื่อง',
        );
      }
```

- [ ] **Step 4: รันให้ผ่าน + spec เดิมของ template**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/journal/defect-exchange-reversal-credit-flows.spec.ts src/modules/journal/defect-exchange-reversal-skip.spec.ts`
Expected: PASS ทั้ง 2 (spec เดิม: ใบรับชำระที่ `reversed: true` ยังถูกข้ามก่อนถึงด่านเงินสด — ลำดับ `reversed` check มาก่อน)

- [ ] **Step 5: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && git add apps/api/src/modules/journal/cpa-templates/defect-exchange-reversal.template.ts apps/api/src/modules/journal/defect-exchange-reversal-credit-flows.spec.ts && git commit -q -F - <<'MSG'
feat(journal): reverseContract ข้าม flow ย้ายเครดิต + รายการเงินสดของลูกค้า · ปฏิเสธรายการเงินสดอื่น (15ข)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

### Task 4: ตัวช่วยของเปลี่ยนเครื่อง — ค่าคงที่ · บรรทัด JE ข/ง · เลือกใบ · ด่านเงิน

**Files:**
- Create: `apps/api/src/modules/defect-exchange/defect-exchange-credit.ts`
- Modify: `apps/api/src/modules/journal/contract-close-advances.ts:31` (`ContractCloseFlow` เพิ่ม `'defect-exchange'`)
- Test: `apps/api/src/modules/defect-exchange/defect-exchange-credit.spec.ts` (ใหม่ — jest)

**Interfaces:**
- Consumes: `DEFECT_EXCHANGE_CREDIT_OUT_FLOW` / `DEFECT_EXCHANGE_CREDIT_IN_FLOW` (Task 3) · `ReceiptVoidRedirect` (Task 1) · `buildAdvanceVatConsumeLines`, `ADVANCE_VAT_META`, `AdvanceVatLine` (`journal/advance-vat.ts`) · `findActiveAdvanceExcessIncome` (`journal/advance-excess-income.util.ts`)
- Produces (ทั้งหมด export): `DEFECT_EXCHANGE_CN_SOURCE = 'DEFECT_EXCHANGE'` · `DEFECT_EXCHANGE_SUSPENSE_ACCOUNT = '21-1106'` · `DEFECT_EXCHANGE_TAG = 'DEFECT_EXCHANGE'` · `DEFECT_EXCHANGE_REDIRECT: ReceiptVoidRedirect` · `EXCHANGE_SKIPPED_RECEIPT_TYPES` · `EXCHANGE_BLOCK_*` ข้อความ 5 ตัว · `EXCHANGE_RECEIPT_SELECT` + `type ExchangeReceiptRow` · `listReceiptsToCreditNote(client, contractId): Promise<ExchangeReceiptRow[]>` · `sumReceiptAmounts(rows): Decimal` · `hasRescheduleHistory(client, contract): Promise<boolean>` · `exchangeMoneyBlockers(client, contract): Promise<string[]>` · `buildCreditOutLines(advance, credit, vat): AdvanceVatLine[]` · `buildCreditInLines(total): AdvanceVatLine[]` · `creditInAmountOf(client, contractId): Promise<Decimal>`

- [ ] **Step 1: เขียนเทสที่ล้ม**

```ts
// apps/api/src/modules/defect-exchange/defect-exchange-credit.spec.ts
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as excess from '../journal/advance-excess-income.util';
import {
  buildCreditInLines,
  buildCreditOutLines,
  creditInAmountOf,
  DEFECT_EXCHANGE_REDIRECT,
  EXCHANGE_BLOCK_EARLY_PAYOFF,
  EXCHANGE_BLOCK_EXCESS_INCOME,
  EXCHANGE_BLOCK_ORPHAN_CN,
  EXCHANGE_BLOCK_PENDING_VOID,
  EXCHANGE_BLOCK_RESCHEDULED,
  EXCHANGE_SKIPPED_RECEIPT_TYPES,
  exchangeMoneyBlockers,
  hasRescheduleHistory,
  listReceiptsToCreditNote,
  sumReceiptAmounts,
} from './defect-exchange-credit';

const D = (n: string | number) => new Decimal(n);
const fmt = (l: { accountCode: string; dr: Decimal; cr: Decimal }) => `${l.accountCode}:${l.dr.toFixed(2)}:${l.cr.toFixed(2)}`;

describe('บรรทัด JE ของการย้ายเครดิต (spec §3 ข/ง)', () => {
  it('ข: Dr 21-1103 a · Dr 21-5101 c · Dr 21-2101 p / Cr 21-1106 a+c · Cr 21-2102 p — บรรทัด 0 ไม่ออก', () => {
    expect(buildCreditOutLines(D(500), D(300), D('52.34')).map(fmt)).toEqual([
      '21-1103:500.00:0.00',
      '21-5101:300.00:0.00',
      '21-2101:52.34:0.00',
      '21-1106:0.00:800.00',
      '21-2102:0.00:52.34',
    ]);
    expect(buildCreditOutLines(D(0), D(300), D(0)).map(fmt)).toEqual(['21-5101:300.00:0.00', '21-1106:0.00:300.00']);
    expect(buildCreditOutLines(D(0), D(0), D(0))).toEqual([]);
  });

  it('ง: Dr 21-1106 T / Cr 21-5101 T — T ≤ 0 ไม่มีบรรทัด', () => {
    expect(buildCreditInLines(D('1515.83')).map(fmt)).toEqual(['21-1106:1515.83:0.00', '21-5101:0.00:1515.83']);
    expect(buildCreditInLines(D(0))).toEqual([]);
  });

  it('redirect ของขั้น ก: เงินสด/ธนาคาร → 21-1106', () => {
    expect(DEFECT_EXCHANGE_REDIRECT).toEqual({
      accountPrefixes: ['11-11', '11-12'],
      to: '21-1106',
      description: 'โอนเป็นเครดิตเปลี่ยนเครื่อง',
    });
  });
});

describe('เลือกใบที่ต้องออกใบลดหนี้', () => {
  it('exclude-list: CREDIT_NOTE / EARLY_PAYOFF / RESCHEDULE_FEE / DOWN_PAYMENT ไม่ถูกเลือก · เรียง paidDate แล้ว receiptNumber', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await listReceiptsToCreditNote({ receipt: { findMany } } as never, 'ct-old');
    expect(findMany).toHaveBeenCalledWith({
      where: {
        contractId: 'ct-old',
        isVoided: false,
        deletedAt: null,
        receiptType: { notIn: [...EXCHANGE_SKIPPED_RECEIPT_TYPES] },
      },
      orderBy: [{ paidDate: 'asc' }, { receiptNumber: 'asc' }],
      select: expect.objectContaining({ id: true, receiptNumber: true, amount: true, vatAmount: true }),
    });
  });

  it('sumReceiptAmounts รวม Decimal', () => {
    expect(sumReceiptAmounts([{ amount: new Prisma.Decimal('1515.83') }, { amount: new Prisma.Decimal('1000') }]).toFixed(2)).toBe('2515.83');
  });
});

describe('hasRescheduleHistory', () => {
  const client = (opts: { feeCount?: number; entries?: unknown[] }) =>
    ({
      receipt: { count: jest.fn().mockResolvedValue(opts.feeCount ?? 0) },
      journalEntry: { findMany: jest.fn().mockResolvedValue(opts.entries ?? []) },
    }) as never;

  it('ถังพัก > 0 = เคยปรับดิว (ไม่ต้องอ่านฐาน)', async () => {
    expect(await hasRescheduleHistory(client({}), { id: 'c', rescheduleAdvanceBalance: new Prisma.Decimal('1') })).toBe(true);
  });
  it('ใบ RESCHEDULE_FEE ที่ยังมีผล = เคยปรับดิว', async () => {
    expect(await hasRescheduleHistory(client({ feeCount: 1 }), { id: 'c', rescheduleAdvanceBalance: 0 })).toBe(true);
  });
  it.each([
    [{ tag: '6b', flow: 'reschedule-bundled' }],
    [{ tag: '2A', flow: 'reschedule-park-consume' }],
    [{ flow: 'reschedule-collect' }],
  ])('JE %j ที่ยังมีผล = เคยปรับดิว · reversed = ไม่นับ', async (meta) => {
    expect(await hasRescheduleHistory(client({ entries: [{ metadata: { ...meta, contractId: 'c' } }] }), { id: 'c', rescheduleAdvanceBalance: 0 })).toBe(true);
    expect(await hasRescheduleHistory(client({ entries: [{ metadata: { ...meta, contractId: 'c', reversed: true } }] }), { id: 'c', rescheduleAdvanceBalance: 0 })).toBe(false);
  });
  it('ไม่มีร่องรอย = false', async () => {
    expect(await hasRescheduleHistory(client({ entries: [{ metadata: { tag: '1A', contractId: 'c' } }] }), { id: 'c', rescheduleAdvanceBalance: 0 })).toBe(false);
  });
});

describe('exchangeMoneyBlockers — เหตุผลปฏิเสธด้านเงิน (spec §5)', () => {
  afterEach(() => jest.restoreAllMocks());
  const client = (opts: {
    feeCount?: number;
    earlyPayoffCount?: number;
    orphanCn?: number;
    pendingVoid?: boolean;
    entries?: unknown[];
  }) =>
    ({
      receipt: {
        count: jest.fn(({ where }: { where: { receiptType: string | { in: string[] } } }) => {
          if (where.receiptType === 'RESCHEDULE_FEE') return Promise.resolve(opts.feeCount ?? 0);
          if (where.receiptType === 'EARLY_PAYOFF') return Promise.resolve(opts.earlyPayoffCount ?? 0);
          if (where.receiptType === 'CREDIT_NOTE') return Promise.resolve(opts.orphanCn ?? 0);
          return Promise.resolve(0);
        }),
      },
      journalEntry: { findMany: jest.fn().mockResolvedValue(opts.entries ?? []) },
      paymentApprovalRequest: { findFirst: jest.fn().mockResolvedValue(opts.pendingVoid ? { id: 'req-1' } : null) },
    }) as never;
  const contract = { id: 'ct-old', rescheduleAdvanceBalance: 0 };

  it('สะอาด = []', async () => {
    jest.spyOn(excess, 'findActiveAdvanceExcessIncome').mockResolvedValue([]);
    expect(await exchangeMoneyBlockers(client({}), contract)).toEqual([]);
  });
  it('ทุกเหตุผลรายงานพร้อมกัน เรียง: ปรับดิว · 42-1106 · คำขอ void · ปิดยอด · ใบลดหนี้กำพร้า', async () => {
    jest.spyOn(excess, 'findActiveAdvanceExcessIncome').mockResolvedValue([{ id: 'je-aei' } as never]);
    expect(
      await exchangeMoneyBlockers(client({ feeCount: 1, pendingVoid: true, earlyPayoffCount: 1, orphanCn: 1 }), contract),
    ).toEqual([
      EXCHANGE_BLOCK_RESCHEDULED,
      EXCHANGE_BLOCK_EXCESS_INCOME,
      EXCHANGE_BLOCK_PENDING_VOID,
      EXCHANGE_BLOCK_EARLY_PAYOFF,
      EXCHANGE_BLOCK_ORPHAN_CN,
    ]);
  });
  it('คำขอ void ค้าง: ค้น paymentApprovalRequest action VOID_RECEIPT status PENDING ของสัญญา', async () => {
    jest.spyOn(excess, 'findActiveAdvanceExcessIncome').mockResolvedValue([]);
    const c = client({ pendingVoid: true });
    await exchangeMoneyBlockers(c, contract);
    expect((c as never as { paymentApprovalRequest: { findFirst: jest.Mock } }).paymentApprovalRequest.findFirst).toHaveBeenCalledWith({
      where: { contractId: 'ct-old', action: 'VOID_RECEIPT', status: 'PENDING', deletedAt: null },
      select: { id: true },
    });
  });
});

describe('creditInAmountOf — ยอด credit-in ของสัญญาที่เป็นลูกของการเปลี่ยนเครื่องครั้งก่อน', () => {
  it('Σ metadata.amount ของ JE flow defect-exchange-credit-in ที่ยังมีผล (ข้าม reversed) · ไม่มี = 0', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { metadata: { flow: 'defect-exchange-credit-in', amount: '1515.83' } },
      { metadata: { flow: 'defect-exchange-credit-in', amount: '100.00', reversed: true } },
      { metadata: { flow: 'defect-exchange-credit-out', amount: '999' } },
    ]);
    expect((await creditInAmountOf({ journalEntry: { findMany } } as never, 'ct-b')).toFixed(2)).toBe('1515.83');
    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'POSTED', deletedAt: null, metadata: { path: ['contractId'], equals: 'ct-b' } },
      select: { metadata: true },
    });
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/defect-exchange/defect-exchange-credit.spec.ts`
Expected: FAIL — `Cannot find module './defect-exchange-credit'`

- [ ] **Step 3: เขียน helper + ขยาย `ContractCloseFlow`**

ใน `journal/contract-close-advances.ts` L31: `export type ContractCloseFlow = 'repossession' | 'write-off' | 'early-payoff' | 'excess-income' | 'defect-exchange';` (docblock เพิ่ม: `'defect-exchange'` = ขั้น ข ของเปลี่ยนเครื่องตำหนิ — ล้างทั้ง `.advance` และ `.credit` เข้า 21-1106)

```ts
// apps/api/src/modules/defect-exchange/defect-exchange-credit.ts
import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { ReceiptVoidRedirect } from '../journal/cpa-templates/receipt-void-reversal.template';
import {
  DEFECT_EXCHANGE_CREDIT_IN_FLOW,
  DEFECT_EXCHANGE_CREDIT_OUT_FLOW,
} from '../journal/cpa-templates/defect-exchange-reversal.template';
import { buildAdvanceVatConsumeLines, type AdvanceVatLine } from '../journal/advance-vat';
import { findActiveAdvanceExcessIncome } from '../journal/advance-excess-income.util';

type Client = Prisma.TransactionClient | PrismaClient;
const ZERO = new Decimal(0);

/** `Receipt.cnSource` ของใบลดหนี้ที่ออกตอนเปลี่ยนเครื่องตำหนิ (คู่กับ REPOSSESSION / WRITE_OFF ของ CreditNoteDocumentService) */
export const DEFECT_EXCHANGE_CN_SOURCE = 'DEFECT_EXCHANGE';
/** บัญชีพักเครดิตเปลี่ยนเครื่อง (ผังแถว 53) — สุทธิ 0 ทุกครั้ง: Cr สัญญาเดิม = Dr สัญญาใหม่ */
export const DEFECT_EXCHANGE_SUSPENSE_ACCOUNT = '21-1106';
export const DEFECT_EXCHANGE_TAG = 'DEFECT_EXCHANGE';
export { DEFECT_EXCHANGE_CREDIT_IN_FLOW, DEFECT_EXCHANGE_CREDIT_OUT_FLOW };

/** ขั้น ก: กระจกรับชำระย้ายขาเงินสด/ธนาคารไปบัญชีพัก — ธนาคารไม่ขยับ (เจ้าของ 17/10/2569 แนวทาง B) */
export const DEFECT_EXCHANGE_REDIRECT: ReceiptVoidRedirect = {
  accountPrefixes: ['11-11', '11-12'],
  to: DEFECT_EXCHANGE_SUSPENSE_ACCOUNT,
  description: 'โอนเป็นเครดิตเปลี่ยนเครื่อง',
};

/** ใบที่ **ไม่** ออกใบลดหนี้ตอนเปลี่ยนเครื่อง (exclude-list — ครอบ INSTALLMENT/PAYMENT วันนี้ และ ADVANCE_SURPLUS ของ #1703) */
export const EXCHANGE_SKIPPED_RECEIPT_TYPES = ['CREDIT_NOTE', 'EARLY_PAYOFF', 'RESCHEDULE_FEE', 'DOWN_PAYMENT'] as const;

/** ร่องรอยการปรับดิวในสมุดบัญชี — `RescheduleJP6Template` (6a/6b) · `reschedule-collect.service` · 2A หักถังพัก */
export const RESCHEDULE_JE_TAGS: readonly string[] = ['6a', '6b'];
export const RESCHEDULE_JE_FLOWS: readonly string[] = [
  'reschedule-fee',
  'reschedule-bundled',
  'reschedule-final',
  'reschedule-collect',
  'reschedule-park-consume',
];

export const EXCHANGE_BLOCK_RESCHEDULED =
  'สัญญาเดิมมีการเลื่อนนัดชำระ — เปลี่ยนเครื่องผ่านระบบไม่ได้ ติดต่อผู้ดูแลระบบ';
export const EXCHANGE_BLOCK_EXCESS_INCOME =
  'สัญญาเดิมลงรายได้เงินพักส่วนเกิน (42-1106) แล้ว — ต้องให้ผู้ดูแลระบบกลับรายการกวาดก่อน (คำสั่ง advance-excess:reverse)';
export const EXCHANGE_BLOCK_PENDING_VOID =
  'มีคำขอยกเลิกใบเสร็จของสัญญาเดิมค้างอยู่ในคิวอนุมัติ — อนุมัติ/ปฏิเสธคำขอนั้นก่อน';
export const EXCHANGE_BLOCK_EARLY_PAYOFF = 'สัญญาเดิมมีใบเสร็จปิดยอดก่อนกำหนด — เปลี่ยนเครื่องไม่ได้';
export const EXCHANGE_BLOCK_ORPHAN_CN =
  'สัญญาเดิมมีใบลดหนี้ที่ไม่มีใบต้นทาง (ข้อมูลผิดปกติ) — ให้ฝ่ายบัญชีตรวจก่อน';

export const EXCHANGE_RECEIPT_SELECT = {
  id: true,
  receiptNumber: true,
  receiptType: true,
  installmentNo: true,
  paidDate: true,
  paymentMethod: true,
  amount: true,
  vatAmount: true,
} as const;
export type ExchangeReceiptRow = Prisma.ReceiptGetPayload<{ select: typeof EXCHANGE_RECEIPT_SELECT }>;

/** ใบรับเงินของสัญญาเดิมที่ยังมีผล เรียงตามวันรับเงิน (spec §3 ก) */
export function listReceiptsToCreditNote(client: Client, contractId: string): Promise<ExchangeReceiptRow[]> {
  return client.receipt.findMany({
    where: {
      contractId,
      isVoided: false,
      deletedAt: null,
      receiptType: { notIn: [...EXCHANGE_SKIPPED_RECEIPT_TYPES] },
    },
    orderBy: [{ paidDate: 'asc' }, { receiptNumber: 'asc' }],
    select: EXCHANGE_RECEIPT_SELECT,
  });
}

export function sumReceiptAmounts(rows: readonly { amount: Prisma.Decimal | string | number }[]): Decimal {
  return rows.reduce((s, r) => s.plus(r.amount.toString()), ZERO);
}

const metaOf = (row: { metadata: unknown }): Record<string, unknown> =>
  row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? (row.metadata as Record<string, unknown>)
    : {};

async function activeEntriesOf(client: Client, contractId: string): Promise<Record<string, unknown>[]> {
  const rows = await client.journalEntry.findMany({
    where: { status: 'POSTED', deletedAt: null, metadata: { path: ['contractId'], equals: contractId } },
    select: { metadata: true },
  });
  return rows.map(metaOf).filter((m) => m.reversed !== true);
}

/** สัญญาเดิมเคยปรับดิว (6a แยกใบ / 6b รวมค่างวด) — predicate เดียวของด่าน (spec §5) */
export async function hasRescheduleHistory(
  client: Client,
  contract: { id: string; rescheduleAdvanceBalance?: Prisma.Decimal | string | number | null },
): Promise<boolean> {
  if (new Decimal((contract.rescheduleAdvanceBalance ?? 0).toString()).gt(0)) return true;
  const fee = await client.receipt.count({
    where: { contractId: contract.id, receiptType: 'RESCHEDULE_FEE', isVoided: false, deletedAt: null },
  });
  if (fee > 0) return true;
  const entries = await activeEntriesOf(client, contract.id);
  return entries.some(
    (m) =>
      (typeof m.tag === 'string' && RESCHEDULE_JE_TAGS.includes(m.tag)) ||
      (typeof m.flow === 'string' && RESCHEDULE_JE_FLOWS.includes(m.flow)),
  );
}

/**
 * เหตุผลปฏิเสธด้านเงิน (spec §5) — ใช้ทั้ง `checkEligibility` (นอก tx) และ `execute` (ใน tx ทั้งทางปกติและ bypass).
 * คืนทุกเหตุผลที่พบ เรียงคงที่ — ว่าง = ผ่าน.
 */
export async function exchangeMoneyBlockers(
  client: Client,
  contract: { id: string; rescheduleAdvanceBalance?: Prisma.Decimal | string | number | null },
): Promise<string[]> {
  const out: string[] = [];
  if (await hasRescheduleHistory(client, contract)) out.push(EXCHANGE_BLOCK_RESCHEDULED);
  if ((await findActiveAdvanceExcessIncome(client, contract.id)).length > 0) out.push(EXCHANGE_BLOCK_EXCESS_INCOME);
  const pendingVoid = await client.paymentApprovalRequest.findFirst({
    where: { contractId: contract.id, action: 'VOID_RECEIPT', status: 'PENDING', deletedAt: null },
    select: { id: true },
  });
  if (pendingVoid) out.push(EXCHANGE_BLOCK_PENDING_VOID);
  const earlyPayoff = await client.receipt.count({
    where: { contractId: contract.id, receiptType: 'EARLY_PAYOFF', isVoided: false, deletedAt: null },
  });
  if (earlyPayoff > 0) out.push(EXCHANGE_BLOCK_EARLY_PAYOFF);
  const orphanCn = await client.receipt.count({
    where: { contractId: contract.id, receiptType: 'CREDIT_NOTE', voidedReceiptId: null, cnSource: null, deletedAt: null },
  });
  if (orphanCn > 0) out.push(EXCHANGE_BLOCK_ORPHAN_CN);
  return out;
}

/** ขั้น ข (spec §3): เงินของลูกค้าที่เหลือในสัญญาเดิม → บัญชีพัก + กลับภาษีที่พักไว้ (ถังหมด ⇒ ทั้งก้อน) */
export function buildCreditOutLines(advance: Decimal, credit: Decimal, vat: Decimal): AdvanceVatLine[] {
  const total = advance.plus(credit);
  if (!total.gt(0)) return [];
  const lines: AdvanceVatLine[] = [];
  if (advance.gt(0)) {
    lines.push({ accountCode: '21-1103', dr: advance, cr: ZERO, description: 'โอนเงินรับล่วงหน้าที่เหลือเป็นเครดิตเปลี่ยนเครื่อง' });
  }
  if (credit.gt(0)) {
    lines.push({ accountCode: '21-5101', dr: credit, cr: ZERO, description: 'โอนเครดิตที่เหลือเป็นเครดิตเปลี่ยนเครื่อง' });
  }
  const vatLines = buildAdvanceVatConsumeLines(vat);
  const vatDr = vatLines.filter((l) => l.dr.gt(0));
  const vatCr = vatLines.filter((l) => l.cr.gt(0));
  lines.push(...vatDr);
  lines.push({
    accountCode: DEFECT_EXCHANGE_SUSPENSE_ACCOUNT,
    dr: ZERO,
    cr: total,
    description: 'เงินของลูกค้ารอโอนเป็นเครดิตสัญญาใหม่ (เปลี่ยนเครื่องตำหนิ)',
  });
  lines.push(...vatCr);
  return lines;
}

/** ขั้น ง (spec §3): ตั้งเครดิตสัญญาใหม่ — ไม่ stamp ภาษี (spec §7) */
export function buildCreditInLines(total: Decimal): AdvanceVatLine[] {
  if (!total.gt(0)) return [];
  return [
    { accountCode: DEFECT_EXCHANGE_SUSPENSE_ACCOUNT, dr: total, cr: ZERO, description: 'รับโอนเครดิตจากสัญญาเดิม (เปลี่ยนเครื่องตำหนิ)' },
    { accountCode: '21-5101', dr: ZERO, cr: total, description: 'เครดิตจากการเปลี่ยนเครื่องตำหนิ — ใช้ชำระค่างวด' },
  ];
}

/**
 * ยอด credit-in ที่สัญญานี้รับไว้ (เมื่อสัญญานี้เป็นลูกของการเปลี่ยนเครื่องครั้งก่อน — Review Focus 2):
 * ใช้ตรวจทาน 21-1106 ตอนสัญญานี้ถูกเปลี่ยนเครื่องอีกครั้ง — Dr ของมันทำให้ยอด Cr สุทธิของ 21-1106 ต่ำกว่าเงินที่ย้ายจริง.
 */
export async function creditInAmountOf(client: Client, contractId: string): Promise<Decimal> {
  const entries = await activeEntriesOf(client, contractId);
  return entries
    .filter((m) => m.flow === DEFECT_EXCHANGE_CREDIT_IN_FLOW)
    .reduce((s, m) => s.plus(typeof m.amount === 'string' || typeof m.amount === 'number' ? new Decimal(m.amount) : ZERO), ZERO);
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/defect-exchange/defect-exchange-credit.spec.ts && cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && ./tools/check-types.sh api`
Expected: PASS · 0 type errors

- [ ] **Step 5: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && git add apps/api/src/modules/defect-exchange/defect-exchange-credit.ts apps/api/src/modules/defect-exchange/defect-exchange-credit.spec.ts apps/api/src/modules/journal/contract-close-advances.ts && git commit -q -F - <<'MSG'
feat(defect-exchange): ตัวช่วยเครดิตเปลี่ยนเครื่อง — บรรทัด JE ข/ง · เลือกใบ · ด่านเงิน (15ข)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 5: `checkEligibility` รายงานใบ/เครดิตที่จะย้าย + ด่านเงิน · ต่อสาย DI

**Files:**
- Modify: `apps/api/src/modules/defect-exchange/defect-exchange.service.ts` (ctor L33–38 · `checkEligibility` L45–138)
- Modify: `apps/api/src/modules/defect-exchange/defect-exchange.module.ts` (providers)
- Modify: `apps/api/src/modules/defect-exchange/defect-exchange.service.spec.ts:168-174` (providers ของ TestingModule)
- Modify: `apps/api/src/modules/after-sales/__tests__/after-sales-exchange.integration.spec.ts:129` · `after-sales-cash-exchange.integration.spec.ts:119` (construct 6 อาร์กิวเมนต์)
- Test: `apps/api/src/modules/defect-exchange/defect-exchange.credit-guards.spec.ts` (ใหม่ — jest)

**Interfaces:**
- Consumes: Task 4 helpers · `glContractBalance` · `ReceiptVoidReversalTemplate` (export จาก JournalModule) · `ReceiptNumberService` (`receipts/services/receipt-number.service.ts` — ctor `(prisma)`)
- Produces: `new DefectExchangeService(prisma, journalAutoService, defectExchangeReversalTemplate, repairTickets, receiptVoidReversal, receiptNumbers)` · `checkEligibility()` คืนเพิ่ม `receiptsToCreditNote: { id; receiptNumber; receiptType; installmentNo; paidDate: string; paymentMethod; amount: string; vatAmount: string | null }[]` · `creditToTransfer: string` (2dp) · `ledgerAdvance: string` · `ledgerCredit: string` · `reasons` รวมเหตุผลจาก `exchangeMoneyBlockers`

- [ ] **Step 1: เขียนเทสที่ล้ม**

```ts
// apps/api/src/modules/defect-exchange/defect-exchange.credit-guards.spec.ts
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { DefectExchangeService } from './defect-exchange.service';
import * as credit from './defect-exchange-credit';
import * as gl from '../journal/gl-contract-balance';

jest.mock('../../utils/sequence.util', () => ({ generateContractNumber: jest.fn().mockResolvedValue('CT-NEW-0001') }));

const D = (n: string | number) => new Decimal(n);
const fmt = (l: { accountCode: string; dr: Decimal; cr: Decimal }) => `${l.accountCode}:${l.dr.toFixed(2)}:${l.cr.toFixed(2)}`;

function makeService(prisma: Record<string, unknown>) {
  return new DefectExchangeService(
    prisma as never,
    { createAndPost: jest.fn() } as never,
    { reverseContract: jest.fn() } as never,
    { markReplaced: jest.fn() } as never,
    { voidReceipt: jest.fn(), voidAccrualPostedAtReceipt: jest.fn() } as never,
    { generateReceiptNumber: jest.fn() } as never,
  );
}

const oldProduct = { id: 'p-old', brand: 'Apple', model: 'iPhone 14', storage: '128GB', category: 'PHONE_USED', imeiSerial: '1', supplierId: null, stockInDate: null, shopWarrantyDays: null };
const contract = {
  id: 'ct-old', contractNumber: 'CT-OLD', status: 'ACTIVE', deletedAt: null, tradeInCreditSnapshot: null,
  deviceReceivedAt: new Date(), shopWarrantyStartDate: null, createdAt: new Date(),
  rescheduleAdvanceBalance: new Prisma.Decimal(0), product: oldProduct,
  payments: [{ amountPaid: new Prisma.Decimal('1515.83') }],
};

describe('checkEligibility — ใบ/เครดิตที่จะย้าย + ด่านเงิน (15ข)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('รายงาน receiptsToCreditNote และ creditToTransfer = Σ ใบ + 21-1103 + 21-5101 ในบัญชี', async () => {
    jest.spyOn(credit, 'exchangeMoneyBlockers').mockResolvedValue([]);
    jest.spyOn(credit, 'listReceiptsToCreditNote').mockResolvedValue([
      { id: 'rc-1', receiptNumber: 'RT-31', receiptType: 'INSTALLMENT', installmentNo: 1, paidDate: new Date('2026-10-10T00:00:00Z'), paymentMethod: 'BANK_TRANSFER', amount: new Prisma.Decimal('1515.83'), vatAmount: new Prisma.Decimal('99.17') },
    ]);
    jest.spyOn(gl, 'glContractBalance').mockImplementation(async (_c, _id, code) => (code === '21-5101' ? D(300) : D(0)));
    const prisma = { contract: { findUnique: jest.fn().mockResolvedValue(contract) }, product: { findUnique: jest.fn() } };
    const out = await makeService(prisma).checkEligibility('ct-old');
    expect(out.eligible).toBe(true);
    expect(out.receiptsToCreditNote).toEqual([
      { id: 'rc-1', receiptNumber: 'RT-31', receiptType: 'INSTALLMENT', installmentNo: 1, paidDate: '2026-10-10T00:00:00.000Z', paymentMethod: 'BANK_TRANSFER', amount: '1515.83', vatAmount: '99.17' },
    ]);
    expect(out.creditToTransfer).toBe('1815.83');
    expect(out.ledgerAdvance).toBe('0.00');
    expect(out.ledgerCredit).toBe('300.00');
    expect(out.oldContract.paidAmount).toBe(1515.83);
  });

  it('เหตุผลด้านเงินถูกต่อท้าย reasons → eligible=false (ไม่ใช่เหตุผลกรอบ 7 วัน)', async () => {
    jest.spyOn(credit, 'exchangeMoneyBlockers').mockResolvedValue([credit.EXCHANGE_BLOCK_RESCHEDULED]);
    jest.spyOn(credit, 'listReceiptsToCreditNote').mockResolvedValue([]);
    jest.spyOn(gl, 'glContractBalance').mockResolvedValue(D(0));
    const prisma = { contract: { findUnique: jest.fn().mockResolvedValue(contract) }, product: { findUnique: jest.fn() } };
    const out = await makeService(prisma).checkEligibility('ct-old');
    expect(out.eligible).toBe(false);
    expect(out.reasons).toEqual([credit.EXCHANGE_BLOCK_RESCHEDULED]);
    expect(out.creditToTransfer).toBe('0.00');
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/defect-exchange/defect-exchange.credit-guards.spec.ts`
Expected: FAIL — `receiptsToCreditNote` undefined (และ TS: ctor รับ 4 อาร์กิวเมนต์)

- [ ] **Step 3: แก้ service + module**

`defect-exchange.service.ts` — imports เพิ่ม:

```ts
import { ReceiptVoidReversalTemplate } from '../journal/cpa-templates/receipt-void-reversal.template';
import { ReceiptNumberService } from '../receipts/services/receipt-number.service';
import { glContractBalance } from '../journal/gl-contract-balance';
import { exchangeMoneyBlockers, listReceiptsToCreditNote, sumReceiptAmounts } from './defect-exchange-credit';
```

ctor:

```ts
  constructor(
    private prisma: PrismaService,
    private journalAutoService: JournalAutoService,
    private defectExchangeReversalTemplate: DefectExchangeReversalTemplate,
    private repairTickets: RepairTicketsService,
    /** 15ข — กระจกรับชำระ (redirect ขาเงินสด → 21-1106) + กลับ 2A ที่ลง ณ วันรับเงิน · export จาก JournalModule */
    private receiptVoidReversal: ReceiptVoidReversalTemplate,
    /** 15ข — เลขที่ใบลดหนี้ (advisory lock เดียวกับใบเสร็จ) · provide ตรงใน DefectExchangeModule (ReceiptsModule ไม่ export) */
    private receiptNumbers: ReceiptNumberService,
  ) {}
```

ใน `checkEligibility` หลังบล็อก `if (now > windowEnd) { reasons.push(…) }` เพิ่ม:

```ts
    // 15ข — ด่านเงิน (spec §5): ปรับดิว / กวาด 42-1106 / คำขอ void ค้าง / ปิดยอด / ใบลดหนี้กำพร้า — เหตุผลเหล่านี้
    // ไม่ใช่เหตุผลกรอบ 7 วัน ⇒ หลังการขายบล็อกเสมอแม้ ผจก. ข้ามกรอบ (WINDOW_REASON_RE ไม่จับ)
    reasons.push(...(await exchangeMoneyBlockers(this.prisma, contract)));
    // 15ข — ใบรับเงินที่จะออกใบลดหนี้ + เงินของลูกค้าที่ค้างในบัญชี → เครดิตที่จะย้ายไปสัญญาใหม่ (กล่องยืนยันหลังการขาย)
    const receiptsToCreditNote = await listReceiptsToCreditNote(this.prisma, contract.id);
    const ledgerAdvance = Decimal.max(0, await glContractBalance(this.prisma, contract.id, '21-1103', 'cr'));
    const ledgerCredit = Decimal.max(0, await glContractBalance(this.prisma, contract.id, '21-5101', 'cr'));
    const creditToTransfer = sumReceiptAmounts(receiptsToCreditNote).plus(ledgerAdvance).plus(ledgerCredit);
```

และใน `return { … }` ของ `checkEligibility` เพิ่มหลัง `supplierClaimEligible,`:

```ts
      receiptsToCreditNote: receiptsToCreditNote.map((r) => ({
        id: r.id,
        receiptNumber: r.receiptNumber,
        receiptType: r.receiptType,
        installmentNo: r.installmentNo,
        paidDate: r.paidDate.toISOString(),
        paymentMethod: r.paymentMethod,
        amount: new Decimal(r.amount.toString()).toFixed(2),
        vatAmount: r.vatAmount == null ? null : new Decimal(r.vatAmount.toString()).toFixed(2),
      })),
      creditToTransfer: creditToTransfer.toFixed(2),
      ledgerAdvance: ledgerAdvance.toFixed(2),
      ledgerCredit: ledgerCredit.toFixed(2),
```

`defect-exchange.module.ts`: `import { ReceiptNumberService } from '../receipts/services/receipt-number.service';` และเพิ่ม `ReceiptNumberService` ใน `providers` (คง `imports: [JournalModule, RepairTicketsModule]` — `ReceiptVoidReversalTemplate` มาจาก JournalModule)

`defect-exchange.service.spec.ts` L168–174 providers เพิ่ม 2 แถว (import ทั้งสอง class ที่หัวไฟล์):

```ts
        { provide: ReceiptVoidReversalTemplate, useValue: { voidReceipt: jest.fn(), voidAccrualPostedAtReceipt: jest.fn() } },
        { provide: ReceiptNumberService, useValue: { generateReceiptNumber: jest.fn().mockResolvedValue('RT-TEST') } },
```

after-sales harness 2 ไฟล์ — บรรทัด `const defect = new DefectExchangeService(prisma as never, journal, defectReversal, repairTickets);` →

```ts
const defect = new DefectExchangeService(
  prisma as never,
  journal,
  defectReversal,
  repairTickets,
  new ReceiptVoidReversalTemplate(journal, prisma as never),
  new ReceiptNumberService(prisma as never),
);
```

+ imports `import { ReceiptVoidReversalTemplate } from '../../journal/cpa-templates/receipt-void-reversal.template';` `import { ReceiptNumberService } from '../../receipts/services/receipt-number.service';`

- [ ] **Step 4: รันให้ผ่าน + spec เดิม + types**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/defect-exchange/ && cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && ./tools/check-types.sh api`
Expected: PASS ทั้งโฟลเดอร์ (spec เดิมยังผ่าน — `checkEligibility` ของมัน mock `prisma.contract.findUnique` และตอนนี้เรียก helper จริงบน prisma mock: ถ้าเทสเดิมล้มที่ `prisma.receipt`/`journalEntry` undefined ให้เพิ่ม `jest.mock('./defect-exchange-credit', …)` ในไฟล์เดิมตามแบบ Task 6 Step 3 แล้วค่อยไปต่อ) · 0 type errors

- [ ] **Step 5: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && git add apps/api/src/modules/defect-exchange apps/api/src/modules/after-sales/__tests__/after-sales-exchange.integration.spec.ts apps/api/src/modules/after-sales/__tests__/after-sales-cash-exchange.integration.spec.ts && git commit -q -F - <<'MSG'
feat(defect-exchange): checkEligibility รายงานใบที่จะออกใบลดหนี้ + เครดิตที่จะย้าย + ด่านเงิน · ต่อสาย ReceiptVoidReversal/ReceiptNumber (15ข)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 6: `execute` — ถอดด่าน C-6 · ขั้น ก/ค/ข/ง · ส่งสัญญาณหลัง commit

**Files:**
- Modify: `apps/api/src/modules/defect-exchange/defect-exchange.service.ts` (`execute` L146–456 ทั้งเมธอด)
- Modify: `apps/api/src/modules/defect-exchange/defect-exchange.service.spec.ts` (ลบ/แก้เทส C-6 + เพิ่ม mock)
- Test: เพิ่มเคสใน `defect-exchange.credit-guards.spec.ts`

**Interfaces:**
- Consumes: `voidReceiptInTx`, `storedTaxColumnsOf` (Task 2) · Task 4 helpers · `readContractCloseAdvances`, `CONTRACT_ADVANCE_COLUMNS_CLEARED` · `advanceVatOutstanding`, `ADVANCE_VAT_META` · `glContractBalance` · `emitDeferredWarnings`, `DeferredWarning` · `validatePeriodOpen`
- Produces: `execute()` คืนเพิ่ม `creditNoteNumbers: string[]`, `voidedReceiptNumbers: string[]`, `transferredCredit: string` (2dp), `creditOutEntryNo: string | null`, `creditInEntryNo: string | null` · `newContract.creditBalance: number` = T · audit `DEFECT_EXCHANGE.newValue` เพิ่ม `creditNoteNumbers`, `voidedReceiptNumbers`, `creditOutEntryNo`, `creditInEntryNo`, `ledgerAdvanceMoved`, `ledgerCreditMoved` (และ `transferredCredit` เป็นสตริง 2dp)

- [ ] **Step 1: เขียนเทสที่ล้ม (ต่อท้าย `defect-exchange.credit-guards.spec.ts`)**

```ts
import * as voidCore from '../receipts/services/receipt-void-core';
import * as closeAdv from '../journal/contract-close-advances';
import * as advVat from '../journal/advance-vat';
import { BadRequestException } from '@nestjs/common';
import * as inputVatClaim from '../journal/input-vat/installment-input-vat.claim';
import * as creditApproval from '../credit-check/services/credit-approval';
import * as creditLocks from '../credit-check/services/room-credit-history';

describe('execute — ขั้น ก/ค/ข/ง (15ข)', () => {
  const newProduct = { id: 'p-new', brand: 'Apple', model: 'iPhone 14', storage: '128GB', category: 'PHONE_USED', status: 'IN_STOCK', name: 'iPhone 14', imeiSerial: '356789012345678', po: null, shopWarrantyDays: 30, stockInDate: new Date(), supplierId: null, deviceOrigin: 'IMPORTED', warrantyTerms: null };
  const oldContractRow = {
    ...contract,
    customerId: 'cust-1', productId: 'p-old', branchId: 'b-1', salespersonId: 'u-2', planType: 'INSTALLMENT',
    sellingPrice: 17000, downPayment: 0, interestRate: 0, totalMonths: 12, interestTotal: 6000, financedAmount: 10000,
    storeCommission: 1000, vatAmount: 1190, vatPct: 7, monthlyPayment: 1515.83, paymentDueDay: 5, interestConfigId: null, notes: null,
    customer: { id: 'cust-1', name: 'ลูกค้าจริง', phone: '0891234567', addressCurrent: 'กรุงเทพ' },
    payments: [],
  };
  const receiptRow = { id: 'rc-1', receiptNumber: 'RT-31', isVoided: false, deletedAt: null, amount: new Prisma.Decimal('1515.83') };

  function setup(opts: { receipts?: unknown[]; blockers?: string[]; close?: { advance: Decimal; credit: Decimal }; vat?: Decimal; suspense?: Decimal; creditIn?: Decimal } = {}) {
    jest.spyOn(creditApproval, 'bindExchangeCreditCheck').mockResolvedValue(undefined);
    jest.spyOn(creditLocks, 'lockCreditCustomer').mockResolvedValue(undefined);
    jest.spyOn(inputVatClaim, 'markInputVatReversedIfSwept').mockResolvedValue('UNCHANGED');
    jest.spyOn(credit, 'exchangeMoneyBlockers').mockResolvedValue(opts.blockers ?? []);
    jest.spyOn(credit, 'listReceiptsToCreditNote').mockResolvedValue((opts.receipts ?? []) as never);
    jest.spyOn(credit, 'creditInAmountOf').mockResolvedValue(opts.creditIn ?? D(0));
    jest.spyOn(closeAdv, 'readContractCloseAdvances').mockResolvedValue({ advance: opts.close?.advance ?? D(0), credit: opts.close?.credit ?? D(0), warnings: [] });
    jest.spyOn(advVat, 'advanceVatOutstanding').mockResolvedValue(opts.vat ?? D(0));
    jest.spyOn(gl, 'glContractBalance').mockImplementation(async (_c, _id, code) => (code === '21-1106' ? (opts.suspense ?? D(0)) : D(0)));
    const voidSpy = jest.spyOn(voidCore, 'voidReceiptInTx').mockResolvedValue({
      voidedReceipt: receiptRow as never, creditNote: { receiptNumber: 'RT-44' } as never, paymentReverted: null,
      siblingCreditNoteNumbers: [], siblingReceiptNumbers: [], accrualReversal: null, warnings: [],
    });
    const tx = {
      contract: { findUnique: jest.fn().mockResolvedValue(oldContractRow), update: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({ id: 'ct-new', contractNumber: 'CT-NEW-0001', customerId: 'cust-1' }) },
      product: { findUnique: jest.fn().mockResolvedValue(newProduct), update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      payment: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      receipt: { findUnique: jest.fn().mockResolvedValue(receiptRow), findMany: jest.fn().mockResolvedValue(opts.receipts?.length ? [receiptRow] : []) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      productReservation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      contract: { findUnique: jest.fn().mockResolvedValue(contract) },
      product: { findUnique: jest.fn().mockResolvedValue(newProduct) },
      companyInfo: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx)),
    };
    const createAndPost = jest.fn().mockResolvedValue({ entryNumber: 'JE-X' });
    const reverseContract = jest.fn().mockResolvedValue({ reversedCount: 1, entryNos: ['JE-R'] });
    const service = new DefectExchangeService(prisma as never, { createAndPost } as never, { reverseContract } as never, { markReplaced: jest.fn() } as never, { voidReceipt: jest.fn() } as never, { generateReceiptNumber: jest.fn() } as never);
    return { service, tx, createAndPost, reverseContract, voidSpy };
  }
  const dto = { oldContractId: 'ct-old', newProductId: 'p-new', defectReason: 'จอเสีย' } as never;
  const MGR = { id: 'mgr-1', role: 'BRANCH_MANAGER', branchId: 'b-1' };

  it('มีใบรับเงิน 1 ใบ: ไม่ปฏิเสธ · voidReceiptInTx ด้วยนโยบายเปลี่ยนเครื่อง · ค หลัง ก · ง = Σ ใบ · creditBalance ใหม่ = T', async () => {
    const { service, tx, createAndPost, reverseContract, voidSpy } = setup({ receipts: [receiptRow], suspense: D('1515.83') });
    const res = await service.execute(dto, MGR);
    expect(voidSpy).toHaveBeenCalledTimes(1);
    const input = voidSpy.mock.calls[0][2];
    expect(input.policy).toEqual({ skipAgeLimit: true, cnSource: 'DEFECT_EXCHANGE', redirect: credit.DEFECT_EXCHANGE_REDIRECT });
    expect(input.reason).toContain('CT-NEW-0001');
    expect(input.issuedById).toBe('mgr-1');
    expect(voidSpy.mock.invocationCallOrder[0]).toBeLessThan(reverseContract.mock.invocationCallOrder[0]);
    expect(createAndPost).toHaveBeenCalledTimes(1);
    const creditIn = createAndPost.mock.calls[0][0];
    expect(creditIn.metadata).toMatchObject({ flow: 'defect-exchange-credit-in', contractId: 'ct-new', exchangeOf: 'ct-old', amount: '1515.83' });
    expect(creditIn.lines.map(fmt)).toEqual(['21-1106:1515.83:0.00', '21-5101:0.00:1515.83']);
    expect(tx.contract.update).toHaveBeenCalledWith({ where: { id: 'ct-new' }, data: { creditBalance: D('1515.83') } });
    expect(res.transferredCredit).toBe('1515.83');
    expect(res.creditNoteNumbers).toEqual(['RT-44']);
    expect(res.voidedReceiptNumbers).toEqual(['RT-31']);
    expect(res.newContract.creditBalance).toBe(1515.83);
    expect(tx.auditLog.create.mock.calls.at(-1)[0].data.newValue).toMatchObject({ transferredCredit: '1515.83', creditNoteNumbers: ['RT-44'], creditInEntryNo: 'JE-X' });
  });

  it('ไม่มีใบ ไม่มีเงินค้าง: ไม่มีรายการ ข/ง · creditBalance ไม่ถูกตั้ง · transferredCredit 0.00 (พฤติกรรมเดิม)', async () => {
    const { service, tx, createAndPost, voidSpy } = setup();
    const res = await service.execute(dto, MGR);
    expect(voidSpy).not.toHaveBeenCalled();
    expect(createAndPost).not.toHaveBeenCalled();
    expect(tx.contract.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'ct-new' } }));
    expect(res.transferredCredit).toBe('0.00');
    expect(res.creditInEntryNo).toBeNull();
  });

  it('เงินค้าง a=500 c=300 p=52.34: ข ลงก่อน ง · stamp advanceVatConsume · คอลัมน์สัญญาเดิมเป็น 0 · ง = 800', async () => {
    const { service, tx, createAndPost } = setup({ close: { advance: D(500), credit: D(300) }, vat: D('52.34'), suspense: D(800) });
    await service.execute(dto, MGR);
    expect(createAndPost).toHaveBeenCalledTimes(2);
    const out = createAndPost.mock.calls[0][0];
    expect(out.metadata).toMatchObject({ flow: 'defect-exchange-credit-out', contractId: 'ct-old', advanceVatConsume: '52.34' });
    expect(out.lines.map(fmt)).toEqual(['21-1103:500.00:0.00', '21-5101:300.00:0.00', '21-2101:52.34:0.00', '21-1106:0.00:800.00', '21-2102:0.00:52.34']);
    expect(tx.contract.update).toHaveBeenCalledWith({ where: { id: 'ct-old' }, data: closeAdv.CONTRACT_ADVANCE_COLUMNS_CLEARED });
    expect(createAndPost.mock.calls[1][0].metadata.amount).toBe('800.00');
  });

  it('ด่านเงินใน tx: มีเหตุผล → BadRequest ก่อนปิดสัญญาเดิม', async () => {
    const { service, tx } = setup({ blockers: [credit.EXCHANGE_BLOCK_RESCHEDULED] });
    // ทางปกติ: checkEligibility (นอก tx) เห็นเหตุผลเดียวกันก่อน → "ไม่เข้าเกณฑ์: …" — ด่านใน tx ครอบทาง bypass (เทส 7 ข้างล่าง)
    await expect(service.execute(dto, MGR)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.execute(dto, MGR)).rejects.toThrow(credit.EXCHANGE_BLOCK_RESCHEDULED);
    expect(tx.contract.update).not.toHaveBeenCalled();
  });

  it('ทาง bypass (ข้าม checkEligibility): ด่านเงินใน tx ยังปฏิเสธด้วยข้อความเดียวกัน ก่อนปิดสัญญาเดิม', async () => {
    const { service, tx } = setup({ blockers: [credit.EXCHANGE_BLOCK_RESCHEDULED] });
    tx.afterSalesCase = { findFirst: jest.fn().mockResolvedValue({ contractId: 'ct-old', outcome: 'SAME_MODEL_EXCHANGE', cancelledAt: null }) } as never;
    await expect(
      service.execute({ ...dto, bypassWindowCheck: true, originAfterSalesCaseId: '11111111-1111-4111-8111-111111111111' } as never, MGR),
    ).rejects.toThrow(credit.EXCHANGE_BLOCK_RESCHEDULED);
    expect(tx.contract.update).not.toHaveBeenCalled();
  });

  it('ตรวจทาน 21-1106: ยอดในบัญชี + credit-in ของสัญญาเดิม ≠ Σ ที่ย้าย → throw (GL ผิดปกติ) ไม่ลง ง', async () => {
    const { service, createAndPost } = setup({ receipts: [receiptRow], suspense: D(1000) });
    await expect(service.execute(dto, MGR)).rejects.toThrow(/21-1106/);
    expect(createAndPost).not.toHaveBeenCalled();
  });

  it('สัญญาเดิมเป็นลูกของการเปลี่ยนเครื่องครั้งก่อน (Review Focus 2): 21-1106 = 0 แต่ credit-in เดิม 1515.83 ⇒ ผ่านการตรวจทาน', async () => {
    const { service, createAndPost } = setup({ receipts: [receiptRow], suspense: D(0), creditIn: D('1515.83') });
    await service.execute(dto, MGR);
    expect(createAndPost.mock.calls[0][0].metadata.amount).toBe('1515.83');
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/defect-exchange/defect-exchange.credit-guards.spec.ts`
Expected: FAIL — เทสแรก: `voidReceiptInTx` ถูกเรียก 0 ครั้ง / `tx.payment.count is not a function` (ด่าน C-6 เดิม)

- [ ] **Step 3: แทนที่ `execute` ทั้งเมธอด**

imports เพิ่มใน service:

```ts
import { validatePeriodOpen } from '../../utils/period-lock.util';
import { emitDeferredWarnings, type DeferredWarning } from '../journal/deferred-warning';
import { voidReceiptInTx, storedTaxColumnsOf } from '../receipts/services/receipt-void-core';
import { CONTRACT_ADVANCE_COLUMNS_CLEARED, readContractCloseAdvances } from '../journal/contract-close-advances';
import { ADVANCE_VAT_META, advanceVatOutstanding } from '../journal/advance-vat';
import {
  buildCreditInLines,
  buildCreditOutLines,
  creditInAmountOf,
  DEFECT_EXCHANGE_CN_SOURCE,
  DEFECT_EXCHANGE_CREDIT_IN_FLOW,
  DEFECT_EXCHANGE_CREDIT_OUT_FLOW,
  DEFECT_EXCHANGE_REDIRECT,
  DEFECT_EXCHANGE_SUSPENSE_ACCOUNT,
  DEFECT_EXCHANGE_TAG,
  exchangeMoneyBlockers,
  listReceiptsToCreditNote,
  sumReceiptAmounts,
} from './defect-exchange-credit';
```

เมธอด `execute` ใหม่ (แทนทั้งเมธอดเดิม L146–456 — โค้ดเดิมคงไว้ทุกบรรทัดยกเว้นส่วนที่ขีดเส้นด้วยคอมเมนต์ `15ข`):

```ts
  /**
   * Execute a 7-day defect exchange (MANAGER only):
   *   - 15ข (ก) ใบรับเงินทุกใบของสัญญาเดิม → ใบลดหนี้ + un-pay + กลับ 2A ก่อนครบกำหนด · กระจกรับชำระย้ายขาเงินสด → 21-1106
   *   - Close old contract → DEFECT_EXCHANGED · old product → DEFECT_RETURN
   *   - (ค) reverse remaining JEs (1A · 2A ที่ครบกำหนด · SHOP legs) — ข้าม flow เครดิต/เงินลูกค้า
   *   - (ข) เงินของลูกค้าที่เหลือ (21-1103 + 21-5101) → 21-1106 + กลับภาษีที่พัก
   *   - Create new contract with IDENTICAL terms · (ง) Dr 21-1106 / Cr 21-5101 = T + creditBalance
   *   - New product → RESERVED (→ SOLD_INSTALLMENT on activate; activate ใช้เครดิตชำระงวดอัตโนมัติ)
   * Spec: docs/superpowers/specs/2026-10-17-defect-exchange-credit-note-design.md §3
   */
  async execute(dto: ExecuteDefectExchangeDto, user: ReqUser | string) {
    // Support legacy string userId calls (e.g. existing controller) as well as
    // the new full-user object required for bypass-window role checks.
    const reqUser: ReqUser =
      typeof user === 'string' ? { id: user, role: 'BRANCH_MANAGER' } : user;

    // 15ข — ทุกรายการลงวันนี้ (ใบลดหนี้/กระจก/การย้ายเครดิต) ⇒ งวดบัญชี FINANCE ของวันนี้ต้องเปิด (ด่านเดียวกับ void)
    const finance = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    await validatePeriodOpen(this.prisma, new Date(), finance?.id);
    /** สัญญาณเตือนจาก core/void และคอลัมน์ไม่ตรงบัญชี — ส่งหลัง commit เท่านั้น */
    const warnings: DeferredWarning[] = [];

    const result = await this.prisma.$transaction(
      async (tx) => {
        // === bypass-window guards (must run before eligibility check) ===
        if (dto.bypassWindowCheck) {
          if (!dto.originRepairTicketId && !dto.originAfterSalesCaseId) {
            throw new BadRequestException(
              'bypassWindowCheck ต้องระบุ originRepairTicketId หรือ originAfterSalesCaseId',
            );
          }
          if (!['OWNER', 'BRANCH_MANAGER'].includes(reqUser.role)) {
            throw new ForbiddenException(
              'สิทธิ์ไม่พอ — bypass ทำได้เฉพาะ OWNER/BRANCH_MANAGER',
            );
          }
          if (dto.originRepairTicketId) {
            const ticket = await tx.repairTicket.findUnique({
              where: { id: dto.originRepairTicketId, deletedAt: null },
            });
            if (!ticket) {
              throw new NotFoundException('ไม่พบ repair ticket');
            }
            if (!['OPEN', 'IN_PROGRESS', 'READY_FOR_PICKUP'].includes(ticket.status)) {
              throw new BadRequestException(
                'repair ticket อยู่ในสถานะ terminal — ไม่สามารถ replace ได้',
              );
            }
          } else {
            // M5 — เคสต้องยังเปิดอยู่และยังไม่เคยยืนยันเปลี่ยนเครื่อง (ไม่งั้นเคสที่ปิดแล้วใช้เป็น "ตั๋วข้ามกรอบ" ได้)
            const asCase = await tx.afterSalesCase.findFirst({
              where: {
                id: dto.originAfterSalesCaseId,
                deletedAt: null,
                stage: { notIn: ['CLOSED', 'CANCELLED'] },
                replacementContractId: null,
              },
              select: { contractId: true, outcome: true, cancelledAt: true },
            });
            if (!asCase) {
              throw new NotFoundException('ไม่พบเคสหลังการขายที่ยังเปิดอยู่');
            }
            if (
              asCase.contractId !== dto.oldContractId ||
              asCase.cancelledAt ||
              !['SAME_MODEL_EXCHANGE', 'REPAIR'].includes(asCase.outcome ?? '')
            ) {
              throw new BadRequestException(
                'เคสหลังการขายไม่ตรงกับสัญญา หรือไม่ใช่เคสเปลี่ยนรุ่นเดิม',
              );
            }
          }
        } else {
          // === normal 7-day eligibility check ===
          const elig = await this.checkEligibility(dto.oldContractId, dto.newProductId);
          if (!elig.eligible) {
            throw new BadRequestException(`ไม่เข้าเกณฑ์: ${elig.reasons.join(', ')}`);
          }
        }

        // supplierClaimEligible is only relevant in the normal (non-bypass) path.
        // For bypass we default to false — the exchange is admin-forced, supplier claim
        // determination can be done separately if needed.
        let supplierClaimEligible = false;
        if (!dto.bypassWindowCheck) {
          // We already validated eligibility above; re-fetch just the supplier claim flag.
          const eligForClaim = await this.checkEligibility(dto.oldContractId, dto.newProductId);
          supplierClaimEligible = eligForClaim.supplierClaimEligible;
        }

        // 15ข (เจ้าของ 17/10/2569 ทำตามคำตอบฝ่ายบัญชีข้อ 15 ข): ด่าน C-6 "มีรายการชำระแล้ว → ปฏิเสธ" ถูกถอด —
        // ใบรับเงินของสัญญาเดิมได้ใบลดหนี้ และเงินย้ายเป็นเครดิตสัญญาใหม่ (ขั้น ก–ง ด้านล่าง).

        const oldContract = await tx.contract.findUnique({
          where: { id: dto.oldContractId },
          include: {
            product: true,
            payments: true,
            // test-data fence (spec 2026-09-05 §5.4): โหลดลูกค้ามาเข้ารั้วคู่กับเครื่องใหม่
            customer: { select: TEST_SIDE_CUSTOMER_SELECT },
          },
        });
        if (!oldContract) throw new NotFoundException('ไม่พบสัญญา');
        if (oldContract.tradeInCreditSnapshot) throw new BadRequestException('สัญญาที่ใช้เครดิตเทิร์นยังไม่รองรับการเปลี่ยนเครื่อง ต้องตรวจการคืนเครดิตก่อน');
        await lockCreditCustomer(tx, oldContract.customerId);

        // 15ข — ด่านเงินใน tx (ทั้งทางปกติและ bypass ซึ่งข้าม checkEligibility): ปรับดิว / กวาด 42-1106 / คำขอ void ค้าง /
        // ปิดยอด / ใบลดหนี้กำพร้า (spec §5) — ก่อนเขียนอะไรทั้งสิ้น
        const moneyBlockers = await exchangeMoneyBlockers(tx, oldContract);
        if (moneyBlockers.length > 0) throw new BadRequestException(moneyBlockers[0]);

        const newProductRec = await tx.product.findUnique({
          where: { id: dto.newProductId },
          // รั้วต้องเห็น PO ต้นทาง (อุปกรณ์เสริมไร้ IMEI จาก PO ทดสอบ) — ชนิดของรั้วบังคับ
          include: { po: { select: { poNumber: true } } },
        });
        if (!newProductRec) throw new NotFoundException('ไม่พบสินค้าใหม่');
        // test-data fence (spec 2026-09-05 §5.4 — แก้หลัง final review): เคลมเปลี่ยนเครื่องสืบทอด
        // "ลูกค้า" แต่เลือก "เครื่อง" ใหม่จากสต็อก (ตรงรุ่น/ความจุ — เครื่องทดสอบที่ seed ก็ผ่าน)
        // ⇒ คู่ใหม่ ต้องอยู่ฝั่งเดียวกัน. ตรวจตรงนี้ = ก่อนเขียนอะไรทั้งสิ้น (ปิดสัญญาเดิม /
        // กลับรายการ JE / สร้างสัญญาใหม่ / จองเครื่อง) และครอบทาง replace จากใบซ่อม
        // (`bypassWindowCheck` ข้าม checkEligibility แต่เดินผ่านบรรทัดนี้เหมือนกัน)
        assertSameTestSide(oldContract.customer, newProductRec);

        // 15ข — เลขที่สัญญาใหม่ต้องรู้ก่อนออกใบลดหนี้ (เหตุผลการยกเลิกอ้างถึง)
        const contractNumber = await generateContractNumber(tx);

        // === 15ข ขั้น ก — ใบรับเงินทุกใบที่ยังมีผล → ใบลดหนี้ (สัญญาเดิมยัง ACTIVE/OVERDUE ตรงนี้ จึงผ่านด่านสถานะของ core) ===
        const liveReceipts = await listReceiptsToCreditNote(tx, oldContract.id);
        const creditNoteNumbers: string[] = [];
        const voidedReceiptNumbers: string[] = [];
        for (const row of liveReceipts) {
          const fresh = await tx.receipt.findUnique({ where: { id: row.id } });
          // ถูกยกเลิกไปแล้วในฐานะใบพี่น้องของใบก่อนหน้า (paymentId เดียวกัน) — core จัดการให้แล้ว
          if (!fresh || fresh.isVoided || fresh.deletedAt) continue;
          const out = await voidReceiptInTx(
            tx,
            { reversal: this.receiptVoidReversal, numbers: this.receiptNumbers },
            {
              receipt: fresh,
              reason: `เปลี่ยนเครื่องตำหนิภายใน 7 วัน → สัญญา ${contractNumber}`,
              issuedById: reqUser.id,
              approvedById: reqUser.id,
              userRole: reqUser.role,
              // ใบตั้งแต่ PR3 เก็บค่า ณ ตอนออก — ใบเก่ากว่านั้น (prod ไม่มี) ได้ใบลดหนี้แบบยอดอย่างเดียว
              creditNoteMoney: storedTaxColumnsOf,
              policy: { skipAgeLimit: true, cnSource: DEFECT_EXCHANGE_CN_SOURCE, redirect: DEFECT_EXCHANGE_REDIRECT },
            },
          );
          warnings.push(...out.warnings);
          creditNoteNumbers.push(out.creditNote.receiptNumber, ...out.siblingCreditNoteNumbers);
          voidedReceiptNumbers.push(fresh.receiptNumber, ...out.siblingReceiptNumbers);
        }
        // ยอดที่ย้ายจากใบ = Σ ใบในรายการที่ถูกยกเลิกจริง (ใบพี่น้องรวมอยู่ในรายการอยู่แล้ว)
        const voidedRows =
          liveReceipts.length > 0
            ? await tx.receipt.findMany({
                where: { id: { in: liveReceipts.map((r) => r.id) }, isVoided: true },
                select: { amount: true },
              })
            : [];
        const receiptsCredit = sumReceiptAmounts(voidedRows);

        // Close old contract
        await tx.contract.update({
          where: { id: dto.oldContractId },
          data: {
            status: 'DEFECT_EXCHANGED',
            notes: [oldContract.notes, `เปลี่ยนเครื่องเพราะตำหนิ: ${dto.defectReason}`].filter(Boolean).join('\n'),
          },
        });

        // Old product → DEFECT_RETURN (so shop can decide repair vs supplier claim)
        await tx.product.update({
          where: { id: oldContract.productId },
          data: { status: 'DEFECT_RETURN' },
        });

        // === 15ข ขั้น ค — Phase A.5a: reverse the remaining JEs (1A · 2A ที่ครบกำหนด · SHOP legs). ===
        // Must run in the same outer tx so an exchange that fails to reverse cleanly rolls back the
        // contract status update. ข้าม flow เครดิต/รายการเงินสดของลูกค้า (template) — ขั้น ข ย้ายให้เอง.
        await this.defectExchangeReversalTemplate.reverseContract(oldContract.id, tx);
        // ก้อน 5 — JE ภาษีซื้อของสัญญาเดิมถูกกลับไปพร้อมกัน → สถานะบนสัญญาตามสมุด (PENDING_INVOICE = ถอนสิทธิ์เคลมย้อน)
        await markInputVatReversedIfSwept(tx, oldContract.id);

        // === 15ข ขั้น ข — เงินของลูกค้าที่เหลือ (21-1103 ทุกถัง + 21-5101) → 21-1106 + กลับภาษีที่พักทั้งก้อน ===
        const close = await readContractCloseAdvances(tx, oldContract, 'defect-exchange');
        warnings.push(...close.warnings);
        const moneyOut = close.advance.plus(close.credit);
        let creditOutEntryNo: string | null = null;
        const vatOut = await advanceVatOutstanding(tx, oldContract.id);
        if (moneyOut.gt(0)) {
          const posted = await this.journalAutoService.createAndPost(
            {
              description: `[เปลี่ยนเครื่องตำหนิ] โอนเงินของลูกค้าที่เหลือเป็นเครดิตสัญญาใหม่ — สัญญา ${oldContract.contractNumber} → ${contractNumber}`,
              reference: `defect-exchange-credit-out:${oldContract.id}`,
              metadata: {
                tag: DEFECT_EXCHANGE_TAG,
                flow: DEFECT_EXCHANGE_CREDIT_OUT_FLOW,
                idempotencyKey: `defect-exchange-credit-out:${oldContract.id}`,
                contractId: oldContract.id,
                newContractNumber: contractNumber,
                advance: close.advance.toFixed(2),
                credit: close.credit.toFixed(2),
                amount: moneyOut.toFixed(2),
                ...(vatOut.gt(0) ? { [ADVANCE_VAT_META.consume]: vatOut.toFixed(2) } : {}),
              },
              lines: buildCreditOutLines(close.advance, close.credit, vatOut),
            },
            tx,
          );
          creditOutEntryNo = posted.entryNumber;
        } else if (vatOut.gt(0.01)) {
          warnings.push({
            message: '[defect-exchange] advance VAT outstanding with no customer money left to transfer',
            tags: { module: 'defect-exchange', action: 'defect-exchange-orphan-advance-vat' },
            extra: { contractId: oldContract.id, contractNumber: oldContract.contractNumber, advanceVatOutstanding: vatOut.toFixed(2) },
          });
        }
        // คอลัมน์เงินของลูกค้าบนสัญญาเดิมเป็นศูนย์ในธุรกรรมเดียวกัน (เงินอยู่ที่ 21-1106 → สัญญาใหม่)
        await tx.contract.update({ where: { id: oldContract.id }, data: CONTRACT_ADVANCE_COLUMNS_CLEARED });

        // Create new contract — copy terms verbatim, link to old
        const newContract = await tx.contract.create({
          data: {
            contractNumber,
            productDisclosure: captureProductDisclosure(newProductRec, await readStringFlag(tx, SHOP_WARRANTY_DAYS_CONFIG_KEY, '')),
            customerId: oldContract.customerId,
            productId: dto.newProductId,
            branchId: oldContract.branchId,
            salespersonId: oldContract.salespersonId,
            planType: oldContract.planType,
            sellingPrice: oldContract.sellingPrice,
            downPayment: oldContract.downPayment,
            interestRate: oldContract.interestRate,
            totalMonths: oldContract.totalMonths,
            interestTotal: oldContract.interestTotal,
            financedAmount: oldContract.financedAmount,
            storeCommission: oldContract.storeCommission,
            vatAmount: oldContract.vatAmount,
            vatPct: oldContract.vatPct,
            monthlyPayment: oldContract.monthlyPayment,
            paymentDueDay: oldContract.paymentDueDay,
            interestConfigId: oldContract.interestConfigId,
            parentContractId: oldContract.id,
            status: 'DRAFT',
            workflowStatus: 'CREATING',
            notes: `เปลี่ยนเครื่องจากสัญญา ${oldContract.contractNumber} (ภายใน 7 วัน)\nอาการ: ${dto.defectReason}${dto.notes ? '\n' + dto.notes : ''}`,
          },
        });

        await bindExchangeCreditCheck(tx, oldContract.customerId, newContract.id, reqUser);

        // Copy payment schedule from old (same dueDates, same amountDue, but reset amountPaid/status).
        // The per-installment breakdown (principal/interest/commission/VAT) MUST be carried over —
        // PaymentReceipt2BTemplate splits each collection into those ledger lines, so dropping them
        // (Wave-1 #20) left the exchanged contract's future payment JEs with no VAT/interest split.
        const newPayments = oldContract.payments
          .sort((a, b) => a.installmentNo - b.installmentNo)
          .map((p) => ({
            contractId: newContract.id,
            installmentNo: p.installmentNo,
            dueDate: p.dueDate,
            amountDue: p.amountDue,
            monthlyPrincipal: p.monthlyPrincipal,
            monthlyInterest: p.monthlyInterest,
            monthlyCommission: p.monthlyCommission,
            vatAmount: p.vatAmount,
          }));
        if (newPayments.length > 0) {
          await tx.payment.createMany({ data: newPayments });
        }

        // === 15ข ขั้น ง — ตั้งเครดิตสัญญาใหม่ = Σ ใบที่ยกเลิก + เงินของลูกค้าที่ย้าย ===
        // ตรวจทานกับบัญชีพัก: ยอด Cr สุทธิของ 21-1106 ของสัญญาเดิม + credit-in ที่สัญญาเดิมเคยรับ (ถ้าเป็นลูกของ
        // การเปลี่ยนเครื่องครั้งก่อน — Dr ของมันทำให้ยอดสุทธิต่ำกว่า) ต้องเท่ากับยอดที่ย้าย ±0.01 — ไม่เท่า = บัญชีพักมี
        // รายการที่ไม่รู้จัก ห้ามเดา ⇒ ทั้ง tx rollback (500 + Sentry ให้ฝ่ายบัญชีตรวจ)
        const transferred = receiptsCredit.plus(moneyOut);
        const suspenseCr = await glContractBalance(tx, oldContract.id, DEFECT_EXCHANGE_SUSPENSE_ACCOUNT, 'cr');
        const ownCreditIn = await creditInAmountOf(tx, oldContract.id);
        if (suspenseCr.plus(ownCreditIn).minus(transferred).abs().gt(0.01)) {
          throw new Error(
            `[defect-exchange] 21-1106 ของสัญญา ${oldContract.contractNumber} = ${suspenseCr.toFixed(2)} (+ credit-in เดิม ${ownCreditIn.toFixed(2)}) ` +
              `ไม่เท่ากับเครดิตที่ย้าย ${transferred.toFixed(2)} — บัญชีพักมีรายการที่ไม่รู้จัก ต้องตรวจก่อน`,
          );
        }
        let creditInEntryNo: string | null = null;
        if (transferred.gt(0)) {
          const posted = await this.journalAutoService.createAndPost(
            {
              description: `[เปลี่ยนเครื่องตำหนิ] รับโอนเครดิตจากสัญญา ${oldContract.contractNumber} — สัญญา ${contractNumber}`,
              reference: `defect-exchange-credit-in:${newContract.id}`,
              metadata: {
                tag: DEFECT_EXCHANGE_TAG,
                flow: DEFECT_EXCHANGE_CREDIT_IN_FLOW,
                idempotencyKey: `defect-exchange-credit-in:${newContract.id}`,
                contractId: newContract.id,
                exchangeOf: oldContract.id,
                exchangeOfContractNumber: oldContract.contractNumber,
                amount: transferred.toFixed(2),
                receiptsCredit: receiptsCredit.toFixed(2),
                ledgerMoved: moneyOut.toFixed(2),
              },
              lines: buildCreditInLines(transferred),
            },
            tx,
          );
          creditInEntryNo = posted.entryNumber;
          await tx.contract.update({
            where: { id: newContract.id },
            data: { creditBalance: transferred },
          });
        }

        // Reserve new product (will flip to SOLD_INSTALLMENT on activation)
        // #1679 รอบแก้ 1: CAS where IN_STOCK — RESERVED ไม่มีเจ้าของในสคีมา; ด่าน checkEligibility อ่านนอก tx และทาง
        // bypassWindowCheck ไม่ตรวจสถานะเครื่องใหม่เลย ⇒ update ตรง ๆ ทับเครื่องที่ใบจอง PAID/ร่างสัญญาอื่นถืออยู่ได้
        // count 0 → ทั้ง tx rollback (สัญญาเดิมไม่ถูกปิด · JE ไม่ถูกกลับ · ไม่มีสัญญาใหม่)
        const reserved = await tx.product.updateMany({
          where: { id: dto.newProductId, status: 'IN_STOCK', deletedAt: null },
          data: { status: 'RESERVED' },
        });
        if (reserved.count !== 1) {
          throw new ConflictException(
            'เครื่องใหม่ไม่อยู่ในสต็อกพร้อมขายแล้ว (ถูกขาย ถูกจอง หรือถูกใบจองล็อกไว้) — เปลี่ยนเครื่องไม่ได้ กรุณาเลือกเครื่องอื่นที่พร้อมขายแล้วทำรายการใหม่',
          );
        }
        // B5: เครื่องใหม่ถูกจองไว้แล้ว — ตัด hold ของเว็บใน tx เดียวกัน (เคลมเปลี่ยนเครื่อง)
        await preemptReservationsInTx(tx, [dto.newProductId]);

        // === repair-ticket handoff (bypass path only) ===
        if (dto.bypassWindowCheck && dto.originRepairTicketId) {
          // Customer match check — repair ticket customer must match the new contract customer.
          const ticketForMatch = await tx.repairTicket.findUnique({
            where: { id: dto.originRepairTicketId },
            select: { customerId: true },
          });
          if (ticketForMatch && ticketForMatch.customerId !== newContract.customerId) {
            throw new ForbiddenException(
              'customer mismatch — repair ticket vs new contract',
            );
          }

          await this.repairTickets.markReplaced(
            dto.originRepairTicketId,
            newContract.id,
            reqUser,
            tx,
          );

          await tx.auditLog.create({
            data: {
              userId: reqUser.id,
              action: 'DEFECT_EXCHANGE_WINDOW_BYPASSED',
              entity: 'defect_exchange',
              entityId: newContract.id,
              newValue: { originRepairTicketId: dto.originRepairTicketId },
              ipAddress: '',
            },
          });
        } else if (dto.bypassWindowCheck && dto.originAfterSalesCaseId) {
          await tx.auditLog.create({
            data: {
              userId: reqUser.id,
              action: 'DEFECT_EXCHANGE_WINDOW_BYPASSED',
              entity: 'defect_exchange',
              entityId: newContract.id,
              newValue: { originAfterSalesCaseId: dto.originAfterSalesCaseId },
              ipAddress: '',
            },
          });
        }

        // Audit log
        await tx.auditLog.create({
          data: {
            userId: reqUser.id,
            action: 'DEFECT_EXCHANGE',
            entity: 'contract',
            entityId: newContract.id,
            newValue: {
              oldContractId: oldContract.id,
              oldContractNumber: oldContract.contractNumber,
              newContractId: newContract.id,
              newContractNumber: contractNumber,
              oldProductId: oldContract.productId,
              newProductId: dto.newProductId,
              defectReason: dto.defectReason,
              photoUrls: dto.photoUrls ?? [],
              transferredCredit: transferred.toFixed(2),
              creditNoteNumbers,
              voidedReceiptNumbers,
              receiptsCredit: receiptsCredit.toFixed(2),
              ledgerAdvanceMoved: close.advance.toFixed(2),
              ledgerCreditMoved: close.credit.toFixed(2),
              creditOutEntryNo,
              creditInEntryNo,
              supplierClaimEligible,
            },
            ipAddress: '',
          },
        });

        this.logger.log(
          `Defect exchange: ${oldContract.contractNumber} → ${contractNumber} (credit ${transferred.toFixed(2)} · CN ${creditNoteNumbers.length})`,
        );

        return {
          oldContract: {
            id: oldContract.id,
            contractNumber: oldContract.contractNumber,
            status: 'DEFECT_EXCHANGED',
          },
          newContract: {
            id: newContract.id,
            contractNumber,
            status: 'DRAFT',
            workflowStatus: 'CREATING',
            creditBalance: transferred.toNumber(),
          },
          supplierClaimEligible,
          creditNoteNumbers,
          voidedReceiptNumbers,
          transferredCredit: transferred.toFixed(2),
          creditOutEntryNo,
          creditInEntryNo,
        };
      },
      { isolationLevel: 'Serializable' },
    );
    emitDeferredWarnings(warnings);
    return result;
  }
```

- [ ] **Step 4: แก้ spec เดิม `defect-exchange.service.spec.ts`**

1. หัวไฟล์ (หลัง `jest.mock('../../utils/sequence.util', …)`) เพิ่ม:

```ts
// 15ข — ตัวช่วยเครดิต/บัญชีอ่านฐานจริงผ่าน prisma mock ที่ไฟล์นี้ไม่ได้ mock ตาราง → ตัดออกทั้งชุด (พฤติกรรมของมันปักที่
// defect-exchange-credit.spec.ts และ defect-exchange.credit-guards.spec.ts)
jest.mock('./defect-exchange-credit', () => ({
  ...jest.requireActual('./defect-exchange-credit'),
  exchangeMoneyBlockers: jest.fn().mockResolvedValue([]),
  listReceiptsToCreditNote: jest.fn().mockResolvedValue([]),
  creditInAmountOf: jest.fn().mockResolvedValue(new (require('@prisma/client/runtime/library').Decimal)(0)),
}));
jest.mock('../journal/contract-close-advances', () => ({
  ...jest.requireActual('../journal/contract-close-advances'),
  readContractCloseAdvances: jest.fn().mockResolvedValue({
    advance: new (require('@prisma/client/runtime/library').Decimal)(0),
    credit: new (require('@prisma/client/runtime/library').Decimal)(0),
    warnings: [],
  }),
}));
jest.mock('../journal/advance-vat', () => ({
  ...jest.requireActual('../journal/advance-vat'),
  advanceVatOutstanding: jest.fn().mockResolvedValue(new (require('@prisma/client/runtime/library').Decimal)(0)),
}));
jest.mock('../journal/gl-contract-balance', () => ({
  glContractBalance: jest.fn().mockResolvedValue(new (require('@prisma/client/runtime/library').Decimal)(0)),
}));
```

2. ใน `beforeEach` → `txMock` เพิ่ม `receipt: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },` และ `prisma` เพิ่ม `companyInfo: { findFirst: jest.fn().mockResolvedValue(null) },` · ลบ `count: jest.fn(),` ออกจาก `txMock.payment` (ไม่มีผู้เรียกแล้ว)
3. ลบเทส `'throws BadRequestException when contract has any PAID payment record'` และ `'payment guard message includes the count of payment records'` ทั้งก้อน · เปลี่ยนชื่อ `describe('execute — Wave 3 T2 payment guard (ปพพ.386 C-6)'` → `describe('execute — เส้นทางหลัก (ด่าน C-6 ถอดแล้ว 15ข)'`
4. ลบทุกบรรทัด `tx.payment.count.mockResolvedValue(0);` / `prisma.__tx.payment.count.mockResolvedValue(0);` (ทั้งไฟล์ — `grep -n "payment.count"` ต้องเหลือ 0)
5. ในเทส `'proceeds when contract has zero payments'` ลบ `expect(tx.payment.count).toHaveBeenCalledWith({…})` ทั้งก้อน แทนด้วย `expect(result.transferredCredit).toBe('0.00');`
6. provider `{ provide: JournalAutoService, useValue: {} }` → `{ provide: JournalAutoService, useValue: { createAndPost: jest.fn().mockResolvedValue({ entryNumber: 'JE-T' }) } }`

- [ ] **Step 5: รันทั้งโฟลเดอร์ + types + lint**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/defect-exchange/ src/modules/after-sales/__tests__/exchange-service.spec.ts && grep -c "payment.count" src/modules/defect-exchange/defect-exchange.service.spec.ts; cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && ./tools/check-types.sh api && cd apps/api && npx eslint --no-fix /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api/src/modules/defect-exchange/defect-exchange.service.ts /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api/src/modules/defect-exchange/defect-exchange-credit.ts`
Expected: PASS ทุก spec · grep = `0` · 0 type/lint errors

- [ ] **Step 6: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && git add apps/api/src/modules/defect-exchange && git commit -q -F - <<'MSG'
feat(defect-exchange): ถอดด่าน C-6 — ใบลดหนี้ทุกใบของสัญญาเดิม · เงินผ่าน 21-1106 → เครดิต 21-5101 สัญญาใหม่ (15ข/18.3ข)

ขั้น ก voidReceiptInTx (redirect เงินสด → 21-1106) · ค reverseContract · ข ย้ายเงินค้าง + กลับภาษีพัก ·
ง Dr 21-1106 / Cr 21-5101 = T (ตรวจทานกับบัญชีพัก) · สัญญาณเตือนส่งหลัง commit

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

### Task 7: Integration บน DB จริง — ทั้งสาย (จ่าย → เปลี่ยนเครื่อง → เปิดใช้ → ใช้เครดิต) + CI glob

**Files:**
- Create: `apps/api/src/modules/defect-exchange/__tests__/defect-exchange-credit.integration.spec.ts`
- Modify: `.github/workflows/deploy-gcp.yml` (vitest step — เพิ่ม `DEFECT_FILES`)

**Interfaces:**
- Consumes: ทุกอย่างจาก Task 1–6 · harness แบบ `payments/services/accrue-at-receipt.integration.spec.ts` (wiring ด้วย `new`) · `seedStandard17k12m` · `seedStatementReview`
- Produces: ตัวเลขทอง spec §4 ปักบน DB

- [ ] **Step 1: เขียน spec (แดงก่อนเพราะยังไม่มี glob/ไม่เคยรัน — ตัวเลขต้องตรง spec §4 ไม่ปรับให้ผ่าน)**

```ts
// apps/api/src/modules/defect-exchange/__tests__/defect-exchange-credit.integration.spec.ts
/**
 * 15ข — เปลี่ยนเครื่องตำหนิเมื่อสัญญาเดิมมีการชำระแล้ว บน DB จริง (vitest — jest ignore *.integration.spec.ts).
 * Wiring ด้วย `new` ตาม precedent accrue-at-receipt.integration.spec.ts (ไม่ผ่าน Nest DI).
 *
 * Runner:
 *   source ~/Documents/BESTCHOICE-docs/pr4-advance-vat/test-env.sh && \
 *   npx vitest run --root /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api --no-file-parallelism \
 *     src/modules/defect-exchange/__tests__/defect-exchange-credit.integration.spec.ts
 * CI: glob DEFECT_FILES ใน .github/workflows/deploy-gcp.yml (โฟลเดอร์ใหม่ ⇒ glob ใหม่ — glob ไม่ recurse เอง)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { AccountingPeriodStatus, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../../journal/__tests__/scenario-helpers';
import { glContractBalance } from '../../journal/gl-contract-balance';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ContractActivation1ATemplate } from '../../journal/cpa-templates/contract-activation-1a.template';
import { PaymentReceiptTemplate } from '../../journal/cpa-templates/payment-receipt.template';
import { ReceiptVoidReversalTemplate } from '../../journal/cpa-templates/receipt-void-reversal.template';
import { DefectExchangeReversalTemplate } from '../../journal/cpa-templates/defect-exchange-reversal.template';
import { ADVANCE_VAT_META, advanceVatOutstanding } from '../../journal/advance-vat';
import { ReceiptsService } from '../../receipts/receipts.service';
import { ReceiptNumberService } from '../../receipts/services/receipt-number.service';
import { PaymentReceiptOrchestrator } from '../../payments/services/payment-receipt-orchestrator';
import { seedStatementReview } from '../../contracts/__tests__/credit-approval.fixture';
import { DefectExchangeService } from '../defect-exchange.service';
import { DEFECT_EXCHANGE_CN_SOURCE, EXCHANGE_BLOCK_RESCHEDULED } from '../defect-exchange-credit';

vi.mock('@sentry/nestjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/nestjs')>();
  return { ...actual, captureMessage: vi.fn(), captureException: vi.fn() };
});

const prisma = new PrismaClient();
const D = (n: string | number) => new Decimal(n);
const DAY_MS = 86_400_000;
const INSTALLMENT_TOTAL = '1515.83';
const OWNER = { id: '', role: 'OWNER', branchId: null as string | null };

async function ensureFinanceCompany(): Promise<void> {
  const existing = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
  if (!existing) {
    await prisma.companyInfo.create({
      data: {
        nameTh: 'BESTCHOICE FINANCE', taxId: '0000000000003', companyCode: 'FINANCE', address: '1 Finance Rd.',
        directorName: 'Test Director', vatRegistered: true, vatRate: D('0.0700'),
      },
    });
  }
}
async function ensureSystemAdminUser(): Promise<string> {
  const existing = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: { email: 'admin@bestchoice.com', password: 'hashed_placeholder', name: 'System Admin', role: 'OWNER' },
  });
  return created.id;
}
const reopenedFinancePeriods: { id: string; status: AccountingPeriodStatus }[] = [];
async function ensureFinancePeriodsOpen(): Promise<void> {
  const finance = await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE' } });
  const months = new Map<string, { year: number; month: number }>();
  for (let offset = -10; offset <= 1; offset++) {
    const day = new Date(Date.now() + offset * DAY_MS);
    months.set(`${day.getFullYear()}-${day.getMonth() + 1}`, { year: day.getFullYear(), month: day.getMonth() + 1 });
  }
  const closed = await prisma.accountingPeriod.findMany({
    where: { companyId: finance.id, status: { in: ['CLOSED', 'SYNCED'] }, OR: [...months.values()] },
    select: { id: true, status: true },
  });
  if (closed.length === 0) return;
  reopenedFinancePeriods.push(...closed);
  await prisma.accountingPeriod.updateMany({ where: { id: { in: closed.map((p) => p.id) } }, data: { status: 'OPEN' } });
}
async function restoreFinancePeriods(): Promise<void> {
  const rows = reopenedFinancePeriods.splice(0);
  for (const status of new Set(rows.map((r) => r.status))) {
    await prisma.accountingPeriod.updateMany({
      where: { id: { in: rows.filter((r) => r.status === status).map((r) => r.id) } },
      data: { status },
    });
  }
}
async function cleanLedger(): Promise<void> {
  await prisma.receipt.deleteMany({});
  await prisma.journalPostAuditLog.deleteMany({});
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.loyaltyPoint.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  await prisma.creditCheck.deleteMany({ where: { statementFiles: { has: 'synthetic://integration-statement.pdf' } } });
  const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
  await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
}

/** ยอดทั้งบัญชี (ทุกสัญญา) — ใช้ยืนยันว่า 21-1106 สุทธิ 0 และ 21-2101 สุทธิเท่าภาษีของเงินสดจริง */
async function accountNet(accountCode: string, side: 'cr' | 'dr'): Promise<Decimal> {
  const lines = await prisma.journalLine.findMany({
    where: { accountCode, journalEntry: { status: 'POSTED', deletedAt: null } },
    select: { debit: true, credit: true },
  });
  return lines.reduce(
    (b, l) => (side === 'cr' ? b.plus(l.credit.toString()).minus(l.debit.toString()) : b.plus(l.debit.toString()).minus(l.credit.toString())),
    D(0),
  );
}
const metaOf = (e: { metadata: unknown }) => (e.metadata ?? {}) as Record<string, unknown>;
async function entriesOf(contractId: string) {
  return prisma.journalEntry.findMany({
    where: { status: 'POSTED', deletedAt: null, metadata: { path: ['contractId'], equals: contractId } },
    include: { lines: true },
    orderBy: { createdAt: 'asc' },
  });
}
const sortedLines = (e: { lines: { accountCode: string; debit: unknown; credit: unknown }[] }) =>
  e.lines.map((l) => `${l.accountCode}:${D(String(l.debit)).toFixed(2)}:${D(String(l.credit)).toFixed(2)}`).sort();

describe('15ข — เปลี่ยนเครื่องตำหนิเมื่อสัญญาเดิมมีการชำระแล้ว (integration)', () => {
  let journal: JournalAutoService;
  let orchestrator: PaymentReceiptOrchestrator;
  let defect: DefectExchangeService;
  let recordedById: string;
  const futureDue = () => new Date(Date.now() + 60 * DAY_MS);

  /** สัญญามาตรฐาน 17,000/12 + 1A + งวดในอนาคต + แถว Payment ของงวดที่ระบุ · เครื่องมือสอง รับเครื่องวันนี้ */
  const seedContract = async (opts: { dueDate: Date; paymentRows: number[] }) => {
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as never).execute(c.id);
    await prisma.installmentSchedule.updateMany({ where: { contractId: c.id }, data: { dueDate: opts.dueDate } });
    for (const installmentNo of opts.paymentRows) {
      await prisma.payment.create({
        data: { contractId: c.id, installmentNo, dueDate: opts.dueDate, amountDue: D(INSTALLMENT_TOTAL), status: 'PENDING' },
      });
    }
    const row = await prisma.contract.update({
      where: { id: c.id },
      data: { status: 'ACTIVE', deviceReceivedAt: new Date() },
      select: { id: true, contractNumber: true, customerId: true, productId: true, branchId: true },
    });
    await prisma.product.update({ where: { id: row.productId }, data: { category: 'PHONE_USED', status: 'SOLD_INSTALLMENT' } });
    const old = await prisma.product.findUniqueOrThrow({ where: { id: row.productId } });
    const replacement = await prisma.product.create({
      data: {
        name: 'Replacement Phone', brand: old.brand, model: old.model, storage: old.storage, category: 'PHONE_USED',
        status: 'IN_STOCK', imeiSerial: `DXR-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, costPrice: D('8000'),
        cashPrice: D('12000'), installmentPrice: D('17000'), branchId: row.branchId, ownedByCompanyId: old.ownedByCompanyId,
      },
    });
    await seedStatementReview(prisma, row.customerId);
    return { ...row, replacementId: replacement.id };
  };

  const record = (contractId: string, installmentNo: number, amount: number, ref: string, paymentCase?: 'PARTIAL') =>
    orchestrator.recordPayment(
      contractId, installmentNo, amount, 'BANK_TRANSFER', recordedById,
      undefined, undefined, ref, '11-1201', undefined, paymentCase, undefined, undefined, undefined, undefined, undefined, true,
    );

  const exchange = (oldContractId: string, newProductId: string) =>
    defect.execute({ oldContractId, newProductId, defectReason: 'จอมีเส้น' } as never, OWNER);

  /** จำลองการเปิดใช้สัญญาใหม่ที่หน้าสัญญา (precedent after-sales-exchange.integration เคส 5) — 1A + ตารางงวด + ACTIVE */
  const activateNew = async (oldId: string, newId: string) => {
    await prisma.contract.update({ where: { id: newId }, data: { status: 'ACTIVE', workflowStatus: 'ACTIVE' } });
    await new ContractActivation1ATemplate(journal, prisma as never).execute(newId);
    const sched = await prisma.installmentSchedule.findMany({ where: { contractId: oldId } });
    await prisma.installmentSchedule.createMany({
      data: sched.map((s) => ({ contractId: newId, installmentNo: s.installmentNo, dueDate: s.dueDate, principal: s.principal, interest: s.interest, amountDue: s.amountDue })),
    });
  };

  beforeAll(async () => {
    await cleanLedger();
    await seedFinanceCoa(prisma);
    await prisma.chartOfAccount.upsert({
      where: { code: '21-5101' },
      create: { code: '21-5101', name: 'เงินเกินของลูกค้า (Customer Credit Balance)', type: 'หนี้สิน', normalBalance: 'Cr', category: 'หนี้สิน' },
      update: { deletedAt: null },
    });
    await ensureFinanceCompany();
    OWNER.id = await ensureSystemAdminUser();
    await ensureFinancePeriodsOpen();
    journal = new JournalAutoService(prisma as never);
    const voidReversal = new ReceiptVoidReversalTemplate(journal, prisma as never);
    const receiptsService = new ReceiptsService(prisma as never, journal, voidReversal, undefined);
    const noop = async () => {};
    orchestrator = new PaymentReceiptOrchestrator(
      prisma as never, receiptsService, { logPaymentEvent: noop, log: noop } as never, journal,
      { transferOwnership: noop } as never, { reverseStageOnPayment: noop } as never,
      new PaymentReceiptTemplate(journal, prisma as never), { execute: noop } as never,
      { awardLoyaltyPoints: noop, sendPaymentSuccessLine: noop, runMdmAutoUnlock: noop, checkPromiseAfterPayment: noop },
    );
    defect = new DefectExchangeService(
      prisma as never, journal, new DefectExchangeReversalTemplate(journal, prisma as never),
      { markReplaced: noop } as never, voidReversal, new ReceiptNumberService(prisma as never),
    );
    await seedStandard17k12m(prisma);
    recordedById = (await prisma.user.findFirstOrThrow({ where: { email: 'test-salesperson@bestchoice-test.internal' } })).id;
  });

  afterAll(async () => {
    try { await cleanLedger(); } finally { try { await restoreFinancePeriods(); } finally { await prisma.$disconnect(); } }
  });

  it('1) ตัวเลขทอง spec §4: จ่ายงวด 1 ก่อนครบกำหนด → เปลี่ยนเครื่อง → ใบลดหนี้ 1 ใบ · ธนาคารไม่ขยับ · 21-1106 สุทธิ 0 · เครดิตใหม่ 1,515.83 · ภ.พ.30 สุทธิ 0 → เปิดใช้ + ใช้เครดิต → ใบใหม่ VAT 99.17 · สุทธิ 99.17', async () => {
    const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
    await record(c.id, 1, 1515.83, 'ref-g1');
    expect((await accountNet('21-2101', 'cr')).toFixed(2)).toBe('99.17');
    const bankBefore = await accountNet('11-1201', 'dr');

    const res = await exchange(c.id, c.replacementId);
    expect(res.transferredCredit).toBe('1515.83');
    expect(res.creditNoteNumbers).toHaveLength(1);
    expect(res.creditOutEntryNo).toBeNull();
    expect(res.creditInEntryNo).not.toBeNull();

    // ใบลดหนี้ + ใบเดิม
    const cn = await prisma.receipt.findFirstOrThrow({ where: { contractId: c.id, receiptType: 'CREDIT_NOTE' } });
    expect(cn.cnSource).toBe(DEFECT_EXCHANGE_CN_SOURCE);
    expect(D(cn.amount.toString()).toFixed(2)).toBe('1515.83');
    expect(D(String(cn.vatAmount)).toFixed(2)).toBe('99.17');
    expect(D(String(cn.amountBeforeVat)).toFixed(2)).toBe('1416.66');
    const original = await prisma.receipt.findUniqueOrThrow({ where: { id: cn.voidedReceiptId! } });
    expect(original.isVoided).toBe(true);
    expect(original.voidReason).toContain(res.newContract.contractNumber);
    // งวด 1 ของสัญญาเดิมกลับเป็นค้าง
    const pay1 = await prisma.payment.findFirstOrThrow({ where: { contractId: c.id, installmentNo: 1 } });
    expect(pay1.status).toBe('PENDING');
    expect(D(pay1.amountPaid.toString()).toFixed(2)).toBe('0.00');

    // รายการ: กระจกรับชำระ redirect · กระจก 2A · กระจก 1A · ไม่มี credit-out · credit-in บนสัญญาใหม่
    const oldEntries = await entriesOf(c.id);
    const receiptMirror = oldEntries.find((e) => metaOf(e).flow === 'receipt-void');
    expect(receiptMirror && metaOf(receiptMirror).redirectedTo).toBe('21-1106');
    expect(sortedLines(receiptMirror!)).toEqual(['11-2103:1515.83:0.00', '21-1106:0.00:1515.83']);
    expect(oldEntries.some((e) => metaOf(e).flow === 'receipt-accrual-void')).toBe(true);
    expect(oldEntries.some((e) => metaOf(e).flow === 'defect-exchange' && metaOf(e).tag === 'REVERSAL')).toBe(true);
    expect(oldEntries.some((e) => metaOf(e).flow === 'defect-exchange-credit-out')).toBe(false);
    const newEntries = await entriesOf(res.newContract.id);
    const creditIn = newEntries.find((e) => metaOf(e).flow === 'defect-exchange-credit-in');
    expect(sortedLines(creditIn!)).toEqual(['21-1106:1515.83:0.00', '21-5101:0.00:1515.83']);
    expect(metaOf(creditIn!)).not.toHaveProperty(ADVANCE_VAT_META.park);

    // ยอดในบัญชี
    for (const code of ['11-2101', '11-2103', '11-2105', '11-2106', '21-2101', '21-2102', '41-1101', '21-1101', '21-1102', '21-1103', '21-5101']) {
      expect((await glContractBalance(prisma, c.id, code, 'cr')).toFixed(2), code).toBe('0.00');
    }
    expect((await glContractBalance(prisma, c.id, '21-1106', 'cr')).toFixed(2)).toBe('1515.83');
    expect((await accountNet('21-1106', 'cr')).toFixed(2)).toBe('0.00');
    expect((await accountNet('11-1201', 'dr')).toFixed(2)).toBe(bankBefore.toFixed(2));
    expect((await glContractBalance(prisma, res.newContract.id, '21-5101', 'cr')).toFixed(2)).toBe('1515.83');
    expect((await accountNet('21-2101', 'cr')).toFixed(2)).toBe('0.00');
    const newRow = await prisma.contract.findUniqueOrThrow({ where: { id: res.newContract.id } });
    expect(D(newRow.creditBalance.toString()).toFixed(2)).toBe('1515.83');
    expect(newRow.parentContractId).toBe(c.id);

    // เปิดใช้ + ใช้เครดิต (ทางเดียวกับ hook ตอน activate — Task 8)
    await activateNew(c.id, res.newContract.id);
    const applied = await orchestrator.applyCreditBalance(res.newContract.id, OWNER.id);
    expect(applied.creditUsed).toBe(1515.83);
    expect(applied.creditRemaining).toBe(0);
    const newPay1 = await prisma.payment.findFirstOrThrow({ where: { contractId: res.newContract.id, installmentNo: 1 } });
    expect(newPay1.status).toBe('PAID');
    const creditReceipt = await prisma.receipt.findFirstOrThrow({ where: { contractId: res.newContract.id, paymentMethod: 'CREDIT_BALANCE' } });
    expect(D(creditReceipt.amount.toString()).toFixed(2)).toBe('1515.83');
    expect(D(String(creditReceipt.vatAmount)).toFixed(2)).toBe('99.17');
    expect((await glContractBalance(prisma, res.newContract.id, '21-5101', 'cr')).toFixed(2)).toBe('0.00');
    expect((await accountNet('21-2101', 'cr')).toFixed(2)).toBe('99.17');
    expect((await advanceVatOutstanding(prisma, res.newContract.id)).toFixed(2)).toBe('0.00');
  });

  it('2) ไม่มีใบรับเงิน ไม่มีเงินค้าง: ไม่มีใบลดหนี้ ไม่มีรายการ ข/ง · creditBalance 0 (พฤติกรรมเดิม)', async () => {
    const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
    const res = await exchange(c.id, c.replacementId);
    expect(res.transferredCredit).toBe('0.00');
    expect(res.creditNoteNumbers).toEqual([]);
    expect(await prisma.receipt.count({ where: { contractId: c.id } })).toBe(0);
    const newEntries = await entriesOf(res.newContract.id);
    expect(newEntries.some((e) => metaOf(e).flow === 'defect-exchange-credit-in')).toBe(false);
    expect((await accountNet('21-1106', 'cr')).toFixed(2)).toBe('0.00');
  });

  it('3) เคยปรับดิว (ถังพัก > 0) → BadRequest ก่อนเขียนอะไร', async () => {
    const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
    await prisma.contract.update({ where: { id: c.id }, data: { rescheduleAdvanceBalance: D('100') } });
    await expect(exchange(c.id, c.replacementId)).rejects.toThrow(EXCHANGE_BLOCK_RESCHEDULED);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('ACTIVE');
  });

  it('4) จ่ายหลังครบกำหนด (Review Focus 3): ก กลับ 2A ไม่ได้ → ค mirror 2A · T = 1,515.83 · ทุกบัญชีของสัญญาเดิม 0', async () => {
    const c = await seedContract({ dueDate: new Date(Date.now() - 3 * DAY_MS), paymentRows: [1, 2] });
    await record(c.id, 1, 1515.83, 'ref-late');
    const res = await exchange(c.id, c.replacementId);
    expect(res.transferredCredit).toBe('1515.83');
    const oldEntries = await entriesOf(c.id);
    expect(oldEntries.some((e) => metaOf(e).flow === 'receipt-accrual-void')).toBe(false);
    const mirrored2A = oldEntries.filter((e) => metaOf(e).flow === 'defect-exchange' && metaOf(e).tag === 'REVERSAL');
    expect(mirrored2A.length).toBeGreaterThanOrEqual(2); // 1A + 2A
    for (const code of ['11-2101', '11-2103', '11-2105', '11-2106', '21-2101', '21-2102', '41-1101']) {
      expect((await glContractBalance(prisma, c.id, code, 'cr')).toFixed(2), code).toBe('0.00');
    }
    expect((await accountNet('21-1106', 'cr')).toFixed(2)).toBe('0.00');
  });

  it('5) ใบรับบางส่วน 1,000 ก่อนครบกำหนด (Review Focus 4): ใบลดหนี้ 1,000 · 2A บางส่วนถูกกลับ · T = 1,000', async () => {
    const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
    await record(c.id, 1, 1000, 'ref-part', 'PARTIAL');
    const res = await exchange(c.id, c.replacementId);
    expect(res.transferredCredit).toBe('1000.00');
    const cn = await prisma.receipt.findFirstOrThrow({ where: { contractId: c.id, receiptType: 'CREDIT_NOTE' } });
    expect(D(cn.amount.toString()).toFixed(2)).toBe('1000.00');
    expect(D(String(cn.vatAmount)).toFixed(2)).toBe('65.42');
    const oldEntries = await entriesOf(c.id);
    expect(oldEntries.some((e) => metaOf(e).flow === 'receipt-accrual-void')).toBe(true);
    expect((await glContractBalance(prisma, c.id, '11-2103', 'dr')).toFixed(2)).toBe('0.00');
    expect((await glContractBalance(prisma, res.newContract.id, '21-5101', 'cr')).toFixed(2)).toBe('1000.00');
  });

  it('6) เงินของลูกค้าค้างบนสัญญาเดิม (เครดิต 300 พักภาษี 19.63): ขั้น ข ย้าย + กลับภาษีทั้งก้อน · ธนาคารไม่ขยับ · T = 300', async () => {
    const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
    // จำลองจ่ายเกิน (overpayment-credit ของกระจายเงิน): Dr ธนาคาร / Cr 21-5101 + ขาพักภาษี (PR4 ต2 ง)
    await journal.createAndPost({
      description: 'test overpayment credit',
      reference: `test-over:${c.id}`,
      metadata: { tag: 'overpayment-credit', contractId: c.id, paymentId: 'none', [ADVANCE_VAT_META.park]: '19.63' },
      lines: [
        { accountCode: '11-1201', dr: D(300), cr: D(0) },
        { accountCode: '21-5101', dr: D(0), cr: D(300) },
        { accountCode: '21-2102', dr: D('19.63'), cr: D(0) },
        { accountCode: '21-2101', dr: D(0), cr: D('19.63') },
      ],
    });
    await prisma.contract.update({ where: { id: c.id }, data: { creditBalance: D(300) } });
    const bankBefore = await accountNet('11-1201', 'dr');
    const res = await exchange(c.id, c.replacementId);
    expect(res.transferredCredit).toBe('300.00');
    const out = (await entriesOf(c.id)).find((e) => metaOf(e).flow === 'defect-exchange-credit-out');
    expect(sortedLines(out!)).toEqual(['21-1106:0.00:300.00', '21-2101:19.63:0.00', '21-2102:0.00:19.63', '21-5101:300.00:0.00']);
    expect(metaOf(out!)[ADVANCE_VAT_META.consume]).toBe('19.63');
    expect((await advanceVatOutstanding(prisma, c.id)).toFixed(2)).toBe('0.00');
    expect((await accountNet('11-1201', 'dr')).toFixed(2)).toBe(bankBefore.toFixed(2));
    const oldRow = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    expect(D(oldRow.creditBalance.toString()).toFixed(2)).toBe('0.00');
    expect((await glContractBalance(prisma, res.newContract.id, '21-5101', 'cr')).toFixed(2)).toBe('300.00');
  });

  it('7) A→B→C (Review Focus 2): สัญญาใหม่ที่ใช้เครดิตแล้วถูกเปลี่ยนเครื่องอีกครั้ง → เครดิตย้ายต่อ 1,515.83 · 21-1106 สุทธิ 0', async () => {
    const a = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
    const vatBefore = await accountNet('21-2101', 'cr'); // เทสก่อนหน้าทิ้งยอดสะสมไว้ (ledger ล้างเฉพาะ beforeAll/afterAll)
    await record(a.id, 1, 1515.83, 'ref-chain');
    const ab = await exchange(a.id, a.replacementId);
    await activateNew(a.id, ab.newContract.id);
    await orchestrator.applyCreditBalance(ab.newContract.id, OWNER.id);
    // เตรียม B ให้เปลี่ยนเครื่องได้อีกครั้ง
    const bProduct = await prisma.product.findUniqueOrThrow({ where: { id: a.replacementId } });
    const cProduct = await prisma.product.create({
      data: {
        name: 'Replacement Phone 2', brand: bProduct.brand, model: bProduct.model, storage: bProduct.storage, category: 'PHONE_USED',
        status: 'IN_STOCK', imeiSerial: `DXR2-${Date.now()}`, costPrice: D('8000'), cashPrice: D('12000'), installmentPrice: D('17000'),
        branchId: bProduct.branchId, ownedByCompanyId: bProduct.ownedByCompanyId,
      },
    });
    await prisma.contract.update({ where: { id: ab.newContract.id }, data: { deviceReceivedAt: new Date() } });
    await seedStatementReview(prisma, a.customerId);
    const bc = await exchange(ab.newContract.id, cProduct.id);
    expect(bc.transferredCredit).toBe('1515.83');
    expect(bc.creditNoteNumbers).toHaveLength(1); // ใบใช้เครดิตของ B ได้ใบลดหนี้
    expect((await glContractBalance(prisma, bc.newContract.id, '21-5101', 'cr')).toFixed(2)).toBe('1515.83');
    expect((await glContractBalance(prisma, ab.newContract.id, '21-5101', 'cr')).toFixed(2)).toBe('0.00');
    expect((await accountNet('21-1106', 'cr')).toFixed(2)).toBe('0.00');
    // ภาษีสุทธิไม่เปลี่ยน: +99.17 (ใบ A) −99.17 (กลับ 2A ของ A) +99.17 (ใช้เครดิต B) −99.17 (กลับ 2A ของ B)
    expect((await accountNet('21-2101', 'cr')).toFixed(2)).toBe(vatBefore.toFixed(2));
  });
});
```

- [ ] **Step 2: รัน (แดงได้เฉพาะเพราะ wiring/ตัวเลข — ห้ามแก้ตัวเลขทอง)**

Run: `source ~/Documents/BESTCHOICE-docs/pr4-advance-vat/test-env.sh && npx vitest run --root /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api --no-file-parallelism src/modules/defect-exchange/__tests__/defect-exchange-credit.integration.spec.ts 2>&1 | tail -40`
Expected: 7/7 PASS — ถ้า `prisma.product.create` ใน `seedContract` ล้มเพราะฟิลด์บังคับ ให้ใช้ชุดฟิลด์เดียวกับ `seedReplacementProduct` ใน `after-sales/__tests__/after-sales-exchange.integration.spec.ts:357` (name/brand/model/storage/imeiSerial/category/costPrice/installmentPrice/branchId/status) · ถ้าเคส 1 ล้มที่ `creditUsed`/ใบ VAT ให้ไล่จาก `activateNew` (ตารางงวด/สถานะ) ไม่ใช่ตัวเลข · ถ้าเคส 7 ล้มที่การตรวจทาน 21-1106 = `creditInAmountOf` อ่านไม่เจอ (ตรวจ metadata.amount ของ credit-in)

- [ ] **Step 3: CI glob**

ใน `.github/workflows/deploy-gcp.yml` หลังบรรทัด `BOOKINGS_FILES=$(ls src/modules/bookings/__tests__/*.integration.spec.ts)` เพิ่ม:

```yaml
          # เปลี่ยนเครื่องตำหนิ 15ข (2026-10-17) — โฟลเดอร์ใหม่ ⇒ glob ใหม่ (glob ไม่ recurse เอง)
          DEFECT_FILES=$(ls src/modules/defect-exchange/__tests__/*.integration.spec.ts)
```

และในรายการอาร์กิวเมนต์ของ `npx vitest run --no-file-parallelism $FILES \` เพิ่มบรรทัด `            $DEFECT_FILES \` ต่อจาก `            $BOOKINGS_FILES \` (ตรวจด้วย `grep -n 'BOOKINGS_FILES \\\\\|DEFECT_FILES' .github/workflows/deploy-gcp.yml` ต้องเห็น 2 บรรทัดติดกัน)

- [ ] **Step 4: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && git add apps/api/src/modules/defect-exchange/__tests__/defect-exchange-credit.integration.spec.ts .github/workflows/deploy-gcp.yml && git commit -q -F - <<'MSG'
test(defect-exchange): integration ทั้งสาย 15ข บน DB — ตัวเลขทอง spec §4 + Review Focus 2/3/4 · CI glob DEFECT_FILES

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 8: เปิดใช้สัญญาใหม่ → ใช้เครดิตชำระงวดอัตโนมัติ

**Files:**
- Create: `apps/api/src/modules/contracts/services/exchange-credit-autoapply.ts`
- Test: `apps/api/src/modules/contracts/services/exchange-credit-autoapply.spec.ts` (ใหม่ — jest)
- Modify: `apps/api/src/modules/contracts/contract-workflow.service.ts` (ctor L44–59 · `activate` L390 + ท้ายเมธอด L756–762)
- Modify: `apps/api/src/modules/contracts/contracts.module.ts:28-50` (imports)
- Modify: `apps/api/src/modules/contracts/contracts.controller.ts:223`

**Interfaces:**
- Consumes: `PaymentsService.applyCreditBalance(contractId, recordedById)` (export จาก PaymentsModule — คืน `{ allocatedPayments, creditUsed: number, creditRemaining: number }`)
- Produces: `export type CreditAutoApplyResult = { applied: true; installments: number; creditUsed: number; creditRemaining: number; actorId: string } | { applied: false; reason: 'NOT_EXCHANGE' | 'NO_CREDIT' | 'NO_PAYMENTS_SERVICE' | 'NO_ACTOR' | 'FAILED'; message?: string }` · `applyExchangeCreditAfterActivation(deps, contract, actorId?)` · `ContractWorkflowService.activate(id: string, actorId?: string)` คืน `{ ...findOne(id), creditApplied: CreditAutoApplyResult }`

- [ ] **Step 1: เขียนเทสที่ล้ม**

```ts
// apps/api/src/modules/contracts/services/exchange-credit-autoapply.spec.ts
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { applyExchangeCreditAfterActivation } from './exchange-credit-autoapply';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

const contract = { id: 'ct-new', contractNumber: 'CT-NEW', parentContractId: 'ct-old', creditBalance: new Prisma.Decimal('1515.83') };
const prisma = { user: { findFirst: jest.fn().mockResolvedValue({ id: 'admin-1' }) } };

describe('applyExchangeCreditAfterActivation (spec §6)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('สัญญาจากการเปลี่ยนเครื่องที่มีเครดิต → เรียก applyCreditBalance ด้วยผู้ใช้ที่กดเปิดใช้', async () => {
    const applyCreditBalance = jest.fn().mockResolvedValue({ allocatedPayments: [{}], creditUsed: 1515.83, creditRemaining: 0 });
    const out = await applyExchangeCreditAfterActivation({ prisma: prisma as never, payments: { applyCreditBalance } }, contract, 'mgr-1');
    expect(applyCreditBalance).toHaveBeenCalledWith('ct-new', 'mgr-1');
    expect(out).toEqual({ applied: true, installments: 1, creditUsed: 1515.83, creditRemaining: 0, actorId: 'mgr-1' });
  });

  it('ไม่ส่ง actor → ใช้ admin@bestchoice.com · ไม่มีผู้ใช้ระบบ → NO_ACTOR + Sentry', async () => {
    const applyCreditBalance = jest.fn().mockResolvedValue({ allocatedPayments: [], creditUsed: 0, creditRemaining: 0 });
    await applyExchangeCreditAfterActivation({ prisma: prisma as never, payments: { applyCreditBalance } }, contract);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { email: 'admin@bestchoice.com', deletedAt: null }, select: { id: true } });
    expect(applyCreditBalance).toHaveBeenCalledWith('ct-new', 'admin-1');
    const none = { user: { findFirst: jest.fn().mockResolvedValue(null) } };
    const out = await applyExchangeCreditAfterActivation({ prisma: none as never, payments: { applyCreditBalance } }, contract);
    expect(out).toEqual({ applied: false, reason: 'NO_ACTOR' });
    expect(Sentry.captureMessage).toHaveBeenCalled();
  });

  it('ไม่ใช่สัญญาจากการเปลี่ยนเครื่อง / ไม่มีเครดิต → ไม่เรียก', async () => {
    const applyCreditBalance = jest.fn();
    expect(await applyExchangeCreditAfterActivation({ prisma: prisma as never, payments: { applyCreditBalance } }, { ...contract, parentContractId: null })).toEqual({ applied: false, reason: 'NOT_EXCHANGE' });
    expect(await applyExchangeCreditAfterActivation({ prisma: prisma as never, payments: { applyCreditBalance } }, { ...contract, creditBalance: new Prisma.Decimal(0) })).toEqual({ applied: false, reason: 'NO_CREDIT' });
    expect(applyCreditBalance).not.toHaveBeenCalled();
  });

  it('applyCreditBalance ล้ม → FAILED + Sentry warning action defect-exchange-credit-autoapply-failed · ไม่ throw', async () => {
    const applyCreditBalance = jest.fn().mockRejectedValue(new Error('งวดบัญชีปิด'));
    const out = await applyExchangeCreditAfterActivation({ prisma: prisma as never, payments: { applyCreditBalance } }, contract, 'mgr-1');
    expect(out).toEqual({ applied: false, reason: 'FAILED', message: 'งวดบัญชีปิด' });
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      level: 'warning', tags: expect.objectContaining({ action: 'defect-exchange-credit-autoapply-failed' }),
    }));
  });

  it('ไม่มี PaymentsService (ผู้เรียกไม่ได้ฉีด) → NO_PAYMENTS_SERVICE + Sentry', async () => {
    const out = await applyExchangeCreditAfterActivation({ prisma: prisma as never, payments: null }, contract, 'mgr-1');
    expect(out).toEqual({ applied: false, reason: 'NO_PAYMENTS_SERVICE' });
    expect(Sentry.captureMessage).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/contracts/services/exchange-credit-autoapply.spec.ts`
Expected: FAIL — `Cannot find module './exchange-credit-autoapply'`

- [ ] **Step 3: เขียน helper**

```ts
// apps/api/src/modules/contracts/services/exchange-credit-autoapply.ts
import { Prisma, PrismaClient } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';

export type CreditAutoApplyResult =
  | { applied: true; installments: number; creditUsed: number; creditRemaining: number; actorId: string }
  | { applied: false; reason: 'NOT_EXCHANGE' | 'NO_CREDIT' | 'NO_PAYMENTS_SERVICE' | 'NO_ACTOR' | 'FAILED'; message?: string };

export interface CreditApplier {
  applyCreditBalance(contractId: string, recordedById: string): Promise<{
    allocatedPayments: unknown[];
    creditUsed: number;
    creditRemaining: number;
  }>;
}

const SENTRY_TAGS = { module: 'contracts', action: 'defect-exchange-credit-autoapply-failed', flow: 'defect-exchange' };

/**
 * 15ข (spec §6): หลังเปิดใช้สัญญาที่มาจากการเปลี่ยนเครื่องตำหนิ (`parentContractId`) และมีเครดิตที่ย้ายมา
 * (`creditBalance > 0`) → ใช้เครดิตชำระงวดทันที (เส้นทาง `applyCreditBalance` เดิม: ใบเสร็จ/ใบกำกับภาษี
 * ช่องทาง CREDIT_BALANCE + 2A ตามกติกา + LINE ตามกติกาใบงวด). เรียก**หลัง** tx ของ activate commit —
 * ล้มไม่ย้อนการเปิดใช้ (เครดิตค้าง ใช้ปุ่ม "ใช้ยอดเครดิต" มือ) · ไม่ throw.
 */
export async function applyExchangeCreditAfterActivation(
  deps: { prisma: Pick<PrismaClient, 'user'>; payments: CreditApplier | null | undefined },
  contract: {
    id: string;
    contractNumber: string;
    parentContractId: string | null;
    creditBalance: Prisma.Decimal | string | number | null;
  },
  actorId?: string | null,
): Promise<CreditAutoApplyResult> {
  if (!contract.parentContractId) return { applied: false, reason: 'NOT_EXCHANGE' };
  const credit = new Prisma.Decimal((contract.creditBalance ?? 0).toString());
  if (!credit.gt(0)) return { applied: false, reason: 'NO_CREDIT' };
  const extra = { contractId: contract.id, contractNumber: contract.contractNumber, creditBalance: credit.toFixed(2) };
  if (!deps.payments) {
    Sentry.captureMessage('[defect-exchange] activate without PaymentsService — credit left on contract', {
      level: 'warning', tags: SENTRY_TAGS, extra,
    });
    return { applied: false, reason: 'NO_PAYMENTS_SERVICE' };
  }
  let actor = actorId ?? null;
  if (!actor) {
    const system = await deps.prisma.user.findFirst({
      where: { email: 'admin@bestchoice.com', deletedAt: null },
      select: { id: true },
    });
    actor = system?.id ?? null;
  }
  if (!actor) {
    Sentry.captureMessage('[defect-exchange] no actor for credit auto-apply — credit left on contract', {
      level: 'warning', tags: SENTRY_TAGS, extra,
    });
    return { applied: false, reason: 'NO_ACTOR' };
  }
  try {
    const out = await deps.payments.applyCreditBalance(contract.id, actor);
    return {
      applied: true,
      installments: out.allocatedPayments.length,
      creditUsed: out.creditUsed,
      creditRemaining: out.creditRemaining,
      actorId: actor,
    };
  } catch (err) {
    Sentry.captureException(err, { level: 'warning', tags: SENTRY_TAGS, extra: { ...extra, actorId: actor } });
    return { applied: false, reason: 'FAILED', message: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/contracts/services/exchange-credit-autoapply.spec.ts`
Expected: PASS 5/5

- [ ] **Step 5: ต่อสายใน `ContractWorkflowService` / module / controller**

`contract-workflow.service.ts`:
- imports: `import { Inject, Optional, forwardRef } from '@nestjs/common';` (รวมกับ import เดิมของ `@nestjs/common`) · `import { PaymentsService } from '../payments/payments.service';` · `import { applyExchangeCreditAfterActivation } from './services/exchange-credit-autoapply';`
- ctor เพิ่มพารามิเตอร์ท้ายสุด (หลัง `journeyEntries`):

```ts
    // 15ข — ใช้เครดิตที่ย้ายมาจากการเปลี่ยนเครื่องชำระงวดทันทีหลังเปิดใช้. PaymentsModule import ContractsModule อยู่แล้ว
    // (forwardRef) ⇒ ฝั่งนี้ต้อง forwardRef เช่นกัน · @Optional: spec เดิม `new` service ด้วย 9–11 อาร์กิวเมนต์ — ไม่มี = เครดิตค้าง + Sentry
    @Optional() @Inject(forwardRef(() => PaymentsService)) private paymentsService?: PaymentsService,
```

- `async activate(id: string)` → `async activate(id: string, actorId?: string)` · ท้ายเมธอดแทน `return this.findOne(id);` ด้วย:

```ts
    // 15ข (spec §6): เครดิตจากการเปลี่ยนเครื่องตำหนิ → ชำระงวดของสัญญานี้ทันที (หลัง tx commit — ล้มไม่ย้อนการเปิดใช้)
    const creditApplied = await applyExchangeCreditAfterActivation(
      { prisma: this.prisma, payments: this.paymentsService ?? null },
      {
        id: contract.id,
        contractNumber: contract.contractNumber,
        parentContractId: contract.parentContractId,
        creditBalance: contract.creditBalance,
      },
      actorId,
    );
    return { ...(await this.findOne(id)), creditApplied };
```

`contracts.module.ts`: `import { PaymentsModule } from '../payments/payments.module';` และใน `imports` เพิ่ม

```ts
    // 15ข — ContractWorkflowService.activate ใช้ PaymentsService.applyCreditBalance หลัง commit (เครดิตจากเปลี่ยนเครื่อง).
    // PaymentsModule import ContractsModule ผ่าน forwardRef อยู่แล้ว ⇒ ขอบนี้ต้อง forwardRef ด้วย
    forwardRef(() => PaymentsModule),
```

`contracts.controller.ts:223`: `const activated = await this.workflowService.activate(id, user.id);`

- [ ] **Step 6: types + spec ข้างเคียง + บูตโมดูล**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && ./tools/check-types.sh api && cd apps/api && npx jest --runInBand src/modules/contracts/ 2>&1 | tail -15`
Expected: 0 type errors · spec ใน contracts/ ผ่านเท่าเดิม (ที่ `new ContractWorkflowService(…)` ยังคอมไพล์เพราะพารามิเตอร์ใหม่ optional)

Run (ตรวจ DI cycle จริง — บูต Nest แล้วปิด): `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && source ~/Documents/BESTCHOICE-docs/pr4-advance-vat/test-env.sh && timeout 120 npx ts-node -r tsconfig-paths/register -e "import('./src/app.module').then(async ({ AppModule }) => { const { Test } = await import('@nestjs/testing'); const m = await Test.createTestingModule({ imports: [AppModule] }).compile(); const { ContractWorkflowService } = await import('./src/modules/contracts/contract-workflow.service'); const s = m.get(ContractWorkflowService); console.log('DI OK paymentsService=', !!(s as any).paymentsService); await m.close(); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); })" 2>&1 | tail -5`
Expected: `DI OK paymentsService= true` — ถ้า Nest โยน "circular dependency"/"can't resolve dependencies" ให้แก้ที่ `forwardRef` ทั้งสองขอบ (ห้ามเปลี่ยนเป็น import ตรง) · ถ้าคำสั่งล้มด้วยเหตุ env (Redis/S3) ให้บันทึกเป็น ruling แล้วพึ่ง CI e2e (บูตแอปจริง)

- [ ] **Step 7: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && git add apps/api/src/modules/contracts && git commit -q -F - <<'MSG'
feat(contracts): เปิดใช้สัญญาจากการเปลี่ยนเครื่อง → ใช้เครดิตชำระงวดอัตโนมัติหลัง commit (15ข spec §6)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 9: เอกสาร — ใบลดหนี้เปลี่ยนเครื่อง + ใบใช้เครดิตบอกที่มา

**Files:**
- Create: `apps/api/src/modules/receipts/services/exchange-credit-source.ts`
- Test: `apps/api/src/modules/receipts/services/exchange-credit-source.spec.ts` (ใหม่ — jest) · `apps/api/src/modules/receipts/services/receipt-pdf.exchange.spec.ts` (ใหม่ — jest, mock puppeteer แบบ `receipt-pdf.service.spec.ts`)
- Modify: `apps/api/src/modules/receipts/services/receipt-query.service.ts` (`getReceipt` L139–302)
- Modify: `apps/api/src/modules/receipts/services/receipt-pdf.service.ts` (L202 · L256–265 · L461–467 · L481–486 · L556–567 · L595)

**Interfaces:**
- Consumes: `DEFECT_EXCHANGE_CN_SOURCE`, `DEFECT_EXCHANGE_CREDIT_IN_FLOW` (Task 4) · `INSTALLMENT_MONEY_RECEIPT_TYPES`
- Produces: `interface ExchangeCreditSource { parentContractNumber: string; transferred: Decimal; creditNotes: { number: string; originalNumber: string | null }[] }` · `exchangeCreditSourceFrom(input)` (pure) · `resolveExchangeCreditSource(prisma, receipt, contract)` · `getReceipt()` คืนเพิ่ม `exchangeTarget: { contractNumber: string } | null` (ใบลดหนี้เปลี่ยนเครื่อง) และ `exchangeCreditSource: ExchangeCreditSource | null` (ใบใช้เครดิต)

- [ ] **Step 1: เทสที่ล้ม — กติกาที่มาของเครดิต (pure)**

```ts
// apps/api/src/modules/receipts/services/exchange-credit-source.spec.ts
import { Decimal } from '@prisma/client/runtime/library';
import { exchangeCreditSourceFrom } from './exchange-credit-source';

const D = (n: string) => new Decimal(n);
const rc = (id: string, paidDate: string, receiptNumber: string, amount: string) => ({ id, paidDate: new Date(paidDate), receiptNumber, amount: D(amount) });
const base = {
  receipt: { id: 'r1', paymentMethod: 'CREDIT_BALANCE', receiptType: 'INSTALLMENT', isVoided: false },
  parentContractNumber: 'CT-OLD',
  transferred: D('1515.83'),
  creditNotes: [{ number: 'RT-44', originalNumber: 'RT-31' }],
};

describe('exchangeCreditSourceFrom (spec §6 — Σ ใบ CREDIT_BALANCE ถึงใบนี้ ≤ T)', () => {
  it('ใบแรกที่ใช้เครดิต (Σ = T) → แสดงที่มา', () => {
    const out = exchangeCreditSourceFrom({ ...base, creditBalanceReceipts: [rc('r1', '2026-10-15', 'RT-45', '1515.83')] });
    expect(out).toEqual({ parentContractNumber: 'CT-OLD', transferred: D('1515.83'), creditNotes: base.creditNotes });
  });
  it('ใบที่สองเกิน T (เครดิตจากจ่ายเกินทีหลัง) → null · ใบแรกยังแสดง', () => {
    const rows = [rc('r1', '2026-10-15', 'RT-45', '1515.83'), rc('r2', '2026-11-15', 'RT-60', '500')];
    expect(exchangeCreditSourceFrom({ ...base, creditBalanceReceipts: rows })).not.toBeNull();
    expect(exchangeCreditSourceFrom({ ...base, receipt: { ...base.receipt, id: 'r2' }, creditBalanceReceipts: rows })).toBeNull();
  });
  it('เรียง paidDate แล้ว receiptNumber — ใบวันเดียวกันเลขน้อยกว่ามาก่อน', () => {
    const rows = [rc('r2', '2026-10-15', 'RT-46', '1000'), rc('r1', '2026-10-15', 'RT-45', '1000')];
    expect(exchangeCreditSourceFrom({ ...base, transferred: D('1000'), creditBalanceReceipts: rows })).not.toBeNull();
    expect(exchangeCreditSourceFrom({ ...base, transferred: D('1000'), receipt: { ...base.receipt, id: 'r2' }, creditBalanceReceipts: rows })).toBeNull();
  });
  it('ไม่ใช่ช่องทางเครดิต / ไม่มีสัญญาเดิม / T = 0 / ใบถูกยกเลิก → null', () => {
    const rows = [rc('r1', '2026-10-15', 'RT-45', '1515.83')];
    expect(exchangeCreditSourceFrom({ ...base, receipt: { ...base.receipt, paymentMethod: 'CASH' }, creditBalanceReceipts: rows })).toBeNull();
    expect(exchangeCreditSourceFrom({ ...base, parentContractNumber: null, creditBalanceReceipts: rows })).toBeNull();
    expect(exchangeCreditSourceFrom({ ...base, transferred: null, creditBalanceReceipts: rows })).toBeNull();
    expect(exchangeCreditSourceFrom({ ...base, receipt: { ...base.receipt, isVoided: true }, creditBalanceReceipts: rows })).toBeNull();
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/receipts/services/exchange-credit-source.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: เขียน helper**

```ts
// apps/api/src/modules/receipts/services/exchange-credit-source.ts
import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { INSTALLMENT_MONEY_RECEIPT_TYPES } from '../receipt-types.constants';
import {
  DEFECT_EXCHANGE_CN_SOURCE,
  DEFECT_EXCHANGE_CREDIT_IN_FLOW,
} from '../../defect-exchange/defect-exchange-credit';

export interface ExchangeCreditSource {
  parentContractNumber: string;
  transferred: Decimal;
  creditNotes: { number: string; originalNumber: string | null }[];
}

interface CreditBalanceReceiptRow {
  id: string;
  paidDate: Date;
  receiptNumber: string;
  amount: Prisma.Decimal | string | number;
}

/**
 * ที่มาของเครดิตบนใบใช้เครดิต (spec §6 — ตัดสินตอนพิมพ์ ไม่มีคอลัมน์ใหม่): ใบเป็นช่องทาง CREDIT_BALANCE ของสัญญาที่มี
 * สัญญาเดิม และ Σ ใบ CREDIT_BALANCE ที่ยังมีผลของสัญญา เรียงตาม paidDate แล้ว receiptNumber จนถึงใบนี้ ≤ T + 0.01
 * (เครดิตเข้าสัญญาได้ทางเดียวก่อนเปิดใช้ และถูกใช้ทันทีตอนเปิดใช้ ⇒ ใบแรก ๆ เสมอ) · เกิน = เครดิตจากจ่ายเกินทีหลัง
 */
export function exchangeCreditSourceFrom(input: {
  receipt: { id: string; paymentMethod: string | null; receiptType: string; isVoided: boolean };
  parentContractNumber: string | null;
  transferred: Decimal | null;
  creditBalanceReceipts: CreditBalanceReceiptRow[];
  creditNotes: { number: string; originalNumber: string | null }[];
}): ExchangeCreditSource | null {
  const { receipt, parentContractNumber, transferred } = input;
  if (receipt.paymentMethod !== 'CREDIT_BALANCE' || receipt.isVoided) return null;
  if (!(INSTALLMENT_MONEY_RECEIPT_TYPES as readonly string[]).includes(receipt.receiptType)) return null;
  if (!parentContractNumber || !transferred || !transferred.gt(0)) return null;
  const ordered = [...input.creditBalanceReceipts].sort((a, b) =>
    a.paidDate.getTime() !== b.paidDate.getTime()
      ? a.paidDate.getTime() - b.paidDate.getTime()
      : a.receiptNumber.localeCompare(b.receiptNumber),
  );
  let cumulative = new Decimal(0);
  for (const row of ordered) {
    cumulative = cumulative.plus(row.amount.toString());
    if (row.id === receipt.id) {
      return cumulative.lte(transferred.plus('0.01'))
        ? { parentContractNumber, transferred, creditNotes: input.creditNotes }
        : null;
    }
  }
  return null;
}

/** อ่านข้อมูลประกอบจากฐาน แล้วตัดสินด้วย `exchangeCreditSourceFrom` — คืน null เร็วเมื่อไม่ใช่ใบใช้เครดิตของสัญญาเปลี่ยนเครื่อง */
export async function resolveExchangeCreditSource(
  prisma: PrismaClient,
  receipt: { id: string; contractId: string; paymentMethod: string | null; receiptType: string; isVoided: boolean },
  contract: { parentContractId: string | null; parentContract: { contractNumber: string } | null },
): Promise<ExchangeCreditSource | null> {
  if (receipt.paymentMethod !== 'CREDIT_BALANCE' || !contract.parentContractId) return null;
  const creditIn = await prisma.journalEntry.findMany({
    where: { status: 'POSTED', deletedAt: null, metadata: { path: ['contractId'], equals: receipt.contractId } },
    select: { metadata: true },
  });
  let transferred = new Decimal(0);
  for (const e of creditIn) {
    const m = (e.metadata ?? {}) as Record<string, unknown>;
    if (m.flow !== DEFECT_EXCHANGE_CREDIT_IN_FLOW || m.reversed === true) continue;
    if (typeof m.amount === 'string' || typeof m.amount === 'number') transferred = transferred.plus(m.amount);
  }
  const [creditBalanceReceipts, cnRows] = await Promise.all([
    prisma.receipt.findMany({
      where: {
        contractId: receipt.contractId, paymentMethod: 'CREDIT_BALANCE', isVoided: false, deletedAt: null,
        receiptType: { in: [...INSTALLMENT_MONEY_RECEIPT_TYPES] },
      },
      select: { id: true, paidDate: true, receiptNumber: true, amount: true },
    }),
    prisma.receipt.findMany({
      where: { contractId: contract.parentContractId, receiptType: 'CREDIT_NOTE', cnSource: DEFECT_EXCHANGE_CN_SOURCE, deletedAt: null },
      select: { receiptNumber: true, voidedReceiptId: true },
      orderBy: { receiptNumber: 'asc' },
    }),
  ]);
  const originals = cnRows.some((r) => r.voidedReceiptId)
    ? await prisma.receipt.findMany({
        where: { id: { in: cnRows.map((r) => r.voidedReceiptId).filter((x): x is string => !!x) } },
        select: { id: true, receiptNumber: true },
      })
    : [];
  const originalNumber = new Map(originals.map((o) => [o.id, o.receiptNumber]));
  return exchangeCreditSourceFrom({
    receipt,
    parentContractNumber: contract.parentContract?.contractNumber ?? null,
    transferred: transferred.gt(0) ? transferred : null,
    creditBalanceReceipts,
    creditNotes: cnRows.map((r) => ({ number: r.receiptNumber, originalNumber: r.voidedReceiptId ? (originalNumber.get(r.voidedReceiptId) ?? null) : null })),
  });
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/receipts/services/exchange-credit-source.spec.ts`
Expected: PASS 4/4

- [ ] **Step 5: เทสที่ล้ม — HTML ของ PDF (mock puppeteer ตามแบบ `receipt-pdf.service.spec.ts`)**

```ts
// apps/api/src/modules/receipts/services/receipt-pdf.exchange.spec.ts
import { Decimal } from '@prisma/client/runtime/library';
import { ReceiptPdfService } from './receipt-pdf.service';
import { ReceiptQueryService } from './receipt-query.service';

let capturedHtml = '';
jest.mock('puppeteer', () => ({
  launch: jest.fn().mockResolvedValue({
    newPage: jest.fn().mockResolvedValue({
      setContent: jest.fn(async (html: string) => { capturedHtml = html; }),
      evaluate: jest.fn().mockResolvedValue(undefined),
      pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
    }),
    close: jest.fn().mockResolvedValue(undefined),
  }),
}));

const company = { nameTh: 'บริษัท เบสท์ช้อยส์โฟน จำกัด', nameEn: null, taxId: '0165568000050', address: '-', phone: null, logoUrl: null, bankName: null, bankAccountName: null, bankAccountNumber: null };
const contract = {
  contractNumber: 'CT-2569-0418', productDisclosure: null, totalMonths: 12, financedAmount: new Decimal('10000'),
  storeCommission: new Decimal('1000'), interestTotal: new Decimal('6000'), vatAmount: new Decimal('1190'),
  customer: { name: 'ลูกค้าทดสอบ', phone: null, email: null, nationalId: null, addressIdCard: null, addressCurrent: null },
  branch: { id: 'b', name: 'ลาดพร้าว', location: null, phone: null }, product: { id: 'p', name: 'iPhone 14', imeiSerial: '1', serialNumber: null },
  parentContractId: 'ct-old', parentContract: { contractNumber: 'CT-2569-0412' },
};
const base = (overrides: Record<string, unknown>) => ({
  id: 'r', receiptNumber: 'RT-202610-00044', receiptType: 'CREDIT_NOTE', payerName: 'ลูกค้าทดสอบ', receiverName: 'FINANCE',
  payerAddress: null, payerTaxId: null, amount: new Decimal('1515.83'), amountBeforeVat: new Decimal('1416.66'), vatAmount: new Decimal('99.17'),
  roundingAmount: new Decimal(0), lateFeeAmount: new Decimal(0), lateFeeWaivedAmount: new Decimal(0), advanceAmount: new Decimal(0), advanceVatAmount: new Decimal(0),
  installmentNo: 1, paymentId: 'pay-1', voidedReceiptId: 'rc-31', paidDate: new Date('2026-10-15T00:00:00.000Z'), isVoided: false,
  paymentMethod: 'BANK_TRANSFER', transactionRef: null, remainingBalance: null, remainingMonths: null, paymentStatus: 'PENDING', priorReceiptCount: 0,
  voidedRef: { receiptNumber: 'RT-202610-00031', paidDate: new Date('2026-10-10T00:00:00.000Z') }, cnSource: 'DEFECT_EXCHANGE',
  installmentAllocations: [], advanceTargetInstallmentNo: null, payment: null, issuer: { name: 'ผจก.', role: 'BRANCH_MANAGER' },
  company, contract: { ...contract, contractNumber: 'CT-2569-0412' }, exchangeTarget: { contractNumber: 'CT-2569-0418' }, exchangeCreditSource: null,
  ...overrides,
});

describe('ReceiptPdfService — เอกสารเปลี่ยนเครื่องตำหนิ (mockup 7dMBBNTYVZLGDvgG1pk2Yo)', () => {
  let service: ReceiptPdfService;
  const query = { getReceipt: jest.fn() };
  beforeEach(() => { capturedHtml = ''; service = new ReceiptPdfService(query as unknown as ReceiptQueryService); });

  it('ใบลดหนี้ cnSource DEFECT_EXCHANGE: ข้อความกล่องเหลือง · รายการ · ผลของการลดหนี้ 3 บรรทัด · ม.86/10', async () => {
    query.getReceipt.mockResolvedValue(base({}));
    await service.generatePDF('r');
    expect(capturedHtml).toContain('ใบลดหนี้');
    expect(capturedHtml).toContain('เนื่องจากเปลี่ยนเครื่องตำหนิภายใน 7 วัน');
    expect(capturedHtml).toContain('โอนเป็นเครดิตของสัญญาใหม่ <strong>CT-2569-0418</strong>');
    expect(capturedHtml).toContain('ลดหนี้ — เปลี่ยนเครื่องตำหนิภายใน 7 วัน');
    expect(capturedHtml).toContain('ตามใบเสร็จ RT-202610-00031 · เหตุผล: เปลี่ยนเครื่องตำหนิภายใน 7 วัน (ม.82/10 (3))');
    expect(capturedHtml).toContain('<div class="heading">ผลของการลดหนี้</div>');
    expect(capturedHtml).toContain('<span class="k">เงินของลูกค้า</span><span class="v">1,515.83 บาท — ไม่คืนเงินสด</span>');
    expect(capturedHtml).toContain('<span class="k">โอนเป็นเครดิต</span><span class="v">สัญญาใหม่ CT-2569-0418</span>');
    expect(capturedHtml).toContain('<span class="k">ใช้เครดิต</span><span class="v">ชำระค่างวดของสัญญาใหม่ (ใบกำกับภาษีใหม่)</span>');
    expect(capturedHtml).toContain('ใบลดหนี้ตามมาตรา 86/10');
    expect(capturedHtml).not.toContain('งวดนี้กลับเป็นยอดค้างชำระ');
  });

  it('ใบลดหนี้ void ปกติ (cnSource null) ไม่เปลี่ยน', async () => {
    query.getReceipt.mockResolvedValue(base({ cnSource: null, exchangeTarget: null }));
    await service.generatePDF('r');
    expect(capturedHtml).toContain('ยอดตามใบเสร็จเดิมถูกกลับรายการทั้งจำนวน');
    expect(capturedHtml).toContain('กลับรายการ — งวดนี้กลับเป็นยอดค้างชำระ');
    expect(capturedHtml).not.toContain('เปลี่ยนเครื่องตำหนิ');
  });

  it('ใบใช้เครดิตของสัญญาใหม่: บรรทัดรอง · ที่มาของเครดิต · กล่องเหลือง · แถวในรายละเอียดสัญญา', async () => {
    query.getReceipt.mockResolvedValue(base({
      receiptNumber: 'RT-202610-00045', receiptType: 'INSTALLMENT', voidedReceiptId: null, voidedRef: null, cnSource: null,
      paymentMethod: 'CREDIT_BALANCE', paymentStatus: 'PAID', remainingBalance: new Decimal('16674.17'), remainingMonths: 11,
      contract, exchangeTarget: null,
      exchangeCreditSource: { parentContractNumber: 'CT-2569-0412', transferred: new Decimal('1515.83'), creditNotes: [{ number: 'RT-202610-00044', originalNumber: 'RT-202610-00031' }] },
    }));
    await service.generatePDF('r');
    expect(capturedHtml).toContain('ใบเสร็จรับเงิน / ใบกำกับภาษี');
    expect(capturedHtml).toContain('ชำระด้วยเครดิตจากการเปลี่ยนเครื่อง · สัญญาเดิม CT-2569-0412');
    expect(capturedHtml).toContain('<span class="k">ที่มาของเครดิต</span><span class="v">เปลี่ยนเครื่องตำหนิ — สัญญา CT-2569-0412</span>');
    expect(capturedHtml).toContain('ชำระด้วยเครดิต 1,515.83 บาท ที่โอนมาจากสัญญาเดิม <strong>CT-2569-0412</strong>');
    expect(capturedHtml).toContain('ใบเสร็จเดิม RT-202610-00031 ถูกลดหนี้ด้วยใบลดหนี้ RT-202610-00044');
    expect(capturedHtml).toContain('เปลี่ยนเครื่องจากสัญญา CT-2569-0412 (ใบลดหนี้ RT-202610-00044)');
    expect(capturedHtml).toContain('ใช้ยอดเครดิตในสัญญา');
  });

  it('ใบใช้เครดิตที่ไม่ได้มาจากการเปลี่ยนเครื่อง (exchangeCreditSource null) ไม่มีบรรทัดรอง', async () => {
    query.getReceipt.mockResolvedValue(base({ receiptType: 'INSTALLMENT', voidedReceiptId: null, voidedRef: null, cnSource: null, paymentMethod: 'CREDIT_BALANCE', contract, exchangeTarget: null, exchangeCreditSource: null }));
    await service.generatePDF('r');
    expect(capturedHtml).not.toContain('ที่มาของเครดิต');
    expect(capturedHtml).not.toContain('ชำระด้วยเครดิตจากการเปลี่ยนเครื่อง');
  });
});
```

- [ ] **Step 6: รันให้ล้ม**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/receipts/services/receipt-pdf.exchange.spec.ts`
Expected: FAIL — ข้อความ "เนื่องจากเปลี่ยนเครื่องตำหนิ…" ไม่อยู่ใน HTML

- [ ] **Step 7: แก้ `receipt-query.service.ts` + `receipt-pdf.service.ts`**

`receipt-query.service.ts` — import `import { resolveExchangeCreditSource } from './exchange-credit-source';` `import { DEFECT_EXCHANGE_CN_SOURCE } from '../../defect-exchange/defect-exchange-credit';` · ใน `getReceipt` select ของ `contract` เพิ่ม `parentContractId: true, parentContract: { select: { contractNumber: true } },` · หลัง `const voidedRef = …` เพิ่ม:

```ts
    // 15ข — ใบลดหนี้เปลี่ยนเครื่องอ้างสัญญาใหม่ (ลูกของสัญญานี้) · ใบใช้เครดิตบอกที่มา (ตัดสินตอนพิมพ์ — spec §6)
    const exchangeTarget =
      receipt.receiptType === 'CREDIT_NOTE' && receipt.cnSource === DEFECT_EXCHANGE_CN_SOURCE
        ? await this.prisma.contract.findFirst({
            where: { parentContractId: receipt.contractId, deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { contractNumber: true },
          })
        : null;
    const exchangeCreditSource = await resolveExchangeCreditSource(this.prisma, receipt, receipt.contract);
```

และใน `return { … }` เพิ่ม `exchangeTarget, exchangeCreditSource,`

`receipt-pdf.service.ts`:
- หลัง `const isCreditNote = receiptType === 'CREDIT_NOTE';` (L202): `const isExchangeCn = isCreditNote && receipt.cnSource === 'DEFECT_EXCHANGE';` และ `const exchangeSrc = receipt.exchangeCreditSource ?? null;`
- `itemLabels.CREDIT_NOTE` → `CREDIT_NOTE: isExchangeCn ? 'ลดหนี้ — เปลี่ยนเครื่องตำหนิภายใน 7 วัน' : 'ลดหนี้ — ยกเลิกใบเสร็จ',`
- บล็อก cn-notice (L461–467) → แทนทั้ง ternary ด้วย:

```ts
  ${isExchangeCn && receipt.voidedRef ? `
    <div class="cn-notice">
      เอกสารนี้ออกเพื่อยกเลิกใบเสร็จรับเงิน / ใบกำกับภาษีเลขที่ <strong>${this.escapeHtml(receipt.voidedRef.receiptNumber)}</strong>
      ลงวันที่ ${formatDateShort(receipt.voidedRef.paidDate)} เนื่องจากเปลี่ยนเครื่องตำหนิภายใน 7 วัน — ยอดตามใบเสร็จเดิมถูกกลับรายการทั้งจำนวน
      และโอนเป็นเครดิตของสัญญาใหม่ <strong>${this.escapeHtml(receipt.exchangeTarget?.contractNumber ?? '-')}</strong>
      (ใช้ชำระค่างวดของสัญญาใหม่ · ภาษีมูลค่าเพิ่มจะออกใบกำกับภาษีใหม่เมื่อใช้เครดิต)
    </div>` : isCreditNote && receipt.voidedRef ? `
    <div class="cn-notice">
      เอกสารนี้ออกเพื่อยกเลิกใบเสร็จรับเงินเลขที่ <strong>${this.escapeHtml(receipt.voidedRef.receiptNumber)}</strong>
      ลงวันที่ ${formatDateShort(receipt.voidedRef.paidDate)} — ยอดตามใบเสร็จเดิมถูกกลับรายการทั้งจำนวน
    </div>` : isCreditNote ? `
    <div class="cn-notice">
      อ้างอิง: เลิกสัญญา <strong>${safe.contractNumber || '-'}</strong> — ใบลดหนี้ตามมาตรา 82/5
    </div>` : exchangeSrc ? `
    <div class="cn-notice">
      ชำระด้วยเครดิต ${fmt(total)} บาท ที่โอนมาจากสัญญาเดิม <strong>${this.escapeHtml(exchangeSrc.parentContractNumber)}</strong>
      (${exchangeSrc.creditNotes.map((n) => `ใบเสร็จเดิม ${this.escapeHtml(n.originalNumber ?? '-')} ถูกลดหนี้ด้วยใบลดหนี้ ${this.escapeHtml(n.number)}`).join(' · ')})
      — ภาษีมูลค่าเพิ่มของค่างวดนี้ออกใบกำกับภาษีฉบับนี้ ไม่มีเงินสดรับเพิ่ม
    </div>` : ''}
```

- แถวรายการ (L481–486): หลัง `<div class="item-name">${itemLabel}</div>` แทนบรรทัด item-meta เดิมด้วย:

```ts
          ${isExchangeCn && receipt.voidedRef ? `<div class="item-meta">ตามใบเสร็จ ${this.escapeHtml(receipt.voidedRef.receiptNumber)} · เหตุผล: เปลี่ยนเครื่องตำหนิภายใน 7 วัน (ม.82/10 (3))</div>` : ''}
          ${safe.productName && !isCreditNote ? `<div class="item-meta">${safe.productName}${safe.imeiSerial ? ` · IMEI ${safe.imeiSerial}` : ''}</div>` : ''}
          ${exchangeSrc ? `<div class="item-meta">ชำระด้วยเครดิตจากการเปลี่ยนเครื่อง · สัญญาเดิม ${this.escapeHtml(exchangeSrc.parentContractNumber)}</div>` : ''}
```

- รายละเอียดสัญญา (ในบล็อก `<div class="party-heading">รายละเอียดสัญญา</div>` ท้ายสุด) เพิ่ม:

```ts
      ${exchangeSrc ? `<div class="party-line">เปลี่ยนเครื่องจากสัญญา ${this.escapeHtml(exchangeSrc.parentContractNumber)} (ใบลดหนี้ ${exchangeSrc.creditNotes.map((n) => this.escapeHtml(n.number)).join(', ')})</div>` : ''}
```

- การชำระเงิน (L556 หลังแถวช่องทาง): `${exchangeSrc ? `<span class="k">ที่มาของเครดิต</span><span class="v">เปลี่ยนเครื่องตำหนิ — สัญญา ${this.escapeHtml(exchangeSrc.parentContractNumber)}</span>` : ''}`
- สถานะ (L564–566): แทน `${isCreditNote ? \`<span class="k">สถานะ</span>…\` : \`…\`}` ด้วย:

```ts
        ${isExchangeCn
          ? `<span class="k">เงินของลูกค้า</span><span class="v">${fmt(total)} บาท — ไม่คืนเงินสด</span>
        <span class="k">โอนเป็นเครดิต</span><span class="v">สัญญาใหม่ ${this.escapeHtml(receipt.exchangeTarget?.contractNumber ?? '-')}</span>
        <span class="k">ใช้เครดิต</span><span class="v">ชำระค่างวดของสัญญาใหม่ (ใบกำกับภาษีใหม่)</span>`
          : isCreditNote
          ? `<span class="k">สถานะ</span><span class="v">กลับรายการ — งวดนี้กลับเป็นยอดค้างชำระ</span>`
          : `
```
(ส่วนท้ายของ ternary เดิมคงไว้)
- doc-note ท้ายใบ (L595): `… · ตรวจสอบได้ที่ QR ด้านซ้าย${isExchangeCn ? ' · ใบลดหนี้ตามมาตรา 86/10' : ''}</div>`
- หัวข้อ "สถานะสัญญาหลังชำระ" เมื่อ `isExchangeCn` → `ผลของการลดหนี้`: `<div class="heading">${isExchangeCn ? 'ผลของการลดหนี้' : 'สถานะสัญญาหลังชำระ'}</div>`

- [ ] **Step 8: รันให้ผ่าน + spec PDF เดิม + types**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/receipts/ && cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && ./tools/check-types.sh api`
Expected: PASS ทั้งโฟลเดอร์ (spec เดิม `receipt-pdf.service.spec.ts` ไม่แตะ — ใบ void CN/JP5 CN พิมพ์เท่าเดิม) · 0 type errors (mock ของ `getReceipt` ในเทสเดิมไม่มี `exchangeTarget` — โค้ดอ่านด้วย `?.`/`?? null` จึงไม่ล้ม)

- [ ] **Step 8ข: ใบลดหนี้เปลี่ยนเครื่องต้อง 1 หน้า (บทเรียน #1703 ใบ 6a ล้น 2 หน้า) — render จริงจาก DB ทดสอบ (local เท่านั้น ไม่ commit)**

หลัง Task 7 ผ่าน (DB ทดสอบมีใบลดหนี้ `cnSource DEFECT_EXCHANGE` และใบใช้เครดิตค้างอยู่หลังเคส 1 — รัน Task 7 ใหม่ถ้าล้างไปแล้ว แล้วหยุดก่อน afterAll ไม่ได้ ⇒ ใช้เคส 1 ซ้ำผ่านสคริปต์นี้ซึ่งอ่านใบที่ **เพิ่งสร้าง** ในรอบเดียวกัน) เขียนสคริปต์ที่ scratchpad `/private/tmp/claude-501/-Users-iamnaii-Desktop-App/cacc0b32-ebd9-467c-9db6-598a612c54c8/scratchpad/render-cn.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'fs';
import { ReceiptQueryService } from '/Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api/src/modules/receipts/services/receipt-query.service';
import { ReceiptPdfService } from '/Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api/src/modules/receipts/services/receipt-pdf.service';

const prisma = new PrismaClient();
(async () => {
  const query = new ReceiptQueryService(prisma as never);
  const pdf = new ReceiptPdfService(query);
  const cn = await prisma.receipt.findFirstOrThrow({ where: { cnSource: 'DEFECT_EXCHANGE' }, orderBy: { createdAt: 'desc' } });
  const cr = await prisma.receipt.findFirstOrThrow({ where: { paymentMethod: 'CREDIT_BALANCE', isVoided: false }, orderBy: { createdAt: 'desc' } });
  for (const [name, id] of [['cn', cn.id], ['credit', cr.id]] as const) {
    const buf = await pdf.generatePDF(id);
    const out = `/private/tmp/claude-501/-Users-iamnaii-Desktop-App/cacc0b32-ebd9-467c-9db6-598a612c54c8/scratchpad/${name}.pdf`;
    writeFileSync(out, buf);
    const pages = (buf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
    console.log(name, out, 'pages =', pages);
  }
  await prisma.$disconnect();
})();
```

Run: `source ~/Documents/BESTCHOICE-docs/pr4-advance-vat/test-env.sh && cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx vitest run --root /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api --no-file-parallelism src/modules/defect-exchange/__tests__/defect-exchange-credit.integration.spec.ts -t '1\)' >/dev/null; npx ts-node --transpile-only /private/tmp/claude-501/-Users-iamnaii-Desktop-App/cacc0b32-ebd9-467c-9db6-598a612c54c8/scratchpad/render-cn.ts`
Expected: `cn … pages = 1` และ `credit … pages = 1` — แล้วเปิดทั้งสองไฟล์ด้วย Read tool เทียบกับ mockup กระดาน 1–2 (ฟอนต์ไทยครบ · กล่องเหลือง · ผลของการลดหนี้ 3 บรรทัด · ที่มาของเครดิต) · ล้น 2 หน้า = ย่อข้อความกล่องเหลือง/แถวสถานะก่อน commit (ห้ามลดขนาดฟอนต์ของใบทั้งใบ) · เคส 1 ของ integration ล้าง ledger ตอน afterAll ⇒ ถ้าสคริปต์หาใบไม่เจอ ให้ comment `cleanLedger()` ใน afterAll ชั่วคราวระหว่างรัน (คืนค่าก่อน commit)

- [ ] **Step 9: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && git add apps/api/src/modules/receipts && git commit -q -F - <<'MSG'
feat(receipts): ใบลดหนี้เปลี่ยนเครื่องตำหนิ + ใบใช้เครดิตบอกที่มา (mockup 7dMBBNTYVZLGDvgG1pk2Yo กระดาน 1–2)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

### Task 10: หลังการขาย — ข้อความ event ยืนยัน + ส่งผลเครดิตกลับ

**Files:**
- Create: `apps/api/src/modules/after-sales/utils/exchange-confirm-note.ts`
- Test: `apps/api/src/modules/after-sales/__tests__/exchange-confirm-note.spec.ts` (ใหม่ — jest)
- Modify: `apps/api/src/modules/after-sales/services/after-sales-exchange.service.ts` (L262–300 ใน `confirmSameModel`)

**Interfaces:**
- Consumes: `execute()` คืน `creditNoteNumbers`, `transferredCredit` (Task 6)
- Produces: `exchangeConfirmNote(i: { newContractNumber: string; outOfWindow: boolean; fromRepair: boolean; creditNoteCount: number; transferredCredit: string }): string` · `confirmSameModel()` คืนเพิ่ม `creditNoteNumbers: string[]`, `transferredCredit: string` · audit `AFTER_SALES_EXCHANGE_CONFIRMED.newValue` เพิ่มสองฟิลด์เดียวกัน

- [ ] **Step 1: เขียนเทสที่ล้ม**

```ts
// apps/api/src/modules/after-sales/__tests__/exchange-confirm-note.spec.ts
import { exchangeConfirmNote } from '../utils/exchange-confirm-note';

describe('exchangeConfirmNote — ข้อความ event ยืนยันเปลี่ยนเครื่อง (spec §8 ไทม์ไลน์)', () => {
  it('ไม่มีใบลดหนี้: ข้อความเดิมทุกตัวอักษร', () => {
    expect(exchangeConfirmNote({ newContractNumber: 'CT-NEW', outOfWindow: false, fromRepair: false, creditNoteCount: 0, transferredCredit: '0.00' }))
      .toBe('ยืนยันเปลี่ยนเครื่อง · สัญญาใหม่ CT-NEW');
    expect(exchangeConfirmNote({ newContractNumber: 'CT-NEW', outOfWindow: true, fromRepair: true, creditNoteCount: 0, transferredCredit: '0.00' }))
      .toBe('ยืนยันเปลี่ยนเครื่อง · สัญญาใหม่ CT-NEW · ข้ามกรอบ 7 วัน · จากใบซ่อม (ซ่อมไม่ได้)');
  });
  it('มีใบลดหนี้: ต่อท้าย "ใบลดหนี้ N ใบ · เครดิต T บาท ย้ายไปสัญญาใหม่" (ตัวเลขมีจุลภาค)', () => {
    expect(exchangeConfirmNote({ newContractNumber: 'CT-NEW', outOfWindow: false, fromRepair: false, creditNoteCount: 1, transferredCredit: '1515.83' }))
      .toBe('ยืนยันเปลี่ยนเครื่อง · สัญญาใหม่ CT-NEW · ใบลดหนี้ 1 ใบ · เครดิต 1,515.83 บาท ย้ายไปสัญญาใหม่');
  });
  it('เครดิตจากเงินค้างอย่างเดียว (ไม่มีใบ): บอกเครดิตอย่างเดียว', () => {
    expect(exchangeConfirmNote({ newContractNumber: 'CT-NEW', outOfWindow: false, fromRepair: false, creditNoteCount: 0, transferredCredit: '300.00' }))
      .toBe('ยืนยันเปลี่ยนเครื่อง · สัญญาใหม่ CT-NEW · เครดิต 300.00 บาท ย้ายไปสัญญาใหม่');
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/after-sales/__tests__/exchange-confirm-note.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: เขียน util + ต่อเข้า service**

```ts
// apps/api/src/modules/after-sales/utils/exchange-confirm-note.ts
/** ข้อความ event APPROVED ของการยืนยันเปลี่ยนเครื่อง (ส่วนเดิมคงถ้อยคำเดิมทุกตัวอักษร · 15ข ต่อท้ายใบลดหนี้/เครดิต) */
export function exchangeConfirmNote(i: {
  newContractNumber: string;
  outOfWindow: boolean;
  fromRepair: boolean;
  creditNoteCount: number;
  transferredCredit: string;
}): string {
  const parts = [`ยืนยันเปลี่ยนเครื่อง · สัญญาใหม่ ${i.newContractNumber}`];
  if (i.outOfWindow) parts.push('ข้ามกรอบ 7 วัน');
  if (i.fromRepair) parts.push('จากใบซ่อม (ซ่อมไม่ได้)');
  if (i.creditNoteCount > 0) parts.push(`ใบลดหนี้ ${i.creditNoteCount} ใบ`);
  if (Number(i.transferredCredit) > 0) {
    parts.push(`เครดิต ${Number(i.transferredCredit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท ย้ายไปสัญญาใหม่`);
  }
  return parts.join(' · ');
}
```

ใน `after-sales-exchange.service.ts` `confirmSameModel`: import `exchangeConfirmNote` · แทน template string ของ `note:` ด้วย

```ts
            note: exchangeConfirmNote({
              newContractNumber: newContract.contractNumber,
              outOfWindow,
              fromRepair,
              creditNoteCount: res.creditNoteNumbers.length,
              transferredCredit: res.transferredCredit,
            }),
```

audit `newValue: { newContractId: newContract.id, bypass: outOfWindow, fromRepair, creditNoteNumbers: res.creditNoteNumbers, transferredCredit: res.transferredCredit }` · return เพิ่ม `creditNoteNumbers: res.creditNoteNumbers, transferredCredit: res.transferredCredit,`

- [ ] **Step 4: รันให้ผ่าน + spec เดิมของ after-sales (jest) + types**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand src/modules/after-sales/__tests__/exchange-confirm-note.spec.ts src/modules/after-sales/__tests__/exchange-service.spec.ts && cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && ./tools/check-types.sh api`
Expected: PASS · 0 type errors (ถ้า `exchange-service.spec.ts` mock `defect.execute` คืนค่าที่ไม่มี `creditNoteNumbers` → เติม `creditNoteNumbers: [], transferredCredit: '0.00'` ใน mock นั้น)

- [ ] **Step 5: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && git add apps/api/src/modules/after-sales && git commit -q -F - <<'MSG'
feat(after-sales): event ยืนยันเปลี่ยนเครื่องบอกใบลดหนี้/เครดิตที่ย้าย + ส่งผลกลับ (15ข)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 11: กล่องยืนยันหลังการขาย — ตารางใบเสร็จที่จะออกใบลดหนี้ + ยอดเครดิต (mockup กระดาน 3)

**Files:**
- Modify: `apps/web/src/pages/after-sales/ExchangeActionDialogs.tsx` (`ConfirmExchangeDialog` L51–241)
- Test: `apps/web/src/pages/after-sales/ExchangeActionDialogs.credit.test.tsx` (ใหม่ — vitest + testing-library · mock `@/lib/api` ตามแบบ `TicketRedirect.test.tsx`)

**Interfaces:**
- Consumes: `GET /defect-exchange/eligibility/:contractId` → `{ receiptsToCreditNote: { id; receiptNumber; receiptType; installmentNo: number | null; paidDate: string; paymentMethod: string | null; amount: string; vatAmount: string | null }[]; creditToTransfer: string }` (Task 5 · roles OWNER/BM/SALES)
- Produces: กล่องยืนยันกิ่งสัญญาผ่อนแสดงตาราง + แถบเครดิต + bullet ใหม่เมื่อมีใบ/เงิน · ไม่มี = เหมือนวันนี้

- [ ] **Step 1: เขียนเทสที่ล้ม**

```tsx
// apps/web/src/pages/after-sales/ExchangeActionDialogs.credit.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmExchangeDialog } from './ExchangeActionDialogs';
import type { CaseDetail } from './after-sales';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post },
  getErrorMessage: (error: Error) => error.message,
}));
vi.mock('./ReplacementProductPicker', () => ({ default: () => <div>picker</div> }));

const baseCase = {
  id: 'case-1',
  outcome: 'SAME_MODEL_EXCHANGE',
  stage: 'AWAITING_APPROVAL',
  contractId: 'ct-old',
  saleId: null,
  replacementProductId: 'p-new',
  replacementContractId: null,
  contract: { id: 'ct-old', contractNumber: 'CT-2569-0412', status: 'ACTIVE' },
} as unknown as CaseDetail;

function renderDialog(data: CaseDetail) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConfirmExchangeDialog caseId="case-1" open onOpenChange={() => undefined} data={data} />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('ConfirmExchangeDialog — ใบเสร็จที่จะออกใบลดหนี้ + เครดิต (15ข · mockup กระดาน 3)', () => {
  it('มีใบรับเงิน: ตารางใบเสร็จ · ยอดเครดิตที่จะย้าย · bullet ใบลดหนี้/ไม่คืนเงินสด/ใช้เครดิตตอนเปิดใช้', async () => {
    mocks.get.mockResolvedValue({
      data: {
        receiptsToCreditNote: [
          { id: 'rc-1', receiptNumber: 'RT-202610-00031', receiptType: 'INSTALLMENT', installmentNo: 1, paidDate: '2026-10-10T03:00:00.000Z', paymentMethod: 'BANK_TRANSFER', amount: '1515.83', vatAmount: '99.17' },
        ],
        creditToTransfer: '1515.83',
      },
    });
    renderDialog(baseCase);
    expect(await screen.findByText('RT-202610-00031')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/defect-exchange/eligibility/ct-old');
    expect(screen.getByText(/ใบเสร็จของสัญญาเดิมที่จะออกใบลดหนี้/)).toBeInTheDocument();
    expect(screen.getByText(/ค่างวดงวดที่ 1/)).toBeInTheDocument();
    expect(screen.getByText(/เครดิตที่จะย้ายไปสัญญาใหม่ \(ไม่คืนเงินสด\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/1,515\.83/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/ออกใบลดหนี้ให้ใบเสร็จ\/ใบกำกับภาษีของสัญญาเดิมทุกใบ — ไม่ส่ง LINE/)).toBeInTheDocument();
    expect(screen.getByText(/เงินที่ลูกค้าจ่ายแล้วย้ายเป็นเครดิตของสัญญาใหม่ — ไม่คืนเงินสด ธนาคารไม่ขยับ/)).toBeInTheDocument();
    expect(screen.getByText(/เมื่อเปิดใช้ ระบบใช้เครดิตชำระงวดที่ 1 ทันทีและออกใบเสร็จ\/ใบกำกับภาษีใหม่/)).toBeInTheDocument();
  });

  it('ไม่มีใบ ไม่มีเงินค้าง: กล่องเหมือนวันนี้ (ไม่มีตาราง ไม่มี bullet ใบลดหนี้)', async () => {
    mocks.get.mockResolvedValue({ data: { receiptsToCreditNote: [], creditToTransfer: '0.00' } });
    renderDialog(baseCase);
    expect(await screen.findByText(/สัญญาเดิมปิดเป็น/)).toBeInTheDocument();
    expect(screen.queryByText(/ใบเสร็จของสัญญาเดิมที่จะออกใบลดหนี้/)).toBeNull();
    expect(screen.queryByText(/ไม่ส่ง LINE/)).toBeNull();
    expect(screen.getByText(/ต้องเปิดใช้ที่หน้าสัญญาก่อนส่งมอบ/)).toBeInTheDocument();
  });

  it('เคสขายสด: ไม่เรียก eligibility ของสัญญาผ่อน', async () => {
    mocks.get.mockResolvedValue({ data: { saleNumber: 'S-1', oldCost: '1', newCost: '1', lines: [] } });
    renderDialog({ ...baseCase, outcome: 'CASH_SAME_MODEL_EXCHANGE', contractId: null, saleId: 'sale-1' } as unknown as CaseDetail);
    await screen.findAllByText(/สลับเครื่องบนใบขายเดิม/); // อยู่ทั้งใน DialogDescription และ bullet
    expect(mocks.get.mock.calls.some((c) => String(c[0]).startsWith('/defect-exchange/eligibility'))).toBe(false);
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/web && npx vitest run src/pages/after-sales/ExchangeActionDialogs.credit.test.tsx`
Expected: FAIL — ไม่พบ "RT-202610-00031"

- [ ] **Step 3: แก้ dialog**

ใน `ConfirmExchangeDialog` หลัง `const preview = useQuery<…>({ … })` เพิ่ม:

```tsx
  // 15ข — กิ่งสัญญาผ่อน: ใบรับเงินของสัญญาเดิมที่จะออกใบลดหนี้ + เครดิตที่จะย้าย (checkEligibility — แหล่งเดียวกับ engine)
  const credit = useQuery<{
    receiptsToCreditNote: {
      id: string;
      receiptNumber: string;
      receiptType: string;
      installmentNo: number | null;
      paidDate: string;
      paymentMethod: string | null;
      amount: string;
      vatAmount: string | null;
    }[];
    creditToTransfer: string;
  }>({
    queryKey: ['defect-exchange', 'eligibility', data.contractId],
    queryFn: async () => (await api.get(`/defect-exchange/eligibility/${data.contractId}`)).data,
    enabled: open && !isCash && !!data.contractId,
  });
  const receipts = credit.data?.receiptsToCreditNote ?? [];
  const creditToTransfer = credit.data?.creditToTransfer ?? '0.00';
  const hasCredit = receipts.length > 0 || Number(creditToTransfer) > 0;
```

ค่าคงที่ระดับไฟล์ (ใต้ `areaClass`):

```tsx
const METHOD_SHORT: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอน',
  QR_EWALLET: 'QR',
  CARD: 'บัตร',
  ONLINE_GATEWAY: 'ลิงก์ชำระ',
  CREDIT_BALANCE: 'เครดิต',
};
const thDate = (iso: string) => new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
```

ใน JSX กิ่ง `!isCash` ของกล่องเหลือง แทน `<ul>` เดิม 3 ข้อด้วย:

```tsx
            <ul className="list-disc space-y-0.5 pl-4">
              <li>สัญญาเดิมปิดเป็น &quot;เปลี่ยนเครื่องชำรุด&quot; และกลับรายการบัญชีอัตโนมัติ</li>
              {hasCredit && (
                <>
                  <li>ออกใบลดหนี้ให้ใบเสร็จ/ใบกำกับภาษีของสัญญาเดิมทุกใบ — ไม่ส่ง LINE</li>
                  <li>เงินที่ลูกค้าจ่ายแล้วย้ายเป็นเครดิตของสัญญาใหม่ — ไม่คืนเงินสด ธนาคารไม่ขยับ</li>
                </>
              )}
              <li>
                เปิดสัญญาใหม่เงื่อนไขเดิมด้วยเครื่องที่เลือก — ต้องเปิดใช้ที่หน้าสัญญาก่อนส่งมอบ
                {hasCredit ? ' · เมื่อเปิดใช้ ระบบใช้เครดิตชำระงวดที่ 1 ทันทีและออกใบเสร็จ/ใบกำกับภาษีใหม่' : ''}
              </li>
              <li>เครื่องเดิม → รอส่งเคลมผู้จัดจำหน่าย · บันทึกผู้ยืนยันในไทม์ไลน์</li>
            </ul>
```

และก่อน `{isCash && preview.data && (` เพิ่มบล็อก:

```tsx
        {!isCash && hasCredit && (
          <div className="space-y-2 rounded-lg border border-border bg-muted p-3 text-xs leading-snug">
            <p className="font-semibold text-foreground">ใบเสร็จของสัญญาเดิมที่จะออกใบลดหนี้</p>
            {receipts.length > 0 && (
              <table className="w-full">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-0.5 pr-2 text-left font-normal">เลขที่</th>
                    <th className="py-0.5 pr-2 text-left font-normal">รายการ</th>
                    <th className="py-0.5 pr-2 text-left font-normal">วันที่ชำระ</th>
                    <th className="py-0.5 text-right font-normal">ยอด</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => (
                    <tr key={r.id}>
                      <td className="py-0.5 pr-2 font-mono">{r.receiptNumber}</td>
                      <td className="py-0.5 pr-2">{r.installmentNo ? `ค่างวดงวดที่ ${r.installmentNo}` : 'การรับชำระเงิน'}</td>
                      <td className="py-0.5 pr-2">
                        {thDate(r.paidDate)}
                        {r.paymentMethod ? ` · ${METHOD_SHORT[r.paymentMethod] ?? r.paymentMethod}` : ''}
                      </td>
                      <td className="py-0.5 text-right">{baht(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="flex items-center justify-between rounded-md bg-primary/10 px-2 py-1.5 font-semibold text-primary">
              <span>เครดิตที่จะย้ายไปสัญญาใหม่ (ไม่คืนเงินสด)</span>
              <span>{baht(creditToTransfer)} บาท</span>
            </div>
          </div>
        )}
        {!isCash && credit.isError && (
          <p className="text-xs leading-snug text-destructive">{getErrorMessage(credit.error)}</p>
        )}
```

(`baht` รับสตริงตัวเลขอยู่แล้ว — ใช้กับ `preview.data.oldCost` เดิม)

- [ ] **Step 4: รันให้ผ่าน + types web + typography check**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/web && npx vitest run src/pages/after-sales/ && cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && ./tools/check-types.sh web && node tools/check-admin-typography.mjs`
Expected: PASS ทั้งโฟลเดอร์ (ถ้า `baht()` คืนรูปแบบอื่นที่ไม่ใช่ `1,515.83` ให้ปรับ regex ในเทสตามรูปแบบจริงของ util — ห้ามแก้ util) · 0 type errors · typography PASS (ใช้ token `text-primary`/`bg-primary/10`/`text-muted-foreground` ไม่มี hex/gray · `leading-snug` กับข้อความไทย)

- [ ] **Step 5: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && git add apps/web/src/pages/after-sales/ExchangeActionDialogs.tsx apps/web/src/pages/after-sales/ExchangeActionDialogs.credit.test.tsx && git commit -q -F - <<'MSG'
feat(web): กล่องยืนยันเปลี่ยนเครื่อง — ตารางใบเสร็จที่จะออกใบลดหนี้ + เครดิตที่จะย้าย (mockup 7dMBBNTYVZLGDvgG1pk2Yo กระดาน 3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 12: เอกสาร · เวอร์ชัน · ตรวจทานทั้งชุด · ผู้ตรวจอิสระ · PR

**Files:**
- Modify: `.claude/rules/accounting.md` (หัวข้อใหม่ก่อน `## Device Swap — Priced Exchange (2026-07-29)` · bullet "เครดิตจากการเปลี่ยนเครื่องเสียภายใน 7 วัน" L1397–1400 · แถว `ContractCloseFlow`)
- Modify: `.claude/CLAUDE.md` (Important Notes — bullet หลัง "เปลี่ยนเครื่องแบบมีราคา (device swap) ปิดใช้")
- Modify: `apps/web/package.json` (`version` → `26.10.36`)

- [ ] **Step 1: accounting.md — หัวข้อใหม่ (วางก่อน `## Device Swap — Priced Exchange (2026-07-29)`)**

```markdown
## เปลี่ยนเครื่องตำหนิ 7 วัน เมื่อสัญญาเดิมมีการชำระแล้ว — ใบลดหนี้ + เครดิต 21-5101 (15ข/18.3ข · 2026-10-17)

Spec: `docs/superpowers/specs/2026-10-17-defect-exchange-credit-note-design.md` · Plan: `docs/superpowers/plans/2026-10-17-defect-exchange-credit-note.md` ·
คำตอบฝ่ายบัญชี 16/10/2569 ข้อ 15 (ข) + 18.3 (ข) · คำตัดสินเจ้าของ 17/10/2569: ทำตามคำตอบตรงตัว · เงินผ่าน **21-1106 ไม่แตะธนาคาร** · ใช้เครดิต
ชำระงวดสัญญาใหม่**อัตโนมัติตอนเปิดใช้** · **ไม่ส่งใบลดหนี้ทาง LINE** · mockup `https://claude.ai/artifact/7dMBBNTYVZLGDvgG1pk2Yo`.
โค้ด: `defect-exchange/defect-exchange.service.ts` (`execute` ก/ค/ข/ง · `checkEligibility`) · `defect-exchange/defect-exchange-credit.ts` ·
`receipts/services/receipt-void-core.ts` (`voidReceiptInTx` — ส่วนใน tx ของการยกเลิกใบเสร็จ ใช้ร่วมกับ `ReceiptVoidService`) ·
`journal/cpa-templates/receipt-void-reversal.template.ts` (`redirect`) · `journal/cpa-templates/defect-exchange-reversal.template.ts` ·
`contracts/services/exchange-credit-autoapply.ts` · Integration: `defect-exchange/__tests__/defect-exchange-credit.integration.spec.ts` (CI glob `DEFECT_FILES`).

**ด่าน C-6 (#780 · Wave 3 ปพพ.386) "มีรายการชำระแล้ว → ปฏิเสธ" ถูกถอด** — ก่อน 2026-10-17 การเปลี่ยนเครื่องตำหนิของสัญญาที่จ่ายงวดแล้วทำไม่ได้เลย
(โค้ดโอนเครดิตเดิมเป็น dead code · คำถามข้อ 15 ที่ส่งฝ่ายบัญชี 11/10 บรรยายฉากที่ไม่เคยเกิด — เจ้าของเลือก (ข) อยู่ดี).

| ขั้น (tx Serializable เดิมของ `execute`) | รายการ |
|---|---|
| ก ยกเลิกใบรับเงินทุกใบที่ยังมีผลของสัญญาเดิม (`receiptType` ∉ {CREDIT_NOTE, EARLY_PAYOFF, RESCHEDULE_FEE, DOWN_PAYMENT}) ผ่าน `voidReceiptInTx` policy `{ skipAgeLimit, cnSource: 'DEFECT_EXCHANGE', redirect }` — ใบลดหนี้คัดลอกค่าที่เก็บ · un-pay แถว Payment · กลับ 2A ที่ลง ณ วันรับเงินและยังไม่ถึงกำหนด (`voidAccrualPostedAtReceipt` เดิม) · คืนคอลัมน์ถัง · ไม่มีคำขออนุมัติ (ผจก. ยืนยัน = อนุมัติ) · ไม่ใช้กฎ 30 วัน | กระจกรับชำระ (flow `receipt-void` เดิม) แต่บรรทัด `11-11xx`/`11-12xx` ถูกย้ายเป็น **`Cr 21-1106`** (metadata `redirectedTo`) — เช่น `Dr 11-2103 1,515.83 / Cr 21-1106 1,515.83` (contractId เดิม) |
| ค `reverseContract` เดิม — เพิ่มข้าม flow `defect-exchange-credit-out` / `-in` และ**รายการที่แตะเงินสด**: คู่เป็น {21-1103, 21-5101, 21-2101, 21-2102} ล้วน (จ่ายเกิน · ส่วนเกินลิงก์ชำระ) = ข้าม (ขั้น ข ย้ายให้) · คู่อื่น (ใบรับชำระที่ไม่มีใบเสร็จ) = **ปฏิเสธทั้ง tx** | กระจก 1A · 2A ที่ครบกำหนด · SHOP legs ตามเดิม |
| ข เงินของลูกค้าที่เหลือ `readContractCloseAdvances(…, 'defect-exchange')` a = 21-1103 ทุกถัง · c = 21-5101 · p = `advanceVatOutstanding` ทั้งก้อน | `Dr 21-1103 a · Dr 21-5101 c · Dr 21-2101 p / Cr 21-1106 (a+c) · Cr 21-2102 p` flow `defect-exchange-credit-out` stamp `advanceVatConsume = p` (contractId เดิม) · a+c = 0 ⇒ ไม่มีรายการ (p > 0.01 = Sentry `defect-exchange-orphan-advance-vat`) · คอลัมน์สัญญาเดิมทั้งสาม = 0 |
| ง ตั้งเครดิตสัญญาใหม่ T = Σ ใบที่ยกเลิก + (a+c) · **ตรวจทาน** `21-1106` Cr สุทธิของสัญญาเดิม + credit-in ที่สัญญาเดิมเคยรับ (A→B→C) = T ±0.01 ไม่งั้น throw (GL ผิดปกติ) | `Dr 21-1106 T / Cr 21-5101 T` flow `defect-exchange-credit-in` (contractId **ใหม่** · `exchangeOf` เดิม · `amount`) · **ไม่ stamp `advanceVatPark`** · `creditBalance` ใหม่ = T |
| จ เปิดใช้สัญญาใหม่ `ContractWorkflowService.activate(id, actorId?)` → **หลัง commit** `applyExchangeCreditAfterActivation` → `PaymentsService.applyCreditBalance` (ใบกำกับภาษีช่องทาง CREDIT_BALANCE + 2A ตามกติกา) · actor = ผู้กดเปิดใช้ (`@CurrentUser` ของ controller) ไม่มี = `admin@bestchoice.com` · ล้ม**ไม่ย้อน**การเปิดใช้ + Sentry warning `action: 'defect-exchange-credit-autoapply-failed'` (เครดิตค้าง → ปุ่ม "ใช้ยอดเครดิต" มือ) · `activate()` คืน `creditApplied` | ตามเส้นทางใช้เครดิตเดิม — `Dr 21-5101 / Cr 11-2103` ไม่มีขากลับภาษี (ไม่มี stamp) · 2A สัญญาใหม่ลงภาษีเต็ม |

- **21-1106 สุทธิ 0 ทุกครั้ง** ข้ามคู่สัญญา — ยอดต่อสัญญาไม่ 0 (Cr เดิม / Dr ใหม่) ไม่มีเลนส์อ่านต่อสัญญา · ธนาคาร/เงินสด**ไม่ขยับ** ไม่มีการคืนเงิน
- **ภาษีขาย:** ใบลดหนี้ลด 21-2101 เดือนที่เปลี่ยน (กระจก 2A = REVERSAL ใน ภ.พ.30) · **เครดิตที่ย้ายไม่พัก VAT** (ต่างจาก PR4 กติกา 14) — ใบกำกับของเงินก้อนนี้ถูกยกเลิกด้วยใบลดหนี้แล้ว ภาษีรับรู้เต็มตอนใช้เครดิต (2A ใหม่) และใบใหม่พิมพ์ภาษีเต็ม ⇒ ช่วงเปลี่ยนเครื่องถึงเปิดใช้ไม่มีภาษีขายค้าง (ปกติวันเดียวกัน) — **แจ้งฝ่ายบัญชีเพื่อทราบ** · ภ.พ.30 ตัวเลขทอง 17,000/12 จ่ายงวด 1: +99.17 −99.17 +99.17 = 99.17 ครั้งเดียว
- **ด่านปฏิเสธ (`exchangeMoneyBlockers` — ทั้ง `checkEligibility` และใน tx ของ `execute` ทางปกติ/bypass):** เคยปรับดิว (`hasRescheduleHistory` — ใบ RESCHEDULE_FEE / ถังพัก > 0 / JE tag 6a·6b หรือ flow reschedule-*) · กวาด 42-1106 แล้ว · คำขอ `VOID_RECEIPT` ค้างคิว · ใบ EARLY_PAYOFF · ใบลดหนี้กำพร้า — เหตุผลไม่ใช่กรอบ 7 วัน ⇒ หลังการขายบล็อกเสมอ
- **เอกสาร (mockup):** ใบลดหนี้ `cnSource DEFECT_EXCHANGE` — กล่องเหลือง "…เนื่องจากเปลี่ยนเครื่องตำหนิภายใน 7 วัน … โอนเป็นเครดิตของสัญญาใหม่ X" · รายการ "ลดหนี้ — เปลี่ยนเครื่องตำหนิภายใน 7 วัน" + บรรทัดรอง ม.82/10 (3) · "ผลของการลดหนี้" 3 บรรทัด · ท้ายใบ ม.86/10 · **ไม่ส่ง LINE** · สัญญาใหม่อ่านจาก `Contract.parentContractId` ย้อนกลับ (`getReceipt().exchangeTarget`) · ใบใช้เครดิตของสัญญาใหม่: บรรทัดรอง/ที่มาของเครดิต/กล่องเหลือง ตัดสินตอนพิมพ์ด้วย `exchangeCreditSourceFrom` (Σ ใบ CREDIT_BALANCE ถึงใบนี้ ≤ T — ไม่มีคอลัมน์ใหม่) · กล่องยืนยันหลังการขาย: ตารางใบเสร็จ + "เครดิตที่จะย้ายไปสัญญาใหม่ (ไม่คืนเงินสด)" จาก `checkEligibility().receiptsToCreditNote/creditToTransfer`
- **Audit:** `DEFECT_EXCHANGE.newValue` เพิ่ม `creditNoteNumbers` `voidedReceiptNumbers` `transferredCredit` (2dp) `ledgerAdvanceMoved` `ledgerCreditMoved` `creditOutEntryNo` `creditInEntryNo` · `RECEIPT_VOID` ต่อใบ (เหตุผล "เปลี่ยนเครื่องตำหนิภายใน 7 วัน → สัญญา X") · `AFTER_SALES_EXCHANGE_CONFIRMED` เพิ่ม `creditNoteNumbers` `transferredCredit`
- **Forward-only** · prod ไม่มีสัญญาที่ผ่อนอยู่ (17/10/2569) · **ห้ามถอย revision หลังมีรายการ `defect-exchange-credit-*`** (reverseContract เก่าไม่รู้จัก flow) · ขึ้นหลัง #1703 (ADVANCE_SURPLUS) + #1705 (22.2)

**ที่ยังเปิดอยู่:** ภาษีขายของเงินระหว่างเปลี่ยนเครื่องถึงเปิดใช้ (แจ้งบัญชี) · เคยปรับดิว = ปฏิเสธ (รอเคสจริง) · ยกเลิก/ลบร่างสัญญาใหม่หลังเปลี่ยนเครื่อง —
C-1 กวาดรายการ credit-in (ไม่อยู่ใน `C1_EXCLUDED_FLOWS`) ⇒ `Dr 21-5101 / Cr 21-1106` ค้างบน 21-1106 โดยไม่มีสัญญารับ — ไม่มีเส้นทางวันนี้ ห้ามเดา
```

- [ ] **Step 2: accounting.md — bullet เดิม L1397–1400 (หัวข้อ "ใบกำกับภาษีตามบัญชี" ที่ยังเปิดอยู่)**

ขีดฆ่าหัว bullet และต่อท้าย: `~~**เครดิตจากการเปลี่ยนเครื่องเสียภายใน 7 วัน** …~~ — **ปิดแล้ว 2026-10-17 (15ข)**: ใบเสร็จ/ใบกำกับภาษีของสัญญาเดิมได้ใบลดหนี้ `cnSource DEFECT_EXCHANGE` ทุกใบ และเครดิตมี 21-5101 หนุน (หัวข้อ "เปลี่ยนเครื่องตำหนิ 7 วัน เมื่อสัญญาเดิมมีการชำระแล้ว")` (คงข้อความเดิมภายใน `~~…~~`)

- [ ] **Step 3: CLAUDE.md — Important Notes**

หลัง bullet `**เปลี่ยนเครื่องแบบมีราคา (device swap) ปิดใช้ …**` เพิ่ม:

```markdown
- **เปลี่ยนเครื่องตำหนิ 7 วันเมื่อสัญญาเดิมมีการชำระแล้ว (2026-10-17 · 15ข/18.3ข)**: ด่าน C-6 ถูกถอด — ใบรับเงินทุกใบของสัญญาเดิมได้ใบลดหนี้ (`cnSource DEFECT_EXCHANGE` · ไม่ส่ง LINE) · เงินเดินผ่าน 21-1106 ไม่แตะธนาคาร → เครดิต 21-5101 สัญญาใหม่ · `activate(id, actorId?)` ใช้เครดิตชำระงวดอัตโนมัติหลัง commit · เคยปรับดิว = ปฏิเสธ · กติกาเต็ม `.claude/rules/accounting.md` หัวข้อ "เปลี่ยนเครื่องตำหนิ 7 วัน เมื่อสัญญาเดิมมีการชำระแล้ว"
```

- [ ] **Step 4: เวอร์ชัน web**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && python3 - <<'PY'
import re,io
p='apps/web/package.json'; s=io.open(p,encoding='utf-8').read()
new=re.sub(r'"version": "26\.10\.\d+"', '"version": "26.10.36"', s, count=1); assert new!=s or '"26.10.36"' in s
io.open(p,'w',encoding='utf-8').write(new); print('version 26.10.36')
PY
grep -n '"version"' apps/web/package.json`
Expected: `"version": "26.10.36"` (คิว: #1697=.30 … #1705=.35 — ถ้า merge สลับลำดับให้ bump อีกครั้งก่อน merge)

- [ ] **Step 5: ตรวจทานทั้งชุด**

Run (jest ทั้ง api — ไม่ใช่ DB): `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest --runInBand 2>&1 | tail -15`
Expected: ทุก suite ผ่าน (suite ที่ต้องมี DATABASE_URL และล้มอยู่ก่อนแล้วตามหมายเหตุใน memory — `prisma-finance.service.spec` — ไม่นับ; รายงานชื่อที่ล้มทุกตัว)

Run (vitest DB — ทีละชุด ห้ามซ้อนกับ jest DB): `source ~/Documents/BESTCHOICE-docs/pr4-advance-vat/test-env.sh && npx vitest run --root /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api --no-file-parallelism src/modules/defect-exchange/__tests__/defect-exchange-credit.integration.spec.ts src/modules/after-sales/__tests__/after-sales-exchange.integration.spec.ts src/modules/after-sales/__tests__/after-sales-cash-exchange.integration.spec.ts src/modules/payments/services/accrue-at-receipt.integration.spec.ts src/modules/payments/services/park-void-restore.integration.spec.ts 2>&1 | tail -30`
Expected: ทุกไฟล์ผ่าน (void path ถูก refactor — accrue-at-receipt "ยกเลิกใบเสร็จ…" และ park-void-restore คือตัวพิสูจน์ว่า `voidReceiptInTx` เท่าเดิม)

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && ./tools/check-types.sh all && cd apps/api && npx eslint --no-fix $(cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && git diff --name-only c5d26edcf -- 'apps/api/src/**/*.ts' | sed 's#^#/Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/#' | tr '\n' ' ') && cd ../web && npx eslint --no-fix $(cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && git diff --name-only c5d26edcf -- 'apps/web/src/**/*.tsx' | sed 's#^#/Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/#' | tr '\n' ' ') && npx vitest run src/pages/after-sales/`
Expected: 0 errors ทุกขั้น

- [ ] **Step 6: Commit เอกสาร + เวอร์ชัน**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && git add .claude/rules/accounting.md .claude/CLAUDE.md apps/web/package.json && git commit -q -F - <<'MSG'
docs(accounting): เปลี่ยนเครื่องตำหนิ 7 วันเมื่อสัญญาเดิมมีการชำระแล้ว (15ข/18.3ข) · web 26.10.36

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

- [ ] **Step 7: ผู้ตรวจอิสระ (Agent model fable) ก่อน push — ตามคำสั่งเจ้าของ**

ส่ง `review-package` ของทั้ง branch (`git merge-base origin/main HEAD`..HEAD) + path spec/plan + Review Focus ข้างบน + rulings ใน ledger ให้ผู้ตรวจอิสระ · Critical/Important → แก้ RED→GREEN + รัน suite ที่เกี่ยวข้อง · Minor → ledger + PR body ("minor deferred")

- [ ] **Step 8: Push + PR**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange && git push -u origin feat/defect-exchange-credit-note
```

PR body (เขียนลง scratchpad `defect-exchange-pr-body.md` แล้ว `gh pr create --title "เปลี่ยนเครื่องตำหนิ 7 วันเมื่อสัญญาเดิมมีการชำระแล้ว — ใบลดหนี้ + เครดิต 21-5101 (15ข/18.3ข)" --body-file …`) ต้องมี: คำตัดสินเจ้าของ 17/10 · ตารางขั้น ก–จ · ตัวเลขทอง · ด่าน · เอกสาร 3 ชิ้น (ลิงก์ mockup) · เทสที่รัน (jest/vitest/web ตัวเลขจริง) · "ไม่ stamp VAT บนเครดิตที่ย้าย — แจ้งฝ่ายบัญชีเพื่อทราบ" · ห้าม rollback · ขึ้นหลัง #1703/#1705 · web 26.10.36 · minor deferred · ลงท้าย `🤖 Generated with [Claude Code](https://claude.com/claude-code)` · **เจ้าของ merge เอง** (`gh pr merge N --admin --merge` พิมพ์ในแชท)

