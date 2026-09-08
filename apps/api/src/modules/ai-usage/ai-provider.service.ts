import { Injectable, Logger } from '@nestjs/common';
import Anthropic, { APIConnectionTimeoutError, type ClientOptions } from '@anthropic-ai/sdk';
import { AiUsageService, UsageRecord } from './ai-usage.service';

export type AiCallerContext = Pick<UsageRecord, 'service' | 'method' | 'userId'>;
export type AiRequest = Anthropic.MessageCreateParamsNonStreaming;
export type AiClient = Pick<Anthropic, 'messages'>;
export type AiClientProfile = 'interactive' | 'document' | 'credit';

// Domain policies remain independent: credit keeps the SDK defaults, documents
// keep their existing 120-second timeout/retries, short staff assistance is bounded.
const CLIENT_OPTIONS = {
  interactive: { timeout: 30_000, maxRetries: 0 },
  document: { timeout: 120_000 },
  credit: {},
} satisfies Record<AiClientProfile, Partial<ClientOptions>>;

/** Shared provider transport for text, images and PDFs; no business decisions. */
@Injectable()
export class AiProviderService {
  private readonly logger = new Logger(AiProviderService.name);
  private readonly clients = new Map<AiClientProfile, { apiKey: string; client: AiClient }>();

  constructor(private readonly aiUsage: AiUsageService) {}

  /** Credentials come from server config; cache at most one current client per policy. */
  clientFor(apiKey: string | undefined | null, profile: AiClientProfile): AiClient | null {
    if (!apiKey) {
      this.clients.delete(profile);
      return null;
    }
    const cached = this.clients.get(profile);
    if (cached?.apiKey === apiKey) return cached.client;
    const client = new Anthropic({ apiKey, ...CLIENT_OPTIONS[profile] });
    this.clients.set(profile, { apiKey, client });
    return client;
  }

  countTokens(client: AiClient, request: Anthropic.MessageCountTokensParams) {
    return client.messages.countTokens(request);
  }

  async complete(
    client: AiClient,
    request: AiRequest,
    context: AiCallerContext,
  ): Promise<Anthropic.Message> {
    const usage: UsageRecord = {
      ...context,
      model: request.model,
      inputTokens: 0,
      outputTokens: 0,
      status: 'error',
    };
    try {
      const response = await client.messages.create(request);
      usage.status = 'success';
      usage.inputTokens = response.usage?.input_tokens ?? 0;
      usage.outputTokens = response.usage?.output_tokens ?? 0;
      return response;
    } catch (error) {
      usage.errorKind = error instanceof APIConnectionTimeoutError ? 'timeout' : 'provider_error';
      throw error;
    } finally {
      // Request content, document bytes and provider error bodies never enter usage logs.
      // Await on Cloud Run so its response CPU throttling cannot discard this write.
      try {
        await this.aiUsage.record(usage);
      } catch {
        this.logger.error(`Failed to record AI usage for ${context.service}`);
      }
    }
  }
}
