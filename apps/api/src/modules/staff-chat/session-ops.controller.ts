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

  @Post('rooms/:id/create-ticket')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async createTicket(@Param('id') id: string, @Req() req: any) {
    return this.sessionOps.createTicketFromRoom(id, req.user.id);
  }

  @Post('rooms/merge')
  @Roles('OWNER', 'BRANCH_MANAGER')
  async mergeRooms(
    @Body() body: { primaryRoomId: string; secondaryRoomId: string },
  ) {
    await this.sessionOps.mergeRooms(
      body.primaryRoomId,
      body.secondaryRoomId,
    );
    return { success: true };
  }
}
