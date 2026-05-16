import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SsoConfigService } from './sso-config.service';

@Module({
  providers: [SsoConfigService, PrismaService],
  exports: [SsoConfigService],
})
export class SsoConfigModule {}
