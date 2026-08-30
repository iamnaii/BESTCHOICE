import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerQueryService } from './services/customer-query.service';
import { CustomerWriteService } from './services/customer-write.service';
import { CustomerAnalyticsService } from './services/customer-analytics.service';
import { CustomerTierService } from './customer-tier.service';
import { SkipTracingService } from './skip-tracing.service';
import { CustomerPiiModule } from './customer-pii.module';
import { OverdueModule } from '../overdue/overdue.module';
import { ContactsModule } from '../contacts/contacts.module';
import { TestModeModule } from '../test-mode/test-mode.module';
import { CreditCheckModule } from '../credit-check/credit-check.module';

@Module({
  // CreditCheckModule — เดิม pre-check เรียกตัวอ่าน statement ด้วย AI (โมดูลนั้น import แค่
  // IntegrationsModule จึงไม่มี cycle กลับมาหา customers)
  imports: [OverdueModule, CustomerPiiModule, ContactsModule, TestModeModule, CreditCheckModule],
  controllers: [CustomersController],
  providers: [
    CustomersService,
    CustomerQueryService,
    CustomerWriteService,
    CustomerAnalyticsService,
    CustomerTierService,
    SkipTracingService,
  ],
  exports: [
    CustomersService,
    CustomerTierService,
    SkipTracingService,
    CustomerPiiModule,
  ],
})
export class CustomersModule {}
