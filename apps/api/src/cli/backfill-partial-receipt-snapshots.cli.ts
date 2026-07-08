/**
 * Backfill — repair partial-payment snapshot columns on receipts
 * (paymentStatus / installmentPartialSeq / remainingAmount).
 *
 * WHY
 * ---
 * Until 2026-07-08 the issuance snapshot counted EVERY non-voided receipt of
 * the installment into the partial sequence — including CREDIT_NOTE and
 * RESCHEDULE_FEE documents that share the same contractId+installmentNo.
 * Two corruptions resulted:
 *   1. Fee/CN-type receipts got stamped PARTIAL + a seq of their own.
 *   2. Installment-money receipts issued after a void (CNs present) or after
 *      a reschedule fee got wrong seq and wrong remainingAmount (e.g.
 *      remaining=0 on a genuinely-partial 1,000฿ receipt because two 8,925฿
 *      credit notes were summed into the cumulative).
 * The writer now filters to INSTALLMENT_MONEY_RECEIPT_TYPES; this CLI repairs
 * rows written before that fix so re-generated PDFs show the correct
 * "ชำระบางส่วน — สะสมงวดนี้ X จากยอดงวด Y" numbers.
 *
 * WHAT IT DOES
 * ------------
 * 1. Non-installment receipts (CN / RESCHEDULE_FEE / EARLY_PAYOFF / …) that
 *    carry partial fields → reset to the writer's default:
 *    paymentStatus='PAID', installmentPartialSeq=null, remainingAmount=null.
 * 2. INSTALLMENT/'PAYMENT' receipts with paymentId+installmentNo → recompute
 *    seq/remaining/status from installment-money receipts only, ordered by
 *    createdAt. "Voided at issuance time" is reconstructed from
 *    voidApprovedAt (a sibling voided AFTER this receipt was issued still
 *    counts toward its cumulative, exactly as the writer saw it).
 *
 * GUARDS (same shape as backfill-orphan-partial-receipts.cli)
 * -----------------------------------------------------------
 * - EXPECTED_DB_NAME required; SELECT current_database() must match → exit 1
 * - DRY-RUN by default: prints what would change, writes nothing, exit 0.
 * - CONFIRM_BACKFILL=YES_I_AM_SURE → actually updates.
 * - NODE_ENV=production also requires ALLOW_PROD_BACKFILL=YES_I_AM_SURE.
 *
 * INVOCATION
 * ----------
 *   Dry-run:  EXPECTED_DB_NAME=<db> npm --prefix apps/api run backfill:receipt-snapshots
 *   Live:     CONFIRM_BACKFILL=YES_I_AM_SURE EXPECTED_DB_NAME=<db> \
 *             [ALLOW_PROD_BACKFILL=YES_I_AM_SURE NODE_ENV=production] \
 *             npm --prefix apps/api run backfill:receipt-snapshots
 */

import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { INSTALLMENT_MONEY_RECEIPT_TYPES } from '../modules/receipts/receipt-types.constants';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

export interface SnapshotRow {
  id: string;
  receiptNumber: string;
  amount: Prisma.Decimal | string | number;
  createdAt: Date;
  isVoided: boolean;
  voidApprovedAt: Date | null;
  paymentStatus: string;
  installmentPartialSeq: number | null;
  remainingAmount: Prisma.Decimal | string | number | null;
}

export interface SnapshotFix {
  id: string;
  receiptNumber: string;
  paymentStatus: string;
  installmentPartialSeq: number | null;
  remainingAmount: Prisma.Decimal;
}

const dec = (v: Prisma.Decimal | string | number | null | undefined) =>
  new Prisma.Decimal((v ?? 0).toString());

/**
 * Pure recompute for one installment's money-receipts (already filtered to
 * INSTALLMENT_MONEY_RECEIPT_TYPES, ordered by createdAt ASC). Returns only
 * the rows whose stored snapshot differs from the recomputed one.
 */
export function recomputeInstallmentSnapshots(
  receipts: SnapshotRow[],
  amountDue: Prisma.Decimal | string | number,
): SnapshotFix[] {
  const due = dec(amountDue);
  const fixes: SnapshotFix[] = [];
  for (const r of receipts) {
    // Priors as the writer saw them at issuance: created earlier AND not yet
    // voided at that moment (voided later still counted then).
    const priors = receipts.filter(
      (p) =>
        p.createdAt < r.createdAt &&
        (!p.isVoided || (p.voidApprovedAt != null && p.voidApprovedAt > r.createdAt)),
    );
    const cumulative = priors.reduce((acc, p) => acc.plus(dec(p.amount)), dec(r.amount));
    const paymentStatus = cumulative.gte(due) ? 'PAID' : 'PARTIAL';
    const installmentPartialSeq = paymentStatus === 'PARTIAL' ? priors.length + 1 : null;
    const remainder = due.minus(cumulative);
    const remainingAmount = remainder.gt(0) ? remainder : new Prisma.Decimal(0);

    const changed =
      r.paymentStatus !== paymentStatus ||
      (r.installmentPartialSeq ?? null) !== installmentPartialSeq ||
      !dec(r.remainingAmount).equals(remainingAmount);
    if (changed) {
      fixes.push({ id: r.id, receiptNumber: r.receiptNumber, paymentStatus, installmentPartialSeq, remainingAmount });
    }
  }
  return fixes;
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const expected = process.env.EXPECTED_DB_NAME;
  if (!expected) {
    console.error('[backfill-receipt-snapshots] EXPECTED_DB_NAME is required'); // eslint-disable-line no-console
    process.exit(1);
  }
  const [{ current_database: actual }] = await prisma.$queryRaw<
    Array<{ current_database: string }>
  >`SELECT current_database()`;
  if (actual !== expected) {
    console.error(`[backfill-receipt-snapshots] DB mismatch: expected "${expected}", connected to "${actual}"`); // eslint-disable-line no-console
    process.exit(1);
  }
  const live = process.env.CONFIRM_BACKFILL === REQUIRED_CONSENT;
  if (process.env.NODE_ENV === 'production' && live && process.env.ALLOW_PROD_BACKFILL !== REQUIRED_CONSENT) {
    console.error('[backfill-receipt-snapshots] production requires ALLOW_PROD_BACKFILL=YES_I_AM_SURE'); // eslint-disable-line no-console
    process.exit(1);
  }
  const log = (m: string) => console.log(m); // eslint-disable-line no-console
  log(`[backfill-receipt-snapshots] DB: "${actual}" | mode: ${live ? 'LIVE' : 'DRY-RUN'}`);

  const moneyTypes = [...INSTALLMENT_MONEY_RECEIPT_TYPES];

  // ── Pass 1: strip partial snapshots off non-installment documents ────────
  const polluted = await prisma.receipt.findMany({
    where: {
      deletedAt: null,
      receiptType: { notIn: moneyTypes },
      OR: [{ paymentStatus: 'PARTIAL' }, { installmentPartialSeq: { not: null } }, { remainingAmount: { not: null } }],
    },
    select: { id: true, receiptNumber: true, receiptType: true },
  });
  for (const r of polluted) {
    log(`  reset ${r.receiptNumber} (${r.receiptType}) → PAID/seq=null/remaining=null`);
  }
  if (live && polluted.length > 0) {
    await prisma.receipt.updateMany({
      where: { id: { in: polluted.map((r) => r.id) } },
      data: { paymentStatus: 'PAID', installmentPartialSeq: null, remainingAmount: null },
    });
  }

  // ── Pass 2: recompute installment-money receipts per payment ─────────────
  const rows = await prisma.receipt.findMany({
    where: {
      deletedAt: null,
      paymentId: { not: null },
      installmentNo: { not: null },
      receiptType: { in: moneyTypes },
    },
    select: {
      id: true,
      receiptNumber: true,
      paymentId: true,
      amount: true,
      createdAt: true,
      isVoided: true,
      voidApprovedAt: true,
      paymentStatus: true,
      installmentPartialSeq: true,
      remainingAmount: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const byPayment = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byPayment.get(r.paymentId as string) ?? [];
    list.push(r);
    byPayment.set(r.paymentId as string, list);
  }
  const paymentIds = [...byPayment.keys()];
  const payments = await prisma.payment.findMany({
    where: { id: { in: paymentIds } },
    select: { id: true, amountDue: true },
  });
  const dueById = new Map(payments.map((p) => [p.id, p.amountDue]));

  let recomputed = 0;
  for (const [paymentId, group] of byPayment) {
    const due = dueById.get(paymentId);
    if (due == null) continue; // payment row hard-deleted — nothing to anchor on
    const fixes = recomputeInstallmentSnapshots(group as unknown as SnapshotRow[], due);
    for (const f of fixes) {
      log(`  fix ${f.receiptNumber} → status=${f.paymentStatus} seq=${f.installmentPartialSeq ?? 'null'} remaining=${f.remainingAmount.toFixed(2)}`);
      if (live) {
        await prisma.receipt.update({
          where: { id: f.id },
          data: {
            paymentStatus: f.paymentStatus,
            installmentPartialSeq: f.installmentPartialSeq,
            remainingAmount: f.remainingAmount,
          },
        });
      }
      recomputed++;
    }
  }

  log(`[backfill-receipt-snapshots] ===== SUMMARY =====`);
  log(`  non-installment resets : ${polluted.length}`);
  log(`  recomputed snapshots   : ${recomputed}`);
  log(live ? '  applied.' : '  DRY-RUN — nothing written. Re-run with CONFIRM_BACKFILL=YES_I_AM_SURE to apply.');
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e); // eslint-disable-line no-console
    process.exit(1);
  });
}
