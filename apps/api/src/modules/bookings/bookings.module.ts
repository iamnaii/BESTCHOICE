import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingExpireCron } from './booking-expire.cron';
// A5 (คำวินิจฉัยผู้สอบ 2026-08-25): ใบจองต้องลงบัญชีเงินมัดจำตอนรับเงิน
// ⇒ ต้องใช้ ShopBookingDepositTemplate + ShopAccountResolver จาก JournalModule
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingExpireCron],
  exports: [BookingsService],
})
export class BookingsModule {}
