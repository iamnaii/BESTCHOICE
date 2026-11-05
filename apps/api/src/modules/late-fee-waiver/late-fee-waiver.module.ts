import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { LateFeeWaiverController } from './late-fee-waiver.controller';
import { LateFeeWaiverService } from './late-fee-waiver.service';

@Module({
  // AuditModule is @Global; ProductsModule supplies ProductsService for
  // checkContractCompletion (device ownership release on completion).
  imports: [PrismaModule, ProductsModule],
  controllers: [LateFeeWaiverController],
  providers: [LateFeeWaiverService],
  exports: [LateFeeWaiverService],
})
export class LateFeeWaiverModule {}
