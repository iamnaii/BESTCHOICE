import {
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProductsService } from '../../products/products.service';
import { hasCrossBranchAccess } from '../../auth/branch-access.util';

/**
 * Stateless helpers shared by the decomposed payments sub-services
 * (PaymentReceiptOrchestrator / LateFeeWaiverService / PaymentCsvImportService).
 *
 * Each takes an explicit `db` (a Prisma.TransactionClient when called inside a
 * money $tx, or the PrismaService otherwise) so NO cross-seam method call is
 * ever needed: an orchestrator helper that runs inside its Serializable tx
 * receives `tx`; a fail-fast pre-tx check receives `prisma`. Bodies are moved
 * verbatim from the legacy PaymentsService (only `this.<dep>` → parameter).
 */

type Db = Prisma.TransactionClient | PrismaService;

/**
 * T15: Resolve the cash/bank account code for a payment.
 * Priority: user.defaultCashAccountCode → system default '11-1101'.
 */
export async function resolveUserDefaultCashAccount(
  db: Db,
  userId: string,
): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { defaultCashAccountCode: true },
  });
  return user?.defaultCashAccountCode ?? '11-1101';
}

/**
 * F-3-027 part 2/3: Resolve FINANCE companyId for HP installment journal entries.
 * Payments on installment contracts post to FINANCE-side accounts (HP Receivable,
 * Interest Income, VAT Output) — must be passed explicitly to JournalAutoService
 * instead of relying on the non-deterministic resolveCompanyId fallback.
 * Hoisted out of the per-installment loop so autoAllocate / applyCreditBalance
 * resolve it once per call rather than once per installment.
 */
export async function resolveFinanceCompanyId(db: Db): Promise<string> {
  const financeCompany = await db.companyInfo.findFirst({
    where: { companyCode: 'FINANCE', deletedAt: null },
    select: { id: true },
  });
  if (!financeCompany) {
    throw new InternalServerErrorException('FINANCE company not configured');
  }
  return financeCompany.id;
}

/**
 * Phase A.1b: Resolve SHOP companyId for the SHOP-side commission JE leg.
 * Returns null when SHOP is not configured — JournalAutoService will skip
 * the commission entry rather than fail the payment.
 */
export async function resolveShopCompanyId(db: Db): Promise<string | null> {
  const shop = await db.companyInfo.findFirst({
    where: { companyCode: 'SHOP', deletedAt: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return shop?.id ?? null;
}

/** Enforce branch-level access: SALES/BRANCH_MANAGER can only operate on their own branch */
export async function validateBranchAccess(
  db: Db,
  contractId: string,
  user: { role: string; branchId: string | null },
) {
  if (hasCrossBranchAccess(user)) return;

  const contract = await db.contract.findUnique({
    where: { id: contractId },
    select: { branchId: true, deletedAt: true },
  });
  if (contract && !contract.deletedAt && user.branchId && contract.branchId !== user.branchId) {
    throw new ForbiddenException('ไม่สามารถบันทึกชำระเงินข้ามสาขาได้');
  }
}

/**
 * W1 fix: enforce branch-level access when the caller only knows the
 * paymentId (waive-late-fee + partial-QR endpoints). Looks up the
 * payment's contractId and delegates to validateBranchAccess.
 *
 * Routes guarded by class-level BranchGuard pass only when the request
 * carries `branchId` — these payment-keyed routes don't, so they were
 * silently bypassing the cross-branch check. This helper closes the gap.
 */
export async function validateBranchAccessByPayment(
  db: Db,
  paymentId: string,
  user: { role: string; branchId: string | null },
) {
  if (hasCrossBranchAccess(user)) return;
  // Round 2 W1 fix: collapse the previous 2 queries (payment.findUnique →
  // contract.findUnique) into a single join. Saves a roundtrip on every
  // waive-late-fee + partial-QR call. Inline the branchId check here so
  // we don't re-fetch the contract via validateBranchAccess().
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: {
      deletedAt: true,
      contract: { select: { branchId: true, deletedAt: true } },
    },
  });
  if (!payment || payment.deletedAt) {
    throw new NotFoundException('ไม่พบรายการชำระ');
  }
  const contract = payment.contract;
  if (
    contract &&
    !contract.deletedAt &&
    user.branchId &&
    contract.branchId !== user.branchId
  ) {
    throw new ForbiddenException('ไม่สามารถบันทึกชำระเงินข้ามสาขาได้');
  }
}

/** Todo tag used for "ปิดสัญญาแล้วยังมีเงินพักปรับดิวเหลือ" follow-ups (I-5). */
export const RESIDUAL_PARK_TODO_TAG = 'reschedule-park';

/**
 * I-5: alarm + MEDIUM Todo when a contract completes with a non-zero
 * `rescheduleAdvanceBalance`. Mirrors the credit-note delivery-failure pattern
 * (`credit-note-delivery.service.ts` — Sentry warning + deduped Todo created by
 * the SYSTEM user), which is this codebase's established shape for "money needs
 * a human, do not guess a JE".
 *
 * R-1 (re-review 2026-08-18) — **MUST run on the ROOT PrismaService, never on a
 * money `tx` client, and must never be awaited by the completion path.**
 *
 * The earlier shape took `db = tx ?? prisma` and was awaited, so any failure of
 * the three statements below (FK on `Todo.createdById` if the SYSTEM user row is
 * removed, statement timeout, serialization failure under the Serializable
 * isolation the receipt tx runs at) aborted the customer's payment — "customer
 * paid, system says no". A `try/catch` alone does NOT fix that: once a statement
 * errors inside a Postgres transaction the whole tx is poisoned and cannot
 * commit, so the alarm has to be off the tx connection entirely.
 *
 * Accepted trade-off, deliberately chosen: because this fires before the caller's
 * tx commits, a tx that later rolls back can leave one spurious Todo ("check this
 * contract") which a human closes after seeing the contract is not COMPLETED. The
 * dedup below caps that at one row. Rare, self-evident noise is strictly
 * preferable to the inverse failure (rolling back money the customer really paid).
 *
 * Exported so it can be tested directly — the completion path fires it
 * un-awaited, which is not a seam a test can assert against deterministically.
 */
export async function alarmResidualParkOnCompletion(
  prisma: PrismaService,
  logger: Logger,
  contractId: string,
  completed: { contractNumber: string; rescheduleAdvanceBalance: Prisma.Decimal | null },
): Promise<void> {
  const residual = new Prisma.Decimal(completed.rescheduleAdvanceBalance ?? 0);
  if (!residual.gt(0)) return;

  const amountText = residual.toFixed(2);
  Sentry.captureMessage('Contract completed with residual reschedule park balance', {
    level: 'warning',
    tags: { subsystem: 'reschedule-park' },
    extra: {
      contractId,
      contractNumber: completed.contractNumber,
      rescheduleAdvanceBalance: amountText,
    },
  });

  try {
    const systemUser = await prisma.user.findFirst({
      where: { isSystemUser: true, deletedAt: null },
      select: { id: true },
    });
    if (!systemUser) {
      logger.error(
        `Residual park balance ${amountText} on completed contract ${completed.contractNumber} — no SYSTEM user, Todo skipped (Sentry-alarmed)`,
      );
      return;
    }

    // Dedup: a re-run of checkContractCompletion (or a void → re-pay cycle that
    // completes the contract twice) must not spam a second Todo.
    const existing = await prisma.todo.findFirst({
      where: {
        tags: { has: RESIDUAL_PARK_TODO_TAG },
        title: { contains: completed.contractNumber },
        status: { not: 'DONE' },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing) return;

    await prisma.todo.create({
      data: {
        title: `สัญญา ${completed.contractNumber} ปิดครบงวดแล้ว แต่ยังมีเงินพักปรับดิวเหลือ ${amountText} บาท`,
        description:
          `ยอดพักงวดสุดท้าย (ค่าธรรมเนียมปรับดิว) คงเหลือ ${amountText} บาท ค้างอยู่ในบัญชี 21-1103 ` +
          `หลังสัญญาปิดครบงวด — กรุณาตรวจสอบและดำเนินการคืนเงินลูกค้าหรือปรับปรุงบัญชีตามที่ผู้สอบบัญชีกำหนด ` +
          `(ระบบไม่ตั้งรายการบัญชีอัตโนมัติ เพราะต้องให้ CPA ตัดสินก่อน) · contractId: ${contractId}`,
        priority: 'MEDIUM',
        tags: [RESIDUAL_PARK_TODO_TAG],
        createdById: systemUser.id,
      },
    });
  } catch (err) {
    // Never rethrow — see the R-1 note above. Sentry already carries the residual.
    logger.error(
      `Residual park Todo failed for contract ${completed.contractNumber} (${amountText}): ${String(err)}`,
    );
    Sentry.captureException(err);
  }
}

/**
 * Check if contract is fully paid → mark COMPLETED, bump call-log recording
 * lifecycle, release product ownership. tx-aware: callers inside a money $tx
 * pass `tx` so the ownership flip cannot diverge from the COMPLETED status.
 * It calls `productsService.transferOwnership(productId, null, tx)` with the
 * SAME external-tx so that signature is preserved.
 */
export async function checkContractCompletion(
  prisma: PrismaService,
  productsService: ProductsService,
  logger: Logger,
  contractId: string,
  tx?: Prisma.TransactionClient,
) {
  const db: Prisma.TransactionClient | PrismaService = tx ?? prisma;
  const unpaid = await db.payment.count({
    where: { contractId, status: { not: 'PAID' }, deletedAt: null },
  });

  if (unpaid !== 0) return;

  // All installments paid → mark contract as COMPLETED
  const completed = await db.contract.update({
    where: { id: contractId },
    data: { status: 'COMPLETED' },
    select: { productId: true, contractNumber: true, rescheduleAdvanceBalance: true },
  });

  // I-5 (review 2026-08-16): residual park money on a contract that ran to term.
  // The park bucket (ค่าปรับดิวพักงวดสุดท้าย) is relieved ONLY at the last
  // installment and is capped there at that installment's total — with several
  // reschedules it routinely exceeds one installment, so a contract can complete
  // with real customer money still sitting as a 21-1103 credit. A contract that
  // simply runs to term NEVER touches JP4 (the payoff sweep the spec assumed),
  // so nothing else would ever notice.
  //
  // Deliberately NO automatic refund/income JE here — which of the two it is, is
  // a CPA call, not a code call. Alarm + a MEDIUM Todo so a human resolves it.
  //
  // R-1: fired on the ROOT client (`prisma`, NOT `db`) and NOT awaited, so it can
  // neither poison nor roll back the caller's money tx. See the helper's JSDoc for
  // why try/catch alone would be insufficient and what trade-off this accepts.
  void alarmResidualParkOnCompletion(prisma, logger, contractId, completed);

  // Recording lifecycle: STANDARD → CLOSED so storage cron / GCS lifecycle
  // can transition recordings to a cheaper tier. Only bump rows still on
  // STANDARD to avoid clobbering LEGAL_HOLD set by an open legal case.
  await db.callLog.updateMany({
    where: {
      contractId,
      recordingStorageTier: 'STANDARD',
      recordingUrl: { not: null },
      deletedAt: null,
    },
    data: { recordingStorageTier: 'CLOSED' },
  });

  // Ownership release: FINANCE → null (customer now owns the device).
  // Uses the same tx so the ownership flip cannot diverge from the
  // COMPLETED status. `tx` is a proper Prisma.TransactionClient when
  // called from recordPayment; when called without tx we fall through
  // to this.prisma which the helper also accepts.
  if (completed?.productId) {
    try {
      await productsService.transferOwnership(
        completed.productId,
        null,
        tx,
      );
    } catch (err) {
      logger.error(
        `Failed to release product ownership for completed contract ${contractId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
