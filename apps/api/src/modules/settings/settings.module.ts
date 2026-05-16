import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { JournalModule } from '../journal/journal.module';

@Module({
  // D1.1.1.4 — pull in JournalModule so we can reuse AccountRoleService
  // for the role-map admin endpoints (no duplicated cache logic).
  imports: [JournalModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
