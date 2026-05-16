import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { CreateChartOfAccountDto, UpdateChartOfAccountDto } from './dto/chart-of-account.dto';
import { CoaGroupedQueryDto, CoaGroupedResponse } from './dto/coa-grouped.dto';

@Controller('chart-of-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChartOfAccountsController {
  constructor(private readonly service: ChartOfAccountsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findAll(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    return this.service.findAll({ type, status, q });
  }

  /** T15: Fetch CoA rows by comma-separated code list — used by CashAccountSelect dropdown. */
  @Get('by-codes')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findByCodes(@Query('codes') codes?: string): Promise<{ code: string; name: string }[]> {
    if (!codes) return Promise.resolve([]);
    const codeList = codes.split(',').map((c) => c.trim()).filter(Boolean);
    if (codeList.length > 20) throw new BadRequestException('codes ต้องไม่เกิน 20 รายการ');
    return this.service.findByCodes(codeList);
  }

  @Get('grouped')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  grouped(@Query() query: CoaGroupedQueryDto): Promise<CoaGroupedResponse> {
    return this.service.findGrouped(query);
  }

  /**
   * D1.1.6.2 — Adjustment role mappings (`adj_underpay`, `adj_overpay`) resolved
   * to their current CoA codes. Drives the AdjustmentSection UI hints so the
   * preparer sees the live routing target instead of a hardcoded literal.
   */
  @Get('adjustment-roles')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  adjustmentRoles(): Promise<{ underpay: string; overpay: string }> {
    return this.service.getAdjustmentRoleCodes();
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  create(@Body() dto: CreateChartOfAccountDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  update(@Param('id') id: string, @Body() dto: UpdateChartOfAccountDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'FINANCE_MANAGER')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
