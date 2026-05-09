import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';

const ASSET_FLOWS = [
  'asset-purchase',
  'asset-purchase-reverse',
  'asset-disposal',
  'asset-disposal-reverse',
  'depreciation',
  'depreciation-reverse',
] as const;

const FLOW_GROUPS: Record<string, string[]> = {
  'asset-purchase': ['asset-purchase'],
  'asset-purchase-reverse': ['asset-purchase-reverse'],
  'asset-disposal': ['asset-disposal'],
  'asset-disposal-reverse': ['asset-disposal-reverse'],
  'depreciation': ['depreciation'],
  'depreciation-reverse': ['depreciation-reverse'],
  'all-reversals': ['asset-purchase-reverse', 'asset-disposal-reverse', 'depreciation-reverse'],
  'all': [...ASSET_FLOWS],
};

@Injectable()
export class AssetJournalService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: {
    page?: number;
    limit?: number;
    search?: string;
    flowType?: string;
    fromDate?: string;
    toDate?: string;
  }) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    const flows = FLOW_GROUPS[filters.flowType ?? 'all'] ?? [...ASSET_FLOWS];

    const flowOr = flows.map((f) => ({ metadata: { path: ['flow'], equals: f } }));
    const where: Prisma.JournalEntryWhereInput = {
      deletedAt: null,
      OR: flowOr,
    };

    if (filters.fromDate || filters.toDate) {
      where.entryDate = {};
      if (filters.fromDate) where.entryDate.gte = new Date(filters.fromDate);
      if (filters.toDate) {
        const end = new Date(filters.toDate);
        end.setHours(23, 59, 59, 999);
        where.entryDate.lte = end;
      }
    }

    if (filters.search) {
      const assets = await this.prisma.fixedAsset.findMany({
        where: {
          OR: [
            { assetCode: { contains: filters.search, mode: 'insensitive' } },
            { name: { contains: filters.search, mode: 'insensitive' } },
            { serialNo: { contains: filters.search, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
        take: 500,
      });
      const matchingIds = assets.map((a) => a.id);
      if (matchingIds.length === 0) return { data: [], total: 0, page, limit };
      where.AND = [
        { OR: matchingIds.map((id) => ({ metadata: { path: ['assetId'], equals: id } })) },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        orderBy: { entryDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { lines: true },
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    const assetIds = Array.from(
      new Set(
        rows
          .map((r) => (r.metadata as Record<string, unknown> | null)?.assetId as string | undefined)
          .filter(Boolean) as string[],
      ),
    );
    const assets = assetIds.length
      ? await this.prisma.fixedAsset.findMany({
          where: { id: { in: assetIds } },
          select: { id: true, assetCode: true, name: true },
        })
      : [];
    const assetById = new Map(assets.map((a) => [a.id, a]));

    const data = rows.map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const flow = (meta.flow as string) ?? 'unknown';
      const assetId = (meta.assetId as string) ?? null;
      const totalDr = r.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
      const totalCr = r.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
      return {
        id: r.id,
        entryNumber: r.entryNumber,
        entryDate: r.entryDate.toISOString().slice(0, 10),
        status: r.status,
        description: r.description,
        flow,
        assetId,
        asset: assetId ? assetById.get(assetId) ?? null : null,
        totalDr: totalDr.toFixed(2),
        totalCr: totalCr.toFixed(2),
        reversed: meta.reversed === true,
        reversedByEntryNumber: (meta.reversedByEntryNumber as string) ?? null,
      };
    });

    return { data, total, page, limit };
  }
}
