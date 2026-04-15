import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiSuggestService } from './ai-suggest.service';
import type { AiAutoSettings, UpdateAiSettingsDto } from '../dto/ai-settings.dto';

@Injectable()
export class AiAutoReplyService {
  private readonly logger = new Logger(AiAutoReplyService.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private aiSuggest: AiSuggestService,
  ) {}

  async shouldAutoReply(session: any): Promise<boolean> {
    // Check env flag
    const enabled = this.config.get<string>('AI_AUTO_ENABLED');
    if (enabled !== 'true') return false;

    // Check channel allowlist
    const channelsRaw = this.config.get<string>('AI_AUTO_CHANNELS') ?? '';
    const channels = channelsRaw
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    if (channels.length > 0 && !channels.includes(session.channel)) return false;

    // Check per-session reply cap
    const maxReplies = parseInt(this.config.get<string>('AI_AUTO_MAX_REPLIES') ?? '5', 10);
    const sentCount = await this.prisma.aiAutoReplyLog.count({
      where: { sessionId: session.id, autoSent: true },
    });
    if (sentCount >= maxReplies) return false;

    return true;
  }

  async autoReply(
    sessionId: string,
    customerMessage: string,
  ): Promise<{ reply: string; confidence: number } | null> {
    const thresholdRaw = parseInt(
      this.config.get<string>('AI_AUTO_CONFIDENCE_THRESHOLD') ?? '80',
      10,
    );
    // Convert scale 0-100 → 0-1 for comparison with suggestion confidence
    const threshold = thresholdRaw / 100;

    const result = await this.aiSuggest.suggest(sessionId);
    if (!result.suggestions.length) return null;

    const top = result.suggestions[0];
    if (top.confidence < threshold) return null;

    return { reply: top.text, confidence: top.confidence };
  }

  async logAutoReply(params: {
    sessionId: string;
    customerMessage: string;
    aiReply: string;
    confidence: number;
    autoSent: boolean;
    handoffReason?: string;
  }): Promise<void> {
    await this.prisma.aiAutoReplyLog.create({
      data: {
        sessionId: params.sessionId,
        customerMessage: params.customerMessage,
        aiReply: params.aiReply,
        confidence: params.confidence,
        autoSent: params.autoSent,
        handoffReason: params.handoffReason,
      },
    });
  }

  getSettings(): AiAutoSettings {
    const channelsRaw = this.config.get<string>('AI_AUTO_CHANNELS') ?? '';
    const channels = channelsRaw
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    return {
      aiAutoEnabled: this.config.get<string>('AI_AUTO_ENABLED') === 'true',
      aiAutoChannels: channels,
      aiAutoConfidenceThreshold: parseInt(
        this.config.get<string>('AI_AUTO_CONFIDENCE_THRESHOLD') ?? '80',
        10,
      ),
      aiAutoMaxRepliesPerSession: parseInt(
        this.config.get<string>('AI_AUTO_MAX_REPLIES') ?? '5',
        10,
      ),
    };
  }

  updateSettings(dto: UpdateAiSettingsDto): AiAutoSettings {
    this.logger.log('updateSettings called (persistence not yet implemented)', dto);
    // Actual DB persistence will be added when settings model is available
    return this.getSettings();
  }
}
