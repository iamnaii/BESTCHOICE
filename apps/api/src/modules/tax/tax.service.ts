import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, TaxReportType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginatedResponse } from '../../common/helpers/pagination.helper';
import { GenerateTaxReportDto } from './dto/tax.dto';

@Injectable()
export class TaxService {
  constructor(private prisma: PrismaService) {}

  /**
   * ภ.พ.30 Preview — VAT output (ภาษีขาย) vs VAT input (ภาษีซื้อ)
   */
  async previewPP30(companyId: string, year: number, month: number) {
    const { startDate, endDate } = this.getDateRange(year, month);

    // Get branches belonging to this company
    const branchIds = await this.getBranchIds(companyId);

    // Output VAT (ภาษีขาย): PAID payments with vatAmount from FINANCE company contracts
    const payments = await this.prisma.payment.findMany({
      where: {
        deletedAt: null,
        status: 'PAID',
        vatAmount: { not: null },
        paidDate: { gte: startDate, lte: endDate },
        contract: {
          deletedAt: null,
          branchId: { in: branchIds },
        },
      },
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            customer: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { paidDate: 'asc' },
    });

    const totalSales = payments.reduce(
      (sum, p) => sum.add(p.amountPaid),
      new Prisma.Decimal(0),
    );
    const totalVatOutput = payments.reduce(
      (sum, p) => sum.add(p.vatAmount ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0),
    );

    // Input VAT (ภาษีซื้อ): legacy `expense` model removed; ExpenseDocument-based tax
    // reporting will be added in a follow-up PR. For now PP30 returns sales-only data.
    const expenses: Array<{
      expenseDate: Date;
      description: string;
      vendorName: string | null;
      vendorTaxId: string | null;
      taxInvoiceNo: string | null;
      totalAmount: Prisma.Decimal;
      vatAmount: Prisma.Decimal;
    }> = [];

    const totalPurchases = new Prisma.Decimal(0);
    const totalVatInput = new Prisma.Decimal(0);

    const netVat = totalVatOutput.sub(totalVatInput);

    const salesLineItems = payments.map((p) => ({
      date: p.paidDate,
      description: `สัญญา ${p.contract.contractNumber} - ${p.contract.customer.name}`,
      contractId: p.contract.id,
      contractNumber: p.contract.contractNumber,
      customerName: p.contract.customer.name,
      amount: p.amountPaid,
      vatAmount: p.vatAmount,
    }));

    const purchaseLineItems = expenses.map((e) => ({
      date: e.expenseDate,
      description: e.description,
      vendorName: e.vendorName,
      vendorTaxId: e.vendorTaxId,
      taxInvoiceNo: e.taxInvoiceNo,
      amount: e.totalAmount,
      vatAmount: e.vatAmount,
    }));

    return {
      totalSales,
      totalVatOutput,
      totalPurchases,
      totalVatInput,
      netVat,
      lineItems: {
        sales: salesLineItems,
        purchases: purchaseLineItems,
      },
    };
  }

  /**
   * ภ.ง.ด.3 Preview — WHT for individuals (บุคคลธรรมดา)
   */
  async previewPND3(companyId: string, year: number, month: number) {
    return this.previewWHT(companyId, year, month, 'PND3');
  }

  /**
   * ภ.ง.ด.53 Preview — WHT for companies (นิติบุคคล)
   */
  async previewPND53(companyId: string, year: number, month: number) {
    return this.previewWHT(companyId, year, month, 'PND53');
  }

  /**
   * Generate tax report — upsert with snapshot data
   */
  async generate(dto: GenerateTaxReportDto, userId: string) {
    const reportType = dto.reportType as TaxReportType;

    // Call the appropriate preview method
    let previewData: Record<string, unknown>;
    if (reportType === 'PP30') {
      previewData = await this.previewPP30(dto.companyId, dto.reportYear, dto.reportMonth);
    } else if (reportType === 'PND3') {
      previewData = await this.previewPND3(dto.companyId, dto.reportYear, dto.reportMonth);
    } else {
      previewData = await this.previewPND53(dto.companyId, dto.reportYear, dto.reportMonth);
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
            totalWht: (previewData as { totalWht: Prisma.Decimal }).totalWht,
            transactionCount: (previewData as { transactionCount: number }).transactionCount,
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
   * List tax reports with filters and pagination
   */
  async findAll(
    companyId?: string,
    reportType?: string,
    year?: number,
    status?: string,
    page = 1,
    limit = 50,
  ) {
    const where: Prisma.TaxReportWhereInput = { deletedAt: null };

    if (companyId) where.companyId = companyId;
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

  // ──────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────

  private getDateRange(year: number, month: number) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    return { startDate, endDate };
  }

  private async getBranchIds(companyId: string): Promise<string[]> {
    const branches = await this.prisma.branch.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true },
    });
    return branches.map((b) => b.id);
  }

  /**
   * Shared WHT preview logic for PND3 (individuals) and PND53 (companies)
   */
  private async previewWHT(
    companyId: string,
    year: number,
    month: number,
    type: 'PND3' | 'PND53',
  ) {
    // Legacy `expense` model removed; WHT reporting on the new ExpenseDocument
    // module will be reinstated in a follow-up PR. For now PND3/PND53 preview is empty.
    void this.getDateRange(year, month);
    void (await this.getBranchIds(companyId));
    void type;

    return {
      totalWht: new Prisma.Decimal(0),
      transactionCount: 0,
      vendors: [] as Array<{
        vendorName: string;
        vendorTaxId: string;
        whtIncomeType: string | null;
        totalAmount: Prisma.Decimal;
        whtAmount: Prisma.Decimal;
      }>,
    };
  }
}
