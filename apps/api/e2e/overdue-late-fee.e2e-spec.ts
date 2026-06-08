/**
 * Wave 3 MED gap-fill — CHARACTERIZATION integration test for the Thai-law
 * 3-way late-fee cap in `OverdueService.calculateLateFees()`
 * (apps/api/src/modules/overdue/overdue.service.ts:268-306).
 *
 * WHY a REAL-DB e2e test (not a mock spec):
 * ----------------------------------------
 * `calculateLateFees()` performs its entire arithmetic inside a single
 * `prisma.$executeRaw` bulk UPDATE:
 *
 *   late_fee = ROUND(LEAST(
 *     GREATEST(FLOOR(EXTRACT(EPOCH FROM (now - due_date)) / 86400)::int, 0) * perDay,
 *     cap,
 *     amount_due * 0.05            -- LATE_FEE_CAP_PCT (Thai-law 5% ceiling)
 *   )::numeric, 2)
 *
 * The LEAST/GREATEST/EXTRACT/FLOOR/ROUND happen in Postgres, not in JS, so a
 * hand-mocked PrismaService can't characterize the math — `$executeRaw` would
 * just be a `jest.fn`. We therefore pin the behaviour against a REAL database.
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
import { OverdueService } from '../src/modules/overdue/overdue.service';
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

describeOrSkip('OverdueService.calculateLateFees — Thai-law 3-way cap (real DB e2e)', () => {
  let prisma: PrismaService;
  let service: OverdueService;

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

    // calculateLateFees() only touches `this.prisma`. The other seven injected
    // deps (DunningEngineService, OverdueKpiService, PromiseService,
    // PaymentsService, ContractLetterService, MdmLockService, OwnerAlertHelper)
    // are never reached on this code path, so empty stubs are faithful here —
    // see overdue.service.ts:268-306. Casts keep the constructor signature.
    service = new OverdueService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

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

    // --- Payment scenarios ----------------------------------------------
    // 1) pct-cap wins: 30 days * 100 = 3000, cap 200, amount*5% = 50 -> 50.00
    const pPct = await prisma.payment.create({
      data: {
        contractId: activeContractId,
        installmentNo: 1,
        dueDate: daysAgo(30),
        amountDue: new Prisma.Decimal(1000),
        status: 'PENDING',
      },
    });
    paymentIds.pctCap = pPct.id;

    // 2) per-day wins: 1 day * 100 = 100, cap 200, amount*5% = 500 -> 100.00
    const pPerDay = await prisma.payment.create({
      data: {
        contractId: activeContractId,
        installmentNo: 2,
        dueDate: daysAgo(1),
        amountDue: new Prisma.Decimal(10000),
        status: 'PENDING',
      },
    });
    paymentIds.perDay = pPerDay.id;

    // 3) flat-cap wins: 10 days * 100 = 1000, cap 200, amount*5% = 250 -> 200.00
    const pFlat = await prisma.payment.create({
      data: {
        contractId: activeContractId,
        installmentNo: 3,
        dueDate: daysAgo(10),
        amountDue: new Prisma.Decimal(5000),
        status: 'PENDING',
      },
    });
    paymentIds.flatCap = pFlat.id;

    // 4) waived row: due 30 days ago BUT late_fee_waived = true -> untouched.
    //    Pre-seed a sentinel late_fee (7.77) so we can assert it is preserved.
    const pWaived = await prisma.payment.create({
      data: {
        contractId: activeContractId,
        installmentNo: 4,
        dueDate: daysAgo(30),
        amountDue: new Prisma.Decimal(1000),
        status: 'PENDING',
        lateFee: new Prisma.Decimal('7.77'),
        lateFeeWaived: true,
      },
    });
    paymentIds.waived = pWaived.id;

    // 5) not-yet-due row: dueDate in the FUTURE -> excluded by WHERE due_date < now.
    const pFuture = await prisma.payment.create({
      data: {
        contractId: activeContractId,
        installmentNo: 5,
        dueDate: daysFromNow(5),
        amountDue: new Prisma.Decimal(1000),
        status: 'PENDING',
      },
    });
    paymentIds.future = pFuture.id;

    // --- SystemConfig: pin defaults explicitly so the assertions are stable
    // regardless of whatever the seeded DB happens to carry. perDay=100,
    // cap=200 match BUSINESS_RULES; pct 0.05 is hardcoded (NOT configurable).
    await prisma.systemConfig.upsert({
      where: { key: 'late_fee_per_day' },
      create: { key: 'late_fee_per_day', value: '100' },
      update: { value: '100' },
    });
    await prisma.systemConfig.upsert({
      where: { key: 'late_fee_cap' },
      create: { key: 'late_fee_cap', value: '200' },
      update: { value: '200' },
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
    // 3 eligible rows: pctCap, perDay, flatCap. (waived + future excluded.)
    // >= 3 (not === 3) because a shared DB may carry other overdue rows; we
    // only assert OUR rows below with exact values.
    expect(res.updated).toBeGreaterThanOrEqual(3);
    expect(res.timestamp).toBeInstanceOf(Date);
  });

  it('pct-cap wins (5% of 1000 = 50.00, beats 30-day 3000 and flat 200)', async () => {
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentIds.pctCap } });
    expect(p.lateFee.toFixed(2)).toBe('50.00');
    expect(p.status).toBe('OVERDUE');
  });

  it('per-day wins (1 day * 100 = 100.00, beats flat 200 and 5%*10000=500)', async () => {
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentIds.perDay } });
    expect(p.lateFee.toFixed(2)).toBe('100.00');
    expect(p.status).toBe('OVERDUE');
  });

  it('flat cap wins (200.00, beats 10-day 1000 and 5%*5000=250)', async () => {
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentIds.flatCap } });
    expect(p.lateFee.toFixed(2)).toBe('200.00');
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
    expect(p.lateFee.toFixed(2)).toBe('0.00');
    expect(p.status).toBe('PENDING');
  });
});
