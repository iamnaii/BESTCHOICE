import { Controller, Get, Post, Body, Query, UseGuards, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DefectExchangeService } from './defect-exchange.service';
import { ExecuteDefectExchangeDto } from './dto/defect-exchange.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Defect Exchange')
@ApiBearerAuth('JWT')
@Controller('defect-exchange')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DefectExchangeController {
  constructor(private service: DefectExchangeService) {}

  @Get('eligibility/:contractId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  getEligibility(
    @Param('contractId') contractId: string,
    @Query('newProductId') newProductId?: string,
  ) {
    return this.service.checkEligibility(contractId, newProductId);
  }

  @Post('execute')
  @Roles('OWNER', 'BRANCH_MANAGER')
  execute(@Body() dto: ExecuteDefectExchangeDto, @CurrentUser() user: { id: string }) {
    return this.service.execute(dto, user.id);
  }

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  list(
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.list({ branchId, from, to });
  }
}
