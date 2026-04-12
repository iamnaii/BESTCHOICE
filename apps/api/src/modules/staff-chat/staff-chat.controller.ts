import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  Delete,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SessionManagerService } from '../chat-engine/services/session-manager.service';
import { AssignmentService } from '../chat-engine/services/assignment.service';
import { ConversationTagService } from '../chat-engine/services/conversation-tag.service';
import { HandoffManagerService } from '../chat-engine/services/handoff-manager.service';
import { StaffMessageService } from './services/staff-message.service';
import { SessionQueryDto } from '../chat-engine/dto/session-query.dto';
import { ChatSessionStatus, ChatChannel, ChatPriority } from '@prisma/client';

@Controller('staff-chat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StaffChatController {
  constructor(
    private sessionManager: SessionManagerService,
    private assignment: AssignmentService,
    private tags: ConversationTagService,
    private handoff: HandoffManagerService,
    private staffMessage: StaffMessageService,
  ) {}

  // ─── Sessions ──────────────────────────────────────────

  @Get('sessions')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async listSessions(@Query() query: SessionQueryDto) {
    return this.sessionManager.listSessions({
      channel: query.channel as ChatChannel | undefined,
      sessionStatus: query.sessionStatus as ChatSessionStatus | undefined,
      priority: query.priority as ChatPriority | undefined,
      assignedToId: query.assignedToId,
      unassignedOnly: query.unassignedOnly,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('sessions/:id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getSession(@Param('id') id: string) {
    return this.sessionManager.findById(id);
  }

  @Get('sessions/:id/messages')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getMessages(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.sessionManager.getRecentMessages(id, limit ? parseInt(limit, 10) : 50);
  }

  // ─── Assignment ────────────────────────────────────────

  @Patch('sessions/:id/assign')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  async assignSession(
    @Param('id') id: string,
    @Body('staffId') staffId: string,
  ) {
    await this.assignment.assign(id, staffId);
    return { success: true };
  }

  @Patch('sessions/:id/transfer')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  async transferSession(
    @Param('id') id: string,
    @Body('toStaffId') toStaffId: string,
    @Req() req: any,
  ) {
    await this.assignment.transfer(id, req.user.id, toStaffId);
    return { success: true };
  }

  @Patch('sessions/:id/resolve')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async resolveSession(@Param('id') id: string, @Req() req: any) {
    await this.assignment.resolve(id, req.user.id);
    return { success: true };
  }

  // ─── Tags ──────────────────────────────────────────────

  @Post('sessions/:id/tags')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async addTag(
    @Param('id') id: string,
    @Body('tag') tag: string,
  ) {
    await this.tags.addTag(id, tag);
    return { success: true };
  }

  @Delete('sessions/:id/tags/:tag')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async removeTag(@Param('id') id: string, @Param('tag') tag: string) {
    await this.tags.removeTag(id, tag);
    return { success: true };
  }

  @Get('tags')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getAllTags() {
    return this.tags.getAllUniqueTags();
  }

  // ─── Notes ─────────────────────────────────────────────

  @Post('sessions/:id/notes')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async addNote(
    @Param('id') id: string,
    @Body('content') content: string,
    @Req() req: any,
  ) {
    return this.staffMessage.addNote(id, req.user.id, content);
  }

  @Get('sessions/:id/notes')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getNotes(@Param('id') id: string) {
    return this.staffMessage.getNotes(id);
  }

  // ─── Canned Responses ─────────────────────────────────

  @Get('canned-responses')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getCannedResponses(@Query('category') category?: string) {
    return this.staffMessage.getCannedResponses(category);
  }

  // ─── Handoff ───────────────────────────────────────────

  @Patch('sessions/:id/return-to-ai')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  async returnToAI(@Param('id') id: string) {
    await this.handoff.resolveHandoff(id, true);
    return { success: true };
  }

  // ─── Presence ──────────────────────────────────────────

  @Get('staff/online')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getOnlineStaff() {
    return this.assignment.getStaffSessionCounts();
  }
}
