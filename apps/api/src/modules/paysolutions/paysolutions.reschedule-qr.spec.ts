import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
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

// Same Sentry-transport stub the sibling specs use — captureException is
// asserted directly in the orphan test.
jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

/**
 * Unit spec for createRescheduleQR — the ปรับดิว collect-first intent (PR #1326,
 * owner directive 2026-07-02: เงินไม่เข้า ดิวไม่เลื่อน).
 *
 * Pins: the zero-collect guard (6b + no late fee → confirm directly, no QR),
 * the already-PAID guard, the single-outstanding-QR cancel (updateMany →
 * CANCELLED before create), the PartialPaymentLink row with purpose='RESCHEDULE'
 * + the frozen quote metadata the webhook later replays, the orphan-Sentry path
 * (gateway OK then DB create throws), and the best-effort LINE push (failure
 * swallowed → sentToLine=false, never aborts the QR).
 *
 * Late-fee config is pinned to BRACKET (tier1=50 / tier2=100 @ 3 days) via the
 * systemConfig mock so the server-authoritative quote is deterministic:
 *   monthlyPayment 1500, daysToShift 10 → fee = 1500/30×10 = 500 (ROUND_UP)
 *   dueDate 5.5 days ago → 5 whole days overdue → tier2 lateFee = 100
 *   6a (SPLIT)  → collect 600  |  6b (SINGLE) → collect 100
 */
describe('PaySolutionsService — createRescheduleQR (ปรับดิว collect-first)', () => {
  let service: PaySolutionsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let lineOa: { pushMessage: jest.Mock; sendFlexMessage: jest.Mock };
  let fetchSpy: jest.SpyInstance;

  const paymentId = 'pay-rs-1';
  const requestedById = 'user-owner-1';

  // A canonical Pay Solutions v2 success body.
  function gatewayOk(redirectUrl = 'https://pay.example/redirect') {
    return {
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        redirectUrl,
        transactionId: 'GW-TX-1',
        refNo: 'GW-REF-1',
        status: 'success',
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  function buildPrisma(paymentOverrides: Record<string, unknown> = {}): void {
    prisma = {
      payment: {
        findUnique: jest.fn().mockResolvedValue({
          id: paymentId,
          deletedAt: null,
          status: 'PENDING',
          installmentNo: 5,
          contractId: 'ct-rs-1',
          // 5.5 days ago → 5 whole days overdue → BRACKET tier2 (100฿).
          dueDate: new Date(Date.now() - 5.5 * 86_400_000),
          amountDue: new Prisma.Decimal(1500),
          lateFeeWaived: false,
          contract: {
            contractNumber: 'CT-2026-0009',
            monthlyPayment: new Prisma.Decimal(1500),
            customer: { id: 'cust-rs-1', email: 'c@example.com', name: 'ลูกค้า', lineIdFinance: null },
          },
          ...paymentOverrides,
        }),
      },
      // loadLateFeeConfig reads 7 keys — pin BRACKET so the quote is deterministic.
      systemConfig: {
        findUnique: jest.fn().mockImplementation(({ where: { key } }: { where: { key: string } }) => {
          const map: Record<string, string> = {
            late_fee_mode: 'BRACKET',
            late_fee_tier1_amount: '50',
            late_fee_tier2_amount: '100',
            late_fee_tier2_min_days: '3',
          };
          return Promise.resolve(map[key] ? { value: map[key] } : null);
        }),
      },
      partialPaymentLink: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'ppl-rs-1' }),
      },
    };
  }

  async function buildService(): Promise<void> {
    lineOa = {
      sendFlexMessage: jest.fn().mockResolvedValue(undefined),
      pushMessage: jest.fn().mockResolvedValue(undefined),
    };
    const integrationConfig = {
      getValue: jest.fn().mockImplementation((_ns: string, key: string) => {
        const map: Record<string, string> = {
          merchantId: 'MID-123',
          secretKey: 'SK-123',
          apiKey: 'AK-123',
          apiUrl: 'https://apis.paysolutions.test',
          terminalId: 'TID-XYZ',
        };
        return Promise.resolve(map[key] ?? '');
      }),
    } as Partial<IntegrationConfigService>;
    const config = {
      get: jest.fn().mockImplementation((_k: string, def?: string) => def ?? ''),
    } as Partial<ConfigService>;

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        PaySolutionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: LineOaService, useValue: lineOa },
        { provide: IntegrationConfigService, useValue: integrationConfig },
        { provide: OnlineOrderSaleAdapter, useValue: {} },
        { provide: ProductsService, useValue: {} },
        { provide: JournalAutoService, useValue: {} },
        { provide: PaymentReceiptTemplate, useValue: { execute: jest.fn() } },
        { provide: Vat60dayReversalTemplate, useValue: { execute: jest.fn() } },
        { provide: PaymentsService, useValue: { recordPayment: jest.fn() } },
      ],
    }).compile();

    service = mod.get<PaySolutionsService>(PaySolutionsService);
  }

  /** Parse the JSON body the service POSTed to the gateway in the latest fetch. */
  function lastGatewayPayload(): Record<string, unknown> {
    const body = fetchSpy.mock.calls[0][1].body as string;
    return JSON.parse(body) as Record<string, unknown>;
  }

  beforeEach(() => {
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it('zero-collect (6b + waived late fee) → BadRequest "ยืนยันปรับดิวได้โดยตรง", no gateway call, no link cancel', async () => {
    buildPrisma({ lateFeeWaived: true }); // 6b collects lateFee only → 0
    await buildService();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(gatewayOk());

    const err = await service
      .createRescheduleQR({ paymentId, daysToShift: 10, splitMode: 'SINGLE', requestedById })
      .then(() => null)
      .catch((e: Error) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain('ยืนยันปรับดิวได้โดยตรง');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.partialPaymentLink.updateMany).not.toHaveBeenCalled();
    expect(prisma.partialPaymentLink.create).not.toHaveBeenCalled();
  });

  it('payment already PAID → BadRequest, no gateway call', async () => {
    buildPrisma({ status: 'PAID' });
    await buildService();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(gatewayOk());

    const err = await service
      .createRescheduleQR({ paymentId, daysToShift: 10, splitMode: 'SPLIT', requestedById })
      .then(() => null)
      .catch((e: Error) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain('ชำระครบแล้ว');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.partialPaymentLink.create).not.toHaveBeenCalled();
  });

  it('cancels prior ACTIVE PartialPaymentLink rows (→ CANCELLED) BEFORE creating the new link', async () => {
    buildPrisma();
    await buildService();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(gatewayOk());

    await service.createRescheduleQR({ paymentId, daysToShift: 10, splitMode: 'SPLIT', requestedById });

    // Single-outstanding-QR rule — BOTH purposes cancelled (stale partial QR
    // racing a reschedule QR would double-charge).
    expect(prisma.partialPaymentLink.updateMany).toHaveBeenCalledWith({
      where: { paymentId, status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'CANCELLED', cancelledAt: expect.any(Date) }),
    });
    expect(prisma.partialPaymentLink.create).toHaveBeenCalledTimes(1);
    expect(prisma.partialPaymentLink.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.partialPaymentLink.create.mock.invocationCallOrder[0],
    );
  });

  it('6a (SPLIT): gateway amount = fee+lateFee, link has purpose=RESCHEDULE + frozen quote metadata', async () => {
    buildPrisma();
    await buildService();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(gatewayOk());

    const res = await service.createRescheduleQR({
      paymentId,
      daysToShift: 10,
      splitMode: 'SPLIT',
      requestedById,
    });

    // Server-authoritative quote: fee 500 + lateFee 100 = collect 600.
    const payload = lastGatewayPayload();
    expect(payload.amount).toBe(600);
    expect(payload.paymentChannel).toBe('Qrcode');
    expect(payload.paymentGateway).toBe('Promptpay');
    expect(payload.description).toContain('ปรับดิวงวด 5');
    expect(payload.postbackUrl).toContain('/api/paysolutions/webhook');

    // The link row the webhook later routes through rescheduleWithCollect.
    expect(prisma.partialPaymentLink.create).toHaveBeenCalledTimes(1);
    const linkData = prisma.partialPaymentLink.create.mock.calls[0][0].data;
    expect(linkData.paymentId).toBe(paymentId);
    expect(linkData.contractId).toBe('ct-rs-1');
    expect(linkData.customerId).toBe('cust-rs-1');
    expect(linkData.amount).toBe(600);
    expect(linkData.gatewayRef).toBe('GW-REF-1');
    expect(linkData.status).toBe('ACTIVE');
    expect(linkData.purpose).toBe('RESCHEDULE');
    // Frozen quote — the webhook must execute EXACTLY what the cashier quoted.
    expect(linkData.metadata).toEqual({
      daysToShift: 10,
      splitMode: 'SPLIT',
      rescheduleFee: '500',
      lateFee: '100',
      collectAmount: '600',
      requestedById,
    });

    expect(res.partialPaymentLinkId).toBe('ppl-rs-1');
    expect(res.paymentUrl).toBe('https://pay.example/redirect');
    expect(typeof res.orderRef).toBe('string');
    expect(res.sentToLine).toBe(false); // no lineIdFinance
    expect(res.collectAmount).toBe('600.00');
    expect(res.rescheduleFee).toBe('500.00');
    expect(res.lateFee).toBe('100.00');
  });

  it('6b (SINGLE): collects the late fee ONLY (fee rides the next installment) but still freezes the fee in metadata', async () => {
    buildPrisma();
    await buildService();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(gatewayOk());

    const res = await service.createRescheduleQR({
      paymentId,
      daysToShift: 10,
      splitMode: 'SINGLE',
      requestedById,
    });

    expect(lastGatewayPayload().amount).toBe(100);
    const linkData = prisma.partialPaymentLink.create.mock.calls[0][0].data;
    expect(linkData.amount).toBe(100);
    expect(linkData.metadata).toEqual({
      daysToShift: 10,
      splitMode: 'SINGLE',
      rescheduleFee: '500',
      lateFee: '100',
      collectAmount: '100',
      requestedById,
    });
    expect(res.collectAmount).toBe('100.00');
    expect(res.rescheduleFee).toBe('500.00');
    expect(res.lateFee).toBe('100.00');
  });

  it('orphan path: gateway OK then PartialPaymentLink.create throws → Sentry critical=paysolutions-reschedule-orphan + InternalServerError', async () => {
    buildPrisma();
    prisma.partialPaymentLink.create.mockRejectedValueOnce(new Error('DB down'));
    await buildService();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(gatewayOk());

    await expect(
      service.createRescheduleQR({ paymentId, daysToShift: 10, splitMode: 'SPLIT', requestedById }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(Sentry.captureException as jest.Mock).toHaveBeenCalledTimes(1);
    const opts = (Sentry.captureException as jest.Mock).mock.calls[0][1];
    expect(opts.level).toBe('fatal');
    expect(opts.tags.critical).toBe('paysolutions-reschedule-orphan');
  });

  it('LINE push failure is swallowed: resolves with sentToLine=false, link still created, no Sentry', async () => {
    buildPrisma({
      contract: {
        contractNumber: 'CT-2026-0009',
        monthlyPayment: new Prisma.Decimal(1500),
        customer: {
          id: 'cust-rs-1',
          email: 'c@example.com',
          name: 'ลูกค้า',
          lineIdFinance: 'U1234567890abcdef',
        },
      },
    });
    await buildService();
    lineOa.pushMessage.mockRejectedValue(new Error('LINE OA down'));
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(gatewayOk());

    const res = await service.createRescheduleQR({
      paymentId,
      daysToShift: 10,
      splitMode: 'SPLIT',
      requestedById,
    });

    expect(lineOa.pushMessage).toHaveBeenCalledTimes(1);
    expect(res.sentToLine).toBe(false);
    expect(res.partialPaymentLinkId).toBe('ppl-rs-1');
    expect(Sentry.captureException as jest.Mock).not.toHaveBeenCalled();
  });

  it('LINE push success: sentToLine=true, Flex pushed via the FINANCE channel', async () => {
    buildPrisma({
      contract: {
        contractNumber: 'CT-2026-0009',
        monthlyPayment: new Prisma.Decimal(1500),
        customer: {
          id: 'cust-rs-1',
          email: 'c@example.com',
          name: 'ลูกค้า',
          lineIdFinance: 'U1234567890abcdef',
        },
      },
    });
    await buildService();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(gatewayOk());

    const res = await service.createRescheduleQR({
      paymentId,
      daysToShift: 10,
      splitMode: 'SPLIT',
      requestedById,
    });

    expect(lineOa.pushMessage).toHaveBeenCalledWith(
      'U1234567890abcdef',
      [expect.objectContaining({ type: 'flex' })],
      'line-finance',
    );
    expect(res.sentToLine).toBe(true);
  });
});
