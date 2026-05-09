import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { AssetStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TransferAssetDto } from './dto/transfer-asset.dto';
import { validatePeriodOpen } from '../../utils/period-lock.util';

/**
 * AssetTransferService — Phase 1
 *
 * Records a custodian/location transfer for a POSTED asset. NO journal entry
 * is posted — transfers are operational only (TFRS for NPAEs has no JE for
 * intra-entity custody changes). The transfer is captured in
 * `AssetTransferHistory` and an `ASSET_TRANSFER` AuditLog row.
 *
 * V15 period guard runs against `transferDate` (FINANCE company) so that a
 * historical transfer cannot be back-dated into a closed period.
 */
@Injectable()
export class AssetTransferService {
  private readonly logger = new Logger(AssetTransferService.name);
  private financeCompanyId?: string;

  constructor(private readonly prisma: PrismaService) {}

  private async getFinanceCompanyId(): Promise<string> {
    if (this.financeCompanyId) return this.financeCompanyId;
    const company = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
    });
    if (!company) throw new Error('FINANCE company not found in CompanyInfo');
    this.financeCompanyId = company.id;
    return company.id;
  }

  async transfer(
    assetId: string,
    dto: TransferAssetDto,
    transferredById: string,
  ) {
    // 1. Validate reason (defensive — DTO validator also enforces this)
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException('กรุณาระบุเหตุผลการโอน');
    }

    // 2. Load asset
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id: assetId, deletedAt: null },
    });
    if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');

    // 3. Status guard — POSTED only
    if (asset.status !== AssetStatus.POSTED) {
      throw new BadRequestException(
        `โอนได้เฉพาะสถานะ POSTED (ปัจจุบัน: ${asset.status})`,
      );
    }

    // 4. transferDate ≤ today
    const transferDate = new Date(dto.transferDate);
    if (Number.isNaN(transferDate.getTime())) {
      throw new BadRequestException('วันที่โอนไม่ถูกต้อง');
    }
    // Compare at end-of-day "today" (BKK-local-equivalent based on server)
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    if (transferDate > todayEnd) {
      throw new BadRequestException(
        'วันที่โอนต้องไม่อยู่ในอนาคต (transferDate cannot be in the future)',
      );
    }

    // 5. Determine new values
    const trimmedCustodian =
      typeof dto.toCustodian === 'string' ? dto.toCustodian.trim() : undefined;
    const trimmedLocation =
      typeof dto.toLocation === 'string' ? dto.toLocation.trim() : undefined;
    const newCustodian =
      trimmedCustodian && trimmedCustodian.length > 0
        ? trimmedCustodian
        : asset.custodian;
    const newLocation =
      trimmedLocation && trimmedLocation.length > 0
        ? trimmedLocation
        : asset.location;

    // 6. Reject no-change requests
    if (
      newCustodian === asset.custodian &&
      newLocation === asset.location
    ) {
      throw new BadRequestException(
        'ไม่มีการเปลี่ยนแปลง (no change requested) — ต้องเปลี่ยนผู้ดูแลหรือสถานที่อย่างน้อยหนึ่งอย่าง',
      );
    }

    // 7. V15 period guard on transferDate
    const financeCompanyId = await this.getFinanceCompanyId();
    try {
      await validatePeriodOpen(this.prisma, transferDate, financeCompanyId);
    } catch (err: any) {
      throw new BadRequestException(
        `ไม่สามารถโอน: ${err?.message ?? 'งวดบัญชีปิดแล้ว'}`,
      );
    }

    // 8. Atomic: history + asset update + audit log
    return this.prisma.$transaction(async (tx) => {
      // 12 hex chars = ~48 bits of entropy → collision probability negligible
      // even at millions of transfers/day. The previous 4-char Math.random()
      // suffix only had ~20 bits and was prone to collisions in batches.
      const transferId = `TRF-${randomUUID().replace(/-/g, '').slice(0, 12)}`;

      await tx.assetTransferHistory.create({
        data: {
          transferId,
          assetId: asset.id,
          transferDate,
          fromCustodian: asset.custodian,
          toCustodian: newCustodian,
          fromLocation: asset.location,
          toLocation: newLocation,
          reason: dto.reason,
          transferredById,
        },
      });

      const updated = await tx.fixedAsset.update({
        where: { id: asset.id },
        data: {
          custodian: newCustodian,
          location: newLocation,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: transferredById,
          action: 'ASSET_TRANSFER',
          entity: 'fixed_asset',
          entityId: asset.id,
          oldValue: {
            custodian: asset.custodian,
            location: asset.location,
          },
          newValue: {
            custodian: newCustodian,
            location: newLocation,
            transferId,
            reason: dto.reason,
          },
        },
      });

      this.logger.log(
        `[Phase1] TRANSFER asset ${asset.assetCode} → ${transferId}`,
      );
      return updated;
    });
  }
}
