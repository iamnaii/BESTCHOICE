import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFixedAssetDto, UpdateFixedAssetDto, DisposeAssetDto } from './dto/asset.dto';
import { AssetDisposalTemplate } from '../journal/cpa-templates/asset-disposal.template';

@Injectable()
export class AssetService {
  private readonly logger = new Logger(AssetService.name);

  constructor(
    private prisma: PrismaService,
    private disposalTemplate: AssetDisposalTemplate,
  ) {}

  /**
   * Generate asset code: PA-YYYYMMXXXX
   */
  async generateAssetCode(): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `PA-${year}${month}`;

    const count = await this.prisma.fixedAsset.count({
      where: { assetCode: { startsWith: prefix } },
    });

    return `${prefix}${String(count + 1).padStart(4, '0')}`;
  }

  /**
   * Create a new fixed asset
   */
  async create(dto: CreateFixedAssetDto, userId: string) {
    return this.prisma.fixedAsset.create({
      data: {
        assetCode: dto.assetCode,
        name: dto.name,
        description: dto.description,
        category: dto.category,
        assetCategory: dto.assetCategory ?? null,
        branchId: dto.branchId,
        costValue: dto.costValue,
        salvageValue: dto.salvageValue ?? 0,
        usefulLife: dto.usefulLife,
        usefulLifeMonths: dto.usefulLifeMonths ?? null,
        purchaseDate: new Date(dto.purchaseDate),
        depreciationAccountCode: dto.depreciationAccountCode ?? '53-1601',
        accumulatedAccountCode: dto.accumulatedAccountCode ?? '12-2102',
        status: 'ACTIVE',
        createdById: userId,
      },
      include: { branch: true },
    });
  }

  /**
   * List assets with filters and pagination
   */
  async findAll(filters: {
    branchId?: string;
    category?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const where: Record<string, unknown> = { deletedAt: null };

    if (filters.branchId) {
      where.branchId = filters.branchId;
    }
    if (filters.category) {
      where.category = filters.category;
    }
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { assetCode: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.fixedAsset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.fixedAsset.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Get a single asset by ID
   */
  async findOne(id: string) {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
      include: {
        branch: true,
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    if (!asset) {
      throw new NotFoundException('ไม่พบสินทรัพย์ที่ระบุ');
    }

    return asset;
  }

  /**
   * Update an asset
   */
  async update(id: string, dto: UpdateFixedAssetDto) {
    const existing = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('ไม่พบสินทรัพย์ที่ระบุ');
    }

    const data: Record<string, unknown> = { ...dto };
    if (dto.purchaseDate) {
      data.purchaseDate = new Date(dto.purchaseDate);
    }

    return this.prisma.fixedAsset.update({
      where: { id },
      data,
      include: { branch: true },
    });
  }

  /**
   * Dispose an asset — posts AssetDisposalTemplate JE (Phase A.5c).
   * Updates asset status to DISPOSED and records disposal proceeds.
   */
  async dispose(id: string, dto: DisposeAssetDto) {
    const existing = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('ไม่พบสินทรัพย์ที่ระบุ');
    }

    const result = await this.disposalTemplate.execute({
      assetId: id,
      disposalDate: new Date(),
      disposalProceeds: new Decimal(dto.disposalProceeds?.toString() ?? '0'),
      depositAccountCode: dto.depositAccountCode,
    });

    // Add disposalNote if provided (template already sets a default)
    if (dto.disposalNote) {
      await this.prisma.fixedAsset.update({
        where: { id },
        data: { disposalNote: dto.disposalNote },
      });
    }

    return {
      ...(await this.prisma.fixedAsset.findFirst({
        where: { id },
        include: { branch: true },
      })),
      journalEntryNo: result.entryNo,
    };
  }

  /**
   * Calculate monthly straight-line depreciation for an asset
   */
  calculateMonthlyDepreciation(asset: {
    costValue: unknown;
    salvageValue: unknown;
    usefulLife: number;
    accumulatedDepre: unknown;
  }): number {
    const cost = Number(asset.costValue);
    const salvage = Number(asset.salvageValue);
    const maxDepre = cost - salvage;
    const remaining = maxDepre - Number(asset.accumulatedDepre);

    if (remaining <= 0) return 0; // Fully depreciated

    const annualDepre = (cost - salvage) / asset.usefulLife;
    const monthlyDepre = Math.round((annualDepre / 12) * 100) / 100;

    return Math.min(monthlyDepre, remaining); // Don't exceed remaining
  }

  /**
   * Month-end batch depreciation processing
   * Creates journal entries for each active asset's monthly depreciation
   */
  async runMonthEndDepreciation(companyId?: string, userId?: string) {
    this.logger.log('Starting month-end depreciation batch...');

    const assets = await this.prisma.fixedAsset.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      include: {
        branch: { select: { id: true, name: true, companyId: true } },
      },
    });

    let assetsProcessed = 0;
    let totalDepreciation = 0;
    let journalEntriesCreated = 0;

    for (const asset of assets) {
      const monthlyDepre = this.calculateMonthlyDepreciation(asset);
      if (monthlyDepre <= 0) continue;

      assetsProcessed++;
      totalDepreciation += monthlyDepre;

      await this.prisma.$transaction(async (tx) => {
        // Update accumulated depreciation
        const newAccumulated = Number(asset.accumulatedDepre) + monthlyDepre;
        const maxDepre = Number(asset.costValue) - Number(asset.salvageValue);
        const isFullyDepreciated = newAccumulated >= maxDepre;

        await tx.fixedAsset.update({
          where: { id: asset.id },
          data: {
            accumulatedDepre: newAccumulated,
            status: isFullyDepreciated ? 'FULLY_DEPRECIATED' : 'ACTIVE',
          },
        });

        // Determine companyId: prefer passed-in, then branch's company, then default
        let entryCompanyId = companyId;
        if (!entryCompanyId && asset.branch?.companyId) {
          entryCompanyId = asset.branch.companyId;
        }
        if (!entryCompanyId) {
          // Find default company
          const defaultCompany = await tx.companyInfo.findFirst({
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
          });
          entryCompanyId = defaultCompany?.id;
        }

        if (!entryCompanyId) {
          this.logger.warn(
            `Skipping journal entry for asset ${asset.assetCode}: no companyId found`,
          );
          return;
        }

        // Generate journal entry number
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const prefix = `JE-${year}${month}`;
        const count = await tx.journalEntry.count({
          where: { entryNumber: { startsWith: prefix } },
        });
        const entryNumber = `${prefix}-${String(count + 1).padStart(4, '0')}`;

        // Determine createdById for the journal entry
        const createdById = userId ?? asset.createdById;
        if (!createdById) {
          this.logger.warn(
            `Skipping journal entry for asset ${asset.assetCode}: no userId available`,
          );
          return;
        }

        await tx.journalEntry.create({
          data: {
            entryNumber,
            companyId: entryCompanyId,
            entryDate: now,
            description: `ค่าเสื่อมราคา ${asset.name} ประจำเดือน`,
            referenceType: 'DEPRECIATION',
            referenceId: asset.id,
            status: 'POSTED',
            postedAt: now,
            postedById: createdById,
            createdById: createdById,
            lines: {
              create: [
                {
                  accountCode: asset.depreciationAccountCode,
                  description: `ค่าเสื่อมราคา - ${asset.name}`,
                  debit: monthlyDepre,
                  credit: 0,
                },
                {
                  accountCode: asset.accumulatedAccountCode,
                  description: `ค่าเสื่อมราคาสะสม - ${asset.name}`,
                  debit: 0,
                  credit: monthlyDepre,
                },
              ],
            },
          },
        });

        journalEntriesCreated++;
      });
    }

    const summary = { assetsProcessed, totalDepreciation, journalEntriesCreated };
    this.logger.log(
      `Depreciation batch complete: ${assetsProcessed} assets, ` +
        `${totalDepreciation.toFixed(2)} total, ${journalEntriesCreated} journal entries`,
    );

    return summary;
  }

  /**
   * Get depreciation summary aggregated by category and status
   */
  async getDepreciationSummary() {
    const assets = await this.prisma.fixedAsset.findMany({
      where: { deletedAt: null },
      select: {
        category: true,
        status: true,
        costValue: true,
        salvageValue: true,
        accumulatedDepre: true,
      },
    });

    // Aggregate by category
    const byCategory: Record<
      string,
      { count: number; totalCost: number; totalAccumulated: number; netBookValue: number }
    > = {};

    // Aggregate by status
    const byStatus: Record<
      string,
      { count: number; totalCost: number; totalAccumulated: number; netBookValue: number }
    > = {};

    let grandTotalCost = 0;
    let grandTotalAccumulated = 0;

    for (const asset of assets) {
      const cost = Number(asset.costValue);
      const accumulated = Number(asset.accumulatedDepre);
      const nbv = cost - accumulated;
      const category = asset.category || 'ไม่ระบุหมวดหมู่';
      const status = asset.status;

      grandTotalCost += cost;
      grandTotalAccumulated += accumulated;

      // By category
      if (!byCategory[category]) {
        byCategory[category] = { count: 0, totalCost: 0, totalAccumulated: 0, netBookValue: 0 };
      }
      byCategory[category].count++;
      byCategory[category].totalCost += cost;
      byCategory[category].totalAccumulated += accumulated;
      byCategory[category].netBookValue += nbv;

      // By status
      if (!byStatus[status]) {
        byStatus[status] = { count: 0, totalCost: 0, totalAccumulated: 0, netBookValue: 0 };
      }
      byStatus[status].count++;
      byStatus[status].totalCost += cost;
      byStatus[status].totalAccumulated += accumulated;
      byStatus[status].netBookValue += nbv;
    }

    return {
      totalAssets: assets.length,
      grandTotalCost,
      grandTotalAccumulated,
      grandNetBookValue: grandTotalCost - grandTotalAccumulated,
      byCategory,
      byStatus,
    };
  }

  /**
   * Cron: Run monthly depreciation on the 1st of every month at 00:30
   */
  @Cron('30 0 1 * *')
  async handleMonthlyDepreciation() {
    this.logger.log('Running scheduled monthly depreciation batch...');
    try {
      const result = await this.runMonthEndDepreciation();
      this.logger.log(`Scheduled depreciation complete: ${JSON.stringify(result)}`);
    } catch (error) {
      this.logger.error(
        `Scheduled depreciation failed: ${error instanceof Error ? error.message : error}`,
      );
      Sentry.captureException(error, {
        tags: { kind: 'cron-job', cron: 'monthly-depreciation' },
      });
    }
  }
}
