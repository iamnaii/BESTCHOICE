import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ImportedSalesService } from './imported-sales.service';
import { QueryImportedSalesDto } from './dto/query-imported-sales.dto';

// Locally-declared, exported mirror of the service's private `Bucket` shape.
// Needed because apps/api/tsconfig.json has `declaration: true`: an exported
// class cannot expose a public method whose inferred return type names an
// unexported type from another module (TS4053). Structurally identical to
// ImportedSalesService's private `Bucket`, so the actual return value
// type-checks against it without any change to imported-sales.service.ts.
export interface ImportedSalesBucket {
  key: string;
  count: number;
  sales: string;
  profit: string;
}

export interface ImportedSalesSummaryResult {
  totals: { count: number; sales: string; profit: string; cost: string };
  byMonth: ImportedSalesBucket[];
  byChannel: ImportedSalesBucket[];
  bySalesperson: ImportedSalesBucket[];
  byCategory: ImportedSalesBucket[];
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
