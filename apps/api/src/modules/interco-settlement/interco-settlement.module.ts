import { Module } from '@nestjs/common';
import { IntercoPendingService } from './interco-pending.service';
import { IntercoBatchNumberService } from './interco-batch-number.service';
import { IntercoSettlementService } from './interco-settlement.service';

// PrismaService is provided globally via @Global() PrismaModule — no import needed.
//
// Batch lifecycle service (create/submit/withdraw/cancel/update/list/get)
// lands here in Task 3. `approveBatch`/`reverseBatch` (paired JE — needs
// PairedJournalService from the journal module) land in Task 4. Controller +
// app.module.ts wiring land in Task 5 — see
// docs/superpowers/plans/2026-07-30-interco-settlement-batch.md.
@Module({
  providers: [IntercoPendingService, IntercoBatchNumberService, IntercoSettlementService],
  exports: [IntercoPendingService, IntercoBatchNumberService, IntercoSettlementService],
})
export class IntercoSettlementModule {}
