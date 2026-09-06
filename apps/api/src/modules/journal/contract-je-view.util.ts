import { Prisma } from '@prisma/client';

/**
 * Read-side view of one POSTED journal entry as consumed by the web JE card
 * (`JeBlock`). Shared by `PaymentQueryService.getContractJournalEntries`
 * (receipt-scoped, 5 tags/flows) and `ContractJournalQueryService`
 * (contract-scoped, every flow) — one mapper so the two endpoints can never
 * drift on money formatting or metadata coercion.
 *
 * Conventions locked by `payment-query.journal-entries.spec.ts`:
 *   - money as `.toFixed(2)` STRINGS (never Number())
 *   - Dr lines before Cr lines (JournalLine has no lineNo; DB order is random)
 *   - metadata soft-links coerced to `string | null` (non-strings → null)
 */
export interface ContractJeLineView {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  description: string;
}

export interface ContractJeView {
  id: string;
  entryNumber: string;
  entryDate: Date;
  postedAt: Date | null;
  description: string;
  paymentId: string | null;
  tag: string | null;
  flow: string | null;
  deltaApplied: string | null;
  lateFeePortion: string | null;
  /** Original JE that has since been mirrored out by a receipt void. */
  reversed: boolean;
  reversedByEntryNumber: string | null;
  /** Set on receipt-void REVERSAL JEs — points at the original entry id. */
  originalEntryId: string | null;
  lines: ContractJeLineView[];
  totalDebit: string;
  totalCredit: string;
  isBalanced: boolean;
}

export interface JeLineSource {
  accountCode: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  description: string | null;
}

export interface JeEntrySource {
  id: string;
  entryNumber: string;
  entryDate: Date;
  postedAt: Date | null;
  description: string;
  metadata: Prisma.JsonValue | null;
  lines: JeLineSource[];
}

const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Unique account codes across every line of the given entries — one CoA lookup. */
export function collectAccountCodes(
  entries: ReadonlyArray<Pick<JeEntrySource, 'lines'>>,
): string[] {
  return [...new Set(entries.flatMap((e) => e.lines.map((l) => l.accountCode)))];
}

export function toContractJeView(
  e: JeEntrySource,
  nameByCode: Map<string, string>,
): ContractJeView {
  const meta = (e.metadata ?? {}) as Record<string, unknown>;
  let totalDebit = new Prisma.Decimal(0);
  let totalCredit = new Prisma.Decimal(0);
  // JournalLine has no lineNo and its id is a random UUID, so DB order is
  // arbitrary — present Dr lines before Cr (stable sort keeps each group's
  // relative order), matching the Dr-then-Cr convention of every JE view.
  const orderedLines = [...e.lines].sort(
    (a, b) => (b.debit.gt(0) ? 1 : 0) - (a.debit.gt(0) ? 1 : 0),
  );
  const lines = orderedLines.map((l) => {
    totalDebit = totalDebit.plus(l.debit);
    totalCredit = totalCredit.plus(l.credit);
    return {
      accountCode: l.accountCode,
      accountName: nameByCode.get(l.accountCode) ?? l.accountCode,
      debit: l.debit.toFixed(2),
      credit: l.credit.toFixed(2),
      description: l.description ?? '',
    };
  });
  return {
    id: e.id,
    entryNumber: e.entryNumber,
    entryDate: e.entryDate,
    postedAt: e.postedAt,
    description: e.description,
    paymentId: asString(meta.paymentId),
    tag: asString(meta.tag),
    flow: asString(meta.flow),
    deltaApplied: asString(meta.deltaApplied),
    lateFeePortion: asString(meta.lateFeePortion),
    reversed: meta.reversed === true,
    reversedByEntryNumber: asString(meta.reversedByEntryNumber),
    originalEntryId: asString(meta.originalEntryId),
    lines,
    totalDebit: totalDebit.toFixed(2),
    totalCredit: totalCredit.toFixed(2),
    isBalanced: totalDebit.toFixed(2) === totalCredit.toFixed(2),
  };
}
