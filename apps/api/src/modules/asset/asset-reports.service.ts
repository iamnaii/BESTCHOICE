import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma, AssetStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';

export interface SummaryRow {
  key: string; // category enum / custodian text / location text
  label: string;
  count: number;
  totalPurchaseCost: string;
  totalAccumulatedDepr: string;
  totalNbv: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  EQUIPMENT: 'อุปกรณ์สำนักงาน',
  IMPROVEMENT: 'ส่วนปรับปรุงอาคาร',
  FURNITURE: 'เครื่องตกแต่งสำนักงาน',
  VEHICLE: 'ยานพาหนะ',
};

@Injectable()
export class AssetReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(filters: {
    groupBy: 'category' | 'custodian' | 'location';
    asOfDate?: string;
    status?: AssetStatus;
    branchId?: string;
  }): Promise<SummaryRow[]> {
    if (!['category', 'custodian', 'location'].includes(filters.groupBy)) {
      throw new BadRequestException(
        'groupBy ต้องเป็น category, custodian, หรือ location',
      );
    }

    const asOfDate = filters.asOfDate ? new Date(filters.asOfDate) : new Date();
    const asOfYearMonth = `${asOfDate.getFullYear()}-${String(
      asOfDate.getMonth() + 1,
    ).padStart(2, '0')}`;

    const where: Prisma.FixedAssetWhereInput = {
      deletedAt: null,
      purchaseDate: { lte: asOfDate },
    };

    if (filters.status) {
      // User explicitly wants a specific status — narrow active-at-asOfDate accordingly
      if (filters.status === 'POSTED') {
        where.status = 'POSTED';
      } else if (filters.status === 'DISPOSED' || filters.status === 'WRITTEN_OFF') {
        where.status = filters.status;
        where.disposalDate = { gt: asOfDate }; // still active at asOfDate (not yet disposed)
      } else {
        where.status = filters.status; // DRAFT, REVERSED — pass through
      }
    } else {
      // No status filter: include POSTED OR (DISPOSED/WRITTEN_OFF still active at asOfDate)
      where.OR = [
        { status: 'POSTED' },
        {
          AND: [
            { status: { in: ['DISPOSED', 'WRITTEN_OFF'] } },
            { disposalDate: { gt: asOfDate } },
          ],
        },
      ];
    }

    if (filters.branchId) where.branchId = filters.branchId;

    const assets = await this.prisma.fixedAsset.findMany({
      where,
      select: {
        id: true,
        category: true,
        custodian: true,
        location: true,
        purchaseCost: true,
        monthlyDepr: true,
        residualValue: true,
      },
    });

    const assetIds = assets.map((a) => a.id);
    if (assetIds.length === 0) return [];

    const entries = await this.prisma.depreciationEntry.findMany({
      where: {
        assetId: { in: assetIds },
        period: { lte: asOfYearMonth },
        reversedAt: null,
      },
      select: { assetId: true, amount: true },
    });
    const accumByAsset = new Map<string, Decimal>();
    for (const e of entries) {
      const cur = accumByAsset.get(e.assetId) ?? new Decimal(0);
      accumByAsset.set(e.assetId, cur.plus(e.amount.toString()));
    }

    const groups = new Map<
      string,
      { count: number; pc: Decimal; ad: Decimal; nbv: Decimal; label: string }
    >();
    for (const a of assets) {
      const accumulated = accumByAsset.get(a.id) ?? new Decimal(0);
      const purchaseCost = new Decimal(a.purchaseCost.toString());
      const nbv = purchaseCost.minus(accumulated);

      let key: string;
      let label: string;
      if (filters.groupBy === 'category') {
        key = a.category;
        label = CATEGORY_LABELS[a.category] ?? a.category;
      } else if (filters.groupBy === 'custodian') {
        key = a.custodian ?? 'ไม่ระบุ';
        label = key;
      } else {
        key = a.location ?? 'ไม่ระบุ';
        label = key;
      }

      const g = groups.get(key) ?? {
        count: 0,
        pc: new Decimal(0),
        ad: new Decimal(0),
        nbv: new Decimal(0),
        label,
      };
      g.count += 1;
      g.pc = g.pc.plus(purchaseCost);
      g.ad = g.ad.plus(accumulated);
      g.nbv = g.nbv.plus(nbv);
      groups.set(key, g);
    }

    return Array.from(groups.entries())
      .map(([key, g]) => ({
        key,
        label: g.label,
        count: g.count,
        totalPurchaseCost: g.pc.toFixed(2),
        totalAccumulatedDepr: g.ad.toFixed(2),
        totalNbv: g.nbv.toFixed(2),
      }))
      .sort((a, b) => b.count - a.count);
  }
}
