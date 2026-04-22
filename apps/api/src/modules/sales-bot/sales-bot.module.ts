import { Module } from '@nestjs/common';
import { SalesBotService } from './sales-bot.service';
import { SearchProductsTool } from './tools/search-products.tool';
import { CalculateInstallmentTool } from './tools/calculate-installment.tool';
import { ListPromotionsTool } from './tools/list-promotions.tool';
import { HandoffToHumanTool } from './tools/handoff-to-human.tool';

@Module({
  providers: [
    SalesBotService,
    SearchProductsTool,
    CalculateInstallmentTool,
    ListPromotionsTool,
    HandoffToHumanTool,
  ],
  exports: [SalesBotService],
})
export class SalesBotModule {}
