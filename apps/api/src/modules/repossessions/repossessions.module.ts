import { Module } from '@nestjs/common';
import { RepossessionsController } from './repossessions.controller';
import { RepossessionsService } from './repossessions.service';
import { JournalModule } from '../journal/journal.module';
import { ReceiptsModule } from '../receipts/receipts.module';

// No forwardRef needed here: ReceiptsModule's own dependency chain
// (PrismaModule, LineOaModule, JournalModule) never imports
// RepossessionsModule, so there is no cycle to break (verified 2026-07-24,
// Phase 3 Task 3 — unlike the Contracts → Receipts → LineOa → Contracts cycle).
@Module({
  imports: [JournalModule, ReceiptsModule],
  controllers: [RepossessionsController],
  providers: [RepossessionsService],
  exports: [RepossessionsService],
})
export class RepossessionsModule {}
