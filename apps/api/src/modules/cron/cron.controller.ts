import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OverdueService } from '../overdue/overdue.service';

/**
 * Manual trigger endpoints สำหรับ cron jobs
 * Cron jobs ทำงานอัตโนมัติผ่าน CronService (@Cron decorators):
 *   - Late fees:        ทุกวัน 01:00
 *   - Contract statuses: ทุกวัน 02:00
 *   - Dunning escalation: ทุกวัน 03:00
 *
 * Endpoints เหล่านี้ยังคงไว้สำหรับ trigger-on-demand โดย OWNER
 */
@Controller('cron')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CronController {
  constructor(private readonly overdueService: OverdueService) {}

  // ทำงานอัตโนมัติ @Cron('0 1 * * *') — endpoint นี้สำหรับ trigger manual
  @Post('calculate-late-fees')
  @Roles('OWNER')
  calculateLateFees() {
    return this.overdueService.calculateLateFees();
  }

  // ทำงานอัตโนมัติ @Cron('0 2 * * *') — endpoint นี้สำหรับ trigger manual
  @Post('update-contract-statuses')
  @Roles('OWNER')
  updateContractStatuses() {
    return this.overdueService.updateContractStatuses();
  }

  // ทำงานอัตโนมัติ @Cron('0 3 * * *') — endpoint นี้สำหรับ trigger manual
  @Post('escalate-dunning')
  @Roles('OWNER')
  escalateDunning() {
    return this.overdueService.escalateDunningStages();
  }

  @Post('run-daily')
  @Roles('OWNER')
  async runDailyTasks() {
    const lateFees = await this.overdueService.calculateLateFees();
    const statuses = await this.overdueService.updateContractStatuses();
    const dunning = await this.overdueService.escalateDunningStages();
    return { lateFees, statuses, dunning, runAt: new Date() };
  }
}
