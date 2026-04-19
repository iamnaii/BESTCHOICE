# Merge Guard Report — feat/prometheus-metrics-slo

**Date**: 2026-04-19  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Recommendation**: ⚠️ REVIEW — fix Critical before merge

---

## Branch Summary

Adds Prometheus metrics scrape endpoint (`/metrics`) and a `MetricsService` with business counters.  
8 files changed, 379 insertions.

### Key commits
- `feat(metrics): Prometheus metrics module + SLO runbook`

### Files changed
| File | Change |
|------|--------|
| `metrics.controller.ts` | NEW — `/metrics` endpoint with `X-Metrics-Token` auth |
| `metrics.service.ts` | NEW — Registry + counters + histogram |
| `metrics.module.ts` | NEW — `@Global()` module |
| `metrics.service.spec.ts` | NEW — 4 tests |
| `app.module.ts` | `MetricsModule` import added |
| `docs/guides/SLO-RUNBOOK.md` | NEW — SLO runbook |
| `apps/api/package.json` | `prom-client` dependency added |
| `package-lock.json` | Updated lockfile |

---

## Issues Found

### Critical — 1 issue

**C-1: Token comparison is NOT timing-safe**  
Location: `metrics.controller.ts:37`
```typescript
if (!token || token !== expected) {
  throw new HttpException('forbidden', HttpStatus.FORBIDDEN);
}
```
String equality (`!==`) is subject to short-circuit evaluation — an attacker who can time responses (even over HTTP with enough samples) can brute-force the scrape token one character at a time.

**Fix required before merge:**
```typescript
import { timingSafeEqual } from 'crypto';
// ...
if (
  !token ||
  token.length !== expected.length ||
  !timingSafeEqual(Buffer.from(token), Buffer.from(expected))
) {
  throw new HttpException('forbidden', HttpStatus.FORBIDDEN);
}
```
This is especially important because Prometheus scrape tokens are long-lived (unlike short-lived JWTs) and typically have fewer rotation mechanisms.

### Warning — 2 issues

**W-1: `MetricsController` is `@Public()` but not in the intentionally-public list in `security.md`**  
Location: `metrics.controller.ts:24`, `.claude/rules/security.md`  
The controller uses `@Public()` (no JwtAuthGuard) instead of a JWT-gated approach. This is architecturally correct (Prometheus scrapers don't carry JWTs), but it's not listed in the `security.md` whitelist of intentionally-public endpoints.

A future security auditor running `grep -r '@Public\|no JwtAuthGuard'` will flag this as a potential bug.

Recommendation: Add `metrics` to the intentionally-public list in `.claude/rules/security.md`:
```
- `metrics` — Prometheus scrape endpoint (gated by X-Metrics-Token shared secret)
```

**W-2: Business metrics expose operational intelligence without rate-limiting**  
`dunning_escalated_total`, `ai_calls_total`, `payments_recorded_total` expose business volumes to anyone who obtains `METRICS_SCRAPE_TOKEN`.  
The token-per-environment approach (single token, no expiry) means a leaked token gives indefinite read access to business telemetry.

Recommendation: document token rotation procedure in `SLO-RUNBOOK.md` (e.g., rotate via Secret Manager on suspected leak).

### Info — 2 items

**I-1: `MetricsModule` is `@Global()` — correct, but note injection is by type**  
Any service that wants to increment counters must type-hint `MetricsService` in its constructor. The global scope means no per-module import needed, which is convenient but makes the dependency implicit.

**I-2: `SLO-RUNBOOK.md` references alert thresholds that are not yet wired to Alertmanager**  
The runbook documents SLOs but the Alertmanager YAML rules are not in this PR. Ensure follow-up PR adds the alert rules before SLOs are considered "monitored."

---

## Security Assessment

| Check | Result |
|-------|--------|
| JwtAuthGuard on controller | N/A — intentionally public (Prometheus) |
| Alternative auth mechanism | ✅ `X-Metrics-Token` shared secret |
| Token comparison timing-safe | ❌ FAIL — uses `!==` (see C-1) |
| Endpoint returns 503 if token unconfigured | ✅ Correct — prevents silent exposure |
| `SkipThrottle()` prevents false throttle on 15s scrape | ✅ Correct |
| Module registered in `app.module.ts` | ✅ |

---

## Recommendation: ⚠️ REVIEW

**Block on C-1** (timing-safe token comparison). The fix is a 3-line change.  
After C-1 is fixed, address W-1 (update `security.md` whitelist) before merging.
