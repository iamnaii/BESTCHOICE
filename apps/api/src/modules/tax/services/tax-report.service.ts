import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, TaxReportType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { paginatedResponse } from '../../../common/helpers/pagination.helper';
import { GenerateTaxReportDto } from '../dto/tax.dto';
import { EntityScope, ensureTaxTypeAllowedForEntity } from '../tax-entity.util';
import { TaxPreviewService } from './tax-preview.service';

/**
 * TaxReportService — tax report persistence (generate / submit / findAll /
 * findOne). Reads preview snapshot data from TaxPreviewService. Decomposed
 * VERBATIM from the original TaxService facade (behavior-preserving).
 *
 * The only writes in the tax module live here: taxReport.upsert (generate) and
 * taxReport.update (submit) — neither is on the money path.
 */
@Injectable()
export class TaxReportService {
  constructor(
    private prisma: PrismaService,
    private preview: TaxPreviewService,
  ) {}

  /**
   * Generate tax report — upsert with snapshot data.
   * SP7.5: Validates entity scope against report type (e.g. PP30 not allowed for SHOP).
   */
  async generate(dto: GenerateTaxReportDto, userId: string, entityScope?: EntityScope) {
    const reportType = dto.reportType as TaxReportType;

    // SP7.5: enforce per-entity tax type rules when scope is known
    if (entityScope) {
      ensureTaxTypeAllowedForEntity(entityScope, reportType);
    }

    // Call the appropriate preview method
    let previewData: Record<string, unknown>;
    if (reportType === 'PP30') {
      previewData = await this.preview.previewPP30(dto.companyId, dto.reportYear, dto.reportMonth);
    } else if (reportType === 'PND1') {
      previewData = await this.preview.previewPND1(dto.companyId, dto.reportYear, dto.reportMonth);
    } else if (reportType === 'PND3') {
      previewData = await this.preview.previewPND3(dto.companyId, dto.reportYear, dto.reportMonth);
    } else {
      previewData = await this.preview.previewPND53(dto.companyId, dto.reportYear, dto.reportMonth);
    }

    // Build upsert data
    const commonData = {
      notes: dto.notes ?? null,
      status: 'DRAFT' as const,
      generatedData: previewData as unknown as Prisma.JsonObject,
      filedAt: null,
      filedById: null,
    };

    const pp30Fields =
      reportType === 'PP30'
        ? {
            totalSales: (previewData as { totalSales: Prisma.Decimal }).totalSales,
            totalVatOutput: (previewData as { totalVatOutput: Prisma.Decimal }).totalVatOutput,
            totalPurchases: (previewData as { totalPurchases: Prisma.Decimal }).totalPurchases,
            totalVatInput: (previewData as { totalVatInput: Prisma.Decimal }).totalVatInput,
            netVat: (previewData as { netVat: Prisma.Decimal }).netVat,
            totalWht: null,
            transactionCount: null,
          }
        : {
            totalSales: null,
            totalVatOutput: null,
            totalPurchases: null,
            totalVatInput: null,
            netVat: null,
            totalWht: (previewData as { whtTotal: Prisma.Decimal }).whtTotal,
            transactionCount: (previewData as { count: number }).count,
          };

    return this.prisma.taxReport.upsert({
      where: {
        companyId_reportType_reportYear_reportMonth: {
          companyId: dto.companyId,
          reportType,
          reportYear: dto.reportYear,
          reportMonth: dto.reportMonth,
        },
      },
      create: {
        companyId: dto.companyId,
        reportType,
        reportYear: dto.reportYear,
        reportMonth: dto.reportMonth,
        ...commonData,
        ...pp30Fields,
      },
      update: {
        ...commonData,
        ...pp30Fields,
      },
      include: { company: true },
    });
  }

  /**
   * List tax reports with filters and pagination.
   * SP7.5: When entityScope is provided, list is restricted to that company entity.
   */
  async findAll(
    companyId?: string,
    reportType?: string,
    year?: number,
    status?: string,
    page = 1,
    limit = 50,
    entityScope?: EntityScope,
  ) {
    const where: Prisma.TaxReportWhereInput = { deletedAt: null };

    if (companyId) {
      where.companyId = companyId;
    } else if (entityScope) {
      // SP7.5: scope by company entity when no explicit companyId provided
      where.company = { companyCode: entityScope };
    }
    if (reportType) where.reportType = reportType as TaxReportType;
    if (year) where.reportYear = year;
    if (status) where.status = status as 'DRAFT' | 'SUBMITTED' | 'FILED';

    const [data, total] = await Promise.all([
      this.prisma.taxReport.findMany({
        where,
        orderBy: [{ reportYear: 'desc' }, { reportMonth: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          company: { select: { id: true, nameTh: true, companyCode: true } },
        },
      }),
      this.prisma.taxReport.count({ where }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }

  /**
   * Get single tax report by ID
   */
  async findOne(id: string) {
    const report = await this.prisma.taxReport.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: true,
        filedBy: { select: { id: true, name: true } },
      },
    });

    if (!report) {
      throw new NotFoundException('ไม่พบรายงานภาษี');
    }

    return report;
  }

  /**
   * Submit tax report (DRAFT → SUBMITTED)
   */
  async submit(id: string, userId: string) {
    const report = await this.prisma.taxReport.findFirst({
      where: { id, deletedAt: null },
    });

    if (!report) {
      throw new NotFoundException('ไม่พบรายงานภาษี');
    }

    if (report.status !== 'DRAFT') {
      throw new BadRequestException('สามารถยื่นได้เฉพาะรายงานที่สถานะ DRAFT เท่านั้น');
    }

    return this.prisma.taxReport.update({
      where: { id },
      data: {
        status: 'SUBMITTED',
        filedAt: new Date(),
        filedById: userId,
      },
      include: { company: true },
    });
  }
}
