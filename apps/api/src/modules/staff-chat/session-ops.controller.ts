import {
  Controller,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SessionOpsService } from './services/session-ops.service';

@Controller('staff-chat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SessionOpsController {
  constructor(private sessionOps: SessionOpsService) {}

  @Post('sessions/:id/create-ticket')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async createTicket(@Param('id') id: string, @Req() req: any) {
    return this.sessionOps.createTicketFromSession(id, req.user.id);
  }

  @Post('sessions/merge')
  @Roles('OWNER', 'BRANCH_MANAGER')
  async mergeSessions(
    @Body() body: { primarySessionId: string; secondarySessionId: string },
  ) {
    await this.sessionOps.mergeSessions(
      body.primarySessionId,
      body.secondarySessionId,
    );
    return { success: true };
  }
}
