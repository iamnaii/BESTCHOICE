import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, TaxReportType } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { paginatedResponse } from '../../common/helpers/pagination.helper';
import { GenerateTaxReportDto } from './dto/tax.dto';

export type TaxFormCode = 'PP30' | 'PND1' | 'PND3' | 'PND53';

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
   * ภ.ง.ด.1 Preview — Personal Income Tax (WHT on payroll, ม.50(1), ม.52/53).
   *
   * Source: JournalLine where accountCode = '21-3101' (WHT payable — payroll)
   * + credit > 0 + entry POSTED in period + referenceType = 'PAYROLL'.
   * Joined back to PayrollLine via the originating PayrollDetail document for
   * employee name + tax id + WHT amount.
   *
   * V17 rule: WHT base on PayrollLine is `baseSalary` (already pre-VAT;
   * payroll has no VAT). Documented in `.claude/rules/accounting.md`.
   */
  async previewPND1(companyId: string, year: number, month: number) {
    return this.previewPayrollWHT(companyId, year, month);
  }

  /**
   * ภ.ง.ด.3 Preview — WHT for individuals (บุคคลธรรมดา, ม.3 เตรส, ม.50(3)(4)).
   * Source: JournalLine accountCode = '21-3102', joined to ExpenseDocument /
   * VendorSettlementDetail for vendor name + tax id + WHT amount.
   * V17: WHT base = subtotal (pre-VAT) per ExpenseDocument.subtotal.
   */
  async previewPND3(companyId: string, year: number, month: number) {
    return this.previewVendorWHT(companyId, year, month, 'PND3');
  }

  /**
   * ภ.ง.ด.53 Preview — WHT for juristic persons (นิติบุคคล, ทป.4/2528).
   * Source: JournalLine accountCode = '21-3103'.
   */
  async previewPND53(companyId: string, year: number, month: number) {
    return this.previewVendorWHT(companyId, year, month, 'PND53');
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
    } else if (reportType === 'PND1') {
      previewData = await this.previewPND1(dto.companyId, dto.reportYear, dto.reportMonth);
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
   * Export tax form data as a 1-sheet XLSX (RD-format columns).
   *
   * Wraps the matching `preview*` query and emits an exceljs workbook as a
   * Buffer suitable for HTTP streaming. Returns RD-style columns:
   *   - PP30: sales / purchases sheets
   *   - PND1: employee + tax id + gross + WHT
   *   - PND3 / PND53: vendor + tax id + income type + gross + WHT% + WHT
   */
  async exportTaxFormXlsx(
    form: TaxFormCode,
    companyId: string,
    year: number,
    month: number,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BESTCHOICE';
    workbook.created = new Date();

    const periodLabel = `${year}-${String(month).padStart(2, '0')}`;

    if (form === 'PP30') {
      const data = await this.previewPP30(companyId, year, month);
      const sheet = workbook.addWorksheet(`PP30-${periodLabel}`);
      sheet.columns = [
        { header: 'หมวด', key: 'category', width: 16 },
        { header: 'รายการ', key: 'description', width: 40 },
        { header: 'ผู้ขาย / ลูกค้า', key: 'party', width: 30 },
        { header: 'เลขที่กำกับภาษี', key: 'taxInvoiceNo', width: 18 },
        { header: 'วันที่', key: 'date', width: 12 },
        { header: 'มูลค่า (บาท)', key: 'amount', width: 14 },
        { header: 'ภาษีมูลค่าเพิ่ม (บาท)', key: 'vat', width: 16 },
      ];
      sheet.getRow(1).font = { bold: true };
      for (const s of data.lineItems.sales) {
        sheet.addRow({
          category: 'ขาย',
          description: s.description,
          party: s.customerName,
          taxInvoiceNo: s.contractNumber,
          date: s.date,
          amount: Number(s.amount ?? 0),
          vat: Number(s.vatAmount ?? 0),
        });
      }
      for (const p of data.lineItems.purchases) {
        sheet.addRow({
          category: 'ซื้อ',
          description: p.description,
          party: p.vendorName ?? '',
          taxInvoiceNo: p.taxInvoiceNo ?? '',
          date: p.date,
          amount: Number(p.amount ?? 0),
          vat: Number(p.vatAmount ?? 0),
        });
      }
      const summary = sheet.addRow({});
      summary.getCell('description').value = 'ภาษีขาย (Output VAT)';
      summary.getCell('vat').value = Number(data.totalVatOutput);
      summary.font = { bold: true };
      const summary2 = sheet.addRow({});
      summary2.getCell('description').value = 'ภาษีซื้อ (Input VAT)';
      summary2.getCell('vat').value = Number(data.totalVatInput);
      summary2.font = { bold: true };
      const summary3 = sheet.addRow({});
      summary3.getCell('description').value = 'ภาษีที่ต้องชำระ (Net VAT)';
      summary3.getCell('vat').value = Number(data.netVat);
      summary3.font = { bold: true };
    } else if (form === 'PND1') {
      const data = await this.previewPND1(companyId, year, month);
      const sheet = workbook.addWorksheet(`PND1-${periodLabel}`);
      sheet.columns = [
        { header: 'ลำดับ', key: 'no', width: 6 },
        { header: 'ชื่อพนักงาน', key: 'name', width: 30 },
        { header: 'เลขประจำตัวผู้เสียภาษี', key: 'taxId', width: 22 },
        { header: 'จำนวนเงินได้ (บาท)', key: 'gross', width: 18 },
        { header: 'ภาษีหัก ณ ที่จ่าย (บาท)', key: 'wht', width: 20 },
        { header: 'วันที่จ่าย', key: 'payDate', width: 12 },
        { header: 'เลขที่เอกสาร', key: 'doc', width: 18 },
      ];
      sheet.getRow(1).font = { bold: true };
      data.items.forEach((it, idx) => {
        sheet.addRow({
          no: idx + 1,
          name: it.employeeName,
          taxId: it.employeeTaxId ?? '',
          gross: Number(it.gross),
          wht: Number(it.whtAmount),
          payDate: it.payDate,
          doc: it.payrollDocNumber,
        });
      });
      const total = sheet.addRow({});
      total.getCell('name').value = 'รวม';
      total.getCell('gross').value = Number(data.grossIncome);
      total.getCell('wht').value = Number(data.whtTotal);
      total.font = { bold: true };
    } else {
      // PND3 / PND53 — vendor WHT
      const data =
        form === 'PND3'
          ? await this.previewPND3(companyId, year, month)
          : await this.previewPND53(companyId, year, month);
      const sheet = workbook.addWorksheet(`${form}-${periodLabel}`);
      sheet.columns = [
        { header: 'ลำดับ', key: 'no', width: 6 },
        { header: 'ชื่อผู้รับเงิน', key: 'name', width: 30 },
        { header: 'เลขประจำตัวผู้เสียภาษี', key: 'taxId', width: 22 },
        { header: 'ประเภทเงินได้', key: 'incomeType', width: 20 },
        { header: 'จำนวนเงิน (บาท)', key: 'gross', width: 16 },
        { header: 'อัตรา %', key: 'whtPercent', width: 10 },
        { header: 'ภาษีหัก ณ ที่จ่าย (บาท)', key: 'wht', width: 20 },
        { header: 'วันที่จ่าย', key: 'paidDate', width: 12 },
        { header: 'เลขที่เอกสาร', key: 'doc', width: 18 },
      ];
      sheet.getRow(1).font = { bold: true };
      data.items.forEach((it, idx) => {
        sheet.addRow({
          no: idx + 1,
          name: it.vendorName,
          taxId: it.vendorTaxId ?? '',
          incomeType: it.incomeType ?? '',
          gross: Number(it.gross),
          whtPercent: Number(it.whtPercent),
          wht: Number(it.whtAmount),
          paidDate: it.paidDate,
          doc: it.expenseDocNumber,
        });
      });
      const total = sheet.addRow({});
      total.getCell('name').value = 'รวม';
      total.getCell('gross').value = Number(data.grossIncome);
      total.getCell('wht').value = Number(data.whtTotal);
      total.font = { bold: true };
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer as ArrayBuffer);
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
   * Shared WHT preview for vendor flows (PND3 individuals / PND53 juristic).
   *
   * Source: JournalLine where accountCode matches the WHT payable account for
   * the form (21-3102 PND3, 21-3103 PND53) + credit > 0 + entry POSTED in
   * period + entry.metadata.flow LIKE 'expense-%' (only expense-same-day,
   * expense-accrual, credit-note, vendor-settlement touch WHT payable).
   *
   * Joined back to ExpenseDocument via metadata.documentId for vendor name /
   * tax id / WHT income type / amount. WHT base per V17 = subtotal (pre-VAT).
   *
   * Returns items shaped per RD form: vendorName, vendorTaxId, incomeType,
   * gross (pre-VAT amount), whtAmount, paidDate, expenseDocNumber.
   */
  private async previewVendorWHT(
    companyId: string,
    year: number,
    month: number,
    form: 'PND3' | 'PND53',
  ) {
    const { startDate, endDate } = this.getDateRange(year, month);
    const branchIds = await this.getBranchIds(companyId);
    const accountCode = form === 'PND3' ? '21-3102' : '21-3103';
    const emptyResult = {
      items: [] as Array<{
        vendorName: string;
        vendorTaxId: string | null;
        incomeType: string | null;
        gross: Prisma.Decimal;
        whtPercent: Prisma.Decimal;
        whtAmount: Prisma.Decimal;
        paidDate: Date;
        expenseDocNumber: string;
      }>,
      grossIncome: new Prisma.Decimal(0),
      whtTotal: new Prisma.Decimal(0),
      count: 0,
      period: { year, month, startDate, endDate },
      companyId,
      form,
      // Backward-compat fields consumed by /tax/generate upsert
      totalWht: new Prisma.Decimal(0),
      transactionCount: 0,
      vendors: [] as Array<{
        vendorName: string;
        vendorTaxId: string | null;
        whtIncomeType: string | null;
        totalAmount: Prisma.Decimal;
        whtAmount: Prisma.Decimal;
      }>,
    };

    if (branchIds.length === 0) return emptyResult;

    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountCode,
        credit: { gt: 0 },
        deletedAt: null,
        journalEntry: {
          deletedAt: null,
          status: 'POSTED',
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

    if (lines.length === 0) return emptyResult;

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
              number: true,
              vendorName: true,
              vendorTaxId: true,
              subtotal: true,
              documentDate: true,
              paidAt: true,
              expenseDetail: {
                select: {
                  lines: {
                    select: { category: true, whtPercent: true },
                    take: 1,
                  },
                },
              },
            },
          })
        : [];
    const docById = new Map(docs.map((d) => [d.id, d]));

    const items = lines.flatMap((line) => {
      const md = line.journalEntry.metadata as Prisma.JsonObject | null;
      const docId = typeof md?.documentId === 'string' ? md.documentId : null;
      const doc = docId ? docById.get(docId) : null;
      if (!doc) return [];
      const firstLine = doc.expenseDetail?.lines?.[0];
      const incomeType = firstLine?.category ?? null;
      const whtPercent = firstLine?.whtPercent ?? new Prisma.Decimal(0);
      return [
        {
          vendorName: doc.vendorName ?? '(ไม่ระบุชื่อผู้รับเงิน)',
          vendorTaxId: doc.vendorTaxId,
          incomeType,
          gross: doc.subtotal,
          whtPercent,
          whtAmount: line.credit,
          paidDate: doc.paidAt ?? doc.documentDate ?? line.journalEntry.postedAt ?? new Date(),
          expenseDocNumber: doc.number,
        },
      ];
    });

    const grossIncome = items.reduce((s, x) => s.add(x.gross), new Prisma.Decimal(0));
    const whtTotal = items.reduce((s, x) => s.add(x.whtAmount), new Prisma.Decimal(0));

    return {
      items,
      grossIncome,
      whtTotal,
      count: items.length,
      period: { year, month, startDate, endDate },
      companyId,
      form,
      // Backward-compat fields consumed by /tax/generate upsert
      totalWht: whtTotal,
      transactionCount: items.length,
      vendors: items.map((x) => ({
        vendorName: x.vendorName,
        vendorTaxId: x.vendorTaxId,
        whtIncomeType: x.incomeType,
        totalAmount: x.gross,
        whtAmount: x.whtAmount,
      })),
    };
  }

  /**
   * Payroll WHT (ภ.ง.ด.1) preview. Source: JournalLine accountCode='21-3101'
   * (WHT payable — payroll) joined to PayrollLine via metadata.documentId on
   * the originating PAYROLL ExpenseDocument.
   *
   * WHT base on a payroll line = baseSalary (already pre-VAT; payroll has no
   * VAT). Each PayrollLine row maps 1:1 to a beneficiary on form ภ.ง.ด.1.
   */
  private async previewPayrollWHT(companyId: string, year: number, month: number) {
    const { startDate, endDate } = this.getDateRange(year, month);
    const branchIds = await this.getBranchIds(companyId);
    const emptyResult = {
      items: [] as Array<{
        employeeName: string;
        employeeTaxId: string | null;
        gross: Prisma.Decimal;
        whtAmount: Prisma.Decimal;
        payDate: Date;
        payrollDocNumber: string;
      }>,
      grossIncome: new Prisma.Decimal(0),
      whtTotal: new Prisma.Decimal(0),
      count: 0,
      period: { year, month, startDate, endDate },
      companyId,
      form: 'PND1' as const,
      // Backward-compat fields consumed by /tax/generate upsert
      totalWht: new Prisma.Decimal(0),
      transactionCount: 0,
    };

    if (branchIds.length === 0) return emptyResult;

    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountCode: '21-3101',
        credit: { gt: 0 },
        deletedAt: null,
        journalEntry: {
          deletedAt: null,
          status: 'POSTED',
          postedAt: { gte: startDate, lte: endDate },
          // payroll.template.ts writes `flow: 'expense-payroll'` — must match exactly
          metadata: {
            path: ['flow'],
            string_starts_with: 'expense-payroll',
          } as Prisma.JsonFilter,
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

    if (lines.length === 0) return emptyResult;

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

    if (documentIds.length === 0) return emptyResult;

    const docs = await this.prisma.expenseDocument.findMany({
      where: {
        id: { in: documentIds },
        branchId: { in: branchIds },
        deletedAt: null,
      },
      select: {
        id: true,
        number: true,
        documentDate: true,
        paidAt: true,
        payroll: {
          select: {
            lines: {
              where: { whtAmount: { gt: 0 } },
              select: {
                employeeName: true,
                employeeTaxId: true,
                baseSalary: true,
                whtAmount: true,
              },
            },
          },
        },
      },
    });

    const items: Array<{
      employeeName: string;
      employeeTaxId: string | null;
      gross: Prisma.Decimal;
      whtAmount: Prisma.Decimal;
      payDate: Date;
      payrollDocNumber: string;
    }> = [];

    for (const doc of docs) {
      const payDate = doc.paidAt ?? doc.documentDate ?? new Date();
      for (const line of doc.payroll?.lines ?? []) {
        items.push({
          employeeName: line.employeeName,
          employeeTaxId: line.employeeTaxId,
          gross: line.baseSalary,
          whtAmount: line.whtAmount,
          payDate,
          payrollDocNumber: doc.number,
        });
      }
    }

    const grossIncome = items.reduce((s, x) => s.add(x.gross), new Prisma.Decimal(0));
    const whtTotal = items.reduce((s, x) => s.add(x.whtAmount), new Prisma.Decimal(0));

    return {
      items,
      grossIncome,
      whtTotal,
      count: items.length,
      period: { year, month, startDate, endDate },
      companyId,
      form: 'PND1' as const,
      // Backward-compat fields consumed by /tax/generate upsert
      totalWht: whtTotal,
      transactionCount: items.length,
    };
  }
}
