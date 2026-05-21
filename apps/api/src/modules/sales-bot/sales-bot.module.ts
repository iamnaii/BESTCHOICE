import { Module, forwardRef } from '@nestjs/common';
import { SalesBotService } from './sales-bot.service';
import { SearchProductsTool } from './tools/search-products.tool';
import { CalculateInstallmentTool } from './tools/calculate-installment.tool';
import { ListPromotionsTool } from './tools/list-promotions.tool';
import { HandoffToHumanTool } from './tools/handoff-to-human.tool';
import { CaptureLeadTool } from './tools/capture-lead.tool';
import { StaffChatModule } from '../staff-chat/staff-chat.module';
import { ClaudeProvider } from './providers/claude.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { LlmProviderRegistry } from './providers/llm-provider.registry';

@Module({
  imports: [
    // For CHAT_GATEWAY_TOKEN — HandoffToHumanTool + CaptureLeadTool emit
    // chat:room:update so UnifiedInboxPage refreshes the handoff badge live.
    forwardRef(() => StaffChatModule),
  ],
  providers: [
    SalesBotService,
    SearchProductsTool,
    CalculateInstallmentTool,
    ListPromotionsTool,
    HandoffToHumanTool,
    CaptureLeadTool,
    ClaudeProvider,
    GeminiProvider,
    LlmProviderRegistry,
  ],
  exports: [SalesBotService, ClaudeProvider, GeminiProvider, LlmProviderRegistry],
})
export class SalesBotModule {}
