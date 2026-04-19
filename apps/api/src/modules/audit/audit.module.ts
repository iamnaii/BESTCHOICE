import { Module, Global } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';
import { AuditChainVerifyCron } from './audit-chain-verify.cron';
import { AuditRetentionCron } from './audit-retention.cron';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditInterceptor, AuditChainVerifyCron, AuditRetentionCron],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}
