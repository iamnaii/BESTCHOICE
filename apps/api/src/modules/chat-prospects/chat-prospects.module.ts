import { Module } from '@nestjs/common';
import { ChatProspectService } from './chat-prospect.service';

/** ผู้สนใจจากแชท — ไม่ import โมดูลอื่น (PrismaModule/AuditModule เป็น @Global) จึงไม่มีวงจร */
@Module({
  providers: [ChatProspectService],
  exports: [ChatProspectService],
})
export class ChatProspectsModule {}
