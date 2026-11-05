import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { LateFeeWaiverController } from './late-fee-waiver.controller';
import { LateFeeWaiverService } from './late-fee-waiver.service';

@Module({
  // ProductsService: checkContractCompletion releases device ownership when the
  // waiver settles the contract's last installment (same as the payments path).
  imports: [PrismaModule, ProductsModule],
  controllers: [LateFeeWaiverController],
  providers: [LateFeeWaiverService],
  exports: [LateFeeWaiverService],
})
export class LateFeeWaiverModule {}
