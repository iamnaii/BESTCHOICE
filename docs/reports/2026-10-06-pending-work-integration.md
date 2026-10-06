# Pending work integration — 6 October 2026

User explicitly authorized completing pending work, commit, push and admin merge. Integration branch: `feat/chat-operations-20261006`; PR #1682.

## Inventory and decisions

- Current remote main at integration start: `eee9f695f` (#1681). Existing worktree heads were checked against ancestry and PR head SHAs; old squash-merged heads were not replayed.
- Chat operations: all six features, UX restoration and private library, plus the previously untracked design prototypes and six audit reports.
- Open #1645: bot free-down Thai/in-store rules, eval fixtures and guarded apply/rollback scripts; preserved without executing production scripts.
- `chore/remove-warranty-expiring-7d`: pending removal of unused notification template and sender, including idempotent soft-delete migration.
- `chore/remove-petty-cash-custodian`: pending removal of unused setting/API/UI; retained the database column for rolling-revision compatibility.
- `feat/customer-journey-phase3`: integrated existing T1–T13; completed optional heard-from capture for customer creation and POS (T14). T15 menu/palette removal was already present on main and remains absent. Customer creation still succeeds if its optional journey write fails, with a warning; chat-linked creation and fill mode do not ask again.
- #1655 was closed after its implementation was included in merged accounting PR #1662; no duplicate merge is needed.
- Historical unmounted branches, backup refs and already closed/superseded PRs were retained as history, not treated as active changes to replay into main.

## Integration corrections

- Combined current-main voice typing with the new composer, note mention input and cloud staging; independent read-only review found no concrete conflict-resolution bug.
- Separate `ChatSalesDispositionService.record` from customer-level `JourneyManualEntryService.create/remove`. Customer-level undo rejects room-bound manual entries, its CAS requires `roomId:null`, and global timeline projection excludes room-bound manual facts. Chat actions retain current company/branch/room grants.
- Journey retry tokens now reject a changed actor or normalized payload. Scoped summary/funnel ranks follow the shared order: contact, identity, credit, appointment/interest, purchase.
- Preserved current-main dependency/schema changes and regenerated both Prisma clients after installing the current lockfile.

## Operational limits

New chat flags remain disabled by default outside the synthetic preview. Live Meta capabilities and production cloud credentials are not validated by local tests. Merging main starts the repository's normal CI/deploy pipeline; no separate live data backfill, bot ops apply, feature activation or customer send is part of this integration.

## Release verification

- GitHub API job 112081157743 (production code at `2e6627e2a`): **888 suites / 11,048 tests pass**, 2 suites / 14 tests skipped. Later changes only correct test routing/mocks and regression expectations; no production source changes.
- Final isolated operations: **19 suites / 136 tests pass**. Legacy credit/browser/approval: **12 suites / 154 tests pass**. General dual-Prisma/payment integration: **14 suites / 70 tests pass**. The generic harness seeds the base branch/system user; its two optional demo-user grant checks skip internally when those demo users are absent.
- Test routing now keeps the operations specs in their guarded disposable-PostgreSQL harness, run explicitly by the blocking credit CI job. Filename-anchored exclusion works inside this worktree as well as a normal checkout. Legacy browser mocks use the current settings/notification envelopes.
- Bot offline evaluation: **67 scenarios / 141 turns pass**; no live provider/database writes.
- Read-only reviews found room-bound undo scope, retry-token payload binding, and heard-from skip pending-state issues; all corrected with focused regressions.
- All 131 original untracked design/report files were hash-verified and archived outside the repository at `BESTCHOICE-local-archive-20261006`. Canonical versions are committed. Generated PDF exports and caches remain on disk, excluded locally. The stale stock-writeoff lockfile version-only diff is archived separately.

Final managed `local:check`: **PASS, 37 gates**, completed `2026-10-06T02:53:52.967Z`, code revision `e37d45da3`, source fingerprint `158ab8093cfda4387f723c3c582951b2acc665cf9ae4cec0f5cac8dfe98e4ef8`. Includes 434 Web suites / 3,235 tests, shared 149 tests, storefront 46 tests, both Prisma clients, API/Web types/lint/builds, light/dark layouts at 320–1920px and all six operations/library browser flows at 1440/390px. Verified preview remains running at http://localhost:5217/inbox with synthetic data/providers. Evidence: `.tmp/local-preview/check.json` and `.tmp/chat-operations/merge-local-check-release.log`. PR #1682 is the canonical merge record; normal GitHub CI/deployment runs after merge. No separate live-data operation was performed.
