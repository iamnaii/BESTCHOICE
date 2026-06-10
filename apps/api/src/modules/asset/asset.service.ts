import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, AssetCategory } from '@prisma/client';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { DisposeAssetDto } from './dto/dispose-asset.dto';
import { AssetPurchaseTemplate } from '../journal/cpa-templates/asset-purchase.template';
import { AssetPurchaseReverseTemplate } from '../journal/cpa-templates/asset-purchase-reverse.template';
import { AssetDisposalTemplate } from '../journal/cpa-templates/asset-disposal.template';
import { AssetDisposalReverseTemplate } from '../journal/cpa-templates/asset-disposal-reverse.template';
import { AssetInvoiceReceivedTemplate } from '../journal/cpa-templates/asset-invoice-received.template';
import { AssetLifecycleService } from './services/asset-lifecycle.service';
import { AssetWriteService } from './services/asset-write.service';
import { AssetQueryService } from './services/asset-query.service';

/**
 * AssetService — facade over three internally-constructed sub-services.
 *
 * Public surface (22-method) + the UNCHANGED 6-arg constructor (prisma + the 5
 * cpa-templates) are preserved byte-for-byte; the constructor builds the three
 * sub-services internally and every public method one-line-delegates to one of
 * them. This keeps the spec construction site + asset.module.ts (DI)
 * untouched while splitting the implementation:
 *
 *   - AssetLifecycleService — the 5 JE-posting $transaction methods
 *       (post / reverse / markInvoiceReceived / dispose / reverseDispose) with
 *       their V15 period guards + BLOCKED-on-rejection audit, each tx moved WHOLE.
 *   - AssetWriteService — createDraft / create / update / delete / copy + the
 *       tx-aware generateAssetCode helper + cost math via asset-cost-math.util.
 *   - AssetQueryService — read-only / reporting paths + the runMonthEndDepreciation
 *       stub.
 */
@Injectable()
export class AssetService {
  private readonly lifecycle: AssetLifecycleService;
  private readonly write: AssetWriteService;
  private readonly query: AssetQueryService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly purchaseTemplate: AssetPurchaseTemplate,
    private readonly reverseTemplate: AssetPurchaseReverseTemplate,
    private readonly disposalTemplate: AssetDisposalTemplate,
    private readonly disposalReverseTemplate: AssetDisposalReverseTemplate,
    private readonly invoiceReceivedTemplate: AssetInvoiceReceivedTemplate,
  ) {
    this.lifecycle = new AssetLifecycleService(
      this.prisma,
      this.purchaseTemplate,
      this.reverseTemplate,
      this.disposalTemplate,
      this.disposalReverseTemplate,
      this.invoiceReceivedTemplate,
    );
    this.write = new AssetWriteService(this.prisma);
    this.query = new AssetQueryService(this.prisma);
  }

  // ==========================================================================
  // Write paths (AssetWriteService)
  // ==========================================================================

  generateAssetCode(
    tx?: Prisma.TransactionClient,
    category?: AssetCategory,
  ): Promise<{ assetCode: string }> {
    return this.write.generateAssetCode(tx, category);
  }

  createDraft(dto: CreateAssetDto, createdById: string) {
    return this.write.createDraft(dto, createdById);
  }

  create(dto: CreateAssetDto, createdById: string) {
    return this.write.create(dto, createdById);
  }

  update(id: string, dto: UpdateAssetDto) {
    return this.write.update(id, dto);
  }

  delete(id: string, _userId: string) {
    return this.write.delete(id, _userId);
  }

  copy(id: string, createdById: string) {
    return this.write.copy(id, createdById);
  }

  // ==========================================================================
  // Read / reporting paths (AssetQueryService)
  // ==========================================================================

  findAll(filters: {
    branchId?: string;
    category?: AssetCategory | string;
    status?: import('@prisma/client').AssetStatus | string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    return this.query.findAll(filters);
  }

  vendorNames(limit = 200): Promise<string[]> {
    return this.query.vendorNames(limit);
  }

  findOne(id: string) {
    return this.query.findOne(id);
  }

  getDepreciationSummary() {
    return this.query.getDepreciationSummary();
  }

  getAuditTrail(assetId: string) {
    return this.query.getAuditTrail(assetId);
  }

  getRegister(filters: {
    asOfDate?: string;
    category?: AssetCategory;
    status?: import('@prisma/client').AssetStatus;
    branchId?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    return this.query.getRegister(filters);
  }

  getAssetSchedule(assetId: string) {
    return this.query.getAssetSchedule(assetId);
  }

  runMonthEndDepreciation(_period: string | undefined, _userId: string) {
    return this.query.runMonthEndDepreciation(_period, _userId);
  }

  listGlobalAudit(params: {
    page?: number;
    limit?: number;
    action?: string;
    fromDate?: string;
    toDate?: string;
  }) {
    return this.query.listGlobalAudit(params);
  }

  // ==========================================================================
  // JE-posting lifecycle paths (AssetLifecycleService)
  // ==========================================================================

  post(id: string, postedById: string): Promise<{ entryNo: string }> {
    return this.lifecycle.post(id, postedById);
  }

  reverse(
    id: string,
    reversedById: string,
    reason: string,
    meta?: { reasonLabel?: string | null; note?: string | null },
  ): Promise<{ entryNo: string }> {
    return this.lifecycle.reverse(id, reversedById, reason, meta);
  }

  markInvoiceReceived(
    id: string,
    triggeredById: string,
  ): Promise<{ entryNo: string; invoiceReceivedAt: Date }> {
    return this.lifecycle.markInvoiceReceived(id, triggeredById);
  }

  dispose(
    id: string,
    dto: DisposeAssetDto,
    userId: string,
  ): Promise<{ entryNo: string }> {
    return this.lifecycle.dispose(id, dto, userId);
  }

  reverseDispose(
    id: string,
    reason: string,
    userId: string,
    meta?: { reasonLabel?: string | null; note?: string | null },
  ): Promise<{ entryNo: string }> {
    return this.lifecycle.reverseDispose(id, reason, userId, meta);
  }
}
