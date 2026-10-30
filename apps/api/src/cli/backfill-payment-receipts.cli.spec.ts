import type { PrismaService } from '../prisma/prisma.service';
import type { ReceiptIssuanceService } from '../modules/receipts/services/receipt-issuance.service';
import {
  backfillPaymentReceipts,
  findPaidPaymentsWithoutReceipt,
} from './backfill-payment-receipts.cli';

/**
 * Task 18 review m-2 — the catch-up receipt CLI must never issue a tax invoice for an installment
 * imported from the old back office (its pre-cutover money is booked in PEAK). Behaviour on real rows:
 * `legacy-import-nightly-checks.db.spec.ts` (stage 1 + 3).
 */
describe('backfill-payment-receipts CLI', () => {
  const queryRaw = jest.fn();
  const prisma = {
    $queryRaw: queryRaw,
    auditLog: { create: jest.fn() },
  } as unknown as PrismaService;

  beforeEach(() => queryRaw.mockReset().mockResolvedValue([]));

  it('candidate query always excludes imported legacy installments (no flag to include them)', async () => {
    await findPaidPaymentsWithoutReceipt(prisma);
    const sql = (queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toContain('p.legacy_installment_code IS NULL');
    expect(sql).toContain("p.status = 'PAID'");
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM receipts r WHERE r.payment_id = p.id)');
  });

  it('dry-run issues nothing', async () => {
    queryRaw.mockResolvedValueOnce([
      {
        id: 'p-1',
        contract_id: 'c-1',
        installment_no: 1,
        amount_paid: '1515.83',
        payment_method: 'CASH',
        gateway_ref: null,
        recorded_by_id: 'u-1',
        contract_number: 'BC-1',
        paid_date: null,
      },
    ]);
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
});
