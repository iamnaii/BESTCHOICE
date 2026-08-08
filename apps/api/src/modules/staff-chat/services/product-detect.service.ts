import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProductQuoteService, type DecimalLike } from './product-quote.service';

interface DetectedProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  /** ราคาเงินสด (columns-first) — เดิมอ่าน prices[0] ซึ่ง label ปนกันใน prod */
  price: number;
  /** จำนวนเครื่องในสต็อกรุ่น+ความจุเดียวกัน */
  stock: number;
  /** gallery[0] เท่านั้น — photos[] เป็น base64 data URL ห้ามส่งออก */
  imageUrl: string | null;
  installmentPrice: number | null;
  conditionGrade: string | null;
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
  constructor(
    private prisma: PrismaService,
    private productQuote: ProductQuoteService,
  ) {}

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
        storage: true,
        category: true,
        conditionGrade: true,
        cashPrice: true,
        installmentPrice: true,
        gallery: true,
        prices: { where: { deletedAt: null }, select: { label: true, amount: true } },
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
      storage: string | null;
      category: string;
      conditionGrade: string | null;
      cashPrice: DecimalLike | null;
      installmentPrice: DecimalLike | null;
      gallery: string[];
      prices: { label: string; amount: DecimalLike }[];
    }[],
  ): Promise<DetectedProduct[]> {
    if (products.length === 0) return [];

    const [quotes, counts, promotions] = await Promise.all([
      this.productQuote.getQuotes(
        products.map((p) => ({
          category: p.category,
          cashPrice: p.cashPrice,
          installmentPrice: p.installmentPrice,
          prices: p.prices,
        })),
      ),
      Promise.all(
        products.map((p) =>
          this.prisma.product.count({
            where: {
              deletedAt: null,
              status: 'IN_STOCK',
              brand: p.brand,
              model: p.model,
              storage: p.storage,
            },
          }),
        ),
      ),
      this.prisma.promotion.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          startDate: { lte: new Date() },
          endDate: { gte: new Date() },
        },
        select: { id: true, name: true, description: true },
        take: 3,
      }),
    ]);

    return products.map((product, i) => {
      const quote = quotes[i];
      return {
        id: product.id,
        name: product.name,
        brand: product.brand ?? '',
        model: product.model ?? '',
        price: quote.cashPrice ?? 0,
        stock: counts[i],
        imageUrl: product.gallery[0] ?? null,
        installmentPrice: quote.installmentPrice,
        conditionGrade: product.conditionGrade,
        pricingOptions:
          quote.months != null && quote.monthlyPayment != null
            ? [
                {
                  downPaymentMin: quote.downAmount ?? 0,
                  monthlyPayment: quote.monthlyPayment,
                  installments: quote.months,
                  interestRate: 0,
                },
              ]
            : [],
        activePromotions: promotions.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description ?? '',
        })),
      };
    });
  }
}
