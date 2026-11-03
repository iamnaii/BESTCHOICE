/**
 * Σ Dr / Σ Cr of journal lines in whole satang — each amount is rounded to the satang first, then integers are added,
 * so the totals are exact (0.1 + 0.2 = 0.3) and comparing them with `===` is the server's `isJournalBalanced` rule
 * (owner decision 2026-10-31: equal to the satang, no 0.01 tolerance). Shared by `EditableJournalTable` (override V1)
 * and `AutoJournalPreview` (the balance badge — re-review m1).
 */
export function journalTotalsCents(lines: ReadonlyArray<{ debit: number; credit: number }>): {
  drCents: number;
  crCents: number;
} {
  return {
    drCents: lines.reduce((s, l) => s + Math.round((l.debit || 0) * 100), 0),
    crCents: lines.reduce((s, l) => s + Math.round((l.credit || 0) * 100), 0),
  };
}
