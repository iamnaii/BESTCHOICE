import { CreateExpenseDocumentDto } from './dto/create.dto';

/**
 * Pure account-code collection for the JE preview (E4 — extracted from
 * ExpenseDocumentsService.previewJe). Builds the Set of chart-of-account codes
 * whose names the preview must resolve, so the preview matches what post()
 * actually books. No DB access — the caller does the findMany.
 */
export function collectJePreviewCodes(dto: CreateExpenseDocumentDto): Set<string> {
  const codes = new Set<string>();
  for (const l of dto.lines) codes.add(l.category);
  if (dto.depositAccountCode) codes.add(dto.depositAccountCode);
  // W8 — preload adjustment row codes + per-line WHT routes so the preview
  // can resolve names for the new sections (adjustments + multi-line WHT).
  for (const adj of dto.adjustments ?? []) {
    if (adj.accountCode) codes.add(adj.accountCode);
  }
  // 11-4101 = ภาษีซื้อ (Input Tax Credit, claimable). Mirrors expense
  // templates' VAT routing — must match what post() actually books.
  codes.add('11-4101');
  codes.add('21-1104');
  // Always preload both WHT routes — the preview may emit either or both
  // depending on per-line whtFormType (P2-4).
  codes.add('21-3102');
  codes.add('21-3103');
  return codes;
}
