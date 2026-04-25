import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { IntegrationConfigService } from '../integrations/integration-config.service';

interface TokenCache {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

@Injectable()
export class YeastarTokenService implements OnModuleDestroy {
  private readonly logger = new Logger(YeastarTokenService.name);
  private cache: TokenCache | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(private readonly configService: IntegrationConfigService) {}

  onModuleDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  /** Return a valid access token, refreshing automatically if needed. */
  async getToken(): Promise<string> {
    const config = await this.configService.getConfig('yeastar');
    if (!config.pbxUrl || !config.clientId || !config.clientSecret) {
      throw new Error('Yeastar ยังไม่ได้ตั้งค่า — กรุณาตั้งค่า PBX URL, Client ID, Client Secret');
    }

    // Refresh if cache is empty or expires in < 2 minutes
    if (!this.cache || this.cache.expiresAt - Date.now() < 2 * 60 * 1000) {
      if (this.cache?.refreshToken) {
        await this.refreshAccessToken(config.pbxUrl, this.cache.refreshToken);
      } else {
        await this.fetchNewToken(config.pbxUrl, config.clientId, config.clientSecret);
      }
    }

    return this.cache!.accessToken;
  }

  /** Revoke current token (called on reconfigure). */
  clearCache() {
    this.cache = null;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async fetchNewToken(pbxUrl: string, clientId: string, clientSecret: string) {
    const url = `${pbxUrl}/openapi/v1.0/get_token`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'BESTCHOICE/1.0',
      },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    });

    if (!res.ok) {
      const text = await res.text();
      Sentry.captureMessage(`[Yeastar] get_token failed: ${res.status} ${text}`, 'error');
      throw new Error(`Yeastar authentication failed: ${res.status}`);
    }

    const data = await res.json();
    this.setCache(data);
    this.logger.log('[Yeastar] Token acquired');
  }

  private async refreshAccessToken(pbxUrl: string, refreshToken: string) {
    try {
      const url = `${pbxUrl}/openapi/v1.0/refresh_token`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'BESTCHOICE/1.0',
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
      const data = await res.json();
      this.setCache(data);
      this.logger.log('[Yeastar] Token refreshed');
    } catch (err) {
      this.logger.warn('[Yeastar] Token refresh failed, clearing cache');
      this.cache = null;
      Sentry.captureException(err);
      throw err;
    }
  }

  private setCache(data: { access_token: string; refresh_token: string; expires_in: number }) {
    this.cache = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }
}
