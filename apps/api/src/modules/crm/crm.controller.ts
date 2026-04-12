import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CrmPipelineService } from './services/crm-pipeline.service';
import { CustomerScoringService } from './services/customer-scoring.service';
import { LeadStage, LeadSource } from '@prisma/client';

@Controller('crm')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CrmController {
  constructor(
    private pipeline: CrmPipelineService,
    private scoring: CustomerScoringService,
  ) {}

  // ─── Pipeline ──────────────────────────────────────────

  @Get('leads')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async listLeads(
    @Query('stage') stage?: LeadStage,
    @Query('assignedTo') assignedToId?: string,
    @Query('branch') branchId?: string,
    @Query('source') source?: LeadSource,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.pipeline.listLeads({
      stage,
      assignedToId,
      branchId,
      source,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('leads')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async createLead(@Body() body: any) {
    return this.pipeline.createLead(body);
  }

  @Get('leads/:id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getLead(@Param('id') id: string) {
    return this.pipeline.findById(id);
  }

  @Patch('leads/:id/stage')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async moveStage(
    @Param('id') id: string,
    @Body('stage') stage: LeadStage,
    @Body('lostReason') lostReason?: string,
  ) {
    return this.pipeline.moveStage(id, stage, lostReason);
  }

  @Patch('leads/:id/assign')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  async assignLead(
    @Param('id') id: string,
    @Body('staffId') staffId: string,
  ) {
    return this.pipeline.assignLead(id, staffId);
  }

  @Post('leads/:id/notes')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async addNote(
    @Param('id') id: string,
    @Body('staffId') staffId: string,
    @Body('content') content: string,
  ) {
    return this.pipeline.addNote(id, staffId, content);
  }

  @Get('dashboard')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  async getDashboard(@Query('branchId') branchId?: string) {
    return this.pipeline.getDashboard(branchId);
  }

  // ─── Customer Scoring ──────────────────────────────────

  @Get('customers/:id/score')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getCustomerScore(@Param('id') customerId: string) {
    return this.scoring.getScore(customerId);
  }

  @Post('customers/scores/recalculate')
  @Roles('OWNER')
  async recalculateScores() {
    await this.scoring.recalculateAll();
    return { success: true, message: 'คำนวณคะแนนเสร็จแล้ว' };
  }
}
