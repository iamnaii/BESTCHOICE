import type { PrismaService } from '../prisma/prisma.service';
import { PAID_BY_EARLY_PAYOFF } from '../modules/data-audit/services/payment-backing';
import type { ReceiptIssuanceService } from '../modules/receipts/services/receipt-issuance.service';
import {
  backfillPaymentReceipts,
  findBoundReissueCandidates,
  findDocumentedElsewhere,
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
    cleared_by_schedule: false,
    paid_by_payoff: false,
  };
  const boundRow = {
    id: 'p-2',
    contract_id: 'c-1',
    installment_no: 2,
    amount_paid: '1515.83',
    contract_number: 'BC-1',
    entries: [{ entryNumber: 'JE-202605-0007', receiptAmount: '1515.83' }],
    unbound_receipts: 0,
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

  it('Task 23 review m-1 · Task 25 r-1 — the population query flags paths (b) schedule clearing and (c) rows the early payoff paid, of orphan_payments (shared rules)', async () => {
    await findPaidPaymentsWithoutReceipt(prisma);
    const sql = sqlOf(0);
    expect(sql).toContain(
      'EXISTS (SELECT 1 FROM cleared_schedule b WHERE b.id = s.id) AS cleared_by_schedule',
    );
    expect(sql).toContain("je.metadata->>'installmentScheduleId'"); // SCHEDULE_ROWS_CLEARED_BY_ENTRY
    expect(sql).toContain('AS paid_by_payoff');
    // (c) per row — not every row of a paid-off contract (a row PAID before the payoff stays a candidate)
    expect(sql).not.toContain('paid_off_contract');
    expect(queryRaw.mock.calls[0]).toContain(PAID_BY_EARLY_PAYOFF);
  });

  it('Task 25 (r-1) — rows under path b / c / b+c are never issued: listed as [documented elsewhere] with paymentId + path, counted, on dry-run and live run alike', async () => {
    const flagged = (id: string, no: number, b: boolean, c: boolean) => ({
      ...cliRow,
      id,
      installment_no: no,
      cleared_by_schedule: b,
      paid_by_payoff: c,
    });
    const population = [
      cliRow,
      flagged('p-b', 2, true, false),
      flagged('p-c', 3, false, true),
      flagged('p-bc', 4, true, true),
    ];
    queryRaw.mockResolvedValueOnce(population).mockResolvedValueOnce(population);
    expect((await findPaidPaymentsWithoutReceipt(prisma)).map((r) => r.id)).toEqual(['p-1']);
    expect(
      (await findDocumentedElsewhere(prisma)).map((r) => [r.id, r.installment_no, r.path]),
    ).toEqual([
      ['p-b', 2, 'b'],
      ['p-c', 3, 'c'],
      ['p-bc', 4, 'b+c'],
    ]);

    for (const dryRun of [true, false]) {
      queryRaw.mockReset().mockResolvedValueOnce(population).mockResolvedValueOnce([boundRow]);
      const generateReceipt = jest.fn().mockResolvedValue({ id: 'r-1' });
      const lines: string[] = [];
      const log = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(args.join(' '));
      });
      const result = await backfillPaymentReceipts(
        prisma,
        { generateReceipt } as unknown as ReceiptIssuanceService,
        { dryRun, fallbackIssuerId: null },
      );
      log.mockRestore();
      expect([result.candidates, result.documentedElsewhere]).toEqual([1, 3]);
      expect(result.totalAmount.toFixed(2)).toBe('1515.83'); // skipped rows are not CLI money
      expect(generateReceipt.mock.calls.map((c) => c[1])).toEqual(dryRun ? [] : ['p-1']);
      expect(lines.filter((l) => l.includes('[documented elsewhere]'))).toEqual([
        expect.stringMatching(/paymentId=p-b .*path=b$/),
        expect.stringMatching(/paymentId=p-c .*path=c$/),
        expect.stringMatching(/paymentId=p-bc .*path=b\+c$/),
      ]);
      expect(lines.some((l) => l.includes('3 payment(s) skipped (b=1 · c=1 · b+c=1)'))).toBe(true);
      expect(result.documentedElsewhereByPath).toEqual({ b: 1, c: 1, 'b+c': 1 });
      // review nit 3: the lists to act on come first — bound re-issue, then the CLI's own rows — and the
      // (ever-growing) documented-elsewhere block last, in full
      const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
      const candidateLine = at(dryRun ? 'paymentId=p-1 ' : 'CREATED paymentId=p-1');
      expect(at('[bound re-issue]')).toBeGreaterThanOrEqual(0);
      expect(candidateLine).toBeGreaterThan(at('[bound re-issue]'));
      expect(at('payment(s) skipped')).toBeGreaterThan(candidateLine);
      expect(at('[documented elsewhere]')).toBeGreaterThan(at('payment(s) skipped'));
    }
  });

  it('Task 25 (m-2) — bound re-issue list is per receipt ENTRY: a live entry of a PAID installment with no receipt bound to it (the runbook SQL rule) · before PR3 (no receiptTax) only while the payment has no receipt at all · imported rows included', async () => {
    await findBoundReissueCandidates(prisma);
    const sql = sqlOf(0);
    expect(sql).toContain('FROM journal_entries je');
    expect(sql).toContain("JOIN payments p ON p.id = je.metadata->>'paymentId'");
    expect(sql).toContain("p.status = 'PAID'");
    expect(sql).toContain('WHERE r.source_journal_entry_id = je.id AND r.deleted_at IS NULL)');
    expect(sql).toContain("je.metadata->'receiptTax' IS NOT NULL");
    expect(sql).toContain('OR NOT EXISTS (SELECT 1 FROM receipts r WHERE r.payment_id = p.id)');
    expect(sql).toContain("je.metadata->'receiptTax'->>'amount'");
    expect(sql).toContain('AS unbound_receipts');
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
    const boundSecond = {
      ...boundRow,
      id: 'p-3',
      installment_no: 3,
      entries: [
        { entryNumber: 'JE-202605-0008', receiptAmount: '1000.00' },
        { entryNumber: 'JE-202605-0009', receiptAmount: '515.83' },
      ],
      unbound_receipts: 1,
    };
    queryRaw.mockResolvedValueOnce([cliRow]).mockResolvedValueOnce([boundRow, boundSecond]);
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
    expect([
      result.candidates,
      result.created,
      result.boundReissue,
      result.boundReissueEntries,
    ]).toEqual([1, 1, 2, 3]);
    expect(result.totalAmount.toFixed(2)).toBe('1515.83'); // bound rows are not CLI money
    const bound = lines.filter((l) => l.includes('paymentId=p-2'));
    expect(bound).toHaveLength(1);
    expect(bound[0]).toContain('JE-202605-0007');
    expect(bound[0]).toContain('1515.83');
    expect(bound[0]).not.toContain('unboundReceipts');
    // Task 25 (m-2): the known false positive of the per-entry rule is flagged on the line
    const second = lines.filter((l) => l.includes('paymentId=p-3'));
    expect(second).toHaveLength(1);
    expect(second[0]).toContain('JE-202605-0008 (receiptTax.amount=1000.00), JE-202605-0009');
    expect(second[0]).toContain('unboundReceipts=1');
  });
});
