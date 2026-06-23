import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, ProductCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface ShopProductAccounts {
  inventoryAccountCode: string;
  cogsAccountCode: string;
  revenueAccountCode: string;
}

/**
 * Single source of truth for resolving SHOP-side account codes:
 * product category → inventory/COGS/revenue S-codes, and branch → cash till.
 */
@Injectable()
export class ShopAccountResolver {
  /** SHOP bank that receives inflows (down/cash-sale transfer + FINANCE settlement). */
  static readonly SHOP_RECEIVING_BANK = 'S11-1201';
  /** SHOP bank that funds outflows (branch expenses, transfer trade-in payout). */
  static readonly SHOP_PAYING_BANK = 'S11-1202';

  constructor(private readonly prisma: PrismaService) {}

  /** TABLET reuses PHONE_NEW codes (D-5); dedicated tablet S-codes deferred. */
  resolveProductAccounts(category: ProductCategory): ShopProductAccounts {
    switch (category) {
      case 'PHONE_USED':
        return { inventoryAccountCode: 'S11-2002', cogsAccountCode: 'S50-1102', revenueAccountCode: 'S41-1102' };
      case 'ACCESSORY':
        return { inventoryAccountCode: 'S11-2003', cogsAccountCode: 'S50-1103', revenueAccountCode: 'S41-1103' };
      case 'PHONE_NEW':
      case 'TABLET':
        return { inventoryAccountCode: 'S11-2001', cogsAccountCode: 'S50-1101', revenueAccountCode: 'S41-1101' };
      default:
        throw new BadRequestException(`ShopAccountResolver: unknown ProductCategory "${category as string}"`);
    }
  }

  /** Fail-closed: a branch must have shopCashAccountCode set before SHOP cash JEs can post. */
  async resolveBranchCashAccount(branchId: string, tx?: Prisma.TransactionClient): Promise<string> {
    const client = (tx ?? this.prisma) as Prisma.TransactionClient;
    const branch = await client.branch.findUnique({
      where: { id: branchId },
      select: { shopCashAccountCode: true },
    });
    if (!branch?.shopCashAccountCode) {
      throw new BadRequestException(
        `ShopAccountResolver: branch ${branchId} has no shopCashAccountCode — set it in branch settings before posting SHOP cash entries`,
      );
    }
    return branch.shopCashAccountCode;
  }
}
