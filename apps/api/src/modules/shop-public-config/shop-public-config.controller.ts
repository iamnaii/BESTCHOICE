import { Controller, Get } from '@nestjs/common';
import { ShopPublicConfigService } from './shop-public-config.service';

/**
 * Public config for the customer-facing shop (bestchoicephone.app).
 *
 * Intentionally unauthenticated — only returns values that are safe to expose
 * to anonymous browsers (GA4 measurement ID + FB Pixel ID). Sensitive credentials
 * are never routed through this controller.
 */
@Controller('shop/public-config')
export class ShopPublicConfigController {
  constructor(private service: ShopPublicConfigService) {}

  @Get('analytics')
  getAnalytics() {
    return this.service.getAnalyticsConfig();
  }
}
