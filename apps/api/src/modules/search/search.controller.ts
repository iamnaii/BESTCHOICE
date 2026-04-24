import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';

type AuthRequest = Request & {
  user?: { id: string; role: string; branchId?: string };
};

@ApiTags('Search')
@ApiBearerAuth('JWT')
@Controller('search')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SearchController {
  constructor(private service: SearchService) {}

  @Get('union')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({
    summary: 'Union search across contracts, customers, letters, IMEIs',
  })
  async unionSearch(@Query() dto: SearchQueryDto, @Req() req: AuthRequest) {
    return this.service.unionSearch({
      q: dto.q,
      userId: req.user?.id ?? '',
      userRole: req.user?.role ?? '',
      branchId: req.user?.branchId,
    });
  }
}
