import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TradeInService } from './trade-in.service';
import { CreateTradeInDto, AppraiseTradeInDto } from './dto/trade-in.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Trade-In')
@ApiBearerAuth('JWT')
@Controller('trade-in')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TradeInController {
  constructor(private tradeInService: TradeInService) {}

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  create(@Body() dto: CreateTradeInDto) {
    return this.tradeInService.create(dto);
  }

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  findAll(
    @Query() pagination: PaginationDto,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
  ) {
    return this.tradeInService.findAll({
      customerId,
      status,
      page: pagination.page,
      limit: pagination.limit,
    });
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  findOne(@Param('id') id: string) {
    return this.tradeInService.findOne(id);
  }

  @Patch(':id/appraise')
  @Roles('OWNER', 'BRANCH_MANAGER')
  appraise(
    @Param('id') id: string,
    @Body() dto: AppraiseTradeInDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.tradeInService.appraise(id, dto, userId);
  }

  @Post(':id/accept')
  @Roles('OWNER', 'BRANCH_MANAGER')
  accept(@Param('id') id: string) {
    return this.tradeInService.accept(id);
  }

  @Post(':id/reject')
  @Roles('OWNER', 'BRANCH_MANAGER')
  reject(@Param('id') id: string) {
    return this.tradeInService.reject(id);
  }
}
