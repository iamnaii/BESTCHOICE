import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaFinanceService } from './prisma-finance.service';

@Global()
@Module({
  providers: [PrismaService, PrismaFinanceService],
  exports: [PrismaService, PrismaFinanceService],
})
export class PrismaModule {}
