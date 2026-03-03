import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { CreditCheckService } from './credit-check.service';
import { CreateCreditCheckDto, OverrideCreditCheckDto } from './dto/credit-check.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('contracts/:contractId/credit-check')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CreditCheckController {
  constructor(private service: CreditCheckService) {}

  @Get()
  findByContract(@Param('contractId') contractId: string) {
    return this.service.findByContract(contractId);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  create(
    @Param('contractId') contractId: string,
    @Body() dto: CreateCreditCheckDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.create(contractId, dto, user.id);
  }

  @Post('analyze')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  analyze(@Param('contractId') contractId: string) {
    return this.service.analyze(contractId);
  }

  @Post('override')
  @Roles('OWNER', 'BRANCH_MANAGER')
  override(
    @Param('contractId') contractId: string,
    @Body() dto: OverrideCreditCheckDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.override(contractId, dto, user.id);
  }
}
