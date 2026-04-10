import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminAnalyticsService } from './services/admin-analytics.service';
import { KnowledgeService } from './services/knowledge.service';
import { LearningService } from './services/learning.service';
import { FeedbackService } from './services/feedback.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  ListSessionsQueryDto,
  CreateKbDto,
  UpdateKbDto,
} from './dto/admin.dto';

/**
 * Admin endpoints สำหรับ Finance Bot
 *
 * Routes:
 *   GET    /admin/analytics
 *   GET    /admin/sessions
 *   GET    /admin/sessions/:id
 *   POST   /admin/sessions/:id/return-to-bot
 *   GET    /admin/knowledge
 *   POST   /admin/knowledge
 *   PATCH  /admin/knowledge/:id
 *   DELETE /admin/knowledge/:id
 */
@Controller('chatbot/finance/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatbotFinanceAdminController {
  constructor(
    private analytics: AdminAnalyticsService,
    private knowledge: KnowledgeService,
    private learning: LearningService,
    private feedbackService: FeedbackService,
  ) {}

  // ─── Analytics ───────────────────────────────────────────

  @Get('analytics')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async getAnalytics() {
    return this.analytics.getOverview();
  }

  // ─── Sessions ────────────────────────────────────────────

  @Get('sessions')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async listSessions(@Query() query: ListSessionsQueryDto) {
    return this.analytics.listSessions({
      page: query.page,
      limit: query.limit,
      search: query.search,
      handoffOnly: query.handoffOnly,
    });
  }

  @Get('sessions/:id')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async getSession(@Param('id') id: string) {
    return this.analytics.getSessionDetail(id);
  }

  @Post('sessions/:id/return-to-bot')
  @HttpCode(200)
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async returnToBot(@Param('id') id: string) {
    // Extract learning from handoff before returning to bot
    await this.learning.extractFromHandoff(id);
    return this.analytics.returnToBot(id);
  }

  // ─── Knowledge Base CRUD (delegated to KnowledgeService) ─

  @Get('knowledge')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async listKnowledge() {
    return this.knowledge.listAll();
  }

  @Post('knowledge')
  @HttpCode(201)
  @Roles('OWNER', 'FINANCE_MANAGER')
  async createKnowledge(@Body() dto: CreateKbDto) {
    return this.knowledge.create(dto);
  }

  @Patch('knowledge/:id')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async updateKnowledge(@Param('id') id: string, @Body() dto: UpdateKbDto) {
    return this.knowledge.update(id, dto);
  }

  @Delete('knowledge/:id')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async deleteKnowledge(@Param('id') id: string) {
    return this.knowledge.remove(id);
  }

  // ─── Learning Hub ───────────────────────────────────────

  @Get('learning/stats')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async getLearningStats() {
    return this.learning.getStats();
  }

  @Get('learning/suggestions')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async listSuggestions(
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.learning.listSuggestions({ status, source, page: +page, limit: +limit });
  }

  @Post('learning/suggestions/:id/approve')
  @HttpCode(200)
  @Roles('OWNER', 'FINANCE_MANAGER')
  async approveSuggestion(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.learning.approveSuggestion(id, userId);
    return { ok: true };
  }

  @Post('learning/suggestions/:id/reject')
  @HttpCode(200)
  @Roles('OWNER', 'FINANCE_MANAGER')
  async rejectSuggestion(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.learning.rejectSuggestion(id, userId);
    return { ok: true };
  }

  @Get('learning/feedback-stats')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async getFeedbackStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400_000);
    const end = endDate ? new Date(endDate) : new Date();
    return this.feedbackService.getStats(start, end);
  }
}
