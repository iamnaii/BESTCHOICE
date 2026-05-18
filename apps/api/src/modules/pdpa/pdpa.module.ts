import { Module } from '@nestjs/common';
import { PDPAController } from './pdpa.controller';
import { PDPAService } from './pdpa.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CustomersModule } from '../customers/customers.module';
import { AuditModule } from '../audit/audit.module';
import { PdpaEncryptionService } from './pdpa-encryption.service';
import { PdpaEncryptionController } from './pdpa-encryption.controller';
import { PdpaBackfillRetentionCron } from './pdpa-backfill-retention.cron';

@Module({
  imports: [PrismaModule, AuthModule, CustomersModule, AuditModule],
  controllers: [PDPAController, PdpaEncryptionController],
  providers: [PDPAService, PdpaEncryptionService, PdpaBackfillRetentionCron],
  exports: [PDPAService, PdpaEncryptionService],
})
export class PDPAModule {}
