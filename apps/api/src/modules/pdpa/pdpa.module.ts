import { Module, forwardRef } from '@nestjs/common';
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
 * Hotfix 2026-05-18 (#1018 + this PR) —
 *
 * Two cycles needed breaking:
 * 1) PDPAModule → CustomersModule → OverdueModule → ChatEngine ↔ StaffChat cycle
 *    → fixed in #1018 by extracting CustomerPiiModule (leaf, PrismaModule only).
 * 2) NotificationsModule → PDPAModule → AuthModule (in scan order: AuthModule
 *    is mid-init via LineOaModule forwardRef, so PDPAModule sees AuthModule
 *    as undefined). → fixed here by forwardRef on AuthModule import.
 *
 * Without (1) the chain dies at StaffChatModule with index [0]=undefined.
 * Without (2) it dies at PDPAModule with index [1]=AuthModule undefined.
 */
@Module({
  imports: [
    PrismaModule,
    forwardRef(() => AuthModule),
    CustomerPiiModule,
    AuditModule,
  ],
  controllers: [PDPAController, PdpaEncryptionController],
  providers: [PDPAService, PdpaEncryptionService, PdpaBackfillRetentionCron],
  exports: [PDPAService, PdpaEncryptionService],
})
export class PDPAModule {}
