import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { RoleMapValidationService } from './role-map-validation.service';
import { JournalModule } from '../journal/journal.module';

@Module({
  // D1.1.1.5 — pull in JournalModule (exports AccountRoleService); the
  // RoleMapValidationService reuses the same prisma instance.
  imports: [JournalModule],
  controllers: [SettingsController],
  providers: [SettingsService, RoleMapValidationService],
  exports: [SettingsService, RoleMapValidationService],
})
export class SettingsModule {}
