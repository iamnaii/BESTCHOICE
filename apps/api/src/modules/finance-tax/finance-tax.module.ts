import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FinanceTaxController } from './finance-tax.controller';
import { FinanceTaxService } from './finance-tax.service';

@Module({
  imports: [PrismaModule],
  controllers: [FinanceTaxController],
  providers: [FinanceTaxService],
  exports: [FinanceTaxService],
})
export class FinanceTaxModule {}
