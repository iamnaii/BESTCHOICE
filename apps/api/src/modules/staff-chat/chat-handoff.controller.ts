import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { ChatWorkActor } from '@installment/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WORK_ROLES } from './services/chat-work-access.service';
import { StaffInboxQueryDto } from './dto/staff-inbox.dto';
import {
  AmendChatHandoffDto,
  CreateChatHandoffDto,
  UpdateChatHandoffDto,
} from './dto/chat-handoff.dto';
import { ChatHandoffService } from './services/chat-handoff.service';
@Controller('staff-chat')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WORK_ROLES)
export class ChatHandoffController {
  constructor(private readonly handoffs: ChatHandoffService) {}
  @Post('rooms/:id/handoffs') create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateChatHandoffDto,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.handoffs.create(id, dto, req.user, query);
  }
  @Patch('handoffs/:id/details') amend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AmendChatHandoffDto,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.handoffs.amend(id, dto, req.user, query);
  }
  @Patch('handoffs/:id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChatHandoffDto,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.handoffs.update(id, dto, req.user, query);
  }
}
