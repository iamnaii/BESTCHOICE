# ใบรับเครื่องคืน (Device-Return Intake) Implementation Plan — Phase 3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ต่อหน้าจอทั้งหมดของใบรับเครื่องคืนเข้ากับ API ที่ Phase 1–2 ส่งมอบ (สาขาบันทึกใบ → FINANCE ยืนยันใน overlay → ค่าเครื่องหักในรอบจ่าย INTER-CO) พร้อม tag/เมนู/เอกสาร และบันทึกแจ้งผู้สอบบัญชี

**Architecture:** คอมโพเนนต์ใหม่ทั้งหมดอยู่ใน `apps/web/src/components/device-returns/` (types + FormSection + RejectDialog + IntakeDialog + List + ContractActions) แล้วต่อเข้าหน้าเดิม 4 หน้า (`RepossessionsPage`, `RepossessionOverlay` ที่กลายเป็นโหมดยืนยันอย่างเดียว, `ContractDetailPage`, `IntercompanySettlementPage` + interco/*) — ทุกตัวเลขเงินเป็น string จาก API (Prisma Decimal) แสดงผ่าน `formatNumberDecimal`/`fmtMoney`. ส่วนเอกสาร (`.claude/rules/*`, `.claude/CLAUDE.md`, CPA note) เขียนหลังโค้ดเสร็จโดยอ้างชื่อไฟล์/endpoint จริงของ Phase 1–2.

**Tech Stack:** React 18 + TypeScript + Vite 6 · @tanstack/react-query · shadcn/ui + Radix (Dialog/Checkbox/Tabs) · Tailwind design tokens เท่านั้น · lucide-react · sonner · vitest + @testing-library/react (jsdom, `apps/web/vitest.config.ts` include `src/**/*.{test,spec}.{ts,tsx}`)

## Global Constraints

- ห้าม `git commit` / `git push` / เปิด PR ในทุกขั้น — คำสั่งเจ้าของ 2026-09-05 (ยังไม่ได้อนุญาต); ทุก task จบด้วย Checkpoint (type-check + tests) แทน commit
- โค้ดยึดคืน/INTER-CO ต้องอ่านจาก `origin/main` (worktree `D:/BESTCHOICE APP/BESTCHOICE-device-return` สร้างจาก origin/main) — ห้าม implement บน branch `feat/stock-go-live-2026-09`
- ข้อความ error/UI เป็นภาษาไทย; เงินใช้ `Prisma.Decimal` (`@db.Decimal(12, 2)`) ห้าม Number(); soft delete เท่านั้น; ทุก controller `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles` ทุก method; route รูป `/:id` บังคับขอบเขตสาขาใน service (BranchGuard ไม่ครอบ)
- AuditLog: action เป็น String; เขียนหลัง `$transaction` commit ผ่าน `AuditService.log` (pattern `pendingAudit`) ยกเว้นที่ต้อง atomic ใช้ `tx.auditLog.create` (แถวนั้นหลุด Merkle chain — ระบุเหตุผลในคอมเมนต์)
- JE ทุกใบ idempotent ด้วย `metadata.flow + idempotencyKey` (DB partial unique index); JE ที่แตะ 11-2107/S21-1104 ต้อง stamp `metadata.shopReceivableType` + `metadata.contractId`
- Unit tests = jest `*.spec.ts` (mock PrismaService; run `npm --prefix apps/api test -- <path>`); DB-backed tests = vitest `*.integration.spec.ts` under `__tests__/` (pattern: `apps/api/src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts` — real PrismaClient, seeds CoA via `seedFinanceCoa`/`seedShopCoa`; run `cd apps/api && npx vitest run --no-file-parallelism <file>` with local Postgres per `.env`); new `__tests__/` directories MUST be added to the vitest globs in `.github/workflows/deploy-gcp.yml` (step "Run DB-backed money-invariant specs", lines ~259-290 on origin/main — globs do not recurse)
- Type check: `./tools/check-types.sh api` / `./tools/check-types.sh web` must be 0 errors at every checkpoint
- Prettier: semi, singleQuote, printWidth 100, tabWidth 2; camelCase/PascalCase; kebab-case files
- Migrations: additive only, descriptive names, timestamp later than `20261002100000_customer_journey`; partial unique index = raw SQL in migration (Prisma cannot express it)
- Frontend: React Query for data, `api` from `@/lib/api`, shadcn/ui + tokens only (no hardcoded colors), `toast` from sonner, Thai text with `leading-snug`
---

## ก่อนเริ่ม (อ่านให้ครบก่อนแตะ Task 1)

1. ทุกคำสั่งรันใน worktree `D:/BESTCHOICE APP/BESTCHOICE-device-return` (branch `feat/device-return-intake`, จาก origin/main) ซึ่ง Phase 1 + Phase 2 ทำเสร็จแล้ว — ตรวจก่อน:
   ```bash
   cd "D:/BESTCHOICE APP/BESTCHOICE-device-return" && git branch --show-current
   ls apps/api/src/modules/device-returns/device-returns.controller.ts apps/api/src/modules/interco-settlement/interco-typed-balance.ts
   grep -n "deviceReturnContractIds" apps/api/src/modules/interco-settlement/dto/create-batch.dto.ts
   grep -n "@Post()" apps/api/src/modules/repossessions/repossessions.controller.ts || echo "OK: POST /repossessions removed"
   ```
   Expected: branch = `feat/device-return-intake`, ทั้งสองไฟล์มี, grep พบ `deviceReturnContractIds`, และบรรทัดสุดท้ายพิมพ์ `OK: POST /repossessions removed`
2. Web tests รันด้วย `cd apps/web && npx vitest run <file>` (vitest 3, jsdom, `globals: true`, setup `src/test/setup.ts` มี jest-dom + cleanup แล้ว) — pattern การ mock อยู่ใน `apps/web/src/pages/RepossessionsPage.awaiting-repossession.test.tsx` (mock `@/lib/api` เป็น `vi.fn()`, mock `sonner`, mock `@/contexts/AuthContext`, ห่อด้วย `QueryClientProvider` + `MemoryRouter`)
3. ไฟล์อ้างอิงเวลาเขียนคอมโพเนนต์ใหม่: `apps/web/src/pages/PaymentsPage/components/RepossessionOverlay.tsx` (origin/main — Section/Row/Effect helpers, autoPrice effect, submitBlockReason chain), `apps/web/src/pages/interco/RecallCashDialog.tsx` (Radix Dialog + mutation + requestId), `apps/web/src/pages/interco/PendingTab.tsx` (ตาราง + checkbox + summary bar)
4. ตัวเลขบรรทัดในแผนนี้เป็นของ **origin/main** — worktree หลัง Phase 1–2 อาจเลื่อนไปไม่กี่บรรทัดในไฟล์ API แต่ไฟล์ web ที่แผนนี้แก้ Phase 1–2 ไม่ได้แตะ (ยกเว้น `apps/web/src/pages/interco/types.ts` ที่ Phase 1 **ไม่ได้แก้** — web ทั้งหมดเป็นของ Phase 3)

## Interface contract ที่ Phase 3 บริโภค (จาก brief + ที่ตกลงกับผู้เขียน Phase 2)

| Endpoint | Roles | Response / Body ที่ web ใช้ |
|---|---|---|
| `GET /device-returns/lookup?q=` | OWNER, BM, SALES | `DeviceReturnLookupRow[]` (array ตรง ๆ ≤ 20 แถว: `{ id, contractNumber, status, customer{id,name}, product{id,brand,model,imeiSerial}\|null, branch{id,name}\|null }`) |
| `GET /device-returns/preview?contractId&conditionGrade&appraisalPrice` | OWNER, BM, SALES | `DeviceReturnPreview` (brief line 148) |
| `POST /device-returns` | OWNER, BM, SALES | body `CreateDeviceReturnPayload` → คืน list-row (`DeviceReturnRow`) |
| `GET /device-returns?status&contractId&branchId&page&limit` | OWNER/FM/ACC ทั้งหมด; BM/SALES เฉพาะสาขาตัวเอง | `{ data: DeviceReturnRow[], total, page, limit }` |
| `GET /device-returns/awaiting-repossession?limit=100` | OWNER, BM, FM | `{ data: AwaitingRepossessionRow[], total }` (แถว = subset เดิมของ `GET /contracts` list row) |
| `GET /device-returns/:id` | ตามขอบเขตข้างบน | `DeviceReturnRow` |
| `POST /device-returns/:id/confirm` `{ paymentDate?, discountPct? }` | OWNER, FM | `DeviceReturnRow` (web อ่านแค่ docNumber/status) |
| `POST /device-returns/:id/reject` `{ reason }` (10–500) | OWNER, FM | `DeviceReturnRow` |
| `POST /device-returns/:id/cancel` | OWNER, BM (สาขาตัวเอง) | `DeviceReturnRow` |
| `POST /device-returns/:id/resend-line` | OWNER, FM, BM | `DeviceReturnRow` |
| `GET /repossessions/preview/:contractId?deviceReturnId=&discountPct=` | OWNER, BM, FM | shape เดิม `RepoPreview` (contract/calculation/eligibility/journalPreview) — โหมดยืนยัน **ไม่ส่ง** conditionGrade/appraisalPrice/collectedByShop/depositAccountCode |
| `GET /repossessions` rows | เดิม | + `deviceReturnOutstanding: string` |
| `GET /interco-settlement/pending` | เดิม | `{ pending, recalls, deviceReturns: DeviceReturnCandidate[], reconcile }` |
| `POST /interco-settlement/batches` | เดิม | + `deviceReturnContractIds?: string[]` |
| `POST /interco-settlement/device-returns/:contractId/settle-cash` | OWNER, FM | body เดิมของ recall settle-cash (`amount, financeDepositAccountCode, shopPayoutAccountCode?, requestId`) → `{ financeEntryNo, shopEntryNo, deduped }` |
| `GET /interco-settlement/batches/:id` items | เดิม | `itemType` เพิ่ม `'DEVICE_RETURN'`, item เพิ่ม `deviceReturnAmount: string` |

**สิ่งที่ถูกลบจาก API และ web ต้องเลิกเรียก:** `POST /repossessions` (ทั้ง endpoint + `CreateRepossessionDto`); query params `collectedByShop`/`depositAccountCode`/`customerRefundEnabled` ของ preview

---

### Task 1: Shared types + FormSection helpers (`components/device-returns/`)

**Files:**
- Create: `apps/web/src/components/device-returns/types.ts`
- Create: `apps/web/src/components/device-returns/FormSection.tsx`
- Test: `apps/web/src/components/device-returns/__tests__/types.test.ts`

**Interfaces:**
- Consumes: shape จากตาราง contract ด้านบน
- Produces: `DeviceReturnRow`, `DeviceReturnListResponse`, `DeviceReturnPreview`, `DeviceReturnLookupRow`, `AwaitingRepossessionRow`, `AwaitingRepossessionResponse`, `CreateDeviceReturnPayload`, `ConfirmDeviceReturnPayload`, label maps (`DEVICE_RETURN_STATUS_LABEL`, `DEVICE_RETURN_KIND_LABEL`, `RETURN_REASON_LABEL`, `RETURN_REASON_OPTIONS`, `LINE_STATUS_LABEL`), role constants (`DEVICE_RETURN_CREATE_ROLES`, `DEVICE_RETURN_CONFIRM_ROLES`, `DEVICE_RETURN_RESEND_ROLES`, `DEVICE_RETURN_INTAKE_ELIGIBLE_STATUSES`), helpers `bkkToday()`, `computeDeviationPct()`, `formatDeviationLabel()`, `canCancelDeviceReturn()`; JSX helpers `Section`, `Row`, `Effect` (ย้ายจาก RepossessionOverlay เพื่อให้ overlay + intake dialog ใช้ร่วมกัน)

- [ ] **Step 1: Write the failing test**

สร้าง `apps/web/src/components/device-returns/__tests__/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  canCancelDeviceReturn,
  computeDeviationPct,
  DEVICE_RETURN_KIND_LABEL,
  DEVICE_RETURN_STATUS_LABEL,
  formatDeviationLabel,
  LINE_STATUS_LABEL,
  RETURN_REASON_LABEL,
  RETURN_REASON_OPTIONS,
} from '../types';

describe('device-returns/types — label maps', () => {
  it('ครบทุกสถานะใบ / ประเภท / เหตุผล / สถานะไลน์ (ป้ายไทยตาม spec §7)', () => {
    expect(DEVICE_RETURN_STATUS_LABEL).toEqual({
      PENDING_CONFIRM: 'รอ FINANCE ยืนยัน',
      CONFIRMED: 'ยืนยันแล้ว',
      REJECTED: 'ส่งกลับ',
      CANCELED: 'ยกเลิก',
    });
    expect(DEVICE_RETURN_KIND_LABEL).toEqual({ VOLUNTARY: 'ลูกค้าคืนเอง', REPOSSESSION: 'ยึดเครื่อง' });
    expect(RETURN_REASON_OPTIONS.map((o) => o.value)).toEqual([
      'UNAFFORDABLE',
      'NO_LONGER_NEEDED',
      'AFTER_TERMINATION',
      'OTHER',
    ]);
    expect(RETURN_REASON_LABEL.AFTER_TERMINATION).toBe('รับเครื่องคืนหลังบอกเลิกสัญญา');
    expect(LINE_STATUS_LABEL).toEqual({
      SENT: 'ส่งไลน์แล้ว',
      FAILED: 'ส่งไลน์ไม่สำเร็จ',
      NO_LINE: 'ไม่มีไลน์ผูก',
    });
  });
});

describe('computeDeviationPct / formatDeviationLabel — ตรรกะ ±15% เดียวกับ overlay เดิม', () => {
  it('คิดเป็น % เทียบตาราง; null เมื่อไม่มีตาราง/ตาราง 0/ราคาประเมิน 0', () => {
    expect(computeDeviationPct(7000, 6500)).toBeCloseTo(7.69, 2);
    expect(computeDeviationPct(5000, 6500)).toBeCloseTo(-23.08, 2);
    expect(computeDeviationPct(7000, null)).toBeNull();
    expect(computeDeviationPct(7000, 0)).toBeNull();
    expect(computeDeviationPct(0, 6500)).toBeNull();
    expect(computeDeviationPct(Number.NaN, 6500)).toBeNull();
  });

  it('ป้าย: ปัดเป็นจำนวนเต็ม มีเครื่องหมาย + เมื่อบวก, ว่างเมื่อ null', () => {
    expect(formatDeviationLabel(7.69)).toBe('+8%');
    expect(formatDeviationLabel(-23.08)).toBe('-23%');
    expect(formatDeviationLabel(null)).toBe('');
  });
});

describe('canCancelDeviceReturn — OWNER ทุกใบ, BM เฉพาะสาขาที่รับ, อื่น ๆ ไม่ได้', () => {
  const row = { receivingBranch: { id: 'b1', name: 'ลาดพร้าว' } };
  it.each([
    [{ role: 'OWNER', branchId: null }, true],
    [{ role: 'BRANCH_MANAGER', branchId: 'b1' }, true],
    [{ role: 'BRANCH_MANAGER', branchId: 'b2' }, false],
    [{ role: 'BRANCH_MANAGER', branchId: null }, false],
    [{ role: 'FINANCE_MANAGER', branchId: null }, false],
    [{ role: 'SALES', branchId: 'b1' }, false],
  ])('%o → %s', (user, expected) => {
    expect(canCancelDeviceReturn(user, row)).toBe(expected);
  });
  it('user null → false', () => {
    expect(canCancelDeviceReturn(null, row)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/components/device-returns/__tests__/types.test.ts`
Expected: FAIL with `Failed to resolve import "../types"`

- [ ] **Step 3: Write minimal implementation**

สร้าง `apps/web/src/components/device-returns/types.ts`:

```ts
/**
 * ใบรับเครื่องคืน (device-return intake) — shared web types + label maps.
 *
 * Mirror ของ shape ฝั่ง API (`apps/api/src/modules/device-returns/`): Decimal → string,
 * Date → ISO string. ห้าม `Number()` แล้ว re-serialize — แสดงผ่าน `formatNumberDecimal`/`fmtMoney`.
 * Spec: docs/superpowers/specs/2026-09-20-device-return-intake-design.md §4, §5.0, §7
 */

export type DeviceReturnStatus = 'PENDING_CONFIRM' | 'CONFIRMED' | 'REJECTED' | 'CANCELED';
export type DeviceReturnKind = 'VOLUNTARY' | 'REPOSSESSION';
export type ReturnReason = 'UNAFFORDABLE' | 'NO_LONGER_NEEDED' | 'AFTER_TERMINATION' | 'OTHER';
export type ConditionGrade = 'A' | 'B' | 'C' | 'D';
export type LineNotifyStatus = 'SENT' | 'FAILED' | 'NO_LINE';

/** แถวจาก `GET /device-returns` / `GET /device-returns/:id` / ผลของ create-confirm-reject-cancel */
export interface DeviceReturnRow {
  id: string;
  docNumber: string;
  status: DeviceReturnStatus;
  returnKind: DeviceReturnKind;
  returnReason: ReturnReason;
  deviceReceivedAt: string;
  conditionGrade: ConditionGrade;
  appraisalPrice: string;
  /** snapshot ตารางรับซื้อ ณ วันสร้าง — null = ไม่มีรุ่นในตาราง (สาขาตีราคาเอง) */
  tableBasePrice: string | null;
  repairCost: string;
  notes: string | null;
  lineNotifyStatus: LineNotifyStatus | null;
  lineNotifiedAt: string | null;
  receivingBranch: { id: string; name: string };
  receivedBy: { id: string; name: string };
  contract: {
    id: string;
    contractNumber: string;
    status: string;
    customer: { id: string; name: string };
    product: { id: string; brand: string; model: string; imeiSerial: string | null };
  };
  confirmedAt: string | null;
  confirmedBy: { id: string; name: string } | null;
  repossessionId: string | null;
  rejectReason: string | null;
  createdAt: string;
}

export interface DeviceReturnListResponse {
  data: DeviceReturnRow[];
  total: number;
  page: number;
  limit: number;
}

/** `GET /device-returns/preview?contractId&conditionGrade&appraisalPrice` */
export interface DeviceReturnPreview {
  contract: {
    id: string;
    contractNumber: string;
    status: string;
    customer: { id: string; name: string };
    product: {
      id: string;
      brand: string;
      model: string;
      storage: string | null;
      imeiSerial: string | null;
    };
    branch: { id: string; name: string };
  };
  /** ระบบ derive จากสถานะสัญญา (TERMINATED → REPOSSESSION; เดิน → VOLUNTARY); null = สถานะไม่เข้าเกณฑ์ */
  returnKind: DeviceReturnKind | null;
  eligibility: { canCreate: boolean; reason: string | null };
  allowedReasons: ReturnReason[];
  valuation: { grade: string; found: boolean; suggestedPrice: number | null; note: string | null } | null;
  deviationPct: number | null;
  outstandingBalance: string;
}

/** `GET /device-returns/lookup?q=` — รายการสั้น ไม่มี PII เกินจำเป็น (ไม่มีเบอร์โทร) */
export interface DeviceReturnLookupRow {
  id: string;
  contractNumber: string;
  status: string;
  customer: { id: string; name: string };
  product: { id: string; brand: string; model: string; imeiSerial: string | null } | null;
  branch: { id: string; name: string } | null;
}

/** `GET /device-returns/awaiting-repossession` — TERMINATED ที่ยังไม่มีใบค้างยืนยันและไม่มีแถว Repossession */
export interface AwaitingRepossessionRow {
  id: string;
  contractNumber: string;
  status: string;
  monthlyPayment: string;
  customer: { id: string; name: string; phone: string };
  product: { id: string; name: string; brand: string; model: string } | null;
  branch: { id: string; name: string } | null;
}

export interface AwaitingRepossessionResponse {
  data: AwaitingRepossessionRow[];
  total: number;
}

/** body ของ `POST /device-returns` (CreateDeviceReturnDto) */
export interface CreateDeviceReturnPayload {
  contractId: string;
  deviceReceivedAt: string;
  conditionGrade: ConditionGrade;
  appraisalPrice: number;
  repairCost?: number;
  returnReason: ReturnReason;
  notes?: string;
  /** OWNER เท่านั้น — BM/SALES ใช้ `user.branchId` ฝั่ง server */
  receivingBranchId?: string;
}

/** body ของ `POST /device-returns/:id/confirm` */
export interface ConfirmDeviceReturnPayload {
  paymentDate?: string;
  discountPct?: number;
}

export const GRADES: ConditionGrade[] = ['A', 'B', 'C', 'D'];

export const RETURN_REASON_OPTIONS: { value: ReturnReason; label: string }[] = [
  { value: 'UNAFFORDABLE', label: 'ลูกค้าไม่สามารถผ่อนต่อได้' },
  { value: 'NO_LONGER_NEEDED', label: 'ลูกค้าไม่ประสงค์ใช้งานต่อ' },
  { value: 'AFTER_TERMINATION', label: 'รับเครื่องคืนหลังบอกเลิกสัญญา' },
  { value: 'OTHER', label: 'อื่น ๆ' },
];

export const RETURN_REASON_LABEL: Record<ReturnReason, string> = Object.fromEntries(
  RETURN_REASON_OPTIONS.map((o) => [o.value, o.label]),
) as Record<ReturnReason, string>;

export const DEVICE_RETURN_KIND_LABEL: Record<DeviceReturnKind, string> = {
  VOLUNTARY: 'ลูกค้าคืนเอง',
  REPOSSESSION: 'ยึดเครื่อง',
};

export const DEVICE_RETURN_STATUS_LABEL: Record<DeviceReturnStatus, string> = {
  PENDING_CONFIRM: 'รอ FINANCE ยืนยัน',
  CONFIRMED: 'ยืนยันแล้ว',
  REJECTED: 'ส่งกลับ',
  CANCELED: 'ยกเลิก',
};

export const LINE_STATUS_LABEL: Record<LineNotifyStatus, string> = {
  SENT: 'ส่งไลน์แล้ว',
  FAILED: 'ส่งไลน์ไม่สำเร็จ',
  NO_LINE: 'ไม่มีไลน์ผูก',
};

/** `POST /device-returns` (spec §5.0) — SALES สร้างได้แต่ไม่มี route มา /repossessions จึงสร้างจากหน้าสัญญา */
export const DEVICE_RETURN_CREATE_ROLES = ['OWNER', 'BRANCH_MANAGER', 'SALES'];
/** `POST /device-returns/:id/confirm` + `/reject` */
export const DEVICE_RETURN_CONFIRM_ROLES = ['OWNER', 'FINANCE_MANAGER'];
/** `POST /device-returns/:id/resend-line` */
export const DEVICE_RETURN_RESEND_ROLES = ['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER'];
/** สถานะสัญญาที่รับเครื่องคืนได้ (spec §5.1 ข้อ 2) — server เป็นผู้ตัดสินจริงผ่าน preview.eligibility */
export const DEVICE_RETURN_INTAKE_ELIGIBLE_STATUSES = ['ACTIVE', 'OVERDUE', 'DEFAULT', 'TERMINATED'];

/** ด่านตารางรับซื้อ ±15% — ชุดเดียวกับ `RepossessionsService.TABLE_DEVIATION_LIMIT` */
export const TABLE_DEVIATION_LIMIT_PCT = 15;
export const REJECT_REASON_MIN = 10;
export const REJECT_REASON_MAX = 500;

/** Today's date in Asia/Bangkok (YYYY-MM-DD) — avoids UTC off-by-one during BKK evening. */
export function bkkToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

/** % ต่างจากตารางรับซื้อ (ตรรกะเดียวกับ RepossessionOverlay เดิม) — null เมื่อคำนวณไม่ได้ */
export function computeDeviationPct(appraisal: number, tablePrice: number | null): number | null {
  if (tablePrice === null || !(tablePrice > 0)) return null;
  if (!Number.isFinite(appraisal) || !(appraisal > 0)) return null;
  return ((appraisal - tablePrice) / tablePrice) * 100;
}

export function formatDeviationLabel(pct: number | null): string {
  if (pct === null) return '';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`;
}

/**
 * `POST /device-returns/:id/cancel` — OWNER ทุกใบ; BRANCH_MANAGER เฉพาะใบที่
 * `receivingBranchId = user.branchId` (server บังคับซ้ำ, ไม่มี branchId = fail-closed)
 */
export function canCancelDeviceReturn(
  user: { role?: string; branchId?: string | null } | null | undefined,
  row: Pick<DeviceReturnRow, 'receivingBranch'>,
): boolean {
  if (!user) return false;
  if (user.role === 'OWNER') return true;
  if (user.role === 'BRANCH_MANAGER') return !!user.branchId && user.branchId === row.receivingBranch.id;
  return false;
}
```

สร้าง `apps/web/src/components/device-returns/FormSection.tsx` (ย้ายมาจาก helpers ท้ายไฟล์ `RepossessionOverlay.tsx` origin/main บรรทัด 938-1011 แบบ byte-identical ยกเว้น `export`):

```tsx
import { AlertTriangle, Check } from 'lucide-react';

/* ─── Shared form helpers (token-only styling, mirrors EarlyPayoffOverlay) ───────────
 * ใช้ร่วมกันโดย RepossessionOverlay (โหมดยืนยัน) และ DeviceReturnIntakeDialog */

export function Section({
  icon,
  title,
  subtitle,
  tone = 'primary',
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  tone?: 'primary' | 'success' | 'warning';
  children: React.ReactNode;
}) {
  const iconClass =
    tone === 'success'
      ? 'bg-success/10 text-success'
      : tone === 'warning'
        ? 'bg-warning/10 text-warning'
        : 'bg-primary/10 text-primary';
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className={`flex items-center justify-center size-8 rounded-lg ${iconClass}`}>
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground leading-snug">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground leading-snug">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export function Row({
  label,
  value,
  bold,
  destructive,
}: {
  label: string;
  value: string;
  bold?: boolean;
  destructive?: boolean;
}) {
  const valueClass = destructive
    ? 'text-destructive font-medium'
    : bold
      ? 'font-semibold text-foreground'
      : 'text-foreground';
  return (
    <div className="flex justify-between items-baseline text-sm">
      <span className="text-muted-foreground leading-snug">{label}</span>
      <span className={`leading-snug ${valueClass}`}>{value}</span>
    </div>
  );
}

export function Effect({ text, warning }: { text: string; warning?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span className={warning ? 'text-warning' : 'text-success'}>
        {warning ? (
          <AlertTriangle className="size-4 inline" />
        ) : (
          <Check className="size-4 inline" />
        )}
      </span>
      <span className={warning ? 'text-warning' : 'text-foreground'}>{text}</span>
    </li>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/components/device-returns/__tests__/types.test.ts`
Expected: PASS (3 describe / 11 tests)

- [ ] **Step 5: Checkpoint**

Run `./tools/check-types.sh web` — Expected: 0 errors. **Do NOT commit** (see Global Constraints).

---

### Task 2: `RejectDeviceReturnDialog` — dialog เหตุผลส่งกลับ (ใช้ร่วมกันโดย list + overlay)

**Files:**
- Create: `apps/web/src/components/device-returns/RejectDeviceReturnDialog.tsx`
- Test: `apps/web/src/components/device-returns/__tests__/RejectDeviceReturnDialog.test.tsx`

**Interfaces:**
- Consumes: `POST /device-returns/:id/reject` `{ reason }` (10–500), `REJECT_REASON_MIN/MAX`, `DeviceReturnRow` (Task 1)
- Produces: `RejectDeviceReturnDialog({ target: Pick<DeviceReturnRow,'id'|'docNumber'|'returnKind'|'contract'> | null; onClose: () => void; onRejected?: () => void })` — Task 4 (list) และ Task 5 (overlay) mount ตัวนี้

เปิดไฟล์ `apps/web/src/pages/interco/RecallCashDialog.tsx` เป็นแบบ (Radix `Dialog` + `useMutation` + toast).

- [ ] **Step 1: Write the failing test**

สร้าง `apps/web/src/components/device-returns/__tests__/RejectDeviceReturnDialog.test.tsx`:

```tsx
/**
 * dialog "ส่งกลับใบรับเครื่องคืน" (spec 2026-09-20 §5.3): เหตุผล 10–500 ตัวอักษร →
 * POST /device-returns/:id/reject — ใช้ร่วมกันโดยตาราง "รอ FINANCE ยืนยัน" และ overlay โหมดยืนยัน.
 */
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: (...a: unknown[]) => apiPost(...a) },
  getErrorMessage: (e: unknown) => String(e),
}));
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));

import { RejectDeviceReturnDialog } from '../RejectDeviceReturnDialog';

const target = {
  id: 'dr-1',
  docNumber: 'DR-20260920-0001',
  returnKind: 'VOLUNTARY' as const,
  contract: {
    id: 'c-1',
    contractNumber: 'TEST-20260920-001',
    status: 'TERMINATED',
    customer: { id: 'cu1', name: 'สมชาย ใจดี' },
    product: { id: 'p1', brand: 'Apple', model: 'iPhone 14', imeiSerial: null },
  },
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  apiPost.mockReset().mockResolvedValue({ data: { ...target, status: 'REJECTED' } });
  toastSuccess.mockReset();
});

describe('RejectDeviceReturnDialog', () => {
  it('ไม่ render อะไรเมื่อ target = null', () => {
    render(<RejectDeviceReturnDialog target={null} onClose={() => {}} />, { wrapper });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('เหตุผลสั้นกว่า 10 ตัวอักษร → ปุ่มปิด + ข้อความเตือน; ครบแล้ว POST reject → toast + onRejected + onClose', async () => {
    const onClose = vi.fn();
    const onRejected = vi.fn();
    render(<RejectDeviceReturnDialog target={target} onClose={onClose} onRejected={onRejected} />, {
      wrapper,
    });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('DR-20260920-0001');
    const submit = screen.getByRole('button', { name: 'ยืนยันส่งกลับ' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/เหตุผลที่ส่งกลับ/), { target: { value: 'สั้นไป' } });
    expect(screen.getByText(/ต้องอย่างน้อย 10 ตัวอักษร/)).toBeInTheDocument();
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/เหตุผลที่ส่งกลับ/), {
      target: { value: 'ราคาประเมินไม่สอดคล้องกับสภาพเครื่อง' },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/device-returns/dr-1/reject', {
        reason: 'ราคาประเมินไม่สอดคล้องกับสภาพเครื่อง',
      }),
    );
    await waitFor(() => expect(onRejected).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('สัญญากลับไปสถานะเดิม'));
  });

  it('ใบยึดเครื่อง (REPOSSESSION) → toast บอกว่าสัญญายังบอกเลิกอยู่ตามเดิม', async () => {
    render(
      <RejectDeviceReturnDialog
        target={{ ...target, returnKind: 'REPOSSESSION' }}
        onClose={() => {}}
      />,
      { wrapper },
    );
    fireEvent.change(await screen.findByLabelText(/เหตุผลที่ส่งกลับ/), {
      target: { value: 'ใบผิดสัญญา ต้องบันทึกใหม่' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันส่งกลับ' }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        expect.stringContaining('สัญญายังบอกเลิกอยู่ตามเดิม'),
      ),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/components/device-returns/__tests__/RejectDeviceReturnDialog.test.tsx`
Expected: FAIL with `Failed to resolve import "../RejectDeviceReturnDialog"`

- [ ] **Step 3: Write minimal implementation**

สร้าง `apps/web/src/components/device-returns/RejectDeviceReturnDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { REJECT_REASON_MAX, REJECT_REASON_MIN, type DeviceReturnRow } from './types';

/**
 * ส่งกลับใบรับเครื่องคืน (spec 2026-09-20 §5.3) — OWNER/FINANCE_MANAGER:
 * `POST /device-returns/:id/reject { reason }` (10–500). VOLUNTARY: สัญญากลับ
 * `previousContractStatus`; REPOSSESSION: สัญญายัง TERMINATED. ลูกค้าได้ไลน์
 * `DEVICE_RETURN_CANCELED`. ใช้ร่วมกันโดย DeviceReturnList และ RepossessionOverlay.
 */
interface Props {
  target: Pick<DeviceReturnRow, 'id' | 'docNumber' | 'returnKind' | 'contract'> | null;
  onClose: () => void;
  onRejected?: () => void;
}

export function RejectDeviceReturnDialog({ target, onClose, onRejected }: Props) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');

  // เปิดใบใหม่ = เริ่มเหตุผลว่างเสมอ
  useEffect(() => {
    if (target) setReason('');
  }, [target]);

  const trimmed = reason.trim();
  const tooShort = trimmed.length < REJECT_REASON_MIN;
  const tooLong = trimmed.length > REJECT_REASON_MAX;

  const mutation = useMutation({
    mutationFn: async () =>
      (await api.post(`/device-returns/${target!.id}/reject`, { reason: trimmed })).data,
    onSuccess: () => {
      toast.success(
        `ส่งกลับใบ ${target?.docNumber} แล้ว — ${
          target?.returnKind === 'VOLUNTARY' ? 'สัญญากลับไปสถานะเดิม' : 'สัญญายังบอกเลิกอยู่ตามเดิม'
        }`,
      );
      queryClient.invalidateQueries({ queryKey: ['device-returns'] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      if (target) queryClient.invalidateQueries({ queryKey: ['contract', target.contract.id] });
      queryClient.invalidateQueries({ queryKey: ['customer-tags'] });
      onRejected?.();
      onClose();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ส่งกลับใบรับเครื่องคืน</DialogTitle>
          <DialogDescription className="leading-snug">
            ใบ <span className="font-semibold">{target?.docNumber ?? ''}</span> สัญญา{' '}
            <span className="font-semibold">{target?.contract.contractNumber ?? ''}</span> — ระบุเหตุผล
            ให้สาขา ({REJECT_REASON_MIN}–{REJECT_REASON_MAX} ตัวอักษร)
            ลูกค้าจะได้รับไลน์แจ้งว่าใบถูกยกเลิกและสัญญาเดินต่อ
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="device-return-reject-reason">
            เหตุผลที่ส่งกลับ <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="device-return-reject-reason"
            rows={3}
            maxLength={REJECT_REASON_MAX}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น ราคาประเมินไม่สอดคล้องสภาพเครื่อง / ใบผิดสัญญา"
          />
          {reason.length > 0 && tooShort && (
            <p className="text-xs text-destructive leading-snug">
              ต้องอย่างน้อย {REJECT_REASON_MIN} ตัวอักษร
            </p>
          )}
          <p className="text-xs text-muted-foreground leading-snug">
            ถ้าใบข้ามเดือน งวดบัญชีเดือนก่อนอาจปิดแล้ว — accrual ย้อนหลังของงวดที่ค้างระหว่างรอ
            ต้องเปิดงวดก่อน (PERIOD_REOPENED)
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            ยกเลิก
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={!target || tooShort || tooLong || mutation.isPending}
          >
            {mutation.isPending ? 'กำลังส่งกลับ...' : 'ยืนยันส่งกลับ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/components/device-returns/__tests__/RejectDeviceReturnDialog.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Checkpoint**

Run `./tools/check-types.sh web` — Expected: 0 errors. **Do NOT commit** (see Global Constraints).

---

### Task 3: `DeviceReturnIntakeDialog` — ฟอร์มสาขา "บันทึกรับเครื่องคืน"

**Files:**
- Create: `apps/web/src/components/device-returns/DeviceReturnIntakeDialog.tsx`
- Test: `apps/web/src/components/device-returns/__tests__/DeviceReturnIntakeDialog.test.tsx`

**Interfaces:**
- Consumes: `GET /device-returns/lookup?q=`, `GET /device-returns/preview?contractId&conditionGrade&appraisalPrice`, `GET /branches` (array `{ id, name, isActive }` — เหมือน `BranchesPage.tsx:45-50`), `POST /device-returns`; Task 1 types/helpers + `Section`/`Effect`; `useDebounce` (`@/hooks/useDebounce`); `Modal` (`@/components/ui/Modal`, props `isOpen/onClose/title/size`)
- Produces: `DeviceReturnIntakeDialog({ open: boolean; onClose: () => void; initialContractId?: string; onCreated?: (row: DeviceReturnRow) => void })` — Task 6 (หน้า /repossessions) และ Task 8 (หน้าสัญญา) mount

ตรรกะ autoPrice/±15%/submitBlockReason ยกมาจาก `RepossessionOverlay.tsx` origin/main บรรทัด 140-147, 201-230, 288-303 — เปิดไฟล์นั้นเทียบขณะเขียน.

- [ ] **Step 1: Write the failing test**

สร้าง `apps/web/src/components/device-returns/__tests__/DeviceReturnIntakeDialog.test.tsx`:

```tsx
/**
 * ฟอร์ม "บันทึกรับเครื่องคืน" (spec 2026-09-20 §5.1, §7) — สาขาบันทึก ไม่มีส่วนบัญชี:
 *   - ค้นสัญญาผ่าน GET /device-returns/lookup?q= แล้ว preview ผ่าน GET /device-returns/preview
 *   - ตารางรับซื้อเติมราคาประเมินให้ (autoPrice) — ค่าที่พิมพ์เองไม่ถูกทับเมื่อสลับเกรด
 *   - ต่างจากตารางเกิน ±15% → ต้องมีหมายเหตุ ไม่งั้นปุ่มบันทึกปิด
 *   - ประเภทระบบเลือก: TERMINATED = ยึดเครื่อง (เหตุผลล็อก AFTER_TERMINATION) / เดิน = คืนเอง
 *   - OWNER ต้องเลือกสาขาที่รับ; BM/SALES ใช้สาขาตัวเอง (ไม่ส่ง receivingBranchId)
 */
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
  getErrorMessage: (e: unknown) => String(e),
}));
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));

type TestUser = { id: string; name: string; role: string; branchId: string | null };
const OWNER: TestUser = { id: 'u-owner', name: 'เจ้าของ', role: 'OWNER', branchId: null };
const BM: TestUser = { id: 'u-bm', name: 'ผจก.ลาดพร้าว', role: 'BRANCH_MANAGER', branchId: 'b1' };
const FM: TestUser = { id: 'u-fm', name: 'ผจก.การเงิน', role: 'FINANCE_MANAGER', branchId: null };
let currentUser: TestUser = OWNER;
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: currentUser, isLoading: false }),
}));
// ค้นทันที — ไม่รอ 300ms
vi.mock('@/hooks/useDebounce', () => ({ useDebounce: <T,>(v: T) => v }));

import { DeviceReturnIntakeDialog } from '../DeviceReturnIntakeDialog';

const lookupRows = [
  {
    id: 'c-1',
    contractNumber: 'TEST-20260920-001',
    status: 'ACTIVE',
    customer: { id: 'cu1', name: 'สมชาย ใจดี' },
    product: { id: 'p1', brand: 'Apple', model: 'iPhone 14', imeiSerial: '350000000000001' },
    branch: { id: 'b1', name: 'ลาดพร้าว' },
  },
];

let contractStatus = 'ACTIVE';
let eligibilityOverride: { canCreate: boolean; reason: string | null } | null = null;

/** Backend stand-in: เกรด A อยู่ในตาราง (6,500) เกรดอื่นไม่อยู่ */
function previewFor(url: string) {
  const q = new URLSearchParams(url.split('?')[1] ?? '');
  const grade = q.get('conditionGrade') ?? 'A';
  const found = grade === 'A';
  const terminated = contractStatus === 'TERMINATED';
  return {
    contract: {
      id: q.get('contractId'),
      contractNumber: 'TEST-20260920-001',
      status: contractStatus,
      customer: { id: 'cu1', name: 'สมชาย ใจดี' },
      product: {
        id: 'p1',
        brand: 'Apple',
        model: 'iPhone 14',
        storage: '128GB',
        imeiSerial: '350000000000001',
      },
      branch: { id: 'b1', name: 'ลาดพร้าว' },
    },
    returnKind: terminated ? 'REPOSSESSION' : 'VOLUNTARY',
    eligibility: eligibilityOverride ?? { canCreate: true, reason: null },
    allowedReasons: terminated
      ? ['AFTER_TERMINATION']
      : ['UNAFFORDABLE', 'NO_LONGER_NEEDED', 'OTHER'],
    valuation: { grade, found, suggestedPrice: found ? 6500 : null, note: null },
    deviationPct: null,
    outstandingBalance: '12126.64',
  };
}

function routeApi() {
  apiGet.mockImplementation((url: string) => {
    if (url.startsWith('/device-returns/lookup?')) return Promise.resolve({ data: lookupRows });
    if (url.startsWith('/device-returns/preview?')) {
      return Promise.resolve({ data: previewFor(url) });
    }
    if (url === '/branches') {
      return Promise.resolve({
        data: [
          { id: 'b1', name: 'ลาดพร้าว', isActive: true },
          { id: 'b2', name: 'สาขาปิดแล้ว', isActive: false },
        ],
      });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderDialog(props: { initialContractId?: string } = {}) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(<DeviceReturnIntakeDialog open onClose={onClose} onCreated={onCreated} {...props} />, {
    wrapper,
  });
  return { onClose, onCreated };
}

const appraisalInput = () => screen.getByLabelText(/ราคาประเมิน/) as HTMLInputElement;
const submitButton = () =>
  screen.getByRole('button', { name: 'บันทึกรับเครื่องคืน' }) as HTMLButtonElement;

async function pickContract() {
  fireEvent.change(screen.getByPlaceholderText(/เลขสัญญา \/ เบอร์โทร \/ IMEI/), {
    target: { value: 'TEST' },
  });
  fireEvent.click(await screen.findByRole('button', { name: /TEST-20260920-001/ }));
}

beforeEach(() => {
  contractStatus = 'ACTIVE';
  eligibilityOverride = null;
  currentUser = OWNER;
  apiGet.mockReset();
  apiPost.mockReset().mockResolvedValue({
    data: { id: 'dr-1', docNumber: 'DR-20260920-0001', contract: { id: 'c-1' } },
  });
  toastSuccess.mockReset();
});

describe('DeviceReturnIntakeDialog — ค้นสัญญา + preview', () => {
  it('ค้นแล้วเลือกสัญญา → เรียก preview ด้วย contractId และแสดงสรุปสัญญา + ประเภทที่ระบบเลือก', async () => {
    routeApi();
    renderDialog();
    await pickContract();
    await waitFor(() =>
      expect(
        apiGet.mock.calls.some(([u]) =>
          String(u).startsWith('/device-returns/preview?contractId=c-1&conditionGrade=A'),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText('สมชาย ใจดี')).toBeInTheDocument();
    expect(screen.getByTestId('device-return-kind')).toHaveTextContent('ลูกค้าคืนเอง');
    expect(screen.getByText(/12,126\.64 ฿/)).toBeInTheDocument();
  });

  it('initialContractId: ไม่มีช่องค้นหา ไม่มีปุ่มเปลี่ยนสัญญา และ preview ทันที', async () => {
    routeApi();
    renderDialog({ initialContractId: 'c-1' });
    expect(screen.queryByPlaceholderText(/เลขสัญญา/)).not.toBeInTheDocument();
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    expect(screen.queryByRole('button', { name: 'เปลี่ยนสัญญา' })).not.toBeInTheDocument();
  });
});

describe('DeviceReturnIntakeDialog — ราคาประเมิน + ตารางรับซื้อ (autoPrice ±15%)', () => {
  it('เติมราคาจากตารางเกรด A; สลับไปเกรดที่ไม่มีในตารางล้างค่าที่ระบบเติม; ค่าที่พิมพ์เองไม่ถูกทับ', async () => {
    currentUser = BM;
    routeApi();
    renderDialog({ initialContractId: 'c-1' });
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    expect(screen.getByText(/ตารางรับซื้อ เกรด A: 6,500\.00 ฿ \(ค่าตั้งต้น/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^B$/ }));
    await waitFor(() =>
      expect(
        screen.getByText(/ไม่มีรุ่นนี้ในตารางรับซื้อ \(เกรด B\) ตีราคาเอง/),
      ).toBeInTheDocument(),
    );
    await waitFor(() => expect(appraisalInput().value).toBe(''));

    fireEvent.change(appraisalInput(), { target: { value: '7000' } });
    fireEvent.click(screen.getByRole('button', { name: /^A$/ }));
    await waitFor(() => expect(screen.getByText(/ตารางรับซื้อ เกรด A/)).toBeInTheDocument());
    expect(appraisalInput().value).toBe('7000');
    expect(screen.getByText(/ต่างจากตาราง \+8%/)).toBeInTheDocument();
  });

  it('ต่างจากตารางเกิน 15% → ปุ่มปิดจนกว่าจะมีหมายเหตุ', async () => {
    currentUser = BM;
    routeApi();
    renderDialog({ initialContractId: 'c-1' });
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    fireEvent.change(screen.getByLabelText(/เหตุผลคืนเครื่อง/), {
      target: { value: 'UNAFFORDABLE' },
    });
    await waitFor(() => expect(submitButton()).toBeEnabled());

    fireEvent.change(appraisalInput(), { target: { value: '5000' } }); // −23%
    await waitFor(() =>
      expect(screen.getByText(/ต่างจากตารางรับซื้อ -23% \(เกิน 15%\)/)).toBeInTheDocument(),
    );
    expect(submitButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/รายละเอียดเพิ่มเติม/), {
      target: { value: 'จอแตก กระจกหลังร้าว' },
    });
    await waitFor(() => expect(submitButton()).toBeEnabled());
  });
});

describe('DeviceReturnIntakeDialog — ประเภท / เหตุผล / สิ่งที่จะเกิดขึ้น', () => {
  it('สัญญา TERMINATED = ยึดเครื่อง: เหตุผลล็อก AFTER_TERMINATION และไม่มีข้อความสัญญาหยุด', async () => {
    contractStatus = 'TERMINATED';
    currentUser = BM;
    routeApi();
    renderDialog({ initialContractId: 'c-1' });
    await waitFor(() =>
      expect(screen.getByTestId('device-return-kind')).toHaveTextContent('ยึดเครื่อง'),
    );
    const reason = screen.getByLabelText(/เหตุผลคืนเครื่อง/) as HTMLSelectElement;
    await waitFor(() => expect(reason.value).toBe('AFTER_TERMINATION'));
    expect(reason).toBeDisabled();
    expect(screen.getByText(/สัญญาบอกเลิกอยู่แล้ว/)).toBeInTheDocument();
    expect(screen.queryByText(/สัญญาหยุดนับค่างวด/)).not.toBeInTheDocument();
  });

  it('สัญญา ACTIVE = คืนเอง: กล่องผลลัพธ์ = สัญญาหยุดทันที / แจ้งไลน์ / รอ FINANCE / MDM ทำมือ และไม่มีส่วนบัญชี', async () => {
    routeApi();
    renderDialog({ initialContractId: 'c-1' });
    await waitFor(() =>
      expect(screen.getByTestId('device-return-kind')).toHaveTextContent('ลูกค้าคืนเอง'),
    );
    expect(screen.getByText(/สัญญาหยุดนับค่างวดและค่าปรับทันที/)).toBeInTheDocument();
    expect(screen.getByText(/แจ้งลูกค้าทางไลน์ทันที/)).toBeInTheDocument();
    expect(screen.getByText(/รอ FINANCE ยืนยันบัญชี/)).toBeInTheDocument();
    expect(screen.getByText(/ปลดล็อค MDM/)).toBeInTheDocument();
    expect(screen.queryByText(/บัญชีรับเงิน/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ตั้งลูกหนี้-หน้าร้าน/)).not.toBeInTheDocument();
  });

  it('eligibility ไม่ผ่าน → แบนเนอร์ + ปุ่มปิด + ไม่ POST', async () => {
    eligibilityOverride = { canCreate: false, reason: 'เครื่องนี้เคยถูกยึดแล้ว — ยึดซ้ำไม่ได้' };
    currentUser = BM;
    routeApi();
    renderDialog({ initialContractId: 'c-1' });
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/เคยถูกยึดแล้ว/);
    fireEvent.change(screen.getByLabelText(/เหตุผลคืนเครื่อง/), {
      target: { value: 'UNAFFORDABLE' },
    });
    expect(submitButton()).toBeDisabled();
    fireEvent.click(submitButton());
    expect(apiPost).not.toHaveBeenCalled();
  });
});

describe('DeviceReturnIntakeDialog — บันทึก', () => {
  it('BM: ส่ง body ตาม DTO (ไม่มี receivingBranchId) → toast + onCreated + onClose', async () => {
    currentUser = BM;
    routeApi();
    const { onClose, onCreated } = renderDialog({ initialContractId: 'c-1' });
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    fireEvent.change(screen.getByLabelText(/เหตุผลคืนเครื่อง/), {
      target: { value: 'NO_LONGER_NEEDED' },
    });
    fireEvent.change(screen.getByLabelText(/ค่าซ่อม/), { target: { value: '300' } });
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/device-returns', {
        contractId: 'c-1',
        deviceReceivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        conditionGrade: 'A',
        appraisalPrice: 6500,
        repairCost: 300,
        returnReason: 'NO_LONGER_NEEDED',
        notes: undefined,
        receivingBranchId: undefined,
      }),
    );
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ docNumber: 'DR-20260920-0001' }),
      ),
    );
    expect(onClose).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('DR-20260920-0001'));
  });

  it('OWNER: ต้องเลือกสาขาที่รับก่อน (สาขาที่ปิดใช้ไม่โผล่) แล้ว body มี receivingBranchId', async () => {
    routeApi();
    renderDialog({ initialContractId: 'c-1' });
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    fireEvent.change(screen.getByLabelText(/เหตุผลคืนเครื่อง/), {
      target: { value: 'UNAFFORDABLE' },
    });
    await waitFor(() =>
      expect(submitButton()).toHaveAttribute('title', 'กรุณาเลือกสาขาที่รับเครื่อง'),
    );
    const branch = await screen.findByLabelText(/สาขาที่รับเครื่อง/);
    expect(within(branch).queryByRole('option', { name: 'สาขาปิดแล้ว' })).not.toBeInTheDocument();
    fireEvent.change(branch, { target: { value: 'b1' } });
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/device-returns',
        expect.objectContaining({ receivingBranchId: 'b1' }),
      ),
    );
  });

  it('FINANCE_MANAGER: แจ้งว่าบันทึกไม่ได้และปุ่มปิด', async () => {
    currentUser = FM;
    routeApi();
    renderDialog({ initialContractId: 'c-1' });
    expect(await screen.findByText(/บันทึกรับเครื่องคืนได้เฉพาะเจ้าของ/)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/components/device-returns/__tests__/DeviceReturnIntakeDialog.test.tsx`
Expected: FAIL with `Failed to resolve import "../DeviceReturnIntakeDialog"`

- [ ] **Step 3: Write minimal implementation**

สร้าง `apps/web/src/components/device-returns/DeviceReturnIntakeDialog.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, FileText, Gauge, Lock, PackageX, Search, Store } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import { formatNumberDecimal } from '@/utils/formatters';
import { Effect, Section } from './FormSection';
import {
  bkkToday,
  computeDeviationPct,
  formatDeviationLabel,
  DEVICE_RETURN_CREATE_ROLES,
  DEVICE_RETURN_KIND_LABEL,
  GRADES,
  RETURN_REASON_OPTIONS,
  TABLE_DEVIATION_LIMIT_PCT,
  type ConditionGrade,
  type CreateDeviceReturnPayload,
  type DeviceReturnLookupRow,
  type DeviceReturnPreview,
  type DeviceReturnRow,
  type ReturnReason,
} from './types';

interface BranchOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** เปิดจากหน้าสัญญา / รายการรอยึดเครื่อง — ล็อกสัญญาไว้ ไม่มีช่องค้นหา */
  initialContractId?: string;
  onCreated?: (row: DeviceReturnRow) => void;
}

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 outline-hidden';

/**
 * ฟอร์มสาขา "บันทึกรับเครื่องคืน" (spec 2026-09-20 §5.1, §7) — ไม่มีส่วนบัญชี:
 * สาขาบันทึกสภาพ/ราคาประเมิน แล้ว FINANCE ยืนยันใน RepossessionOverlay โหมดยืนยัน.
 * ตรรกะ autoPrice/±15% ยกมาจาก RepossessionOverlay เดิม (ราคาเดียว 2026-09-05) —
 * ค่าที่ระบบเติมจากตารางถูกสลับตามเกรด ค่าที่พิมพ์เองไม่ถูกทับ.
 */
export function DeviceReturnIntakeDialog({ open, onClose, initialContractId, onCreated }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const role = user?.role ?? '';
  const canCreate = DEVICE_RETURN_CREATE_ROLES.includes(role);
  const isOwner = role === 'OWNER';
  const lockedContract = !!initialContractId;

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search.trim(), 300);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(
    initialContractId ?? null,
  );
  const [conditionGrade, setConditionGrade] = useState<ConditionGrade>('A');
  const [appraisalPrice, setAppraisalPrice] = useState('');
  const [autoPrice, setAutoPrice] = useState<string | null>(null);
  const [repairCost, setRepairCost] = useState('0');
  const [returnReason, setReturnReason] = useState<ReturnReason | ''>('');
  const [notes, setNotes] = useState('');
  const [deviceReceivedAt, setDeviceReceivedAt] = useState(bkkToday);
  const [receivingBranchId, setReceivingBranchId] = useState('');

  // Reset ทุกครั้งที่เปิด — dialog นี้ mount ค้างบนหน้า (open prop) เหมือน CreateBatchDialog
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelectedContractId(initialContractId ?? null);
    setConditionGrade('A');
    setAppraisalPrice('');
    setAutoPrice(null);
    setRepairCost('0');
    setReturnReason('');
    setNotes('');
    setDeviceReceivedAt(bkkToday());
    setReceivingBranchId('');
  }, [open, initialContractId]);

  const lookupEnabled = open && !selectedContractId && debouncedSearch.length >= 2;
  const lookup = useQuery<DeviceReturnLookupRow[]>({
    queryKey: ['device-returns', 'lookup', debouncedSearch],
    queryFn: async () =>
      (await api.get(`/device-returns/lookup?q=${encodeURIComponent(debouncedSearch)}`)).data,
    enabled: lookupEnabled,
    staleTime: 10_000,
  });

  const {
    data: preview,
    isLoading: previewLoading,
    isFetching: previewFetching,
    isError: previewFailed,
    error: previewError,
    refetch: retryPreview,
  } = useQuery<DeviceReturnPreview>({
    queryKey: ['device-returns', 'preview', selectedContractId, conditionGrade, appraisalPrice],
    queryFn: async () => {
      const params = new URLSearchParams({ contractId: selectedContractId!, conditionGrade });
      if (appraisalPrice) params.set('appraisalPrice', appraisalPrice);
      return (await api.get(`/device-returns/preview?${params.toString()}`)).data;
    },
    enabled: open && !!selectedContractId,
    // สถานะสัญญา/ยอดค้าง/ใบค้างเปลี่ยนได้ระหว่างที่ dialog ปิด
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const branches = useQuery<BranchOption[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: open && isOwner,
    staleTime: 60_000,
  });

  // ราคาตารางรับซื้อ (เกรดที่เลือก) → เติมราคาประเมินเป็นค่าตั้งต้นเฉพาะเมื่อช่องว่างหรือยังเป็น
  // ค่าที่ระบบเติมไว้ก่อนหน้า; เปลี่ยนเกรดแล้วไม่พบ → ล้างค่าที่ระบบเติม (ค่าที่พิมพ์เองคงไว้)
  const valuation = preview?.valuation;
  useEffect(() => {
    if (!valuation || valuation.grade !== conditionGrade) return;
    if (valuation.found && valuation.suggestedPrice != null) {
      const s = String(valuation.suggestedPrice);
      if (s === autoPrice) return;
      setAppraisalPrice((cur) => (cur === '' || cur === autoPrice ? s : cur));
      setAutoPrice(s);
    } else if (autoPrice !== null) {
      setAppraisalPrice((cur) => (cur === autoPrice ? '' : cur));
      setAutoPrice(null);
    }
  }, [valuation, conditionGrade, autoPrice]);

  // REPOSSESSION (สัญญา TERMINATED) มีเหตุผลเดียว → ระบบตั้งให้; VOLUNTARY เลือกเองจาก 3 ค่า
  const allowedReasons = useMemo(() => preview?.allowedReasons ?? [], [preview]);
  useEffect(() => {
    if (allowedReasons.length === 1) {
      setReturnReason(allowedReasons[0]);
    } else if (returnReason && !allowedReasons.includes(returnReason)) {
      setReturnReason('');
    }
  }, [allowedReasons, returnReason]);

  const tablePrice =
    valuation?.found && valuation.grade === conditionGrade ? valuation.suggestedPrice : null;
  const appraisalNum = Number(appraisalPrice);
  const deviationPct = computeDeviationPct(appraisalNum, tablePrice);
  const needsReason = deviationPct !== null && Math.abs(deviationPct) > TABLE_DEVIATION_LIMIT_PCT;
  const reasonMissing = needsReason && notes.trim().length === 0;
  const deviationLabel = formatDeviationLabel(deviationPct);
  const blockedByEligibility = preview?.eligibility.canCreate === false;
  const returnKind = preview?.returnKind ?? null;
  const reasonOptions = RETURN_REASON_OPTIONS.filter((o) => allowedReasons.includes(o.value));
  const reasonLocked = allowedReasons.length === 1;

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: CreateDeviceReturnPayload = {
        contractId: selectedContractId!,
        deviceReceivedAt,
        conditionGrade,
        appraisalPrice: appraisalNum,
        repairCost: repairCost ? Number(repairCost) : 0,
        returnReason: returnReason as ReturnReason,
        notes: notes.trim() || undefined,
        receivingBranchId: isOwner ? receivingBranchId : undefined,
      };
      return (await api.post('/device-returns', payload)).data as DeviceReturnRow;
    },
    onSuccess: (row) => {
      toast.success(`บันทึกใบรับเครื่องคืน ${row.docNumber} แล้ว — รอ FINANCE ยืนยัน`);
      queryClient.invalidateQueries({ queryKey: ['device-returns'] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['contract', row.contract.id] });
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
      queryClient.invalidateQueries({ queryKey: ['customer-tags'] });
      onCreated?.(row);
      onClose();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const computeBlockReason = (): string | null => {
    if (!canCreate) return 'เฉพาะเจ้าของ / ผจก.สาขา / พนักงานขาย บันทึกรับเครื่องคืนได้';
    if (!selectedContractId) return 'กรุณาเลือกสัญญา';
    if (previewLoading || previewFetching) return 'กำลังตรวจสอบสัญญา';
    if (previewFailed) return 'ตรวจสอบสัญญาไม่สำเร็จ กรุณาลองใหม่';
    if (!preview) return 'ยังตรวจสอบสัญญาไม่สำเร็จ';
    if (blockedByEligibility) return preview.eligibility.reason || 'สัญญานี้รับเครื่องคืนไม่ได้';
    if (isOwner && !receivingBranchId) return 'กรุณาเลือกสาขาที่รับเครื่อง';
    if (!deviceReceivedAt) return 'กรุณาระบุวันที่รับเครื่อง';
    if (deviceReceivedAt > bkkToday()) return 'วันที่รับเครื่องต้องไม่เป็นวันในอนาคต';
    if (!Number.isFinite(appraisalNum) || appraisalNum <= 0) {
      return 'กรุณาระบุราคาประเมินมากกว่า 0';
    }
    if (!Number.isFinite(Number(repairCost)) || Number(repairCost) < 0) {
      return 'ค่าซ่อมต้องไม่ติดลบ';
    }
    if (!returnReason) return 'กรุณาเลือกเหตุผลคืนเครื่อง';
    if (returnReason === 'OTHER' && !notes.trim()) return 'กรุณาระบุรายละเอียดเหตุผลคืนเครื่อง';
    if (reasonMissing) {
      return 'กรุณาอธิบายเหตุผลที่ราคาประเมินต่างจากตารางเกิน 15% ในหมายเหตุ';
    }
    if (mutation.isPending) return 'กำลังบันทึกใบรับเครื่องคืน';
    return null;
  };
  const submitBlockReason = computeBlockReason();
  const canSubmit = submitBlockReason === null;

  return (
    <Modal
      isOpen={open}
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
      title="บันทึกรับเครื่องคืน"
      size="lg"
    >
      <div className="space-y-4">
        {!canCreate && (
          <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-3">
            <Lock className="size-4 text-warning shrink-0 mt-0.5" />
            <div className="text-xs text-warning leading-snug">
              <strong className="block">
                บันทึกรับเครื่องคืนได้เฉพาะเจ้าของ / ผจก.สาขา / พนักงานขาย
              </strong>
              บทบาทนี้ดูได้อย่างเดียว — ให้สาขาที่รับเครื่องเป็นผู้บันทึก
            </div>
          </div>
        )}

        {/* 1. สัญญา — ค้นหา หรือสรุปสัญญาที่เลือก/ล็อกไว้ */}
        <Section
          icon={<Search className="size-4" />}
          title="สัญญา"
          subtitle="ค้นด้วยเลขสัญญา / เบอร์โทร / IMEI"
        >
          {!selectedContractId ? (
            <div className="space-y-2">
              <input
                id="device-return-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={inputClass}
                placeholder="เลขสัญญา / เบอร์โทร / IMEI (อย่างน้อย 2 ตัวอักษร)"
                autoFocus
              />
              {lookupEnabled && lookup.isLoading && (
                <p className="text-xs text-muted-foreground leading-snug">กำลังค้นหา...</p>
              )}
              {lookupEnabled && lookup.isError && (
                <p role="alert" className="text-xs text-destructive leading-snug">
                  ค้นหาไม่สำเร็จ: {getErrorMessage(lookup.error)}
                </p>
              )}
              {lookupEnabled && lookup.data && lookup.data.length === 0 && (
                <p className="text-xs text-muted-foreground leading-snug">
                  ไม่พบสัญญาที่ตรงกับคำค้น
                </p>
              )}
              {lookupEnabled && lookup.data && lookup.data.length > 0 && (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {lookup.data.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedContractId(row.id)}
                        className="w-full text-left px-3 py-2 hover:bg-accent transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-sm">
                            {row.contractNumber}
                          </span>
                          <span className="text-xs text-muted-foreground">{row.status}</span>
                        </div>
                        <div className="text-xs text-muted-foreground leading-snug">
                          {row.customer.name}
                          {row.product && ` · ${row.product.brand} ${row.product.model}`}
                          {row.product?.imeiSerial && ` · ${row.product.imeiSerial}`}
                          {row.branch && ` · ${row.branch.name}`}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">สัญญา: </span>
                <span className="font-mono font-semibold">
                  {preview?.contract.contractNumber ?? '…'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">ลูกค้า: </span>
                <span className="font-medium">{preview?.contract.customer.name ?? '…'}</span>
              </div>
              {preview?.contract.product && (
                <div>
                  <span className="text-muted-foreground">สินค้า: </span>
                  <span className="font-medium">
                    {preview.contract.product.brand} {preview.contract.product.model}
                    {preview.contract.product.storage ? ` ${preview.contract.product.storage}` : ''}
                  </span>
                  {preview.contract.product.imeiSerial && (
                    <span className="block text-xs text-muted-foreground font-mono">
                      {preview.contract.product.imeiSerial}
                    </span>
                  )}
                </div>
              )}
              {preview?.contract.branch && (
                <div>
                  <span className="text-muted-foreground">สาขาสัญญา: </span>
                  <span className="font-medium">{preview.contract.branch.name}</span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">ยอดค้าง: </span>
                <span className="font-medium">
                  {preview ? `${formatNumberDecimal(preview.outstandingBalance, 2)} ฿` : '…'}
                </span>
              </div>
              {!lockedContract && (
                <div className="col-span-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedContractId(null);
                      setSearch('');
                    }}
                    className="text-xs text-primary underline"
                  >
                    เปลี่ยนสัญญา
                  </button>
                </div>
              )}
            </div>
          )}
        </Section>

        {selectedContractId && previewFailed && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
          >
            <p>ตรวจสอบสัญญาไม่สำเร็จ: {getErrorMessage(previewError)}</p>
            <button type="button" onClick={() => retryPreview()} className="mt-2 underline">
              ลองใหม่
            </button>
          </div>
        )}

        {/* รับคืนไม่ได้ (สถานะ/ยอดค้าง 0/เครื่องเคยยึด/ใบค้าง) — บอกตั้งแต่เลือกสัญญา ไม่รอชน 400 */}
        {blockedByEligibility && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning leading-snug"
          >
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <span>{preview?.eligibility.reason}</span>
          </div>
        )}

        {selectedContractId && (
          <>
            {/* 2. ประเภท (ระบบเลือก) + เหตุผล + วันที่รับ */}
            <Section
              icon={<PackageX className="size-4" />}
              title="การรับคืน"
              subtitle="ประเภท (ระบบเลือกจากสถานะสัญญา), เหตุผล, วันที่รับเครื่อง"
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="block text-xs font-medium text-foreground mb-1.5 leading-snug">
                    ประเภท
                  </span>
                  {returnKind ? (
                    <Badge
                      variant={returnKind === 'REPOSSESSION' ? 'destructive' : 'warning'}
                      appearance="light"
                      size="md"
                      data-testid="device-return-kind"
                    >
                      {DEVICE_RETURN_KIND_LABEL[returnKind]}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="device-return-received-at"
                    className="block text-xs font-medium text-foreground mb-1.5 leading-snug"
                  >
                    วันที่รับเครื่อง <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="device-return-received-at"
                    type="date"
                    value={deviceReceivedAt}
                    max={bkkToday()}
                    onChange={(e) => setDeviceReceivedAt(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2">
                  <label
                    htmlFor="device-return-reason"
                    className="block text-xs font-medium text-foreground mb-1.5 leading-snug"
                  >
                    เหตุผลคืนเครื่อง <span className="text-destructive">*</span>
                  </label>
                  <select
                    id="device-return-reason"
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value as ReturnReason | '')}
                    disabled={reasonLocked}
                    className={inputClass}
                  >
                    <option value="">— เลือกเหตุผลคืนเครื่อง —</option>
                    {reasonOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {reasonLocked && (
                    <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
                      สัญญาบอกเลิกแล้ว — เหตุผลถูกตั้งเป็น "รับเครื่องคืนหลังบอกเลิกสัญญา" โดยระบบ
                    </p>
                  )}
                </div>
              </div>
            </Section>

            {/* 3. สภาพเครื่อง + ราคาประเมิน (ตารางรับซื้อเติมให้ ปรับได้ เตือน ±15%) */}
            <Section
              icon={<Gauge className="size-4" />}
              title="สภาพเครื่อง + ราคาประเมิน"
              subtitle="เกรดสภาพ, ราคาประเมิน (ตารางรับซื้อเติมให้ ปรับได้), ค่าซ่อม"
            >
              <div className="space-y-4">
                <div>
                  <span className="block text-xs font-medium text-foreground mb-1.5 leading-snug">
                    เกรดสภาพ <span className="text-destructive">*</span>
                  </span>
                  <div className="flex gap-2">
                    {GRADES.map((g) => (
                      <button
                        key={g}
                        type="button"
                        aria-pressed={conditionGrade === g}
                        onClick={() => setConditionGrade(g)}
                        className={`flex-1 px-2 py-2 text-sm rounded-lg border transition-colors ${
                          conditionGrade === g
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background border-input hover:bg-muted'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="device-return-appraisal"
                      className="block text-xs font-medium text-foreground mb-1.5 leading-snug"
                    >
                      ราคาประเมิน (฿) <span className="text-destructive">*</span>
                    </label>
                    <input
                      id="device-return-appraisal"
                      type="number"
                      min={0}
                      step="0.01"
                      value={appraisalPrice}
                      onChange={(e) => setAppraisalPrice(e.target.value)}
                      className={`${inputClass} text-right font-mono`}
                      placeholder="0.00"
                    />
                    {valuation && valuation.grade === conditionGrade && (
                      <p
                        className={`mt-1 text-[11px] leading-snug ${
                          reasonMissing
                            ? 'text-destructive'
                            : valuation.found
                              ? 'text-muted-foreground'
                              : 'text-warning'
                        }`}
                      >
                        {!valuation.found
                          ? `ไม่มีรุ่นนี้ในตารางรับซื้อ (เกรด ${valuation.grade}) ตีราคาเอง`
                          : reasonMissing
                            ? `ต่างจากตารางรับซื้อ ${deviationLabel} (เกิน 15%) — ต้องระบุเหตุผลในหมายเหตุก่อนบันทึก`
                            : `ตารางรับซื้อ เกรด ${valuation.grade}: ${formatNumberDecimal(valuation.suggestedPrice ?? 0, 2)} ฿` +
                              (appraisalPrice === autoPrice
                                ? ' (ค่าตั้งต้น ปรับตามสภาพจริงได้)'
                                : deviationLabel
                                  ? ` · ต่างจากตาราง ${deviationLabel}`
                                  : '')}
                      </p>
                    )}
                  </div>
                  <div>
                    <label
                      htmlFor="device-return-repair-cost"
                      className="block text-xs font-medium text-foreground mb-1.5 leading-snug"
                    >
                      ค่าซ่อม (฿)
                    </label>
                    <input
                      id="device-return-repair-cost"
                      type="number"
                      min={0}
                      step="0.01"
                      value={repairCost}
                      onChange={(e) => setRepairCost(e.target.value)}
                      className={`${inputClass} text-right font-mono`}
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>
            </Section>

            {/* 4. หมายเหตุ */}
            <Section
              icon={<FileText className="size-4" />}
              title="หมายเหตุ"
              subtitle="บังคับเมื่อเหตุผล = อื่น ๆ หรือราคาต่างจากตารางเกิน 15%"
            >
              <label htmlFor="device-return-notes" className="block text-xs font-medium mb-1.5">
                รายละเอียดเพิ่มเติม{' '}
                {returnReason === 'OTHER' || needsReason ? (
                  <span className="text-destructive">*</span>
                ) : (
                  '(ถ้ามี)'
                )}
              </label>
              <textarea
                id="device-return-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                maxLength={1000}
                className={`${inputClass} resize-none`}
                placeholder="เช่น สภาพเครื่อง หรือเหตุผลที่ราคาประเมินต่างจากตาราง..."
              />
              {needsReason && (
                <p className="text-xs text-warning mt-1 leading-snug">
                  กรุณาอธิบายเหตุผลที่ราคาประเมินต่างจากตารางเกิน 15%
                </p>
              )}
            </Section>

            {/* 5. OWNER เท่านั้น — สาขาที่รับเครื่องจริง (D7: รับได้ทุกสาขา ใบเก็บสาขาที่รับ) */}
            {isOwner && (
              <Section
                icon={<Store className="size-4" />}
                title="สาขาที่รับเครื่อง"
                subtitle="เจ้าของต้องระบุสาขาที่รับเครื่องจริง (สาขาบันทึกเองใช้สาขาตัวเอง)"
              >
                <label
                  htmlFor="device-return-branch"
                  className="block text-xs font-medium text-foreground mb-1.5 leading-snug"
                >
                  สาขาที่รับเครื่อง <span className="text-destructive">*</span>
                </label>
                <select
                  id="device-return-branch"
                  value={receivingBranchId}
                  onChange={(e) => setReceivingBranchId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">— เลือกสาขา —</option>
                  {(branches.data ?? [])
                    .filter((b) => b.isActive)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
              </Section>
            )}

            {/* 6. สิ่งที่จะเกิดขึ้น — ไม่มีการลงบัญชีในขั้นนี้ */}
            <Section
              icon={<Check className="size-4" />}
              title="สิ่งที่จะเกิดขึ้นเมื่อบันทึก"
              subtitle="ไม่มีการลงบัญชีในขั้นนี้ — FINANCE ลงบัญชีตอนยืนยัน"
              tone="success"
            >
              <ul className="space-y-1.5 text-sm">
                {returnKind === 'VOLUNTARY' && (
                  <Effect text="สัญญาหยุดนับค่างวดและค่าปรับทันที (สถานะ → บอกเลิกสัญญา) — ส่งกลับ/ยกเลิกใบจะคืนสถานะเดิม" />
                )}
                {returnKind === 'REPOSSESSION' && (
                  <Effect text="สัญญาบอกเลิกอยู่แล้ว — สถานะไม่เปลี่ยนจนกว่า FINANCE ยืนยัน" />
                )}
                <Effect text="แจ้งลูกค้าทางไลน์ทันที (ไม่มีราคาประเมินในข้อความ)" />
                <Effect text="รอ FINANCE ยืนยันบัญชี (JP5 + ขาคู่ SHOP) — ค่าเครื่องหักในรอบจ่าย INTER-CO ถัดไป" />
                <Effect text="ปลดล็อค MDM (PJ-Soft) — ต้องทำ manual" warning />
              </ul>
            </Section>
          </>
        )}

        {/* Footer */}
        <div className="border-t border-border pt-3 space-y-3">
          {submitBlockReason && (
            <div
              id="device-return-submit-block"
              role="status"
              className="text-sm text-warning leading-snug"
            >
              {submitBlockReason}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={mutation.isPending}
              className="px-5 py-2.5 text-sm border border-border rounded-lg hover:bg-accent transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={!canSubmit}
              title={submitBlockReason ?? undefined}
              aria-describedby={submitBlockReason ? 'device-return-submit-block' : undefined}
              className="px-6 py-2.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg disabled:opacity-50 font-semibold transition-colors"
            >
              {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึกรับเครื่องคืน'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/components/device-returns/__tests__/DeviceReturnIntakeDialog.test.tsx`
Expected: PASS (4 describe / 10 tests)

- [ ] **Step 5: Checkpoint**

Run `./tools/check-types.sh web` — Expected: 0 errors. **Do NOT commit** (see Global Constraints).

---

### Task 4: `DeviceReturnList` — ตาราง "ใบรับเครื่องคืน — รอ FINANCE ยืนยัน"

**Files:**
- Create: `apps/web/src/components/device-returns/DeviceReturnList.tsx`
- Test: `apps/web/src/components/device-returns/__tests__/DeviceReturnList.test.tsx`

**Interfaces:**
- Consumes: `GET /device-returns?status=PENDING_CONFIRM&limit=100`, `POST /device-returns/:id/cancel`, `POST /device-returns/:id/resend-line`; `RejectDeviceReturnDialog` (Task 2); `ConfirmDialog` (`@/components/ui/ConfirmDialog`); `QueryBoundary`; `getStatusBadgeProps`/`conditionGradeMap` (`@/lib/status-badges`)
- Produces: `DeviceReturnList({ onConfirm: (row: DeviceReturnRow) => void })` — Task 6 mount ในหน้า `/repossessions` แล้วเปิด `RepossessionOverlay` โหมดยืนยันจาก `onConfirm`

สิทธิ์บนแถว (spec §5.0 + §9): ยืนยัน/ส่งกลับ = OWNER, FM · ส่งซ้ำไลน์ = OWNER, FM, BM (เฉพาะแถวที่ไลน์ยังไม่ `SENT`) · ยกเลิก = OWNER ทุกใบ, BM เฉพาะ `receivingBranch.id === user.branchId` · SALES/ACCOUNTANT เห็นสถานะอย่างเดียว.

- [ ] **Step 1: Write the failing test**

สร้าง `apps/web/src/components/device-returns/__tests__/DeviceReturnList.test.tsx`:

```tsx
/**
 * ตาราง "ใบรับเครื่องคืน — รอ FINANCE ยืนยัน" (spec 2026-09-20 §7):
 *   FINANCE (OWNER/FM) เห็น ยืนยัน / ส่งกลับ / ส่งซ้ำไลน์ · สาขา (BM) เห็นสถานะ + ยกเลิกใบสาขาตัวเอง ·
 *   SALES/ACC เห็นสถานะอย่างเดียว · ยืนยัน = ส่งแถวให้ parent เปิด overlay โหมดยืนยัน
 */
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type TestUser = { id: string; name: string; role: string; branchId: string | null };
let currentUser: TestUser = { id: 'u-owner', name: 'เจ้าของ', role: 'OWNER', branchId: null };
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: currentUser, isLoading: false }),
}));

import { DeviceReturnList } from '../DeviceReturnList';

const baseRow = {
  status: 'PENDING_CONFIRM',
  deviceReceivedAt: '2026-09-19T03:00:00.000Z',
  conditionGrade: 'B',
  appraisalPrice: '7000.00',
  tableBasePrice: '6500.00',
  repairCost: '0.00',
  notes: null,
  lineNotifiedAt: '2026-09-19T03:01:00.000Z',
  receivedBy: { id: 'u-bm', name: 'ผจก.ลาดพร้าว' },
  confirmedAt: null,
  confirmedBy: null,
  repossessionId: null,
  rejectReason: null,
  createdAt: '2026-09-19T03:00:00.000Z',
};
const rows = [
  {
    ...baseRow,
    id: 'dr-1',
    docNumber: 'DR-20260919-0001',
    returnKind: 'VOLUNTARY',
    returnReason: 'UNAFFORDABLE',
    lineNotifyStatus: 'SENT',
    receivingBranch: { id: 'b1', name: 'ลาดพร้าว' },
    contract: {
      id: 'c-1',
      contractNumber: 'TEST-20260919-001',
      status: 'TERMINATED',
      customer: { id: 'cu1', name: 'สมชาย ใจดี' },
      product: { id: 'p1', brand: 'Apple', model: 'iPhone 14', imeiSerial: '350000000000001' },
    },
  },
  {
    ...baseRow,
    id: 'dr-2',
    docNumber: 'DR-20260919-0002',
    returnKind: 'REPOSSESSION',
    returnReason: 'AFTER_TERMINATION',
    lineNotifyStatus: 'FAILED',
    receivingBranch: { id: 'b2', name: 'รามอินทรา' },
    contract: {
      id: 'c-2',
      contractNumber: 'TEST-20260919-002',
      status: 'TERMINATED',
      customer: { id: 'cu2', name: 'สมหญิง รักดี' },
      product: { id: 'p2', brand: 'Samsung', model: 'S24', imeiSerial: null },
    },
  },
];

function routeApi(data: unknown[] = rows) {
  apiGet.mockImplementation((url: string) => {
    if (url === '/device-returns?status=PENDING_CONFIRM&limit=100') {
      return Promise.resolve({ data: { data, total: data.length, page: 1, limit: 100 } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const rowOf = (docNumber: string) => screen.getByTestId(`device-return-row-${docNumber}`);

beforeEach(() => {
  currentUser = { id: 'u-owner', name: 'เจ้าของ', role: 'OWNER', branchId: null };
  apiGet.mockReset();
  apiPost.mockReset().mockResolvedValue({ data: {} });
});

describe('DeviceReturnList — สิทธิ์ต่อบทบาท', () => {
  it('OWNER: ยืนยัน/ส่งกลับ/ยกเลิก ทุกแถว, ส่งซ้ำไลน์เฉพาะแถวที่ไลน์ไม่ SENT', async () => {
    routeApi();
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText('DR-20260919-0001');
    const r1 = within(rowOf('DR-20260919-0001'));
    const r2 = within(rowOf('DR-20260919-0002'));
    expect(r1.getByRole('button', { name: 'ยืนยัน' })).toBeInTheDocument();
    expect(r1.getByRole('button', { name: 'ส่งกลับ' })).toBeInTheDocument();
    expect(r1.getByRole('button', { name: 'ยกเลิก' })).toBeInTheDocument();
    expect(r1.queryByRole('button', { name: /ส่งซ้ำไลน์/ })).not.toBeInTheDocument();
    expect(r2.getByRole('button', { name: /ส่งซ้ำไลน์/ })).toBeInTheDocument();
    expect(r1.getByText('ส่งไลน์แล้ว')).toBeInTheDocument();
    expect(r2.getByText('ส่งไลน์ไม่สำเร็จ')).toBeInTheDocument();
    expect(r1.getByText('ลูกค้าคืนเอง')).toBeInTheDocument();
    expect(r2.getByText('ยึดเครื่อง')).toBeInTheDocument();
    expect(r1.getByText('7,000.00 ฿')).toBeInTheDocument();
  });

  it('FINANCE_MANAGER: ยืนยัน/ส่งกลับ แต่ไม่มียกเลิก', async () => {
    currentUser = { id: 'u-fm', name: 'ผจก.การเงิน', role: 'FINANCE_MANAGER', branchId: null };
    routeApi();
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText('DR-20260919-0001');
    const r1 = within(rowOf('DR-20260919-0001'));
    expect(r1.getByRole('button', { name: 'ยืนยัน' })).toBeInTheDocument();
    expect(r1.queryByRole('button', { name: 'ยกเลิก' })).not.toBeInTheDocument();
  });

  it('BRANCH_MANAGER สาขา b1: ไม่มียืนยัน; ยกเลิกเฉพาะใบสาขาตัวเอง; ส่งซ้ำไลน์ได้', async () => {
    currentUser = { id: 'u-bm', name: 'ผจก.ลาดพร้าว', role: 'BRANCH_MANAGER', branchId: 'b1' };
    routeApi();
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText('DR-20260919-0001');
    const r1 = within(rowOf('DR-20260919-0001'));
    const r2 = within(rowOf('DR-20260919-0002'));
    expect(r1.queryByRole('button', { name: 'ยืนยัน' })).not.toBeInTheDocument();
    expect(r1.getByRole('button', { name: 'ยกเลิก' })).toBeInTheDocument();
    expect(r2.queryByRole('button', { name: 'ยกเลิก' })).not.toBeInTheDocument();
    expect(r2.getByRole('button', { name: /ส่งซ้ำไลน์/ })).toBeInTheDocument();
  });

  it('SALES: สถานะอย่างเดียว ไม่มีปุ่ม', async () => {
    currentUser = { id: 'u-s', name: 'พนักงานขาย', role: 'SALES', branchId: 'b1' };
    routeApi();
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText('DR-20260919-0001');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('ว่าง → ข้อความว่างและจำนวน 0 ใบ', async () => {
    routeApi([]);
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    expect(await screen.findByText('ไม่มีใบรับเครื่องคืนที่รอยืนยัน')).toBeInTheDocument();
    expect(screen.getByText('0 ใบ')).toBeInTheDocument();
  });
});

describe('DeviceReturnList — การกระทำ', () => {
  it('ยืนยัน → onConfirm(row)', async () => {
    const onConfirm = vi.fn();
    routeApi();
    render(<DeviceReturnList onConfirm={onConfirm} />, { wrapper });
    await screen.findByText('DR-20260919-0001');
    fireEvent.click(within(rowOf('DR-20260919-0001')).getByRole('button', { name: 'ยืนยัน' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: 'dr-1' }));
  });

  it('ยกเลิก → ConfirmDialog → POST /device-returns/:id/cancel', async () => {
    routeApi();
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText('DR-20260919-0001');
    fireEvent.click(within(rowOf('DR-20260919-0001')).getByRole('button', { name: 'ยกเลิก' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/DR-20260919-0001/);
    expect(dialog).toHaveTextContent(/สัญญาจะกลับไปสถานะเดิม/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยันยกเลิกใบ' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/device-returns/dr-1/cancel'));
  });

  it('ส่งกลับ → RejectDeviceReturnDialog → POST reject', async () => {
    routeApi();
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText('DR-20260919-0002');
    fireEvent.click(within(rowOf('DR-20260919-0002')).getByRole('button', { name: 'ส่งกลับ' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/เหตุผลที่ส่งกลับ/), {
      target: { value: 'ราคาประเมินสูงเกินสภาพจริง' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยันส่งกลับ' }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/device-returns/dr-2/reject', {
        reason: 'ราคาประเมินสูงเกินสภาพจริง',
      }),
    );
  });

  it('ส่งซ้ำไลน์ → POST /device-returns/:id/resend-line', async () => {
    routeApi();
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText('DR-20260919-0002');
    fireEvent.click(within(rowOf('DR-20260919-0002')).getByRole('button', { name: /ส่งซ้ำไลน์/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/device-returns/dr-2/resend-line'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/components/device-returns/__tests__/DeviceReturnList.test.tsx`
Expected: FAIL with `Failed to resolve import "../DeviceReturnList"`

- [ ] **Step 3: Write minimal implementation**

สร้าง `apps/web/src/components/device-returns/DeviceReturnList.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { conditionGradeMap, getStatusBadgeProps } from '@/lib/status-badges';
import { formatDateShort, formatNumberDecimal } from '@/utils/formatters';
import { RejectDeviceReturnDialog } from './RejectDeviceReturnDialog';
import {
  canCancelDeviceReturn,
  DEVICE_RETURN_CONFIRM_ROLES,
  DEVICE_RETURN_KIND_LABEL,
  DEVICE_RETURN_RESEND_ROLES,
  LINE_STATUS_LABEL,
  RETURN_REASON_LABEL,
  type DeviceReturnListResponse,
  type DeviceReturnRow,
  type LineNotifyStatus,
} from './types';

interface Props {
  /** FINANCE กด "ยืนยัน" → parent เปิด RepossessionOverlay โหมดยืนยันด้วยแถวนี้ */
  onConfirm: (row: DeviceReturnRow) => void;
}

const LINE_BADGE: Record<LineNotifyStatus, 'success' | 'destructive' | 'warning'> = {
  SENT: 'success',
  FAILED: 'destructive',
  NO_LINE: 'warning',
};

/**
 * ตาราง "ใบรับเครื่องคืน — รอ FINANCE ยืนยัน" (spec 2026-09-20 §7) บนหน้า /repossessions.
 * Query key ขึ้นต้น ['device-returns'] — intake dialog / overlay / reject / cancel
 * invalidate prefix เดียวกันแล้วตารางนี้ + รายการรอยึดเครื่อง refresh พร้อมกัน.
 */
export function DeviceReturnList({ onConfirm }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const role = user?.role ?? '';
  const canConfirm = DEVICE_RETURN_CONFIRM_ROLES.includes(role);
  const canResend = DEVICE_RETURN_RESEND_ROLES.includes(role);
  const [rejectTarget, setRejectTarget] = useState<DeviceReturnRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DeviceReturnRow | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<DeviceReturnListResponse>({
    queryKey: ['device-returns', 'pending-confirm'],
    queryFn: async () => (await api.get('/device-returns?status=PENDING_CONFIRM&limit=100')).data,
    staleTime: 15_000,
  });
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  const cancelMutation = useMutation({
    mutationFn: async (row: DeviceReturnRow) =>
      (await api.post(`/device-returns/${row.id}/cancel`)).data,
    onSuccess: (_res, row) => {
      toast.success(
        `ยกเลิกใบ ${row.docNumber} แล้ว — ${
          row.returnKind === 'VOLUNTARY' ? 'สัญญากลับไปสถานะเดิม' : 'สัญญายังบอกเลิกอยู่ตามเดิม'
        }`,
      );
      queryClient.invalidateQueries({ queryKey: ['device-returns'] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['contract', row.contract.id] });
      queryClient.invalidateQueries({ queryKey: ['customer-tags'] });
      setCancelTarget(null);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const resendMutation = useMutation({
    mutationFn: async (row: DeviceReturnRow) =>
      (await api.post(`/device-returns/${row.id}/resend-line`)).data,
    onSuccess: () => {
      toast.success('ส่งไลน์แจ้งลูกค้าอีกครั้งแล้ว');
      queryClient.invalidateQueries({ queryKey: ['device-returns'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  return (
    <Card className="shadow-card mb-6 overflow-hidden">
      <CardHeader className="px-4 py-3 border-b bg-secondary flex flex-row items-center justify-between">
        <h3 className="text-sm font-medium text-foreground leading-snug">
          ใบรับเครื่องคืน — รอ FINANCE ยืนยัน
        </h3>
        <Badge variant="warning" appearance="light" size="sm">
          {total} ใบ
        </Badge>
      </CardHeader>
      <QueryBoundary
        isLoading={isLoading && rows.length === 0}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดใบรับเครื่องคืนได้"
      >
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center leading-snug">
            ไม่มีใบรับเครื่องคืนที่รอยืนยัน
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-secondary text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-2 text-left">เลขที่ใบ / วันที่รับ</th>
                  <th className="px-4 py-2 text-left">สัญญา / ลูกค้า</th>
                  <th className="px-4 py-2 text-left">สินค้า</th>
                  <th className="px-4 py-2 text-left">สาขาที่รับ / ผู้ตรวจ</th>
                  <th className="px-4 py-2 text-left">ประเภท / เหตุผล</th>
                  <th className="px-4 py-2 text-right">เกรด / ราคาประเมิน</th>
                  <th className="px-4 py-2 text-left">ไลน์</th>
                  <th className="px-4 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => {
                  const grade = getStatusBadgeProps(r.conditionGrade, conditionGradeMap);
                  const canCancel = canCancelDeviceReturn(user, r);
                  const showResend = canResend && r.lineNotifyStatus !== 'SENT';
                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-muted/50"
                      data-testid={`device-return-row-${r.docNumber}`}
                    >
                      <td className="px-4 py-2">
                        <div className="font-mono font-medium text-primary">{r.docNumber}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDateShort(r.deviceReceivedAt)}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium">{r.contract.contractNumber}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.contract.customer.name}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        {r.contract.product.brand} {r.contract.product.model}
                        {r.contract.product.imeiSerial && (
                          <div className="text-xs text-muted-foreground font-mono">
                            {r.contract.product.imeiSerial}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div>{r.receivingBranch.name}</div>
                        <div className="text-xs text-muted-foreground">{r.receivedBy.name}</div>
                      </td>
                      <td className="px-4 py-2">
                        <Badge
                          variant={r.returnKind === 'REPOSSESSION' ? 'destructive' : 'warning'}
                          appearance="light"
                          size="sm"
                        >
                          {DEVICE_RETURN_KIND_LABEL[r.returnKind]}
                        </Badge>
                        <div className="text-xs text-muted-foreground leading-snug mt-0.5">
                          {RETURN_REASON_LABEL[r.returnReason]}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <Badge variant={grade.variant} appearance={grade.appearance} size="sm">
                          {grade.label}
                        </Badge>
                        <div className="text-sm font-mono">
                          {formatNumberDecimal(r.appraisalPrice, 2)} ฿
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        {r.lineNotifyStatus ? (
                          <Badge
                            variant={LINE_BADGE[r.lineNotifyStatus]}
                            appearance="light"
                            size="sm"
                          >
                            {LINE_STATUS_LABEL[r.lineNotifyStatus]}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" appearance="light" size="sm">
                            ยังไม่ส่ง
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-3">
                          {canConfirm && (
                            <>
                              <button
                                type="button"
                                onClick={() => onConfirm(r)}
                                className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                              >
                                ยืนยัน
                              </button>
                              <button
                                type="button"
                                onClick={() => setRejectTarget(r)}
                                className="text-destructive hover:text-destructive/80 text-sm font-medium"
                              >
                                ส่งกลับ
                              </button>
                            </>
                          )}
                          {showResend && (
                            <button
                              type="button"
                              onClick={() => resendMutation.mutate(r)}
                              disabled={resendMutation.isPending}
                              title="ส่งไลน์แจ้งลูกค้าอีกครั้ง"
                              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground text-sm font-medium disabled:opacity-50"
                            >
                              <Send className="h-3.5 w-3.5" />
                              ส่งซ้ำไลน์
                            </button>
                          )}
                          {canCancel && (
                            <button
                              type="button"
                              onClick={() => setCancelTarget(r)}
                              className="text-warning hover:text-warning/80 text-sm font-medium"
                            >
                              ยกเลิก
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryBoundary>

      <RejectDeviceReturnDialog target={rejectTarget} onClose={() => setRejectTarget(null)} />

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(open) => {
          if (!open && !cancelMutation.isPending) setCancelTarget(null);
        }}
        title="ยกเลิกใบรับเครื่องคืน"
        description={
          cancelTarget
            ? `ยกเลิกใบ ${cancelTarget.docNumber} สัญญา ${cancelTarget.contract.contractNumber}? ${
                cancelTarget.returnKind === 'VOLUNTARY'
                  ? 'สัญญาจะกลับไปสถานะเดิมและเดินค่างวด/ค่าปรับต่อ'
                  : 'สัญญายังบอกเลิกอยู่ตามเดิม'
              } — ลูกค้าจะได้รับไลน์แจ้งว่าใบถูกยกเลิก`
            : ''
        }
        confirmLabel="ยืนยันยกเลิกใบ"
        variant="destructive"
        loading={cancelMutation.isPending}
        closeOnConfirm={false}
        onConfirm={() => cancelTarget && cancelMutation.mutate(cancelTarget)}
      />
    </Card>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/components/device-returns/__tests__/DeviceReturnList.test.tsx`
Expected: PASS (2 describe / 9 tests)

- [ ] **Step 5: Checkpoint**

Run `./tools/check-types.sh web` — Expected: 0 errors. **Do NOT commit** (see Global Constraints).

---

### Task 5: `RepossessionOverlay` → โหมดยืนยันอย่างเดียว (prop `deviceReturnId`)

**Files:**
- Modify: `apps/web/src/pages/PaymentsPage/components/RepossessionOverlay.tsx` (แทนทั้งไฟล์ — origin/main 1012 บรรทัด)
- Rename + rewrite: `apps/web/src/pages/PaymentsPage/components/__tests__/RepossessionOverlay.valuation.test.tsx` → `RepossessionOverlay.confirm-mode.test.tsx` (เทสต์เกรด/ราคาประเมินแบบแก้ได้ย้ายไปอยู่ที่ Task 3 แล้ว — overlay ไม่มีช่องเหล่านั้นอีก)

**Interfaces:**
- Consumes: `GET /device-returns/:id` (Task 1 `DeviceReturnRow`), `GET /repossessions/preview/:contractId?deviceReturnId=&discountPct=`, `POST /device-returns/:id/confirm`, `RejectDeviceReturnDialog` (Task 2), `Section/Row/Effect` (Task 1)
- Produces: `RepossessionOverlay({ deviceReturnId: string; contractId: string; contractNumber: string; customerName: string; branchName?: string; onClose: () => void; onSuccess: () => void })` — Task 6 mount; **prop `deviceReturnId` บังคับ** (ไม่มี `POST /repossessions` ให้โหมดสร้างอีกต่อไป — brief เขียน `deviceReturnId?` แต่ optional จะเหลือทางที่ไม่มี endpoint รองรับ)

**ถอดออก:** `CashAccountSelect`/`KBANK_ONLY_CODES` import, state `depositAccountCode`/`collectedByShop`/`repossessedDate`/`conditionGrade`/`appraisalPrice`/`autoPrice`/`repairCost`/`notes`/`returnReason`, ช่องติ๊ก "ตั้งลูกหนี้-หน้าร้าน", ปุ่ม + dialog "บันทึกรับโอนจากหน้าร้าน" (`settlementMutation`), `mutation` ที่ `POST /repossessions`, `FocusScope` import (ใช้เฉพาะ settlement dialog), `Store` icon, และ helpers ท้ายไฟล์ (ย้ายไป Task 1)

- [ ] **Step 1: Write the failing test**

```bash
cd "D:/BESTCHOICE APP/BESTCHOICE-device-return" && git mv apps/web/src/pages/PaymentsPage/components/__tests__/RepossessionOverlay.valuation.test.tsx apps/web/src/pages/PaymentsPage/components/__tests__/RepossessionOverlay.confirm-mode.test.tsx
```

แทนเนื้อหา `apps/web/src/pages/PaymentsPage/components/__tests__/RepossessionOverlay.confirm-mode.test.tsx` ทั้งไฟล์ด้วย:

```tsx
/**
 * RepossessionOverlay โหมดยืนยันใบรับเครื่องคืน (spec 2026-09-20 §5.2, §7):
 *   - ข้อมูลใบ (เกรด/ราคาประเมิน/เหตุผล/สาขา/ไลน์) อ่านอย่างเดียวจาก GET /device-returns/:id
 *   - preview JP5 เรียกด้วย deviceReturnId + discountPct เท่านั้น (ไม่มี conditionGrade/appraisalPrice/collectedByShop)
 *   - แก้ได้เฉพาะ วันที่ลงบัญชี + ส่วนลดยอดปิด; ปุ่ม ยืนยัน = POST /device-returns/:id/confirm, ส่งกลับ = reject
 *   - ไม่มีบัญชีรับเงิน / ช่องติ๊กลูกหนี้-หน้าร้าน / ปุ่มรับโอนจากหน้าร้าน อีกต่อไป
 */
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
type TestUser = { id: string; name: string; role: string; branchId: string | null };
let currentUser: TestUser = { id: 'u1', name: 'เจ้าของ', role: 'OWNER', branchId: null };
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: currentUser, isLoading: false }),
}));

import { RepossessionOverlay } from '../RepossessionOverlay';

let deviceReturnStatus = 'PENDING_CONFIRM';
let eligibilityOverride: { canRepossess: boolean; reason: string | null } | null = null;
let missingJournal = false;
let unbalancedJournal = false;

const deviceReturn = () => ({
  id: 'dr-1',
  docNumber: 'DR-20260920-0001',
  status: deviceReturnStatus,
  returnKind: 'VOLUNTARY',
  returnReason: 'UNAFFORDABLE',
  deviceReceivedAt: '2026-09-19T03:00:00.000Z',
  conditionGrade: 'B',
  appraisalPrice: '7000.00',
  tableBasePrice: '6500.00',
  repairCost: '0.00',
  notes: 'จอมีรอย',
  lineNotifyStatus: 'SENT',
  lineNotifiedAt: '2026-09-19T03:01:00.000Z',
  receivingBranch: { id: 'b1', name: 'ลาดพร้าว' },
  receivedBy: { id: 'u-bm', name: 'ผจก.ลาดพร้าว' },
  contract: {
    id: 'c-1',
    contractNumber: 'TEST-1',
    status: 'TERMINATED',
    customer: { id: 'cu1', name: 'ลูกค้า' },
    product: { id: 'p1', brand: 'Apple', model: 'iPhone 14', imeiSerial: null },
  },
  confirmedAt: null,
  confirmedBy: null,
  repossessionId: null,
  rejectReason: null,
  createdAt: '2026-09-19T03:00:00.000Z',
});

const preview = (url: string) => {
  const q = new URLSearchParams(url.split('?')[1] ?? '');
  const discountPct = Number(q.get('discountPct') ?? 50);
  return {
    contract: {
      contractNumber: 'TEST-1',
      customer: { name: 'ลูกค้า' },
      product: { brand: 'Apple', model: 'iPhone 14' },
      totalMonths: 12,
      monthlyPayment: 1000,
      sellingPrice: 12000,
      financedAmount: 10000,
      storeCommission: 500,
    },
    calculation: {
      remainingMonths: 2,
      totalPaid: 10000,
      outstandingBalance: 2000,
      principalExVat: 1869.16,
      financeCost: 10500,
      remainingCost: 1750,
      grossProfit: 119.16,
      discountPct,
      discountAmount: 59.58,
      unpaidLateFees: 0,
      closingAmount: 1940.42,
      marketValue: 7000,
      marketValueSource: 'APPRAISAL',
      profitLoss: 5059.58,
      rescheduleAdvanceApplied: 0,
    },
    journalPreview: missingJournal
      ? null
      : {
          lines: [
            { accountCode: '11-2107', accountName: 'ลูกหนี้-หน้าร้าน', debit: '7000.00', credit: '0', description: 'ค่าเครื่องคืน' },
            { accountCode: '11-2101', accountName: 'ลูกหนี้ผ่อนชำระ', debit: '0', credit: '2000.00', description: '' },
            { accountCode: '41-1102', accountName: 'กำไรจากการยึด', debit: '0', credit: '5000.00', description: '' },
          ],
          totalDebit: '7000.00',
          totalCredit: '7000.00',
          isBalanced: !unbalancedJournal,
        },
    eligibility: eligibilityOverride ?? { canRepossess: true, reason: null },
  };
};

function routeApi() {
  apiGet.mockImplementation((url?: string) => {
    if (url === '/device-returns/dr-1') return Promise.resolve({ data: deviceReturn() });
    if (typeof url === 'string' && url.startsWith('/repossessions/preview/c-1?')) {
      return Promise.resolve({ data: preview(url) });
    }
    return Promise.reject(new Error('unexpected ' + String(url)));
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderOverlay() {
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  render(
    <RepossessionOverlay
      deviceReturnId="dr-1"
      contractId="c-1"
      contractNumber="TEST-1"
      customerName="ลูกค้า"
      branchName="ลาดพร้าว"
      onClose={onClose}
      onSuccess={onSuccess}
    />,
    { wrapper },
  );
  return { onClose, onSuccess };
}

const confirmButton = () =>
  screen.getByRole('button', { name: 'ยืนยันรับเครื่องคืน' }) as HTMLButtonElement;
const bkkToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

beforeEach(() => {
  currentUser = { id: 'u1', name: 'เจ้าของ', role: 'OWNER', branchId: null };
  deviceReturnStatus = 'PENDING_CONFIRM';
  eligibilityOverride = null;
  missingJournal = false;
  unbalancedJournal = false;
  // NOTE: block body on purpose — `mockReset()` returns the mock, and vitest would run a
  // returned function as the hook's cleanup.
  apiGet.mockReset();
  apiPost.mockReset().mockResolvedValue({ data: { id: 'dr-1', status: 'CONFIRMED' } });
});

describe('RepossessionOverlay — โหมดยืนยันใบรับเครื่องคืน', () => {
  it('แสดงข้อมูลใบอ่านอย่างเดียว + ไลน์ และเรียก preview ด้วย deviceReturnId + discountPct เท่านั้น', async () => {
    routeApi();
    renderOverlay();
    expect(await screen.findByText('DR-20260920-0001')).toBeInTheDocument();
    expect(screen.getByTestId('dr-appraisal')).toHaveTextContent('7,000.00 ฿');
    expect(screen.getByText(/ตารางรับซื้อ 6,500\.00 ฿ · ต่างจากตาราง \+8%/)).toBeInTheDocument();
    expect(screen.getByText('ส่งไลน์แล้ว')).toBeInTheDocument();
    expect(screen.getByText('จอมีรอย')).toBeInTheDocument();
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/repossessions/preview/c-1?deviceReturnId=dr-1&discountPct=50'),
    );
    const previewUrls = apiGet.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/preview/'));
    expect(previewUrls.every((u) => !/conditionGrade|appraisalPrice|collectedByShop|depositAccountCode/.test(u))).toBe(true);
    // ถอดออกแล้ว
    expect(screen.queryByText(/บัญชีรับเงิน/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/ตั้งลูกหนี้-หน้าร้าน/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /บันทึกรับโอนจากหน้าร้าน/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^A$/ })).not.toBeInTheDocument();
  });

  it('OWNER ยืนยัน → POST /device-returns/dr-1/confirm { paymentDate, discountPct } → onSuccess + onClose', async () => {
    routeApi();
    const { onClose, onSuccess } = renderOverlay();
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/device-returns/dr-1/confirm', {
        paymentDate: bkkToday(),
        discountPct: 50,
      }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('FINANCE_MANAGER ยืนยันได้; BRANCH_MANAGER เห็นแจ้งเตือนและปุ่มปิด', async () => {
    currentUser = { id: 'u-fm', name: 'ผจก.การเงิน', role: 'FINANCE_MANAGER', branchId: null };
    routeApi();
    const first = renderOverlay();
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    first.onClose();

    currentUser = { id: 'u-bm', name: 'ผจก.สาขา', role: 'BRANCH_MANAGER', branchId: 'b1' };
    routeApi();
    renderOverlay();
    expect(await screen.findAllByText(/เฉพาะเจ้าของ \/ ผจก.การเงิน/)).not.toHaveLength(0);
    const buttons = screen.getAllByRole('button', { name: 'ยืนยันรับเครื่องคืน' });
    expect(buttons[buttons.length - 1]).toBeDisabled();
  });

  it('ใบที่ไม่ใช่ PENDING_CONFIRM → ปุ่มปิด + ข้อความ', async () => {
    deviceReturnStatus = 'REJECTED';
    routeApi();
    renderOverlay();
    await screen.findByText('DR-20260920-0001');
    await waitFor(() =>
      expect(confirmButton()).toHaveAttribute('title', 'ใบนี้ถูกยืนยัน/ส่งกลับ/ยกเลิกไปแล้ว'),
    );
    expect(confirmButton()).toBeDisabled();
  });

  it('eligibility ไม่ผ่าน → แบนเนอร์ + ปุ่มปิด + ลิงก์เปิดสัญญา', async () => {
    eligibilityOverride = { canRepossess: false, reason: 'ยอดค้างเป็น 0 — ลูกค้าจ่ายครบระหว่างรอ ให้ส่งกลับใบ' };
    routeApi();
    renderOverlay();
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/ยอดค้างเป็น 0/);
    await waitFor(() => expect(confirmButton()).toBeDisabled());
    expect(screen.getByRole('link', { name: /เปิดสัญญา/ })).toHaveAttribute('href', '/contracts/c-1');
    fireEvent.click(confirmButton());
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('ส่งกลับ → dialog เหตุผล → POST reject → onSuccess + onClose', async () => {
    routeApi();
    const { onClose, onSuccess } = renderOverlay();
    fireEvent.click(await screen.findByRole('button', { name: 'ส่งกลับ' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/เหตุผลที่ส่งกลับ/), {
      target: { value: 'ราคาประเมินสูงเกินสภาพจริง' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยันส่งกลับ' }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/device-returns/dr-1/reject', {
        reason: 'ราคาประเมินสูงเกินสภาพจริง',
      }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('เปลี่ยนส่วนลด → preview refetch ด้วย discountPct ใหม่', async () => {
    routeApi();
    renderOverlay();
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    fireEvent.change(screen.getByLabelText(/ส่วนลดยอดปิด/), { target: { value: '30' } });
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/repossessions/preview/c-1?deviceReturnId=dr-1&discountPct=30'),
    );
    await waitFor(() => expect(screen.getByText(/ส่วนลดลูกค้า \(30%\)/)).toBeInTheDocument());
  });

  it.each(['missing', 'unbalanced'])('blocks a %s JP5 preview', async (state) => {
    missingJournal = state === 'missing';
    unbalancedJournal = state === 'unbalanced';
    routeApi();
    renderOverlay();
    await screen.findByText('DR-20260920-0001');
    await waitFor(() => expect(confirmButton().title).toMatch(/JP5/));
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByText('รายการบัญชีคืนเครื่อง (JP5)')).toBeInTheDocument();
  });

  it('วันที่ลงบัญชีนอกเดือนปัจจุบัน → ปุ่มปิด', async () => {
    routeApi();
    renderOverlay();
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    fireEvent.change(screen.getByLabelText(/วันที่ลงบัญชี/), { target: { value: '2020-01-15' } });
    await waitFor(() =>
      expect(confirmButton()).toHaveAttribute(
        'title',
        'วันที่ลงบัญชีต้องอยู่ในเดือนปัจจุบันและไม่เป็นวันในอนาคต',
      ),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/pages/PaymentsPage/components/__tests__/RepossessionOverlay.confirm-mode.test.tsx`
Expected: FAIL — เทสต์แรกล้มที่ `findByText('DR-20260920-0001')` (overlay เดิมไม่เรียก `/device-returns/dr-1` และยังส่ง `conditionGrade`/`collectedByShop` ไป preview)

- [ ] **Step 3: Write minimal implementation**

แทนเนื้อหา `apps/web/src/pages/PaymentsPage/components/RepossessionOverlay.tsx` ทั้งไฟล์ด้วย:

```tsx
import { useMemo, useState } from 'react';
import { WizardStackedOverlay } from '@/components/WizardStackedOverlay';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  PackageX,
  ClipboardCheck,
  Calculator,
  CalendarDays,
  FileText,
  Check,
  X,
  AlertTriangle,
  Lock,
} from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { formatDateShort, formatNumberDecimal } from '@/utils/formatters';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Effect, Row, Section } from '@/components/device-returns/FormSection';
import { RejectDeviceReturnDialog } from '@/components/device-returns/RejectDeviceReturnDialog';
import {
  bkkToday,
  computeDeviationPct,
  formatDeviationLabel,
  DEVICE_RETURN_CONFIRM_ROLES,
  DEVICE_RETURN_KIND_LABEL,
  DEVICE_RETURN_STATUS_LABEL,
  LINE_STATUS_LABEL,
  RETURN_REASON_LABEL,
  TABLE_DEVIATION_LIMIT_PCT,
  type DeviceReturnRow,
  type LineNotifyStatus,
} from '@/components/device-returns/types';

interface Props {
  /** ใบรับเครื่องคืนที่จะยืนยัน — overlay เป็น "โหมดยืนยัน" อย่างเดียวตั้งแต่ 2026-09-20 (POST /repossessions ถูกลบ) */
  deviceReturnId: string;
  contractId: string;
  contractNumber: string;
  customerName: string;
  branchName?: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface RepoPreview {
  contract: {
    contractNumber: string;
    customer: { name: string };
    product: { brand: string; model: string };
    totalMonths: number;
    monthlyPayment: number;
    sellingPrice: number;
    financedAmount: number;
    storeCommission: number;
  };
  calculation: {
    remainingMonths: number;
    totalPaid: number;
    outstandingBalance: number;
    principalExVat: number;
    financeCost: number;
    remainingCost: number;
    grossProfit: number;
    discountPct: number;
    discountAmount: number;
    unpaidLateFees: number;
    rescheduleAdvanceApplied?: number;
    closingAmount: number;
    marketValue: number;
    /** ที่มาของราคาประเมิน — null = ยังคำนวณไม่ได้ */
    marketValueSource: 'MARKET' | 'APPRAISAL' | null;
    customerRefundEnabled?: boolean;
    customerRefund?: number;
    profitLoss: number;
  };
  /** ยืนยันได้ไหม ณ ตอนนี้ (สถานะสัญญา + strict mode + ยอดค้าง) — กติกาเดียวกับ createInTx */
  eligibility?: { canRepossess: boolean; reason: string | null } | null;
  /** Dry-run JP5 JE — same buildJe as the posting path (null เมื่อ preview ล้มเหลว/ไม่มีงวดค้าง) */
  journalPreview?: {
    lines: {
      accountCode: string;
      accountName: string;
      debit: string;
      credit: string;
      description: string;
    }[];
    totalDebit: string;
    totalCredit: string;
    isBalanced: boolean;
  } | null;
}

const PREVIEW_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'];

const LINE_BADGE: Record<LineNotifyStatus, 'success' | 'destructive' | 'warning'> = {
  SENT: 'success',
  FAILED: 'destructive',
  NO_LINE: 'warning',
};

/**
 * ผลทางบัญชี (ledger P&L) จาก JP5 journalPreview — คำสั่งเจ้าของ 2026-08-08 (ข้อ 1):
 * โชว์คู่กับ "กำไร/ขาดทุนเชิงบริหาร" (calculation.profitLoss ซึ่งมีส่วนลด/ราคาประเมิน)
 * เพราะสองเลขนี้ต่างกันได้โดยตั้งใจ. อ่านตรงจากบรรทัด JE: 41-1102 (Cr) = กำไรจากการยึดสินค้า,
 * 51-1102 (Dr) = ขาดทุนจากยึดเครื่อง.
 */
function computeLedgerPl(journalPreview: RepoPreview['journalPreview']): number {
  if (!journalPreview) return 0;
  let pl = 0;
  for (const line of journalPreview.lines) {
    if (line.accountCode === '41-1102') {
      const cr = parseFloat(line.credit);
      if (cr > 0) pl += cr;
    } else if (line.accountCode === '51-1102') {
      const dr = parseFloat(line.debit);
      if (dr > 0) pl -= dr;
    }
  }
  return pl;
}

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 outline-hidden';

/**
 * ยืนยันใบรับเครื่องคืน (JP5 + ขาคู่ SHOP) — spec 2026-09-20 §5.2, §7. โหมดยืนยันอย่างเดียว:
 * ข้อมูลใบ (เกรด/ราคาประเมิน/เหตุผล/สาขา) อ่านอย่างเดียวจากใบที่สาขาบันทึก; FINANCE แก้ได้เฉพาะ
 * วันที่ลงบัญชี + ส่วนลดยอดปิด. ยืนยัน = `POST /device-returns/:id/confirm` (server เรียก
 * `RepossessionsService.createInTx` — ขา Dr JP5 = 11-2107 stamp DEVICE_RETURN เสมอ).
 * Roles: ยืนยัน/ส่งกลับ = OWNER / FINANCE_MANAGER; preview = OWNER / BM / FM.
 */
export function RepossessionOverlay({
  deviceReturnId,
  contractId,
  contractNumber,
  customerName,
  branchName,
  onClose,
  onSuccess,
}: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canPreview = PREVIEW_ROLES.includes(user?.role ?? '');
  const canConfirm = DEVICE_RETURN_CONFIRM_ROLES.includes(user?.role ?? '');

  const [discountPct, setDiscountPct] = useState('50');
  // วันที่ลงบัญชี (JP5 + ขาคู่ SHOP) — ย้อนหลังได้ภายในเดือนปัจจุบัน (กติกาใบลดหนี้เดิม)
  const [paymentDate, setPaymentDate] = useState(bkkToday);
  const [rejectOpen, setRejectOpen] = useState(false);

  const {
    data: deviceReturn,
    isLoading: drLoading,
    isError: drFailed,
    error: drError,
    refetch: retryDr,
  } = useQuery<DeviceReturnRow>({
    queryKey: ['device-returns', 'detail', deviceReturnId],
    queryFn: async () => (await api.get(`/device-returns/${deviceReturnId}`)).data,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const {
    data: preview,
    isLoading: previewLoading,
    isFetching: previewFetching,
    isError: previewFailed,
    error: previewError,
    refetch: retryPreview,
  } = useQuery<RepoPreview>({
    queryKey: ['repossession-preview', contractId, deviceReturnId, discountPct],
    queryFn: async () => {
      // โหมดยืนยัน: เกรด/ราคาประเมิน/เหตุผลมาจากใบรับเครื่องคืนฝั่ง server —
      // ส่งแค่ deviceReturnId + ส่วนลด (ไม่มี conditionGrade/appraisalPrice/collectedByShop อีก)
      const params = new URLSearchParams({ deviceReturnId });
      if (discountPct) params.set('discountPct', discountPct);
      const { data } = await api.get(`/repossessions/preview/${contractId}?${params.toString()}`);
      return data;
    },
    enabled: canPreview && !!contractId,
    // ยอดค้าง/สถานะเปลี่ยนได้ระหว่างที่ overlay ปิด (ลูกค้าจ่ายผ่าน webhook)
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const ledgerPl = useMemo(() => computeLedgerPl(preview?.journalPreview), [preview]);
  const blockedByEligibility = preview?.eligibility?.canRepossess === false;
  const notPending = !!deviceReturn && deviceReturn.status !== 'PENDING_CONFIRM';
  const tableBase = deviceReturn?.tableBasePrice != null ? Number(deviceReturn.tableBasePrice) : null;
  const deviationPct = deviceReturn
    ? computeDeviationPct(Number(deviceReturn.appraisalPrice), tableBase)
    : null;
  const deviationLabel = formatDeviationLabel(deviationPct);
  const overLimit = deviationPct !== null && Math.abs(deviationPct) > TABLE_DEVIATION_LIMIT_PCT;

  const mutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/device-returns/${deviceReturnId}/confirm`, {
        // Cleared input = '' → omit so the server defaults to today
        paymentDate: paymentDate || undefined,
        discountPct: discountPct ? Number(discountPct) : 50,
      });
      return data;
    },
    onSuccess: () => {
      toast.success(
        'ยืนยันรับเครื่องคืนแล้ว — ลงบัญชี JP5 + ขาคู่ SHOP เรียบร้อย ค่าเครื่องรอหักในรอบจ่าย INTER-CO',
      );
      queryClient.invalidateQueries({ queryKey: ['device-returns'] });
      queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
      queryClient.invalidateQueries({ queryKey: ['repossessions-pl'] });
      queryClient.invalidateQueries({ queryKey: ['interco-pending'] });
      queryClient.invalidateQueries({ queryKey: ['customer-tags'] });
      onSuccess();
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const computeBlockReason = (): string | null => {
    if (!canConfirm) return 'เฉพาะเจ้าของ / ผจก.การเงิน ยืนยันรับเครื่องคืนได้';
    if (drLoading) return 'กำลังโหลดใบรับเครื่องคืน';
    if (drFailed) return 'โหลดใบรับเครื่องคืนไม่สำเร็จ กรุณาลองใหม่';
    if (!deviceReturn) return 'ยังโหลดใบรับเครื่องคืนไม่สำเร็จ';
    if (notPending) return 'ใบนี้ถูกยืนยัน/ส่งกลับ/ยกเลิกไปแล้ว';
    if (blockedByEligibility) return preview?.eligibility?.reason || 'สัญญานี้ยังยึดคืนไม่ได้';
    if (previewLoading || previewFetching) return 'กำลังตรวจสอบยอดและรายการ JP5';
    if (previewFailed) return 'ตรวจสอบข้อมูลไม่สำเร็จ กรุณาลองคำนวณใหม่';
    if (!preview || preview.eligibility?.canRepossess !== true) {
      return 'ยังตรวจสอบสถานะสัญญาไม่สำเร็จ';
    }
    if (
      discountPct !== '' &&
      (!Number.isFinite(Number(discountPct)) || Number(discountPct) < 0 || Number(discountPct) > 100)
    ) {
      return 'ส่วนลดยอดปิดต้องอยู่ระหว่าง 0 ถึง 100%';
    }
    if (
      paymentDate &&
      (paymentDate > bkkToday() || paymentDate.slice(0, 7) !== bkkToday().slice(0, 7))
    ) {
      return 'วันที่ลงบัญชีต้องอยู่ในเดือนปัจจุบันและไม่เป็นวันในอนาคต';
    }
    if (!preview.journalPreview) return 'ยังไม่มีรายการ JP5 ให้ตรวจสอบ กรุณาลองคำนวณใหม่';
    if (!preview.journalPreview.isBalanced) return 'รายการ JP5 ยังไม่สมดุล กรุณาตรวจสอบก่อนยืนยัน';
    if (mutation.isPending) return 'กำลังยืนยันรับเครื่องคืน';
    return null;
  };
  const submitBlockReason = computeBlockReason();
  const canSubmit = submitBlockReason === null;
  const hasReceivableRelief = preview?.journalPreview?.lines.some(
    (line) => ['11-2101', '11-2103', '11-2105'].includes(line.accountCode) && Number(line.credit) > 0,
  );
  const hasVatCreditNote = preview?.journalPreview?.lines.some(
    (line) => line.accountCode === '21-2101' && Number(line.debit) > 0,
  );

  return (
    <WizardStackedOverlay maxWidthClass="max-w-2xl">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm leading-snug text-muted-foreground hover:text-foreground transition-colors"
        >
          ← กลับ
        </button>
        <h2 className="text-lg font-semibold text-foreground leading-snug">
          ยืนยันรับเครื่องคืน (JP5)
        </h2>
        <div className="w-16" />
      </div>

      <div className="p-6 space-y-5">
        {!canConfirm && (
          <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-3">
            <Lock className="size-4 text-warning shrink-0 mt-0.5" />
            <div className="text-xs text-warning leading-snug">
              <strong className="block">การยืนยันทำได้เฉพาะเจ้าของ / ผจก.การเงิน</strong>
              {canPreview
                ? 'ดูตัวอย่างกำไร/ขาดทุนและรายการ JP5 ได้ แต่กดยืนยันไม่ได้'
                : 'บทบาทนี้ดูตัวอย่าง P&L และยืนยันไม่ได้'}
            </div>
          </div>
        )}

        {/* Section 1: ข้อมูลสัญญา */}
        <Section
          icon={<PackageX className="size-4" />}
          title="ข้อมูลสัญญา"
          subtitle="เลขที่, ลูกค้า, สินค้า"
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">สัญญา: </span>
              <span className="font-mono font-semibold">{contractNumber}</span>
            </div>
            <div>
              <span className="text-muted-foreground">ลูกค้า: </span>
              <span className="font-medium">{customerName}</span>
            </div>
            {preview?.contract.product && (
              <div>
                <span className="text-muted-foreground">สินค้า: </span>
                <span className="font-medium">
                  {preview.contract.product.brand} {preview.contract.product.model}
                </span>
              </div>
            )}
            {branchName && (
              <div>
                <span className="text-muted-foreground">สาขาที่รับ: </span>
                <span className="font-medium">{branchName}</span>
              </div>
            )}
          </div>
        </Section>

        {/* Section 2: ใบรับเครื่องคืน — อ่านอย่างเดียว (สาขาบันทึก) */}
        <Section
          icon={<ClipboardCheck className="size-4" />}
          title="ใบรับเครื่องคืน"
          subtitle="ข้อมูลจากสาขา — อ่านอย่างเดียว (แก้ = ส่งกลับให้สาขาบันทึกใหม่)"
        >
          {drLoading ? (
            <p className="text-sm text-muted-foreground leading-snug">กำลังโหลด...</p>
          ) : drFailed ? (
            <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
              <p>โหลดใบรับเครื่องคืนไม่สำเร็จ: {getErrorMessage(drError)}</p>
              <button type="button" onClick={() => retryDr()} className="mt-2 underline">
                ลองใหม่
              </button>
            </div>
          ) : deviceReturn ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">เลขที่ใบ: </span>
                <span className="font-mono font-semibold">{deviceReturn.docNumber}</span>
              </div>
              <div>
                <span className="text-muted-foreground">ประเภท: </span>
                <Badge
                  variant={deviceReturn.returnKind === 'REPOSSESSION' ? 'destructive' : 'warning'}
                  appearance="light"
                  size="sm"
                >
                  {DEVICE_RETURN_KIND_LABEL[deviceReturn.returnKind]}
                </Badge>
              </div>
              <div>
                <span className="text-muted-foreground">วันที่รับเครื่อง: </span>
                <span className="font-medium">{formatDateShort(deviceReturn.deviceReceivedAt)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">สาขาที่รับ: </span>
                <span className="font-medium">{deviceReturn.receivingBranch.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">ผู้ตรวจ/ตีราคา: </span>
                <span className="font-medium">{deviceReturn.receivedBy.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">เหตุผล: </span>
                <span className="font-medium">{RETURN_REASON_LABEL[deviceReturn.returnReason]}</span>
              </div>
              <div>
                <span className="text-muted-foreground">เกรดสภาพ: </span>
                <span className="font-semibold">{deviceReturn.conditionGrade}</span>
              </div>
              <div>
                <span className="text-muted-foreground">ราคาประเมิน: </span>
                <span className="font-mono font-semibold" data-testid="dr-appraisal">
                  {formatNumberDecimal(deviceReturn.appraisalPrice, 2)} ฿
                </span>
                <span
                  className={`block text-[11px] leading-snug ${
                    tableBase === null ? 'text-warning' : 'text-muted-foreground'
                  }`}
                >
                  {tableBase === null
                    ? 'ไม่มีรุ่นนี้ในตารางรับซื้อ — สาขาตีราคาเอง'
                    : `ตารางรับซื้อ ${formatNumberDecimal(tableBase, 2)} ฿` +
                      (deviationLabel ? ` · ต่างจากตาราง ${deviationLabel}` : '') +
                      (overLimit ? ' (เกิน 15% — สาขาระบุเหตุผลในหมายเหตุแล้ว)' : '')}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">ค่าซ่อม: </span>
                <span className="font-mono">{formatNumberDecimal(deviceReturn.repairCost, 2)} ฿</span>
              </div>
              <div>
                <span className="text-muted-foreground">ไลน์แจ้งลูกค้า: </span>
                {deviceReturn.lineNotifyStatus ? (
                  <Badge
                    variant={LINE_BADGE[deviceReturn.lineNotifyStatus]}
                    appearance="light"
                    size="sm"
                  >
                    {LINE_STATUS_LABEL[deviceReturn.lineNotifyStatus]}
                  </Badge>
                ) : (
                  <Badge variant="secondary" appearance="light" size="sm">
                    ยังไม่ส่ง
                  </Badge>
                )}
              </div>
              {deviceReturn.notes && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">หมายเหตุ: </span>
                  <span>{deviceReturn.notes}</span>
                </div>
              )}
            </div>
          ) : null}
          {notPending && deviceReturn && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning leading-snug"
            >
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <span>
                ใบนี้ถูกยืนยัน/ส่งกลับ/ยกเลิกไปแล้ว (
                {DEVICE_RETURN_STATUS_LABEL[deviceReturn.status]})
              </span>
            </div>
          )}
        </Section>

        {/* ยึดไม่ได้ (ยอดค้าง 0 / สถานะ / เครื่องเคยยึด) — บอกตั้งแต่เปิด ไม่รอชน 400 */}
        {blockedByEligibility && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning leading-snug"
          >
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <span>{preview?.eligibility?.reason}</span>
          </div>
        )}

        {/* Section 3: คำนวณกำไร/ขาดทุน — ส่วนลดยอดปิด (ตัวเลขบนจอ ไม่ลง JE) */}
        <Section
          icon={<Calculator className="size-4" />}
          title="คำนวณกำไร/ขาดทุน (FINANCE)"
          subtitle="ส่วนลดยอดปิด — ราคาประเมิน − ยอดปิดสัญญา"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="repo-discount-pct"
                  className="block text-xs font-medium text-foreground mb-1.5 leading-snug"
                >
                  ส่วนลดยอดปิด (%)
                </label>
                <input
                  id="repo-discount-pct"
                  type="number"
                  min={0}
                  max={100}
                  value={discountPct}
                  onChange={(e) => setDiscountPct(e.target.value)}
                  className={`${inputClass} text-right font-mono`}
                  placeholder="50"
                />
              </div>
            </div>
            {!canPreview ? (
              <div className="py-6 text-center text-sm leading-snug text-muted-foreground">
                ดูตัวอย่าง P&L ได้เฉพาะ OWNER / ผจก.สาขา / ผจก.การเงิน
              </div>
            ) : previewFailed ? (
              <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
                <p>คำนวณตัวอย่างไม่สำเร็จ: {getErrorMessage(previewError)}</p>
                <button type="button" onClick={() => retryPreview()} className="mt-2 underline">
                  ลองคำนวณใหม่
                </button>
              </div>
            ) : previewLoading || !preview ? (
              <div className="py-6 text-center text-sm leading-snug text-muted-foreground">
                กำลังคำนวณ...
              </div>
            ) : (
              <div className="rounded-xl bg-muted/60 p-4 space-y-2">
                <Row
                  label="ยอดค้าง (รวม VAT)"
                  value={`${preview.calculation.outstandingBalance.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`}
                />
                <Row
                  label="ค่างวดไม่รวม VAT (÷ 1.07)"
                  value={`${preview.calculation.principalExVat.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`}
                />
                <Row
                  label="ต้นทุนยอดค้างชำระ (ยอดจัด + คอม)"
                  value={`${preview.calculation.remainingCost.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`}
                />
                <div className="border-t border-border pt-2">
                  <Row
                    label={`ส่วนลดลูกค้า (${preview.calculation.discountPct}%)`}
                    value={`- ${preview.calculation.discountAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`}
                    destructive
                  />
                </div>
                {preview.calculation.unpaidLateFees > 0 && (
                  <Row
                    label="ค่าปรับค้างชำระ"
                    value={`+ ${preview.calculation.unpaidLateFees.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`}
                    destructive
                  />
                )}
                {(preview.calculation.rescheduleAdvanceApplied ?? 0) > 0 && (
                  <Row
                    label="หักเงินรับล่วงหน้าที่พักไว้"
                    value={`- ${formatNumberDecimal(preview.calculation.rescheduleAdvanceApplied!)} ฿`}
                  />
                )}
                <div className="border-t border-border pt-2">
                  <Row
                    label="ยอดปิดสัญญาสุทธิ"
                    value={`${preview.calculation.closingAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`}
                    bold
                  />
                </div>
                <div className="border-t border-border pt-2 space-y-2">
                  <Row
                    label="ราคาประเมิน (หน้าร้านรับเครื่อง)"
                    value={
                      preview.calculation.marketValueSource === null
                        ? '—'
                        : `${preview.calculation.marketValue.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`
                    }
                  />
                </div>
                <div
                  className={`flex justify-between items-center mt-2 p-3 rounded-lg ${
                    preview.calculation.profitLoss >= 0
                      ? 'bg-success/10 ring-1 ring-success/30'
                      : 'bg-destructive/10 ring-1 ring-destructive/30'
                  }`}
                >
                  <div>
                    <div
                      className={`text-xs font-medium leading-snug ${preview.calculation.profitLoss >= 0 ? 'text-success' : 'text-destructive'}`}
                    >
                      {preview.calculation.profitLoss >= 0 ? (
                        <Check className="size-4 inline mr-1" />
                      ) : (
                        <X className="size-4 inline mr-1" />
                      )}
                      ส่วนต่างราคาประเมินเทียบยอดปิด
                    </div>
                    <div className="text-xs text-muted-foreground leading-snug">
                      ราคาประเมิน − ยอดปิดสัญญา
                    </div>
                  </div>
                  <div
                    className={`text-xl font-bold ${preview.calculation.profitLoss >= 0 ? 'text-success' : 'text-destructive'}`}
                  >
                    {preview.calculation.profitLoss >= 0 ? '+' : ''}
                    {preview.calculation.profitLoss.toLocaleString('th-TH', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    ฿
                  </div>
                </div>
                {preview.journalPreview && (
                  <div className="text-xs mt-2 px-3 space-y-2">
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground leading-snug">
                        กำไร/ขาดทุนจากรายการยึดคืน
                      </span>
                      <span className="font-medium text-foreground">
                        {ledgerPl >= 0 ? '+' : ''}
                        {ledgerPl.toLocaleString('th-TH', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        ฿
                      </span>
                    </div>
                    <p className="text-muted-foreground leading-relaxed">
                      อ่านจากบัญชีกำไร/ขาดทุนจากการยึดใน JP5 หลังล้างยอดคงเหลือทางบัญชี
                      ตัวเลขนี้ใช้ฐานบัญชี ส่วนต่างด้านบนใช้ยอดปิดสัญญาหลังส่วนลด
                    </p>
                    {!hasReceivableRelief && (
                      <p className="text-warning leading-relaxed">
                        JP5 ชุดนี้ไม่มีบรรทัดตัดลูกหนี้ ยอดจึงรวมมูลค่ารับคืนและเงินล่วงหน้าที่ล้างออก
                        ควรตรวจประวัติบัญชีของสัญญาประกอบ
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </Section>

        {/* Section 4: วันที่ลงบัญชี — แทนส่วน "รับชำระ" เดิม (ไม่มีขาเงินสดวันยึดอีกต่อไป) */}
        <Section
          icon={<CalendarDays className="size-4" />}
          title="วันที่ลงบัญชี"
          subtitle="JP5 + ขาคู่ SHOP ลงวันที่นี้ — ค่าเครื่องตั้งเป็นลูกหนี้-หน้าร้าน 11-2107 ไม่มีขาเงินสด"
          tone="warning"
        >
          <label
            htmlFor="repo-payment-date"
            className="block text-xs font-medium text-foreground mb-1.5"
          >
            วันที่ลงบัญชี{' '}
            <span className="text-muted-foreground font-normal">(ย้อนหลังได้ถ้างวดบัญชียังเปิด)</span>
          </label>
          <input
            id="repo-payment-date"
            type="date"
            value={paymentDate}
            max={bkkToday()}
            onChange={(e) => setPaymentDate(e.target.value)}
            className={`${inputClass} font-mono`}
          />
          <p className="text-xs text-muted-foreground leading-snug mt-1">
            ย้อนหลังได้ภายในเดือนนี้เท่านั้น — ใบที่ข้ามเดือนจะได้ JE/ใบลดหนี้ของเดือนที่ยืนยัน
          </p>
        </Section>

        {/* Section 5: JOURNAL AUTO — JP5 JE preview (dry-run บรรทัดเดียวกับตอน post) */}
        {canPreview && preview?.journalPreview && (
          <Section
            icon={<FileText className="size-4" />}
            title="รายการบัญชีคืนเครื่อง (JP5)"
            subtitle={
              hasVatCreditNote
                ? 'ยึดเครื่องและกลับรายการ VAT พร้อมออกใบลดหนี้'
                : 'รายการที่จะลงบัญชีเมื่อยืนยันรับเครื่องคืน'
            }
          >
            <div className="space-y-1">
              <div className="grid grid-cols-[80px_1fr_90px_90px] gap-1 text-xs text-muted-foreground font-medium pb-1 border-b border-border">
                <span>รหัส</span>
                <span>บัญชี</span>
                <span className="text-right">Dr</span>
                <span className="text-right">Cr</span>
              </div>
              {preview.journalPreview.lines.map((line, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[80px_1fr_90px_90px] gap-1 text-xs leading-snug"
                >
                  <span className="font-mono text-muted-foreground">{line.accountCode}</span>
                  <div className="min-w-0">
                    <span className="text-foreground truncate block">{line.accountName}</span>
                    <span className="text-muted-foreground/70 text-[10px]">{line.description}</span>
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
            <div
              className={`flex items-center justify-between mt-3 pt-2 border-t text-xs font-medium ${
                preview.journalPreview.isBalanced
                  ? 'border-success/30 text-success'
                  : 'border-destructive/30 text-destructive'
              }`}
            >
              <span>Dr รวม = Cr รวม</span>
              <span className="font-mono">
                {formatNumberDecimal(preview.journalPreview.totalDebit)} ={' '}
                {formatNumberDecimal(preview.journalPreview.totalCredit)}{' '}
                {preview.journalPreview.isBalanced ? 'BALANCED' : 'UNBALANCED'}
              </span>
            </div>
          </Section>
        )}
        {canPreview &&
          !previewLoading &&
          !previewFetching &&
          !previewFailed &&
          preview &&
          !preview.journalPreview && (
            <Section
              icon={<FileText className="size-4" />}
              title="รายการบัญชีคืนเครื่อง (JP5)"
              subtitle="ยังไม่มีรายการให้ตรวจสอบ"
            >
              <p className="text-sm text-warning">
                ไม่สามารถเตรียมรายการ JP5 ได้ กรุณาตรวจสอบข้อมูลบัญชีของสัญญาแล้วลองอีกครั้ง
              </p>
              <button type="button" onClick={() => retryPreview()} className="mt-2 text-sm underline">
                ลองคำนวณใหม่
              </button>
            </Section>
          )}

        {/* Section 6: สิ่งที่จะเกิดขึ้น */}
        <Section
          icon={<Check className="size-4" />}
          title="สิ่งที่จะเกิดขึ้นเมื่อยืนยัน"
          subtitle="ตรวจสอบก่อนยืนยัน"
          tone="success"
        >
          <ul className="space-y-1.5 text-sm">
            <Effect
              text={
                hasVatCreditNote
                  ? 'ปิดลูกหนี้คงค้างและออกใบลดหนี้ VAT — บันทึก JP5'
                  : 'ปิดรายการคงค้างของสัญญาตามรายการบัญชี JP5 ด้านบน'
              }
            />
            <Effect text="ตั้งลูกหนี้-หน้าร้าน 11-2107 (ค่าเครื่องคืน) — หักจากยอดโอนในรอบจ่าย INTER-CO ถัดไป หรือรับเงินสดที่หน้าจ่ายให้หน้าร้าน" />
            <Effect text="ขาคู่ SHOP: รับเครื่องเข้าสต็อกมือสอง S11-2002 คู่เจ้าหนี้ FINANCE S21-1104 ที่ราคาประเมิน" />
            <Effect text="บันทึกกำไร/ขาดทุนจากการยึด (41-1102 / 51-1102)" />
            <Effect text="เปลี่ยนสถานะสัญญาเป็น ปิด-หนี้สูญ + สินค้าเป็น ยึดคืน (ย้ายไปสาขาที่รับ)" />
            <Effect text="ใบรับเครื่องคืน → ยืนยันแล้ว + บันทึกการเดินทางลูกค้า 'คืนเครื่อง'" />
            <Effect text="จัดการซ่อม/ตั้งราคาขายต่อ ทำต่อที่หน้า รับเครื่องคืน / ยึดคืน & ขายต่อ" warning />
            <Effect text="ปลดล็อค MDM (PJ-Soft) — ต้องทำ manual" warning />
          </ul>
        </Section>
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 space-y-3">
        {submitBlockReason && (
          <div id="repo-submit-block" role="status" className="text-sm text-warning leading-snug">
            <p>{submitBlockReason}</p>
            {blockedByEligibility && (
              <a href={`/contracts/${contractId}`} className="inline-block mt-1 underline">
                เปิดสัญญาเพื่อตรวจสถานะและยอดค้าง
              </a>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          {canConfirm && deviceReturn && !notPending ? (
            <button
              type="button"
              onClick={() => setRejectOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm border border-destructive/40 text-destructive rounded-lg hover:bg-destructive/10 transition-colors"
            >
              <X className="size-4" />
              ส่งกลับ
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2.5 text-sm leading-snug border border-input rounded-lg hover:bg-muted transition-colors"
            >
              ยกเลิก
            </button>
            <button
              onClick={() => mutation.mutate()}
              disabled={!canSubmit}
              title={submitBlockReason ?? undefined}
              aria-describedby={submitBlockReason ? 'repo-submit-block' : undefined}
              className="px-6 py-2.5 text-sm leading-snug bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm"
            >
              {mutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันรับเครื่องคืน'}
            </button>
          </div>
        </div>
      </div>

      {/* ส่งกลับ — Radix Dialog portal ไป body พร้อม FocusScope ของตัวเอง (ซ้อนบน overlay ได้ตาม scope stack) */}
      <RejectDeviceReturnDialog
        target={rejectOpen && deviceReturn ? deviceReturn : null}
        onClose={() => setRejectOpen(false)}
        onRejected={() => {
          onSuccess();
          onClose();
        }}
      />
    </WizardStackedOverlay>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/pages/PaymentsPage/components/__tests__/RepossessionOverlay.confirm-mode.test.tsx`
Expected: PASS (10 tests)

- [ ] **Step 5: Checkpoint**

Run `./tools/check-types.sh web` — Expected: **มี error ชั่วคราว** ที่ `RepossessionsPage.tsx` (mount overlay โดยไม่มี `deviceReturnId`) และ `RecordPaymentWizard.tsx` (เหมือนกัน) — สองไฟล์นี้แก้ใน Task 6 และ Task 7; error อื่นนอกจากสองไฟล์นี้ต้องเป็น 0. **Do NOT commit** (see Global Constraints).

---

### Task 6: `RepossessionsPage` — ส่วนใบรับเครื่องคืน + รายการรอยึดใช้ endpoint ใหม่ + overlay โหมดยืนยัน

**Files:**
- Modify: `apps/web/src/pages/RepossessionsPage.tsx:14-19` (imports), `:21-33` (interface + REPO_OPEN_ROLES), `:48-49` (Repossession interface), `:86-93` (state), `:148-171` (awaiting query), `:378-394` (status column), `:493-496` (PageHeader), `:498` (แทรก DeviceReturnList ก่อน comment), `:559-567` (ปุ่มในรายการรอยึด), `:687-699` (overlay mount)
- Modify test: `apps/web/src/pages/RepossessionsPage.awaiting-repossession.test.tsx` (แทนทั้งไฟล์)
- Modify test: `apps/web/src/pages/RepossessionsPage.settlement-button.test.tsx:32-56` (fixture), `:58-67` (routeApi)
- Modify test: `apps/web/src/pages/RepossessionsPage.journal-button.test.tsx:57-80` (fixture), `:82-93` (routeApi)

**Interfaces:**
- Consumes: `DeviceReturnList` (Task 4), `DeviceReturnIntakeDialog` (Task 3), `RepossessionOverlay` โหมดยืนยัน (Task 5), `GET /device-returns/awaiting-repossession?limit=100`, `GET /repossessions` rows + `deviceReturnOutstanding`
- Produces: หน้า `/repossessions` = ทางเข้าเดียวของใบรับเครื่องคืน (ปุ่มหัวหน้า + ปุ่มในรายการรอยึด) และของ JP5 (ผ่านตาราง "รอ FINANCE ยืนยัน")

ข้อความหัวหน้าต้องคง "เพื่อบันทึกการยึดคืน" และ "รอยึดเครื่อง" ไว้ — Playwright `apps/web/e2e/debt-collection.spec.ts:16,23,57` assert สามคำนี้ (title ยังมีคำว่า "ยึดคืน").

- [ ] **Step 1: Write the failing test**

แทนเนื้อหา `apps/web/src/pages/RepossessionsPage.awaiting-repossession.test.tsx` ทั้งไฟล์ด้วย:

```tsx
/**
 * หน้า /repossessions หลังใบรับเครื่องคืน (spec 2026-09-20 §7):
 *   - รายการ "รอยึดเครื่อง" มาจาก GET /device-returns/awaiting-repossession (TERMINATED ที่ยังไม่มีใบค้าง/แถวยึด)
 *     ปุ่มต่อแถวคือ "รับเครื่องคืน" → เปิด DeviceReturnIntakeDialog ล็อกสัญญานั้น
 *   - ปุ่มหัวหน้า "บันทึกรับเครื่องคืน" → เปิด dialog แบบค้นสัญญาเอง (OWNER/BM เท่านั้น)
 *   - ตาราง "ใบรับเครื่องคืน — รอ FINANCE ยืนยัน" ปุ่ม ยืนยัน → RepossessionOverlay โหมดยืนยัน (deviceReturnId)
 */
import type { ReactNode } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

type TestUser = { id: string; name: string; role: string; branchId: string | null };
let currentUser: TestUser = { id: 'u-owner', name: 'เจ้าของ', role: 'OWNER', branchId: null };
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: currentUser, isLoading: false }),
}));

// overlay/dialog ตัวจริงมีเทสต์ของตัวเอง — ที่นี่ดูแค่ว่าหน้าส่ง prop ที่ถูกต้องให้
vi.mock('@/pages/PaymentsPage/components/RepossessionOverlay', () => ({
  RepossessionOverlay: (p: { deviceReturnId: string; contractNumber: string; customerName: string }) => (
    <div data-testid="repo-overlay">
      overlay:{p.deviceReturnId}:{p.contractNumber}:{p.customerName}
    </div>
  ),
}));
vi.mock('@/components/device-returns/DeviceReturnIntakeDialog', () => ({
  DeviceReturnIntakeDialog: (p: { open: boolean; initialContractId?: string }) =>
    p.open ? <div data-testid="intake-dialog">intake:{p.initialContractId ?? 'search'}</div> : null,
}));
vi.mock('@/components/contract/ContractJournalDialog', () => ({ default: () => null }));

import RepossessionsPage from './RepossessionsPage';

const terminatedContract = {
  id: 'c-term-1',
  contractNumber: 'TEST-20260827-021',
  status: 'TERMINATED',
  monthlyPayment: '5371.00',
  customer: { id: 'cu1', name: 'ทดสอบ ยึดเครื่อง (บอกเลิกแล้ว) 21', phone: '0800000000' },
  product: { id: 'p1', name: 'iPhone 15', brand: 'Apple', model: '15' },
  branch: { id: 'b1', name: 'ลาดพร้าว' },
};

const pendingReturn = {
  id: 'dr-1',
  docNumber: 'DR-20260919-0001',
  status: 'PENDING_CONFIRM',
  returnKind: 'VOLUNTARY',
  returnReason: 'UNAFFORDABLE',
  deviceReceivedAt: '2026-09-19T03:00:00.000Z',
  conditionGrade: 'B',
  appraisalPrice: '7000.00',
  tableBasePrice: '6500.00',
  repairCost: '0.00',
  notes: null,
  lineNotifyStatus: 'SENT',
  lineNotifiedAt: '2026-09-19T03:01:00.000Z',
  receivingBranch: { id: 'b1', name: 'ลาดพร้าว' },
  receivedBy: { id: 'u-bm', name: 'ผจก.ลาดพร้าว' },
  contract: {
    id: 'c-ret-1',
    contractNumber: 'TEST-20260919-001',
    status: 'TERMINATED',
    customer: { id: 'cu9', name: 'สมชาย ใจดี' },
    product: { id: 'p9', brand: 'Apple', model: 'iPhone 14', imeiSerial: null },
  },
  confirmedAt: null,
  confirmedBy: null,
  repossessionId: null,
  rejectReason: null,
  createdAt: '2026-09-19T03:00:00.000Z',
};

function routeApi(awaiting: unknown[], pending: unknown[] = []) {
  apiGet.mockImplementation((url: string) => {
    if (url.startsWith('/device-returns/awaiting-repossession')) {
      return Promise.resolve({ data: { data: awaiting, total: awaiting.length } });
    }
    if (url.startsWith('/device-returns?')) {
      return Promise.resolve({ data: { data: pending, total: pending.length, page: 1, limit: 100 } });
    }
    if (url.startsWith('/repossessions/profit-loss')) {
      return Promise.resolve({ data: {} });
    }
    if (url.startsWith('/repossessions')) {
      return Promise.resolve({ data: { data: [], total: 0 } });
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

beforeEach(() => {
  currentUser = { id: 'u-owner', name: 'เจ้าของ', role: 'OWNER', branchId: null };
  apiGet.mockReset();
});

describe('RepossessionsPage — รอยึดเครื่อง (GET /device-returns/awaiting-repossession)', () => {
  it('lists awaiting contracts from the device-returns endpoint with a รับเครื่องคืน button', async () => {
    routeApi([terminatedContract]);
    render(<RepossessionsPage />, { wrapper });

    expect(await screen.findByText('TEST-20260827-021')).toBeInTheDocument();
    expect(screen.getByText(/ทดสอบ ยึดเครื่อง \(บอกเลิกแล้ว\) 21/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'รับเครื่องคืน' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^ยึดเครื่อง$/ })).not.toBeInTheDocument();
    expect(
      apiGet.mock.calls.some(([url]) =>
        String(url).startsWith('/device-returns/awaiting-repossession?limit=100'),
      ),
    ).toBe(true);
    expect(apiGet.mock.calls.some(([url]) => String(url).startsWith('/contracts?'))).toBe(false);
  });

  it('รับเครื่องคืน on a row opens the intake dialog locked to that contract', async () => {
    routeApi([terminatedContract]);
    render(<RepossessionsPage />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: 'รับเครื่องคืน' }));

    expect(screen.getByTestId('intake-dialog')).toHaveTextContent('intake:c-term-1');
  });

  it('header button บันทึกรับเครื่องคืน opens the intake dialog in search mode (OWNER)', async () => {
    routeApi([]);
    render(<RepossessionsPage />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: 'บันทึกรับเครื่องคืน' }));

    expect(screen.getByTestId('intake-dialog')).toHaveTextContent('intake:search');
  });

  it('FINANCE_MANAGER sees neither the header button nor the row button (POST /device-returns roles)', async () => {
    currentUser = { id: 'u-fm', name: 'ผจก.การเงิน', role: 'FINANCE_MANAGER', branchId: null };
    routeApi([terminatedContract]);
    render(<RepossessionsPage />, { wrapper });

    await screen.findByText('TEST-20260827-021');
    expect(screen.queryByRole('button', { name: 'บันทึกรับเครื่องคืน' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'รับเครื่องคืน' })).not.toBeInTheDocument();
  });

  it('no longer points staff at the payments page to repossess', async () => {
    routeApi([]);
    render(<RepossessionsPage />, { wrapper });

    expect(await screen.findByText(/ไม่มีสัญญาที่บอกเลิกแล้วรอยึดเครื่อง/)).toBeInTheDocument();
    expect(screen.queryByText(/ไปหน้ารับชำระ/)).not.toBeInTheDocument();
  });
});

describe('RepossessionsPage — ใบรับเครื่องคืน รอ FINANCE ยืนยัน', () => {
  it('ยืนยัน on a pending device return opens the overlay in confirm mode with deviceReturnId', async () => {
    routeApi([], [pendingReturn]);
    render(<RepossessionsPage />, { wrapper });

    const row = await screen.findByTestId('device-return-row-DR-20260919-0001');
    fireEvent.click(within(row).getByRole('button', { name: 'ยืนยัน' }));

    expect(screen.getByTestId('repo-overlay')).toHaveTextContent(
      'overlay:dr-1:TEST-20260919-001:สมชาย ใจดี',
    );
  });
});
```

แก้ `apps/web/src/pages/RepossessionsPage.settlement-button.test.tsx`:

บรรทัด 43 (ใน fixture `repo`) — เดิม:
```ts
  shopCollectOutstanding: '0.00',
```
ใหม่:
```ts
  shopCollectOutstanding: '0.00',
  deviceReturnOutstanding: '0.00',
```

บรรทัด 58-67 `routeApi` — เดิม:
```ts
function routeApi(rows: unknown[]) {
  apiGet.mockImplementation((url: string) => {
    if (url.startsWith('/contracts?status=TERMINATED'))
      return Promise.resolve({ data: { data: [], total: 0 } });
    if (url.startsWith('/repossessions/profit-loss')) return Promise.resolve({ data: {} });
    if (url.startsWith('/repossessions'))
      return Promise.resolve({ data: { data: rows, total: rows.length } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}
```
ใหม่:
```ts
function routeApi(rows: unknown[]) {
  apiGet.mockImplementation((url: string) => {
    if (url.startsWith('/device-returns/awaiting-repossession'))
      return Promise.resolve({ data: { data: [], total: 0 } });
    if (url.startsWith('/device-returns?'))
      return Promise.resolve({ data: { data: [], total: 0, page: 1, limit: 100 } });
    if (url.startsWith('/repossessions/profit-loss')) return Promise.resolve({ data: {} });
    if (url.startsWith('/repossessions'))
      return Promise.resolve({ data: { data: rows, total: rows.length } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}
```

เพิ่มเทสต์ท้าย `describe('RepossessionsPage — รับโอนหน้าร้าน / ขายแล้ว', ...)` ก่อน `});` ปิด describe:
```ts
  it('shows the "รอหักในรอบจ่าย" badge when 11-2107 DEVICE_RETURN is still outstanding', async () => {
    routeApi([repo({ deviceReturnOutstanding: '7000.00' })]);
    render(<RepossessionsPage />, { wrapper });
    await screen.findByText('TEST-20260905-010');
    expect(screen.getByText(/รอหักในรอบจ่าย 7,000 ฿/)).toBeInTheDocument();
    // ปุ่มรับโอนหน้าร้านยังผูกกับ SHOP_COLLECT เดิมเท่านั้น
    expect(screen.queryByRole('button', { name: 'รับโอนหน้าร้าน' })).not.toBeInTheDocument();
  });
```

แก้ `apps/web/src/pages/RepossessionsPage.journal-button.test.tsx`:

บรรทัด 68 (fixture `repossession`) — เดิม:
```ts
  shopCollectOutstanding: '0.00',
```
ใหม่:
```ts
  shopCollectOutstanding: '0.00',
  deviceReturnOutstanding: '0.00',
```

บรรทัด 82-93 `routeApi` — เดิม:
```ts
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
```
ใหม่:
```ts
function routeApi() {
  apiGet.mockImplementation((url: string) => {
    if (url.startsWith('/device-returns/awaiting-repossession')) {
      return Promise.resolve({ data: { data: [terminatedContract], total: 1 } });
    }
    if (url.startsWith('/device-returns?')) {
      return Promise.resolve({ data: { data: [], total: 0, page: 1, limit: 100 } });
    }
    if (url.startsWith('/repossessions/profit-loss')) return Promise.resolve({ data: {} });
    if (url.startsWith('/repossessions')) {
      return Promise.resolve({ data: { data: [repossession], total: 1 } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/pages/RepossessionsPage.awaiting-repossession.test.tsx src/pages/RepossessionsPage.settlement-button.test.tsx src/pages/RepossessionsPage.journal-button.test.tsx`
Expected: FAIL — หน้าเดิมยิง `/contracts?status=TERMINATED` (route mock ปฏิเสธ → `unexpected GET`), ไม่มีปุ่ม "รับเครื่องคืน"/"บันทึกรับเครื่องคืน", และ type error ชั่วคราวจาก Task 5 ยังอยู่

- [ ] **Step 3: Write minimal implementation**

แก้ `apps/web/src/pages/RepossessionsPage.tsx` ทีละจุด (ตัวเลขบรรทัด origin/main):

(a) บรรทัด 14-19 imports — เดิม:
```tsx
import { Camera, Download, Send } from 'lucide-react';
import { Link } from 'react-router';
import { CashAccountSelect, CASH_ACCOUNT_CODES, KBANK_ONLY_CODES } from '@/components/CashAccountSelect';
import { useAuth } from '@/contexts/AuthContext';
import { RepossessionOverlay } from '@/pages/PaymentsPage/components/RepossessionOverlay';
import ContractJournalDialog from '@/components/contract/ContractJournalDialog';
```
ใหม่:
```tsx
import { Camera, Download, Send } from 'lucide-react';
import { Link } from 'react-router';
import { CashAccountSelect, CASH_ACCOUNT_CODES, KBANK_ONLY_CODES } from '@/components/CashAccountSelect';
import { useAuth } from '@/contexts/AuthContext';
import { RepossessionOverlay } from '@/pages/PaymentsPage/components/RepossessionOverlay';
import ContractJournalDialog from '@/components/contract/ContractJournalDialog';
import { DeviceReturnIntakeDialog } from '@/components/device-returns/DeviceReturnIntakeDialog';
import { DeviceReturnList } from '@/components/device-returns/DeviceReturnList';
import {
  DEVICE_RETURN_CREATE_ROLES,
  type AwaitingRepossessionResponse,
  type AwaitingRepossessionRow,
  type DeviceReturnRow,
} from '@/components/device-returns/types';
```

(b) บรรทัด 21-33 — เดิม:
```tsx
/** สัญญาที่บอกเลิกแล้ว (TERMINATED) — รอยึดเครื่อง. Subset of a GET /contracts list row. */
interface AwaitingRepossessionContract {
  id: string;
  contractNumber: string;
  status: string;
  monthlyPayment: string;
  customer: { id: string; name: string; phone: string };
  product: { id: string; name: string; brand: string; model: string } | null;
  branch: { id: string; name: string } | null;
}

/** Roles that may open the JP5 overlay (preview = OWNER/BM/FM; submit stays OWNER-only inside it). */
const REPO_OPEN_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'];
```
ใหม่:
```tsx
// รอยึดเครื่อง = `AwaitingRepossessionRow` (components/device-returns/types) — TERMINATED ที่ยัง
// ไม่มีใบรับเครื่องคืนค้างยืนยันและไม่มีแถว Repossession (spec 2026-09-20 §5.7). ทางเข้า JP5
// ย้ายไปที่ตาราง "รอ FINANCE ยืนยัน" (DeviceReturnList) — ไม่มี POST /repossessions อีกต่อไป.
```

(c) บรรทัด 48-49 ใน `interface Repossession` — เดิม:
```tsx
  /** ยอด 11-2107 ลูกหนี้-หน้าร้าน (SHOP_COLLECT) ที่ยังค้างของสัญญานี้ — ปุ่ม "รับโอนหน้าร้าน" โชว์เฉพาะ > 0 */
  shopCollectOutstanding: string;
```
ใหม่:
```tsx
  /** ยอด 11-2107 ลูกหนี้-หน้าร้าน (SHOP_COLLECT) ที่ยังค้างของสัญญานี้ — ปุ่ม "รับโอนหน้าร้าน" โชว์เฉพาะ > 0 (แถวยึดยุคก่อนใบรับเครื่องคืน) */
  shopCollectOutstanding: string;
  /** ยอด 11-2107 ประเภท DEVICE_RETURN สุทธิหลังหักรอบจ่าย POSTED — ป้าย "รอหักในรอบจ่าย" เมื่อ > 0 (spec 2026-09-20 §6.1) */
  deviceReturnOutstanding: string;
```

(d) บรรทัด 86-93 — เดิม:
```tsx
  // รอยึดเครื่อง — TERMINATED contract chosen for the JP5 overlay (owner 2026-09-05:
  // these contracts left the รับชำระ queue, so this page is now the only doorway).
  const [repoTarget, setRepoTarget] = useState<AwaitingRepossessionContract | null>(null);
  // "บัญชี" — บันทึกบัญชีของสัญญา (JE ทุกใบ ทั้งสมุด FINANCE/SHOP) ในหน้าเดิม
  const [journalTarget, setJournalTarget] = useState<{ id: string; contractNumber: string } | null>(
    null,
  );
  const canOpenRepo = REPO_OPEN_ROLES.includes(user?.role ?? '');
```
ใหม่:
```tsx
  // ใบรับเครื่องคืน (spec 2026-09-20): สาขาบันทึกใบ → FINANCE ยืนยันใน RepossessionOverlay
  // โหมดยืนยัน — หน้านี้เป็นทางเข้าเดียวของ JP5 (POST /repossessions ถูกลบ)
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [intakeContractId, setIntakeContractId] = useState<string | undefined>(undefined);
  const [confirmTarget, setConfirmTarget] = useState<DeviceReturnRow | null>(null);
  // POST /device-returns roles — SALES ไม่มี route มาหน้านี้ จึงเหลือ OWNER/BM ในทางปฏิบัติ
  const canCreateReturn = DEVICE_RETURN_CREATE_ROLES.includes(user?.role ?? '');
  // "บัญชี" — บันทึกบัญชีของสัญญา (JE ทุกใบ ทั้งสมุด FINANCE/SHOP) ในหน้าเดิม
  const [journalTarget, setJournalTarget] = useState<{ id: string; contractNumber: string } | null>(
    null,
  );
```

(e) บรรทัด 148-171 awaiting query — เดิม:
```tsx
  // TERMINATED = หนังสือบอกเลิกดิสแพตช์แล้ว แต่ยังไม่ยึดเครื่อง (JP5 flips it to
  // CLOSED_BAD_DEBT). Key starts with 'contracts' so the overlay's own
  // invalidateQueries(['contracts']) refreshes this list after a successful JP5.
  const {
    data: awaitingResult,
    isLoading: loadingAwaiting,
    isError: awaitingError,
    error: awaitingErrorDetail,
    refetch: refetchAwaiting,
  } = useQuery<{ rows: AwaitingRepossessionContract[]; total: number }>({
    queryKey: ['contracts', 'awaiting-repossession'],
    queryFn: async () => {
      // limit=100 = the /contracts SERVICE cap (contract-query.service clamps to 100
      // even though the controller accepts 200). Keep `total` so a longer backlog
      // shows as "แสดง N จาก M" instead of silently truncating (same pattern as the
      // ชำระครบ tab on PaymentsPage). BRANCH_MANAGER is branch-scoped server-side.
      const res = (await api.get('/contracts?status=TERMINATED&limit=100')).data;
      const rows: AwaitingRepossessionContract[] = res?.data ?? [];
      return { rows, total: res?.total ?? rows.length };
    },
  });
  const awaiting = awaitingResult?.rows ?? [];
  const awaitingTotal = awaitingResult?.total ?? 0;
  const awaitingTruncated = awaitingTotal > awaiting.length;
```
ใหม่:
```tsx
  // รอยึดเครื่อง = TERMINATED ที่ยังไม่มีใบรับเครื่องคืนค้างยืนยันและยังไม่มีแถว Repossession
  // (spec 2026-09-20 §5.7). Key ขึ้นต้น 'device-returns' ให้ intake dialog / overlay ยืนยัน /
  // ส่งกลับ / ยกเลิก (invalidate prefix เดียวกัน) refresh รายการนี้ด้วย.
  const {
    data: awaitingResult,
    isLoading: loadingAwaiting,
    isError: awaitingError,
    error: awaitingErrorDetail,
    refetch: refetchAwaiting,
  } = useQuery<{ rows: AwaitingRepossessionRow[]; total: number }>({
    queryKey: ['device-returns', 'awaiting-repossession'],
    queryFn: async () => {
      // limit=100 = cap เดียวกับ /contracts เดิม; เก็บ `total` ให้ backlog ยาวโชว์ "แสดง N จาก M"
      // BRANCH_MANAGER ถูก scope สาขาฝั่ง server
      const res: AwaitingRepossessionResponse = (
        await api.get('/device-returns/awaiting-repossession?limit=100')
      ).data;
      const rows = res?.data ?? [];
      return { rows, total: res?.total ?? rows.length };
    },
  });
  const awaiting = awaitingResult?.rows ?? [];
  const awaitingTotal = awaitingResult?.total ?? 0;
  const awaitingTruncated = awaitingTotal > awaiting.length;
```

(f) บรรทัด 378-394 status column — เดิม:
```tsx
      render: (r: Repossession) => {
        const cfg = getStatusBadgeProps(r.status, repossessionStatusMap);
        const inPhotoQueue = r.status === 'READY_FOR_SALE' && r.product.status === 'PHOTO_PENDING';
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">{cfg.label}</Badge>
            {inPhotoQueue && (
              <Link
                to={`/products/${r.product.id}`}
                title="เครื่องอยู่ในคิวรอถ่ายรูป 6 มุม — ครบแล้วขึ้นขายเอง"
                className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning hover:bg-warning/20 dark:bg-warning/15"
              >
                <Camera className="size-3" /> รอถ่ายรูป {r.product.photoAngles ?? 0}/6
              </Link>
            )}
          </div>
        );
      },
```
ใหม่:
```tsx
      render: (r: Repossession) => {
        const cfg = getStatusBadgeProps(r.status, repossessionStatusMap);
        const inPhotoQueue = r.status === 'READY_FOR_SALE' && r.product.status === 'PHOTO_PENDING';
        const deviceReturnOutstanding = Number(r.deviceReturnOutstanding ?? 0);
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">{cfg.label}</Badge>
            {inPhotoQueue && (
              <Link
                to={`/products/${r.product.id}`}
                title="เครื่องอยู่ในคิวรอถ่ายรูป 6 มุม — ครบแล้วขึ้นขายเอง"
                className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning hover:bg-warning/20 dark:bg-warning/15"
              >
                <Camera className="size-3" /> รอถ่ายรูป {r.product.photoAngles ?? 0}/6
              </Link>
            )}
            {deviceReturnOutstanding > 0 && (
              <Badge
                variant="info"
                appearance="light"
                size="sm"
                title="ค่าเครื่องคืน (11-2107 DEVICE_RETURN) ยังไม่ถูกหัก — หักในรอบจ่าย INTER-CO ถัดไป หรือรับเงินสดที่หน้าจ่ายให้หน้าร้าน"
              >
                รอหักในรอบจ่าย {deviceReturnOutstanding.toLocaleString()} ฿
              </Badge>
            )}
          </div>
        );
      },
```

(g) บรรทัด 493-496 PageHeader — เดิม:
```tsx
      <PageHeader
        title="ยึดคืน & ขายต่อ"
        subtitle="สัญญาที่บอกเลิกแล้วรอยึดเครื่องอยู่ในรายการด้านล่าง — กดปุ่ม ยึดเครื่อง เพื่อบันทึกการยึดคืน (JP5) จากหน้านี้"
      />
```
ใหม่:
```tsx
      <PageHeader
        title="รับเครื่องคืน / ยึดคืน & ขายต่อ"
        subtitle="สาขาบันทึกใบรับเครื่องคืนที่นี่ (ปุ่มด้านขวา หรือปุ่ม รับเครื่องคืน ในรายการรอยึดเครื่อง) เพื่อบันทึกการยึดคืน — FINANCE กดยืนยันจากตารางรอยืนยัน แล้วบัญชี JP5 ลงพร้อมขาคู่ SHOP"
        action={
          canCreateReturn ? (
            <button
              type="button"
              onClick={() => {
                setIntakeContractId(undefined);
                setIntakeOpen(true);
              }}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 shadow-sm"
            >
              บันทึกรับเครื่องคืน
            </button>
          ) : undefined
        }
      />

      {/* ใบรับเครื่องคืน — รอ FINANCE ยืนยัน (spec 2026-09-20 §7): FINANCE ยืนยัน/ส่งกลับ/ส่งซ้ำไลน์, สาขายกเลิกใบตัวเอง */}
      <DeviceReturnList onConfirm={(row) => setConfirmTarget(row)} />
```

(h) บรรทัด 498-499 comment ของ card รอยึด — เดิม:
```tsx
      {/* รอยึดเครื่อง — TERMINATED contracts (owner 2026-09-05: moved here from the
          รับชำระ queue, which now lists only contracts a receipt can be recorded on). */}
```
ใหม่:
```tsx
      {/* รอยึดเครื่อง — TERMINATED ที่ยังไม่มีใบรับเครื่องคืน (owner 2026-09-05: moved here from the
          รับชำระ queue; 2026-09-20: ปุ่มเปิดใบรับเครื่องคืนแทนการยึดตรง). */}
```

(i) บรรทัด 559-567 ปุ่มในแถวรอยึด — เดิม:
```tsx
                          {canOpenRepo && (
                            <button
                              type="button"
                              onClick={() => setRepoTarget(c)}
                              className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                            >
                              ยึดเครื่อง
                            </button>
                          )}
```
ใหม่:
```tsx
                          {canCreateReturn && (
                            <button
                              type="button"
                              onClick={() => {
                                setIntakeContractId(c.id);
                                setIntakeOpen(true);
                              }}
                              className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                            >
                              รับเครื่องคืน
                            </button>
                          )}
```

(j) บรรทัด 687-699 overlay mount — เดิม:
```tsx
      {/* JP5 overlay — the same component the payment wizard's "คืนเครื่อง" tab uses. */}
      {repoTarget && (
        <RepossessionOverlay
          contractId={repoTarget.id}
          contractNumber={repoTarget.contractNumber}
          customerName={repoTarget.customer.name}
          branchName={repoTarget.branch?.name}
          onClose={() => setRepoTarget(null)}
          onSuccess={() =>
            queryClient.invalidateQueries({ queryKey: ['contracts', 'awaiting-repossession'] })
          }
        />
      )}
```
ใหม่:
```tsx
      {/* ยืนยันใบรับเครื่องคืน (JP5 + ขาคู่ SHOP) — RepossessionOverlay โหมดยืนยันอย่างเดียว */}
      {confirmTarget && (
        <RepossessionOverlay
          deviceReturnId={confirmTarget.id}
          contractId={confirmTarget.contract.id}
          contractNumber={confirmTarget.contract.contractNumber}
          customerName={confirmTarget.contract.customer.name}
          branchName={confirmTarget.receivingBranch.name}
          onClose={() => setConfirmTarget(null)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['device-returns'] })}
        />
      )}

      {/* บันทึกรับเครื่องคืน — จากปุ่มหัวหน้า (ค้นสัญญาเอง) หรือจากรายการรอยึด (ล็อกสัญญา) */}
      <DeviceReturnIntakeDialog
        open={intakeOpen}
        initialContractId={intakeContractId}
        onClose={() => {
          setIntakeOpen(false);
          setIntakeContractId(undefined);
        }}
      />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/pages/RepossessionsPage.awaiting-repossession.test.tsx src/pages/RepossessionsPage.settlement-button.test.tsx src/pages/RepossessionsPage.journal-button.test.tsx`
Expected: PASS (6 + 4 + 2 tests)

- [ ] **Step 5: Checkpoint**

Run `./tools/check-types.sh web` — Expected: เหลือ error เฉพาะ `RecordPaymentWizard.tsx` (แก้ใน Task 7); `RepossessionsPage.tsx` ต้อง 0. **Do NOT commit** (see Global Constraints).

---

### Task 7: `RecordPaymentWizard` — ถอดชิป "คืนเครื่อง" + state + import + mount + key handlers

**Files:**
- Modify: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx:55` (import), `:206` (state), `:763-775` (comment + 3 handlers), `:877-883` (chip), `:1559-1571` (mount)
- Test: `apps/web/src/pages/PaymentsPage/components/__tests__/RecordPaymentWizard.no-repo-chip.test.ts`

**Interfaces:**
- Consumes: —
- Produces: วิซาร์ดรับชำระไม่มีทางเข้า JP5 อีก (spec §2 สมมติฐาน "ชิป 'คืนเครื่อง' ในวิซาร์ดรับชำระถูกถอด")

วิซาร์ดเป็นคอมโพเนนต์ 1,575 บรรทัดที่ต้อง mock endpoint หลายสิบตัวจึงจะ render ได้ — เทสต์ของ task นี้จึงตรวจที่ระดับ source (อ่านไฟล์แล้ว assert ว่าไม่มีชิป/state/import) ซึ่งกำหนดผลลัพธ์ได้แน่นอนและตรงกับ spec §10 "RecordPaymentWizard ไม่มีชิป".

- [ ] **Step 1: Write the failing test**

สร้าง `apps/web/src/pages/PaymentsPage/components/__tests__/RecordPaymentWizard.no-repo-chip.test.ts`:

```ts
/**
 * ชิป "คืนเครื่อง" (REPO) ในวิซาร์ดรับชำระถูกถอด (spec 2026-09-20 §2, §7) — ทางเข้า JP5
 * ย้ายไปใบรับเครื่องคืนบนหน้า /repossessions. ตรวจที่ระดับ source: การ render วิซาร์ดทั้งตัว
 * ต้อง mock endpoint หลายสิบตัว ไม่คุ้มสำหรับ assertion "ไม่มี" 3 ข้อ.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../RecordPaymentWizard.tsx', import.meta.url)),
  'utf8',
);

describe('RecordPaymentWizard — ชิป "คืนเครื่อง" ถูกถอด', () => {
  it('ไม่มีชิป REPO / state showRepoOverlay / import RepossessionOverlay ในวิซาร์ดอีกต่อไป', () => {
    expect(source).not.toContain("key: 'REPO'");
    expect(source).not.toContain('showRepoOverlay');
    expect(source).not.toContain('RepossessionOverlay');
  });

  it('ชิปที่เหลือยังครบ: แบ่งชำระ / ล่วงหน้า / ปิดยอด / ปรับดิว', () => {
    for (const key of ["key: 'PARTIAL'", "key: 'OVERPAY_ADVANCE'", "key: 'PAYOFF'", "key: 'RESCHEDULE'"]) {
      expect(source).toContain(key);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/pages/PaymentsPage/components/__tests__/RecordPaymentWizard.no-repo-chip.test.ts`
Expected: FAIL — `expected '...' not to contain "key: 'REPO'"`

- [ ] **Step 3: Write minimal implementation**

แก้ `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx`:

(a) บรรทัด 55 — ลบทั้งบรรทัด:
```tsx
import { RepossessionOverlay } from './RepossessionOverlay';
```

(b) บรรทัด 206 — ลบทั้งบรรทัด:
```tsx
  const [showRepoOverlay, setShowRepoOverlay] = useState(false);
```

(c) บรรทัด 763-775 — เดิม:
```tsx
          // The payoff/reschedule/repossession overlays portal to document.body (outside
          // this Dialog), so clicking them (incl. their ยกเลิก) reads as an "interact
          // outside" and would close the wizard underneath. While an overlay is open,
          // keep the wizard mounted so cancelling the overlay returns to รับชำระ.
          onPointerDownOutside={(e) => {
            if (showPayoffOverlay || showRescheduleOverlay || showRepoOverlay) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (showPayoffOverlay || showRescheduleOverlay || showRepoOverlay) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (showPayoffOverlay || showRescheduleOverlay || showRepoOverlay) e.preventDefault();
          }}
```
ใหม่:
```tsx
          // The payoff/reschedule overlays portal to document.body (outside this Dialog),
          // so clicking them (incl. their ยกเลิก) reads as an "interact outside" and would
          // close the wizard underneath. While an overlay is open, keep the wizard mounted
          // so cancelling the overlay returns to รับชำระ. (ชิป "คืนเครื่อง" ถูกถอด 2026-09-20 —
          // ยึดเครื่องเริ่มที่ใบรับเครื่องคืนบนหน้า /repossessions)
          onPointerDownOutside={(e) => {
            if (showPayoffOverlay || showRescheduleOverlay) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (showPayoffOverlay || showRescheduleOverlay) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (showPayoffOverlay || showRescheduleOverlay) e.preventDefault();
          }}
```

(d) บรรทัด 870-883 — เดิม:
```tsx
                      {
                        key: 'RESCHEDULE',
                        label: 'ปรับดิว',
                        toggle: false,
                        onClick: () => setShowRescheduleOverlay(true),
                        active: false,
                      },
                      {
                        key: 'REPO',
                        label: 'คืนเครื่อง',
                        toggle: false,
                        onClick: () => setShowRepoOverlay(true),
                        active: false,
                      },
                    ].map((t) => (
```
ใหม่:
```tsx
                      {
                        key: 'RESCHEDULE',
                        label: 'ปรับดิว',
                        toggle: false,
                        onClick: () => setShowRescheduleOverlay(true),
                        active: false,
                      },
                    ].map((t) => (
```

(e) บรรทัด 1558-1571 — ลบทั้งบล็อก (รวมบรรทัดว่างก่อนหน้า):
```tsx

      {/* Repossession overlay (คืนเครื่อง) — self-portals; full create (OWNER-only submit). */}
      {showRepoOverlay && (
        <RepossessionOverlay
          contractId={payment.contract.id}
          contractNumber={payment.contract.contractNumber}
          customerName={payment.contract.customer.name}
          branchName={payment.contract.branch.name}
          onClose={() => setShowRepoOverlay(false)}
          onSuccess={() => {
            setShowRepoOverlay(false);
            onClose(); // close wizard after successful repossession
          }}
        />
      )}
```

ตรวจว่าไม่เหลืออ้างอิง:
```bash
cd "D:/BESTCHOICE APP/BESTCHOICE-device-return" && grep -n "Repo\|คืนเครื่อง" apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx || echo "OK: none"
```
Expected: `OK: none`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/pages/PaymentsPage/components/__tests__/RecordPaymentWizard.no-repo-chip.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Checkpoint**

Run `./tools/check-types.sh web` — Expected: **0 errors** (error ชั่วคราวจาก Task 5 หมดแล้ว). **Do NOT commit** (see Global Constraints).

---

### Task 8: `ContractDeviceReturnActions` + ป้าย/ปุ่มบน `ContractDetailPage`

**Files:**
- Create: `apps/web/src/components/device-returns/ContractDeviceReturnActions.tsx`
- Test: `apps/web/src/components/device-returns/__tests__/ContractDeviceReturnActions.test.tsx`
- Modify: `apps/web/src/pages/ContractDetailPage.tsx:23` (import), `:352` (แทรกก่อนปุ่ม ปิดก่อนกำหนด)

**Interfaces:**
- Consumes: `GET /device-returns?contractId=<id>&status=PENDING_CONFIRM&limit=1`, `DeviceReturnIntakeDialog` (Task 3), `DEVICE_RETURN_CREATE_ROLES` / `DEVICE_RETURN_INTAKE_ELIGIBLE_STATUSES` (Task 1)
- Produces: `ContractDeviceReturnActions({ contractId: string; contractStatus: string; role: string })` — คอมโพเนนต์แยกเพื่อให้เทสต์ได้โดยไม่ต้อง render `ContractDetailPage` (1,122 บรรทัด, query หลายสิบตัว)

พฤติกรรม (spec §7 แถว ContractDetailPage): มีใบ `PENDING_CONFIRM` → ป้าย "รับเครื่องคืนแล้ว รอ FINANCE ยืนยัน DR-…" (ไม่มีปุ่ม); ไม่มีใบ + สถานะ ∈ ACTIVE/OVERDUE/DEFAULT/TERMINATED + role ∈ OWNER/BM/SALES → ปุ่ม "รับเครื่องคืน" เปิด intake dialog ล็อกสัญญานี้; สถานะอื่น → ไม่ render และไม่ยิง API. BM/SALES ต่างสาขาจะได้ list ว่าง (server scope) ⇒ ไม่เห็นป้าย — ยอมรับได้ (server เป็นผู้ตัดสินตอน POST).

- [ ] **Step 1: Write the failing test**

สร้าง `apps/web/src/components/device-returns/__tests__/ContractDeviceReturnActions.test.tsx`:

```tsx
/**
 * ป้าย/ปุ่มใบรับเครื่องคืนบนหน้าสัญญา (spec 2026-09-20 §7 แถว ContractDetailPage)
 */
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...a: unknown[]) => apiGet(...a), post: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('../DeviceReturnIntakeDialog', () => ({
  DeviceReturnIntakeDialog: (p: { open: boolean; initialContractId?: string }) =>
    p.open ? <div data-testid="intake-dialog">intake:{p.initialContractId}</div> : null,
}));

import { ContractDeviceReturnActions } from '../ContractDeviceReturnActions';

const pendingRow = {
  id: 'dr-1',
  docNumber: 'DR-20260920-0007',
  status: 'PENDING_CONFIRM',
  contract: { id: 'c-1', contractNumber: 'TEST-1' },
};

function routeApi(pending: unknown[]) {
  apiGet.mockImplementation((url: string) => {
    if (url === '/device-returns?contractId=c-1&status=PENDING_CONFIRM&limit=1') {
      return Promise.resolve({ data: { data: pending, total: pending.length, page: 1, limit: 1 } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => apiGet.mockReset());

describe('ContractDeviceReturnActions', () => {
  it('มีใบ PENDING_CONFIRM → ป้ายพร้อมเลขที่ใบ ไม่มีปุ่ม', async () => {
    routeApi([pendingRow]);
    render(<ContractDeviceReturnActions contractId="c-1" contractStatus="TERMINATED" role="OWNER" />, {
      wrapper,
    });
    expect(
      await screen.findByText(/รับเครื่องคืนแล้ว รอ FINANCE ยืนยัน DR-20260920-0007/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'รับเครื่องคืน' })).not.toBeInTheDocument();
  });

  it.each([
    ['OWNER', 'ACTIVE'],
    ['BRANCH_MANAGER', 'OVERDUE'],
    ['SALES', 'TERMINATED'],
  ])('%s + %s ไม่มีใบ → ปุ่ม รับเครื่องคืน เปิด intake dialog ล็อกสัญญา', async (role, status) => {
    routeApi([]);
    render(<ContractDeviceReturnActions contractId="c-1" contractStatus={status} role={role} />, {
      wrapper,
    });
    const button = await screen.findByRole('button', { name: 'รับเครื่องคืน' });
    fireEvent.click(button);
    expect(screen.getByTestId('intake-dialog')).toHaveTextContent('intake:c-1');
  });

  it('FINANCE_MANAGER / ACCOUNTANT ไม่มีปุ่ม (POST /device-returns roles) แม้สถานะเข้าเกณฑ์', async () => {
    routeApi([]);
    render(
      <ContractDeviceReturnActions contractId="c-1" contractStatus="ACTIVE" role="FINANCE_MANAGER" />,
      { wrapper },
    );
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'รับเครื่องคืน' })).not.toBeInTheDocument();
  });

  it('สถานะที่รับคืนไม่ได้ (COMPLETED) → ไม่ render และไม่ยิง API', () => {
    routeApi([]);
    const { container } = render(
      <ContractDeviceReturnActions contractId="c-1" contractStatus="COMPLETED" role="OWNER" />,
      { wrapper },
    );
    expect(container).toBeEmptyDOMElement();
    expect(apiGet).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/components/device-returns/__tests__/ContractDeviceReturnActions.test.tsx`
Expected: FAIL with `Failed to resolve import "../ContractDeviceReturnActions"`

- [ ] **Step 3: Write minimal implementation**

สร้าง `apps/web/src/components/device-returns/ContractDeviceReturnActions.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PackageX } from 'lucide-react';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { DeviceReturnIntakeDialog } from './DeviceReturnIntakeDialog';
import {
  DEVICE_RETURN_CREATE_ROLES,
  DEVICE_RETURN_INTAKE_ELIGIBLE_STATUSES,
  type DeviceReturnListResponse,
} from './types';

interface Props {
  contractId: string;
  contractStatus: string;
  role: string;
}

/**
 * หน้าสัญญา (spec 2026-09-20 §7): ป้าย "รับเครื่องคืนแล้ว รอ FINANCE ยืนยัน DR-…" เมื่อมีใบ
 * `PENDING_CONFIRM`; ปุ่ม "รับเครื่องคืน" เมื่อสถานะเข้าเกณฑ์และผู้ใช้มีสิทธิ์ (OWNER/BM/SALES).
 * Server เป็นผู้ตัดสินจริง (eligibility ใน preview + ด่านตอน POST) — ที่นี่แค่ซ่อนทางที่ไม่มีวันผ่าน.
 */
export function ContractDeviceReturnActions({ contractId, contractStatus, role }: Props) {
  const [intakeOpen, setIntakeOpen] = useState(false);
  const eligible = DEVICE_RETURN_INTAKE_ELIGIBLE_STATUSES.includes(contractStatus);
  const canCreate = DEVICE_RETURN_CREATE_ROLES.includes(role);

  const { data } = useQuery<DeviceReturnListResponse>({
    queryKey: ['device-returns', 'by-contract', contractId, 'PENDING_CONFIRM'],
    queryFn: async () =>
      (await api.get(`/device-returns?contractId=${contractId}&status=PENDING_CONFIRM&limit=1`))
        .data,
    enabled: eligible,
    staleTime: 15_000,
  });
  const pending = data?.data?.[0] ?? null;

  if (!eligible) return null;

  if (pending) {
    return (
      <Badge
        variant="warning"
        appearance="light"
        size="lg"
        title={`ใบ ${pending.docNumber} รอ FINANCE ยืนยัน — ยืนยันได้ที่หน้า รับเครื่องคืน / ยึดคืน`}
      >
        <PackageX className="size-3.5" />
        รับเครื่องคืนแล้ว รอ FINANCE ยืนยัน {pending.docNumber}
      </Badge>
    );
  }

  if (!canCreate) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setIntakeOpen(true)}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-destructive/10 text-destructive rounded-lg hover:bg-destructive/20 shadow-sm"
      >
        <PackageX className="size-4" />
        รับเครื่องคืน
      </button>
      <DeviceReturnIntakeDialog
        open={intakeOpen}
        onClose={() => setIntakeOpen(false)}
        initialContractId={contractId}
      />
    </>
  );
}
```

แก้ `apps/web/src/pages/ContractDetailPage.tsx`:

บรรทัด 23 — เดิม:
```tsx
import ContractJournalDialog from '@/components/contract/ContractJournalDialog';
```
ใหม่:
```tsx
import ContractJournalDialog from '@/components/contract/ContractJournalDialog';
import { ContractDeviceReturnActions } from '@/components/device-returns/ContractDeviceReturnActions';
```

บรรทัด 352-356 (ปุ่ม ปิดก่อนกำหนด ใน `action` ของ PageHeader) — เดิม:
```tsx
            {canActivate && ['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status) && (
              <button onClick={() => setShowPayoffModal(true)} className="px-4 py-2 text-sm bg-warning text-warning-foreground rounded-lg hover:bg-warning/90 shadow-sm">
                ปิดก่อนกำหนด
              </button>
            )}
```
ใหม่ (แทรกบล็อกใบรับเครื่องคืน **ก่อน** ปุ่มเดิม):
```tsx
            {/* ใบรับเครื่องคืน (spec 2026-09-20 §7) — ป้ายเมื่อมีใบรอยืนยัน / ปุ่มเมื่อสถานะเข้าเกณฑ์ + มีสิทธิ์ */}
            <ContractDeviceReturnActions
              contractId={contract.id}
              contractStatus={contract.status}
              role={user?.role ?? ''}
            />

            {canActivate && ['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status) && (
              <button onClick={() => setShowPayoffModal(true)} className="px-4 py-2 text-sm bg-warning text-warning-foreground rounded-lg hover:bg-warning/90 shadow-sm">
                ปิดก่อนกำหนด
              </button>
            )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/components/device-returns/__tests__/ContractDeviceReturnActions.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Checkpoint**

Run `./tools/check-types.sh web` — Expected: 0 errors. **Do NOT commit** (see Global Constraints).

---

### Task 9: INTER-CO web types + `RecallCashDialog` รับ `kind` (RECALL | DEVICE_RETURN)

**Files:**
- Modify: `apps/web/src/pages/interco/types.ts:36-60` (หลัง `RecallCandidate`, `PendingResponse`), `:233-252` (`BatchItem`)
- Modify: `apps/web/src/pages/interco/RecallCashDialog.tsx` (แทนทั้งไฟล์ — origin/main 161 บรรทัด)
- Test: `apps/web/src/pages/interco/__tests__/RecallCashDialog.test.tsx`

**Interfaces:**
- Consumes: `GET /interco-settlement/pending` → `deviceReturns: DeviceReturnCandidate[]`; `POST /interco-settlement/device-returns/:contractId/settle-cash` (body/response เดียวกับ recall)
- Produces: `DeviceReturnCandidate`, `CashSettleCandidate`, `recallToCashCandidate()`, `deviceReturnToCashCandidate()`, `PendingResponse.deviceReturns`, `BatchItem.itemType` += `'DEVICE_RETURN'`, `BatchItem.deviceReturnAmount`; `RecallCashDialog({ candidate: CashSettleCandidate | null; kind: 'RECALL' | 'DEVICE_RETURN'; onClose })` — Task 10 (PendingTab) เรียก. **prop เดิม `recall: RecallCandidate` เปลี่ยนเป็น `candidate` แบบ normalize** (แถวสองชนิดถือยอดคนละชื่อฟิลด์ — `recallGl` vs `deviceReturnGl`)

- [ ] **Step 1: Write the failing test**

สร้าง `apps/web/src/pages/interco/__tests__/RecallCashDialog.test.tsx`:

```tsx
/**
 * RecallCashDialog รับ `kind` เลือก endpoint (spec 2026-09-20 §6.3 "RecallCashDialog รับ type
 * เพื่อใช้กับค่าเครื่องคืน"): RECALL → /recalls/:id/settle-cash (ป้ายเดิมทุกตัว),
 * DEVICE_RETURN → /device-returns/:id/settle-cash (ป้ายค่าเครื่องคืน). body/requestId เหมือนกัน.
 */
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RecallCashDialog } from '../RecallCashDialog';
import { deviceReturnToCashCandidate, recallToCashCandidate } from '../types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  apiGet.mockReset().mockResolvedValue({
    data: [
      { code: '11-1201', name: 'ธนาคาร KBank' },
      { code: 'S11-1201', name: 'ธนาคาร KBank หน้าร้าน' },
    ],
  });
  apiPost.mockReset().mockResolvedValue({
    data: { financeEntryNo: 'JE-1', shopEntryNo: 'SJE-1', deduped: false },
  });
});

describe('RecallCashDialog — kind', () => {
  it('DEVICE_RETURN: ป้ายค่าเครื่องคืน, ยอด default = deviceReturnGl, POST ไป /device-returns/:id/settle-cash', async () => {
    const candidate = deviceReturnToCashCandidate({
      contractId: 'd1',
      contractNumber: 'CT-0011',
      customerName: 'ลูกค้า D',
      deviceReturnGl: '7000.00',
      shopDeviceReturnGl: '7000.00',
    });
    render(<RecallCashDialog candidate={candidate} kind="DEVICE_RETURN" onClose={() => {}} />, {
      wrapper,
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('รับเงินสดค่าเครื่องคืนจากหน้าร้าน')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/ยอดรับเงินค่าเครื่องคืน/)).toHaveValue(7000);
    fireEvent.click(within(dialog).getByRole('button', { name: 'บันทึกรับเงินค่าเครื่องคืน' }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/interco-settlement/device-returns/d1/settle-cash',
        expect.objectContaining({
          amount: 7000,
          financeDepositAccountCode: '11-1201',
          shopPayoutAccountCode: 'S11-1201',
          requestId: expect.stringMatching(UUID_RE),
        }),
      ),
    );
  });

  it('RECALL: ป้ายเดิม + endpoint เดิม (byte-identical กับก่อน 2026-09-20)', async () => {
    const candidate = recallToCashCandidate({
      contractId: 'r1',
      contractNumber: 'CT-0009',
      customerName: 'ลูกค้า C',
      recallGl: '500.00',
      shopRecallGl: '500.00',
    });
    render(<RecallCashDialog candidate={candidate} kind="RECALL" onClose={() => {}} />, { wrapper });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('รับเงินสดคืนจากหน้าร้าน')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/ยอดรับเงินคืน/)).toHaveValue(500);
    fireEvent.click(within(dialog).getByRole('button', { name: 'บันทึกรับเงินคืน' }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/interco-settlement/recalls/r1/settle-cash',
        expect.objectContaining({ amount: 500 }),
      ),
    );
  });

  it('ยอดเกิน net → ข้อความ + ปุ่มปิด (ทั้งสอง kind ใช้เพดานเดียวกัน)', async () => {
    const candidate = deviceReturnToCashCandidate({
      contractId: 'd1',
      contractNumber: 'CT-0011',
      customerName: 'ลูกค้า D',
      deviceReturnGl: '7000.00',
      shopDeviceReturnGl: '7000.00',
    });
    render(<RecallCashDialog candidate={candidate} kind="DEVICE_RETURN" onClose={() => {}} />, {
      wrapper,
    });
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/ยอดรับเงินค่าเครื่องคืน/), {
      target: { value: '7500' },
    });
    expect(within(dialog).getByText(/เกินค่าเครื่องคืนคงเหลือ/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'บันทึกรับเงินค่าเครื่องคืน' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/pages/interco/__tests__/RecallCashDialog.test.tsx`
Expected: FAIL — `deviceReturnToCashCandidate is not a function` / TS error ที่ prop `candidate`

- [ ] **Step 3: Write minimal implementation**

แก้ `apps/web/src/pages/interco/types.ts`:

(a) หลังบล็อก `RecallCandidate` (บรรทัด 41-47) แทรกก่อน `export interface ReconcileTotals`:
```ts
/**
 * แถวคิวค่าเครื่องคืน (ใบรับเครื่องคืนที่ FINANCE ยืนยันแล้ว — JP5 ตั้ง 11-2107 [DEVICE_RETURN]
 * คู่ S21-1104, spec 2026-09-20 §6.3): เลือกเป็น "แถวหัก" ประเภทที่ 3 เข้ารอบจ่ายได้ (ไม่มีเจ้าหนี้
 * ของตัวเอง เหมือน RECALL). ยอด = net หลังหัก Σ deduction ของ batch POSTED แล้ว.
 */
export interface DeviceReturnCandidate {
  contractId: string;
  contractNumber: string;
  customerName: string;
  /** 11-2107 typed DEVICE_RETURN net */
  deviceReturnGl: string;
  /** S21-1104 typed DEVICE_RETURN net — ต้องเท่ากับ deviceReturnGl ±0.01 จึงหัก/รับเงินสดได้ */
  shopDeviceReturnGl: string;
}

/** แถวที่ RecallCashDialog รับ — normalize จาก RecallCandidate / DeviceReturnCandidate */
export interface CashSettleCandidate {
  contractId: string;
  contractNumber: string;
  /** ยอดสุทธิคงเหลือที่รับเงินสดได้ (เพดานของ dialog) */
  net: string;
}

export function recallToCashCandidate(r: RecallCandidate): CashSettleCandidate {
  return { contractId: r.contractId, contractNumber: r.contractNumber, net: r.recallGl };
}

export function deviceReturnToCashCandidate(d: DeviceReturnCandidate): CashSettleCandidate {
  return { contractId: d.contractId, contractNumber: d.contractNumber, net: d.deviceReturnGl };
}

```

(b) บรรทัด 56-60 `PendingResponse` — เดิม:
```ts
export interface PendingResponse {
  pending: PendingContract[];
  recalls: RecallCandidate[];
  reconcile: ReconcileTotals;
}
```
ใหม่:
```ts
export interface PendingResponse {
  pending: PendingContract[];
  recalls: RecallCandidate[];
  /** แถวหักประเภทที่ 3 — ค่าเครื่องคืน (Phase 1 ของใบรับเครื่องคืน 2026-09-20) */
  deviceReturns: DeviceReturnCandidate[];
  reconcile: ReconcileTotals;
}
```

(c) บรรทัด 236-246 ใน `BatchItem` — เดิม:
```ts
  /** SETTLEMENT = จ่ายเจ้าหนี้ตามปกติ; RECALL = แถวหักเรียกคืน (Flow C-2, ไม่มีเจ้าหนี้ของตัวเอง) */
  itemType: 'SETTLEMENT' | 'RECALL';
```
ใหม่:
```ts
  /**
   * SETTLEMENT = จ่ายเจ้าหนี้ตามปกติ; RECALL = แถวหักเรียกคืน (Flow C-2, ไม่มีเจ้าหนี้ของตัวเอง);
   * DEVICE_RETURN = แถวหักค่าเครื่องคืน (ใบรับเครื่องคืน 2026-09-20 — ไม่มีเจ้าหนี้ของตัวเองเช่นกัน)
   */
  itemType: 'SETTLEMENT' | 'RECALL' | 'DEVICE_RETURN';
```
และหลังบรรทัด `recallAmount: string;` (บรรทัด 246) เพิ่ม:
```ts
  /** ยอดหักค่าเครื่องคืน (11-2107 DEVICE_RETURN) — > 0 เฉพาะแถว itemType DEVICE_RETURN; รอบก่อน 2026-09-20 = "0.00" */
  deviceReturnAmount: string;
```

แทนเนื้อหา `apps/web/src/pages/interco/RecallCashDialog.tsx` ทั้งไฟล์ด้วย:

```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CashAccountSelect, SHOP_CASH_ACCOUNT_CODES } from '@/components/CashAccountSelect';
import { fmtMoney, type CashSettleCandidate } from './types';

/**
 * รับเงินสดคืนจากหน้าร้านแทนการหักในรอบจ่าย — สองประเภท (spec 2026-09-20 §6.3):
 *   RECALL        → `POST /interco-settlement/recalls/:contractId/settle-cash` (Flow C-2 เดิม)
 *   DEVICE_RETURN → `POST /interco-settlement/device-returns/:contractId/settle-cash`
 *                   (ค่าเครื่องคืน — FINANCE Dr เงิน / Cr 11-2107 [DEVICE_RETURN] · SHOP Dr S21-1104 / Cr เงิน)
 *
 * - ยอด default = ยอดสุทธิคงเหลือ (`candidate.net`) — แก้ได้ แต่ห้ามเกิน net (server re-check ±0.01)
 * - `requestId` = crypto.randomUUID() ต่อการเปิด dialog หนึ่งครั้ง — คงที่ระหว่าง retry
 * - บัญชีรับเงิน FINANCE จาก CASH_ACCOUNT_CODES (default 11-1201 KBank);
 *   บัญชีจ่ายฝั่ง SHOP optional (default S11-1201 ตาม service)
 */

export type CashSettleKind = 'RECALL' | 'DEVICE_RETURN';

interface RecallCashDialogProps {
  /** แถวที่จะรับเงินสด (normalize แล้ว) — null = ปิด dialog */
  candidate: CashSettleCandidate | null;
  kind: CashSettleKind;
  onClose: () => void;
}

const DEFAULT_FINANCE_ACCOUNT = '11-1201';
const DEFAULT_SHOP_ACCOUNT = 'S11-1201';

const ENDPOINT: Record<CashSettleKind, (contractId: string) => string> = {
  RECALL: (id) => `/interco-settlement/recalls/${id}/settle-cash`,
  DEVICE_RETURN: (id) => `/interco-settlement/device-returns/${id}/settle-cash`,
};

const COPY: Record<
  CashSettleKind,
  { title: string; what: string; amountLabel: string; exceeds: string; submit: string; success: string }
> = {
  RECALL: {
    title: 'รับเงินสดคืนจากหน้าร้าน',
    what: 'ล้างยอดเรียกคืนด้วยเงินสด',
    amountLabel: 'ยอดรับเงินคืน (฿)',
    exceeds: 'ยอดรับเงินคืนเกินยอดเรียกคืนคงเหลือ',
    submit: 'บันทึกรับเงินคืน',
    success: 'รับเงินสดคืนสำเร็จ',
  },
  DEVICE_RETURN: {
    title: 'รับเงินสดค่าเครื่องคืนจากหน้าร้าน',
    what: 'ล้างค่าเครื่องคืนด้วยเงินสด (แทนการหักในรอบจ่าย)',
    amountLabel: 'ยอดรับเงินค่าเครื่องคืน (฿)',
    exceeds: 'ยอดรับเงินเกินค่าเครื่องคืนคงเหลือ',
    submit: 'บันทึกรับเงินค่าเครื่องคืน',
    success: 'รับเงินสดค่าเครื่องคืนสำเร็จ',
  },
};

export function RecallCashDialog({ candidate, kind, onClose }: RecallCashDialogProps) {
  const queryClient = useQueryClient();
  const copy = COPY[kind];
  const [amount, setAmount] = useState('');
  const [financeAccount, setFinanceAccount] = useState(DEFAULT_FINANCE_ACCOUNT);
  const [shopAccount, setShopAccount] = useState(DEFAULT_SHOP_ACCOUNT);
  const [requestId, setRequestId] = useState('');

  // Reset ต่อการเปิดหนึ่งครั้ง — `candidate` เป็น object ที่ parent จับไว้ใน state
  // (identity คงที่แม้ pending query refetch) ⇒ requestId ไม่ถูก regenerate ระหว่าง retry
  useEffect(() => {
    if (candidate) {
      setAmount(candidate.net);
      setFinanceAccount(DEFAULT_FINANCE_ACCOUNT);
      setShopAccount(DEFAULT_SHOP_ACCOUNT);
      setRequestId(crypto.randomUUID());
    }
  }, [candidate]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!candidate) return null;
      return (
        await api.post(ENDPOINT[kind](candidate.contractId), {
          amount: Number(amount),
          financeDepositAccountCode: financeAccount,
          shopPayoutAccountCode: shopAccount,
          requestId,
        })
      ).data as { financeEntryNo: string; shopEntryNo: string; deduped: boolean };
    },
    onSuccess: (data) => {
      toast.success(
        data?.deduped
          ? 'รายการนี้ถูกบันทึกไปก่อนหน้าแล้ว (ไม่บันทึกซ้ำ)'
          : `${copy.success} — ใบสำคัญ ${data?.financeEntryNo ?? ''} / ${data?.shopEntryNo ?? ''}`,
      );
      queryClient.invalidateQueries({ queryKey: ['interco-pending'] });
      queryClient.invalidateQueries({ queryKey: ['interco-aging'] });
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'เกิดข้อผิดพลาด กรุณาลองใหม่';
      toast.error(msg);
    },
  });

  const netNum = Number(candidate?.net ?? 0);
  const amountNum = Number(amount);
  const amountInvalid = amount.trim() === '' || Number.isNaN(amountNum) || amountNum <= 0;
  const amountExceeds = !amountInvalid && amountNum > netNum + 0.01;
  const canSubmit = !!candidate && !amountInvalid && !amountExceeds && !mutation.isPending;

  return (
    <Dialog open={!!candidate} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription className="leading-snug">
            สัญญา <span className="font-semibold">{candidate?.contractNumber ?? ''}</span> —{' '}
            {copy.what} (FINANCE: Dr เงินสด/ธนาคาร / Cr 11-2107 · SHOP: Dr S21-1104 / Cr
            เงินสด/ธนาคาร) ยอดคงเหลือสุทธิ{' '}
            <span className="font-semibold tabular-nums">฿{fmtMoney(candidate?.net)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="recall-cash-amount">{copy.amountLabel}</Label>
            <Input
              id="recall-cash-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {amountExceeds && (
              <p className="text-xs text-destructive leading-snug">
                {copy.exceeds} ฿{fmtMoney(candidate?.net)} ไม่อนุญาต
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>บัญชีรับเงินฝั่ง FINANCE</Label>
            <CashAccountSelect
              value={financeAccount}
              onChange={setFinanceAccount}
              placeholder="เลือกบัญชีรับเงิน"
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              บัญชีจ่ายเงินฝั่ง SHOP{' '}
              <span className="font-normal text-muted-foreground">(ค่าเริ่มต้น S11-1201)</span>
            </Label>
            <CashAccountSelect
              value={shopAccount}
              onChange={setShopAccount}
              placeholder="เลือกบัญชีจ่ายเงิน"
              codes={SHOP_CASH_ACCOUNT_CODES}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            ยกเลิก
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit}>
            {mutation.isPending ? 'กำลังบันทึก...' : copy.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/pages/interco/__tests__/RecallCashDialog.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Checkpoint**

Run `./tools/check-types.sh web` — Expected: error ชั่วคราว **เฉพาะ** `PendingTab.tsx` (`<RecallCashDialog recall=...>` prop เก่า — แก้ใน Task 10). **Do NOT commit** (see Global Constraints).

---

### Task 10: INTER-CO — รายการที่ 3 "ค่าเครื่องคืน" ใน `PendingTab` + `CreateBatchDialog` + หน้า + `BatchDetailSheet`

**Files:**
- Modify: `apps/web/src/pages/interco/PendingTab.tsx` (แทนทั้งไฟล์ — origin/main 407 บรรทัด)
- Modify: `apps/web/src/pages/interco/CreateBatchDialog.tsx:22` (import), `:66-81` (props), `:110-118` (totals), `:122-134` (POST body), `:169-172` (description), `:267-271` (label หักรวม)
- Modify: `apps/web/src/pages/IntercompanySettlementPage.tsx:43-44` (state), `:122-125` (derived), `:142-149` (toggle), `:171-185` (PendingTab props), `:234-248` (CreateBatchDialog props + reset)
- Modify: `apps/web/src/pages/interco/BatchDetailSheet.tsx:135` (label), `:202-206` (deduction), `:210-221` (badge), `:233-245` (cells)
- Modify test: `apps/web/src/pages/__tests__/IntercompanySettlementPage.test.tsx:77-91` (fixture) + เพิ่ม describe ท้ายไฟล์

**Interfaces:**
- Consumes: Task 9 (`DeviceReturnCandidate`, `CashSettleCandidate`, `RecallCashDialog kind`), `POST /interco-settlement/batches` + `deviceReturnContractIds`
- Produces: `PendingTab` props += `deviceReturns: DeviceReturnCandidate[]`, `selectedDeviceReturnIds: Set<string>`, `onToggleDeviceReturn: (contractId: string) => void`; `CreateBatchDialog` props += `selectedDeviceReturns: DeviceReturnCandidate[]`

- [ ] **Step 1: Write the failing test**

แก้ `apps/web/src/pages/__tests__/IntercompanySettlementPage.test.tsx`:

บรรทัด 77-85 (`recalls` ใน `pendingResponse`) — เดิม:
```ts
  recalls: [
    {
      contractId: 'r1',
      contractNumber: 'CT-0009',
      customerName: 'ลูกค้า C',
      recallGl: '500.00',
      shopRecallGl: '500.00',
    },
  ],
```
ใหม่:
```ts
  recalls: [
    {
      contractId: 'r1',
      contractNumber: 'CT-0009',
      customerName: 'ลูกค้า C',
      recallGl: '500.00',
      shopRecallGl: '500.00',
    },
  ],
  // ใบรับเครื่องคืนที่ยืนยันแล้ว (2026-09-20) — แถวหักประเภทที่ 3
  deviceReturns: [
    {
      contractId: 'd1',
      contractNumber: 'CT-0011',
      customerName: 'ลูกค้า D',
      deviceReturnGl: '7000.00',
      shopDeviceReturnGl: '7000.00',
    },
  ],
```

เพิ่มท้ายไฟล์ (หลัง `});` ปิด describe เดิม):
```tsx

// ── ใบรับเครื่องคืน 2026-09-20: แถวหักประเภทที่ 3 "ค่าเครื่องคืน" + รับเงินสดสำรอง ─────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('IntercompanySettlementPage — ค่าเครื่องคืน (DEVICE_RETURN)', () => {
  it('shows the device-return section, folds it into the deduction summary and sends deviceReturnContractIds', async () => {
    asRole('ACCOUNTANT', 'u1');
    const user = userEvent.setup();
    wrap(<IntercompanySettlementPage />);

    await waitFor(() => expect(screen.getByText('CT-0001')).toBeInTheDocument());
    expect(screen.getByText(/ค่าเครื่องคืน \(ใบรับเครื่องคืนที่ยืนยันแล้ว\)/)).toBeInTheDocument();
    expect(screen.getByText('CT-0011')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'เลือกสัญญา CT-0001' }));
    await user.click(screen.getByRole('checkbox', { name: 'เลือกค่าเครื่องคืนสัญญา CT-0011' }));
    await user.click(screen.getByRole('button', { name: 'สร้างรอบจ่าย' }));

    const dialog = await screen.findByRole('dialog');
    // 11,000 gross − (2,000 swap credit + 7,000 device return) = 2,000 net
    expect(within(dialog).getByText('฿2,000.00')).toBeInTheDocument();
    expect(within(dialog).getByText('−฿9,000.00')).toBeInTheDocument();
    expect(within(dialog).getByText(/\+ ค่าเครื่องคืน 1 รายการ/)).toBeInTheDocument();

    apiPost.mockResolvedValueOnce({ data: { id: 'b10', batchNumber: 'IC-20260920-0001' } });
    await user.click(within(dialog).getByRole('button', { name: 'สร้างรอบจ่าย' }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/interco-settlement/batches',
        expect.objectContaining({ contractIds: ['c1'], deviceReturnContractIds: ['d1'] }),
      ),
    );
  });

  it('opens the device-return cash dialog and POSTs to the device-returns settle-cash endpoint', async () => {
    asRole('OWNER');
    const user = userEvent.setup();
    wrap(<IntercompanySettlementPage />);

    await waitFor(() => expect(screen.getByText('CT-0011')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'รับเงินสดค่าเครื่อง' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('รับเงินสดค่าเครื่องคืนจากหน้าร้าน')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/ยอดรับเงินค่าเครื่องคืน/)).toHaveValue(7000);

    apiPost.mockResolvedValueOnce({
      data: { financeEntryNo: 'JE-202609-00010', shopEntryNo: 'SJE-202609-00010', deduped: false },
    });
    await user.click(within(dialog).getByRole('button', { name: 'บันทึกรับเงินค่าเครื่องคืน' }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/interco-settlement/device-returns/d1/settle-cash',
        expect.objectContaining({
          amount: 7000,
          financeDepositAccountCode: '11-1201',
          shopPayoutAccountCode: 'S11-1201',
          requestId: expect.stringMatching(UUID_RE),
        }),
      ),
    );
  });

  it('disables selection and the cash button on a device-return row whose two books mismatch', async () => {
    asRole('OWNER');
    setupApiGet({
      ...pendingResponse,
      deviceReturns: [{ ...pendingResponse.deviceReturns[0], shopDeviceReturnGl: '6000.00' }],
    });
    wrap(<IntercompanySettlementPage />);

    await waitFor(() => expect(screen.getByText('CT-0011')).toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: 'เลือกค่าเครื่องคืนสัญญา CT-0011' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'รับเงินสดค่าเครื่อง' })).toBeDisabled();
  });

  it('hides รับเงินสดค่าเครื่อง from maker-side roles (endpoint is OWNER/FM only)', async () => {
    asRole('ACCOUNTANT', 'u1');
    wrap(<IntercompanySettlementPage />);

    await waitFor(() => expect(screen.getByText('CT-0011')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'รับเงินสดค่าเครื่อง' })).not.toBeInTheDocument();
  });

  it('renders a DEVICE_RETURN batch item with its badge, deduction and the 3-part หักรวม label', async () => {
    asRole('OWNER');
    apiGet.mockImplementation((url: string) => {
      if (url === '/interco-settlement/pending') return Promise.resolve({ data: pendingResponse });
      if (url === '/interco-settlement/batches') return Promise.resolve({ data: batchesResponse });
      if (url.startsWith('/interco-settlement/batches/')) {
        return Promise.resolve({
          data: {
            ...batchDetailResponse,
            totalDeduction: '7500.00',
            netTransferAmount: '3500.00',
            shopNetAmount: '3500.00',
            items: [
              ...batchDetailResponse.items,
              {
                id: 'i3',
                contractId: 'd1',
                itemType: 'DEVICE_RETURN',
                financedGl: '0.00',
                commissionGl: '0.00',
                shopFinancedGl: '0.00',
                shopCommissionGl: '0.00',
                legacyNoShop: false,
                swapCreditAmount: '0.00',
                recallAmount: '0.00',
                deviceReturnAmount: '7000.00',
                contract: { id: 'd1', contractNumber: 'CT-0011', customer: { name: 'ลูกค้า D' } },
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    wrap(<IntercompanySettlementPage />);

    await user.click(screen.getByRole('tab', { name: 'รอบจ่าย' }));
    await waitFor(() => expect(screen.getByText('IC-20260801-0001')).toBeInTheDocument());
    await user.click(screen.getByText('IC-20260801-0001'));
    await waitFor(() => expect(screen.getByText(/รายการสัญญา/)).toBeInTheDocument());

    expect(screen.getByText('ค่าเครื่องคืน')).toBeInTheDocument(); // badge บนแถว DEVICE_RETURN
    expect(screen.getByText('−7,000.00')).toBeInTheDocument(); // ยอดหักของแถวในตาราง items
    expect(
      screen.getByText(/หักรวม \(เครดิตเปลี่ยนเครื่อง \+ เรียกคืน \+ ค่าเครื่องคืน\)/),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/pages/__tests__/IntercompanySettlementPage.test.tsx`
Expected: FAIL — 5 เทสต์ใหม่ล้ม (`Unable to find an element with the text: /ค่าเครื่องคืน \(ใบรับเครื่องคืนที่ยืนยันแล้ว\)/` ฯลฯ); 12 เทสต์เดิมยังผ่าน (หรือล้มจาก TS error ชั่วคราวของ Task 9 ที่ `PendingTab.tsx` — vitest ไม่ type-check จึงมักยังรันได้)

- [ ] **Step 3: Write minimal implementation**

แทนเนื้อหา `apps/web/src/pages/interco/PendingTab.tsx` ทั้งไฟล์ด้วย:

```tsx
import { useState } from 'react';
import { AlertTriangle, ClipboardList, PackageX, Undo2 } from 'lucide-react';
import QueryBoundary from '@/components/QueryBoundary';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { formatThaiDateShort } from '@/lib/date';
import { RecallCashDialog, type CashSettleKind } from './RecallCashDialog';
import {
  deviceReturnToCashCandidate,
  fmtMoney,
  INTERCO_APPROVER_ROLES,
  recallToCashCandidate,
  type CashSettleCandidate,
  type DeviceReturnCandidate,
  type PendingContract,
  type RecallCandidate,
  type ReconcileTotals,
} from './types';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — แท็บ "รอจ่าย" (spec §8 แท็บ 1).
 *
 * Reconcile strip = sanity check ระดับบัญชี (spec §4): ยอดคิวรอจ่ายรวม ต้อง
 * ใกล้เคียง GL 21-1101+21-1102 ทั้งบัญชี — drift ที่ไม่ใช่ 0 แปลว่ามี JE
 * แปลกปลอม/เส้นเก่าที่ไม่มี metadata.contractId (pre-flight §10 ข้อ 1).
 *
 * แถวหักมี 3 ประเภท: เครดิตเปลี่ยนเครื่อง (บนแถวสัญญาค้างจ่าย), เรียกคืน (Flow C-2),
 * และค่าเครื่องคืน (ใบรับเครื่องคืน 2026-09-20 — 11-2107 [DEVICE_RETURN] คู่ S21-1104).
 */

const DRIFT_TOLERANCE = 0.01;

/** ยอดหักของแถว — หักได้เฉพาะ eligible (mixed-era swap = 0, ล้างผ่านรับโอนหน้าร้านแทน) */
function rowDeduction(p: PendingContract): number {
  return p.swapCreditEligible ? Number(p.swapCreditGl) : 0;
}

/** สองสมุดไม่ตรงกัน ±0.01 — เลือกเข้ารอบไม่ได้ (backend ปฏิเสธที่ createBatch อยู่แล้ว) */
function recallMismatch(r: RecallCandidate): boolean {
  return Math.abs(Number(r.recallGl) - Number(r.shopRecallGl)) > DRIFT_TOLERANCE;
}

/** เช่นเดียวกับ recall — `ยอดค่าเครื่องคืนสองสมุดไม่ตรงกัน` ฝั่ง server */
function deviceReturnMismatch(d: DeviceReturnCandidate): boolean {
  return Math.abs(Number(d.deviceReturnGl) - Number(d.shopDeviceReturnGl)) > DRIFT_TOLERANCE;
}

interface PendingTabProps {
  pending: PendingContract[];
  recalls: RecallCandidate[];
  deviceReturns: DeviceReturnCandidate[];
  reconcile: ReconcileTotals | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  selectedIds: Set<string>;
  onToggle: (contractId: string) => void;
  onToggleAll: () => void;
  selectedRecallIds: Set<string>;
  onToggleRecall: (contractId: string) => void;
  selectedDeviceReturnIds: Set<string>;
  onToggleDeviceReturn: (contractId: string) => void;
  onCreateClick: () => void;
}

export function PendingTab({
  pending,
  recalls,
  deviceReturns,
  reconcile,
  isLoading,
  isError,
  error,
  onRetry,
  selectedIds,
  onToggle,
  onToggleAll,
  selectedRecallIds,
  onToggleRecall,
  selectedDeviceReturnIds,
  onToggleDeviceReturn,
  onCreateClick,
}: PendingTabProps) {
  const { user } = useAuth();
  // ปุ่มรับเงินสดโพสต์ JE สองสมุดทันที — endpoint gate ที่ role ระดับ checker
  // (OWNER/FINANCE_MANAGER) เหมือน approve/reverse จึงซ่อนจาก maker-side roles
  const canSettleCash = !!user && INTERCO_APPROVER_ROLES.includes(user.role);
  const [cashTarget, setCashTarget] = useState<{
    kind: CashSettleKind;
    candidate: CashSettleCandidate;
  } | null>(null);

  const drift = Number(reconcile?.drift ?? 0);
  const hasDrift = Math.abs(drift) > DRIFT_TOLERANCE;
  const allSelected = pending.length > 0 && selectedIds.size === pending.length;

  const selectedContracts = pending.filter((p) => selectedIds.has(p.contractId));
  const selectedTotal = selectedContracts.reduce(
    (sum, p) => sum + Number(p.financedGl) + Number(p.commissionGl),
    0,
  );
  const selectedRecallTotal = recalls
    .filter((r) => selectedRecallIds.has(r.contractId))
    .reduce((sum, r) => sum + Number(r.recallGl), 0);
  const selectedDeviceReturnTotal = deviceReturns
    .filter((d) => selectedDeviceReturnIds.has(d.contractId))
    .reduce((sum, d) => sum + Number(d.deviceReturnGl), 0);
  const selectedDeduction =
    selectedContracts.reduce((sum, p) => sum + rowDeduction(p), 0) +
    selectedRecallTotal +
    selectedDeviceReturnTotal;
  const anySelected =
    selectedIds.size > 0 || selectedRecallIds.size > 0 || selectedDeviceReturnIds.size > 0;

  return (
    <div className="space-y-4 pt-4">
      {reconcile && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="ยอดคิวรวม" value={reconcile.pendingTotal} />
          <StatTile label="GL FINANCE (21-1101+21-1102)" value={reconcile.glFinanceTotal} />
          <StatTile label="GL SHOP (S11-3001+S11-3002)" value={reconcile.glShopTotal} />
          <StatTile
            label="ส่วนต่าง"
            value={reconcile.drift}
            tone={hasDrift ? 'warning' : 'success'}
          />
        </div>
      )}

      {hasDrift && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning leading-snug">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <strong>ยอดคิวรอจ่ายไม่ตรงกับ GL ทั้งบัญชี</strong> — ส่วนต่าง ฿
            {fmtMoney(Math.abs(drift))}. อาจมีรายการเดินบัญชีที่ไม่ผูกเลขที่สัญญา (JE
            เส้นเก่าก่อนเปิดใช้รอบจ่าย) — ตรวจสอบก่อนเริ่ม บันทึกรอบย้อนหลัง
          </div>
        </div>
      )}

      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={onRetry}
        errorTitle="ไม่สามารถโหลดคิวรอจ่ายได้"
      >
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-lg font-semibold flex items-center gap-2 leading-snug">
                  <ClipboardList className="h-5 w-5 text-primary" />
                  สัญญาค้างจ่าย ({pending.length} รายการ)
                </h2>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm leading-snug">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="w-10 p-3">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={onToggleAll}
                          aria-label="เลือกทั้งหมด"
                          disabled={pending.length === 0}
                        />
                      </th>
                      <th className="text-left p-3 font-medium text-muted-foreground">
                        เลขสัญญา / ลูกค้า
                      </th>
                      <th className="text-center p-3 font-medium text-muted-foreground">
                        วันที่ activate
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">ยอดจัด</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">ค่าคอม</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">
                        หักเครดิตเปลี่ยนเครื่อง
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">โอนสุทธิ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="p-8 text-center text-muted-foreground leading-snug"
                        >
                          ไม่มีสัญญาค้างจ่าย
                        </td>
                      </tr>
                    ) : (
                      pending.map((p) => (
                        <tr
                          key={p.contractId}
                          className="border-t border-border hover:bg-accent/30 cursor-pointer"
                          onClick={() => onToggle(p.contractId)}
                        >
                          <td className="p-3" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedIds.has(p.contractId)}
                              onCheckedChange={() => onToggle(p.contractId)}
                              aria-label={`เลือกสัญญา ${p.contractNumber}`}
                            />
                          </td>
                          <td className="p-3">
                            <div className="font-medium leading-snug flex items-center gap-2 flex-wrap">
                              {p.contractNumber}
                              {p.legacyNoShop && (
                                <Badge variant="warning" appearance="light" size="sm">
                                  LEGACY — SHOP ไม่มียอดตั้งต้น
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground leading-snug">
                              {p.customerName}
                            </div>
                          </td>
                          <td className="p-3 text-center text-xs text-muted-foreground">
                            {p.activatedAt ? formatThaiDateShort(p.activatedAt) : '-'}
                          </td>
                          <td className="p-3 text-right tabular-nums">{fmtMoney(p.financedGl)}</td>
                          <td className="p-3 text-right tabular-nums">
                            {fmtMoney(p.commissionGl)}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {p.swapCreditEligible ? (
                              <span className="text-warning">−{fmtMoney(p.swapCreditGl)}</span>
                            ) : Number(p.swapCreditGl) > 0 ? (
                              <Badge
                                variant="secondary"
                                appearance="light"
                                size="sm"
                                title="สัญญาเปลี่ยนเครื่องยุคก่อน Phase 1 — เครดิต 11-2107 สองสมุดไม่เท่ากัน จึงหักกลบในรอบจ่ายไม่ได้ ให้ล้างผ่านช่องทางรับโอนจากหน้าร้านแทน"
                              >
                                ล้างผ่านรับโอนหน้าร้าน
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="p-3 text-right tabular-nums font-medium">
                            {fmtMoney(
                              Number(p.financedGl) + Number(p.commissionGl) - rowDeduction(p),
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {recalls.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold flex items-center gap-2 leading-snug">
                  <Undo2 className="h-5 w-5 text-warning" />
                  รายการเรียกคืน (ยกเลิกหลังตัดจ่าย) ({recalls.length} รายการ)
                </h2>
                <p className="text-xs text-muted-foreground leading-snug">
                  สัญญาเปลี่ยนเครื่องที่ยกเลิกหลังรอบจ่ายตัดไปแล้ว —
                  เลือกเพื่อหักเงินคืนจากรอบจ่ายถัดไป (ต้องมีสัญญาค้างจ่ายในรอบอย่างน้อย 1 สัญญา)
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm leading-snug">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="w-10 p-3" aria-label="เลือกรายการเรียกคืน" />
                        <th className="text-left p-3 font-medium text-muted-foreground">
                          เลขสัญญา / ลูกค้า
                        </th>
                        <th className="text-right p-3 font-medium text-muted-foreground">
                          ยอดเรียกคืน (11-2107)
                        </th>
                        <th className="text-right p-3 font-medium text-muted-foreground">
                          ฝั่ง SHOP (S21-1104)
                        </th>
                        {canSettleCash && (
                          <th className="text-right p-3 font-medium text-muted-foreground">
                            รับเงินสด
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {recalls.map((r) => {
                        const mismatch = recallMismatch(r);
                        return (
                          <tr
                            key={r.contractId}
                            className={`border-t border-border ${
                              mismatch ? 'opacity-70' : 'hover:bg-accent/30 cursor-pointer'
                            }`}
                            onClick={() => !mismatch && onToggleRecall(r.contractId)}
                          >
                            <td className="p-3" onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedRecallIds.has(r.contractId)}
                                onCheckedChange={() => onToggleRecall(r.contractId)}
                                disabled={mismatch}
                                aria-label={`เลือกเรียกคืนสัญญา ${r.contractNumber}`}
                              />
                            </td>
                            <td className="p-3">
                              <div className="font-medium leading-snug flex items-center gap-2 flex-wrap">
                                {r.contractNumber}
                                {mismatch && (
                                  <Badge
                                    variant="warning"
                                    appearance="light"
                                    size="sm"
                                    title="ยอด 11-2107 กับ S21-1104 ไม่เท่ากัน — GL ผิดปกติ ตรวจสอบก่อนจึงจะหักเข้ารอบได้"
                                  >
                                    ยอดสองสมุดไม่ตรง
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground leading-snug">
                                {r.customerName}
                              </div>
                            </td>
                            <td className="p-3 text-right tabular-nums text-warning">
                              −{fmtMoney(r.recallGl)}
                            </td>
                            <td className="p-3 text-right tabular-nums">
                              {fmtMoney(r.shopRecallGl)}
                            </td>
                            {canSettleCash && (
                              <td
                                className="p-3 text-right"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-3 text-xs"
                                  disabled={mismatch}
                                  title={
                                    mismatch
                                      ? 'ยอดสองสมุดไม่ตรงกัน — ตรวจสอบ GL ก่อนรับเงินคืน'
                                      : 'รับเงินสดคืนจากหน้าร้านแทนการหักในรอบจ่าย'
                                  }
                                  onClick={() =>
                                    setCashTarget({
                                      kind: 'RECALL',
                                      candidate: recallToCashCandidate(r),
                                    })
                                  }
                                >
                                  รับเงินสดคืน
                                </Button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {deviceReturns.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold flex items-center gap-2 leading-snug">
                  <PackageX className="h-5 w-5 text-warning" />
                  ค่าเครื่องคืน (ใบรับเครื่องคืนที่ยืนยันแล้ว) ({deviceReturns.length} รายการ)
                </h2>
                <p className="text-xs text-muted-foreground leading-snug">
                  ราคาประเมินที่หน้าร้านรับเครื่องไปจาก FINANCE (11-2107 ค่าเครื่องคืน คู่ S21-1104) —
                  เลือกเพื่อหักจากยอดโอนของรอบจ่ายถัดไป (ต้องมีสัญญาค้างจ่ายในรอบอย่างน้อย 1
                  สัญญา) หรือรับเงินสดจากหน้าร้านเป็นรายสัญญา
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm leading-snug">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="w-10 p-3" aria-label="เลือกรายการค่าเครื่องคืน" />
                        <th className="text-left p-3 font-medium text-muted-foreground">
                          เลขสัญญา / ลูกค้า
                        </th>
                        <th className="text-right p-3 font-medium text-muted-foreground">
                          ค่าเครื่องคืน (11-2107)
                        </th>
                        <th className="text-right p-3 font-medium text-muted-foreground">
                          ฝั่ง SHOP (S21-1104)
                        </th>
                        {canSettleCash && (
                          <th className="text-right p-3 font-medium text-muted-foreground">
                            รับเงินสด
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {deviceReturns.map((d) => {
                        const mismatch = deviceReturnMismatch(d);
                        return (
                          <tr
                            key={d.contractId}
                            className={`border-t border-border ${
                              mismatch ? 'opacity-70' : 'hover:bg-accent/30 cursor-pointer'
                            }`}
                            onClick={() => !mismatch && onToggleDeviceReturn(d.contractId)}
                          >
                            <td className="p-3" onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedDeviceReturnIds.has(d.contractId)}
                                onCheckedChange={() => onToggleDeviceReturn(d.contractId)}
                                disabled={mismatch}
                                aria-label={`เลือกค่าเครื่องคืนสัญญา ${d.contractNumber}`}
                              />
                            </td>
                            <td className="p-3">
                              <div className="font-medium leading-snug flex items-center gap-2 flex-wrap">
                                {d.contractNumber}
                                {mismatch && (
                                  <Badge
                                    variant="warning"
                                    appearance="light"
                                    size="sm"
                                    title="ยอด 11-2107 กับ S21-1104 ไม่เท่ากัน — GL ผิดปกติ ตรวจสอบก่อนจึงจะหักเข้ารอบได้"
                                  >
                                    ยอดสองสมุดไม่ตรง
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground leading-snug">
                                {d.customerName}
                              </div>
                            </td>
                            <td className="p-3 text-right tabular-nums text-warning">
                              −{fmtMoney(d.deviceReturnGl)}
                            </td>
                            <td className="p-3 text-right tabular-nums">
                              {fmtMoney(d.shopDeviceReturnGl)}
                            </td>
                            {canSettleCash && (
                              <td
                                className="p-3 text-right"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-3 text-xs"
                                  disabled={mismatch}
                                  title={
                                    mismatch
                                      ? 'ยอดสองสมุดไม่ตรงกัน — ตรวจสอบ GL ก่อนรับเงินสด'
                                      : 'รับเงินสดค่าเครื่องคืนจากหน้าร้านแทนการหักในรอบจ่าย'
                                  }
                                  onClick={() =>
                                    setCashTarget({
                                      kind: 'DEVICE_RETURN',
                                      candidate: deviceReturnToCashCandidate(d),
                                    })
                                  }
                                >
                                  รับเงินสดค่าเครื่อง
                                </Button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </QueryBoundary>

      {anySelected && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-lg flex-wrap">
          <div className="text-sm leading-snug">
            เลือกแล้ว <strong>{selectedIds.size}</strong> สัญญา
            {selectedRecallIds.size > 0 && (
              <>
                {' '}
                + เรียกคืน <strong>{selectedRecallIds.size}</strong> รายการ
              </>
            )}
            {selectedDeviceReturnIds.size > 0 && (
              <>
                {' '}
                + ค่าเครื่องคืน <strong>{selectedDeviceReturnIds.size}</strong> รายการ
              </>
            )}{' '}
            • รวม <strong className="tabular-nums">฿{fmtMoney(selectedTotal)}</strong>
            {selectedDeduction > 0 && (
              <>
                {' '}
                • หัก{' '}
                <strong className="tabular-nums text-warning">
                  ฿{fmtMoney(selectedDeduction)}
                </strong>{' '}
                • โอนสุทธิ{' '}
                <strong className="tabular-nums">
                  ฿{fmtMoney(selectedTotal - selectedDeduction)}
                </strong>
              </>
            )}
            {selectedIds.size === 0 && (
              <span className="block text-xs text-muted-foreground">
                ต้องเลือกสัญญาค้างจ่ายอย่างน้อย 1 สัญญาจึงจะสร้างรอบได้
              </span>
            )}
          </div>
          <Button onClick={onCreateClick} disabled={selectedIds.size === 0}>
            สร้างรอบจ่าย
          </Button>
        </div>
      )}

      <RecallCashDialog
        candidate={cashTarget?.candidate ?? null}
        kind={cashTarget?.kind ?? 'RECALL'}
        onClose={() => setCashTarget(null)}
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'warning' | 'success';
}) {
  const toneClass =
    tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-foreground';
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <p className="text-xs text-muted-foreground leading-snug">{label}</p>
        <p className={`text-xl font-bold mt-1 tabular-nums leading-snug ${toneClass}`}>
          ฿{fmtMoney(value)}
        </p>
      </CardContent>
    </Card>
  );
}
```

แก้ `apps/web/src/pages/interco/CreateBatchDialog.tsx`:

(a) บรรทัด 22 — เดิม:
```ts
import { fmtMoney, type PendingContract, type RecallCandidate } from './types';
```
ใหม่:
```ts
import {
  fmtMoney,
  type DeviceReturnCandidate,
  type PendingContract,
  type RecallCandidate,
} from './types';
```

(b) บรรทัด 70-73 (ใน `interface CreateBatchDialogProps`) — เดิม:
```ts
  /** แถวหักเรียกคืน (Flow C-2) ที่เลือกจาก section "รายการเรียกคืน" ในแท็บรอจ่าย */
  selectedRecalls: RecallCandidate[];
  onCreated: (batchId: string) => void;
}
```
ใหม่:
```ts
  /** แถวหักเรียกคืน (Flow C-2) ที่เลือกจาก section "รายการเรียกคืน" ในแท็บรอจ่าย */
  selectedRecalls: RecallCandidate[];
  /** แถวหักค่าเครื่องคืน (ใบรับเครื่องคืน 2026-09-20) ที่เลือกจาก section "ค่าเครื่องคืน" */
  selectedDeviceReturns: DeviceReturnCandidate[];
  onCreated: (batchId: string) => void;
}
```

(c) บรรทัด 75-81 — เดิม:
```ts
export function CreateBatchDialog({
  open,
  onOpenChange,
  selectedContracts,
  selectedRecalls,
  onCreated,
}: CreateBatchDialogProps) {
```
ใหม่:
```ts
export function CreateBatchDialog({
  open,
  onOpenChange,
  selectedContracts,
  selectedRecalls,
  selectedDeviceReturns,
  onCreated,
}: CreateBatchDialogProps) {
```

(d) บรรทัด 110-118 — เดิม:
```ts
  // Phase 2 หักกลบ — mirror ของ buildSnapshot ฝั่ง server (display เท่านั้น
  // ตัวเลขจริง snapshot จาก GL ตอน POST): swap credit เฉพาะ eligible + เรียกคืน.
  const swapCreditTotal = selectedContracts.reduce(
    (sum, c) => sum + (c.swapCreditEligible ? Number(c.swapCreditGl) : 0),
    0,
  );
  const recallTotal = selectedRecalls.reduce((sum, r) => sum + Number(r.recallGl), 0);
  const totalDeduction = swapCreditTotal + recallTotal;
  const netTransferAmount = totalAmount - totalDeduction;
```
ใหม่:
```ts
  // Phase 2 หักกลบ — mirror ของ buildSnapshot ฝั่ง server (display เท่านั้น
  // ตัวเลขจริง snapshot จาก GL ตอน POST): swap credit เฉพาะ eligible + เรียกคืน + ค่าเครื่องคืน.
  const swapCreditTotal = selectedContracts.reduce(
    (sum, c) => sum + (c.swapCreditEligible ? Number(c.swapCreditGl) : 0),
    0,
  );
  const recallTotal = selectedRecalls.reduce((sum, r) => sum + Number(r.recallGl), 0);
  const deviceReturnTotal = selectedDeviceReturns.reduce(
    (sum, d) => sum + Number(d.deviceReturnGl),
    0,
  );
  const totalDeduction = swapCreditTotal + recallTotal + deviceReturnTotal;
  const netTransferAmount = totalAmount - totalDeduction;
```

(e) บรรทัด 125-127 (ใน POST body) — เดิม:
```ts
          contractIds: selectedContracts.map((c) => c.contractId),
          recallContractIds:
            selectedRecalls.length > 0 ? selectedRecalls.map((r) => r.contractId) : undefined,
```
ใหม่:
```ts
          contractIds: selectedContracts.map((c) => c.contractId),
          recallContractIds:
            selectedRecalls.length > 0 ? selectedRecalls.map((r) => r.contractId) : undefined,
          deviceReturnContractIds:
            selectedDeviceReturns.length > 0
              ? selectedDeviceReturns.map((d) => d.contractId)
              : undefined,
```

(f) บรรทัด 170-172 (DialogDescription) — เดิม:
```tsx
            เลือกแล้ว {selectedContracts.length} สัญญา
            {selectedRecalls.length > 0 && <> + เรียกคืน {selectedRecalls.length} รายการ</>} • รวม ฿
            {fmtMoney(totalAmount)}
```
ใหม่:
```tsx
            เลือกแล้ว {selectedContracts.length} สัญญา
            {selectedRecalls.length > 0 && <> + เรียกคืน {selectedRecalls.length} รายการ</>}
            {selectedDeviceReturns.length > 0 && (
              <> + ค่าเครื่องคืน {selectedDeviceReturns.length} รายการ</>
            )}{' '}
            • รวม ฿{fmtMoney(totalAmount)}
```

(g) บรรทัด 268-270 — เดิม:
```tsx
              <span className="text-muted-foreground">
                หักรวม (เครดิตเปลี่ยนเครื่อง + เรียกคืน)
              </span>
```
ใหม่:
```tsx
              <span className="text-muted-foreground">
                หักรวม (เครดิตเปลี่ยนเครื่อง + เรียกคืน + ค่าเครื่องคืน)
              </span>
```

แก้ `apps/web/src/pages/IntercompanySettlementPage.tsx`:

(a) บรรทัด 43-44 — เดิม:
```ts
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedRecallIds, setSelectedRecallIds] = useState<Set<string>>(new Set());
```
ใหม่:
```ts
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedRecallIds, setSelectedRecallIds] = useState<Set<string>>(new Set());
  const [selectedDeviceReturnIds, setSelectedDeviceReturnIds] = useState<Set<string>>(new Set());
```

(b) บรรทัด 122-125 — เดิม:
```ts
  const pending = pendingQuery.data?.pending ?? [];
  const recalls = pendingQuery.data?.recalls ?? [];
  const selectedContracts = pending.filter((p) => selectedIds.has(p.contractId));
  const selectedRecalls = recalls.filter((r) => selectedRecallIds.has(r.contractId));
```
ใหม่:
```ts
  const pending = pendingQuery.data?.pending ?? [];
  const recalls = pendingQuery.data?.recalls ?? [];
  const deviceReturns = pendingQuery.data?.deviceReturns ?? [];
  const selectedContracts = pending.filter((p) => selectedIds.has(p.contractId));
  const selectedRecalls = recalls.filter((r) => selectedRecallIds.has(r.contractId));
  const selectedDeviceReturns = deviceReturns.filter((d) =>
    selectedDeviceReturnIds.has(d.contractId),
  );
```

(c) หลังฟังก์ชัน `toggleRecall` (บรรทัด 142-149) เพิ่ม:
```ts

  const toggleDeviceReturn = (contractId: string) => {
    setSelectedDeviceReturnIds((prev) => {
      const next = new Set(prev);
      if (next.has(contractId)) next.delete(contractId);
      else next.add(contractId);
      return next;
    });
  };
```

(d) บรรทัด 171-185 `<PendingTab ...>` — เดิม:
```tsx
          <PendingTab
            pending={pending}
            recalls={recalls}
            reconcile={pendingQuery.data?.reconcile}
            isLoading={pendingQuery.isLoading}
            isError={pendingQuery.isError}
            error={pendingQuery.error}
            onRetry={() => pendingQuery.refetch()}
            selectedIds={selectedIds}
            onToggle={toggleSelect}
            onToggleAll={toggleSelectAll}
            selectedRecallIds={selectedRecallIds}
            onToggleRecall={toggleRecall}
            onCreateClick={() => setCreateOpen(true)}
          />
```
ใหม่:
```tsx
          <PendingTab
            pending={pending}
            recalls={recalls}
            deviceReturns={deviceReturns}
            reconcile={pendingQuery.data?.reconcile}
            isLoading={pendingQuery.isLoading}
            isError={pendingQuery.isError}
            error={pendingQuery.error}
            onRetry={() => pendingQuery.refetch()}
            selectedIds={selectedIds}
            onToggle={toggleSelect}
            onToggleAll={toggleSelectAll}
            selectedRecallIds={selectedRecallIds}
            onToggleRecall={toggleRecall}
            selectedDeviceReturnIds={selectedDeviceReturnIds}
            onToggleDeviceReturn={toggleDeviceReturn}
            onCreateClick={() => setCreateOpen(true)}
          />
```

(e) บรรทัด 234-248 `<CreateBatchDialog ...>` — เดิม:
```tsx
      <CreateBatchDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        selectedContracts={selectedContracts}
        selectedRecalls={selectedRecalls}
        onCreated={(batchId) => {
          setSelectedIds(new Set());
          setSelectedRecallIds(new Set());
          invalidateAll();
```
ใหม่:
```tsx
      <CreateBatchDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        selectedContracts={selectedContracts}
        selectedRecalls={selectedRecalls}
        selectedDeviceReturns={selectedDeviceReturns}
        onCreated={(batchId) => {
          setSelectedIds(new Set());
          setSelectedRecallIds(new Set());
          setSelectedDeviceReturnIds(new Set());
          invalidateAll();
```

แก้ `apps/web/src/pages/interco/BatchDetailSheet.tsx`:

(a) บรรทัด 135 — เดิม:
```tsx
                    label="หักรวม (เครดิตเปลี่ยนเครื่อง + เรียกคืน)"
```
ใหม่:
```tsx
                    label="หักรวม (เครดิตเปลี่ยนเครื่อง + เรียกคืน + ค่าเครื่องคืน)"
```

(b) บรรทัด 202-206 — เดิม:
```tsx
                        const isRecall = item.itemType === 'RECALL';
                        // item รอบเก่า (ก่อน Phase 2) ไม่มีคอลัมน์หัก — Prisma default
                        // ให้ "0.00" เสมอ แต่กันเผื่อ undefined จาก fixture/response เก่า
                        const deduction = Number(
                          (isRecall ? item.recallAmount : item.swapCreditAmount) ?? 0,
                        );
```
ใหม่:
```tsx
                        const isRecall = item.itemType === 'RECALL';
                        const isDeviceReturn = item.itemType === 'DEVICE_RETURN';
                        // แถวหักที่ไม่มีเจ้าหนี้ของตัวเอง (RECALL / DEVICE_RETURN) โชว์ '-' ในคอลัมน์เจ้าหนี้
                        const noPayable = isRecall || isDeviceReturn;
                        // item รอบเก่า (ก่อน Phase 2 / ก่อน 2026-09-20) ไม่มีคอลัมน์หัก — Prisma default
                        // ให้ "0.00" เสมอ แต่กันเผื่อ undefined จาก fixture/response เก่า
                        const deduction = Number(
                          (isRecall
                            ? item.recallAmount
                            : isDeviceReturn
                              ? item.deviceReturnAmount
                              : item.swapCreditAmount) ?? 0,
                        );
```

(c) บรรทัด 210-221 (badge) — เดิม:
```tsx
                                {isRecall && (
                                  <Badge
                                    variant="warning"
                                    appearance="light"
                                    size="sm"
                                    title="ยกเลิกหลังตัดจ่าย (Flow C-2) — หักเงินคืนจากรอบนี้ ไม่มีเจ้าหนี้ของตัวเอง"
                                  >
                                    เรียกคืน
                                  </Badge>
                                )}
```
ใหม่:
```tsx
                                {isRecall && (
                                  <Badge
                                    variant="warning"
                                    appearance="light"
                                    size="sm"
                                    title="ยกเลิกหลังตัดจ่าย (Flow C-2) — หักเงินคืนจากรอบนี้ ไม่มีเจ้าหนี้ของตัวเอง"
                                  >
                                    เรียกคืน
                                  </Badge>
                                )}
                                {isDeviceReturn && (
                                  <Badge
                                    variant="info"
                                    appearance="light"
                                    size="sm"
                                    title="ค่าเครื่องคืน (ใบรับเครื่องคืนที่ยืนยันแล้ว) — หักจากยอดโอนของรอบนี้ ไม่มีเจ้าหนี้ของตัวเอง"
                                  >
                                    ค่าเครื่องคืน
                                  </Badge>
                                )}
```

(d) บรรทัด 233-245 (4 เซลล์เจ้าหนี้) — เดิม:
```tsx
                            <td className="p-2.5 text-right tabular-nums">
                              {isRecall ? '-' : fmtMoney(item.financedGl)}
                            </td>
                            <td className="p-2.5 text-right tabular-nums">
                              {isRecall ? '-' : fmtMoney(item.commissionGl)}
                            </td>
                            <td className="p-2.5 text-right tabular-nums">
                              {isRecall || item.legacyNoShop ? '-' : fmtMoney(item.shopFinancedGl)}
                            </td>
                            <td className="p-2.5 text-right tabular-nums">
                              {isRecall || item.legacyNoShop
                                ? '-'
                                : fmtMoney(item.shopCommissionGl)}
                            </td>
```
ใหม่:
```tsx
                            <td className="p-2.5 text-right tabular-nums">
                              {noPayable ? '-' : fmtMoney(item.financedGl)}
                            </td>
                            <td className="p-2.5 text-right tabular-nums">
                              {noPayable ? '-' : fmtMoney(item.commissionGl)}
                            </td>
                            <td className="p-2.5 text-right tabular-nums">
                              {noPayable || item.legacyNoShop ? '-' : fmtMoney(item.shopFinancedGl)}
                            </td>
                            <td className="p-2.5 text-right tabular-nums">
                              {noPayable || item.legacyNoShop
                                ? '-'
                                : fmtMoney(item.shopCommissionGl)}
                            </td>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/pages/__tests__/IntercompanySettlementPage.test.tsx src/pages/interco/__tests__/`
Expected: PASS (17 page tests + RecallCashDialog 3 + AgingTab/ReconcileTab เดิม)

- [ ] **Step 5: Checkpoint**

Run `./tools/check-types.sh web` — Expected: 0 errors. **Do NOT commit** (see Global Constraints).

---

### Task 11: Tag `RETURNED_DEVICE` — META ชิป "เคยคืนเครื่อง" + dialog ห้ามติดมือ + filter รายชื่อ

**Files:**
- Modify: `apps/web/src/pages/CollectionsPage/hooks/useCustomerTags.ts:5` (union)
- Modify: `apps/web/src/pages/CollectionsPage/components/CustomerTagChips.tsx:1-9` (import), `:11-18` (doc), `:29-55` (META)
- Modify: `apps/web/src/pages/CollectionsPage/components/CustomerTagDialog.tsx:33-59` (ALL_TAGS → export + AUTO_ONLY_TAGS), `:106-131` (remove button)
- Modify: `apps/web/src/pages/CustomersPage/components/ProspectFilterBar.tsx:30-36` (TAG_LABELS)
- Test: `apps/web/src/pages/CollectionsPage/components/CustomerTagChips.test.tsx` (เพิ่ม 1 เทสต์)
- Test: `apps/web/src/pages/CollectionsPage/components/CustomerTagDialog.test.tsx` (ใหม่)

**Interfaces:**
- Consumes: Phase 2 `CustomerTagType` += `RETURNED_DEVICE` (Prisma enum) + กฎ AUTO ใน `evaluateAutoTags` + `AUTO_MANAGED_TAGS`
- Produces: `CustomerTagType` (web) += `'RETURNED_DEVICE'`; `META.RETURNED_DEVICE` label `'เคยคืนเครื่อง'`; `MANUAL_TAG_OPTIONS` (rename ของ `ALL_TAGS`, export) + `AUTO_ONLY_TAGS`

**คำตัดสิน (AUTO-managed):** `RETURNED_DEVICE` **ไม่อยู่ในรายการติดมือ** ของ `CustomerTagDialog` และปุ่มถอดถูกปิดสำหรับ tag นี้ — เหตุผล: กฎอยู่ที่ `evaluateAutoTags` (มีใบรับคืน/รายการยึดจริง); `recomputeForCustomer` ถอดเฉพาะแถว `source: 'AUTO'` (`customer-tags.service.ts:127-131`) ⇒ tag ที่ติดมือ (`MANUAL`) จะ**ค้างถาวรโดยไม่มีหลักฐาน** และแถว AUTO ที่ถอดมือจะถูก recompute รายคืนติดกลับทันที — ทั้งสองทางเป็นทางที่ "ทำแล้วไม่ได้ผลจริง" ตามกติกา `.claude/rules/coding-standards.md` จึงไม่โฆษณาบนหน้าจอ. ชิปยังแสดงได้ทุกที่ที่ใช้ `CustomerTagChips` (CustomersPage, DetailHeader, ContractCard, Customer360Panel) โดยอัตโนมัติจาก META.

- [ ] **Step 1: Write the failing test**

เพิ่มท้าย `apps/web/src/pages/CollectionsPage/components/CustomerTagChips.test.tsx` ก่อน `});` ปิด describe:

```tsx
  it('renders the AUTO tag "เคยคืนเครื่อง" (RETURNED_DEVICE — ใบรับเครื่องคืน 2026-09-20) with token classes', () => {
    render(<CustomerTagChips tags={[{ tag: 'RETURNED_DEVICE' }]} />);
    const chip = screen.getByTestId('customer-tag-chip-RETURNED_DEVICE');
    expect(chip).toHaveTextContent('เคยคืนเครื่อง');
    expect(chip.className).toMatch(/bg-warning\/10/);
    expect(chip.className).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
```

สร้าง `apps/web/src/pages/CollectionsPage/components/CustomerTagDialog.test.tsx`:

```tsx
/**
 * CustomerTagDialog กับ tag AUTO-only `RETURNED_DEVICE` (ใบรับเครื่องคืน 2026-09-20):
 * ไม่อยู่ในรายการติดมือ และปุ่มถอดปิด (recompute รายคืนจะติดกลับเมื่อยังมีใบรับคืน/รายการยึด)
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../hooks/useCustomerTags', () => ({
  useCustomerTags: () => ({
    data: [
      {
        id: 't-ret',
        customerId: 'cu1',
        tag: 'RETURNED_DEVICE',
        source: 'AUTO',
        reason: 'AUTO: เคยคืน/ถูกยึดเครื่อง',
        appliedByUserId: null,
        createdAt: '2026-09-20T03:00:00.000Z',
      },
      {
        id: 't-vip',
        customerId: 'cu1',
        tag: 'VIP',
        source: 'MANUAL',
        reason: null,
        appliedByUserId: 'u1',
        createdAt: '2026-09-01T03:00:00.000Z',
      },
    ],
    isLoading: false,
  }),
  useApplyCustomerTag: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveCustomerTag: () => ({ mutate: vi.fn(), isPending: false }),
}));

import CustomerTagDialog, { AUTO_ONLY_TAGS, MANUAL_TAG_OPTIONS } from './CustomerTagDialog';

describe('CustomerTagDialog — RETURNED_DEVICE เป็น AUTO-only', () => {
  it('ไม่อยู่ในตัวเลือกติดมือ แต่ยังอยู่ในกลุ่ม AUTO-only', () => {
    expect(MANUAL_TAG_OPTIONS.map((t) => t.value)).not.toContain('RETURNED_DEVICE');
    expect(MANUAL_TAG_OPTIONS.map((t) => t.value)).toEqual([
      'VIP',
      'HIGH_RISK',
      'NEW',
      'LOYAL',
      'BLACKLIST',
    ]);
    expect(AUTO_ONLY_TAGS).toEqual(['RETURNED_DEVICE']);
  });

  it('แสดงชิป เคยคืนเครื่อง และปิดปุ่มถอดเฉพาะ tag นี้ (VIP ถอดได้)', () => {
    render(<CustomerTagDialog open onClose={() => {}} customerId="cu1" />);
    expect(screen.getByText('เคยคืนเครื่อง')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ลบ RETURNED_DEVICE' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ลบ VIP' })).toBeEnabled();
    expect(screen.getByText(/ติดอัตโนมัติจากใบรับเครื่องคืน\/รายการยึด/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/pages/CollectionsPage/components/CustomerTagChips.test.tsx src/pages/CollectionsPage/components/CustomerTagDialog.test.tsx`
Expected: FAIL — `META[tag]` เป็น undefined → `Cannot read properties of undefined (reading 'icon')`; dialog test: `MANUAL_TAG_OPTIONS` is not exported

- [ ] **Step 3: Write minimal implementation**

แก้ `apps/web/src/pages/CollectionsPage/hooks/useCustomerTags.ts` บรรทัด 5 — เดิม:
```ts
export type CustomerTagType = 'VIP' | 'HIGH_RISK' | 'NEW' | 'LOYAL' | 'BLACKLIST';
```
ใหม่:
```ts
/** ตรง Prisma enum `CustomerTagType` — `RETURNED_DEVICE` = AUTO-only (ใบรับเครื่องคืน/รายการยึด, 2026-09-20) */
export type CustomerTagType =
  | 'VIP'
  | 'HIGH_RISK'
  | 'NEW'
  | 'LOYAL'
  | 'BLACKLIST'
  | 'RETURNED_DEVICE';
```

แก้ `apps/web/src/pages/CollectionsPage/components/CustomerTagChips.tsx`:

บรรทัด 1-9 — เดิม:
```tsx
import {
  Crown,
  AlertTriangle,
  Sparkles,
  Heart,
  Ban,
  Tag,
} from 'lucide-react';
import type { CustomerTagType } from '../hooks/useCustomerTags';
```
ใหม่:
```tsx
import {
  Crown,
  AlertTriangle,
  Sparkles,
  Heart,
  Ban,
  PackageX,
  Tag,
} from 'lucide-react';
import type { CustomerTagType } from '../hooks/useCustomerTags';
```

บรรทัด 11-18 doc comment — เดิม:
```tsx
/**
 * Read-only chip row for the 5 customer tag types. Keeps semantic tokens
```
ใหม่:
```tsx
/**
 * Read-only chip row for the 6 customer tag types (5 เดิม + RETURNED_DEVICE
 * "เคยคืนเครื่อง" AUTO-only ตั้งแต่ 2026-09-20). Keeps semantic tokens
```

บรรทัด 50-55 (ท้าย META) — เดิม:
```tsx
  BLACKLIST: {
    label: 'BLACKLIST',
    icon: Ban,
    className: 'bg-destructive/10 text-destructive border-destructive/30',
  },
};
```
ใหม่:
```tsx
  BLACKLIST: {
    label: 'BLACKLIST',
    icon: Ban,
    className: 'bg-destructive/10 text-destructive border-destructive/30',
  },
  // AUTO-only: ลูกค้ามีใบรับเครื่องคืน (PENDING_CONFIRM/CONFIRMED) หรือแถว Repossession —
  // กฎอยู่ที่ customer-tags.service evaluateAutoTags (spec 2026-09-20 §5.6)
  RETURNED_DEVICE: {
    label: 'เคยคืนเครื่อง',
    icon: PackageX,
    className: 'bg-warning/10 text-warning border-warning/30',
  },
};
```

แก้ `apps/web/src/pages/CollectionsPage/components/CustomerTagDialog.tsx`:

บรรทัด 33 — เดิม:
```tsx
const ALL_TAGS: { value: CustomerTagType; label: string; help: string }[] = [
```
ใหม่:
```tsx
/**
 * tag ที่ติดมือได้ — ไม่รวม `RETURNED_DEVICE`: กฎอยู่ที่ evaluateAutoTags (มีใบรับเครื่องคืน/
 * รายการยึดจริง) และ recompute ถอดเฉพาะแถว AUTO ⇒ ติดมือ = ค้างถาวรโดยไม่มีหลักฐาน,
 * ถอดมือ = ติดกลับคืนนี้. ห้ามโฆษณาทางที่ทำแล้วไม่ได้ผลจริง (.claude/rules/coding-standards.md)
 */
export const AUTO_ONLY_TAGS: CustomerTagType[] = ['RETURNED_DEVICE'];

export const MANUAL_TAG_OPTIONS: { value: CustomerTagType; label: string; help: string }[] = [
```

บรรทัด 149-153 (`ALL_TAGS.map` ใน SelectContent) — เดิม:
```tsx
                    {ALL_TAGS.map((t) => (
```
ใหม่:
```tsx
                    {MANUAL_TAG_OPTIONS.map((t) => (
```

บรรทัด 158 — เดิม:
```tsx
                    {ALL_TAGS.find((t) => t.value === selectedTag)?.help}
```
ใหม่:
```tsx
                    {MANUAL_TAG_OPTIONS.find((t) => t.value === selectedTag)?.help}
```

บรรทัด 107-129 (รายการ tag ปัจจุบัน) — เดิม:
```tsx
                {tags.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2"
                  >
                    <div className="flex flex-col gap-1 min-w-0">
                      <CustomerTagChips tags={[{ tag: t.tag }]} compact />
                      <div className="text-2xs text-muted-foreground leading-snug truncate">
                        {t.source} {t.reason ? `· ${t.reason}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemove(t.id)}
                      disabled={remove.isPending}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      title="ลบ tag นี้"
                      aria-label={`ลบ ${t.tag}`}
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
```
ใหม่:
```tsx
                {tags.map((t) => {
                  const autoOnly = AUTO_ONLY_TAGS.includes(t.tag);
                  return (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2"
                    >
                      <div className="flex flex-col gap-1 min-w-0">
                        <CustomerTagChips tags={[{ tag: t.tag }]} compact />
                        <div className="text-2xs text-muted-foreground leading-snug truncate">
                          {t.source} {t.reason ? `· ${t.reason}` : ''}
                        </div>
                        {autoOnly && (
                          <div className="text-2xs text-muted-foreground leading-snug">
                            ติดอัตโนมัติจากใบรับเครื่องคืน/รายการยึด — ถอดมือไม่ได้ (recompute จะติดกลับ)
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemove(t.id)}
                        disabled={remove.isPending || autoOnly}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                        title={autoOnly ? 'tag อัตโนมัติ — ถอดมือไม่ได้' : 'ลบ tag นี้'}
                        aria-label={`ลบ ${t.tag}`}
                      >
                        <X className="size-4" />
                      </button>
                    </li>
                  );
                })}
```

แก้ `apps/web/src/pages/CustomersPage/components/ProspectFilterBar.tsx` บรรทัด 30-36 — เดิม:
```ts
const TAG_LABELS: Record<string, string> = {
  VIP: 'VIP',
  HIGH_RISK: 'เสี่ยงสูง',
  NEW: 'ลูกค้าใหม่',
  LOYAL: 'ลูกค้าประจำ',
  BLACKLIST: 'BLACKLIST',
};
```
ใหม่:
```ts
const TAG_LABELS: Record<string, string> = {
  VIP: 'VIP',
  HIGH_RISK: 'เสี่ยงสูง',
  NEW: 'ลูกค้าใหม่',
  LOYAL: 'ลูกค้าประจำ',
  BLACKLIST: 'BLACKLIST',
  // D5 (2026-09-20): ประวัติ "เคยคืนเครื่อง" ต้องเห็นบนรายชื่อ — กรองได้จากตัวเลือกนี้
  RETURNED_DEVICE: 'เคยคืนเครื่อง',
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/pages/CollectionsPage/components/CustomerTagChips.test.tsx src/pages/CollectionsPage/components/CustomerTagDialog.test.tsx src/pages/CustomersPage`
Expected: PASS (snapshot "full render of all 5 tag types" ไม่เปลี่ยน — ยังส่ง 5 tag เดิม; ถ้า vitest รายงาน obsolete/updated snapshot ให้ตรวจว่าไม่ได้แก้ชิปเดิม)

- [ ] **Step 5: Checkpoint**

Run `./tools/check-types.sh web` — Expected: 0 errors (ไฟล์ที่ import `CustomerTagType` อีก 2 ไฟล์ — `CustomerDetailPage/types.ts`, `CustomersPage/types.ts` — ใช้เป็น type เฉย ๆ ไม่ต้องแก้). **Do NOT commit** (see Global Constraints).

---

### Task 12: เมนู — 4 ป้าย `'ยึดคืนเครื่อง'` → `'รับเครื่องคืน / ยึดคืน'` (path เดิม)

**Files:**
- Modify: `apps/web/src/config/menu.ts:278` (BRANCH_MANAGER_CONFIG), `:377` (FINANCE_MANAGER_CONFIG), `:522` (ACCOUNTANT_CONFIG), `:715` (OWNER_CONFIG)
- Test: `apps/web/src/config/menu.test.ts` (เพิ่ม describe)

**Interfaces:**
- Consumes: `getMenuConfig(role): RoleMenuConfig { sidebar: MenuSection[]; bottomNav }`, `MenuItem { label, path, children? }`
- Produces: ป้ายเมนูใหม่ทั้ง 4 role ที่มี `/repossessions` (SALES ไม่มีเมนูและไม่มี route — ไม่แตะ)

- [ ] **Step 1: Write the failing test**

แก้ `apps/web/src/config/menu.test.ts` บรรทัด 3 — เดิม:
```ts
import { getSidebarForRole, getZoneConfigForRole, resolveZoneForPath } from './menu';
```
ใหม่:
```ts
import { getMenuConfig, getSidebarForRole, getZoneConfigForRole, resolveZoneForPath } from './menu';
```

เพิ่มท้ายไฟล์:
```ts

describe('เมนู /repossessions — ป้าย "รับเครื่องคืน / ยึดคืน" (ใบรับเครื่องคืน 2026-09-20 §7)', () => {
  const flatItems = (role: string) =>
    getMenuConfig(role).sidebar.flatMap((s) => s.items.flatMap((i) => [i, ...(i.children ?? [])]));

  it.each(['BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'OWNER'])(
    '%s: รายการ /repossessions ใช้ป้ายใหม่ path เดิม',
    (role) => {
      const repo = flatItems(role).filter((i) => i.path === '/repossessions');
      expect(repo).toHaveLength(1);
      expect(repo[0].label).toBe('รับเครื่องคืน / ยึดคืน');
    },
  );

  it('ไม่มีป้ายเก่า "ยึดคืนเครื่อง" เหลืออยู่ในทุก role', () => {
    for (const role of ['SALES', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'OWNER', 'VIEWER']) {
      expect(flatItems(role).map((i) => i.label)).not.toContain('ยึดคืนเครื่อง');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/config/menu.test.ts`
Expected: FAIL — `expected 'ยึดคืนเครื่อง' to be 'รับเครื่องคืน / ยึดคืน'`

- [ ] **Step 3: Write minimal implementation**

แก้ `apps/web/src/config/menu.ts` — ทั้ง 4 บรรทัด (278, 377, 522, 715) เป็นข้อความเดียวกันทุกไบต์; แทนทุกครั้งที่พบ (replace all):

เดิม:
```ts
        { label: 'ยึดคืนเครื่อง', path: '/repossessions', icon: Lock },
```
ใหม่:
```ts
        { label: 'รับเครื่องคืน / ยึดคืน', path: '/repossessions', icon: Lock },
```

ตรวจ:
```bash
cd "D:/BESTCHOICE APP/BESTCHOICE-device-return" && grep -c "รับเครื่องคืน / ยึดคืน" apps/web/src/config/menu.ts && (grep -n "ยึดคืนเครื่อง" apps/web/src/config/menu.ts || echo "OK: old label gone")
```
Expected: `4` แล้ว `OK: old label gone`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run src/config/menu.test.ts src/config`
Expected: PASS (รวม `route-reachability.test.ts` เดิม — path ไม่เปลี่ยน)

- [ ] **Step 5: Checkpoint**

Run `./tools/check-types.sh web` — Expected: 0 errors. **Do NOT commit** (see Global Constraints).

---

### Task 13: การเดินทางลูกค้า — ป้าย kind `DEVICE_RETURNED` = "คืนเครื่อง" (ตรวจ Phase 2 แล้วเติมเฉพาะที่ขาด)

**Files:**
- Verify/Modify: `apps/api/src/modules/customer-journey/sources/entries.source.ts:15-28` (`VIEWS`), `:33` (`TAG_LABELS`)
- Verify/Modify: `apps/api/src/modules/customer-journey/sources/entries.source.spec.ts:57` (expected kind IN-list)

**Interfaces:**
- Consumes: Phase 2 `JOURNEY_ENTRY_KINDS.SYSTEM` += `'DEVICE_RETURNED'` (`packages/shared/src/customer-journey.ts`) + zod schema `DEVICE_RETURNED` ใน `journey-data-schemas.ts`
- Produces: `VIEWS.DEVICE_RETURNED = { group: 'sale', stage: null, title: 'คืนเครื่อง' }`, `TAG_LABELS.RETURNED_DEVICE = 'เคยคืนเครื่อง'`

**ทำไมไม่แตะ `JourneyTab.tsx`:** แท็บการเดินทางฝั่ง web ไม่มี map kind → ป้าย — `JourneyTab.tsx:16-27` render `event.title` ที่ API สร้างจาก `VIEWS` ใน `entries.source.ts` (`Record<ShownKind, …>` exhaustive ⇒ เมื่อ Phase 2 เพิ่ม kind ใน shared, ไฟล์นี้ต้องมีแถว `DEVICE_RETURNED` ไม่งั้น type-check API ล้ม). ป้ายกลุ่ม (`GROUP_EVENT_STYLES.sale.typeLabel = 'ขาย/สัญญา'`) มีอยู่แล้ว. Task นี้จึงเป็น **verify-or-add**: ถ้า Phase 2 ใส่แล้ว (ตามที่ประสานไว้) ให้ผ่านทั้ง 3 ข้อโดยไม่แก้อะไร.

- [ ] **Step 1: Write the failing test (ตรวจก่อน)**

```bash
cd "D:/BESTCHOICE APP/BESTCHOICE-device-return" && grep -n "DEVICE_RETURNED" apps/api/src/modules/customer-journey/sources/entries.source.ts packages/shared/src/customer-journey.ts apps/api/src/modules/customer-journey/journey-data-schemas.ts && grep -n "RETURNED_DEVICE" apps/api/src/modules/customer-journey/sources/entries.source.ts || echo "MISSING"
```
Expected ถ้า Phase 2 ครบ: พบ `DEVICE_RETURNED` ทั้ง 3 ไฟล์ + `RETURNED_DEVICE` ใน `entries.source.ts` → ข้ามไป Step 4. ถ้าพิมพ์ `MISSING` (หรือ `entries.source.ts` ไม่มี `DEVICE_RETURNED`) → ทำ Step 2-3.

แก้ `apps/api/src/modules/customer-journey/sources/entries.source.spec.ts` บรรทัด 57 — เดิม:
```ts
    expect(args.where.kind).toEqual({ in: ['CONTRACT_ACTIVATED', 'CONTRACT_REVIEWED', 'CREDIT_AI_SCORED', 'BOT_HANDOFF', 'CONTACT_ADDED', 'LINE_LINKED', 'PRODUCT_LINK_CLICK', 'PLACEHOLDER_MERGED', 'TOUCHPOINT', 'HEARD_FROM', 'MARKED_LOST', 'REOPENED'] });
```
ใหม่:
```ts
    expect(args.where.kind).toEqual({ in: ['CONTRACT_ACTIVATED', 'CONTRACT_REVIEWED', 'DEVICE_RETURNED', 'CREDIT_AI_SCORED', 'BOT_HANDOFF', 'CONTACT_ADDED', 'LINE_LINKED', 'PRODUCT_LINK_CLICK', 'PLACEHOLDER_MERGED', 'TOUCHPOINT', 'HEARD_FROM', 'MARKED_LOST', 'REOPENED'] });
```

เพิ่มเทสต์ท้าย `describe('entriesSource', ...)` ก่อน `});` ปิด:
```ts
  it('DEVICE_RETURNED (ใบรับเครื่องคืน 2026-09-20): กลุ่ม sale, ป้าย "คืนเครื่อง", ลิงก์สัญญา, metadata ผ่าน whitelist', async () => {
    const prisma = db();
    prisma.customerJourneyEntry.findMany.mockResolvedValue([
      entry({ id: 'ret', kind: 'DEVICE_RETURNED', occurredAt: at('2026-09-19T03:00:00.000Z'), refType: 'contract', refId: 'k7', actorUser: { id: 'u-fm', name: 'ผจก.การเงิน' }, data: { docNumber: 'DR-20260919-0001', contractNumber: 'CT-7', returnKind: 'VOLUNTARY', returnReason: 'UNAFFORDABLE' } }),
    ]);
    prisma.customerTag.findMany.mockResolvedValue([
      { id: 'ret-tag', tag: 'RETURNED_DEVICE', source: 'AUTO', createdAt: at('2026-09-19T03:00:01.000Z'), deletedAt: null, appliedBy: null },
    ]);
    const events = await entriesSource(prisma as unknown as PrismaService, ['c1'], { limit: 30 }, { id: 'o1', role: 'OWNER' });
    expect(byId(events, 'entry-ret')).toMatchObject({ type: 'DEVICE_RETURNED', group: 'sale', stage: null, title: 'คืนเครื่อง', href: '/contracts/k7', actor: { type: 'STAFF', id: 'u-fm', name: 'ผจก.การเงิน' } });
    expect(byId(events, 'tag-ret-tag')).toMatchObject({ title: 'ติดแท็ก เคยคืนเครื่อง', actor: { type: 'SYSTEM' } });
  });
```
(เทสต์นี้ mock `JOURNEY_DATA_SCHEMAS` ที่หัวไฟล์ไว้เฉพาะ 2 kind — `DEVICE_RETURNED` ไม่มี schema ใน mock ⇒ `whitelisted()` คืน undefined ⇒ event ไม่มี `metadata` ซึ่งถูกต้องตาม `toMatchObject` ข้างบนที่ไม่ assert metadata; schema จริงถูกเทสต์ใน `journey-data-schemas.spec.ts` ของ Phase 2)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return" && npm --prefix apps/api test -- src/modules/customer-journey/sources/entries.source.spec.ts`
Expected (เฉพาะกรณี MISSING): FAIL — `entry-ret` ถูกทิ้งเพราะ `isShownKind` ไม่รู้จัก → `expected undefined to match object`

- [ ] **Step 3: Write minimal implementation (เฉพาะกรณี MISSING)**

แก้ `apps/api/src/modules/customer-journey/sources/entries.source.ts`:

บรรทัด 16-17 — เดิม:
```ts
  CONTRACT_ACTIVATED: { group: 'sale', stage: 'PURCHASED', title: 'เริ่มผ่อนสัญญา' },
  CONTRACT_REVIEWED: { group: 'sale', stage: 'CREDIT', title: 'ผู้จัดการตรวจสัญญา' },
```
ใหม่:
```ts
  CONTRACT_ACTIVATED: { group: 'sale', stage: 'PURCHASED', title: 'เริ่มผ่อนสัญญา' },
  CONTRACT_REVIEWED: { group: 'sale', stage: 'CREDIT', title: 'ผู้จัดการตรวจสัญญา' },
  // ใบรับเครื่องคืนที่ FINANCE ยืนยันแล้ว (spec 2026-09-20 §5.6) — ป้ายตาม §7 "คืนเครื่อง"
  DEVICE_RETURNED: { group: 'sale', stage: null, title: 'คืนเครื่อง' },
```

บรรทัด 33 — เดิม:
```ts
const TAG_LABELS: Record<string, string> = { VIP: 'VIP', HIGH_RISK: 'เสี่ยงสูง', NEW: 'ลูกค้าใหม่', LOYAL: 'ลูกค้าประจำ', BLACKLIST: 'BLACKLIST' };
```
ใหม่:
```ts
const TAG_LABELS: Record<string, string> = { VIP: 'VIP', HIGH_RISK: 'เสี่ยงสูง', NEW: 'ลูกค้าใหม่', LOYAL: 'ลูกค้าประจำ', BLACKLIST: 'BLACKLIST', RETURNED_DEVICE: 'เคยคืนเครื่อง' };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return" && npm --prefix apps/api test -- src/modules/customer-journey/sources/entries.source.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Checkpoint**

Run `./tools/check-types.sh api` — Expected: 0 errors. **Do NOT commit** (see Global Constraints).

---

### Task 14: เอกสาร `.claude/rules/accounting.md` — หัวข้อใหม่ "ใบรับเครื่องคืน (DeviceReturn)" + แก้จุดที่กลายเป็นเท็จ

**Files:**
- Modify: `.claude/rules/accounting.md:130` (แถว JP5 ในตาราง JE Templates), `:146-147` (บรรทัด Spec/โค้ดของหัวข้อยึดเครื่อง), `:168-179` (บล็อกขาคู่ SHOP), `:221-224` (ย่อหน้า "หน้ายึด/วิซาร์ด"), `:230-232` (แทรกหัวข้อย่อยใหม่ก่อน `---`), `:2292-2298` (Workbook Phase 1 ข้อ (3) ตารางประเภท 11-2107), `:2585-2586` (ท้ายหัวข้อ settle-cash)

**Interfaces:**
- Consumes: ชื่อไฟล์/endpoint/flow จริงหลัง Phase 1–2 (ตรวจด้วย grep ใน Step 1 ก่อนเขียน)
- Produces: กติกาบัญชีของใบรับเครื่องคืนที่ agent รุ่นถัดไปอ่านก่อนแตะ JP5/11-2107

เอกสารนี้ไม่มีเทสต์ — ขั้นตอนคือ ตรวจชื่อจริง → แก้ → grep ยืนยัน. ตัวเลขบรรทัดเป็นของ origin/main; ถ้า Phase 1–2 แก้ไฟล์นี้ไปแล้ว (เช่น เพิ่มหัวข้อ `settleDeductionCash`) ให้ค้นด้วยข้อความ "เดิม" แทนเลขบรรทัด และ**ไม่เขียนซ้ำ**ย่อหน้าที่มีเนื้อหาเดียวกันอยู่แล้ว.

- [ ] **Step 1: ตรวจชื่อจริงที่จะอ้างถึง**

```bash
cd "D:/BESTCHOICE APP/BESTCHOICE-device-return" && grep -n "settleDeductionCash\|DEVICE_RETURN_CASH_SHOP_FLOW\|interco-device-return-cash-shop" apps/api/src/modules/interco-settlement/interco-settlement.service.ts | head -5 && grep -n "assertRepossessionPeriodsOpen\|async createInTx" apps/api/src/modules/repossessions/repossessions.service.ts | head -3 && grep -n "device-returns/:contractId/settle-cash\|device-returns/:contractId" apps/api/src/modules/interco-settlement/interco-settlement.controller.ts | head -2 && ls apps/api/src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts apps/api/src/modules/device-returns/__tests__/device-return-flow.integration.spec.ts
```
Expected: ทุก grep พบ; ทั้งสองไฟล์ integration มีอยู่ (ถ้าชื่อไฟล์เทสต์ต่างจากนี้ ให้ใช้ชื่อจริงในข้อความด้านล่าง)

- [ ] **Step 2: แก้ 7 จุด**

(A) บรรทัด 130 — เดิม:
```
| `RepossessionJP5Template` | Repossession | Loss branch: Dr 51-1102; Gain branch: Cr 41-1102; `Dr <deposit>` = **ราคาประเมิน** (ราคาเดียว 2026-09-05). optional `input.customerRefund` → Cr 21-1107 ยังอยู่ใน template แต่ **caller ไม่ส่งอีกแล้ว** (`create()` ปฏิเสธ `customerRefundEnabled=true` — คำตัดสินเจ้าของ 2026-09-05 supersede 2026-08-08 ข้อ 2) |
```
ใหม่:
```
| `RepossessionJP5Template` | ยืนยันใบรับเครื่องคืน (`DeviceReturnsService.confirm` → `RepossessionsService.createInTx`; `create()` + `POST /repossessions` ถูกลบ 2026-09-20) | Loss branch: Dr 51-1102; Gain branch: Cr 41-1102; `Dr <deposit>` = **ราคาประเมิน** (ราคาเดียว 2026-09-05) ลง **`11-2107` เสมอ stamp `shopReceivableType: 'DEVICE_RETURN'` + `deviceReturnId`** (2026-09-20 — ไม่มีโหมดโอนสด/`collectedByShop` อีก). optional `input.customerRefund` → Cr 21-1107 ยังอยู่ใน template แต่ **caller ไม่ส่งอีกแล้ว** (คำตัดสินเจ้าของ 2026-09-05 supersede 2026-08-08 ข้อ 2) |
```

(B) บรรทัด 146-147 — เดิม:
```
Spec: `docs/superpowers/specs/2026-09-05-repossession-single-price-design.md` · โค้ด:
`repossessions.service.ts` (`previewCalculation` / `create`), `RepossessionOverlay.tsx`
```
ใหม่:
```
Spec: `docs/superpowers/specs/2026-09-05-repossession-single-price-design.md` · โค้ด:
`repossessions.service.ts` (`previewCalculation` / `createInTx` — `create()` ถูกลบ 2026-09-20 ทางเข้าเดียวคือ
`DeviceReturnsService.confirm`), `RepossessionOverlay.tsx` (โหมดยืนยันอย่างเดียว — ดูหัวข้อย่อย "ใบรับเครื่องคืน
(DeviceReturn)" ท้ายส่วนนี้)
```

(C) บรรทัด 168-179 — เดิม:
````
**ขาคู่ฝั่ง SHOP ของการยึด (ทำแล้ว 2026-09-05 — ปิด "ASYMMETRY ที่รู้ตัว" ต้นทาง JP5):**
`ShopCollectShopLegs` (`cpa-templates/shop-collect-shop-legs.template.ts`, ไม่ใช่ Nest provider —
สร้างภายในผู้เรียก) โพสต์ใน tx เดียวกับ JP5 (`RepossessionsService.create`):

```
Dr S11-2002 สินค้าคงคลัง-มือถือมือสอง        [ราคาประเมิน]
   Cr S21-1104 เจ้าหนี้ FINANCE                 [ราคาประเมิน]   ← collectedByShop (FINANCE Dr 11-2107) · stamp SHOP_COLLECT
   Cr S11-1202 ธนาคาร SHOP (จ่าย)               [ราคาประเมิน]   ← หน้าร้านโอนให้ FINANCE ทันที (FINANCE Dr KBank) · ไม่ stamp
```
flow `shop-repossession-intake`, key `shop-repossession-intake:<contractId>`, `metadata.contractId`.
`create()` ตรวจ `validatePeriodOpen` ของ **ทั้งสองบริษัท** และ flip `product.ownedByCompanyId` → SHOP +
`category PHONE_NEW → PHONE_USED` (ขายต่อผ่าน POS จึงลง Cr S11-2002 ถูกบัญชี).
````
ใหม่:
````
**ขาคู่ฝั่ง SHOP ของการยึด (ทำแล้ว 2026-09-05 — ปิด "ASYMMETRY ที่รู้ตัว" ต้นทาง JP5; เหลือรูปเดียว 2026-09-20):**
`ShopCollectShopLegs.postRepossessionIntake` (`cpa-templates/shop-collect-shop-legs.template.ts`, ไม่ใช่ Nest provider —
สร้างภายในผู้เรียก) โพสต์ใน tx เดียวกับ JP5 (`RepossessionsService.createInTx`):

```
Dr S11-2002 สินค้าคงคลัง-มือถือมือสอง        [ราคาประเมิน]
   Cr S21-1104 เจ้าหนี้ FINANCE                 [ราคาประเมิน]   ← เสมอ (FINANCE Dr 11-2107) · stamp DEVICE_RETURN + contractId + productId + deviceReturnId
```
flow `shop-repossession-intake`, key `shop-repossession-intake:<contractId>`, `metadata.contractId`.
**สาขา `Cr S11-1202` (หน้าร้านโอนให้ FINANCE ทันที, ไม่ stamp) ถูกลบ 2026-09-20** — วันยึด/รับคืนไม่มีเงินโอนจริง
(spec 2026-09-20 §1: ค่าเริ่มต้นเดิม `collectedByShop=false` ทำให้ยอดธนาคาร FINANCE เกินจริงเท่าราคาประเมิน) · stamp
`SHOP_COLLECT` บนขานี้เปลี่ยนเป็น `DEVICE_RETURN` (แถวยึดก่อน 2026-09-20 ยังเป็น `SHOP_COLLECT` — forward-only).
`createInTx` ตรวจ `validatePeriodOpen` ของ **ทั้งสองบริษัท** (`assertRepossessionPeriodsOpen` ก่อนเปิด tx) และ flip
`product.ownedByCompanyId` → SHOP + `category PHONE_NEW → PHONE_USED` + **`branchId = receivingBranchId`** (ขายต่อผ่าน
POS จึงลง Cr S11-2002 ถูกบัญชี และเครื่องอยู่ที่สาขาที่รับจริง — D7).
````

(D) บรรทัด 221-224 — เดิม:
```
**หน้ายึด/วิซาร์ด:** `previewCalculation` คืน `eligibility {canRepossess, reason}` (สถานะสัญญา + strict
mode กติกาเดียวกับ `create()`) → overlay โชว์แบนเนอร์ + ปิดปุ่มยืนยัน แทนปล่อยชน 400 · `findAll` คืน
`shopCollectOutstanding` (11-2107 SHOP_COLLECT ต่อสัญญาผ่าน `shopCollectTypedBalance`) → ปุ่ม
"รับโอนหน้าร้าน" โชว์เฉพาะแถวที่ยังมียอด และเติมยอดนั้นให้.
```
ใหม่:
```
**หน้ายึด/ใบรับเครื่องคืน:** `previewCalculation(contractId, { deviceReturnId, discountPct })` คืน `eligibility
{canRepossess, reason}` (สถานะสัญญา + strict mode + ยอดค้าง กติกาเดียวกับ `createInTx`; เกรด/ราคาประเมิน/เหตุผลอ่านจาก
ใบรับเครื่องคืน) → `RepossessionOverlay` โหมดยืนยันโชว์แบนเนอร์ + ปิดปุ่มยืนยัน แทนปล่อยชน 400 · `findAll` คืน
`shopCollectOutstanding` (11-2107 SHOP_COLLECT ต่อสัญญาผ่าน `shopCollectTypedBalance` — แถวยึดก่อน 2026-09-20) → ปุ่ม
"รับโอนหน้าร้าน" โชว์เฉพาะแถวที่ยังมียอด และเติมยอดนั้นให้ · และคืน `deviceReturnOutstanding` (11-2107 DEVICE_RETURN
net ของ POSTED deductions) → ป้าย "รอหักในรอบจ่าย" บนแถว (ล้างผ่านรอบจ่าย INTER-CO/รับเงินสด ไม่ใช่ปุ่มรับโอน).
```

(E) แทรกหัวข้อย่อยใหม่ — เดิม (ท้ายส่วน ก่อน `---`):
```
(`Dr <เงินสด SHOP ต่อสาขา> / Cr S21-1104`) ยังไม่ต่อ — รอตัดสินบัญชีเงินสด SHOP ต่อสาขา.

---
```
ใหม่:
````
(`Dr <เงินสด SHOP ต่อสาขา> / Cr S21-1104`) ยังไม่ต่อ — รอตัดสินบัญชีเงินสด SHOP ต่อสาขา.

### ใบรับเครื่องคืน (DeviceReturn) — สาขาบันทึก FINANCE ยืนยัน ค่าเครื่องหักในรอบจ่าย (2026-09-20)

Spec: `docs/superpowers/specs/2026-09-20-device-return-intake-design.md` · Plans:
`docs/superpowers/plans/2026-09-20-device-return-phase{1,2,3}-*.md` · โค้ด: `apps/api/src/modules/device-returns/` (ใบ),
`repossessions.service.ts` (`createInTx` / `assertRepossessionPeriodsOpen` — `create()` + `POST /repossessions` ถูกลบ),
`interco-settlement/*` (แถวหักประเภทที่ 3), web `apps/web/src/components/device-returns/*` + `RepossessionOverlay.tsx`
(โหมดยืนยันอย่างเดียว).

**คำตัดสินเจ้าของ (D1–D7, ปิดประเด็น — อย่าเสนอกลับ):** สาขา (OWNER/BM/SALES) บันทึก "ใบรับเครื่องคืน"
`DR-YYYYMMDD-NNNN` (`DeviceReturnNumberService` — advisory lock ต่อวัน BKK แบบ `IntercoBatchNumberService`) พร้อมเกรด/
ราคาประเมิน → **สัญญาหยุดทันทีที่รับคืน** (VOLUNTARY = สัญญา ACTIVE/OVERDUE/DEFAULT flip → `TERMINATED` เก็บ
`previousContractStatus` + audit `CONTRACT_STATUS_LEGAL` reason `DEVICE_RETURN_INTAKE` ใน tx; REPOSSESSION = สัญญา
`TERMINATED` อยู่แล้ว เหตุผลล็อก `AFTER_TERMINATION`; `jp5_require_terminated_status` คงไว้) → ลูกค้าได้ไลน์
`DEVICE_RETURNED` (ไม่มีลายเซ็น ไม่มีราคาในข้อความ; แม่แบบแก้ได้ที่ `/notifications`) → OWNER/FM กด **ยืนยัน** หนึ่งคลิก
= JP5 + ขาคู่ SHOP ใน tx เดียว (`DeviceReturnsService.confirm` → `RepossessionsService.createInTx`, CAS
`PENDING_CONFIRM → CONFIRMED` count 0 → 409) → ค่าเครื่องหักผ่านรอบจ่าย INTER-CO (แนวทาง A — ประเภทหักใหม่ ไม่ใช้แถว
เรียกคืนแทน) · รับได้ทุกสาขา ใบเก็บ `receivingBranchId` และเครื่องย้าย `branchId` ไปสาขาที่รับตอนยืนยัน · ส่งกลับ
(`reject`, OWNER/FM, เหตุผล 10–500) / ยกเลิก (`cancel`, OWNER/BM สาขาตัวเอง) คืนสถานะสัญญาเดิม + ไลน์
`DEVICE_RETURN_CANCELED`.

**JE ตอนยืนยัน — ขา Dr ของ JP5 = `11-2107` เสมอ stamp `shopReceivableType: 'DEVICE_RETURN'` (+ `deviceReturnId`,
`shopReceivable: '11-2107'`); ไม่มีโหมด "โอนสดวันยึด" อีกต่อไป:**

```
FINANCE — RepossessionJP5Template (deposit '11-2107', typeStamp DEVICE_RETURN)
  Dr 11-2107 ลูกหนี้-หน้าร้าน [ราคาประเมิน] + ขาล้าง 11-2101/11-2103/11-2105/11-2106/21-2102 + plug 41-1102/51-1102 ตามเดิม
SHOP — ShopCollectShopLegs.postRepossessionIntake (สาขา Cr S11-1202 ถูกลบ)
  Dr S11-2002 สินค้าคงคลัง-มือถือมือสอง [ราคาประเมิน]
     Cr S21-1104 เจ้าหนี้ FINANCE            [ราคาประเมิน]   ← stamp DEVICE_RETURN + contractId + productId + deviceReturnId
```
flow `shop-repossession-intake` เดิม. ราคาประเมิน 0 → JP5 ลง แต่ไม่มีใบรับเข้าสต็อก SHOP และไม่มีแถวหักในรอบจ่าย.
`SHOP_COLLECT_REPOSSESSION` audit ไม่เขียนอีก (แทนด้วย `DEVICE_RETURN_CONFIRMED` + metadata บน JE); audit `REPOSSESSION`
เดิมยังเขียนใน `createInTx`.

**ตัวเลขทอง (`interco-settlement/__tests__/interco-device-return.integration.spec.ts` — CSV กรณีที่ 5: 17,000/12 งวด
จ่าย 4 ยังไม่ accrual, ราคาประเมิน 7,000):** FINANCE `Dr 11-2107 7,000.00 · Dr 11-2106 4,000.00 · Dr 21-2102 793.32 ·
Dr 51-1102 5,126.68 / Cr 11-2101 11,333.36 · Cr 11-2105 793.32 · Cr 21-2101 793.32 · Cr 41-1101 4,000.00` (Σ 16,920.00)
· SHOP `Dr S11-2002 7,000.00 / Cr S21-1104 7,000.00`.

**ประเภท `DEVICE_RETURN` ครบทุกเลนส์** — ประกาศครั้งเดียว `SHOP_RECEIVABLE_TYPES` (`shop-receivable-type.util.ts`) และ
SQL ทุกตัวสร้าง IN-list จาก `Prisma.join`; **ไม่มี `FLOW_MAP` fallback** (แถวยึดเก่า flow เดียวกันที่ไม่มี stamp คือโหมด
โอนทันทีซึ่งไม่แตะ S21-1104 — ถ้าใส่ fallback จะถูกจัดเป็น DEVICE_RETURN โดยไม่มีหนี้จริง): `deviceReturnFinanceBalance` /
`deviceReturnShopBalance` (`interco-typed-balance.ts`, stamp-only) · `getPendingDeviceReturns()` +
`ReconcileTotals.glDeviceReturnTotal` · aging `deviceReturnGross` / `shopMirrorDeviceReturnGross` รวมใน `intercoNet` และ
`shopMirrorGross` (key `metadata.contractId`) + `negativeTypedFields` · `getTypedAccountDrift` ⇒ anti-drift = 0 หลัง
ยืนยันใบแรก (`device-returns/__tests__/device-return-flow.integration.spec.ts`).

**แถวหักประเภทที่ 3 ในรอบจ่าย INTER-CO (`InterCoItemType.DEVICE_RETURN`, คอลัมน์ `deviceReturnAmount`) — mirror ของ RECALL
ทุกจุด:** คิว `GET /interco-settlement/pending` คืน `{ pending, recalls, deviceReturns, reconcile }` (net = typed gross −
Σ `swapCreditAmount + recallAmount + deviceReturnAmount` ของ item ทุกประเภทใน batch POSTED; hydrate **ไม่กรอง**สถานะสัญญา
— เป็น `CLOSED_BAD_DEBT` โดยนิยาม) · `CreateBatchDto.deviceReturnContractIds` · guard สองสมุดต่างกัน > 0.01 → reject
`ยอดค่าเครื่องคืนสองสมุดไม่ตรงกัน สัญญา {no}` · clash เฉพาะ `itemType: 'DEVICE_RETURN'` · drift guard เทียบ live net ±0.01 ·
`buildFinanceLines` ข้าม Dr 21-1101/21-1102, `Cr 11-2107 [deviceReturnAmount]` "หักค่าเครื่องคืน {no}" · `buildShopLines`
`Dr S21-1104 [deviceReturnAmount]` "ล้างเจ้าหนี้ FINANCE-ค่าเครื่องคืน {no}" · metadata `items[]` เพิ่ม `type: 'DEVICE_RETURN'`,
`deviceReturn: '<2dp>'` (**ไม่ stamp** top-level `contractId`/`shopReceivableType` — สถาปัตยกรรม "เลนส์ gross + item gate"
เดิม) · `alarmNettingResiduals` รวม 3 ประเภทต่อสมุด − Σ deduction ทุก itemType · reverse = mirror สองใบ แถวกลับเข้าคิวเอง
ผ่าน gate. รอบถัดไปจ่ายสัญญา Y (10,000 + 1,000) เลือกแถว X: FINANCE `Dr 21-1101 10,000 · Dr 21-1102 1,000 / Cr 11-2107
7,000 · Cr 11-1201 4,000`; SHOP `Dr S21-1104 7,000 · Dr S11-1201 4,000 / Cr S11-3001 10,000 · Cr S11-3002 1,000` — หลัง
approve typed gross ยังเป็น 7,000 (ขาหักไม่ stamp) แต่คิว = 0, residual = 0, drift = 0, X หลุดคิว; reverse → X กลับเข้าคิว
ที่ 7,000. ทางรับเงินสดสำรอง: `POST /interco-settlement/device-returns/:contractId/settle-cash` (OWNER/FM —
`settleDeductionCash(contractId, 'DEVICE_RETURN', dto, userId)`; ดูหัวข้อ "เส้นทางรับเงินสดคืน (Task 6)").

**ด่านกันล้างซ้ำสองทาง (`ShopCollectSettlementTemplate.execute`, หลัง requestId idempotency ก่อนคำนวณยอดค้าง):**
`typeStamp !== 'DEVICE_RETURN'` และ `deviceReturnFinanceBalance(contractId) > 0` → 400 "สัญญานี้มีค่าเครื่องคืนที่ต้องหัก
ผ่านรอบจ่าย INTER-CO — ใช้หน้าจ่ายให้หน้าร้าน รายการค่าเครื่องคืน หรือปุ่มรับเงินสดในหน้านั้น" — ไม่งั้นใบรับโอน (stamp
SHOP_COLLECT) ล้าง 11-2107 โดยเลนส์ DEVICE_RETURN ไม่ลด → รอบจ่ายถัดไปหักซ้ำ. ปุ่ม "รับโอนหน้าร้าน" บน `/repossessions`
ยังโชว์เฉพาะแถวเก่าที่ `shopCollectOutstanding > 0`; แถวใหม่โชว์ป้าย "รอหักในรอบจ่าย" จาก `deviceReturnOutstanding`.

**`SHOP_COLLECT` เหลือต้นทางเดียวคือ JP4** (ปิดยอดหน้าร้านรับแทน) — ต้นทาง JP5 ถูกแทนด้วย `DEVICE_RETURN` ตั้งแต่
2026-09-20; แถวยึดที่ลงไปแล้วด้วย `SHOP_COLLECT` ล้างทางเดิม (forward-only ไม่ย้ายรายการ ไม่ backfill ใบรับคืน).

**หน้าจอ:** `/repossessions` (เมนู "รับเครื่องคืน / ยึดคืน") — ปุ่ม "บันทึกรับเครื่องคืน" (`DeviceReturnIntakeDialog`: ค้นสัญญา
`GET /device-returns/lookup?q=` + `GET /device-returns/preview` ให้ eligibility/kind/ราคาตาราง/±15% — **ไม่มีส่วนบัญชี**) ·
ตาราง "ใบรับเครื่องคืน — รอ FINANCE ยืนยัน" (`DeviceReturnList`: FINANCE ยืนยัน/ส่งกลับ/ส่งซ้ำไลน์, BM ยกเลิกใบสาขาตัวเอง) ·
รายการ "รอยึดเครื่อง" = `GET /device-returns/awaiting-repossession` ปุ่ม "รับเครื่องคืน" · `RepossessionOverlay` = **โหมดยืนยัน
อย่างเดียว** (prop `deviceReturnId` บังคับ; ข้อมูลใบอ่านอย่างเดียว; แก้ได้เฉพาะวันที่ลงบัญชี + ส่วนลดยอดปิด; preview
`GET /repossessions/preview/:contractId?deviceReturnId=&discountPct=`; ยืนยัน = `POST /device-returns/:id/confirm`, ส่งกลับ =
`POST /device-returns/:id/reject`) — ถอด CashAccountSelect/ช่องติ๊กลูกหนี้-หน้าร้าน/ปุ่มรับโอน/`POST /repossessions`; ชิป
"คืนเครื่อง" ในวิซาร์ดรับชำระถูกถอด · `ContractDetailPage` ป้าย "รับเครื่องคืนแล้ว รอ FINANCE ยืนยัน DR-…" + ปุ่ม
"รับเครื่องคืน" · INTER-CO `PendingTab` รายการที่ 3 "ค่าเครื่องคืน" + ปุ่ม "รับเงินสดค่าเครื่อง" (`RecallCashDialog
kind='DEVICE_RETURN'`) + `BatchDetailSheet` badge "ค่าเครื่องคืน" · tag AUTO `RETURNED_DEVICE` "เคยคืนเครื่อง" (ห้ามติด/
ถอดมือ — กฎที่ `evaluateAutoTags`) · journey kind `DEVICE_RETURNED` ป้าย "คืนเครื่อง" (`entries.source.ts` VIEWS).

**ที่ยังเปิดอยู่:** ยึดเครื่องเดิมซ้ำ (`Repossession.productId @unique`) · ส่วนลดยอดปิดของ JP5 ลงบัญชีหรือไม่ (รอผู้สอบ —
`docs/accounting/cpa-followup-2026-09-05.txt`; แจ้งวิธีใหม่ให้ผู้สอบทราบแล้วที่
`docs/accounting/cpa-followup-2026-09-20-device-return.txt`) · ไลน์เป็นข้อความธรรมดา (Flex ทีหลังผ่านแม่แบบเดียวกัน) ·
MDM ปลดอัตโนมัติตอนรับคืน · ขาคู่ SHOP ของ JP4 ปิดยอดหน้าร้านรับแทน (ยังไม่ต่อ — ข้างบน).

---
````

(F) บรรทัด 2292-2298 — เดิม:
```
  (3) **11-2107/S21-1104 reference types** — `metadata.shopReceivableType`
  (`SWAP_CREDIT` | `PAYOUT_RECALL` | `SHOP_COLLECT`) stamp ทุก JE ใหม่; แถวเก่า classify
  ตอนอ่านผ่าน `classifyShopReceivable()` (`apps/api/src/modules/journal/shop-receivable-type.util.ts`).
  จุดกำเนิด `SHOP_COLLECT` มี 2 ทาง (ตรงตาราง spec §2): JP4 ปิดยอดหน้าร้านรับแทน และ
  JP5 ยึดเครื่องหน้าร้านรับแทน (`repossession-jp5.template.ts` — ค้นพบระหว่าง implement,
  stamp แล้ว). ส่วนใบ settle (`shop-collect-settlement.template.ts` — Dr cash / Cr 11-2107)
  เป็น**จุดล้าง** ไม่ใช่จุดกำเนิด แต่ stamp `SHOP_COLLECT` ด้วย เพื่อให้ classify ครบทั้งสองขา.
```
ใหม่:
```
  (3) **11-2107/S21-1104 reference types** — `metadata.shopReceivableType`
  (`SWAP_CREDIT` | `PAYOUT_RECALL` | `SHOP_COLLECT` | **`DEVICE_RETURN`** ตั้งแต่ 2026-09-20 — ประกาศครั้งเดียวที่
  `SHOP_RECEIVABLE_TYPES` ใน `shop-receivable-type.util.ts`, SQL ทุกตัวสร้าง IN-list จาก `Prisma.join`) stamp ทุก JE ใหม่;
  แถวเก่า classify ตอนอ่านผ่าน `classifyShopReceivable()` (`apps/api/src/modules/journal/shop-receivable-type.util.ts`
  — `DEVICE_RETURN` **ไม่มี `FLOW_MAP` fallback**: แถวยึดเก่า flow `shop-repossession-intake` ที่ไม่มี stamp คือโหมด
  โอนทันทีซึ่งไม่แตะ S21-1104).
  จุดกำเนิด `SHOP_COLLECT` **เหลือทางเดียว (2026-09-20): JP4 ปิดยอดหน้าร้านรับแทน** — ต้นทาง JP5 ยึดเครื่องหน้าร้าน
  รับแทน (`repossession-jp5.template.ts`) ถูกแทนด้วย `DEVICE_RETURN` (ขา Dr 11-2107 ของ JP5 stamp `DEVICE_RETURN`
  เสมอ; แถวยึดก่อนหน้านั้นยัง `SHOP_COLLECT` ล้างทางเดิม). ส่วนใบ settle (`shop-collect-settlement.template.ts` —
  Dr cash / Cr 11-2107) เป็น**จุดล้าง** ไม่ใช่จุดกำเนิด แต่ stamp ตาม `typeStamp` (`SHOP_COLLECT` | `PAYOUT_RECALL` |
  `DEVICE_RETURN`) เพื่อให้ classify ครบทั้งสองขา — และมี**ด่านกันล้างซ้ำ**: `typeStamp !== 'DEVICE_RETURN'` แต่สัญญา
  มี `deviceReturnFinanceBalance > 0` → 400 (ดูหัวข้อ "ใบรับเครื่องคืน (DeviceReturn)" ในส่วนยึดเครื่อง).
```

(G) บรรทัด 2585-2586 — เดิม:
```
DB unique (P2002) แปลเป็น 409 ไทยทั้งคู่ — ไม่ใช่ raw 500. `typeStamp` default
`'SHOP_COLLECT'` บน template ⇒ caller เดิม (JP4 shop-collect settle) byte-identical.
```
ใหม่:
```
DB unique (P2002) แปลเป็น 409 ไทยทั้งคู่ — ไม่ใช่ raw 500. `typeStamp` default
`'SHOP_COLLECT'` บน template ⇒ caller เดิม (JP4 shop-collect settle) byte-identical.

**2026-09-20 — generalize เป็น `settleDeductionCash(contractId, type: 'PAYOUT_RECALL' | 'DEVICE_RETURN', dto, userId)`**
(`settleRecallCash` เหลือเป็น wrapper บาง ๆ ที่ส่ง `'PAYOUT_RECALL'`): route ใหม่
`POST /interco-settlement/device-returns/:contractId/settle-cash` (OWNER/FM, DTO เดียวกัน) — FINANCE ใช้
`ShopCollectSettlementTemplate` + `typeStamp: 'DEVICE_RETURN'`, SHOP flow `interco-device-return-cash-shop`
(`Dr S21-1104 / Cr <shopPayoutAccountCode>` stamp DEVICE_RETURN), guards ชุดเดียวกับ recall (คิว =
`getPendingDeviceReturns` ยอด net, item DEVICE_RETURN ใน batch เปิด → reject, สองสมุดตรง ±0.01, amount ≤ net + 0.01),
audit `INTERCO_DEVICE_RETURN_CASH_SETTLED`. UI: ปุ่ม "รับเงินสดค่าเครื่อง" ใน `PendingTab` รายการที่ 3 →
`RecallCashDialog kind='DEVICE_RETURN'`.
```

- [ ] **Step 3: ยืนยันด้วย grep**

```bash
cd "D:/BESTCHOICE APP/BESTCHOICE-device-return" && grep -c "ใบรับเครื่องคืน (DeviceReturn)" .claude/rules/accounting.md && grep -n "Cr S11-1202 ธนาคาร SHOP (จ่าย)" .claude/rules/accounting.md || echo "OK: stale S11-1202 branch gone" && grep -n "settleDeductionCash" .claude/rules/accounting.md | head -2
```
Expected: `>= 3` (หัวข้อ + อ้างอิง 2 จุด), `OK: stale S11-1202 branch gone`, พบ `settleDeductionCash`

- [ ] **Step 4: Checkpoint**

ไม่มีโค้ด — ตรวจว่า markdown ยัง render (heading `###` ใหม่อยู่ใต้ `## ยึดเครื่อง — ราคาเดียว` ก่อน `---`). **Do NOT commit** (see Global Constraints).

---

### Task 15: `.claude/rules/database.md` (partial unique + สถานะระหว่างรอ) + `.claude/CLAUDE.md` (Key Routes + Important Notes)

**Files:**
- Modify: `.claude/rules/database.md` (ต่อท้ายไฟล์ — หลังบรรทัด 443 บรรทัดสุดท้ายของหัวข้อ `"บันทึกขายผิด"`)
- Modify: `.claude/CLAUDE.md:257` (Collections & Risk), `:365-366` (Important Notes — แทรกบรรทัดแรกใต้หัวข้อ)

**Interfaces:**
- Consumes: migration/ชื่อ index ของ Phase 2 (`device_returns_one_open_per_contract`), predicate `noOpenDeviceReturnWhere()`, endpoints Phase 2
- Produces: กติกาความถูกต้องของข้อมูลของ `DeviceReturn` + route/notes ใน CLAUDE.md

- [ ] **Step 1: ตรวจชื่อจริง**

```bash
cd "D:/BESTCHOICE APP/BESTCHOICE-device-return" && grep -rn "device_returns_one_open_per_contract" apps/api/prisma/migrations | head -2 && grep -n "noOpenDeviceReturnWhere\|OPEN_DEVICE_RETURN_STATUSES" apps/api/src/modules/device-returns/device-return.predicate.ts | head -3 && ls apps/api/prisma/migrations | grep seed_device_return_templates
```
Expected: พบ index ใน migration SQL, พบทั้งสอง export, migration seed แม่แบบไลน์ `20261003200000_seed_device_return_templates` มี (idempotent — precedent `20260702000001_seed_notification_templates`; ไม่มีไฟล์ SQL มือแล้ว; ถ้าไม่มี = Phase 2 ยังไม่เสร็จ — หยุดแล้วแจ้ง)

- [ ] **Step 2: ต่อท้าย `.claude/rules/database.md`** (บรรทัดสุดท้ายเดิมคือ `ที่**ห้ามกรอง** (ใบยกเลิกยังถือเลข) และ `findOne` ที่เปิดดูใบยกเลิกได้โดยตั้งใจ`) ด้วย:

````

---

## ใบรับเครื่องคืน (`DeviceReturn` — 2026-09-20)

Spec: `docs/superpowers/specs/2026-09-20-device-return-intake-design.md` §4 · โมเดล `device_returns`
(`apps/api/src/modules/device-returns/`) · กติกาบัญชีอยู่ที่ `.claude/rules/accounting.md` หัวข้อย่อย
"ใบรับเครื่องคืน (DeviceReturn)" ใต้ "ยึดเครื่อง — ราคาเดียว".

### หนึ่งสัญญามีใบรอยืนยันได้ใบเดียว — partial unique (raw SQL ใน migration)

```sql
CREATE UNIQUE INDEX "device_returns_one_open_per_contract"
  ON "device_returns" ("contract_id")
  WHERE "status" = 'PENDING_CONFIRM' AND "deleted_at" IS NULL;
```

Prisma เขียน partial unique ไม่ได้ (precedent `products_imei_serial_active_unique`) ⇒ service ตรวจ "ไม่มีใบ
`PENDING_CONFIRM` ของสัญญานี้" ก่อน แล้ว index เป็นตาข่าย (P2002 → 409 ไทย). ใบที่ `CONFIRMED`/`REJECTED`/`CANCELED`
หลุดจาก index ⇒ สัญญาเดิมเปิดใบใหม่ได้หลังส่งกลับ/ยกเลิก (ยืนยันแล้ว = สัญญา `CLOSED_BAD_DEBT` เปิดใหม่ไม่ได้อยู่แล้วโดย
ด่านสถานะ). `repossessionId @unique` — หนึ่งรายการยึดผูกใบเดียว; `docNumber @unique` (`DR-YYYYMMDD-NNNN`, ตัวนับแบบ
`IntercoBatchNumberService` ไม่ใช่ `DocNumberService` ที่ผูก enum `DocumentType`).

### สถานะระหว่างรอยืนยัน (`PENDING_CONFIRM`)

| สิ่งที่ | ระหว่างรอ | ตอน FINANCE ยืนยัน | ส่งกลับ/ยกเลิก |
|---|---|---|---|
| `Contract.status` | VOLUNTARY: flip `ACTIVE/OVERDUE/DEFAULT → TERMINATED` ทันที (เก็บ `previousContractStatus`) · REPOSSESSION: `TERMINATED` อยู่แล้ว | → `CLOSED_BAD_DEBT` (ใน `createInTx`) | VOLUNTARY: คืน `previousContractStatus` · REPOSSESSION: ไม่แตะ |
| `Product` | **ไม่แตะ** (ยัง `SOLD_INSTALLMENT` ของ FINANCE — เครื่องอยู่ที่สาขาแล้วแต่ยังไม่ผ่านบัญชี) | → `REPOSSESSED` + `ownedByCompanyId` = SHOP + `PHONE_NEW → PHONE_USED` + **`branchId = receivingBranchId`** | ไม่แตะ |
| `Repossession` แถว | ยังไม่มี | สร้าง (JP5 + ขาคู่ SHOP) + `DeviceReturn.repossessionId` | ไม่มี |
| audit | `CONTRACT_STATUS_LEGAL` reason `DEVICE_RETURN_INTAKE` เขียนใน tx ด้วย `tx.auditLog.create` (atomic กับ flip — แถวหลุด Merkle chain โดยตั้งใจ, รูปเดียวกับ `contract-letter.service.ts`) + `DEVICE_RETURN_CREATED` หลัง commit | `DEVICE_RETURN_CONFIRMED` (หลัง commit) + `REPOSSESSION` (ใน `createInTx`) | `CONTRACT_STATUS_LEGAL` reason `DEVICE_RETURN_REJECTED`/`DEVICE_RETURN_CANCELED` (ใน tx) + `DEVICE_RETURN_REJECTED`/`DEVICE_RETURN_CANCELED` (หลัง commit) |

ผลของ `TERMINATED` ที่ได้ฟรี: accrual 2A / ค่าปรับ / จดหมายอัตโนมัติ / ล็อคจากไม่รับสาย / มอบหมายทวงถาม / dunning หยุด,
หายจากคิวรับชำระและคิวทวงถาม "วันนี้" (รายการไฟล์ใน spec §5.1) · เพิ่มเติม: แท็บ "นัดชำระ" ของคิวทวงถามกรอง
`noOpenDeviceReturnWhere()` และ `promise-resolution.cron` ไม่สั่ง `mdm.autoLock` เมื่อสัญญามีใบ `OPEN_DEVICE_RETURN_STATUSES`
(เครื่องอยู่ที่สาขาแล้ว — MDM ปลดมือ). ระหว่างรอ **เครื่องยังถูกถือครองโดยสัญญา** ในสายตา `product-hold.util.ts`
(`TERMINATED` ไม่อยู่ใน `FINISHED_CONTRACT_STATUSES`) ⇒ ลบ/แก้ IMEI/เปิดสัญญาใหม่บนเครื่องนี้ไม่ได้ — ถูกต้องแล้ว.
รายการ "รอยึดเครื่อง" = TERMINATED ที่ **ไม่มี** ใบ `PENDING_CONFIRM` และไม่มีแถว `Repossession`
(`GET /device-returns/awaiting-repossession`).

ลูกค้าจ่ายระหว่างรอ (webhook PaySolutions บันทึกได้ — เงินตัดจริง): ยอดค้างเป็น 0 → ยืนยันถูกปฏิเสธ 400
(`ZERO_OUTSTANDING_MSG` เดิม) ต้องส่งกลับใบ. ใบข้ามเดือน: `paymentDate` ตอนยืนยันต้องเดือนปัจจุบัน ⇒ JE/ใบลดหนี้ลงเดือนที่
ยืนยัน; cron `device-return-pending.cron` (09:20 BKK) สร้าง Todo MEDIUM ต่อใบค้าง > 3 วัน + HIGH เมื่อเหลือ ≤ 2 วันสิ้นเดือน.
tag AUTO `RETURNED_DEVICE` ติดเมื่อลูกค้ามี `DeviceReturn` `PENDING_CONFIRM`/`CONFIRMED` หรือแถว `Repossession` ผ่านสัญญา
ของลูกค้า (กฎใน `evaluateAutoTags`; หน้าจอไม่ให้ติด/ถอดมือ — `recomputeForCustomer` ถอดเฉพาะแถว `source: 'AUTO'`).
````

- [ ] **Step 3: แก้ `.claude/CLAUDE.md`**

บรรทัด 257 — เดิม:
```
`/overdue`, `/letters` (queue + bulk print + dispatch tracking), `/insurance/exchange-requests` (Device Swap), `/repossessions`, `/credit-checks`, `/slip-review`, `/insurance(/:id|/new)` (SP5 Phase 2)
```
ใหม่:
```
`/overdue`, `/letters` (queue + bulk print + dispatch tracking), `/insurance/exchange-requests` (Device Swap), `/repossessions` (ใบรับเครื่องคืน + รอยึดเครื่อง + ยึดคืน & ขายต่อ — เมนู "รับเครื่องคืน / ยึดคืน"), `/credit-checks`, `/slip-review`, `/insurance(/:id|/new)` (SP5 Phase 2)
```

บรรทัด 365-366 — เดิม:
```
## Important Notes
- **เริ่มใช้คลัง+จัดซื้อจริงบน DB ที่ยังทดสอบ (2026-09-05)**:
```
(ขึ้นต้นบรรทัด 366 — บรรทัดเต็มยาวมาก แทรก**ก่อน**บรรทัดนั้นโดยไม่แก้ตัวบรรทัด) ใหม่:
```
## Important Notes
- **ใบรับเครื่องคืน (2026-09-20)**: สาขา (OWNER/BM/SALES) บันทึก `POST /device-returns` (`DR-YYYYMMDD-NNNN`) → สัญญาหยุดทันที (VOLUNTARY flip `TERMINATED`, เก็บ `previousContractStatus`) + ไลน์แจ้งลูกค้า (`DEVICE_RETURNED` — แม่แบบ seed ด้วย migration `20261003200000_seed_device_return_templates` (idempotent)) → OWNER/FM ยืนยันใน `RepossessionOverlay` โหมดยืนยันอย่างเดียว (`POST /device-returns/:id/confirm` → `RepossessionsService.createInTx`; `POST /repossessions` + `create()` ถูกลบ) → JP5 ขา Dr = `11-2107` stamp `DEVICE_RETURN` เสมอ + SHOP `Dr S11-2002 / Cr S21-1104` → ค่าเครื่องหักในรอบจ่าย INTER-CO (แถวประเภทที่ 3 `deviceReturnAmount`) หรือ `POST /interco-settlement/device-returns/:contractId/settle-cash`; tag AUTO `RETURNED_DEVICE`; journey `DEVICE_RETURNED`; ชิป "คืนเครื่อง" ในวิซาร์ดรับชำระถูกถอด · กติกาเต็ม: `.claude/rules/accounting.md` หัวข้อย่อย "ใบรับเครื่องคืน (DeviceReturn)" + `.claude/rules/database.md` หัวข้อ "ใบรับเครื่องคืน"
- **เริ่มใช้คลัง+จัดซื้อจริงบน DB ที่ยังทดสอบ (2026-09-05)**:
```

- [ ] **Step 4: ยืนยันด้วย grep**

```bash
cd "D:/BESTCHOICE APP/BESTCHOICE-device-return" && grep -n "^## ใบรับเครื่องคืน" .claude/rules/database.md && grep -c "device_returns_one_open_per_contract" .claude/rules/database.md && grep -n "ใบรับเครื่องคืน (2026-09-20)" .claude/CLAUDE.md && grep -n 'เมนู "รับเครื่องคืน / ยึดคืน"' .claude/CLAUDE.md
```
Expected: พบทั้ง 4 (database.md heading, count ≥ 1, CLAUDE.md note, CLAUDE.md route)

- [ ] **Step 5: Checkpoint**

ไม่มีโค้ด. **Do NOT commit** (see Global Constraints).

---

### Task 16: บันทึกแจ้งผู้สอบบัญชี `docs/accounting/cpa-followup-2026-09-20-device-return.txt`

**Files:**
- Create: `docs/accounting/cpa-followup-2026-09-20-device-return.txt`

**Interfaces:**
- Consumes: ตัวเลขทอง spec §6.5 (ตรงกับ `interco-device-return.integration.spec.ts` ของ Phase 1)
- Produces: ย่อหน้า "แจ้งเพื่อทราบ" ตาม spec §11 — กรณีที่ 5 ขาเงินสดเป็นลูกหนี้-หน้าร้านแล้วล้างผ่านรอบจ่ายตามแนวกรณีที่ 8 จุดที่ 3 — รูปแบบเดียวกับ `docs/accounting/cpa-followup-2026-09-05.txt` (ไทยล้วน, ไม่มี markdown)

- [ ] **Step 1: สร้างไฟล์** ด้วยเนื้อหานี้ทั้งหมด (byte-for-byte):

```
บันทึกแจ้งเพื่อทราบ — BESTCHOICE
ร่างวันที่ 20 กันยายน 2569

เรียน ผู้สอบบัญชี

ขอเรียนให้ทราบการเปลี่ยนวิธีบันทึกบัญชี "ยึดเครื่อง / ลูกค้าคืนเครื่อง" (กรณีที่ 5 ในชุด
คำถามระบบยึดเครื่อง JP5 วันที่ 8 สิงหาคม 2569) ตามที่เจ้าของกิจการตัดสินใจเมื่อ 20 กันยายน
2569 ให้ตรงกับกระบวนการจริงของกิจการ (เรียนให้ทราบ ไม่ต้องตอบ — ไม่มีบัญชีใหม่ในผัง)

  1. หน้าร้าน (SHOP) เป็นผู้รับเครื่องและตรวจสภาพ/ตีราคาประเมิน แล้วบันทึก "ใบรับเครื่องคืน"
     (เลขที่ DR-YYYYMMDD-NNNN) ในระบบ สัญญาหยุดนับค่างวดและค่าปรับตั้งแต่วันรับเครื่อง;
     FINANCE ตรวจแล้วกดยืนยัน — รายการบัญชี JP5 และขาคู่ฝั่งหน้าร้านลงพร้อมกันตอนยืนยัน
     ไม่ใช่ตอนรับเครื่อง (ระหว่างรอยืนยันยังไม่มีรายการบัญชี)
  2. ขาเงินสดของกรณีที่ 5 ไม่มีอีกต่อไป: วันยึด/รับคืนไม่มีเงินโอนจริง JP5 จึงลง
     Dr 11-2107 ลูกหนี้-หน้าร้าน (ประเภท "ค่าเครื่องคืน") ที่ราคาประเมินเสมอ แทน Dr ธนาคาร
     ฝั่งหน้าร้านลง Dr S11-2002 สินค้าคงคลัง-มือถือมือสอง / Cr S21-1104 เจ้าหนี้ FINANCE
     ที่ราคาประเมิน (ตามที่ท่านรับรองไว้ ข้อ B2 และ A1 รอบ 24-25 สิงหาคม 2569)
  3. ค่าเครื่องคืนถูกล้างผ่านรอบจ่าย INTER-CO ตามแนวกรณีที่ 8 จุดที่ 3 (หักจากยอดที่ FINANCE
     โอนให้หน้าร้าน): FINANCE Cr 11-2107 / หน้าร้าน Dr S21-1104 ในรอบจ่ายเดียวกับการจ่าย
     เจ้าหนี้ยอดจัด+ค่าคอมของสัญญาอื่น — หรือรับเงินสดจากหน้าร้านเป็นรายสัญญาเมื่อไม่มีรอบจ่าย
     (FINANCE Dr เงินสด/ธนาคาร / Cr 11-2107 · หน้าร้าน Dr S21-1104 / Cr เงินสด/ธนาคาร)

ตัวอย่างตัวเลข (สัญญา 17,000 บาท 12 งวด จ่ายแล้ว 4 งวด ยังไม่รับรู้ดอกเบี้ยงวดค้าง
ราคาประเมิน 7,000 บาท — ชุดตัวเลขเดียวกับกรณีที่ 5 เดิม เปลี่ยนเฉพาะขา Dr แรก):

  FINANCE (JP5 ตอนยืนยัน)
    Dr 11-2107 ลูกหนี้-หน้าร้าน (ค่าเครื่องคืน)               7,000.00
    Dr 11-2106 รายได้รอตัดบัญชี-ดอกเบี้ย                     4,000.00
    Dr 21-2102 ภาษีขายรอเรียกเก็บ                                793.32
    Dr 51-1102 หนี้สูญ/ขาดทุนจากยึดเครื่อง                    5,126.68
       Cr 11-2101 ลูกหนี้ผ่อนชำระ                                       11,333.36
       Cr 11-2105 ลูกหนี้ภาษีขายรอเรียกเก็บ                                 793.32
       Cr 21-2101 ภาษีขาย ภ.พ.30                                             793.32
       Cr 41-1101 รายได้ดอกเบี้ย                                           4,000.00
                                                        รวม 16,920.00 = 16,920.00
  หน้าร้าน (ตอนยืนยัน)
    Dr S11-2002 สินค้าคงคลัง-มือถือมือสอง                       7,000.00
       Cr S21-1104 เจ้าหนี้ FINANCE                                        7,000.00

  รอบจ่าย INTER-CO ถัดไป (จ่ายสัญญาอื่น เจ้าหนี้ยอดจัด 10,000 + ค่าคอม 1,000 หักค่าเครื่องคืน 7,000)
    FINANCE: Dr 21-1101 10,000.00 · Dr 21-1102 1,000.00 / Cr 11-2107 7,000.00 · Cr 11-1201 4,000.00
    หน้าร้าน: Dr S21-1104 7,000.00 · Dr S11-1201 4,000.00 / Cr S11-3001 10,000.00 · Cr S11-3002 1,000.00

สิ่งที่ไม่เปลี่ยน: ผังบัญชี (ไม่มีบัญชีใหม่), ใบลดหนี้ ม.82/5 ที่ออกอัตโนมัติจาก JP5,
และคำถามที่ยังรอคำตอบจากท่านเรื่องส่วนลดตอนยึดเครื่องควรลงบัญชีแยกหรือไม่ (คำถามติดตาม
วันที่ 5 กันยายน 2569) — วิธีใหม่นี้ไม่กระทบคำถามนั้น

ขอบพระคุณอย่างสูงครับ
BESTCHOICE (SHOP + FINANCE)
```

- [ ] **Step 2: ยืนยันตัวเลขกับ golden ของ Phase 1**

```bash
cd "D:/BESTCHOICE APP/BESTCHOICE-device-return" && grep -c "5126.68\|5,126.68" apps/api/src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts && grep -n "16,920.00" docs/accounting/cpa-followup-2026-09-20-device-return.txt
```
Expected: ค่าแรก ≥ 1 (golden ตรงกัน), ค่าที่สองพบ 1 บรรทัด

- [ ] **Step 3: Checkpoint**

ไม่มีโค้ด. **Do NOT commit** (see Global Constraints).

---

### Task 17: ตรวจสอบรวมท้าย Phase 3 (type-check ทั้งสองแอป + web/API unit + integration ของ Phase 1–2)

**Files:**
- ไม่มีไฟล์ใหม่ — รันคำสั่งเท่านั้น

**Interfaces:**
- Consumes: ทุก task ก่อนหน้า + integration suites ของ Phase 1–2
- Produces: หลักฐานว่า worktree พร้อมส่งให้เจ้าของ review (ยังไม่ commit)

- [ ] **Step 1: Type-check ทั้งสองแอป**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return" && ./tools/check-types.sh all`
Expected: `0 errors` ทั้ง api และ web

- [ ] **Step 2: Web unit/component tests ทั้งชุด**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx vitest run`
Expected: PASS ทุกไฟล์ — รวมไฟล์ใหม่/แก้ของ Phase 3: `components/device-returns/__tests__/*` (6 ไฟล์), `RepossessionOverlay.confirm-mode.test.tsx`, `RepossessionsPage.*.test.tsx` (3), `RecordPaymentWizard.no-repo-chip.test.ts`, `IntercompanySettlementPage.test.tsx`, `interco/__tests__/RecallCashDialog.test.tsx`, `CustomerTagChips.test.tsx`, `CustomerTagDialog.test.tsx`, `menu.test.ts`. ถ้า snapshot ของ `CustomerTagChips` ถูกรายงานว่า obsolete/mismatch ให้เปิดดูก่อน — ชิป 5 ตัวเดิมต้องไม่เปลี่ยน; ห้าม `-u` โดยไม่อ่าน diff

- [ ] **Step 3: API unit tests (jest)**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/api" && npm test`
Expected: PASS — รวม `entries.source.spec.ts` (Task 13) และ spec ของ Phase 1–2

- [ ] **Step 4: Integration suites ของ Phase 1–2 (DB จริงตาม `.env`)**

Run:
```bash
cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/api" && npx vitest run --no-file-parallelism \
  src/modules/device-returns/__tests__/device-return-flow.integration.spec.ts \
  src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts \
  src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts \
  src/modules/interco-settlement/__tests__/interco-aging.integration.spec.ts \
  src/modules/contracts/__tests__/product-lifecycle.integration.spec.ts
```
Expected: PASS ทั้ง 5 ไฟล์ (Phase 3 ไม่แตะ API นอกจาก Task 13 — ถ้าล้มให้ดูว่าเป็น drift จาก Phase 1–2 ไม่ใช่จาก web)

- [ ] **Step 5: ตรวจสิ่งตกค้าง (grep)**

```bash
cd "D:/BESTCHOICE APP/BESTCHOICE-device-return" && \
(grep -rn "api.post('/repossessions'" apps/web/src || echo "OK: no POST /repossessions caller") && \
(grep -rn "collectedByShop\|depositAccountCode" apps/web/src/pages/PaymentsPage/components/RepossessionOverlay.tsx || echo "OK: overlay has no cash leg") && \
(grep -rn "ยึดคืนเครื่อง" apps/web/src || echo "OK: old menu label gone") && \
(grep -rn "contracts?status=TERMINATED" apps/web/src || echo "OK: awaiting list uses device-returns endpoint") && \
grep -c "deviceReturnContractIds" apps/web/src/pages/interco/CreateBatchDialog.tsx
```
Expected: 4 บรรทัด `OK: ...` แล้ว `1`

- [ ] **Step 6: (ทางเลือก — ต้องมี stack รัน) Playwright ที่แตะหน้า /repossessions**

Run: `cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/web" && npx playwright test e2e/debt-collection.spec.ts e2e/advanced-operations.spec.ts`
Expected: PASS — assert เดิม `/ยึดคืน/`, `/เพื่อบันทึกการยึดคืน/`, `/รอยึดเครื่อง/`, "no link named ยึดเครื่อง" ยังจริงกับหัวหน้า/ปุ่มใหม่ (Task 6 ออกแบบข้อความให้คงคำเหล่านี้)

- [ ] **Step 7: Checkpoint สุดท้าย**

`git status` ต้องแสดงเฉพาะไฟล์ที่แผนนี้ + Phase 1–2 แตะ; **Do NOT commit / push / PR** — ส่งสรุปให้เจ้าของตัดสิน (คำสั่ง 2026-09-05).

---

## คำตัดสินระหว่างเขียนแผน (อ่านก่อนลงมือ — ไม่ใช่ทางเลือก)

1. **`RepossessionOverlay.deviceReturnId` เป็น prop บังคับ** (brief เขียน `deviceReturnId?`): `POST /repossessions` ถูกลบใน Phase 2 ⇒ โหมดสร้างไม่มี endpoint รองรับ; prop บังคับทำให้การถอด mount ในวิซาร์ด (Task 7) ถูกบังคับด้วย type-check แทนปล่อยทางตันไว้.
2. **เทสต์ valuation ของ overlay ถูก rename เป็น `RepossessionOverlay.confirm-mode.test.tsx`** — เกรด/ราคาประเมินไม่ใช่ช่องแก้ได้บน overlay อีกต่อไป (อยู่บนใบ) จึงย้ายเทสต์ autoPrice/±15% ไป `DeviceReturnIntakeDialog.test.tsx` (Task 3) ตาม spec §10.
3. **`RecallCashDialog` prop `recall` → `candidate: CashSettleCandidate` + `kind`** (brief กำหนดแค่ `kind`): แถวสองชนิดถือยอดคนละชื่อฟิลด์ (`recallGl` / `deviceReturnGl`) — normalize ผ่าน `recallToCashCandidate` / `deviceReturnToCashCandidate` ใน `interco/types.ts` แทน union type ที่ต้อง branch ใน dialog.
4. **`BatchDetailSheet` แก้ด้วย** (ไม่อยู่ใน spec §7): item `DEVICE_RETURN` จะ render โดยไม่มี badge และยอดหัก "0.00" ถ้าไม่แก้ — 4 จุดเล็กใน Task 10.
5. **shape ที่ brief ไม่ระบุ** — `GET /device-returns/lookup` (array ตรง ๆ ≤ 20 แถว ไม่มีเบอร์โทร) และ `GET /device-returns/awaiting-repossession` (`{ data, total }` แถว = subset เดิมของ `/contracts`) ประสานกับผู้เขียน Phase 2 แล้ว; `POST` create/confirm/reject/cancel/resend คืน list-row (web อ่านแค่ `docNumber`/`status`/`contract.id`).
6. **ราคาประเมิน 0**: spec §5.1 ข้อ 7 ("ราคาประเมิน > 0") ขัดกับ §6.1 ("ราคาประเมิน 0 ยังยืนยันได้") และ DTO `≥ 0` — ฟอร์มสาขาบล็อกที่ UI เมื่อ `≤ 0` ตาม convention ของ overlay เดิม (server เป็นผู้ตัดสินสุดท้าย); ถ้าเจ้าของต้องการรับเครื่องมูลค่า 0 ให้ถอดบรรทัดเดียวใน `computeBlockReason` ของ Task 3.
7. **ป้าย journey `DEVICE_RETURNED`** อยู่ฝั่ง API (`entries.source.ts` VIEWS — exhaustive `Record`) ไม่ใช่ `JourneyTab.tsx` (ไม่มี map ต่อ kind); Task 13 เป็น verify-or-add ที่ประสานกับ Phase 2 แล้ว.
8. **`RETURNED_DEVICE` ห้ามติด/ถอดมือ** (Task 11) — `recomputeForCustomer` ถอดเฉพาะ `source: 'AUTO'` ⇒ ติดมือ = ค้างถาวรโดยไม่มีหลักฐาน, ถอดมือ = ติดกลับคืนนี้; ทั้งสองทาง "ทำแล้วไม่ได้ผลจริง" จึงไม่โฆษณาบนจอ (`.claude/rules/coding-standards.md`).
9. **หัวหน้า `/repossessions`** คงคำ "ยึดคืน", "เพื่อบันทึกการยึดคืน", "รอยึดเครื่อง" เพื่อไม่ทำ Playwright `debt-collection.spec.ts` / `advanced-operations.spec.ts` แดง (ไม่แก้ e2e ในเฟสนี้).
10. **SALES** สร้างใบได้ตาม spec §5.0 แต่ไม่มี route `/repossessions` (`App.tsx:766-770` = OWNER/BM/FM/ACC) ⇒ ทางเข้าของ SALES คือปุ่ม "รับเครื่องคืน" บนหน้าสัญญา (Task 8) — ไม่เพิ่ม route/เมนูให้ SALES ในเฟสนี้.
