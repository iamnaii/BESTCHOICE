import { Module } from '@nestjs/common';
import { CustomerJourneyController } from './customer-journey.controller';
import { CustomerJourneyCron } from './customer-journey.cron';
import { CustomerJourneyService } from './customer-journey.service';
import { JourneyEntryWriter } from './journey-entry-writer.service';
import { JourneyStateService } from './journey-state.service';
import { JourneySummaryService } from './journey-summary.service';

/**
 * การเดินทางของลูกค้า — ไม่ import โมดูลอื่น (PrismaModule เป็น @Global · ScheduleModule.forRoot อยู่ใน app.module)
 * ⇒ ChatProspectsModule (CustomerMergeService) และโมดูลที่มี hook import โมดูลนี้ได้โดยไม่เกิดวงจร
 */
@Module({
  controllers: [CustomerJourneyController],
  providers: [JourneyEntryWriter, JourneyStateService, JourneySummaryService, CustomerJourneyService, CustomerJourneyCron],
  exports: [JourneyEntryWriter, JourneyStateService],
})
export class CustomerJourneyModule {}
