import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ExternalFinanceService } from './external-finance.service';
import { ExternalFinanceCommissionService } from './external-finance-commission.service';
import {
  CreateExternalFinanceCompanyDto,
  UpdateExternalFinanceCompanyDto,
} from './dto/external-finance-company.dto';
import { CreateCommissionDto, MarkReceivedDto } from './dto/commission.dto';

@Controller('external-finance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExternalFinanceController {
  constructor(
    private readonly companies: ExternalFinanceService,
    private readonly commissions: ExternalFinanceCommissionService,
  ) {}

  // ── Companies ──────────────────────────────────────────────

  @Get('companies')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'ACCOUNTANT')
  listCompanies() {
    return this.companies.list();
  }

  @Get('companies/:id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'ACCOUNTANT')
  getCompany(@Param('id') id: string) {
    return this.companies.findOne(id);
  }

  @Post('companies')
  @Roles('OWNER', 'BRANCH_MANAGER')
  createCompany(@Body() dto: CreateExternalFinanceCompanyDto) {
    return this.companies.create(dto);
  }

  @Patch('companies/:id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  updateCompany(@Param('id') id: string, @Body() dto: UpdateExternalFinanceCompanyDto) {
    return this.companies.update(id, dto);
  }

  @Delete('companies/:id')
  @Roles('OWNER')
  deleteCompany(@Param('id') id: string) {
    return this.companies.softDelete(id);
  }

  // ── Commissions ────────────────────────────────────────────

  @Get('commissions')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'ACCOUNTANT')
  listCommissions(
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
  ) {
    return this.commissions.list({ externalFinanceCompanyId: companyId, status });
  }

  @Post('commissions')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  accrueCommission(@Body() dto: CreateCommissionDto) {
    return this.commissions.accrue(dto);
  }

  @Patch('commissions/:id/received')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  markReceived(@Param('id') id: string, @Body() dto: MarkReceivedDto) {
    return this.commissions.markReceived(id, dto);
  }

  @Patch('commissions/:id/cancel')
  @Roles('OWNER', 'ACCOUNTANT')
  cancelCommission(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.commissions.cancel(id, body.reason);
  }
}
