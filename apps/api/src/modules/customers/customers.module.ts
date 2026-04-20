import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerTierService } from './customer-tier.service';
import { CustomerPreCheckService } from './customer-precheck.service';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomerTierService, CustomerPreCheckService],
  exports: [CustomersService, CustomerTierService, CustomerPreCheckService],
})
export class CustomersModule {}
