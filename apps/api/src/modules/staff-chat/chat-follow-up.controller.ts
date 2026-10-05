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
import { CreateChatFollowUpDto, UpdateChatFollowUpDto } from './dto/chat-follow-up.dto';
import { ChatFollowUpService } from './services/chat-follow-up.service';
@Controller('staff-chat')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WORK_ROLES)
export class ChatFollowUpController {
  constructor(private readonly followUps: ChatFollowUpService) {}
  @Post('rooms/:id/follow-ups') create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateChatFollowUpDto,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.followUps.create(id, dto, req.user, query);
  }
  @Patch('follow-ups/:id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChatFollowUpDto,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.followUps.update(id, dto, req.user, query);
  }
}
