import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/sale.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Sales')
@ApiBearerAuth('JWT')
@Controller('sales')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class SalesController {
  constructor(private salesService: SalesService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findAll(
    @Query('saleType') saleType?: string,
    @Query('branchId') branchId?: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('salespersonId') salespersonId?: string,
    @Query('contractStatus') contractStatus?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: { id: string; role: string },
  ) {
    return this.salesService.findAll({
      saleType,
      branchId,
      search,
      startDate,
      endDate,
      paymentMethod,
      salespersonId,
      contractStatus,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      userRole: user?.role,
    });
  }

  @Get('salespersons')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getSalespersons(@CurrentUser() user: { id: string; role: string; branchId?: string }) {
    return this.salesService.getSalespersons(user);
  }

  @Get('config')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  getPosConfig() {
    return this.salesService.getPosConfig();
  }

  @Get('top-products')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getTopProducts() {
    return this.salesService.getTopSellingProducts();
  }

  @Get('daily-summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getDailySummary(
    @Query('date') date?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.salesService.getDailySummary(
      date || new Date().toISOString().split('T')[0],
      branchId,
    );
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findOne(@Param('id') id: string) {
    return this.salesService.findOne(id);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  create(
    @Body() dto: CreateSaleDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.salesService.create(dto, user.id, user.role);
  }
}
