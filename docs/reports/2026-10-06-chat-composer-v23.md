# V2.3 — composer alignment and product search

The user's V2.2 screenshot exposed a visual mismatch in the active note composer that geometry-only checks did not flag: a raised tab cut into a green input outline while using neutral/amber borders. Product selection also had no search input.

## Reproduction ledger

- 1512×830, note mode, textarea focused: tab bottom 673px and card top 672px (overlap), tab border rgb(224,229,226) against card rgb(11,116,86); native vertical-resize handle visible. Product dialog contained zero search inputs. Screenshot saved under `.tmp/chat-ux-v23/note-before.png`.
- Removed the negative tab margin/raised border shape. Mode controls now sit 8px above the uninterrupted card (4px on compact screens); note card/focus/action use amber. The textarea auto-grows instead of exposing a resize handle.
- Added search with stable catalog indices. A filtered Samsung row remains catalog index2, inserts the Samsung summary at the caret and does not send a message.
- Review identified that `128GB` missed `128 GB`; whitespace-free matching now accepts both, as well as `iphone15`.
- Review identified 40-line typing at 320×568 pushing Save below the viewport. Growth now accounts for available conversation height; on very short screens active typing scrolls the conversation just enough to expose the footer. The textarea itself scrolls additional content.
- Existing attachment test caught the footer 1px below the 320×568 viewport after reviewing/removing files. Compact mode-control spacing was reduced to 4px. The original attachment/retry interaction test passes again.

## Verification

- `qa/verify-products.mjs`: both themes/modes, continuous-border geometry, bounded auto-growing text, search by model/color/capacity/price, compact/case-insensitive input, empty/clear, stable filtered product selection, caret insertion, reopen/Escape, and 40-line drafts with visible Send/Save across five viewports.
- Existing composer regression: emoji/sticker/template behaviors and 60 picker layouts pass.
- Existing 1,120 layout states and 9 interaction groups pass; includes file review/removal, retry, GFIN, comments and modal focus.
- Visually inspected note mode and product search screenshots. `npm run local:check`: PASS; managed synthetic application remains at http://localhost:5207/inbox.

Preview: http://127.0.0.1:5286/?v=2.3. Only the standalone prototype changed; product stock and sends remain synthetic. This does not replace or validate the production product-search API.
