import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ReorderPointsService } from './reorder-points.service';
import { CreateReorderPointDto, UpdateReorderPointDto } from './dto/reorder-point.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('reorder-points')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReorderPointsController {
  constructor(private service: ReorderPointsService) {}

  @Get()
  findAll(
    @Query('branchId') branchId?: string,
    @Query('isActive') isActive?: string,
    @Query('category') category?: string,
  ) {
    return this.service.findAll({
      branchId,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      category,
    });
  }

  @Get('low-stock')
  getLowStockDashboard(@Query('branchId') branchId?: string) {
    return this.service.getLowStockDashboard(branchId);
  }

  @Get('alerts')
  getAlerts(
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getAllAlerts({
      status, branchId,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('alerts/active')
  getActiveAlerts(@Query('branchId') branchId?: string) {
    return this.service.getActiveAlerts(branchId);
  }

  @Post('check-stock')
  @Roles('OWNER')
  checkStockLevels() {
    return this.service.checkStockLevels();
  }

  @Post('alerts/:alertId/resolve')
  @Roles('OWNER', 'BRANCH_MANAGER')
  resolveAlert(
    @Param('alertId') alertId: string,
    @Body('poId') poId?: string,
  ) {
    return this.service.resolveAlert(alertId, poId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER')
  create(@Body() dto: CreateReorderPointDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateReorderPointDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
