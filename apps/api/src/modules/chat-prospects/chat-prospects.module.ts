import { Module } from '@nestjs/common';
import { ChatProspectService } from './chat-prospect.service';
import { CustomerMergeService } from './customer-merge.service';
import { SamePersonService } from './same-person.service';

/** ผู้สนใจจากแชท — ไม่ import โมดูลอื่น (PrismaModule/AuditModule เป็น @Global) จึงไม่มีวงจร */
@Module({
  providers: [ChatProspectService, CustomerMergeService, SamePersonService],
  exports: [ChatProspectService, CustomerMergeService, SamePersonService],
})
export class ChatProspectsModule {}
