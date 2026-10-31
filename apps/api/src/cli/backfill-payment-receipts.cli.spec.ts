import type { PrismaService } from '../prisma/prisma.service';
import type { ReceiptIssuanceService } from '../modules/receipts/services/receipt-issuance.service';
import {
  backfillPaymentReceipts,
  findBoundReissueCandidates,
  findPaidPaymentsWithoutReceipt,
} from './backfill-payment-receipts.cli';

/**
 * Task 18 review m-2 — the catch-up receipt CLI must never issue a tax invoice for an installment
 * imported from the old back office (its pre-cutover money is booked in PEAK).
 * Task 23 (m-2 part 2) — nor an UNBOUND document for a payment whose receipt journal entry is live: that
 * money already has its entry (receipt issuance failed after commit) and must get the receipt bound to it
 * (runbook "ออกใบเสร็จซ้ำ") — the CLI lists those instead of issuing. Behaviour on real rows:
 * `legacy-import-nightly-checks.db.spec.ts` (stage 1 + 3).
 */
describe('backfill-payment-receipts CLI', () => {
  const queryRaw = jest.fn();
  const prisma = {
    $queryRaw: queryRaw,
    auditLog: { create: jest.fn() },
  } as unknown as PrismaService;
  const sqlOf = (call: number) => JSON.stringify(queryRaw.mock.calls[call]);

  const cliRow = {
    id: 'p-1',
    contract_id: 'c-1',
    installment_no: 1,
    amount_paid: '1515.83',
    payment_method: 'CASH',
    gateway_ref: null,
    recorded_by_id: 'u-1',
    contract_number: 'BC-1',
    paid_date: null,
  };
  const boundRow = {
    id: 'p-2',
    contract_id: 'c-1',
    installment_no: 2,
    amount_paid: '1515.83',
    contract_number: 'BC-1',
    entries: [{ entryNumber: 'JE-202605-0007', receiptAmount: '1515.83' }],
  };

  beforeEach(() => queryRaw.mockReset().mockResolvedValue([]));

  it('candidate query always excludes imported legacy installments (no flag to include them)', async () => {
    await findPaidPaymentsWithoutReceipt(prisma);
    const sql = sqlOf(0);
    expect(sql).toContain('p.legacy_installment_code IS NULL');
    expect(sql).toContain("p.status = 'PAID'");
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM receipts r WHERE r.payment_id = p.id)');
  });

  it('Task 23 — candidate query excludes a payment with a live POSTED receipt entry bound to it (tags the bound re-issue binds · not reversed)', async () => {
    await findPaidPaymentsWithoutReceipt(prisma);
    const sql = sqlOf(0);
    expect(sql).toContain('AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE');
    expect(sql).toContain("je.metadata->>'paymentId' = p.id");
    expect(sql).toContain("je.status = 'POSTED'");
    expect(sql).toContain("COALESCE(je.metadata->>'reversed', 'false') <> 'true'");
    expect(queryRaw.mock.calls[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ values: expect.arrayContaining(['receipt', '2B']) }),
      ]),
    );
  });

  it('Task 23 — bound re-issue list = the same population WITH a live bound receipt entry (imported rows included — they re-issue bound too)', async () => {
    await findBoundReissueCandidates(prisma);
    const sql = sqlOf(0);
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM receipts r WHERE r.payment_id = p.id)');
    expect(sql).toContain('AND EXISTS (SELECT 1 FROM journal_entries je WHERE');
    expect(sql).toContain("je.metadata->'receiptTax'->>'amount'");
    expect(sql).not.toContain('legacy_installment_code');
  });

  it('dry-run issues nothing', async () => {
    queryRaw.mockResolvedValueOnce([cliRow]);
    const generateReceipt = jest.fn();
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const result = await backfillPaymentReceipts(
      prisma,
      { generateReceipt } as unknown as ReceiptIssuanceService,
      { dryRun: true, fallbackIssuerId: null },
    );
    log.mockRestore();
    expect([result.candidates, result.created, result.totalAmount.toFixed(2)]).toEqual([
      1,
      0,
      '1515.83',
    ]);
    expect(generateReceipt).not.toHaveBeenCalled();
  });

  it('Task 23 — live run issues only the rows without a receipt entry; bound re-issue rows are printed with their entry number and never issued', async () => {
    queryRaw.mockResolvedValueOnce([cliRow]).mockResolvedValueOnce([boundRow]);
    const generateReceipt = jest.fn().mockResolvedValue({ id: 'r-1' });
    const lines: string[] = [];
    const log = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.join(' '));
    });
    const result = await backfillPaymentReceipts(
      prisma,
      { generateReceipt } as unknown as ReceiptIssuanceService,
      { dryRun: false, fallbackIssuerId: null },
    );
    log.mockRestore();
    expect(generateReceipt).toHaveBeenCalledTimes(1);
    expect(generateReceipt.mock.calls[0][1]).toBe('p-1');
    expect([result.candidates, result.created, result.boundReissue]).toEqual([1, 1, 1]);
    expect(result.totalAmount.toFixed(2)).toBe('1515.83'); // bound rows are not CLI money
    const bound = lines.filter((l) => l.includes('paymentId=p-2'));
    expect(bound).toHaveLength(1);
    expect(bound[0]).toContain('JE-202605-0007');
    expect(bound[0]).toContain('1515.83');
  });
});
