import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AssetJournalService } from './asset-journal.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Asset Journal')
@ApiBearerAuth('JWT')
@Controller('assets/journal')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssetJournalController {
  constructor(private readonly service: AssetJournalService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('flowType') flowType?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const parsedPage = page ? parseInt(page, 10) : NaN;
    const parsedLimit = limit ? parseInt(limit, 10) : NaN;
    return this.service.list({
      page: Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : undefined,
      limit: Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined,
      search,
      flowType,
      fromDate,
      toDate,
    });
  }
}
