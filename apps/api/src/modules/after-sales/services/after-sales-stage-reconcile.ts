import type { AfterSalesOutcome, AfterSalesStage, Prisma, RepairStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { deriveStage } from '../utils/after-sales-stage.util';

/**
 * A1 (final-fix brief, 2026-09-24) — `AfterSalesCase.stage` is written only by
 * `AfterSalesRepairService.sync()`, a *separate* write that runs after the repair-ticket
 * transaction commits. If `sync()` fails, or the ticket is mutated outside the after-sales
 * proxy (old `/repair-tickets/:id/*` API, `/insurance/:id` reached via the `TicketRedirect`
 * fallback, `markReplaced` via defect-exchange), the stored `stage` drifts from the true
 * derived stage. A drifted case that stays "open" in the stored column then blocks its IMEI
 * forever (409 on every new intake) even though the underlying repair ticket is CLOSED.
 *
 * Every reader that trusts the stored `stage` column must reconcile it against the live
 * `deriveStage()` truth first. This helper is idempotent and race-safe: the write is a CAS
 * `updateMany({ where: { id, stage: <the value we read> } })` — a losing concurrent caller
 * (or a caller that reads a row someone else already reconciled) simply writes 0 rows and
 * still returns the freshly-derived stage. It never throws and never writes an audit log —
 * this is self-healing bookkeeping, not a user-attributable action.
 */
export interface ReconcilableCase {
  id: string;
  stage: AfterSalesStage;
  outcome: AfterSalesOutcome | null;
  cancelledAt: Date | null;
  replacementContractId: string | null;
  repairTicket: { status: RepairStatus; deletedAt: Date | null } | null;
}

type ReconcileClient = Prisma.TransactionClient | PrismaService;

export async function reconcileStage<T extends ReconcilableCase>(
  client: ReconcileClient,
  row: T,
): Promise<T> {
  const derived = deriveStage({
    outcome: row.outcome,
    cancelledAt: row.cancelledAt,
    repairStatus: row.repairTicket?.status ?? null,
    repairDeleted: !!row.repairTicket?.deletedAt,
    replacementContractId: row.replacementContractId,
  });

  if (derived === row.stage) return row;

  const data: Prisma.AfterSalesCaseUpdateManyMutationInput = { stage: derived };
  if (derived === 'CLOSED') data.closedAt = new Date();
  if (derived === 'CANCELLED' && !row.cancelledAt) data.cancelledAt = new Date();

  // CAS: only the caller that still sees the stage we read is allowed to write it.
  // count === 0 (lost the race, or another reconcile already ran) is NOT an error —
  // the derived value we hand back is correct either way.
  await client.afterSalesCase.updateMany({ where: { id: row.id, stage: row.stage }, data });

  return {
    ...row,
    stage: derived,
    ...(data.closedAt ? { closedAt: data.closedAt } : {}),
    ...(data.cancelledAt ? { cancelledAt: data.cancelledAt } : {}),
  };
}
