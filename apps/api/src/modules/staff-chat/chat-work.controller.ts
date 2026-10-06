import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import type { ChatWorkActor } from '@installment/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WORK_ROLES } from './services/chat-work-access.service';
import { ChatWorkQueryService } from './services/chat-work-query.service';
import { ChatWorkQueryDto } from './dto/chat-work-query.dto';
import { StaffInboxQueryDto } from './dto/staff-inbox.dto';
@Controller('staff-chat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatWorkController {
  constructor(private readonly work: ChatWorkQueryService) {}
  @Get('work') @Roles(...WORK_ROLES)
  list(@Req() req: { user: ChatWorkActor }, @Query() query: ChatWorkQueryDto) { return this.work.list(req.user, query); }
  @Get('work-targets/:type/:id') @Roles(...WORK_ROLES)
  target(@Req() req: { user: ChatWorkActor }, @Query() query: StaffInboxQueryDto, @Param('type') type: string, @Param('id', ParseUUIDPipe) id: string) { return this.work.target(req.user, query, type, id); }
}
