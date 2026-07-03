import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export const GET_INSTALLMENT_RATES_TOOL = {
  name: 'get_installment_rates',
  description:
    "Get the shop's standard installment rates from the live InterestConfig: active tenure terms with their flat interest rate, and the minimum down payment percent. Use this when search_products found nothing (or a hit has priceMissing) so you can still answer with real rate numbers instead of going silent — then invite the customer to share their model/budget so calculate_installment can run a real quote. Includes one illustrative example calculation (NOT tied to any specific product).",
  input_schema: {
    type: 'object',
    properties: {},
  },
};

// Illustrative reference price used ONLY to produce one concrete, grounded
// Baht example (see collectGroundedPrices in sales-bot.service.ts, which
// scans tool results for `priceThb` / `monthly` among other keys). This is
// NOT a real product's price — the persona instructs the bot to label it as
// an example and invite the customer's real budget/model for
// calculate_installment to quote for real.
const EXAMPLE_REFERENCE_PRICE_THB = 10000;

// Matches CALCULATE_INSTALLMENT_TOOL's own documented default ("Down payment
// percent defaults to 20%") — used only if a (theoretically impossible,
// schema-required) InterestConfig row is missing minDownPaymentPct.
const DOCUMENTED_DEFAULT_DOWN_PCT = 20;

interface InstallmentRateTerm {
  tenureMonths: number;
  ratePct: number;
}

export interface GetInstallmentRatesResult {
  activeTerms: InstallmentRateTerm[];
  minDownPaymentPct: number;
  example: {
    priceThb: number;
    downPct: number;
    tenureMonths: number;
    monthly: number;
  };
}

@Injectable()
export class GetInstallmentRatesTool {
  constructor(private readonly prisma: PrismaService) {}

  async run(
    _input: Record<string, unknown> = {},
  ): Promise<GetInstallmentRatesResult | { error: string }> {
    // Same finance source as CalculateInstallmentTool.loadRatePct: the most
    // recently created active, non-deleted InterestConfig row.
    const cfg = await this.prisma.interestConfig.findFirst({
      where: { isActive: true, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        rates: { where: { deletedAt: null }, orderBy: { months: 'asc' } },
      },
    });
    if (!cfg) return { error: 'no_active_rate_config' };

    // Prefer the per-term InterestConfigRate breakdown (จำนวนงวดที่เปิด —
    // a different rate per tenure) when the owner has configured one;
    // otherwise fall back to the flat top-level interestRate applied to the
    // config's max tenure — mirrors CalculateInstallmentTool's single-rate
    // fallback behaviour so the two tools never contradict each other.
    const activeTerms: InstallmentRateTerm[] =
      cfg.rates.length > 0
        ? cfg.rates.map((r) => ({
            tenureMonths: r.months,
            ratePct: Number(r.ratePct) * 100,
          }))
        : [
            {
              tenureMonths: cfg.maxInstallmentMonths,
              ratePct: Number(cfg.interestRate) * 100,
            },
          ];

    const minDownPaymentPct =
      cfg.minDownPaymentPct != null
        ? Number(cfg.minDownPaymentPct) * 100
        : DOCUMENTED_DEFAULT_DOWN_PCT;

    // Illustrative example — same math as CalculateInstallmentTool.run, run
    // against the longest active term (the shop's typical/anchor term).
    const exampleTerm = activeTerms[activeTerms.length - 1];
    const downAmount = Math.round(EXAMPLE_REFERENCE_PRICE_THB * (minDownPaymentPct / 100));
    const financed = EXAMPLE_REFERENCE_PRICE_THB - downAmount;
    const totalInterest = Math.round(
      financed * (exampleTerm.ratePct / 100) * (exampleTerm.tenureMonths / 12),
    );
    const monthly = Math.round((financed + totalInterest) / exampleTerm.tenureMonths);

    return {
      activeTerms,
      minDownPaymentPct,
      example: {
        priceThb: EXAMPLE_REFERENCE_PRICE_THB,
        downPct: minDownPaymentPct,
        tenureMonths: exampleTerm.tenureMonths,
        monthly,
      },
    };
  }
}
