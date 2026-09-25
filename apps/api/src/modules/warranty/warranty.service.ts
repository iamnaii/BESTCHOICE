import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { readProductDisclosure } from '../../utils/product-disclosure.util';
import { readStringFlag } from '../../utils/config.util';
import { PrismaService } from '../../prisma/prisma.service';
import { addDays, isPast, differenceInDays } from 'date-fns';
import { resolveShopWarrantyDays, SHOP_WARRANTY_DAYS_CONFIG_KEY } from './shop-warranty-policy';

/**
 * แถวหนึ่งของ "ประกันใกล้หมด 7 วัน" — คนเดียวที่บริโภคคือ `WarrantyCron` →
 * `WarrantyLineNotifierService.notifyExpiring` (PR 3 Task 5). ครอบทั้งลูกค้าผ่อน (`Contract`)
 * และลูกค้าขายสด/ไฟแนนซ์นอก (`Sale` ที่ `contractId: null`) — spec bug 12.7.
 *
 * `lineIdShop` เป็น PII: อยู่ในฟิลด์นี้เพื่อให้ notifier ใช้ส่งเท่านั้น ห้าม log และห้ามใส่ใน
 * `data` ที่ส่งเข้าแม่แบบ (ตัวแปรของแม่แบบมีแค่ warrantyType/deviceName/daysRemaining/
 * expireDate/liffLine — ไม่มี lineIdShop).
 */
export interface ExpiringWarrantyItem {
  type: 'manufacturer' | 'shop';
  source: 'CONTRACT' | 'SALE';
  /** contractId (source CONTRACT) หรือ saleId (source SALE) — คู่กับ type คือ relatedId dedup key */
  sourceId: string;
  /** คงไว้เพื่อ back-compat — มีค่าเฉพาะ source CONTRACT (เท่ากับ sourceId) */
  contractId?: string;
  productName: string | undefined;
  /** ยี่ห้อ+รุ่น+ความจุ เหมือนหน้า LIFF "ประกันของฉัน" (LiffWarrantyService) */
  deviceName: string;
  customerName: string | undefined;
  customerId: string;
  expireDate: Date;
  daysRemaining: number;
  /** PII — ผู้รับ LINE ของ notifier เท่านั้น ห้าม log */
  lineIdShop: string | null;
}

interface WarrantyStatus {
  manufacturer: {
    expireDate: Date | null;
    expired: boolean;
    daysRemaining: number;
  };
  shop: {
    startDate: Date | null;
    endDate: Date | null;
    expired: boolean;
    daysRemaining: number;
  } | null;
}

@Injectable()
export class WarrantyService {
  private readonly logger = new Logger(WarrantyService.name);

  constructor(private prisma: PrismaService) {}

  async getWarrantyStatus(contractId: string): Promise<WarrantyStatus> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { product: true },
    });

    if (!contract?.product) {
      return {
        manufacturer: { expireDate: null, expired: true, daysRemaining: 0 },
        shop: null,
      };
    }

    const now = new Date();
    const product = contract.product;

    return {
      manufacturer: {
        expireDate: product.warrantyExpireDate ?? null,
        expired: product.warrantyExpireDate ? isPast(product.warrantyExpireDate) : true,
        daysRemaining: product.warrantyExpireDate
          ? Math.max(0, differenceInDays(product.warrantyExpireDate, now))
          : 0,
      },
      shop: contract.shopWarrantyEndDate
        ? {
            startDate: contract.shopWarrantyStartDate,
            endDate: contract.shopWarrantyEndDate,
            expired: isPast(contract.shopWarrantyEndDate),
            daysRemaining: Math.max(0, differenceInDays(contract.shopWarrantyEndDate, now)),
          }
        : null,
    };
  }

  async setShopWarranty(contractId: string): Promise<void> {
    try {
      const contract = await this.prisma.contract.findUnique({
        where: { id: contractId },
        include: { product: true },
      });

      if (!contract?.product || contract.shopWarrantyStartDate || contract.shopWarrantyEndDate)
        return;

      const product = contract.product;

      // สูตรจำนวนวันย้ายไป shop-warranty-policy.ts แล้ว — ใบขาย (ขายสด/ไฟแนนซ์นอก)
      // ใช้สูตรเดียวกันนี้ ห้ามคำนวณแยก ไม่งั้นลูกค้าคนเดียวกันได้ประกันไม่เท่ากัน
      // แล้วแต่ว่าซื้อแบบผ่อนหรือสด
      const disclosure = readProductDisclosure(contract.productDisclosure);
      const warrantyDays = disclosure
        ? disclosure.shopWarrantyDays || null
        : resolveShopWarrantyDays(
            product,
            await readStringFlag(this.prisma, SHOP_WARRANTY_DAYS_CONFIG_KEY, ''),
          );
      if (warrantyDays === null) return;

      const startDate = contract.createdAt;
      const endDate = addDays(startDate, warrantyDays);

      await this.prisma.contract.update({
        where: { id: contractId },
        data: {
          shopWarrantyStartDate: startDate,
          shopWarrantyEndDate: endDate,
        },
      });

      // Initial warranty set — audit trail row with direction=INITIAL.
      // Only write when salespersonId is a real user (FK requires it). If
      // the contract has no salesperson, skip — the audit table is for
      // manual adjustments anyway; auto-set on activation is self-documenting.
      if (contract.salespersonId) {
        await this.prisma.warrantyAuditLog
          .create({
            data: {
              contractId,
              userId: contract.salespersonId,
              oldEndDate: null,
              newEndDate: endDate,
              direction: 'INITIAL',
              reason: `auto-set on contract activation (${warrantyDays} days)`,
            },
          })
          .catch((err) =>
            this.logger.warn(`WarrantyAuditLog write failed (initial): ${err.message}`),
          );
      }

      this.logger.log(
        `Shop warranty set for contract ${contractId}: ${warrantyDays} days until ${endDate.toISOString()}`,
      );
    } catch (error) {
      this.logger.error(`Failed to set shop warranty for contract ${contractId}`, error);
    }
  }

  /**
   * Manual shop-warranty adjustment (T5-C6 + T5-C13). The ONLY path allowed
   * to mutate `shopWarrantyEndDate` after initial activation. Every call
   * writes an immutable audit row in the SAME transaction as the update so
   * an audit-write failure rolls back the mutation (T5-C13 atomicity).
   *
   * Policy:
   *   - reason is required (≥ 10 chars)
   *   - BACKWARD adjustment (newEnd < oldEnd) → OWNER only. This is the fraud
   *     vector: MANAGER shortens warranty so customer can't claim, then staff
   *     resells the faulty device.
   *   - BACKWARD > 7 days → requires a SECOND approver (different user) —
   *     two-person integrity check for material shortening of customer
   *     coverage (T5-C13). Pass `secondApproverId` in the options arg.
   *   - FORWARD adjustment → OWNER / FINANCE_MANAGER / BRANCH_MANAGER
   */
  async adjustShopWarranty(
    contractId: string,
    newEndDate: Date,
    reason: string,
    userId: string,
    userRole: string,
    options?: { secondApproverId?: string },
  ): Promise<void> {
    if (!reason || reason.trim().length < 10) {
      throw new BadRequestException('ต้องระบุเหตุผลอย่างน้อย 10 ตัวอักษร');
    }

    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { id: true, shopWarrantyEndDate: true },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    const oldEnd = contract.shopWarrantyEndDate;
    const isBackward = oldEnd !== null && newEndDate.getTime() < oldEnd.getTime();
    const direction = oldEnd === null ? 'INITIAL' : isBackward ? 'BACKWARD' : 'FORWARD';

    if (isBackward && userRole !== 'OWNER') {
      throw new ForbiddenException('การย่นวันสิ้นสุดประกันต้องได้รับอนุมัติจาก OWNER เท่านั้น');
    }
    const allowedForward = ['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER'];
    if (!isBackward && !allowedForward.includes(userRole)) {
      throw new ForbiddenException(`ผู้ปรับประกันต้องเป็น ${allowedForward.join(' / ')}`);
    }

    // T5-C13: BACKWARD > 7 days needs a second approver (different user).
    let secondApproverId: string | null = null;
    if (isBackward && oldEnd) {
      const daysShortened = Math.ceil(
        (oldEnd.getTime() - newEndDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysShortened > 7) {
        const approver = options?.secondApproverId?.trim();
        if (!approver) {
          throw new BadRequestException(
            'การย่นวันสิ้นสุดประกันเกิน 7 วัน ต้องระบุผู้อนุมัติร่วม (second approver)',
          );
        }
        if (approver === userId) {
          throw new BadRequestException('ผู้อนุมัติร่วมต้องไม่ใช่ผู้ทำรายการคนเดียวกัน');
        }
        secondApproverId = approver;
      }
    }

    await this.prisma.$transaction([
      this.prisma.contract.update({
        where: { id: contractId },
        data: { shopWarrantyEndDate: newEndDate },
      }),
      this.prisma.warrantyAuditLog.create({
        data: {
          contractId,
          userId,
          oldEndDate: oldEnd,
          newEndDate,
          direction,
          reason: reason.trim(),
        },
      }),
      // T5-C13: second-approver trace on material shortening
      ...(secondApproverId
        ? [
            this.prisma.auditLog.create({
              data: {
                userId: secondApproverId,
                action: 'WARRANTY_BACKWARD_SECOND_APPROVAL',
                entity: 'contract',
                entityId: contractId,
                oldValue: { shopWarrantyEndDate: oldEnd },
                newValue: {
                  shopWarrantyEndDate: newEndDate,
                  reason: reason.trim(),
                  primaryUserId: userId,
                },
              },
            }),
          ]
        : []),
    ]);

    this.logger.log(
      `Shop warranty adjusted for ${contractId}: ${direction} by ${userId}` +
        (secondApproverId ? ` (co-approved by ${secondApproverId})` : ''),
    );
  }

  /**
   * รวมประกันที่ใกล้หมดใน `daysAhead` วัน — ทั้งลูกค้าผ่อน (`Contract`) และลูกค้าขายสด/
   * ไฟแนนซ์นอก (`Sale` ที่ `contractId: null` — spec bug 12.7 เดิมมองไม่เห็นกลุ่มนี้เลย).
   * ผู้เรียกเดียว: `WarrantyCron.checkExpiringWarranties`.
   */
  async getExpiringWarranties(daysAhead: number = 7): Promise<ExpiringWarrantyItem[]> {
    const now = new Date();
    const targetDate = addDays(now, daysAhead);

    const PRODUCT_SELECT = {
      name: true,
      brand: true,
      model: true,
      storage: true,
      warrantyExpireDate: true,
    } as const;
    const CUSTOMER_SELECT = { id: true, name: true, lineIdShop: true } as const;

    const [manufacturerExpiring, shopExpiring, salesManufacturerExpiring, salesShopExpiring] =
      await Promise.all([
        // ประกันศูนย์ — ลูกค้าผ่อน
        this.prisma.contract.findMany({
          where: {
            status: 'ACTIVE',
            deletedAt: null,
            product: { warrantyExpireDate: { gte: now, lte: targetDate } },
          },
          select: {
            id: true,
            product: { select: PRODUCT_SELECT },
            customer: { select: CUSTOMER_SELECT },
          },
        }),
        // ประกันร้าน — ลูกค้าผ่อน
        this.prisma.contract.findMany({
          where: {
            status: 'ACTIVE',
            deletedAt: null,
            shopWarrantyEndDate: { gte: now, lte: targetDate },
          },
          select: {
            id: true,
            shopWarrantyEndDate: true,
            product: { select: PRODUCT_SELECT },
            customer: { select: CUSTOMER_SELECT },
          },
        }),
        // ประกันศูนย์ — ลูกค้าขายสด/ไฟแนนซ์นอก (ไม่มีสัญญา)
        this.prisma.sale.findMany({
          where: {
            deletedAt: null,
            contractId: null,
            product: { warrantyExpireDate: { gte: now, lte: targetDate } },
          },
          select: {
            id: true,
            product: { select: PRODUCT_SELECT },
            customer: { select: CUSTOMER_SELECT },
          },
        }),
        // ประกันร้าน — ลูกค้าขายสด/ไฟแนนซ์นอก (ไม่มีสัญญา)
        this.prisma.sale.findMany({
          where: {
            deletedAt: null,
            contractId: null,
            shopWarrantyEndDate: { gte: now, lte: targetDate },
          },
          select: {
            id: true,
            shopWarrantyEndDate: true,
            product: { select: PRODUCT_SELECT },
            customer: { select: CUSTOMER_SELECT },
          },
        }),
      ]);

    const deviceName = (
      product:
        | { brand?: string | null; model?: string | null; storage?: string | null }
        | null
        | undefined,
    ): string => [product?.brand, product?.model, product?.storage].filter(Boolean).join(' ');

    return [
      ...manufacturerExpiring.map(
        (c): ExpiringWarrantyItem => ({
          type: 'manufacturer',
          source: 'CONTRACT',
          sourceId: c.id,
          contractId: c.id,
          productName: c.product?.name,
          deviceName: deviceName(c.product),
          customerName: c.customer?.name,
          customerId: c.customer!.id,
          expireDate: c.product!.warrantyExpireDate!,
          daysRemaining: differenceInDays(c.product!.warrantyExpireDate!, now),
          lineIdShop: c.customer?.lineIdShop ?? null,
        }),
      ),
      ...shopExpiring.map(
        (c): ExpiringWarrantyItem => ({
          type: 'shop',
          source: 'CONTRACT',
          sourceId: c.id,
          contractId: c.id,
          productName: c.product?.name,
          deviceName: deviceName(c.product),
          customerName: c.customer?.name,
          customerId: c.customer!.id,
          expireDate: c.shopWarrantyEndDate!,
          daysRemaining: differenceInDays(c.shopWarrantyEndDate!, now),
          lineIdShop: c.customer?.lineIdShop ?? null,
        }),
      ),
      ...salesManufacturerExpiring.map(
        (s): ExpiringWarrantyItem => ({
          type: 'manufacturer',
          source: 'SALE',
          sourceId: s.id,
          productName: s.product?.name,
          deviceName: deviceName(s.product),
          customerName: s.customer?.name,
          customerId: s.customer!.id,
          expireDate: s.product!.warrantyExpireDate!,
          daysRemaining: differenceInDays(s.product!.warrantyExpireDate!, now),
          lineIdShop: s.customer?.lineIdShop ?? null,
        }),
      ),
      ...salesShopExpiring.map(
        (s): ExpiringWarrantyItem => ({
          type: 'shop',
          source: 'SALE',
          sourceId: s.id,
          productName: s.product?.name,
          deviceName: deviceName(s.product),
          customerName: s.customer?.name,
          customerId: s.customer!.id,
          expireDate: s.shopWarrantyEndDate!,
          daysRemaining: differenceInDays(s.shopWarrantyEndDate!, now),
          lineIdShop: s.customer?.lineIdShop ?? null,
        }),
      ),
    ];
  }
}
