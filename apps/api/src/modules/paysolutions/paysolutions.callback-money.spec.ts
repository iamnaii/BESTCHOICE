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
import { PaymentReceipt2BTemplate } from '../journal/cpa-templates/payment-receipt-2b.template';
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
 *        - OVERPAY (2500 over [1000,1000]) → both PAID, 500 surplus DROPPED
 *          (QUIRK: silent over-collection, locked + flagged)
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
 *   6. in-tx 2B JE (1240-1277)
 *        - prior-partial (amountPaid 400 + 600 delta) posts amountReceived='1000'
 *          (cumulative, NOT 600 delta — locked over-post + flagged, the I2 TODO)
 *        - 3 closed installments → execute called 3x
 *        - installmentSchedule lookup null → execute NOT called for that snapshot
 *
 * Expected values are hand-traced from the implementation; we assert CURRENT
 * behaviour only. Money is Prisma.Decimal — compared via .toString().
 */
describe('PaySolutionsService.handlePaymentCallback — FIFO money + close (characterization)', () => {
  let service: PaySolutionsService;
  // Hand-mocked Prisma surface — only the members handlePaymentCallback touches.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let txMock: any;
  let products: { transferOwnership: jest.Mock };
  let template2B: { execute: jest.Mock };
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
    instSchedResolver?: (installmentNo: number) => { id: string } | null;
  }) {
    const instSchedResolver =
      opts.instSchedResolver ?? (() => ({ id: 'inst-sched' }));
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findUnique: jest.fn().mockImplementation((args: any) => {
          const instNo =
            args.where.contractId_installmentNo.installmentNo as number;
          return Promise.resolve(instSchedResolver(instNo));
        }),
      },
    };
    return txMock;
  }

  async function buildService(): Promise<void> {
    products = { transferOwnership: jest.fn().mockResolvedValue(undefined) };
    template2B = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-MOCK' }) };

    const lineOa = {} as Partial<LineOaService>;
    const integrationConfig = {
      getValue: jest.fn().mockResolvedValue(''),
    } as Partial<IntegrationConfigService>;
    const config = {
      get: jest.fn().mockImplementation((_k: string, def?: string) => def ?? ''),
    } as Partial<ConfigService>;
    const saleAdapter = {} as Partial<OnlineOrderSaleAdapter>;
    const journalAuto = {
      createPaymentJournal: jest.fn().mockResolvedValue('je-1'),
    } as Partial<JournalAutoService>;

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        PaySolutionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: LineOaService, useValue: lineOa },
        { provide: IntegrationConfigService, useValue: integrationConfig },
        { provide: OnlineOrderSaleAdapter, useValue: saleAdapter },
        { provide: ProductsService, useValue: products },
        { provide: JournalAutoService, useValue: journalAuto },
        { provide: PaymentReceipt2BTemplate, useValue: template2B },
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

    it('QUIRK overpay: paidAmount=2500 over [1000,1000] → both PAID, 500 surplus silently DROPPED', async () => {
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

      // Only two installments exist — both fully paid at 1000. The remaining
      // 500 is NOT credited anywhere (no creditBalance, no advance row). The
      // loop simply exits (no more unpaidPayments). LOCK this leak.
      expect(tx.payment.update).toHaveBeenCalledTimes(2);
      expect(tx.payment.update.mock.calls[0][0].data.amountPaid.toString()).toBe(
        '1000',
      );
      expect(tx.payment.update.mock.calls[1][0].data.amountPaid.toString()).toBe(
        '1000',
      );
      // 2 fully-paid in one webhook → EARLY_PAYOFF close; creditBalance forced 0
      // (does NOT capture the 500 surplus).
      const closeArg = tx.contract.update.mock.calls[0][0];
      expect(closeArg.data.status).toBe('EARLY_PAYOFF');
      expect(closeArg.data.creditBalance).toBe(0);
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
      expect(template2B.execute).not.toHaveBeenCalled();
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
      expect(template2B.execute).not.toHaveBeenCalled();
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
  // 6) in-tx 2B JE post
  // ---------------------------------------------------------------------------
  describe('in-tx PaymentReceipt2B JE', () => {
    it('QUIRK prior-partial: amountPaid 400 + 600 delta posts amountReceived="1000" (cumulative, NOT 600)', async () => {
      // Installment already had a 400 partial. A 600 payment closes it.
      // The JE snapshot uses cumulative amountPaid (1000), NOT the 600 delta —
      // the documented PR-843/I2 over-post limitation. LOCK it.
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
      // JE posts amountReceived = cumulative 1000 (the over-post quirk).
      expect(template2B.execute).toHaveBeenCalledTimes(1);
      const [jeInput, outerTx] = template2B.execute.mock.calls[0];
      expect(jeInput.amountReceived.toString()).toBe('1000');
      expect(jeInput.installmentScheduleId).toBe('inst-sched');
      expect(jeInput.depositAccountCode).toBe('11-1202');
      expect(jeInput.existingPaymentId).toBe('pay-1');
      // JE shares the outer serializable tx (atomicity).
      expect(outerTx).toBe(tx);
    });

    it('3 closed installments → execute called 3x (one JE per fully-paid snapshot)', async () => {
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

      expect(template2B.execute).toHaveBeenCalledTimes(3);
      // Each JE posts its own installment's cumulative amount (1000) + schedule id.
      for (const call of template2B.execute.mock.calls) {
        expect(call[0].amountReceived.toString()).toBe('1000');
        expect(call[1]).toBe(tx);
      }
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
      expect(template2B.execute).not.toHaveBeenCalled();
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

      expect(template2B.execute).not.toHaveBeenCalled();
      expect(tx.payment.update.mock.calls[0][0].data.status).toBe('PAID');
      // Alert raised about the missing OWNER.
      expect(Sentry.captureMessage as jest.Mock).toHaveBeenCalledWith(
        expect.stringContaining('no OWNER user'),
        expect.objectContaining({ level: 'error' }),
      );
    });
  });
});
