# A0 · Pre-flight Verify

**Status:** ✅ Done (3/3)  |  **Started:** 2026-05-16  |  **Prod-run:** 2026-05-16 (initial + corrected re-run via cloud-sql-proxy)  |  **PRs:** [#859](https://github.com/iamnaii/BESTCHOICE/pull/859) (script) · [#870](https://github.com/iamnaii/BESTCHOICE/pull/870) (A0.1+A0.2 flip) · this PR (A0.3 investigation close + script flow-name fix)
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
| A0.1 | Verify `adj_underpay = 52-1104` in prod `account_role_map` | P0 | ✅ | this PR | **Prod result 2026-05-16:** `adj_overpay=53-1503` + `adj_underpay=52-1104` (priority=1, is_active=true) ✓ Follow-up query for misclassified JEs (`account_code='53-1503'` + `side='CR'` since 2026-05-11): **0 rows**. PR #810 reclassification landed cleanly. |
| A0.2 | Reclassify SSO catch-up — `21-1104` rows still containing `%SSO%` or `%ประกันสังคม%` | P1 | ✅ | this PR | **Prod result 2026-05-16:** 0 rows. PR #810 SSO reclassification migration complete on prod. **Unblocks B3.J-06** (which also flips ✅ in this PR). |
| A0.3 | Recover missing depreciation JEs for งวด มี.ค.–เม.ย. 2569 | P1 | ✅ | this PR | **Investigation complete 2026-05-16.** The original report of "0 depreciation JEs ทั้งหมด" was a **false alarm** — my A0 script queried `metadata.flow = 'asset-depreciation'` but the actual `DepreciationTemplate` uses `flow: 'depreciation'`. Dev Action #5 source doc had the same wrong string. Script fixed (this PR). **Corrected re-run results:** EQ-001 has 1 JE (JE-202605-00012, period 2026-05, ฿144.24) with `accumulated_depr=144.24` matching `depreciation_entries.amount` exactly — **no anomaly**. EQ-002 has 0 JEs because it was POSTED on **2026-05-16** with a back-dated `purchase_date=2026-04-30`; the cron ticked at end-of-เม.ย. when EQ-002 didn't yet exist in DB. **Not a cron failure — by design** (cron does not retroactively backfill). Cron will pick up พ.ค. depreciation for EQ-002 at end-of-พ.ค. (May 31). For เม.ย. catch-up (~฿287), owner can optionally run `POST /admin/depreciation/run?period=2026-04` — but that is housekeeping, not a release blocker. **No remediation required to unblock v2.0 work**. |

## Phase

🟢 No phase gate — these are read-only verifications + targeted recoveries. Each item is independent and can run in any order.

## Decision Log

- **2026-05-16:** A0 placed before B1 because Action #1 (adj_underpay routing) could affect any future SETTLEMENT/EXP that uses an adjustment — must be correct before B2 lands
- **2026-05-16:** Schema-corrected the source SQL queries (Dev Action Items used logical names — `audit_log`/`asset_register`/`cr_amount`/`line_note` — that diverge from the actual Prisma schema). Consolidated all 3 verification queries into one `psql -f`-runnable script: `scripts/a0-preflight-verify.sql`. Smoke-tested on local dev DB (results: A0.1 correct, A0.2 clean, A0.3 uninformative locally due to no POSTED fixed_assets).
- **2026-05-16 (prod run):** Owner ran the script on prod via cloud-sql-proxy. A0.1 + A0.2 ✅ clean. A0.3 surfaced an unexpected picture (zero depreciation JEs across ALL periods, not just มี.ค./เม.ย.; only 2 POSTED assets both purchased late). Also fixed script's `fixed_assets` column names — local dev DB had outdated short-form columns (`cost_value`/`useful_life`/`accumulated_depre`) but prod + current `schema.prisma` use long-form (`purchase_cost`/`useful_life_months`/`accumulated_depr`). Local dev DB is the stale one (db-push state per memory note).
- **2026-05-16 (A0.3 investigation):** Code review of `DepreciationTemplate` revealed my A0 script used `metadata.flow = 'asset-depreciation'` but the actual emitted flow is `'depreciation'`. Dev Action #5 source had the same wrong string. Fixed in this PR. Corrected re-run on prod: EQ-001 had its depreciation JE all along; EQ-002 missing เม.ย. is by-design (asset created/POSTED 2026-05-16 with back-dated purchase_date=2026-04-30 — cron at end-of-เม.ย. couldn't process a row that didn't exist yet). Decision: close A0.3 ✅ — no system failure, no blocker. EQ-002 เม.ย. catch-up via manual `/depreciation/run` is a separate housekeeping ticket.

## Open Questions

- [ ] Q: Owner approval required to run UPDATE on prod `account_role_map` if Step 1 finds a discrepancy? — **Pending owner answer** (A0.1 verification result will tell us if remediation is even needed)
- [x] Q: For A0.3 (depreciation recovery) — Option A (POST /depreciation/run) requires the endpoint to exist; if not, fall back to Option B manual adjusting JEs — ✅ **Endpoint exists at `apps/api/src/modules/depreciation/depreciation.controller.ts:30` (`@Post('run')` on `@Controller('depreciation')`)**. Option A is viable.
- [ ] Q: A0.2 — does memory note "PR #810 reclassify SSO" already cover all rows? Need verification query result first — **Local dev DB shows clean; prod result pending owner run**

## Dependencies

- ✅ T0 (tracking infrastructure exists)
- Requires: production DB read access; OWNER_TOKEN for `POST /depreciation/run` if A0.3 falls back to API
