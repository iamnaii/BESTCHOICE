import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { JournalModule } from '../journal/journal.module';

@Module({
  // D1.1.1.2 — pull in JournalModule (exports AccountRoleService) so the
  // settings controller can serve the account_role_map admin UI without
  // duplicating the cache/validation logic.
  imports: [JournalModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
