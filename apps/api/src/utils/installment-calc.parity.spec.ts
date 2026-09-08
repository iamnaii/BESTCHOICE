import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { calcBcInstallment as sharedCalc } from '@installment/shared';
import { assertApprovalAmounts } from '../modules/credit-check/services/credit-approval';
import { computeInstallmentBreakdown } from '../modules/journal/compute-installment-breakdown';
import { calcBcInstallment } from './installment-calc.util';
import { calculateInstallmentWithInterest, generatePaymentSchedule } from './installment.util';

const cases = [
  {
    price: '19900',
    down: '2985',
    rate: '0.5',
    monthly: '2413.20',
    last: '2413.28',
    total: '28958.48',
  },
  {
    price: '12500',
    down: '2500',
    rate: '0.6',
    monthly: '1515.83',
    last: '1515.87',
    total: '18190.00',
  },
  {
    price: '10000',
    down: '2000',
    rate: '0.3',
    monthly: '998.66',
    last: '998.74',
    total: '11984.00',
  },
  // VAT rounding can also make the final installment smaller than the ordinary one.
  { price: '100', down: '37.3', rate: '0.5', monthly: '8.95', last: '8.89', total: '107.34' },
];

describe.each(cases)('shared/API/ledger parity for price $price, rate $rate', (example) => {
  const quote = calcBcInstallment({
    installmentPrice: new Decimal(example.price),
    customDownAmount: new Decimal(example.down),
    months: 12,
    config: {
      minDownPct: new Decimal('0.15'),
      commissionPct: new Decimal('0.10'),
      vatPct: new Decimal('0.07'),
      ratePctByMonths: new Map([[12, new Decimal(example.rate)]]),
      allowedMonths: [12],
    },
  });
  const legacy = calculateInstallmentWithInterest(
    Number(example.price),
    Number(example.down),
    quote.interestAmount.toNumber(),
    12,
    0.1,
    0.07,
  );
  const payments = generatePaymentSchedule(
    'parity-only',
    12,
    legacy.financedAmount,
    legacy.monthlyPayment,
    31,
    legacy,
  );
  const amounts = payments.map((payment) => new Decimal(payment.amountDue).toDecimalPlaces(2));

  it('uses the shared quote and settles exactly the same amounts as every ledger period', () => {
    expect(calcBcInstallment).toBe(sharedCalc);
    expect(quote.isValid).toBe(true);
    expect(quote.monthlyPayment.toFixed(2)).toBe(example.monthly);
    expect(quote.totalWithVat.toFixed(2)).toBe(example.total);
    expect(new Decimal(legacy.monthlyPayment).toFixed(2)).toBe(example.monthly);
    expect(amounts.at(-1)?.toFixed(2)).toBe(example.last);

    let total = new Decimal(0);
    let totalVat = new Decimal(0);
    let totalInterest = new Decimal(0);
    for (const payment of payments) {
      const ledger = computeInstallmentBreakdown({
        financedAmount: legacy.principal,
        storeCommission: legacy.storeCommission,
        interestTotal: legacy.interestTotal,
        vatAmount: legacy.vatAmount,
        totalMonths: 12,
        installmentNo: payment.installmentNo,
      });
      const amount = amounts[payment.installmentNo - 1];
      expect(ledger.installmentTotal.toFixed(2)).toBe(amount.toFixed(2));
      expect(ledger.vatPerInst.toFixed(2)).toBe(new Decimal(payment.vatAmount!).toFixed(2));
      expect(ledger.interestPerInst.toFixed(2)).toBe(
        new Decimal(payment.monthlyInterest!).toFixed(2),
      );
      total = total.plus(amount);
      totalVat = totalVat.plus(ledger.vatPerInst.toString());
      totalInterest = totalInterest.plus(ledger.interestPerInst.toString());
    }
    expect(total.toFixed(2)).toBe(example.total);
    expect(totalVat.toFixed(2)).toBe(quote.vatAmount.toFixed(2));
    expect(totalInterest.toFixed(2)).toBe(quote.interestAmount.toFixed(2));
  });

  it('enforces the approved ceiling on the largest actual installment, including the residual', () => {
    const maximum = Decimal.max(...amounts);
    const terms = {
      paymentDueDay: 31,
      monthlyAmounts: payments.map((payment) => payment.amountDue),
    };
    expect(() =>
      assertApprovalAmounts(
        { salaryPayDay: 31, approvedMonthlyPayment: new Prisma.Decimal(maximum.toString()) },
        terms,
      ),
    ).not.toThrow();
    expect(() =>
      assertApprovalAmounts(
        {
          salaryPayDay: 31,
          approvedMonthlyPayment: new Prisma.Decimal(maximum.minus('0.01').toString()),
        },
        terms,
      ),
    ).toThrow(/ทุกงวด/);
    expect(() =>
      assertApprovalAmounts(
        { salaryPayDay: 25, approvedMonthlyPayment: new Prisma.Decimal(maximum.toString()) },
        terms,
      ),
    ).toThrow(/เงินเดือน/);
  });
});
