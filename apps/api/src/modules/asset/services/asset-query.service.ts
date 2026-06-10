import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma, AssetCategory, AssetStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { buildDepreciationSchedule } from '../depreciation-schedule.util';

/**
 * AssetQueryService — read-only / reporting paths for fixed assets:
 * findAll / findOne / getDepreciationSummary / getAuditTrail / getRegister /
 * getAssetSchedule / vendorNames / listGlobalAudit + the runMonthEndDepreciation
 * throwing stub (Phase 2). No JE writes, no $transaction. Constructed internally
 * by the AssetService facade — NOT a Nest provider.
 */
export class AssetQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filters: {
    branchId?: string;
    category?: AssetCategory | string;
    status?: AssetStatus | string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const where: Prisma.FixedAssetWhereInput = { deletedAt: null };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.category) where.category = filters.category as AssetCategory;
    if (filters.status) where.status = filters.status as AssetStatus;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { assetCode: { contains: filters.search, mode: 'insensitive' } },
        { docNo: { contains: filters.search, mode: 'insensitive' } },
        { serialNo: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.fixedAsset.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { purchaseDate: 'desc' },
        include: {
          branch: true,
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.fixedAsset.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Distinct free-text vendor/supplier names previously used on assets — surfaced
   * as "เคยใช้" suggestions in the asset entry vendor combobox so a one-off name
   * typed before can be reused without re-registering a Supplier master.
   */
  async vendorNames(limit = 200): Promise<string[]> {
    const rows = await this.prisma.fixedAsset.findMany({
      where: { deletedAt: null, supplierName: { not: null } },
      select: { supplierName: true },
      distinct: ['supplierName'],
      orderBy: { supplierName: 'asc' },
      take: limit,
    });
    return rows.map((r) => r.supplierName?.trim() ?? '').filter((n) => n.length > 0);
  }

  async findOne(id: string) {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
      include: {
        branch: true,
        createdBy: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
        postedBy: { select: { id: true, name: true } },
        reversedBy: { select: { id: true, name: true } },
        invoiceReceivedBy: { select: { id: true, name: true } },
        transferHistory: {
          orderBy: { transferDate: 'desc' },
          take: 10,
          include: { transferredBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');
    return asset;
  }

  async getDepreciationSummary() {
    const [draft, posted, reversed, disposed, writtenOff, totalCost, totalNbv] =
      await Promise.all([
        this.prisma.fixedAsset.count({
          where: { status: AssetStatus.DRAFT, deletedAt: null },
        }),
        this.prisma.fixedAsset.count({
          where: { status: AssetStatus.POSTED, deletedAt: null },
        }),
        this.prisma.fixedAsset.count({
          where: { status: AssetStatus.REVERSED, deletedAt: null },
        }),
        this.prisma.fixedAsset.count({
          where: { status: AssetStatus.DISPOSED, deletedAt: null },
        }),
        this.prisma.fixedAsset.count({
          where: { status: AssetStatus.WRITTEN_OFF, deletedAt: null },
        }),
        this.prisma.fixedAsset.aggregate({
          where: { status: AssetStatus.POSTED, deletedAt: null },
          _sum: { purchaseCost: true },
        }),
        this.prisma.fixedAsset.aggregate({
          where: { status: AssetStatus.POSTED, deletedAt: null },
          _sum: { netBookValue: true },
        }),
      ]);
    return {
      draft,
      posted,
      reversed,
      disposed,
      writtenOff,
      totalPurchaseCost: totalCost._sum.purchaseCost ?? new Decimal(0),
      totalNetBookValue: totalNbv._sum.netBookValue ?? new Decimal(0),
    };
  }

  async getAuditTrail(assetId: string) {
    return this.prisma.auditLog.findMany({
      where: { entity: 'fixed_asset', entityId: assetId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { id: true, name: true } } },
    });
  }

  /**
   * Asset Register report — paginated rows of fixed assets active AT `asOfDate`,
   * with historical accumulated depreciation + net book value computed from
   * DepreciationEntry rows up to the asOfDate's year-month (exclusive of reversed entries).
   *
   * Asset filter:
   *  - purchaseDate ≤ asOfDate
   *  - status='POSTED'  OR  (status IN ['DISPOSED','WRITTEN_OFF'] AND disposalDate > asOfDate)
   *
   * Per-row historical NBV:
   *  accumulatedDeprAt = SUM(DepreciationEntry.amount WHERE assetId = id
   *                            AND period ≤ asOfYearMonth AND reversedAt IS NULL)
   *  netBookValueAt    = purchaseCost − accumulatedDeprAt
   *  remainingMonths   = ceil((netBookValueAt − residualValue) / monthlyDepr), floor at 0
   *
   * Returns: { data, total, page, limit, asOfDate (resolved), summary }
   */
  async getRegister(filters: {
    asOfDate?: string;
    category?: AssetCategory;
    status?: AssetStatus;
    branchId?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const asOfDate = filters.asOfDate ? new Date(filters.asOfDate) : new Date();
    const asOfYearMonth = `${asOfDate.getFullYear()}-${String(
      asOfDate.getMonth() + 1,
    ).padStart(2, '0')}`;
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);

    // Filter assets: purchased on or before asOfDate; if disposed/written-off,
    // disposalDate <= asOfDate (disposed by the report date).
    const where: Prisma.FixedAssetWhereInput = {
      deletedAt: null,
      purchaseDate: { lte: asOfDate },
    };

    if (filters.status) {
      // User explicitly wants a specific status — narrow active-at-asOfDate accordingly
      if (filters.status === AssetStatus.POSTED) {
        where.status = AssetStatus.POSTED;
      } else if (
        filters.status === AssetStatus.DISPOSED ||
        filters.status === AssetStatus.WRITTEN_OFF
      ) {
        where.status = filters.status;
        where.disposalDate = { lte: asOfDate }; // disposed BY the report date
      } else {
        where.status = filters.status; // DRAFT, REVERSED — pass through
      }
    } else {
      // No status filter: include POSTED OR (DISPOSED/WRITTEN_OFF still active at asOfDate)
      where.OR = [
        { status: AssetStatus.POSTED },
        {
          AND: [
            { status: { in: [AssetStatus.DISPOSED, AssetStatus.WRITTEN_OFF] } },
            { disposalDate: { gt: asOfDate } },
          ],
        },
      ];
    }

    if (filters.category) where.category = filters.category;
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.search) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { assetCode: { contains: filters.search, mode: 'insensitive' } },
            { name: { contains: filters.search, mode: 'insensitive' } },
            { serialNo: { contains: filters.search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [assets, total] = await Promise.all([
      this.prisma.fixedAsset.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { purchaseDate: 'desc' },
        include: { branch: { select: { id: true, name: true } } },
      }),
      this.prisma.fixedAsset.count({ where }),
    ]);

    // Compute historical NBV per asset
    const assetIds = assets.map((a) => a.id);
    const entries = assetIds.length
      ? await this.prisma.depreciationEntry.findMany({
          where: {
            assetId: { in: assetIds },
            period: { lte: asOfYearMonth },
            reversedAt: null,
          },
        })
      : [];

    const accumByAsset = new Map<string, Decimal>();
    for (const e of entries) {
      const cur = accumByAsset.get(e.assetId) ?? new Decimal(0);
      accumByAsset.set(e.assetId, cur.plus(e.amount.toString()));
    }

    let totalPurchaseCost = new Decimal(0);
    let totalAccumulatedDepr = new Decimal(0);
    let totalNbv = new Decimal(0);

    const data = assets.map((a) => {
      const purchaseCost = new Decimal(a.purchaseCost.toString());
      const residualValue = new Decimal(a.residualValue.toString());
      const monthlyDepr = new Decimal(a.monthlyDepr.toString());
      const accumulatedDeprAt = accumByAsset.get(a.id) ?? new Decimal(0);
      const netBookValueAt = purchaseCost.minus(accumulatedDeprAt);
      const remainingDepreciable = netBookValueAt.minus(residualValue);
      const remainingMonths =
        monthlyDepr.gt(0) && remainingDepreciable.gt(0)
          ? remainingDepreciable.div(monthlyDepr).ceil().toNumber()
          : 0;

      totalPurchaseCost = totalPurchaseCost.plus(purchaseCost);
      totalAccumulatedDepr = totalAccumulatedDepr.plus(accumulatedDeprAt);
      totalNbv = totalNbv.plus(netBookValueAt);

      return {
        id: a.id,
        assetCode: a.assetCode,
        name: a.name,
        category: a.category,
        branchId: a.branchId,
        branch: a.branch,
        custodian: a.custodian,
        location: a.location,
        purchaseDate: a.purchaseDate.toISOString().slice(0, 10),
        purchaseCost: purchaseCost.toFixed(2),
        accumulatedDeprAt: accumulatedDeprAt.toFixed(2),
        netBookValueAt: netBookValueAt.toFixed(2),
        monthlyDepr: monthlyDepr.toFixed(2),
        remainingMonths,
        status: a.status,
      };
    });

    return {
      data,
      total,
      page,
      limit,
      asOfDate: asOfDate.toISOString().slice(0, 10),
      summary: {
        count: total,
        totalPurchaseCost: totalPurchaseCost.toFixed(2),
        totalAccumulatedDepr: totalAccumulatedDepr.toFixed(2),
        totalNbv: totalNbv.toFixed(2),
      },
    };
  }

  /**
   * Per-asset Asset Schedule — day-based month-by-month NBV projection.
   *
   * Behavior:
   *  - Projection comes from buildDepreciationSchedule (dailyRate × days/period,
   *    partial first/last months, forced-exact final period) — the same source
   *    of truth as the depreciation template + preview.
   *  - Each row: if a DepreciationEntry exists for the period, its actual posted
   *    amount overrides the projection; otherwise the scheduled amount is used
   *    (clamped so we never depreciate below the residualValue floor)
   *  - Stops at the first FULLY_DEPRECIATED period (NBV ≤ residualValue)
   *  - asset.disposalDate truncates the schedule (R4)
   */
  async getAssetSchedule(assetId: string) {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id: assetId, deletedAt: null },
    });
    if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');

    const purchaseCost = new Decimal(asset.purchaseCost.toString());
    const residualValue = new Decimal(asset.residualValue.toString());
    const monthlyDepr = new Decimal(asset.monthlyDepr.toString());
    const depreciableBase = purchaseCost.minus(residualValue);

    // Load existing entries indexed by period (skip reversed) — actual posted
    // amounts override the projection for past periods.
    const entries = await this.prisma.depreciationEntry.findMany({
      where: { assetId, reversedAt: null },
      select: { period: true, amount: true },
    });
    const entryByPeriod = new Map(
      entries.map((e) => [e.period, new Decimal(e.amount.toString())]),
    );

    // Day-based projection — single source of truth shared with template/preview.
    const schedule = buildDepreciationSchedule({
      purchaseCost,
      residualValue,
      usefulLifeMonths: asset.usefulLifeMonths,
      startDate: asset.purchaseDate,
      disposalDate: asset.disposalDate,
    });

    const rows: Array<{
      period: string;
      days: number;
      monthlyDepr: string;
      accumulatedDepr: string;
      netBookValue: string;
      status: 'ACTIVE' | 'FULLY_DEPRECIATED';
    }> = [];

    let accumulated = new Decimal(0);
    for (const r of schedule.rows) {
      const posted = entryByPeriod.get(r.period);
      let thisMonth = posted ?? r.amount;
      // Never depreciate past the residual floor.
      const remaining = depreciableBase.minus(accumulated);
      if (thisMonth.gt(remaining)) thisMonth = remaining;
      if (thisMonth.lte(0)) break;

      accumulated = accumulated.plus(thisMonth);
      const nbv = purchaseCost.minus(accumulated);
      const status: 'ACTIVE' | 'FULLY_DEPRECIATED' =
        nbv.lte(residualValue) ? 'FULLY_DEPRECIATED' : 'ACTIVE';

      rows.push({
        period: r.period,
        days: r.days,
        monthlyDepr: thisMonth.toFixed(2),
        accumulatedDepr: accumulated.toFixed(2),
        netBookValue: nbv.toFixed(2),
        status,
      });

      if (status === 'FULLY_DEPRECIATED') break;
    }

    return {
      assetId: asset.id,
      assetCode: asset.assetCode,
      name: asset.name,
      purchaseDate: asset.purchaseDate.toISOString().slice(0, 10),
      purchaseCost: purchaseCost.toFixed(2),
      residualValue: residualValue.toFixed(2),
      monthlyDepr: monthlyDepr.toFixed(2),
      dailyDepr: schedule.dailyDepr.toFixed(4),
      rows,
    };
  }

  /** Backward-compat for controller — implemented in Task 9. */
  async runMonthEndDepreciation(_period: string | undefined, _userId: string) {
    throw new Error('runMonthEndDepreciation: implement in Task 9 (Phase 2)');
  }

  /** Global audit feed — all AuditLog rows where entity = 'asset', paginated. */
  async listGlobalAudit(params: {
    page?: number;
    limit?: number;
    action?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<{
    data: Array<{
      id: string;
      action: string;
      entity: string;
      entityId: string;
      userId: string;
      user: { id: string; name: string };
      oldValue: unknown;
      newValue: unknown;
      ipAddress: string | null;
      createdAt: Date;
      assetCode: string | null;
      assetName: string | null;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 200) : 50;

    const where: Record<string, unknown> = { entity: 'fixed_asset' };
    if (params.action) where.action = params.action;
    if (params.fromDate || params.toDate) {
      const range: Record<string, Date> = {};
      if (params.fromDate) range.gte = new Date(params.fromDate);
      if (params.toDate) {
        const end = new Date(params.toDate);
        end.setHours(23, 59, 59, 999);
        range.lte = end;
      }
      where.createdAt = range;
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { id: true, name: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // Batch lookup assets to avoid N+1
    const assetIds = Array.from(
      new Set(logs.map((l) => l.entityId).filter((id): id is string => Boolean(id))),
    );
    // Intentional: audit history must show assetCode/assetName even for soft-deleted
    // (deletedAt != null) assets. Project rule deviation acknowledged.
    const assets = assetIds.length
      ? await this.prisma.fixedAsset.findMany({
          where: { id: { in: assetIds } },
          select: { id: true, assetCode: true, name: true },
        })
      : [];
    const assetById = new Map(assets.map((a) => [a.id, a]));

    return {
      data: logs.map((log) => ({
        id: log.id,
        action: log.action,
        entity: log.entity,
        entityId: log.entityId,
        userId: log.userId,
        user: log.user ?? { id: log.userId, name: '' },
        oldValue: log.oldValue,
        newValue: log.newValue,
        ipAddress: log.ipAddress ?? null,
        createdAt: log.createdAt,
        assetCode: assetById.get(log.entityId)?.assetCode ?? null,
        assetName: log.entityId ? (assetById.get(log.entityId)?.name ?? null) : null,
      })),
      total,
      page,
      limit,
    };
  }
}
