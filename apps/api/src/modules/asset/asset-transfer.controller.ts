import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AssetTransferService } from './asset-transfer.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';

/**
 * AssetTransferController — Phase 2
 *
 * Cross-asset transfer audit endpoint. Separated from AssetController so that
 * the route prefix is `/asset-transfers` (not `/assets/asset-transfers`).
 */
@ApiTags('Asset Transfers')
@ApiBearerAuth('JWT')
@Controller('asset-transfers')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class AssetTransferController {
  constructor(private readonly service: AssetTransferService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('assetId') assetId?: string,
    @Query('custodianContains') custodianContains?: string,
    @Query('locationContains') locationContains?: string,
    @Query('branchId') branchId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.service.listAllTransfers({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      assetId,
      custodianContains,
      locationContains,
      branchId,
      fromDate,
      toDate,
    });
  }
}
