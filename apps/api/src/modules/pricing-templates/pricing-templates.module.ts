import { Module } from '@nestjs/common';
import { PricingTemplatesController } from './pricing-templates.controller';
import { PricingTemplatesService } from './pricing-templates.service';

@Module({
  controllers: [PricingTemplatesController],
  providers: [PricingTemplatesService],
  exports: [PricingTemplatesService],
})
export class PricingTemplatesModule {}
