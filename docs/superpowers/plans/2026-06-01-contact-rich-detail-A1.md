# Contact Rich Detail (A1, read-through) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หน้า Contact detail แสดงข้อมูลกิจการแบบ read-through จาก Customer/Supplier/ExternalFinanceCompany/TradeIn ที่ link อยู่ + ปุ่ม deep-link ไปแก้ที่หน้าต้นทางเดิม — โดยไม่เก็บ column ซ้ำบน Contact

**Architecture:** ขยาย `select` ใน `ContactsService.findOne` ให้ดึงฟิลด์ระบุตัวตน/ไม่อ่อนไหวจาก role record ที่ link (ไม่ดึง address PII ของลูกค้า). Frontend แสดงการ์ดต่อ role record + ปุ่ม "เปิด/แก้ไข →" ที่ deep-link. ไม่มี Contact column ใหม่ / migration / PATCH.

**Tech Stack:** NestJS + Prisma + Jest (api), React + react-query + react-router + shadcn/ui + Vitest (web)

**Spec:** `docs/superpowers/specs/2026-06-01-contact-rich-fields-A1-design.md`

---

## File Structure

- Modify: `apps/api/src/modules/contacts/contacts.service.ts` — expand `findOne` select
- Modify: `apps/api/src/modules/contacts/__tests__/contacts.service.spec.ts` — assert expanded select fields
- Modify: `apps/web/src/lib/api/contacts.ts` — typed linked-record shapes on detail response
- Modify: `apps/web/src/pages/ContactDetailPage.tsx` — read-through cards + deep-links

---

## Task 1: Backend — expand findOne select (read-through fields)

**Files:**
- Modify: `apps/api/src/modules/contacts/contacts.service.ts` (the `findOne` method)
- Test: `apps/api/src/modules/contacts/__tests__/contacts.service.spec.ts`

- [ ] **Step 1: Write/extend the failing test**

แทนที่/เพิ่ม test ใน describe `ContactsService.findOne` ให้ assert ว่า select ดึงฟิลด์ที่ขยาย และ **ไม่ดึง address PII ของลูกค้า**:
```typescript
it('selects read-through fields per role record (no customer PII address)', async () => {
  prisma.contact.findFirst.mockResolvedValue({ id: 'c1', roles: ['SUPPLIER'], customers: [], suppliers: [], tradeInsAsSeller: [], externalFinanceCompany: [] });
  await svc.findOne('c1');
  const include = prisma.contact.findFirst.mock.calls[0][0].include;
  // suppliers: rich non-PII fields
  expect(include.suppliers.select).toEqual(expect.objectContaining({
    id: true, name: true, type: true, taxId: true, branchCode: true,
    contactName: true, contactPhone: true, phone: true, hasVat: true, address: true,
  }));
  // customers: identity only, NO encrypted address columns
  expect(include.customers.select).toEqual(expect.objectContaining({ id: true, name: true, prefix: true, phone: true }));
  expect(include.customers.select.addressCurrent).toBeUndefined();
  expect(include.customers.select.addressIdCard).toBeUndefined();
  // finance company
  expect(include.externalFinanceCompany.select).toEqual(expect.objectContaining({ id: true, name: true, taxId: true, contactPhone: true, email: true, creditTermDays: true }));
  // trade-in seller free-text
  expect(include.tradeInsAsSeller.select).toEqual(expect.objectContaining({ id: true, sellerName: true, sellerPhone: true, createdAt: true }));
});
```
> NB: the existing `findOne` tests in this describe (returns-linked-records, NotFound) must keep passing — adapt their mock `findFirst` return to still satisfy them; do not delete them.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx jest contacts.service --silent`
Expected: FAIL — select lacks the new fields

- [ ] **Step 3: Implement — expand the include/select**

แก้ `findOne` ใน `contacts.service.ts`:
```typescript
async findOne(id: string) {
  const contact = await this.prisma.contact.findFirst({
    where: { id, deletedAt: null },
    include: {
      customers: {
        where: { deletedAt: null },
        // identity + non-sensitive only — NO encrypted address PII (deep-link to /customers/:id for full detail)
        select: { id: true, name: true, prefix: true, phone: true },
      },
      suppliers: {
        where: { deletedAt: null },
        select: {
          id: true, name: true, type: true, taxId: true, branchCode: true,
          contactName: true, contactPhone: true, phone: true, hasVat: true, address: true,
        },
      },
      tradeInsAsSeller: {
        where: { deletedAt: null },
        select: { id: true, sellerName: true, sellerPhone: true, createdAt: true },
      },
      externalFinanceCompany: {
        where: { deletedAt: null },
        select: { id: true, name: true, taxId: true, contactPhone: true, email: true, creditTermDays: true },
      },
    },
  });
  if (!contact) throw new NotFoundException('ไม่พบผู้ติดต่อ');
  return contact;
}
```

- [ ] **Step 4: Run to verify it passes + type-check**

Run: `cd apps/api && npx jest contacts.service --silent && cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api`
Expected: PASS + 0 type errors. (If `prefix`/`branchCode`/`hasVat`/`address`/`type` aren't valid select keys, the Prisma client type-check will fail — confirm the exact field names against `schema.prisma`: Supplier has `type`, `branchCode`, `contactName`, `contactPhone`, `phone`, `hasVat`, `address`, `taxId`; Customer has `prefix`, `phone`, `name`.)

- [ ] **Step 5: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && git add apps/api/src/modules/contacts && git commit -m "feat(contacts): expand findOne select for read-through detail (no customer PII)"
```

---

## Task 2: Frontend — read-through cards + deep-links

**Files:**
- Modify: `apps/web/src/lib/api/contacts.ts` (typed detail response)
- Modify: `apps/web/src/pages/ContactDetailPage.tsx`
- Test: `apps/web/src/pages/__tests__/ContactDetailPage.test.tsx` (create)

- [ ] **Step 1: Add typed linked-record shapes to the api client**

ใน `apps/web/src/lib/api/contacts.ts` เพิ่ม types + ใช้กับ `detail`:
```typescript
export interface ContactCustomerLink { id: string; name: string; prefix: string | null; phone: string | null; }
export interface ContactSupplierLink { id: string; name: string; type: 'JURISTIC' | 'INDIVIDUAL'; taxId: string | null; branchCode: string | null; contactName: string | null; contactPhone: string | null; phone: string | null; hasVat: boolean; address: string | null; }
export interface ContactFinanceLink { id: string; name: string; taxId: string | null; contactPhone: string | null; email: string | null; creditTermDays: number | null; }
export interface ContactTradeInLink { id: string; sellerName: string | null; sellerPhone: string | null; createdAt: string; }

export interface ContactDetail extends Contact {
  customers: ContactCustomerLink[];
  suppliers: ContactSupplierLink[];
  tradeInsAsSeller: ContactTradeInLink[];
  externalFinanceCompany: ContactFinanceLink[];
}
```
และเปลี่ยน `detail` ให้คืน `ContactDetail`:
```typescript
detail: (id: string) => api.get<ContactDetail>(`/contacts/${id}`).then((r) => r.data),
```

- [ ] **Step 2: Write the failing test**

`apps/web/src/pages/__tests__/ContactDetailPage.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi } from 'vitest';
import ContactDetailPage from '../ContactDetailPage';
import { contactsApi } from '@/lib/api/contacts';

vi.mock('@/lib/api/contacts', async (orig) => {
  const actual = await orig<typeof import('@/lib/api/contacts')>();
  return { ...actual, contactsApi: { ...actual.contactsApi, detail: vi.fn() } };
});

function wrap(id: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/contacts/${id}`]}>
        <Routes><Route path="/contacts/:id" element={<ContactDetailPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('renders a supplier read-through card with a deep-link to the supplier page', async () => {
  (contactsApi.detail as any).mockResolvedValue({
    id: 'c1', contactCode: 'P-00002', name: 'บ.แอปเปิล', roles: ['SUPPLIER'], isActive: true,
    taxId: '0105500000010', phone: null, email: null, peakContactCode: null,
    customers: [], tradeInsAsSeller: [], externalFinanceCompany: [],
    suppliers: [{ id: 's1', name: 'บ.แอปเปิล', type: 'JURISTIC', taxId: '0105500000010', branchCode: '00000', contactName: 'คุณเอ', contactPhone: '02', phone: '02', hasVat: true, address: 'กทม' }],
  });
  wrap('c1');
  await waitFor(() => expect(screen.getByText('บ.แอปเปิล')).toBeInTheDocument());
  const link = screen.getByRole('link', { name: /แก้ไข|เปิดข้อมูล|ผู้ขาย/ });
  expect(link).toHaveAttribute('href', '/suppliers/s1');
});
```
> Match the repo's existing page-test idioms (router import path `react-router`, api-mock style) — mirror `ContactsPage.test.tsx`.

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/web && npx vitest run ContactDetailPage --silent`
Expected: FAIL — no supplier card / link yet

- [ ] **Step 4: Implement the read-through cards**

แก้ `ContactDetailPage.tsx` แท็บ "ข้อมูลกิจการ" ให้ render การ์ดต่อ role record จาก `ContactDetail`:
- การ์ดผู้ขาย (suppliers[]): แสดง name, type (badge นิติบุคคล/บุคคล), taxId, เลขสาขา, ผู้ติดต่อ (contactName/contactPhone), เบอร์, VAT, address + `<Link to={`/suppliers/${s.id}`}>เปิดข้อมูลผู้ขาย / แก้ไข →</Link>`
- การ์ดลูกค้า (customers[]): prefix+name, เบอร์ + `<Link to={`/customers/${c.id}`}>เปิดข้อมูลลูกค้า / แก้ไข →</Link>` (ไม่โชว์ที่อยู่ — อยู่หน้าลูกค้า)
- การ์ดบริษัทไฟแนนซ์ (externalFinanceCompany[]): name, taxId, เบอร์, email + `<Link to={`/external-finance-companies/${f.id}`}>เปิด / แก้ไข →</Link>`
- การ์ดคนขายมือสอง (tradeInsAsSeller[]): sellerName/sellerPhone (read-only) + `<Link to="/trade-in">ดูรายการรับซื้อ →</Link>`
- ถ้าไม่มี role record เลย: แสดงข้อความ "ยังไม่ผูกกับลูกค้า/ผู้ขาย" + ข้อมูล Contact เท่าที่มี (name/phone)
- derived entityType ที่หัว: ถ้ามี supplier.type==='JURISTIC' หรือ role FINANCE_COMPANY → "นิติบุคคล" ไม่งั้น "บุคคลธรรมดา"
- ใช้ `Link` จาก `react-router`, semantic tokens, Thai `leading-snug`, ใช้ shadcn `Card`/`Badge` ตาม pattern หน้าอื่น (ดู ExternalFinanceCompanyDetailPage / CustomerDetailPage เป็น reference)

- [ ] **Step 5: Run to verify it passes + type-check**

Run: `cd apps/web && npx vitest run ContactDetailPage --silent && cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web`
Expected: PASS + 0 type errors

- [ ] **Step 6: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && git add apps/web/src/lib/api/contacts.ts apps/web/src/pages/ContactDetailPage.tsx apps/web/src/pages/__tests__/ContactDetailPage.test.tsx && git commit -m "feat(contacts): read-through detail cards + deep-links to source records"
```

---

## Task 3: Verify

**Files:** none

- [ ] **Step 1: Full type-check** — `cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh all` → 0 errors
- [ ] **Step 2: Contacts tests** — `cd apps/api && npx jest contacts --silent` + `cd apps/web && npx vitest run Contact --silent` → green
- [ ] **Step 3: Confirm no Contact schema change** — `git diff main --stat -- apps/api/prisma` → should show NO migration/schema changes (A1 is read-through only; if a migration appears, something went wrong)

---

## Self-Review Notes

- **Spec coverage:** read-through select (Task 1) ✓; read-through cards + deep-links (Task 2) ✓; no new columns/migration/backfill/PATCH ✓ (Task 3 step 3 guards it); no customer PII via contacts endpoint (Task 1 asserts address columns absent) ✓; multi-role → multiple cards (Task 2) ✓; no-record fallback (Task 2) ✓; derived entityType (Task 2) ✓.
- **Placeholders:** none — all code shown; field names verified against schema (Supplier.type/branchCode/contactName/contactPhone/phone/hasVat/address/taxId; Customer.prefix/phone/name; ExternalFinanceCompany.taxId/contactPhone/email/creditTermDays; TradeIn.sellerName/sellerPhone).
- **Type consistency:** `ContactDetail` shape in api client (Task 2 step 1) matches the backend select (Task 1 step 3) field-for-field.
- DBD lookup (A2), accounting fields (B), overview tab (C) are out of scope per spec.
