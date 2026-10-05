# BESTCHOICE chat operations — actual application verification

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

- Cloud storage RED→GREEN: private local bytes, list/search/page, no storage keys in responses, company/branch/revoked-grant checks, archived folder/file denial, idempotent upload and cleanup after DB/storage failure.
- Cloud delivery RED→GREEN: actual router and PostgreSQL ACK state, partial failure, same-token retry, double click, unknown ACK, changed file/room token denial, notes/company denial, PDF download-link payload, independent credit copy. Queue disabled deliberately: file delivery tracking remains safe without enabling queue/cycle analytics.
- Scoped room tests RED→GREEN: cross-company/other-owner previews and legacy restricted-room ticket copying.
- Latest focused database run: **130 tests passed / 19 suites** (`.tmp/chat-operations/cloud-flags-green.log`).
- Latest focused Web run: **36 tests / 8 files passed**, including cloud staging, response-loss verification, upload retries, original picker/credit behavior, mentions and Bangkok timezone (`cloud-final-web.log`).
- Original router/credit regression before the queue-independent tracking correction: **89 tests passed**. Full API regression is repeated below on the final source.
- Browser library flow: **1440/390 passed**, including folder creation, upload, search, keyboard selection, staging without sending, note separation, failed-send retry, credit copy without sending and original composer tools (`cloud-t3-browser-retry.log`). Screenshots were inspected. The final integrated run also checks LINE sticker availability and 320–1920 light/dark composer layout.
- Integrated `local:check` PASS (2026-10-05 22:57:33 UTC). Combined broader API regression: **848 suites / 10,572 tests PASS**, followed by **19 suites / 130 scoped DB tests PASS**.
- Thai multipart filename issue: real HTTP upload reproduced mojibake; 3 normalization tests and the actual 1440/390 upload/search/canned-insertion browser flow pass after correction. Latest-source final `local:check` is repeated as the whole-branch gate.
- Fresh whole-branch reviewer: **pending**.
- Integrated run 1 correctly failed on a preview-only canned-response HTTP 501; the original reader/expander is now wired and the browser asserts inserting a synthetic response into the draft. Broad API passed 848 suites / 10,572 tests; the following operations run exposed an alert test assuming no other eligible finance manager existed. The assertion now checks the exact current authorized manager audience and duplicate prevention. Both complete checks are being repeated after these fixes.

## Limits and operational boundaries

This is local reviewable work. All DB-backed verification uses disposable PostgreSQL. The preview uses local private file bytes, synthetic actors, synthetic AI and synthetic provider acknowledgements. It does not prove live Meta permissions/subscriptions, provider acceptance, or production cloud credentials. All new feature flags remain off by default outside the isolated preview. No live migration, deployment, push, merge or real customer message was performed.

SHOP sales values follow source net-after-discount documents and soft-void exclusion; separate refund accounting is not subtracted. FINANCE reports qualified original contract principal. Funnel contact means earliest surviving scoped evidence, not an unprovable all-time contact. Coverage notes explain unknown/legacy and scoped-vs-global differences.

The original checkout, its user changes, and other preview processes were preserved. [Recorded decisions and tradeoffs](2026-10-06-chat-operations-decisions.md) preserve every task ruling. Earlier F6 test-harness failures and their causes are documented in [the detailed verification record](2026-10-05-chat-operations-verification.md).
