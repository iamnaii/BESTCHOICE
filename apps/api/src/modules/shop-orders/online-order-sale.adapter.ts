import { Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';

@Injectable()
export class OnlineOrderSaleAdapter {
  private readonly logger = new Logger(OnlineOrderSaleAdapter.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => SalesService)) private sales: SalesService,
  ) {}

  /**
   * Called after PaySolutions webhook confirms PAID on an OnlineOrder.
   * Creates a Sale (CASH) record, links back to the OnlineOrder,
   * and transitions OnlineOrder.status to PACKING (admin picks up from here).
   */
  async createForOnlineOrder(onlineOrderId: string): Promise<void> {
    const order = await this.prisma.onlineOrder.findUnique({
      where: { id: onlineOrderId },
      include: { product: true, customer: true },
    });
    if (!order) throw new NotFoundException('online order not found');
    if (order.saleId) return; // idempotent

    const branch = await this.prisma.branch.findFirst({
      where: { company: { companyCode: 'SHOP' }, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!branch) throw new Error('No SHOP branch configured — cannot attribute online sale');

    // Attribute the online sale to an OWNER as the "salesperson" (system attribution)
    const salesperson = await this.prisma.user.findFirst({
      where: { role: 'OWNER', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!salesperson) throw new Error('No OWNER user available to attribute online sale');

    // Cast to any — CreateSaleDto's paymentMethod whitelist excludes ONLINE_GATEWAY,
    // but the Prisma enum supports it. SalesService.create is called directly
    // (bypasses DTO ValidationPipe).
    const sale = await (this.sales as any).create(
      {
        saleType: 'CASH',
        customerId: order.customerId,
        productId: order.productId,
        branchId: branch.id,
        sellingPrice: Number(order.productPrice),
        discount: Number(order.promoDiscount) + Number(order.loyaltyDiscount),
        paymentMethod: 'ONLINE_GATEWAY',
        amountReceived: Number(order.totalAmount),
        loyaltyPointsRedeemed: order.loyaltyPointsUsed || undefined,
      },
      salesperson.id,
      'OWNER',
    );

    await this.prisma.sale.update({
      where: { id: sale.id },
      data: { saleSource: 'ONLINE', onlineOrderId: order.id },
    });
    await this.prisma.onlineOrder.update({
      where: { id: order.id },
      data: { saleId: sale.id, status: 'PACKING' },
    });
    this.logger.log(`Sale ${sale.id} created for online order ${order.orderNumber}`);
  }
}
