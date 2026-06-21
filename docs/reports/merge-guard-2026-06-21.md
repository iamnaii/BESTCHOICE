# Pre-Merge Guard Report — 2026-06-21

**Run date**: 2026-06-21  
**Reviewed by**: Pre-Merge Guard (automated)

---

## Branches Reviewed

| # | Branch | Author | Commits Ahead | Last Commit |
|---|--------|--------|--------------|-------------|
| 1 | `fix/fb-webhook-integration-config` | Akenarin Kongdach | 18 | 2026-05-28 |
| 2 | `fix/letters-e2e-sales-assertion` | Akenarin Kongdach | 7 | 2026-05-26 |
| 3 | `feat/canned-response-postback-routing` | Akenarin Kongdach | 4 | 2026-05-25 |

> Note: All 4 reviewable branches share a common ancestor at commit `b8e00b0d` (chat template picker). Branch 3 is the base; branch 2 builds on it; branch 1 is the furthest tip (adds the FB webhook fix on top of the letters feature). The 4th branch (`feat/canned-response-channel-tabs`, 3 commits) is a subset of branch 2 and not separately reviewed.

---

## Branch 1: `fix/fb-webhook-integration-config`

**Summary**: Fixes Facebook webhook to resolve verify token + app secret from `IntegrationConfig` (DB → env fallback) instead of env-only. Also includes the full letters management page feature from branches 2 & 3.

**Files changed**: `facebook-webhook.controller.ts`, `facebook-webhook.controller.spec.ts`, `chat-adapters.module.ts`, plus all letters-page and canned-response files.

### Critical Issues
None found.

### Warning Issues
None found.

### Info
- **Security improvement (GOOD)**: The FB webhook now reads `verifyToken` and `appSecret` from `IntegrationConfig.getConfig('facebook')` (DB → `FB_VERIFY_TOKEN`/`FB_APP_SECRET` env fallback). This makes inbound and outbound FB integration consistent — previously, the Settings → Integrations UI would update the DB but the webhook would still use stale env vars.
- **Fail-closed**: Both `verifyWebhook` (GET challenge) and `verifySignature` (HMAC POST) return 400/false when the secret is empty or unset. ✅
- **Tests**: 3 new describe blocks cover the verify token from IntegrationConfig path (match, mismatch, empty token → 400). ✅
- Controller remains intentionally public (no `JwtAuthGuard`) per the allow-list in `security.md`. ✅

**Recommendation: APPROVE** — pure security improvement, well-tested.

---

## Branch 2: `fix/letters-e2e-sales-assertion`

**Summary**: Adds the `/letters` management page (letter queue, bulk print/dispatch, Excel export) plus an E2E test fix for the SALES-role assertion.

**Files changed**: `overdue.controller.ts` (+64 lines), `contract-letter.service.ts` (+207 lines), `bulk-dispatch-letters.dto.ts` (new), `LettersPage/` components + hooks, E2E spec.

### Critical Issues
None found.

### Warning Issues
None found.

### Info
- **Guards**: `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at controller class level. All new endpoints have explicit `@Roles()` decorators. Cancel endpoint correctly excludes `SALES` (`@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')`). ✅
- **Soft-delete**: All 8 new queries include `deletedAt: null`. ✅
- **DTOs**: `BulkDispatchLettersDto` / `BulkDispatchItemDto` have full class-validator decorators with Thai error messages and proper `@ValidateNested + @Type()`. ✅
- **Frontend**: All API calls use `api.get()`/`api.post()` from `@/lib/api`. `queryClient.invalidateQueries({ queryKey: ['letters'] })` called after mutations. Toast notifications use `sonner`. ✅
- **E2E fix logic**: Previous test was a false positive — "ยกเลิก" tab label was matching before a cancel button existed. Fixed with positive assertion (page accessible + heading visible). Cancel permission enforcement is separately tested at the backend role level. ✅

**Recommendation: APPROVE** — clean implementation, correct security posture.

---

## Branch 3: `feat/canned-response-postback-routing`

**Summary**: Adds Quick Reply postback routing (LINE + FB): `TEMPLATE:<id>` payload → `CannedResponseSenderService` → bot sends back the configured canned response. Includes review-fixes commit `57b23560` addressing C1/C2/W4/W5/W6/W7.

**Files changed**: `quick-reply-postback-router.service.ts` (new), `canned-response-sender.service.ts` (modified), `line-oa-chatbot.controller.ts`, `chatbot-finance.service.ts`, `facebook-webhook.controller.ts`, module files, 8 new unit tests.

### Critical Issues
None remaining (C1 race condition and C2 ChatRoom ordering were addressed in `57b23560`).

### Warning Issues

**W1 — System user has unhashed password in DB**

File: `apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts:60`

```ts
create: {
  email: 'system@bestchoice.internal',
  password: 'NEVER_LOGIN_SYSTEM_USER',   // ← plaintext, not bcrypt-hashed
  ...
  isActive: false,
}
```

The system bot user is stored with a plaintext string in the `password` column. The normal `bcrypt.compare()` login flow blocks this before password check (line 134 in `auth.service.ts` checks `!isActive` first and throws `UnauthorizedException`), so actual login is blocked. However, storing unhashed strings in the password column violates the project's password security model and would appear as a plaintext credential in any DB dump or audit.

**Recommendation**: Hash the placeholder with `await bcrypt.hash('NEVER_LOGIN_SYSTEM_USER', 10)` in the `create` block. Since `isActive: false` already blocks login, hashing is belt-and-suspenders but aligns with the project standard.

---

**W2 — Existing OWNER-role system user NOT downgraded by upsert**

File: `apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts`

The `upsert` uses `update: {}` (no-op on existing row). The commit message acknowledges this:

> "Existing OWNER-roled system user from collections-foundation seed is preserved via upsert update:{} no-op."

If `collections-foundation.seed.ts` already created a system user with `role: 'OWNER'`, production will continue to have that OWNER-role bot user. The bot doesn't log in (`isActive: false`), but it could appear in OWNER-filtered queries (audit recipients, role-filtered admin lists).

**Recommendation**: Change `update: {}` to `update: { role: 'SALES' }` (idempotent safe — won't affect non-system users since the upsert key is the unique email). OR add a one-time migration to downgrade existing system user rows.

### Info
- **C1 fixed**: `findFirst → create` race replaced with atomic `upsert` on unique email. ✅
- **C2 fixed**: `ChatRoom.findFirst` for FB PSID now includes `orderBy: { lastMessageAt: 'desc' }`. ✅
- **W7 rate limit**: In-memory sliding window (5 postbacks / 10s / room) guards against A→B→A QR loops. Acknowledged to be per-process (resets on restart) — acceptable for v1. ✅
- **forwardRef**: Used correctly at module level; redundant constructor-level `@Inject(forwardRef())` removed (W4). ✅
- **Tests**: 8 new tests (4 for sender, 4 for router W7 rate limit). ✅

**Recommendation: REVIEW** — two warnings remain (unhashed password, OWNER-role not downgraded for existing rows). Neither blocks login but both should be addressed before merge.

---

## Summary

| Branch | Critical | Warning | Info | Verdict |
|--------|----------|---------|------|---------|
| `fix/fb-webhook-integration-config` | 0 | 0 | 3 | ✅ APPROVE |
| `fix/letters-e2e-sales-assertion` | 0 | 0 | 5 | ✅ APPROVE |
| `feat/canned-response-postback-routing` | 0 | 2 | 4 | ⚠️ REVIEW |

### Action Items Before Merging `feat/canned-response-postback-routing`
1. Hash the system user's password placeholder with bcrypt in `canned-response-sender.service.ts`.
2. Change `update: {}` to `update: { role: 'SALES' }` in the upsert to downgrade any existing OWNER-role system user.
