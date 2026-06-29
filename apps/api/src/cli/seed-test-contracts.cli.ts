/**
 * Seed TEST contracts for exercising the payment-recording + receipt flow.
 *
 * WHAT IT MAKES
 * -------------
 * N (default 10) clearly-marked contracts:
 *   - contractNumber prefixed `TEST-YYYYMMDD-NNN` (BKK date) — unmistakable in
 *     the UI, easy to find for cleanup, never collides with real `BCP-` numbers.
 *   - customer named "ทดสอบระบบ NN", phone 09xxxxxxxx.
 *   - status ACTIVE / workflowStatus APPROVED so they appear in the payment queue.
 *   - totalMonths PENDING installments (none paid) so you can record payments.
 *
 * Data-only, exactly like the dev seed (prisma/seed.ts) — it does NOT post an
 * activation journal. Recording a payment via the app then posts the real payment
 * JE + generates the receipt (the thing being tested). `cleanup-test-contracts.cli`
 * removes everything afterwards (hard delete).
 *
 * GUARDS (same shape as backfill-payment-receipts.cli)
 * ----------------------------------------------------
 * - EXPECTED_DB_NAME required; SELECT current_database() must match → exit 1
 * - DRY-RUN by default: prints what it WOULD create, writes nothing, exit 0.
 * - CONFIRM_SEED=YES_I_AM_SURE → actually creates.
 * - NODE_ENV=production also requires ALLOW_PROD_SEED=YES_I_AM_SURE.
 * - TEST_CONTRACT_COUNT (default 10).
 *
 * INVOCATION
 * ----------
 *   Dry-run:  EXPECTED_DB_NAME=<db> npm --prefix apps/api run seed:test-contracts
 *   Live:     CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=<db> \
 *             [ALLOW_PROD_SEED=YES_I_AM_SURE NODE_ENV=production] [TEST_CONTRACT_COUNT=10] \
 *             npm --prefix apps/api run seed:test-contracts
 */

import { PrismaService } from '../prisma/prisma.service';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

/** Pure installment calc — copied verbatim from prisma/seed.ts `calc()`. */
function calc(sellingPrice: number, downPayment: number, rate: number, months: number, commPct = 0.1, vatPct = 0.07) {
  const principal = Math.round((sellingPrice - downPayment) * 100) / 100;
  const storeCommission = Math.round(principal * commPct * 100) / 100;
  const interestTotal = Math.round(principal * rate * months * 100) / 100;
  const vatAmount = Math.round((principal + storeCommission + interestTotal) * vatPct * 100) / 100;
  const financedAmount = Math.round((principal + storeCommission + interestTotal + vatAmount) * 100) / 100;
  const monthlyPayment = Math.ceil(financedAmount / months);
  return { principal, interestTotal, storeCommission, vatAmount, financedAmount, monthlyPayment };
}

/** A few price/term profiles so the test set has variety. */
const PROFILES = [
  { sellingPrice: 54900, downPayment: 11000, rate: 0.08, months: 10 },
  { sellingPrice: 34900, downPayment: 5000, rate: 0.08, months: 10 },
  { sellingPrice: 24900, downPayment: 5000, rate: 0.1, months: 10 },
  { sellingPrice: 21900, downPayment: 4000, rate: 0.1, months: 12 },
  { sellingPrice: 16900, downPayment: 4000, rate: 0.1, months: 6 },
];

interface Refs {
  productId: string;
  branchId: string;
  salespersonId: string;
  reviewerId: string;
  interestConfigId: string;
}

async function resolveRefs(prisma: PrismaService): Promise<Refs> {
  const [product, branch, sales, reviewer, ic] = await Promise.all([
    prisma.product.findFirst({ where: { deletedAt: null }, select: { id: true } }),
    prisma.branch.findFirst({ where: { deletedAt: null }, select: { id: true } }),
    prisma.user.findFirst({ where: { role: 'SALES', deletedAt: null }, select: { id: true } }),
    prisma.user.findFirst({ where: { role: { in: ['OWNER', 'BRANCH_MANAGER'] }, deletedAt: null }, select: { id: true } }),
    prisma.interestConfig.findFirst({ select: { id: true } }),
  ]);
  const missing: string[] = [];
  if (!product) missing.push('product');
  if (!branch) missing.push('branch');
  if (!sales) missing.push('SALES user');
  if (!reviewer) missing.push('OWNER/BRANCH_MANAGER user');
  if (!ic) missing.push('interestConfig');
  if (missing.length) throw new Error(`Cannot seed — missing reference data: ${missing.join(', ')}`);
  return {
    productId: product!.id,
    branchId: branch!.id,
    salespersonId: sales!.id,
    reviewerId: reviewer!.id,
    interestConfigId: ic!.id,
  };
}

function bkkDateStr(): string {
  // BKK = UTC+7; format YYYYMMDD
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
}

export interface SeedResult {
  created: number;
  contractNumbers: string[];
}

export async function seedTestContracts(
  prisma: PrismaService,
  refs: Refs,
  opts: { count: number; dryRun: boolean },
): Promise<SeedResult> {
  const result: SeedResult = { created: 0, contractNumbers: [] };
  const dateStr = bkkDateStr();
  // Continue the per-day sequence so re-runs don't collide.
  const existingToday = await prisma.contract.count({
    where: { contractNumber: { startsWith: `TEST-${dateStr}-` } },
  });
  const baseMonth = new Date();
  baseMonth.setDate(1); // first installment due next month onward

  for (let n = 1; n <= opts.count; n++) {
    const seq = existingToday + n;
    const contractNumber = `TEST-${dateStr}-${String(seq).padStart(3, '0')}`;
    const profile = PROFILES[(n - 1) % PROFILES.length];
    const c = calc(profile.sellingPrice, profile.downPayment, profile.rate, profile.months);
    const paymentDueDay = 5;
    const phone = `09${String(10000000 + seq).slice(-8)}`;

    if (opts.dryRun) {
      console.log(
        `  ${contractNumber}  ลูกค้า="ทดสอบระบบ ${seq}"  ราคา=฿${profile.sellingPrice}  ดาวน์=฿${profile.downPayment}` +
          `  ${profile.months} งวด  ค่างวด=฿${c.monthlyPayment}  (PENDING x${profile.months})`,
      );
      result.contractNumbers.push(contractNumber);
      continue;
    }

    // Per-installment breakdown (ceil for 1..N-1, remainder on last) — mirrors seed.
    const mpPrincipal = Math.ceil(c.principal / profile.months);
    const mpInterest = Math.ceil(c.interestTotal / profile.months);
    const mpCommission = Math.ceil(c.storeCommission / profile.months);
    let usedP = 0,
      usedI = 0,
      usedC = 0;

    await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          name: `ทดสอบระบบ ${seq}`,
          phone,
          prefix: 'นาย',
          occupation: 'ทดสอบ',
          addressCurrent: 'ข้อมูลทดสอบระบบ — ลบได้',
        },
      });

      const contract = await tx.contract.create({
        data: {
          contractNumber,
          customerId: customer.id,
          productId: refs.productId,
          branchId: refs.branchId,
          salespersonId: refs.salespersonId,
          reviewedById: refs.reviewerId,
          interestConfigId: refs.interestConfigId,
          planType: 'STORE_DIRECT',
          sellingPrice: profile.sellingPrice,
          downPayment: profile.downPayment,
          interestRate: profile.rate,
          totalMonths: profile.months,
          interestTotal: c.interestTotal,
          // ยอดจัด = principal base (sellingPrice − down). computeInstallmentBreakdown
          // ADDS commission+interest+VAT on top, so this must NOT be the grand total
          // (the dev-seed calc() stuffs the grand total here — a latent bug never hit
          // because the seed pre-marks installments PAID and never records a payment).
          financedAmount: c.principal,
          storeCommission: c.storeCommission,
          vatAmount: c.vatAmount,
          vatPct: 0.07,
          monthlyPayment: c.monthlyPayment,
          status: 'ACTIVE',
          workflowStatus: 'APPROVED',
          paymentDueDay,
          hasOwnershipClause: true,
          hasRepossessionClause: true,
          hasEarlyPayoffClause: true,
          hasNoTransferClause: true,
          hasAcknowledgement: true,
        },
      });

      for (let i = 1; i <= profile.months; i++) {
        const isLast = i === profile.months;
        const principal = isLast ? Math.round((c.principal - usedP) * 100) / 100 : mpPrincipal;
        const interest = isLast ? Math.round((c.interestTotal - usedI) * 100) / 100 : mpInterest;
        const commission = isLast ? Math.round((c.storeCommission - usedC) * 100) / 100 : mpCommission;
        const vat = Math.round((c.monthlyPayment - principal - interest - commission) * 100) / 100;
        usedP += principal;
        usedI += interest;
        usedC += commission;
        await tx.payment.create({
          data: {
            contractId: contract.id,
            installmentNo: i,
            dueDate: new Date(baseMonth.getFullYear(), baseMonth.getMonth() + i, paymentDueDay),
            amountDue: c.monthlyPayment,
            amountPaid: 0,
            status: 'PENDING',
            monthlyPrincipal: principal,
            monthlyInterest: interest,
            monthlyCommission: commission,
            vatAmount: vat,
          },
        });
      }
    });

    result.created += 1;
    result.contractNumbers.push(contractNumber);
    console.log(`[seed-test-contracts] CREATED ${contractNumber} (ลูกค้า "ทดสอบระบบ ${seq}", ${profile.months} งวด)`);
  }

  return result;
}

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: EXPECTED_DB_NAME required');
    console.error('Re-run with: EXPECTED_DB_NAME=<db-name> npm --prefix apps/api run seed:test-contracts');
    process.exit(1);
  }

  const dryRun = process.env.CONFIRM_SEED !== REQUIRED_CONSENT;
  const count = Math.min(Math.max(parseInt(process.env.TEST_CONTRACT_COUNT || '10', 10) || 10, 1), 100);

  if (dryRun) {
    console.log('[seed-test-contracts] DRY-RUN mode (default). To create, re-run with:');
    console.log(`  CONFIRM_SEED=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db> [ALLOW_PROD_SEED=${REQUIRED_CONSENT}] npm --prefix apps/api run seed:test-contracts`);
    console.log('');
  }
  if (!dryRun && process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SEED !== REQUIRED_CONSENT) {
    console.error(`ERROR: Refusing to seed in NODE_ENV=production without ALLOW_PROD_SEED=${REQUIRED_CONSENT}`);
    process.exit(1);
  }

  const prisma = new PrismaService();
  const [{ current_database: actualDb }] = await (prisma as any).$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`ERROR: DB mismatch: connected="${actualDb}" expected="${expectedDb}". Aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[seed-test-contracts] DB: "${actualDb}" | mode: ${dryRun ? 'DRY-RUN' : 'LIVE'} | count: ${count}`);
  console.log('');

  try {
    const refs = await resolveRefs(prisma);
    const result = await seedTestContracts(prisma, refs, { dryRun, count });

    console.log('');
    console.log('[seed-test-contracts] ===== SUMMARY =====');
    console.log(`  ${dryRun ? 'would create' : 'created'} : ${dryRun ? count : result.created} test contracts`);
    console.log(`  number range       : ${result.contractNumbers[0]} .. ${result.contractNumbers[result.contractNumbers.length - 1]}`);
    console.log('');
    if (dryRun) {
      console.log('[seed-test-contracts] DRY-RUN complete — nothing created. Re-run with CONFIRM_SEED=YES_I_AM_SURE to write.');
    } else {
      console.log('[seed-test-contracts] Done. Find them in /payments (search "TEST-" or "ทดสอบระบบ"). Clean up with: npm --prefix apps/api run cleanup:test-contracts');
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[seed-test-contracts] FATAL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
