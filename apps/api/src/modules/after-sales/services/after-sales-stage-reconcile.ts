import type {
  AfterSalesOutcome,
  AfterSalesStage,
  ExchangeMode,
  ExchangeRequestStatus,
  Prisma,
  RepairStatus,
} from '@prisma/client';
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
 *
 * PR 2 — stage รุ่นสอง อ่านทางออกเปลี่ยนเครื่องทั้งสองแบบด้วย: `closedAt` เป็นคอลัมน์จริงที่ผู้เขียน
 * ทางออกเปลี่ยนเครื่อง (SAME_MODEL_EXCHANGE ส่งมอบแล้ว ฯลฯ) อาจตั้งตรง ๆ นอกไฟล์นี้ — ถ้ามีค่าอยู่แล้ว
 * ห้ามเขียนทับด้วย `new Date()` (ผิดเวลาปิดจริง) และ `exchangeRequest` ของ PRICED_EXCHANGE ใช้ตัดสิน
 * MEMO/PRICED + สถานะสัญญาใหม่ รวมถึงสังเคราะห์ `cancelReason` เมื่อคำขอถูกปฏิเสธ/ยกเลิกนอก proxy
 * (AfterSalesCase ไม่มีผู้เขียน cancelReason ของกรณีนี้เอง).
 */
export interface ReconcilableCase {
  id: string;
  stage: AfterSalesStage;
  outcome: AfterSalesOutcome | null;
  cancelledAt: Date | null;
  closedAt: Date | null;
  replacementContractId: string | null;
  repairTicket: {
    status: RepairStatus;
    deletedAt: Date | null;
    returnedToCustomerAt: Date | null;
  } | null;
  exchangeRequest: {
    status: ExchangeRequestStatus;
    mode: ExchangeMode;
    memoAppliedAt: Date | null;
    rejectionReason: string | null;
    cancelReason: string | null;
    newContract: { status: string } | null;
  } | null;
}

type ReconcileClient = Prisma.TransactionClient | PrismaService;

const DEFAULT_EXCHANGE_CANCEL_REASON = 'คำขอเปลี่ยนเครื่องถูกยกเลิก';

export async function reconcileStage<T extends ReconcilableCase>(
  client: ReconcileClient,
  row: T,
): Promise<T> {
  const derived = deriveStage({
    outcome: row.outcome,
    cancelledAt: row.cancelledAt,
    closedAt: row.closedAt,
    repairStatus: row.repairTicket?.status ?? null,
    repairDeleted: !!row.repairTicket?.deletedAt,
    replacementContractId: row.replacementContractId,
    exchange: row.exchangeRequest
      ? {
          status: row.exchangeRequest.status,
          mode: row.exchangeRequest.mode,
          memoAppliedAt: row.exchangeRequest.memoAppliedAt,
          newContractStatus: row.exchangeRequest.newContract?.status ?? null,
        }
      : null,
  });

  if (derived === row.stage) return row;

  const data: Prisma.AfterSalesCaseUpdateManyMutationInput = { stage: derived };
  // R25 (d) — closedAt ที่มีอยู่แล้วบนแถว (ตั้งโดยผู้เขียนทางออกเปลี่ยนเครื่องเอง) คือเวลาปิดจริง
  // ห้ามเขียนทับด้วย new Date(); เขียนเฉพาะตอนที่ยังไม่มีค่าเลย โดยเลือกแหล่งที่ใกล้ "เวลาส่งมอบจริง"
  // ที่สุดก่อนเสมอ (ใบซ่อม → returnedToCustomerAt, MEMO applied → memoAppliedAt) แล้วค่อย fallback ตอนนี้
  if (derived === 'CLOSED' && !row.closedAt) {
    data.closedAt =
      row.repairTicket?.returnedToCustomerAt ?? row.exchangeRequest?.memoAppliedAt ?? new Date();
  }
  if (derived === 'CANCELLED' && !row.cancelledAt) {
    data.cancelledAt = new Date();
    // ทางออก PRICED_EXCHANGE ไม่มีผู้เขียน cancelReason ของ AfterSalesCase เอง (เหตุผลอยู่ที่คำขอ) —
    // สังเคราะห์จากคำขอให้ ณ จุดที่ตรวจพบดริฟท์นี้เป็นครั้งแรก
    if (row.exchangeRequest) {
      data.cancelReason =
        row.exchangeRequest.rejectionReason ??
        row.exchangeRequest.cancelReason ??
        DEFAULT_EXCHANGE_CANCEL_REASON;
    }
  }

  // CAS: only the caller that still sees the stage we read is allowed to write it.
  // count === 0 (lost the race, or another reconcile already ran) is NOT an error —
  // the derived value we hand back is correct either way.
  await client.afterSalesCase.updateMany({ where: { id: row.id, stage: row.stage }, data });

  return {
    ...row,
    stage: derived,
    ...(data.closedAt ? { closedAt: data.closedAt } : {}),
    ...(data.cancelledAt ? { cancelledAt: data.cancelledAt } : {}),
    ...(data.cancelReason ? { cancelReason: data.cancelReason } : {}),
  };
}
