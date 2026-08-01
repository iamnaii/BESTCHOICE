import { Module } from '@nestjs/common';
import { IntercoPendingService } from './interco-pending.service';
import { IntercoBatchNumberService } from './interco-batch-number.service';

// PrismaService is provided globally via @Global() PrismaModule — no import needed.
//
// Skeleton for DI sanity (plan Task 2). Controller + app.module.ts wiring +
// the batch lifecycle service (create/submit/approve/reverse) land in
// Task 3-5 — see docs/superpowers/plans/2026-07-30-interco-settlement-batch.md.
@Module({
  providers: [IntercoPendingService, IntercoBatchNumberService],
  exports: [IntercoPendingService, IntercoBatchNumberService],
})
export class IntercoSettlementModule {}
