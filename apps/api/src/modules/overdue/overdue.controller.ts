import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { OverdueService } from './overdue.service';
import { CreateCallLogDto } from './dto/create-call-log.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('overdue')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OverdueController {
  constructor(private overdueService: OverdueService) {}

  @Get()
  findOverdue(
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.overdueService.findOverdueContracts({
      branchId,
      status,
      search,
      userRole: user.role,
      userBranchId: user.branchId || undefined,
    });
  }

  @Get('summary')
  getSummary(@CurrentUser() user: { role: string; branchId: string | null }) {
    return this.overdueService.getOverdueSummary(user.role, user.branchId || undefined);
  }

  @Get('contracts/:id/timeline')
  getTimeline(@Param('id') id: string) {
    return this.overdueService.getContractTimeline(id);
  }

  @Get('contracts/:id/call-logs')
  getCallLogs(@Param('id') contractId: string) {
    return this.overdueService.getCallLogs(contractId);
  }

  @Post('call-logs')
  createCallLog(
    @Body() dto: CreateCallLogDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.overdueService.createCallLog(dto, user.id);
  }

  @Post('cron/calculate-late-fees')
  @Roles('OWNER')
  calculateLateFees() {
    return this.overdueService.calculateLateFees();
  }

  @Post('cron/update-statuses')
  @Roles('OWNER')
  updateStatuses() {
    return this.overdueService.updateContractStatuses();
  }
}
