import { Prisma } from '@prisma/client';
import { ContractPaymentService } from './contract-payment.service';

/**
 * Characterization (golden) test for ContractPaymentService.getEarlyPayoffQuote —
 * the EARLY-PAYOFF computation: remaining principal/gross, reversal of the
 * unearned (deferred) interest, the early-payoff discount, and the final
 * settlement (payoff) amount.
 *
 * A prior bug here was a 100× discount UNIT mismatch: the JE-preview discount
 * is computed from the fraction form of discountPct (0..1, e.g. 0.5 for 50%),
 * while the value RETURNED to callers is the percentage form (0..100). This
 * test pins BOTH the discount unit and the exact computed payoff so the two
 * paths can never silently drift by a factor of 100 again.
 *
 * Pure mock-based unit test — the service is constructed directly with plain
 * mock deps; no real DB. Only getEarlyPayoffQuote is exercised, so the journal/
 * product/template collaborators are never actually invoked.
 *
 * ── Concrete scenario (self-consistent FINANCE installment contract) ─────────
 *   totalMonths      = 12
 *   sellingPrice     = 20000, downPayment = 2000  → true principal = 18000
 *   financedAmount   = 18000 (ยอดจัด base for JE gross)
 *   storeCommission  = 1800  (= 18000 × 10%)
 *   interestTotal    = 1800  (flat)
 *   vatAmount        = 1512  (= (18000+1800+1800) × 7%)
 *   monthlyPayment   = 1926  (= (21600 grossExclVat + 1512 vat) / 12, incl VAT)
 *   creditBalance    = 0, vatPct = 0.07
 *   6 installments PAID → 6 remaining
 *   discountPct      = default (50% → fraction 0.5)
 */
describe('ContractPaymentService.getEarlyPayoffQuote (early-payoff golden)', () => {
  const dec = (v: string | number) => new Prisma.Decimal(v);

  // ── Contract fixture (mirrors findOne includes; only fields the math reads) ──
  const contract = {
    id: 'contract-ep-1',
    status: 'ACTIVE',
    deletedAt: null,
    totalMonths: 12,
    monthlyPayment: dec('1926.00'),
    creditBalance: dec('0'),
    vatPct: dec('0.07'),
    sellingPrice: dec('20000'),
    downPayment: dec('2000'),
    storeCommission: dec('1800'),
    financedAmount: dec('18000'),
    interestTotal: dec('1800'),
    vatAmount: dec('1512.00'),
    // 6 PAID + 6 unpaid payment rows. Only status/installmentNo/amountPaid/
    // lateFee/lateFeeWaived are read by the quote.
    payments: [
      ...Array.from({ length: 6 }, (_, i) => ({
        installmentNo: i + 1,
        status: 'PAID',
        amountPaid: dec('1926.00'),
        amountDue: dec('1926.00'),
        lateFee: dec('0'),
        lateFeeWaived: false,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        installmentNo: i + 7,
        status: 'PENDING',
        amountPaid: dec('0'),
        amountDue: dec('1926.00'),
        lateFee: dec('0'),
        lateFeeWaived: false,
      })),
    ],
  };

  // installmentSchedule rows: 12 distinct installment numbers (1..12).
  const installmentSchedules = Array.from({ length: 12 }, (_, i) => ({
    installmentNo: i + 1,
  }));

  let prisma: {
    contract: { findUnique: jest.Mock };
    installmentSchedule: { findMany: jest.Mock };
    chartOfAccount: { findMany: jest.Mock };
  };
  let service: ContractPaymentService;

  beforeEach(() => {
    prisma = {
      contract: { findUnique: jest.fn().mockResolvedValue(contract) },
      installmentSchedule: { findMany: jest.fn().mockResolvedValue(installmentSchedules) },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
    };

    service = new ContractPaymentService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      // ProductsService / JournalAutoService / EarlyPayoffJP4Template are never
      // touched by getEarlyPayoffQuote — empty mocks are sufficient.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any, // ShopCollectSettlementTemplate never invoked by getEarlyPayoffQuote
    );
  });

  it('reverses the full remaining deferred interest (unearned interest reversal)', async () => {
    const quote = await service.getEarlyPayoffQuote(contract.id);

    // 6 of 12 installments remain. interestPerInst = 1800/12 = 150.00.
    // Remaining deferred interest reversed = 150.00 × 6 = 900.00.
    const interestLine = quote.journalPreview.lines.find((l) => l.accountCode === '11-2106');
    expect(interestLine?.debit).toBe('900.00');
  });

  it('computes the early-payoff discount from the FRACTION form of discountPct (0..1, not 0..100)', async () => {
    const quote = await service.getEarlyPayoffQuote(contract.id);

    // discount = remainingDeferredInterest (900.00) × 0.5 (fraction) = 450.00.
    // SUSPECTED BUG GUARD: if the JE preview ever read the returned percentage
    // form (50) instead of the fraction (0.5), this would be 45000.00 — a 100×
    // overstatement. Pin 450.00 to lock the unit.
    const discountLine = quote.journalPreview.lines.find((l) => l.accountCode === '52-1106');
    expect(discountLine?.debit).toBe('450.00');
    expect(quote.discountAmount).toBe(450); // gross-profit path agrees (900 × 0.5)
  });

  it('returns discountPct in PERCENTAGE form (0..100) to the caller', async () => {
    const quote = await service.getEarlyPayoffQuote(contract.id);
    // Internally a fraction 0.5; surfaced to the API as 50.
    expect(quote.discountPct).toBe(50);
  });

  it('computes the final settlement (cash payoff line) = remainingGross − discount + remainingVat', async () => {
    const quote = await service.getEarlyPayoffQuote(contract.id);

    // remainingGross (excl VAT) = 1800.00 × 6 = 10800.00
    // remainingDeferredVat       = (1512/12 = 126.00) × 6 = 756.00
    // settlement = 10800.00 − 450.00 + 756.00 = 11106.00
    const cashLine = quote.journalPreview.lines.find((l) => l.accountCode === '11-1101');
    expect(cashLine?.debit).toBe('11106.00');

    // Top-level payoff (remainingBalance 11556 − discount 450, no late fees)
    // must agree with the JE cash settlement exactly.
    expect(quote.totalPayoff).toBe(11106);
  });

  it('produces a balanced early-payoff journal entry', async () => {
    const quote = await service.getEarlyPayoffQuote(contract.id);
    expect(quote.journalPreview.totalDebit).toBe('13212.00');
    expect(quote.journalPreview.totalCredit).toBe('13212.00');
    expect(quote.journalPreview.isBalanced).toBe(true);
  });

  it('scales the discount with an explicit discountPct override (30% → 270.00) and reflows the settlement', async () => {
    const quote = await service.getEarlyPayoffQuote(contract.id, 30);

    // discount = 900.00 × 0.30 = 270.00 (fraction 0.30, not 30).
    const discountLine = quote.journalPreview.lines.find((l) => l.accountCode === '52-1106');
    expect(discountLine?.debit).toBe('270.00');

    // settlement = 10800.00 − 270.00 + 756.00 = 11286.00
    const cashLine = quote.journalPreview.lines.find((l) => l.accountCode === '11-1101');
    expect(cashLine?.debit).toBe('11286.00');
    expect(quote.discountPct).toBe(30);
  });
});
