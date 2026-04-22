import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

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
      select: { costPrice: true, name: true },
    });
    if (!product) return { error: 'product_not_found' };

    const downPct = input.downPct ?? 20;
    // See search-products.tool.ts — using costPrice as selling-price proxy.
    const price = Number(product.costPrice);
    const downAmount = Math.round(price * (downPct / 100));
    const financed = price - downAmount;
    const ratePct = await this.loadRatePct(input.tenureMonths);
    // Flat-rate interest over the full tenure (consistent with InterestConfig
    // semantics: annual flat rate × fraction of a year spanned by tenure).
    const totalInterest = Math.round(financed * (ratePct / 100) * (input.tenureMonths / 12));
    const totalFinanced = financed + totalInterest;
    const monthly = Math.round(totalFinanced / input.tenureMonths);

    return {
      productName: product.name,
      priceThb: price,
      downAmountThb: downAmount,
      financedThb: financed,
      tenureMonths: input.tenureMonths,
      ratePct,
      monthlyThb: monthly,
      totalPaidThb: downAmount + totalFinanced,
    };
  }

  private async loadRatePct(tenure: number): Promise<number> {
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
    // interestRate is stored as a fraction (0.15) — convert to pct for the UI.
    return Number(cfg.interestRate) * 100;
  }
}
