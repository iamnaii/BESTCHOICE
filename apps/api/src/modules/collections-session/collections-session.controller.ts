import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CollectionsSessionService } from './collections-session.service';
import { PoolService } from './pool.service';
import { TeamDashboardService } from './team-dashboard.service';
import { ActionDto } from './dto/action.dto';
import { SkipDto } from './dto/skip.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('collections/session')
export class CollectionsSessionController {
  constructor(
    private session: CollectionsSessionService,
    private pool: PoolService,
    private teamDashboard: TeamDashboardService,
  ) {}

  @Roles('SALES', 'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Get('mine')
  getMine(@CurrentUser() user: any) {
    return this.session.getMySession(user.id);
  }

  @Roles('SALES', 'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Post('start')
  start(@CurrentUser() user: any) {
    return this.session.startSession(user.id);
  }

  @Roles('SALES', 'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Post(':id/action')
  action(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: ActionDto) {
    return this.session.recordAction(id, user.id, dto);
  }

  @Roles('SALES', 'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Post(':id/skip')
  skip(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: SkipDto) {
    return this.session.skip(id, user.id, dto);
  }

  @Roles('SALES', 'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Get('pool')
  poolList(@CurrentUser() user: any) {
    return this.pool.list(user.branchId);
  }

  @Roles('SALES', 'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Post('pool/:id/claim')
  claim(@Param('id') id: string, @CurrentUser() user: any) {
    return this.pool.claim(id, user.id);
  }

  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  @Get('team-dashboard')
  teamDashboardGet(@CurrentUser() user: any) {
    const scope =
      user.role === 'BRANCH_MANAGER' && user.branchId ? [user.branchId] : undefined;
    return this.teamDashboard.getDashboard(scope);
  }
}
