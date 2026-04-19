import { Test, TestingModule } from '@nestjs/testing';
import {
  BankLine,
  BankReconciliationService,
} from './bank-reconciliation.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
}));

import * as Sentry from '@sentry/node';

describe('BankReconciliationService.reconcileLines', () => {
  let service: BankReconciliationService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const mkLine = (overrides: Partial<BankLine> = {}): BankLine => ({
    amount: 5000,
    valueDate: new Date('2026-04-15'),
    reference: 'REF-001',
    description: 'transfer from customer',
    ...overrides,
  });

  beforeEach(async () => {
    (Sentry.captureMessage as jest.Mock).mockClear();
    prisma = {
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        BankReconciliationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(BankReconciliationService);
  });

  it('returns an empty summary for zero lines', async () => {
    const result = await service.reconcileLines([], 'user-1');
    expect(result.totalLines).toBe(0);
    expect(result.matched).toBe(0);
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
  });

  it('matches a line via gatewayRef even when multiple amount candidates exist', async () => {
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pay-A', amountPaid: 5000, paidDate: new Date('2026-04-15'), gatewayRef: 'REF-001', paymentMethod: 'BANK_TRANSFER' },
      { id: 'pay-B', amountPaid: 5000, paidDate: new Date('2026-04-15'), gatewayRef: 'REF-999', paymentMethod: 'BANK_TRANSFER' },
    ]);

    const result = await service.reconcileLines([mkLine({ reference: 'REF-001' })], 'user-1');
    expect(result.matched).toBe(1);
    expect(result.details[0].paymentId).toBe('pay-A');
  });

  it('flags AMBIGUOUS when two candidates match amount+date with no ref hint', async () => {
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pay-A', amountPaid: 5000, paidDate: new Date('2026-04-15'), gatewayRef: null, paymentMethod: 'BANK_TRANSFER' },
      { id: 'pay-B', amountPaid: 5000, paidDate: new Date('2026-04-15'), gatewayRef: null, paymentMethod: 'BANK_TRANSFER' },
    ]);

    const result = await service.reconcileLines([mkLine({ reference: null })], 'user-1');
    expect(result.ambiguous).toBe(1);
    expect(result.details[0].status).toBe('AMBIGUOUS');
  });

  it('flags AMOUNT_MISMATCH when a ref match exists but the amount differs > tolerance', async () => {
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pay-X', amountPaid: 4000, paidDate: new Date('2026-04-15'), gatewayRef: 'REF-001', paymentMethod: 'BANK_TRANSFER' },
    ]);

    const result = await service.reconcileLines([mkLine({ amount: 5000 })], 'user-1');
    expect(result.amountMismatches).toBe(1);
    expect(result.details[0].paymentId).toBe('pay-X');
  });

  it('tolerates a 0.50฿ amount drift as MATCHED', async () => {
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pay-X', amountPaid: 5000.25, paidDate: new Date('2026-04-15'), gatewayRef: null, paymentMethod: 'BANK_TRANSFER' },
    ]);

    const result = await service.reconcileLines(
      [mkLine({ amount: 5000, reference: null })],
      'user-1',
    );
    expect(result.matched).toBe(1);
  });

  it('flags DUPLICATE when the same reference appears twice in one file', async () => {
    prisma.payment.findMany.mockResolvedValue([]);
    const result = await service.reconcileLines(
      [mkLine({ reference: 'DUP-1' }), mkLine({ reference: 'DUP-1', amount: 3000 })],
      'user-1',
    );
    expect(result.duplicates).toBe(2);
    expect(result.details.every((d) => d.status === 'DUPLICATE')).toBe(true);
  });

  it('marks UNMATCHED lines and counts their amount toward unmatchedAmount', async () => {
    prisma.payment.findMany.mockResolvedValue([]);
    const result = await service.reconcileLines([mkLine({ amount: 250 })], 'user-1');
    expect(result.unmatched).toBe(1);
    expect(result.unmatchedAmount).toBe(250);
  });

  it('does NOT fire Sentry when unmatched total is below the threshold', async () => {
    prisma.payment.findMany.mockResolvedValue([]);
    await service.reconcileLines([mkLine({ amount: 50 })], 'user-1'); // < 100฿ threshold
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('fires Sentry warning when unmatched total exceeds the threshold', async () => {
    prisma.payment.findMany.mockResolvedValue([]);
    await service.reconcileLines([mkLine({ amount: 500 })], 'user-1');
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringMatching(/mismatch exceeds threshold/),
      expect.objectContaining({
        level: 'warning',
        tags: expect.objectContaining({ kind: 'bank-reconciliation' }),
      }),
    );
  });

  it('respects a ±2 day paidDate window', async () => {
    prisma.payment.findMany.mockResolvedValue([
      // paidDate is 2 days before the bank valueDate — within tolerance
      { id: 'pay-A', amountPaid: 5000, paidDate: new Date('2026-04-13'), gatewayRef: null, paymentMethod: 'BANK_TRANSFER' },
    ]);
    const result = await service.reconcileLines([mkLine({ reference: null })], 'user-1');
    expect(result.matched).toBe(1);
  });
});
