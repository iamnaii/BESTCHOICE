# Merge Guard Report — `feat/a1-d1.4.2.5-max-concurrent-jobs`

**Date**: 2026-05-17  
**Branch**: `feat/a1-d1.4.2.5-max-concurrent-jobs`  
**Author**: Akenarin Kongdach  
**Commit**: feat(a1): D1.4.2.5 — max_concurrent_jobs + BullMQ worker concurrency

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/notifications/notification.worker.ts` | Added `readMaxConcurrentJobs()` fn; passes result as `{ concurrency }` to `@Processor` decorator |
| `apps/api/src/modules/settings/settings.service.ts` | Added `maxConcurrentJobs: number` to `getUiFlags()` return type; clamps to [1, 50] |
| `apps/api/src/modules/settings/settings.service.spec.ts` | 3 new tests: default 5, valid range, clamping out-of-range |
| `apps/web/src/hooks/useUiFlags.ts` | Added `maxConcurrentJobs: number` to `UiFlags` interface + default 5 |

---

## Issues Found

### Critical
_None._

### Warning

**[WARN-1] Source-of-truth disconnect between SystemConfig and env var**  
The Admin Settings UI will expose `max_concurrent_jobs` as a configurable OWNER setting via SystemConfig. However the actual BullMQ worker concurrency is read from `process.env.MAX_CONCURRENT_JOBS` at module load time — changing the SystemConfig key in the UI has **no effect** without a Cloud Run env var update + redeploy.

The code comment documents this honestly (`"Currently INFORMATIONAL for the SystemConfig key"`), but an OWNER who changes the setting in the UI will see no visible effect, which is confusing. Recommendation: render a warning banner in the Settings UI when this key is displayed, e.g. _"การเปลี่ยนค่านี้มีผลหลังจาก deploy ใหม่เท่านั้น — ต้องตั้ง env var MAX_CONCURRENT_JOBS บน Cloud Run ด้วย"_.

### Info

**[INFO-1]** The clamping logic [1, 50] is correctly applied in both `readMaxConcurrentJobs()` (worker, env var path) and `SettingsService.getUiFlags()` (DB config path) — consistent.

**[INFO-2]** `maxConcurrentJobs` is added to `UiFlags` on the frontend but no Settings UI component consumes it yet. Presumably a paired branch adds the admin toggle. No issue — the default value ensures no regression.

---

## Security Notes

- No new endpoints introduced; no guard changes.
- Env var is read at startup only — no runtime code injection risk.
- Clamping prevents runaway concurrency (max 50 jobs).

---

## Recommendation: ✅ APPROVE (address WARN-1 in Settings UI)

No blocking issues. The informational nature of the SystemConfig key is an operator UX concern, not a correctness or security defect. Approve with the suggestion to add a UI warning banner before the Settings page for this field ships to OWNER users.
