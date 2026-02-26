import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OverdueService } from '../overdue/overdue.service';

@Controller('cron')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CronController {
  constructor(private overdueService: OverdueService) {}

  @Post('calculate-late-fees')
  @Roles('OWNER')
  calculateLateFees() {
    return this.overdueService.calculateLateFees();
  }

  @Post('update-contract-statuses')
  @Roles('OWNER')
  updateContractStatuses() {
    return this.overdueService.updateContractStatuses();
  }

  @Post('run-daily')
  @Roles('OWNER')
  async runDailyTasks() {
    const lateFees = await this.overdueService.calculateLateFees();
    const statuses = await this.overdueService.updateContractStatuses();
    return { lateFees, statuses, runAt: new Date() };
  }
}
