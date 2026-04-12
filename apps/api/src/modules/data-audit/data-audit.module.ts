import { Module } from '@nestjs/common';
import { DataAuditController } from './data-audit.controller';
import { DataAuditService } from './data-audit.service';

@Module({
  controllers: [DataAuditController],
  providers: [DataAuditService],
  exports: [DataAuditService],
})
export class DataAuditModule {}
