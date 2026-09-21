import { Module } from '@nestjs/common';
import { ShopTendersController } from './shop-tenders.controller';
import { ShopTendersReportService } from './shop-tenders-report.service';
import { ShopCashCloseService } from './shop-cash-close.service';
import { JournalModule } from '../journal/journal.module';

/**
 * สมุดเงินเข้า/ออกหน้าร้าน (สเปค 2026-09-20-shop-tenders-daily-cash).
 * ฝั่งเขียน (`ShopTenderRecorder`) ไม่ใช่ provider — แต่ละ flow สร้างเองใน tx ของตัวเองด้วย `new ShopTenderRecorder(prisma)`
 * ตามแบบ TradeInCreditService; module นี้มีเฉพาะฝั่งอ่าน (หน้าสรุปเงินรายวัน).
 */
@Module({
  imports: [JournalModule],
  controllers: [ShopTendersController],
  providers: [ShopTendersReportService, ShopCashCloseService],
})
export class ShopTendersModule {}
