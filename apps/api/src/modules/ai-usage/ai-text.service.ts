import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProviderService, AiClient, AiCallerContext } from './ai-provider.service';

interface TextRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}

/** Text facade; callers own prompts and fallbacks, the provider owns transport/usage. */
@Injectable()
export class AiTextService {
  private readonly logger = new Logger(AiTextService.name);
  private readonly client: AiClient | null;

  constructor(
    config: ConfigService,
    private readonly provider: AiProviderService,
  ) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    this.client = this.provider.clientFor(apiKey, 'interactive');
    if (!this.client) this.logger.warn('ANTHROPIC_API_KEY not set — AI text assistance disabled');
  }

  get isAvailable(): boolean {
    return this.client !== null;
  }

  async generate(request: TextRequest, context: AiCallerContext): Promise<string | null> {
    if (!this.client) return null;

    const response = await this.provider.complete(this.client, request, context);
    const content = response.content[0];
    return content?.type === 'text' ? content.text : null;
  }
}
