import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import type { ChatWorkActor } from '@installment/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WORK_ROLES } from './services/chat-work-access.service';
import { StaffInboxQueryDto } from './dto/staff-inbox.dto';
import { ChatSalesContextService } from './services/chat-sales-context.service';
@Controller('staff-chat/rooms/:id/sales-context')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WORK_ROLES)
export class ChatSalesContextController {
  constructor(private readonly context: ChatSalesContextService) {}
  @Get('credit/:analysisId') credit(@Param('id', ParseUUIDPipe) id: string, @Param('analysisId', ParseUUIDPipe) analysisId: string, @Req() req: { user: ChatWorkActor }, @Query() query: StaffInboxQueryDto) { return this.context.creditEvidence(id, analysisId, req.user, query); }
  @Get() get(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: ChatWorkActor }, @Query() query: StaffInboxQueryDto) { return this.context.get(id, req.user, query); }
}
