# Accounting Phase A.0 — Critical Fix (Code-Only) — Spec

**Date:** 2026-04-29
**Type:** Code fix sprint (no CoA changes, no policy decisions)
**Status:** Draft for review
**Predecessor:** `docs/reports/2026-04-29-accounting-audit.md` (audit found 41 critical findings, 79 total)

---

## 1. Goal

แก้ critical bugs ในระบบ accounting/journal ที่**ไม่ต้องรอ business decision** เพื่อหยุด orphan transactions ใหม่ + ปิด silent failure paths ก่อนทำ CoA reconciliation (A.1) และ policy work (A.2-A.3) ในเฟสถัดไป

**Deliverable:** 1 PR with 11 fixes (5 logical waves), 20+ unit tests, 3 E2E tests, 1 migration. Ship to prod in 1 day.

**ไม่ทำใน spec นี้:**
- เปลี่ยน account code / เพิ่มบัญชี / re-align block ใน CoA
- เพิ่ม JE สำหรับ event ที่ต้องตัดสิน policy (commission ownership, inter-company, year-end closing, customer credit)
- Stock JEs (trade-in, PO receipt, write-off)
- Backfill historical orphan transactions
- Build missing reports (P&L, BS, CF)

---

## 2. Background

จาก audit `docs/reports/2026-04-29-accounting-audit.md`:

**Critical chain ใน prod (Layer 4 prod data):**
- มี JournalEntry **1 row total** ตลอดประวัติ prod (April 2026 ฿6,125.63)
- มี **36 orphan PAID payments** ตั้งแต่ 2025-11-24 (ลูกค้าจ่ายจริง ไม่มี ledger record)

**Root cause chain:**
1. F-2-001: `journal-auto.service.ts:296` — `hpReceivable = financedAmount + i+c+v` แต่ `financedAmount` มี i+c+v อยู่แล้ว → double-count → throw ทุก contract activation
2. F-1-002: `contract-workflow.service.ts:443` try/catch กลืน throw → activation succeeds in DB แต่ไม่มี JE
3. F-1-003: `paysolutions.service.ts:713` webhook ไม่มี JournalAutoService injection → 36 orphan payments
4. F-3-027: `createAndPost` ไม่ validate `allowedCompanies` + `resolveCompanyId` non-deterministic
5. F-1-016 / F-1-017: try/catch ใน expense + receipt void → silent JE failure
6. F-6-001 ถึง F-6-004: period close ไม่ validate / ไม่ block / ไม่มี audit trail

---

## 3. Scope — 11 Fixes ใน 5 Waves

### Wave 1 — Foundation (3 fixes ต้องอยู่ commit เดียว)

**ทำไมต้องรวม:** ถ้า #1 ไม่มี #2 → JE สร้างได้แต่ try/catch ยังมี (ใช้ครึ่งทาง). ถ้า #2 ไม่มี #1 → contract activation ทุกตัว fail (math throws).

| # | ID | Change |
|---|---|---|
| 1 | F-2-001 | `journal-auto.service.ts:296` `hpReceivable = financedAmount.add(...)` → `hpReceivable = financedAmount` |
| 2 | F-1-002 / F-2-003 | `contract-workflow.service.ts:443` ลบ try/catch รอบ `createContractActivationJournal` — ให้ propagate |
| 3 | F-2-010 | `journal-auto.service.ts:91-93` balance check ใช้ `Prisma.Decimal` แทน `Number()`; tolerance 0.01 |

### Wave 2 — Company Validation (3 changes)

**Order matters:** 5a → 5c → 5b (validation last, after callers updated)

| # | Change |
|---|---|
| 5a | `journal-auto.service.ts:64` `resolveCompanyId` add `orderBy: { createdAt: 'asc' }` |
| 5c | Pass explicit `companyId` from 3 callers: `contract-workflow.service.ts` (use `contract.companyId`), `payments.service.ts` (use `contract.companyId`), `accounting.service.ts` (use `expense.branch.companyId`) |
| 5b | `journal-auto.service.ts createAndPost` add: query `chartOfAccount` for accountCodes in lines, query `companyInfo`, throw `BadRequestException` if any account.allowedCompanies excludes companyCode |

### Wave 3 — Other try/catch removals

| # | ID | Change |
|---|---|---|
| 3 | F-1-016 / F-2-008 | `accounting.service.ts:374-391` ลบ try/catch รอบ `createExpenseJournal` |
| 4 | F-1-017 | `receipts.service.ts:407-426` ลบ try/catch รอบ `createReversalJournal` |

### Wave 4 — PaySolutions Webhook

| # | ID | Change |
|---|---|---|
| 7 | F-1-003 | `paysolutions.service.ts` inject `JournalAutoService` (also update `paysolutions.module.ts` to import `JournalModule`). After Payment.update to PAID inside webhook tx, call `createPaymentJournal`. **Pattern: Sentry+log+continue** — do NOT rethrow (webhook must not block payment) |

### Wave 5 — Period Close Hardening (5 changes + 1 migration)

| # | ID | Change |
|---|---|---|
| 8 | F-6-001 | `journal.service.ts:200` `post()` add `validatePeriodOpen(prisma, entry.entryDate, entry.companyId)` at start |
| 9 | F-6-002 | `journal-auto.service.ts createAndPost` check if `entryDate` in CLOSED period; if yes: redirect entryDate to current period + prepend `[Originally for YYYY-MM]` to description + Sentry warning |
| 10 | F-6-003 | `monthly-close.service.ts:154` `closePeriod` check `existing.auditIssues.hasIssues`; throw if true unless `forceCloseReason` provided (≥50 chars) → AuditLog `PERIOD_FORCE_CLOSE` |
| 11 | F-6-004 | `accounting.controller.ts:268` add `@Request() req`. `monthly-close.service.ts:253` `reopenPeriod(dto, userId)`: create AuditLog `PERIOD_REOPEN` with boardResolutionId + reason. New migration adds `reopenedAt`, `reopenedById`, `boardResolutionId` to `accounting_periods` |
| — | DTO changes | `close-month.dto.ts` add optional `forceCloseReason: string @MinLength(50)`. `reopen-period.dto.ts` make `boardResolutionId` + `reason` required |

---

## 4. Pattern Decisions (Made — overrideable)

### P1 — Sync user/staff actions: rethrow on JE failure
Sites: contract activation (#2), expense pay (#3), receipt VOID (#4)

**Behavior:** JE fails → `$transaction` rollback → operation fails → user sees error → retry
**Rationale:** silent divergence is worse than "operation failed, please retry"

### P2 — Async webhook: Sentry+log+continue
Sites: PaySolutions webhook (#7)

**Behavior:** JE fails → Sentry capture + log error + continue payment processing
**Rationale:** Customer paid via QR — payment must complete; manual reconciliation from Sentry alert

### P3 — JournalAutoService in CLOSED period: soft-block (redirect)
Sites: #9

**Behavior:** entryDate in CLOSED period → redirect to current OPEN period + add `[Originally for YYYY-MM]` to description
**Rationale:** webhook payments shouldn't fail just because period closed; accounting team reconciles via description note

### P4 — closePeriod with auditIssues: hard-block + OWNER override
Sites: #10

**Behavior:** `hasIssues=true` → throw BadRequestException unless `forceCloseReason` (≥50 chars) provided → AuditLog
**Rationale:** known issues shouldn't lock-in unintentionally; OWNER has documented escape hatch

### P5 — Customer Credit overpayment JE (21-5101)
**Decision:** Defer to A.1 — 21-5101 not in owner CoA (F-3-010); avoid pre-committing accounts

---

## 5. File Structure

### Modified files (10)

| File | Wave | Changes |
|---|---|---|
| `apps/api/src/modules/journal/journal-auto.service.ts` | 1, 2, 5 | math fix, validation, Decimal balance, soft-block period |
| `apps/api/src/modules/journal/journal.service.ts` | 5 | validatePeriodOpen in post() |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` | 1, 2 | remove try/catch, pass companyId |
| `apps/api/src/modules/payments/payments.service.ts` | 2 | pass companyId |
| `apps/api/src/modules/accounting/accounting.service.ts` | 2, 3 | pass companyId, remove try/catch |
| `apps/api/src/modules/receipts/receipts.service.ts` | 3 | remove try/catch |
| `apps/api/src/modules/paysolutions/paysolutions.service.ts` | 4 | inject + post payment JE |
| `apps/api/src/modules/paysolutions/paysolutions.module.ts` | 4 | import JournalModule |
| `apps/api/src/modules/accounting/monthly-close.service.ts` | 5 | enforce auditIssues, audit reopen |
| `apps/api/src/modules/accounting/accounting.controller.ts` | 5 | add @Request() to reopenPeriod |

### DTO changes (2)
- `apps/api/src/modules/accounting/dto/close-month.dto.ts` — add optional `forceCloseReason`
- `apps/api/src/modules/accounting/dto/reopen-period.dto.ts` — make `boardResolutionId` + `reason` required

### New migration (1)
- `apps/api/prisma/migrations/{timestamp}_add_period_reopen_audit_fields/migration.sql`
- Add `reopened_at TIMESTAMPTZ`, `reopened_by_id TEXT`, `board_resolution_id TEXT` to `accounting_periods`
- Update `apps/api/prisma/schema.prisma` AccountingPeriod model

### Test files (5 modified, 0 new)
- `journal-auto.service.spec.ts` — add tests for #1, #5b, #6, #9
- `contract-workflow.service.spec.ts` — add atomic rollback test (#2)
- `paysolutions.service.spec.ts` — add #7 tests (post JE, JE failure doesn't block payment, Sentry called)
- `monthly-close.service.spec.ts` — add #10 + #11 tests
- `journal.service.spec.ts` — add #8 test

### New E2E tests (3)
- `apps/web/e2e/accounting-contract-activation.spec.ts` — full flow → verify JE created + balanced
- `apps/web/e2e/accounting-paysolutions-webhook.spec.ts` — simulate webhook → verify Payment + JE
- `apps/web/e2e/accounting-period-close.spec.ts` — close with mock issues → verify hard block; with forceCloseReason → verify AuditLog + status=CLOSED

---

## 6. Commit Order (within single PR)

PR uses **squash merge** (project default) so commits below are for review traceability — main gets 1 squash commit at end.

| Commit | Wave | Files | Notes |
|---|---|---|---|
| (a) | 1 | journal-auto.service.ts + spec, contract-workflow.service.ts + spec | math + Decimal + try/catch removal |
| (b) | 2 | journal-auto.service.ts (+5a, +5b), 3 callers + spec | resolveCompanyId ORDER BY → callers pass companyId → validation |
| (c) | 3 | accounting.service.ts, receipts.service.ts + specs | other try/catch removals |
| (d) | 4 | paysolutions.service.ts + module + spec, paysolutions.module.ts | webhook JE with Sentry pattern |
| (e) | 5 | migration + schema, journal.service.ts + spec, monthly-close.service.ts + spec, accounting.controller.ts, 2 DTOs | period close + reopen audit |
| (f) | E2E | 3 new E2E specs | end-to-end verification |

---

## 7. Testing Strategy

### Unit tests (~20 new)

| Wave | Tests added |
|---|---|
| 1 | (i) JE balanced after math fix; (ii) balance check rejects unbalanced; (iii) Decimal precision 100 lines fractional satang; (iv) contract rollback on JE failure; (v) JE created on successful activation |
| 2 | (i) resolveCompanyId returns same row across calls; (ii) caller passes companyId not fallback; (iii) FINANCE-only account thrown when SHOP companyId; (iv) accounts with empty allowedCompanies allowed for any company |
| 3 | (i) expense rollback on JE failure; (ii) receipt void rollback; (iii) error message propagated to user; (iv) original receipt JE not reversed if reversal fails |
| 4 | (i) webhook posts JE on PAID; (ii) JE failure doesn't block Payment.update; (iii) Sentry.captureException called with correct tags |
| 5 | (i) post() throws if entryDate in CLOSED; (ii) auto-JE redirected when CLOSED; (iii) closePeriod throws on hasIssues; (iv) reopenPeriod creates AuditLog with userId |

### E2E tests (3 new)

1. **`accounting-contract-activation.spec.ts`** — login OWNER → POS → activate contract → query GET /journal-entries?referenceType=CONTRACT&referenceId=$id → assert exists + balanced
2. **`accounting-paysolutions-webhook.spec.ts`** — mock POST /paysolutions/webhook with success payload → assert Payment.status=PAID + JournalEntry created with referenceType=PAYMENT
3. **`accounting-period-close.spec.ts`** — create period with hasIssues=true via test fixture → POST /expenses/periods/close → expect 400; retry with `forceCloseReason: "..."` 50 chars → expect 200 + AuditLog row exists

### Manual verification (post-deploy)

1. Run `apps/api/scripts/audit-trial-balance.ts` against prod → record orphan payment count baseline
2. Make 1 test contract end-to-end → verify JournalEntry table has matching row + balanced
3. Trigger 1 PaySolutions test webhook → verify JournalEntry row appears
4. Re-run audit script after 24h → orphan payment count should NOT grow (existing 36 stay until A.3 backfill)

---

## 8. Success Criteria

- [ ] All unit tests pass (existing 577 + ~20 new)
- [ ] All E2E tests pass (existing 35+ + 3 new) — note: chat_snoozes drift unrelated to this PR may still cause unrelated E2E failures
- [ ] TypeScript check clean (`./tools/check-types.sh all`)
- [ ] CI deploy success (Lint + 4 E2E shards + Build + Migrations + Cloud Run + Firebase)
- [ ] Sentry **no error spike** in 1 hour post-deploy
- [ ] Layer 4 prod re-run after 24h: **new** orphan payment count = 0 (old 36 await A.3 backfill)
- [ ] 1 manual contract activation → JournalEntry exists + balanced
- [ ] 1 manual PaySolutions webhook test → JournalEntry exists

---

## 9. Risk & Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Wave 1 deploy breaks contract activation in prod | Activation fails for users until rollback | Deploy at low traffic; monitor Sentry 30 min post-deploy; rollback ready (~10 min revert) |
| Wave 2 caller misses companyId, validation throws | Operations fail in prod | grep all call sites + add caller-specific unit tests + E2E covers contract path |
| Wave 4 webhook JE failure rate spikes | Sentry alert flood; orphan payments resume | Sentry alert threshold tuned; manual reconcile process documented; option to roll back Wave 4 only |
| Wave 5 migration on prod | 0 risk (3 optional NULL fields, no data movement) | N/A |
| F-2-001 makes existing JE "look weird" | None — Layer 4 confirmed prod has 1 JE total | Clean slate; backfill in A.3 |
| F-3-027 validation throws on existing manual JE | Manual JE may have wrong companyId | journal.service.ts already has manual validation (this fix only adds to auto path) |

### Rollback plan
- All changes are in single PR with squash merge → `git revert <merge-sha>` + push → trigger deploy → ~10 min total
- Migration is additive (3 optional fields) → no data migration to reverse

---

## 10. Out of Scope (deferred)

- ❌ All findings dependent on owner CoA decision (F-2-002, F-3-001 to F-3-022 except F-3-027) → A.1
- ❌ All findings dependent on policy decision (F-2-005 interest, F-2-007/F-3-028 commission, F-1-011 inter-company, CR-001 VAT) → A.2
- ❌ Stock JEs (F-1-005 trade-in, F-1-006 PO, F-1-007 write-off) → A.1 (after stock-related accounts confirmed)
- ❌ Year-end closing entries (F-1-013 / F-6-007) → A.2 (depends on retained earnings code from A.1)
- ❌ Bad debt provision JE (F-1-009) → A.1 (depends on Bad Debt Expense + Allowance accounts from A.1)
- ❌ Repossession resale JE (F-1-018) → A.1
- ❌ Backfill 36 orphan payments + historical activations → A.3 (depends on A.0 + A.1 deployed + CPA sign-off)
- ❌ Build missing reports (P&L, BS, CF, Notes, GL, PND.50/51, subsidiary ledger) → Phase B
- ❌ Customer Credit overpayment JE (F-2-006) → A.1 (uses 21-5101 not in owner CoA)
- ❌ Late fee waiver JE (F-1-020) → A.2 (depends on accrual policy)

---

## 11. Estimated Effort

| Phase | Time |
|---|---|
| Wave 1 implementation | ~1 hr |
| Wave 2 implementation | ~2 hr |
| Wave 3 implementation | ~30 min |
| Wave 4 implementation | ~2 hr |
| Wave 5 implementation | ~3 hr |
| Unit tests (~20) | ~3 hr |
| E2E tests (3) | ~2 hr |
| Self-review + /review subagent + fix | ~1 hr |
| Deploy + monitor | ~1 hr |
| **Total** | **~15 hr** |

---

## 12. Follow-up Specs (Anticipated)

After this spec ships:

- **A.1 — CoA Reconciliation Fix** — depends on owner business decision #1 (CoA ground truth). Adds new accounts, re-aligns blocks, fixes BAD_DEBT_EXPENSE mapping, enables F-1-001/005/006/007/009 stock + sales + provision JEs, F-2-006 customer credit JE.
- **A.2 — Policy-Dependent Fixes** — depends on CPA decisions (interest, commission, VAT, inter-company). Year-end closing entries.
- **A.3 — Historical Backfill** — depends on A.0 + A.1 deployed + CPA sign-off. Backfill 36 orphan payments + historical contract activations.
- **B — Build Missing Reports** — General Ledger, Balance Sheet (from JE), Cash Flow investing/financing, Notes to FS, HP Subsidiary Ledger, PND.50/51.

---

## 13. References

- Audit report: `docs/reports/2026-04-29-accounting-audit.md`
- Audit raw outputs: `docs/reports/audit-2026-04-29-raw/`
- Audit script: `apps/api/scripts/audit-trial-balance.ts`
- Owner CoA: `docs/references/owner-chart-of-accounts.csv`
- Accounting rules: `.claude/rules/accounting.md`
- Memory: `project_accounting_audit_2026_04_29.md`
- Memory: `project_interest_recognition_policy.md` (W-003 / N-005 deferred)
