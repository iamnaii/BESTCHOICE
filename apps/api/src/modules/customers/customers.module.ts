import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerTierService } from './customer-tier.service';
import { CustomerPreCheckService } from './customer-precheck.service';
import { SkipTracingService } from './skip-tracing.service';
import { OverdueModule } from '../overdue/overdue.module';

@Module({
  imports: [OverdueModule],
  controllers: [CustomersController],
  providers: [
    CustomersService,
    CustomerTierService,
    CustomerPreCheckService,
    SkipTracingService,
  ],
  exports: [
    CustomersService,
    CustomerTierService,
    CustomerPreCheckService,
    SkipTracingService,
  ],
})
export class CustomersModule {}
