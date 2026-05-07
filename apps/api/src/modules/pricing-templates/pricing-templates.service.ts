import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePricingTemplateDto, UpdatePricingTemplateDto } from './dto/pricing-template.dto';
import { Prisma, ProductCategory } from '@prisma/client';

@Injectable()
export class PricingTemplatesService {
  constructor(private prisma: PrismaService) {}

  async findAll(query?: { brand?: string; category?: string }) {
    const where: Prisma.PricingTemplateWhereInput = { isActive: true };
    if (query?.brand) where.brand = { contains: query.brand, mode: 'insensitive' };
    if (query?.category) where.category = query.category as ProductCategory;

    return this.prisma.pricingTemplate.findMany({
      where,
      orderBy: [{ brand: 'asc' }, { model: 'asc' }, { storage: 'asc' }, { hasWarranty: 'desc' }],
    });
  }

  async findOne(id: string) {
    const template = await this.prisma.pricingTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('ไม่พบราคาตั้งต้น');
    return template;
  }

  /**
   * Lookup pricing template for auto-fill when creating a product
   */
  async lookup(brand: string, model: string, storage: string | null, category: string, hasWarranty: boolean | null) {
    // Try exact match first
    const template = await this.prisma.pricingTemplate.findFirst({
      where: {
        brand: { equals: brand, mode: 'insensitive' },
        model: { equals: model, mode: 'insensitive' },
        storage: storage || '',
        category: category as ProductCategory,
        hasWarranty: category === 'PHONE_USED' ? (hasWarranty ?? false) : false,
        isActive: true,
      },
    });

    if (template) return template;

    // Fallback: try without storage
    if (storage) {
      return this.prisma.pricingTemplate.findFirst({
        where: {
          brand: { equals: brand, mode: 'insensitive' },
          model: { equals: model, mode: 'insensitive' },
          storage: '',
          category: category as ProductCategory,
          hasWarranty: category === 'PHONE_USED' ? (hasWarranty ?? false) : false,
          isActive: true,
        },
      });
    }

    return null;
  }

  async create(dto: CreatePricingTemplateDto) {
    try {
      return await this.prisma.pricingTemplate.create({
        data: {
          brand: dto.brand,
          model: dto.model,
          storage: dto.storage || '',
          category: dto.category as ProductCategory,
          hasWarranty: dto.category === 'PHONE_USED' ? (dto.hasWarranty ?? false) : false,
          cashPrice: dto.cashPrice,
          installmentBestchoicePrice: dto.installmentBestchoicePrice,
          installmentFinancePrice: dto.installmentFinancePrice,
          rate1DownPayment: dto.rate1DownPayment,
          rate1TermMonths: dto.rate1TermMonths,
          rate2DownPayment: dto.rate2DownPayment,
          rate2TermMonths: dto.rate2TermMonths,
        },
      });
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('ราคาตั้งต้นสำหรับ brand/model/storage/category/warranty นี้มีอยู่แล้ว');
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdatePricingTemplateDto) {
    await this.findOne(id);
    return this.prisma.pricingTemplate.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.pricingTemplate.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async bulkImport(items: CreatePricingTemplateDto[]) {
    const results = { success: 0, skipped: 0, errors: [] as string[] };

    for (const item of items) {
      try {
        const hasWarranty = item.category === 'PHONE_USED' ? (item.hasWarranty ?? false) : false;
        await this.prisma.pricingTemplate.upsert({
          where: {
            brand_model_storage_category_hasWarranty: {
              brand: item.brand,
              model: item.model,
              storage: item.storage || '',
              category: item.category as ProductCategory,
              hasWarranty,
            },
          },
          update: {
            cashPrice: item.cashPrice,
            installmentBestchoicePrice: item.installmentBestchoicePrice,
            installmentFinancePrice: item.installmentFinancePrice,
            isActive: true,
          },
          create: {
            brand: item.brand,
            model: item.model,
            storage: item.storage || '',
            category: item.category as ProductCategory,
            hasWarranty,
            cashPrice: item.cashPrice,
            installmentBestchoicePrice: item.installmentBestchoicePrice,
            installmentFinancePrice: item.installmentFinancePrice,
          },
        });
        results.success++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        results.errors.push(`${item.brand} ${item.model} ${item.storage || ''}: ${msg}`);
        results.skipped++;
      }
    }

    return results;
  }
}
