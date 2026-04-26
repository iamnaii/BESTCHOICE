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
  SetLockScreenTextDto,
  AddDeviceDto,
  EditDeviceDto,
} from './dto/mdm.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';

@Controller('mdm')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class MdmController {
  constructor(
    private mdmService: MdmService,
    private audit: AuditService,
  ) {}

  // ─── Status & Config ────────────────────────────────────

  @Get('status')
  @Roles('OWNER')
  getStatus() {
    return this.mdmService.getStatus();
  }

  // ─── Device Lookup ──────────────────────────────────────

  @Get('devices')
  @Roles('OWNER', 'BRANCH_MANAGER')
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
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getDeviceStatus(@Query() dto: DeviceStatusDto) {
    return this.mdmService.getDeviceStatus(dto.imei);
  }

  @Get('devices/wallpapers')
  @Roles('OWNER')
  getWallpapers() {
    return this.mdmService.getWallpapers();
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
  @Roles('OWNER', 'FINANCE_MANAGER')
  async lockDevice(
    @Body() dto: LockDeviceDto,
    @CurrentUser() user: { id: string },
  ) {
    const result = await this.mdmService.lockDeviceByImei(dto.imei, dto.reason);
    await this.audit.log({
      userId: user.id,
      action: 'MDM_LOCK',
      entity: 'MDM',
      entityId: dto.imei,
      newValue: { imei: dto.imei, reason: dto.reason },
    });
    return result;
  }

  @Post('unlock')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async unlockDevice(
    @Body() dto: UnlockDeviceDto,
    @CurrentUser() user: { id: string },
  ) {
    const result = await this.mdmService.unlockDeviceByImei(dto.imei);
    await this.audit.log({
      userId: user.id,
      action: 'MDM_UNLOCK',
      entity: 'MDM',
      entityId: dto.imei,
      newValue: { imei: dto.imei, reason: dto.reason, note: dto.note ?? null },
    });
    return result;
  }

  // ─── Contract-based Lost Mode (action-first flow from Customer360Panel) ──

  @Post('contracts/:contractId/lock')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'SALES')
  async lockByContract(
    @Param('contractId') contractId: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: { id: string },
  ) {
    const reason = (body?.reason ?? '').trim() || 'ค้างชำระ';
    const result = await this.mdmService.lockContract(contractId, reason, user.id);
    await this.audit.log({
      userId: user.id,
      action: 'MDM_LOCK',
      entity: 'Contract',
      entityId: contractId,
      newValue: { reason, success: result.success, message: result.message },
    });
    return result;
  }

  @Post('contracts/:contractId/unlock')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'SALES')
  async unlockByContract(
    @Param('contractId') contractId: string,
    @CurrentUser() user: { id: string },
  ) {
    const result = await this.mdmService.unlockContract(contractId, user.id);
    await this.audit.log({
      userId: user.id,
      action: 'MDM_UNLOCK',
      entity: 'Contract',
      entityId: contractId,
      newValue: { success: result.success, message: result.message },
    });
    return result;
  }

  // ─── Policies ───────────────────────────────────────────

  @Post('devices/lock-screen')
  @Roles('OWNER', 'FINANCE_MANAGER')
  lockScreen(@Body() body: { id: number }) {
    return this.mdmService.lockDeviceScreen(body.id);
  }

  @Post('devices/restrictions')
  @Roles('OWNER')
  setRestrictions(@Body() body: { id: number; [key: string]: unknown }) {
    const { id, ...options } = body;
    return this.mdmService.installRestrictions(id, options as Record<string, number>);
  }

  @Post('devices/wallpaper')
  @Roles('OWNER')
  setWallpaper(@Body() body: { deviceId: number; imageId: number }) {
    return this.mdmService.setWallpaper(body.deviceId, body.imageId);
  }

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
