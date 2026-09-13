import { Module } from '@nestjs/common';
import { ChatProspectService } from './chat-prospect.service';
import { CustomerMergeService } from './customer-merge.service';

/** ผู้สนใจจากแชท — ไม่ import โมดูลอื่น (PrismaModule/AuditModule เป็น @Global) จึงไม่มีวงจร */
@Module({
  providers: [ChatProspectService, CustomerMergeService],
  exports: [ChatProspectService, CustomerMergeService],
})
export class ChatProspectsModule {}
