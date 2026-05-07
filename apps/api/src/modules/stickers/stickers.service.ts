import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStickerTemplateDto, UpdateStickerTemplateDto } from './dto/sticker.dto';

export interface StickerRate {
  downPayment: number;
  monthlyPrice: number;
  termMonths: number;
}

export interface StickerData {
  productId: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  batteryHealth: number | null;
  warrantyExpireDate: string | null; // ISO date YYYY-MM-DD or null
  imei: string | null;
  cashPrice: number | null;
  rate1: StickerRate | null;
  rate2: StickerRate | null;
  shopLogoUrl: string | null;
}

interface StickerDefaults {
  rate1Down: number;
  rate1Term: number;
  rate2Down: number;
  rate2Term: number;
}

@Injectable()
export class StickersService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, limit = 50) {
    page = Math.max(1, page);
    limit = Math.min(200, Math.max(1, limit));

    const [data, total] = await Promise.all([
      this.prisma.stickerTemplate.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stickerTemplate.count({ where: { deletedAt: null } }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const template = await this.prisma.stickerTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('ไม่พบ Template สติกเกอร์');
    return template;
  }

  async create(dto: CreateStickerTemplateDto) {
    return this.prisma.stickerTemplate.create({ data: dto as Prisma.StickerTemplateCreateInput });
  }

  async update(id: string, dto: UpdateStickerTemplateDto) {
    await this.findOne(id);
    return this.prisma.stickerTemplate.update({
      where: { id },
      data: dto as Prisma.StickerTemplateUpdateInput,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.stickerTemplate.update({ where: { id }, data: { isActive: false } });
  }

  async getStickerData(productId: string): Promise<StickerData> {
    const [defaults, shopLogoUrl] = await Promise.all([
      this.loadDefaults(),
      this.loadShopLogoUrl(),
    ]);
    const data = await this.composeOne(productId, defaults, shopLogoUrl);
    if (!data) throw new NotFoundException('ไม่พบสินค้า');
    return data;
  }

  async getStickerDataBatch(productIds: string[]): Promise<StickerData[]> {
    if (productIds.length === 0) return [];
    const [defaults, shopLogoUrl] = await Promise.all([
      this.loadDefaults(),
      this.loadShopLogoUrl(),
    ]);
    const results = await Promise.all(
      productIds.map((id) => this.composeOne(id, defaults, shopLogoUrl)),
    );
    return results.filter((r): r is StickerData => r !== null);
  }

  private async loadDefaults(): Promise<StickerDefaults> {
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { startsWith: 'sticker.' } },
    });
    const map = new Map((rows ?? []).map((r) => [r.key, r.value]));
    return {
      rate1Down: Number(map.get('sticker.rate1.defaultDown') ?? 0),
      rate1Term: Number(map.get('sticker.rate1.defaultTerm') ?? 24),
      rate2Down: Number(map.get('sticker.rate2.defaultDown') ?? 0),
      rate2Term: Number(map.get('sticker.rate2.defaultTerm') ?? 12),
    };
  }

  private async loadShopLogoUrl(): Promise<string | null> {
    const company = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'SHOP' },
      select: { logoUrl: true },
    });
    return company?.logoUrl ?? null;
  }

  private async composeOne(
    productId: string,
    defaults: StickerDefaults,
    shopLogoUrl: string | null,
  ): Promise<StickerData | null> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: {
        branch: { select: { name: true } },
        inspection: { select: { overallGrade: true, gradeOverride: true } },
      },
    });
    if (!product) return null;

    // PHONE_USED templates are uniquely keyed by hasWarranty too — derive from product
    const productHasWarranty =
      product.category === 'PHONE_USED' &&
      product.warrantyExpired !== true &&
      product.warrantyExpireDate !== null &&
      product.warrantyExpireDate.getTime() >= Date.now();

    const pricing = await this.prisma.pricingTemplate.findFirst({
      where: {
        brand: { equals: product.brand, mode: 'insensitive' },
        model: { equals: product.model, mode: 'insensitive' },
        storage: product.storage ?? '',
        category: product.category as ProductCategory,
        hasWarranty: product.category === 'PHONE_USED' ? productHasWarranty : false,
        isActive: true,
        deletedAt: null,
      },
    });

    const warrantyExpireDate = this.computeWarranty(
      product.warrantyExpireDate,
      product.warrantyExpired,
    );

    return {
      productId: product.id,
      brand: product.brand,
      model: product.model,
      color: product.color,
      storage: product.storage,
      batteryHealth: product.batteryHealth,
      warrantyExpireDate,
      imei: product.imeiSerial,
      cashPrice: pricing ? Number(pricing.cashPrice) : null,
      rate1: pricing
        ? {
            downPayment:
              pricing.rate1DownPayment !== null
                ? Number(pricing.rate1DownPayment)
                : defaults.rate1Down,
            monthlyPrice: Number(pricing.installmentBestchoicePrice),
            termMonths: pricing.rate1TermMonths ?? defaults.rate1Term,
          }
        : null,
      rate2: pricing
        ? {
            downPayment:
              pricing.rate2DownPayment !== null
                ? Number(pricing.rate2DownPayment)
                : defaults.rate2Down,
            monthlyPrice: Number(pricing.installmentFinancePrice),
            termMonths: pricing.rate2TermMonths ?? defaults.rate2Term,
          }
        : null,
      shopLogoUrl,
    };
  }

  private computeWarranty(expireDate: Date | null, expired: boolean | null): string | null {
    if (!expireDate) return null;
    if (expired === true) return null;
    if (expireDate.getTime() < Date.now()) return null;
    return expireDate.toISOString().slice(0, 10);
  }
}
