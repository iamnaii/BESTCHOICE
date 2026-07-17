import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsPricingService } from './products-pricing.service';
import { ProductsStockService } from './products-stock.service';
import { ProductsOnlineListingService } from './products-online-listing.service';
import { WarrantyService } from './warranty.service';

@Module({
  controllers: [ProductsController],
  providers: [
    ProductsService,
    ProductsPricingService,
    ProductsStockService,
    ProductsOnlineListingService,
    WarrantyService,
  ],
  exports: [
    ProductsService,
    ProductsPricingService,
    ProductsStockService,
    ProductsOnlineListingService,
    WarrantyService,
  ],
})
export class ProductsModule {}
