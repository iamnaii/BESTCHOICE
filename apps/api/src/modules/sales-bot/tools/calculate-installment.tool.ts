import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { getRateForMonths } from '../../../utils/get-rate-for-months.util';

export const CALCULATE_INSTALLMENT_TOOL = {
  name: 'calculate_installment',
  description:
    'Calculate monthly installment for a product. Down payment percent defaults to 20%. Tenure in months.',
  input_schema: {
    type: 'object',
    properties: {
      productId: { type: 'string' },
      downPct: { type: 'number', description: 'Down payment percent 0-100' },
      tenureMonths: { type: 'integer', description: '3, 6, 10, or 12' },
    },
    required: ['productId', 'tenureMonths'],
  },
};

@Injectable()
export class CalculateInstallmentTool {
  private readonly logger = new Logger(CalculateInstallmentTool.name);
  constructor(private readonly prisma: PrismaService) {}

  async run(input: { productId: string; downPct?: number; tenureMonths: number }) {
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, deletedAt: null },
      select: {
        name: true,
        prices: {
          where: { deletedAt: null, isDefault: true },
          select: { amount: true },
          take: 1,
        },
      },
    });
    if (!product) return { error: 'product_not_found' };
    const sellingPrice = product.prices[0]?.amount;
    if (sellingPrice == null) return { error: 'price_not_configured' };

    const downPct = input.downPct ?? 20;
    const price = Number(sellingPrice);
    const downAmount = Math.round(price * (downPct / 100));
    const financed = price - downAmount;
    const rateFraction = await this.loadRateFraction(input.tenureMonths);
    // TOTAL-contract rate for this term (a fraction, e.g. 1.0 = 100% of
    // financed over the WHOLE tenure) — NOT annual. Per get-rate-for-months.util.ts /
    // interest-config.service.ts:100-105 / installment-preview.service.ts:75-80:
    // InterestConfigRate.ratePct (per-term row) is already the TOTAL rate for
    // that term; the legacy InterestConfig.interestRate is PER-MONTH, so
    // total = rate × months (no ÷12). #1335: this tool used to divide by
    // tenure/12, treating the per-month rate as if it were annual — quoting
    // installments far below what installment-preview.service (the contract
    // engine's own preview) computes for the identical input.
    const totalInterest = Math.round(financed * rateFraction);
    const totalFinanced = financed + totalInterest;
    const monthly = Math.round(totalFinanced / input.tenureMonths);

    return {
      productName: product.name,
      priceThb: price,
      downAmountThb: downAmount,
      financedThb: financed,
      tenureMonths: input.tenureMonths,
      ratePct: Math.round(rateFraction * 10000) / 100, // TOTAL rate for the term, as %
      monthlyThb: monthly,
      totalPaidThb: downAmount + totalFinanced,
    };
  }

  /**
   * Resolves the TOTAL-contract rate (fraction) for `tenure` months using the
   * same resolution the contract engine uses (sale-writer.service.ts,
   * contract-lifecycle.service.ts): find the matching InterestConfig row,
   * then delegate to getRateForMonths — which reads the per-term
   * InterestConfigRate row when `USE_NEW_RATE_LOOKUP=true`, else falls back
   * to legacy `interestRate × months`. Returns 0 when no config matches the
   * tenure (kept from the original behaviour).
   */
  private async loadRateFraction(tenure: number): Promise<number> {
    // InterestConfig schema uses min/maxInstallmentMonths + interestRate
    // (a decimal fraction, e.g. 0.15 = 15%) and `isActive` (not `active`).
    const cfg = await this.prisma.interestConfig.findFirst({
      where: {
        isActive: true,
        deletedAt: null,
        minInstallmentMonths: { lte: tenure },
        maxInstallmentMonths: { gte: tenure },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!cfg) return 0;
    const rate = await getRateForMonths(this.prisma, cfg.id, tenure);
    return Number(rate);
  }
}
