import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma, AssetCategory, AssetStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CreateAssetDto } from '../dto/create-asset.dto';
import { UpdateAssetDto } from '../dto/update-asset.dto';
import { CATEGORY_PREFIX, computeCostFields } from '../asset-cost-math.util';

/**
 * AssetWriteService — non-JE write paths for a fixed asset:
 * createDraft / create (alias) / update / delete / copy. createDraft + copy hold
 * their own (non-JE) $transaction with the ASSET_CREATE audit; the cost math is
 * delegated to the pure asset-cost-math util. generateAssetCode is the only
 * tx-accepting helper (called from inside createDraft/copy's tx). Constructed
 * internally by the AssetService facade — NOT a Nest provider.
 */
export class AssetWriteService {
  constructor(private readonly prisma: PrismaService) {}

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

  async createDraft(dto: CreateAssetDto, createdById: string) {
    const {
      basePrice,
      vatAmount,
      purchaseCost,
      whtAmount,
      monthlyDepr,
      dailyDepr,
      shippingCost,
      installationCost,
      otherCapitalized,
      residualValue,
    } = computeCostFields(dto);

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
          dailyDepr,
          netBookValue: purchaseCost,
          purchaseDate: new Date(dto.purchaseDate),
          invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : null,
          warrantyExpire: dto.warrantyExpire ? new Date(dto.warrantyExpire) : null,
          supplierName: dto.supplierName,
          supplierTaxId: dto.supplierTaxId,
          // P6: vendor master link + partial-payment amount (both optional)
          vendorId: dto.vendorId,
          vendorAmountPaid:
            dto.vendorAmountPaid !== undefined && dto.vendorAmountPaid !== null
              ? new Decimal(dto.vendorAmountPaid)
              : null,
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
      const computed = computeCostFields({
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
        dailyDepr: computed.dailyDepr,
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
      vendorAmountPaid: _vap,
      ...rest
    } = dto;

    const data: Prisma.FixedAssetUncheckedUpdateInput = {
      ...rest,
      purchaseDate: purchaseDate ? new Date(purchaseDate) : undefined,
      invoiceDate: invoiceDate ? new Date(invoiceDate) : undefined,
      warrantyExpire: warrantyExpire ? new Date(warrantyExpire) : undefined,
      // P6: vendorAmountPaid needs explicit Decimal conversion; preserve "set
      // to null" semantics when client explicitly passes null.
      ...(dto.vendorAmountPaid !== undefined
        ? {
            vendorAmountPaid:
              dto.vendorAmountPaid === null
                ? null
                : new Decimal(dto.vendorAmountPaid),
          }
        : {}),
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
          // P6: copy vendor link forward; partial-payment amount NOT copied
          // (treat each new draft as a fresh transaction; user re-enters amount).
          vendorId: source.vendorId,
          vendorAmountPaid: null,
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
}
