/**
 * Backfill Receipt DOCUMENTS for PAID payments that have none.
 *
 * WHY
 * ---
 * recordPayment auto-generates a Receipt row (ReceiptsService.generateReceipt),
 * and (after fix f2518b4c) so does early-payoff. But payments recorded BEFORE
 * those paths existed — or any PAID Payment whose generateReceipt failed (it is
 * wrapped in a try-catch that logs + swallows so it never blocks the payment) —
 * have NO Receipt row, so they never appear in the ใบเสร็จ tab (/payments?tab=receipts).
 *
 * This CLI finds PAID payments with money received and ZERO receipts, and issues
 * a catch-up INSTALLMENT receipt via the SAME proven generateReceipt primitive
 * (own tx + FOR-UPDATE receipt-number lock). lineOaService is intentionally
 * undefined → no LINE push of old receipts to customers.
 *
 * GUARDS
 * ------
 * - EXPECTED_DB_NAME required; SELECT current_database() must match → exit 1
 * - DRY-RUN by default: lists candidates + totals, creates NOTHING, exit 0.
 * - CONFIRM_BACKFILL=YES_I_AM_SURE → actually creates receipts.
 * - NODE_ENV=production also requires ALLOW_PROD_BACKFILL=YES_I_AM_SURE.
 * - Idempotent: population query excludes any payment that already has a receipt,
 *   so re-running is safe. One payment's failure does NOT abort the rest.
 *
 * PRODUCTION INVOCATION
 * ---------------------
 *   Dry-run:  EXPECTED_DB_NAME=bestchoice_prod npm --prefix apps/api run backfill:receipts
 *   Live:     CONFIRM_BACKFILL=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice_prod \
 *             ALLOW_PROD_BACKFILL=YES_I_AM_SURE NODE_ENV=production \
 *             npm --prefix apps/api run backfill:receipts
 */

import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { ReceiptIssuanceService } from '../modules/receipts/services/receipt-issuance.service';
import { ReceiptNumberService } from '../modules/receipts/services/receipt-number.service';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

interface PaidPaymentRow {
  id: string;
  contract_id: string;
  installment_no: number;
  amount_paid: string;
  payment_method: string | null;
  gateway_ref: string | null;
  recorded_by_id: string | null;
  contract_number: string;
  paid_date: Date | null;
}

/** PAID payments with money received and NO receipt row at all (voided or not). */
async function findPaidPaymentsWithoutReceipt(prisma: PrismaService): Promise<PaidPaymentRow[]> {
  return prisma.$queryRaw<PaidPaymentRow[]>`
    SELECT p.id, p.contract_id, p.installment_no,
           p.amount_paid::text AS amount_paid,
           p.payment_method, p.gateway_ref, p.recorded_by_id,
           p.paid_date,
           c.contract_number
    FROM payments p
    JOIN contracts c ON c.id = p.contract_id
    WHERE p.deleted_at IS NULL
      AND p.status = 'PAID'
      AND p.amount_paid > 0
      AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.payment_id = p.id)
    ORDER BY c.contract_number, p.installment_no
  `;
}

export interface BackfillReceiptsResult {
  candidates: number;
  created: number;
  skipped: number;
  failed: number;
  totalAmount: Decimal;
}

export async function backfillPaymentReceipts(
  prisma: PrismaService,
  issuance: ReceiptIssuanceService,
  opts: { dryRun: boolean; fallbackIssuerId: string | null },
): Promise<BackfillReceiptsResult> {
  const rows = await findPaidPaymentsWithoutReceipt(prisma);
  const result: BackfillReceiptsResult = {
    candidates: rows.length,
    created: 0,
    skipped: 0,
    failed: 0,
    totalAmount: new Decimal(0),
  };

  for (const p of rows) {
    const amt = new Decimal(p.amount_paid);
    result.totalAmount = result.totalAmount.plus(amt);

    if (opts.dryRun) {
      console.log(
        `  paymentId=${p.id}  contract=${p.contract_number}  งวด=${p.installment_no}` +
          `  amountPaid=฿${amt.toFixed(2)}  method=${p.payment_method ?? '-'}`,
      );
      continue;
    }

    // generateReceipt needs a valid issuedById (FK → User). Prefer the original
    // recorder; fall back to a system user when the payment has none.
    const issuedById = p.recorded_by_id ?? opts.fallbackIssuerId;
    if (!issuedById) {
      console.warn(`[backfill-receipts] SKIP paymentId=${p.id} — no recorder + no fallback issuer`);
      result.skipped += 1;
      continue;
    }

    try {
      // generateReceipt manages its own $transaction + receipt-number lock.
      await issuance.generateReceipt(
        p.contract_id,
        p.id,
        'INSTALLMENT',
        amt.toNumber(),
        p.installment_no,
        p.payment_method,
        p.gateway_ref ?? null,
        issuedById,
        p.paid_date ?? undefined, // ใบเสร็จ backfill ลงวันที่เงินเข้าเดิม ไม่ใช่วันรัน CLI
      );
      await prisma.auditLog.create({
        data: {
          userId: issuedById,
          action: 'PAYMENT_RECEIPT_BACKFILLED',
          entity: 'payment',
          entityId: p.id,
          newValue: {
            contractId: p.contract_id,
            installmentNo: p.installment_no,
            amount: amt.toFixed(2),
          },
        },
      });
      result.created += 1;
      console.log(
        `[backfill-receipts] CREATED paymentId=${p.id} contract=${p.contract_number}` +
          ` งวด=${p.installment_no} ฿${amt.toFixed(2)}`,
      );
    } catch (err) {
      result.failed += 1;
      console.error(
        `[backfill-receipts] FAILED paymentId=${p.id} contract=${p.contract_number}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return result;
}

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: EXPECTED_DB_NAME required');
    console.error('Re-run with: EXPECTED_DB_NAME=<db-name> npm --prefix apps/api run backfill:receipts');
    process.exit(1);
  }

  const dryRun = process.env.CONFIRM_BACKFILL !== REQUIRED_CONSENT;
  if (dryRun) {
    console.log('[backfill-receipts] DRY-RUN mode (default). To create receipts, re-run with:');
    console.log(`  CONFIRM_BACKFILL=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db> [ALLOW_PROD_BACKFILL=${REQUIRED_CONSENT}] npm --prefix apps/api run backfill:receipts`);
    console.log('');
  }

  if (!dryRun && process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_BACKFILL !== REQUIRED_CONSENT) {
    console.error(`ERROR: Refusing to backfill in NODE_ENV=production without ALLOW_PROD_BACKFILL=${REQUIRED_CONSENT}`);
    process.exit(1);
  }

  const prisma = new PrismaService();
  const [{ current_database: actualDb }] = await (prisma as any).$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`ERROR: DB mismatch: connected="${actualDb}" expected="${expectedDb}". Aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[backfill-receipts] DB: "${actualDb}" | mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);

  try {
    // lineOaService undefined → no LINE push of historical receipts.
    const issuance = new ReceiptIssuanceService(prisma, undefined, new ReceiptNumberService(prisma));

    // Fallback issuer for payments with no recorded_by_id.
    const fallback = await prisma.user.findFirst({
      where: { email: 'admin@bestchoice.com', deletedAt: null },
      select: { id: true },
    });

    console.log('[backfill-receipts] Scanning PAID payments (amountPaid>0) with no receipt...');
    console.log('');
    const result = await backfillPaymentReceipts(prisma, issuance, {
      dryRun,
      fallbackIssuerId: fallback?.id ?? null,
    });

    console.log('');
    console.log('[backfill-receipts] ===== SUMMARY =====');
    console.log(`  candidates                : ${result.candidates}`);
    if (!dryRun) {
      console.log(`  created                   : ${result.created}`);
      console.log(`  skipped (no issuer)       : ${result.skipped}`);
      console.log(`  failed                    : ${result.failed}`);
    }
    console.log(`  total ฿ amount            : ฿${result.totalAmount.toFixed(2)}`);
    console.log('');

    if (dryRun) {
      console.log('[backfill-receipts] DRY-RUN complete — nothing created. Re-run with CONFIRM_BACKFILL=YES_I_AM_SURE to write.');
    } else if (result.failed > 0) {
      console.error(`[backfill-receipts] WARNING: ${result.failed} failed — check logs above.`);
      process.exit(1);
    } else {
      console.log('[backfill-receipts] Done.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[backfill-receipts] FATAL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
