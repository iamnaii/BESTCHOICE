import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { MdmService } from './mdm.service';
import { LockDeviceDto, UnlockDeviceDto, DeviceStatusDto } from './dto/mdm.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('mdm')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class MdmController {
  constructor(private mdmService: MdmService) {}

  @Get('status')
  @Roles('OWNER')
  getStatus() {
    return this.mdmService.getStatus();
  }

  @Post('lock')
  @Roles('OWNER')
  lockDevice(@Body() dto: LockDeviceDto) {
    return this.mdmService.lockDevice(dto.imei, dto.reason);
  }

  @Post('unlock')
  @Roles('OWNER')
  unlockDevice(@Body() dto: UnlockDeviceDto) {
    return this.mdmService.unlockDevice(dto.imei);
  }

  @Get('device-status')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getDeviceStatus(@Query() dto: DeviceStatusDto) {
    return this.mdmService.getDeviceStatus(dto.imei);
  }

  @Get('devices')
  @Roles('OWNER')
  listDevices(
    @Query('pageNum') pageNum?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ) {
    return this.mdmService.listDevices({
      pageNum: pageNum ? parseInt(pageNum) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
      status: status !== undefined ? parseInt(status) as 0 | 1 | 2 : undefined,
    });
  }
}
