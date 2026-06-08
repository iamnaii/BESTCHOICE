/**
 * PR-C PII — mask each payroll line's `employeeTaxId` (= the employee's
 * nationalId / override) UNLESS the viewer is a PII-cleared role. Mutates
 * `doc` in place (response-only — the STORED value is never changed); no-op
 * for non-payroll docs.
 *
 * Pure helper extracted from ExpenseDocumentsService (Wave-4) so the masking
 * rule has dedicated tests and a single definition shared by the create
 * response + the payroll-detail GET.
 *
 * PII-cleared roles: OWNER + ACCOUNTANT run the books; FINANCE_MANAGER files
 * payroll tax (ภ.ง.ด.1) and needs the real national IDs.
 */
export function maskPayrollTaxIds(
  doc: { payroll?: { lines: Array<{ employeeTaxId: string | null }> } | null },
  role?: string | null,
): void {
  if (role === 'OWNER' || role === 'ACCOUNTANT' || role === 'FINANCE_MANAGER') return;
  if (!doc.payroll) return;
  for (const l of doc.payroll.lines) {
    l.employeeTaxId = l.employeeTaxId ? '•••••••••' + l.employeeTaxId.slice(-4) : l.employeeTaxId;
  }
}
