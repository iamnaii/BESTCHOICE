import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { BookingsModule } from '../bookings/bookings.module';
import { AfterSalesModule } from '../after-sales/after-sales.module';
import { ShopTendersModule } from '../shop-tenders/shop-tenders.module';
import { InventoryModule } from '../inventory/inventory.module';
import { JournalModule } from '../journal/journal.module';
import { ProductsModule } from '../products/products.module';
import { AccountingModule } from '../accounting/accounting.module';
import { ShopHomeController } from './shop-home.controller';
import { ShopHomeService } from './shop-home.service';

/**
 * หน้าหลักหน้าร้าน (spec docs/superpowers/specs/2026-10-22-shop-home-dashboard-design.md).
 * ไม่มีข้อมูลของตัวเอง — ประกอบจาก service ที่ module อื่น export ให้.
 */
@Module({
  imports: [
    SalesModule,
    BookingsModule,
    AfterSalesModule,
    ShopTendersModule,
    InventoryModule,
    JournalModule, // CompanyResolverService — resolve บริษัทร้านครั้งเดียวสำหรับงบ 6 เดือน
    ProductsModule,
    AccountingModule,
  ],
  controllers: [ShopHomeController],
  providers: [ShopHomeService],
})
export class ShopHomeModule {}
