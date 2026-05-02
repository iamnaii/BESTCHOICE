# Pre-Merge Guard Report — 2026-05-02

**Generated**: 2026-05-02  
**Reviewed branches**: 3 most-recently-committed unmerged feature branches  
**Reviewer**: Pre-Merge Guard (automated)

---

## Summary Table

| Branch | Files Δ | Critical | Warning | Info | Recommendation |
|--------|---------|----------|---------|------|----------------|
| `feat/accounting-phase-a1b-intercompany-je` | +3,835 / -181 (23 files) | 0 | 0 | 2 | ✅ APPROVE |
| `feat/collections-partial-payment-escalate` | +3,817 / -1,936 (30 files) | 0 | 1 | 2 | ⚠️ REVIEW |
| `feat/collections-promise-to-pay-lifecycle` | +7,373 / -525 (44 files) | 0 | 3 | 3 | ⚠️ REVIEW |

---

## Branch 1: `feat/accounting-phase-a1b-intercompany-je`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-04-29 18:10 +0700  
**Summary**: Phase A.1b inter-company journal entries — splits SHOP/FINANCE JEs for contract activation, payment, repossession, bad debt, and early payoff. Adds 796-line test suite.

### File Changes
- `journal-auto.service.ts` — +665 lines (now 1,124 lines total)
- `journal-auto.service.spec.ts` — +796 lines (new inter-company test cases)
- `contract-payment.service.ts` — +25 lines (shopCompanyId resolution)
- `repossessions.service.ts` — +38 lines (repossession JE fixes)
- `bad-debt.service.ts` — +48 lines (bad debt provision JE)
- `data-audit.service.ts` — +12 lines (SHOP company lookup for orphan detection)
- `inter-company-link.util.ts` — new utility (25 lines)
- 2 large doc files (1,525 + 434 lines) added to `docs/`
- E2E test: `accounting-inter-company-flow.spec.ts` (125 lines)

### Critical Issues — NONE

- `@UseGuards(JwtAuthGuard, RolesGuard)` present at class level on all modified controllers ✓
- No new controllers added ✓
- No `Number()` on financial fields in production services — all money uses `.toNumber()` on Prisma.Decimal ✓
- `deletedAt: null` present on all new queries ✓
- `$queryRaw` usages are pre-existing in main; no new raw SQL added ✓
- No hardcoded secrets ✓

### Warning Issues — NONE

- DTOs unchanged; no new DTOs required ✓
- No new React components ✓
- All mutations already have `queryClient.invalidateQueries()` ✓

### Info Issues

1. **`journal-auto.service.ts` is 1,124 lines** — exceeds the 500-line soft limit. Growing file; consider extracting SHOP-side JE methods into a `JournalShopService` in a future sprint.

2. **`Number(l.debit ?? 0)` in spec file** — `journal-auto.service.spec.ts` lines 628, 762, 844 use `Number()` for balance-check assertions. This is test-only code and does not affect production precision. Not a rule violation in test context.

### Recommendation: ✅ APPROVE

No blocking issues. The inter-company JE implementation is well-tested (796 new test lines, E2E coverage). Decimal precision is correctly maintained throughout production code.

---

## Branch 2: `feat/collections-partial-payment-escalate`

**Author**: Akenarin Kongdach + Claude  
**Last commit**: 2026-04-28 12:02 +0700  
**Summary**: Adds partial-payment-reschedule endpoint (pay partial now, promise remainder) and escalation guardrail (LETTER/MDM/LEGAL) for overdue contracts. Includes `PartialPaymentRescheduleDialog` UI component.

### File Changes
- `overdue.service.ts` — +369 lines (partialPaymentReschedule + escalate logic)
- `overdue.controller.ts` — +28 lines (2 new endpoints)
- `PartialPaymentRescheduleDialog.tsx` — new component (320 lines)
- `ContactLogDialog.tsx` — +417 lines (integration of escalation UI)
- `partial-payment-reschedule.dto.ts` — new DTO (59 lines, fully validated)
- `escalate.dto.ts` — new DTO (14 lines, fully validated)
- `queue.service.ts` — +48 lines
- `package-lock.json` — large churn from dep merge (3,810 file diff lines)

### Critical Issues — NONE

- New endpoints have `@Roles()` decorators ✓  
  - `POST :contractId/partial-payment-reschedule` → `@Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER')` ✓
  - `POST :contractId/escalate` → `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')` ✓
- `OverdueController` class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` unchanged ✓
- `deletedAt: null` present on all new Prisma queries ✓
- DTOs have full class-validator coverage with Thai messages ✓
- `evidenceUrl` validated with HTTPS regex ✓
- No hardcoded secrets ✓

### Warning Issues

1. **`Number()` used in frontend display calculations** (`ContactLogDialog.tsx`):  
   ```ts
   const amount1Num = Number(settlementAmount);  // UI display
   const amountPaidNum = Number(amountPaid);      // UI display
   ```
   These are used only for UI arithmetic (sum display, remaining calculation in the dialog) — not sent to the API as financial data. The API DTO is `@Type(() => Number) @IsNumber(...)` which handles the correct server-side type conversion. Technically acceptable for UI, but inconsistent with project convention of using Decimal throughout.

   **Suggested fix**: Use `parseFloat()` or validate before calculation, and add a comment clarifying these are display-only.

### Info Issues

2. **`PartialPaymentRescheduleDto.amountPaid` uses `@Type(() => Number)`** — class-transformer converts the incoming string to a `number` before persistence. The service then passes this `number` to `new Prisma.Decimal(paid)` for DB write, which is acceptable. However, it would be cleaner to accept as string and convert to `new Prisma.Decimal()` directly in the service.

3. **`package-lock.json` has 3,810-line diff** — indicates a lockfile merge from a dep-update branch was included in this feature branch. Should be reviewed separately or rebased onto the dep update branch after it merges to main.

### Recommendation: ⚠️ REVIEW

No critical security issues. One minor warning about `Number()` in frontend display code. The larger concern is the `package-lock.json` churn which obscures the actual feature diff. Recommend rebasing onto main after dep updates merge to reduce noise.

---

## Branch 3: `feat/collections-promise-to-pay-lifecycle`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-04-28 10:59 +0700  
**Summary**: Full Promise-to-Pay lifecycle redesign — `PromiseSlot` model, N-slot promise manager, supersede chain, `MdmLockService` auto-lock/unlock, `promise-resolution.cron`, `no-promise-lock.cron`, `PaymentService.checkPromiseAfterPayment` hook, `InstallmentPickerPopover`, `SupersedePromiseConfirmDialog`, and `PromiseTab` redesign.

### File Changes
- `overdue.service.ts` — +189 lines (now ~1,342 lines total)
- `promise.service.ts` — new service (225 lines)
- `mdm-lock.service.ts` — new service (81 lines)
- `installment-allocator.util.ts` — new utility (24 lines)
- `payments.service.ts` — +143 lines (`checkPromiseAfterPayment` hook)
- `ContactLogDialog.tsx` — +631 lines (now 610 lines total — rewrite)
- `InstallmentPickerPopover.tsx` — new component (117 lines)
- `SupersedePromiseConfirmDialog.tsx` — new component (76 lines)
- `PromiseTab.tsx` — +109 lines
- 2 E2E tests (99 + 111 lines)
- 2 large plan docs (2,955 + 437 lines) in `docs/`

### Critical Issues — NONE

- New endpoints `GET /overdue/contracts/:id/cycle-deadline` and `GET /overdue/contracts/:id/overdue-installments` have `@Roles(...)` decorators ✓
- `OverdueController` class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` present ✓
- `MdmLockService`, `PromiseService` are not controllers — no guard concern ✓
- `deletedAt: null` on all new Prisma queries ✓
- No hardcoded secrets ✓
- No SQL injection (`$queryRaw` not used in new code) ✓

### Warning Issues

1. **`Number(dto.settlementAmount ?? 0)` in legacy slot path** (`overdue.service.ts:964,972`):  
   In the legacy (non-`dto.slots`) code path for `PROMISED` call logs, `settlementAmount` is converted to a JS `number` before being stored:
   ```ts
   settlementAmount: Number(dto.settlementAmount ?? 0),  // should be new Prisma.Decimal(...)
   ```
   The value is immediately used in `new Prisma.Decimal(s.settlementAmount)` for sum validation, and Prisma writes the `number` to a `@db.Decimal` field (Prisma handles the number→Decimal conversion). The DTO `@IsNumber({ maxDecimalPlaces: 2 })` limits precision exposure.  
   **Practical risk**: Low. **Rule violation**: Yes. Should use `new Prisma.Decimal(dto.settlementAmount ?? 0)` for consistency.

2. **`Number((active as any).settlementAmount ?? 0)` in `getCycleDeadline`** (`overdue.service.ts:1308`):  
   A Prisma Decimal field from the database is converted with `Number()` for the GET response. This is display-only (not written to DB). However, it propagates a float where a string representation would preserve precision in the JSON response.  
   **Suggested fix**: `(active as any).settlementAmount?.toString() ?? '0'` or cast as `Prisma.Decimal` and call `.toFixed(2)`.

3. **Multiple `(active as any)` casts** (`overdue.service.ts:1295–1309`):  
   The `active` variable (result of `prisma.callLog.findFirst`) is accessed via 6 consecutive `(active as any)` casts, suggesting the Prisma query's `include` shape isn't reflected in the TypeScript type. This is a type safety gap:
   ```ts
   const deadline = (active as any)?.cycleDeadline  // unsafe
   const activeSlots: Array<...> = (active as any)?.slots ?? [];  // unsafe
   ```
   **Suggested fix**: Type the query with a typed `include` shape or use a typed intermediate interface.

### Info Issues

4. **`overdue.service.ts` is ~1,342 lines** — significantly exceeds the 500-line limit. The service now handles collections queue, promise lifecycle, MDM lock decisions, cycle deadlines, overdue installments, and escalation. Should be split: consider `PromiseLifecycleService`, `MdmDecisionService`.

5. **`ContactLogDialog.tsx` is 610 lines** — large React component. Consider splitting into `PromiseSlotManager`, `EscalationPanel`, and the core dialog.

6. **`(p.amountDue as any).sub(p.amountPaid as any)` pattern** (`overdue.service.ts:1143`):  
   Decimal arithmetic via `any` cast suggests the Prisma query return type isn't carrying `Decimal` for `amountDue`/`amountPaid`. Using `as any` to call `.sub()` works at runtime but loses type safety. Prefer `new Prisma.Decimal(p.amountDue as string).sub(new Prisma.Decimal(p.amountPaid as string))`.

### Recommendation: ⚠️ REVIEW

No security blockers. Three warnings relating to financial precision consistency and type safety. The `Number(dto.settlementAmount)` in the legacy slot path (Warning #1) should be fixed before merge for consistency with the project rule. Warnings #2 and #3 are lower priority but should be tracked as tech debt.

---

## Appendix: Checks Not Triggered

| Check | Result |
|-------|--------|
| Missing `@UseGuards` on new controllers | None found |
| Missing `@Roles()` on new endpoints | None found |
| Hardcoded secrets/API keys | None found |
| Unparameterized `$queryRawUnsafe` | None found |
| `deletedAt: null` missing in new queries | None found |
| Raw `fetch()` in React components | None found |
| Missing `queryClient.invalidateQueries()` after mutations | None found |
| Hardcoded hex colors (`#...`) | Not checked (JS/TS scope only) |
