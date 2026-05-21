import { Injectable, Logger, Inject, Optional, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatChannel, MessageRole, MessageType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiSuggestService } from './ai-suggest.service';
import { SalesBotService, SalesBotResult } from '../../sales-bot/sales-bot.service';
import { LlmProviderRegistry } from '../../sales-bot/providers/llm-provider.registry';
import { MessageRouterService } from '../../chat-engine/services/message-router.service';
import { PersonaService } from './persona.service';
import {
  LLM_PROVIDERS,
  type AiAutoSettings,
  type LlmProviderChoice,
  type UpdateAiSettingsDto,
} from '../dto/ai-settings.dto';

@Injectable()
export class AiAutoReplyService {
  private readonly logger = new Logger(AiAutoReplyService.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private aiSuggest: AiSuggestService,
    private salesBot: SalesBotService,
    private llmRegistry: LlmProviderRegistry,
    private personaService: PersonaService,
    @Optional()
    @Inject(forwardRef(() => MessageRouterService))
    private messageRouter?: MessageRouterService,
  ) {}

  async shouldAutoReply(session: any): Promise<boolean> {
    // Blocker fixes: respect take-over + handoff signals
    if (session.aiPaused) {
      this.logger.log(`[ShouldAutoReply] room=${session.id} skip=aiPaused`);
      return false;
    }
    if (session.handoffMode) {
      this.logger.log(`[ShouldAutoReply] room=${session.id} skip=handoffMode`);
      return false;
    }

    // Defense-in-depth: skip channels whose adapter is stub (TikTok)
    // Even if aiAutoChannels misconfigured to include TIKTOK, prevent wasted Claude tokens.
    const STUB_CHANNELS = new Set(['TIKTOK']);
    if (STUB_CHANNELS.has(session.channel)) {
      this.logger.log(`[ShouldAutoReply] room=${session.id} skip=stubChannel channel=${session.channel}`);
      return false;
    }

    const settings = await this.getSettings();

    if (!settings.aiAutoEnabled) {
      this.logger.log(`[ShouldAutoReply] room=${session.id} skip=aiAutoEnabled=false`);
      return false;
    }

    // Check channel allowlist
    if (settings.aiAutoChannels.length > 0 && !settings.aiAutoChannels.includes(session.channel)) {
      this.logger.log(
        `[ShouldAutoReply] room=${session.id} skip=channelNotInAllowlist channel=${session.channel} allowlist=${JSON.stringify(settings.aiAutoChannels)}`,
      );
      return false;
    }

    // Check per-room reply cap
    const sentCount = await this.prisma.aiAutoReplyLog.count({
      where: { roomId: session.id, autoSent: true },
    });
    if (sentCount >= settings.aiAutoMaxRepliesPerSession) {
      this.logger.log(
        `[ShouldAutoReply] room=${session.id} skip=capHit sentCount=${sentCount} cap=${settings.aiAutoMaxRepliesPerSession}`,
      );
      return false;
    }

    // Fail-loud guard: SHOP channels require central branch + promptpay configured
    const SHOP_CHANNELS = new Set(['LINE_SHOP', 'FACEBOOK', 'WEB']);
    if (SHOP_CHANNELS.has(session.channel)) {
      const cfg = await this.prisma.systemConfig.findMany({
        where: { key: 'shop_bot_central_branch_id', deletedAt: null },
      });
      if (cfg.length === 0 || !cfg[0].value) {
        this.logger.warn(
          `shop_bot_central_branch_id not configured — AI auto-reply disabled for ${session.channel}`,
        );
        return false;
      }
    }

    this.logger.log(`[ShouldAutoReply] room=${session.id} pass channel=${session.channel}`);
    return true;
  }

  async autoReply(
    roomId: string,
    customerMessage: string,
  ): Promise<({ reply: string; confidence: number } & Partial<SalesBotResult>) | null> {
    const settings = await this.getSettings();
    // Convert scale 0-100 → 0-1 for comparison with SalesBot confidence
    const threshold = settings.aiAutoConfidenceThreshold / 100;

    // Fetch room context (customerId) + last 5 prior messages (duplicate of loadPrior pattern)
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { customerId: true },
    });

    const priorRows = await this.prisma.chatMessage.findMany({
      where: { roomId, deletedAt: null, text: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { role: true, text: true },
    });
    const priorMessages = priorRows.reverse().map((r) => ({
      role: (r.role === MessageRole.BOT || r.role === MessageRole.STAFF
        ? 'assistant'
        : 'user') as 'assistant' | 'user',
      content: r.text ?? '',
    }));

    const result = await this.salesBot.generateReply({
      text: customerMessage,
      roomId,
      customerId: room?.customerId ?? null,
      priorMessages,
    });

    if (result.confidence < threshold) return null;

    return {
      reply: result.reply,
      confidence: result.confidence,
      toolsUsed: result.toolsUsed,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  }

  async logAutoReply(params: {
    roomId: string;
    customerMessage: string;
    aiReply: string;
    confidence: number;
    autoSent: boolean;
    handoffReason?: string;
    intent?: string;
    toolsUsed?: string[];
    inputTokens?: number;
    outputTokens?: number;
  }): Promise<void> {
    await this.prisma.aiAutoReplyLog.create({
      data: {
        roomId: params.roomId,
        customerMessage: params.customerMessage,
        aiReply: params.aiReply,
        confidence: params.confidence,
        autoSent: params.autoSent,
        handoffReason: params.handoffReason,
        intent: params.intent,
        toolsUsed: params.toolsUsed ?? [],
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
      },
    });
  }

  async getSettings(): Promise<AiAutoSettings> {
    const keys = [
      'ai.autoEnabled',
      'ai.autoChannels',
      'ai.autoConfidenceThreshold',
      'ai.autoMaxRepliesPerSession',
      'shop_bot_central_branch_id',
      'shop_bot_promptpay_id',
      'shop_bot_test_user_id',
      'shop_bot_llm_provider',
    ];

    const configs = await this.prisma.systemConfig.findMany({
      where: { key: { in: keys }, deletedAt: null },
    });

    const configMap = new Map(configs.map((c) => [c.key, c.value]));

    const rawProvider = (configMap.get('shop_bot_llm_provider') ?? '').trim().toLowerCase();
    const llmProvider: LlmProviderChoice = (LLM_PROVIDERS as readonly string[]).includes(
      rawProvider,
    )
      ? (rawProvider as LlmProviderChoice)
      : 'claude';

    return {
      aiAutoEnabled: configMap.has('ai.autoEnabled')
        ? configMap.get('ai.autoEnabled') === 'true'
        : this.config.get<string>('AI_AUTO_ENABLED') === 'true',
      aiAutoChannels: configMap.has('ai.autoChannels')
        ? JSON.parse(configMap.get('ai.autoChannels')!)
        : (this.config.get<string>('AI_AUTO_CHANNELS') ?? '').split(',').filter(Boolean),
      aiAutoConfidenceThreshold: configMap.has('ai.autoConfidenceThreshold')
        ? Number(configMap.get('ai.autoConfidenceThreshold'))
        : Number(this.config.get<string>('AI_AUTO_CONFIDENCE_THRESHOLD') ?? '80'),
      aiAutoMaxRepliesPerSession: configMap.has('ai.autoMaxRepliesPerSession')
        ? Number(configMap.get('ai.autoMaxRepliesPerSession'))
        : Number(this.config.get<string>('AI_AUTO_MAX_REPLIES') ?? '50'),
      shopBotCentralBranchId: configMap.get('shop_bot_central_branch_id') ?? null,
      shopBotPromptpayId: configMap.get('shop_bot_promptpay_id') ?? null,
      shopBotTestUserId: configMap.get('shop_bot_test_user_id') ?? null,
      llmProvider,
    };
  }

  async updateSettings(dto: UpdateAiSettingsDto): Promise<AiAutoSettings> {
    const entries: { key: string; value: string; label: string }[] = [];

    // `!= null` covers both `undefined` (key absent from PATCH body) AND `null`
    // (key explicitly cleared by client). SystemConfig.value is non-nullable,
    // so passing null straight through to upsert crashes with
    // `PrismaClientValidationError: Argument value must not be null` and the
    // whole PATCH returns 500 — observed in prod 2026-05-21 when the
    // ShopBotSetupForm save mutation sent `shopBotPromptpayId: null` for an
    // empty input. Skipping the entry preserves the previously-saved value;
    // explicit clearing of a value isn't a flow we expose today.
    if (dto.aiAutoEnabled != null) {
      entries.push({
        key: 'ai.autoEnabled',
        value: String(dto.aiAutoEnabled),
        label: 'AI Auto Mode เปิด/ปิด',
      });
    }
    if (dto.aiAutoChannels != null) {
      entries.push({
        key: 'ai.autoChannels',
        value: JSON.stringify(dto.aiAutoChannels),
        label: 'AI Auto Channels',
      });
    }
    if (dto.aiAutoConfidenceThreshold != null) {
      entries.push({
        key: 'ai.autoConfidenceThreshold',
        value: String(dto.aiAutoConfidenceThreshold),
        label: 'AI Confidence Threshold',
      });
    }
    if (dto.aiAutoMaxRepliesPerSession != null) {
      entries.push({
        key: 'ai.autoMaxRepliesPerSession',
        value: String(dto.aiAutoMaxRepliesPerSession),
        label: 'AI Max Replies per Session',
      });
    }
    if (dto.shopBotCentralBranchId != null) {
      entries.push({
        key: 'shop_bot_central_branch_id',
        value: dto.shopBotCentralBranchId,
        label: 'SHOP Bot central branch ID',
      });
    }
    if (dto.shopBotPromptpayId != null) {
      entries.push({
        key: 'shop_bot_promptpay_id',
        value: dto.shopBotPromptpayId,
        label: 'SHOP Bot PromptPay ID',
      });
    }
    if (dto.shopBotTestUserId != null) {
      entries.push({
        key: 'shop_bot_test_user_id',
        value: dto.shopBotTestUserId,
        label: 'SHOP Bot test LINE userId',
      });
    }
    if (dto.llmProvider != null) {
      entries.push({
        key: 'shop_bot_llm_provider',
        value: dto.llmProvider,
        label: 'SHOP Bot LLM provider (claude | gemini)',
      });
    }

    // Persona fields use the empty-string-as-revert sentinel: `''` means
    // "soft-delete the row so PersonaService falls back to the hardcoded
    // default". Non-empty = upsert as override. `null`/`undefined` continues
    // to skip the field entirely (per PR #1059 null-skip pattern).
    const personaKeysToRevert: string[] = [];
    let personaTouched = false;
    if (dto.shopBotPersonaBase !== undefined && dto.shopBotPersonaBase !== null) {
      personaTouched = true;
      if (dto.shopBotPersonaBase === '') {
        personaKeysToRevert.push('shop_bot_persona_base');
      } else {
        entries.push({
          key: 'shop_bot_persona_base',
          value: dto.shopBotPersonaBase,
          label: 'SHOP Sales Persona — BASE (identity + tone)',
        });
      }
    }
    if (
      dto.shopBotPersonaBotExtras !== undefined &&
      dto.shopBotPersonaBotExtras !== null
    ) {
      personaTouched = true;
      if (dto.shopBotPersonaBotExtras === '') {
        personaKeysToRevert.push('shop_bot_persona_bot_extras');
      } else {
        entries.push({
          key: 'shop_bot_persona_bot_extras',
          value: dto.shopBotPersonaBotExtras,
          label: 'SHOP Sales Persona — BOT_EXTRAS (tool playbook)',
        });
      }
    }

    for (const entry of entries) {
      await this.prisma.systemConfig.upsert({
        where: { key: entry.key },
        create: { key: entry.key, value: entry.value, label: entry.label },
        update: { value: entry.value, deletedAt: null },
      });
    }

    // Soft-delete persona rows the owner asked to revert. Uses updateMany so
    // a missing row is a no-op instead of a 404 — matches the "revert is
    // idempotent" intent. PersonaService.getX() will then fall back to the
    // hardcoded const on next read.
    if (personaKeysToRevert.length > 0) {
      await this.prisma.systemConfig.updateMany({
        where: { key: { in: personaKeysToRevert }, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }

    // If the LLM provider was flipped, drop the in-memory registry cache so
    // the next customer message routes to the new provider immediately instead
    // of after the 60-second TTL. Cheap (single field assignment) and
    // idempotent, so it's safe to call unconditionally when llmProvider is in
    // the patch — even if the value didn't actually change. Skip on null so
    // we don't churn the cache for clients that send the field cleared.
    if (dto.llmProvider != null) {
      this.llmRegistry.invalidateCache();
    }

    // If either persona layer was edited or reverted, drop the persona cache so
    // the next AI reply uses the new prompt instead of waiting for the 60-second
    // TTL. Same idempotent / cheap call pattern as the registry cache.
    if (personaTouched) {
      this.personaService.invalidateCache();
    }

    return this.getSettings();
  }

  /**
   * Send a fixed test message to the configured `shop_bot_test_user_id` via the
   * LINE Shop adapter. Used by the SHOP Bot Setup "🧪 ส่งข้อความทดสอบ" button so
   * the owner can verify LINE Shop OA + adapter wiring before flipping
   * `ai.autoEnabled=true`.
   *
   * Phase A: LINE Shop only. Returns structured `{ success, error? }` instead
   * of throwing so the controller can pass the failure straight to a toast.
   */
  async testSend(): Promise<{ success: boolean; error?: string }> {
    const settings = await this.getSettings();
    const testUserId = settings.shopBotTestUserId;

    if (!testUserId) {
      return {
        success: false,
        error:
          'shop_bot_test_user_id ยังไม่ตั้งค่า — กรุณากรอกใน SHOP Bot Setup ก่อน',
      };
    }

    if (!this.messageRouter) {
      return {
        success: false,
        error: 'MessageRouterService ไม่พร้อมใช้งาน',
      };
    }

    const adapter = this.messageRouter.getAdapter(ChatChannel.LINE_SHOP);
    if (!adapter) {
      return { success: false, error: 'LINE Shop adapter not registered' };
    }

    const result = await adapter.sendMessage({
      externalUserId: testUserId,
      channel: ChatChannel.LINE_SHOP,
      type: MessageType.TEXT,
      text: '🧪 SHOP Bot test — ถ้าได้ข้อความนี้แสดงว่า LINE Shop OA + adapter wiring ทำงานปกติ ✅',
    });

    if (!result.success) {
      return { success: false, error: result.error ?? 'adapter sendMessage failed' };
    }
    return { success: true };
  }
}
