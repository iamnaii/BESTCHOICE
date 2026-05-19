import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ETaxXmlController } from './e-tax-xml.controller';
import { ETaxXmlService } from './e-tax-xml.service';
import { ETaxAutoSubmitCron } from './etax-auto-submit.cron';

/**
 * P2-SP5 — e-Tax XML module.
 *
 * Brings in IntegrationsModule so the service can read/write the
 * encrypted `e-tax` config (cert path, RD creds) via the same pattern
 * as PaySolutions, LINE, MDM.
 */
@Module({
  imports: [ConfigModule, PrismaModule, IntegrationsModule],
  controllers: [ETaxXmlController],
  providers: [ETaxXmlService, ETaxAutoSubmitCron],
  exports: [ETaxXmlService],
})
export class ETaxXmlModule {}
