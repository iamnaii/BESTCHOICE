import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LateFeeWaiverController } from './late-fee-waiver.controller';
import { LateFeeWaiverService } from './late-fee-waiver.service';

@Module({
  imports: [PrismaModule],
  controllers: [LateFeeWaiverController],
  providers: [LateFeeWaiverService],
  exports: [LateFeeWaiverService],
})
export class LateFeeWaiverModule {}
