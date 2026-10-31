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
 * ⚠️ NEVER FOR IMPORTED LEGACY INSTALLMENTS
 * ----------------------------------------
 * Rows written by the legacy back-office importer (`payments.legacy_installment_code` set) are
 * ALWAYS excluded — their pre-cutover money is booked in PEAK and must not get a tax invoice here
 * (Task 18 review m-2, 2026-10-30). There is no flag to include them. A post-cutover receipt of an
 * imported row that failed to issue is re-issued bound to its journal entry (runbook "ออกใบเสร็จซ้ำ"
 * in `.claude/rules/accounting.md`), not by this CLI.
 *
 * ⚠️ NEVER FOR A PAYMENT WHOSE RECEIPT ENTRY IS LIVE (Task 23 · Task 18 review m-2 part 2)
 * ---------------------------------------------------------------------------------------
 * A PAID row with a live POSTED receipt journal entry bound to it (`metadata.paymentId`, tag
 * `INSTALLMENT_RECEIPT_SOURCE_TAGS`, not `metadata.reversed`) is money whose receipt failed to issue
 * after commit. This CLI's receipt is UNBOUND and its amount is `amount_paid` (which may include advance
 * consumed into the row) — the bound re-issue of the same money later would be a second tax document the
 * `receipts_source_journal_entry_key` index cannot stop, and refunds would pay back by the unbound amount.
 * Such rows are never issued here: they are printed as "bound re-issue" candidates with their entry
 * numbers (+ `receiptTax.amount` — the amount the bound re-issue must pass) for the runbook. That list is
 * per receipt ENTRY (Task 25 · review m-2): every live receipt entry of a PAID installment with no receipt
 * bound to it — also on an installment that already has another receipt row (voided then re-received · an
 * earlier partial receipt · a reschedule-fee receipt on the same paymentId).
 *
 * ⚠️ NEVER FOR MONEY DOCUMENTED ELSEWHERE (Task 23 review m-1)
 * ------------------------------------------------------------
 * A PAID row with no receipt row of its own can still be money that already has its document:
 * - (c) a row the early payoff paid — the payoff receipt (`EARLY_PAYOFF`) and JP4 carry no `paymentId`; only
 *   the rows JP4 settled (`PAID_BY_EARLY_PAYOFF`: paid_date = the JP4's posted_at and inside the range of
 *   installments it closed; a JP4 without the range also by the early-payoff note prefix its rows carry),
 *   NOT a row of the same contract PAID before the payoff (Task 25 · r-1);
 * - (b) a row cleared by an entry that credits 11-2103 for its schedule row (path (b) of `orphan_payments` —
 *   the nightly 2A consuming a customer advance / the reschedule park: that money got its document when it
 *   was received since PR3 / PR4ข).
 * These are exactly paths (c) and (b) of the nightly `orphan_payments` check — the same rules
 * (`modules/data-audit/services/payment-backing.ts`), not a second definition. A row whose rest was paid in
 * cash has that receipt row already (or, if it failed, a live entry ⇒ the bound list), so skipping the whole
 * row is safe. Every skipped row is printed — `[documented elsewhere] paymentId=… path=b|c|b+c` plus a count
 * line, on dry-run and live run — so the operator sees what is not issued before a real run (Task 25).
 * What the CLI still issues for: PAID rows backed by no journal entry at all (seed "data-only" rows ·
 * payments that predate receipt automation) — including such a row on a contract that was later paid off
 * early (the payoff settled only the rows still open).
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

import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import {
  PAID_BY_EARLY_PAYOFF,
  SCHEDULE_ROWS_CLEARED_BY_ENTRY,
} from '../modules/data-audit/services/payment-backing';
import {
  INSTALLMENT_MONEY_RECEIPT_TYPES,
  INSTALLMENT_RECEIPT_SOURCE_TAGS,
} from '../modules/receipts/receipt-types.constants';
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

/** Payment rows (alias `p`) the CLI looks at: PAID, money received, NO receipt row at all (voided or not). */
const PAID_WITHOUT_ANY_RECEIPT = Prisma.sql`p.deleted_at IS NULL
      AND p.status = 'PAID'
      AND p.amount_paid > 0
      AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.payment_id = p.id)`;

/**
 * Journal entry (alias `je`) that is a live receipt entry of payment `p` — the entry the bound re-issue
 * (`generateReceipt(…, sourceJournalEntryNumber)`) binds: POSTED, not deleted, `metadata.paymentId` = the
 * payment, a tag that path accepts, and not reversed by a receipt void / refund (the bound path refuses a
 * reversed entry).
 */
const LIVE_BOUND_RECEIPT_ENTRY = Prisma.sql`je.metadata->>'paymentId' = p.id
        AND je.metadata->>'tag' IN (${Prisma.join([...INSTALLMENT_RECEIPT_SOURCE_TAGS])})
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND COALESCE(je.metadata->>'reversed', 'false') <> 'true'`;

/** Paths (b)/(c) of `orphan_payments` that put a row's money under a document elsewhere (`payment-backing.ts`) */
export type DocumentedElsewherePath = 'b' | 'c' | 'b+c';

/** A row of the CLI's population with the two "documented elsewhere" paths decided per row */
interface PopulationRow extends PaidPaymentRow {
  /** (b) an entry credits 11-2103 for the row's schedule row (nightly advance / park consumption · 6a/6b) */
  cleared_by_schedule: boolean;
  /** (c) the contract's early payoff (JP4) paid this row — `PAID_BY_EARLY_PAYOFF` */
  paid_by_payoff: boolean;
}

export interface DocumentedElsewhereRow extends PaidPaymentRow {
  path: DocumentedElsewherePath;
}

/**
 * The CLI's population: PAID payments with money received and NO receipt row at all, and
 * - never an installment imported from the old back office (`legacy_installment_code` — written only by
 *   the importer): its pre-cutover money was booked in PEAK and has no receipt here by design, so a
 *   catch-up tax invoice would be a second document for the same money (Task 18 review m-2, 2026-10-30);
 * - never a payment with a live receipt entry bound to it (Task 23): that goes through the bound re-issue
 *   runbook — `findBoundReissueCandidates`.
 * Each row carries paths (b)/(c) of `orphan_payments` (`payment-backing.ts` — the same rules, decided in one
 * query) so the run splits it into the rows it issues for and the rows it skips and prints.
 */
async function loadPopulation(prisma: PrismaService): Promise<PopulationRow[]> {
  return prisma.$queryRaw<PopulationRow[]>`
    WITH cleared_schedule AS (${SCHEDULE_ROWS_CLEARED_BY_ENTRY})
    SELECT p.id, p.contract_id, p.installment_no,
           p.amount_paid::text AS amount_paid,
           p.payment_method, p.gateway_ref, p.recorded_by_id,
           p.paid_date,
           c.contract_number,
           EXISTS (SELECT 1 FROM cleared_schedule b WHERE b.id = s.id) AS cleared_by_schedule,
           ${PAID_BY_EARLY_PAYOFF} AS paid_by_payoff
    FROM payments p
    JOIN contracts c ON c.id = p.contract_id
    LEFT JOIN installment_schedules s
      ON s.contract_id = p.contract_id AND s.installment_no = p.installment_no
    WHERE ${PAID_WITHOUT_ANY_RECEIPT}
      AND p.legacy_installment_code IS NULL
      AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE ${LIVE_BOUND_RECEIPT_ENTRY})
    ORDER BY c.contract_number, p.installment_no
  `;
}

/** Rows this CLI issues for vs rows it skips because their money is documented elsewhere — one snapshot */
function splitPopulation(rows: PopulationRow[]): {
  candidates: PaidPaymentRow[];
  documentedElsewhere: DocumentedElsewhereRow[];
} {
  const candidates: PaidPaymentRow[] = [];
  const documentedElsewhere: DocumentedElsewhereRow[] = [];
  for (const { cleared_by_schedule: b, paid_by_payoff: c, ...row } of rows) {
    const path: DocumentedElsewherePath | null = b && c ? 'b+c' : b ? 'b' : c ? 'c' : null;
    if (path) documentedElsewhere.push({ ...row, path });
    else candidates.push(row);
  }
  return { candidates, documentedElsewhere };
}

/**
 * Rows this CLI issues an (unbound) receipt for: the population (`loadPopulation`) minus the rows the early
 * payoff paid (c) or cleared through their schedule row (b) — paths (b)/(c) of `orphan_payments`
 * (`payment-backing.ts`): that money is documented by the payoff receipt / by the receipt that took the
 * advance (Task 23 review m-1) · a row PAID before the payoff is not under (c) (Task 25).
 */
export async function findPaidPaymentsWithoutReceipt(
  prisma: PrismaService,
): Promise<PaidPaymentRow[]> {
  return splitPopulation(await loadPopulation(prisma)).candidates;
}

/**
 * Rows of the population the CLI skips because their money is documented elsewhere — path `b` / `c` /
 * `b+c` (Task 25 · Task 23 re-review r-1): printed on every run (dry-run and live) with a count so the
 * operator sees what is not issued before a real run.
 */
export async function findDocumentedElsewhere(
  prisma: PrismaService,
): Promise<DocumentedElsewhereRow[]> {
  return splitPopulation(await loadPopulation(prisma)).documentedElsewhere;
}

/**
 * Live receipt entry (alias `je`) of payment `p` that has no receipt bound to it — the per-entry rule of the
 * runbook's SQL check ("ออกใบเสร็จซ้ำ" in `.claude/rules/accounting.md`): no live receipt row carries
 * `source_journal_entry_id = je.id`. An entry from before PR3 (no `receiptTax` stamp) never had its receipt
 * bound — that receipt was issued unbound — so it counts as missing only while the payment has no receipt row
 * at all (the per-payment rule of Task 23, kept for that era).
 */
const RECEIPT_ENTRY_WITHOUT_ITS_RECEIPT = Prisma.sql`NOT EXISTS (SELECT 1 FROM receipts r
                        WHERE r.source_journal_entry_id = je.id AND r.deleted_at IS NULL)
        AND (je.metadata->'receiptTax' IS NOT NULL
             OR NOT EXISTS (SELECT 1 FROM receipts r WHERE r.payment_id = p.id))`;

interface BoundReissueRow {
  id: string;
  contract_id: string;
  installment_no: number;
  amount_paid: string;
  contract_number: string;
  /**
   * the payment's live receipt entries with no receipt bound to them, oldest first — one receipt to re-issue per
   * entry · `receiptAmount` = `metadata.receiptTax.amount` (null before PR3)
   */
  entries: { entryNumber: string; receiptAmount: string | null }[];
  /**
   * live installment receipts of the payment bound to NO entry (before PR3 / issued without the entry) — > 0 on a
   * listed entry is the runbook's known false positive (an entry posted later for money whose receipt was issued
   * unbound, e.g. `backfill-orphan-partial-receipts`): check that receipt before re-issuing
   */
  unbound_receipts: number;
}

/**
 * Live receipt journal entries of a PAID installment with no receipt bound to them — the receipt failed to
 * issue after the money was booked (Task 25 · Task 23 review m-2: per ENTRY, not per payment — an installment
 * that already has a receipt row (voided then re-received · an earlier partial receipt · a reschedule-fee
 * receipt on the same paymentId) can still miss the receipt of another entry). Grouped per payment. Never
 * issued by this CLI; listed for the bound re-issue runbook ("ออกใบเสร็จซ้ำ" — `.claude/rules/accounting.md`).
 * Imported rows are included: a post-cutover receipt of an imported row re-issues bound too.
 */
export async function findBoundReissueCandidates(
  prisma: PrismaService,
): Promise<BoundReissueRow[]> {
  return prisma.$queryRaw<BoundReissueRow[]>`
    SELECT p.id, p.contract_id, p.installment_no,
           p.amount_paid::text AS amount_paid,
           c.contract_number,
           json_agg(json_build_object(
                      'entryNumber', je.entry_number,
                      'receiptAmount', je.metadata->'receiptTax'->>'amount')
                    ORDER BY je.posted_at, je.entry_number) AS entries,
           (SELECT COUNT(*)::int FROM receipts r
             WHERE r.payment_id = p.id AND r.deleted_at IS NULL AND NOT r.is_voided
               AND r.source_journal_entry_id IS NULL
               AND r."receiptType" IN (${Prisma.join([...INSTALLMENT_MONEY_RECEIPT_TYPES])})) AS unbound_receipts
    FROM journal_entries je
    JOIN payments p ON p.id = je.metadata->>'paymentId'
    JOIN contracts c ON c.id = p.contract_id
    WHERE p.deleted_at IS NULL
      AND p.status = 'PAID'
      AND p.amount_paid > 0
      AND ${LIVE_BOUND_RECEIPT_ENTRY}
      AND ${RECEIPT_ENTRY_WITHOUT_ITS_RECEIPT}
    GROUP BY p.id, c.contract_number
    ORDER BY c.contract_number, p.installment_no
  `;
}

export interface BackfillReceiptsResult {
  candidates: number;
  created: number;
  skipped: number;
  failed: number;
  totalAmount: Decimal;
  /** payments listed for the bound re-issue runbook — never issued by this CLI */
  boundReissue: number;
  /** their receipt entries with no receipt (one receipt to re-issue per entry) */
  boundReissueEntries: number;
  /** population rows skipped because their money is documented elsewhere (paths b/c) — printed, never issued */
  documentedElsewhere: number;
}

export async function backfillPaymentReceipts(
  prisma: PrismaService,
  issuance: ReceiptIssuanceService,
  opts: { dryRun: boolean; fallbackIssuerId: string | null },
): Promise<BackfillReceiptsResult> {
  const { candidates: rows, documentedElsewhere } = splitPopulation(await loadPopulation(prisma));
  const bound = await findBoundReissueCandidates(prisma);
  const result: BackfillReceiptsResult = {
    candidates: rows.length,
    created: 0,
    skipped: 0,
    failed: 0,
    totalAmount: new Decimal(0),
    boundReissue: bound.length,
    boundReissueEntries: bound.reduce((n, b) => n + b.entries.length, 0),
    documentedElsewhere: documentedElsewhere.length,
  };

  if (documentedElsewhere.length > 0) {
    console.log(
      `[backfill-receipts] ${documentedElsewhere.length} payment(s) skipped — money documented elsewhere` +
        ' (orphan_payments paths, payment-backing.ts: b = cleared through the schedule row by the nightly' +
        " advance / park consumption · c = paid by the contract's early payoff JP4). NOT issued here:",
    );
    for (const e of documentedElsewhere) {
      console.log(
        `  [documented elsewhere] paymentId=${e.id}  contract=${e.contract_number}  งวด=${e.installment_no}` +
          `  amountPaid=฿${new Decimal(e.amount_paid).toFixed(2)}  path=${e.path}`,
      );
    }
    console.log('');
  }

  if (bound.length > 0) {
    console.log(
      `[backfill-receipts] ${result.boundReissueEntries} live receipt journal entr(y/ies) on ${bound.length}` +
        ' payment(s) have no receipt bound to them — NOT issued here. Re-issue one receipt per entry, bound to it' +
        ' (runbook "ออกใบเสร็จซ้ำ", .claude/rules/accounting.md):',
    );
    for (const b of bound) {
      const entries = b.entries
        .map((e) => `${e.entryNumber} (receiptTax.amount=${e.receiptAmount ?? '-'})`)
        .join(', ');
      console.log(
        `  [bound re-issue] paymentId=${b.id}  contract=${b.contract_number}  งวด=${b.installment_no}` +
          `  amountPaid=฿${new Decimal(b.amount_paid).toFixed(2)}  entries=${entries}` +
          (b.unbound_receipts > 0
            ? `  ⚠ unboundReceipts=${b.unbound_receipts} — check that receipt is not this money before re-issuing`
            : ''),
      );
    }
    console.log('');
  }

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
    console.error(
      'Re-run with: EXPECTED_DB_NAME=<db-name> npm --prefix apps/api run backfill:receipts',
    );
    process.exit(1);
  }

  const dryRun = process.env.CONFIRM_BACKFILL !== REQUIRED_CONSENT;
  if (dryRun) {
    console.log('[backfill-receipts] DRY-RUN mode (default). To create receipts, re-run with:');
    console.log(
      `  CONFIRM_BACKFILL=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db> [ALLOW_PROD_BACKFILL=${REQUIRED_CONSENT}] npm --prefix apps/api run backfill:receipts`,
    );
    console.log('');
  }

  if (
    !dryRun &&
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_PROD_BACKFILL !== REQUIRED_CONSENT
  ) {
    console.error(
      `ERROR: Refusing to backfill in NODE_ENV=production without ALLOW_PROD_BACKFILL=${REQUIRED_CONSENT}`,
    );
    process.exit(1);
  }

  const prisma = new PrismaService();
  const [{ current_database: actualDb }] = await prisma.$queryRaw<
    { current_database: string }[]
  >`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(
      `ERROR: DB mismatch: connected="${actualDb}" expected="${expectedDb}". Aborting.`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[backfill-receipts] DB: "${actualDb}" | mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);

  try {
    // lineOaService undefined → no LINE push of historical receipts.
    const issuance = new ReceiptIssuanceService(
      prisma,
      undefined,
      new ReceiptNumberService(prisma),
    );

    // Fallback issuer for payments with no recorded_by_id.
    const fallback = await prisma.user.findFirst({
      where: { email: 'admin@bestchoice.com', deletedAt: null },
      select: { id: true },
    });

    console.log('[backfill-receipts] Scanning PAID payments (amountPaid>0) with no receipt...');
    console.log(
      '[backfill-receipts] Imported legacy installments (legacy_installment_code) are always excluded — never issue them a receipt.',
    );
    console.log(
      '[backfill-receipts] Payments with a live receipt journal entry are listed for the bound re-issue runbook — never issued here.',
    );
    console.log(
      '[backfill-receipts] Rows the early payoff paid (not rows paid before it) or cleared by the nightly advance / park consumption are skipped — their money is documented elsewhere; each is listed as [documented elsewhere] with its path.',
    );
    console.log('');
    const result = await backfillPaymentReceipts(prisma, issuance, {
      dryRun,
      fallbackIssuerId: fallback?.id ?? null,
    });

    console.log('');
    console.log('[backfill-receipts] ===== SUMMARY =====');
    console.log(`  candidates                : ${result.candidates}`);
    console.log(
      `  bound re-issue (not here) : ${result.boundReissueEntries} entr(y/ies) on ${result.boundReissue} payment(s)`,
    );
    console.log(`  documented elsewhere      : ${result.documentedElsewhere}`);
    if (!dryRun) {
      console.log(`  created                   : ${result.created}`);
      console.log(`  skipped (no issuer)       : ${result.skipped}`);
      console.log(`  failed                    : ${result.failed}`);
    }
    console.log(`  total ฿ amount            : ฿${result.totalAmount.toFixed(2)}`);
    console.log('');

    if (dryRun) {
      console.log(
        '[backfill-receipts] DRY-RUN complete — nothing created. Re-run with CONFIRM_BACKFILL=YES_I_AM_SURE to write.',
      );
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
