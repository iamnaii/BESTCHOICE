import { Module, forwardRef } from '@nestjs/common';
import { ChatAiDraftService } from './chat-ai-draft.service';
import { ChatAiDraftController } from './chat-ai-draft.controller';
import { StaffChatModule } from '../staff-chat/staff-chat.module';

@Module({
  // CHAT_GATEWAY_TOKEN — takeOver/releaseToAi emit chat:room:update ให้ inbox refresh
  imports: [forwardRef(() => StaffChatModule)],
  controllers: [ChatAiDraftController],
  providers: [ChatAiDraftService],
  exports: [ChatAiDraftService],
})
export class ChatAiDraftModule {}
