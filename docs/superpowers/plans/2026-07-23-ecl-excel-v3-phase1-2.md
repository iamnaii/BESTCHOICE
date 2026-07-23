# ECL Excel v3 Alignment — Phase 1 (GL Correctness) + Phase 2 (Enforcement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้การตั้งค่าเผื่อหนี้สงสัยจะสูญ (ECL) คิดเลข/ลง GL ตรงตาม Excel v3 ของ CPA (spec: `docs/superpowers/specs/2026-07-23-ecl-excel-v3-alignment-design.md`) — เฟส 1 แก้ความถูกต้องของตัวเลขบัญชี, เฟส 2 บังคับ workflow บอกเลิกก่อนยึด/ตัดหนี้สูญ

**Architecture:** แก้ที่ 2 ชั้น — (1) `BadDebtService` + `BadDebtProvisionTemplate` + `BadDebtWriteOffTemplate` ใน backend NestJS ให้ delta ตั้ง/กลับสำรองอิง GL จริง 2 ทิศทาง, ฐานคำนวณสม่ำเสมอ 3 เส้นทาง, และ write-off แยกขา accrued/deferred ตามแบบ JP5; (2) seed + manual SQL เปิด enforcement configs. เฟส 3 (เอกสาร CN + LINE) เป็น plan แยกภายหลัง

**Tech Stack:** NestJS + Prisma + PostgreSQL, Decimal.js (`@prisma/client/runtime/library`), jest (unit), vitest (DB-backed specs), GitHub Actions (`.github/workflows/deploy-gcp.yml`)

## Global Constraints

- เงินใช้ `Prisma.Decimal`/`Decimal` เท่านั้น — ห้าม `Number()` บนค่าเงินที่ persist/คำนวณ (v4 mandate)
- Error messages ภาษาไทย ผ่าน NestJS exceptions (`BadRequestException` ฯลฯ)
- JE ต้อง balance เป๊ะ — `JournalAutoService.createAndPost` ใช้ exact equality, unbalanced = throw
- Rounding ตาม CPA CSV: `installmentExclVat` = ROUND_DOWN, `vatPerInst`/`interestPerInst` = ROUND_HALF_UP; fixture 17,000/12: excl-VAT 1,416.66 / VAT 99.17 / ดอกเบี้ย 500.00 / รวม 1,515.83
- **Unit spec** (mock) = jest, ชื่อ `*.spec.ts` นอก directory ที่ jest ignore; **DB-backed spec** = vitest style (real PrismaClient) วางใน `apps/api/src/modules/journal/cpa-templates/` เท่านั้น (CI vitest step glob เฉพาะ dir นี้ — deploy-gcp.yml:145-147) จนกว่า Task 7 จะขยาย glob
- DB-backed spec ต้องมี local DB รันอยู่ (docker per `docs` local dev setup; รันจาก `apps/api`: `npx vitest run <file>`)
- Seed SystemConfig: `update` แตะเฉพาะ `label`, `value` เป็น create-only — ห้ามเปลี่ยน semantics นี้ (กันทับค่าที่ owner ตั้ง)
- เปลี่ยน config บน prod ใช้ pattern `apps/api/prisma/migrations-manual/*.sql` (มี confirmation gate + BEGIN/COMMIT — ดูตัวอย่าง `2026-05-17-merge-vat-rate-keys.sql`)
- ทุก commit ลงท้าย `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Branch: `feat/ecl-excel-v3-alignment` (มีอยู่แล้ว มี spec 2 commits)

---

## Phase 1 — GL Correctness

### Task 1: BadDebtProvisionTemplate — delta 2 ทิศทาง + idempotency ราย run-date

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/bad-debt-provision.template.ts`
- Test: `apps/api/src/modules/journal/cpa-templates/bad-debt-provision.template.spec.ts` (มีอยู่แล้ว — เพิ่ม tests + แก้ของเดิมที่ผูกกับ period-idempotency)

**Interfaces:**
- Consumes: `JournalAutoService.createAndPost(payload, tx?)` (เดิม)
- Produces: `BadDebtProvisionTemplate.execute({ contractId, provisionAmount: Decimal /* SIGNED: บวก=ตั้งเพิ่ม, ลบ=release */, period: string, runDate?: string /* YYYY-MM-DD BKK, default วันนี้ */ }, tx?) => Promise<{ entryNo: string } | null>` — Task 2/5 เรียกด้วย signature นี้

- [ ] **Step 1: เขียน failing tests (vitest, DB-backed)**

เพิ่มใน `bad-debt-provision.template.spec.ts` (ตาม style เดิมของไฟล์ — real PrismaClient + `seedFinanceCoa`):

```ts
  it('posts RELEASE JE (Dr 11-2102 / Cr 51-1103) when provisionAmount is negative', async () => {
    const c = await seedStandard17k12m(prisma);
    const tmpl = new BadDebtProvisionTemplate(journal, prisma as any);
    await tmpl.execute({
      contractId: c.id,
      provisionAmount: new Decimal('500.00'),
      period: '2026-07',
      runDate: '2026-07-23',
    });
    const result = await tmpl.execute({
      contractId: c.id,
      provisionAmount: new Decimal('-200.00'),
      period: '2026-07',
      runDate: '2026-07-24',
    });
    expect(result).not.toBeNull();

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'provision' } } as any,
          { metadata: { path: ['contractId'], equals: c.id } } as any,
          { metadata: { path: ['runDate'], equals: '2026-07-24' } } as any,
        ],
      },
      include: { lines: true },
    });
    expect(je).toBeDefined();
    const dr2102 = je!.lines.find((l) => l.accountCode === '11-2102');
    const cr51 = je!.lines.find((l) => l.accountCode === '51-1103');
    expect(new Decimal(dr2102!.debit.toString()).toFixed(2)).toBe('200.00');
    expect(new Decimal(cr51!.credit.toString()).toFixed(2)).toBe('200.00');
  });

  it('same runDate posts once (idempotent), different runDate posts again', async () => {
    const c = await seedStandard17k12m(prisma);
    const tmpl = new BadDebtProvisionTemplate(journal, prisma as any);
    const first = await tmpl.execute({
      contractId: c.id, provisionAmount: new Decimal('100.00'), period: '2026-07', runDate: '2026-07-23',
    });
    const dup = await tmpl.execute({
      contractId: c.id, provisionAmount: new Decimal('999.00'), period: '2026-07', runDate: '2026-07-23',
    });
    expect(dup!.entryNo).toBe(first!.entryNo); // skipped, returns existing

    const second = await tmpl.execute({
      contractId: c.id, provisionAmount: new Decimal('50.00'), period: '2026-07', runDate: '2026-07-24',
    });
    expect(second!.entryNo).not.toBe(first!.entryNo); // same month, new day → posts
  });

  it('skips when provisionAmount is zero', async () => {
    const c = await seedStandard17k12m(prisma);
    const tmpl = new BadDebtProvisionTemplate(journal, prisma as any);
    const r = await tmpl.execute({
      contractId: c.id, provisionAmount: new Decimal('0'), period: '2026-07', runDate: '2026-07-25',
    });
    expect(r).toBeNull();
  });
```

หมายเหตุ: ถ้าไฟล์ spec เดิมมี test ที่ assert ว่า "same period skips" ให้แก้ test นั้นเป็น "same runDate skips" (เปลี่ยน expectation ให้ตรง behavior ใหม่)

- [ ] **Step 2: รัน test ให้ fail**

Run (จาก `apps/api`): `npx vitest run src/modules/journal/cpa-templates/bad-debt-provision.template.spec.ts`
Expected: FAIL — negative amount ถูก skip (return null), runDate ไม่มีใน metadata

- [ ] **Step 3: แก้ template**

แทนที่เนื้อหา `execute()` ใน `bad-debt-provision.template.ts` (interface + logic — คงชื่อ class/DI เดิม):

```ts
export interface BadDebtProvisionInput {
  contractId: string;
  /**
   * SIGNED delta: บวก = ตั้งสำรองเพิ่ม (Dr 51-1103 / Cr 11-2102),
   * ลบ = release สำรอง (Dr 11-2102 / Cr 51-1103). ศูนย์ = skip.
   */
  provisionAmount: Decimal;
  /** Period string e.g. '2026-04' (metadata/description เท่านั้น — ไม่ใช่ idempotency key แล้ว) */
  period: string;
  /** Idempotency key: YYYY-MM-DD (BKK). default = วันนี้เวลา BKK */
  runDate?: string;
}
```

```ts
  async execute(input: BadDebtProvisionInput): Promise<{ entryNo: string } | null> {
    const { contractId, provisionAmount, period } = input;
    const runDate =
      input.runDate ??
      new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD

    if (provisionAmount.abs().lt(new Decimal('0.005'))) {
      this.logger.warn(
        `[A.5a] BadDebtProvision skipped — delta=${provisionAmount.toFixed(2)} for contract ${contractId} runDate ${runDate}`,
      );
      return null;
    }

    // Idempotency: (flow, contractId, runDate) — daily cron รันซ้ำวันเดียวกันไม่ post ซ้ำ
    const existing = await this.prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'provision' } } as Prisma.JournalEntryWhereInput,
          { metadata: { path: ['contractId'], equals: contractId } } as Prisma.JournalEntryWhereInput,
          { metadata: { path: ['runDate'], equals: runDate } } as Prisma.JournalEntryWhereInput,
        ],
        deletedAt: null,
      },
    });
    if (existing) {
      this.logger.log(
        `[A.5a] BadDebtProvision idempotency — JE ${existing.entryNumber} already exists for contract ${contractId} runDate ${runDate}, skipping`,
      );
      return { entryNo: existing.entryNumber };
    }

    const zero = new Decimal(0);
    const isRelease = provisionAmount.isNegative();
    const amount = provisionAmount.abs().toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const direction = isRelease ? 'release' : 'increase';

    const lines = isRelease
      ? [
          {
            accountCode: '11-2102',
            dr: amount,
            cr: zero,
            description: `กลับค่าเผื่อหนี้สงสัยจะสูญ (ลดสำรอง) — สัญญา ${contractId.slice(0, 8)}`,
          },
          {
            accountCode: '51-1103',
            dr: zero,
            cr: amount,
            description: `กลับค่าเผื่อหนี้สงสัยจะสูญ (เพิ่มในปี) — ${period}`,
          },
        ]
      : [
          {
            accountCode: '51-1103',
            dr: amount,
            cr: zero,
            description: `ค่าเผื่อหนี้สงสัยจะสูญ (เพิ่มในปี) — ${period}`,
          },
          {
            accountCode: '11-2102',
            dr: zero,
            cr: amount,
            description: `ค่าเผื่อหนี้สงสัยจะสูญ (Contra) — สัญญา ${contractId.slice(0, 8)}`,
          },
        ];

    const result = await this.journal.createAndPost({
      description: `${isRelease ? 'กลับ' : 'ตั้ง'}สำรองหนี้สงสัยจะสูญ — สัญญา ${contractId.slice(0, 8)} งวด ${period}`,
      reference: `${contractId}:bad-debt-provision:${runDate}`,
      metadata: {
        tag: 'BAD-DEBT',
        flow: 'provision',
        direction,
        contractId,
        period,
        runDate,
        provisionAmount: provisionAmount.toFixed(2),
      },
      lines,
    });

    return { entryNo: result.entryNumber };
  }
```

- [ ] **Step 4: รัน test ให้ผ่าน**

Run: `npx vitest run src/modules/journal/cpa-templates/bad-debt-provision.template.spec.ts`
Expected: PASS ทุก test (รวมของเดิมที่แก้แล้ว)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/bad-debt-provision.template.ts apps/api/src/modules/journal/cpa-templates/bad-debt-provision.template.spec.ts
git commit -m "feat(ecl): provision template รับ delta 2 ทิศ (ตั้ง/release) + idempotency ราย run-date

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: delta เทียบ GL 11-2102 + helper อ่าน GL balance ราย contract

**Files:**
- Modify: `apps/api/src/modules/accounting/bad-debt.service.ts:273-321` (delta loop) + เพิ่ม private helper
- Test: `apps/api/src/modules/accounting/bad-debt.service.spec.ts` (jest unit — แก้ mock + tests เดิม)

**Interfaces:**
- Consumes: `BadDebtProvisionTemplate.execute` signature ใหม่จาก Task 1
- Produces: `private async glBalanceByContract(accountCode: string, contractId: string, db: Prisma.TransactionClient | PrismaService): Promise<Decimal>` — คืน (ΣCr − ΣDr) สำหรับ contra-liability side หรือ (ΣDr − ΣCr) ตาม `side` param; Task 4 ใช้ helper เดียวกัน จึงประกาศเป็น
  `private async glBalance(contractId: string, accountCode: string, side: 'dr' | 'cr', db?: Prisma.TransactionClient): Promise<Decimal>`

- [ ] **Step 1: เขียน failing unit tests (jest)**

ใน `bad-debt.service.spec.ts` — เพิ่ม `journalLine: { findMany: jest.fn().mockResolvedValue([]) }` เข้า prisma mock object (block `beforeEach` เดิมบรรทัด ~37) และประกาศ `let provisionTemplateMock: { execute: jest.Mock };` ข้าง `let service` โดย set ใน beforeEach (`provisionTemplateMock = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-MOCK' }) };` แล้วใช้เป็น useValue ของ `BadDebtProvisionTemplate`) — assertion ทุกจุดใช้ `provisionTemplateMock.execute` แทน `module.get(...)` เพราะ `module` เป็น local ใน beforeEach. แก้/เพิ่ม tests ใน describe `'calculateProvisions — aggregation and reversal'`:

```ts
    it('computes delta against GL 11-2102 balance (not BadDebtProvision rows)', async () => {
      // 1 contract, 40 วัน overdue, outstanding 1,000 → B2 15% → target 150.00
      prisma.payment.findMany.mockResolvedValue([
        {
          contract: { id: 'c-1', status: 'OVERDUE' },
          dueDate: new Date(Date.now() - 40 * 86_400_000),
          amountDue: new Prisma.Decimal('1000.00'),
          amountPaid: new Prisma.Decimal('0'),
          lateFee: new Prisma.Decimal('0'),
          lateFeeWaived: false,
        },
      ]);
      // DB rows บอก prev = 150 (JE เดิมเคย fail) แต่ GL มีจริงแค่ 100
      prisma.badDebtProvision.findMany.mockResolvedValue([
        { contractId: 'c-1', provisionAmount: new Prisma.Decimal('150.00') },
      ]);
      prisma.journalLine.findMany.mockResolvedValue([
        { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('100.00') },
      ]);

      await service.calculateProvisions('owner-1');

      // delta ต้อง = 150 − 100(GL) = 50 ไม่ใช่ 150 − 150(DB) = 0
      expect(provisionTemplateMock.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'c-1',
          provisionAmount: expect.decimalEq('50.00'),
        }),
      );
    });

    it('posts negative delta (release) when GL balance exceeds new target', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          contract: { id: 'c-1', status: 'OVERDUE' },
          dueDate: new Date(Date.now() - 10 * 86_400_000), // B1 2%
          amountDue: new Prisma.Decimal('1000.00'),
          amountPaid: new Prisma.Decimal('0'),
          lateFee: new Prisma.Decimal('0'),
          lateFeeWaived: false,
        },
      ]);
      prisma.journalLine.findMany.mockResolvedValue([
        { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('150.00') },
      ]);

      await service.calculateProvisions('owner-1');
      // target = 20.00 (2%), GL = 150 → delta = −130.00
      expect(provisionTemplateMock.execute).toHaveBeenCalledWith(
        expect.objectContaining({ provisionAmount: expect.decimalEq('-130.00') }),
      );
    });
```

เพิ่ม custom matcher ที่หัวไฟล์ (ใต้ imports — jest ไม่มี Decimal matcher):

```ts
expect.extend({
  decimalEq(received: any, expected: string) {
    const pass =
      received != null &&
      typeof received.toFixed === 'function' &&
      received.toFixed(2) === new Prisma.Decimal(expected).toFixed(2);
    return { pass, message: () => `expected Decimal ${received} to equal ${expected}` };
  },
});
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Expect {
      decimalEq(expected: string): any;
    }
  }
}
```

และแก้ test เดิม `'calls BadDebtProvisionTemplate.execute with correct delta vs prior provision (Phase A.5a)'` ให้ mock `journalLine.findMany` เป็นแหล่ง prev แทน `badDebtProvision.findMany` (ตัว test คง assertion delta เดิมไว้ แต่ย้ายค่า prev ไปอยู่ใน journalLine mock)

- [ ] **Step 2: รัน test ให้ fail**

Run: `npm run test --workspace=apps/api -- bad-debt.service.spec`
Expected: FAIL — delta ยังคิดจาก badDebtProvision rows

- [ ] **Step 3: แก้ service**

ใน `bad-debt.service.ts` เพิ่ม helper (วางใต้ `computeOutstanding`):

```ts
  /**
   * GL balance ราย contract จาก journal lines (POSTED เท่านั้น) — pattern เดียวกับ
   * BadDebtWriteOffTemplate/RepossessionJP5Template. side='cr' คืน ΣCr−ΣDr
   * (contra-asset/liability เช่น 11-2102, 11-2106), side='dr' คืน ΣDr−ΣCr
   * (asset เช่น 11-2101, 11-2103).
   */
  private async glBalance(
    contractId: string,
    accountCode: string,
    side: 'dr' | 'cr',
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Decimal> {
    const lines = await db.journalLine.findMany({
      where: {
        accountCode,
        journalEntry: {
          metadata: { path: ['contractId'], equals: contractId },
          status: 'POSTED',
          deletedAt: null,
        },
      },
      select: { debit: true, credit: true },
    });
    let bal = new Decimal(0);
    for (const l of lines) {
      bal =
        side === 'cr'
          ? bal.plus(l.credit.toString()).minus(l.debit.toString())
          : bal.plus(l.debit.toString()).minus(l.credit.toString());
    }
    return bal;
  }
```

แล้วแก้ delta loop ใน `calculateProvisions` (บรรทัด ~273-321 เดิม):
1. ลบการสร้าง `previousProvisionByContract` จาก `activeProvisions` (คงการ `updateMany` reverse rows ไว้ — ตาราง `BadDebtProvision` ยังเป็น operational record)
2. ใน JE loop เปลี่ยน prev เป็น GL:

```ts
    // Post delta-based provision JEs (non-blocking — a single JE failure must not abort the run)
    // Delta เทียบ GL 11-2102 จริง (ไม่ใช่ DB rows) — JE ที่เคย fail จะถูกเติมคืนรอบถัดไป (self-healing)
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const runDate = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

    for (const p of provisions) {
      try {
        const glPrev = await this.glBalance(p.contractId, '11-2102', 'cr');
        const delta = new Decimal(p.provisionAmount.toString()).sub(glPrev);
        if (delta.abs().lt(new Decimal('0.005'))) continue;

        await this.badDebtProvisionTemplate.execute({
          contractId: p.contractId,
          provisionAmount: delta,
          period,
          runDate,
        });
      } catch (err) {
        Sentry.captureException(err, { extra: { contractId: p.contractId, period } });
        this.logger.error(
          `[A.5a] Bad debt provision JE failed for contract ${p.contractId} period ${period}: ${(err as Error).message}`,
        );
      }
    }
```

- [ ] **Step 4: รัน test ให้ผ่าน**

Run: `npm run test --workspace=apps/api -- bad-debt.service.spec`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/accounting/bad-debt.service.ts apps/api/src/modules/accounting/bad-debt.service.spec.ts
git commit -m "feat(ecl): provision delta เทียบ GL 11-2102 จริง (self-healing) + glBalance helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: ฐานเดียวกัน 3 เส้นทาง — ถอด lateFee + กรอง dueDate ใน stage reverse

**Files:**
- Modify: `apps/api/src/modules/accounting/bad-debt.service.ts` — `computeOutstanding` (138-145), `calculateProvisions` (204-207), `writeOffBadDebt` (498-510), `reverseStageOnPayment` (606-623)
- Test: `apps/api/src/modules/accounting/bad-debt.service.spec.ts`

**Interfaces:**
- Produces: `computeOutstanding(p: { amountDue; amountPaid }): Decimal` — ไม่มี lateFee param แล้ว; ทุก caller ภายใน service เท่านั้น

- [ ] **Step 1: เขียน failing unit tests**

```ts
    it('NEVER includes late fee in the ECL base (waived or not)', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          contract: { id: 'c-1', status: 'OVERDUE' },
          dueDate: new Date(Date.now() - 40 * 86_400_000), // B2 15%
          amountDue: new Prisma.Decimal('1000.00'),
          amountPaid: new Prisma.Decimal('0'),
          lateFee: new Prisma.Decimal('75.79'),
          lateFeeWaived: false, // ยังไม่ waive — เดิมเคยถูกบวกเข้าฐาน
        },
      ]);
      prisma.journalLine.findMany.mockResolvedValue([]);

      const result = await service.calculateProvisions('owner-1');
      // ฐาน = 1,000.00 เท่านั้น → 15% = 150.00 (ไม่ใช่ 1,075.79 × 15%)
      expect(result.totalProvision).toBe(150.0);
    });

    it('reverseStageOnPayment excludes future (not-yet-due) installments from the base', async () => {
      prisma.badDebtProvision.findFirst.mockResolvedValue({
        id: 'prov-1',
        contractId: 'c-1',
        agingBucket: '31-60',
        provisionRate: new Prisma.Decimal('0.15'),
        provisionAmount: new Prisma.Decimal('150.00'),
      });
      // 1 งวดค้าง 10 วัน (1,000) + 1 งวดอนาคต (1,000) — งวดอนาคตต้องไม่เข้าฐาน
      prisma.payment.findMany.mockResolvedValue([
        {
          dueDate: new Date(Date.now() - 10 * 86_400_000),
          amountDue: new Prisma.Decimal('1000.00'),
          amountPaid: new Prisma.Decimal('0'),
          lateFee: new Prisma.Decimal('0'),
          lateFeeWaived: false,
        },
      ]);
      prisma.contract = { ...prisma.contract, findUnique: jest.fn().mockResolvedValue({ id: 'c-1', status: 'OVERDUE' }) };

      const r = await service.reverseStageOnPayment('c-1');
      // bucket ใหม่ B1 2% × 1,000 = 20 → reverse = 150 − 20 = 130
      expect(r!.reverseAmount).toBe('130.00');
      // และ query ต้องส่ง dueDate filter
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ dueDate: expect.objectContaining({ lt: expect.any(Date) }) }),
        }),
      );
    });
```

แก้ test เดิม `'skips lateFee when it is waived'` → ลบทิ้ง (พฤติกรรม lateFee หมดไปทั้งเส้น) และแก้ test เดิมของ `reverseStageOnPayment` ที่ mock payment rows ให้สอดคล้อง filter ใหม่

- [ ] **Step 2: รัน test ให้ fail**

Run: `npm run test --workspace=apps/api -- bad-debt.service.spec`
Expected: FAIL — totalProvision = 161.37 (รวมค่าปรับ) และไม่มี dueDate filter

- [ ] **Step 3: แก้ service**

1. `computeOutstanding` — ตัด lateFee:

```ts
  /**
   * ฐาน ECL = amountDue − amountPaid เท่านั้น (ตรงกับ 11-2103) — ค่าปรับล่าช้า
   * ไม่ใช่สินทรัพย์ใน GL (รับรู้เป็นรายได้ 42-1103 ตอนรับเงิน) จึงห้ามเข้าฐาน
   * (Excel v3 §1 + spec 2026-07-23 §4 1b)
   */
  private computeOutstanding(p: { amountDue: Prisma.Decimal; amountPaid: Prisma.Decimal }): Decimal {
    return new Decimal(p.amountDue.toString()).sub(new Decimal(p.amountPaid.toString()));
  }
```

2. ลบตัวแปร `unpaidLateFee` + argument ที่ 2 ทุกจุดที่เรียก (`calculateProvisions` loop, `writeOffBadDebt` reduce, `reverseStageOnPayment` loop)
3. `reverseStageOnPayment` เพิ่ม filter ใน query:

```ts
    const overduePayments = await db.payment.findMany({
      where: {
        contractId,
        status: { in: ['PENDING', 'PARTIALLY_PAID'] },
        dueDate: { lt: now },
        deletedAt: null,
      },
      select: { dueDate: true, amountDue: true, amountPaid: true },
    });
```

(ย้าย `const now = new Date();` ขึ้นก่อน query; ตัด `lateFee`/`lateFeeWaived` ออกจาก select)

- [ ] **Step 4: รัน test ให้ผ่าน**

Run: `npm run test --workspace=apps/api -- bad-debt.service.spec`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/accounting/bad-debt.service.ts apps/api/src/modules/accounting/bad-debt.service.spec.ts
git commit -m "fix(ecl): ฐาน ECL = amountDue−amountPaid เท่านั้น (ตัดค่าปรับ) + stage reverse กรองงวดอนาคต

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: TERMINATED เข้า scope + ฐาน carrying amount

**Files:**
- Modify: `apps/api/src/modules/accounting/bad-debt.service.ts` — `calculateProvisions` (status filter + ฐาน), `reverseStageOnPayment` (ฐาน TERMINATED)
- Test: `apps/api/src/modules/accounting/bad-debt.service.spec.ts` (unit) + Create: `apps/api/src/modules/journal/cpa-templates/ecl-terminated-base.spec.ts` (vitest DB)

**Interfaces:**
- Consumes: `glBalance(contractId, accountCode, side, db?)` จาก Task 2
- Produces: `private async terminatedCarryingAmount(contractId: string, db?): Promise<Decimal>` = `glBalance(11-2103,'dr') + glBalance(11-2101,'dr') − glBalance(11-2106,'cr')`

- [ ] **Step 1: เขียน failing unit test**

```ts
    it('TERMINATED contract: base = carrying amount from GL (11-2103 + 11-2101 − 11-2106)', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          contract: { id: 'c-t', status: 'TERMINATED' },
          dueDate: new Date(Date.now() - 100 * 86_400_000), // B4 75%
          amountDue: new Prisma.Decimal('1515.83'),
          amountPaid: new Prisma.Decimal('0'),
          lateFee: new Prisma.Decimal('0'),
          lateFeeWaived: false,
        },
      ]);
      // glBalance ถูกเรียกตามลำดับ: 11-2103, 11-2101, 11-2106, แล้วค่อย 11-2102 (delta)
      prisma.journalLine.findMany
        .mockResolvedValueOnce([{ debit: new Prisma.Decimal('4547.49'), credit: new Prisma.Decimal('0') }]) // 11-2103
        .mockResolvedValueOnce([{ debit: new Prisma.Decimal('12750.02'), credit: new Prisma.Decimal('0') }]) // 11-2101
        .mockResolvedValueOnce([{ debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('4500.00') }]) // 11-2106
        .mockResolvedValue([]); // 11-2102 = 0

      const result = await service.calculateProvisions('owner-1');
      // carrying = 4,547.49 + 12,750.02 − 4,500.00 = 12,797.51 → B4 75% = 9,598.13
      expect(result.totalProvision).toBe(9598.13);
    });
```

- [ ] **Step 2: รัน test ให้ fail**

Run: `npm run test --workspace=apps/api -- bad-debt.service.spec`
Expected: FAIL — TERMINATED ไม่อยู่ใน scope (result.created = 0)

- [ ] **Step 3: แก้ service**

1. Status filter ใน `calculateProvisions`:

```ts
        contract: {
          deletedAt: null,
          // TERMINATED เข้า scope ตาม Excel v3 B4/B5 — escalate ต่อระหว่างรอยึด/ตัดหนี้สูญ
          // (ยึดแล้ว = CLOSED_BAD_DEBT หลุด scope เอง — spec 2026-07-23 §4 1c)
          status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT', 'TERMINATED'] },
          ...branchFilter,
        },
```

2. Helper + ฐาน TERMINATED (หลังจากรวม outstanding ต่อ contract แล้ว — override เฉพาะสัญญา TERMINATED):

```ts
  /**
   * ฐาน ECL ของสัญญา TERMINATED = มูลค่าตามบัญชีของลูกหนี้ (carrying amount):
   * 11-2103 (accrued ค้าง) + 11-2101 (ยังไม่ accrue, excl VAT) − 11-2106 (unearned interest).
   * VAT deferred (11-2105/21-2102) หักล้างกันเอง — ไม่เข้าฐาน.
   * เหตุผล: หลังบอกเลิก 2A หยุด accrue — ฐานจาก Payment rows จะบวมรวมดอกเบี้ย/VAT
   * ที่ยังไม่รับรู้ เกิน carrying amount (spec 2026-07-23 §4 1c)
   */
  private async terminatedCarryingAmount(
    contractId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Decimal> {
    const [accrued, gross, unearned] = await Promise.all([
      this.glBalance(contractId, '11-2103', 'dr', db),
      this.glBalance(contractId, '11-2101', 'dr', db),
      this.glBalance(contractId, '11-2106', 'cr', db),
    ]);
    return accrued.plus(gross).minus(unearned);
  }
```

ใน loop สร้าง provisions (ก่อนคำนวณ rate) — ต้องรู้ status ของ contract: ขยาย include เดิม `contract: { select: { id: true, status: true } }` (มีอยู่แล้ว) และเก็บ status ลง map ตอน group:

```ts
    const contractStatus = new Map<string, string>();
    for (const p of overduePayments) {
      contractStatus.set(p.contract.id, p.contract.status);
      // ... (โค้ด group เดิม)
    }
```

แล้วใน provisions loop:

```ts
    for (const [contractId, data] of contractOutstanding) {
      const isTerminated = contractStatus.get(contractId) === 'TERMINATED';
      const baseAmount = isTerminated
        ? await this.terminatedCarryingAmount(contractId)
        : data.amount;
      // ... daysOverdue/bucket เดิม แต่แทน data.amount ด้วย baseAmount:
      const outstandingDec = baseAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const provisionAmountDec = baseAmount.mul(rateDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
```

3. `reverseStageOnPayment`: หลังคำนวณ `totalOutstanding` เพิ่ม override เดียวกัน:

```ts
    const contract = await db.contract.findUnique({
      where: { id: contractId },
      select: { status: true },
    });
    if (contract?.status === 'TERMINATED') {
      totalOutstanding = await this.terminatedCarryingAmount(contractId, db);
    }
```

- [ ] **Step 4: รัน unit test ให้ผ่าน**

Run: `npm run test --workspace=apps/api -- bad-debt.service.spec`
Expected: PASS

- [ ] **Step 5: เขียน DB-backed spec (vitest) — end-to-end กับ GL จริง**

Create `apps/api/src/modules/journal/cpa-templates/ecl-terminated-base.spec.ts` (โครง setup ตาม `bad-debt-writeoff.template.spec.ts` — cleanup list เดียวกัน + `seedFinanceCoa` + admin user):

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from './installment-accrual-2a.template';
import { BadDebtProvisionTemplate } from './bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from './bad-debt-writeoff.template';
import { EclStageReverseTemplate } from './ecl-stage-reverse.template';
import { JournalAutoService } from '../journal-auto.service';
import { BadDebtService } from '../../accounting/bad-debt.service';
import { ConsecutiveMissedService } from '../../overdue/consecutive-missed.service';

const prisma = new PrismaClient();

function buildService(journal: JournalAutoService) {
  return new BadDebtService(
    prisma as any,
    journal,
    new BadDebtProvisionTemplate(journal, prisma as any),
    new BadDebtWriteOffTemplate(journal, prisma as any),
    new EclStageReverseTemplate(journal, prisma as any),
    new ConsecutiveMissedService(prisma as any),
  );
}

describe('ECL base for TERMINATED contract = GL carrying amount', () => {
  let journal: JournalAutoService;
  let contractId: string;

  beforeAll(async () => {
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.badDebtProvision.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await seedFinanceCoa(prisma);
    if (!(await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } }))) {
      await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'a', role: 'OWNER' },
      });
    }
    journal = new JournalAutoService(prisma as any);

    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await new ContractActivation1ATemplate(journal, prisma as any).execute(contractId);

    // Accrue 3 งวดแรกผ่าน 2A จริง แล้ว mark เป็นค้างชำระ 100 วัน (B4)
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId },
      orderBy: { installmentNo: 'asc' },
      take: 3,
    });
    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    for (const inst of insts) await accrual.execute(inst.id);

    const now = Date.now();
    for (let no = 1; no <= 3; no++) {
      await prisma.payment.upsert({
        where: { contractId_installmentNo: { contractId, installmentNo: no } },
        create: {
          contractId, installmentNo: no,
          amountDue: new Decimal('1515.83'), amountPaid: new Decimal('0'),
          dueDate: new Date(now - (100 + 3 - no) * 86_400_000),
          status: 'PENDING',
        },
        update: {},
      });
    }
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'TERMINATED' } });
  });

  it('provisions B4 75% on carrying amount 12,797.51 → 9,598.13', async () => {
    const admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    await buildService(journal).calculateProvisions(admin!.id);

    const row = await prisma.badDebtProvision.findFirst({
      where: { contractId, status: 'ACTIVE', deletedAt: null },
      orderBy: { provisionDate: 'desc' },
    });
    expect(row!.agingBucket).toBe('91-180');
    // carrying = 3×1,515.83 + (17,000 − 3×1,416.66) − (6,000 − 3×500)
    //          = 4,547.49 + 12,750.02 − 4,500.00 = 12,797.51
    expect(new Decimal(row!.outstandingAmount.toString()).toFixed(2)).toBe('12797.51');
    expect(new Decimal(row!.provisionAmount.toString()).toFixed(2)).toBe('9598.13');
  });
});
```

หมายเหตุ implementer: เช็ค signature จริงของ `InstallmentAccrual2ATemplate.execute` (รับ installmentScheduleId หรือ object) ก่อนใช้ — ถ้าไม่ตรงให้ปรับตาม แต่ตัวเลข golden values ห้ามเปลี่ยน

- [ ] **Step 6: รัน DB spec**

Run: `npx vitest run src/modules/journal/cpa-templates/ecl-terminated-base.spec.ts`
Expected: PASS (ต้องมี local DB)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/accounting/bad-debt.service.ts apps/api/src/modules/accounting/bad-debt.service.spec.ts apps/api/src/modules/journal/cpa-templates/ecl-terminated-base.spec.ts
git commit -m "feat(ecl): TERMINATED เข้า scope provision + ฐาน = carrying amount จาก GL (Excel v3 B4/B5)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Cron รายวัน

**Files:**
- Modify: `apps/api/src/modules/accounting/bad-debt-provision.cron.ts:37-42`

**Interfaces:**
- Consumes: `BadDebtService.calculateProvisions` (ไม่เปลี่ยน signature)

- [ ] **Step 1: แก้ cron**

```ts
  /** ทุกวัน 00:30 BKK (หลัง 2A accrual 00:01) — Excel v3 "Daily Cron" (spec 2026-07-23 §4 1c) */
  @Cron('30 0 * * *', { timeZone: 'Asia/Bangkok' })
  async run(): Promise<{ created: number; totalProvision: number; period: string } | null> {
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
```

(ลบ `prevMonth` — period = เดือนปัจจุบัน; แก้ docblock หัวไฟล์บรรทัด 7-27 ให้บอกว่า daily + delta-vs-GL + idempotent ราย runDate; log/Sentry messages คงโครงเดิม)

- [ ] **Step 2: Type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/accounting/bad-debt-provision.cron.ts
git commit -m "feat(ecl): provision cron รายเดือน → รายวัน 00:30 BKK ตาม Excel v3

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Write-off template แยกขา accrued/deferred + CN VAT ม.82/5

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/bad-debt-writeoff.template.ts` (rewrite `execute`)
- Test: `apps/api/src/modules/journal/cpa-templates/bad-debt-writeoff.template.spec.ts`

**Interfaces:**
- Consumes: `InstallmentSchedule.accrualJournalEntryId` (schema.prisma:1392), per-installment derivation แบบ JP5 (contract fields: `totalMonths`, `financedAmount`, `storeCommission`, `interestTotal`, `vatAmount`)
- Produces: `execute(input: BadDebtWriteOffInput, tx?)` signature เดิม; JE metadata เพิ่ม `creditNoteIssued: boolean`, `creditNoteVatAmount: string` (เฟส 3 ใช้ออกเอกสาร)

**JE line set ใหม่** (mirror JP5 ลบขาเงินสด — งวด accrued ออก CN ตาม ม.82/5, งวด deferred VAT ถึงกำหนดตาม ม.82/3 + รับรู้ดอกเบี้ยแล้วตัดเป็นหนี้สูญ, ยอด Cr ฝั่งลูกหนี้ใช้ GL balance เพื่อเก็บกวาดเศษ rounding):

```
Dr 21-2101  cnVat (= vatPerInst × accruedUnpaidCount)     ← ใบลดหนี้ VAT (ม.82/5) — ถ้ามีงวด accrued
Dr 11-2106  glBalance(11-2106)                            ← ล้าง unearned interest คงเหลือ
Dr 21-2102  glBalance(21-2102, side=cr)                   ← ล้างภาษีขายรอเรียกเก็บคงเหลือ
Dr 11-2102  provisionConsumed                             ← ใช้ค่าเผื่อก่อน (เดิม)
Dr 51-1102  plug (loss ส่วนเกินค่าเผื่อ)                    ← ส่วนที่เหลือให้ JE balance
  Cr 11-2103  glBalance(11-2103)                          ← ล้างลูกหนี้ค้าง (accrued)
  Cr 11-2101  glBalance(11-2101)                          ← ล้างลูกหนี้ Gross (deferred)
  Cr 11-2105  glBalance(11-2105)                          ← ล้างลูกหนี้ภาษีขายรอฯ
  Cr 21-2101  glBalance(21-2102, side=cr)                 ← VAT deferred ถึงกำหนดนำส่ง (ม.82/3)
  Cr 41-1101  glBalance(11-2106)                          ← รับรู้ดอกเบี้ยงวด deferred (แบบ JP5)
```

Golden values (17k/12, 1A + 2A×3 งวด, ไม่มีชำระ, provision 0):
- Cr 11-2103 = 4,547.49 · Cr 11-2101 = 12,750.02 · Cr 11-2105 = 892.51 · Cr 21-2101 = 892.51 · Cr 41-1101 = 4,500.00 → ΣCr = 23,582.53
- Dr 21-2101 = 297.51 · Dr 11-2106 = 4,500.00 · Dr 21-2102 = 892.51 → Dr 51-1102 (plug) = **17,892.51**

- [ ] **Step 1: เขียน failing tests (เพิ่มใน spec เดิม)**

```ts
  it('mixed accrued/deferred: issues CN VAT + clears 11-2103/11-2106/VAT legs (golden 17k, 3 accrued)', async () => {
    const c3 = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c3.id);
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c3.id }, orderBy: { installmentNo: 'asc' }, take: 3,
    });
    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    for (const inst of insts) await accrual.execute(inst.id);

    const result = await new BadDebtWriteOffTemplate(journal, prisma as any).execute({ contractId: c3.id });
    expect(result.entryNo).toMatch(/^JE-/);

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'write-off' } } as any,
          { metadata: { path: ['contractId'], equals: c3.id } } as any,
        ],
      },
      include: { lines: true },
    });
    const get = (code: string, side: 'debit' | 'credit') => {
      const l = je!.lines.find(
        (x) => x.accountCode === code && new Decimal(x[side].toString()).gt(0),
      );
      return l ? new Decimal(l[side].toString()).toFixed(2) : null;
    };
    expect(get('21-2101', 'debit')).toBe('297.51');    // CN ม.82/5
    expect(get('11-2103', 'credit')).toBe('4547.49');
    expect(get('11-2101', 'credit')).toBe('12750.02');
    expect(get('11-2106', 'debit')).toBe('4500.00');
    expect(get('21-2102', 'debit')).toBe('892.51');
    expect(get('11-2105', 'credit')).toBe('892.51');
    expect(get('21-2101', 'credit')).toBe('892.51');   // deferred VAT ถึงกำหนด
    expect(get('41-1101', 'credit')).toBe('4500.00');
    expect(get('51-1102', 'debit')).toBe('17892.51');  // loss plug

    const totalDr = je!.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = je!.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    expect((je!.metadata as any).creditNoteIssued).toBe(true);
    expect((je!.metadata as any).creditNoteVatAmount).toBe('297.51');
  });

  it('all-deferred (no 2A run): no CN line, clears 1A balances only', async () => {
    const c4 = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c4.id);
    await new BadDebtWriteOffTemplate(journal, prisma as any).execute({ contractId: c4.id });

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'write-off' } } as any,
          { metadata: { path: ['contractId'], equals: c4.id } } as any,
        ],
      },
      include: { lines: true },
    });
    // ไม่มี Dr 21-2101 (ไม่มีงวด accrued → ไม่มี CN)
    const cnLine = je!.lines.find(
      (l) => l.accountCode === '21-2101' && new Decimal(l.debit.toString()).gt(0),
    );
    expect(cnLine).toBeUndefined();
    expect((je!.metadata as any).creditNoteIssued).toBe(false);
    // Cr 11-2101 = 17,000 เต็ม, Dr 11-2106 = 6,000, loss plug = 18,190 − 6,000 − 1,190 ... :
    // Dr: 11-2106 6,000 + 21-2102 1,190 → Cr: 11-2101 17,000 + 11-2105 1,190 + 21-2101 1,190 + 41-1101 6,000
    // → Dr 51-1102 = 25,380 − 7,190 = 18,190.00
    const loss = je!.lines.find((l) => l.accountCode === '51-1102');
    expect(new Decimal(loss!.debit.toString()).toFixed(2)).toBe('18190.00');
  });
```

(เพิ่ม import `InstallmentAccrual2ATemplate` ที่หัวไฟล์ spec; test เดิม 'consumes provision first...' ยังต้องผ่าน — provision consume logic คงเดิม แต่ยอด expense เปลี่ยนตาม line set ใหม่ → แก้ assertion จำนวนเงินใน test เดิมถ้า assert ยอดเป๊ะ)

- [ ] **Step 2: รัน test ให้ fail**

Run: `npx vitest run src/modules/journal/cpa-templates/bad-debt-writeoff.template.spec.ts`
Expected: FAIL — ไม่มีขา CN/11-2103/11-2106

- [ ] **Step 3: Rewrite `execute()`**

โครงใหม่ (แทน grossOutstanding เดิมบรรทัด 61-133; idempotency check + contract fetch คงเดิม):

```ts
    // ---- GL balances (เก็บกวาดจริงถึงศูนย์ รวมเศษ rounding งวดสุดท้าย) ----
    const glBal = async (accountCode: string, side: 'dr' | 'cr'): Promise<Decimal> => {
      const ls = await client.journalLine.findMany({
        where: {
          accountCode,
          journalEntry: {
            metadata: { path: ['contractId'], equals: contractId },
            status: 'POSTED',
            deletedAt: null,
          },
        },
        select: { debit: true, credit: true },
      });
      let b = new Decimal(0);
      for (const l of ls) {
        b = side === 'dr'
          ? b.plus(l.debit.toString()).minus(l.credit.toString())
          : b.plus(l.credit.toString()).minus(l.debit.toString());
      }
      return b;
    };

    const bal2103 = await glBal('11-2103', 'dr');
    const bal2101 = await glBal('11-2101', 'dr');
    const bal2106 = await glBal('11-2106', 'cr');
    const bal2105 = await glBal('11-2105', 'dr');
    const bal21_2102 = await glBal('21-2102', 'cr');
    const provisionBalance = await glBal('11-2102', 'cr');

    const totalReceivable = bal2103.plus(bal2101);
    if (totalReceivable.lte(0)) {
      throw new Error(
        `[A.5a] BadDebtWriteOff — no outstanding receivable balance for contract ${contract.contractNumber}`,
      );
    }

    // ---- CN VAT (ม.82/5) — งวด accrued ที่ยังไม่จ่าย (mirror JP5) ----
    const c = await client.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: {
        id: true, contractNumber: true, totalMonths: true,
        financedAmount: true, storeCommission: true, interestTotal: true, vatAmount: true,
      },
    });
    const total = new Decimal(c.totalMonths);
    const financed = new Decimal(c.financedAmount.toString());
    const commission = c.storeCommission != null
      ? new Decimal(c.storeCommission.toString())
      : financed.times('0.10').toDecimalPlaces(2);
    const interest = new Decimal(c.interestTotal.toString());
    const grossExclVat = financed.plus(commission).plus(interest);
    const vat = c.vatAmount != null
      ? new Decimal(c.vatAmount.toString())
      : grossExclVat.times('0.07').toDecimalPlaces(2);
    const vatPerInst = vat.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const allInsts = await client.installmentSchedule.findMany({
      where: { contractId, deletedAt: null },
      select: { installmentNo: true, accrualJournalEntryId: true },
    });
    const paidNos = new Set(
      (
        await client.payment.findMany({
          where: { contractId, status: 'PAID' },
          select: { installmentNo: true },
        })
      ).map((p) => p.installmentNo),
    );
    const accruedUnpaidCount = new Decimal(
      allInsts.filter((i) => i.accrualJournalEntryId !== null && !paidNos.has(i.installmentNo)).length,
    );
    const cnVat = vatPerInst.times(accruedUnpaidCount);
    const creditNoteIssued = accruedUnpaidCount.gt(0);

    // ---- สร้าง lines: Dr ทั้งหมดก่อน แล้ว plug 51-1102 ให้ balance ----
    const zero = new Decimal(0);
    const lines: { accountCode: string; dr: Decimal; cr: Decimal; description?: string }[] = [];

    if (creditNoteIssued) {
      lines.push({
        accountCode: '21-2101', dr: cnVat, cr: zero,
        description: `ใบลดหนี้ VAT ${accruedUnpaidCount.toNumber()} งวด (ม.82/5)`,
      });
    }
    if (bal2106.gt(0)) {
      lines.push({ accountCode: '11-2106', dr: bal2106, cr: zero, description: 'ยกเลิกรายได้รอตัดบัญชี-ดอกเบี้ย' });
    }
    if (bal21_2102.gt(0)) {
      lines.push({ accountCode: '21-2102', dr: bal21_2102, cr: zero, description: 'ล้างภาษีขายรอเรียกเก็บ' });
    }

    if (bal2103.gt(0)) {
      lines.push({ accountCode: '11-2103', dr: zero, cr: bal2103, description: 'ล้างลูกหนี้ค้างชำระ (accrued)' });
    }
    if (bal2101.gt(0)) {
      lines.push({ accountCode: '11-2101', dr: zero, cr: bal2101, description: 'ล้างลูกหนี้ผ่อนชำระ (Gross)' });
    }
    if (bal2105.gt(0)) {
      lines.push({ accountCode: '11-2105', dr: zero, cr: bal2105, description: 'ล้างลูกหนี้ภาษีขายรอฯ' });
    }
    if (bal21_2102.gt(0)) {
      lines.push({ accountCode: '21-2101', dr: zero, cr: bal21_2102, description: 'ภาษีขาย ภ.พ.30 ถึงกำหนด (deferred, ม.82/3)' });
    }
    if (bal2106.gt(0)) {
      lines.push({ accountCode: '41-1101', dr: zero, cr: bal2106, description: 'รับรู้รายได้ดอกเบี้ย (deferred)' });
    }

    // loss = ΣCr − ΣDr(ที่มีอยู่) → consume ค่าเผื่อก่อน แล้ว plug 51-1102
    const sumDr = lines.reduce((s, l) => s.plus(l.dr), new Decimal(0));
    const sumCr = lines.reduce((s, l) => s.plus(l.cr), new Decimal(0));
    let loss = sumCr.minus(sumDr);
    if (loss.lt(0)) {
      throw new Error(
        `[A.5a] BadDebtWriteOff — negative loss plug (${loss.toFixed(2)}) for contract ${contract.contractNumber}; GL state ผิดปกติ ต้องตรวจก่อน`,
      );
    }
    const provisionConsumed = Decimal.min(
      provisionBalance.gt(0) ? provisionBalance : new Decimal(0),
      loss,
    );
    if (provisionConsumed.gt(0)) {
      lines.push({ accountCode: '11-2102', dr: provisionConsumed, cr: zero, description: 'ล้างค่าเผื่อหนี้สงสัยจะสูญ' });
      loss = loss.minus(provisionConsumed);
    }
    if (loss.gt(0)) {
      lines.push({
        accountCode: '51-1102', dr: loss, cr: zero,
        description: `หนี้สูญ — ${writeOffReason ?? 'ตัดหนี้สูญ'}`,
      });
    }
```

metadata ใน `createAndPost` เพิ่ม:

```ts
        metadata: {
          tag: 'BAD-DEBT',
          flow: 'write-off',
          contractId,
          totalReceivable: totalReceivable.toFixed(2),
          provisionConsumed: provisionConsumed.toFixed(2),
          writeOffExpense: loss.toFixed(2),
          creditNoteIssued,
          creditNoteVatAmount: cnVat.toFixed(2),
          writeOffReason: writeOffReason ?? null,
        },
```

(ลบ `grossOutstanding` เดิม; คง `reference: \`${contractId}:bad-debt-write-off\`` เดิม)

- [ ] **Step 4: รัน test ให้ผ่าน**

Run: `npx vitest run src/modules/journal/cpa-templates/bad-debt-writeoff.template.spec.ts`
Expected: PASS ทุก test (เดิม + ใหม่)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/bad-debt-writeoff.template.ts apps/api/src/modules/journal/cpa-templates/bad-debt-writeoff.template.spec.ts
git commit -m "fix(ecl): write-off แยกขา accrued/deferred + CN VAT ม.82/5 + ล้าง 11-2103/11-2106/VAT ครบ (เดิมทิ้งค้างงบ)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: CI — DB specs ใต้ accounting/ ต้องรันจริง

**Files:**
- Modify: `.github/workflows/deploy-gcp.yml:145-147` (vitest step `FILES=`)

ปัจจุบัน `bad-debt.streak-*.integration.spec.ts` (vitest style, อยู่ใต้ `src/modules/accounting/`) **ไม่รันใน CI ใดเลย** — jest ignore เพราะชื่อ `.integration.spec.ts` และ vitest step glob เฉพาะ `cpa-templates/*.spec.ts`

- [ ] **Step 1: แก้ CI**

```yaml
          FILES=$(ls src/modules/journal/cpa-templates/*.spec.ts | grep -v contract-cancellation.template.spec.ts)
          npx vitest run --no-file-parallelism $FILES \
            src/modules/installments/reschedule.service.spec.ts \
            src/modules/accounting/*.integration.spec.ts
```

- [ ] **Step 2: รัน specs ที่เพิ่มเข้า CI ให้ผ่าน local ก่อน**

Run: `npx vitest run --no-file-parallelism src/modules/accounting/bad-debt.streak-provision.integration.spec.ts src/modules/accounting/bad-debt.streak-reverse.integration.spec.ts`
Expected: PASS — **ถ้า fail** เพราะพฤติกรรมใหม่ (late fee/ฐาน) ให้แก้ expectation ของ spec ให้ตรง spec ใหม่ (ห้ามแก้ service ให้ผ่าน test เก่า)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-gcp.yml apps/api/src/modules/accounting/bad-debt.streak-provision.integration.spec.ts apps/api/src/modules/accounting/bad-debt.streak-reverse.integration.spec.ts
git commit -m "ci: รัน accounting *.integration.spec.ts ใน vitest step (เดิมไม่เคยรันใน CI)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Dry-run CLI สำหรับ prod-copy

**Files:**
- Create: `apps/api/src/cli/ecl-dry-run.cli.ts`
- Modify: `apps/api/package.json` (เพิ่ม script `"ecl:dry-run": "ts-node src/cli/ecl-dry-run.cli.ts"` — ดู script เดิมเช่น `wipe:accounting` แล้วใช้ runner เดียวกัน)

**Interfaces:**
- Consumes: logic เดียวกับ `calculateProvisions` แบบ read-only — refactor ขั้นต่ำ: เพิ่ม param `dryRun = false` ใน `calculateProvisions(calculatedById, branchId?, dryRun?)`; เมื่อ `dryRun=true` ข้าม `$transaction` (ไม่ reverse/create rows) และข้าม `badDebtProvisionTemplate.execute` แต่**คำนวณ delta เทียบ GL จริง** แล้วคืน `{ created, totalProvision, byBucket, deltas: { contractId, bucket, prevGl, target, delta }[] }`

- [ ] **Step 1: เพิ่ม dryRun ใน service**

ใน `calculateProvisions`: หุ้ม `$transaction` block และ template loop ด้วย `if (!dryRun)`; เก็บ `deltas` array ระหว่าง loop (คำนวณ glPrev + delta เสมอ):

```ts
  async calculateProvisions(
    calculatedById: string,
    branchId?: string,
    dryRun = false,
  ): Promise<{
    created: number;
    totalProvision: number;
    byBucket: Record<string, { count: number; amount: number }>;
    deltas?: { contractId: string; bucket: string; prevGl: string; target: string; delta: string }[];
  }> {
```

(รายละเอียด: ใน dry-run โหมด delta loop รันเหมือนเดิมแต่แทน `execute` ด้วยการ push ลง `deltas`)

- [ ] **Step 2: เขียน CLI**

```ts
/**
 * ECL dry-run — คำนวณ provision + delta เทียบ GL โดยไม่เขียนอะไรลง DB
 * ใช้ก่อนเปิดเฟส 1 บน prod: ต่อ prod-copy ผ่าน cloud-sql-proxy แล้วรัน
 *   DATABASE_URL=... npm --prefix apps/api run ecl:dry-run
 */
import { PrismaClient } from '@prisma/client';
import { BadDebtService } from '../modules/accounting/bad-debt.service';
import { JournalAutoService } from '../modules/journal/journal-auto.service';
import { BadDebtProvisionTemplate } from '../modules/journal/cpa-templates/bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from '../modules/journal/cpa-templates/bad-debt-writeoff.template';
import { EclStageReverseTemplate } from '../modules/journal/cpa-templates/ecl-stage-reverse.template';
import { ConsecutiveMissedService } from '../modules/overdue/consecutive-missed.service';

async function main() {
  const prisma = new PrismaClient();
  const journal = new JournalAutoService(prisma as any);
  const service = new BadDebtService(
    prisma as any,
    journal,
    new BadDebtProvisionTemplate(journal, prisma as any),
    new BadDebtWriteOffTemplate(journal, prisma as any),
    new EclStageReverseTemplate(journal, prisma as any),
    new ConsecutiveMissedService(prisma as any),
  );

  const system = await prisma.user.findFirst({ where: { isSystemUser: true }, select: { id: true } });
  if (!system) throw new Error('SYSTEM user not found');

  const result = await service.calculateProvisions(system.id, undefined, true);

  console.log('=== ECL DRY-RUN (no writes) ===');
  console.log('byBucket:', JSON.stringify(result.byBucket, null, 2));
  console.log('totalProvision target:', result.totalProvision.toLocaleString());
  let increase = 0, release = 0;
  for (const d of result.deltas ?? []) {
    const n = Number(d.delta);
    if (n > 0) increase += n; else release += n;
  }
  console.log(`JE ที่จะโพสต์: ${result.deltas?.filter((d) => Number(d.delta) !== 0).length} รายการ`);
  console.log(`ตั้งเพิ่มรวม: ${increase.toLocaleString()} ฿ | release รวม: ${release.toLocaleString()} ฿`);
  console.log('--- top 20 by |delta| ---');
  (result.deltas ?? [])
    .sort((a, b) => Math.abs(Number(b.delta)) - Math.abs(Number(a.delta)))
    .slice(0, 20)
    .forEach((d) => console.log(`${d.contractId} ${d.bucket} prevGL=${d.prevGl} target=${d.target} delta=${d.delta}`));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Unit test dryRun ไม่เขียน DB**

เพิ่มใน `bad-debt.service.spec.ts`:

```ts
    it('dryRun=true computes deltas but writes nothing', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          contract: { id: 'c-1', status: 'OVERDUE' },
          dueDate: new Date(Date.now() - 40 * 86_400_000),
          amountDue: new Prisma.Decimal('1000.00'),
          amountPaid: new Prisma.Decimal('0'),
          lateFee: new Prisma.Decimal('0'),
          lateFeeWaived: false,
        },
      ]);
      prisma.journalLine.findMany.mockResolvedValue([]);

      const r = await service.calculateProvisions('owner-1', undefined, true);
      expect(r.deltas).toHaveLength(1);
      expect(r.deltas![0].delta).toBe('150.00');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(provisionTemplateMock.execute).not.toHaveBeenCalled();
    });
```

- [ ] **Step 4: รัน tests + type check**

Run: `npm run test --workspace=apps/api -- bad-debt.service.spec && ./tools/check-types.sh api`
Expected: PASS / 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/cli/ecl-dry-run.cli.ts apps/api/package.json apps/api/src/modules/accounting/bad-debt.service.ts apps/api/src/modules/accounting/bad-debt.service.spec.ts
git commit -m "feat(ecl): dry-run CLI รายงาน delta ก่อนรันจริงบน prod (spec §8)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Phase 1 verification gate

- [ ] **Step 1:** `./tools/check-types.sh all` → 0 errors
- [ ] **Step 2:** `npm run test --workspace=apps/api` → jest unit ผ่านทั้งหมด (ยกเว้น pre-existing failures ที่ documented ใน memory — ถ้าเจอใหม่ที่เกี่ยว bad-debt ต้องแก้)
- [ ] **Step 3:** `cd apps/api && npx vitest run --no-file-parallelism $(ls src/modules/journal/cpa-templates/*.spec.ts | grep -v contract-cancellation.template.spec.ts) src/modules/accounting/bad-debt.streak-provision.integration.spec.ts src/modules/accounting/bad-debt.streak-reverse.integration.spec.ts` → PASS
- [ ] **Step 4:** dispatch `code-reviewer` agent review diff เฟส 1 → แก้ Critical ก่อนไปต่อ
- [ ] **Step 5:** รายงานผลให้ owner review + approve ก่อนเริ่มเฟส 2 (กติกา phase review)

---

## Phase 2 — Workflow Enforcement

### Task 10: Seeds + prod manual SQL

**Files:**
- Modify: `apps/api/prisma/seeds/collections-foundation.seed.ts:214-217` (+ เพิ่ม 1 entry ใน `mdmLetterConfigs` array)
- Create: `apps/api/prisma/migrations-manual/2026-07-23-enable-letter-auto-generate-and-jp5-strict.sql`

- [ ] **Step 1: แก้ seed**

```ts
    {
      key: 'letter_auto_generate_enabled',
      value: 'true',
      label: 'เปิดใช้งาน cron สร้างหนังสืออัตโนมัติรายวัน (ผ่านการตรวจสอบทางกฎหมาย — owner 2026-07-23)',
    },
```

และเพิ่ม entry ใหม่ท้าย array เดิม:

```ts
    {
      key: 'jp5_require_terminated_status',
      value: 'true',
      label: 'JP5 strict mode: ต้องส่งหนังสือบอกเลิกสัญญา (TERMINATED) ก่อนยึดเครื่อง (ปพพ.386 — owner 2026-07-23)',
    },
```

(seed upsert แตะแค่ label ตอน update — dev DB เดิมที่มี key อยู่แล้วจะไม่ถูก flip อัตโนมัติ ใช้ SQL ใน Step 2 กับทุก env ที่มีข้อมูลแล้ว)

- [ ] **Step 2: เขียน manual SQL** (ลอกโครง confirmation gate จาก `2026-05-17-merge-vat-rate-keys.sql`)

```sql
-- Manual (NOT auto-applied) migration. Run via:
--   psql "$DATABASE_URL" -f apps/api/prisma/migrations-manual/2026-07-23-enable-letter-auto-generate-and-jp5-strict.sql
-- เปิด enforcement ตาม spec 2026-07-23 (ECL Excel v3 เฟส 2):
--   1. letter_auto_generate_enabled = true  (ผ่านการตรวจสอบทางกฎหมาย — owner 2026-07-23)
--   2. jp5_require_terminated_status = true (ปพพ.386 — ต้องบอกเลิกก่อนยึด)
\prompt 'Type YES_ENABLE_ENFORCEMENT to continue: ' confirm
\if :{?confirm}
\else
\q
\endif

BEGIN;

UPDATE system_config
SET value = 'true',
    label = 'เปิดใช้งาน cron สร้างหนังสืออัตโนมัติรายวัน (ผ่านการตรวจสอบทางกฎหมาย — owner 2026-07-23)'
WHERE key = 'letter_auto_generate_enabled';

INSERT INTO system_config (id, key, value, label, created_at, updated_at)
SELECT gen_random_uuid(), 'jp5_require_terminated_status', 'true',
       'JP5 strict mode: ต้องส่งหนังสือบอกเลิกสัญญา (TERMINATED) ก่อนยึดเครื่อง (ปพพ.386 — owner 2026-07-23)',
       NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM system_config WHERE key = 'jp5_require_terminated_status');

UPDATE system_config
SET value = 'true'
WHERE key = 'jp5_require_terminated_status' AND value <> 'true';

COMMIT;

SELECT key, value FROM system_config
WHERE key IN ('letter_auto_generate_enabled', 'jp5_require_terminated_status');
```

หมายเหตุ implementer: เช็คชื่อคอลัมน์จริงของ `system_config` (id/created_at/updated_at) จาก schema.prisma model `SystemConfig` ก่อน — ถ้า id เป็น uuid default ใน DB ให้ตัด `gen_random_uuid()` ออกตาม; และเทียบ `\prompt` gate syntax กับไฟล์ `2026-05-17-merge-vat-rate-keys.sql` ให้ตรง pattern เดิม

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/seeds/collections-foundation.seed.ts apps/api/prisma/migrations-manual/2026-07-23-enable-letter-auto-generate-and-jp5-strict.sql
git commit -m "feat(enforcement): เปิด letter auto-generate + JP5 strict mode (seed + prod SQL)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Write-off gate — ต้อง TERMINATED

**Files:**
- Modify: `apps/api/src/modules/accounting/bad-debt.service.ts` (`writeOffBadDebt`, หลัง fetch contract ~บรรทัด 488-494)
- Test: `apps/api/src/modules/accounting/bad-debt.service.spec.ts`

- [ ] **Step 1: เขียน failing tests**

```ts
      it('refuses write-off when contract is not TERMINATED (Excel v3 workflow gate)', async () => {
        prisma.contract.findFirst.mockResolvedValue({ id: 'c-1', status: 'OVERDUE', contractNumber: 'CT-1' });
        await expect(
          service.writeOffBadDebt('c-1', 'fm-1', 'owner-1'),
        ).rejects.toThrow('ตัดหนี้สูญได้เฉพาะสัญญาที่บอกเลิกแล้ว');
      });

      it('allows write-off when contract is TERMINATED', async () => {
        prisma.contract.findFirst.mockResolvedValue({ id: 'c-1', status: 'TERMINATED', contractNumber: 'CT-1' });
        prisma.payment.findMany.mockResolvedValue([]);
        await expect(service.writeOffBadDebt('c-1', 'fm-1', 'owner-1')).resolves.toBeDefined();
      });
```

และแก้ mocks ของ write-off tests เดิมทั้งหมด (tier tests, audit log tests) ให้ contract mock มี `status: 'TERMINATED'` แทนค่าที่ไม่ใช่ CLOSED_BAD_DEBT เดิม

- [ ] **Step 2: รัน test ให้ fail** — `npm run test --workspace=apps/api -- bad-debt.service.spec`

- [ ] **Step 3: เพิ่ม gate**

หลัง check `CLOSED_BAD_DEBT` เดิม:

```ts
    if (contract.status !== 'TERMINATED') {
      throw new BadRequestException(
        'ตัดหนี้สูญได้เฉพาะสัญญาที่บอกเลิกแล้ว (TERMINATED) — กรุณาออกหนังสือบอกเลิก (CONTRACT_TERMINATION_60D) และบันทึกการส่ง EMS ก่อน (ปพพ.386)',
      );
    }
```

- [ ] **Step 4: รัน test ให้ผ่าน** — expected PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/accounting/bad-debt.service.ts apps/api/src/modules/accounting/bad-debt.service.spec.ts
git commit -m "feat(enforcement): ตัดหนี้สูญได้เฉพาะสัญญา TERMINATED (Excel v3 workflow)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: อัปเดต docs

**Files:**
- Modify: `.claude/rules/accounting.md` — section ECL/bad-debt

- [ ] **Step 1:** เพิ่ม/แก้ section สรุป: cron รายวัน 00:30, delta 2 ทิศเทียบ GL 11-2102, ฐาน = amountDue−amountPaid (ไม่มีค่าปรับ), TERMINATED base = carrying amount (11-2103+11-2101−11-2106), write-off split legs + CN ม.82/5 + metadata `creditNoteIssued`, gates เฟส 2 (letter auto-gen เปิด, JP5 strict, write-off ต้อง TERMINATED), dry-run CLI `npm run ecl:dry-run`
- [ ] **Step 2:** Commit

```bash
git add .claude/rules/accounting.md
git commit -m "docs(accounting): อัปเดตกติกา ECL ตาม Excel v3 (daily cron, GL delta, TERMINATED base, gates)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Phase 2 verification gate + rollout

- [ ] **Step 1:** `./tools/check-types.sh all` + `npm run test --workspace=apps/api` → ผ่าน
- [ ] **Step 2:** dispatch `code-reviewer` review diff เฟส 2
- [ ] **Step 3:** เปิด PR จาก `feat/ecl-excel-v3-alignment` → main สรุป 2 เฟส + link spec (ใช้ commit-commands:commit-push-pr ได้)
- [ ] **Step 4 (rollout — หลัง merge, ทำกับ owner):**
  1. ต่อ prod-copy ผ่าน cloud-sql-proxy → `DATABASE_URL=... npm --prefix apps/api run ecl:dry-run` → ส่งสรุป delta (ตั้งเพิ่ม/release/top-20) ให้ owner ดูก่อน
  2. Owner approve → deploy (auto จาก main) → รัน manual SQL เฟส 2 บน prod → แจ้งทีมเก็บเงิน (จดหมายเข้าคิวอัตโนมัติ 09:15, ยึด/ตัดหนี้สูญต้องบอกเลิกก่อน)
  3. เช้าวันถัดไป: เช็ค JE จาก cron รอบแรก + Sentry

---

## Out of scope (plan นี้)

- เฟส 3 (เอกสาร CN + PDF + LINE) — plan แยกหลังเฟส 1 ship (ต้องใช้ metadata `creditNoteIssued` จาก Task 6)
- คำถาม NET_PI ถึง CPA (spec §9) — ไม่ block
