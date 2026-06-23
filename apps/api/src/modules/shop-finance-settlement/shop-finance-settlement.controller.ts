import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShopFinanceSettlementService } from './shop-finance-settlement.service';
import { SettleFinanceDto } from './dto/finance-settlement.dto';

@ApiTags('Shop Finance Settlement')
@ApiBearerAuth('JWT')
@Controller('shop/finance-settlements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShopFinanceSettlementController {
  constructor(private readonly service: ShopFinanceSettlementService) {}

  @Post()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  settle(@Body() dto: SettleFinanceDto) {
    return this.service.settle(dto);
  }

  @Get('pending')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  pending() {
    return this.service.listPending();
  }
}
