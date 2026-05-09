import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AssetStatus } from '@prisma/client';
import { AssetReportsService } from './asset-reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Asset Reports')
@ApiBearerAuth('JWT')
@Controller('reports/asset-summary')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssetReportsController {
  constructor(private readonly service: AssetReportsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  summary(
    @Query('groupBy') groupBy: 'category' | 'custodian' | 'location',
    @Query('asOfDate') asOfDate?: string,
    @Query('status') status?: AssetStatus,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.summary({ groupBy, asOfDate, status, branchId });
  }
}
