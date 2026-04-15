import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

interface DetectedProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  price: number;
  stock: number;
  imageUrl: string | null;
  pricingOptions: {
    downPaymentMin: number;
    monthlyPayment: number;
    installments: number;
    interestRate: number;
  }[];
  activePromotions: {
    id: string;
    name: string;
    description: string;
  }[];
}

@Injectable()
export class ProductDetectService {
  constructor(private prisma: PrismaService) {}

  async detectProducts(messages: string[]): Promise<DetectedProduct[]> {
    const text = messages.join(' ').toLowerCase();
    const keywords = this.extractKeywords(text);
    if (keywords.length === 0) return [];

    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        status: 'IN_STOCK',
        OR: keywords.flatMap((kw) => [
          { name: { contains: kw, mode: 'insensitive' as const } },
          { brand: { contains: kw, mode: 'insensitive' as const } },
          { model: { contains: kw, mode: 'insensitive' as const } },
        ]),
      },
      select: {
        id: true,
        name: true,
        brand: true,
        model: true,
        photos: true,
        prices: {
          where: { deletedAt: null },
          orderBy: { isDefault: 'desc' },
          take: 1,
          select: { amount: true },
        },
      },
      take: 3,
    });

    return this.enrichProducts(products);
  }

  private extractKeywords(text: string): string[] {
    const patterns = [
      /iphone\s*\d{1,2}\s*(pro\s*max|pro|plus|mini)?/gi,
      /samsung\s*(galaxy\s*)?(s|a|z|m)\s*\d{1,2}\s*(ultra|plus|\+|fe)?/gi,
      /oppo\s*(reno|find|a)\s*\d{1,2}\s*(pro|plus|\+)?/gi,
      /vivo\s*(v|y|x|t)\s*\d{1,2}\s*(pro|plus|\+)?/gi,
      /xiaomi\s*(redmi|poco|mi)?\s*\d{1,2}\s*(pro|ultra|note)?/gi,
      /realme\s*(gt|c|narzo)?\s*\d{1,2}\s*(pro|plus|\+)?/gi,
      /huawei\s*(nova|p|mate)?\s*\d{1,2}\s*(pro|lite)?/gi,
    ];

    const matches: string[] = [];
    for (const pattern of patterns) {
      const found = text.match(pattern);
      if (found) matches.push(...found.map((m) => m.trim()));
    }
    return [...new Set(matches)];
  }

  private async enrichProducts(
    products: {
      id: string;
      name: string;
      brand: string;
      model: string;
      photos: string[];
      prices: { amount: { toNumber(): number } }[];
    }[],
  ): Promise<DetectedProduct[]> {
    const result: DetectedProduct[] = [];

    // Use InterestConfig for installment option preview
    const interestConfigs = await this.prisma.interestConfig.findMany({
      where: { deletedAt: null, isActive: true },
      select: {
        interestRate: true,
        minDownPaymentPct: true,
        minInstallmentMonths: true,
        maxInstallmentMonths: true,
      },
      take: 3,
    });

    const now = new Date();
    const promotions = await this.prisma.promotion.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      select: { id: true, name: true, description: true },
      take: 3,
    });

    for (const product of products) {
      const price = product.prices.length > 0 ? product.prices[0].amount.toNumber() : 0;
      const imageUrl = product.photos.length > 0 ? product.photos[0] : null;

      result.push({
        id: product.id,
        name: product.name,
        brand: product.brand ?? '',
        model: product.model ?? '',
        price,
        stock: 1, // Each Product row = 1 unit; aggregated count done upstream if needed
        imageUrl,
        pricingOptions: interestConfigs.map((cfg) => {
          const interestRate = cfg.interestRate.toNumber();
          const downPaymentPct = cfg.minDownPaymentPct.toNumber();
          const installments = cfg.minInstallmentMonths;
          const principal = price * (1 - downPaymentPct);
          const totalWithInterest = principal * (1 + interestRate);
          return {
            downPaymentMin: Math.ceil(price * downPaymentPct),
            monthlyPayment: Math.ceil(totalWithInterest / installments),
            installments,
            interestRate,
          };
        }),
        activePromotions: promotions.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description ?? '',
        })),
      });
    }
    return result;
  }
}
