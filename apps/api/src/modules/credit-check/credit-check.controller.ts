import { Controller, Get, Post, Param, Body, UseGuards, Query } from '@nestjs/common';
import { CreditCheckService } from './credit-check.service';
import { RiskScoringService } from './risk-scoring.service';
import { CreateCreditCheckDto, OverrideCreditCheckDto } from './dto/credit-check.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { PredictiveRiskService } from './predictive-risk.service';

// === Global credit check list ===
@Controller('credit-checks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GlobalCreditCheckController {
  constructor(
    private service: CreditCheckService,
    private prisma: PrismaService,
  ) {}

  @Get('analytics/score-distribution')
  @Roles('OWNER', 'BRANCH_MANAGER')
  async getScoreDistribution() {
    const checks = await this.prisma.creditCheck.findMany({
      where: { deletedAt: null, aiScore: { not: null } },
      select: { aiScore: true },
    });

    const ranges = [
      { range: '0-20', min: 0, max: 20 },
      { range: '21-40', min: 21, max: 40 },
      { range: '41-60', min: 41, max: 60 },
      { range: '61-80', min: 61, max: 80 },
      { range: '81-100', min: 81, max: 100 },
    ];

    const distribution = ranges.map((r) => ({
      range: r.range,
      count: checks.filter((c) => (c.aiScore ?? 0) >= r.min && (c.aiScore ?? 0) <= r.max).length,
    }));

    const totalScore = checks.reduce((s, c) => s + (c.aiScore ?? 0), 0);
    return {
      distribution,
      avgScore: checks.length > 0 ? Math.round(totalScore / checks.length) : 0,
      totalChecked: checks.length,
    };
  }

  @Get('analytics/risk-overview')
  @Roles('OWNER', 'BRANCH_MANAGER')
  async getRiskOverview() {
    const checks = await this.prisma.creditCheck.findMany({
      where: { deletedAt: null, aiScore: { not: null } },
      select: {
        id: true,
        aiScore: true,
        aiRecommendation: true,
        createdAt: true,
        customer: { select: { name: true } },
        contract: { select: { contractNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const total = checks.length;
    const lowRisk = checks.filter((c) => (c.aiScore ?? 0) >= 80).length;
    const medRisk = checks.filter((c) => (c.aiScore ?? 0) >= 50 && (c.aiScore ?? 0) < 80).length;
    const highRisk = checks.filter((c) => (c.aiScore ?? 0) < 50).length;

    const riskLevels = [
      { level: 'LOW_RISK', label: 'ความเสี่ยงต่ำ', count: lowRisk, percentage: total > 0 ? Math.round((lowRisk / total) * 100) : 0 },
      { level: 'MEDIUM_RISK', label: 'ความเสี่ยงปานกลาง', count: medRisk, percentage: total > 0 ? Math.round((medRisk / total) * 100) : 0 },
      { level: 'HIGH_RISK', label: 'ความเสี่ยงสูง', count: highRisk, percentage: total > 0 ? Math.round((highRisk / total) * 100) : 0 },
    ];

    const recentChecks = checks.slice(0, 20).map((c) => ({
      id: c.id,
      customerName: c.customer?.name || '-',
      contractNumber: c.contract?.contractNumber || '-',
      score: c.aiScore ?? 0,
      riskLevel: (c.aiScore ?? 0) >= 80 ? 'LOW_RISK' : (c.aiScore ?? 0) >= 50 ? 'MEDIUM_RISK' : 'HIGH_RISK',
      recommendation: c.aiRecommendation || '-',
      createdAt: c.createdAt.toISOString(),
    }));

    return { riskLevels, recentChecks, total };
  }

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  findAll(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('branchId') branchId?: string,
    @Query('checkedById') checkedById?: string,
  ) {
    return this.service.findAll({
      status,
      search,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      startDate,
      endDate,
      branchId,
      checkedById,
    });
  }
}

// === Contract-level credit check ===
@Controller('contracts/:contractId/credit-check')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CreditCheckController {
  constructor(private service: CreditCheckService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  findByContract(@Param('contractId') contractId: string) {
    return this.service.findByContract(contractId);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  create(
    @Param('contractId') contractId: string,
    @Body() dto: CreateCreditCheckDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.create(contractId, dto, user.id);
  }

  @Post('analyze')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  analyze(@Param('contractId') contractId: string) {
    return this.service.analyze(contractId);
  }

  @Post('override')
  @Roles('OWNER', 'BRANCH_MANAGER')
  override(
    @Param('contractId') contractId: string,
    @Body() dto: OverrideCreditCheckDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.override(contractId, dto, user.id);
  }
}

// === Customer-level credit check (เช็คก่อนทำสัญญา) ===
@Controller('customers/:customerId/credit-check')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerCreditCheckController {
  constructor(private service: CreditCheckService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  findByCustomer(@Param('customerId') customerId: string) {
    return this.service.findByCustomer(customerId);
  }

  @Get('latest')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  findLatest(@Param('customerId') customerId: string) {
    return this.service.findLatestByCustomer(customerId);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  create(
    @Param('customerId') customerId: string,
    @Body() dto: CreateCreditCheckDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.createForCustomer(customerId, dto, user.id);
  }

  @Post(':creditCheckId/analyze')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  analyze(@Param('creditCheckId') creditCheckId: string) {
    return this.service.analyzeForCustomer(creditCheckId);
  }

  @Post(':creditCheckId/override')
  @Roles('OWNER', 'BRANCH_MANAGER')
  override(
    @Param('creditCheckId') creditCheckId: string,
    @Body() dto: OverrideCreditCheckDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.overrideById(creditCheckId, dto, user.id);
  }
}

// === Risk Score ===
@Controller('credit-check')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RiskScoreController {
  constructor(
    private riskScoringService: RiskScoringService,
    private predictiveRiskService: PredictiveRiskService,
  ) {}

  @Get('risk-score/:customerId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  getRiskScore(@Param('customerId') customerId: string) {
    return this.riskScoringService.calculateRiskScore(customerId);
  }

  @Get('risk-distribution')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getRiskDistribution(@Query('branchId') branchId?: string) {
    return this.riskScoringService.getPortfolioRiskDistribution(branchId || undefined);
  }

  @Get('predict/:customerId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  predictCustomerRisk(@Param('customerId') customerId: string) {
    return this.predictiveRiskService.predictDefaultRisk(customerId);
  }

  @Get('portfolio-risk')
  @Roles('OWNER')
  getPortfolioRisk() {
    return this.predictiveRiskService.batchScorePortfolio();
  }
}
