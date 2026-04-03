import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsPricingService } from './products-pricing.service';
import { ProductsStockService } from './products-stock.service';
import { WarrantyService } from './warranty.service';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, ProductsPricingService, ProductsStockService, WarrantyService],
  exports: [ProductsService, ProductsPricingService, ProductsStockService, WarrantyService],
})
export class ProductsModule {}
