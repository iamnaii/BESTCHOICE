import { Module } from '@nestjs/common';
import { CustomerAccessController } from './customer-access.controller';
import { CustomerAccessService } from './customer-access.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CustomerAccessController],
  providers: [CustomerAccessService],
  exports: [CustomerAccessService],
})
export class CustomerAccessModule {}
