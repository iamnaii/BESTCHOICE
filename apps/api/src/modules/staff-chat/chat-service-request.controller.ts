import {
  Body,
  Controller,
  Get,
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
  CreateChatServiceRequestDto,
  UpdateChatServiceRequestDto,
} from './dto/chat-service-request.dto';
import { ChatServiceRequestService } from './services/chat-service-request.service';
@Controller('staff-chat')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WORK_ROLES)
export class ChatServiceRequestController {
  constructor(private readonly service: ChatServiceRequestService) {}
  @Post('rooms/:id/service-requests') create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CreateChatServiceRequestDto,
    @Req() req: { user: ChatWorkActor },
    @Query() scope: StaffInboxQueryDto,
  ) {
    return this.service.create(id, input, req.user, scope);
  }
  @Get('rooms/:id/service-requests') list(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: ChatWorkActor },
    @Query() scope: StaffInboxQueryDto,
  ) {
    return this.service.list(id, req.user, scope, scope.page, scope.limit);
  }
  @Get('service-requests/:id') get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: ChatWorkActor },
    @Query() scope: StaffInboxQueryDto,
  ) {
    return this.service.get(id, req.user, scope);
  }
  @Patch('service-requests/:id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateChatServiceRequestDto,
    @Req() req: { user: ChatWorkActor },
    @Query() scope: StaffInboxQueryDto,
  ) {
    return this.service.update(id, input, req.user, scope);
  }
}
