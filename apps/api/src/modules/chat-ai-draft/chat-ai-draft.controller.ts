import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChatAiDraftService } from './chat-ai-draft.service';

@Controller('chat-ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatAiDraftController {
  constructor(private readonly svc: ChatAiDraftService) {}

  @Post('take-over/:roomId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async takeOver(@Param('roomId') id: string, @Req() req: { user: { id: string } }) {
    return this.svc.takeOver(id, req.user.id);
  }

  @Post('release-to-ai/:roomId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async releaseToAi(@Param('roomId') id: string, @Req() req: { user: { id: string } }) {
    return this.svc.releaseToAi(id, req.user.id);
  }
}
