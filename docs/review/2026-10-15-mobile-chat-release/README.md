# Mobile chat implementation and release verification

Authorized on 15 October 2026: recheck mobile scale and deploy the approved LINE-inspired layout. Design research and UI UX Pro Max guidance are recorded in [the proposal](../2026-10-14-chat-mobile-proposal/README.md). This directory describes the actual app, not the earlier HTML prototype.

## Delivered behavior

- Customer chats and team work have equal entry points on the mobile list. Additional list filters and utilities expand on demand. Existing scope, queue, assignment and task completion rules remain in their existing hooks.
- Opening a room hides workspace/global navigation. A 64px header provides Back, customer details and a room menu. Loading and access-denied states also retain Back. The global test-mode warning is reserved above the room when enabled.
- A compact composer shows customer/private-note mode, quick replies, attachments and microphone/send. Mobile Enter inserts a newline. Active dictation always retains Stop. Thai inputs use 16px Noto Sans Thai Looped.
- Files selected, pasted or dropped are staged until Send. Failed uploads stay available for retry; batches capture their original room. Files are excluded from private notes. Existing library delivery and credit workflows remain separate.
- Customer and note drafts survive room/list navigation. A per-workspace in-memory note store handles save completion across room switches, preserves newer edits, and gives a new submission a new idempotency token.
- Quick replies show a full-width list and a separate preview on phones. Expanded customer variables and rich-message sending use the original APIs. No new quoted-message protocol or team chat backend was introduced.
- `visualViewport`, dynamic height and safe-area padding support browser resizing. History follows input/tool changes only when already at the latest messages. Desktop retains the three-panel workspace.

## Checks

`tools/check-mobile-chat.mjs` exercises the actual app at 320×568, 375×667, 390×844, 430×932, 375×440, 844×390, 768×1024 and 1440×900, each in light and dark modes. It checks bounds, mobile input and touch sizes, room/list navigation, customer/private-note drafts, mobile Enter, file staging without auto-send, and quick-reply selection/preview/insertion. The 375×667 room has a 98px idle composer and 461px history with the bot status bar visible.

Existing browser acceptance checks were updated to use visible mobile menus while retaining their delivery, error/retry, feature flag, role/scope, team task, note mention, library and credit assertions. Added unit tests cover file batch room isolation and asynchronous note completion/idempotency after A→B→A navigation. A read-only reviewer identified issues that were corrected before release.

Additional browser checks passed for bottom anchoring, retaining older-history position, visible test-mode warning, and Back from denied rooms; see `edge-checks.json`. The same-checkout final suite and source fingerprint are recorded in `local-check.json`. Screenshots use synthetic local fixtures. Outbound delivery, speech recognition and some preview APIs are simulated. No physical iPhone/Android keyboard, live LINE delivery or live Meta delivery was tested; no customer messages were sent during verification.

Final release gate: version **26.10.30**, `npm run local:check` **PASS (39 checks)**, including **3,525 unit tests** (Web 3,330; Shared 149; storefront 46). The final scale matrix passed all **16** viewport/theme combinations. The check report records the pre-commit revision and the exact verified source fingerprint.

CI follow-up: legacy acceptance tests now open mobile filters, expand repossession help, and assert that dropped files stay in a draft without message/upload requests. The voucher error test waits for the target document's HTTP 403 and matching alert, preserving the no-sheet/no-number checks. These are test-only changes after the application source passed the recorded local gate; the refreshed same-checkout report is kept at `.tmp/local-preview/check.json` and CI verifies the final commit.
