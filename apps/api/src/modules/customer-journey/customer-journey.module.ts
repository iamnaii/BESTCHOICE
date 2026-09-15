import { Module } from '@nestjs/common';
import { JourneyEntryWriter } from './journey-entry-writer.service';
import { JourneyStateService } from './journey-state.service';

/**
 * การเดินทางของลูกค้า — ไม่ import โมดูลอื่น (PrismaModule เป็น @Global)
 * ⇒ ChatProspectsModule (CustomerMergeService) และโมดูลที่มี hook import โมดูลนี้ได้โดยไม่เกิดวงจร
 * Task 8 เพิ่ม CustomerJourneyService + controller · Task 9 เพิ่ม JourneySummaryService + CustomerJourneyCron
 */
@Module({
  providers: [JourneyEntryWriter, JourneyStateService],
  exports: [JourneyEntryWriter, JourneyStateService],
})
export class CustomerJourneyModule {}
