/**
 * D2 Task 3 — CHARACTERIZATION integration test for the flat-bracket late-fee model
 * in `OverdueLifecycleCronService.calculateLateFees()`.
 *
 * WHY a REAL-DB e2e test (not a mock spec):
 * ----------------------------------------
 * `calculateLateFees()` performs its entire arithmetic inside a single
 * `prisma.$executeRaw` bulk UPDATE:
 *
 *   late_fee = CASE
 *     WHEN FLOOR(EXTRACT(EPOCH FROM (now - due_date)) / 86400)::int >= minDays THEN tier2
 *     WHEN FLOOR(EXTRACT(EPOCH FROM (now - due_date)) / 86400)::int >= 1       THEN tier1
 *     ELSE 0
 *   END
 *
 * The CASE/EXTRACT/FLOOR happen in Postgres, not in JS, so a hand-mocked
 * PrismaService can't characterize the math — `$executeRaw` would just be a
 * `jest.fn`. We therefore pin the behaviour against a REAL database.
 *
 * D2 bracket model (defaults: tier1=50, tier2=100, minDays=3):
 *   - 1 day overdue  → tier1 (50)
 *   - 2 days overdue → tier1 (50)
 *   - 3 days overdue → tier2 (100)   ← exactly minDays
 *   - 5 days overdue → tier2 (100)
 *   - stored 200 with 5 days → DOWNGRADED to 100 (unconditional SET)
 *
 * HARNESS: the main jest config IGNORES *.integration.spec.ts and only the e2e
 * jest config (`e2e/jest-e2e.json`, run by CI via `npm run test:e2e`) matches
 * `e2e/.*\.e2e-spec\.ts$`. Hence this file lives in `e2e/` with the
 * `.e2e-spec.ts` suffix. Setup/teardown mirrors `sp7-1-dual-prisma.e2e-spec.ts`.
 *
 * SKIP GATE: requires DATABASE_URL (the SHOP DB that holds payments/contracts).
 * When unset the whole suite is `describe.skip`-ed so a DB-less local run stays
 * green; CI provisions the DB and runs the arithmetic for real.
 *
 * To run locally:
 *   export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/installment_db?schema=public"
 *   cd apps/api && npx jest --config e2e/jest-e2e.json e2e/overdue-late-fee.e2e-spec.ts --runInBand
 */

import { PrismaService } from '../src/prisma/prisma.service';
import { OverdueLifecycleCronService } from '../src/modules/overdue/services/overdue-lifecycle-cron.service';
import { ConsecutiveMissedService } from '../src/modules/overdue/consecutive-missed.service';
import { Prisma } from '@prisma/client';

const HAS_DB = !!process.env.DATABASE_URL;

// Only runs when DATABASE_URL is set (CI provisions it). Skipped locally
// when the DB is unreachable so a DB-less run does not red the suite.
const describeOrSkip = HAS_DB ? describe : describe.skip;

// Stable, unique-ish prefix so a parallel/leftover run never collides and our
// cleanup never touches unrelated rows.
const TAG = `e2e-latefee-${Date.now()}`;

/** ms helpers — anchored to the same clock the service reads (`new Date()`). */
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY_MS);
const daysFromNow = (n: number): Date => new Date(Date.now() + n * DAY_MS);

describeOrSkip('OverdueLifecycleCronService.calculateLateFees — D2 flat-bracket model (real DB e2e)', () => {
  let prisma: PrismaService;
  let service: OverdueLifecycleCronService;

  // FK anchors created in beforeAll, torn down in afterAll.
  let branchId: string;
  let userId: string;
  let customerId: string;
  let productId: string;
  let activeContractId: string;
  let waivedContractConfirm: string;

  // Payment ids we read back after the cron runs.
  const paymentIds: Record<string, string> = {};

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    // OverdueLifecycleCronService — constructor(private prisma: PrismaService, private consecutiveMissed: ConsecutiveMissedService).
    service = new OverdueLifecycleCronService(prisma, new ConsecutiveMissedService(prisma));

    // --- FK anchors ------------------------------------------------------
    const branch = await prisma.branch.create({
      data: { name: `${TAG}-branch` },
    });
    branchId = branch.id;

    const user = await prisma.user.create({
      data: {
        email: `${TAG}@example.com`,
        password: 'x',
        name: `${TAG}-user`,
        role: 'SALES',
        branchId,
      },
    });
    userId = user.id;

    const customer = await prisma.customer.create({
      data: { name: `${TAG}-customer`, phone: '0800000000' },
    });
    customerId = customer.id;

    const product = await prisma.product.create({
      data: {
        name: `${TAG}-product`,
        brand: 'TestBrand',
        model: 'TestModel',
        category: 'PHONE_NEW',
        costPrice: new Prisma.Decimal(1000),
        branchId,
      },
    });
    productId = product.id;

    // Shared contract scaffold — only `status` + ids vary per scenario.
    const baseContract = {
      customerId,
      productId,
      branchId,
      salespersonId: userId,
      planType: 'STORE_WITH_INTEREST' as const,
      sellingPrice: new Prisma.Decimal(10000),
      downPayment: new Prisma.Decimal(0),
      interestRate: new Prisma.Decimal('0.0800'),
      totalMonths: 12,
      interestTotal: new Prisma.Decimal(0),
      financedAmount: new Prisma.Decimal(10000),
      monthlyPayment: new Prisma.Decimal(1000),
    };

    // ACTIVE contract carries the four "should be processed / should be
    // skipped" payment rows (the WHERE clause requires contract status in
    // ACTIVE/OVERDUE/DEFAULT).
    const activeContract = await prisma.contract.create({
      data: {
        ...baseContract,
        contractNumber: `${TAG}-C-ACTIVE`,
        status: 'ACTIVE',
      },
    });
    activeContractId = activeContract.id;
    waivedContractConfirm = activeContract.id;

    // --- Payment scenarios (D2 flat-bracket model) ----------------------
    // Defaults: tier1=50 (1..minDays-1 days), tier2=100 (>=minDays=3 days)

    // 1) 2 days overdue → tier1 = 50
    const p2Days = await prisma.payment.create({
      data: {
        contractId: activeContractId,
        installmentNo: 1,
        dueDate: daysAgo(2),
        amountDue: new Prisma.Decimal(1000),
        status: 'PENDING',
      },
    });
    paymentIds.twoDays = p2Days.id;

    // 2) 1 day overdue → tier1 = 50
    const p1Day = await prisma.payment.create({
      data: {
        contractId: activeContractId,
        installmentNo: 2,
        dueDate: daysAgo(1),
        amountDue: new Prisma.Decimal(1000),
        status: 'PENDING',
      },
    });
    paymentIds.oneDay = p1Day.id;

    // 3) exactly 3 days overdue → tier2 = 100 (boundary: days >= minDays=3)
    const p3Days = await prisma.payment.create({
      data: {
        contractId: activeContractId,
        installmentNo: 3,
        dueDate: daysAgo(3),
        amountDue: new Prisma.Decimal(1000),
        status: 'PENDING',
      },
    });
    paymentIds.threeDays = p3Days.id;

    // 4) 5 days overdue → tier2 = 100
    const p5Days = await prisma.payment.create({
      data: {
        contractId: activeContractId,
        installmentNo: 4,
        dueDate: daysAgo(5),
        amountDue: new Prisma.Decimal(1000),
        status: 'PENDING',
      },
    });
    paymentIds.fiveDays = p5Days.id;

    // 5) stale: 5 days overdue, pre-seeded lateFee=200 → DOWNGRADED to 100 (unconditional SET)
    const pStale = await prisma.payment.create({
      data: {
        contractId: activeContractId,
        installmentNo: 5,
        dueDate: daysAgo(5),
        amountDue: new Prisma.Decimal(1000),
        status: 'OVERDUE',
        lateFee: new Prisma.Decimal('200.00'),
      },
    });
    paymentIds.stale = pStale.id;

    // 6) waived row: due 5 days ago BUT late_fee_waived = true -> untouched.
    //    Pre-seed a sentinel late_fee (7.77) so we can assert it is preserved.
    const pWaived = await prisma.payment.create({
      data: {
        contractId: activeContractId,
        installmentNo: 6,
        dueDate: daysAgo(5),
        amountDue: new Prisma.Decimal(1000),
        status: 'PENDING',
        lateFee: new Prisma.Decimal('7.77'),
        lateFeeWaived: true,
      },
    });
    paymentIds.waived = pWaived.id;

    // 7) not-yet-due row: dueDate in the FUTURE -> excluded by WHERE due_date < now.
    const pFuture = await prisma.payment.create({
      data: {
        contractId: activeContractId,
        installmentNo: 7,
        dueDate: daysFromNow(5),
        amountDue: new Prisma.Decimal(1000),
        status: 'PENDING',
      },
    });
    paymentIds.future = pFuture.id;

    // --- SystemConfig: pin D2 bracket defaults explicitly ---------------
    await prisma.systemConfig.upsert({
      where: { key: 'late_fee_tier1_amount' },
      create: { key: 'late_fee_tier1_amount', value: '50' },
      update: { value: '50' },
    });
    await prisma.systemConfig.upsert({
      where: { key: 'late_fee_tier2_amount' },
      create: { key: 'late_fee_tier2_amount', value: '100' },
      update: { value: '100' },
    });
    await prisma.systemConfig.upsert({
      where: { key: 'late_fee_tier2_min_days' },
      create: { key: 'late_fee_tier2_min_days', value: '3' },
      update: { value: '3' },
    });
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    // Delete in FK-safe order. Payments → contract → product/customer/user/branch.
    await prisma.payment.deleteMany({ where: { contractId: activeContractId } });
    await prisma.contract.deleteMany({ where: { id: activeContractId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.branch.deleteMany({ where: { id: branchId } });
    // Leave the two shared SystemConfig keys in place — they are global config
    // rows, not test fixtures, and our values match the defaults anyway.
    await prisma.$disconnect();
  });

  it('confirms ACTIVE contract scaffold seeded', () => {
    expect(waivedContractConfirm).toBe(activeContractId);
  });

  it('runs and reports the number of updated rows', async () => {
    const res = await service.calculateLateFees();
    // 5 eligible rows: oneDay, twoDays, threeDays, fiveDays, stale. (waived + future excluded.)
    // >= 5 (not === 5) because a shared DB may carry other overdue rows; we
    // only assert OUR rows below with exact values.
    expect(res.updated).toBeGreaterThanOrEqual(5);
    expect(res.timestamp).toBeInstanceOf(Date);
  });

  it('2 days overdue → tier1 = 50 (CASE: days >= 1 but < minDays=3)', async () => {
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentIds.twoDays } });
    expect(Number(p.lateFee)).toBe(50);
    expect(p.status).toBe('OVERDUE');
  });

  it('1 day overdue → tier1 = 50 (CASE: days >= 1)', async () => {
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentIds.oneDay } });
    expect(Number(p.lateFee)).toBe(50);
    expect(p.status).toBe('OVERDUE');
  });

  it('exactly 3 days overdue → tier2 = 100 (boundary: days >= minDays=3)', async () => {
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentIds.threeDays } });
    expect(Number(p.lateFee)).toBe(100);
    expect(p.status).toBe('OVERDUE');
  });

  it('5 days overdue → tier2 = 100', async () => {
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentIds.fiveDays } });
    expect(Number(p.lateFee)).toBe(100);
    expect(p.status).toBe('OVERDUE');
  });

  it('stale stored 200 with 5 days overdue → DOWNGRADED to 100 (unconditional SET)', async () => {
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentIds.stale } });
    expect(Number(p.lateFee)).toBe(100);
    expect(p.status).toBe('OVERDUE');
  });

  it('waived row is left untouched (late_fee preserved, status NOT flipped)', async () => {
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentIds.waived } });
    // WHERE late_fee_waived = false excludes this row entirely.
    expect(p.lateFee.toFixed(2)).toBe('7.77');
    expect(p.status).toBe('PENDING');
  });

  it('not-yet-due (future dueDate) row is NOT updated (WHERE due_date < now)', async () => {
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentIds.future } });
    expect(Number(p.lateFee)).toBe(0);
    expect(p.status).toBe('PENDING');
  });
});
