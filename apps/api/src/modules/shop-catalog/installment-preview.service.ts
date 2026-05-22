import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import {
  calcBcInstallment,
  calcGfinInstallment,
  findGfinMapping,
  findGfinOverpriceRule,
} from '../../utils/installment-calc.util';
import { InstallmentPreviewDto } from './dto/installment-preview.dto';

export interface PreviewResult {
  available: boolean;
  reason?: string;
  errors?: string[];
  provider?: 'BC' | 'GFIN';
  monthlyPayment?: number;
  downAmount?: number;
  totalWithVat?: number;
  financedAmount?: number;
  months?: number;
  gfinSubmitPrice?: number;
  downDiscount?: number;
}

@Injectable()
export class InstallmentPreviewService {
  constructor(private prisma: PrismaService) {}

  async preview(dto: InstallmentPreviewDto): Promise<PreviewResult> {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { prices: { where: { deletedAt: null } } },
    });
    if (!product || product.deletedAt) {
      return { available: false, reason: 'product_not_found' };
    }

    const installmentPriceRaw =
      product.installmentPrice ??
      product.prices.find((p) => p.label === 'ราคาผ่อน BESTCHOICE')?.amount ??
      product.prices.find((p) => p.label.startsWith('ราคาผ่อน'))?.amount ??
      null;

    if (!installmentPriceRaw) {
      return { available: false, reason: 'no_installment_price' };
    }
    const installmentPrice = new Decimal(installmentPriceRaw.toString());

    if (dto.provider === 'BC') {
      return this.previewBc(product, installmentPrice, dto);
    }
    return this.previewGfin(product, installmentPrice, dto);
  }

  private async previewBc(
    product: { category: string },
    installmentPrice: Decimal,
    dto: InstallmentPreviewDto,
  ): Promise<PreviewResult> {
    const config = await this.prisma.interestConfig.findFirst({
      where: {
        productCategories: { has: product.category },
        deletedAt: null,
        isActive: true,
      },
      include: { rates: { where: { deletedAt: null } } },
    });
    if (!config) return { available: false, reason: 'no_interest_config' };

    const ratePctByMonths = new Map<number, Decimal>();
    for (const r of config.rates) {
      ratePctByMonths.set(r.months, new Decimal(r.ratePct.toString()));
    }
    // Fallback when InterestConfigRate not yet seeded — synthesize from per-month × m
    if (ratePctByMonths.size === 0) {
      const rate = new Decimal(config.interestRate.toString());
      for (let m = config.minInstallmentMonths; m <= config.maxInstallmentMonths; m++) {
        ratePctByMonths.set(m, rate.mul(m));
      }
    }
    const allowedMonths = Array.from(ratePctByMonths.keys()).sort((a, b) => a - b);

    const result = calcBcInstallment({
      installmentPrice,
      months: dto.months,
      downPct: dto.downPct !== undefined ? new Decimal(dto.downPct) : undefined,
      customDownAmount:
        dto.customDownAmount !== undefined ? new Decimal(dto.customDownAmount) : undefined,
      config: {
        minDownPct: new Decimal(config.minDownPaymentPct.toString()),
        commissionPct: new Decimal(config.storeCommissionPct.toString()),
        vatPct: new Decimal(config.vatPct.toString()),
        ratePctByMonths,
        allowedMonths,
      },
    });

    if (!result.isValid) {
      return { available: false, reason: 'invalid', errors: result.errors };
    }

    return {
      available: true,
      provider: 'BC',
      monthlyPayment: result.monthlyPayment.toNumber(),
      downAmount: result.downAmount.toNumber(),
      totalWithVat: result.totalWithVat.toNumber(),
      financedAmount: result.financedAmount.toNumber(),
      months: dto.months,
    };
  }

  private async previewGfin(
    product: { brand: string | null; model: string; storage: string | null; category: string },
    installmentPrice: Decimal,
    dto: InstallmentPreviewDto,
  ): Promise<PreviewResult> {
    const [mappings, rules, factor] = await Promise.all([
      this.prisma.gfinModelMapping.findMany({
        where: { deletedAt: null, isActive: true },
      }),
      this.prisma.gfinOverpriceRule.findMany({
        where: { deletedAt: null, isActive: true },
      }),
      this.prisma.gfinRateFactor.findFirst({
        where: { months: dto.months, deletedAt: null, isActive: true },
      }),
    ]);

    if (!factor) return { available: false, reason: 'no_rate_factor' };

    const mappingObjects = mappings.map((m) => ({
      id: m.id,
      gfinSeries: m.gfinSeries,
      gfinVariant: m.gfinVariant,
      storage: m.storage,
      condition: m.condition as 'HAND_1' | 'HAND_2',
      maxPrice: new Decimal(m.maxPrice.toString()),
      modelMatchPattern: m.modelMatchPattern,
      isActive: m.isActive,
    }));

    const mapping = findGfinMapping(
      {
        brand: product.brand ?? '',
        model: product.model,
        storage: product.storage ?? '',
        category: product.category === 'PHONE_NEW' ? 'PHONE_NEW' : 'PHONE_USED',
      },
      mappingObjects,
    );
    if (!mapping) return { available: false, reason: 'no_gfin_mapping' };

    const ruleObjects = rules.map((r) => ({
      id: r.id,
      label: r.label,
      seriesPattern: r.seriesPattern,
      condition: r.condition as 'HAND_1' | 'HAND_2',
      allowance: new Decimal(r.allowance.toString()),
      isActive: r.isActive,
    }));

    const rule = findGfinOverpriceRule(mapping, ruleObjects);

    const result = calcGfinInstallment({
      installmentPrice,
      product: {
        brand: product.brand ?? '',
        model: product.model,
        storage: product.storage ?? '',
        category: product.category === 'PHONE_NEW' ? 'PHONE_NEW' : 'PHONE_USED',
      },
      months: dto.months,
      downPct: dto.downPct !== undefined ? new Decimal(dto.downPct) : undefined,
      mapping,
      overpriceRule: rule,
      rateFactor: {
        months: factor.months,
        factor: new Decimal(factor.factor.toString()),
        feePerInstallment: new Decimal(factor.feePerInstallment.toString()),
        isActive: factor.isActive,
      },
    });

    if (!result.isValid) {
      return { available: false, reason: 'invalid', errors: result.errors };
    }

    return {
      available: true,
      provider: 'GFIN',
      monthlyPayment: result.monthlyPayment.toNumber(),
      downAmount: result.downAmountActual.toNumber(),
      financedAmount: result.financedAmount.toNumber(),
      months: dto.months,
      gfinSubmitPrice: result.gfinSubmitPrice.toNumber(),
      downDiscount: result.downDiscount.toNumber(),
    };
  }
}
