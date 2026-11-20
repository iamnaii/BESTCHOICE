import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type GfinOverpriceRule } from '@prisma/client';
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
  UpdateGfinSettingsDto,
  ImportMaxPricesDto,
  BulkUpsertOverpriceRulesDto,
  CloseMaxPricesDto,
} from './dto';
import {
  GFIN_SETTINGS_KEYS,
  loadGfinSettings,
  loadGfinSheetInfo,
  type GfinSettingsView,
} from './gfin-settings.util';

export const PER_MODEL_ONLY_MESSAGE = 'เงื่อนไขเก็บรายรุ่นแล้ว — แก้ทีละรุ่น (ใส่ชื่อรุ่นเดียว ไม่ใช้ |)';
export const RULE_EXISTS_MESSAGE = 'รุ่นนี้มีเงื่อนไขของสภาพนี้อยู่แล้ว — แก้แถวที่มีอยู่แทน';

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/** สเปค 2026-11-20 §5: กติกากลุ่มใหม่ไม่มีผล (กติการายรุ่นชนะเสมอใน findGfinOverpriceRule) → ปฏิเสธตั้งแต่ต้น */
function assertSingleSeries(seriesPattern: string | undefined): void {
  if (seriesPattern !== undefined && seriesPattern.includes('|')) {
    throw new BadRequestException(PER_MODEL_ONLY_MESSAGE);
  }
}

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

  /**
   * นำเข้าใบราคาจาก Excel (สเปคข้อ 7.7) — หนึ่งแถว = ชื่อรุ่นเต็ม + ความจุ + สภาพ
   * หาแถวเดิมเอง (unique ของฐานข้อมูลกันซ้ำไม่ได้เพราะ gfinVariant ว่าง) · แถวรูปแบบเก่าที่มีรุ่นย่อยไม่ถูกแตะ
   */
  async importMaxPrices(dto: ImportMaxPricesDto, userId: string) {
    const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase();
    // ตรวจก่อนเขียน: รุ่น+ความจุ+สภาพ ห้ามซ้ำในไฟล์เดียว
    const seen = new Set<string>();
    for (const item of dto.items) {
      const key = `${item.model.trim().toLowerCase()}|${norm(item.storage)}|${item.condition}`;
      if (seen.has(key)) {
        throw new BadRequestException(
          `ใบราคามีแถวซ้ำ: ${item.model.trim()} ${norm(item.storage)} (${item.condition === 'HAND_1' ? 'มือ 1' : 'มือ 2'}) — รุ่น ความจุ และสภาพเดียวกันต้องมีได้แถวเดียว`,
        );
      }
      seen.add(key);
    }
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.gfinModelMapping.findMany({ where: { deletedAt: null } });
      for (const item of dto.items) {
        const model = item.model.trim();
        const storage = norm(item.storage);
        const match = existing.find(
          (r) =>
            !r.gfinVariant &&
            r.gfinSeries.trim().toLowerCase() === model.toLowerCase() &&
            norm(r.storage) === storage &&
            r.condition === item.condition,
        );
        const maxPrice = new Prisma.Decimal(item.maxPrice);
        if (!match) {
          await tx.gfinModelMapping.create({
            data: {
              gfinSeries: model,
              gfinVariant: null,
              storage,
              condition: item.condition,
              maxPrice,
              modelMatchPattern: model,
              isActive: true,
            },
          });
          created++;
          continue;
        }
        if (new Decimal(match.maxPrice.toString()).eq(item.maxPrice) && match.modelMatchPattern === model && match.isActive) {
          unchanged++;
          continue;
        }
        await tx.gfinModelMapping.update({
          where: { id: match.id },
          data: { maxPrice, modelMatchPattern: model, isActive: true },
        });
        updated++;
      }
    });
    await this.auditService.log({
      action: 'GFIN_MAX_PRICE_IMPORTED',
      entity: 'gfin_model_mapping',
      entityId: 'batch',
      userId,
      newValue: { created, updated, unchanged, count: dto.items.length },
    });
    return { created, updated, unchanged };
  }

  /** ปิดราคาที่ GFIN ไม่รับแล้ว (สเปค 2026-11-20 §5) — ปิดแล้วไม่หาย เปิดคืนได้ด้วย PATCH max-prices/:id */
  async closeMaxPrices(dto: CloseMaxPricesDto, userId: string) {
    const ids = [...new Set(dto.ids)];
    const { count } = await this.prisma.gfinModelMapping.updateMany({
      where: { id: { in: ids }, deletedAt: null, isActive: true },
      data: { isActive: false },
    });
    await this.auditService.log({
      action: 'GFIN_MAX_PRICES_CLOSED',
      entity: 'gfin_model_mapping',
      entityId: 'batch',
      userId,
      newValue: { ids, closed: count },
    });
    return { closed: count };
  }

  // ===== Overprice Rules =====

  listOverpriceRules() {
    return this.prisma.gfinOverpriceRule.findMany({
      where: { deletedAt: null },
      orderBy: [{ condition: 'asc' }, { label: 'asc' }],
    });
  }

  async createOverpriceRule(dto: CreateOverpriceRuleDto, userId: string) {
    assertSingleSeries(dto.seriesPattern);
    let row;
    try {
      row = await this.prisma.gfinOverpriceRule.create({
        data: {
          label: dto.label,
          seriesPattern: dto.seriesPattern.trim(),
          condition: dto.condition,
          allowance: new Prisma.Decimal(dto.allowance),
          maxMonths: dto.maxMonths ?? null,
          minDownPct: dto.minDownPct ?? null,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(RULE_EXISTS_MESSAGE);
      throw e;
    }
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
    assertSingleSeries(dto.seriesPattern);
    const existing = await this.prisma.gfinOverpriceRule.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new NotFoundException('ไม่พบ row นี้');

    const data: Prisma.GfinOverpriceRuleUpdateInput = {};
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.seriesPattern !== undefined) data.seriesPattern = dto.seriesPattern.trim();
    if (dto.condition !== undefined) data.condition = dto.condition;
    if (dto.allowance !== undefined) data.allowance = new Prisma.Decimal(dto.allowance);
    if (dto.maxMonths !== undefined) data.maxMonths = dto.maxMonths;
    if (dto.minDownPct !== undefined) data.minDownPct = dto.minDownPct;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    let updated;
    try {
      updated = await this.prisma.gfinOverpriceRule.update({ where: { id }, data });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(RULE_EXISTS_MESSAGE);
      throw e;
    }
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

  /**
   * แก้เงื่อนไขหลายรุ่นพร้อมกัน (สเปก 2026-11-20 §5) — ทั้งชุดใน transaction เดียว (พลาดแถวเดียว = ไม่บันทึกเลย)
   * คู่ที่มีกติกาแล้ว (รวมที่ปิดใช้) = แก้แถวเดิม + เปิดใช้ · คู่ใหม่ต้องมี OVER และผ่อนสูงสุด · audit ครั้งเดียวหลัง commit
   */
  async bulkUpsertOverpriceRules(dto: BulkUpsertOverpriceRulesDto, userId: string) {
    const hand = (c: string) => (c === 'HAND_1' ? 'มือ 1' : 'มือ 2');
    const items = dto.items.map((i) => ({ series: i.series.trim(), condition: i.condition }));
    if (dto.allowance === undefined && dto.maxMonths === undefined && dto.minDownPct === undefined) {
      throw new BadRequestException('ไม่มีค่าที่จะเปลี่ยน — เลือก OVER ผ่อนสูงสุด หรือดาวน์อย่างน้อยหนึ่งอย่าง');
    }
    const seen = new Set<string>();
    for (const i of items) {
      const key = `${i.series}|${i.condition}`;
      if (seen.has(key)) throw new BadRequestException(`เลือก ${i.series} ${hand(i.condition)} ซ้ำ`);
      seen.add(key);
    }
    const seriesList = [...new Set(items.map((i) => i.series))];

    type Change = { series: string; condition: string; before: unknown; after: unknown };
    let result: {
      created: number;
      updated: number;
      rows: GfinOverpriceRule[];
      changes: Change[];
    };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const priced = await tx.gfinModelMapping.findMany({
          where: { deletedAt: null, gfinVariant: null, gfinSeries: { in: seriesList } },
          select: { gfinSeries: true },
        });
        const pricedSet = new Set(priced.map((p) => p.gfinSeries));
        const missing = seriesList.find((s) => !pricedSet.has(s));
        if (missing) throw new BadRequestException(`ไม่พบรุ่น ${missing} ในใบราคา — นำเข้าใบราคาที่มีรุ่นนี้ก่อน`);

        const existing = await tx.gfinOverpriceRule.findMany({
          where: { deletedAt: null, seriesPattern: { in: seriesList } },
        });
        const out = { created: 0, updated: 0, rows: [] as GfinOverpriceRule[], changes: [] as Change[] };
        for (const i of items) {
          const ex = existing.find((r) => r.seriesPattern === i.series && r.condition === i.condition);
          if (ex) {
            const data: Prisma.GfinOverpriceRuleUpdateInput = {};
            if (dto.allowance !== undefined) data.allowance = new Prisma.Decimal(dto.allowance);
            if (dto.maxMonths !== undefined) data.maxMonths = dto.maxMonths;
            if (dto.minDownPct !== undefined) data.minDownPct = dto.minDownPct;
            data.isActive = true;
            const row = await tx.gfinOverpriceRule.update({ where: { id: ex.id }, data });
            out.updated++;
            out.rows.push(row);
            out.changes.push({ series: i.series, condition: i.condition, before: ex, after: row });
          } else {
            if (dto.allowance === undefined || dto.maxMonths === undefined) {
              throw new BadRequestException(`${i.series} ${hand(i.condition)} ยังไม่มีเงื่อนไข — ต้องระบุ OVER และผ่อนสูงสุด`);
            }
            const row = await tx.gfinOverpriceRule.create({
              data: {
                label: `${i.series} ${hand(i.condition)}`,
                seriesPattern: i.series,
                condition: i.condition,
                allowance: new Prisma.Decimal(dto.allowance),
                maxMonths: dto.maxMonths,
                minDownPct: dto.minDownPct ?? null,
                isActive: true,
              },
            });
            out.created++;
            out.rows.push(row);
            out.changes.push({ series: i.series, condition: i.condition, before: null, after: row });
          }
        }
        return out;
      }, { timeout: 30_000 });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException('มีการแก้เงื่อนไขของรุ่นเดียวกันพร้อมกัน — โหลดหน้าใหม่แล้วลองอีกครั้ง');
      }
      throw e;
    }
    await this.auditService.log({
      action: 'GFIN_RULES_BULK_UPSERTED',
      entity: 'gfin_overprice_rule',
      entityId: 'bulk',
      userId,
      newValue: { changes: result.changes } as unknown as Record<string, unknown>,
    });
    return { created: result.created, updated: result.updated, rows: result.rows };
  }

  // ===== Rate Factors =====

  listRateFactors() {
    return this.prisma.gfinRateFactor.findMany({
      where: { deletedAt: null },
      orderBy: [{ months: 'asc' }, { shopCommissionPct: 'asc' }],
    });
  }

  async createRateFactor(dto: CreateRateFactorDto, userId: string) {
    const row = await this.prisma.gfinRateFactor.create({
      data: {
        months: dto.months,
        shopCommissionPct: dto.shopCommissionPct ?? 15,
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
    if (dto.shopCommissionPct !== undefined) data.shopCommissionPct = dto.shopCommissionPct;
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

  // ===== ค่าตั้งค่า GFIN (system_config gfin.*) =====

  async getSettings(): Promise<GfinSettingsView> {
    const [settings, sheet] = await Promise.all([loadGfinSettings(this.prisma), loadGfinSheetInfo(this.prisma)]);
    return { ...settings, ...sheet };
  }

  async updateSettings(dto: UpdateGfinSettingsDto, userId: string): Promise<GfinSettingsView> {
    const before = await this.getSettings();
    // สเปก 2026-11-20 §5: ตรวจเฉพาะเมื่อค่าคอม iPhone เปลี่ยน — ไม่มีตารางค่างวดของ % ใหม่ = GFIN คิดผ่อนไม่ได้ทุกเครื่อง
    if (dto.commissionPhone !== undefined && dto.commissionPhone !== before.commissionPctByCategory.PHONE) {
      const factors = await this.prisma.gfinRateFactor.count({
        where: { shopCommissionPct: dto.commissionPhone, isActive: true, deletedAt: null },
      });
      if (factors === 0) {
        throw new BadRequestException(
          `ยังไม่มีตารางค่างวดของคอม ${dto.commissionPhone}% — เพิ่มตารางค่างวดก่อน แล้วค่อยเปลี่ยนค่าคอม`,
        );
      }
    }
    const writes: Array<[string, string | number | undefined, string]> = [
      [GFIN_SETTINGS_KEYS.minDownPct, dto.minDownPct, 'GFIN: % ดาวน์ขั้นต่ำที่ GFIN ตั้งให้ร้าน'],
      [GFIN_SETTINGS_KEYS.commissionPhone, dto.commissionPhone, 'GFIN: % คอมมิชชั่นตั้งต้น มือถือ'],
      [GFIN_SETTINGS_KEYS.commissionTablet, dto.commissionTablet, 'GFIN: % คอมมิชชั่นตั้งต้น iPad'],
      [GFIN_SETTINGS_KEYS.contractFee, dto.contractFee, 'GFIN: ค่าทำสัญญาที่หักจากยอดโอนให้ร้าน'],
      [GFIN_SETTINGS_KEYS.sheetVersion, dto.sheetVersion?.trim(), 'GFIN: เวอร์ชันใบเงื่อนไข G Finn'],
      [GFIN_SETTINGS_KEYS.sheetEffectiveDate, dto.sheetEffectiveDate, 'GFIN: วันเริ่มใช้ใบเงื่อนไข G Finn'],
    ];
    for (const [key, value, label] of writes) {
      if (value === undefined) continue;
      await this.prisma.systemConfig.upsert({
        where: { key },
        create: { key, value: String(value), label },
        update: { value: String(value), deletedAt: null },
      });
    }
    const after = await this.getSettings();
    await this.auditService.log({
      action: 'GFIN_SETTINGS_UPDATED',
      entity: 'system_config',
      entityId: 'gfin',
      userId,
      oldValue: before as unknown as Record<string, unknown>,
      newValue: after as unknown as Record<string, unknown>,
    });
    return after;
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
