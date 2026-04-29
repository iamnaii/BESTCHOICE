import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { CreateChartOfAccountDto, UpdateChartOfAccountDto } from './dto/chart-of-account.dto';
import { AccountGroup } from '@prisma/client';

@Controller('chart-of-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChartOfAccountsController {
  constructor(private readonly service: ChartOfAccountsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findAll(
    @Query('group') group?: AccountGroup,
    @Query('active') active?: string,
    @Query('q') q?: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.service.findAll({
      group,
      active: active != null ? active === 'true' : undefined,
      q,
      companyId: companyId === 'SHARED' ? 'SHARED' : companyId,
    });
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
