import { Injectable } from '@nestjs/common';
import { GenerateTaxReportDto } from './dto/tax.dto';
import { EntityScope } from './tax-entity.util';
import { TaxPreviewService } from './services/tax-preview.service';
import { TaxReportService } from './services/tax-report.service';
import { TaxExportService } from './services/tax-export.service';

export type TaxFormCode = 'PP30' | 'PND1' | 'PND3' | 'PND53';

/**
 * TaxService — facade preserving the 9-method public surface + DI contract.
 *
 * Behavior-preserving decomposition: all logic moved VERBATIM into three
 * injected sub-services. Consumers (TaxController, accounting/monthly-close
 * via constructor injection) see only this facade.
 *
 *   - TaxPreviewService — read-only VAT/WHT preview computations + journal math
 *   - TaxReportService  — generate / submit / findAll / findOne (the 2 writes)
 *   - TaxExportService  — exportTaxFormXlsx (exceljs)
 */
@Injectable()
export class TaxService {
  constructor(
    private preview: TaxPreviewService,
    private report: TaxReportService,
    private export_: TaxExportService,
  ) {}

  previewPP30(companyId: string, year: number, month: number, entityScope?: EntityScope) {
    return this.preview.previewPP30(companyId, year, month, entityScope);
  }

  previewPND1(companyId: string, year: number, month: number) {
    return this.preview.previewPND1(companyId, year, month);
  }

  previewPND3(companyId: string, year: number, month: number) {
    return this.preview.previewPND3(companyId, year, month);
  }

  previewPND53(companyId: string, year: number, month: number) {
    return this.preview.previewPND53(companyId, year, month);
  }

  generate(dto: GenerateTaxReportDto, userId: string, entityScope?: EntityScope) {
    return this.report.generate(dto, userId, entityScope);
  }

  findAll(
    companyId?: string,
    reportType?: string,
    year?: number,
    status?: string,
    page = 1,
    limit = 50,
    entityScope?: EntityScope,
  ) {
    return this.report.findAll(companyId, reportType, year, status, page, limit, entityScope);
  }

  findOne(id: string) {
    return this.report.findOne(id);
  }

  exportTaxFormXlsx(
    form: TaxFormCode,
    companyId: string,
    year: number,
    month: number,
  ): Promise<Buffer> {
    return this.export_.exportTaxFormXlsx(form, companyId, year, month);
  }

  submit(id: string, userId: string) {
    return this.report.submit(id, userId);
  }
}
