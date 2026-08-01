import { Module } from '@nestjs/common';
import { IntercoPendingService } from './interco-pending.service';
import { IntercoBatchNumberService } from './interco-batch-number.service';
import { IntercoSettlementService } from './interco-settlement.service';
import { IntercoSettlementController } from './interco-settlement.controller';
import { JournalModule } from '../journal/journal.module';
import { StorageModule } from '../storage/storage.module';

// PrismaService is provided globally via @Global() PrismaModule — no import needed.
//
// `approveBatch`/`reverseBatch` need PairedJournalService + CompanyResolverService
// + JournalAutoService, all exported by JournalModule. `uploadSlip` needs
// StorageService (S3/GCS upload), exported by StorageModule (also @Global(),
// imported explicitly here to match house convention — see other-income.module.ts).
//
// Task 5: controller + app.module.ts wiring.
@Module({
  imports: [JournalModule, StorageModule],
  controllers: [IntercoSettlementController],
  providers: [IntercoPendingService, IntercoBatchNumberService, IntercoSettlementService],
  exports: [IntercoPendingService, IntercoBatchNumberService, IntercoSettlementService],
})
export class IntercoSettlementModule {}
