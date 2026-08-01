import { Module } from '@nestjs/common';
import { IntercoPendingService } from './interco-pending.service';
import { IntercoBatchNumberService } from './interco-batch-number.service';
import { IntercoSettlementService } from './interco-settlement.service';
import { JournalModule } from '../journal/journal.module';

// PrismaService is provided globally via @Global() PrismaModule — no import needed.
//
// Batch lifecycle service (create/submit/withdraw/cancel/update/list/get)
// landed in Task 3. `approveBatch`/`reverseBatch` (Task 4) need
// PairedJournalService + CompanyResolverService + JournalAutoService, all
// exported by JournalModule — imported here so Nest DI can resolve them once
// this module is wired into app.module.ts (Task 5). Controller +
// app.module.ts wiring land in Task 5 — see
// docs/superpowers/plans/2026-07-30-interco-settlement-batch.md.
@Module({
  imports: [JournalModule],
  providers: [IntercoPendingService, IntercoBatchNumberService, IntercoSettlementService],
  exports: [IntercoPendingService, IntercoBatchNumberService, IntercoSettlementService],
})
export class IntercoSettlementModule {}
