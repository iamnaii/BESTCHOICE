import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';

// Controllers + service wired in Task 9
@Module({
  imports: [PrismaModule],
  controllers: [],
  providers: [],
})
export class ContractExchangeModule {}
