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

  @Post(':sessionId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async addMessage(
    @Param('sessionId') sessionId: string,
    @Body('text') text: string,
    @Req() req: any,
  ) {
    return this.sideConversation.addMessage(sessionId, req.user.id, text);
  }

  @Get(':sessionId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getMessages(@Param('sessionId') sessionId: string) {
    return this.sideConversation.getMessages(sessionId);
  }

  @Delete('message/:id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  async deleteMessage(@Param('id') id: string) {
    return this.sideConversation.deleteMessage(id);
  }
}
