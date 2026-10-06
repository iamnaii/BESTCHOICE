# BESTCHOICE prototype V2.1 — detailed layout audit

Date: 6 October 2026, Asia/Bangkok. User reported that parts of V2 were misaligned and requested a detailed check of the whole prototype.

Preview: **http://127.0.0.1:5286/?v=2.1**

## Confirmed defects and fixes

The earlier document-width checks were insufficient: `overflow:hidden` kept the page width normal while vertically hiding usable content. This audit checks control positions, scrollable ancestors, overlap/hit targets, and actual interactions as well as screenshots.

| Reproduction | Before | Fix / result |
|---|---|---|
| Chat at 320×568 | Message thread only 36 px; composer bottom 587 px, beyond a 568 px viewport | Compact chat header, move room close to toolbar, put secondary controls in the room menu, remove redundant app header in mobile conversations. Normal thread now **153 px** and send button stays in view |
| Eight long filenames / 390×667 | Composer grew with every file; five-file reproduction put its bottom at 832 px | Bounded attachment summary opens a scrollable review/remove dialog. Eight files no longer change composer height linearly |
| Service dialog at 844×390 | Dialog bottom at 370 px but footer bottom at 413.4 px | Flex dialog with independently scrolling body and fixed-in-layout header/footer. Footer now fits within the viewport |
| Low-height / landscape conversations | Headers and composer consumed all available height, with unreachable controls below a clipped workspace | Conversation becomes vertically scrollable at genuinely insufficient height. Normal-height panes retain independent message scrolling |
| Room queue at 320×568 | Remaining list viewport was smaller than a complete room row | On short screens the entire queue scrolls; filters, rows and queue-work link remain reachable |
| Long Facebook post title | Post card pushed the response controls below the available pane | Two-line title plus explicit full-post dialog; reduced metadata on short mobile screens. Standard 320×568 public-response button now fully fits |
| Narrow header and long customer/file/task text | Owner text, filenames and task controls competed for fixed space | Shrinkable text containers, deliberate wrapping, labeled overflow menu and consistent touch controls |
| Resize/attachment updates | A reader at the end of a thread could be left above the newest message after layout changed | Preserve bottom anchoring when previously at the bottom; otherwise preserve reading position |
| Back after sending | The previously selected room could leave the waiting filter, leaving focus without a target | Focus returns to the selected visible room or next remaining room/search |

The secondary room controls were relocated, not removed: mobile room menu contains pin, mute, notifications, actor/theme controls and failed-send simulation. Attachments retain their full names in the review dialog. GFIN/credit/contract/warranty entry points remain available.

## Experiment ledger

1. Reproduced the original defects using fixed synthetic state, fixed sample time and exact viewports. Recorded thread/composer/dialog rectangles. The page width remained correct despite vertical clipping, disproving the earlier “no horizontal overflow implies usable layout” assumption.
2. Traced computed flex/min-height/overflow styles. Existing chrome and unbounded attachment rows consumed the conversation height; the dialog body's independent `65dvh` maximum did not reserve room for header and footer.
3. Changed only modal flex constraints in a temporary browser stylesheet. Footer moved inside the viewport without changing data or JavaScript state, isolating that cause.
4. Applied bounded attachments, compact mobile chrome, modal flex sizing and low-height scroll recovery. Repeated reproduction: normal 320×568 thread 153 px; long attachments no longer pushed send out of view.
5. Broader control geometry checks found six remaining failures (three cases × two themes): short queue rows, long comment title, and failure+attachments at 1024×600. Corrected queue scroll, post disclosure and conversation overflow recovery.
6. Rechecked the final source: 1,120 layout states passed, zero uncaught browser errors. Visually inspected screenshots after the correction rather than inferring visual quality from geometry alone.
7. Native-dialog Tab briefly enters browser chrome in Chromium (`document.hasFocus() === false`) before returning to the modal. This is browser navigation, not background-page focus; the keyboard test verifies that focused page controls stay in the modal and Escape dismisses it.

## Verification

- **1,120 geometry states:** 30 scene variants × 16 viewport sizes × 2 themes, plus 20 modal variants × 4 viewport sizes × 2 themes.
- Width/height pairs include 320×568, 360×640, 390×844, 430×932, 600×800, 760×900, 761×900, 768×1024, 844×390, 1024×600, 1024×768, 1279×720, 1280×720, 1440×900, 1920×1080 and 320×360.
- Scenes cover empty queues, long names/messages, attachments, failed send, notes/tasks, closed conversation, customer states, credit files/results, contracts, warranty, every GFIN step/sent state, work list states, comments and SHOP/FINANCE reports.
- Each enabled rendered control is checked for viewport bounds and hit coverage **after scrolling only ancestors that users can scroll**. The test does not use `scrollIntoView` to silently move `overflow:hidden` ancestors and mask a clipping bug. Below-fold content is expected on deliberate scroll surfaces; this does not claim every control is simultaneously visible.
- **9 additional interaction groups:** small-phone chat/send; 8-file review/removal; mobile failure/retry; back/focus; compact room controls/profile; full mobile GFIN; landscape service form; long-post disclosure/public reply; native modal keyboard behavior.
- Previous **14 core workflow groups** passed again, preserving ownership, queue, credit mock, service identity matching and company scope behavior.
- Google Fonts unavailable: normal chat checked at 320×568, 768×1024 and 1440×900 with no width overflow and a usable message viewport.
- `npm run local:check`: **PASS** on the current checkout; synthetic managed application preview remains at http://localhost:5207/inbox.

Reproducible QA:

```bash
node docs/prototypes/chat-operations/qa/verify-layout.mjs
node docs/prototypes/chat-operations/qa/verify-interactions.mjs
```

[Geometry results](../prototypes/chat-operations/qa/layout-results.json) · [Interaction results](../prototypes/chat-operations/qa/interaction-results.json)

Screenshots: [Desktop](../prototypes/chat-operations/screens/v2.1/desktop.png) · [Small phone](../prototypes/chat-operations/screens/v2.1/phone-small.png) · [Attachments](../prototypes/chat-operations/screens/v2.1/phone-files.png) · [Landscape dialog](../prototypes/chat-operations/screens/v2.1/landscape-dialog.png) · [Comments](../prototypes/chat-operations/screens/v2.1/phone-comment.png) · [Dark](../prototypes/chat-operations/screens/v2.1/desktop-dark.png).

## Scope and limits

These checks cover the standalone V2.1 prototype in Chromium, with emulated viewport sizes. They are not physical-device Safari/Android keyboard tests, a complete accessibility certification, or validation of live backend integrations. Low-height viewports intentionally permit vertical scrolling rather than hiding controls. All data and financial/Meta actions remain simulated or explicit handoff points. No production application source or API/schema changed.


## V2.4.1 credit upload button alignment

User screenshot showed เลือกไฟล์ higher than จากแชท. Reproduced at 1512×830: first button y778.97/h32 versus second y786.72/h30. Both were inline-flex with baseline alignment; the icon altered the first button baseline and intrinsic height. A browser-only middle-alignment/36px-height probe aligned them, isolating the cause.

Set `.credit-drop button` to `vertical-align: middle` and minimum height36px. The existing compact-screen rule retains44px targets. Browser measurements verified identical top/bottom positions across320,390,768,1024 and1512px widths in light/dark themes; both file-source actions still work. No production application source changed.
