import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { MdmService } from './mdm.service';
import { LockDeviceDto, UnlockDeviceDto } from './dto/mdm.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('MDM PJ-Soft')
@ApiBearerAuth('JWT')
@Controller('mdm')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class MdmController {
  constructor(private mdmService: MdmService) {}

  @Get('status')
  @Roles('OWNER')
  @ApiOperation({ summary: 'ตรวจสอบสถานะการเชื่อมต่อ MDM PJ-Soft' })
  getStatus() {
    const configured = this.mdmService.isConfigured();
    return {
      configured,
      message: configured ? 'MDM PJ-Soft connected' : 'ยังไม่ได้ตั้งค่า MDM API',
    };
  }

  @Post('lock')
  @Roles('OWNER')
  @ApiOperation({ summary: 'ล็อคเครื่องผ่าน MDM PJ-Soft (กรณีค้างชำระ)' })
  lockDevice(@Body() dto: LockDeviceDto) {
    return this.mdmService.lockDevice(dto.imei, dto.reason);
  }

  @Post('unlock')
  @Roles('OWNER')
  @ApiOperation({ summary: 'ปลดล็อคเครื่องผ่าน MDM PJ-Soft (กรณีชำระครบ)' })
  unlockDevice(@Body() dto: UnlockDeviceDto) {
    return this.mdmService.unlockDevice(dto.imei);
  }

  @Get('device-status')
  @Roles('OWNER')
  @ApiOperation({ summary: 'ตรวจสอบสถานะล็อคของเครื่องตาม IMEI' })
  getDeviceStatus(@Body() dto: { imei: string }) {
    return this.mdmService.getDeviceStatus(dto.imei);
  }
}
