import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AttendanceDeviceService } from './attendance-device.service';
import { AttendanceSettingsService } from './attendance-settings.service';
import { IssueRegistrationCodeDto, UpdateAttendanceSettingsDto } from './dto/attendance.dto';

/** ตั้งค่า › บริษัท & สาขา › เครื่องตอกบัตร + เวลางาน (OWNER เท่านั้น · สเปก §4.1 §7 ข้อ 3 §8) */
@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceDevicesController {
  constructor(
    private readonly devices: AttendanceDeviceService,
    private readonly settings: AttendanceSettingsService,
  ) {}

  @Get('devices')
  @Roles('OWNER')
  list() {
    return this.devices.listDevices();
  }

  @Post('devices/registration-code')
  @Roles('OWNER')
  issueCode(@CurrentUser('id') actorId: string, @Body() dto: IssueRegistrationCodeDto) {
    return this.devices.issueRegistrationCode(dto.branchId, actorId);
  }

  @Post('devices/:id/revoke')
  @Roles('OWNER')
  async revoke(@CurrentUser('id') actorId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.devices.revoke(id, actorId);
    return { ok: true };
  }

  @Post('devices/:id/unlock')
  @Roles('OWNER')
  async unlock(@CurrentUser('id') actorId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.devices.unlock(id, actorId);
    return { ok: true, message: 'ปลดล็อกแล้ว — ลงทะเบียนเครื่องใหม่ด้วยรหัสใหม่' };
  }

  @Get('devices/:id/events')
  @Roles('OWNER')
  events(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.listEvents(id);
  }

  @Get('settings')
  @Roles('OWNER')
  getSettings() {
    return this.settings.getSettings();
  }

  @Patch('settings')
  @Roles('OWNER')
  updateSettings(@Body() dto: UpdateAttendanceSettingsDto) {
    return this.settings.updateSettings(dto);
  }
}
