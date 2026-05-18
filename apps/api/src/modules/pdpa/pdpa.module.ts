import { Module } from '@nestjs/common';
import { PDPAController } from './pdpa.controller';
import { PDPAService } from './pdpa.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CustomerPiiModule } from '../customers/customer-pii.module';
import { AuditModule } from '../audit/audit.module';
import { PdpaEncryptionService } from './pdpa-encryption.service';
import { PdpaEncryptionController } from './pdpa-encryption.controller';
import { PdpaBackfillRetentionCron } from './pdpa-backfill-retention.cron';

/**
 * Hotfix 2026-05-18 — was importing CustomersModule (P3-SP4) which transitively
 * pulled in OverdueModule → ChatEngineModule → StaffChatModule cycle, breaking
 * boot. Now imports the leaf CustomerPiiModule directly — same CustomerPiiService
 * is exported, no other deps come along.
 */
@Module({
  imports: [PrismaModule, AuthModule, CustomerPiiModule, AuditModule],
  controllers: [PDPAController, PdpaEncryptionController],
  providers: [PDPAService, PdpaEncryptionService, PdpaBackfillRetentionCron],
  exports: [PDPAService, PdpaEncryptionService],
})
export class PDPAModule {}
