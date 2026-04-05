import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InventoryForecastService } from './inventory-forecast.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Inventory')
@ApiBearerAuth('JWT')
@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryForecastController {
  constructor(private forecastService: InventoryForecastService) {}

  @Get('forecast')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getForecast(@Query('branchId') branchId?: string) {
    return this.forecastService.getInventoryForecast(branchId);
  }
}
