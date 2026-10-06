import { Body, Controller, Get, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ChatWorkActor } from '@installment/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WORK_ROLES } from './services/chat-work-access.service';
import { ChatWorkSettingsService } from './services/chat-work-settings.service';
import { StaffInboxQueryDto } from './dto/staff-inbox.dto';
import { UpdateChatWorkSettingsDto } from './dto/chat-work-settings.dto';
@Controller('staff-chat/work-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatWorkSettingsController {
  constructor(private readonly settings: ChatWorkSettingsService) {}
  @Get()
  @Roles(...WORK_ROLES)
  read(@Req() req: { user: ChatWorkActor }, @Query() query: StaffInboxQueryDto) {
    return this.settings.read(req.user, query);
  }
  @Patch()
  @Roles('OWNER')
  update(@Req() req: { user: ChatWorkActor }, @Body() input: UpdateChatWorkSettingsDto) {
    return this.settings.update(req.user, input);
  }
}
