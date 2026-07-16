import { Injectable } from '@nestjs/common';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { shopLineRedirectUri } from '../../utils/shop-base-url.util';

export interface PublicAnalyticsConfig {
  ga4MeasurementId: string | null;
  fbPixelId: string | null;
}

export interface PublicAuthConfig {
  lineLoginEnabled: boolean;
  /** LINE Login channel id — public by OAuth design (appears in the authorize URL). */
  lineLoginChannelId: string | null;
  /**
   * Redirect URI the SERVER will use for the token exchange
   * (shop-auth-social.controller). The frontend must send the exact same
   * value in the authorize request or LINE rejects the exchange.
   */
  lineLoginRedirectUri: string | null;
}

@Injectable()
export class ShopPublicConfigService {
  constructor(private integrations: IntegrationConfigService) {}

  async getAnalyticsConfig(): Promise<PublicAnalyticsConfig> {
    const [ga4, fb] = await Promise.all([
      this.integrations.getValue('ga4', 'measurementId'),
      this.integrations.getValue('facebook-pixel', 'pixelId'),
    ]);
    return {
      ga4MeasurementId: ga4 ? ga4.trim() || null : null,
      fbPixelId: fb ? fb.trim() || null : null,
    };
  }

  getAuthConfig(): PublicAuthConfig {
    const channelId = process.env.LINE_LOGIN_CHANNEL_ID?.trim() || null;
    const redirectUri = shopLineRedirectUri();
    const enabled = Boolean(channelId && process.env.LINE_LOGIN_CHANNEL_SECRET && redirectUri);
    return {
      lineLoginEnabled: enabled,
      lineLoginChannelId: enabled ? channelId : null,
      lineLoginRedirectUri: enabled ? redirectUri : null,
    };
  }
}
