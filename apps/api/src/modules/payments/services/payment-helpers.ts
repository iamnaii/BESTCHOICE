import {
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    select: { productId: true },
  });

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
