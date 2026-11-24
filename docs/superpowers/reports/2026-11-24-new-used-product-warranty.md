# New/used product entry and warranty — 2026-11-24

## Requested behavior

- New phones: no photo attachment section and no shop warranty section in product creation; submission omits angle/evidence photos and clears shop warranty days/terms.
- Used phones: a checked-by-default “ประกันร้าน 60 วัน” checkbox; unchecking records zero days and no shop terms. Six angle photos and four internal evidence slots remain available.
- Standard warranty copy has the six clauses supplied by the owner. Clause 1 uses the selected duration. Existing custom shop terms are preserved. Tablet manufacturer-only warranty notes remain available.
- Changing product category clears product-photo and warranty drafts. A generation guard ignores image decoding/busy callbacks from the prior category.
- Receipt standard terms use the actual warranty duration, are absent when there is no shop warranty, and matching product terms are not duplicated. The warranty block is full width and preserves line breaks. This does not change any monetary calculations or stored sale/contract records.

## Verification

- Product creation regression: four intended failures before implementation; final 24/24 pass, including tablet terms and delayed image completion after used → new → used.
- Receipt model/service unit tests: 25/25 pass.
- Shared copy tests check all six clauses, duration substitution, custom text preservation, and invalid durations.
- Independent read-only review identified two cases (tablet notes and stale image completion); both were fixed and rereviewed with no remaining findings.
- Browser at 390/1440 pixels: new-phone fields absent; used checkbox and six clauses present; 6 angle + 4 internal evidence inputs; no horizontal overflow or page errors. Uses the isolated local preview only.
- Real Chromium rendering of synthetic new/used receipt HTML and PDFs verifies all six clauses and no shop terms on a new-phone receipt. The used-phone fixture with multiple tenders, trade-in and two bundled items spans two pages at the existing document font size; its full warranty block and signatures remain together. The new-phone fixture is one page. No promise of a universal one-page receipt.
- Artifacts and logs: `.tmp/new-used-warranty/` (synthetic data). Full-check result is in `.tmp/local-preview/check.json`.

## Delivery

Local preview: http://localhost:5218/products/create . Source remains on `fix/ui-followup-accessibility` with the earlier UI fixes; no merge/deploy or production data writes were performed for this request.

Final full check: PASS 49/49, finished 2026-11-24T05:48:07.735Z. Source fingerprint: `a5c2e19feb11dcaca4dd84df471cbe916b3103a3467772956b96e46c34c57695`. Current managed preview verified running after completion.
