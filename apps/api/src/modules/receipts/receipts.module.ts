import { Module, forwardRef } from '@nestjs/common';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsPublicController } from './receipts-public.controller';
import { ReceiptsService } from './receipts.service';
import { CreditNoteDocumentService } from './services/credit-note-document.service';
import { CreditNoteDeliveryService } from './services/credit-note-delivery.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { JournalModule } from '../journal/journal.module';
import { ChatbotFinanceModule } from '../chatbot-finance/chatbot-finance.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => LineOaModule),
    JournalModule,
    // Phase 3 Task 5: CreditNoteDeliveryService needs LineFinanceClientService
    // (exported by ChatbotFinanceModule). forwardRef is required — verified
    // 2026-07-24: ReceiptsModule → ChatbotFinanceModule → NotificationsModule
    // → LineOaModule (forwardRef) → ContractsModule (forwardRef) →
    // ReceiptsModule closes a cycle back to this module. Every other edge in
    // that cycle already uses forwardRef (see LineOaModule/ContractsModule
    // comments) — this is simply the last edge to add one.
    forwardRef(() => ChatbotFinanceModule),
  ],
  controllers: [ReceiptsController, ReceiptsPublicController],
  providers: [ReceiptsService, CreditNoteDocumentService, CreditNoteDeliveryService],
  exports: [ReceiptsService, CreditNoteDocumentService, CreditNoteDeliveryService],
})
export class ReceiptsModule {}
