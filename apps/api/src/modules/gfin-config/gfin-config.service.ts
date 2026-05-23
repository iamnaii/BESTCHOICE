import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { findGfinMapping } from '../../utils/installment-calc.util';
import {
  CreateMaxPriceDto,
  UpdateMaxPriceDto,
  CreateOverpriceRuleDto,
  UpdateOverpriceRuleDto,
  CreateRateFactorDto,
  UpdateRateFactorDto,
} from './dto';

@Injectable()
export class GfinConfigService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  // ===== Max Prices =====

  listMaxPrices() {
    return this.prisma.gfinModelMapping.findMany({
      where: { deletedAt: null },
      orderBy: [
        { gfinSeries: 'asc' },
        { gfinVariant: 'asc' },
        { storage: 'asc' },
        { condition: 'asc' },
      ],
    });
  }

  async createMaxPrice(dto: CreateMaxPriceDto, userId: string) {
    const row = await this.prisma.gfinModelMapping.create({
      data: {
        gfinSeries: dto.gfinSeries,
        gfinVariant: dto.gfinVariant ?? null,
        storage: dto.storage,
        condition: dto.condition,
        maxPrice: new Prisma.Decimal(dto.maxPrice),
        modelMatchPattern: dto.modelMatchPattern,
        isActive: dto.isActive ?? true,
      },
    });
    await this.auditService.log({
      action: 'GFIN_MAX_PRICE_CREATED',
      entity: 'gfin_model_mapping',
      entityId: row.id,
      userId,
      newValue: row as unknown as Record<string, unknown>,
    });
    return row;
  }

  async updateMaxPrice(id: string, dto: UpdateMaxPriceDto, userId: string) {
    const existing = await this.prisma.gfinModelMapping.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new NotFoundException('ไม่พบ row นี้');

    const data: Prisma.GfinModelMappingUpdateInput = {};
    if (dto.gfinSeries !== undefined) data.gfinSeries = dto.gfinSeries;
    if (dto.gfinVariant !== undefined) data.gfinVariant = dto.gfinVariant ?? null;
    if (dto.storage !== undefined) data.storage = dto.storage;
    if (dto.condition !== undefined) data.condition = dto.condition;
    if (dto.maxPrice !== undefined) data.maxPrice = new Prisma.Decimal(dto.maxPrice);
    if (dto.modelMatchPattern !== undefined) data.modelMatchPattern = dto.modelMatchPattern;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.gfinModelMapping.update({ where: { id }, data });
    await this.auditService.log({
      action: 'GFIN_MAX_PRICE_UPDATED',
      entity: 'gfin_model_mapping',
      entityId: id,
      userId,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: updated as unknown as Record<string, unknown>,
    });
    return updated;
  }

  async softDeleteMaxPrice(id: string, userId: string) {
    const existing = await this.prisma.gfinModelMapping.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new NotFoundException('ไม่พบ row นี้');
    const updated = await this.prisma.gfinModelMapping.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.auditService.log({
      action: 'GFIN_MAX_PRICE_DELETED',
      entity: 'gfin_model_mapping',
      entityId: id,
      userId,
      oldValue: existing as unknown as Record<string, unknown>,
    });
    return updated;
  }

  // ===== Overprice Rules =====

  listOverpriceRules() {
    return this.prisma.gfinOverpriceRule.findMany({
      where: { deletedAt: null },
      orderBy: [{ condition: 'asc' }, { label: 'asc' }],
    });
  }

  async createOverpriceRule(dto: CreateOverpriceRuleDto, userId: string) {
    const row = await this.prisma.gfinOverpriceRule.create({
      data: {
        label: dto.label,
        seriesPattern: dto.seriesPattern,
        condition: dto.condition,
        allowance: new Prisma.Decimal(dto.allowance),
        isActive: dto.isActive ?? true,
      },
    });
    await this.auditService.log({
      action: 'GFIN_OVERPRICE_RULE_CREATED',
      entity: 'gfin_overprice_rule',
      entityId: row.id,
      userId,
      newValue: row as unknown as Record<string, unknown>,
    });
    return row;
  }

  async updateOverpriceRule(id: string, dto: UpdateOverpriceRuleDto, userId: string) {
    const existing = await this.prisma.gfinOverpriceRule.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new NotFoundException('ไม่พบ row นี้');

    const data: Prisma.GfinOverpriceRuleUpdateInput = {};
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.seriesPattern !== undefined) data.seriesPattern = dto.seriesPattern;
    if (dto.condition !== undefined) data.condition = dto.condition;
    if (dto.allowance !== undefined) data.allowance = new Prisma.Decimal(dto.allowance);
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.gfinOverpriceRule.update({ where: { id }, data });
    await this.auditService.log({
      action: 'GFIN_OVERPRICE_RULE_UPDATED',
      entity: 'gfin_overprice_rule',
      entityId: id,
      userId,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: updated as unknown as Record<string, unknown>,
    });
    return updated;
  }

  async softDeleteOverpriceRule(id: string, userId: string) {
    const existing = await this.prisma.gfinOverpriceRule.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new NotFoundException('ไม่พบ row นี้');
    const updated = await this.prisma.gfinOverpriceRule.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.auditService.log({
      action: 'GFIN_OVERPRICE_RULE_DELETED',
      entity: 'gfin_overprice_rule',
      entityId: id,
      userId,
      oldValue: existing as unknown as Record<string, unknown>,
    });
    return updated;
  }

  // ===== Rate Factors =====

  listRateFactors() {
    return this.prisma.gfinRateFactor.findMany({
      where: { deletedAt: null },
      orderBy: { months: 'asc' },
    });
  }

  async createRateFactor(dto: CreateRateFactorDto, userId: string) {
    const row = await this.prisma.gfinRateFactor.create({
      data: {
        months: dto.months,
        factor: new Prisma.Decimal(dto.factor),
        feePerInstallment:
          dto.feePerInstallment !== undefined
            ? new Prisma.Decimal(dto.feePerInstallment)
            : new Prisma.Decimal(100),
        isActive: dto.isActive ?? true,
      },
    });
    await this.auditService.log({
      action: 'GFIN_RATE_FACTOR_CREATED',
      entity: 'gfin_rate_factor',
      entityId: row.id,
      userId,
      newValue: row as unknown as Record<string, unknown>,
    });
    return row;
  }

  async updateRateFactor(id: string, dto: UpdateRateFactorDto, userId: string) {
    const existing = await this.prisma.gfinRateFactor.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new NotFoundException('ไม่พบ row นี้');

    const data: Prisma.GfinRateFactorUpdateInput = {};
    if (dto.factor !== undefined) data.factor = new Prisma.Decimal(dto.factor);
    if (dto.feePerInstallment !== undefined)
      data.feePerInstallment = new Prisma.Decimal(dto.feePerInstallment);
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.gfinRateFactor.update({ where: { id }, data });
    await this.auditService.log({
      action: 'GFIN_RATE_FACTOR_UPDATED',
      entity: 'gfin_rate_factor',
      entityId: id,
      userId,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: updated as unknown as Record<string, unknown>,
    });
    return updated;
  }

  async softDeleteRateFactor(id: string, userId: string) {
    const existing = await this.prisma.gfinRateFactor.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new NotFoundException('ไม่พบ row นี้');
    const updated = await this.prisma.gfinRateFactor.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.auditService.log({
      action: 'GFIN_RATE_FACTOR_DELETED',
      entity: 'gfin_rate_factor',
      entityId: id,
      userId,
      oldValue: existing as unknown as Record<string, unknown>,
    });
    return updated;
  }

  // ===== Match Preview (debug helper) =====

  async matchPreview(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('ไม่พบสินค้า');

    const mappings = await this.prisma.gfinModelMapping.findMany({ where: { deletedAt: null } });

    // Map to the shared GfinModelMappingRow shape
    const mappingRows = mappings.map((m) => ({
      id: m.id,
      gfinSeries: m.gfinSeries,
      gfinVariant: m.gfinVariant,
      storage: m.storage,
      condition: m.condition as 'HAND_1' | 'HAND_2',
      maxPrice: new Decimal(m.maxPrice.toString()),
      modelMatchPattern: m.modelMatchPattern,
      isActive: m.isActive,
    }));

    // Determine GFIN category from product category
    const categoryForGfin =
      product.category === 'PHONE_NEW' ? ('PHONE_NEW' as const) : ('PHONE_USED' as const);

    const match = findGfinMapping(
      {
        brand: product.brand ?? '',
        model: product.model ?? '',
        storage: product.storage ?? '',
        category: categoryForGfin,
      },
      mappingRows,
    );

    return {
      product: {
        id: product.id,
        name: product.name,
        brand: product.brand,
        model: product.model,
        storage: product.storage,
        category: product.category,
      },
      match,
    };
  }
}
