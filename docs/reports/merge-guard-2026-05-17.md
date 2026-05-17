# Pre-Merge Guard Report — 2026-05-17

**Reviewed by:** Pre-Merge Guard Agent  
**Date:** 2026-05-17  
**Branches reviewed:** 3 of 10 open PRs (most recently updated)

---

## PR #961 — feat/a1-d1.3.1.3-email-provider

**Title:** feat(a1): D1.3.1.3 — email_provider abstraction (Q5-gated, SMTP default)  
**Author:** Akenarin Kongdach  
**Base:** main  
**Files changed:** 6 (+274 lines)

| File | Change |
|------|--------|
| `apps/api/src/modules/notifications/email-provider.service.ts` | New — 162 lines |
| `apps/api/src/modules/notifications/email-provider.service.spec.ts` | New — 82 lines, 7 test cases |
| `apps/api/src/modules/notifications/notifications.module.ts` | +9 lines (register providers + export) |
| `apps/api/src/modules/settings/settings.service.ts` | +12 lines (emailProvider in getUiFlags) |
| `apps/web/src/hooks/useUiFlags.ts` | +3 lines (emailProvider field + default) |
| `docs/superpowers/tracking/D1-settings-implement.md` | Tracking update |

### Critical
_None._

### Warning
_None._

### Info
- `ConfigService` is NOT listed in `NotificationsModule` imports but is correctly resolved globally via `AppModule.ConfigModule.forRoot({ isGlobal: true })`. No issue.
- `SendgridEmailProvider.send()` throws `NotImplementedException` by design — callers must catch it. The PR states there are no callers yet; this is safe until a caller is wired.
- `SmtpEmailProvider` silently swallows SMTP send failures and returns `{ sent: false }` rather than rethrowing. This is intentional per the existing `EmailService` fallback pattern. Downstream callers that rely on `sent: true` for audit/retry should add explicit checks.
- Test coverage is 7 cases (factory defaults, sendgrid stub, smtp-env-missing, DB-error fallback) — adequate for this size.

### Recommendation: **APPROVE** ✅

---

## PR #960 — feat/a1-d1.3.2.4-reverse-permission

**Title:** feat(a1): D1.3.2.4 — reverse_permission dynamic guard (Q4-gated)  
**Author:** Akenarin Kongdach  
**Base:** main  
**Files changed:** 6 (+153 lines)

| File | Change |
|------|--------|
| `apps/api/src/modules/expense-documents/reverse-permission.guard.ts` | New — 61 lines |
| `apps/api/src/modules/expense-documents/__tests__/reverse-permission.guard.spec.ts` | New — 65 lines, 4 test cases |
| `apps/api/src/modules/expense-documents/expense-documents.controller.ts` | +9 lines (add `@UseGuards(ReversePermissionGuard)` to `void()`) |
| `apps/api/src/modules/expense-documents/expense-documents.module.ts` | +2 lines |
| `apps/api/src/modules/settings/settings.service.ts` | +13 lines (reversePermission in getUiFlags) |
| `apps/web/src/hooks/useUiFlags.ts` | +3 lines |

### Critical
_None._

### Warning
_None._

### Info
- Guard ordering is correct: class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` runs first, then method-level `@UseGuards(ReversePermissionGuard)` narrows. NestJS merges and sequences these as expected.
- Static `@Roles('OWNER', 'FINANCE_MANAGER')` is unchanged — acts as the superset. `ReversePermissionGuard` only narrows toward `OWNER_ONLY`.
- `deletedAt: null` included in SystemConfig query ✓
- Thai error message `'ไม่มีสิทธิ์กลับรายการเอกสาร'` ✓
- DB-error fallback to default ✓
- 4 test cases cover default, narrowed, malformed, and DB-error paths — adequate.

### Recommendation: **APPROVE** ✅

---

## PR #959 — feat/a1-d1.3.2.3-post-permission

**Title:** feat(a1): D1.3.2.3 — post_permission dynamic guard (Q4-gated)  
**Author:** Akenarin Kongdach  
**Base:** main  
**Files changed:** 6 (+193 lines)

| File | Change |
|------|--------|
| `apps/api/src/modules/expense-documents/post-permission.guard.ts` | New — 71 lines |
| `apps/api/src/modules/expense-documents/__tests__/post-permission.guard.spec.ts` | New — 75 lines, 5 test cases |
| `apps/api/src/modules/expense-documents/expense-documents.controller.ts` | +12 lines |
| `apps/api/src/modules/expense-documents/expense-documents.module.ts` | +2 lines |
| `apps/api/src/modules/settings/settings.service.ts` | +26 lines |
| `apps/web/src/hooks/useUiFlags.ts` | +7 lines |

### Critical
_None._

### Warning
- **`@Roles` superset permanently widened to include `BRANCH_MANAGER`** on `POST :id/post`. Before this PR, BRANCH_MANAGER could never reach the `post()` handler. After this PR, BRANCH_MANAGER passes the static `RolesGuard` check and is only blocked by `PostPermissionGuard`'s default value. The guard's default (`OWNER+FINANCE_MANAGER+ACCOUNTANT`) correctly excludes BRANCH_MANAGER, and DB-error fallback is safe. However, this is now an architectural assumption: **if `PostPermissionGuard` is ever misconfigured, removed, or if the SystemConfig row is set to `OWNER+ALL_NON_SALES`, BRANCH_MANAGERs gain the ability to post expense documents to ACCRUAL**. This is intended by design (D1 item decision), but the person merging should be aware it permanently widens the permission surface.

### Info
- `deletedAt: null` included in SystemConfig query ✓
- Thai error message `'ไม่มีสิทธิ์โพสต์เอกสาร'` ✓
- DB-error fallback to default (`OWNER+FINANCE_MANAGER+ACCOUNTANT`) ✓
- `OWNER+ALL_NON_SALES` set correctly: includes BRANCH_MANAGER, excludes SALES ✓
- Service-level V15 guard (WHT on ACCRUAL rejection) remains intact regardless of who reaches the controller ✓
- 5 test cases cover all 4 config values plus boundary roles — adequate.

### Recommendation: **APPROVE with note** ⚠️

> Merge is safe. Reviewer should confirm with owner that the `OWNER+ALL_NON_SALES` bundle (and its BRANCH_MANAGER permission to post expense docs) is an accepted business decision before merging.

---

## Overall Summary

| PR | Branch | Issues | Recommendation |
|----|--------|--------|----------------|
| #961 | feat/a1-d1.3.1.3-email-provider | 0 critical, 0 warning | ✅ APPROVE |
| #960 | feat/a1-d1.3.2.4-reverse-permission | 0 critical, 0 warning | ✅ APPROVE |
| #959 | feat/a1-d1.3.2.3-post-permission | 0 critical, 1 warning | ⚠️ APPROVE with note |
| —   | feat/a1-d1.2.1-frontend-approval-ui | 0 critical, 0 warning | ✅ APPROVE |

No PRs are blocked. The three guard branches follow the established `SettingsAccessGuard` pattern (D1.3.2.2), use proper fallback semantics, include Thai error messages, and have adequate unit tests. The only flag is the intentional BRANCH_MANAGER superset widening on PR #959 which warrants an explicit owner acknowledgment before merge. The frontend approval-UI branch (`feat/a1-d1.2.1-frontend-approval-ui`) is clean — `warning`/`info` CSS tokens verified, all mutations use the `api` client, cache invalidation wired, pure helpers fully tested. See individual report for details.
