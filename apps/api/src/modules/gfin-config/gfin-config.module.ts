import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { GfinConfigController } from './gfin-config.controller';
import { GfinConfigService } from './gfin-config.service';

// AuditModule is @Global() so AuditService is available without explicit import here.

@Module({
  imports: [PrismaModule],
  controllers: [GfinConfigController],
  providers: [GfinConfigService],
  exports: [GfinConfigService],
})
export class GfinConfigModule {}
