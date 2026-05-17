import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PrismaService } from '../../prisma/prisma.service';
import { hasCrossBranchAccess } from '../auth/branch-access.util';

/** Minimal user shape needed for branch scoping — branchId may be null
 * for cross-branch roles (OWNER / FINANCE_MANAGER / ACCOUNTANT). */
export interface ETaxRequestUser {
  role: string;
  branchId?: string | null;
}

/**
 * e-Tax Invoice — Phase 1
 *
 * Lists FINANCE-side Payment records with VAT (paidDate within period) so that
 * Accounting can issue invoice receipts and a monthly CSV. Phase 2 will add
 * RD XML submission + PKCS#7 cert.
 *
 * Source: `Payment` joined to its `Contract` (filter `branchId IN companyBranchIds`).
 * VAT is captured per-payment on `Payment.vatAmount` (set by PaymentReceipt2B
 * template at the time the customer pays — see `.claude/rules/accounting.md`).
 */
@Injectable()
export class ETaxService {
  constructor(private prisma: PrismaService) {}

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
   * List Payment records with VAT > 0 paid in the period for the company.
   * Pagination via page/limit; default 1/50 per backend conventions.
   *
   * Critical #5: optional `user` arg narrows results to branches the user
   * can access. Cross-branch roles (OWNER/FINANCE_MANAGER/ACCOUNTANT) see
   * all branches of the requested company. Branch-scoped roles
   * (BRANCH_MANAGER/SALES) see only their own branch — and only if it
   * belongs to the requested company.
   */
  async listInvoices(
    companyId: string,
    year: number,
    month: number,
    page = 1,
    limit = 50,
    user?: ETaxRequestUser,
  ) {
    const { startDate, endDate } = this.getDateRange(year, month);
    const branchIds = user
      ? await this.getAccessibleBranchIds(companyId, user)
      : await this.getBranchIds(companyId);

    const where: Prisma.PaymentWhereInput = {
      deletedAt: null,
      status: 'PAID',
      vatAmount: { gt: 0 },
      paidDate: { gte: startDate, lte: endDate },
      contract: {
        deletedAt: null,
        branchId: { in: branchIds },
      },
    };

    if (branchIds.length === 0) {
      return { data: [], total: 0, page, limit };
    }

    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { paidDate: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          paidDate: true,
          amountPaid: true,
          vatAmount: true,
          installmentNo: true,
          contract: {
            select: {
              id: true,
              contractNumber: true,
              customer: { select: { id: true, name: true, nationalId: true } },
            },
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    const data = rows.map((r) => {
      const vat = r.vatAmount ?? new Prisma.Decimal(0);
      const total = r.amountPaid;
      const base = total.sub(vat);
      return {
        paymentId: r.id,
        paidDate: r.paidDate,
        installmentNo: r.installmentNo,
        contractId: r.contract.id,
        contractNumber: r.contract.contractNumber,
        customerName: r.contract.customer.name,
        customerTaxId: r.contract.customer.nationalId ?? null,
        amountBeforeVat: base,
        vatAmount: vat,
        total,
      };
    });

    return { data, total, page, limit };
  }

  /**
   * Critical #5: compute the set of branchIds the requesting user can access
   * for a given company. Cross-branch roles (OWNER/FINANCE_MANAGER/ACCOUNTANT)
   * see all branches under the company. Branch-scoped roles
   * (BRANCH_MANAGER/SALES) see ONLY their own branch — and only if it belongs
   * to the requested company.
   */
  private async getAccessibleBranchIds(
    companyId: string,
    user: ETaxRequestUser,
  ): Promise<string[]> {
    const companyBranchIds = await this.getBranchIds(companyId);
    if (hasCrossBranchAccess(user)) return companyBranchIds;

    // Branch-scoped role — limit to their own branch if it's in this company
    if (!user.branchId) return [];
    return companyBranchIds.includes(user.branchId) ? [user.branchId] : [];
  }

  /**
   * Critical #5: Generate PDF receipt for a single Payment record
   * (Phase 1 internal receipt, NOT a legal e-Tax Invoice per ม.86/4).
   *
   * Scoping: requires the requesting user. Resolves the Payment via Contract
   * → Branch and rejects (NotFoundException — does not leak existence) if
   * the contract's branchId is not in the user's accessible set. Without
   * this, any authenticated user with the PDF route could fetch any
   * payment's customer name + nationalId — a PII leak across companies.
   *
   * Phase 1: jspdf-autotable, English labels, plain receipt format.
   * Phase 2 will produce a real ใบกำกับภาษีอิเล็กทรอนิกส์ with Thai font +
   * ม.86/4 mandatory fields + PKCS#7 signature.
   */
  async generateInvoicePdf(
    paymentId: string,
    user: ETaxRequestUser,
  ): Promise<Buffer> {
    // Look up the payment's contract.branchId first (no PII leak — just branch)
    const paymentCheck = await this.prisma.payment.findFirst({
      where: { id: paymentId, deletedAt: null, status: 'PAID' },
      select: {
        contract: { select: { branchId: true, deletedAt: true } },
      },
    });
    if (!paymentCheck || paymentCheck.contract.deletedAt) {
      throw new NotFoundException('ไม่พบรายการชำระเงิน');
    }

    // Determine the user's company for the contract's branch, then check
    // accessible branches under that company.
    const branch = await this.prisma.branch.findFirst({
      where: { id: paymentCheck.contract.branchId, deletedAt: null },
      select: { companyId: true },
    });
    // companyId is nullable on Branch — payment from an orphan branch is
    // treated as not-accessible (defensive: refuse to leak via missing FK).
    if (!branch || !branch.companyId) {
      throw new NotFoundException('ไม่พบรายการชำระเงิน');
    }

    const accessibleBranches = await this.getAccessibleBranchIds(branch.companyId, user);
    if (!accessibleBranches.includes(paymentCheck.contract.branchId)) {
      // Do NOT differentiate "not found" vs "forbidden" — same response
      // prevents enumeration of valid payment IDs from other companies.
      throw new NotFoundException('ไม่พบรายการชำระเงิน');
    }

    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        deletedAt: null,
        status: 'PAID',
        contract: {
          deletedAt: null,
          branchId: { in: accessibleBranches },
        },
      },
      select: {
        id: true,
        paidDate: true,
        installmentNo: true,
        amountPaid: true,
        vatAmount: true,
        contract: {
          select: {
            id: true,
            contractNumber: true,
            customer: {
              select: { id: true, name: true, nationalId: true, addressIdCard: true },
            },
          },
        },
      },
    });
    if (!payment) throw new NotFoundException('ไม่พบรายการชำระเงิน');
    if (!payment.vatAmount || payment.vatAmount.lte(0)) {
      throw new NotFoundException('รายการชำระไม่มีภาษีมูลค่าเพิ่ม');
    }
    const vat = payment.vatAmount;
    const total = payment.amountPaid;
    const base = total.sub(vat);

    // Critical #6: jsPDF default Helvetica cannot render Thai (tofu boxes).
    // PR #843 bundled Noto Sans Thai for pdfmake — that lives in the
    // expense-document PDF pipeline. For SP3 Phase 1 we ship an
    // English-only receipt to avoid font regression risk while we work the
    // proper Thai-font path into the e-tax module for Phase 2.
    //
    // Critical #7: This PDF is INTERNAL only — NOT a legal ใบกำกับภาษี
    // ตามม.86/4. Title, header banner, and file name all reflect that.
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });

    doc.setFontSize(16);
    doc.text('Receipt with VAT (Internal)', 40, 60);
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text(
      'Phase 1 — Internal receipt, NOT a legal Thai tax invoice (per Section 86/4 of the Revenue Code).',
      40,
      78,
    );
    doc.text(
      'Phase 2 will deliver a compliant e-Tax Invoice with Thai font, full ม.86/4 fields, and PKCS#7 signature.',
      40,
      90,
    );
    doc.setTextColor(0, 0, 0);

    doc.setFontSize(10);
    doc.text(`Payment ID: ${payment.id}`, 40, 120);
    doc.text(`Paid Date: ${payment.paidDate?.toISOString().slice(0, 10) ?? '-'}`, 40, 135);
    doc.text(`Contract: ${payment.contract.contractNumber}`, 40, 150);
    doc.text(`Installment No: ${payment.installmentNo}`, 40, 165);
    // Customer name and address may contain Thai — render with placeholder
    // tag so jsPDF default font does not emit garbled tofu boxes. The
    // accountant uses Contract + Payment ID to cross-reference the real
    // customer record. Phase 2 swaps in Noto Sans Thai for native rendering.
    doc.text(`Customer: [contract ${payment.contract.contractNumber}]`, 40, 180);
    if (payment.contract.customer.nationalId) {
      doc.text(`Tax ID: ${payment.contract.customer.nationalId}`, 40, 195);
    }

    autoTable(doc, {
      startY: 220,
      head: [['Item', 'Amount (THB)']],
      body: [
        ['Amount before VAT', base.toFixed(2)],
        ['VAT 7%', vat.toFixed(2)],
        ['Total', total.toFixed(2)],
      ],
      styles: { fontSize: 10 },
    });

    // Footer disclaimer
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(
      'This receipt is for internal verification only. Issue an official tax invoice (Phase 2) before submitting to RD.',
      40,
      doc.internal.pageSize.getHeight() - 30,
    );

    const arrayBuffer = doc.output('arraybuffer');
    return Buffer.from(arrayBuffer as ArrayBuffer);
  }

  /**
   * Monthly CSV export. Columns:
   *   paidDate, installmentNo, contractNumber, customerName, customerTaxId,
   *   amountBeforeVat, vatAmount, total
   */
  async exportCsv(
    companyId: string,
    year: number,
    month: number,
    user?: ETaxRequestUser,
  ): Promise<string> {
    // limit very high — CSV is "give me everything in the month"
    const result = await this.listInvoices(companyId, year, month, 1, 100000, user);
    const rows = result.data;

    const header = [
      'paidDate',
      'installmentNo',
      'contractNumber',
      'customerName',
      'customerTaxId',
      'amountBeforeVat',
      'vatAmount',
      'total',
    ].join(',');

    const escape = (v: string | null) => {
      if (v == null) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const body = rows.map((r) =>
      [
        r.paidDate ? r.paidDate.toISOString().slice(0, 10) : '',
        String(r.installmentNo),
        escape(r.contractNumber),
        escape(r.customerName),
        escape(r.customerTaxId),
        r.amountBeforeVat.toFixed(2),
        r.vatAmount.toFixed(2),
        r.total.toFixed(2),
      ].join(','),
    );

    // BOM ensures Thai chars open correctly in Excel
    return '﻿' + [header, ...body].join('\n');
  }
}
