import { Module } from '@nestjs/common';
import { ReceivableReconService } from './receivable-recon.service';
import { ReceivableReconCron } from './receivable-recon.cron';
import { ReceivableReconController } from './receivable-recon.controller';

@Module({
  controllers: [ReceivableReconController],
  providers: [ReceivableReconService, ReceivableReconCron],
  exports: [ReceivableReconService],
})
export class ReceivableReconModule {}
