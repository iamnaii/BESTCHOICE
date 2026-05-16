# A0 · Pre-flight Verify

**Status:** ⬜ Pending  |  **Started:** —  |  **PRs:** —
**Deadline:** before any code change in v2.0 work
**Spec:** —  ·  **Plan:** —

## Context

Three production-DB checks that MUST run before any v2.0 code change. These verify the assumed starting state of `account_role_map`, SSO historical data, and depreciation cron output. If any check fails, downstream sub-projects (B1, C2, etc.) have wrong assumptions baked in.

A0 has no code deliverable — it's `psql` queries against prod + recovery actions if discrepancies found.

## Source

- [Dev Action Items v1.0](_owner-package/Dev_Action_Items_v1.0.md) Action #1 (page 3), #3 (page 12), #5 (page 19)

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A0.1 | Verify `adj_underpay = 52-1104` in prod `account_role_map` | P0 | ⬜ | — | Run Dev Action #1 Step 1 SQL on prod. If row says `53-1503` (the old wrong value), run Step 2 UPDATE and create adjusting JEs per Step 3+4 |
| A0.2 | Reclassify SSO catch-up — `21-1104` rows still containing `%SSO%` or `%ประกันสังคม%` | P1 | ⬜ | — | Run Dev Action #3 Section 3.2 verification query on prod. If count > 0, apply Dev Action #3 Section 3.3 cleanup migration |
| A0.3 | Recover missing depreciation JEs for งวด มี.ค.–เม.ย. 2569 | P1 | ⬜ | — | Run Dev Action #5 Section 5.2 query on prod. If count = 0, run Option A (`POST /depreciation/run` for each missing period) per Section 5.3 |

## Phase

🟢 No phase gate — these are read-only verifications + targeted recoveries. Each item is independent and can run in any order.

## Decision Log

- **2026-05-16:** A0 placed before B1 because Action #1 (adj_underpay routing) could affect any future SETTLEMENT/EXP that uses an adjustment — must be correct before B2 lands

## Open Questions

- [ ] Q: Owner approval required to run UPDATE on prod `account_role_map` if Step 1 finds a discrepancy?
- [ ] Q: For A0.3 (depreciation recovery) — Option A (POST /depreciation/run) requires the endpoint to exist; if not, fall back to Option B manual adjusting JEs
- [ ] Q: A0.2 — does memory note "PR #810 reclassify SSO" already cover all rows? Need verification query result first

## Dependencies

- ✅ T0 (tracking infrastructure exists)
- Requires: production DB read access; OWNER_TOKEN for `POST /depreciation/run` if A0.3 falls back to API
