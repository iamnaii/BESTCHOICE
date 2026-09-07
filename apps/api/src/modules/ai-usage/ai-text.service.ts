import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic, { APIConnectionTimeoutError } from '@anthropic-ai/sdk';
import { AiUsageService, UsageRecord } from './ai-usage.service';

interface TextRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}

/** Shared transport for short text assistance; callers own prompts and fallbacks. */
@Injectable()
export class AiTextService {
  private readonly logger = new Logger(AiTextService.name);
  private readonly client: Anthropic | null;

  constructor(
    config: ConfigService,
    private readonly aiUsage: AiUsageService,
  ) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    // One attempt keeps interactive requests bounded and avoids hidden paid retries.
    this.client = apiKey ? new Anthropic({ apiKey, timeout: 30_000, maxRetries: 0 }) : null;
    if (!this.client) this.logger.warn('ANTHROPIC_API_KEY not set — AI text assistance disabled');
  }

  get isAvailable(): boolean {
    return this.client !== null;
  }

  async generate(
    request: TextRequest,
    context: Pick<UsageRecord, 'service' | 'method' | 'userId'>,
  ): Promise<string | null> {
    if (!this.client) return null;

    const usage: UsageRecord = {
      ...context,
      model: request.model,
      inputTokens: 0,
      outputTokens: 0,
      status: 'error',
    };

    try {
      const response = await this.client.messages.create(request);
      usage.status = 'success';
      usage.inputTokens = response.usage?.input_tokens ?? 0;
      usage.outputTokens = response.usage?.output_tokens ?? 0;
      const content = response.content[0];
      return content?.type === 'text' ? content.text : null;
    } catch (error) {
      usage.errorKind = error instanceof APIConnectionTimeoutError ? 'timeout' : 'provider_error';
      throw error;
    } finally {
      // Complete one usage write before returning, without masking the AI result/error.
      try {
        await this.aiUsage.record(usage);
      } catch {
        this.logger.error(`Failed to record AI text usage for ${context.service}`);
      }
    }
  }
}
