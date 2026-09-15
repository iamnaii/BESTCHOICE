import { Module } from '@nestjs/common';
import { CustomerJourneyModule } from '../customer-journey/customer-journey.module';
import { ChatProspectService } from './chat-prospect.service';
import { CustomerMergeService } from './customer-merge.service';
import { SamePersonService } from './same-person.service';

/**
 * ผู้สนใจจากแชท — PrismaModule/AuditModule เป็น @Global
 * CustomerJourneyModule ให้ JourneyEntryWriter + JourneyStateService แก่ CustomerMergeService
 * (โมดูลนั้นห้าม import ChatProspectsModule หรือโมดูลที่ import ChatProspectsModule กลับมา — กันวงจร)
 */
@Module({
  imports: [CustomerJourneyModule],
  providers: [ChatProspectService, CustomerMergeService, SamePersonService],
  exports: [ChatProspectService, CustomerMergeService, SamePersonService],
})
export class ChatProspectsModule {}
