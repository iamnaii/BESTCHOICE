import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsPricingService } from './products-pricing.service';
import { ProductsStockService } from './products-stock.service';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, ProductsPricingService, ProductsStockService],
  exports: [ProductsService, ProductsPricingService, ProductsStockService],
})
export class ProductsModule {}
