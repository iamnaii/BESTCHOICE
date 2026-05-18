import { Module, forwardRef } from '@nestjs/common';
import { PDPAController } from './pdpa.controller';
import { PDPAService } from './pdpa.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CustomersModule } from '../customers/customers.module';
import { AuditModule } from '../audit/audit.module';
import { PdpaEncryptionService } from './pdpa-encryption.service';
import { PdpaEncryptionController } from './pdpa-encryption.controller';
import { PdpaBackfillRetentionCron } from './pdpa-backfill-retention.cron';

/**
 * Hotfix 2026-05-18 — PDPAModule was imported by NotificationsModule (pre-P3-SP4).
 * P3-SP4 added CustomersModule to PDPAModule.imports. CustomersModule transitively
 * imports NotificationsModule (via OverdueModule chain), creating a circular dep.
 * Symptom: bestchoice-api revision crashed at boot with
 *   "Nest cannot create the PDPAModule instance. The module at index [1] of
 *    the PDPAModule 'imports' array is undefined."
 * Fix: wrap AuthModule + CustomersModule with forwardRef to defer resolution.
 */
@Module({
  imports: [
    PrismaModule,
    forwardRef(() => AuthModule),
    forwardRef(() => CustomersModule),
    AuditModule,
  ],
  controllers: [PDPAController, PdpaEncryptionController],
  providers: [PDPAService, PdpaEncryptionService, PdpaBackfillRetentionCron],
  exports: [PDPAService, PdpaEncryptionService],
})
export class PDPAModule {}
