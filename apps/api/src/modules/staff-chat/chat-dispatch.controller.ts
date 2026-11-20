import { Body, Controller, Get, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ChatReadinessDto, ChatReadinessHeartbeatDto } from './dto/chat-dispatch.dto';
import type { ChatWorkActor } from '@installment/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WORK_ROLES } from './services/chat-work-access.service';
import { StaffInboxQueryDto } from './dto/staff-inbox.dto';
import { ChatDispatchService } from '../chat-engine/services/chat-dispatch.service';
@Controller('staff-chat/dispatch')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WORK_ROLES)
export class ChatDispatchController {
  constructor(private readonly dispatch: ChatDispatchService) {}
  @Get() read(@Req() req: { user: ChatWorkActor }, @Query() scope: StaffInboxQueryDto) {
    return this.dispatch.read(req.user, scope);
  }
  @Patch('readiness') ready(
    @Req() req: { user: ChatWorkActor },
    @Query() scope: StaffInboxQueryDto,
    @Body() body: ChatReadinessDto,
  ) {
    return this.dispatch.setReady(req.user, scope, body.ready);
  }
  @Post('heartbeat') heartbeat(
    @Req() req: { user: ChatWorkActor },
    @Query() scope: StaffInboxQueryDto,
    @Body() body: ChatReadinessHeartbeatDto,
  ) {
    return this.dispatch.heartbeat(req.user, scope, body.generation);
  }
}
