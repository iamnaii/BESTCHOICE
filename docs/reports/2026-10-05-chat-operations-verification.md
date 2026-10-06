# Chat operations implementation and verification

Worktree: `.worktrees/chat-operations-20261006` · branch `feat/chat-operations-20261006`.
Local app: http://localhost:5217/inbox (the actual React application, not the earlier metadata-only prototype).

## Implemented scope

- F1: durable human-response cycles, scoped work queue, SLA policy snapshots and idempotent internal alerts. Reading, failed delivery and bot replies do not count as a successful human answer.
- F2: evidence-derived customer journey, canonical follow-up tasks with revision checks and immutable history, manual lost/reopen overlay.
- F3: scoped Facebook comment ingestion, durable events/tombstones, confirmed/unknown delivery states and exact comment links. No author-name/PSID inference.
- F4: persisted note mentions, recipient inbox and handoff accept/complete/cancel. Task receiver does not silently become room/sales owner.
- F5: chat service intake, one canonical task, explicit original-case linkage and actual after-sales lifecycle synchronization. Intake is not physical receipt, accounting or a customer notification.
- F6: scoped response/work metrics, actual responder and source salesperson, Decimal document sums, canonical-customer funnel with current scoped evidence, paginated matching drilldowns, CSV export, OWNER settings UI. Unscoped v1 report routes return 410.

Cloud library and final full UX parity/review are still in progress. This file is updated only with completed checks; it is not final acceptance yet.

## Recorded checks

- F5: service/intake/link browser scenarios at 1440/390; original repair lifecycle, receipt photos, closure and cross-company denial. Isolated original after-sales regression: 116 unit tests and 28 real integration tests.
- F5 final local check: API/Web types and lint, builds, 399 Web suites/2,907 tests, 145 shared and 46 storefront tests; light/dark layout from 320 to 1920, F1–F5 browser flows. Evidence `.tmp/chat-operations/f5-local-check.json`.
- F6 T1: 114 isolated PostgreSQL tests plus 6 metric/controller unit tests, types and lint.
- F6 T2: 118 isolated PostgreSQL tests, 55 attribution/sales-read/void regression unit tests, types and lint.
- F6 T3 focused: 120 isolated PostgreSQL tests, 5 Web formatter/scoped/error tests, API/Web types and targeted lint; actual browser checks at 1440/390 pass human/bot acknowledgement, retry, actual responder vs changed owner, two sales plus linked contract counted twice (not three times), Decimal amounts, export/list agreement and current-work drilldown counts.
- Broad isolated API attempt 1: 847 suites/10,570 tests passed; one DTO-only test failed to initialize `reflect-metadata`. Added test bootstrap and verified its 2 tests pass.
- Broad isolated API attempt 2: an untouched trade-in routing test intermittently returned 404 rather than expected 403. Its isolated rerun passed all 10 cases. No production trade-in code was changed. Further verification is pending; do not read this as a completely green broad run.
- F6 `local:check` PASS on 2026-10-05 22:26 UTC (1440/390 browser flows plus 320–1920 layout); private preview remains at port 5217.
- Broad API attempt 3 exposed a legacy GFIN test-order dependency: no baseline branch. The disposable harness now seeds a branch explicitly. Attempt 4: all 848 API suites / 10,572 tests pass (14 intentionally skipped). Its subsequent F1–F6 run had 119/120: an additional eligible manager from another suite was omitted by the test expectation. The seed account was marked `isSystemUser: true` as fixture hygiene, but later investigation showed the actual extra recipient was a cross-branch FINANCE_MANAGER with SHOP grants. The test now asserts the exact authorized audience, including those managers, and no duplicates after concurrent/repeated scans. No production alert recipients were weakened.

## Interpretation and limits

All database-backed tests use disposable PostgreSQL. The managed preview uses private local file bytes and synthetic actors/AI/provider acknowledgements; it is not proof of live Meta permissions, subscriptions, provider delivery, cloud credentials or production operations. No deployment, migration on a live database, or real customer message was performed.

Response time uses each cycle's immutable Bangkok work-hour policy. Unknown policy/staff and legacy cycles are coverage categories, not zeros. Work counts in a period use event history; current backlog is explicitly current, not a reconstructed historical snapshot.

SHOP amount follows net-after-discount source sales and excludes soft-voids; separate refund accounting is not subtracted from this document-value report. FINANCE uses original qualified contract principal, not retail revenue or receipts. Attribution means a prior evidenced chat for the canonical customer, not a causal sales claim. Funnel first contact means earliest surviving evidence in authorized rooms/company/channel, and current stage omits unscoped manual/cross-company evidence. These restrictions can make its stage differ from an unrestricted customer profile.

For known policy decisions and implementation deviations, see the task ledgers while work is active; the final report will preserve them before ledger cleanup.

## Completed six-feature integrated verification

Final combined isolated run (`all-final-broad-v2.log`): 848 API suites / 10,572 tests passed (14 skipped), followed by 19 scoped operations suites / 130 tests passed. `local:check` passed at 2026-10-05 22:57:33 UTC, including the actual canned-response insertion and library flows at 1440/390 plus 320–1920 light/dark composer layout. A later isolated upload probe found a Thai multipart filename encoding issue; its cloud-only fix is separately verified and included in the final branch review.
