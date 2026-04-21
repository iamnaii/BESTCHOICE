import { Module, forwardRef } from '@nestjs/common';
import { ShopOrdersService } from './shop-orders.service';
import { ShopOrdersController } from './shop-orders.controller';
import { OnlineOrderSaleAdapter } from './online-order-sale.adapter';
import { PrismaModule } from '../../prisma/prisma.module';
import { SalesModule } from '../sales/sales.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, forwardRef(() => SalesModule), AuthModule],
  controllers: [ShopOrdersController],
  providers: [ShopOrdersService, OnlineOrderSaleAdapter],
  exports: [ShopOrdersService, OnlineOrderSaleAdapter],
})
export class ShopOrdersModule {}
