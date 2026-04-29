# Accounting Phase A.1a — CoA Split (SHOP/FINANCE Multi-Entity Schema) — Spec

**Date:** 2026-04-29
**Type:** Schema migration + CoA reorg (no inter-company JE wiring; deferred to A.1b)
**Status:** Draft for review
**Predecessor:** Phase A.0 PR #722 (`feat/accounting-phase-a0-critical-fix`) — code-only critical fixes
**Audit source:** `docs/reports/2026-04-29-accounting-audit.md` Phase A.1 + business decisions section

---

## 1. Goal

Split BESTCHOICE chart of accounts into 2 entity-scoped charts (SHOP + FINANCE) with proper schema partitioning. Replaces the current single-table `allowedCompanies` array approach with explicit `companyId` partitioning + composite unique on `(companyId, code)`.

Owner CoA (109 accounts, owner-supplied) becomes SHOP's chart. New 44-account FINANCE chart (38 standard + 2 deferred-decision + 4 inter-company clearing) added. ACC constants in `JournalAutoService` remapped to point at correct accounts (e.g., `BAD_DEBT_EXPENSE` moves from `53-1101 Salary` → `53-1701 หนี้สูญ`).

**Deliverable:** 1 PR. Schema migration + seed replacement + lookup updates + frontend filter. ~21 hr work.

---

## 2. Background

### Why this exists

Phase A.0 hardened code-level bugs (math, try/catch, validation, period close) WITHOUT touching CoA. The remaining critical findings from audit (F-2-002, F-3-001 to F-3-022, F-3-026) all require CoA structural change before they can be fixed.

### Why split (Q1 = ข)

Owner's 109-account CoA is purpose-built for SHOP single-entity operation (no HP receivable, no commission income, no allowance accounts). System assumes SHOP↔FINANCE split. Reconciling means either:
- (a) Extend owner CoA with FINANCE accounts (single chart, 150+ acc.) — rejected
- (b) Split into 2 charts — chosen

### Why composite unique (Q2 = A)

Both SHOP and FINANCE need `11-1101 Cash` (different bank accounts). Current `code String @unique` blocks coexistence. Composite unique `@@unique([companyId, code])` is industry standard (matches PEAK multi-entity pattern).

---

## 3. Scope (5 logical changes)

### 3.1 Schema change

```prisma
model ChartOfAccount {
  id              String       @id @default(uuid())
  code            String       // NOT unique anymore
  companyId       String?      @map("company_id")  // NEW — null = shared
  company         CompanyInfo? @relation(fields: [companyId], references: [id])
  nameTh          String
  nameEn          String?
  accountGroup    AccountGroup
  parentCode      String?
  level           Int          @default(1)
  isActive        Boolean      @default(true)
  // allowedCompanies REMOVED
  peakAccountCode String?
  peakAccountId   String?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  deletedAt       DateTime?

  @@unique([companyId, code])  // NEW composite unique
  @@index([accountGroup])
  @@index([code])
  @@index([companyId])  // NEW
  @@map("chart_of_accounts")
}
```

### 3.2 Migration (single SQL file, atomic)

5 logical steps in one migration:

1. `ALTER TABLE chart_of_accounts ADD COLUMN company_id TEXT NULL`
2. `ALTER TABLE chart_of_accounts ADD CONSTRAINT chart_of_accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES company_info(id)`
3. Backfill: `UPDATE chart_of_accounts SET company_id = (SELECT id FROM company_info WHERE company_code = 'SHOP') WHERE 'SHOP' = ANY(allowed_companies);` (and similar for FINANCE)
4. `ALTER TABLE chart_of_accounts DROP CONSTRAINT chart_of_accounts_code_key; CREATE UNIQUE INDEX ON chart_of_accounts (company_id, code);`
5. `ALTER TABLE chart_of_accounts DROP COLUMN allowed_companies;`

### 3.3 Seed replacement

**SHOP chart — 109 accounts** from `docs/references/owner-chart-of-accounts.csv`:
- All accounts get `companyId = SHOP company id`
- Code preserved as-is from CSV (e.g., 11-1101 = "เงินสด สุทธินีย์ คงเดช")

**FINANCE chart — 44 accounts** (NEW seed file `chart-of-accounts-finance.ts`):

```
─ 11-XXXX สินทรัพย์หมุนเวียน (10) ─
11-1101 เงินสด FINANCE
11-1201 ธนาคาร FINANCE — บัญชีหลัก
11-1202 ธนาคาร FINANCE — รับชำระค่างวด
11-2102 ลูกหนี้เช่าซื้อ
11-2103 หัก: ค่าเผื่อหนี้สงสัยจะสูญ
11-2104 ลูกหนี้ไฟแนนซ์ภายนอก
11-3103 สินค้ายึดคืน/ซ่อมแล้ว
11-4101 ภาษีซื้อ
11-4102 ภาษีซื้อยังไม่ถึงกำหนด
11-4103 ภาษีถูกหัก ณ ที่จ่าย

─ 21-XXXX หนี้สินหมุนเวียน (8) ─
21-1102 เจ้าหนี้คู่ค้า — SHOP (clearing for inter-company)
21-2101 ภาษีขาย ภ.พ.30
21-2102 ภาษีขายรอเรียกเก็บ
21-2103 ภ.พ.36 ค้างจ่าย
21-2104 ภาษีขายดอกเบี้ยรอตัดบัญชี [DEFERRED — for CR-001 if VAT on interest]
21-2202 รายได้ดอกเบี้ยรอตัดบัญชี [DEFERRED — for W-003 unearnedInterest]
21-3201 เจ้าหนี้สรรพากร ภ.พ.30 รอชำระ
21-3202 เจ้าหนี้สรรพากร ภ.ง.ด.53 รอชำระ
21-4201 เงินรับล่วงหน้า
21-5101 เงินเกินของลูกค้า

─ 31/32-XXXX ส่วนของผู้ถือหุ้น (2) ─
31-1101 ทุนสามัญ FINANCE
32-1101 กำไร(ขาดทุน)สะสม FINANCE

─ 42-XXXX รายได้อื่น (5) — ใช้ 42-2XXX prefix แยกจาก SHOP's 42-1XXX ─
42-2101 รายได้ดอกเบี้ยเช่าซื้อ (HP Interest Income)
42-2102 ค่างวดเบี้ยปรับล่าช้า (Late Fee Income)
42-2103 ค่ามัดจำ/เงินประกันที่ริบ
42-2104 รายได้จากการยึดเครื่อง (Repossession Income)
42-2105 รายได้ค่าคอมมิชชันจาก SHOP [unused in A.1a — for A.1b inter-company]

─ 53-XXXX ค่าใช้จ่าย (6) ─
53-1701 หนี้สูญ (Bad Debt Expense) — ใหม่
53-1702 หนี้สงสัยจะสูญ (Doubtful Debt Expense)
53-1801 ค่านายหน้าจ่าย SHOP (Commission Expense — for A.1b inter-company)
53-1802 ค่าธรรมเนียม PaySolutions
53-1803 ค่าธรรมเนียมโอนเงิน
53-1601 ค่าเสื่อมราคา — อุปกรณ์ FINANCE

─ 54-XXXX รายจ่ายต้องห้ามทางภาษี (2) ─
54-1101 ภงด. ทางภาษี ภ.ง.ด.3
54-1102 ภงด. ทางภาษี ภ.ง.ด.53

Plus 1 SHOP-side clearing account:
SHOP 11-2105 ลูกหนี้คู่ค้า — FINANCE (Due-from-FINANCE for inter-company)
```

**Total in DB after migration:** 109 SHOP + 25 (existing shared accounts re-tagged null) + 38 + 2 deferred + 1 clearing per side = ~155 accounts

### 3.4 Validation lookup change

In `journal-auto.service.ts createAndPost`:

```typescript
// Before:
const accounts = await tx.chartOfAccount.findMany({
  where: { code: { in: codes } },
  select: { code: true, nameTh: true, allowedCompanies: true },
});

// After:
const accounts = await tx.chartOfAccount.findMany({
  where: { code: { in: codes }, companyId: params.companyId },
  select: { code: true, nameTh: true },
});
// Validation simplifies — if account exists in this company's chart, allowed.
// If not exists → throw "account not in chart for company"
```

Same change in `journal.service.ts create + post`.

### 3.5 ACC constant remapping

```typescript
// journal-auto.service.ts — partition ACC by company chart
private static readonly SHOP_ACC = {
  CASH: '11-1101',
  REVENUE_NEW: '41-1101',
  REVENUE_USED: '41-1102',
  INVENTORY_NEW: '11-3101',
  INVENTORY_USED: '11-3102',
  COGS_NEW: '51-1101',
  COGS_USED: '51-1102',
  COMMISSION_INCOME: '42-1105',         // exists in owner CoA — for A.1b
  DUE_FROM_FINANCE: '11-2105',          // new clearing
} as const;

private static readonly FINANCE_ACC = {
  CASH: '11-1101',                      // FINANCE's cash, different account
  HP_RECEIVABLE: '11-2102',
  ALLOWANCE_DOUBTFUL: '11-2103',
  REPO_INVENTORY: '11-3103',
  VAT_INPUT: '11-4101',
  INTEREST_INCOME: '42-2101',           // moved from 42-1101 (was wrong code)
  LATE_FEE_INCOME: '42-2102',           // moved from 42-1102 (was wrong code)
  REPOSSESSION_INCOME: '42-2104',
  VAT_OUTPUT: '21-2101',
  CUSTOMER_CREDIT: '21-5101',
  DUE_TO_SHOP: '21-1102',               // new clearing
  BAD_DEBT_EXPENSE: '53-1701',          // moved from 53-1101 (was Salary!)
  COMMISSION_EXPENSE: '53-1801',        // for A.1b
} as const;
```

Update all references in createPaymentJournal, createContractActivationJournal, createBadDebtWriteOffJournal to use the new partitioned constants. Pass `companyId` from already-resolved (Phase A.0) caller.

### 3.6 Commission temporary removal

In `createPaymentJournal`, remove the commission income line:

```typescript
// REMOVED — defer to A.1b inter-company:
// lines.push({
//   accountCode: ACC.COMMISSION_INCOME, ...
// });
// TODO A.1b: post inter-company commission JE here

if (params.payment.monthlyCommission && params.payment.monthlyCommission.gt(0)) {
  Sentry.captureMessage('Payment commission not yet posted (deferred to A.1b)', {
    level: 'info',
    tags: { module: 'journal', kind: 'commission-deferred' },
    extra: { paymentId: params.payment.id, amount: params.payment.monthlyCommission.toString() },
  });
}
```

### 3.7 Frontend ChartOfAccountsPage

Add company selector dropdown above filters:

```tsx
<Select value={companyFilter} onValueChange={setCompanyFilter}>
  <SelectItem value="ALL">ทุกบริษัท (รวม shared)</SelectItem>
  <SelectItem value="SHOP">SHOP</SelectItem>
  <SelectItem value="FINANCE">FINANCE</SelectItem>
  <SelectItem value="SHARED">Shared (ไม่ระบุบริษัท)</SelectItem>
</Select>
```

API: `GET /chart-of-accounts?companyId=<id|"shared"|null>`. Backend filters accordingly.

Create/edit form: company selector required field (defaults to current filter if set).

---

## 4. File Structure

| File | Type | Wave |
|---|---|---|
| `apps/api/prisma/schema.prisma` | Modify | 1 |
| `apps/api/prisma/migrations/{ts}_chart_of_accounts_company_partition/migration.sql` | Create | 1 |
| `apps/api/prisma/seeds/chart-of-accounts.ts` | Replace (use 109 SHOP from CSV) | 1 |
| `apps/api/prisma/seeds/chart-of-accounts-finance.ts` | Create (44 FINANCE accounts) | 1 |
| `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.ts` | Modify (filter by companyId) | 2 |
| `apps/api/src/modules/chart-of-accounts/chart-of-accounts.controller.ts` | Modify (add ?companyId= query) | 2 |
| `apps/api/src/modules/chart-of-accounts/dto/create-chart-of-account.dto.ts` | Modify (add companyId field) | 2 |
| `apps/api/src/modules/chart-of-accounts/dto/update-chart-of-account.dto.ts` | Modify | 2 |
| `apps/api/src/modules/journal/journal-auto.service.ts` | Modify (ACC remap + lookup change + commission removal) | 2 |
| `apps/api/src/modules/journal/journal.service.ts` | Modify (lookup change in create + post) | 2 |
| `apps/web/src/pages/ChartOfAccountsPage.tsx` | Modify (company selector) | 3 |
| ~5 spec files | Modify (mock updates) | 4 |
| `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.spec.ts` | Create if absent (filter tests) | 4 |
| `apps/web/e2e/accounting-coa-multi-entity.spec.ts` | Create | 4 |
| `.claude/rules/accounting.md` | Update (new chart structure) | 5 |
| `docs/references/finance-chart-of-accounts.csv` | Create | 5 |

---

## 5. Wave order (single PR, multiple commits)

**Wave 1 — Schema + seed (single atomic commit)**
- Migration file + schema update
- Seed file replacement + new FINANCE seed
- Verify migrate dev passes locally

**Wave 2 — Backend code (3 commits)**
- (2a) `chart-of-accounts.service` + controller + DTO — companyId filter
- (2b) `journal-auto.service` — ACC partition + lookup + commission removal
- (2c) `journal.service` — lookup change

**Wave 3 — Frontend (1 commit)**
- ChartOfAccountsPage company selector + filter wiring

**Wave 4 — Tests + verification (1 commit)**
- Update mocks across affected specs
- New chart-of-accounts.service.spec
- E2E accounting-coa-multi-entity
- Full test + TS check

**Wave 5 — Docs + push + PR**
- accounting.md update
- finance-chart-of-accounts.csv reference
- Internal memo for นักบัญชี (commission temporary divergence)

---

## 6. Pattern Decisions (Captured from Brainstorm)

| ID | Decision | Choice |
|---|---|---|
| Q1 | CoA ground truth | Split 2 charts (SHOP + FINANCE) |
| Q2 | Schema | Composite unique (companyId, code) |
| Q3 | FINANCE chart size | ~38 + 2 deferred + 4 clearing |
| Q4 | Commission ownership | Proper inter-company (A.1b) |
| Q5 | Inter-company JE policy | Full inter-company (A.1b for wiring) |
| Q6 | Sub-phase split | A.1a (this) + A.1b (inter-company JE) |
| Q7 | Deferred accounts | Include 21-2202 + 21-2104 in seed |

---

## 7. Testing Strategy

### Unit tests (~30 new + ~20 existing updates)

| Area | Tests added |
|---|---|
| Schema | Migration backfill verification on test DB |
| Validation | (companyId, code) lookup correct; cross-company returns empty + throws |
| ACC remap | Bad debt write-off posts to '53-1701' (FINANCE chart); Interest income posts to '42-2101' |
| Commission | Payment JE has no COMMISSION_INCOME line; Sentry alarm fires when monthlyCommission > 0 |
| ChartOfAccounts CRUD | Filter by companyId; create with companyId; update preserves companyId |
| Frontend ChartOfAccountsPage | Company dropdown filters list; create form requires companyId |

### E2E (1 new)

- `accounting-coa-multi-entity.spec.ts`:
  - GET /chart-of-accounts → returns all
  - GET /chart-of-accounts?companyId=SHOP → ~109 rows
  - GET /chart-of-accounts?companyId=FINANCE → ~44 rows
  - POST create with companyId — verify saves correctly

### Cross-spec impact

ALL specs that mock `chartOfAccount.findMany` need updates (filter by companyId). Pattern verified in Phase A.0 — budget 1 hr for stale-mock fixes.

---

## 8. Success Criteria

- [ ] Schema migration applied — `chart_of_accounts` has `company_id` column + composite unique
- [ ] All existing 76 accounts re-tagged correctly (verify counts: SHOP/FINANCE/null match expected from `allowedCompanies`)
- [ ] 109 SHOP accounts seeded
- [ ] 44 FINANCE accounts seeded (38 + 2 deferred + 4 clearing — note: 2 of the 4 clearing are SHOP-side `11-2105 Due-from-FINANCE`)
- [ ] All unit tests pass (existing 2171 + ~30 new)
- [ ] All E2E tests pass (existing + 1 new)
- [ ] TypeScript: 0 errors
- [ ] Sentry: no error spike 1 hr post-deploy
- [ ] Manual: GET /chart-of-accounts?companyId=SHOP returns 109+ rows
- [ ] Manual: GET /chart-of-accounts?companyId=FINANCE returns ~44 rows
- [ ] Manual: trigger bad debt write-off → JE row in journal_lines references '53-1701' (not '53-1101')
- [ ] Documented: `accounting.md` updated
- [ ] Documented: `docs/references/finance-chart-of-accounts.csv` exists
- [ ] Internal memo sent to นักบัญชี (commission divergence + A.1b plan)

---

## 9. Risk & Mitigation

| Risk | Severity | Mitigation |
|---|---|---|
| Migration backfill miscategorizes accounts | CRITICAL | `gcloud sql backups create` pre-deploy. Manual review of mapping. Dry-run on staging. |
| ACC remapping breaks existing JEs in prod | HIGH | Old code records preserved (just moved to different chart). Forward-only fix. Existing JE rows reference old codes by string — they remain valid records. |
| Commission line removal causes SHOP P&L underreport | HIGH | **Documented temporary divergence**. Sentry alarm tracks. Internal memo. A.1b restores. |
| Frontend page breaks for users | LOW | Default to "All" filter — preserves current behavior. |
| Stale test mocks across modules | MEDIUM | Budget 1 hr fix cycle. |
| FK constraint blocks delete of SHOP/FINANCE company | LOW | Migration uses `ON DELETE SET NULL` so company deletion sets companyId to null (account becomes shared). |

### Backup before deploy (mandatory)

```bash
gcloud sql backups create --instance=bestchoice-db --project=bestchoice-prod --description="pre-A1a-coa-migration"
```

### Rollback plan

If migration breaks data:
1. Revert PR commit + redeploy
2. Manual restore: `psql` connect → restore `chart_of_accounts` table from backup
3. Total recovery: ~15 min

If migration succeeds but code has bug:
1. Cloud Run revision rollback (1 click) — schema stays new
2. Total recovery: ~5 min

---

## 10. Out of Scope (deferred to A.1b)

- ❌ Inter-company JE pairing (contract activation split, commission inter-company, repossession)
- ❌ Bad debt provision JE (Dr Bad Debt Expense / Cr Allowance)
- ❌ Customer credit overpayment JE
- ❌ Repossession resale JE
- ❌ Backfill historical JEs with new account codes
- ❌ Year-end closing entries (Phase A.2)
- ❌ HP interest accrual policy (W-003 unearnedInterest implementation — Phase A.2)

---

## 11. Estimated Effort

| Phase | Time |
|---|---|
| Wave 1 (schema + seed) | ~5 hr |
| Wave 2 (backend) | ~4 hr |
| Wave 3 (frontend) | ~3 hr |
| Wave 4 (tests) | ~5 hr |
| Wave 5 (docs + PR) | ~2 hr |
| Self-review + 2-stage subagent review + fix | ~2 hr |
| **Total A.1a** | **~21 hr** |

---

## 12. Follow-up Specs

After A.1a ships:

- **A.1b** — Inter-company JE wiring (full SHOP↔FINANCE flow): contract activation split, commission inter-company, repossession resale, customer credit JE, bad debt provision JE
- **A.2** — Policy-dependent fixes: HP interest recognition (W-003 unearnedInterest), CR-001 VAT on interest decision (CPA), year-end closing entries
- **A.3** — Backfill historical orphan transactions (36 prod orphan payments + historical activations)
- **B** — Build missing reports (P&L from JE not raw tables, Balance Sheet from JE, Cash Flow investing/financing, Notes to FS, GL endpoint, HP Subsidiary Ledger, PND.50/51)

---

## 13. References

- Audit report: `docs/reports/2026-04-29-accounting-audit.md`
- Phase A.0 spec: `docs/superpowers/specs/2026-04-29-accounting-phase-a0-critical-fix-design.md`
- Phase A.0 PR: #722 (`feat/accounting-phase-a0-critical-fix`)
- Owner CoA: `docs/references/owner-chart-of-accounts.csv`
- Accounting rules: `.claude/rules/accounting.md`
- Memory: `project_accounting_phase_a0_pr722.md`
- Memory: `project_accounting_audit_2026_04_29.md`
