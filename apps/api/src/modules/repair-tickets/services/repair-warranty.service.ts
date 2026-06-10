import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { detectWarrantyStatus, defaultPayer } from '../utils/detect-warranty-status';
import { WarrantyPreviewDto } from '../dto/warranty-preview.dto';
import { WarrantyLookupDto } from '../dto/warranty-lookup.dto';
import { hasCrossBranchAccess } from '../../auth/branch-access.util';

type ReqUser = { id: string; role: string; branchId?: string | null };

/**
 * Warranty (read-only lookup/preview) half of RepairTicketsService.
 * Constructed internally by the RepairTicketsService facade.
 */
@Injectable()
export class RepairWarrantyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Private helper — shared by warrantyPreview and warrantyLookup.
   * Computes the 3 warranty day-remaining windows using BKK calendar-day arithmetic.
   * Mirrors the logic in detectWarrantyStatus (UTC+7 offset).
   */
  private computeWarrantyWindows(
    deviceReceivedAt: Date | null | undefined,
    shopWarrantyEndDate: Date | null | undefined,
    warrantyExpireDate: Date | null | undefined,
  ): { sevenDayDefect: number | null; shopWarranty: number | null; mfrWarranty: number | null } {
    const now = new Date();

    // BKK calendar-day arithmetic (UTC+7 offset) — consistent with detectWarrantyStatus
    function bkkCalendarDay(d: Date): Date {
      const shifted = new Date(d.getTime() + 7 * 60 * 60 * 1000);
      return new Date(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
    }

    const sevenDayDefect =
      deviceReceivedAt != null
        ? Math.max(
            0,
            Math.floor(
              (bkkCalendarDay(deviceReceivedAt).getTime() +
                7 * 86400_000 -
                bkkCalendarDay(now).getTime()) /
                86400_000,
            ),
          )
        : null;

    // W1: use BKK calendar-day math for shopWarranty + mfrWarranty (same as sevenDayDefect)
    // so all 3 windows are measured with consistent BKK midnight boundaries.
    const shopWarranty =
      shopWarrantyEndDate != null
        ? Math.max(
            0,
            Math.floor(
              (bkkCalendarDay(shopWarrantyEndDate).getTime() - bkkCalendarDay(now).getTime()) /
                86400_000,
            ),
          )
        : null;

    const mfrWarranty =
      warrantyExpireDate != null
        ? Math.max(
            0,
            Math.floor(
              (bkkCalendarDay(warrantyExpireDate).getTime() - bkkCalendarDay(now).getTime()) /
                86400_000,
            ),
          )
        : null;

    return { sevenDayDefect, shopWarranty, mfrWarranty };
  }

  /**
   * Server-side warranty decision for the wizard Step 3 routing.
   * Determines warranty status, smart-default flow, days-remaining windows,
   * and eligibility flags without any re-implementation in the frontend.
   */
  async warrantyPreview(dto: WarrantyPreviewDto, user: ReqUser) {
    if (!dto.customerId && !dto.contractId && !dto.productId) {
      throw new BadRequestException(
        'ต้องระบุ customerId หรือ productId หรือ contractId อย่างน้อย 1 อย่าง',
      );
    }

    const contract = dto.contractId
      ? await this.prisma.contract.findUnique({
          where: { id: dto.contractId, deletedAt: null },
          include: { product: true },
        })
      : null;

    const product = dto.productId
      ? await this.prisma.product.findUnique({
          where: { id: dto.productId, deletedAt: null },
        })
      : (contract?.product ?? null);

    // detectWarrantyStatus accepts { contract?, product? } — BKK calendar-day arithmetic inside
    const warrantyStatus = detectWarrantyStatus({ contract, product });

    const { sevenDayDefect, shopWarranty, mfrWarranty } = this.computeWarrantyWindows(
      contract?.deviceReceivedAt,
      contract?.shopWarrantyEndDate,
      product?.warrantyExpireDate,
    );

    // C2: tie forExchange to warrantyStatus === IN_7DAY_DEFECT (source of truth from detectWarrantyStatus).
    // Do NOT use sevenDayDefect > 0 — on day-7 exactly, sevenDayDefect === 0 yet warrantyStatus
    // is still IN_7DAY_DEFECT (daysSinceReceipt === 7 <= 7). sevenDayDefect is Math.max(0, ...)
    // so it bottoms out at 0 regardless of days-past-7, making sevenDayDefect === 0 ambiguous.
    // Using warrantyStatus directly is the single source of truth.
    const forExchange =
      warrantyStatus === 'IN_7DAY_DEFECT' &&
      !!contract &&
      contract.status === 'ACTIVE' &&
      product?.category === 'PHONE_USED';

    const defaultFlow: 'repair' | 'exchange' =
      warrantyStatus === 'IN_7DAY_DEFECT' && forExchange ? 'exchange' : 'repair';
    const alternativeFlow: 'repair' | null = defaultFlow === 'exchange' ? 'repair' : null;
    const defaultPayerValue = defaultPayer(warrantyStatus);

    // Audit log (fire-and-forget — non-blocking, throttled per-user upstream)
    // C1: do NOT include dto in the log — it contains UUIDs (customerId/contractId/productId) = PII
    this.audit
      .log({
        userId: user.id,
        action: 'WARRANTY_LOOKED_UP',
        entity: 'repair_ticket',
        newValue: {
          searchMode: 'preview',
          inputType: dto.contractId ? 'contract' : dto.productId ? 'product' : 'customer',
          resultCount: 1,
        },
      })
      .catch(() => {});

    return {
      warrantyStatus,
      defaultFlow,
      alternativeFlow,
      defaultPayer: defaultPayerValue,
      daysRemaining: { sevenDayDefect, shopWarranty, mfrWarranty },
      eligibility: { forExchange, forRepair: true },
      blockingReasons: undefined as string[] | undefined,
    };
  }

  /**
   * Standalone warranty lookup for the /insurance/warranty-check page.
   * Three search modes: by customerId, by imei/serial, or by contractNumber.
   * Returns customer info + all matching devices with warranty windows + eligibility flags.
   * No ticket is created — read-only lookup only.
   */
  async warrantyLookup(dto: WarrantyLookupDto, user: ReqUser) {
    if (!dto.customerId && !dto.imei && !dto.serial && !dto.contractNumber) {
      throw new BadRequestException('ต้องระบุ search input อย่างน้อย 1 อย่าง');
    }

    const branchScope = hasCrossBranchAccess(user)
      ? {}
      : { branchId: user.branchId ?? undefined };

    let contracts: any[] = [];
    let customer: any = null;

    if (dto.customerId) {
      // C3: verify customer exists — throw if not, but empty devices is OK (customer has no phones)
      customer = await this.prisma.customer.findUnique({
        where: { id: dto.customerId, deletedAt: null },
      });
      if (!customer) throw new NotFoundException('ไม่พบลูกค้า');
      contracts = await this.prisma.contract.findMany({
        where: { customerId: dto.customerId, deletedAt: null, ...branchScope },
        include: { product: true, customer: true },
      });
    } else if (dto.imei || dto.serial) {
      const search = dto.imei ?? dto.serial!;
      // C3: exact-match lookup — throw NotFoundException when the device doesn't exist at all
      const product = await this.prisma.product.findFirst({
        where: { imeiSerial: search, deletedAt: null },
        include: {
          contracts: {
            where: { deletedAt: null, ...branchScope },
            include: { customer: true },
          },
        },
      });
      if (!product) {
        throw new NotFoundException(`ไม่พบเครื่องที่ ${dto.imei ? 'IMEI' : 'Serial'} นี้`);
      }
      if (product.contracts?.length) {
        customer = product.contracts[0].customer;
        contracts = product.contracts.map((c: any) => ({ ...c, product }));
      } else {
        // Product exists but no contract in scope — walk-in style row (no contract)
        contracts = [
          {
            product,
            customer: null,
            deviceReceivedAt: null,
            shopWarrantyEndDate: null,
            status: 'NO_CONTRACT',
          },
        ];
      }
    } else if (dto.contractNumber) {
      // C3: exact-match lookup — throw NotFoundException when contract doesn't exist at all
      const c = await this.prisma.contract.findFirst({
        where: { contractNumber: dto.contractNumber, deletedAt: null, ...branchScope },
        include: { product: true, customer: true },
      });
      if (!c) throw new NotFoundException(`ไม่พบสัญญาเลขที่ ${dto.contractNumber}`);
      customer = c.customer;
      contracts = [c];
    }

    const devices = contracts
      .map((c: any) => {
        const warrantyWindows = this.computeWarrantyWindows(
          c.deviceReceivedAt,
          c.shopWarrantyEndDate,
          c.product?.warrantyExpireDate,
        );

        // C2: use detectWarrantyStatus as the single source of truth for the 7-day boundary.
        // sevenDayDefect bottoms at 0 via Math.max, making sevenDayDefect === 0 ambiguous
        // (could be day-7 in-window OR any expired day). warrantyStatus === IN_7DAY_DEFECT
        // correctly captures the inclusive-7 boundary from BKK calendar-day arithmetic.
        const warrantyStatus = detectWarrantyStatus({ contract: c, product: c.product });
        const forExchange =
          warrantyStatus === 'IN_7DAY_DEFECT' &&
          !!c.id &&
          c.status === 'ACTIVE' &&
          c.product?.category === 'PHONE_USED';

        return {
          product: c.product
            ? {
                id: c.product.id,
                brand: c.product.brand,
                model: c.product.model,
                imeiSerial: c.product.imeiSerial ?? null,
              }
            : null,
          contract: c.id
            ? { id: c.id, contractNumber: c.contractNumber, status: c.status }
            : null,
          warrantyWindows,
          eligibility: { forExchange, forRepair: true },
        };
      })
      .filter((d: any) => d.product !== null);

    // Audit log (fire-and-forget — non-blocking)
    this.audit
      .log({
        userId: user.id,
        action: 'WARRANTY_LOOKED_UP',
        entity: 'repair_ticket',
        newValue: {
          searchMode: dto.customerId
            ? 'customer'
            : dto.imei
              ? 'imei'
              : dto.serial
                ? 'serial'
                : 'contract',
          resultCount: devices.length,
        },
      })
      .catch(() => {});

    return { customer, devices };
  }

  /**
   * IMEI-based lookup for the insurance wizard Step 1 pre-fill.
   * Finds the product by IMEI/serial, then the most recent non-deleted Sale for that product.
   * Returns structured data covering product, customer, contract, and computed warranty status.
   * No audit log — read-only, called frequently during wizard UX.
   */
  async lookupByImei(imei: string, user: ReqUser) {
    const product = await this.prisma.product.findFirst({
      where: { imeiSerial: imei, deletedAt: null },
      select: {
        id: true,
        brand: true,
        model: true,
        storage: true,
        imeiSerial: true,
        category: true,
        warrantyExpireDate: true,
      },
    });

    if (!product) return { found: false } as const;

    // Branch scoping: SALES + BRANCH_MANAGER (non-cross-branch roles) only see
    // Sales from their own branch. OWNER / FINANCE_MANAGER / ACCOUNTANT see all.
    // Without this, scanning a foreign branch's IMEI leaks customer name/phone
    // — PDPA violation. Mirrors warrantyLookup's branchScope at line ~795.
    const branchScope = hasCrossBranchAccess(user)
      ? {}
      : { branchId: user.branchId ?? undefined };

    const sale = await this.prisma.sale.findFirst({
      where: { productId: product.id, deletedAt: null, ...branchScope },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        saleType: true,
        createdAt: true,
        customer: { select: { id: true, name: true, phone: true } },
        contract: {
          select: {
            id: true,
            contractNumber: true,
            status: true,
            deviceReceivedAt: true,
            shopWarrantyEndDate: true,
          },
        },
      },
    });

    // Use canonical detectWarrantyStatus utility (handles IN_MANUFACTURER + BKK
    // calendar-day arithmetic correctly). Never duplicate this logic — see W8
    // discipline in detect-warranty-status.ts.
    const warrantyStatus = detectWarrantyStatus({
      contract: sale?.contract ?? null,
      product,
    });

    return {
      found: true,
      product: {
        id: product.id,
        brand: product.brand,
        model: product.model,
        storage: product.storage,
        imeiSerial: product.imeiSerial,
        category: product.category,
      },
      sale: sale ? { id: sale.id, saleType: sale.saleType } : null,
      customer: sale?.customer ?? null,
      contract: sale?.contract
        ? {
            id: sale.contract.id,
            contractNumber: sale.contract.contractNumber,
            status: sale.contract.status,
          }
        : null,
      warrantyStatus,
      daysRemainingIn7Day: this.computeDaysRemainingIn7Day(sale?.contract),
      // วันที่ซื้อ + วันที่หมดประกัน (both warranties when present)
      purchasedAt: sale?.createdAt ?? null,
      shopWarrantyEndDate: sale?.contract?.shopWarrantyEndDate ?? null,
      manufacturerWarrantyEndDate: product.warrantyExpireDate ?? null,
    } as const;
  }

  private computeDaysRemainingIn7Day(contract: { deviceReceivedAt?: Date | null } | null | undefined): number | null {
    if (!contract?.deviceReceivedAt) return null;
    // BKK calendar-day arithmetic (matches detect-warranty-status.ts convention).
    // A device received at 23:00 BKK on day 0 → still has 7 days remaining at midnight UTC.
    const bkkOffsetMs = 7 * 60 * 60 * 1000;
    const toBkkMidnight = (d: Date) => {
      const bkk = new Date(d.getTime() + bkkOffsetMs);
      return new Date(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate());
    };
    const daysSince =
      (toBkkMidnight(new Date()).getTime() - toBkkMidnight(new Date(contract.deviceReceivedAt)).getTime()) /
      86_400_000;
    const remaining = 7 - daysSince;
    return remaining < 0 ? 0 : Math.ceil(remaining);
  }
}
