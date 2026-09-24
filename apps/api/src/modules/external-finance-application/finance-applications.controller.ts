import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FinanceApplicationService } from './services/finance-application.service';
import { UpdateFinanceApplicationDto } from './dto/finance-application.dto';
import { FinanceActor } from './constants';

@Controller('finance-applications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
export class FinanceApplicationsController {
  constructor(private applications: FinanceApplicationService) {}

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: FinanceActor }) {
    return this.applications.get(id, req.user);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFinanceApplicationDto, @Req() req: { user: FinanceActor }) {
    return this.applications.update(id, dto, req.user);
  }
}
