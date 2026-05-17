import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { DocConfigController } from './doc-config.controller';
import { DocConfigService } from './doc-config.service';

/**
 * SP4 — Document Number Config module.
 *
 * Provides OWNER-only CRUD + preview for `DocumentNumberConfig` rows.
 * AuditService is injected from the global AuditModule (registered in
 * app.module.ts).
 */
@Module({
  imports: [PrismaModule],
  controllers: [DocConfigController],
  providers: [DocConfigService],
  exports: [DocConfigService],
})
export class DocConfigModule {}
