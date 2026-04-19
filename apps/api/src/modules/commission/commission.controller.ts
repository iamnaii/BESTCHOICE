import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CommissionService } from './commission.service';
import { CreateCommissionRuleDto, UpdateCommissionRuleDto } from './dto/commission.dto';
import { GeneratePayoutDto, ApprovePayoutDto } from './dto/commission-payout.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Commissions')
@ApiBearerAuth('JWT')
@Controller('commissions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CommissionController {
  constructor(private commissionService: CommissionService) {}

  @Get()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findAll(
    @CurrentUser() user: { id: string; role: string },
    @Query('salespersonId') salespersonId?: string,
    @Query('period') period?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // SALES role can only see their own commissions
    const effectiveSalespersonId = user.role === 'SALES' ? user.id : salespersonId;

    return this.commissionService.findAll({
      salespersonId: effectiveSalespersonId,
      period,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('summary')
  @Roles('OWNER', 'FINANCE_MANAGER')
  getSummary(
    @Query('period') period?: string,
    @Query('salespersonId') salespersonId?: string,
  ) {
    return this.commissionService.getSummary(period, salespersonId);
  }

  @Post(':id/approve')
  @Roles('OWNER', 'FINANCE_MANAGER')
  approve(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.commissionService.approve(id, user.id);
  }

  @Post(':id/pay')
  @Roles('OWNER', 'FINANCE_MANAGER')
  markPaid(@Param('id') id: string) {
    return this.commissionService.markPaid(id);
  }

  @Get('rules')
  @Roles('OWNER')
  findAllRules() {
    return this.commissionService.findAllRules();
  }

  @Post('rules')
  @Roles('OWNER')
  createRule(@Body() dto: CreateCommissionRuleDto) {
    return this.commissionService.createRule(dto);
  }

  @Patch('rules/:id')
  @Roles('OWNER')
  updateRule(
    @Param('id') id: string,
    @Body() dto: UpdateCommissionRuleDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.commissionService.updateRule(id, dto, user.id);
  }

  // ============================================================
  // PAYOUT ENDPOINTS (Phase 5)
  // ============================================================

  @Get('payouts')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findPayouts(
    @Query('userId') userId?: string,
    @Query('status') status?: string,
    @Query('period') period?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.commissionService.findPayouts({
      userId,
      status,
      period,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('payouts/summary')
  @Roles('OWNER', 'FINANCE_MANAGER')
  getPayoutSummary(@Query('period') period: string) {
    return this.commissionService.getPayoutSummary(period || '');
  }

  @Post('payouts/generate')
  @Roles('OWNER')
  generatePayouts(@Body() dto: GeneratePayoutDto) {
    return this.commissionService.generatePayouts(dto);
  }

  @Patch('payouts/:id/approve')
  @Roles('OWNER')
  approvePayout(
    @Param('id') id: string,
    @Body() dto: ApprovePayoutDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.commissionService.approvePayout(id, user.id, dto);
  }

  @Patch('payouts/:id/paid')
  @Roles('OWNER')
  markPayoutPaid(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.commissionService.markPayoutPaid(id, user.id);
  }
}
