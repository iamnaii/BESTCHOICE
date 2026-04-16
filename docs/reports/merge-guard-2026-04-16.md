# Pre-Merge Guard Report — 2026-04-16

**Generated**: 2026-04-16  
**Reviewer**: Pre-Merge Guard Agent  
**Branches reviewed**: 3 (of 6+ unmerged feature branches)

---

## Summary

| Branch | Files (src) | Commits ahead | Recommendation |
|--------|-------------|---------------|---------------|
| `feat/accounting-audit-fixes` | 851 | 5 | **REVIEW** |
| `fix/hardening-non-accounting` | 401 | 5 | **REVIEW** |
| `chore/quickbuy-step1-reorder` | 724 | 5 | **REVIEW** |

> **Note**: All three branches have also diverged from `origin/main` (main is 3 commits ahead). A rebase or merge from main is needed before merging any of these.

---

## Branch 1: `feat/accounting-audit-fixes`

**Authors**: BESTCHOICE Developer, Claude, iamnaii  
**Commits**: 5 ahead of main  
**Scope**: Inter-company accounting (SHOP↔FINANCE), production seed script, legacy import scripts, seed.ts reset expansion

### File Changes Summary
- New: `apps/api/prisma/seed-production.ts`, `seed-chart-of-accounts-only.ts` — production-safe idempotent seeds
- Modified: `apps/api/prisma/seed.ts` — adds NODE_ENV production guard, expands deleteMany list, adds 2nd company (FINANCE)
- New: `apps/api/scripts/import-legacy/` — CSV import scripts for legacy data
- New: accounting/inter-company modules, updated controllers

### Issues Found

#### Warning
- **`Number()` on Decimal fields in legacy scripts** — `scripts/import-legacy/check-sample.ts` and `scripts/import-legacy/validate.ts` use `Number(c.financedAmount)`, `Number(c.sellingPrice)`, etc. for display/reporting only, not DB writes. These are one-off migration scripts, but the pattern could cause floating-point display errors on large amounts.
  - Files: `apps/api/scripts/import-legacy/check-sample.ts`, `apps/api/scripts/import-legacy/validate.ts`
  - Recommendation: Replace with `.toFixed(2)` or `.toString()` for consistency

#### Info
- `seed.ts` now deletes 20+ additional tables in reset — verify ordering is correct for FK constraints (some tables appear duplicated: `repossession` and `callLog` deleted twice)
- Branches diverged from main — requires rebase before merge
- All new controllers (`AdsTrackingController`, `AssetController`, `InterCompanyController`) have `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles(...)` ✅

### Recommendation: **REVIEW**
No critical issues. Requires rebase onto main before merge. Clean up duplicate deleteMany calls in seed.ts reset section.

---

## Branch 2: `fix/hardening-non-accounting`

**Authors**: Akenarin Kongdach, Claude, iamnaii  
**Commits**: 5 ahead of main  
**Scope**: Massive feature addition — MDM auto-lock/unlock, dunning engine, chat system (WebSocket gateway, session management, room-based chat), warranty cron, AI assistant, broadcast, snooze, side conversations, todos

### File Changes Summary
- 401 app source files changed (API + Web)
- New controllers: `StaffChatController`, `SessionOpsController`, `SnoozeController`, `SideConversationController`, `ChatCommerceController`, `WebWidgetController`, `TodosController`
- New services: `ChatEngineService`, `RoomManagerService`, `AssignmentService`, `DunningEngineService`, `DunningRuleService`, `WarrantyCronService`, `AiAssistantService`, and ~15 others

### Issues Found

#### Info (Intentional Public Endpoint — Verify)
- **`WebWidgetController` has no `@UseGuards`** — controller at `/widget` is documented as intentionally public ("serves anonymous website visitors"). This is acceptable per security rules, but it is NOT listed in `.claude/rules/security.md` under "Intentionally Public Endpoints". Should be added to the allow-list.
  - File: `apps/api/src/modules/staff-chat/web-widget.controller.ts`
  - Action: Add to `.claude/rules/security.md` public endpoint list

#### Info
- `payments.service.ts` modified to inject `FlexTemplatesService`, `QuickReplyService`, `MdmAutoService` — verify these don't introduce circular dependencies
- All other new controllers have proper `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles(...)` ✅
- No `Number()` on Decimal fields in service/controller files ✅
- No raw `fetch()` calls in frontend ✅
- Sidebar hardcoded `text-white/text-gray-*` colors being removed (positive) ✅

### Recommendation: **REVIEW**
No critical issues. The change set is very large (401 files) — recommend reviewing in smaller PRs if possible. Add `WebWidgetController` to the security.md public endpoint list.

---

## Branch 3: `chore/quickbuy-step1-reorder`

**Authors**: BESTCHOICE Developer, Claude, iamnaii  
**Commits**: 5 ahead of main  
**Scope**: QuickBuy Step 1 UI reorder — replace raw `fetch()` card-reader call with `readSmartCard()` abstraction, replace freeform address textarea with structured `AddressForm` component

### File Changes Summary
- `apps/web/src/components/trade-in/QuickBuyModal.tsx` — core UI change
- Trade-in valuation endpoints added to `trade-in.controller.ts` + `trade-in.service.ts`
- New DTO: `ValuationQueryDto`, `UpsertValuationDto`
- Branch also carries many migration files from earlier work

### Issues Found

#### Warning
- **`Number(record.basePrice)` in response serialization** — `trade-in.service.ts` returns `suggestedPrice: record ? Number(record.basePrice) : null`. Writing uses `new Prisma.Decimal(dto.basePrice)` correctly ✅, but reading converts back to JS `number`. For phone prices (5-digit THB), precision loss is unlikely, but convention should be consistent.
  - File: `apps/api/src/modules/trade-in/trade-in.service.ts`
  - Fix: `suggestedPrice: record ? Number(record.basePrice.toString()) : null` or return as string

#### Info
- `UpsertValuationDto.basePrice` uses `@Transform(({ value }) => Number(value))` for validation — acceptable pattern for DTO input, DB write uses `new Prisma.Decimal()` ✅
- Raw `fetch('http://localhost:3457/api/read-card')` replaced with `readSmartCard()` abstraction ✅ (positive fix)
- All new valuation endpoints have `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` + `@Roles(...)` ✅
- `FINANCE_MANAGER` added to voucher download — correct ✅

### Recommendation: **REVIEW**
No critical issues. Fix `Number(record.basePrice)` → string serialization before merge.

---

## Global Checks

| Check | Result |
|-------|--------|
| New controllers without `@UseGuards` | `WebWidgetController` — intentional public, but unlisted |
| `Number()` on Decimal in services | Only in legacy script files + 1 response serialization (Warning) |
| Missing `deletedAt: null` in new queries | None found |
| Hardcoded secrets / API keys | None found |
| Raw `fetch()` in frontend | None (fixed in quickbuy branch) |
| SQL injection (`$queryRaw` unparameterized) | None found |
| Missing `@Roles()` on controller methods | None found |

---

## Action Items Before Merge

1. **All branches**: Rebase onto `origin/main` (main has 3 new commits: branding, Facebook webhook)
2. **`fix/hardening-non-accounting`**: Add `WebWidgetController` (/widget) to `.claude/rules/security.md` intentionally-public list
3. **`chore/quickbuy-step1-reorder`**: Fix `Number(record.basePrice)` → use `.toString()` for response serialization in `trade-in.service.ts`
4. **`feat/accounting-audit-fixes`**: Remove duplicate `deleteMany` calls (repossession, callLog deleted twice) in `seed.ts`
5. All branches: Run `./tools/check-types.sh all` after rebase to confirm 0 TypeScript errors
