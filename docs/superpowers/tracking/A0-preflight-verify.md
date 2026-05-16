# A0 · Pre-flight Verify

**Status:** 🟡 In Progress  |  **Started:** 2026-05-16  |  **PRs:** TBD (script-only)
**Deadline:** before any code change in v2.0 work
**Spec:** —  ·  **Plan:** —

## Context

Three production-DB checks that MUST run before any v2.0 code change. These verify the assumed starting state of `account_role_map`, SSO historical data, and depreciation cron output. If any check fails, downstream sub-projects (B1, C2, etc.) have wrong assumptions baked in.

A0 has no code deliverable — it's `psql` queries against prod + recovery actions if discrepancies found.

## Source

- [Dev Action Items v1.0](_owner-package/Dev_Action_Items_v1.0.md) Action #1 (page 3), #3 (page 12), #5 (page 19)
- Ready-to-run consolidated script: [scripts/a0-preflight-verify.sql](../../../scripts/a0-preflight-verify.sql)

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A0.1 | Verify `adj_underpay = 52-1104` in prod `account_role_map` | P0 | 🟡 | — | Script ready. Local dev DB shows `adj_underpay=52-1104` ✅ (correct) — strong signal prod is also correct since same migration source, but **owner must still run on prod**. If prod shows `53-1503` → run Dev Action #1 Step 2 UPDATE + Steps 3-4 |
| A0.2 | Reclassify SSO catch-up — `21-1104` rows still containing `%SSO%` or `%ประกันสังคม%` | P1 | 🟡 | — | Script ready. Local dev DB shows 0 leftover SSO rows ✅. Owner runs on prod; if > 0 → apply Action #3 Section 3.3 cleanup migration |
| A0.3 | Recover missing depreciation JEs for งวด มี.ค.–เม.ย. 2569 | P1 | 🟡 | — | Script ready. Local dev DB has 0 active assets so query returns empty — uninformative locally. Owner runs on prod; if 2026-03 / 2026-04 missing → Option A (`POST /depreciation/run`) per Section 5.3 |

## Phase

🟢 No phase gate — these are read-only verifications + targeted recoveries. Each item is independent and can run in any order.

## Decision Log

- **2026-05-16:** A0 placed before B1 because Action #1 (adj_underpay routing) could affect any future SETTLEMENT/EXP that uses an adjustment — must be correct before B2 lands
- **2026-05-16:** Schema-corrected the source SQL queries (Dev Action Items used logical names — `audit_log`/`asset_register`/`cr_amount`/`line_note` — that diverge from the actual Prisma schema). Consolidated all 3 verification queries into one `psql -f`-runnable script: `scripts/a0-preflight-verify.sql`. Smoke-tested on local dev DB (results: A0.1 correct, A0.2 clean, A0.3 uninformative locally due to no POSTED fixed_assets).

## Open Questions

- [ ] Q: Owner approval required to run UPDATE on prod `account_role_map` if Step 1 finds a discrepancy? — **Pending owner answer** (A0.1 verification result will tell us if remediation is even needed)
- [x] Q: For A0.3 (depreciation recovery) — Option A (POST /depreciation/run) requires the endpoint to exist; if not, fall back to Option B manual adjusting JEs — ✅ **Endpoint exists at `apps/api/src/modules/depreciation/depreciation.controller.ts:30` (`@Post('run')` on `@Controller('depreciation')`)**. Option A is viable.
- [ ] Q: A0.2 — does memory note "PR #810 reclassify SSO" already cover all rows? Need verification query result first — **Local dev DB shows clean; prod result pending owner run**

## Dependencies

- ✅ T0 (tracking infrastructure exists)
- Requires: production DB read access; OWNER_TOKEN for `POST /depreciation/run` if A0.3 falls back to API
