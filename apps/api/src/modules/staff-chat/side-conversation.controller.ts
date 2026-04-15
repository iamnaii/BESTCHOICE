import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SideConversationService } from './services/side-conversation.service';

@Controller('staff-chat/side')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SideConversationController {
  constructor(private sideConversation: SideConversationService) {}

  @Post(':roomId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async addMessage(
    @Param('roomId') roomId: string,
    @Body('text') text: string,
    @Req() req: any,
  ) {
    return this.sideConversation.addMessage(roomId, req.user.id, text);
  }

  @Get(':roomId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getMessages(@Param('roomId') roomId: string) {
    return this.sideConversation.getMessages(roomId);
  }

  @Delete('message/:id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  async deleteMessage(@Param('id') id: string) {
    return this.sideConversation.deleteMessage(id);
  }
}
