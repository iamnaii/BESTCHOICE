# BESTCHOICE chat operations — actual application verification

> Historical pre-integration verification. The subsequent authorized commit/push/admin merge, current-main integration and newer checks are recorded in [the pending-work integration report](2026-10-06-pending-work-integration.md).

User scope: all six features, UX/UI restoration and the internal cloud file library. Actual implementation is in the isolated worktree `/Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/chat-operations-20261006`, branch `feat/chat-operations-20261006`.

Local preview: **http://localhost:5217/inbox**. Port 5286 remains the older design prototype; this report concerns the actual React/Nest application.

## Implemented behavior

1. Work queue and SLA: customer wait is independent of reading, bot replies, drafts and failed sends. Actual confirmed human responses own the reply attribution. Current permissions scope rows, counts, notifications and deep links.
2. Sales context and follow-up: evidence-based five-stage journey, canonical Todo appointments with Bangkok time, revisions, lost/reopen history and actual sales/contract references.
3. Facebook comments: durable signed-event intake, scoped comment queue, explicit author identity, pending/confirmed/failed/unknown delivery. Live Meta permissions and private/public reply capabilities remain unverified and disabled.
4. Team work: explicit persisted mention recipients and task handoff acceptance/completion. A task recipient does not become the room owner or salesperson automatically.
5. After-sales: chat intake links the original physical-receipt/case workflow. It cannot invent receipt evidence or accounting entries. Canonical case closure updates the task using actual closure evidence.
6. Team analytics: human/bot/unknown separated, median/p90 with samples, current backlog and period-event cohorts, scoped drilldowns, canonical-customer and sale/contract deduplication, actual responder vs source salesperson, Decimal amounts and export. Owner-only feature/SLA settings.
7. Internal file library: explicit scoped folder/file uploads, real private storage bytes, authorized previews, paginated search/type filtering, keyboard multi-selection, explicit staging, stable delivery tokens and credit copies. Images reuse image delivery; PDFs use a server-signed 15-minute download link. No automatic publication of credit documents into the library.

## UX parity

The original room views, search, filters, pin/close/reopen/AI/mute tools, reply/note drafts, emoji, LINE sticker picker, non-LINE GIF picker, canned-response search, searchable product picker and credit work remain in the actual application. The library is an additional composer control. Reply and note modes share a continuous composer surface; cloud files cannot send from notes. Credit local/cloud selection buttons have equal minimum height and wrap together on narrow screens.

Persisted mentions display the selected recipients even if no textual @name was typed. Appointment labels use Bangkok time on devices in another timezone. Cross-channel previews and the legacy create-ticket path now reload current room grants before accessing messages.

## Verification evidence

- **Final integrated `local:check`: PASS**, completed 2026-10-05T23:25:21.002Z. Code revision `00e32c6f5`, source fingerprint `6c90403d520b1c9df3fc489b33b8d4b4819941afd8d56c2c18986bf173bebde2`. All 36 recorded gates pass. Report: `.tmp/chat-operations/final-integrated-check.json`; log: `.tmp/chat-operations/post-review-local-check-v2.log`.
- **Full API regression: 849 suites / 10,578 tests PASS (14 skipped)**, followed by **19 operations suites / 136 real PostgreSQL tests PASS** (`review-full-api.log`).
- Final integrated gate includes API/Web types, both Prisma schemas, API/Web lint, Web/shared/storefront tests, storefront/Web builds, light/dark composer layout at **320–1920px**, and actual browser flows at **1440/390px** for all six features plus the library. It also checks existing customer/portfolio/company-navigation/trade-in/appraisal flows.
- **Fresh whole-branch review:** four Important findings, no Critical or Minor. All four fixed in one author pass with observed RED→GREEN regressions: scoped customer summary/disposition, independent feature flags/notifications, production Finance bot acknowledgement, and changed retry payload recovery. No re-review was dispatched. [Findings and remediation](2026-10-06-chat-operations-final-review.md).
- Focused final review checks: **31 finance bot/transport tests PASS**, **9 Web flag/recovery tests PASS**, plus the 136 operations tests above. Existing human wait remains open after a confirmed bot reply; rejected/unconfigured transport cannot claim bot success.
- Cloud checks cover actual private local bytes, current company/branch/revoked grants, archive denial, upload rollback/cleanup, partial failure, stable-token retry, double-click/ambiguous ACK, queue-disabled delivery tracking, changed file/room token denial, PDF link payload and independent credit copy without customer delivery.
- Browser checks cover real Thai upload/search, folder creation, keyboard multi-selection, staging, reply/note separation, failed-send retry, credit copy, searchable products, actual canned-response insertion, emoji and LINE sticker availability. Author inspected the resulting desktop/mobile screenshots.
- Verification caught a preview-only canned-response 501 and multipart Thai filename corruption; both were corrected and covered by the final gate. An intermediate final run also reached the genuine 10-file credit limit after repeated runs reused one fixture. The browser now creates a fresh synthetic room per library flow; production limits and retained preview files are unchanged. The replacement standalone 1440/390 flow and full gate both pass.

## Limits and operational boundaries

This is local reviewable work. All DB-backed verification uses disposable PostgreSQL. The preview uses local private file bytes, synthetic actors, synthetic AI and synthetic provider acknowledgements. It does not prove live Meta permissions/subscriptions, provider acceptance, or production cloud credentials. All new feature flags remain off by default outside the isolated preview. No live migration, deployment, push, merge or real customer message was performed.

SHOP sales values follow source net-after-discount documents and soft-void exclusion; separate refund accounting is not subtracted. FINANCE reports qualified original contract principal. Funnel contact means earliest surviving scoped evidence, not an unprovable all-time contact. Coverage notes explain unknown/legacy and scoped-vs-global differences.

The original checkout, its user changes, and other preview processes were preserved. [Recorded decisions and tradeoffs](2026-10-06-chat-operations-decisions.md) preserve every task ruling. Earlier F6 test-harness failures and their causes are documented in [the detailed verification record](2026-10-05-chat-operations-verification.md).
