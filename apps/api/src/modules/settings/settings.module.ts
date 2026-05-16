import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { JournalModule } from '../journal/journal.module';

@Module({
  // D1.1.1.6 — pull in JournalModule to reuse AccountRoleService (cache +
  // audit-aware create/update/deactivate).
  imports: [JournalModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
