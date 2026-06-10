import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PaySolutionsService } from './paysolutions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { LineOaService } from '../line-oa/line-oa.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { OnlineOrderSaleAdapter } from '../shop-orders/online-order-sale.adapter';
import { ProductsService } from '../products/products.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { PaymentReceiptTemplate } from '../journal/cpa-templates/payment-receipt.template';
import { Vat60dayReversalTemplate } from '../journal/cpa-templates/vat-60day-reversal.template';
import { PaymentsService } from '../payments/payments.service';

// Same Sentry-transport stub the sibling specs use — captureMessage is
// asserted directly in the orphan test.
jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

/**
 * CHARACTERIZATION (golden) spec for handlePaymentCallback's SUCCESS money path
 * (paysolutions.service.ts:909-1339) — the FINANCE installment "god-method".
 * Wave 3 gap-fill (audit HIGH gap).
 *
 * The base JE/atomicity contract is pinned in paysolutions.service.spec.ts.
 * This file LOCKS the money/decision behaviour that file does not exercise:
 *
 *   1. FIFO distribution across unpaid installments (1086-1186)
 *        - exact-cover (3000 over [1000,1000,1000]) → all PAID, remaining 0
 *        - underflow (1500 over [1000,1000]) → inst1 PAID, inst2 PARTIALLY_PAID
 *          amountPaid 500, paidDate NULL
 *        - OVERPAY (2500 over [1000,1000]) → both PAID, 500 surplus parked as
 *          customer advance: JE Dr 11-1202 / Cr 21-1103 + advanceBalance↑ +
 *          OVERPAY_ADVANCE_RECORDED audit (PR-843/I2 #3 owner decision)
 *        - lateFeeWaived=true → owed math uses lateFee 0
 *   2. Contract-close decision (1188-1226)
 *        - exactly 1 installment closed → status='COMPLETED', NO creditBalance key
 *        - >1 installment closed → status='EARLY_PAYOFF' AND creditBalance=0
 *        - productId set → transferOwnership(productId, null, tx) exactly once
 *        - EARLY_PAYOFF → sendEarlyPayoffSuccessNotification (else sendPaymentSuccess)
 *   3. Idempotency gates (958-967, 1102-1110)
 *        - link.status='USED' → early return, NO $transaction, NO notification
 *        - updateMany → {count:0} → alreadyClaimed skip, NO JE, NO notification
 *   4. Orphan SUCCESS (937-956)
 *        - unknown refno + result_code='00' → Sentry fatal 'paysolutions-orphan-payment', no throw
 *        - unknown refno + result_code='99' → NO Sentry
 *   5. paidAmount parse (1032-1044)
 *        - total missing / 'NaN' → falls back to link.amount
 *        - total='1500' w/ link.amount=5000 → uses 1500 (no match check — QUIRK)
 *   6. in-tx receipt JE — PR-843/I2 Phase 3 3b primitive (FIXED behaviour)
 *        - EVERY touched installment posts its own receipt JE with delta=payThis
 *          (the per-receipt DELTA — NOT the cumulative amountPaid double-count)
 *        - prior-partial (amountPaid 400 + 600 delta) posts delta='600'
 *          (the completing receipt's own delta — reconstructPrior handles the 400)
 *        - 3 closed installments → execute called 3x, each delta = that owed
 *        - a partial (PARTIALLY_PAID) is ALSO ledgered (its own delta JE) — the
 *          defect-2 fix; partials are no longer unledgered
 *        - a completing late fee passes lateFee → Cr 42-1103 (via the primitive)
 *        - vat60dayJournalEntryId set → vat60Reversal.execute fires for that snapshot
 *        - installmentSchedule lookup null → execute NOT called for that snapshot
 *
 * Expected values are hand-traced from the implementation; we assert the FIXED
 * 3b behaviour. Money is Prisma.Decimal — compared via .toString().
 */
describe('PaySolutionsService.handlePaymentCallback — FIFO money + close (characterization)', () => {
  let service: PaySolutionsService;
  // Hand-mocked Prisma surface — only the members handlePaymentCallback touches.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let txMock: any;
  let products: { transferOwnership: jest.Mock };
  let template: { execute: jest.Mock };
  let vat60Reversal: { execute: jest.Mock };
  let journalAuto: { createAndPost: jest.Mock; createPaymentJournal: jest.Mock };
  let sendEarlyPayoffSpy: jest.SpyInstance;
  let sendPaymentSuccessSpy: jest.SpyInstance;

  const contractId = 'ct-1';
  const linkId = 'link-1';
  const refno = 'refno-1';

  // A single mutable Payment row as the txMock would return it. The real impl
  // reads the *return value* of tx.payment.update for the JE snapshot, so the
  // update mock echoes the merged row (original + data) back.
  type Row = {
    id: string;
    contractId: string;
    installmentNo: number;
    amountDue: Prisma.Decimal;
    amountPaid: Prisma.Decimal;
    lateFee: Prisma.Decimal;
    lateFeeWaived: boolean;
    monthlyPrincipal: Prisma.Decimal | null;
    monthlyInterest: Prisma.Decimal | null;
    monthlyCommission: Prisma.Decimal | null;
    vatAmount: Prisma.Decimal | null;
    status: string;
    paidDate: Date | null;
  };

  function makeRow(installmentNo: number, overrides: Partial<Row> = {}): Row {
    return {
      id: `pay-${installmentNo}`,
      contractId,
      installmentNo,
      amountDue: new Prisma.Decimal(1000),
      amountPaid: new Prisma.Decimal(0),
      lateFee: new Prisma.Decimal(0),
      lateFeeWaived: false,
      monthlyPrincipal: new Prisma.Decimal(800),
      monthlyInterest: new Prisma.Decimal(150),
      monthlyCommission: new Prisma.Decimal(50),
      vatAmount: new Prisma.Decimal(0),
      status: 'PENDING',
      paidDate: null,
      ...overrides,
    };
  }

  function makeLink(overrides: Record<string, unknown> = {}) {
    return {
      id: linkId,
      token: refno,
      status: 'ACTIVE',
      contractId,
      paymentId: 'pay-1',
      amount: new Prisma.Decimal(1000),
      savingPlanId: null,
      payment: { id: 'pay-1' },
      ...overrides,
    };
  }

  /**
   * Build the txMock around a fixed list of unpaid rows.
   * @param unpaid     rows returned by tx.payment.findMany (FIFO order)
   * @param stillUnpaid value returned by tx.payment.count after the loop
   * @param claimCount  paymentLink.updateMany claim count (0 = lost the race)
   * @param contractProductId productId returned by tx.contract.update
   * @param instSchedResolver  installmentNo → schedule row | null
   */
  function buildTx(opts: {
    unpaid: Row[];
    stillUnpaid: number;
    claimCount?: number;
    contractProductId?: string | null;
    instSchedResolver?: (
      installmentNo: number,
    ) => { id: string; vat60dayJournalEntryId: string | null } | null;
  }) {
    const instSchedResolver =
      opts.instSchedResolver ??
      (() => ({ id: 'inst-sched', vat60dayJournalEntryId: null }));
    txMock = {
      paymentLink: {
        updateMany: jest
          .fn()
          .mockResolvedValue({ count: opts.claimCount ?? 1 }),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue(opts.unpaid),
        // Echo the merged row so the impl's snapshot reads real values.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: jest.fn().mockImplementation((args: any) => {
          const original = opts.unpaid.find((r) => r.id === args.where.id)!;
          return Promise.resolve({ ...original, ...args.data });
        }),
        count: jest.fn().mockResolvedValue(opts.stillUnpaid),
      },
      contract: {
        update: jest
          .fn()
          .mockResolvedValue({ productId: opts.contractProductId ?? null }),
      },
      installmentSchedule: {
        // Lazy-gen recovery (#1170): count>0 → ensureInstallmentSchedules no-op.
        count: jest.fn().mockResolvedValue(1),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findUnique: jest.fn().mockImplementation((args: any) => {
          const instNo =
            args.where.contractId_installmentNo.installmentNo as number;
          return Promise.resolve(instSchedResolver(instNo));
        }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    return txMock;
  }

  async function buildService(): Promise<void> {
    products = { transferOwnership: jest.fn().mockResolvedValue(undefined) };
    // PR-843/I2 Phase 3 3b — the webhook now posts via the PaymentReceiptTemplate
    // primitive (delta-based) + fires Vat60dayReversalTemplate when the installment
    // carried a 60-day mandatory VAT flag. Both mocked so the unit spec asserts the
    // call shape without a DB.
    template = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-MOCK', split: {} }) };
    vat60Reversal = { execute: jest.fn().mockResolvedValue(null) };

    const lineOa = {} as Partial<LineOaService>;
    const integrationConfig = {
      getValue: jest.fn().mockResolvedValue(''),
    } as Partial<IntegrationConfigService>;
    const config = {
      get: jest.fn().mockImplementation((_k: string, def?: string) => def ?? ''),
    } as Partial<ConfigService>;
    const saleAdapter = {} as Partial<OnlineOrderSaleAdapter>;
    journalAuto = {
      createAndPost: jest.fn().mockResolvedValue({ id: 'je-surplus', entryNumber: 'JE-S-001' }),
      createPaymentJournal: jest.fn().mockResolvedValue('je-1'),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        PaySolutionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: LineOaService, useValue: lineOa },
        { provide: IntegrationConfigService, useValue: integrationConfig },
        { provide: OnlineOrderSaleAdapter, useValue: saleAdapter },
        { provide: ProductsService, useValue: products },
        { provide: JournalAutoService, useValue: journalAuto as Partial<JournalAutoService> },
        { provide: PaymentReceiptTemplate, useValue: template },
        { provide: Vat60dayReversalTemplate, useValue: vat60Reversal },
        { provide: PaymentsService, useValue: { recordPayment: jest.fn() } },
      ],
    }).compile();

    service = mod.get<PaySolutionsService>(PaySolutionsService);
    // The two notification helpers fetch the contract again and push LINE flex —
    // out of scope here. Spy so we can assert WHICH one fired without DB.
    sendPaymentSuccessSpy = jest
      .spyOn(
        service as unknown as Record<string, () => Promise<void>>,
        'sendPaymentSuccessNotification',
      )
      .mockResolvedValue(undefined);
    sendEarlyPayoffSpy = jest
      .spyOn(
        service as unknown as Record<string, () => Promise<void>>,
        'sendEarlyPayoffSuccessNotification',
      )
      .mockResolvedValue(undefined);
  }

  /**
   * Wire the top-level (non-tx) prisma surface around a link + tx.
   * companyInfo/user/contract.findUnique mirror the production hoist-out reads.
   */
  function buildPrisma(opts: {
    link: Record<string, unknown> | null;
    tx: unknown;
    owner?: { id: string } | null;
    contractForJe?: { id: string; contractNumber: string; branchId: string } | null;
  }) {
    prisma = {
      partialPaymentLink: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      paymentLink: {
        findFirst: jest.fn().mockResolvedValue(opts.link),
        update: jest.fn().mockResolvedValue({}),
      },
      companyInfo: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findFirst: jest.fn().mockImplementation((args: any) => {
          if (args?.where?.companyCode === 'SHOP')
            return Promise.resolve({ id: 'co-shop' });
          return Promise.resolve({ id: 'co-finance' });
        }),
      },
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.owner === undefined ? { id: 'owner-1' } : opts.owner,
          ),
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue(
          opts.contractForJe === undefined
            ? { id: contractId, contractNumber: 'CT-2026-0001', branchId: 'br-1' }
            : opts.contractForJe,
        ),
      },
      payment: {
        update: jest.fn().mockResolvedValue({}),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(opts.tx)),
    };
    return prisma;
  }

  beforeEach(() => {
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  // ---------------------------------------------------------------------------
  // 1) FIFO distribution
  // ---------------------------------------------------------------------------
  describe('FIFO distribution across unpaid installments', () => {
    it('exact cover: paidAmount=3000 over [1000,1000,1000] → all three PAID, remaining 0', async () => {
      const unpaid = [makeRow(1), makeRow(2), makeRow(3)];
      const tx = buildTx({ unpaid, stillUnpaid: 0, contractProductId: null });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(3000) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '3000',
      });

      // Each installment updated exactly once, all to PAID with paidDate set.
      expect(tx.payment.update).toHaveBeenCalledTimes(3);
      for (const call of tx.payment.update.mock.calls) {
        expect(call[0].data.status).toBe('PAID');
        expect(call[0].data.amountPaid.toString()).toBe('1000');
        expect(call[0].data.paidDate).toBeInstanceOf(Date);
        expect(call[0].data.paidAt).toBeInstanceOf(Date);
      }
    });

    it('underflow: paidAmount=1500 over [1000,1000] → inst1 PAID, inst2 PARTIALLY_PAID amountPaid 500 paidDate null', async () => {
      const unpaid = [makeRow(1), makeRow(2)];
      const tx = buildTx({ unpaid, stillUnpaid: 1, contractProductId: null });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(1500) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '1500',
      });

      expect(tx.payment.update).toHaveBeenCalledTimes(2);
      // inst1: fully paid 1000.
      const c1 = tx.payment.update.mock.calls[0][0];
      expect(c1.where.id).toBe('pay-1');
      expect(c1.data.status).toBe('PAID');
      expect(c1.data.amountPaid.toString()).toBe('1000');
      expect(c1.data.paidDate).toBeInstanceOf(Date);
      // inst2: only 500 of 1000 → PARTIALLY_PAID, NO paidDate/paidAt key.
      const c2 = tx.payment.update.mock.calls[1][0];
      expect(c2.where.id).toBe('pay-2');
      expect(c2.data.status).toBe('PARTIALLY_PAID');
      expect(c2.data.amountPaid.toString()).toBe('500');
      expect('paidDate' in c2.data).toBe(false);
      expect('paidAt' in c2.data).toBe(false);
    });

    it('overpay: paidAmount=2500 over [1000,1000] → both PAID, 500 surplus parked as advance JE Dr 11-1202 / Cr 21-1103 + advanceBalance↑ + audit (owner decision PR-843/I2 #3)', async () => {
      const unpaid = [makeRow(1), makeRow(2)];
      const tx = buildTx({ unpaid, stillUnpaid: 0, contractProductId: null });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(2500) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '2500',
      });

      // Only two installments exist — both fully paid at 1000.
      expect(tx.payment.update).toHaveBeenCalledTimes(2);
      expect(tx.payment.update.mock.calls[0][0].data.amountPaid.toString()).toBe('1000');
      expect(tx.payment.update.mock.calls[1][0].data.amountPaid.toString()).toBe('1000');
      // Each installment receipt clears only its own owed (delta=1000) — the
      // primitive NEVER over-clears even when cash is left over (the surplus is
      // not pushed into any installment JE).
      expect(template.execute).toHaveBeenCalledTimes(2);
      for (const call of template.execute.mock.calls) {
        expect(call[0].delta.toString()).toBe('1000');
      }
      // 2 fully-paid in one webhook → EARLY_PAYOFF close; creditBalance forced 0.
      const closeArg = tx.contract.update.mock.calls[0][0];
      expect(closeArg.data.status).toBe('EARLY_PAYOFF');
      expect(closeArg.data.creditBalance).toBe(0);

      // OWNER POLICY (PR-843/I2 #3): the 500 surplus is parked as a customer advance.
      // journalAutoService.createAndPost called once with the balanced surplus JE.
      expect(journalAuto.createAndPost).toHaveBeenCalledTimes(1);
      const [jeInput, jeTx] = journalAuto.createAndPost.mock.calls[0];
      expect(jeTx).toBe(tx); // inside the serializable tx
      expect(jeInput.reference).toBe(`${refno}-surplus`);
      expect(jeInput.metadata.tag).toBe('paysolutions-surplus-advance');
      expect(jeInput.lines).toHaveLength(2);
      const drLine = jeInput.lines.find((l: { accountCode: string }) => l.accountCode === '11-1202');
      const crLine = jeInput.lines.find((l: { accountCode: string }) => l.accountCode === '21-1103');
      expect(drLine).toBeDefined();
      expect(crLine).toBeDefined();
      // JE is balanced: Dr 11-1202 == Cr 21-1103 == 500 surplus.
      expect(drLine.dr.toString()).toBe('500');
      expect(drLine.cr.toString()).toBe('0');
      expect(crLine.cr.toString()).toBe('500');
      expect(crLine.dr.toString()).toBe('0');

      // contract.advanceBalance incremented by the surplus (second call to contract.update,
      // after the EARLY_PAYOFF status close above).
      const advanceUpdateCall = tx.contract.update.mock.calls.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (call: any[]) => call[0].data.advanceBalance !== undefined,
      );
      expect(advanceUpdateCall).toBeDefined();
      expect(advanceUpdateCall![0].data.advanceBalance.increment.toString()).toBe('500');
      expect(advanceUpdateCall![0].where.id).toBe(contractId);

      // OVERPAY_ADVANCE_RECORDED audit log written inside the tx.
      expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
      const auditArg = tx.auditLog.create.mock.calls[0][0].data;
      expect(auditArg.action).toBe('OVERPAY_ADVANCE_RECORDED');
      expect(auditArg.entity).toBe('contract');
      expect(auditArg.entityId).toBe(contractId);
      expect(auditArg.newValue.source).toBe('PAYSOLUTIONS_SURPLUS');
      expect(auditArg.newValue.refno).toBe(refno);
      expect(auditArg.newValue.surplus).toBe('500');
      expect(auditArg.newValue.paidAmount).toBe('2500');

      // No paysolutions-overpay-surplus Sentry warning (parking replaced alerting).
      const sentryOverpayCalls = (Sentry.captureMessage as jest.Mock).mock.calls.filter(
        (c: unknown[]) => c[0] === 'paysolutions-overpay-surplus',
      );
      expect(sentryOverpayCalls).toHaveLength(0);
    });

    it('lateFeeWaived=true: owed uses lateFee 0 — a 1000 installment with a waived 200 lateFee is fully PAID by 1000', async () => {
      const unpaid = [
        makeRow(1, { lateFee: new Prisma.Decimal(200), lateFeeWaived: true }),
      ];
      const tx = buildTx({ unpaid, stillUnpaid: 0, contractProductId: null });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(1000) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '1000',
      });

      // owed = amountDue(1000) + lateFee(0, waived) - amountPaid(0) = 1000.
      // 1000 covers it → PAID. (If the 200 lateFee counted, this would be
      // PARTIALLY_PAID.)
      const c = tx.payment.update.mock.calls[0][0];
      expect(c.data.status).toBe('PAID');
      expect(c.data.amountPaid.toString()).toBe('1000');
    });
  });

  // ---------------------------------------------------------------------------
  // 2) Contract-close decision
  // ---------------------------------------------------------------------------
  describe('contract-close decision', () => {
    it('exactly 1 installment closed → status=COMPLETED, NO creditBalance key, sendPaymentSuccessNotification', async () => {
      const unpaid = [makeRow(1)];
      const tx = buildTx({ unpaid, stillUnpaid: 0, contractProductId: null });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(1000) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '1000',
      });

      expect(tx.contract.update).toHaveBeenCalledTimes(1);
      const data = tx.contract.update.mock.calls[0][0].data;
      expect(data.status).toBe('COMPLETED');
      // fullyPaidCount === 1 → not EARLY_PAYOFF → creditBalance key absent.
      expect('creditBalance' in data).toBe(false);
      expect(sendPaymentSuccessSpy).toHaveBeenCalledTimes(1);
      expect(sendEarlyPayoffSpy).not.toHaveBeenCalled();
    });

    it('>1 installment closed → status=EARLY_PAYOFF AND creditBalance=0, sendEarlyPayoffSuccessNotification', async () => {
      const unpaid = [makeRow(1), makeRow(2)];
      const tx = buildTx({ unpaid, stillUnpaid: 0, contractProductId: null });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(2000) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '2000',
      });

      const data = tx.contract.update.mock.calls[0][0].data;
      expect(data.status).toBe('EARLY_PAYOFF');
      expect(data.creditBalance).toBe(0);
      // Early-payoff notification fires with the paid Decimal amount.
      expect(sendEarlyPayoffSpy).toHaveBeenCalledTimes(1);
      expect((sendEarlyPayoffSpy.mock.calls[0][1] as Prisma.Decimal).toString()).toBe(
        '2000',
      );
      expect(sendPaymentSuccessSpy).not.toHaveBeenCalled();
    });

    it('productId set on close → transferOwnership(productId, null, tx) exactly once', async () => {
      const unpaid = [makeRow(1)];
      const tx = buildTx({ unpaid, stillUnpaid: 0, contractProductId: 'prod-9' });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(1000) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '1000',
      });

      expect(products.transferOwnership).toHaveBeenCalledTimes(1);
      expect(products.transferOwnership).toHaveBeenCalledWith('prod-9', null, tx);
    });

    it('still-unpaid > 0 (no close) → contract.update NOT called, sendPaymentSuccessNotification still fires', async () => {
      const unpaid = [makeRow(1), makeRow(2)];
      // Pay only the first installment; second remains.
      const tx = buildTx({ unpaid, stillUnpaid: 1, contractProductId: null });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(1000) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '1000',
      });

      expect(tx.contract.update).not.toHaveBeenCalled();
      // contractStatus null → not EARLY_PAYOFF → single-installment notification.
      expect(sendPaymentSuccessSpy).toHaveBeenCalledTimes(1);
      expect(sendEarlyPayoffSpy).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 3) Idempotency gates
  // ---------------------------------------------------------------------------
  describe('idempotency gates', () => {
    it("link.status='USED' → early return, NO $transaction opened, NO notification", async () => {
      const tx = buildTx({ unpaid: [makeRow(1)], stillUnpaid: 0 });
      buildPrisma({ link: makeLink({ status: 'USED' }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '1000',
      });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(template.execute).not.toHaveBeenCalled();
      expect(sendPaymentSuccessSpy).not.toHaveBeenCalled();
      expect(sendEarlyPayoffSpy).not.toHaveBeenCalled();
      expect(Sentry.captureMessage as jest.Mock).not.toHaveBeenCalled();
    });

    it('updateMany claim count=0 (lost the race) → idempotent skip: no JE, no contract close, no notification', async () => {
      const unpaid = [makeRow(1)];
      // claimCount 0 → the impl returns { alreadyClaimed: true } immediately.
      const tx = buildTx({ unpaid, stillUnpaid: 0, claimCount: 0 });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(1000) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '1000',
      });

      // The $transaction DID open (claim is inside it) but bailed at count===0.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.payment.findMany).not.toHaveBeenCalled();
      expect(tx.payment.update).not.toHaveBeenCalled();
      expect(tx.contract.update).not.toHaveBeenCalled();
      expect(template.execute).not.toHaveBeenCalled();
      expect(sendPaymentSuccessSpy).not.toHaveBeenCalled();
      expect(sendEarlyPayoffSpy).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 4) Orphan SUCCESS webhook (unknown refno)
  // ---------------------------------------------------------------------------
  describe('orphan SUCCESS (unknown refno)', () => {
    it("unknown refno + result_code='00' → Sentry fatal 'paysolutions-orphan-payment', no throw, no tx", async () => {
      const tx = buildTx({ unpaid: [makeRow(1)], stillUnpaid: 0 });
      buildPrisma({ link: null, tx });
      await buildService();

      await expect(
        service.handlePaymentCallback({
          refno,
          result_code: '00',
          order_no: 'o-1',
          transaction_id: 'tx-9',
          total: '1000',
        }),
      ).resolves.toBeUndefined();

      expect(Sentry.captureMessage as jest.Mock).toHaveBeenCalledTimes(1);
      const [msg, opts] = (Sentry.captureMessage as jest.Mock).mock.calls[0];
      expect(msg).toContain('unknown refno');
      expect(opts.level).toBe('fatal');
      expect(opts.tags.critical).toBe('paysolutions-orphan-payment');
      expect(opts.tags.transactionId).toBe('tx-9');
      // No money movement attempted.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("unknown refno + result_code='99' (failure) → NO Sentry, silent 200", async () => {
      const tx = buildTx({ unpaid: [makeRow(1)], stillUnpaid: 0 });
      buildPrisma({ link: null, tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '99',
        order_no: 'o-1',
        transaction_id: 'tx-9',
        total: '1000',
      });

      expect(Sentry.captureMessage as jest.Mock).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 5) paidAmount parse / fallback
  // ---------------------------------------------------------------------------
  describe('paidAmount parse', () => {
    it("total missing → falls back to link.amount (1000) and credits a single installment", async () => {
      const unpaid = [makeRow(1)];
      const tx = buildTx({ unpaid, stillUnpaid: 0 });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(1000) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        // total omitted entirely
      });

      // paidAmount = link.amount = 1000 → installment fully paid.
      const c = tx.payment.update.mock.calls[0][0];
      expect(c.data.status).toBe('PAID');
      expect(c.data.amountPaid.toString()).toBe('1000');
    });

    it("total='NaN' → falls back to link.amount", async () => {
      const unpaid = [makeRow(1)];
      const tx = buildTx({ unpaid, stillUnpaid: 0 });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(1000) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: 'NaN',
      });

      expect(tx.payment.update.mock.calls[0][0].data.amountPaid.toString()).toBe(
        '1000',
      );
    });

    it("QUIRK: total='1500' with link.amount=5000 → uses wire 1500 (NO amount-match check)", async () => {
      // Two installments of 1000 each. paidAmount = wire total 1500 (NOT 5000).
      const unpaid = [makeRow(1), makeRow(2)];
      const tx = buildTx({ unpaid, stillUnpaid: 1 });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(5000) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '1500',
      });

      // 1500 distributed: inst1 PAID(1000), inst2 PARTIALLY_PAID(500). If the
      // code had used link.amount=5000 instead, both would be PAID. Locks the
      // "trust the wire total, no reconciliation" behaviour.
      expect(tx.payment.update.mock.calls[0][0].data.status).toBe('PAID');
      expect(tx.payment.update.mock.calls[1][0].data.status).toBe(
        'PARTIALLY_PAID',
      );
      expect(tx.payment.update.mock.calls[1][0].data.amountPaid.toString()).toBe(
        '500',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 6) in-tx receipt JE — PR-843/I2 Phase 3 3b primitive (FIXED behaviour)
  // ---------------------------------------------------------------------------
  describe('in-tx PaymentReceiptTemplate JE (3b primitive)', () => {
    it('defect-1 FIXED prior-partial: amountPaid 400 + 600 → primitive posts delta="600" (NOT cumulative 1000)', async () => {
      // Installment already had a 400 partial. A 600 webhook closes it.
      // The 3b primitive receives the per-receipt DELTA (600) — NOT the cumulative
      // amountPaid (1000) the old 2B template over-posted. reconstructPrior reads
      // the prior 400 from the ledger, so the completion clears only the 600 left.
      const unpaid = [
        makeRow(1, { amountPaid: new Prisma.Decimal(400), status: 'PARTIALLY_PAID' }),
      ];
      const tx = buildTx({ unpaid, stillUnpaid: 0 });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(600) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '600',
      });

      // Payment row: 400 + 600 = 1000 → PAID.
      expect(tx.payment.update.mock.calls[0][0].data.amountPaid.toString()).toBe(
        '1000',
      );
      // Primitive posts delta = 600 (the DELTA), with the new input shape.
      expect(template.execute).toHaveBeenCalledTimes(1);
      const [jeInput, outerTx] = template.execute.mock.calls[0];
      expect(jeInput.delta.toString()).toBe('600');
      expect(jeInput.installmentScheduleId).toBe('inst-sched');
      expect(jeInput.debitAccountCode).toBe('11-1202');
      expect(jeInput.isFinalReceipt).toBe(true);
      expect(jeInput.paymentId).toBe('pay-1');
      // PR-843/I2 Phase 5b — the QR webhook always clears the FULL owed per
      // installment, so a ≤1฿ last-installment residual is a system rounding
      // artifact → the flag is true (no approver available on the webhook path).
      expect(jeInput.autoApproveSystemRounding).toBe(true);
      // No 2B-era cumulative field leaks through.
      expect(jeInput.amountReceived).toBeUndefined();
      expect(jeInput.existingPaymentId).toBeUndefined();
      // JE shares the outer serializable tx (atomicity).
      expect(outerTx).toBe(tx);
    });

    it('3 closed installments → execute called 3x, each delta = that installment owed (1000)', async () => {
      const unpaid = [makeRow(1), makeRow(2), makeRow(3)];
      const tx = buildTx({ unpaid, stillUnpaid: 0 });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(3000) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '3000',
      });

      expect(template.execute).toHaveBeenCalledTimes(3);
      // Each receipt posts its OWN owed as the delta (1000) + shares the tx.
      for (const call of template.execute.mock.calls) {
        expect(call[0].delta.toString()).toBe('1000');
        expect(call[0].isFinalReceipt).toBe(true);
        expect(call[1]).toBe(tx);
      }
    });

    it('defect-2 FIXED: a PARTIAL installment is ALSO ledgered (its own delta JE, isFinalReceipt=false)', async () => {
      // 1500 over [1000,1000]: inst1 fully paid (delta 1000, final), inst2 gets a
      // 500 partial. Pre-3b the partial posted NO JE; now it posts its own receipt.
      const unpaid = [makeRow(1), makeRow(2)];
      const tx = buildTx({ unpaid, stillUnpaid: 1 });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(1500) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '1500',
      });

      // BOTH touched installments post a receipt — the partial is no longer dropped.
      expect(template.execute).toHaveBeenCalledTimes(2);
      const first = template.execute.mock.calls[0][0];
      expect(first.delta.toString()).toBe('1000');
      expect(first.isFinalReceipt).toBe(true);
      expect(first.paymentId).toBe('pay-1');
      const second = template.execute.mock.calls[1][0];
      expect(second.delta.toString()).toBe('500');
      expect(second.isFinalReceipt).toBe(false);
      expect(second.paymentId).toBe('pay-2');
    });

    it('completing late fee → primitive receives lateFee (→ Cr 42-1103); waived/zero late fee → lateFee undefined', async () => {
      // inst1: amountDue 1000 + lateFee 150 (not waived) → owed 1150, fully paid by 1150.
      const unpaid = [makeRow(1, { lateFee: new Prisma.Decimal(150) })];
      const tx = buildTx({ unpaid, stillUnpaid: 0 });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(1150) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '1150',
      });

      expect(template.execute).toHaveBeenCalledTimes(1);
      const jeInput = template.execute.mock.calls[0][0];
      // delta = owed = 1000 + 150 = 1150; lateFee 150 passed → primitive books Cr 42-1103.
      expect(jeInput.delta.toString()).toBe('1150');
      expect(jeInput.lateFee.toString()).toBe('150');
      expect(jeInput.isFinalReceipt).toBe(true);
    });

    it('lateFeeWaived → primitive receives lateFee=undefined (no 42-1103 booking)', async () => {
      const unpaid = [
        makeRow(1, { lateFee: new Prisma.Decimal(200), lateFeeWaived: true }),
      ];
      const tx = buildTx({ unpaid, stillUnpaid: 0 });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(1000) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '1000',
      });

      const jeInput = template.execute.mock.calls[0][0];
      // owed uses lateFee 0 (waived) → delta 1000, and lateFee is NOT passed.
      expect(jeInput.delta.toString()).toBe('1000');
      expect(jeInput.lateFee).toBeUndefined();
    });

    it('vat60dayJournalEntryId set → vat60Reversal.execute(installmentScheduleId, tx) fires after the receipt', async () => {
      const unpaid = [makeRow(1)];
      const tx = buildTx({
        unpaid,
        stillUnpaid: 0,
        instSchedResolver: () => ({
          id: 'inst-sched',
          vat60dayJournalEntryId: 'JE-VAT60-1',
        }),
      });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(1000) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '1000',
      });

      expect(template.execute).toHaveBeenCalledTimes(1);
      // The 60-day reversal posts in the SAME tx, keyed by installmentScheduleId.
      expect(vat60Reversal.execute).toHaveBeenCalledTimes(1);
      expect(vat60Reversal.execute).toHaveBeenCalledWith('inst-sched', tx);
    });

    it('no vat60 flag → vat60Reversal.execute NOT called', async () => {
      const unpaid = [makeRow(1)];
      const tx = buildTx({ unpaid, stillUnpaid: 0 });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(1000) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '1000',
      });

      expect(template.execute).toHaveBeenCalledTimes(1);
      expect(vat60Reversal.execute).not.toHaveBeenCalled();
    });

    it('installmentSchedule lookup null → execute NOT called for that snapshot (JE skipped, no throw)', async () => {
      const unpaid = [makeRow(1)];
      // No schedule row for this installment → impl logs warn + skips execute.
      const tx = buildTx({ unpaid, stillUnpaid: 0, instSchedResolver: () => null });
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(1000) }), tx });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '1000',
      });

      // Payment still fully paid; only the JE is skipped.
      expect(tx.payment.update.mock.calls[0][0].data.status).toBe('PAID');
      expect(template.execute).not.toHaveBeenCalled();
      expect(vat60Reversal.execute).not.toHaveBeenCalled();
    });

    it('no OWNER user → JE block skipped entirely (no execute) but Payment.update still happened', async () => {
      const unpaid = [makeRow(1)];
      const tx = buildTx({ unpaid, stillUnpaid: 0 });
      // owner=null → systemUserId null → JE guard (contractForJe && systemUserId) false.
      buildPrisma({ link: makeLink({ amount: new Prisma.Decimal(1000) }), tx, owner: null });
      await buildService();

      await service.handlePaymentCallback({
        refno,
        result_code: '00',
        order_no: 'o-1',
        transaction_id: 'tx-1',
        total: '1000',
      });

      expect(template.execute).not.toHaveBeenCalled();
      expect(tx.payment.update.mock.calls[0][0].data.status).toBe('PAID');
      // Alert raised about the missing OWNER.
      expect(Sentry.captureMessage as jest.Mock).toHaveBeenCalledWith(
        expect.stringContaining('no OWNER user'),
        expect.objectContaining({ level: 'error' }),
      );
    });
  });
});
