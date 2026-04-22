import { BadRequestException, Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShopInstallmentApplyService } from './shop-installment-apply.service';
import { ScheduleApplicationDto } from './dto/schedule-application.dto';
import { DecideApplicationDto } from './dto/decide-application.dto';

@Controller('admin/installment-applications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
export class ShopInstallmentApplyAdminController {
  constructor(private service: ShopInstallmentApplyService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.service.adminList(status);
  }

  @Patch(':id/schedule')
  schedule(
    @Param('id') id: string,
    @Body() dto: ScheduleApplicationDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.service.schedule(id, new Date(dto.scheduledAt), req.user.id);
  }

  @Patch(':id/approve')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  approve(@Param('id') id: string, @Req() req: { user: { id: string } }) {
    return this.service.approve(id, req.user.id);
  }

  @Patch(':id/reject')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  reject(
    @Param('id') id: string,
    @Body() dto: DecideApplicationDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.service.reject(id, req.user.id, dto.rejectReason ?? '');
  }

  @Patch(':id/link-contract')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  linkContract(@Param('id') id: string, @Body() dto: DecideApplicationDto) {
    if (!dto.contractId) {
      throw new BadRequestException('กรุณาระบุ contractId');
    }
    return this.service.linkContract(id, dto.contractId);
  }
}
