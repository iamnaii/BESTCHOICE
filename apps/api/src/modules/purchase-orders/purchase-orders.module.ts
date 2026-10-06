import { Module } from '@nestjs/common';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { GoodsReceivingTaxInvoiceService } from './services/goods-receiving-tax-invoice.service';
import { JournalModule } from '../journal/journal.module';

@Module({
  // รับสินค้าเข้าลงบัญชี (2026-09-29) — template + ตัวเลือกบัญชีมาจาก JournalModule
  imports: [JournalModule],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService, GoodsReceivingTaxInvoiceService],
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
