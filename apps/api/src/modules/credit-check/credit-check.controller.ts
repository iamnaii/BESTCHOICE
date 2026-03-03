import { Controller, Get, Post, Param, Body, UseGuards, Query } from '@nestjs/common';
import { CreditCheckService } from './credit-check.service';
import { CreateCreditCheckDto, OverrideCreditCheckDto } from './dto/credit-check.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

// === Global credit check list ===
@Controller('credit-checks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GlobalCreditCheckController {
  constructor(private service: CreditCheckService) {}

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll({
      status,
      search,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }
}

// === Contract-level credit check ===
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

// === Customer-level credit check (เช็คก่อนทำสัญญา) ===
@Controller('customers/:customerId/credit-check')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerCreditCheckController {
  constructor(private service: CreditCheckService) {}

  @Get()
  findByCustomer(@Param('customerId') customerId: string) {
    return this.service.findByCustomer(customerId);
  }

  @Get('latest')
  findLatest(@Param('customerId') customerId: string) {
    return this.service.findLatestByCustomer(customerId);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  create(
    @Param('customerId') customerId: string,
    @Body() dto: CreateCreditCheckDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.createForCustomer(customerId, dto, user.id);
  }

  @Post(':creditCheckId/analyze')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  analyze(@Param('creditCheckId') creditCheckId: string) {
    return this.service.analyzeForCustomer(creditCheckId);
  }

  @Post(':creditCheckId/override')
  @Roles('OWNER', 'BRANCH_MANAGER')
  override(
    @Param('creditCheckId') creditCheckId: string,
    @Body() dto: OverrideCreditCheckDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.overrideById(creditCheckId, dto, user.id);
  }
}
