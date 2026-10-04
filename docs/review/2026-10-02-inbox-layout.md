# Inbox layout correction — 2026-10-02

Base: `bb27af756` (same revision as the reported production page).
Working checkout: `BESTCHOICE-inbox-layout`, branch `fix/inbox-layout-review`.

## Diagnosis ledger

1. Opened the reported conversation in the deployed UI. Focusing the empty composer reproduced the screenshot: an opaque green rectangle surrounded the textarea inside a second card border.
2. Traced the textarea, card `focus-within` styles, base `*:focus-visible` rule, and admin theme overrides. Candidate causes were the base ring/offset, the unlayered admin outline, and the card/toolbar sizing. The base ring was already disabled in this revision; the unlayered theme still applied a 2px solid outline with a 3px offset.
3. Added a browser regression against the isolated local preview with the real app shell and theme styles. Before the correction, it failed at 320px/light/chat: computed outline was `solid`, expected `none`. This rules out a stale production build as the sole cause.
4. Scoped the admin-outline exception to the composer textarea. Kept one opaque focus ring on the surrounding card (primary for chat, warning-strong for notes). Toolbar controls retain their individual keyboard outlines; forced-colors retains the card's outline fallback.
5. Replaced viewport-based keyboard-hint visibility with the available chat-container width. Prevented the send button/tool group from shrinking and allowed note privacy text to wrap.
6. Screenshot review at 320px revealed a separate header defect: the customer name had zero usable width. Wrapping the header actions below the name on narrow panels restored it; a minimum visible title-width assertion covers the regression.
7. The targeted browser check passed 28 combinations: light/dark × 320/390/768/1024/1280/1440/1920px × chat/note. It checks page/composer/control bounds, card-owned focus, preserved button focus, visible customer-name width, empty/nonempty button states, and Shift+Enter drafts. Screenshots are under `.tmp/local-preview/inbox-layout-*`.
8. Independent read-only code review passed after making the card focus ring opaque for contrast. The regression is included in `npm run local:check`.

## Scope

This is a layout and keyboard-focus correction. The preview uses isolated synthetic customer data and mocked AI; these checks do not certify real LINE/Facebook delivery or financial operations. Full basic-check results are recorded in `.tmp/local-preview/check.json` and `checks.log`.

Reproduce the targeted check against this running preview:

```sh
LOCAL_INBOX_ORIGIN=http://localhost:5227 node tools/check-local-inbox-layout.mjs
```

## Final verification

- `npm run local:check`: PASS, 2026-10-02T03:52:15.360Z; 22 recorded checks.
- API/Web types, lint, Web 2,799 tests, Shared 123 tests, Storefront 46 tests, and both frontend builds passed.
- First full run timed out in the unrelated trade-in action menu while its element detached; an unchanged-source rerun passed the entire desktop/mobile suite.
- Preview remains current and running at http://localhost:5227/inbox.
