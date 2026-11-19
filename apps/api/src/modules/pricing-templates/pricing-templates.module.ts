import { Module } from '@nestjs/common';
import { PricingTemplatesController } from './pricing-templates.controller';
import { PricingTemplatesService } from './pricing-templates.service';
import { PricingQuoteService } from './pricing-quote.service';

@Module({
  controllers: [PricingTemplatesController],
  providers: [PricingTemplatesService, PricingQuoteService],
  exports: [PricingTemplatesService, PricingQuoteService],
})
export class PricingTemplatesModule {}
