import { Controller, Post, UseGuards } from '@nestjs/common';
import { CronService } from './cron.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('cron')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CronController {
  constructor(private cronService: CronService) {}

  @Post('calculate-late-fees')
  @Roles('OWNER')
  calculateLateFees() {
    return this.cronService.calculateLateFees();
  }

  @Post('update-contract-statuses')
  @Roles('OWNER')
  updateContractStatuses() {
    return this.cronService.updateContractStatuses();
  }

  @Post('run-daily')
  @Roles('OWNER')
  runDailyTasks() {
    return this.cronService.runDailyTasks();
  }
}
