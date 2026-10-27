import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { AttendanceDeviceService } from './attendance-device.service';
import { AttendanceSettingsService } from './attendance-settings.service';
import { KioskPunchService } from './kiosk-punch.service';
import { KioskPublicController } from './kiosk-public.controller';

/**
 * ลงเวลาทำงานผ่านเครื่องประจำสาขา (ก้อน 10 · D3) — spec docs/superpowers/specs/2026-10-27-attendance-kiosk-design.md
 * controller สาธารณะ `kiosk` (token-gated) + controller ภายใน (Task 5) + cron (Task 6)
 */
@Module({
  imports: [AuditModule, StorageModule],
  controllers: [KioskPublicController],
  providers: [AttendanceDeviceService, AttendanceSettingsService, KioskPunchService],
  exports: [AttendanceDeviceService, AttendanceSettingsService, KioskPunchService],
})
export class AttendanceModule {}
