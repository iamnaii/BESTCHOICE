import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { currentDomainAccess } from '../employee-access/access-execution-context';
import { writeSharedReference } from '../employee-access/access-shared-reference';
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePricingTemplateDto, UpdatePricingTemplateDto } from './dto/pricing-template.dto';
import { Prisma, ProductCategory, PricingDeviceOrigin } from '@prisma/client';

@Injectable()
export class PricingTemplatesService {
  constructor(private readonly base: PrismaService) {}
  private get prisma() {
    return currentDomainAccess()?.client ?? this.base;
  }

  async findAll(query?: { brand?: string; category?: string; deviceOrigin?: string }) {
    const where: Prisma.PricingTemplateWhereInput = { isActive: true, deletedAt: null };
    if (query?.brand) where.brand = { contains: query.brand, mode: 'insensitive' };
    if (query?.category) where.category = query.category as ProductCategory;
    if (query?.deviceOrigin) {
      if (!Object.values(PricingDeviceOrigin).includes(query.deviceOrigin as PricingDeviceOrigin))
        throw new BadRequestException('Invalid device origin');
      where.deviceOrigin = query.deviceOrigin as PricingDeviceOrigin;
    }

    return this.prisma.pricingTemplate.findMany({
      where,
      orderBy: [{ brand: 'asc' }, { model: 'asc' }, { storage: 'asc' }, { hasWarranty: 'desc' }],
    });
  }

  async findOne(id: string) {
    const template = await this.prisma.pricingTemplate.findUnique({
      where: { id, deletedAt: null },
    });
    if (!template) throw new NotFoundException('ไม่พบราคาตั้งต้น');
    return template;
  }

  /**
   * Lookup pricing template for auto-fill when creating a product
   */
  async lookup(
    brand: string,
    model: string,
    storage: string | null,
    category: string,
    hasWarranty: boolean | null,
    deviceOrigin: PricingDeviceOrigin = 'UNSPECIFIED',
  ) {
    // Try exact match first
    const template = await this.prisma.pricingTemplate.findFirst({
      where: {
        deviceOrigin,
        brand: { equals: brand, mode: 'insensitive' },
        model: { equals: model, mode: 'insensitive' },
        storage: storage || '',
        category: category as ProductCategory,
        hasWarranty: category === 'PHONE_USED' ? (hasWarranty ?? false) : false,
        isActive: true,
        deletedAt: null,
      },
    });

    if (template) return template;

    // Fallback: try without storage
    if (storage) {
      return this.prisma.pricingTemplate.findFirst({
        where: {
          deviceOrigin,
          brand: { equals: brand, mode: 'insensitive' },
          model: { equals: model, mode: 'insensitive' },
          storage: '',
          category: category as ProductCategory,
          hasWarranty: category === 'PHONE_USED' ? (hasWarranty ?? false) : false,
          isActive: true,
          deletedAt: null,
        },
      });
    }

    return null;
  }

  async create(dto: CreatePricingTemplateDto) {
    return writeSharedReference(this.base, (tx) =>
      tx.pricingTemplate.create({
        data: {
          deviceOrigin: dto.deviceOrigin ?? 'UNSPECIFIED',
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
      }),
    );
  }
  async update(id: string, dto: UpdatePricingTemplateDto) {
    return writeSharedReference(this.base, async (tx) => {
      await tx.$queryRaw`SELECT id FROM pricing_templates WHERE id = ${id} FOR UPDATE`;
      if (!(await tx.pricingTemplate.findFirst({ where: { id, deletedAt: null } })))
        throw new NotFoundException('ไม่พบราคาตั้งต้น');
      return tx.pricingTemplate.update({ where: { id }, data: dto });
    });
  }
  async remove(id: string) {
    return this.update(id, { isActive: false });
  }

  async bulkImport(items: CreatePricingTemplateDto[]) {
    if (!Array.isArray(items) || items.length > 100)
      throw new BadRequestException('รายการนำเข้าต้องเป็นอาร์เรย์ไม่เกิน 100 แถว');
    const errors: string[] = [];
    const valid: CreatePricingTemplateDto[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`ROW_${i + 1}:INVALID_ROW`);
        continue;
      }
      const dto = plainToInstance(CreatePricingTemplateDto, item);
      if ((await validate(dto, { whitelist: true })).length)
        errors.push(`ROW_${i + 1}:INVALID_ROW`);
      else valid.push(dto);
    }
    if (errors.length) return { success: 0, skipped: items.length, errors };
    return writeSharedReference(this.base, async (tx) => {
      for (const item of valid) {
        const key = {
          brand: item.brand,
          model: item.model,
          storage: item.storage || '',
          category: item.category as ProductCategory,
          hasWarranty: item.category === 'PHONE_USED' ? (item.hasWarranty ?? false) : false,
          deviceOrigin: item.deviceOrigin ?? ('UNSPECIFIED' as PricingDeviceOrigin),
        };
        const existing = await tx.pricingTemplate.findUnique({
          where: { brand_model_storage_category_hasWarranty_deviceOrigin: key },
        });
        if (existing?.deletedAt) throw new ConflictException('ข้อมูลอ้างอิงถูกลบแล้ว');
        if (existing)
          await tx.$queryRaw`SELECT id FROM pricing_templates WHERE id = ${existing.id} FOR UPDATE`;
        const prices = {
          cashPrice: item.cashPrice,
          installmentBestchoicePrice: item.installmentBestchoicePrice,
          installmentFinancePrice: item.installmentFinancePrice,
        };
        await tx.pricingTemplate.upsert({
          where: { brand_model_storage_category_hasWarranty_deviceOrigin: key },
          update: { ...prices, isActive: true },
          create: { ...key, ...prices },
        });
      }
      return { success: valid.length, skipped: 0, errors: [] as string[] };
    });
  }
}
