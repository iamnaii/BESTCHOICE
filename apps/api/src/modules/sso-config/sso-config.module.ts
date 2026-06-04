import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SsoConfigService } from './sso-config.service';
import { SsoConfigController } from './sso-config.controller';

@Module({
  controllers: [SsoConfigController],
  providers: [SsoConfigService, PrismaService],
  exports: [SsoConfigService],
})
export class SsoConfigModule {}
