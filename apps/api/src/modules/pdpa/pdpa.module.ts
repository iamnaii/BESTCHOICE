import { Module } from '@nestjs/common';
import { PDPAController } from './pdpa.controller';
import { PDPAService } from './pdpa.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PDPAController],
  providers: [PDPAService],
  exports: [PDPAService],
})
export class PDPAModule {}
