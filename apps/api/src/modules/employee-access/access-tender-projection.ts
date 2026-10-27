import { TenderSourcePlan } from './access-tender-source';

const MONEY_FIELDS = new Set([
  'cashOut',
  'dayCashOut',
  'nonCashOut',
  'totalOut',
  'netCash',
  'expectedCashInDrawer',
  'expectedAmount',
  'countedAmount',
  'sendAmount',
  'receivedAmount',
  'varianceAmount',
  'varianceReason',
  'receiveVariance',
  'receiveNote',
  'sentBackReason',
  'amount',
  'outstanding',
  'oldestConfirmedAt',
  'openCloses',
  'moneyState',
  'journalPosted',
  'depositReference',
  'reference',
  'note',
]);
/** Explicit output projection over canonical results. No partial drawer is full. */
export function projectTenderRead(plan: TenderSourcePlan, method: string, value: unknown): unknown {
  const full = plan.branchIds.every((id) => plan.moneyVisible(id));
  const complete = plan.branchIds.every((id) => plan.complete(id));
  const walk = (input: unknown, branchId?: string): unknown => {
    if (Array.isArray(input)) return input.map((item) => walk(item, branchId));
    if (!input || typeof input !== 'object' || input instanceof Date) return input;
    const row = input as Record<string, unknown>;
    const ownBranch = typeof row.branchId === 'string' ? row.branchId : branchId;
    const money = ownBranch ? plan.moneyVisible(ownBranch) : full;
    const sourceComplete = ownBranch ? plan.complete(ownBranch) : complete;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(row)) {
      if (key === 'viewerRole') continue;
      if (key === 'hasDepositSlip' && (!ownBranch || !plan.allows('documents.read', ownBranch))) {
        out[key] = null;
        continue;
      }
      if (['holdings', 'monthShortage'].includes(key) && !money) {
        out[key] = null;
        continue;
      }
      if (!money && MONEY_FIELDS.has(key)) {
        out[key] = null;
        continue;
      }
      if (
        !sourceComplete &&
        [
          'cashIn',
          'dayCashIn',
          'transferIn',
          'qrIn',
          'totalIn',
          'movementCount',
          'lastCashInAt',
        ].includes(key)
      ) {
        out[key] = null;
        continue;
      }
      if (!money && ['reached', 'atBranch', 'state', 'cells'].includes(key)) {
        out[key] = null;
        continue;
      }
      out[key] = walk(item, ownBranch);
    }
    if (typeof row.branchId === 'string') out.moneyAvailable = money;
    if (ownBranch && ('hasDepositSlip' in row || 'depositedAt' in row)) out.canReadSlip = money && plan.allows('documents.read', ownBranch) && plan.allows('shop-tenders.read', ownBranch);
    return out;
  };
  if (!value || typeof value !== 'object') return value;
  const result = walk(value) as Record<string, unknown>;
  if (method === 'getDailySummary') {
    // Daily totals/staff buckets may combine branches. Scope is exact, monetary
    // coverage is fixed by current grants, never by whether a payout exists today.
    const raw = value as { rows: Record<string, unknown>[]; byKind: Record<string, unknown>[] };
    result.rows = raw.rows.map((row) => {
      const id = String(row.id),
        source = plan.sources.get(id);
      return {
        ...row,
        amount:
          source?.kind === 'TRADE_IN_PAYOUT' && !plan.moneyVisible(source.branchId)
            ? null
            : row.amount,
        docId: plan.navigate(id) ? row.docId : null,
        docNumber: plan.navigate(id) ? row.docNumber : null,
        customerName: plan.customerVisible(id) ? row.customerName : null,
      };
    });
    result.duplicateReferences = (value as Record<string, unknown>).duplicateReferences;
    result.byKind = raw.byKind.map((row) =>
      row.kind === 'TRADE_IN_PAYOUT' && !full
        ? { ...row, cash: null, transfer: null, qr: null, total: null }
        : row,
    );
  }
  result.availability = {
    money: full ? 'FULL' : 'UNAVAILABLE',
    sources: complete ? 'COMPLETE' : 'PARTIAL',
    duplicateReferences: 'SCOPED',
    countNote: { required: true, minLength: 5, maxLength: 500 },
  };
  return result;
}
