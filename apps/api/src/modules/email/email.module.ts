import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [IntegrationsModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
