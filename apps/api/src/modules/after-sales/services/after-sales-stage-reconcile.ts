import { hashLockKey } from '../../../utils/advisory-lock.util';
import { ForbiddenException } from '@nestjs/common';
import {
  currentDomainAccess,
  isCurrentDomainClient,
} from '../../employee-access/access-execution-context';
import {
  assertAfterSalesDerivedFacts,
  AfterSalesSourceFacts,
} from '../../employee-access/access-after-sales-source.service';
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
 * still returns the freshly-derived stage. Managed maintenance requires current linked
 * source facts and writes atomic derived-event evidence attributed to the real initiator;
 * audit failure rolls back the CAS. Unmanaged compatibility retains the original behavior.
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

/** select ที่ตรงกับ `ReconcilableCase` เป๊ะ — ใช้ร่วมกันทุกที่ที่โหลดแถวมาเพื่อ reconcile อย่างเดียว */
export const RECONCILE_SELECT = {
  id: true,
  stage: true,
  outcome: true,
  cancelledAt: true,
  closedAt: true,
  replacementContractId: true,
  repairTicket: { select: { status: true, deletedAt: true, returnedToCustomerAt: true } },
  exchangeRequest: {
    select: {
      status: true,
      mode: true,
      memoAppliedAt: true,
      rejectionReason: true,
      cancelReason: true,
      newContract: { select: { status: true } },
    },
  },
} satisfies Prisma.AfterSalesCaseSelect;

const DEFAULT_EXCHANGE_CANCEL_REASON = 'คำขอเปลี่ยนเครื่องถูกยกเลิก';

export async function reconcileStage<T extends ReconcilableCase>(
  client: ReconcileClient,
  row: T,
  facts?: AfterSalesSourceFacts,
): Promise<T> {
  const execution = currentDomainAccess();
  if (execution) {
    if (!isCurrentDomainClient(client))
      throw new ForbiddenException('ธุรกรรมไม่ตรงกับสิทธิ์ปัจจุบัน');
    assertAfterSalesDerivedFacts(facts, row.id);
    const persisted = await client.afterSalesCase.findUniqueOrThrow({
      where: { id: row.id },
      select: {
        ...RECONCILE_SELECT,
        branchId: true,
        customerId: true,
        saleId: true,
        replacementSaleId: true,
        replacementProductId: true,
        repairTicketId: true,
        exchangeRequestId: true,
        productId: true,
        contractId: true,
      },
    });
    if (
      persisted.branchId !== facts!.row.branchId ||
      persisted.customerId !== facts!.row.customerId ||
      persisted.saleId !== facts!.row.saleId ||
      persisted.replacementSaleId !== facts!.row.replacementSaleId ||
      persisted.replacementProductId !== facts!.row.replacementProductId ||
      persisted.repairTicketId !== facts!.row.repairTicketId ||
      persisted.exchangeRequestId !== facts!.row.exchangeRequestId ||
      persisted.productId !== facts!.row.productId ||
      persisted.contractId !== facts!.row.contractId ||
      persisted.replacementContractId !== facts!.row.replacementContractId
    )
      throw new ForbiddenException('แหล่งเคสเปลี่ยนแปลง กรุณาตรวจใหม่');
    // Derive from persisted current child state, never from a caller-provided status.
    row = { ...row, ...persisted };
  }
  const derived = classifyAfterSalesStage(row);

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
  const changed = await client.afterSalesCase.updateMany({
    where: { id: row.id, stage: row.stage },
    data,
  });
  if (execution && changed.count) {
    await client.auditLog.create({
      data: {
        userId: execution.snapshot.userId,
        action: 'AFTER_SALES_STAGE_RECONCILED',
        entity: 'after_sales_case',
        entityId: row.id,
        oldValue: { stage: row.stage },
        newValue: {
          stage: derived,
          derived: true,
          initiatorId: execution.snapshot.userId,
          repairTicketId: facts!.row.repairTicketId,
          exchangeRequestId: facts!.row.exchangeRequestId,
          replacementContractId: facts!.row.replacementContractId,
        },
      },
    });
  }

  return {
    ...row,
    stage: derived,
    ...(data.closedAt ? { closedAt: data.closedAt } : {}),
    ...(data.cancelledAt ? { cancelledAt: data.cancelledAt } : {}),
    ...(data.cancelReason ? { cancelReason: data.cancelReason } : {}),
  };
}

/** Pure canonical classification. It grants no detail or mutation authority. */
export function classifyAfterSalesStage(row: ReconcilableCase) {
  return deriveStage({
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
}

/** Global IMEI exclusion is deliberately boolean-only and read-only, including foreign cases.
 * Consumers must still recheck under this same advisory lock before actual intake writes. */
export async function hasGlobalOpenAfterSalesCase(
  client: ReconcileClient,
  imei: string,
): Promise<boolean> {
  if (!isCurrentDomainClient(client)) throw new ForbiddenException('ต้องใช้ธุรกรรมปัจจุบัน');
  await client.$executeRaw`SELECT pg_advisory_xact_lock(${hashLockKey(`as-imei:${imei}`)})`;
  let cursor: string | undefined;
  for (;;) {
    const batch = await client.afterSalesCase.findMany({
      where: { deviceImei: imei, deletedAt: null },
      select: RECONCILE_SELECT,
      orderBy: { id: 'asc' },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.some((row) => !['CLOSED', 'CANCELLED'].includes(classifyAfterSalesStage(row))))
      return true;
    if (batch.length < 100) return false;
    cursor = batch[batch.length - 1].id;
  }
}
