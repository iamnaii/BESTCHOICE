import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ImportedSalesService } from './imported-sales.service';
import type { ImportedSalesSummaryResult } from './imported-sales.service';
import { QueryImportedSalesDto } from './dto/query-imported-sales.dto';

export type { ImportedSalesSummaryResult } from './imported-sales.service';

@Controller('imported-sales')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ImportedSalesController {
  constructor(private readonly service: ImportedSalesService) {}

  @Get()
  @Roles('OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER')
  list(@Query() query: QueryImportedSalesDto) {
    return this.service.list(query);
  }

  @Get('summary')
  @Roles('OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER')
  summary(@Query() query: QueryImportedSalesDto): Promise<ImportedSalesSummaryResult> {
    return this.service.summary(query);
  }
}
