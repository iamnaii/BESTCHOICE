import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ShopPublicConfigController } from './shop-public-config.controller';
import { ShopPublicConfigService } from './shop-public-config.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [ShopPublicConfigController],
  providers: [ShopPublicConfigService],
  exports: [ShopPublicConfigService],
})
export class ShopPublicConfigModule {}
