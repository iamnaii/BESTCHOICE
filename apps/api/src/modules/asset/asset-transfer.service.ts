import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { AssetStatus, Prisma } from '@prisma/client';
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

  /**
   * Phase 2 — Cross-asset transfer audit list.
   *
   * Lists all transfer history rows across all assets (not scoped to a single
   * asset). Supports search across asset code/name/serial, custodian and
   * location "contains" filters (case-insensitive), branchId filter via the
   * asset relation, date range on transferDate, and direct assetId filter.
   *
   * Returns ordered by transferDate desc with joined asset + transferredBy.
   */
  async listAllTransfers(filters: {
    page?: number;
    limit?: number;
    search?: string;
    assetId?: string;
    custodianContains?: string;
    locationContains?: string;
    branchId?: string;
    fromDate?: string;
    toDate?: string;
  }) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const where: Prisma.AssetTransferHistoryWhereInput = {};

    if (filters.assetId) where.assetId = filters.assetId;

    if (filters.custodianContains) {
      where.OR = [
        {
          fromCustodian: {
            contains: filters.custodianContains,
            mode: 'insensitive',
          },
        },
        {
          toCustodian: {
            contains: filters.custodianContains,
            mode: 'insensitive',
          },
        },
      ];
    }

    if (filters.locationContains) {
      const existingAnd = Array.isArray(where.AND)
        ? where.AND
        : where.AND
          ? [where.AND]
          : [];
      where.AND = [
        ...existingAnd,
        {
          OR: [
            {
              fromLocation: {
                contains: filters.locationContains,
                mode: 'insensitive',
              },
            },
            {
              toLocation: {
                contains: filters.locationContains,
                mode: 'insensitive',
              },
            },
          ],
        },
      ];
    }

    // Combine branchId + search into where.asset
    const assetWhere: Prisma.FixedAssetWhereInput = {};
    if (filters.branchId) assetWhere.branchId = filters.branchId;
    if (filters.search) {
      assetWhere.OR = [
        { assetCode: { contains: filters.search, mode: 'insensitive' } },
        { name: { contains: filters.search, mode: 'insensitive' } },
        { serialNo: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (Object.keys(assetWhere).length > 0) {
      where.asset = assetWhere;
    }

    if (filters.fromDate || filters.toDate) {
      const range: Prisma.DateTimeFilter = {};
      if (filters.fromDate) range.gte = new Date(filters.fromDate);
      if (filters.toDate) {
        const end = new Date(filters.toDate);
        end.setHours(23, 59, 59, 999);
        range.lte = end;
      }
      where.transferDate = range;
    }

    const [data, total] = await Promise.all([
      this.prisma.assetTransferHistory.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { transferDate: 'desc' },
        include: {
          asset: {
            select: {
              id: true,
              assetCode: true,
              name: true,
              serialNo: true,
              branchId: true,
            },
          },
          transferredBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.assetTransferHistory.count({ where }),
    ]);

    return { data, total, page, limit };
  }
}
