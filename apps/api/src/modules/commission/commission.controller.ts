import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CommissionService } from './commission.service';
import { CreateCommissionRuleDto, UpdateCommissionRuleDto } from './dto/commission.dto';
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
  updateRule(@Param('id') id: string, @Body() dto: UpdateCommissionRuleDto) {
    return this.commissionService.updateRule(id, dto);
  }
}
