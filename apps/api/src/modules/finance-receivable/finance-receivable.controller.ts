import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FinanceReceivableService } from './finance-receivable.service';
import { RecordReceiveDto, UpdateFinanceReceivableDto } from './dto/finance-receivable.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { Roles } from '../auth/decorators/roles.decorator';
import { FinanceReceivableStatus } from '@prisma/client';

@ApiTags('Finance')
@ApiBearerAuth('JWT')
@Controller('finance-receivable')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class FinanceReceivableController {
  constructor(private service: FinanceReceivableService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findAll(
    @Query('status') status?: FinanceReceivableStatus,
    @Query('financeCompany') financeCompany?: string,
    @Query('branchId') branchId?: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Request() req?: { user: { role: string; branchId?: string } },
  ) {
    const effectiveBranchId = hasCrossBranchAccess(req?.user)
      ? branchId
      : req?.user?.branchId || branchId;

    return this.service.findAll({
      status,
      financeCompany,
      branchId: effectiveBranchId,
      search,
      startDate,
      endDate,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
  }

  @Get('summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getSummary(
    @Query('branchId') branchId?: string,
    @Request() req?: { user: { role: string; branchId?: string } },
  ) {
    const effectiveBranchId = hasCrossBranchAccess(req?.user)
      ? branchId
      : req?.user?.branchId || branchId;
    return this.service.getSummary(effectiveBranchId);
  }

  @Get('companies')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getFinanceCompanies() {
    return this.service.getFinanceCompanies();
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/receive')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  recordReceive(
    @Param('id') id: string,
    @Body() dto: RecordReceiveDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.service.recordReceive(id, dto, req.user.id);
  }

  @Patch(':id')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFinanceReceivableDto,
  ) {
    return this.service.update(id, dto);
  }
}
