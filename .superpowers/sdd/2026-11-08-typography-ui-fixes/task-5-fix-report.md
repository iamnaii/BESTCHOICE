# Task 5 fix round
Status: DONE.
## Fix 1 /after-sales CaseTable
whitespace-nowrap added to StageChip, AwaitingMgrChip, SOURCE_LABEL chip and all 8 <th>. Wrapper already `overflow-x-auto` (line 85) so no wrapper change. Tests: headerNowrap.test.ts (CaseTable in describe.each + chips test).
## Fix 2 InterestConfigPage "แก้ไข"
Same classes as SettingsCard: `inline-flex items-center ... max-lg:min-h-11 lg:min-h-8 max-lg:-my-2.25 lg:-my-0.75` (ml-4 kept). Test: touchTargets.test.ts case (keepsBox).
## Fix 3 stockColumns widths
Audit JSON w fields are the already-shrunk span widths (96->80, 116->100, 62->46 = col minus px-2), so not usable; measured natural text in Chromium (Noto Sans Thai 600, 12px, uppercase, tracking-wider; agrees with audit ink 75.97/85.28/39.59 + 0.6px/char spacing):
text 84.6 / 90.8 / 42.3; need = text + gap 4 + arrow 14 + px-2 16 = 118.6 / 124.8 / 76.3.
cashPrice 96 -> 120 · monthlyPayment 116 -> 128 · quantity 62 -> 80. Accessory view 'ราคาขาย' (50px text) fits the 120 column; stockTableMinWidth still sums widths (tested). Table min width +34px total.
Test: StockPage/components/__tests__/stockColumnsWidths.test.ts.
## RED -> GREEN
Reverting the 3 source files: 11 failed / 79 passed. Restored: all pass.
## Checks
Full web tests 568 files / 4238 passed; tsc clean; eslint 0 errors (1 pre-existing unused-var warning in InterestConfigPage); Doc guard exit=1.
