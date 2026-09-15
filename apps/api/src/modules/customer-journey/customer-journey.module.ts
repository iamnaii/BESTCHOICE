import { Module } from '@nestjs/common';
import { JourneyEntryWriter } from './journey-entry-writer.service';

/**
 * การเดินทางของลูกค้า — ไม่ import โมดูลอื่น (PrismaModule เป็น @Global)
 * ⇒ ChatProspectsModule (CustomerMergeService) และโมดูลที่มี hook import โมดูลนี้ได้โดยไม่เกิดวงจร
 * Task 3 เพิ่ม JourneyStateService (providers + exports) · Task 8 เพิ่ม CustomerJourneyService + controller · Task 9 เพิ่ม JourneySummaryService + CustomerJourneyCron
 */
@Module({
  providers: [JourneyEntryWriter],
  exports: [JourneyEntryWriter],
})
export class CustomerJourneyModule {}
