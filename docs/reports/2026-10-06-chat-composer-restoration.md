# Chat composer restoration — V2.2

Scope: `docs/prototypes/chat-operations`, the exact standalone preview shown in the user's screenshot. Production React/API source is unchanged. Preview: http://127.0.0.1:5286/?v=2.2.

## Evidence and root causes

1. The screenshot's thick, clipped outline on “ข้อความ” came from a generic outside focus outline inside `.composer { overflow:hidden }`, combined with an additional composer focus border. The restored composer permits visible overflow and gives its toolbar buttons an inset keyboard focus indicator.
2. V2 replaced the original equal icon controls with text buttons in a different order. Restored attachment → media → product → canned response, using the original source as reference; connected reply/note tabs to the card border.
3. The six-emoji centered dialog had replaced the original anchored media picker. Restored all five source categories, selected-text/caret insertion, LINE sticker packages and correct channel tabs.
4. The three immediately inserted canned-response buttons had replaced the original searchable, grouped list and preview. Restored the source interaction model with explicit insertion/direct-send actions and per-room expansion.
5. Focused code review caught two further regressions: inserting from note mode switched to public reply, and native light dismissal reopened the media popup on a second trigger click. Both fixed and reproduced by browser regression tests.

Source references:

- `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx`
- `apps/web/src/pages/UnifiedInboxPage/components/ChatMediaPicker.tsx`
- `apps/web/src/pages/UnifiedInboxPage/components/MessageTemplatePicker.tsx`
- `apps/web/src/pages/UnifiedInboxPage/hooks/useChatMediaPicker.ts`

## Restored behavior

- 36px desktop / 44px mobile toolbar controls, stable baseline, no clipped focus border.
- All original emoji categories; caret/range replacement with draft focus restored.
- LINE: Brown & Cony, Brown & Friends, Moon James; 34 original sticker previews render from local assets. Simulated sticker message, failure and retry.
- Canned dialog: categories, title/content/shortcut search, preview, variable expansion, double-click insert, Ctrl/Cmd+K, disabled actions before selection, reset on reopen, insert/direct-send separation.
- Internal-note insertion preserves note mode and the independent customer draft. Direct sends preserve existing draft text and unsent file attachments; successful sends update the simulated queue and owner consistently.
- Native popover Escape, outside dismissal and trigger toggle. Modal content stays reachable on small/short screens in both themes.

## Verification

- `qa/verify-composer.mjs`: 6 focused behavior groups plus 60 popup/modal layouts across 10 viewports × 2 themes × 3 picker types; zero runtime errors. Includes the screenshot-sized 1512×830 viewport, mobile 320×568 and extreme 320×360.
- `qa/verify-layout.mjs`: 1,120 existing layout states, zero clipped/inaccessible tested controls and zero runtime errors.
- `qa/verify-interactions.mjs`: 9 previous interaction groups pass (attachments, retries, compact controls, GFIN, landscape form, comments and focus).
- `qa/verify-workflows.mjs`: 14 core workflow groups and 98 responsive screen combinations pass, including handoff ownership, closed-chat follow-up, service identity matching, credit mock and FINANCE scoping.
- Visually inspected desktop focus, emoji, canned preview, mobile emoji/stickers/canned responses and dark theme.
- `npm run local:check`: **PASS** (6 October 2026, Bangkok), validates the unchanged application checkout separately; it does not cover this standalone prototype. The corresponding managed synthetic app preview remains http://localhost:5207/inbox.

## Limits

All sends remain in-memory simulations. The six canned records are clearly labeled examples, **not recovered production data**. Rich multi-bubble canned responses use the existing production component when integrated; this artifact demonstrates text templates. LINE previews are static PNGs. The original Facebook GIF tab is present, but GIPHY is explicitly not connected. Browser verification uses Chromium emulated viewports, not physical iOS/Android keyboard testing.

Results: [Composer](../prototypes/chat-operations/qa/composer-results.json), [Layout](../prototypes/chat-operations/qa/layout-results.json), [Interactions](../prototypes/chat-operations/qa/interaction-results.json), [Workflows](../prototypes/chat-operations/qa/workflow-results.json).
