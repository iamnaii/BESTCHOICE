import { Module } from '@nestjs/common';
import { GlobalCreditCheckController, CreditCheckController, CustomerCreditCheckController } from './credit-check.controller';
import { CreditCheckService } from './credit-check.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { CustomerJourneyModule } from '../customer-journey/customer-journey.module';

@Module({
  // CustomerJourneyModule — ผู้เปิดตรวจเครดิต (controller) + ผล AI ประเมินเครดิต (service) ของการเดินทางลูกค้า
  // โมดูลนั้นไม่ import โมดูลโดเมน จึงไม่มีวงจรกับ CustomersModule ที่ import ทั้งสองโมดูล
  imports: [IntegrationsModule, CustomerJourneyModule],
  controllers: [GlobalCreditCheckController, CreditCheckController, CustomerCreditCheckController],
  providers: [CreditCheckService],
  exports: [CreditCheckService],
})
export class CreditCheckModule {}
