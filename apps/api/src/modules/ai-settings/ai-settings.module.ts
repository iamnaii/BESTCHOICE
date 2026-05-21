import { Module, forwardRef } from '@nestjs/common';
import { AiSettingsService } from './ai-settings.service';
import { AiSettingsController } from './ai-settings.controller';
import { StaffChatModule } from '../staff-chat/staff-chat.module';

@Module({
  imports: [
    // for PersonaService (read effective persona for the viewer endpoint)
    forwardRef(() => StaffChatModule),
  ],
  controllers: [AiSettingsController],
  providers: [AiSettingsService],
  exports: [AiSettingsService],
})
export class AiSettingsModule {}
