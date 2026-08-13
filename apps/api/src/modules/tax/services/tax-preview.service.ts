import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { EntityScope, ensureTaxTypeAllowedForEntity } from '../tax-entity.util';

/**
 * TaxPreviewService — read-only VAT/WHT preview computations.
 *
 * Holds the journal-aggregation math for ภ.พ.30 (VAT output/input) and the
 * ภ.ง.ด.1/3/53 WHT previews. Decomposed VERBATIM from the original TaxService
 * facade (behavior-preserving). TaxReportService + TaxExportService inject this
 * service to read preview snapshots/export data.
 */
@Injectable()
export class TaxPreviewService {
  constructor(private prisma: PrismaService) {}

  /**
   * ภ.พ.30 Preview — VAT output (ภาษีขาย) vs VAT input (ภาษีซื้อ)
   *
   * Critical #2 fix: Output VAT is sourced from JournalLine Cr to 21-2101
   * (settled VAT — ภ.พ.30) + 21-2103 (60-day mandatory VAT) within the
   * period. The previous implementation summed `Payment.vatAmount` only —
   * which silently undercounted VAT from:
   *   - 21-2103 mandatory 60-day overdue VAT (Vat60dayMandatoryTemplate)
   *   - 2A accrual (Dr 11-2105 / Cr 21-2102 — until cleared to 21-2101)
   *   - JP4 early payoff (reverses 21-2106 and clears VAT to 21-2101)
   *   - JP5 repossession output VAT
   *   - OtherIncomeTemplate (42-1105 disposal gain VAT, etc.)
   *   - Asset disposal VAT (Cr 21-2101)
   *
   * Journal-based totals are the single source of truth. Payment-level
   * vatOutputLineItems is kept as a UI breakdown for source detail only;
   * the totals reported to RD are computed from journal lines.
   */
  async previewPP30(companyId: string, year: number, month: number, entityScope?: EntityScope) {
    // SP7.5: PP30 is FINANCE-only (SHOP is not VAT-registered)
    if (entityScope) {
      ensureTaxTypeAllowedForEntity(entityScope, 'PP30');
    }
    const { startDate, endDate } = this.getDateRange(year, month);

    // Get branches belonging to this company
    const branchIds = await this.getBranchIds(companyId);

    // ── Output VAT side — JOURNAL-BASED (Critical #2) ────────────────────
    // Settled output VAT: Cr 21-2101 (the account ภ.พ.30 actually filed on)
    const settledOutputLines = await this.prisma.journalLine.findMany({
      where: {
        accountCode: '21-2101',
        credit: { gt: 0 },
        deletedAt: null,
        journalEntry: {
          deletedAt: null,
          status: 'POSTED',
          companyId,
          postedAt: { gte: startDate, lte: endDate },
        },
      },
      include: {
        journalEntry: {
          select: {
            id: true,
            entryNumber: true,
            entryDate: true,
            postedAt: true,
            referenceType: true,
            referenceId: true,
            description: true,
          },
        },
      },
      orderBy: { journalEntry: { postedAt: 'asc' } },
    });

    // Mandatory 60-day overdue VAT — ม.78/2 (Vat60dayMandatoryTemplate)
    // Recognized separately so accountant can see the split between
    // "VAT we received cash on" vs "VAT we owe by law on overdue receivables"
    const mandatoryVat60DayLines = await this.prisma.journalLine.findMany({
      where: {
        accountCode: '21-2103',
        credit: { gt: 0 },
        deletedAt: null,
        journalEntry: {
          deletedAt: null,
          status: 'POSTED',
          companyId,
          postedAt: { gte: startDate, lte: endDate },
        },
      },
      include: {
        journalEntry: {
          select: {
            id: true,
            entryNumber: true,
            entryDate: true,
            postedAt: true,
            referenceType: true,
            description: true,
          },
        },
      },
      orderBy: { journalEntry: { postedAt: 'asc' } },
    });

    const totalVatSettled = settledOutputLines.reduce(
      (s, l) => s.add(l.credit ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0),
    );
    const totalVatMandatory60Day = mandatoryVat60DayLines.reduce(
      (s, l) => s.add(l.credit ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0),
    );
    // ภ.พ.30 reports BOTH — settled (paid this month) + mandatory (60-day overdue).
    // Both are output VAT owed to RD for the period.
    const totalVatOutput = totalVatSettled.add(totalVatMandatory60Day);

    // Aggregate by referenceType so the UI / report can break down the source
    // (PAYMENT, OTHER_INCOME, REPOSSESSION, etc.)
    const outputBySource = new Map<string, Prisma.Decimal>();
    for (const line of settledOutputLines) {
      const refType = line.journalEntry.referenceType ?? 'OTHER';
      const current = outputBySource.get(refType) ?? new Prisma.Decimal(0);
      outputBySource.set(refType, current.add(line.credit ?? new Prisma.Decimal(0)));
    }

    // Source detail for the UI: Payment.vatAmount within period (backward
    // compatible breakdown — vatOutputLineItems shows per-payment source).
    // Total reported above is journal-based; this list is presentation only.
    const payments = branchIds.length
      ? await this.prisma.payment.findMany({
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
        })
      : [];

    const totalSales = payments.reduce((sum, p) => sum.add(p.amountPaid), new Prisma.Decimal(0));

    // ── Input VAT side — UNCHANGED (already journal-based; verified correct) ─
    const expenses = await this.getInputVatLineItems(branchIds, startDate, endDate);

    const totalPurchases = expenses.reduce((s, e) => s.add(e.totalAmount), new Prisma.Decimal(0));
    const totalVatInput = expenses.reduce((s, e) => s.add(e.vatAmount), new Prisma.Decimal(0));

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

    // Mandatory 60-day VAT — separate breakdown so accountant can see what
    // portion of total VAT output came from the 21-2103 cron (no cash received)
    const mandatoryVat60DayItems = mandatoryVat60DayLines.map((line) => ({
      date: line.journalEntry.postedAt ?? line.journalEntry.entryDate,
      entryNumber: line.journalEntry.entryNumber,
      description: line.journalEntry.description,
      referenceType: line.journalEntry.referenceType,
      vatAmount: line.credit,
    }));

    return {
      totalSales,
      // ── Output VAT (journal-sourced) ───────────────────────────────────
      totalVatOutput,
      totalVatSettled, // Cr 21-2101 — paid output VAT
      totalVatMandatory60Day, // Cr 21-2103 — 60-day overdue mandatory VAT
      vatOutputBySource: Object.fromEntries(
        Array.from(outputBySource.entries()).map(([k, v]) => [k, v]),
      ),
      // ── Input VAT (already journal-sourced) ────────────────────────────
      totalPurchases,
      totalVatInput,
      netVat,
      lineItems: {
        sales: salesLineItems,
        purchases: purchaseLineItems,
        mandatoryVat60Day: mandatoryVat60DayItems,
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

  // ──────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────

  private getDateRange(year: number, month: number) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    return { startDate, endDate };
  }

  /**
   * Critical #4: WHT income type human label. Previously the raw CoA
   * `category` (e.g. '52-1101') was returned to the RD-format report, which
   * is meaningless to filers and unmappable to RD's income-type taxonomy
   * (ม.40(5),(6),(7),(8)).
   *
   * Pragmatic mapping by category prefix for SP3 — owner can refine via
   * Settings later (deferred to Phase 2). Mappings follow common Thai WHT
   * income types:
   *   - 52-11 ค่าจ้างทำของ (hire of work — ม.40(7),(8))
   *   - 52-12 ค่าบริการ (service fees — ม.40(6))
   *   - 52-13 ค่าเช่า (rent — ม.40(5))
   *   - 52-14 ค่าโฆษณา (advertising — ม.40(8))
   * Fallback "อื่นๆ — <code>" preserves visibility of unrecognized codes.
   */
  private resolveIncomeType(category: string | null | undefined): string {
    if (!category) return 'อื่นๆ';
    // If the category isn't a CoA code (e.g. already a label from older
    // payroll records like 'ค่าจ้างทำของ'), pass it through.
    if (!/^5\d-\d{4}/.test(category)) return category;
    if (category.startsWith('52-11')) return 'ค่าจ้างทำของ';
    if (category.startsWith('52-12')) return 'ค่าบริการ';
    if (category.startsWith('52-13')) return 'ค่าเช่า';
    if (category.startsWith('52-14')) return 'ค่าโฆษณา';
    return `อื่นๆ — ${category}`;
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
              whtFormType: true,
              expenseDetail: {
                select: {
                  lines: {
                    // Critical #3: pull ALL lines (not take: 1) so we can
                    // aggregate gross + WHT per the relevant whtFormType only.
                    // Previously doc.subtotal was used as a doc-level gross
                    // which double-counted when a doc mixed PND3 + PND53 lines
                    // (per-line P2-4 routing — see accounting.md).
                    select: {
                      category: true,
                      whtPercent: true,
                      whtFormType: true,
                      amountBeforeVat: true,
                      whtAmount: true,
                    },
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

      // Critical #3: filter to lines whose effective whtFormType matches
      // the report being run (per-line P2-4 routing). Without this filter,
      // a mixed-form doc (1 PND3 line + 1 PND53 line) would report the
      // whole doc.subtotal for BOTH reports — double-counting the gross.
      const allLines = doc.expenseDetail?.lines ?? [];
      const relevantLines = allLines.filter((l) => {
        const effectiveForm = l.whtFormType ?? doc.whtFormType ?? 'PND3';
        return effectiveForm === form;
      });
      if (relevantLines.length === 0) return [];

      const gross = relevantLines.reduce(
        (sum, l) => sum.add(l.amountBeforeVat ?? new Prisma.Decimal(0)),
        new Prisma.Decimal(0),
      );
      // Sum WHT from the doc's lines (the source of truth for the WHT amount).
      // Note: `line.credit` is the doc-level aggregate posted to the JE; it's
      // the right number when the entire doc is one form, but for mixed docs
      // we need the per-line sum filtered by form.
      const whtFromLines = relevantLines.reduce(
        (sum, l) => sum.add(l.whtAmount ?? new Prisma.Decimal(0)),
        new Prisma.Decimal(0),
      );
      // Prefer line-level sum when present; fall back to JE credit when lines
      // have no whtAmount (defensive — older PETTY_CASH docs may not).
      const whtAmount = whtFromLines.gt(0) ? whtFromLines : line.credit;

      // First relevant line's whtPercent represents the rate for this group
      const firstRelevant = relevantLines[0];

      return [
        {
          vendorName: doc.vendorName ?? '(ไม่ระบุชื่อผู้รับเงิน)',
          vendorTaxId: doc.vendorTaxId,
          // Critical #4: incomeType resolved from category prefix instead of
          // returning the raw CoA code (e.g. '52-1101').
          incomeType: this.resolveIncomeType(firstRelevant.category),
          gross,
          whtPercent: firstRelevant.whtPercent ?? new Prisma.Decimal(0),
          whtAmount,
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
   * Payroll WHT (ภ.ง.ด.1) preview.
   *
   * 2026-08-06 rewrite (payroll-shop-side design §8) — sources directly from
   * POSTED PAYROLL ExpenseDocuments (status='POSTED' + journalEntryId set)
   * instead of walking 21-3101 JE lines. Why:
   *   1. ภ.ง.ด.1 ต้องแสดงผู้มีเงินได้ทุกคน — พนักงานภาษี 0 ไม่มีบรรทัด 21-3101
   *      ใน JE เลย จึงหายทั้งคนใน implementation เดิม (และ filter
   *      whtAmount > 0 บน PayrollLine ตัดซ้ำอีกชั้น). เอกสารเป็นแหล่งที่ครบ.
   *   2. เอกสารที่ VOID แล้วหลุดออกอัตโนมัติ (เดิม JE ต้นฉบับยัง POSTED อยู่ —
   *      ใบเงินเดือนที่ยกเลิกยังโผล่ใน ภ.ง.ด.1).
   *   3. Payroll โพสต์ได้ทั้ง 21-3101 (FINANCE scope) และ S21-3101 (SHOP scope
   *      — นิติบุคคลเดียวกัน ยื่นรวม) — เดิมอ่านแค่ 21-3101.
   *
   * gross = baseSalary + Σ customIncome(isTaxable=true) — โบนัส/OT ที่เสียภาษี
   * เป็นเงินได้ตาม ม.40(1) ต้องเข้าฐาน (ม.42-exempt rows excluded by design).
   * Period keyed on paidAt (ม.50 — หักเมื่อจ่าย), documentDate fallback.
   *
   * NO branch/company gate (review fix 2026-08-06): SHOP + FINANCE are ONE
   * juristic person today — ภ.ง.ด.1 ยื่นรวมทั้งบริษัท. Branches all belong to
   * the SHOP CompanyInfo while FINANCE-scope payroll posts under FINANCE, so
   * gating on getBranchIds(companyId) made the FINANCE selection permanently
   * empty and the SHOP selection silently company-wide anyway. `companyId` is
   * kept for the response/TaxReport bookkeeping only. Revisit when Phase 3 SP7
   * splits the entities into separate legal companies.
   */
  private async previewPayrollWHT(companyId: string, year: number, month: number) {
    const { startDate, endDate } = this.getDateRange(year, month);
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

    const docs = await this.prisma.expenseDocument.findMany({
      where: {
        documentType: 'PAYROLL',
        status: 'POSTED',
        journalEntryId: { not: null },
        deletedAt: null,
        OR: [
          { paidAt: { gte: startDate, lte: endDate } },
          { paidAt: null, documentDate: { gte: startDate, lte: endDate } },
        ],
      },
      orderBy: { documentDate: 'asc' },
      select: {
        id: true,
        number: true,
        documentDate: true,
        paidAt: true,
        payroll: {
          select: {
            lines: {
              select: {
                employeeName: true,
                employeeTaxId: true,
                baseSalary: true,
                whtAmount: true,
                customIncome: {
                  where: { isTaxable: true },
                  select: { amount: true },
                },
              },
            },
          },
        },
      },
    });

    if (docs.length === 0) return emptyResult;

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
        const taxableIncome = (line.customIncome ?? []).reduce(
          (s, r) => s.add(r.amount),
          new Prisma.Decimal(0),
        );
        items.push({
          employeeName: line.employeeName,
          employeeTaxId: line.employeeTaxId,
          gross: line.baseSalary.add(taxableIncome),
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

  /** ภ.ง.ด.2 รายเดือน — จากเอกสาร equity DIV_PAY ที่ POSTED (จ่ายจริงในเดือนนั้น, ม.52 ยื่นใน 7 วันเดือนถัดไป) */
  async previewPnd2(year: number, month: number) {
    const { startDate, endDate } = this.getDateRange(year, month);
    const docs = await this.prisma.equityDocument.findMany({
      where: {
        txnType: 'DIV_PAY',
        status: 'POSTED',
        journalEntryId: { not: null },
        deletedAt: null,
        txnDate: { gte: startDate, lte: endDate },
      },
      orderBy: { txnDate: 'asc' },
      select: {
        docNumber: true,
        txnDate: true,
        lines: {
          select: {
            shareholderName: true,
            amount: true,
            wht: true,
            shareholder: { select: { taxId: true, type: true } },
          },
        },
      },
    });
    const items = docs.flatMap((doc) =>
      doc.lines.map((ln) => ({
        shareholderName: ln.shareholderName,
        taxId: ln.shareholder?.taxId ?? null,
        type: ln.shareholder?.type ?? 'INDIVIDUAL',
        gross: ln.amount,
        whtAmount: ln.wht,
        payDate: doc.txnDate,
        docNumber: doc.docNumber,
      })),
    );
    const grossIncome = items.reduce((s, x) => s.add(x.gross), new Prisma.Decimal(0));
    const whtTotal = items.reduce((s, x) => s.add(x.whtAmount), new Prisma.Decimal(0));
    return {
      items,
      grossIncome,
      whtTotal,
      count: items.length,
      period: { year, month, startDate, endDate },
      form: 'PND2' as const,
    };
  }

  /**
   * สปส.1-10 (SSO monthly filing) preview — payroll round 2 (2026-08-06).
   *
   * Same document-driven sourcing as previewPayrollWHT: POSTED payroll docs
   * keyed on paidAt (documentDate fallback), VOIDs drop out automatically, no
   * branch/company gate (one juristic person files a single สปส.1-10).
   * Only insured rows appear (`ssoEmployee > 0` — พนักงานที่ไม่เข้า ปกส. ไม่ขึ้นแบบ).
   * Employer side mirrors the employee figure (Thai law: identical 5%).
   */
  async previewSso110(year: number, month: number) {
    const { startDate, endDate } = this.getDateRange(year, month);
    const period = `${year}-${String(month).padStart(2, '0')}`;

    const docs = await this.prisma.expenseDocument.findMany({
      where: {
        documentType: 'PAYROLL',
        status: 'POSTED',
        journalEntryId: { not: null },
        deletedAt: null,
        OR: [
          { paidAt: { gte: startDate, lte: endDate } },
          { paidAt: null, documentDate: { gte: startDate, lte: endDate } },
        ],
      },
      orderBy: { documentDate: 'asc' },
      select: {
        number: true,
        payroll: {
          select: {
            entityScope: true,
            lines: {
              where: { ssoEmployee: { gt: 0 } },
              select: {
                employeeName: true,
                employeeTaxId: true,
                baseSalary: true,
                ssoEmployee: true,
              },
            },
          },
        },
      },
    });

    const items: Array<{
      scope: string;
      employeeName: string;
      employeeTaxId: string | null;
      wage: Prisma.Decimal;
      ssoEmployee: Prisma.Decimal;
      ssoEmployer: Prisma.Decimal;
      payrollDocNumber: string;
    }> = [];
    for (const doc of docs) {
      const scope = doc.payroll?.entityScope === 'FINANCE' ? 'FINANCE' : 'SHOP';
      for (const line of doc.payroll?.lines ?? []) {
        items.push({
          scope,
          employeeName: line.employeeName,
          employeeTaxId: line.employeeTaxId,
          wage: line.baseSalary,
          ssoEmployee: line.ssoEmployee,
          // Employer matches employee by law (ม.46 — identical 5%); a future
          // divergence needs a real ssoEmployer column (see payroll.template).
          ssoEmployer: line.ssoEmployee,
          payrollDocNumber: doc.number,
        });
      }
    }

    const zero = new Prisma.Decimal(0);
    const scopeTotal = (scope: 'SHOP' | 'FINANCE') => {
      const rows = items.filter((i) => i.scope === scope);
      const employee = rows.reduce((s, i) => s.add(i.ssoEmployee), zero);
      return {
        count: rows.length,
        employeeTotal: employee,
        employerTotal: employee,
        grandTotal: employee.mul(2),
      };
    };
    const employeeTotal = items.reduce((s, i) => s.add(i.ssoEmployee), zero);

    return {
      form: 'SSO110' as const,
      period: { year, month, startDate, endDate },
      periodKey: period,
      items,
      count: items.length,
      employeeTotal,
      employerTotal: employeeTotal,
      grandTotal: employeeTotal.mul(2),
      perScope: { shop: scopeTotal('SHOP'), finance: scopeTotal('FINANCE') },
    };
  }

  /**
   * ภ.ง.ด.1ก (annual PND1 summary) — payroll round 2 (2026-08-06).
   *
   * Aggregates the whole calendar year per employee (keyed employeeTaxId,
   * falling back to name for legacy free-text rows). Feeds three outputs:
   * the ภ.ง.ด.1ก filing, the per-employee ใบ 50 ทวิ print sheet, and the
   * annual wage total the accountant needs for กท.20ก.
   */
  async previewPnd1Annual(year: number) {
    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    const docs = await this.prisma.expenseDocument.findMany({
      where: {
        documentType: 'PAYROLL',
        status: 'POSTED',
        journalEntryId: { not: null },
        deletedAt: null,
        OR: [
          { paidAt: { gte: startDate, lte: endDate } },
          { paidAt: null, documentDate: { gte: startDate, lte: endDate } },
        ],
      },
      orderBy: { documentDate: 'asc' },
      select: {
        payroll: {
          select: {
            payrollPeriod: true,
            lines: {
              select: {
                employeeName: true,
                employeeTaxId: true,
                baseSalary: true,
                whtAmount: true,
                ssoEmployee: true,
                customIncome: { where: { isTaxable: true }, select: { amount: true } },
              },
            },
          },
        },
      },
    });

    const zero = new Prisma.Decimal(0);
    const byEmployee = new Map<
      string,
      {
        employeeName: string;
        employeeTaxId: string | null;
        monthsPaid: Set<string>;
        grossTotal: Prisma.Decimal;
        whtTotal: Prisma.Decimal;
        ssoTotal: Prisma.Decimal;
      }
    >();

    for (const doc of docs) {
      const period = doc.payroll?.payrollPeriod ?? '';
      for (const line of doc.payroll?.lines ?? []) {
        const key = line.employeeTaxId ?? `name:${line.employeeName}`;
        const taxableIncome = (line.customIncome ?? []).reduce((s, r) => s.add(r.amount), zero);
        const gross = line.baseSalary.add(taxableIncome);
        const agg = byEmployee.get(key) ?? {
          employeeName: line.employeeName,
          employeeTaxId: line.employeeTaxId,
          monthsPaid: new Set<string>(),
          grossTotal: zero,
          whtTotal: zero,
          ssoTotal: zero,
        };
        agg.monthsPaid.add(period);
        agg.grossTotal = agg.grossTotal.add(gross);
        agg.whtTotal = agg.whtTotal.add(line.whtAmount);
        agg.ssoTotal = agg.ssoTotal.add(line.ssoEmployee);
        byEmployee.set(key, agg);
      }
    }

    const items = [...byEmployee.values()]
      .map((a) => ({
        employeeName: a.employeeName,
        employeeTaxId: a.employeeTaxId,
        monthsPaid: a.monthsPaid.size,
        grossTotal: a.grossTotal,
        whtTotal: a.whtTotal,
        ssoTotal: a.ssoTotal,
      }))
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'th'));

    return {
      form: 'PND1A' as const,
      year,
      items,
      count: items.length,
      grossTotal: items.reduce((s, i) => s.add(i.grossTotal), zero),
      whtTotal: items.reduce((s, i) => s.add(i.whtTotal), zero),
      // Σ ค่าจ้างทั้งปี — ตัวเลขอ้างอิงสำหรับ กท.20ก (กองทุนเงินทดแทน)
      annualWageTotal: items.reduce((s, i) => s.add(i.grossTotal), zero),
    };
  }
}
