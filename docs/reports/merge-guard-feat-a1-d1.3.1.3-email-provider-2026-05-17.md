# Merge Guard Report — feat/a1-d1.3.1.3-email-provider

**Date:** 2026-05-17  
**Branch:** `feat/a1-d1.3.1.3-email-provider`  
**Recommendation:** ✅ APPROVE

---

## File Changes Summary

| File | Change | Lines |
|------|--------|-------|
| `apps/api/src/modules/notifications/email-provider.service.ts` | New | +162 |
| `apps/api/src/modules/notifications/email-provider.service.spec.ts` | New | +82 |
| `apps/api/src/modules/notifications/notifications.module.ts` | Modified | +9 |
| `apps/api/src/modules/settings/settings.service.ts` | Modified | +12 |
| `apps/web/src/hooks/useUiFlags.ts` | Modified | +3 |
| `docs/superpowers/tracking/D1-settings-implement.md` | Modified | tracking update |

**Total:** 6 files changed, 274 insertions(+), 6 deletions(−)

---

## Issues Found

### Critical — 0 issues

None.

### Warning — 0 issues

None.

### Info

- **`SmtpEmailProvider.send()` creates a new `nodemailer.createTransport()` on every call** (`email-provider.service.ts:84`). For low-volume transactional email this is acceptable, but a shared/reused transporter would be more efficient if throughput grows. Not a blocking issue.
- `SendgridEmailProvider` is a deliberate stub that throws `NotImplementedException`. This is correct and well-documented, but callers that don't catch this will surface a 501 to the API consumer. Ensure any future call site wraps the `service.send()` with an appropriate error boundary before enabling Sendgrid via SystemConfig.

---

## Detailed Findings

### Security
- No new controller endpoints — `@UseGuards` not applicable.
- `resolveProviderName()` queries SystemConfig with `where: { key: 'email_provider', deletedAt: null }` — soft-delete filter present ✅
- No secrets hardcoded; SMTP credentials read from `ConfigService` env vars ✅
- Input validation on `allowedValues` is done by whitelisting (`raw === 'sendgrid'`), not trusting arbitrary DB values ✅

### Architecture
- `EmailProviderService` registered in `NotificationsModule` as a provider and exported — allows injection in other modules ✅
- DB error in `resolveProviderName()` is caught and falls back to SMTP — non-fatal, correct behavior ✅
- SMTP transport timeouts set (`connectionTimeout: 5000`, `greetingTimeout: 5000`, `socketTimeout: 10000`) ✅
- `UiFlags.emailProvider` exposed to frontend for conditional UI rendering ✅

### Tests
- 7 unit tests covering: default fallback, Sendgrid selection, malformed value fallback, DB error fallback, Sendgrid stub exception, SMTP skip-without-env, and end-to-end routing ✅

---

## Recommendation: APPROVE

Clean abstraction. No security issues, no missing guards, no money fields, deletedAt filtering present. Tests are thorough. The Sendgrid stub is intentional and well-documented. Safe to merge.
