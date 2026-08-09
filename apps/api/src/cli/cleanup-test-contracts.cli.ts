/**
 * Remove ALL test data created by seed-test-contracts.cli + everything the owner
 * produced while exercising flows with it (full-system test-on-prod pack).
 *
 * WHAT COUNTS AS TEST DATA
 * ------------------------
 * - Test customers : Customer.addressCurrent === TEST_CUSTOMER_ADDRESS (exact)
 * - Test products  : Product.imeiSerial LIKE 'TEST-%'
 * - Test contracts : contractNumber LIKE 'TEST-%'  OR  customer is a test
 *   customer  OR  product is a test product — the OR arms catch contracts opened
 *   through the REAL UI during testing (those get real BCP- numbers).
 *
 * The IMEI marker is free text (typed by hand for trade-ins), so the dry-run
 * prints the IDENTITY of every matched product / customer / contract — review
 * that list before confirming a live run on prod.
 *
 * STRATEGY (safe on prod)
 * -----------------------
 * - HARD-delete the journal entries stamped metadata.contractId of any test
 *   contract (payment 2B, payoff JP4, repossession JP5, CN-related, refund
 *   21-1107, cancellation reversals, nightly 2A accrual + ECL provision — all
 *   stamp contractId) + their lines → restores the ledger / Trial Balance.
 *   (journal_entries have no immutability trigger; the wipe CLI deletes them too.)
 * - SOFT-delete (deletedAt) receipts, payments, installment schedules,
 *   contracts, cancellation requests, letters, repossessions, sales, finance
 *   receivables, sales commissions, trade-ins, test products, and test
 *   customers → they vanish from every UI query (all filter deletedAt: null)
 *   WITHOUT risking FK-cascade errors from hard-deleting rows with children.
 *
 * Residue that CANNOT be removed (accepted): immutable audit_logs of the test
 * actions, call logs under soft-deleted contracts, gaps in receipt/sale number
 * sequences (numbers aren't reclaimed), and JEs NOT stamped with
 * metadata.contractId — notably interco settlement batches (metadata.items[]):
 * the playbook forbids approving a batch containing test contracts; if it
 * happened anyway, reverse the batch through the UI BEFORE running this.
 * Accounting documents created manually during testing (expense/payroll/other
 * income) must be voided/reversed through the UI — they are not contract-linked.
 *
 * GUARDS — identical to seed-test-contracts.cli (CONFIRM_CLEANUP / ALLOW_PROD_CLEANUP).
 *
 * INVOCATION
 * ----------
 *   Dry-run:  EXPECTED_DB_NAME=<db> npm --prefix apps/api run cleanup:test-contracts
 *   Live:     CONFIRM_CLEANUP=YES_I_AM_SURE EXPECTED_DB_NAME=<db> \
 *             [ALLOW_PROD_CLEANUP=YES_I_AM_SURE NODE_ENV=production] \
 *             npm --prefix apps/api run cleanup:test-contracts
 */

import { PrismaService } from '../prisma/prisma.service';
import {
  TEST_CONTRACT_PREFIX,
  TEST_CUSTOMER_ADDRESS,
  TEST_IMEI_PREFIX,
} from './seed-test-contracts.cli';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

export interface CleanupResult {
  contracts: number;
  payments: number;
  installmentSchedules: number;
  receipts: number;
  journalEntries: number;
  customers: number;
  products: number;
  sales: number;
  financeReceivables: number;
  salesCommissions: number;
  tradeIns: number;
  repossessions: number;
  letters: number;
  cancellations: number;
}

export async function cleanupTestContracts(
  prisma: PrismaService,
  opts: { dryRun: boolean },
): Promise<CleanupResult> {
  const result: CleanupResult = {
    contracts: 0,
    payments: 0,
    installmentSchedules: 0,
    receipts: 0,
    journalEntries: 0,
    customers: 0,
    products: 0,
    sales: 0,
    financeReceivables: 0,
    salesCommissions: 0,
    tradeIns: 0,
    repossessions: 0,
    letters: 0,
    cancellations: 0,
  };

  // ---- Identify the three marker sets (with identity for dry-run review) ----
  const [testCustomers, testProducts] = await Promise.all([
    prisma.customer.findMany({
      where: { addressCurrent: TEST_CUSTOMER_ADDRESS, deletedAt: null },
      select: { id: true, name: true },
    }),
    prisma.product.findMany({
      where: { imeiSerial: { startsWith: TEST_IMEI_PREFIX }, deletedAt: null },
      select: { id: true, name: true, imeiSerial: true },
    }),
  ]);
  const testCustomerIds = testCustomers.map((c) => c.id);
  const testProductIds = testProducts.map((p) => p.id);

  const contracts = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      OR: [
        { contractNumber: { startsWith: TEST_CONTRACT_PREFIX } },
        ...(testCustomerIds.length ? [{ customerId: { in: testCustomerIds } }] : []),
        ...(testProductIds.length ? [{ productId: { in: testProductIds } }] : []),
      ],
    },
    select: { id: true, contractNumber: true },
  });
  const contractIds = contracts.map((c) => c.id);

  if (contractIds.length === 0 && testCustomerIds.length === 0 && testProductIds.length === 0) {
    console.log('[cleanup-test-contracts] No test data found. Nothing to do.');
    return result;
  }

  // Journal entries posted by flows exercised during the test (metadata.contractId).
  const entries = contractIds.length
    ? await prisma.journalEntry.findMany({
        where: { OR: contractIds.map((id) => ({ metadata: { path: ['contractId'], equals: id } as any })) },
        select: { id: true },
      })
    : [];
  const entryIds = entries.map((e) => e.id);

  // Sales: POS cash sales on test products / test customers + installment-linked sales.
  const saleWhereOr = [
    ...(testProductIds.length ? [{ productId: { in: testProductIds } }] : []),
    ...(testCustomerIds.length ? [{ customerId: { in: testCustomerIds } }] : []),
    ...(contractIds.length ? [{ contractId: { in: contractIds } }] : []),
  ];
  const sales = saleWhereOr.length
    ? await prisma.sale.findMany({
        where: { deletedAt: null, OR: saleWhereOr },
        select: { id: true, saleNumber: true },
      })
    : [];
  const saleIds = sales.map((s) => s.id);

  // Commission rows spawned by test sales / test contracts — without sweeping
  // these, salesperson commission reports (payout-relevant) stay inflated.
  const commissionWhereOr = [
    ...(saleIds.length ? [{ saleId: { in: saleIds } }] : []),
    ...(contractIds.length ? [{ contractId: { in: contractIds } }] : []),
  ];

  const [payCount, schedCount, rcptCount, letterCount, repoCount, cancelCount, tradeInCount, finRecCount, commissionCount] =
    await Promise.all([
      prisma.payment.count({ where: { contractId: { in: contractIds }, deletedAt: null } }),
      prisma.installmentSchedule.count({ where: { contractId: { in: contractIds }, deletedAt: null } }),
      prisma.receipt.count({ where: { contractId: { in: contractIds }, deletedAt: null } }),
      prisma.contractLetter.count({ where: { contractId: { in: contractIds }, deletedAt: null } }),
      prisma.repossession.count({ where: { contractId: { in: contractIds }, deletedAt: null } }),
      prisma.contractCancellation.count({ where: { contractId: { in: contractIds }, deletedAt: null } }),
      testCustomerIds.length
        ? prisma.tradeIn.count({ where: { customerId: { in: testCustomerIds }, deletedAt: null } })
        : Promise.resolve(0),
      saleIds.length
        ? prisma.financeReceivable.count({ where: { saleId: { in: saleIds }, deletedAt: null } })
        : Promise.resolve(0),
      commissionWhereOr.length
        ? prisma.salesCommission.count({ where: { deletedAt: null, OR: commissionWhereOr } })
        : Promise.resolve(0),
    ]);

  result.contracts = contracts.length;
  result.payments = payCount;
  result.installmentSchedules = schedCount;
  result.receipts = rcptCount;
  result.journalEntries = entryIds.length;
  result.customers = testCustomerIds.length;
  result.products = testProductIds.length;
  result.sales = saleIds.length;
  result.financeReceivables = finRecCount;
  result.salesCommissions = commissionCount;
  result.tradeIns = tradeInCount;
  result.repossessions = repoCount;
  result.letters = letterCount;
  result.cancellations = cancelCount;

  // Identity listing — printed in BOTH modes so the operator can eyeball exactly
  // what is about to be (or was) removed. A real product whose hand-typed IMEI
  // happens to start with "TEST-" would cascade into its contract/sale/customer,
  // so this list is the operator's last line of defence before confirming.
  console.log(`  contracts (${contracts.length}):`);
  for (const c of contracts) {
    const viaUi = c.contractNumber.startsWith(TEST_CONTRACT_PREFIX) ? '' : '  ← เปิดผ่าน UI (เลขจริง)';
    console.log(`    ${c.contractNumber}${viaUi}`);
  }
  console.log(`  test products (${testProducts.length}):`);
  for (const p of testProducts) console.log(`    ${p.imeiSerial}  "${p.name}"`);
  console.log(`  test customers (${testCustomers.length}):`);
  for (const c of testCustomers) console.log(`    "${c.name}"`);
  if (sales.length) {
    console.log(`  sales (${sales.length}):`);
    for (const s of sales) console.log(`    ${s.saleNumber}`);
  }

  if (opts.dryRun) {
    console.log('');
    console.log(`  would remove: ${contracts.length} contracts, ${payCount} payments, ${schedCount} schedules, ${rcptCount} receipts,`);
    console.log(`                ${entryIds.length} journal entries (hard), ${letterCount} letters, ${repoCount} repossessions,`);
    console.log(`                ${cancelCount} cancellations, ${saleIds.length} sales, ${finRecCount} finance receivables,`);
    console.log(`                ${commissionCount} commissions, ${tradeInCount} trade-ins,`);
    console.log(`                ${testProductIds.length} test products, ${testCustomerIds.length} test customers`);
    return result;
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (entryIds.length) {
      // FK sweep before hard-deleting JEs — every relation into JournalEntry.id
      // (schema-wide audit 2026-08-09). Postgres default FK = NO ACTION, which
      // blocks the delete and aborts this WHOLE transaction, so each one must be
      // cleared first:
      //   - JournalLine (Restrict)                → deleted below, before the JE
      //   - JournalPostAuditLog (Restrict)        → hard-deleted here (no deletedAt
      //     column; the row is meaningless once its JE is gone)
      //   - ContractCancellation.reversalJournalEntryId (NO ACTION, nullable)
      //                                           → nulled here; the cancellation row
      //     itself is soft-deleted with the contract sweep below
      //   - InterCompanyTransaction.journalEntryId (SetNull) → safe automatically
      //   - FixedAsset.invoiceTransferJournalEntryId (NO ACTION) — unreachable:
      //     asset flows never stamp metadata.contractId, so their JEs can't be in
      //     entryIds
      // Adding a NEW hard FK into JournalEntry later? Update this block, or this
      // cleanup aborts mid-transaction on prod.
      await tx.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: entryIds } } });
      await tx.contractCancellation.updateMany({
        where: { reversalJournalEntryId: { in: entryIds } },
        data: { reversalJournalEntryId: null },
      });
      await tx.journalLine.deleteMany({ where: { journalEntryId: { in: entryIds } } });
      await tx.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
    }
    if (contractIds.length) {
      await tx.receipt.updateMany({
        where: { contractId: { in: contractIds }, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.payment.updateMany({
        where: { contractId: { in: contractIds }, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.installmentSchedule.updateMany({
        where: { contractId: { in: contractIds }, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.contractLetter.updateMany({
        where: { contractId: { in: contractIds }, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.repossession.updateMany({
        where: { contractId: { in: contractIds }, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.contractCancellation.updateMany({
        where: { contractId: { in: contractIds }, deletedAt: null },
        data: { deletedAt: now },
      });
    }
    if (saleIds.length) {
      await tx.financeReceivable.updateMany({
        where: { saleId: { in: saleIds }, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.sale.updateMany({ where: { id: { in: saleIds }, deletedAt: null }, data: { deletedAt: now } });
    }
    if (commissionWhereOr.length) {
      await tx.salesCommission.updateMany({
        where: { deletedAt: null, OR: commissionWhereOr },
        data: { deletedAt: now },
      });
    }
    if (testCustomerIds.length) {
      await tx.tradeIn.updateMany({
        where: { customerId: { in: testCustomerIds }, deletedAt: null },
        data: { deletedAt: now },
      });
    }
    if (contractIds.length) {
      await tx.contract.updateMany({
        where: { id: { in: contractIds }, deletedAt: null },
        data: { deletedAt: now },
      });
    }
    if (testProductIds.length) {
      await tx.product.updateMany({
        where: { id: { in: testProductIds }, deletedAt: null },
        data: { deletedAt: now },
      });
    }
    if (testCustomerIds.length) {
      await tx.customer.updateMany({
        where: { id: { in: testCustomerIds }, deletedAt: null },
        data: { deletedAt: now },
      });
    }
  });

  console.log(`[cleanup-test-contracts] Removed ${contracts.length} test contracts + related test data.`);
  return result;
}

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: EXPECTED_DB_NAME required');
    process.exit(1);
  }

  const dryRun = process.env.CONFIRM_CLEANUP !== REQUIRED_CONSENT;
  if (dryRun) {
    console.log('[cleanup-test-contracts] DRY-RUN mode (default). To remove, re-run with:');
    console.log(`  CONFIRM_CLEANUP=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db> [ALLOW_PROD_CLEANUP=${REQUIRED_CONSENT}] npm --prefix apps/api run cleanup:test-contracts`);
    console.log('');
  }
  if (!dryRun && process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_CLEANUP !== REQUIRED_CONSENT) {
    console.error(`ERROR: Refusing to clean up in NODE_ENV=production without ALLOW_PROD_CLEANUP=${REQUIRED_CONSENT}`);
    process.exit(1);
  }

  const prisma = new PrismaService();
  const [{ current_database: actualDb }] = await (prisma as any).$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`ERROR: DB mismatch: connected="${actualDb}" expected="${expectedDb}". Aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[cleanup-test-contracts] DB: "${actualDb}" | mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);
  console.log('');

  try {
    const r = await cleanupTestContracts(prisma, { dryRun });
    console.log('');
    console.log('[cleanup-test-contracts] ===== SUMMARY =====');
    console.log(`  contracts             : ${r.contracts}`);
    console.log(`  payments              : ${r.payments}`);
    console.log(`  installment schedules : ${r.installmentSchedules}`);
    console.log(`  receipts              : ${r.receipts}`);
    console.log(`  journal entries       : ${r.journalEntries} (hard-deleted)`);
    console.log(`  letters               : ${r.letters}`);
    console.log(`  repossessions         : ${r.repossessions}`);
    console.log(`  cancellations         : ${r.cancellations}`);
    console.log(`  sales                 : ${r.sales}`);
    console.log(`  finance receivables   : ${r.financeReceivables}`);
    console.log(`  sales commissions     : ${r.salesCommissions}`);
    console.log(`  trade-ins             : ${r.tradeIns}`);
    console.log(`  test products         : ${r.products}`);
    console.log(`  test customers        : ${r.customers}`);
    console.log('');
    console.log(dryRun ? '[cleanup-test-contracts] DRY-RUN complete — nothing removed.' : '[cleanup-test-contracts] Done.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[cleanup-test-contracts] FATAL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
