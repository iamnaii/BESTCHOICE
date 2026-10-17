# PO filters: text, arrows and proportions — 17 October 2026

## Reported issue and cause

The owner confirmed both uneven field proportions and text/arrow alignment in
`/purchase-orders?zone=shop`. The previous pass fixed squeezed fields and overflow,
but retained browser-native select arrows and a 2:1:1.4:1 grid. Passing those
earlier overflow checks did not establish consistent visual alignment.

## Changes

- The three filters now use the existing shared Select component and the same
  control styles as the search Input. Desktop uses a 2:1:1:1 grid; tablet uses two
  equal columns and phones use one column.
- Text, chevrons, padding, font, control height and border styling are consistent.
  The selected label truncates inside the control; opening the list shows the
  full label with wrapping and scrolling, including long unbroken supplier names.
- Active filter chips are bounded to their container. Their text can wrap and
  the remove button retains its width. A follow-up probe caught an existing
  1,195.8px chip on a 390px screen; after the fix it is 358px wide and its remove
  button is reachable at x=364px.
- Filter values, status requests and reset behavior are preserved. The internal
  Select value for “all” maps back to the existing empty-string filter value.

Only `POListTab.tsx` changes application behavior in this follow-up. The new
`apps/api/e2e/ui-fields/po-filters.audit-spec.ts` is a persistent browser regression.
The existing uncommitted work from previous rounds is preserved.

## Verification

Read-only code review: final delta passed without findings. UI UX Pro Max guidance
used: consistent form controls, touch spacing, text reflow and complete Select
composition. The existing Noto Sans Thai Looped font is preserved.

The isolated full API test uses disposable SHOP/FINANCE PostgreSQL and synthetic
PO/supplier fixtures. It verifies actual status, supplier, period and search
filtering, empty results, clear-all, removing a long supplier chip, Enter/Home
selection, Escape/focus return, and no page errors or external provider calls.

Configurations: 1440/light/16, 1280/light/16, 1024/light/16, 390/light/16,
320/dark/16 and 390/dark/20 (viewport/theme/root font in CSS pixels).

Measured control heights are 44px at the normal root size and 55px at the larger
root size. Chevron and label centers align vertically. Chevron inset is 13px
including the border at normal size, 16px at the larger size. Desktop filter
widths match within 0.02px of rounding. Open lists stay inside the viewport and
long option text wraps within its available width.

Targeted isolated API/browser regression: PASS, all six configurations. Local
preview status-select open/select/reset also passed at 1512px and 390px.

Final `npm run local:check`: **PASS, 39/39 checks**, completed
2026-10-17T04:34:31.931Z. Web tests: 459 files / 3,362 tests; shared: 149 tests; storefront:
48 tests. Types, lint (existing warnings, no errors), builds and managed browser
checks passed. Preview is running at http://localhost:5206/purchase-orders?zone=shop
and its fingerprint matches the final source:

`f4fffb108b76e3566fb66c18aa4f3f5600e242c6e1107f7fa39ef50504053096`

[Final local-check record](po-filter-alignment-2026-10-17/local-check.json).

The final targeted run completed at 2026-10-17 11:27:09 Asia/Bangkok. Its command:

```sh
DOCS_QA_SKIP_PREPARE=1 \
DOCS_QA_OUTPUT="$PWD/.tmp/po-filter-alignment/runtime-final" \
NODE_OPTIONS=--max-old-space-size=8192 \
bash tools/docs-integration.sh \
  --roots "$PWD/apps/api/e2e/ui-fields" \
  --testRegex 'po-filters\.audit-spec\.ts$' \
  --globals '{"ts-jest":{"isolatedModules":true,"diagnostics":false}}' \
  --runInBand
```

## Evidence and limits

- [Desktop fields](po-filter-alignment-2026-10-17/1440-light-16-fields.png)
- [Open supplier options](po-filter-alignment-2026-10-17/1440-light-16-supplier-open.png)
- [Mobile dark mode with larger text](po-filter-alignment-2026-10-17/390-dark-20-supplier-open.png)
- [Measured results](po-filter-alignment-2026-10-17/results.json)
- [Local desktop preview](po-filter-alignment-2026-10-17/preview-1512-after.png)
- [Local mobile preview](po-filter-alignment-2026-10-17/preview-390-after.png)

Browser tests use Chromium, including simulated mobile viewport sizes; they do
not establish physical iPhone/Android or Safari coverage. Native Chrome AX showed
the updated comboboxes in the owner's local tab, but its screenshot capture was
unreliable, so it is not counted as completed visual verification.

The managed preview at localhost:5206 has a limited synthetic backend. Populated
PO filter behavior is established by the separate full API harness, not by the
managed preview's empty PO list. This follow-up is specific to the PO filter row
and active-filter chips; it is not a new certification of every field in the app.
