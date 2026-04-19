import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { IntegrationConfigService } from './integration-config.service';
import { CredentialRotationCron } from './credential-rotation.cron';

@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, IntegrationConfigService, CredentialRotationCron],
  exports: [IntegrationConfigService],
})
export class IntegrationsModule {}
