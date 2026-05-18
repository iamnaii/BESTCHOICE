import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingExpireCron } from './booking-expire.cron';

@Module({
  controllers: [BookingsController],
  providers: [BookingsService, BookingExpireCron],
  exports: [BookingsService],
})
export class BookingsModule {}
