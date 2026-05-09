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
    // NaN-safe parse: reject non-numeric or non-positive values → undefined
    // so the service falls back to its defaults instead of NaN poisoning math.
    const parsedPage = page ? parseInt(page, 10) : NaN;
    const parsedLimit = limit ? parseInt(limit, 10) : NaN;
    return this.service.listAllTransfers({
      page:
        Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : undefined,
      limit:
        Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined,
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
