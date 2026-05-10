import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { JournalModule } from '../journal/journal.module';
import { AuthModule } from '../auth/auth.module';
import { ExpenseDocumentsController } from './expense-documents.controller';
import { ExpenseDocumentsService } from './expense-documents.service';
import { DocNumberService } from './services/doc-number.service';
import { StatusTransitionService } from './services/status-transition.service';

@Module({
  imports: [PrismaModule, JournalModule, AuthModule],
  controllers: [ExpenseDocumentsController],
  providers: [ExpenseDocumentsService, DocNumberService, StatusTransitionService],
  exports: [ExpenseDocumentsService],
})
export class ExpenseDocumentsModule {}
