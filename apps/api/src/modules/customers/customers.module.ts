import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerTierService } from './customer-tier.service';
import { CustomerPreCheckService } from './customer-precheck.service';
import { SkipTracingService } from './skip-tracing.service';
import { CustomerPiiService } from './customer-pii.service';
import { OverdueModule } from '../overdue/overdue.module';

@Module({
  imports: [OverdueModule],
  controllers: [CustomersController],
  providers: [
    CustomersService,
    CustomerTierService,
    CustomerPreCheckService,
    SkipTracingService,
    CustomerPiiService,
  ],
  exports: [
    CustomersService,
    CustomerTierService,
    CustomerPreCheckService,
    SkipTracingService,
    CustomerPiiService,
  ],
})
export class CustomersModule {}
