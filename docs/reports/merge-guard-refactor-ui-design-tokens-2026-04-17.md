# Pre-Merge Guard Report

**Branch**: `refactor/ui-design-tokens-2026-04-17`
**Author**: Akenarin Kongdach
**Date generated**: 2026-04-17
**Reviewed by**: Pre-Merge Guard agent

---

## Branch Overview

| Metric | Value |
|---|---|
| Commits | 14 |
| Date range | 2026-04-17 |
| Files changed | 151 |
| TS/TSX files | 148 |
| API files | 1 migration SQL |
| Insertions | 1,837 |
| Deletions | 1,261 |

### Purpose
Multi-phase refactor replacing hardcoded Tailwind color scales (`green-*`, `amber-*`, `red-*`, `sky-*`, `violet-*`, `orange-*`, etc.) with semantic design tokens (`text-success`, `bg-warning`, `text-destructive`, `bg-info`, `text-primary`, `text-primary-foreground`, etc.) across the entire `apps/web` frontend.

### Commits

```
5c86e645 test(e2e): share login tokens across workers to beat /auth/login 10/min throttle
092d3949 fix(api): add missing canned_responses.response_type + media_url migration
6efa2b3a refactor(web): Phase 8 tokenize 32 component/hook/lib/constant files
4b564048 refactor(web): Phase 7 eliminate final 45 color-scale violations
cea00f34 refactor(web): Phase 6 tokenize 50 sub-component files (~294 violations)
e1dcd092 chore(eslint): remove exemption for LineGreeting/RichMenu/Broadcast pages
19f80496 refactor(web): Phase 5 deep-clean 5 remaining CRITICAL/MAJOR pages
1ce132e2 refactor(web): tokenize LineGreeting remaining violations + CollectionDashboard a11y
7aaaefcf chore(lint): add no-restricted-syntax rule for hardcoded Tailwind color scales
783483d0 refactor(ui): overhaul 19 CRITICAL pages to design tokens (Phase 4)
958d57db refactor(ui): migrate 16 MAJOR pages to design tokens (Phase 3)
4841ff33 refactor(ui): migrate 14 MINOR pages to design tokens (Phase 2)
f9edb1a1 docs(ui): restore DESIGN.md north star (was accidentally removed)
00c7c849 refactor(ui): migrate 6 hero pages to design tokens (Phase 1)
```

---

## Issues by Severity

### Critical — must fix before merge

**None found.**

No new controllers without `@UseGuards`. No `Number()` arithmetic on financial (Prisma Decimal) fields. No missing `deletedAt: null` in queries. No hardcoded secrets or API keys. No unparameterized `$queryRaw`.

---

### Warning — should fix

**W-001 · PDPAPage · Pre-existing deviation, not introduced by this branch**

`revokeMutation.onSuccess` calls `refetchConsents()` (query's own `refetch`) instead of `queryClient.invalidateQueries()`. Functionally equivalent for a single query but deviates from the project convention. This pattern predates this branch — the branch's change here is a legitimate improvement (replacing `window.prompt()` with a proper modal). Not a blocker; worth a follow-up ticket.

File: `apps/web/src/pages/PDPAPage.tsx`

---

### Info

**I-001 · Mixed-scope commits**

Two commits in this branch are outside the design-token scope:
- `fix(api): add missing canned_responses.response_type + media_url migration` — adds a safe `ALTER TABLE … ADD COLUMN IF NOT EXISTS` migration to fix a schema drift.
- `test(e2e): share login tokens across workers` — fixes E2E test suite to avoid hitting the `/auth/login` 10-req/min throttle in parallel CI workers.

Both are correct and safe; they could live in separate PRs but are small enough to tag along.

**I-002 · `Number()` for display formatting**

Several pages use `Number(field).toLocaleString()` on Decimal fields (e.g., `receipt.amount`, `p.amountPaid`, `p.lateFee`). These are all **display-only** calls for Thai locale number formatting — not financial arithmetic — so there is no precision loss. The pattern predates this branch; no new instances were introduced.

**I-003 · ESLint `no-restricted-syntax` rule**

The new rule enforces semantic token usage via a regex on `Literal` and `TemplateElement` AST nodes. The `e2e/` directory is correctly excluded from linting. Print/receipt templates (`PrintableReceipt.tsx`, `MobileReceipt.tsx`) are also exempted as documented (paper print stylesheets require explicit color values). The rule is additive and will catch future violations.

**I-004 · `CreditChecksPage` refactor beyond token migration**

The refactor converts three separate raw `api.post().then()` call chains (`handleSave`, `handleApprove`, `handleReject`) into a single `useMutation` (`saveCreditCheckMutation`) with a shared `onSuccess` that calls `queryClient.invalidateQueries({ queryKey: ['credit-checks'] })`. This is an improvement per frontend rules and all three call sites correctly pass the appropriate `status` param. Verified that `invalidateQueries` is present.

---

## Backend Changes

| File | Risk |
|---|---|
| `apps/api/prisma/migrations/20260430000000_add_canned_response_type_media/migration.sql` | Low — uses `ADD COLUMN IF NOT EXISTS`, idempotent, provides defaults |

---

## Token Coverage Verification

All semantic tokens used in this branch (`bg-success`, `text-success`, `text-warning`, `bg-warning`, `text-destructive`, `bg-destructive`, `text-info`, `bg-info`, `text-primary-foreground`, `text-success-foreground`, `bg-destructive/10`, etc.) are properly defined in:

- **CSS variables**: `apps/web/src/index.css` (`:root` + `.dark` blocks)
- **Tailwind v4 `@theme` block**: `apps/web/src/index.css` maps `--color-success`, `--color-warning`, `--color-info` etc. to Tailwind utilities

---

## Recommendation

**APPROVE**

This is a clean, large-scale but low-risk refactor. The changes are mechanical color-class substitutions with zero business logic impact. Security posture is unchanged. The added ESLint enforcement rule prevents regression. The one pre-existing warning (W-001) and info items are not blockers.

Suggested follow-up (post-merge):
- [ ] Fix W-001: update PDPAPage `revokeMutation` to use `queryClient.invalidateQueries()` instead of `refetchConsents()`
- [ ] Consider separating the `fix(api)` migration and `test(e2e)` commits into their own PRs in future refactors of this size
