import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RescheduleService } from './reschedule.service';

@Module({
  imports: [PrismaModule],
  providers: [RescheduleService],
  exports: [RescheduleService],
})
export class InstallmentsModule {}
