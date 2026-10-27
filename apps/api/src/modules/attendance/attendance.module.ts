import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { AttendanceDeviceService } from './attendance-device.service';
import { AttendanceSettingsService } from './attendance-settings.service';
import { AttendanceService } from './attendance.service';
import { KioskPunchService } from './kiosk-punch.service';
import { KioskPublicController } from './kiosk-public.controller';
import { AttendanceController } from './attendance.controller';
import { AttendanceDevicesController } from './attendance-devices.controller';

/**
 * ลงเวลาทำงานผ่านเครื่องประจำสาขา (ก้อน 10 · D3) — spec docs/superpowers/specs/2026-10-27-attendance-kiosk-design.md
 * controller สาธารณะ `kiosk` (token-gated) + controller ภายใน (`attendance`, `attendance/devices`) + cron (Task 6)
 */
@Module({
  imports: [AuditModule, StorageModule],
  controllers: [KioskPublicController, AttendanceController, AttendanceDevicesController],
  providers: [AttendanceDeviceService, AttendanceSettingsService, KioskPunchService, AttendanceService],
  exports: [AttendanceDeviceService, AttendanceSettingsService, KioskPunchService, AttendanceService],
})
export class AttendanceModule {}
