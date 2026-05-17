import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { RoleMapValidationService } from './role-map-validation.service';
import { SettingsAccessGuard } from './settings-access.guard';
import { JournalModule } from '../journal/journal.module';

@Module({
  // D1.1.1.2 + D1.1.1.5 + D1.1.1.7 — pull in JournalModule (exports
  // AccountRoleService and the ROLE_MAP_*_ROLES permission constants) so the
  // settings controller can serve the account_role_map admin UI without
  // duplicating the cache/validation logic. RoleMapValidationService reuses
  // the same prisma instance and is invoked by SettingsController as a
  // `validate` callback into AccountRoleService.update().
  imports: [JournalModule],
  controllers: [SettingsController],
  // D1.3.2.2 — SettingsAccessGuard is consumed by the controller via
  // `@UseGuards(...)` so Nest needs it in the providers list.
  providers: [SettingsService, RoleMapValidationService, SettingsAccessGuard],
  exports: [SettingsService, RoleMapValidationService],
})
export class SettingsModule {}
