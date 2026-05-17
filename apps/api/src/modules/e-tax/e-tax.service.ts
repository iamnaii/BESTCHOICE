import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PrismaService } from '../../prisma/prisma.service';

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
   */
  async listInvoices(companyId: string, year: number, month: number, page = 1, limit = 50) {
    const { startDate, endDate } = this.getDateRange(year, month);
    const branchIds = await this.getBranchIds(companyId);

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
   * Generate PDF receipt for a single Payment record (e-Tax invoice receipt).
   * Phase 1: jspdf-autotable. No XML, no digital signature.
   */
  async generateInvoicePdf(paymentId: string): Promise<Buffer> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, deletedAt: null, status: 'PAID' },
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

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    doc.setFontSize(18);
    doc.text('e-Tax Invoice Receipt', 40, 60);
    doc.setFontSize(10);
    doc.text(`Payment ID: ${payment.id}`, 40, 90);
    doc.text(`Paid Date: ${payment.paidDate?.toISOString().slice(0, 10) ?? '-'}`, 40, 105);
    doc.text(`Contract: ${payment.contract.contractNumber}`, 40, 120);
    doc.text(`Installment No: ${payment.installmentNo}`, 40, 135);
    doc.text(`Customer: ${payment.contract.customer.name}`, 40, 150);
    if (payment.contract.customer.nationalId) {
      doc.text(`Tax ID: ${payment.contract.customer.nationalId}`, 40, 165);
    }

    autoTable(doc, {
      startY: 200,
      head: [['Item', 'Amount (THB)']],
      body: [
        ['Amount before VAT', base.toFixed(2)],
        ['VAT 7%', vat.toFixed(2)],
        ['Total', total.toFixed(2)],
      ],
      styles: { fontSize: 10 },
    });

    const arrayBuffer = doc.output('arraybuffer');
    return Buffer.from(arrayBuffer as ArrayBuffer);
  }

  /**
   * Monthly CSV export. Columns:
   *   paidDate, installmentNo, contractNumber, customerName, customerTaxId,
   *   amountBeforeVat, vatAmount, total
   */
  async exportCsv(companyId: string, year: number, month: number): Promise<string> {
    // limit very high — CSV is "give me everything in the month"
    const result = await this.listInvoices(companyId, year, month, 1, 100000);
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
