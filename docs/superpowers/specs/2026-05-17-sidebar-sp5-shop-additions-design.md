# SP5 — SHOP Additions (Design Spec)

**Sub-project:** SP5 (of 6) — ดู roadmap: `2026-05-17-sidebar-redesign-roadmap.md`
**Status:** Design approved 2026-05-17
**ETA:** 5-8 commits / 2-3 days

---

## 1. Goals

Close 4 SHOP-side placeholder routes from SP1:
1. **`/quotes`** — ใบเสนอราคา (new module — create/edit/print/convert-to-sale)
2. **`/drafts`** — Drafts hub (รวม DRAFT-status docs ทุกประเภท: Quote, Contract, Expense, etc.)
3. **`/insurance`** — Insurance/Returns refactor (lifecycle: รับเข้า → ส่งศูนย์ → คืนลูกค้า)
4. **`/crm` enhancement** — CRM Pipeline with stages (เสนอ → ติดต่อ → เสนอราคา → ปิดการขาย)

## 2. Scope per feature

### 2.1 Quote (ใบเสนอราคา)

**New Prisma model:**
```prisma
model Quote {
  id            String   @id @default(uuid())
  quoteNumber   String   @unique    // QU-YYYYMMDD-NNNN (via DocNumberService)
  customerId    String
  customer      Customer @relation(fields: [customerId], references: [id])
  branchId      String
  branch        Branch   @relation(fields: [branchId], references: [id])
  status        QuoteStatus @default(DRAFT)  // DRAFT / SENT / ACCEPTED / REJECTED / EXPIRED / CONVERTED
  validUntil    DateTime
  subtotal      Decimal  @db.Decimal(12, 2)
  discount      Decimal  @db.Decimal(12, 2) @default(0)
  vatAmount     Decimal  @db.Decimal(12, 2) @default(0)
  total         Decimal  @db.Decimal(12, 2)
  notes         String?
  items         QuoteItem[]
  convertedToSaleId String? @unique
  convertedToSale   Sale? @relation(fields: [convertedToSaleId], references: [id])
  createdById   String
  createdBy     User    @relation("QuoteCreatedBy", fields: [createdById], references: [id])
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?
  @@index([customerId, deletedAt])
  @@index([branchId, status, deletedAt])
  @@map("quotes")
}

model QuoteItem {
  id         String @id @default(uuid())
  quoteId    String
  quote      Quote @relation(fields: [quoteId], references: [id], onDelete: Cascade)
  productId  String?
  product    Product? @relation(fields: [productId], references: [id])
  description String
  quantity   Int @default(1)
  unitPrice  Decimal @db.Decimal(12, 2)
  amount     Decimal @db.Decimal(12, 2)
  createdAt  DateTime @default(now())
  @@index([quoteId])
  @@map("quote_items")
}

enum QuoteStatus {
  DRAFT
  SENT
  ACCEPTED
  REJECTED
  EXPIRED
  CONVERTED
}
```

**Endpoints** (`/quotes` API, roles SALES/BRANCH_MANAGER/OWNER):
- `GET /quotes` (list with filters)
- `GET /quotes/:id`
- `POST /quotes` (create DRAFT)
- `PATCH /quotes/:id` (update DRAFT only)
- `POST /quotes/:id/send` (DRAFT → SENT — generates PDF + LINE notify if customer has line)
- `POST /quotes/:id/accept` / `:id/reject`
- `POST /quotes/:id/convert` — creates Sale + Contract from accepted quote
- `GET /quotes/:id/pdf` (download)
- `DELETE /quotes/:id` (soft delete DRAFT only)

**Frontend page**: `QuotesPage.tsx` (list + create form + detail)

### 2.2 Drafts hub

**Aggregation page** — unified view of all DRAFT-status documents:
- Quote DRAFT (status='DRAFT')
- Contract status='PENDING' (pre-activation)
- ExpenseDocument status='DRAFT'
- OtherIncome status='DRAFT'

> **Scope honesty (revised 2026-05-17 post-review):** The original draft also
> included `Sale status='PENDING'` (cart-with-no-payment), but the Sale model
> has no PENDING state — Sale rows are created on payment, with cart state
> living in client-side POS draft store. Phase 1 ships with the 4 tables
> above only. POS cart drafts will be surfaced by a separate localStorage
> import flow if/when needed.

**Endpoint**: `GET /drafts?type=&branchId=` — federated query across 4 tables, returns `{ type, id, number, customer, branch, createdBy, createdAt, amount, link }`

**Frontend page**: `DraftsPage.tsx` — tabbed by type, click → navigate to source doc page

### 2.3 Insurance / Returns refactor

**Existing**: `/defect-exchange` covers in-warranty repair (รับเครื่องคืน → ส่งศูนย์ → คืน)

**Enhance**: Add `/insurance` as parent module wrapping:
- `RepairTicket` (existing) — new screen for status workflow
- Add `lifecycleStatus` enum: RECEIVED / SENT_TO_CENTER / IN_REPAIR / RETURNED_BY_CENTER / CUSTOMER_PICKED_UP
- Add audit trail per status change

If schema model exists, extend. Else create `RepairTicket` model with this enum.

### 2.4 CRM Pipeline stages

**Existing `/crm`** has CRM Pipeline. Enhance with explicit stages:
- LEAD (เสนอ) - new lead
- CONTACTED (ติดต่อแล้ว)
- QUOTED (เสนอราคา — link to Quote module)
- WON (ปิดการขาย — link to Sale)
- LOST

Add `pipelineStage` enum to existing CRM model (`Lead` or `Pipeline` — check schema). Filter Kanban by stage.

## 3. Scope reduction for SP5

Given size, **prioritize**:
- ✅ Quote module (full CRUD + PDF + convert-to-sale)
- ✅ Drafts hub (federated read-only listing)
- ⚠️ Insurance refactor — **Phase 1 only**: rename and link, NO schema change yet (defer enum to Phase 2)
- ⚠️ CRM stages — **Phase 1 only**: filter UI on existing pipeline (NO schema enum addition; use existing CRM status)

## 4. Test Plan

- API: Quote service tests (CRUD + convert + PDF) — 8 tests
- API: Drafts service tests (federation + filtering) — 3 tests
- Web: QuotesPage tests (list + form) — 3 tests
- Web: DraftsPage tests — 2 tests
- Playwright: 3 cases (SALES creates quote, OWNER views drafts, BRANCH_MANAGER converts quote)

## 5. PR Breakdown

1. Backend: Quote schema + migration + service + controller + tests
2. Backend: PDF + convert-to-sale + LINE notify
3. Backend: Drafts federated service + endpoint + tests
4. Frontend: QuotesPage (list + create + detail)
5. Frontend: DraftsPage (tabbed federation)
6. Insurance + CRM Phase 1 (rename + link only, no schema)
7. Route swaps + sidebar update + Playwright

## 6. Acceptance Criteria

- [ ] SALES can create + send + convert Quote
- [ ] OWNER sees Drafts hub with 4+ types
- [ ] Quote PDF generates correctly
- [ ] /insurance + /crm enhanced (Phase 1)
- [ ] All routes role-guarded
- [ ] Vitest + Playwright pass
- [ ] No emoji, design tokens only
