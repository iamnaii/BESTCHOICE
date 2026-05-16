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

    // Input VAT (ภาษีซื้อ) — B3/K-04 (Fix Report P0-1). Sources from journal_lines
    // where account_code = '11-4101' (the post-A.5 input-VAT account) joined to
    // the originating expense_document for vendor/invoice metadata. The legacy
    // `expense` model has been replaced by the ExpenseDocument flow, which posts
    // VAT via expense-same-day / expense-accrual / credit-note / vendor-settlement
    // templates — all of which set `metadata.flow LIKE 'expense-%'` and
    // `metadata.documentId` so this query is a precise filter.
    //
    // Sign convention: VAT input is Dr 11-4101 (asset increase) so we sum the
    // debit column. Credit notes reverse the VAT — those JE lines book Cr 11-4101
    // and are intentionally excluded here so the period total nets correctly when
    // summed with sales output VAT. (CN's negative purchase is represented by
    // a separate negative line on the next month's report if needed.)
    const expenses = await this.getInputVatLineItems(branchIds, startDate, endDate);

    const totalPurchases = expenses.reduce(
      (s, e) => s.add(e.totalAmount),
      new Prisma.Decimal(0),
    );
    const totalVatInput = expenses.reduce(
      (s, e) => s.add(e.vatAmount),
      new Prisma.Decimal(0),
    );

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

  /**
   * B3 / K-04 — Read input VAT (ภาษีซื้อ) from journal_lines on account 11-4101
   * within the given period, joined back to expense_documents for vendor info.
   * Returns the shape `previewPP30` expects on its `expenses` slot.
   *
   * Filtering rules:
   *   - account_code = '11-4101' (input VAT, ITC-claimable per Fix Report P0-1)
   *   - debit > 0 (excludes credit-note reversals which Cr 11-4101)
   *   - posted_at within [startDate, endDate] (period boundaries inclusive)
   *   - metadata.flow LIKE 'expense-%' (any of expense-same-day / expense-accrual /
   *     expense-credit-note / expense-vendor-settlement — only those four book VAT)
   *   - expense_document.branchId IN branchIds (company scope)
   *   - all deletedAt IS NULL
   */
  private async getInputVatLineItems(
    branchIds: string[],
    startDate: Date,
    endDate: Date,
  ): Promise<
    Array<{
      expenseDate: Date;
      description: string;
      vendorName: string | null;
      vendorTaxId: string | null;
      taxInvoiceNo: string | null;
      totalAmount: Prisma.Decimal;
      vatAmount: Prisma.Decimal;
    }>
  > {
    if (branchIds.length === 0) return [];

    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountCode: '11-4101',
        debit: { gt: 0 },
        deletedAt: null,
        journalEntry: {
          deletedAt: null,
          postedAt: { gte: startDate, lte: endDate },
          metadata: { path: ['flow'], string_starts_with: 'expense-' } as Prisma.JsonFilter,
        },
      },
      include: {
        journalEntry: {
          select: {
            id: true,
            postedAt: true,
            description: true,
            metadata: true,
          },
        },
      },
      orderBy: { journalEntry: { postedAt: 'asc' } },
    });

    if (lines.length === 0) return [];

    // Resolve expense_documents via metadata.documentId (batch lookup, no N+1).
    const documentIds = [
      ...new Set(
        lines
          .map((l) => {
            const md = l.journalEntry.metadata as Prisma.JsonObject | null;
            const docId = md?.documentId;
            return typeof docId === 'string' ? docId : null;
          })
          .filter((v): v is string => v !== null),
      ),
    ];
    const docs =
      documentIds.length > 0
        ? await this.prisma.expenseDocument.findMany({
            where: {
              id: { in: documentIds },
              branchId: { in: branchIds },
              deletedAt: null,
            },
            select: {
              id: true,
              vendorName: true,
              vendorTaxId: true,
              taxInvoiceNo: true,
              totalAmount: true,
            },
          })
        : [];
    const docById = new Map(docs.map((d) => [d.id, d]));

    return lines.flatMap((line) => {
      const md = line.journalEntry.metadata as Prisma.JsonObject | null;
      const docId = typeof md?.documentId === 'string' ? md.documentId : null;
      const doc = docId ? docById.get(docId) : null;
      // Skip lines whose document is not in the company's branches (or was soft-
      // deleted); without a doc we can't supply vendor info reliably, and including
      // them would inflate purchases for a different company.
      if (!doc) return [];
      return [
        {
          expenseDate: line.journalEntry.postedAt ?? new Date(),
          description: line.journalEntry.description,
          vendorName: doc.vendorName,
          vendorTaxId: doc.vendorTaxId,
          taxInvoiceNo: doc.taxInvoiceNo,
          totalAmount: doc.totalAmount,
          vatAmount: line.debit,
        },
      ];
    });
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
