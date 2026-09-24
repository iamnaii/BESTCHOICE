import { Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FinanceApplicationService } from './services/finance-application.service';
import { FinanceActor } from './constants';

@Controller('staff-chat/rooms/:roomId/finance-applications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
export class RoomFinanceApplicationsController {
  constructor(private applications: FinanceApplicationService) {}

  @Get()
  list(@Param('roomId', ParseUUIDPipe) roomId: string, @Req() req: { user: FinanceActor }) {
    return this.applications.listForRoom(roomId, req.user);
  }

  @Post()
  create(@Param('roomId', ParseUUIDPipe) roomId: string, @Req() req: { user: FinanceActor }) {
    return this.applications.createDraft(roomId, req.user);
  }
}
