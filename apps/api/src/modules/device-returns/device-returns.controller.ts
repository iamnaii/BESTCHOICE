import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DeviceReturnStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../repossessions/repossessions.service';
import { DeviceReturnsService } from './device-returns.service';
import { CreateDeviceReturnDto } from './dto/create-device-return.dto';
import { ConfirmDeviceReturnDto } from './dto/confirm-device-return.dto';
import { RejectDeviceReturnDto } from './dto/reject-device-return.dto';
import { PreviewDeviceReturnQueryDto } from './dto/preview-device-return.dto';

const DEVICE_RETURN_STATUSES: readonly DeviceReturnStatus[] = [
  'PENDING_CONFIRM',
  'CONFIRMED',
  'REJECTED',
  'CANCELED',
];

/**
 * ใบรับเครื่องคืน — spec 2026-09-20 §5.0. ทางเข้าเดียวของการยึด/รับคืน (POST /repossessions ถูกลบ).
 * ขอบเขตสาขาของ route `/:id` บังคับใน service (BranchGuard ไม่ครอบ — .claude/rules/security.md);
 * static routes (preview / lookup / awaiting-repossession) ต้องประกาศก่อน `:id`.
 */
@ApiTags('Device Returns')
@ApiBearerAuth('JWT')
@Controller('device-returns')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DeviceReturnsController {
  constructor(private readonly service: DeviceReturnsService) {}

  @Get('preview')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  preview(@Query() query: PreviewDeviceReturnQueryDto, @CurrentUser() user: RequestUser) {
    return this.service.preview(query, user);
  }

  @Get('lookup')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  lookup(@Query('q') q: string, @CurrentUser() user: RequestUser) {
    return this.service.lookup(q ?? '', user);
  }

  @Get('awaiting-repossession')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  awaitingRepossession(@CurrentUser() user: RequestUser) {
    return this.service.awaitingRepossession(user);
  }

  @Get()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES')
  list(
    @CurrentUser() user: RequestUser,
    @Query('status') status?: string,
    @Query('contractId') contractId?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (status && !DEVICE_RETURN_STATUSES.includes(status as DeviceReturnStatus)) {
      throw new BadRequestException('สถานะใบรับเครื่องคืนไม่ถูกต้อง');
    }
    return this.service.list(
      {
        status: status ? (status as DeviceReturnStatus) : undefined,
        contractId: contractId || undefined,
        branchId: branchId || undefined,
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      },
      user,
    );
  }

  @Get(':id')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES')
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  create(@Body() dto: CreateDeviceReturnDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Post(':id/confirm')
  @Roles('OWNER', 'FINANCE_MANAGER')
  confirm(
    @Param('id') id: string,
    @Body() dto: ConfirmDeviceReturnDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.confirm(id, dto, user);
  }

  @Post(':id/reject')
  @Roles('OWNER', 'FINANCE_MANAGER')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectDeviceReturnDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.reject(id, dto, user);
  }

  @Post(':id/cancel')
  @Roles('OWNER', 'BRANCH_MANAGER')
  cancel(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.cancel(id, user);
  }

  @Post(':id/resend-line')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  resendLine(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.resendLine(id, user);
  }
}
