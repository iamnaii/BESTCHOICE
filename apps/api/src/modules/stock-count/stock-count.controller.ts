import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { StockCountService } from './stock-count.service';
import { CreateStockCountDto, SubmitStockCountDto } from './dto/stock-count.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('stock-counts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StockCountController {
  constructor(private stockCountService: StockCountService) {}

  @Get()
  findAll(
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.stockCountService.findAll({
      branchId,
      status,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.stockCountService.findOne(id);
  }

  @Get(':id/variance')
  getVariance(@Param('id') id: string) {
    return this.stockCountService.getVariance(id);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER')
  create(
    @Body() dto: CreateStockCountDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.stockCountService.create(dto, user.id);
  }

  @Post(':id/submit')
  @Roles('OWNER', 'BRANCH_MANAGER')
  submit(@Param('id') id: string, @Body() dto: SubmitStockCountDto) {
    return this.stockCountService.submit(id, dto);
  }

  @Post(':id/cancel')
  @Roles('OWNER', 'BRANCH_MANAGER')
  cancel(@Param('id') id: string) {
    return this.stockCountService.cancel(id);
  }
}
