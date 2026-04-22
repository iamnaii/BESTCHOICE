import { Injectable } from '@nestjs/common';
import { IntegrationConfigService } from '../integrations/integration-config.service';

export interface PublicAnalyticsConfig {
  ga4MeasurementId: string | null;
  fbPixelId: string | null;
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
}
