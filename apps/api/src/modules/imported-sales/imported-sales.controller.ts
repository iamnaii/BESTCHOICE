import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ImportedSalesService, Bucket } from './imported-sales.service';
import { QueryImportedSalesDto } from './dto/query-imported-sales.dto';

// `Bucket` is exported from imported-sales.service.ts (TS4053 fix): an exported
// class cannot expose a public method whose inferred return type names an
// unexported type from another module, and this controller's `summary()`
// method returns whatever shape `ImportedSalesService.summary()` produces.
export interface ImportedSalesSummaryResult {
  totals: { count: number; sales: string; profit: string; cost: string };
  byMonth: Bucket[];
  byChannel: Bucket[];
  bySalesperson: Bucket[];
  byCategory: Bucket[];
}

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
