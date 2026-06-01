# Contact Financial Snapshot (C, thin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** โชว์ snapshot การเงินลูกค้า (ยอดค้าง + สัญญา active + ค้างชำระ) บน CustomerCard ของหน้า Contact detail โดย reuse `GET /customers/:id/summary` ที่มีอยู่

**Architecture:** Frontend-only. เพิ่ม web api client `customersApi.summary()` เรียก endpoint เดิม, แล้วให้ `CustomerCard` (ใน ContactDetailPage) fetch ด้วย react-query มาแสดง. ไม่มี backend/schema change.

**Tech Stack:** React + react-query + react-router + Vitest

**Spec:** `docs/superpowers/specs/2026-06-02-contact-financial-snapshot-C-design.md`

**Verified facts:** `GET /customers/:id/summary` (customers.controller.ts:233, roles incl. SALES) returns `{ id, name, phone, activeContracts: number, overdueCount: number, totalOutstandingThb: number }` (outstanding field name = `totalOutstandingThb`, already a number). `CustomerCard` lives in `apps/web/src/pages/ContactDetailPage.tsx` (~line 87) and the file already imports `useQuery`. No `apps/web/src/lib/api/customers.ts` exists yet.

---

## Task 1: web customers api client

**Files:**
- Create: `apps/web/src/lib/api/customers.ts`

- [ ] **Step 1: Create the client**

```typescript
import api from '@/lib/api';

export interface CustomerSummary {
  id: string;
  name: string;
  phone: string | null;
  activeContracts: number;
  overdueCount: number;
  totalOutstandingThb: number;
}

export const customerKeys = {
  summary: (id: string) => ['customer-summary', id] as const,
};

export const customersApi = {
  summary: (id: string) =>
    api.get<CustomerSummary>(`/customers/${id}/summary`).then((r) => r.data),
};
```
> Verify `api` is the default export of `apps/web/src/lib/api.ts` (it is, per `lib/api/contacts.ts`). Confirm field names against backend `getSummary` return (`customers.service.ts`): `activeContracts`, `overdueCount`, `totalOutstandingThb`.

- [ ] **Step 2: Type-check**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && git add apps/web/src/lib/api/customers.ts && git commit -m "feat(contacts): web customers api client (summary)"
```

---

## Task 2: CustomerCard financial snapshot

**Files:**
- Modify: `apps/web/src/pages/ContactDetailPage.tsx` (the `CustomerCard` component)
- Test: `apps/web/src/pages/__tests__/ContactDetailPage.test.tsx`

- [ ] **Step 1: Write the failing test**

เพิ่ม test ในไฟล์ test เดิม (mirror the existing mock style; the file already mocks `@/lib/api/contacts`). Also mock the new customers client:
```tsx
vi.mock('@/lib/api/customers', () => ({
  customerKeys: { summary: (id: string) => ['customer-summary', id] },
  customersApi: { summary: vi.fn() },
}));
```
```tsx
it('shows customer financial snapshot from /summary on the customer card', async () => {
  const { customersApi } = await import('@/lib/api/customers');
  (customersApi.summary as any).mockResolvedValue({
    id: 'cus1', name: 'นราธิป', phone: '08', activeContracts: 2, overdueCount: 1, totalOutstandingThb: 15000,
  });
  (contactsApi.detail as any).mockResolvedValue({
    id: 'c1', contactCode: 'P-00001', name: 'นราธิป', roles: ['CUSTOMER'], isActive: true,
    taxId: null, phone: '08', email: null, peakContactCode: null,
    suppliers: [], tradeInsAsSeller: [], externalFinanceCompany: [],
    customers: [{ id: 'cus1', name: 'นราธิป', prefix: 'คุณ', phone: '08' }],
  });
  wrap('c1');
  await waitFor(() => expect(screen.getByText('นราธิป')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText(/15,000/)).toBeInTheDocument()); // outstanding formatted
  expect(screen.getByText(/ค้างชำระ/)).toBeInTheDocument();
});
```
> Use the SAME `wrap()` + router/QueryClient helper already in this test file (from A1). Keep existing tests intact.

- [ ] **Step 2: Run, expect FAIL**

Run: `cd apps/web && npx vitest run ContactDetailPage --silent`
Expected: FAIL — no outstanding amount rendered

- [ ] **Step 3: Implement — fetch + render snapshot in CustomerCard**

ใน `ContactDetailPage.tsx`:
- import: `import { customersApi, customerKeys } from '@/lib/api/customers';`
- ใน `CustomerCard`, เพิ่มก่อน return:
```tsx
const { data: summary } = useQuery({
  queryKey: customerKeys.summary(customer.id),
  queryFn: () => customersApi.summary(customer.id),
});
```
- ใน CardContent (เหนือ `<CardLink .../>`) เพิ่ม snapshot (แสดงเมื่อมี summary; ถ้ายังไม่มี/ error → ไม่แสดง ไม่พังการ์ด):
```tsx
{summary && (
  <div className="grid grid-cols-3 gap-3">
    <Field label="ยอดค้างชำระ" value={`${summary.totalOutstandingThb.toLocaleString('th-TH')} ฿`} />
    <Field label="สัญญา active" value={String(summary.activeContracts)} />
    <div>
      <div className="text-xs text-muted-foreground mb-0.5 leading-snug">ค้างชำระ</div>
      <div className={`text-sm leading-snug ${summary.overdueCount > 0 ? 'text-destructive' : 'text-foreground'}`}>
        {summary.overdueCount}
      </div>
    </div>
  </div>
)}
```
- เก็บ `<Field label="เบอร์" .../>` และ `<CardLink to={`/customers/${customer.id}`} ... />` เดิมไว้
- ใช้ semantic tokens, Thai `leading-snug`. (react-query default ไม่ retry ใน test แต่ใน prod ถ้า fail summary จะ undefined → snapshot ซ่อน — ตาม spec)

- [ ] **Step 4: Run, expect PASS + type-check**

Run: `cd apps/web && npx vitest run ContactDetailPage --silent && cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web`
Expected: PASS (incl. existing A1 tests) + 0 type errors

- [ ] **Step 5: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && git add apps/web/src/pages/ContactDetailPage.tsx apps/web/src/pages/__tests__/ContactDetailPage.test.tsx && git commit -m "feat(contacts): customer financial snapshot on contact card (reuse /summary)"
```

---

## Task 3: Verify

**Files:** none

- [ ] **Step 1:** `cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web` → 0 errors
- [ ] **Step 2:** `cd apps/web && npx vitest run Contact --silent` → all pass (A1 + new snapshot test)
- [ ] **Step 3:** confirm NO backend/schema change: `git diff main --stat -- apps/api` → 0 lines

---

## Self-Review

- **Spec coverage:** customersApi.summary (Task 1) ✓; CustomerCard snapshot of outstanding+active+overdue (Task 2) ✓; loading/error hides snapshot without breaking card (Task 2 — `summary &&` guard) ✓; frontend-only, no backend (Task 3 step 3 guards) ✓.
- **Placeholders:** none — full code shown; `totalOutstandingThb`/`activeContracts`/`overdueCount` match backend `getSummary` return verified in service.
- **Type consistency:** `CustomerSummary` (Task 1) field names match what CustomerCard reads (Task 2).
- Out of scope per spec: supplier snapshot, charts/doc-list/aging, new backend endpoint.
