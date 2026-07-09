import { ReceiptIssuanceService } from './receipt-issuance.service';

/**
 * QA #1347 follow-up (2026-07-09): backdated payoff (JP4) stamped Payment.paidDate
 * + JE entry_date with the chosen date, but the receipt row hardcoded
 * `paidDate: new Date()` — the printed receipt showed "today" for money received
 * in a prior (open) period. generateReceipt now accepts the caller's paidDate.
 */
describe('ReceiptIssuanceService — paidDate stamping (QA #1347 follow-up)', () => {
  function buildService(created: Record<string, unknown>[]) {
    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          deletedAt: null,
          customer: { name: 'ลูกค้าทดสอบ' },
          payments: [],
          financedAmount: '10000',
          totalMonths: 10,
        }),
      },
      companyInfo: { findFirst: jest.fn().mockResolvedValue(null) },
      payment: { findUnique: jest.fn() },
      receipt: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(async (args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return { id: 'r1', ...args.data };
        }),
      },
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    } as never;
    const numbers = {
      generateReceiptNumber: jest.fn().mockResolvedValue('RT-202607-00001'),
    } as never;
    return new ReceiptIssuanceService(prisma, undefined, numbers);
  }

  it('stamps receipt.paidDate with the caller-supplied paidDate (backdated payoff)', async () => {
    const created: Record<string, unknown>[] = [];
    const svc = buildService(created);
    const backdate = new Date('2026-06-15T00:00:00.000Z');

    await svc.generateReceipt('c1', null, 'EARLY_PAYOFF', 1000, null, 'CASH', null, 'u1', backdate);

    expect(created).toHaveLength(1);
    expect(created[0].paidDate).toEqual(backdate);
  });

  it('defaults paidDate to now when the caller does not supply one (existing behavior)', async () => {
    const created: Record<string, unknown>[] = [];
    const svc = buildService(created);
    const before = Date.now();

    await svc.generateReceipt('c1', null, 'INSTALLMENT', 1000, null, 'CASH', null, 'u1');

    expect(created).toHaveLength(1);
    const stamped = created[0].paidDate as Date;
    expect(stamped.getTime()).toBeGreaterThanOrEqual(before);
    expect(stamped.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
