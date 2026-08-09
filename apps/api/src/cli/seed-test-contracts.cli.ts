/**
 * Seed TEST data for exercising the FULL system on production (or any DB).
 *
 * WHAT IT MAKES
 * -------------
 * 1. N contracts (default = one per scenario, 7 scenarios):
 *    - contractNumber prefixed `TEST-YYYYMMDD-NNN` (BKK date) — unmistakable in
 *      the UI, easy to find for cleanup, never collides with real `BCP-` numbers.
 *    - customer named "ทดสอบ <scenario> NN", phone 09xxxxxxxx.
 *    - each contract gets its OWN test product (imeiSerial `TEST-...`) — never a
 *      real device, so repossession testing can't touch real stock (Repossession
 *      is one-to-one with Product and flips its status).
 *    - scenarios cover: due today / 1-3 overdue / all-future (payment flows),
 *      TERMINATED with 4 overdue (repossession JP5 + CN + 21-1107 refund), and
 *      near-payoff 4/6 paid (early payoff JP4).
 * 2. 3 spare IN_STOCK test products (new / used / accessory, SHOP-owned,
 *    isOnlineVisible=false) — for POS cash sale + opening a NEW contract through
 *    the real UI workflow.
 * 3. 2 blank test customers (no contract) — for new-customer / credit-check /
 *    trade-in / booking flows.
 *
 * Data-only, exactly like the dev seed (prisma/seed.ts) — it does NOT post an
 * activation journal. Exercising a flow in the app then posts the real JEs
 * (the thing being tested). `cleanup-test-contracts.cli` removes everything
 * afterwards, including every JE stamped with metadata.contractId.
 *
 * Test playbook: docs/guides/TEST-ON-PROD-PLAYBOOK.md
 *
 * GUARDS (same shape as backfill-payment-receipts.cli)
 * ----------------------------------------------------
 * - EXPECTED_DB_NAME required; SELECT current_database() must match → exit 1
 * - DRY-RUN by default: prints what it WOULD create, writes nothing, exit 0.
 * - CONFIRM_SEED=YES_I_AM_SURE → actually creates.
 * - NODE_ENV=production also requires ALLOW_PROD_SEED=YES_I_AM_SURE.
 * - TEST_CONTRACT_COUNT (default = number of scenarios).
 *
 * INVOCATION
 * ----------
 *   Dry-run:  EXPECTED_DB_NAME=<db> npm --prefix apps/api run seed:test-contracts
 *   Live:     CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=<db> \
 *             [ALLOW_PROD_SEED=YES_I_AM_SURE NODE_ENV=production] [TEST_CONTRACT_COUNT=7] \
 *             npm --prefix apps/api run seed:test-contracts
 */

import { PrismaService } from '../prisma/prisma.service';
import { ensureInstallmentSchedules } from '../utils/installment-schedule.util';
import { loadLateFeeConfig, resolveLateFee } from '../utils/late-fee.util';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

/**
 * Markers shared with cleanup-test-contracts.cli — the cleanup finds test data
 * through these, so a contract opened through the REAL UI (getting a real BCP-
 * number) on a test customer/product is still swept.
 */
export const TEST_CUSTOMER_ADDRESS = 'ข้อมูลทดสอบระบบ — ลบได้';
export const TEST_IMEI_PREFIX = 'TEST-';
export const TEST_CONTRACT_PREFIX = 'TEST-';

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

/**
 * Scenarios spread across due-date timelines so the owner can test real
 * "receiving payment" events. `startMonthsAgo` = how many months ago installment
 * #1 fell due (0 = due TODAY, 1 = 1 installment already overdue, … -1 = all future).
 * Past-due installments are stamped OVERDUE; the late fee is computed live at
 * payment time from the due date, so no pre-stamping is needed.
 *
 * `paidCount` pre-marks the first N installments PAID (data-only — no JE and no
 * receipt behind them, same convention as the dev seed) so payoff-style flows
 * have realistic history. `status: 'TERMINATED'` makes the contract pass the
 * `jp5_require_terminated_status` gate so repossession can be tested directly.
 */
interface Scenario {
  sellingPrice: number;
  downPayment: number;
  rate: number;
  months: number;
  startMonthsAgo: number;
  label: string;
  paidCount?: number;
  status?: 'ACTIVE' | 'TERMINATED';
}

const SCENARIOS: Scenario[] = [
  { sellingPrice: 54900, downPayment: 11000, rate: 0.08, months: 10, startMonthsAgo: 0, label: 'ครบกำหนดวันนี้' },
  { sellingPrice: 34900, downPayment: 5000, rate: 0.08, months: 10, startMonthsAgo: 1, label: 'ค้าง 1 งวด' },
  { sellingPrice: 24900, downPayment: 5000, rate: 0.1, months: 10, startMonthsAgo: 2, label: 'ค้าง 2 งวด' },
  { sellingPrice: 21900, downPayment: 4000, rate: 0.1, months: 12, startMonthsAgo: 3, label: 'ค้าง 3 งวด (60+ วัน)' },
  { sellingPrice: 16900, downPayment: 4000, rate: 0.1, months: 6, startMonthsAgo: -1, label: 'งวดอนาคต' },
  // ยึดเครื่อง: บอกเลิกสัญญาแล้ว (ปพพ.386) ค้าง 4 งวด — เทส JP5 + ใบลดหนี้ + เงินคืน 21-1107
  { sellingPrice: 28900, downPayment: 5000, rate: 0.1, months: 10, startMonthsAgo: 4, label: 'ยึดเครื่อง (บอกเลิกแล้ว)', status: 'TERMINATED' },
  // ใกล้ปิดยอด: จ่ายแล้ว 4/6 งวด เหลืองวดวันนี้ + งวดอนาคต — เทสปิดยอดก่อนกำหนด JP4
  { sellingPrice: 18900, downPayment: 4000, rate: 0.08, months: 6, startMonthsAgo: 4, paidCount: 4, label: 'ใกล้ปิดยอด' },
];

/** Spare IN_STOCK products for POS cash-sale + new-contract flow testing. */
const SPARE_PRODUCTS: Array<{
  name: string;
  category: 'PHONE_NEW' | 'PHONE_USED' | 'ACCESSORY';
  cashPrice: number;
  costPrice: number;
  storage?: string;
  accessoryType?: string;
}> = [
  { name: 'ทดสอบระบบ มือถือใหม่ (สต็อกว่าง)', category: 'PHONE_NEW', cashPrice: 25900, costPrice: 21000, storage: '256GB' },
  { name: 'ทดสอบระบบ มือถือมือสอง (สต็อกว่าง)', category: 'PHONE_USED', cashPrice: 9900, costPrice: 7500, storage: '128GB' },
  { name: 'ทดสอบระบบ หูฟังบลูทูธ (สต็อกว่าง)', category: 'ACCESSORY', cashPrice: 1290, costPrice: 800, accessoryType: 'หูฟัง' },
];

/** Blank customers (no contract) for new-customer / trade-in / booking flows. */
const BLANK_CUSTOMERS = ['ทดสอบระบบ ลูกค้าใหม่ 1', 'ทดสอบระบบ ลูกค้าใหม่ 2'];

interface Refs {
  branchId: string;
  branchName: string;
  salespersonId: string;
  reviewerId: string;
  interestConfigId: string | null;
  shopCompanyId: string | null;
  financeCompanyId: string | null;
}

async function resolveRefs(prisma: PrismaService): Promise<Refs> {
  const [branch, sales, reviewer, ic, shopCo, financeCo] = await Promise.all([
    prisma.branch.findFirst({ where: { deletedAt: null }, select: { id: true, name: true } }),
    prisma.user.findFirst({ where: { role: 'SALES', deletedAt: null }, select: { id: true } }),
    prisma.user.findFirst({ where: { role: { in: ['OWNER', 'BRANCH_MANAGER'] }, deletedAt: null }, select: { id: true } }),
    prisma.interestConfig.findFirst({ select: { id: true } }),
    prisma.companyInfo.findFirst({ where: { companyCode: 'SHOP', deletedAt: null }, select: { id: true } }),
    prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE', deletedAt: null }, select: { id: true } }),
  ]);
  const missing: string[] = [];
  if (!branch) missing.push('branch');
  if (!sales) missing.push('SALES user');
  if (!reviewer) missing.push('OWNER/BRANCH_MANAGER user');
  // interestConfigId is nullable on Contract — prod may have no InterestConfig
  // rows (rate stored directly on the contract), so it's optional here.
  // Company rows are optional too: ownedByCompanyId is nullable on Product.
  if (missing.length) throw new Error(`Cannot seed — missing reference data: ${missing.join(', ')}`);
  return {
    branchId: branch!.id,
    branchName: branch!.name,
    salespersonId: sales!.id,
    reviewerId: reviewer!.id,
    interestConfigId: ic?.id ?? null,
    shopCompanyId: shopCo?.id ?? null,
    financeCompanyId: financeCo?.id ?? null,
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
  productsCreated: number;
  sparePartNames: string[];
  blankCustomersCreated: number;
}

export async function seedTestContracts(
  prisma: PrismaService,
  refs: Refs,
  opts: { count: number; dryRun: boolean },
): Promise<SeedResult> {
  const result: SeedResult = {
    created: 0,
    contractNumbers: [],
    productsCreated: 0,
    sparePartNames: [],
    blankCustomersCreated: 0,
  };
  const dateStr = bkkDateStr();
  // Continue the per-day sequences so re-runs don't collide (count includes
  // soft-deleted rows on purpose — numbers are never reclaimed).
  const existingToday = await prisma.contract.count({
    where: { contractNumber: { startsWith: `${TEST_CONTRACT_PREFIX}${dateStr}-` } },
  });
  let imeiSeq = await prisma.product.count({
    where: { imeiSerial: { startsWith: `${TEST_IMEI_PREFIX}${dateStr}-` } },
  });
  const nextImei = () => `${TEST_IMEI_PREFIX}${dateStr}-${String(++imeiSeq).padStart(3, '0')}`;
  // Late-fee config (SystemConfig) — used to pre-stamp overdue installments so the
  // wizard/preview show the fee immediately (the daily cron would otherwise do it).
  const lateFeeCfg = await loadLateFeeConfig(prisma);

  // ---- 1. Spare IN_STOCK products (skip ones that already exist, re-run safe) ----
  for (const sp of SPARE_PRODUCTS) {
    const exists = await prisma.product.findFirst({
      where: { name: sp.name, deletedAt: null },
      select: { id: true },
    });
    if (exists) {
      console.log(`[seed-test-contracts] spare product exists, skipped: "${sp.name}"`);
      continue;
    }
    if (opts.dryRun) {
      console.log(`  [เครื่องว่าง] "${sp.name}"  ${sp.category}  ฿${sp.cashPrice}  @${refs.branchName}`);
      result.sparePartNames.push(sp.name);
      continue;
    }
    await prisma.product.create({
      data: {
        name: sp.name,
        brand: 'ทดสอบระบบ',
        model: sp.name,
        storage: sp.storage,
        accessoryType: sp.accessoryType,
        imeiSerial: nextImei(),
        category: sp.category,
        costPrice: sp.costPrice,
        cashPrice: sp.cashPrice,
        installmentPrice: sp.cashPrice,
        branchId: refs.branchId,
        ownedByCompanyId: refs.shopCompanyId,
        status: 'IN_STOCK',
        isOnlineVisible: false,
        stockInDate: new Date(),
      },
    });
    result.productsCreated += 1;
    result.sparePartNames.push(sp.name);
    console.log(`[seed-test-contracts] CREATED spare product "${sp.name}" (@${refs.branchName})`);
  }

  // ---- 2. Blank test customers (no contract; re-run safe) ----
  for (const [i, name] of BLANK_CUSTOMERS.entries()) {
    const exists = await prisma.customer.findFirst({ where: { name, deletedAt: null }, select: { id: true } });
    if (exists) {
      console.log(`[seed-test-contracts] blank customer exists, skipped: "${name}"`);
      continue;
    }
    if (opts.dryRun) {
      console.log(`  [ลูกค้าเปล่า] "${name}"`);
      result.blankCustomersCreated += 1;
      continue;
    }
    await prisma.customer.create({
      data: {
        name,
        phone: `08990000${String(i + 1).padStart(2, '0')}`,
        prefix: 'นาย',
        occupation: 'ทดสอบ',
        addressCurrent: TEST_CUSTOMER_ADDRESS,
      },
    });
    result.blankCustomersCreated += 1;
    console.log(`[seed-test-contracts] CREATED blank customer "${name}"`);
  }

  // ---- 3. Contracts (each with its own test product) ----
  for (let n = 1; n <= opts.count; n++) {
    const seq = existingToday + n;
    const contractNumber = `${TEST_CONTRACT_PREFIX}${dateStr}-${String(seq).padStart(3, '0')}`;
    const sc = SCENARIOS[(n - 1) % SCENARIOS.length];
    const c = calc(sc.sellingPrice, sc.downPayment, sc.rate, sc.months);
    const paidCount = Math.max(0, Math.min(sc.paidCount ?? 0, sc.months));
    // BKK-local "today" (UTC+7) via an explicit offset — TZ-independent, so due
    // dates are correct whether the runtime is UTC (Cloud Run Job) or BKK.
    const bkk = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const bkkY = bkk.getUTCFullYear();
    const bkkMo = bkk.getUTCMonth();
    const dueDay = bkk.getUTCDate();
    const todayMidnight = new Date(bkkY, bkkMo, dueDay);
    // Backdate createdAt so installment #1 (= createdAt + 1 month) falls due
    // `startMonthsAgo` months ago. ensureInstallmentSchedules keys off createdAt,
    // keeping the schedule + Payment due dates in lockstep.
    const createdAt = new Date(bkkY, bkkMo - (sc.startMonthsAgo + 1), dueDay);
    const paymentDueDay = dueDay;
    const custName = `ทดสอบ ${sc.label} ${seq}`;
    const phone = `09${String(10000000 + seq).slice(-8)}`;
    const overdueCount = Math.max(0, Math.min(sc.startMonthsAgo, sc.months) - paidCount);

    if (opts.dryRun) {
      console.log(
        `  ${contractNumber}  "${custName}"  ${sc.status ?? 'ACTIVE'}  ${sc.months} งวด  ค่างวด=฿${c.monthlyPayment}` +
          `  → จ่ายแล้ว ${paidCount} / ค้าง ${overdueCount} งวด (+เครื่อง TEST 1 เครื่อง)`,
      );
      result.contractNumbers.push(contractNumber);
      continue;
    }

    // Per-installment breakdown (ceil for 1..N-1, remainder on last) — mirrors seed.
    const mpPrincipal = Math.ceil(c.principal / sc.months);
    const mpInterest = Math.ceil(c.interestTotal / sc.months);
    const mpCommission = Math.ceil(c.storeCommission / sc.months);
    let usedP = 0,
      usedI = 0,
      usedC = 0;

    await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          name: custName,
          phone,
          prefix: 'นาย',
          occupation: 'ทดสอบ',
          addressCurrent: TEST_CUSTOMER_ADDRESS,
        },
      });

      // Own test product per contract — repossession is one-to-one with Product
      // and flips its status, so a TEST contract must NEVER point at real stock.
      const product = await tx.product.create({
        data: {
          name: `ทดสอบระบบ มือถือคู่สัญญา ${contractNumber}`,
          brand: 'ทดสอบระบบ',
          model: `TEST-${seq}`,
          color: 'ดำ',
          storage: '128GB',
          imeiSerial: nextImei(),
          category: 'PHONE_NEW',
          costPrice: Math.round(sc.sellingPrice * 0.8),
          cashPrice: sc.sellingPrice,
          installmentPrice: sc.sellingPrice,
          branchId: refs.branchId,
          ownedByCompanyId: refs.financeCompanyId,
          status: 'SOLD_INSTALLMENT',
          isOnlineVisible: false,
          stockInDate: createdAt,
        },
      });
      result.productsCreated += 1;

      const contract = await tx.contract.create({
        data: {
          contractNumber,
          customerId: customer.id,
          productId: product.id,
          branchId: refs.branchId,
          salespersonId: refs.salespersonId,
          reviewedById: refs.reviewerId,
          interestConfigId: refs.interestConfigId,
          createdAt,
          planType: 'STORE_DIRECT',
          sellingPrice: sc.sellingPrice,
          downPayment: sc.downPayment,
          interestRate: sc.rate,
          totalMonths: sc.months,
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
          status: sc.status ?? 'ACTIVE',
          workflowStatus: 'APPROVED',
          paymentDueDay,
          hasOwnershipClause: true,
          hasRepossessionClause: true,
          hasEarlyPayoffClause: true,
          hasNoTransferClause: true,
          hasAcknowledgement: true,
        },
      });

      for (let i = 1; i <= sc.months; i++) {
        const isLast = i === sc.months;
        const principal = isLast ? Math.round((c.principal - usedP) * 100) / 100 : mpPrincipal;
        const interest = isLast ? Math.round((c.interestTotal - usedI) * 100) / 100 : mpInterest;
        const commission = isLast ? Math.round((c.storeCommission - usedC) * 100) / 100 : mpCommission;
        const vat = Math.round((c.monthlyPayment - principal - interest - commission) * 100) / 100;
        usedP += principal;
        usedI += interest;
        usedC += commission;
        const dueDateI = new Date(createdAt.getFullYear(), createdAt.getMonth() + i, dueDay);
        const overdueDays =
          dueDateI < todayMidnight
            ? Math.floor((todayMidnight.getTime() - dueDateI.getTime()) / 86400000)
            : 0;
        const isPaid = i <= paidCount;
        await tx.payment.create({
          data: {
            contractId: contract.id,
            installmentNo: i,
            dueDate: dueDateI,
            amountDue: c.monthlyPayment,
            // Pre-marked PAID installments are data-only history (no JE, no
            // receipt) — same convention as the dev seed. The flows being tested
            // (payoff/repossession) quote off the UNPAID rows.
            amountPaid: isPaid ? c.monthlyPayment : 0,
            status: isPaid ? 'PAID' : overdueDays > 0 ? 'OVERDUE' : 'PENDING',
            ...(isPaid
              ? { paidDate: dueDateI, paymentMethod: 'CASH' as const, recordedById: refs.reviewerId }
              : {}),
            // Pre-stamp late fee on overdue installments (mirrors the daily overdue
            // cron) so the wizard + preview show it; record recomputes to match.
            ...(!isPaid && overdueDays > 0
              ? { lateFee: resolveLateFee(lateFeeCfg, overdueDays) }
              : {}),
            monthlyPrincipal: principal,
            monthlyInterest: interest,
            monthlyCommission: commission,
            vatAmount: vat,
          },
        });
      }

      // Persist installment_schedules so the wizard's preview-journal works —
      // it reads installmentSchedule; without these rows the wizard 404s
      // "ไม่พบงวดชำระ" before a payment can be recorded.
      await ensureInstallmentSchedules(tx, contract.id);
    });

    result.created += 1;
    result.contractNumbers.push(contractNumber);
    console.log(
      `[seed-test-contracts] CREATED ${contractNumber} ("${custName}", ${sc.status ?? 'ACTIVE'}, ${sc.months} งวด, จ่ายแล้ว ${paidCount}, ค้าง ${overdueCount})`,
    );
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
  const count = Math.min(
    Math.max(parseInt(process.env.TEST_CONTRACT_COUNT || String(SCENARIOS.length), 10) || SCENARIOS.length, 1),
    100,
  );

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
    console.log(`  ${dryRun ? 'would create' : 'created'} : ${dryRun ? count : result.created} test contracts (+ เครื่องคู่สัญญาอย่างละ 1)`);
    console.log(`  number range       : ${result.contractNumbers[0]} .. ${result.contractNumbers[result.contractNumbers.length - 1]}`);
    console.log(`  spare products     : ${result.sparePartNames.length} (IN_STOCK @${refs.branchName})`);
    console.log(`  blank customers    : ${result.blankCustomersCreated}`);
    console.log('');
    if (dryRun) {
      console.log('[seed-test-contracts] DRY-RUN complete — nothing created. Re-run with CONFIRM_SEED=YES_I_AM_SURE to write.');
    } else {
      console.log('[seed-test-contracts] Done. Find them in /payments (search "TEST-" or "ทดสอบ").');
      console.log('  คู่มือเทส: docs/guides/TEST-ON-PROD-PLAYBOOK.md');
      console.log('  Clean up : npm --prefix apps/api run cleanup:test-contracts');
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
