# Merge Guard Report — feat/ai-relocate-and-24-7

**Date**: 2026-05-20  
**Branch**: `feat/ai-relocate-and-24-7`  
**Author**: Akenarin Kongdach  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| Category | Count |
|---|---|
| Files changed | 34 |
| Insertions | +8,445 |
| Deletions | −3,485 |

The large numbers are mostly doc additions (3 new design docs totalling ~1,700 lines) and `package-lock.json` churn (+134/−134).

Key changes:
- `apps/api/src/app.module.ts` — removes `QuotesModule` + `DraftsModule` registrations
- `apps/api/src/modules/drafts/` — **entire module deleted** (4 files: controller, service, module, spec)
- `apps/api/src/modules/quotes/` — **entire module deleted** (6 files: controller, service, module, 3 DTOs, PDF template, spec)
- `apps/api/src/modules/ai-settings/ai-settings.controller.ts` — modified (guard check: ✅ passes)
- `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` — modified webhook handler
- Frontend menu config + AI Settings page relocation

---

## Issues Found

### Critical
_None found._

### Warning
_None found._

### Info

**INFO-1**: `line-oa-chatbot.controller.ts` uses `@UseGuards(LineWebhookGuard)` (not `JwtAuthGuard`) on the `POST /line-oa/webhook` route.
- **Assessment**: Intentional. LINE webhooks are verified by cryptographic signature (`LineWebhookGuard`), not by JWT. This is the correct pattern for webhook endpoints; JwtAuthGuard would break LINE's server-to-server delivery. Similar to `sms-webhook` and `paysolutions` in the intentionally-public allowlist.
- **Action**: No change needed. Consider adding `line-oa/webhook` to the public-endpoint allowlist in `security.md` for future auditor clarity.

---

## Security Checks

| Check | Result |
|---|---|
| New controllers with missing `@UseGuards` | ✅ `ai-settings.controller.ts` has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level + `@Roles(...)` on all methods |
| `line-oa-chatbot.controller.ts` | ℹ️ `@UseGuards(LineWebhookGuard)` — intentional webhook auth (see INFO-1) |
| Deleted `drafts` / `quotes` controllers (were guarded) | ✅ Removed from `app.module.ts` — no orphaned routes |
| `Number()` on money/Decimal fields | ✅ None |
| `findMany`/`findFirst` missing `deletedAt: null` | ✅ No new queries in modified service files |
| Hardcoded secrets / API keys | ✅ None |
| Raw `fetch()` in React components | ✅ None |
| Unparameterized `$queryRaw` | ✅ None |
| Missing `@Roles()` on controller methods | ✅ All methods have roles |

---

## Structural Notes

- `QuotesModule` and `DraftsModule` deletion is clean: both removed from `app.module.ts` imports AND registered providers — no orphan references.
- AI menu relocation moves settings from the sidebar "Gear" section to a dedicated top-level "AI" section. No auth changes to underlying endpoints.
- Business-hours gate removal (`remove business-hours gate`) is a feature decision, not a security concern.
- 3 new design docs are markdown-only — no functional impact.

---

## Recommendation

**✅ APPROVE**

Branch is clean: dead code removal (Quotes + Drafts modules), AI menu UI relocation, and doc additions. No new security surface introduced. The one noteworthy item (webhook controller guard) is intentional and correct.

_Suggestion_: Add `line-oa/webhook` to the public-endpoint allowlist comment in `.claude/rules/security.md` to prevent future false alarms.
