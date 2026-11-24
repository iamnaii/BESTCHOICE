# UI follow-up verification — 2026-11-24

## Changes

- GFIN settings scroll the focused tab into view, including keyboard Home/End and arrow navigation on narrow screens.
- The storefront address dialog uses a Radix DialogTrigger so focus returns to Add address after Escape, Close, or successful save. A failed save keeps the form editable.
- Product cards immediately become visible and stationary when the OS reduced-motion preference changes during their entrance animation.
- A dedicated six-case browser regression suite now runs in `local:check` (320, 390, and 1440 pixels; synthetic storefront API fixtures).

## Verification

- Storefront regression: six expected failures before the fixes, six passes after.
- Isolated PostgreSQL/API browser suites: 8/8 pass (`uxui-interactions.browser.docs-spec.ts` and `icons.browser.docs-spec.ts`).
- `NODE_OPTIONS=--max-old-space-size=8192 npm run local:check`: PASS, 49 checks, finished 2026-11-24 04:58:02 UTC. The first attempt exhausted Node's default heap; the larger-heap rerun passed.
- Source fingerprint: `f19dbb9eea3883de7be0c6f78abb24440fff0df0008af68bd9553bbb990b4ddd`.
- Separate synthetic contract check uploaded all four device evidence types, created a contract through the UI, and verified all four internal document snapshots and their exact file bytes. It used only the isolated local preview database and mock OCR. The older helper's submit-button selector was updated in an ignored copy to match the current down-payment label.
- Independent read-only agent review found no correctness or regression concerns.
- Production create-product form was inspected read-only: six angle controls plus four internal evidence controls are present. No real product, customer, payment, or contract was created or changed for testing.

## External Apps Script icons

The stock page is a separate Apps Script application, not the first-party Tooltify sales-history page. The project was located through the MASTER spreadsheet's Extensions menu.

- Project: https://script.google.com/u/0/home/projects/1Onir8vaS8KAU5L05cS0eEKnmTkuMu2J3msMG_0g5Leiv_nbf3omT6i7t/edit
- Replaced 64 complete inline SVGs (31 original geometry groups) with Phosphor Duotone; navigation icons remain distinct.
- Full source was backed up before changing `รหัส.gs`. `Format.gs` was not changed.
- Automated comparison proved that removing complete SVG elements leaves identical source before and after. Server/client JavaScript parsing passed. Brand images, QR content, captions, sheet logic, and access settings were preserved.
- Local stock rendering passed at 390 and 1440 pixels; saved editor source was copied back and matched the prepared file byte-for-byte.
- Saved source SHA-256: `433cc66adb7ac40bbf3862961e9b5182320f40a8728127f7bf5fb7ed4ca99335`.
- Existing deployment updated to actual version **58** on 2026-11-24 at 11:59 Bangkok. Its URL and access settings remain unchanged.
- Live HTTP output contains all 64 Phosphor SVG markers and duotone paths. The reloaded public stock page was visually inspected with its search, stock table, chat, and phone controls intact.
- Private source backups, deterministic patch script, source roundtrip, mapping, HTTP captures, and screenshots are retained locally in `.tmp/ui-followup/`; full external business source is intentionally not committed.

## Handoff scope

The three first-party UI fixes are on `fix/ui-followup-accessibility`; this follow-up has not been merged or deployed to the main application. The external Apps Script icon update is live.

- Admin preview: http://localhost:5218/settings/gfin-rates
- Storefront preview: http://127.0.0.1:5493/products
- Preview data and integrations are synthetic. The storefront catalogue preview is read-only; address save/failure behavior is covered by the dedicated fixture-based browser tests rather than live account writes.
- Logs and screenshots: `.tmp/ui-followup/`; managed check record: `.tmp/local-preview/check.json`.
