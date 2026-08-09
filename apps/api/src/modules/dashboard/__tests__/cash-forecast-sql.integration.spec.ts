/**
 * Anti-drift integration test: getCashForecast() raw SQL == feeNettedOutstanding util
 *
 * Named *.integration.spec.ts so jest testPathIgnorePatterns skips it (CI runner = jest).
 * Run with: npx vitest run --no-file-parallelism src/modules/dashboard/__tests__/cash-forecast-sql.integration.spec.ts
 * CI: covered by the DASH_FILES glob in .github/workflows/deploy-gcp.yml (vitest step).
 *
 * The SQL inside DashboardOverviewService.getCashForecast() reproduces the
 * FEE-FIRST fee-netted outstanding formula from compute-cn-breakdown.ts
 * (floor-only — the installmentTotal ceiling is intentionally omitted, see the
 * service jsdoc). This spec pins the SQL to the canonical util for the overdue
 * bucket (same universe as ECL's DUE selection when asOf = Bangkok start of
 * day) and to hand-computed goldens for the future buckets.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedStandard17k12m } from '../../journal/__tests__/scenario-helpers';
import { computeInstallmentOutstanding } from '../../journal/compute-cn-breakdown';
import { DashboardOverviewService } from '../services/dashboard-overview.service';
import { bangkokStartOfDay } from '../../../utils/date.util';

const prisma = new PrismaClient();

// Canonical per-installment total for the 17k/12m fixture: 1,416.66 (ROUND_DOWN)
// + 99.17 (HALF_UP) = 1,515.83
const INSTALLMENT = '1515.83';

// Payment fixture matrix — one row per formula band:
//   n=1 untouched overdue            → outstanding 1,515.83
//   n=2 partial w/ fee (FEE-FIRST)   → 1,515.83 − (1,000 − min(1,000, 50)) = 565.83
//   n=3 partial w/ WAIVED fee        → 1,515.83 − 500 = 1,015.83 (fee not netted)
//   n=4 due in 3 days                → next7 bucket, 1,515.83
//   n=5 due in 10 days               → next(8-30) bucket, 1,515.83
//   n=6 due in 45 days               → beyond 30d — excluded entirely
//   n=7 PAID                         → excluded entirely
const cases = [
  { n: 1, days: -40, status: 'PENDING', paid: '0', fee: '0', waived: false },
  { n: 2, days: -10, status: 'PARTIALLY_PAID', paid: '1000', fee: '50', waived: false },
  { n: 3, days: -3, status: 'PARTIALLY_PAID', paid: '500', fee: '100', waived: true },
  { n: 4, days: 3, status: 'PENDING', paid: '0', fee: '0', waived: false },
  { n: 5, days: 10, status: 'PENDING', paid: '0', fee: '0', waived: false },
  { n: 6, days: 45, status: 'PENDING', paid: '0', fee: '0', waived: false },
  { n: 7, days: -5, status: 'PAID', paid: INSTALLMENT, fee: '0', waived: false },
] as const;

async function wipeContracts() {
  await prisma.payment.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  // T1-C7 guard — contracts written off via writeOffBadDebt() carry an
  // immutable badDebtWriteOffAuditLog row FK-referencing them
  const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({
    select: { contractId: true },
  });
  await prisma.contract.deleteMany({
    where: { id: { notIn: woPoisoned.map((p) => p.contractId) } },
  });
}

describe('getCashForecast SQL == feeNettedOutstanding (anti-drift)', () => {
  let activeContract: Awaited<ReturnType<typeof seedStandard17k12m>>;
  let service: DashboardOverviewService;

  beforeAll(async () => {
    await wipeContracts();

    activeContract = await seedStandard17k12m(prisma);
    await prisma.contract.update({
      where: { id: activeContract.id },
      data: { status: 'ACTIVE' },
    });

    const now = Date.now();
    for (const c of cases) {
      await prisma.payment.create({
        data: {
          contractId: activeContract.id,
          installmentNo: c.n,
          amountDue: new Prisma.Decimal(INSTALLMENT),
          amountPaid: new Prisma.Decimal(c.paid),
          lateFee: new Prisma.Decimal(c.fee),
          lateFeeWaived: c.waived,
          dueDate: new Date(now + c.days * 86_400_000),
          status: c.status,
        },
      });
    }

    // TERMINATED contract with an overdue unpaid installment — must be
    // excluded from every bucket (forecast covers ACTIVE/OVERDUE/DEFAULT only)
    const terminated = await seedStandard17k12m(prisma);
    await prisma.contract.update({
      where: { id: terminated.id },
      data: { status: 'TERMINATED' },
    });
    await prisma.payment.create({
      data: {
        contractId: terminated.id,
        installmentNo: 1,
        amountDue: new Prisma.Decimal(INSTALLMENT),
        dueDate: new Date(now - 20 * 86_400_000),
        status: 'PENDING',
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new DashboardOverviewService(prisma as any);
  });

  afterAll(async () => {
    await wipeContracts();
    await prisma.$disconnect();
  });

  it('buckets match hand-computed FEE-FIRST goldens (incl. waived-fee band)', async () => {
    const result = await service.getCashForecast();

    // overdue: 1,515.83 + 565.83 + 1,015.83 = 3,097.49
    expect(result.overdue.count).toBe(3);
    expect(result.overdue.amount).toBeCloseTo(3097.49, 2);

    // next 7 days: installment n=4 only
    expect(result.next7Days.count).toBe(1);
    expect(result.next7Days.amount).toBeCloseTo(1515.83, 2);

    // next 30 days: cumulative (n=4 + n=5); n=6 (45d) excluded
    expect(result.next30Days.count).toBe(2);
    expect(result.next30Days.amount).toBeCloseTo(3031.66, 2);
  });

  it('overdue bucket equals Σ computeInstallmentOutstanding DUE rows (canonical util)', async () => {
    const asOf = bangkokStartOfDay();
    const contractInput = await prisma.contract.findUniqueOrThrow({
      where: { id: activeContract.id },
      select: {
        id: true,
        totalMonths: true,
        financedAmount: true,
        storeCommission: true,
        interestTotal: true,
        vatAmount: true,
      },
    });
    const { rows } = await computeInstallmentOutstanding(prisma, contractInput, {
      selection: 'DUE',
      asOf,
    });

    const utilTotal = rows.reduce((sum, r) => sum.add(r.outstanding), new Decimal(0));
    const utilCount = rows.length;

    const result = await service.getCashForecast();
    expect(result.overdue.count).toBe(utilCount);
    expect(new Decimal(result.overdue.amount).toFixed(2)).toBe(utilTotal.toFixed(2));
  });

  it('TERMINATED contract installments never enter any bucket', async () => {
    const result = await service.getCashForecast();
    // 3 overdue + 1 next7 + 1 next(8-30) from the ACTIVE contract only —
    // the TERMINATED contract's overdue row would have made overdue.count 4
    expect(result.overdue.count).toBe(3);
    expect(result.next30Days.count).toBe(2);
  });
});
