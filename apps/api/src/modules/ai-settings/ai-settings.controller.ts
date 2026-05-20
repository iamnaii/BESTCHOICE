import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AiSettingsService } from './ai-settings.service';
import { SALES_BOT_SYSTEM_PROMPT } from '../sales-bot/prompts/sales-bot.system';
import { FINANCE_BOT_SYSTEM_PROMPT } from '../chatbot-finance/prompts/system-prompt';

type UpdateAiSettingsBody = {
  salesBotMode?: string;
  serviceBotMode?: string;
  salesBotConfidenceThreshold?: number;
  serviceBotConfidenceThreshold?: number;
};

@Controller('ai-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiSettingsController {
  constructor(private readonly svc: AiSettingsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  get() {
    return this.svc.get();
  }

  @Patch()
  @Roles('OWNER', 'FINANCE_MANAGER')
  update(@Body() body: UpdateAiSettingsBody, @Req() req: { user: { id: string } }) {
    return this.svc.update(body, req.user.id);
  }

  @Get('persona')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  getPersona() {
    return {
      salesBot: {
        name: 'บอทขาย (Sales Bot)',
        channels: ['LINE SHOP', 'Facebook', 'TikTok', 'Web'],
        source: 'apps/api/src/modules/staff-chat/prompts/sales-persona.ts',
        editable: false,
        prompt: SALES_BOT_SYSTEM_PROMPT,
      },
      serviceBot: {
        name: 'น้องเบส (Service Bot)',
        channels: ['LINE FINANCE'],
        source: 'apps/api/src/modules/chatbot-finance/prompts/system-prompt.ts',
        editable: false,
        prompt: FINANCE_BOT_SYSTEM_PROMPT,
      },
    };
  }
}
