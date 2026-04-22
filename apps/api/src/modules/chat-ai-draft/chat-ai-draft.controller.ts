import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChatAiDraftService } from './chat-ai-draft.service';
import { ApproveDraftDto } from './dto/approve-draft.dto';

@Controller('chat-ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatAiDraftController {
  constructor(private readonly svc: ChatAiDraftService) {}

  @Post('draft/:inboundMessageId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async generate(@Param('inboundMessageId') id: string) {
    return this.svc.generateDraft(id);
  }

  @Post('approve')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async approve(@Body() dto: ApproveDraftDto, @Req() req: { user: { id: string } }) {
    return this.svc.approveDraft(dto.draftMessageId, req.user.id, dto.editedText);
  }

  @Post('skip/:draftMessageId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async skip(@Param('draftMessageId') id: string, @Req() req: { user: { id: string } }) {
    return this.svc.skipDraft(id, req.user.id);
  }

  @Post('take-over/:roomId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async takeOver(@Param('roomId') id: string, @Req() req: { user: { id: string } }) {
    return this.svc.takeOver(id, req.user.id);
  }
}
