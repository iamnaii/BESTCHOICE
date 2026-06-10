import {
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AssetStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { DisposeAssetDto } from '../dto/dispose-asset.dto';
import { AssetPurchaseTemplate } from '../../journal/cpa-templates/asset-purchase.template';
import { AssetPurchaseReverseTemplate } from '../../journal/cpa-templates/asset-purchase-reverse.template';
import { AssetDisposalTemplate } from '../../journal/cpa-templates/asset-disposal.template';
import { AssetDisposalReverseTemplate } from '../../journal/cpa-templates/asset-disposal-reverse.template';
import { AssetInvoiceReceivedTemplate } from '../../journal/cpa-templates/asset-invoice-received.template';
import { validatePeriodOpen } from '../../../utils/period-lock.util';

/**
 * AssetLifecycleService — the 5 JE-posting transactions for a fixed asset
 * (post / reverse / markInvoiceReceived / dispose / reverseDispose).
 *
 * Each method holds its WHOLE $transaction (template.execute + status update +
 * AuditLog) plus the V15 validatePeriodOpen guard and the BLOCKED-audit write on
 * rejection. Constructed internally by the AssetService facade — NOT a Nest
 * provider; deps are passed positionally from the facade ctor.
 */
export class AssetLifecycleService {
  private readonly logger = new Logger(AssetLifecycleService.name);
  private financeCompanyId?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly purchaseTemplate: AssetPurchaseTemplate,
    private readonly reverseTemplate: AssetPurchaseReverseTemplate,
    private readonly disposalTemplate: AssetDisposalTemplate,
    private readonly disposalReverseTemplate: AssetDisposalReverseTemplate,
    private readonly invoiceReceivedTemplate: AssetInvoiceReceivedTemplate,
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
    meta?: { reasonLabel?: string | null; note?: string | null },
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
            reverseReasonLabel: meta?.reasonLabel ?? null,
            reverseNote: meta?.note ?? null,
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
   * Mark a supplier tax invoice as received and transfer the deferred input
   * VAT from 11-4102 to 11-4101 (claimable).
   *
   * Preconditions: asset POSTED, hasVat, vatAccount === '11-4102',
   * !invoiceReceivedAt. V15 period guard uses TODAY (not purchaseDate) — the
   * transfer JE posts in the current period.
   *
   * Atomic: template (JE post + idempotency + journalPostAuditLog) + asset
   * field updates + INVOICE_RECEIVED audit log all run in ONE outer
   * $transaction. After this, vatAccount becomes '11-4101' and the next ภ.พ.30
   * filing can credit the input VAT.
   */
  async markInvoiceReceived(
    id: string,
    triggeredById: string,
  ): Promise<{ entryNo: string; invoiceReceivedAt: Date }> {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
    });
    if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');
    if (asset.status !== AssetStatus.POSTED) {
      throw new BadRequestException(
        `บันทึกใบกำกับมาถึงได้เฉพาะสถานะ POSTED (ปัจจุบัน: ${asset.status})`,
      );
    }
    if (!asset.hasVat) {
      throw new BadRequestException(
        'สินทรัพย์นี้ไม่มี VAT — ไม่ต้องโอน 11-4102 → 11-4101',
      );
    }
    if (asset.vatAccount !== '11-4102') {
      throw new BadRequestException(
        `ภาษีซื้ออยู่บัญชี ${asset.vatAccount ?? '(ไม่ระบุ)'} แล้ว — ใช้ flow นี้ได้เฉพาะสินทรัพย์ที่บันทึก 11-4102`,
      );
    }
    if (asset.invoiceReceivedAt) {
      throw new BadRequestException(
        `บันทึกใบกำกับมาถึงแล้วเมื่อ ${asset.invoiceReceivedAt.toISOString()}`,
      );
    }

    // V15: period guard with TODAY (transfer JE posts in current period).
    const financeCompanyId = await this.getFinanceCompanyId();
    try {
      await validatePeriodOpen(this.prisma, new Date(), financeCompanyId);
    } catch (err: any) {
      await this.prisma.auditLog.create({
        data: {
          userId: triggeredById,
          action: 'ASSET_INVOICE_RECEIVED_BLOCKED',
          entity: 'fixed_asset',
          entityId: id,
          oldValue: { vatAccount: '11-4102' },
          newValue: { reason: err?.message ?? 'period closed' },
        },
      });
      throw new BadRequestException(
        `ไม่สามารถบันทึกใบกำกับ: ${err?.message ?? 'งวดบัญชีปิดแล้ว'}`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const inner = await this.invoiceReceivedTemplate.execute(
        { assetId: id, triggeredById },
        tx,
      );

      const now = new Date();
      // TOCTOU guard: precondition checks above ran outside this tx, so two
      // concurrent clicks could both reach here. Use updateMany with a
      // composite where-clause + rowCount check so the second caller's update
      // affects 0 rows and we throw to roll the whole tx back (including the
      // duplicate JE that the template just posted). The UNIQUE index on
      // invoice_transfer_journal_entry_id provides a second defense at the DB
      // level if a different code path ever skipped the where filter.
      const upd = await tx.fixedAsset.updateMany({
        where: {
          id,
          vatAccount: '11-4102',
          invoiceReceivedAt: null,
          invoiceTransferJournalEntryId: null,
          deletedAt: null,
        },
        data: {
          vatAccount: '11-4101',
          invoiceReceivedAt: now,
          invoiceReceivedById: triggeredById,
          invoiceTransferJournalEntryId: inner.journalEntryId,
        },
      });
      if (upd.count !== 1) {
        throw new BadRequestException(
          'มีคนกดบันทึกใบกำกับไปแล้วในระหว่างนี้ — กรุณารีเฟรชหน้า',
        );
      }

      await tx.auditLog.create({
        data: {
          userId: triggeredById,
          action: 'INVOICE_RECEIVED',
          entity: 'fixed_asset',
          entityId: id,
          oldValue: { vatAccount: '11-4102', invoiceReceivedAt: null },
          newValue: {
            vatAccount: '11-4101',
            invoiceReceivedAt: now.toISOString(),
            transferEntryNumber: inner.entryNo,
            vatAmount: new Decimal(asset.vatAmount.toString()).toFixed(2),
          },
        },
      });

      return { entryNo: inner.entryNo, invoiceReceivedAt: now };
    });

    this.logger.log(
      `INVOICE_RECEIVED asset ${asset.assetCode} → ${result.entryNo}`,
    );
    return result;
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
          issueTaxInvoice: dto.disposalType === 'SALE' ? dto.issueTaxInvoice ?? false : false,
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
    meta?: { reasonLabel?: string | null; note?: string | null },
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
            reverseReasonLabel: meta?.reasonLabel ?? null,
            reverseNote: meta?.note ?? null,
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
}
