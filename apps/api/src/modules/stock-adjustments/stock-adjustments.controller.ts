import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { StockAdjustmentsService } from './stock-adjustments.service';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('stock-adjustments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StockAdjustmentsController {
  constructor(private stockAdjustmentsService: StockAdjustmentsService) {}

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER')
  create(
    @Body() dto: CreateStockAdjustmentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.stockAdjustmentsService.create(dto, user.id);
  }

  @Get()
  findAll(
    @Query('branchId') branchId?: string,
    @Query('reason') reason?: string,
    @Query('productId') productId?: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.stockAdjustmentsService.findAll({
      branchId,
      reason,
      productId,
      search,
      startDate,
      endDate,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('summary')
  getSummary(
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stockAdjustmentsService.getSummary({ branchId, startDate, endDate });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.stockAdjustmentsService.findOne(id);
  }
}
