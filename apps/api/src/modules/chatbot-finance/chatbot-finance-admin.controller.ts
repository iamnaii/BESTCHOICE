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
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminAnalyticsService } from './services/admin-analytics.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatChannel } from '@prisma/client';

class ListSessionsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limit = 20;

  @IsOptional() @IsString()
  search?: string;

  @IsOptional() @Type(() => Boolean) @IsBoolean()
  handoffOnly?: boolean;
}

class UpsertKbDto {
  @IsString() intent!: string;
  @IsString() category!: string;
  @IsArray() @IsString({ each: true }) triggerKeywords!: string[];
  @IsArray() @IsString({ each: true }) exampleQuestions!: string[];
  @IsString() responseTemplate!: string;
  @IsString() responseType!: string; // 'auto' | 'handoff' | 'info'
  @IsOptional() @IsBoolean() requiresAuth?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) requiresTools?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() priority?: number;
}

/**
 * Admin endpoints สำหรับ Finance Bot
 *
 * Routes:
 *   GET    /api/chatbot/finance/admin/analytics
 *   GET    /api/chatbot/finance/admin/sessions
 *   GET    /api/chatbot/finance/admin/sessions/:id
 *   POST   /api/chatbot/finance/admin/sessions/:id/return-to-bot
 *   GET    /api/chatbot/finance/admin/knowledge
 *   POST   /api/chatbot/finance/admin/knowledge
 *   PATCH  /api/chatbot/finance/admin/knowledge/:id
 *   DELETE /api/chatbot/finance/admin/knowledge/:id
 */
@Controller('chatbot/finance/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatbotFinanceAdminController {
  constructor(
    private analytics: AdminAnalyticsService,
    private prisma: PrismaService,
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
  async listSessions(@Query() query: ListSessionsQuery) {
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

  // ─── Knowledge Base CRUD ─────────────────────────────────

  @Get('knowledge')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async listKnowledge() {
    return this.prisma.chatKnowledgeBase.findMany({
      where: { channel: ChatChannel.LINE_FINANCE, deletedAt: null },
      orderBy: [{ priority: 'desc' }, { intent: 'asc' }],
    });
  }

  @Post('knowledge')
  @HttpCode(201)
  @Roles('OWNER', 'FINANCE_MANAGER')
  async createKnowledge(@Body() dto: UpsertKbDto) {
    return this.prisma.chatKnowledgeBase.create({
      data: {
        channel: ChatChannel.LINE_FINANCE,
        intent: dto.intent,
        category: dto.category,
        triggerKeywords: dto.triggerKeywords,
        exampleQuestions: dto.exampleQuestions,
        responseTemplate: dto.responseTemplate,
        responseType: dto.responseType,
        requiresAuth: dto.requiresAuth ?? true,
        requiresTools: dto.requiresTools ?? [],
        active: dto.active ?? true,
        priority: dto.priority ?? 0,
      },
    });
  }

  @Patch('knowledge/:id')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async updateKnowledge(@Param('id') id: string, @Body() dto: Partial<UpsertKbDto>) {
    return this.prisma.chatKnowledgeBase.update({
      where: { id },
      data: {
        ...(dto.intent !== undefined && { intent: dto.intent }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.triggerKeywords !== undefined && { triggerKeywords: dto.triggerKeywords }),
        ...(dto.exampleQuestions !== undefined && { exampleQuestions: dto.exampleQuestions }),
        ...(dto.responseTemplate !== undefined && { responseTemplate: dto.responseTemplate }),
        ...(dto.responseType !== undefined && { responseType: dto.responseType }),
        ...(dto.requiresAuth !== undefined && { requiresAuth: dto.requiresAuth }),
        ...(dto.requiresTools !== undefined && { requiresTools: dto.requiresTools }),
        ...(dto.active !== undefined && { active: dto.active }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
      },
    });
  }

  @Delete('knowledge/:id')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async deleteKnowledge(@Param('id') id: string) {
    // Soft delete
    return this.prisma.chatKnowledgeBase.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });
  }
}
