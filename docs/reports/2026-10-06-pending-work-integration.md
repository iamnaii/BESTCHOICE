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

Verification results and final merge hashes are recorded below after the checks finish.
