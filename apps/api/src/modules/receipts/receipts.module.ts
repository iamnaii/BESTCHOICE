import { Module, forwardRef } from '@nestjs/common';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsPublicController } from './receipts-public.controller';
import { ReceiptsService } from './receipts.service';
import { CreditNoteDocumentService } from './services/credit-note-document.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => LineOaModule),
    JournalModule,
  ],
  controllers: [ReceiptsController, ReceiptsPublicController],
  providers: [ReceiptsService, CreditNoteDocumentService],
  exports: [ReceiptsService, CreditNoteDocumentService],
})
export class ReceiptsModule {}
