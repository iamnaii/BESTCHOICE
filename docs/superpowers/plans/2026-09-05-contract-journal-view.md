# Contract Journal View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้ผู้ใช้เปิดดู JE ทุกใบของสัญญา (ทั้งสมุด FINANCE และ SHOP) ได้จากหน้ารายละเอียดสัญญาและหน้ายึดเครื่อง และให้ JE จ่ายคืน/ไม่คืน/รับโอนหน้าร้าน เขียนเลขสัญญาแทน UUID

**Architecture:** Endpoint ใหม่ `GET /contracts/:id/journal-entries` (contracts controller → `ContractJournalQueryService` ในโมดูล journal) อ่าน JE ทุกใบที่ stamp `metadata.contractId` + ใบกลับรายการที่ชี้กลับมา แล้ว map ด้วย util กลางตัวเดียวกับ endpoint รับชำระเดิม ฝั่ง web แยกการ์ด `JeBlock` ออกจาก `PaymentHistorySheet` เป็นไฟล์ของตัวเอง เพิ่มตารางป้าย flow ครบ แล้วสร้าง `ContractJournalDialog` ที่ 2 หน้าเรียกใช้ร่วมกัน

**Tech Stack:** NestJS + Prisma (jest unit spec, mock prisma) · React 18 + react-query + shadcn Dialog (vitest + RTL)

**Spec:** `docs/superpowers/specs/2026-09-05-contract-journal-view-design.md`

## Global Constraints

- **ห้าม `git commit` / push / PR / deploy** — คำสั่งเจ้าของ 2026-09-05 ทุกขั้น "Commit" ในแผนนี้ถูกแทนด้วย "หยุดที่ working tree" จนกว่าเจ้าของจะสั่ง
- เงินเป็น `Prisma.Decimal` / `.toFixed(2)` string เท่านั้น ห้าม `Number()` ฝั่ง API
- UI text ภาษาไทย, ใช้ design tokens (`text-muted-foreground`, `bg-card`, …) ห้าม hardcoded color, ข้อความไทยใช้ `leading-snug`
- ห้ามแตะพฤติกรรมของ `GET /payments/contract/:id/journal-entries` — spec `payment-query.journal-entries.spec.ts` ต้องผ่านโดยไม่แก้
- Roles ของ endpoint ใหม่ = `OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT, SALES` + branch scope ใน service (404 เมื่อข้ามสาขา)
- รันเทสต์: API `cd apps/api && npx jest <path>` · Web `cd apps/web && npx vitest run <path>` · types `./tools/check-types.sh all`

---

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `apps/api/src/modules/journal/contract-je-view.util.ts` (สร้าง) | mapper กลาง JE → view (Dr ก่อน Cr, string money, metadata coercion) + `collectAccountCodes` |
| `apps/api/src/modules/payments/services/payment-query.service.ts` (แก้ 186-244) | ใช้ mapper กลางแทนบล็อก inline เดิม |
| `apps/api/src/modules/journal/contract-journal-query.service.ts` (สร้าง) | `listForContract(contractId, user)` — 404/branch scope, 2 queries, companyCode |
| `apps/api/src/modules/journal/contract-journal-query.service.spec.ts` (สร้าง) | unit spec mock prisma |
| `apps/api/src/modules/journal/journal.module.ts` (แก้) | providers + exports |
| `apps/api/src/modules/contracts/contracts.controller.ts` (แก้) | route `GET :id/journal-entries` |
| `apps/api/src/modules/journal/contract-label.util.ts` (สร้าง) + `.spec.ts` | `resolveContractLabel(client, contractId)` |
| `apps/api/src/modules/journal/cpa-templates/{refund-payout,refund-waive,shop-collect-settlement}.template.ts` (แก้ description) | ใช้เลขสัญญา |
| `apps/web/src/components/payment/JeBlock.tsx` (สร้าง) | `JeBlock`, `ContractJe`, `ContractJeLine`, `journalFlowLabel` |
| `apps/web/src/components/payment/PaymentHistorySheet.tsx` (แก้) | import จาก JeBlock.tsx ลบสำเนาเดิม |
| `apps/web/src/components/payment/__tests__/JeBlock.test.tsx` (สร้าง) | ตารางป้าย + render |
| `apps/web/src/components/contract/ContractJournalDialog.tsx` (สร้าง) + `__tests__/ContractJournalDialog.test.tsx` | dialog จัดกลุ่มตามสมุด |
| `apps/web/src/pages/ContractDetailPage.tsx` (แก้) | ปุ่ม "บันทึกบัญชี" |
| `apps/web/src/pages/RepossessionsPage.tsx` (แก้) + `RepossessionsPage.journal-button.test.tsx` (สร้าง) | ปุ่ม "บัญชี" ทั้งสองตาราง |

---

### Task 1: Mapper กลาง `toContractJeView` + ให้ endpoint รับชำระเดิมใช้

**Files:**
- Create: `apps/api/src/modules/journal/contract-je-view.util.ts`
- Modify: `apps/api/src/modules/payments/services/payment-query.service.ts:186-244`
- Test (มีอยู่แล้ว ห้ามแก้): `apps/api/src/modules/payments/services/payment-query.journal-entries.spec.ts`

**Interfaces:**
- Produces: `toContractJeView(e: JeEntrySource, nameByCode: Map<string,string>): ContractJeView`, `collectAccountCodes(entries): string[]`, types `ContractJeView`, `ContractJeLineView`, `JeEntrySource`, `JeLineSource`

- [ ] **Step 1: รัน spec เดิมให้เห็นว่าเขียวก่อนแตะ**

Run: `cd apps/api && npx jest src/modules/payments/services/payment-query.journal-entries.spec.ts`
Expected: PASS (ทุกเคส)

- [ ] **Step 2: สร้าง util**

```ts
// apps/api/src/modules/journal/contract-je-view.util.ts
import { Prisma } from '@prisma/client';

/**
 * Read-side view of one POSTED journal entry as consumed by the web JE card
 * (`JeBlock`). Shared by `PaymentQueryService.getContractJournalEntries`
 * (receipt-scoped, 5 tags/flows) and `ContractJournalQueryService`
 * (contract-scoped, every flow) — one mapper so the two endpoints can never
 * drift on money formatting or metadata coercion.
 *
 * Conventions locked by `payment-query.journal-entries.spec.ts`:
 *   - money as `.toFixed(2)` STRINGS (never Number())
 *   - Dr lines before Cr lines (JournalLine has no lineNo; DB order is random)
 *   - metadata soft-links coerced to `string | null` (non-strings → null)
 */
export interface ContractJeLineView {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  description: string;
}

export interface ContractJeView {
  id: string;
  entryNumber: string;
  entryDate: Date;
  postedAt: Date | null;
  description: string;
  paymentId: string | null;
  tag: string | null;
  flow: string | null;
  deltaApplied: string | null;
  lateFeePortion: string | null;
  /** Original JE that has since been mirrored out by a receipt void. */
  reversed: boolean;
  reversedByEntryNumber: string | null;
  /** Set on receipt-void REVERSAL JEs — points at the original entry id. */
  originalEntryId: string | null;
  lines: ContractJeLineView[];
  totalDebit: string;
  totalCredit: string;
  isBalanced: boolean;
}

export interface JeLineSource {
  accountCode: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  description: string | null;
}

export interface JeEntrySource {
  id: string;
  entryNumber: string;
  entryDate: Date;
  postedAt: Date | null;
  description: string;
  metadata: Prisma.JsonValue | null;
  lines: JeLineSource[];
}

const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Unique account codes across every line of the given entries — one CoA lookup. */
export function collectAccountCodes(
  entries: ReadonlyArray<Pick<JeEntrySource, 'lines'>>,
): string[] {
  return [...new Set(entries.flatMap((e) => e.lines.map((l) => l.accountCode)))];
}

export function toContractJeView(e: JeEntrySource, nameByCode: Map<string, string>): ContractJeView {
  const meta = (e.metadata ?? {}) as Record<string, unknown>;
  let totalDebit = new Prisma.Decimal(0);
  let totalCredit = new Prisma.Decimal(0);
  // JournalLine has no lineNo and its id is a random UUID, so DB order is
  // arbitrary — present Dr lines before Cr (stable sort keeps each group's
  // relative order), matching the Dr-then-Cr convention of every JE view.
  const orderedLines = [...e.lines].sort(
    (a, b) => (b.debit.gt(0) ? 1 : 0) - (a.debit.gt(0) ? 1 : 0),
  );
  const lines = orderedLines.map((l) => {
    totalDebit = totalDebit.plus(l.debit);
    totalCredit = totalCredit.plus(l.credit);
    return {
      accountCode: l.accountCode,
      accountName: nameByCode.get(l.accountCode) ?? l.accountCode,
      debit: l.debit.toFixed(2),
      credit: l.credit.toFixed(2),
      description: l.description ?? '',
    };
  });
  return {
    id: e.id,
    entryNumber: e.entryNumber,
    entryDate: e.entryDate,
    postedAt: e.postedAt,
    description: e.description,
    paymentId: asString(meta.paymentId),
    tag: asString(meta.tag),
    flow: asString(meta.flow),
    deltaApplied: asString(meta.deltaApplied),
    lateFeePortion: asString(meta.lateFeePortion),
    reversed: meta.reversed === true,
    reversedByEntryNumber: asString(meta.reversedByEntryNumber),
    originalEntryId: asString(meta.originalEntryId),
    lines,
    totalDebit: totalDebit.toFixed(2),
    totalCredit: totalCredit.toFixed(2),
    isBalanced: totalDebit.toFixed(2) === totalCredit.toFixed(2),
  };
}
```

- [ ] **Step 3: แทนบล็อก inline ใน `payment-query.service.ts`**

เพิ่ม import (บรรทัดถัดจาก `import { loadLateFeeConfig, ... }`):

```ts
import { collectAccountCodes, toContractJeView } from '../../journal/contract-je-view.util';
```

แทนบล็อกตั้งแต่บรรทัด comment `// JournalLine.accountCode is a plain string (no CoA relation) — resolve`
จนถึง `});` ที่ปิด `return allEntries.map((e) => { ... })` (บรรทัด 186-244) ด้วย:

```ts
    // JournalLine.accountCode is a plain string (no CoA relation) — resolve
    // display names in one lookup, fallback to the code itself.
    const codes = collectAccountCodes(allEntries);
    const coaRows = codes.length
      ? await this.prisma.chartOfAccount.findMany({
          where: { code: { in: codes } },
          select: { code: true, name: true },
        })
      : [];
    const nameByCode = new Map(coaRows.map((r) => [r.code, r.name]));

    // Shared mapper (journal/contract-je-view.util) — same shape as
    // GET /contracts/:id/journal-entries so the web JeBlock renders both.
    return allEntries.map((e) => toContractJeView(e, nameByCode));
```

- [ ] **Step 4: spec เดิมต้องเขียวเหมือนเดิม**

Run: `cd apps/api && npx jest src/modules/payments/services/payment-query.journal-entries.spec.ts`
Expected: PASS ทุกเคส จำนวนเท่าเดิม

- [ ] **Step 5: หยุดที่ working tree (ไม่ commit)**

---

### Task 2: `ContractJournalQueryService` + route `GET /contracts/:id/journal-entries`

**Files:**
- Create: `apps/api/src/modules/journal/contract-journal-query.service.ts`
- Create: `apps/api/src/modules/journal/contract-journal-query.service.spec.ts`
- Modify: `apps/api/src/modules/journal/journal.module.ts` (providers + exports)
- Modify: `apps/api/src/modules/contracts/contracts.controller.ts` (import, constructor, route หลัง `:id/shop-collect-settlement`)

**Interfaces:**
- Consumes: `toContractJeView`, `collectAccountCodes` (Task 1), `getBranchScope` จาก `../auth/branch-access.util`
- Produces: `ContractJournalQueryService.listForContract(contractId: string, user?: { role?: string|null; branchId?: string|null } | null): Promise<ContractJournalEntryView[]>` โดย `ContractJournalEntryView = ContractJeView & { companyCode: 'FINANCE' | 'SHOP' | null }`

- [ ] **Step 1: เขียน spec ที่ยังแดง**

```ts
// apps/api/src/modules/journal/contract-journal-query.service.spec.ts
import { Prisma } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { ContractJournalQueryService } from './contract-journal-query.service';

/**
 * Unit spec for ContractJournalQueryService.listForContract — the read-side
 * query behind "บันทึกบัญชีของสัญญา" (spec 2026-09-05 §4.1).
 *
 * Locks:
 *   - 404 on missing / soft-deleted contract, and on cross-branch access by a
 *     branch-scoped role (same 404-not-403 convention as repossessions.findOne)
 *   - Query 1 is contractId-scoped ONLY — no tag / flow / companyId filter
 *   - Query 2 fetches reversal JEs via BOTH metadata.originalEntryId (receipt
 *     void) and metadata.reversesEntryId (sweep engine), skipped when Query 1
 *     is empty, and de-duplicated by id against Query 1
 *   - companyCode comes from the JE's company relation, unknown → null
 *   - result ordered by postedAt asc, then entryNumber
 */
describe('ContractJournalQueryService.listForContract', () => {
  const dec = (v: string | number) => new Prisma.Decimal(v);
  const line = (accountCode: string, debit: string, credit: string) => ({
    accountCode,
    debit: dec(debit),
    credit: dec(credit),
    description: null,
  });
  const entry = (over: Record<string, unknown>) => ({
    id: 'je-1',
    entryNumber: 'JE-202609-0001',
    entryDate: new Date('2026-09-01T00:00:00Z'),
    postedAt: new Date('2026-09-01T01:00:00Z'),
    description: 'x',
    metadata: { contractId: 'c-1', tag: 'JP5', flow: 'repossession' },
    company: { companyCode: 'FINANCE' },
    lines: [line('11-1201', '100', '0'), line('11-2101', '0', '100')],
    ...over,
  });

  const build = (o: {
    contract?: unknown;
    primary?: unknown[];
    reversals?: unknown[];
    coa?: unknown[];
  }) => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce(o.primary ?? [])
      .mockResolvedValueOnce(o.reversals ?? []);
    const prisma = {
      contract: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            'contract' in o ? o.contract : { id: 'c-1', branchId: 'b-1', deletedAt: null },
          ),
      },
      journalEntry: { findMany },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue(o.coa ?? []) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { service: new ContractJournalQueryService(prisma as any), prisma, findMany };
  };

  const OWNER = { id: 'u', role: 'OWNER', branchId: null };
  const BM_SAME = { id: 'u', role: 'BRANCH_MANAGER', branchId: 'b-1' };
  const BM_OTHER = { id: 'u', role: 'BRANCH_MANAGER', branchId: 'b-2' };

  it('404 when the contract is missing or soft-deleted', async () => {
    await expect(build({ contract: null }).service.listForContract('c-x', OWNER)).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      build({ contract: { id: 'c-1', branchId: 'b-1', deletedAt: new Date() } }).service.listForContract(
        'c-1',
        OWNER,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('404 (not 403) for a branch-scoped role on another branch; same branch passes', async () => {
    await expect(build({}).service.listForContract('c-1', BM_OTHER)).rejects.toThrow(
      NotFoundException,
    );
    await expect(build({}).service.listForContract('c-1', BM_SAME)).resolves.toEqual([]);
  });

  it('Query 1 is scoped by metadata.contractId only — no tag/flow/companyId filter', async () => {
    const { service, findMany } = build({ primary: [entry({})] });
    await service.listForContract('c-1', OWNER);
    expect(findMany.mock.calls[0][0].where).toEqual({
      status: 'POSTED',
      deletedAt: null,
      metadata: { path: ['contractId'], equals: 'c-1' },
    });
  });

  it('skips the reversal pass when Query 1 is empty', async () => {
    const { service, findMany } = build({ primary: [] });
    await service.listForContract('c-1', OWNER);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('Query 2 targets both originalEntryId and reversesEntryId of every primary id', async () => {
    const { service, findMany } = build({
      primary: [entry({ id: 'je-1' }), entry({ id: 'je-2', entryNumber: 'JE-202609-0002' })],
    });
    await service.listForContract('c-1', OWNER);
    expect(findMany.mock.calls[1][0].where).toEqual({
      status: 'POSTED',
      deletedAt: null,
      OR: [
        { metadata: { path: ['originalEntryId'], equals: 'je-1' } },
        { metadata: { path: ['reversesEntryId'], equals: 'je-1' } },
        { metadata: { path: ['originalEntryId'], equals: 'je-2' } },
        { metadata: { path: ['reversesEntryId'], equals: 'je-2' } },
      ],
    });
  });

  it('de-duplicates a reversal that also carries contractId, maps companyCode, sorts by postedAt', async () => {
    const primary = [
      entry({ id: 'je-2', entryNumber: 'JE-202609-0002', postedAt: new Date('2026-09-03T00:00:00Z') }),
      entry({ id: 'je-1', entryNumber: 'JE-202609-0001', postedAt: new Date('2026-09-01T00:00:00Z') }),
      entry({
        id: 'je-3',
        entryNumber: 'JE-202609-0003',
        postedAt: new Date('2026-09-02T00:00:00Z'),
        company: { companyCode: 'SHOP' },
        metadata: { contractId: 'c-1', tag: 'REVERSAL', reversesEntryId: 'je-1' },
      }),
    ];
    // Query 2 returns je-3 again (it carries contractId, so Query 1 already had it)
    const reversals = [primary[2], entry({ id: 'je-4', entryNumber: 'JE-202609-0004', postedAt: new Date('2026-09-04T00:00:00Z'), company: null, metadata: { originalEntryId: 'je-2' } })];
    const { service } = build({ primary, reversals, coa: [{ code: '11-1201', name: 'ธนาคาร KBank' }] });
    const rows = await service.listForContract('c-1', OWNER);
    expect(rows.map((r) => r.id)).toEqual(['je-1', 'je-3', 'je-2', 'je-4']);
    expect(rows.map((r) => r.companyCode)).toEqual(['FINANCE', 'SHOP', 'FINANCE', null]);
    expect(rows[0].lines[0]).toEqual({
      accountCode: '11-1201',
      accountName: 'ธนาคาร KBank',
      debit: '100.00',
      credit: '0.00',
      description: '',
    });
    expect(rows[0].isBalanced).toBe(true);
  });
});
```

- [ ] **Step 2: รันให้แดง**

Run: `cd apps/api && npx jest src/modules/journal/contract-journal-query.service.spec.ts`
Expected: FAIL — `Cannot find module './contract-journal-query.service'`

- [ ] **Step 3: สร้าง service**

```ts
// apps/api/src/modules/journal/contract-journal-query.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getBranchScope } from '../auth/branch-access.util';
import {
  collectAccountCodes,
  toContractJeView,
  type ContractJeView,
} from './contract-je-view.util';

export type ContractJeBook = 'FINANCE' | 'SHOP' | null;

export interface ContractJournalEntryView extends ContractJeView {
  /** สมุดที่ JE ใบนี้อยู่ — FINANCE / SHOP (companyCode ของ JE) · null = ไม่รู้จัก */
  companyCode: ContractJeBook;
}

interface ScopedUser {
  role?: string | null;
  branchId?: string | null;
}

const LINE_SELECT = {
  where: { deletedAt: null },
  orderBy: { id: 'asc' as const },
  select: { accountCode: true, debit: true, credit: true, description: true },
};

const ENTRY_INCLUDE = {
  lines: LINE_SELECT,
  company: { select: { companyCode: true } },
};

function toBook(code: string | null | undefined): ContractJeBook {
  return code === 'FINANCE' || code === 'SHOP' ? code : null;
}

/**
 * "บันทึกบัญชีของสัญญา" — every POSTED JE that stamps `metadata.contractId`
 * (both books, every flow: 1A/2A/2B/JP4/JP5/refund/shop-collect/ECL/SHOP legs)
 * plus the reversal JEs that point back at them (receipt void stamps
 * `originalEntryId`; the sweep engine — contract cancellation, exchange cancel,
 * interco reverse — stamps `reversesEntryId`).
 *
 * Deliberately NOT included: INTER-CO settlement batch JEs (they stamp
 * `metadata.items[]`, never a top-level contractId — see accounting.md) and
 * JEs keyed only by `metadata.newContractId`.
 *
 * Read-only. Branch scope mirrors `repossessions.service.findOne`: a
 * branch-scoped role asking for another branch's contract gets the same 404
 * as "does not exist" so the response never confirms the contract's existence.
 */
@Injectable()
export class ContractJournalQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listForContract(
    contractId: string,
    user?: ScopedUser | null,
  ): Promise<ContractJournalEntryView[]> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { id: true, branchId: true, deletedAt: true },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    const scope = getBranchScope(user);
    if (user && !scope.all) {
      if (!scope.branchId || contract.branchId !== scope.branchId) {
        throw new NotFoundException('ไม่พบสัญญา');
      }
    }

    const primary = await this.prisma.journalEntry.findMany({
      where: {
        status: 'POSTED',
        deletedAt: null,
        metadata: { path: ['contractId'], equals: contractId },
      },
      include: ENTRY_INCLUDE,
      orderBy: { postedAt: 'asc' },
    });

    const reversals = primary.length
      ? await this.prisma.journalEntry.findMany({
          where: {
            status: 'POSTED',
            deletedAt: null,
            OR: primary.flatMap((e) => [
              { metadata: { path: ['originalEntryId'], equals: e.id } },
              { metadata: { path: ['reversesEntryId'], equals: e.id } },
            ]),
          },
          include: ENTRY_INCLUDE,
          orderBy: { postedAt: 'asc' },
        })
      : [];

    const seen = new Set<string>();
    const all = [...primary, ...reversals].filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
    all.sort(
      (a, b) =>
        (a.postedAt?.getTime() ?? 0) - (b.postedAt?.getTime() ?? 0) ||
        a.entryNumber.localeCompare(b.entryNumber),
    );

    const codes = collectAccountCodes(all);
    const coaRows = codes.length
      ? await this.prisma.chartOfAccount.findMany({
          where: { code: { in: codes } },
          select: { code: true, name: true },
        })
      : [];
    const nameByCode = new Map(coaRows.map((r) => [r.code, r.name]));

    return all.map((e) => ({
      ...toContractJeView(e, nameByCode),
      companyCode: toBook(e.company?.companyCode),
    }));
  }
}
```

- [ ] **Step 4: รันให้เขียว**

Run: `cd apps/api && npx jest src/modules/journal/contract-journal-query.service.spec.ts`
Expected: PASS 6 เคส

- [ ] **Step 5: ลงทะเบียนใน `journal.module.ts`**

เพิ่ม import ใต้ `import { AccountRoleService } from './account-role.service';`:

```ts
import { ContractJournalQueryService } from './contract-journal-query.service';
```

เพิ่ม `ContractJournalQueryService,` ต่อจาก `AccountRoleService,` ทั้งใน `providers: [` และ `exports: [`

- [ ] **Step 6: เพิ่ม route ใน `contracts.controller.ts`**

import (ใต้ `import { ContractSnapshotService } ...`):

```ts
import { ContractJournalQueryService } from '../journal/contract-journal-query.service';
```

constructor เพิ่มพารามิเตอร์สุดท้าย:

```ts
    private contractJournalQuery: ContractJournalQueryService,
```

route — วางถัดจาก method `shopCollectSettlement` (ก่อน comment `// === VALIDATION`):

```ts
  /**
   * บันทึกบัญชีของสัญญา — JE ทุกใบ (ทั้งสมุด FINANCE/SHOP, ทุก flow) ที่ stamp
   * metadata.contractId + ใบกลับรายการที่ชี้กลับมา. Roles + branch scope เหมือน
   * GET :id (ข้ามสาขา = 404 ใน service). Spec 2026-09-05 contract-journal-view.
   */
  @Get(':id/journal-entries')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'ดูบันทึกบัญชี (JE) ทุกใบของสัญญา ทั้งสมุด FINANCE และ SHOP' })
  listJournalEntries(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    return this.contractJournalQuery.listForContract(id, user);
  }
```

- [ ] **Step 7: type check API**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 8: หยุดที่ working tree (ไม่ commit)**

---

### Task 3: description ของ 3 template ใช้เลขสัญญา

**Files:**
- Create: `apps/api/src/modules/journal/contract-label.util.ts`
- Create: `apps/api/src/modules/journal/contract-label.util.spec.ts`
- Modify: `apps/api/src/modules/journal/cpa-templates/refund-payout.template.ts:218-222`
- Modify: `apps/api/src/modules/journal/cpa-templates/refund-waive.template.ts:152-156`
- Modify: `apps/api/src/modules/journal/cpa-templates/shop-collect-settlement.template.ts:280-286`

**Interfaces:**
- Produces: `resolveContractLabel(client: Prisma.TransactionClient | PrismaClient, contractId: string): Promise<string>`

- [ ] **Step 1: spec แดง**

```ts
// apps/api/src/modules/journal/contract-label.util.spec.ts
import { resolveContractLabel } from './contract-label.util';

describe('resolveContractLabel', () => {
  it('returns the contract number when the contract exists', async () => {
    const client = {
      contract: { findUnique: jest.fn().mockResolvedValue({ contractNumber: 'TEST-20260905-001' }) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(resolveContractLabel(client as any, 'c-uuid')).resolves.toBe('TEST-20260905-001');
    expect(client.contract.findUnique).toHaveBeenCalledWith({
      where: { id: 'c-uuid' },
      select: { contractNumber: true },
    });
  });

  it('falls back to the first 8 chars of the id when the contract is missing', async () => {
    const client = { contract: { findUnique: jest.fn().mockResolvedValue(null) } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(resolveContractLabel(client as any, '0123456789abcdef')).resolves.toBe('01234567');
  });
});
```

Run: `cd apps/api && npx jest src/modules/journal/contract-label.util.spec.ts`
Expected: FAIL — cannot find module

- [ ] **Step 2: util**

```ts
// apps/api/src/modules/journal/contract-label.util.ts
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * เลขสัญญาสำหรับ `description` ของ JE — JP5 เขียนเลขสัญญาอยู่แล้ว แต่ refund-payout /
 * refund-waive / shop-collect-settlement เคยเขียน `contractId.slice(0, 8)` (UUID)
 * ทำให้ค้นสมุดรายวันด้วยเลขสัญญาไม่เจอ (spec 2026-09-05 §4.4). Fallback เป็น UUID
 * 8 ตัวเดิมเมื่อไม่พบสัญญา (ไม่ควรเกิด — caller โหลดสัญญามาก่อนเสมอ).
 * ไม่แตะ `reference` / `metadata` — idempotency probe จับที่ metadata ไม่ใช่ข้อความ.
 */
export async function resolveContractLabel(
  client: Prisma.TransactionClient | PrismaClient,
  contractId: string,
): Promise<string> {
  const row = await client.contract.findUnique({
    where: { id: contractId },
    select: { contractNumber: true },
  });
  return row?.contractNumber ?? contractId.slice(0, 8);
}
```

Run: `cd apps/api && npx jest src/modules/journal/contract-label.util.spec.ts`
Expected: PASS 2 เคส

- [ ] **Step 3: refund-payout.template.ts**

import (ท้ายกลุ่ม import เดิม): `import { resolveContractLabel } from '../contract-label.util';`

แทนบรรทัด `    // ── Post Dr 21-1107 / Cr depositAccountCode ───...` ด้วย:

```ts
    const contractLabel = await resolveContractLabel(client, contractId);

    // ── Post Dr 21-1107 / Cr depositAccountCode ───────────────────────────────
```

และ description:

```ts
          description: `จ่ายเงินคืนส่วนต่างลูกค้า — สัญญา ${contractLabel} (ล้าง 21-1107)`,
```

- [ ] **Step 4: refund-waive.template.ts**

import: `import { resolveContractLabel } from '../contract-label.util';`

แทนบรรทัด `    // ── Post Dr 21-1107 / Cr 41-1102 ───...` ด้วย:

```ts
    const contractLabel = await resolveContractLabel(client, contractId);

    // ── Post Dr 21-1107 / Cr 41-1102 ───────────────────────────────────────────
```

description:

```ts
          description: `ล้างหนี้เงินคืนลูกค้า — ตัดสินใจไม่คืน สัญญา ${contractLabel} (ล้าง 21-1107)`,
```

- [ ] **Step 5: shop-collect-settlement.template.ts**

import: `import { resolveContractLabel } from '../contract-label.util';`

หลัง comment ที่จบด้วย `// intentionally-equal-amount remittances don't collide on that index.` และก่อน `    try {` แทรก:

```ts
    const contractLabel = await resolveContractLabel(client, contractId);
```

description ทั้งสองสาขา:

```ts
          description:
            typeStamp === 'PAYOUT_RECALL'
              ? `รับเงินคืนจากหน้าร้าน — สัญญา ${contractLabel} (ล้าง 11-2107 เรียกคืน)`
              : `รับโอนจากหน้าร้าน — สัญญา ${contractLabel} (ล้าง 11-2107)`,
```

- [ ] **Step 6: ตรวจว่าไม่เหลือ `slice(0, 8)` ใน 3 ไฟล์ + type check**

Run: `grep -n "slice(0, 8)" apps/api/src/modules/journal/cpa-templates/refund-payout.template.ts apps/api/src/modules/journal/cpa-templates/refund-waive.template.ts apps/api/src/modules/journal/cpa-templates/shop-collect-settlement.template.ts`
Expected: ไม่มี output

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 7: หยุดที่ working tree (ไม่ commit)**

---

### Task 4: แยก `JeBlock` + `journalFlowLabel` (web)

**Files:**
- Create: `apps/web/src/components/payment/JeBlock.tsx`
- Create: `apps/web/src/components/payment/__tests__/JeBlock.test.tsx`
- Modify: `apps/web/src/components/payment/PaymentHistorySheet.tsx` (ลบ `interface ContractJeLine`, `interface ContractJe`, `function JeBlock` + comment `/* ─── Helpers ─── */` เหนือมัน; เพิ่ม import)
- Test (มีอยู่ ห้ามแก้): `apps/web/src/components/payment/__tests__/PaymentHistorySheet.je-dialog.test.tsx`

**Interfaces:**
- Produces: `export function JeBlock({ je, receiptLabel?, openedReceiptNumber? })`, `export interface ContractJe`, `export interface ContractJeLine`, `export function journalFlowLabel(je: Pick<ContractJe,'flow'|'tag'>): { label: string; tone: 'default' | 'destructive' }`

- [ ] **Step 1: test แดง**

```tsx
// apps/web/src/components/payment/__tests__/JeBlock.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { JeBlock, journalFlowLabel, type ContractJe } from '../JeBlock';

const base: ContractJe = {
  id: 'je-1',
  entryNumber: 'JE-202609-0007',
  entryDate: '2026-09-05T00:00:00.000Z',
  postedAt: '2026-09-05T03:00:00.000Z',
  description: 'ยึดเครื่อง — สัญญา TEST-001 (8 งวดคงเหลือ)',
  paymentId: null,
  tag: 'JP5',
  flow: 'repossession',
  deltaApplied: null,
  lateFeePortion: null,
  reversed: false,
  reversedByEntryNumber: null,
  originalEntryId: null,
  lines: [
    { accountCode: '11-1201', accountName: 'ธนาคาร KBank', debit: '7000.00', credit: '0.00', description: 'ราคากลางเครื่อง' },
    { accountCode: '11-2101', accountName: 'ลูกหนี้ผ่อนชำระ', debit: '0.00', credit: '7000.00', description: '' },
  ],
  totalDebit: '7000.00',
  totalCredit: '7000.00',
  isBalanced: true,
};

describe('journalFlowLabel', () => {
  it.each([
    [{ flow: 'receipt-void', tag: 'REVERSAL' }, 'กลับรายการ (VOID)', 'destructive'],
    [{ flow: 'contract-cancellation', tag: 'REVERSAL' }, 'กลับรายการ', 'destructive'],
    [{ flow: 'early-payoff', tag: 'JP4' }, 'JP4 — ปิดยอดก่อนกำหนด', 'default'],
    [{ flow: 'repossession', tag: 'JP5' }, 'JP5 — ยึดเครื่อง', 'default'],
    [{ flow: 'refund-payout', tag: 'REFUND_PAYOUT' }, 'จ่ายเงินคืนส่วนต่างลูกค้า', 'default'],
    [{ flow: 'refund-waive', tag: 'REFUND_WAIVED' }, 'ไม่คืนเงินส่วนต่าง → รายได้ยึด', 'default'],
    [{ flow: 'shop-collect-settlement', tag: 'SCS' }, 'รับโอนจากหน้าร้าน (ล้าง 11-2107)', 'default'],
    [{ flow: null, tag: '1A' }, 'เปิดสัญญา (1A)', 'default'],
    [{ flow: 'accrual', tag: '2A' }, 'รับรู้รายได้งวด (2A)', 'default'],
    [{ flow: 'payment-receipt', tag: '2B' }, 'รับชำระ (2B)', 'default'],
    [{ flow: null, tag: 'receipt' }, 'รับชำระ (2B)', 'default'],
    [{ flow: 'provision', tag: 'BAD-DEBT' }, 'ค่าเผื่อหนี้ / ตัดหนี้สูญ', 'default'],
    [{ flow: 'stage-reverse', tag: 'ECL-STAGE-REVERSE' }, 'กลับค่าเผื่อหนี้', 'default'],
    [{ flow: 'reschedule-collect', tag: '6a' }, 'ปรับดิว (JP6)', 'default'],
    [{ flow: 'shop-inventory-transfer-cogs', tag: null }, 'SHOP — โอนกรรมสิทธิ์/รายได้', 'default'],
    [{ flow: 'exchange-close-old-21-1106', tag: null }, 'เปลี่ยนเครื่อง', 'default'],
    [{ flow: 'something-new', tag: 'NEW_TAG' }, 'NEW_TAG', 'default'],
    [{ flow: null, tag: null }, 'อื่น ๆ', 'default'],
  ])('%o → %s', (je, label, tone) => {
    expect(journalFlowLabel(je)).toEqual({ label, tone });
  });
});

describe('JeBlock', () => {
  it('renders entry number, flow label, lines and balance', () => {
    render(<JeBlock je={base} />);
    expect(screen.getByText('JE-202609-0007')).toBeInTheDocument();
    expect(screen.getByText('JP5 — ยึดเครื่อง')).toBeInTheDocument();
    expect(screen.getByText('ธนาคาร KBank')).toBeInTheDocument();
    expect(screen.getByText(/BALANCED/)).toBeInTheDocument();
  });

  it('marks a reversal JE with the destructive label', () => {
    render(<JeBlock je={{ ...base, flow: 'receipt-void', tag: 'REVERSAL' }} />);
    expect(screen.getByText('กลับรายการ (VOID)')).toBeInTheDocument();
  });
});
```

Run: `cd apps/web && npx vitest run src/components/payment/__tests__/JeBlock.test.tsx`
Expected: FAIL — cannot resolve `../JeBlock`

- [ ] **Step 2: สร้าง `JeBlock.tsx`**

```tsx
// apps/web/src/components/payment/JeBlock.tsx
import { formatDateShort, formatNumberDecimal } from '@/utils/formatters';
import type { JeReceiptLabel } from './paymentHistoryDerivations';

export interface ContractJeLine {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  description: string;
}

export interface ContractJe {
  id: string;
  entryNumber: string;
  entryDate: string;
  postedAt: string | null;
  description: string;
  paymentId: string | null;
  tag: string | null;
  flow: string | null;
  deltaApplied: string | null;
  lateFeePortion: string | null;
  /** Original JE that has since been mirrored out by a receipt void. */
  reversed: boolean;
  reversedByEntryNumber: string | null;
  /** Set on receipt-void REVERSAL JEs — points at the original entry id. */
  originalEntryId: string | null;
  lines: ContractJeLine[];
  totalDebit: string;
  totalCredit: string;
  isBalanced: boolean;
}

const money = (n: number | string) => formatNumberDecimal(n, 2);

export type JeLabelTone = 'default' | 'destructive';
export interface JeFlowLabel {
  label: string;
  tone: JeLabelTone;
}

type Rule = [test: (flow: string, tag: string) => boolean, label: string];

/**
 * ป้ายประเภท JE จาก metadata.flow (ดูก่อน) / metadata.tag — ครอบทุก flow ที่ template
 * ในระบบ stamp (spec 2026-09-05 §4.3). ลำดับกฎสำคัญ: `exchange-ecl-reversal` ต้องมาก่อน
 * `exchange-*`; กลับรายการเช็คก่อนทุกกฎ.
 */
const RULES: Rule[] = [
  [(f) => f === 'early-payoff', 'JP4 — ปิดยอดก่อนกำหนด'],
  [(f) => f === 'repossession', 'JP5 — ยึดเครื่อง'],
  [(f) => f === 'refund-payout', 'จ่ายเงินคืนส่วนต่างลูกค้า'],
  [(f) => f === 'refund-waive', 'ไม่คืนเงินส่วนต่าง → รายได้ยึด'],
  [(f) => f === 'shop-collect-settlement', 'รับโอนจากหน้าร้าน (ล้าง 11-2107)'],
  [(f, t) => t === '1A' || f === 'exchange-new-contract-1a', 'เปิดสัญญา (1A)'],
  [(f, t) => t === '2A' || f === 'accrual', 'รับรู้รายได้งวด (2A)'],
  [
    (f, t) => t === '2B' || t === 'receipt' || f === 'payment-receipt' || f.startsWith('2b-receipt'),
    'รับชำระ (2B)',
  ],
  [
    (_f, t) =>
      t === 'credit-allocation' || t === 'overpayment-credit' || t === 'paysolutions-surplus-advance',
    'เครดิต/จ่ายเกิน',
  ],
  [(f) => f === 'stage-reverse' || f === 'exchange-ecl-reversal', 'กลับค่าเผื่อหนี้'],
  [(f, t) => f === 'provision' || f === 'write-off' || t === 'BAD-DEBT', 'ค่าเผื่อหนี้ / ตัดหนี้สูญ'],
  [(f, t) => f.startsWith('reschedule') || t === '6a' || t === '6b', 'ปรับดิว (JP6)'],
  [(f, t) => f === 'mandatory' || t.startsWith('VAT60'), 'VAT 60 วัน'],
  [(f) => f.startsWith('shop-inventory-transfer'), 'SHOP — โอนกรรมสิทธิ์/รายได้'],
  [(f) => f.startsWith('shop-down-payment'), 'SHOP — เงินดาวน์'],
  [(f) => f === 'shop-exchange-return', 'SHOP — รับเครื่องคืน'],
  [(f) => f === 'shop-cash-sale', 'SHOP — ขายสด'],
  [(f) => f.startsWith('shop-external-finance'), 'SHOP — ไฟแนนซ์ภายนอก'],
  [(f) => f.startsWith('exchange-'), 'เปลี่ยนเครื่อง'],
];

const REVERSAL_FLOWS = new Set([
  'receipt-void',
  'reversal',
  'refund-reversal',
  'shop-cash-sale-void',
  'exchange-cancel',
  'contract-cancellation',
]);

export function journalFlowLabel(je: Pick<ContractJe, 'flow' | 'tag'>): JeFlowLabel {
  const flow = je.flow ?? '';
  const tag = je.tag ?? '';
  // ใบ void ใบเสร็จ = ป้ายเดิมของ PaymentHistorySheet ทุกไบต์; mirror จาก sweep engine
  // (ยกเลิกสัญญา/เปลี่ยนเครื่อง/รอบจ่าย) stamp tag REVERSAL เหมือนกันแต่ไม่ใช่ VOID
  if (flow === 'receipt-void') return { label: 'กลับรายการ (VOID)', tone: 'destructive' };
  if (tag === 'REVERSAL' || REVERSAL_FLOWS.has(flow) || flow.endsWith('-batch-reverse')) {
    return { label: 'กลับรายการ', tone: 'destructive' };
  }
  for (const [test, label] of RULES) {
    if (test(flow, tag)) return { label, tone: 'default' };
  }
  return { label: tag || flow || 'อื่น ๆ', tone: 'default' };
}

/** One posted JE rendered as a Dr/Cr grid — same layout as the JOURNAL AUTO
 * section in ContractEarlyPayoff (grid-cols-[80px_1fr_90px_90px]). */
export function JeBlock({
  je,
  receiptLabel,
  openedReceiptNumber,
}: {
  je: ContractJe;
  /** ใบเสร็จเจ้าของ JE ใบนี้ (undefined = จับคู่ไม่ได้/งวดใบเดียว — ไม่ติดป้าย) */
  receiptLabel?: JeReceiptLabel;
  openedReceiptNumber?: string;
}) {
  const { label: flowLabel, tone } = journalFlowLabel(je);
  const isVoidReversal = tone === 'destructive';
  // ป้ายเฉพาะงวดแบ่งชำระ (>1 ใบ) — บอกว่า JE นี้เป็นของใบเสร็จใบไหน กันอ่านสับสน
  // ว่าค่าปรับไปลงใบหลัง (คำสั่งเจ้าของ 2026-08-16 — ค่าปรับลง "ใบแรก" เสมอ FEE-FIRST)
  const showReceiptTag = !isVoidReversal && receiptLabel && receiptLabel.total > 1;
  const isOpenedReceipt = showReceiptTag && receiptLabel.receiptNumber === openedReceiptNumber;
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-xs leading-snug flex-wrap">
          <span className="font-mono font-semibold text-foreground">{je.entryNumber}</span>
          {showReceiptTag && (
            <span
              className={`px-1.5 py-0.5 rounded-full font-medium ${
                isOpenedReceipt ? 'bg-info/10 text-info' : 'bg-muted text-muted-foreground'
              }`}
            >
              <span className="font-mono">{receiptLabel.receiptNumber}</span> · ใบที่{' '}
              {receiptLabel.seq}/{receiptLabel.total}
              {isOpenedReceipt ? ' (ใบนี้)' : ''}
            </span>
          )}
          <span className="text-muted-foreground">
            {formatDateShort(je.postedAt ?? je.entryDate)}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded-full font-medium ${
              isVoidReversal ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'
            }`}
          >
            {flowLabel}
          </span>
          {je.reversed && (
            <span className="px-1.5 py-0.5 rounded-full bg-warning/10 text-warning font-medium">
              ถูกกลับรายการ{je.reversedByEntryNumber ? ` โดย ${je.reversedByEntryNumber}` : ''}
            </span>
          )}
          {je.deltaApplied && (
            <span className="text-muted-foreground">รับจริง {money(je.deltaApplied)} ฿</span>
          )}
          {je.lateFeePortion && Number(je.lateFeePortion) > 0 && (
            <span className="text-warning">ค่าปรับ {money(je.lateFeePortion)} ฿</span>
          )}
        </div>
        <span
          className={`text-xs font-medium leading-snug ${je.isBalanced ? 'text-success' : 'text-destructive'}`}
        >
          {money(je.totalDebit)} = {money(je.totalCredit)}{' '}
          {je.isBalanced ? 'BALANCED' : 'UNBALANCED'}
        </span>
      </div>
      <div className="space-y-1">
        <div className="grid grid-cols-[80px_1fr_90px_90px] gap-1 text-xs text-muted-foreground font-medium pb-1 border-b border-border">
          <span>รหัส</span>
          <span>บัญชี</span>
          <span className="text-right">Dr</span>
          <span className="text-right">Cr</span>
        </div>
        {je.lines.map((line, idx) => (
          <div key={idx} className="grid grid-cols-[80px_1fr_90px_90px] gap-1 text-xs leading-snug">
            <span className="font-mono text-muted-foreground">{line.accountCode}</span>
            <div className="min-w-0">
              <span className="text-foreground truncate block">{line.accountName}</span>
              {line.description && (
                <span className="text-muted-foreground/70 text-[10px]">{line.description}</span>
              )}
            </div>
            <span className="text-right font-mono text-foreground">
              {parseFloat(line.debit) > 0 ? formatNumberDecimal(line.debit) : ''}
            </span>
            <span className="text-right font-mono text-foreground">
              {parseFloat(line.credit) > 0 ? formatNumberDecimal(line.credit) : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `PaymentHistorySheet.tsx` ใช้ไฟล์ใหม่**

1. ลบ `interface ContractJeLine { ... }` และ `interface ContractJe { ... }` (บรรทัด ~70-97)
2. ลบตั้งแต่ comment `/* ─── Helpers ───...` + jsdoc + `function JeBlock({ ... }) { ... }` ทั้งก้อน (จบก่อน `function SummaryCard(`)
3. เพิ่ม import ใต้ `import ReceiptVoidDialog from './ReceiptVoidDialog';`:

```ts
import { JeBlock, type ContractJe } from './JeBlock';
```

`money` (บรรทัด 107) และ `formatDateShort`/`formatNumberDecimal` ยังถูกใช้ที่อื่นในไฟล์ — คงไว้

- [ ] **Step 4: เขียวทั้งใหม่และเก่า**

Run: `cd apps/web && npx vitest run src/components/payment`
Expected: PASS — `JeBlock.test.tsx` 20 เคส + `PaymentHistorySheet.je-dialog.test.tsx` และเพื่อนผ่านเท่าเดิม

- [ ] **Step 5: หยุดที่ working tree (ไม่ commit)**

---

### Task 5: `ContractJournalDialog`

**Files:**
- Create: `apps/web/src/components/contract/ContractJournalDialog.tsx`
- Create: `apps/web/src/components/contract/__tests__/ContractJournalDialog.test.tsx`

**Interfaces:**
- Consumes: `JeBlock`, `ContractJe` (Task 4); API `GET /contracts/:id/journal-entries` → `ContractJe & { companyCode: 'FINANCE'|'SHOP'|null }`[] (Task 2)
- Produces: `export default function ContractJournalDialog({ contractId: string | null; contractNumber?: string; onClose: () => void })`, `export function groupByBook(entries)`

- [ ] **Step 1: test แดง**

```tsx
// apps/web/src/components/contract/__tests__/ContractJournalDialog.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import ContractJournalDialog, { groupByBook } from '../ContractJournalDialog';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...args: unknown[]) => apiGet(...args) },
  getErrorMessage: (e: unknown) => String(e),
}));

const je = (over: Record<string, unknown>) => ({
  id: 'je-1',
  entryNumber: 'JE-202609-0001',
  entryDate: '2026-09-01T00:00:00.000Z',
  postedAt: '2026-09-01T01:00:00.000Z',
  description: 'x',
  paymentId: null,
  tag: 'JP5',
  flow: 'repossession',
  deltaApplied: null,
  lateFeePortion: null,
  reversed: false,
  reversedByEntryNumber: null,
  originalEntryId: null,
  lines: [
    { accountCode: '11-1201', accountName: 'KBank', debit: '7000.00', credit: '0.00', description: '' },
    { accountCode: '11-2101', accountName: 'ลูกหนี้', debit: '0.00', credit: '7000.00', description: '' },
  ],
  totalDebit: '7000.00',
  totalCredit: '7000.00',
  isBalanced: true,
  companyCode: 'FINANCE' as const,
  ...over,
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => apiGet.mockReset());

describe('groupByBook', () => {
  it('orders FINANCE → SHOP → unknown and drops empty books', () => {
    const groups = groupByBook([
      je({ id: 'a', companyCode: 'SHOP', totalDebit: '10.00' }),
      je({ id: 'b', companyCode: 'FINANCE', totalDebit: '5.50' }),
      je({ id: 'c', companyCode: 'FINANCE', totalDebit: '4.50' }),
    ]);
    expect(groups.map((g) => [g.label, g.items.length, g.totalDebit])).toEqual([
      ['สมุด FINANCE', 2, 10],
      ['สมุด SHOP (หน้าร้าน)', 1, 10],
    ]);
  });
});

describe('ContractJournalDialog', () => {
  it('fetches the contract journal and renders one section per book', async () => {
    apiGet.mockResolvedValue({
      data: [
        je({ id: 'f1', entryNumber: 'JE-202609-0001' }),
        je({ id: 's1', entryNumber: 'JE-202609-0002', companyCode: 'SHOP', flow: 'shop-inventory-transfer-cogs', tag: null }),
      ],
    });
    render(<ContractJournalDialog contractId="c-1" contractNumber="TEST-001" onClose={() => {}} />, { wrapper });

    expect(await screen.findByText('JE-202609-0001')).toBeInTheDocument();
    expect(screen.getByText('JE-202609-0002')).toBeInTheDocument();
    expect(screen.getByText('สมุด FINANCE')).toBeInTheDocument();
    expect(screen.getByText('สมุด SHOP (หน้าร้าน)')).toBeInTheDocument();
    expect(screen.getByText('JP5 — ยึดเครื่อง')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/contracts/c-1/journal-entries');
  });

  it('shows the empty state when the contract has no JE', async () => {
    apiGet.mockResolvedValue({ data: [] });
    render(<ContractJournalDialog contractId="c-1" onClose={() => {}} />, { wrapper });
    expect(await screen.findByText('ยังไม่มีบันทึกบัญชีของสัญญานี้')).toBeInTheDocument();
  });

  it('does not fetch when closed (contractId null)', () => {
    render(<ContractJournalDialog contractId={null} onClose={() => {}} />, { wrapper });
    expect(apiGet).not.toHaveBeenCalled();
  });
});
```

Run: `cd apps/web && npx vitest run src/components/contract/__tests__/ContractJournalDialog.test.tsx`
Expected: FAIL — cannot resolve `../ContractJournalDialog`

- [ ] **Step 2: component**

```tsx
// apps/web/src/components/contract/ContractJournalDialog.tsx
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import QueryBoundary from '@/components/QueryBoundary';
import api from '@/lib/api';
import { formatNumberDecimal } from '@/utils/formatters';
import { JeBlock, type ContractJe } from '@/components/payment/JeBlock';

export type ContractJeBook = 'FINANCE' | 'SHOP' | null;

/** แถวจาก GET /contracts/:id/journal-entries — ContractJe + สมุดที่ใบนั้นอยู่ */
export interface ContractJournalEntry extends ContractJe {
  companyCode: ContractJeBook;
}

export interface BookGroup {
  book: ContractJeBook;
  label: string;
  items: ContractJournalEntry[];
  /** Σ totalDebit ของกลุ่ม (แสดงผลอย่างเดียว — ไม่ใช่ตัวเลขบัญชี) */
  totalDebit: number;
}

const BOOK_ORDER: ContractJeBook[] = ['FINANCE', 'SHOP', null];
const BOOK_LABEL: Record<'FINANCE' | 'SHOP' | 'none', string> = {
  FINANCE: 'สมุด FINANCE',
  SHOP: 'สมุด SHOP (หน้าร้าน)',
  none: 'ไม่ระบุสมุด',
};

/** จัดกลุ่มตามสมุด FINANCE → SHOP → ไม่ระบุ, ตัดกลุ่มว่างทิ้ง (server เรียงตามวันมาแล้ว) */
export function groupByBook(entries: ContractJournalEntry[]): BookGroup[] {
  return BOOK_ORDER.map((book) => {
    const items = entries.filter((e) => (e.companyCode ?? null) === book);
    const totalDebit = items.reduce((sum, e) => sum + parseFloat(e.totalDebit), 0);
    return { book, label: BOOK_LABEL[book ?? 'none'], items, totalDebit };
  }).filter((g) => g.items.length > 0);
}

interface Props {
  /** null = ปิด dialog (ไม่ยิง query) */
  contractId: string | null;
  contractNumber?: string;
  onClose: () => void;
}

/**
 * "บันทึกบัญชีของสัญญา" — JE ทุกใบที่ผูกกับสัญญา ทั้งสมุด FINANCE และ SHOP
 * (spec 2026-09-05). ใช้จาก ContractDetailPage และ RepossessionsPage.
 */
export default function ContractJournalDialog({ contractId, contractNumber, onClose }: Props) {
  const {
    data = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<ContractJournalEntry[]>({
    queryKey: ['contract-journal', contractId],
    queryFn: async () => (await api.get(`/contracts/${contractId}/journal-entries`)).data,
    enabled: !!contractId,
  });
  const groups = useMemo(() => groupByBook(data), [data]);

  return (
    <Dialog open={!!contractId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[min(96vw,80rem)] max-h-[94vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b border-border mb-0 text-start">
          <DialogTitle className="leading-snug">
            บันทึกบัญชีของสัญญา{' '}
            {contractNumber && <span className="text-primary font-mono">— {contractNumber}</span>}
          </DialogTitle>
          <div className="text-xs text-muted-foreground leading-snug mt-0.5">
            JE ทุกใบที่ผูกกับสัญญานี้ ทั้งสมุด FINANCE และ SHOP · {data.length} ใบ
          </div>
        </DialogHeader>
        <DialogBody className="flex-1 overflow-auto px-5 py-4">
          <QueryBoundary
            isLoading={isLoading}
            isError={isError}
            error={error}
            onRetry={refetch}
            errorTitle="ไม่สามารถโหลดบันทึกบัญชีได้"
          >
            {groups.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8 leading-snug">
                ยังไม่มีบันทึกบัญชีของสัญญานี้
              </div>
            ) : (
              <div className="space-y-5">
                {groups.map((g) => (
                  <section key={g.label}>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-medium text-foreground leading-snug">{g.label}</h4>
                      <span className="text-xs text-muted-foreground leading-snug">
                        {g.items.length} ใบ · Dr รวม {formatNumberDecimal(g.totalDebit, 2)} ฿
                      </span>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {g.items.map((je) => (
                        <JeBlock key={je.id} je={je} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </QueryBoundary>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: เขียว**

Run: `cd apps/web && npx vitest run src/components/contract/__tests__/ContractJournalDialog.test.tsx`
Expected: PASS 4 เคส

- [ ] **Step 4: หยุดที่ working tree (ไม่ commit)**

---

### Task 6: ปุ่มบน `ContractDetailPage` และ `RepossessionsPage`

**Files:**
- Modify: `apps/web/src/pages/ContractDetailPage.tsx` (import, state, ปุ่มหลัง "ประวัติการชำระ", render dialog ใต้ `PaymentHistorySheet`)
- Modify: `apps/web/src/pages/RepossessionsPage.tsx` (import, state, ปุ่มในทั้งสองตาราง, render dialog)
- Create: `apps/web/src/pages/RepossessionsPage.journal-button.test.tsx`

**Interfaces:**
- Consumes: `ContractJournalDialog` (Task 5)

- [ ] **Step 1: test แดง (RepossessionsPage)**

```tsx
// apps/web/src/pages/RepossessionsPage.journal-button.test.tsx
/**
 * "บัญชี" button on RepossessionsPage (spec 2026-09-05 contract-journal-view):
 * both tables — รอยึดเครื่อง (TERMINATED contracts) and ยึดคืน & ขายต่อ — open
 * ContractJournalDialog for the row's contract without leaving the page.
 */
import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const apiGet = vi.fn();

vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(),
    patch: vi.fn(),
  },
  getErrorMessage: (e: unknown) => String(e),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-owner', name: 'เจ้าของ', role: 'OWNER', branchId: null },
    isLoading: false,
  }),
}));

vi.mock('@/pages/PaymentsPage/components/RepossessionOverlay', () => ({
  RepossessionOverlay: () => <div data-testid="repo-overlay" />,
}));

vi.mock('@/components/contract/ContractJournalDialog', () => ({
  default: (p: { contractId: string | null; contractNumber?: string }) =>
    p.contractId ? (
      <div data-testid="journal-dialog">
        journal:{p.contractId}:{p.contractNumber}
      </div>
    ) : null,
}));

import RepossessionsPage from './RepossessionsPage';

const terminatedContract = {
  id: 'c-term-1',
  contractNumber: 'TEST-20260905-001',
  status: 'TERMINATED',
  monthlyPayment: '5371.00',
  customer: { id: 'cu1', name: 'ลูกค้า รอยึด', phone: '0800000000' },
  product: { id: 'p1', name: 'iPhone 15', brand: 'Apple', model: '15' },
  branch: { id: 'b1', name: 'ลาดพร้าว' },
};

const repossession = {
  id: 'repo-1',
  repossessedDate: '2026-09-01T00:00:00.000Z',
  conditionGrade: 'B',
  appraisalPrice: '7000.00',
  repairCost: '0',
  resellPrice: null,
  status: 'REPOSSESSED',
  notes: null,
  customerRefundEnabled: false,
  customerRefund: null,
  contract: {
    id: 'c-repo-1',
    contractNumber: 'TEST-20260905-002',
    sellingPrice: '20000.00',
    financedAmount: '17000.00',
    customer: { id: 'cu2', name: 'ลูกค้า ยึดแล้ว', phone: '0800000001' },
    branch: { id: 'b1', name: 'ลาดพร้าว' },
  },
  product: { id: 'p2', name: 'Galaxy S24', brand: 'Samsung', model: 'S24', imeiSerial: null },
  appraisedBy: { id: 'u-owner', name: 'เจ้าของ' },
  creditNote: null,
};

function routeApi() {
  apiGet.mockImplementation((url: string) => {
    if (url.startsWith('/contracts?status=TERMINATED')) {
      return Promise.resolve({ data: { data: [terminatedContract], total: 1 } });
    }
    if (url.startsWith('/repossessions/profit-loss')) return Promise.resolve({ data: {} });
    if (url.startsWith('/repossessions')) {
      return Promise.resolve({ data: { data: [repossession], total: 1 } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('RepossessionsPage — ปุ่ม บัญชี', () => {
  it('opens the contract journal for a รอยึดเครื่อง row', async () => {
    routeApi();
    render(<RepossessionsPage />, { wrapper });
    await screen.findByText('TEST-20260905-001');

    const buttons = screen.getAllByRole('button', { name: 'บัญชี' });
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(buttons[0]);

    expect(screen.getByTestId('journal-dialog')).toHaveTextContent(
      'journal:c-term-1:TEST-20260905-001',
    );
  });

  it('opens the contract journal for a ยึดคืนแล้ว row', async () => {
    routeApi();
    render(<RepossessionsPage />, { wrapper });
    await screen.findByText('TEST-20260905-002');

    const buttons = screen.getAllByRole('button', { name: 'บัญชี' });
    fireEvent.click(buttons[buttons.length - 1]);

    expect(screen.getByTestId('journal-dialog')).toHaveTextContent(
      'journal:c-repo-1:TEST-20260905-002',
    );
  });
});
```

Run: `cd apps/web && npx vitest run src/pages/RepossessionsPage.journal-button.test.tsx`
Expected: FAIL — `Unable to find role="button" and name "บัญชี"`

- [ ] **Step 2: `RepossessionsPage.tsx`**

import (ใต้ `import { RepossessionOverlay } ...`):

```ts
import ContractJournalDialog from '@/components/contract/ContractJournalDialog';
```

state (ใต้ `const [repoTarget, setRepoTarget] = ...`):

```ts
  // "บัญชี" — บันทึกบัญชีของสัญญา (JE ทุกใบ ทั้งสมุด FINANCE/SHOP) ในหน้าเดิม
  const [journalTarget, setJournalTarget] = useState<{ id: string; contractNumber: string } | null>(
    null,
  );
```

ปุ่มในตาราง "รอยึดเครื่อง" — ใน `<td className="px-4 py-2 text-right">` ท้ายแถว วางก่อน `{canOpenRepo && (`:

```tsx
                        <button
                          type="button"
                          onClick={() => setJournalTarget({ id: c.id, contractNumber: c.contractNumber })}
                          className="mr-3 text-sm font-medium text-muted-foreground hover:text-foreground"
                        >
                          บัญชี
                        </button>
```

ปุ่มในคอลัมน์ `actions` ของตาราง "ยึดคืน & ขายต่อ" — เป็นปุ่มแรกใน `<div className="flex items-center gap-2">`:

```tsx
          <button
            type="button"
            onClick={() =>
              setJournalTarget({ id: r.contract.id, contractNumber: r.contract.contractNumber })
            }
            title="บันทึกบัญชี (JE) ทุกใบของสัญญานี้ — JP5, ใบลดหนี้, จ่ายคืน, รับโอนหน้าร้าน"
            className="text-muted-foreground hover:text-foreground text-sm font-medium"
          >
            บัญชี
          </button>
```

render — ต่อจากบล็อก `{repoTarget && (<RepossessionOverlay ... />)}`:

```tsx
      {/* บันทึกบัญชีของสัญญา — JE ทุกใบ (FINANCE + SHOP) */}
      <ContractJournalDialog
        contractId={journalTarget?.id ?? null}
        contractNumber={journalTarget?.contractNumber}
        onClose={() => setJournalTarget(null)}
      />
```

- [ ] **Step 3: เขียว + test เดิมของหน้ายังผ่าน**

Run: `cd apps/web && npx vitest run src/pages/RepossessionsPage`
Expected: PASS ทั้ง `journal-button` (2) และ `awaiting-repossession` (3)

- [ ] **Step 4: `ContractDetailPage.tsx`**

import:

```ts
import ContractJournalDialog from '@/components/contract/ContractJournalDialog';
```

เพิ่ม `BookOpen` ใน import จาก `lucide-react` (บรรทัด 21):

```ts
import { Copy, CheckCircle2, XCircle, AlertTriangle, Check, ChevronRight, History, BookOpen } from 'lucide-react';
```

state (ใต้ `const [historyContractId, setHistoryContractId] = useState<string | null>(null);`):

```ts
  const [journalOpen, setJournalOpen] = useState(false);
```

ปุ่ม — ต่อจากบล็อกปุ่ม "ประวัติการชำระ" (หลัง `)}` ของเงื่อนไข `['ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'EARLY_PAYOFF'].includes(...)`):

```tsx
            {/* บันทึกบัญชีของสัญญา — JE ทุกใบทั้งสมุด FINANCE/SHOP (spec 2026-09-05);
                DRAFT ยังไม่มี JE จึงซ่อน */}
            {contract.status !== 'DRAFT' && (
              <button
                onClick={() => setJournalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm border border-input bg-background text-foreground rounded-lg hover:bg-accent hover:text-accent-foreground shadow-sm"
              >
                <BookOpen className="size-4" />
                บันทึกบัญชี
              </button>
            )}
```

render — ต่อจาก `<PaymentHistorySheet ... />`:

```tsx
      {/* บันทึกบัญชีของสัญญา (JE ทุกใบ FINANCE + SHOP) */}
      <ContractJournalDialog
        contractId={journalOpen ? contract.id : null}
        contractNumber={contract.contractNumber}
        onClose={() => setJournalOpen(false)}
      />
```

- [ ] **Step 5: type check web + เทสต์หน้าที่แตะ**

Run: `./tools/check-types.sh web`
Expected: 0 errors

Run: `cd apps/web && npx vitest run src/pages/ContractDetailPage src/pages/RepossessionsPage src/components/payment src/components/contract`
Expected: PASS ทั้งหมด

- [ ] **Step 6: หยุดที่ working tree (ไม่ commit)**

---

### Task 7: Verification รวม

- [ ] **Step 1: API specs ที่เกี่ยว**

Run: `cd apps/api && npx jest src/modules/journal/contract-journal-query.service.spec.ts src/modules/journal/contract-label.util.spec.ts src/modules/payments/services/payment-query.journal-entries.spec.ts src/modules/payments/payments.controller.spec.ts src/modules/repossessions/repossessions.service.spec.ts`
Expected: PASS ทั้งหมด

- [ ] **Step 2: Web specs ที่เกี่ยว**

Run: `cd apps/web && npx vitest run src/components/payment src/components/contract src/pages/RepossessionsPage src/pages/ContractDetailPage`
Expected: PASS ทั้งหมด

- [ ] **Step 3: types ทั้งสองฝั่ง**

Run: `./tools/check-types.sh all`
Expected: 0 errors

- [ ] **Step 4: `git status` — รายงานไฟล์ที่เปลี่ยนให้เจ้าของ ไม่ commit**

Run: `git status --short`
Expected: ไฟล์ตามตาราง File Structure ทั้งหมด (M/??) และไม่มีไฟล์นอกรายการ
