# Pre-Merge Guard Report — 2026-04-18

**Generated:** 2026-04-18  
**Reviewer:** Pre-Merge Guard Agent (automated)  
**Branches reviewed:** 4  

---

## Summary

| Branch | Files Changed | Critical | Warning | Info | Recommendation |
|--------|--------------|----------|---------|------|----------------|
| `fix/customer-references-transform-bypass` | 1 | 0 | 0 | 1 | ✅ APPROVE |
| `fix/contract-stepper-status-stale` | 1 | 0 | 0 | 1 | ✅ APPROVE |
| `fix/same-origin-api-proxy` | 2 | 0 | 0 | 1 | ✅ APPROVE |
| `refactor/ui-design-tokens-2026-04-17` | 159 | 0 | 1 | 2 | ✅ APPROVE |

---

## Branch 1: `fix/customer-references-transform-bypass`

**Commit:** `77417819`  
**Author:** iamnaii  
**Description:** Bypasses class-transformer type coercion on `references` field in customer DTOs

### File Changes
- `apps/api/src/modules/customers/dto/customer.dto.ts` (+3 lines)

### Change Summary
Adds `@Transform(({ value }) => value, { toClassOnly: true })` decorator to `references?: Record<string, unknown>[]` field in both `CreateCustomerDto` and `UpdateCustomerDto`.

### Issues

**Info (1)**
- `@Transform(({ value }) => value, { toClassOnly: true })` is a no-op identity transform, used specifically to prevent class-transformer from inadvertently coercing the heterogeneous `Record<string, unknown>[]` type. Pattern is correct and intentional.

### Security Check
- ✅ No new controllers without guards
- ✅ No `Number()` on financial fields
- ✅ No missing `deletedAt: null`
- ✅ No hardcoded secrets
- ✅ No SQL injection risks
- ✅ DTO validation decorators present

### Recommendation: ✅ APPROVE

---

## Branch 2: `fix/contract-stepper-status-stale`

**Commit:** `275edf2c`  
**Author:** iamnaii  
**Description:** Hides "Submit for Review" button after contract reaches PENDING_REVIEW workflow status

### File Changes
- `apps/web/src/pages/ContractDetailPage.tsx` (+10/-6 lines)

### Change Summary
1. **Stepper submit button logic** — Previous code showed "ส่งตรวจสอบ" button whenever `isCreator && allSigned`, even after the contract was already in `PENDING_REVIEW` or `APPROVED`. Fix adds `workflowStatus === 'CREATING' || workflowStatus === 'REJECTED'` guard so the button only appears when re-submission is actually valid.
2. **Cache invalidation** — Adds `contract-edocuments` and `contract-doc-checklist` to the `invalidateAll` helper so document/checklist tabs refresh after workflow state changes.

### Issues

**Info (1)**
- IIFE pattern `(() => { ... })()` inside JSX steps array is functionally correct but slightly unusual. Consider extracting to a named helper variable for readability in a follow-up (non-blocking).

### Security Check
- ✅ No auth changes
- ✅ `queryClient.invalidateQueries()` present and expanded
- ✅ No new API calls or guards affected

### Recommendation: ✅ APPROVE

---

## Branch 3: `fix/same-origin-api-proxy`

**Commits:** `b0d1ace9` (proxy config), `d692bb7f` (runtime URL resolution)  
**Author:** iamnaii  
**Description:** Fixes refresh_token cookie SameSite issues by ensuring production builds always use same-origin `/api`

### File Changes
- `apps/web/src/lib/env.ts` (+15/-5 lines)
- `firebase.json` (+8/-0 lines)

### Change Summary
1. **`env.ts`** — `resolveApiUrl()` function returns `/api` unconditionally for production non-localhost environments. `VITE_API_URL` override still works in `DEV` mode and on `localhost` (for CI E2E with prod bundle at port 5173 hitting API at 3000).
2. **`firebase.json`** — Adds `/api/**` → Cloud Run `bestchoice-api` (asia-southeast1) rewrite rule **before** the SPA catch-all. This is the Firebase Hosting rewrite that enables the same-origin proxy.

### Issues

**Info (1)**
- The `window.location.hostname === 'localhost'` branch in the production bundle relies on the environment having `VITE_API_URL` set; if unset, it falls back to `/api` which would fail on localhost without the Firebase emulator. This is acceptable for CI scenarios (which set `API_DIRECT_URL`/`VITE_API_URL`).

### Security Check
- ✅ This is a **security improvement** — same-origin cookies are first-party, eliminating cross-site cookie blocking
- ✅ No secrets introduced
- ✅ Firebase rewrite rule order is correct (specific `/api/**` before catch-all `**`)

### Recommendation: ✅ APPROVE

---

## Branch 4: `refactor/ui-design-tokens-2026-04-17`

**Commits:** 5 commits (Phase 7 + Phase 8 tokenization + chat adapter fixes + E2E improvements)  
**Author:** iamnaii  
**Description:** Eliminate all hardcoded Tailwind color-scale classes across 159 files; replace with semantic CSS variable tokens. Also includes chat adapter registration fix and E2E token-sharing.

### File Changes
- **159 files changed**, 1,952 insertions, 1,292 deletions
- Backend (API): 6 files
- Frontend (Web): ~150 files  
- E2E: 2 files

### Backend Changes (API)

#### `chat-adapters.module.ts`
Registers adapters via `OnModuleInit.onModuleInit()` instead of relying on DI token injection. Fixes a circular module dependency where `ChatAdaptersModule` imports `ChatEngineModule` (not the reverse). Registration is idempotent.

#### `line-finance.adapter.ts`
Fixes `isConfigured` from property access to method call `isConfigured()` — corrects a runtime bug where the check was always truthy.

#### `chat-engine/services/message-router.service.ts`
- `sendStaffMessage()` now returns `{ success: boolean; error?: string }` instead of `void`
- `registerAdapter()` and `registerDomainHandler()` are now public with idempotency guards
- Improves error visibility for failed LINE/FB delivery

#### `staff-chat.gateway.ts`
Emits `CHAT_EVENTS.MESSAGE_SEND_FAILED` to the sending client when external channel delivery fails, enabling the UI to show a "not delivered" indicator instead of a silent false-positive.

#### `facebook-domain.module.ts`
Same `OnModuleInit` pattern for domain handler registration.

### Frontend Changes (Web)

Systematic replacement across ~150 component/page/hook/lib files:
- `text-green-*` → `text-success`
- `text-red-*` → `text-destructive`
- `text-amber-*` → `text-warning`
- `bg-green-*` → `bg-success/10` or `bg-success`
- `bg-red-*` → `bg-destructive/10` or `bg-destructive`
- `text-white` on colored buttons → `text-primary-foreground`, `text-destructive-foreground`, etc.
- `bg-white` → `bg-background` (non-print contexts)
- `border-gray-*` → `border-border`
- `text-gray-*` → `text-muted-foreground` / `text-foreground`

### E2E Changes
`global-setup.ts` + `e2e/helpers/auth.ts`:
- Pre-fetches tokens for all 5 roles in global setup (sequential, stays under 10/min throttle)
- Workers read from `.playwright-roles-auth.json` instead of hitting `/auth/login` per test
- Fixes flaky tests caused by rate-limit exhaustion in parallel CI workers

### Issues

**Warning (1)**

| File | Pattern | Note |
|------|---------|------|
| Multiple pages (pre-existing) | `Number(p.amountPaid) > 0` and `Number(p.amountPaid).toLocaleString()` in JSX | These `Number()` casts were **pre-existing** — this branch only changed the color class (`text-green-600` → `text-success`). Not introduced by this PR. The usage is display-only (comparison + locale string formatting), not financial arithmetic. **No change required.** |

**Info (2)**

1. `chat-adapters.module.ts` registers adapters twice if both constructor injection AND `onModuleInit` run. The idempotency guard (`if (existing === adapter) return`) prevents duplicate registration — correct.

2. E2E `ROLE_ACCOUNTS` credentials are the standard dev seed accounts documented in `CLAUDE.md`. Acceptable in test-only files (`e2e/`).

### Security Check
- ✅ No new controllers without `@UseGuards`
- ✅ No new `@Roles()` missing
- ✅ No hardcoded secrets or API keys introduced
- ✅ No raw `fetch()` replacing `api.get()`/`api.post()`
- ✅ No unparameterized `$queryRaw`
- ✅ No missing `deletedAt: null` in new queries
- ✅ No financial `Number()` introduced (pre-existing occurrences noted)
- ✅ No hardcoded hex colors — all replacements use CSS variable tokens

### Recommendation: ✅ APPROVE

---

## Branches Not Reviewed (out of scope this run)

The following branches exist but were excluded — primarily dependency upgrade chunks and older feature branches already reviewed in prior guard reports:

- `chore/deps-tier3-chunk*` (10 branches) — automated dependency upgrades, require separate upgrade validation
- `feat/accounting-audit-fixes` — large branch (100+ commits), previously reviewed
- `feat/chatbot-production-ready` / `feature/chatbot-finance` — merged as PR #474
- `fix/hardening-non-accounting` — zero diff vs main (already merged content)
- `fix/rich-menu-test-renderer-provider` — deferred
- `E2E-TEST` — deferred
- All `claude/*` planning/analysis branches — no production code

---

## Overall Assessment

All 4 reviewed branches are clean, focused, and safe to merge:

1. **`fix/customer-references-transform-bypass`** — Minimal targeted fix for DTO coercion edge case
2. **`fix/contract-stepper-status-stale`** — Correct UX fix preventing duplicate PENDING_REVIEW submissions
3. **`fix/same-origin-api-proxy`** — Security improvement aligning production cookie policy with Firebase Hosting proxy
4. **`refactor/ui-design-tokens-2026-04-17`** — Large but mechanical token refactor; backend chat improvements are well-structured with proper error propagation

No blocking issues found. **All 4 branches: APPROVE.**
