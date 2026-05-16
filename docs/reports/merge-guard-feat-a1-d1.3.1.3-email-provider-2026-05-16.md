# Pre-Merge Guard Report — feat/a1-d1.3.1.3-email-provider

**Date**: 2026-05-16  
**Branch**: `feat/a1-d1.3.1.3-email-provider`  
**Author**: Akenarin Kongdach  
**Commit**: `a5eb4a48` — feat(a1): D1.3.1.3 — email_provider abstraction (Q5-gated, SMTP default)  
**Base**: `origin/main`

---

## File Changes Summary

| File | Change | Lines |
|------|--------|-------|
| `apps/api/src/modules/notifications/email-provider.service.ts` | New | +162 |
| `apps/api/src/modules/notifications/email-provider.service.spec.ts` | New | +82 |
| `apps/api/src/modules/notifications/notifications.module.ts` | Modified | +9 |
| `apps/api/src/modules/settings/settings.service.ts` | Modified | +8 |
| `apps/web/src/hooks/useUiFlags.ts` | Modified | +4 |

**Total**: 6 files, 274 insertions, 6 deletions

---

## Issue Analysis

### Critical Issues — NONE

- No new controllers added; no `@UseGuards` gaps.
- No `Number()` on financial fields; no money fields involved at all.
- Prisma query in `email-provider.service.ts` correctly includes `deletedAt: null` in the WHERE clause.
- No hardcoded secrets or API keys. SMTP credentials read from `ConfigService` env vars only.
- No unparameterized raw SQL.

### Warning Issues — NONE

- No new DTOs.
- Error handling: `SmtpEmailProvider.send()` wraps `sendMail` in try/catch and returns `{ sent: false }` on failure. `EmailProviderService.getProvider()` catches DB errors and falls back to SMTP. Both are appropriately defensive.
- No new React components; `useUiFlags.ts` change is purely additive (new field with a default value).
- No mutations or `queryClient.invalidateQueries()` considerations.
- No DTOs requiring Thai validation messages.

### Info

- `SmtpEmailProvider` creates a new `nodemailer.createTransport()` instance on every `send()` call. This is slightly wasteful compared to a cached transporter, but negligible at current call volumes and avoids stale connection state. Not a blocker.
- `ConfigModule.forRoot({ isGlobal: true })` is confirmed in `app.module.ts`, so `ConfigService` injection into `SmtpEmailProvider` is safe without explicit module import.

---

## Notes

- The `SendgridEmailProvider` correctly throws `NotImplementedException` rather than silently dropping mail — the stub is explicitly documented and requires SENDGRID_API_KEY wiring before the owner can flip the SystemConfig row. Good defensive design.
- The `getProvider()` factory reads SystemConfig at call time, enabling live config changes without restart. This is intentional and documented.
- All 7 unit tests in the spec file cover: default fallback, Sendgrid selection, invalid value fallback, DB error fallback, Sendgrid NotImplementedException, SMTP skip-without-env, and service.send() routing. Coverage is complete.

---

## Recommendation: ✅ APPROVE

No critical or warning issues. Clean service abstraction with proper error handling, defensive fallbacks, and thorough tests. Safe to merge.
