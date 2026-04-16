import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
  ParseIntPipe,
} from '@nestjs/common';
import { MdmService } from './mdm.service';
import {
  LockDeviceDto,
  UnlockDeviceDto,
  DeviceStatusDto,
  DeviceByIdDto,
  SetLockScreenTextDto,
  AddDeviceDto,
  EditDeviceDto,
} from './dto/mdm.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('mdm')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class MdmController {
  constructor(private mdmService: MdmService) {}

  // ─── Status & Config ────────────────────────────────────

  @Get('status')
  @Roles('OWNER')
  getStatus() {
    return this.mdmService.getStatus();
  }

  // ─── Device Lookup ──────────────────────────────────────

  @Get('devices')
  @Roles('OWNER')
  listDevices(
    @Query('pageNum') pageNum?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('lossStatus') lossStatus?: string,
    @Query('name') name?: string,
    @Query('phone') phone?: string,
    @Query('deviceId') deviceId?: string,
  ) {
    return this.mdmService.listDevices({
      pageNum: pageNum ? parseInt(pageNum) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
      status: status !== undefined ? (parseInt(status) as 0 | 1 | 2) : undefined,
      lossStatus: lossStatus !== undefined ? (parseInt(lossStatus) as 0 | 1) : undefined,
      name: name || undefined,
      phone: phone || undefined,
      deviceId: deviceId || undefined,
    });
  }

  @Get('device-types')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getDeviceTypes() {
    return this.mdmService.getDeviceTypes();
  }

  @Get('device-status')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getDeviceStatus(@Query() dto: DeviceStatusDto) {
    return this.mdmService.getDeviceStatus(dto.imei);
  }

  @Get('devices/:id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getDeviceById(@Param('id', ParseIntPipe) id: number) {
    return this.mdmService.getDeviceById(id);
  }

  @Get('devices/:id/location')
  @Roles('OWNER')
  getDeviceLocation(@Param('id', ParseIntPipe) id: number) {
    return this.mdmService.getDeviceLocation(id);
  }

  @Get('devices/:id/apps')
  @Roles('OWNER')
  getDeviceApps(@Param('id', ParseIntPipe) id: number) {
    return this.mdmService.getDeviceApps(id);
  }

  @Get('devices/:id/restrictions')
  @Roles('OWNER')
  getDeviceRestrictions(@Param('id', ParseIntPipe) id: number) {
    return this.mdmService.getDeviceRestrictions(id);
  }

  // ─── Device Mutations ───────────────────────────────────

  @Post('devices/add')
  @Roles('OWNER')
  addDevice(@Body() dto: AddDeviceDto) {
    return this.mdmService.addDevice(dto.deviceId, dto.name, dto.phone);
  }

  @Post('devices/edit')
  @Roles('OWNER')
  editDevice(@Body() dto: EditDeviceDto) {
    return this.mdmService.editDevice(dto.id, dto.name, dto.phone, dto.deviceName);
  }

  // ─── Lost Mode (overdue lock/unlock) ───────────────────

  @Post('lock')
  @Roles('OWNER')
  lockDevice(@Body() dto: LockDeviceDto) {
    return this.mdmService.lockDeviceByImei(dto.imei, dto.reason);
  }

  @Post('unlock')
  @Roles('OWNER')
  unlockDevice(@Body() dto: UnlockDeviceDto) {
    return this.mdmService.unlockDeviceByImei(dto.imei);
  }

  // ─── Policies ───────────────────────────────────────────

  @Post('devices/lock-screen-text')
  @Roles('OWNER')
  setLockScreenText(@Body() dto: SetLockScreenTextDto) {
    return this.mdmService.setLockScreenText(dto.id, dto.message);
  }

  // ─── Operations Log ─────────────────────────────────────

  @Get('operations')
  @Roles('OWNER')
  getOperations(
    @Query('pageNum') pageNum?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const query: Record<string, string> = {};
    if (pageNum) query.pageNum = pageNum;
    if (pageSize) query.pageSize = pageSize;
    return this.mdmService.getOperationLogs(query);
  }
}
