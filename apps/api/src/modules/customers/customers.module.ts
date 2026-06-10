import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerQueryService } from './services/customer-query.service';
import { CustomerWriteService } from './services/customer-write.service';
import { CustomerAnalyticsService } from './services/customer-analytics.service';
import { CustomerTierService } from './customer-tier.service';
import { CustomerPreCheckService } from './customer-precheck.service';
import { SkipTracingService } from './skip-tracing.service';
import { CustomerPiiModule } from './customer-pii.module';
import { OverdueModule } from '../overdue/overdue.module';
import { ContactsModule } from '../contacts/contacts.module';
import { TestModeModule } from '../test-mode/test-mode.module';

@Module({
  imports: [OverdueModule, CustomerPiiModule, ContactsModule, TestModeModule],
  controllers: [CustomersController],
  providers: [
    CustomersService,
    CustomerQueryService,
    CustomerWriteService,
    CustomerAnalyticsService,
    CustomerTierService,
    CustomerPreCheckService,
    SkipTracingService,
  ],
  exports: [
    CustomersService,
    CustomerTierService,
    CustomerPreCheckService,
    SkipTracingService,
    CustomerPiiModule,
  ],
})
export class CustomersModule {}
