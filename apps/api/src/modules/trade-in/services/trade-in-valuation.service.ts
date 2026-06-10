import { PrismaService } from '../../../prisma/prisma.service';
import { paginatedResponse } from '../../../common/helpers/pagination.helper';
import { UpsertValuationDto } from '../dto/trade-in.dto';
import { Prisma, PrismaClient } from '@prisma/client';

// tradeInValuation is added via migration — cast prisma to any until `prisma generate` runs
type PrismaAny = PrismaClient & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export class TradeInValuationService {
  constructor(private prisma: PrismaService) {}

  // ─── Valuation table lookup ───────────────────────────────

  /**
   * Lookup suggested price from the valuation table.
   * Returns null if no record found (staff can still enter price manually).
   */
  async lookupValuation(
    brand: string,
    model: string,
    storage: string,
    condition: string,
  ): Promise<{
    found: boolean;
    suggestedPrice: number | null;
    brand: string;
    model: string;
    storage: string;
    condition: string;
    note: string | null;
  }> {
    const db = this.prisma as unknown as PrismaAny;
    const record = await db.tradeInValuation.findFirst({
      where: {
        brand: { equals: brand, mode: 'insensitive' },
        model: { equals: model, mode: 'insensitive' },
        storage: { equals: storage, mode: 'insensitive' },
        condition,
        deletedAt: null,
      },
    });

    return {
      found: !!record,
      suggestedPrice: record ? Number(record.basePrice) : null,
      brand,
      model,
      storage,
      condition,
      note: record?.note ?? null,
    };
  }

  /** List all brands in the valuation table (for autocomplete) */
  async getValuationBrands(): Promise<string[]> {
    const db = this.prisma as unknown as PrismaAny;
    const rows = await db.tradeInValuation.findMany({
      where: { deletedAt: null },
      select: { brand: true },
      distinct: ['brand'],
      orderBy: { brand: 'asc' },
    });
    return rows.map((r) => r.brand);
  }

  /** List all models for a given brand */
  async getValuationModels(brand: string): Promise<string[]> {
    const db = this.prisma as unknown as PrismaAny;
    const rows = await db.tradeInValuation.findMany({
      where: { brand: { equals: brand, mode: 'insensitive' }, deletedAt: null },
      select: { model: true },
      distinct: ['model'],
      orderBy: { model: 'asc' },
    });
    return rows.map((r) => r.model);
  }

  /** Upsert a valuation record (admin use) */
  async upsertValuation(dto: UpsertValuationDto) {
    const db = this.prisma as unknown as PrismaAny;
    const existing = await db.tradeInValuation.findFirst({
      where: {
        brand: { equals: dto.brand, mode: 'insensitive' },
        model: { equals: dto.model, mode: 'insensitive' },
        storage: { equals: dto.storage, mode: 'insensitive' },
        condition: dto.condition,
        deletedAt: null,
      },
    });

    if (existing) {
      return db.tradeInValuation.update({
        where: { id: existing.id },
        data: {
          basePrice: new Prisma.Decimal(dto.basePrice),
          note: dto.note ?? existing.note,
        },
      });
    }

    return db.tradeInValuation.create({
      data: {
        brand: dto.brand,
        model: dto.model,
        storage: dto.storage,
        condition: dto.condition,
        basePrice: new Prisma.Decimal(dto.basePrice),
        note: dto.note,
      },
    });
  }

  /** List all valuation records with optional brand/model filter */
  async listValuations(filters: { brand?: string; model?: string; page?: number; limit?: number }) {
    const { brand, model, page = 1, limit = 50 } = filters;
    const db = this.prisma as unknown as PrismaAny;
    const where: Record<string, unknown> = { deletedAt: null };
    if (brand) where['brand'] = { equals: brand, mode: 'insensitive' };
    if (model) where['model'] = { contains: model, mode: 'insensitive' };

    const [data, total] = await Promise.all([
      db.tradeInValuation.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ brand: 'asc' }, { model: 'asc' }, { storage: 'asc' }, { condition: 'asc' }],
      }),
      db.tradeInValuation.count({ where }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }
}
