import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AiSettingsService } from './ai-settings.service';
import { PersonaService } from '../staff-chat/services/persona.service';
import {
  REQUIRED_TOOL_NAMES,
  SHOP_SALES_PERSONA_BASE,
  SHOP_SALES_PERSONA_BOT_EXTRAS,
} from '../staff-chat/prompts/sales-persona';
import { FINANCE_BOT_SYSTEM_PROMPT } from '../chatbot-finance/prompts/system-prompt';

// FULL was deprecated 2026-05-20 — auto-send now controlled via ai.autoEnabled SystemConfig.
class UpdateAiSettingsBody {
  @IsOptional()
  @IsIn(['OFF', 'HYBRID'], { message: 'salesBotMode ต้องเป็น OFF หรือ HYBRID' })
  salesBotMode?: string;

  @IsOptional()
  @IsIn(['OFF', 'HYBRID'], { message: 'serviceBotMode ต้องเป็น OFF หรือ HYBRID' })
  serviceBotMode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  salesBotConfidenceThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  serviceBotConfidenceThreshold?: number;
}

@Controller('ai-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiSettingsController {
  constructor(
    private readonly svc: AiSettingsService,
    private readonly persona: PersonaService,
  ) {}

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
  async getPersona() {
    const [base, extras, bot, customized] = await Promise.all([
      this.persona.getBase(),
      this.persona.getBotExtras(),
      this.persona.getBot(),
      this.persona.isCustomized(),
    ]);
    return {
      salesBot: {
        name: 'บอทขาย (Sales Bot)',
        channels: ['LINE SHOP', 'Facebook', 'TikTok', 'Web'],
        source: 'apps/api/src/modules/staff-chat/prompts/sales-persona.ts',
        editable: true,
        // Composed system prompt actually sent to the LLM, with both layers
        // resolved (owner overrides if any, else hardcoded defaults).
        prompt: bot,
        // Per-layer breakdown — the editor needs each piece separately to
        // render two textareas + "(แก้ไขแล้ว)" / "(ค่าเริ่มต้น)" badges +
        // "คืนค่าเริ่มต้น" buttons.
        base,
        extras,
        // Hardcoded defaults — used by the editor's "preview default" and the
        // confirmation dialog before reverting an override.
        defaultBase: SHOP_SALES_PERSONA_BASE,
        defaultExtras: SHOP_SALES_PERSONA_BOT_EXTRAS,
        isCustomized: customized,
        // Tool names the EXTRAS layer must keep referencing for the bot to
        // function. Frontend warns the owner if a saved override drops any.
        requiredToolNames: REQUIRED_TOOL_NAMES,
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
