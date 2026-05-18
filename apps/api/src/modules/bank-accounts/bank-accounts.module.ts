import { Module } from '@nestjs/common';
import { BankAccountsController } from './bank-accounts.controller';
import { BankAccountsService } from './bank-accounts.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [BankAccountsController],
  providers: [BankAccountsService, PrismaService],
  exports: [BankAccountsService],
})
export class BankAccountsModule {}
