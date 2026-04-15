import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { addDays, isPast, differenceInDays } from 'date-fns';

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

      if (!contract?.product) return;

      const product = contract.product;

      // PHONE_USED category = used/second-hand phone (schema: ProductCategory enum)
      const isUsed = product.category === 'PHONE_USED';

      // Only set shop warranty for used phones that have shopWarrantyDays configured,
      // or any PHONE_USED product (default 60 days)
      if (!isUsed && !product.shopWarrantyDays) return;

      // Get warranty days: SystemConfig override → product field → default 60
      let warrantyDays = product.shopWarrantyDays ?? 60;

      const configDays = await this.prisma.systemConfig.findUnique({
        where: { key: 'warranty.shopWarrantyDays' },
      });
      if (configDays?.value) {
        warrantyDays = parseInt(configDays.value, 10) || 60;
      }

      const startDate = contract.createdAt;
      const endDate = addDays(startDate, warrantyDays);

      await this.prisma.contract.update({
        where: { id: contractId },
        data: {
          shopWarrantyStartDate: startDate,
          shopWarrantyEndDate: endDate,
        },
      });

      this.logger.log(
        `Shop warranty set for contract ${contractId}: ${warrantyDays} days until ${endDate.toISOString()}`,
      );
    } catch (error) {
      this.logger.error(`Failed to set shop warranty for contract ${contractId}`, error);
    }
  }

  async getExpiringWarranties(daysAhead: number = 7): Promise<any[]> {
    const now = new Date();
    const targetDate = addDays(now, daysAhead);

    // Find manufacturer warranties expiring
    const manufacturerExpiring = await this.prisma.contract.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        product: {
          warrantyExpireDate: { gte: now, lte: targetDate },
        },
      },
      include: {
        product: { select: { name: true, warrantyExpireDate: true } },
        customer: { select: { id: true, name: true, phone: true } },
      },
    });

    // Find shop warranties expiring
    const shopExpiring = await this.prisma.contract.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        shopWarrantyEndDate: { gte: now, lte: targetDate },
      },
      include: {
        product: { select: { name: true } },
        customer: { select: { id: true, name: true, phone: true } },
      },
    });

    return [
      ...manufacturerExpiring.map((c) => ({
        type: 'manufacturer' as const,
        contractId: c.id,
        productName: c.product?.name,
        customerName: c.customer?.name,
        customerId: c.customer?.id,
        expireDate: c.product?.warrantyExpireDate,
        daysRemaining: differenceInDays(c.product!.warrantyExpireDate!, now),
      })),
      ...shopExpiring.map((c) => ({
        type: 'shop' as const,
        contractId: c.id,
        productName: c.product?.name,
        customerName: c.customer?.name,
        customerId: c.customer?.id,
        expireDate: c.shopWarrantyEndDate,
        daysRemaining: differenceInDays(c.shopWarrantyEndDate!, now),
      })),
    ];
  }
}
