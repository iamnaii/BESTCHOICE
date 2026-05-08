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
import { AssetPurchaseTemplate } from '../journal/cpa-templates/asset-purchase.template';
import { AssetPurchaseReverseTemplate } from '../journal/cpa-templates/asset-purchase-reverse.template';
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
   */
  async generateAssetCode(category?: AssetCategory): Promise<{ assetCode: string }> {
    const prefix = category ? CATEGORY_PREFIX[category] : 'EQ';
    // Pull recent rows; skip non-numeric suffixes so legacy/test rows like
    // TEST-1778255626578-QU052F don't poison parseInt.
    const recent = await this.prisma.fixedAsset.findMany({
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

  async createDraft(dto: CreateAssetDto, createdById: string) {
    // Compute derived values
    const basePriceRaw = new Decimal(dto.basePrice);
    const shippingCost = new Decimal(dto.shippingCost ?? 0);
    const installationCost = new Decimal(dto.installationCost ?? 0);
    const otherCapitalized = new Decimal(dto.otherCapitalized ?? 0);
    const residualValue = new Decimal(dto.residualValue ?? 0);

    let basePrice = basePriceRaw;
    let vatAmount = new Decimal(0);
    if (dto.hasVat) {
      if (dto.vatInclusive) {
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

    // WHT — Fix #1.1: base on installation cost (or custom)
    let whtAmount = new Decimal(0);
    if (dto.hasWht && dto.whtRate) {
      const whtBase = new Decimal(dto.whtBaseAmount ?? installationCost);
      whtAmount = round2(whtBase.times(dto.whtRate));
    }

    const monthlyDepr = round4(
      purchaseCost.minus(residualValue).div(dto.usefulLifeMonths),
    );

    return this.prisma.$transaction(async (tx) => {
      const docNo = await this.generateDocNo(tx);
      const { assetCode } = await this.generateAssetCode(dto.category);

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
      // Merge current asset with dto for recompute
      const m = {
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
      };

      const basePriceRaw = new Decimal(m.basePrice.toString());
      const shippingCost = new Decimal(m.shippingCost.toString());
      const installationCost = new Decimal(m.installationCost.toString());
      const otherCapitalized = new Decimal(m.otherCapitalized.toString());
      const residualValue = new Decimal(m.residualValue.toString());

      let basePrice = basePriceRaw;
      let vatAmount = new Decimal(0);
      if (m.hasVat) {
        if (m.vatInclusive) {
          vatAmount = round2(basePriceRaw.times(7).div(107));
          basePrice = basePriceRaw.minus(vatAmount);
        } else {
          vatAmount = round2(basePriceRaw.times('0.07'));
        }
      }
      const purchaseCost = round2(
        basePrice.plus(shippingCost).plus(installationCost).plus(otherCapitalized),
      );
      let whtAmount = new Decimal(0);
      if (m.hasWht && m.whtRate != null) {
        const whtBase = new Decimal(
          (m.whtBaseAmount ?? installationCost).toString(),
        );
        whtAmount = round2(whtBase.times(m.whtRate.toString()));
      }
      const monthlyDepr = round4(
        purchaseCost.minus(residualValue).div(m.usefulLifeMonths),
      );

      derivedUpdate = {
        basePrice,
        vatAmount,
        purchaseCost,
        whtAmount,
        monthlyDepr,
        netBookValue: purchaseCost,
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

    // V15: Period lock check
    const financeCompanyId = await this.getFinanceCompanyId();
    try {
      await validatePeriodOpen(this.prisma, asset.purchaseDate, financeCompanyId);
    } catch (err: any) {
      // Log blocked attempt
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

    // Post JE via template
    const result = await this.purchaseTemplate.execute({
      assetId: id,
      postedById,
    });

    // Update asset status (template already wrote account snapshots)
    await this.prisma.$transaction(async (tx) => {
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
            journalEntryNumber: result.entryNo,
          },
        },
      });
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

    // V15: Period lock check
    const financeCompanyId = await this.getFinanceCompanyId();
    try {
      await validatePeriodOpen(this.prisma, asset.purchaseDate, financeCompanyId);
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

    // Post reversal JE (template already checks for DepreciationEntry)
    const result = await this.reverseTemplate.execute({
      assetId: id,
      reversedById,
      reason,
    });

    // Update asset status
    await this.prisma.$transaction(async (tx) => {
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
            reversalEntryNumber: result.entryNo,
          },
        },
      });
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
      const { assetCode } = await this.generateAssetCode(source.category);

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

  /** Backward-compat for controller — implemented in Task 9. */
  async dispose(_id: string, _dto: unknown) {
    throw new Error('dispose: implement in Task 9 (Phase 2)');
  }

  /** Backward-compat for controller — implemented in Task 9. */
  async runMonthEndDepreciation(_period: string | undefined, _userId: string) {
    throw new Error('runMonthEndDepreciation: implement in Task 9 (Phase 2)');
  }
}
