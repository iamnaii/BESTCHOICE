import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ConfigService } from '@nestjs/config';
import { IntegrationConfigService } from '../../integrations/integration-config.service';
import type { LineChannelKey } from '../../notifications/dto/create-notification.dto';
import { LineMessagePayload } from '../dto/webhook-event.dto';
import { FlexMessagePayload } from '../flex-messages/base-template';

@Injectable()
export class LineApiClientService {
  private readonly logger = new Logger(LineApiClientService.name);
  private readonly lineApiBaseUrl = 'https://api.line.me/v2/bot';
  private readonly lineDataApiBaseUrl = 'https://api-data.line.me/v2/bot';

  constructor(
    private configService: ConfigService,
    private integrationConfig: IntegrationConfigService,
  ) {}

  /**
   * LineOaService routes through three OAs (line-shop, line-finance,
   * line-staff). FINANCE also has a dedicated client at
   * chatbot-finance/services/line-finance-client.service.ts which reads the
   * `line-finance` integration independently for chatbot reply flows.
   *
   * Phase 7 (2026-04-30): the previous BC default of `'line-shop'` was
   * removed from every public sender method. Every caller MUST pass
   * channelKey explicitly so we never silently send a finance message via
   * the SHOP OA again. TypeScript enforces this at compile time.
   */
  async getChannelToken(channelKey: LineChannelKey): Promise<string> {
    return (await this.integrationConfig.getValue(channelKey, 'channelToken')) || '';
  }

  async testConnection(
    channelKey: LineChannelKey,
  ): Promise<{ displayName: string; userId: string; pictureUrl?: string }> {
    const token = await this.getChannelToken(channelKey);
    if (!token) {
      throw new BadRequestException('LINE Channel Access Token ยังไม่ได้ตั้งค่า');
    }

    const response = await fetch(`${this.lineApiBaseUrl}/info`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(`LINE API error ${response.status}: ${errorBody}`);
    }

    return response.json();
  }

  // ─── LINE API Methods ─────────────────────────────────

  /**
   * Send push message(s) to a user
   */
  async pushMessage(
    to: string,
    messages: LineMessagePayload[],
    channelKey: LineChannelKey,
  ): Promise<void> {
    await this.callLineApi(
      `${this.lineApiBaseUrl}/message/push`,
      {
        to,
        messages,
      },
      channelKey,
    );
    this.logger.log(`[LINE:${channelKey}] Push message sent to ${to}`);
  }

  /**
   * Reply to a message using reply token
   */
  async replyMessage(
    replyToken: string,
    messages: LineMessagePayload[],
    channelKey: LineChannelKey,
  ): Promise<void> {
    await this.callLineApi(
      `${this.lineApiBaseUrl}/message/reply`,
      {
        replyToken,
        messages,
      },
      channelKey,
    );
    this.logger.log(`[LINE:${channelKey}] Reply message sent`);
  }

  /**
   * Send a Flex Message via push
   */
  async sendFlexMessage(
    to: string,
    flexMessage: FlexMessagePayload,
    channelKey: LineChannelKey,
  ): Promise<void> {
    await this.pushMessage(to, [flexMessage as unknown as LineMessagePayload], channelKey);
  }

  /**
   * Download content (image, video, etc.) from LINE
   */
  async downloadContent(
    messageId: string,
    channelKey: LineChannelKey,
  ): Promise<Buffer> {
    const token = await this.getChannelToken(channelKey);
    if (!token) {
      throw new BadRequestException('LINE channel access token not configured');
    }

    const url = `${this.lineDataApiBaseUrl}/message/${messageId}/content`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(`Failed to download LINE content: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Get user profile
   */
  async getUserProfile(
    userId: string,
    channelKey: LineChannelKey,
  ): Promise<{ displayName: string; pictureUrl?: string; statusMessage?: string }> {
    const token = await this.getChannelToken(channelKey);
    if (!token) {
      throw new BadRequestException('LINE channel access token not configured');
    }

    const url = `${this.lineApiBaseUrl}/profile/${userId}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(`Failed to get LINE profile: ${response.status}`);
    }

    return response.json();
  }

  // ─── Private Helpers ──────────────────────────────────

  async callLineApi(
    url: string,
    body: unknown,
    channelKey: LineChannelKey,
  ): Promise<void> {
    const token = await this.getChannelToken(channelKey);
    if (!token) {
      throw new BadRequestException(`LINE ${channelKey} channelToken not configured`);
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        // (Audit finding W6) LINE returns 429 Too Many Requests with a
        // Retry-After header (seconds) when the per-recipient burst limit
        // is hit. Surface that to callers so the campaign batch loop can
        // sleep the requested interval instead of slamming the next
        // batch one second later — without this, every retry inside the
        // throttled window also fails.
        if (response.status === 429) {
          const retryAfterRaw = response.headers.get('retry-after');
          const retryAfter = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : 0;
          throw new InternalServerErrorException(
            `LINE API 429 rate limit; retry after ${retryAfter || 60}s`,
          );
        }
        const errorBody = await response.text();
        throw new InternalServerErrorException(`LINE API error ${response.status}: ${errorBody}`);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        this.logger.error(`[LINE:${channelKey}] API timeout after 10s: ${url}`);
        Sentry.captureException(err, {
          tags: { module: 'line-oa', channelKey, action: 'line_api', reason: 'timeout' },
          extra: { url },
        });
        throw new InternalServerErrorException('LINE API timeout');
      }
      throw err;
    }
  }
}
