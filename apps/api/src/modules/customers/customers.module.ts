import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerTierService } from './customer-tier.service';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomerTierService],
  exports: [CustomersService, CustomerTierService],
})
export class CustomersModule {}
