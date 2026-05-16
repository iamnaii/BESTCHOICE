import { Module } from '@nestjs/common';
import { ChartOfAccountsController } from './chart-of-accounts.controller';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  controllers: [ChartOfAccountsController],
  providers: [ChartOfAccountsService, PrismaService],
  exports: [ChartOfAccountsService],
})
export class ChartOfAccountsModule {}
