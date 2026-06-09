/**
 * REAL-DB e2e — PR-843/I2 Phase 3 3b defect-4: an OVERPAYING PaySolutions webhook.
 *
 * THE BEHAVIOUR UNDER TEST
 * ------------------------
 * The customer pays MORE than the contract owes (here: a single 1515.83 installment
 * paid with 2015.83 — 500 surplus). Pre-3b the FIFO loop covered the installment and
 * SILENTLY DROPPED the 500 (no JE, no alert — defect 4).
 *
 * POST-3b:
 *   1. The installment is NOT over-cleared — the primitive clears only its own owed,
 *      so Σ(Cr 11-2103) for the installment == installmentTotal (1515.83), never 2015.83.
 *   2. The leftover 500 is NOT silently dropped — the webhook fires a Sentry warning
 *      `paysolutions-overpay-surplus` (tags.critical + tags.refno, extra.surplus) so ops
 *      reconcile it. It is NOT auto-parked as a 21-1103 advance (needs accountant sign-off).
 *
 * Sentry is mocked at the module boundary so the surplus call is asserted directly
 * (same pattern as the unit specs). The rest of the harness mirrors
 * paysolutions-cross-path.e2e-spec.ts (real prisma, HAS_DB gate, scoped cleanup,
 * audit_logs never deleted, real money collaborators + harmless stubs).
 *
 * To run locally:
 *   export DATABASE_URL="postgresql://iamnaii@localhost:5432/bestchoice"
 *   cd apps/api && npm run test:e2e -- paysolutions-overpay-surplus
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaySolutionsService } from '../src/modules/paysolutions/paysolutions.service';
import { ProductsService } from '../src/modules/products/products.service';
import { JournalAutoService } from '../src/modules/journal/journal-auto.service';
import { PaymentReceiptTemplate } from '../src/modules/journal/cpa-templates/payment-receipt.template';
import { Vat60dayReversalTemplate } from '../src/modules/journal/cpa-templates/vat-60day-reversal.template';
import { ContractActivation1ATemplate } from '../src/modules/journal/cpa-templates/contract-activation-1a.template';
import { seedFinanceCoa } from '../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../src/modules/journal/__tests__/scenario-helpers';

// Mock the Sentry transport so we can assert the surplus alert WITHOUT a real DSN.
// captureException is kept as a no-op (the success path does not call it).
jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

const HAS_DB = !!process.env.DATABASE_URL;
const describeOrSkip = HAS_DB ? describe : describe.skip;
const DAY_MS = 24 * 60 * 60 * 1000;

describeOrSkip('PaySolutions webhook — overpay surplus (real DB e2e, PR-843/I2 3b defect-4)', () => {
  let prisma: PrismaService;
  let paysolutions: PaySolutionsService;

  let contractId: string;
  let instId: string;
  let paymentId: string;
  let createdFinanceCompanyId: string | null = null;

  const INSTALLMENT_TOTAL = 1515.83;
  const SURPLUS = 500;
  const OVERPAY = Math.round((INSTALLMENT_TOTAL + SURPLUS) * 100) / 100; // 2015.83

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    await seedFinanceCoa(prisma as any);
    await prisma.user.upsert({
      where: { email: 'admin@bestchoice.com' },
      create: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      update: {},
    });

    const existingFin = await prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (!existingFin) {
      const fin = await prisma.companyInfo.create({
        data: {
          nameTh: 'E2E Finance Co.',
          taxId: '9999999999996',
          companyCode: 'FINANCE',
          address: '1 E2E Rd.',
          directorName: 'E2E Director',
          vatRegistered: true,
          vatRate: '0.0700',
        },
      });
      createdFinanceCompanyId = fin.id;
    }

    const c = await seedStandard17k12m(prisma as any);
    contractId = c.id;

    const journal = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const inst1 = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId, installmentNo: 1 },
    });
    instId = inst1.id;

    // Single PENDING installment of installmentTotal, dueDate FUTURE, lateFee waived.
    const p1 = await prisma.payment.create({
      data: {
        contractId: c.id,
        installmentNo: 1,
        dueDate: new Date(Date.now() + 30 * DAY_MS),
        amountDue: INSTALLMENT_TOTAL,
        amountPaid: 0,
        lateFeeWaived: true,
        status: 'PENDING',
      },
    });
    paymentId = p1.id;

    const products = new ProductsService(prisma as any);
    const paymentReceiptTemplate = new PaymentReceiptTemplate(journal, prisma as any);
    const vat60Reversal = new Vat60dayReversalTemplate(journal, prisma as any);

    const integrationConfigStub = { getValue: async () => '' } as any;
    const configStub = { get: (_k: string, def?: string) => def ?? '' } as any;
    const lineOaServiceStub = { sendFlexMessage: async () => undefined } as any;
    const saleAdapterStub = {} as any;
    const paymentsStub = { recordPayment: async () => undefined } as any;

    paysolutions = new PaySolutionsService(
      prisma as any,
      configStub,
      lineOaServiceStub,
      integrationConfigStub,
      saleAdapterStub,
      products,
      journal,
      paymentReceiptTemplate,
      vat60Reversal,
      paymentsStub,
    );
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    const step = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch {
        /* best-effort teardown */
      }
    };
    try {
      if (contractId) {
        const jes = await prisma.journalEntry.findMany({
          where: {
            OR: [
              { referenceId: contractId },
              { metadata: { path: ['contractId'], equals: contractId } as any },
            ],
          },
          select: { id: true },
        });
        const ids = jes.map((e) => e.id);
        if (ids.length) {
          await step(() => prisma.journalLine.deleteMany({ where: { journalEntryId: { in: ids } } }));
          await step(() => prisma.journalEntry.deleteMany({ where: { id: { in: ids } } }));
        }
        await step(() => prisma.paymentLink.deleteMany({ where: { contractId } }));
        // audit_logs is IMMUTABLE — never deleted.
        await step(() => prisma.payment.deleteMany({ where: { contractId } }));
        await step(() => prisma.installmentSchedule.deleteMany({ where: { contractId } }));
        await step(() => prisma.contract.deleteMany({ where: { id: contractId } }));
      }
      if (createdFinanceCompanyId) {
        await step(() => prisma.companyInfo.deleteMany({ where: { id: createdFinanceCompanyId! } }));
      }
    } finally {
      await prisma.$disconnect();
    }
  }, 120_000);

  const sumCredits = async (accountCode: string): Promise<number> => {
    const entries = await prisma.journalEntry.findMany({
      where: {
        AND: [
          {
            OR: [
              { metadata: { path: ['tag'], equals: 'receipt' } } as any,
              { metadata: { path: ['tag'], equals: '2B' } } as any,
            ],
          },
          { metadata: { path: ['installmentScheduleId'], equals: instId } } as any,
        ],
      },
      include: { lines: true },
    });
    let sum = 0;
    for (const e of entries) {
      for (const l of e.lines) {
        if (l.accountCode === accountCode) sum += Number(l.credit);
      }
    }
    return Math.round(sum * 100) / 100;
  };

  it('overpay (2015.83 over a 1515.83 installment): installment NOT over-cleared + Sentry surplus alert fires', async () => {
    (Sentry.captureMessage as jest.Mock).mockClear();

    const link = await prisma.paymentLink.create({
      data: {
        token: 'e2e-overpay-surplus-1',
        contractId,
        paymentId,
        amount: OVERPAY,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + DAY_MS),
      },
    });

    await paysolutions.handlePaymentCallback({
      refno: link.token,
      result_code: '00',
      order_no: 'overpay-o-1',
      transaction_id: 'overpay-tx-1',
      total: String(OVERPAY),
    });

    // The installment is fully PAID but NOT over-cleared: Σ(Cr 11-2103) == installmentTotal,
    // NOT the 2015.83 the customer sent. The 500 surplus never touched the installment JE.
    const fresh = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(fresh.status).toBe('PAID');
    const cr11 = await sumCredits('11-2103');
    expect(cr11).toBeCloseTo(INSTALLMENT_TOTAL, 2);

    // The surplus is NOT silently dropped — a Sentry warning is raised so ops reconcile.
    const surplusCall = (Sentry.captureMessage as jest.Mock).mock.calls.find(
      (call) => call[0] === 'paysolutions-overpay-surplus',
    );
    expect(surplusCall).toBeDefined();
    expect(surplusCall![1].level).toBe('warning');
    expect(surplusCall![1].tags.critical).toBe('paysolutions-overpay-surplus');
    expect(surplusCall![1].tags.refno).toBe(link.token);
    expect(Number(surplusCall![1].extra.surplus)).toBeCloseTo(SURPLUS, 2);
    expect(Number(surplusCall![1].extra.paidAmount)).toBeCloseTo(OVERPAY, 2);
    expect(surplusCall![1].extra.contractId).toBe(contractId);
  }, 120_000);
});
