import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FinanceTaxService } from './finance-tax.service';

@Controller('finance-tax')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanceTaxController {
  constructor(private readonly financeTaxService: FinanceTaxService) {}

  /**
   * GET /finance-tax/vat-monthly?year=2026&month=5&companyId=...
   * Returns VAT aggregation for ภ.พ.30 filing.
   */
  @Get('vat-monthly')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getVatMonthly(
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.financeTaxService.getVatMonthly(
      parseInt(year, 10),
      parseInt(month, 10),
      companyId,
    );
  }

  /**
   * GET /finance-tax/wht-monthly?year=2026&month=5&companyId=...
   * Returns WHT aggregation grouped by form type (PND.1/3/53).
   */
  @Get('wht-monthly')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getWhtMonthly(
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.financeTaxService.getWhtMonthly(
      parseInt(year, 10),
      parseInt(month, 10),
      companyId,
    );
  }

  /**
   * GET /finance-tax/vat-auto-journal?year=2026&month=5&companyId=...
   * Returns all journal entries that touched VAT accounts in the period.
   */
  @Get('vat-auto-journal')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getVatAutoJournalHistory(
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.financeTaxService.getVatAutoJournalHistory(
      parseInt(year, 10),
      parseInt(month, 10),
      companyId,
    );
  }
}
