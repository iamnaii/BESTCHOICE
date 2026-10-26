import { Module } from '@nestjs/common';
import { JournalModule } from '../journal/journal.module';
import { ShopPettyCashController } from './shop-petty-cash.controller';
import { ShopPettyCashService } from './shop-petty-cash.service';

/**
 * เงินสดย่อยหน้าร้าน S11-1106 — เมนูเติม/คืน + วงเงิน (ข้อ 20.2 · 2026-10-18).
 * StorageModule / AuditModule เป็น @Global — ไม่ต้อง import · template + CompanyResolverService มาจาก JournalModule
 */
@Module({
  imports: [JournalModule],
  controllers: [ShopPettyCashController],
  providers: [ShopPettyCashService],
  exports: [ShopPettyCashService],
})
export class ShopPettyCashModule {}
