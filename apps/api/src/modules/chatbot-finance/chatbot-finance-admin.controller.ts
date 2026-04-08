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
}
