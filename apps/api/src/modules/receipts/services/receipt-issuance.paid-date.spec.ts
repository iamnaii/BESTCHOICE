import { ReceiptIssuanceService } from './receipt-issuance.service';

/**
 * QA #1347 follow-up (2026-07-09): backdated payoff (JP4) stamped Payment.paidDate
 * + JE entry_date with the chosen date, but the receipt row hardcoded
 * `paidDate: new Date()` — the printed receipt showed "today" for money received
 * in a prior (open) period. generateReceipt now accepts the caller's paidDate.
 */
describe('ReceiptIssuanceService — paidDate stamping (QA #1347 follow-up)', () => {
  function buildService(created: Record<string, unknown>[], source?: Record<string, unknown>,
    auditCreate = jest.fn().mockResolvedValue({})) {
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
      auditLog: { findMany: jest.fn().mockResolvedValue([]), create: auditCreate },
      companyInfo: { findFirst: jest.fn().mockResolvedValue(null) },
      payment: { findUnique: jest.fn() },
      receipt: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(async (args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return { id: 'r1', ...args.data };
        }),
      },
      journalEntry: { findUnique: jest.fn().mockResolvedValue(source) },
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
  it('stamps the exact journal returned by payment posting when its number is provided', async () => {
    const created: Record<string, unknown>[] = [];
    const svc = buildService(created, {
      id: 'je-original', status: 'POSTED', deletedAt: null,
      metadata: { tag: 'receipt', contractId: 'c1', paymentId: 'p1' },
    });
    await svc.generateReceipt('c1', 'p1', 'INSTALLMENT', 1000, null, 'CASH', null, 'u1',
      new Date('2026-09-08T00:00:00Z'), 'JE-202609-12345');
    expect(created[0].sourceJournalEntryId).toBe('je-original');
  });

  it('links the exact reschedule-collect journal only to a RESCHEDULE_FEE receipt', async () => {
    const created: Record<string, unknown>[] = [];
    const svc = buildService(created, { id: 'je-reschedule', status: 'POSTED', deletedAt: null,
      metadata: { tag: 'reschedule-collect', contractId: 'c1', paymentId: 'p1' } });
    await svc.generateReceipt('c1', 'p1', 'RESCHEDULE_FEE', 1144, null, 'CASH', null, 'u1', undefined, 'JE-RD-1');
    expect(created[0].sourceJournalEntryId).toBe('je-reschedule');
    await expect(svc.generateReceipt('c1', 'p1', 'INSTALLMENT', 1144, null, 'CASH', null, 'u1', undefined, 'JE-RD-1')).rejects.toThrow('ไม่พบรายการบัญชีรับชำระ');
    expect(created).toHaveLength(1);
  });

  it.each([['other-contract', 'p1'], ['c1', 'other-payment']])('rejects a reschedule source linked to %s / %s', async (contractId, paymentId) => {
    const created: Record<string, unknown>[] = [];
    const svc = buildService(created, { id: 'je-wrong', status: 'POSTED', deletedAt: null,
      metadata: { tag: 'reschedule-collect', contractId, paymentId } });
    await expect(svc.generateReceipt('c1', 'p1', 'RESCHEDULE_FEE', 1144, null, 'CASH', null, 'u1', undefined, 'JE-RD-1')).rejects.toThrow('ไม่พบรายการบัญชีรับชำระ');
    expect(created).toHaveLength(0);
  });

  it('rejects a source JE belonging to another payment before creating the receipt', async () => {
    const created: Record<string, unknown>[] = [];
    const svc = buildService(created, {
      id: 'je-other', status: 'POSTED', deletedAt: null,
      metadata: { tag: 'receipt', contractId: 'c1', paymentId: 'p2' },
    });
    await expect(svc.generateReceipt('c1', 'p1', 'INSTALLMENT', 1000, null, 'CASH', null, 'u1',
      new Date('2026-09-08T00:00:00Z'), 'JE-202609-OTHER')).rejects.toThrow(
      'ไม่พบรายการบัญชีรับชำระที่ตรงกับใบเสร็จ',
    );
    expect(created).toHaveLength(0);
  });

  it('stamps an explicit unknown balance inside the receipt transaction and propagates audit failures', async () => {
    const created: Record<string, unknown>[] = [];
    const auditCreate = jest.fn().mockRejectedValue(new Error('snapshot insert failed'));
    const svc = buildService(created, undefined, auditCreate);
    await expect(svc.generateReceipt('c1', null, 'INSTALLMENT', 1000, null, 'CASH', null, 'u1')).rejects.toThrow('snapshot insert failed');
    expect(auditCreate).toHaveBeenCalledWith({ data: {
      userId: 'u1', action: 'RECEIPT_DOCUMENT_BALANCE_V1', entity: 'receipt', entityId: 'r1',
      newValue: { version: 1, receiptId: 'r1', contractId: 'c1', receiptType: 'INSTALLMENT', contractTotalMonths: 10,
        documentRemainingBalance: null, documentRemainingMonths: null,
        documentInstallmentAmountDue: null, documentInstallmentAmountPaid: null },
    } });
  });

});
