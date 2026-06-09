/**
 * PR-843/I2 deploy gate ② — catch-up receipt JEs for orphan partial payments.
 *
 * WHY
 * ---
 * The new `PaymentReceiptTemplate.reconstructPrior` counts prior receipt JEs to
 * avoid double-crediting 11-2103. PARTIALLY_PAID installments left by the OLD
 * autoAllocate/applyCreditBalance (which posted NO JE on partials) have NO
 * receipt JE → after deploy, completing them would over-credit 11-2103
 * (reconstructPrior returns 0 and thinks the full installmentTotal is still
 * open, so Cr 11-2103 would equal installmentTotal again). This CLI finds those
 * "orphan partials" and posts a catch-up receipt JE:
 *
 *   Dr depositAccountCode (or 11-1202)  amountPaid   (already-received cash)
 *   Cr 11-2103                          amountPaid   (clear accrued receivable)
 *   tag:'receipt'  metadata.paymentId   paymentId
 *
 * After running this CLI, reconstructPrior counts the catch-up JE, so the
 * subsequent completion only clears the REMAINDER → Σ(Cr 11-2103) == installmentTotal.
 *
 * NOTE ON LATE-FEE BOOKING
 * ------------------------
 * We book the entire amountPaid to 11-2103 (principal clearing), NOT splitting
 * late fee → 42-1103, for the following reason: splitting the historical amountPaid
 * into principal + late-fee proportions for OLD payments would require inferring
 * what portion was "late fee" vs "principal" from records that never captured it.
 * Booking all to 11-2103 is conservative (no income over-recognition). The owner
 * deferred any retrospective late-fee split to a future accounting correction.
 *
 * GUARDS
 * ------
 * - EXPECTED_DB_NAME required; SELECT current_database() must match → exit 1
 * - DRY-RUN by default: lists population + amounts, posts NOTHING, exit 0.
 *   Doubles as the Risk-5 inspection tool.
 * - CONFIRM_BACKFILL=YES_I_AM_SURE → actually posts JEs.
 * - NODE_ENV=production also requires ALLOW_PROD_BACKFILL=YES_I_AM_SURE.
 * - Per-payment $transaction; one payment's failure does NOT abort the rest.
 * - Idempotent: re-checks inside tx that the payment still has NO receipt JE.
 *
 * PRODUCTION INVOCATION
 * ---------------------
 * Step 1 — Dry-run (Risk-5 inspection):
 *   EXPECTED_DB_NAME=bestchoice_prod npm --prefix apps/api run backfill:orphan-receipts
 *
 * Step 2 — Live:
 *   CONFIRM_BACKFILL=YES_I_AM_SURE \
 *   EXPECTED_DB_NAME=bestchoice_prod \
 *   ALLOW_PROD_BACKFILL=YES_I_AM_SURE \
 *   NODE_ENV=production \
 *   npm --prefix apps/api run backfill:orphan-receipts
 *
 * Cloud Run Job (prod):
 *   gcloud run jobs execute backfill-orphan-receipts \
 *     --region=asia-southeast1 --project=bestchoice-prod \
 *     --update-env-vars=CONFIRM_BACKFILL=YES_I_AM_SURE,EXPECTED_DB_NAME=bestchoice_prod,ALLOW_PROD_BACKFILL=YES_I_AM_SURE,NODE_ENV=production \
 *     --wait
 */

import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { JournalAutoService } from '../modules/journal/journal-auto.service';
import { PaymentReceiptTemplate } from '../modules/journal/cpa-templates/payment-receipt.template';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

// ---------------------------------------------------------------------------
// Population query — raw SQL to match the runbook Risk-5 query exactly
// ---------------------------------------------------------------------------

interface OrphanPartialRow {
  id: string;
  contract_id: string;
  installment_no: number;
  amount_paid: string;
  deposit_account_code: string | null;
  contract_number: string;
}

async function findOrphanPartials(prisma: PrismaService): Promise<OrphanPartialRow[]> {
  return prisma.$queryRaw<OrphanPartialRow[]>`
    SELECT p.id, p.contract_id, p.installment_no,
           p.amount_paid::text AS amount_paid,
           p.deposit_account_code,
           c.contract_number
    FROM payments p
    JOIN contracts c ON c.id = p.contract_id
    WHERE p.deleted_at IS NULL
      AND p.status = 'PARTIALLY_PAID'
      AND p.amount_paid > 0
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE (je.reference_id = p.id::text OR je.metadata->>'paymentId' = p.id::text)
          AND je.metadata->>'tag' IN ('receipt', '2B', 'credit-allocation')
          AND je.deleted_at IS NULL
          AND je.status = 'POSTED'
      )
    ORDER BY c.contract_number, p.installment_no
  `;
}

// ---------------------------------------------------------------------------
// Core backfill function — exported for tests
// ---------------------------------------------------------------------------

export interface BackfillOrphanResult {
  candidates: number;
  backfilled: number;
  skipped: number; // no installment_schedule found for the payment
  failed: number;
  totalAmount: Decimal;
}

export async function backfillOrphanPartialReceipts(
  prisma: PrismaService,
  opts: { dryRun: boolean },
): Promise<BackfillOrphanResult> {
  const orphans = await findOrphanPartials(prisma);

  const result: BackfillOrphanResult = {
    candidates: orphans.length,
    backfilled: 0,
    skipped: 0,
    failed: 0,
    totalAmount: new Decimal(0),
  };

  if (orphans.length === 0) {
    return result;
  }

  // DRY-RUN: report only, post nothing
  if (opts.dryRun) {
    for (const p of orphans) {
      const amt = new Decimal(p.amount_paid);
      result.totalAmount = result.totalAmount.plus(amt);
      console.log(
        `  paymentId=${p.id}  contract=${p.contract_number}  installmentNo=${p.installment_no}` +
          `  amountPaid=฿${amt.toFixed(2)}  depositAccount=${p.deposit_account_code ?? '(fallback 11-1202)'}`,
      );
    }
    return result;
  }

  // LIVE: construct the primitive once
  const journal = new JournalAutoService(prisma as any);
  const template = new PaymentReceiptTemplate(journal, prisma as any);

  // Resolve system userId for audit logs (same pattern as JournalAutoService)
  const systemUser = await prisma.user.findFirst({
    where: { email: 'admin@bestchoice.com', deletedAt: null },
    select: { id: true },
  });
  if (!systemUser) {
    throw new Error('System user admin@bestchoice.com not found — needed for AuditLog.userId FK');
  }
  const systemUserId = systemUser.id;

  for (const p of orphans) {
    const amountPaid = new Decimal(p.amount_paid);
    result.totalAmount = result.totalAmount.plus(amountPaid);

    // Resolve installmentSchedule from contractId + installmentNo
    const instSched = await prisma.installmentSchedule.findFirst({
      where: {
        contractId: p.contract_id,
        installmentNo: p.installment_no,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!instSched) {
      console.warn(
        `[backfill-orphan-receipts] SKIP paymentId=${p.id} — no installment_schedule found` +
          ` for contractId=${p.contract_id} installmentNo=${p.installment_no}`,
      );
      result.skipped += 1;
      continue;
    }

    try {
      await (prisma as any).$transaction(async (tx: any) => {
        // Idempotency re-check inside tx: if a receipt JE was posted after our
        // initial population query (e.g. concurrent run), skip this payment.
        const existing = await tx.journalEntry.findFirst({
          where: {
            AND: [
              {
                OR: [
                  { referenceId: p.id },
                  { metadata: { path: ['paymentId'], equals: p.id } } as any,
                ],
              },
              {
                OR: [
                  { metadata: { path: ['tag'], equals: 'receipt' } } as any,
                  { metadata: { path: ['tag'], equals: '2B' } } as any,
                  { metadata: { path: ['tag'], equals: 'credit-allocation' } } as any,
                ],
              },
            ],
            deletedAt: null,
            status: 'POSTED',
          },
          select: { id: true },
        });
        if (existing) {
          console.log(
            `[backfill-orphan-receipts] IDEMPOTENT SKIP paymentId=${p.id} — receipt JE already exists`,
          );
          // Count as skipped (not failed) — idempotent no-op
          result.skipped += 1;
          return;
        }

        await template.execute(
          {
            installmentScheduleId: instSched.id,
            // Book the already-received cash as the principal clearing.
            // Late fee is booked as 0 (conservative — no income over-recognition).
            // See NOTE ON LATE-FEE BOOKING in the file header.
            delta: amountPaid,
            debitAccountCode: p.deposit_account_code ?? '11-1202',
            isFinalReceipt: false, // it's a historical partial — no underpay-close
            paymentId: p.id,
          },
          tx,
        );

        // Audit trail — one row per backfilled payment
        await tx.auditLog.create({
          data: {
            userId: systemUserId,
            action: 'ORPHAN_PARTIAL_RECEIPT_BACKFILLED',
            entity: 'payment',
            entityId: p.id,
            newValue: {
              amountPaid: amountPaid.toFixed(2),
              installmentScheduleId: instSched.id,
              contractId: p.contract_id,
              installmentNo: p.installment_no,
              depositAccountCode: p.deposit_account_code ?? '11-1202',
            },
          },
        });

        result.backfilled += 1;
        console.log(
          `[backfill-orphan-receipts] POSTED paymentId=${p.id}` +
            ` contract=${p.contract_number} installmentNo=${p.installment_no}` +
            ` amountPaid=฿${amountPaid.toFixed(2)}`,
        );
      });
    } catch (err) {
      result.failed += 1;
      console.error(
        `[backfill-orphan-receipts] FAILED paymentId=${p.id}` +
          ` contract=${p.contract_number} installmentNo=${p.installment_no}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Thin CLI main() — only runs when executed directly
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Guard 1: EXPECTED_DB_NAME required
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: EXPECTED_DB_NAME required');
    console.error('');
    console.error('Re-run with: EXPECTED_DB_NAME=<db-name> npm --prefix apps/api run backfill:orphan-receipts');
    process.exit(1);
  }

  // Dry-run by default; only post when CONFIRM_BACKFILL=YES_I_AM_SURE
  const dryRun = process.env.CONFIRM_BACKFILL !== REQUIRED_CONSENT;

  if (dryRun) {
    console.log('[backfill-orphan-receipts] DRY-RUN mode (default).');
    console.log('[backfill-orphan-receipts] To post JEs, re-run with:');
    console.log(`  CONFIRM_BACKFILL=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db> [ALLOW_PROD_BACKFILL=${REQUIRED_CONSENT}] npm --prefix apps/api run backfill:orphan-receipts`);
    console.log('');
  }

  // Guard 2: NODE_ENV=production requires ALLOW_PROD_BACKFILL
  if (!dryRun && process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_BACKFILL !== REQUIRED_CONSENT) {
    console.error(`ERROR: Refusing to backfill in NODE_ENV=production without ALLOW_PROD_BACKFILL=${REQUIRED_CONSENT}`);
    console.error(`Re-run with: CONFIRM_BACKFILL=${REQUIRED_CONSENT} ALLOW_PROD_BACKFILL=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db> NODE_ENV=production npm --prefix apps/api run backfill:orphan-receipts`);
    process.exit(1);
  }

  // Guard 3: DB name must match current_database()
  const prisma = new PrismaService();
  const [{ current_database: actualDb }] = await (prisma as any).$queryRaw<
    { current_database: string }[]
  >`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`ERROR: DB mismatch: connected="${actualDb}" expected="${expectedDb}". Aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[backfill-orphan-receipts] DB: "${actualDb}" | mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);

  try {
    console.log('[backfill-orphan-receipts] Scanning for orphan PARTIALLY_PAID payments with no receipt JE...');
    console.log('');

    const result = await backfillOrphanPartialReceipts(prisma, { dryRun });

    console.log('');
    console.log('[backfill-orphan-receipts] ===== SUMMARY =====');
    console.log(`  candidates (orphan partials)  : ${result.candidates}`);
    if (dryRun) {
      console.log(`  would-backfill               : ${result.candidates}`);
    } else {
      console.log(`  backfilled                   : ${result.backfilled}`);
      console.log(`  skipped (no schedule found)  : ${result.skipped}`);
      console.log(`  failed                       : ${result.failed}`);
    }
    console.log(`  total ฿ amount               : ฿${result.totalAmount.toFixed(2)}`);
    console.log('');

    if (dryRun) {
      console.log('[backfill-orphan-receipts] DRY-RUN complete — no JEs posted.');
      console.log('[backfill-orphan-receipts] Review the list above (Risk-5 inspection).');
      console.log('[backfill-orphan-receipts] When ready to post, run with CONFIRM_BACKFILL=YES_I_AM_SURE.');
    } else {
      console.log('[backfill-orphan-receipts] Done.');
      if (result.failed > 0) {
        console.error(`[backfill-orphan-receipts] WARNING: ${result.failed} payment(s) failed — check logs above.`);
        process.exit(1);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[backfill-orphan-receipts] FATAL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
