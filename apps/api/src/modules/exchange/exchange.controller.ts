import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { CreateExchangeDto } from './dto/create-exchange.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('exchange')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExchangeController {
  constructor(private exchangeService: ExchangeService) {}

  @Get('quote')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getQuote(
    @Query('oldContractId') oldContractId: string,
    @Query('newProductId') newProductId: string,
    @Query('newPriceId') newPriceId: string,
  ) {
    return this.exchangeService.getExchangeQuote(oldContractId, newProductId, newPriceId);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER')
  executeExchange(
    @Body() dto: CreateExchangeDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.exchangeService.executeExchange(dto, user.id);
  }
}
