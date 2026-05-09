import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, AssetCategory, AssetStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { DisposeAssetDto } from './dto/dispose-asset.dto';
import { AssetPurchaseTemplate } from '../journal/cpa-templates/asset-purchase.template';
import { AssetPurchaseReverseTemplate } from '../journal/cpa-templates/asset-purchase-reverse.template';
import { AssetDisposalTemplate } from '../journal/cpa-templates/asset-disposal.template';
import { AssetDisposalReverseTemplate } from '../journal/cpa-templates/asset-disposal-reverse.template';
import { validatePeriodOpen } from '../../utils/period-lock.util';

const CATEGORY_PREFIX: Record<AssetCategory, string> = {
  EQUIPMENT: 'EQ',
  IMPROVEMENT: 'IM',
  FURNITURE: 'FN',
  VEHICLE: 'VH',
};

function round2(d: Decimal | number | string): Decimal {
  return new Decimal(d).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function round4(d: Decimal | number | string): Decimal {
  return new Decimal(d).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

@Injectable()
export class AssetService {
  private readonly logger = new Logger(AssetService.name);
  private financeCompanyId?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly purchaseTemplate: AssetPurchaseTemplate,
    private readonly reverseTemplate: AssetPurchaseReverseTemplate,
    private readonly disposalTemplate: AssetDisposalTemplate,
    private readonly disposalReverseTemplate: AssetDisposalReverseTemplate,
  ) {}

  /**
   * Resolve FINANCE companyId once per service instance (cached).
   * Used by Task 7 (post) for V15 period-lock guard.
   */
  private async getFinanceCompanyId(): Promise<string> {
    if (this.financeCompanyId) return this.financeCompanyId;
    const company = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
    });
    if (!company) throw new Error('FINANCE company not found in CompanyInfo');
    this.financeCompanyId = company.id;
    return company.id;
  }

  /**
   * Generate next sequential assetCode for the given category.
   * Format: {prefix}-{NNN} (e.g. EQ-001, IM-002)
   *
   * When `tx` is provided, the read happens inside the caller's transaction so
   * it sees rows being created by the same caller (race-free with createDraft /
   * copy which insert from inside a $transaction).
   */
  async generateAssetCode(
    tx?: Prisma.TransactionClient,
    category?: AssetCategory,
  ): Promise<{ assetCode: string }> {
    const client: Prisma.TransactionClient | PrismaService = tx ?? this.prisma;
    const prefix = category ? CATEGORY_PREFIX[category] : 'EQ';
    // Pull recent rows; skip non-numeric suffixes so legacy/test rows like
    // TEST-1778255626578-QU052F don't poison parseInt.
    const recent = await client.fixedAsset.findMany({
      where: { assetCode: { startsWith: `${prefix}-` } },
      orderBy: { assetCode: 'desc' },
      take: 50,
      select: { assetCode: true },
    });
    let maxSeq = 0;
    for (const r of recent) {
      const tail = r.assetCode.split('-')[1];
      if (/^\d+$/.test(tail)) {
        const n = parseInt(tail, 10);
        if (n > maxSeq) maxSeq = n;
      }
    }
    const seq = maxSeq + 1;
    return { assetCode: `${prefix}-${seq.toString().padStart(3, '0')}` };
  }

  /**
   * Generate next sequential docNo for the current YYMM.
   * Format: ASSET-{YYMM}-{NNNN}
   */
  private async generateDocNo(tx: Prisma.TransactionClient): Promise<string> {
    const now = new Date();
    const yymm = `${now.getFullYear().toString().slice(2)}${(now.getMonth() + 1)
      .toString()
      .padStart(2, '0')}`;
    const prefix = `ASSET-${yymm}-`;
    // Pull recent rows for the prefix; skip non-numeric suffixes (defensive
    // against legacy/test rows like ASSET-2605-QU052F that would break parseInt).
    const recent = await tx.fixedAsset.findMany({
      where: { docNo: { startsWith: prefix } },
      orderBy: { docNo: 'desc' },
      take: 50,
      select: { docNo: true },
    });
    let maxSeq = 0;
    for (const r of recent) {
      const tail = r.docNo.slice(prefix.length);
      if (/^\d+$/.test(tail)) {
        const n = parseInt(tail, 10);
        if (n > maxSeq) maxSeq = n;
      }
    }
    const seq = maxSeq + 1;
    return `${prefix}${seq.toString().padStart(4, '0')}`;
  }

  /**
   * Compute derived cost fields (basePrice ex-VAT, vatAmount, purchaseCost,
   * whtAmount, monthlyDepr) from raw input. Used by both `createDraft` and
   * `update` to keep the math identical between insert and edit paths.
   *
   * Input shape accepts either DTO numbers/strings or Prisma Decimal values
   * (since `update` merges the existing asset with the partial DTO).
   */
  private computeCostFields(input: {
    basePrice: Decimal | number | string;
    shippingCost?: Decimal | number | string | null;
    installationCost?: Decimal | number | string | null;
    otherCapitalized?: Decimal | number | string | null;
    residualValue?: Decimal | number | string | null;
    usefulLifeMonths: number;
    hasVat?: boolean | null;
    vatInclusive?: boolean | null;
    hasWht?: boolean | null;
    whtBaseAmount?: Decimal | number | string | null;
    whtRate?: Decimal | number | string | null;
  }) {
    const basePriceRaw = new Decimal(input.basePrice.toString());
    const shippingCost = new Decimal((input.shippingCost ?? 0).toString());
    const installationCost = new Decimal((input.installationCost ?? 0).toString());
    const otherCapitalized = new Decimal((input.otherCapitalized ?? 0).toString());
    const residualValue = new Decimal((input.residualValue ?? 0).toString());

    let basePrice = basePriceRaw;
    let vatAmount = new Decimal(0);
    if (input.hasVat) {
      if (input.vatInclusive) {
        // Fix #1.3: extract VAT from inclusive basePrice
        vatAmount = round2(basePriceRaw.times(7).div(107));
        basePrice = basePriceRaw.minus(vatAmount);
      } else {
        vatAmount = round2(basePriceRaw.times('0.07'));
      }
    }

    const purchaseCost = round2(
      basePrice.plus(shippingCost).plus(installationCost).plus(otherCapitalized),
    );

    // WHT — Fix #1.1: base on installation cost (or custom whtBaseAmount)
    let whtAmount = new Decimal(0);
    if (input.hasWht && input.whtRate != null) {
      const whtBase = new Decimal(
        (input.whtBaseAmount ?? installationCost).toString(),
      );
      whtAmount = round2(whtBase.times(input.whtRate.toString()));
    }

    const monthlyDepr = round4(
      purchaseCost.minus(residualValue).div(input.usefulLifeMonths),
    );

    return {
      basePrice,
      vatAmount,
      purchaseCost,
      whtAmount,
      monthlyDepr,
      // Echo back inputs that callers also need
      shippingCost,
      installationCost,
      otherCapitalized,
      residualValue,
    };
  }

  async createDraft(dto: CreateAssetDto, createdById: string) {
    const {
      basePrice,
      vatAmount,
      purchaseCost,
      whtAmount,
      monthlyDepr,
      shippingCost,
      installationCost,
      otherCapitalized,
      residualValue,
    } = this.computeCostFields(dto);

    return this.prisma.$transaction(async (tx) => {
      const docNo = await this.generateDocNo(tx);
      const { assetCode } = await this.generateAssetCode(tx, dto.category);

      return tx.fixedAsset.create({
        data: {
          assetCode,
          docNo,
          name: dto.name,
          description: dto.description,
          category: dto.category,
          branchId: dto.branchId,
          basePrice,
          shippingCost,
          installationCost,
          otherCapitalized,
          hasVat: dto.hasVat ?? false,
          vatInclusive: dto.vatInclusive ?? false,
          vatAmount,
          vatAccount: dto.vatAccount,
          hasWht: dto.hasWht ?? false,
          whtBaseAmount: dto.whtBaseAmount ? new Decimal(dto.whtBaseAmount) : null,
          whtRate: dto.whtRate ? new Decimal(dto.whtRate) : null,
          whtAmount,
          whtAccount: dto.whtAccount,
          whtFormType: dto.whtFormType,
          purchaseCost,
          residualValue,
          usefulLifeMonths: dto.usefulLifeMonths,
          monthlyDepr,
          netBookValue: purchaseCost,
          purchaseDate: new Date(dto.purchaseDate),
          invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : null,
          warrantyExpire: dto.warrantyExpire ? new Date(dto.warrantyExpire) : null,
          supplierName: dto.supplierName,
          supplierTaxId: dto.supplierTaxId,
          invoiceNo: dto.invoiceNo,
          taxInvoiceNo: dto.taxInvoiceNo,
          paymentMethod: dto.paymentMethod,
          paymentAccount: dto.paymentAccount,
          custodian: dto.custodian,
          location: dto.location,
          serialNo: dto.serialNo,
          prRef: dto.prRef,
          note: dto.note,
          status: AssetStatus.DRAFT,
          createdById,
          approverId: dto.approverId,
        },
      });
    });
  }

  /** Backward-compat alias for controller (Task 10 will rename `create` → `createDraft`). */
  async create(dto: CreateAssetDto, createdById: string) {
    return this.createDraft(dto, createdById);
  }

  async update(id: string, dto: UpdateAssetDto) {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
    });
    if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');
    if (asset.status !== AssetStatus.DRAFT) {
      throw new BadRequestException('แก้ไขได้เฉพาะสถานะ DRAFT');
    }

    // Re-derive cost fields if any cost-affecting field changed
    const costFields: (keyof UpdateAssetDto)[] = [
      'basePrice',
      'shippingCost',
      'installationCost',
      'otherCapitalized',
      'hasVat',
      'vatInclusive',
      'hasWht',
      'whtRate',
      'whtBaseAmount',
      'residualValue',
      'usefulLifeMonths',
    ];
    const costChanged = costFields.some((f) => dto[f] !== undefined);

    let derivedUpdate: Prisma.FixedAssetUpdateInput = {};
    if (costChanged) {
      // Merge current asset with dto, then run the shared compute helper.
      const computed = this.computeCostFields({
        basePrice: dto.basePrice ?? asset.basePrice,
        shippingCost: dto.shippingCost ?? asset.shippingCost,
        installationCost: dto.installationCost ?? asset.installationCost,
        otherCapitalized: dto.otherCapitalized ?? asset.otherCapitalized,
        residualValue: dto.residualValue ?? asset.residualValue,
        usefulLifeMonths: dto.usefulLifeMonths ?? asset.usefulLifeMonths,
        hasVat: dto.hasVat ?? asset.hasVat,
        vatInclusive: dto.vatInclusive ?? asset.vatInclusive,
        hasWht: dto.hasWht ?? asset.hasWht,
        whtRate: dto.whtRate ?? asset.whtRate,
        whtBaseAmount: dto.whtBaseAmount ?? asset.whtBaseAmount,
      });

      derivedUpdate = {
        basePrice: computed.basePrice,
        vatAmount: computed.vatAmount,
        purchaseCost: computed.purchaseCost,
        whtAmount: computed.whtAmount,
        monthlyDepr: computed.monthlyDepr,
        netBookValue: computed.purchaseCost,
      };
    }

    // Strip fields handled by derivedUpdate / date conversion to avoid type clashes
    const {
      purchaseDate,
      invoiceDate,
      warrantyExpire,
      basePrice: _bp,
      whtBaseAmount: _wba,
      whtRate: _wr,
      ...rest
    } = dto;

    const data: Prisma.FixedAssetUncheckedUpdateInput = {
      ...rest,
      purchaseDate: purchaseDate ? new Date(purchaseDate) : undefined,
      invoiceDate: invoiceDate ? new Date(invoiceDate) : undefined,
      warrantyExpire: warrantyExpire ? new Date(warrantyExpire) : undefined,
      ...(derivedUpdate as Prisma.FixedAssetUncheckedUpdateInput),
    };

    return this.prisma.fixedAsset.update({ where: { id }, data });
  }

  async delete(id: string, _userId: string) {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
    });
    if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');
    if (asset.status !== AssetStatus.DRAFT) {
      throw new BadRequestException('ลบได้เฉพาะสถานะ DRAFT');
    }
    return this.prisma.fixedAsset.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

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

  async findOne(id: string) {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
      include: {
        branch: true,
        createdBy: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
        postedBy: { select: { id: true, name: true } },
        reversedBy: { select: { id: true, name: true } },
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
    // disposalDate > asOfDate (still active at asOfDate).
    const where: Prisma.FixedAssetWhereInput = {
      deletedAt: null,
      purchaseDate: { lte: asOfDate },
      OR: [
        { status: AssetStatus.POSTED },
        {
          AND: [
            { status: { in: [AssetStatus.DISPOSED, AssetStatus.WRITTEN_OFF] } },
            { disposalDate: { gt: asOfDate } },
          ],
        },
      ],
    };
    if (filters.category) where.category = filters.category;
    if (filters.status) {
      // status filter narrows further (within the OR above)
      where.AND = [{ status: filters.status }];
    }
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
          ? Math.ceil(remainingDepreciable.div(monthlyDepr).toNumber())
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

  // ==========================================================================
  // Stubs — implemented in Tasks 7-9
  // ==========================================================================

  async post(id: string, postedById: string): Promise<{ entryNo: string }> {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
    });
    if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');
    if (asset.status !== AssetStatus.DRAFT) {
      throw new BadRequestException(
        `POST ได้เฉพาะสถานะ DRAFT (ปัจจุบัน: ${asset.status})`,
      );
    }

    // V15: Period lock check (purchase date must be in an open period for POST)
    const financeCompanyId = await this.getFinanceCompanyId();
    try {
      await validatePeriodOpen(this.prisma, asset.purchaseDate, financeCompanyId);
    } catch (err: any) {
      // Log blocked attempt (own write — outside the post tx by design,
      // we want a record of the failed attempt even though the tx never opens).
      await this.prisma.auditLog.create({
        data: {
          userId: postedById,
          action: 'ASSET_POST_BLOCKED',
          entity: 'fixed_asset',
          entityId: id,
          oldValue: { status: 'DRAFT' },
          newValue: { reason: err?.message ?? 'period closed' },
        },
      });
      throw new BadRequestException(
        `ไม่สามารถ POST: ${err?.message ?? 'งวดบัญชีปิดแล้ว'}`,
      );
    }

    // Atomic: template (idempotency + JE post + snapshots + journal-post audit)
    // + asset status update + AuditLog all run in ONE outer $transaction.
    // Crash anywhere = full rollback. No more orphan JE / stuck status.
    const result = await this.prisma.$transaction(async (tx) => {
      const inner = await this.purchaseTemplate.execute(
        { assetId: id, postedById },
        tx,
      );

      await tx.fixedAsset.update({
        where: { id },
        data: {
          status: AssetStatus.POSTED,
          postedById,
          postedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          userId: postedById,
          action: 'ASSET_POST',
          entity: 'fixed_asset',
          entityId: id,
          oldValue: { status: 'DRAFT' },
          newValue: {
            status: 'POSTED',
            postedById,
            journalEntryNumber: inner.entryNo,
          },
        },
      });

      return inner;
    });

    this.logger.log(
      `[Phase1] POST asset ${asset.assetCode} → ${result.entryNo}`,
    );
    return result;
  }

  async reverse(
    id: string,
    reversedById: string,
    reason: string,
  ): Promise<{ entryNo: string }> {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('กรุณาระบุเหตุผลการกลับรายการ');
    }
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
    });
    if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');
    if (asset.status !== AssetStatus.POSTED) {
      throw new BadRequestException(
        `Reverse ได้เฉพาะสถานะ POSTED (ปัจจุบัน: ${asset.status})`,
      );
    }

    // V15: Period lock check — reversal posts TODAY, not on the original
    // purchaseDate. A long-since-closed past period must not block a valid
    // reversal posted into the current open period.
    const financeCompanyId = await this.getFinanceCompanyId();
    try {
      await validatePeriodOpen(this.prisma, new Date(), financeCompanyId);
    } catch (err: any) {
      await this.prisma.auditLog.create({
        data: {
          userId: reversedById,
          action: 'ASSET_REVERSE_BLOCKED',
          entity: 'fixed_asset',
          entityId: id,
          oldValue: { status: 'POSTED' },
          newValue: { reason: err?.message ?? 'period closed' },
        },
      });
      throw new BadRequestException(
        `ไม่สามารถ Reverse: ${err?.message ?? 'งวดบัญชีปิดแล้ว'}`,
      );
    }

    // Atomic: template (deprCount + idempotency + JE post + flag + audit)
    // + asset status update + AuditLog all run in ONE outer $transaction.
    const result = await this.prisma.$transaction(async (tx) => {
      const inner = await this.reverseTemplate.execute(
        { assetId: id, reversedById, reason },
        tx,
      );

      await tx.fixedAsset.update({
        where: { id },
        data: {
          status: AssetStatus.REVERSED,
          reversedById,
          reversedAt: new Date(),
          reversalReason: reason,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: reversedById,
          action: 'ASSET_REVERSE',
          entity: 'fixed_asset',
          entityId: id,
          oldValue: { status: 'POSTED' },
          newValue: {
            status: 'REVERSED',
            reversedById,
            reversalReason: reason,
            reversalEntryNumber: inner.entryNo,
          },
        },
      });

      return inner;
    });

    this.logger.log(
      `[Phase1] REVERSE asset ${asset.assetCode} → ${result.entryNo}`,
    );
    return result;
  }

  /**
   * Clone an existing asset into a new DRAFT. Source can be in any status.
   * - Cloned: name, description, category, branch, cost fields, VAT/WHT config,
   *   vendor info, custodian, location, payment, warranty, prRef, note.
   * - Reset: id, assetCode, docNo, dates (purchaseDate=today; invoiceDate/
   *   warrantyExpire flags individually handled), invoiceNo, taxInvoiceNo,
   *   serialNo, whtBaseAmount, accumulatedDepr, all coa* snapshots,
   *   approverId, posted/reversed/audit fields, status=DRAFT.
   * - NOT copied: transferHistory rows, depreciationEntries (separate tables).
   * - AuditLog ASSET_CREATE includes copiedFromAssetId/copiedFromAssetCode for lineage.
   */
  async copy(id: string, createdById: string) {
    const source = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
    });
    if (!source) throw new NotFoundException('ไม่พบสินทรัพย์ต้นทาง');

    return this.prisma.$transaction(async (tx) => {
      const docNo = await this.generateDocNo(tx);
      const { assetCode } = await this.generateAssetCode(tx, source.category);

      const copy = await tx.fixedAsset.create({
        data: {
          // Generated
          assetCode,
          docNo,
          // Copied operational fields
          name: source.name,
          description: source.description,
          category: source.category,
          branchId: source.branchId,
          basePrice: source.basePrice,
          shippingCost: source.shippingCost,
          installationCost: source.installationCost,
          otherCapitalized: source.otherCapitalized,
          hasVat: source.hasVat,
          vatInclusive: source.vatInclusive,
          vatAmount: source.vatAmount,
          vatAccount: source.vatAccount,
          hasWht: source.hasWht,
          whtRate: source.whtRate,
          whtAccount: source.whtAccount,
          whtFormType: source.whtFormType,
          whtAmount: source.whtAmount,
          purchaseCost: source.purchaseCost,
          residualValue: source.residualValue,
          usefulLifeMonths: source.usefulLifeMonths,
          monthlyDepr: source.monthlyDepr,
          netBookValue: source.purchaseCost, // reset to full
          purchaseDate: new Date(), // today
          warrantyExpire: source.warrantyExpire,
          supplierName: source.supplierName,
          supplierTaxId: source.supplierTaxId,
          paymentMethod: source.paymentMethod,
          paymentAccount: source.paymentAccount,
          custodian: source.custodian,
          location: source.location,
          prRef: source.prRef,
          note: source.note,
          // Reset
          whtBaseAmount: null,
          invoiceDate: null,
          invoiceNo: null,
          taxInvoiceNo: null,
          serialNo: null,
          accumulatedDepr: 0,
          coaCostAccount: null,
          coaDeprAccount: null,
          coaExpenseAccount: null,
          approverId: null,
          postedById: null,
          postedAt: null,
          reversedById: null,
          reversedAt: null,
          reversalReason: null,
          status: AssetStatus.DRAFT,
          createdById,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: createdById,
          action: 'ASSET_CREATE',
          entity: 'fixed_asset',
          entityId: copy.id,
          newValue: {
            status: 'DRAFT',
            copiedFromAssetId: source.id,
            copiedFromAssetCode: source.assetCode,
          },
        },
      });

      return copy;
    });
  }

  /**
   * Dispose a POSTED asset — SALE or WRITE_OFF.
   *
   * - Outer $transaction wraps:
   *     disposalTemplate.execute (sets status=DISPOSED + NBV=0 + posts JE)
   *     + manual status update to WRITTEN_OFF for WRITE_OFF disposals
   *     + AuditLog ASSET_DISPOSE with disposalType/proceeds/gainLoss metadata.
   * - V15 period guard on disposalDate → ASSET_DISPOSE_BLOCKED audit on rejection.
   * - Idempotent: second call returns same JE entryNo via template's
   *   metadata-based lookup (flow=asset-disposal + assetId).
   */
  async dispose(
    id: string,
    dto: DisposeAssetDto,
    userId: string,
  ): Promise<{ entryNo: string }> {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
    });
    if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');
    if (asset.status !== AssetStatus.POSTED) {
      throw new BadRequestException(
        `จำหน่ายได้เฉพาะสถานะ POSTED (ปัจจุบัน: ${asset.status})`,
      );
    }

    const disposalDate = new Date(dto.disposalDate);
    if (disposalDate.getTime() > Date.now()) {
      throw new BadRequestException('วันที่จำหน่ายต้องไม่อยู่ในอนาคต (future date not allowed)');
    }

    // V15 guard — disposalDate must be in an open period
    const financeCompanyId = await this.getFinanceCompanyId();
    try {
      await validatePeriodOpen(this.prisma, disposalDate, financeCompanyId);
    } catch (err: any) {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'ASSET_DISPOSE_BLOCKED',
          entity: 'fixed_asset',
          entityId: id,
          oldValue: { status: 'POSTED' },
          newValue: {
            reason: err?.message ?? 'period closed',
            disposalType: dto.disposalType,
          },
        },
      });
      throw new BadRequestException(
        `ไม่สามารถจำหน่าย: ${err?.message ?? 'งวดบัญชีปิดแล้ว (period closed)'}`,
      );
    }

    // Convert dto.proceeds (number from DTO) → Decimal once for safe arithmetic.
    const proceedsDecimal =
      dto.disposalType === 'SALE'
        ? new Decimal(dto.proceeds ?? 0)
        : new Decimal(0);
    const depositAccountCode =
      dto.disposalType === 'SALE' ? dto.depositAccountCode : undefined;

    // Capture NBV BEFORE the template runs (template overwrites NBV=0).
    const nbvBefore = new Decimal(asset.netBookValue.toString());
    const newStatus: AssetStatus =
      dto.disposalType === 'WRITE_OFF'
        ? AssetStatus.WRITTEN_OFF
        : AssetStatus.DISPOSED;

    const result = await this.prisma.$transaction(async (tx) => {
      const inner = await this.disposalTemplate.execute(
        {
          assetId: id,
          disposalDate,
          disposalProceeds: proceedsDecimal,
          depositAccountCode,
        },
        tx,
      );

      // Template sets status = 'DISPOSED'. For WRITE_OFF we want WRITTEN_OFF.
      const afterTemplate = await tx.fixedAsset.findUnique({ where: { id } });
      if (afterTemplate!.status !== newStatus) {
        await tx.fixedAsset.update({
          where: { id },
          data: { status: newStatus },
        });
      }

      const gainLoss = proceedsDecimal.minus(nbvBefore);
      const proceedsForAudit = dto.disposalType === 'SALE' ? dto.proceeds ?? 0 : 0;

      await tx.auditLog.create({
        data: {
          userId,
          action: 'ASSET_DISPOSE',
          entity: 'fixed_asset',
          entityId: id,
          oldValue: {
            status: 'POSTED',
            netBookValue: nbvBefore.toString(),
          },
          newValue: {
            status: newStatus,
            disposalType: dto.disposalType,
            disposalDate: dto.disposalDate,
            proceeds: proceedsForAudit,
            gainLoss: gainLoss.toString(),
            journalEntryNumber: inner.entryNo,
            reason: dto.reason,
          },
        },
      });

      return inner;
    });

    this.logger.log(
      `[Phase2] DISPOSE asset ${asset.assetCode} type=${dto.disposalType} → ${result.entryNo}`,
    );
    return result;
  }

  /**
   * Reverse a previously disposed asset (undo SALE / WRITE_OFF).
   *
   * - Status DISPOSED or WRITTEN_OFF → POSTED, disposalDate cleared,
   *   NBV recomputed from purchaseCost - accumulatedDepr (template handles).
   * - Outer $transaction wraps disposalReverseTemplate.execute + AuditLog
   *   ASSET_REVERSE_DISPOSE.
   * - V15 period guard runs on TODAY (reversal posted into current period),
   *   not on the original disposalDate.
   * - Idempotent: second call rejects (template flags original JE as reversed).
   */
  async reverseDispose(
    id: string,
    reason: string,
    userId: string,
  ): Promise<{ entryNo: string }> {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('กรุณาระบุเหตุผลการกลับรายการ');
    }
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
    });
    if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');
    if (
      asset.status !== AssetStatus.DISPOSED &&
      asset.status !== AssetStatus.WRITTEN_OFF
    ) {
      throw new BadRequestException(
        `Reverse dispose ได้เฉพาะสถานะ DISPOSED หรือ WRITTEN_OFF (ปัจจุบัน: ${asset.status})`,
      );
    }

    // V15 guard — reversal posts TODAY, not on the original disposalDate.
    const financeCompanyId = await this.getFinanceCompanyId();
    try {
      await validatePeriodOpen(this.prisma, new Date(), financeCompanyId);
    } catch (err: any) {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'ASSET_REVERSE_DISPOSE_BLOCKED',
          entity: 'fixed_asset',
          entityId: id,
          oldValue: { status: asset.status },
          newValue: { reason: err?.message ?? 'period closed' },
        },
      });
      throw new BadRequestException(
        `ไม่สามารถ Reverse: ${err?.message ?? 'งวดบัญชีปิดแล้ว (period closed)'}`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const inner = await this.disposalReverseTemplate.execute(
        { assetId: id, reversedById: userId, reason },
        tx,
      );

      await tx.auditLog.create({
        data: {
          userId,
          action: 'ASSET_REVERSE_DISPOSE',
          entity: 'fixed_asset',
          entityId: id,
          oldValue: {
            status: asset.status,
            disposalDate: asset.disposalDate?.toISOString() ?? null,
          },
          newValue: {
            status: 'POSTED',
            reversalReason: reason,
            reversalEntryNumber: inner.entryNo,
          },
        },
      });

      return inner;
    });

    this.logger.log(
      `[Phase2] REVERSE_DISPOSE asset ${asset.assetCode} → ${result.entryNo}`,
    );
    return result;
  }

  /** Backward-compat for controller — implemented in Task 9. */
  async runMonthEndDepreciation(_period: string | undefined, _userId: string) {
    throw new Error('runMonthEndDepreciation: implement in Task 9 (Phase 2)');
  }
}
