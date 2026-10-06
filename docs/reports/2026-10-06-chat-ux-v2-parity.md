# BESTCHOICE Inbox UX V2 — source parity and verification

Date: 6 October 2026 (Bangkok). User requested a redesign using `ui-ux-pro-max`, then explicitly selected a comprehensive comparison against the original chat interface.

The first prototype simplified the original Inbox too aggressively. Core sales/finance tools and room controls were absent or reduced to explanatory dialogs. V2 restores their discoverability and preserves their placement in the workflow. **This does not mean all underlying integrations have been implemented in the prototype.**

Preview: http://localhost:5286 · preserved V1: http://localhost:5286/v1/

## Design direction

Skill read: `/Users/iamnaii/.agents/skills/ui-ux-pro-max/SKILL.md`, with `references/pro-rules.md` and `references/quick-reference.md`.

Design-system queries `customer support operations dashboard` and narrower retry `CRM enterprise dashboard` both returned landing-page patterns. Those patterns were rejected and the raw recommendations were not persisted as an approved design system. The applicable Flat Design / dense dashboard direction, contrast, visible focus, progressive disclosure, explicit action labels, touch and state-preservation guidance informed the workbench. Existing Emerald/Zinc tokens, Thai typeface and official `apps/web/public/logo-icon.svg` take precedence over suggested generic palettes/fonts.

Desktop keeps three work columns beside the app navigation: room list, conversation, dossier. At intermediate widths the dossier replaces the conversation on request. Mobile shows one work pane at a time, with the top-level destinations still reachable. No key business action depends on hover.

## Source-to-design inventory

“Interactive” below means a local, synthetic prototype interaction. “Handoff” means an explicit entry point or description; the underlying production flow is not duplicated.

| Existing work | Source inspected | V1 gap | V2 location / depth |
|---|---|---|---|
| รอตอบ / ของฉัน / ทั้งหมด | `ChannelFilter.tsx` | Replaced by four work filters | Restored three views; ของฉัน uses room owner |
| Channel and owner filtering | `ChannelFilter.tsx` | Missing | Two labeled filters; owner fixed to actor on ของฉัน |
| Search and waiting time | room list + `ChatPanel.tsx` | Present | Retained; waiting distinct from reading and bot messages |
| Pin, AI pause/return, mute | `ChatPanel.tsx` | Missing | Labeled toolbar, interactive toggles |
| Assign / transfer / claim | `SessionActions.tsx` | Missing | Click owner or room menu; mock transfer; purchased room points to original commission/permission guard |
| Close / reopen | `ChatPanel.tsx` | Present | Retained; open follow-up work survives closing |
| Text draft and failed-send retry | `ChatPanel.tsx` | Basic | Room-specific draft; attachment metadata survives retry exactly once |
| Internal note / mention | `ChatPanel.tsx` + six-feature plan | Present | Preserved note mode and notification simulation |
| Attach image / audio / video / file | `ChatPanel.tsx`, `useChatMediaPicker` | Missing | File selection, removable draft chips, sent file list; metadata only, no media rendering/upload |
| Emoji | `ChatPanel.tsx` | Missing | Keyboard-accessible sample picker |
| Product information / photos | `ProductPickerDialog.tsx` | Missing | Sample product picker prepares text; production stock/photo payload remains original component |
| Canned response / Ctrl+K | `ChatPanel.tsx` | Missing | Picker prepares editable text without auto-send |
| Prepare offer / contract handoff | `PrepareOfferDialog.tsx` | Missing | Interactive draft and review; actual finance calculation and contract creation remain existing workflow |
| Customer / prospect / unknown identity | `RoomDossier.tsx`, `LinkCustomerDialog.tsx` | Flattened to “existing customer” | Linked and unlinked sample states; search, confirm linking, edit/create mock profile |
| Same-person merge and credit-history migration | `RoomDossier.tsx`, `useLinkRoomCustomer` | Missing | Handoff through customer linking; actual merge/provenance rules are not simulated and must be reused |
| Tags | current customer context | Missing | Interactive comma-separated tag editor |
| Credit document upload / from chat | `RoomCreditCard.tsx`, `useRoomCredit` | Explanatory modal only | Visible credit section, file validation (10 MB / 10 files), keyboard chooser, drop and chat-file selection |
| Credit analysis / retry / history | `RoomCreditCard.tsx` | Explanatory modal only | Mock document check and history; no score, approval, or automatic purchase claim |
| Customer appointments | `RoomDossier.tsx` | Present but hard to find | Next-work panel + dedicated work page; completed items remain accessible |
| Product context / ad attribution | `RoomDossier.tsx` | Partial | Customer dossier shows sample product and known/unknown ad source |
| Other linked channels / full customer profile | `RoomDossier.tsx`, `Customer360Panel.tsx` | Missing | History/profile entry points; cross-channel identity still uses original linkage |
| Calls / contact history | `Customer360Panel.tsx` | Missing | Explicit call/history handoffs; no Yeastar action invoked |
| Contract and installment summary | `DossierCards.tsx`, `Customer360Panel.tsx` | Explanatory modal only | Dedicated สัญญา/ชำระ tab, synthetic contract summary |
| Payment link, contact + payment appointment | `Customer360Panel.tsx` | Missing | Review-to-message payment placeholder; appointment simulation |
| Contract PDF / receipt history / MDM | `Customer360Panel.tsx`, `customer360/*` | Missing | Explicit handoff controls; no generated legal PDF, real payment or lock command |
| Warranty lookup by IMEI | `RoomDossier.tsx` | Missing | Dedicated ประกัน tab; only known fixture device matches |
| After-sales intake and case | six-feature plan + existing after-sales | Present | ประกัน tab + work queue; identity/device match required; intake does not mean device receipt |
| GFIN customer / product / docs / message | `gfin/GfinTab.tsx`, step components | Entirely absent | Interactive four-step draft, preserved customer/message drafts |
| GFIN 9 primary + 4 optional document slots | `packages/shared/src/finance-doc-slots.ts` | Absent | Exact 13 labels restored; required first 3 slots gate simulated send |
| GFIN chat document selection | `GfinSlotPicker.tsx` | Absent | Visible handoff from chat-file menu to GFIN; actual per-file slot allocation not implemented |
| GFIN submitted state, further files, links, result | `GfinStatusCard.tsx` | Absent | Sent mock state plus explicit follow-up handoff listing extend/revoke/resend/result operations |
| Wider SHOP / FINANCE navigation | `AGENTS.md`, existing app | Prototype appeared to replace app | “ไปยังงานเดิม” links to managed app preview; full business navigation remains in production shell |

Not restored: owner-removed Broadcast, dead AutoAssign, or a claim that the TikTok scaffold is a live integration. These are not UI regressions to undo.

## Coverage of the six planned improvements

| Feature | V2 representation | Still production work |
|---|---|---|
| Work queue and SLA | Waiting views, overdue labels, task owner filter, dedicated work page | Real clocks, notifications, server queries and escalation policies |
| Sales status and follow-ups | Evidence labels, existing product/credit/offer actions, retained appointments | Evidence aggregation and lost/reopen write flows in the six-feature plan |
| Facebook comments | Separate public queue, draft retention and mock response | Meta permissions, ingestion, rate limits and send/retry handling |
| Mentions and handoffs | Note mentions, notifications, accept/complete, room owner unchanged | RBAC, durable events, full TODO/DOING/REVIEW/DONE transitions |
| Chat service intake | Intake, task visibility, matching case link | Actual intake/repair workflow integration and lifecycle sync |
| Honest team analytics | Human/bot metrics separated, source caveats, drilldown, SHOP/FINANCE scope | Event instrumentation and reliable historical attribution |

## Browser verification

Playwright passed 14 focused behavior groups:

1. Restored toolbar and dossier entry points.
2. Channel and owner filters.
3. Draft retention on room change and template review before send.
4. Attachment failure/retry, waiting state and one-time attachment append.
5. Chat document → credit → simulated analysis, without advancing sales evidence.
6. GFIN draft retention, 13 slots, required-document gate and simulated send.
7. Offer draft and explicit contract handoff boundary.
8. Recipient accepts/completes task; sales owner remains unchanged.
9. Appointment survives closing; completion remains in the completed-work view.
10. Customer link, manual assignment and pin/AI/mute controls.
11. Known-device warranty, correct service-case link, payment placeholder and purchased-room transfer guard.
12. Comment draft survives switching; public reply updates its own queue.
13. FINANCE scope and report behavior.
14. Escape dismisses dialog; no uncaught browser errors.

Responsive checks passed **98 screen/theme combinations**: seven views (queue, conversation, dossier, GFIN start, work page, comments, report) × seven widths (320, 390, 768, 1024, 1280, 1440, 1920) × light/dark. No document horizontal overflow. Additional checks found no chat controls extending beyond the viewport at 320–1440 px. Desktop, mobile, work-page and dark screenshots were visually inspected. This is not a full accessibility conformance audit or backend integration test.

Evidence: [verification JSON](../prototypes/chat-operations/verification-v2.json) · [desktop](../prototypes/chat-operations/screens/inbox-desktop-v2.png) · [mobile](../prototypes/chat-operations/screens/inbox-mobile-v2.png) · [work page](../prototypes/chat-operations/screens/work-desktop-v2.png).

`npm run local:check` also completed **PASS** on this checkout. `.tmp/local-preview/check.json` records source fingerprint `afe7eed62963ad02cce9b122a820f4880b08ca921a171d44f7ee22a0ebc180a7` at revision `cd09bc4e6`. It covers project types/lint/tests/builds plus the managed synthetic browser preview, including trade-in this run. The earlier V1 report's trade-in timeout did not recur. This check does not validate live Meta, finance integrations, or this standalone prototype; the prototype was checked separately above.

## Integration constraint

No tracked production application source changed. Reuse current `ChatPanel`, `RoomDossier`, `RoomCreditCard`, `PrepareOfferDialog`, `GfinTab`, `Customer360Panel` and domain hooks when implementing this design. Do not replace them with this vanilla simulation or flatten their state/permissions. Preserve business actions using this inventory as a review checklist, and recheck the current source before integration.

## V2.1 layout correction

The user subsequently reported misalignment. The original horizontal-overflow checks missed vertical clipping. The [detailed V2.1 audit](2026-10-06-chat-ux-layout-audit.md) records confirmed defects, corrected layout constraints, visual evidence and deeper control-reachability tests. Use V2.1 screenshots for current layout review; the business-work inventory above still applies.
