import { SalesListQueryDto } from './dto/sales-list-query.dto';
import { bangkokDateString } from '../../utils/date.util';
import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SalesService } from './sales.service';
import { SaleVoidService } from './services/sale-void.service';
import { CreateSaleDto } from './dto/sale.dto';
import { VoidSaleDto } from './dto/void-sale.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { SalesReadActor } from './sales-read.types';

@ApiTags('Sales')
@ApiBearerAuth('JWT')
@Controller('sales')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class SalesController {
  constructor(
    private salesService: SalesService,
    private saleVoidService: SaleVoidService,
  ) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findAll(
    @CurrentUser() user: SalesReadActor,
    @Query() filters: SalesListQueryDto,
  ) {
    return this.salesService.findAll(filters, user);
  }

  @Get('salespersons')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getSalespersons(@CurrentUser() user: SalesReadActor) {
    return this.salesService.getSalespersons(user);
  }

  @Get('config')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  getPosConfig() {
    return this.salesService.getPosConfig();
  }

  @Get('top-products')
  // SALES included — the POS page shows top-selling products to sales staff.
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  getTopProducts(@CurrentUser() user: SalesReadActor) {
    return this.salesService.getTopSellingProducts(user);
  }

  @Get('daily-summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getDailySummary(
    @CurrentUser() user: SalesReadActor,
    @Query('date') date?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.salesService.getDailySummary(
      date || bangkokDateString(),
      user,
      branchId,
    );
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findOne(@Param('id') id: string, @CurrentUser() user: SalesReadActor) {
    return this.salesService.findOne(id, user);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  create(
    @Body() dto: CreateSaleDto,
    @CurrentUser() user: SalesReadActor,
  ) {
    return this.salesService.create(dto, user.id, user.role, user.branchId);
  }

  @Post(':id/void')
  @Roles('OWNER', 'BRANCH_MANAGER')
  voidSale(
    @Param('id') id: string,
    @Body() dto: VoidSaleDto,
    // ส่ง user ทั้งก้อน — service ใช้ role/branchId ทำ branch scope (BranchGuard
    // ไม่ scope route ที่ไม่มี branchId ใน request)
    @CurrentUser() user: { id: string; role: string; branchId?: string },
  ) {
    return this.saleVoidService.voidSale(id, user, dto.reason);
  }
}
