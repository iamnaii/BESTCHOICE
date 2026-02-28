import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/sale.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('sales')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesController {
  constructor(private salesService: SalesService) {}

  @Get()
  findAll(
    @Query('saleType') saleType?: string,
    @Query('branchId') branchId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.salesService.findAll({
      saleType,
      branchId,
      search,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('config')
  getPosConfig() {
    return this.salesService.getPosConfig();
  }

  @Get('daily-summary')
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
  findOne(@Param('id') id: string) {
    return this.salesService.findOne(id);
  }

  @Post()
  create(
    @Body() dto: CreateSaleDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.salesService.create(dto, user.id);
  }
}
