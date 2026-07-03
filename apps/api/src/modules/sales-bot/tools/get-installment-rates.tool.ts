import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export const GET_INSTALLMENT_RATES_TOOL = {
  name: 'get_installment_rates',
  description:
    "Get the shop's standard installment rates from the live finance config: every active rate plan (e.g. มือ1/มือ2) with its allowed tenure terms, the TOTAL flat interest percent per term, the per-month percent breakdown, and the minimum down payment percent. Returns PERCENTAGES ONLY — no baht amounts. Use this when search_products found nothing (or a hit has priceMissing) so you can still answer with real rate numbers instead of going silent. Do NOT quote any baht figure from this result; real baht quotes require calculate_installment on a real product.",
  input_schema: {
    type: 'object',
    properties: {},
  },
};

interface InstallmentRateTerm {
  tenureMonths: number;
  /**
   * TOTAL flat rate over the whole term, in percent.
   * `financed × totalRatePct/100 = interest for the entire contract` —
   * matches the contract system's semantics (get-rate-for-months.util.ts:
   * InterestConfigRate.ratePct is per-term-total; legacy
   * InterestConfig.interestRate is per-month, total = rate × months).
   */
  totalRatePct: number;
  /** totalRatePct / tenureMonths — how the shop quotes "ดอกเบี้ย X%/เดือน". */
  perMonthRatePct: number;
}

interface InstallmentRateConfig {
  /** Owner-facing plan label, e.g. "มือ1" / "มือ2". */
  name: string;
  minDownPaymentPct: number;
  terms: InstallmentRateTerm[];
}

export interface GetInstallmentRatesResult {
  configs: InstallmentRateConfig[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

@Injectable()
export class GetInstallmentRatesTool {
  constructor(private readonly prisma: PrismaService) {}

  async run(
    _input: Record<string, unknown> = {},
  ): Promise<GetInstallmentRatesResult | { error: string }> {
    // ALL active plans (มือ1, มือ2, ...) — the bot presents each so a
    // customer asking about a used phone isn't quoted the new-phone rate.
    const rows = await this.prisma.interestConfig.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        rates: { where: { deletedAt: null }, orderBy: { months: 'asc' } },
      },
    });
    if (rows.length === 0) return { error: 'no_active_rate_config' };

    const configs: InstallmentRateConfig[] = rows.map((cfg) => {
      let terms: InstallmentRateTerm[];
      if (cfg.rates.length > 0) {
        // InterestConfigRate.ratePct = TOTAL rate for that term (NOT annual,
        // NOT per-month) — same reading as getRateForMonths' new-lookup path.
        terms = cfg.rates.map((r) => {
          const totalRatePct = round2(Number(r.ratePct) * 100);
          return {
            tenureMonths: r.months,
            totalRatePct,
            perMonthRatePct: round2(totalRatePct / r.months),
          };
        });
      } else {
        // Legacy fallback: InterestConfig.interestRate is PER-MONTH; total
        // for m months = rate × m. Synthesize one term per allowed month —
        // mirrors installment-preview.service.ts' synthesis so this tool
        // never contradicts the storefront preview.
        const perMonthRatePct = round2(Number(cfg.interestRate) * 100);
        terms = [];
        for (let m = cfg.minInstallmentMonths; m <= cfg.maxInstallmentMonths; m++) {
          terms.push({
            tenureMonths: m,
            totalRatePct: round2(perMonthRatePct * m),
            perMonthRatePct,
          });
        }
      }

      return {
        name: cfg.name,
        minDownPaymentPct: round2(Number(cfg.minDownPaymentPct) * 100),
        terms,
      };
    });

    // Percent-and-terms ONLY. Deliberately NO baht fields and NO grounded
    // key names (priceThb/monthly/minPrice/maxPrice): the grounding ledger
    // stays empty after this tool, so any baht amount the model invents is
    // still HALLUCINATION_BLOCKED (review #1332 Critical 2a).
    return { configs };
  }
}
