import { Module } from '@nestjs/common';
import { IntercoAgingService } from './interco-aging.service';
import { ShopReceivableAgingCron } from './crons/shop-receivable-aging.cron';
import { IntercoReconcileCron } from './crons/interco-reconcile.cron';
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
  providers: [
    IntercoPendingService,
    IntercoBatchNumberService,
    IntercoSettlementService,
    IntercoAgingService,
    // Phase 4 Task 3 — cron แจ้งเตือนอายุลูกหนี้หน้าร้าน (ScheduleModule.forRoot
    // อยู่ที่ app.module แล้ว; ไม่ export เพราะไม่มีใครนอกโมดูลเรียก tick)
    ShopReceivableAgingCron,
    // Phase 4 Task 4 — cron กระทบยอดระหว่างกิจการรายเดือน (รายงานอย่างเดียว
    // ไม่แตะ GL); ไม่ export เพราะไม่มีใครนอกโมดูลเรียก tick
    IntercoReconcileCron,
  ],
  exports: [
    IntercoPendingService,
    IntercoBatchNumberService,
    IntercoSettlementService,
    IntercoAgingService,
  ],
})
export class IntercoSettlementModule {}
