# Purchase and related form field audit — 2026-10-17

Status: PASS — scoped layout/interaction audit and final local verification complete.

This audit follows the owner's screenshot of `/purchase-orders?zone=shop`. Previous checks of overall page overflow/control height missed usable field width and long-content containment. This report covers the purchase/supplier/stock forms below; it does not certify every business workflow in the application.

## Defects and changes

- PO search could shrink to 37px at a 390px viewport (130px at 1024px with populated data). The old flex layout and an unlayered `min-width: 0` rule defeated the page's utility minimum. The screen default now lives in the components layer, and the PO filters use a responsive grid: one column on phones, two on tablets, four on large screens. Selects reserve space for their arrow.
- Stock-adjustment search was 157px at a 320px viewport. Its filter row now stacks on phones.
- Supplier, address, purchase/approval/tax/adjustment labels had 4–6px spacing from controls. These forms now share a 12px label gap, 14px text and a consistent line height. Existing control heights and Noto Sans Thai Looped remain unchanged; document exceptions remain intact.
- The supplier label targeted a hidden input instead of its picker. It now opens the actual combobox. The expected-date and transfer-date labels now target their calendar fields.
- When a product was added on a phone, the fixed item columns consumed the table width and left the model column **0px** wide. A 70rem minimum table width preserves 212px for the model at root font 16px. Horizontal scrolling stays inside the named, keyboard-focusable table region.
- A long supplier name caused the payment form's implicit grid track to grow: fields were 496px wide inside a 320/390px screen. Its tracks now shrink correctly, bank details wrap, the accounting table scrolls locally, and the dialog body/footer fit the available height.

## Evidence and scope

Evidence is in `.tmp/po-fields/` (synthetic data only):

- `before/` and `after/`: 12 page/form states at 1440, 1024, 390, 320px = 48 observations per pass. PO list/payables/create, supplier list/create/edit, stock list/count/create/adjustment/create/QC.
- `related-fields/fields/`: 25 related forms at 1440, 768, 390, 320px in light/dark = 200 observations. Checks include control font/height/width/labels, viewport containment and reachable buttons, plus address/input/selection/clear interactions. PASS.
- `interactions/`: populated filters, long supplier selection, label/calendar opening, product/capacity/color/price entry, and continuation to the summary at 1440, 1280, 390, 320px, including dark mode and root font 20px. Five configurations PASS after the table correction.
- `details/`: tax invoice and supplier-payment form entry at desktop/mobile/light/dark/enlarged text. Eight observations PASS after correction, with every visible field horizontally inside the viewport. Payment inputs are now 274px at viewport 390px and 204px at viewport 320px.
- Targeted Vitest: 18 files / 110 tests PASS before the final table/payment layout corrections. Final-source full web tests: 459 files / 3,362 tests PASS. Shared: 149 PASS. Storefront: 48 PASS. TypeScript, API/web lint and web/storefront builds PASS.
- Read-only review: initial 11-file delta and subsequent item-table delta PASS; payment delta PASS. No blockers found in these 13 files.
- Final `npm run local:check`: **39/39 PASS**, finished 2026-10-17T04:15:40.970Z. Source and running preview fingerprints match: `bb850d540eb41260f6a83be5294c84103e442fe31ba09faacf64b9904dcf630d`. The earlier run was intentionally stopped after finding the payment-dialog defect; these results are from the corrected final source.

The populated audit uses the real local AppModule/API against disposable SHOP/FINANCE PostgreSQL databases, with external providers isolated. Purchase-form interactions stopped before saving a PO, payment or tax invoice. Contact selection may ensure a role on synthetic contacts only. The broader local-check suite exercises synthetic writes and simulated providers; no real customer message or production payment is involved.

The managed `localhost:5206` preview has a deliberately limited backend. Its PO page can show empty data; it is not the evidence for populated purchase flows. The temporary full-API environment closed cleanly with its zero-external-call assertion passing. Phone checks are browser viewport simulations, not physical iOS/Android devices. Long native-select values can truncate, but full supplier names remain in options and the selected-filter chip.

## Saved visual evidence

- [PO filters before, 390px](po-field-layout-2026-10-17/po-mobile-before.png)
- [PO filters after, 390px](po-field-layout-2026-10-17/po-mobile-after.png)
- [Payment form after, 390px](po-field-layout-2026-10-17/payment-mobile-after.png)

The PO comparison uses the same limited preview with empty records; populated-flow evidence is recorded separately above.
