import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { JournalModule } from '../journal/journal.module';
import { AuthModule } from '../auth/auth.module';
import { ExpenseDocumentsController } from './expense-documents.controller';
import { ExpenseDocumentsService } from './expense-documents.service';
import { ExpenseTemplatesController } from './expense-templates.controller';
import { ExpenseTemplatesService } from './expense-templates.service';
import { DocNumberService } from './services/doc-number.service';
import { StatusTransitionService } from './services/status-transition.service';
import { LineAggregatorService } from './services/line-aggregator.service';
import { ExpenseRecurringCron } from './crons/expense-recurring.cron';

@Module({
  imports: [PrismaModule, JournalModule, AuthModule],
  controllers: [ExpenseDocumentsController, ExpenseTemplatesController],
  providers: [
    ExpenseDocumentsService,
    ExpenseTemplatesService,
    DocNumberService,
    StatusTransitionService,
    LineAggregatorService,
    ExpenseRecurringCron,
  ],
  exports: [ExpenseDocumentsService, ExpenseTemplatesService],
})
export class ExpenseDocumentsModule {}
