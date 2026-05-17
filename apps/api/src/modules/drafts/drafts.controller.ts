import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DraftsService } from './drafts.service';

@ApiTags('Drafts')
@ApiBearerAuth('JWT')
@Controller('drafts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DraftsController {
  constructor(private readonly draftsService: DraftsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({
    summary:
      'SP5 — Drafts hub: federated read of DRAFT-status docs (Quote / Contract / ExpenseDocument / OtherIncome).',
  })
  list(
    @Query('type') type?: string,
    @Query('branchId') branchId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.draftsService.findAll({
      type,
      branchId,
      search,
      limit: limit ? parseInt(limit, 10) || undefined : undefined,
    });
  }
}
