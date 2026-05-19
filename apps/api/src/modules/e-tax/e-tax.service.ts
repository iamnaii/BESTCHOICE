import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PrismaService } from '../../prisma/prisma.service';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { registerThaiFont } from './thai-font.util';

/**
 * Format a Date as Thai-locale full date (Buddhist era + Asia/Bangkok TZ).
 * Example: 2026-05-17 → "17 พฤษภาคม 2569"
 *
 * Pinned to Asia/Bangkok so server TZ (Cloud Run UTC) doesn't shift the
 * date by 1 day for late-evening BKK timestamps.
 */
function formatThaiDate(d: Date): string {
  const intl = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return intl.format(d);
}

/**
 * Build a 3-4 line block for a party (issuer or buyer) on the invoice.
 * Order: name → tax id → address → optional phone.
 *
 * ม.86/4 mandates name + address + tax id; phone is courtesy.
 */
function buildPartyLines(party: {
  name: string;
  taxId: string;
  address: string;
  phone: string | null;
}): string[] {
  const lines: string[] = [];
  lines.push(party.name);
  lines.push(`เลขประจำตัวผู้เสียภาษี: ${party.taxId}`);
  lines.push(`ที่อยู่: ${party.address}`);
  if (party.phone) lines.push(`โทร: ${party.phone}`);
  return lines;
}

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
   * P2-SP3: Generate ใบกำกับภาษี (ต้นฉบับ) per ม.86/4 of the Revenue Code.
   *
   * This PDF is the **paper form** of the tax invoice — content layout
   * complies with ม.86/4 mandatory fields. Phase 2 (P2-SP5) layers the
   * XML submission + PKCS#7 digital signature on top, which is what RD's
   * e-Tax Invoice & e-Receipt programme actually requires for electronic
   * delivery. Until SP5 ships + cert is uploaded, this PDF can be printed
   * + handed to the customer (acceptable per ม.86/4 paper format).
   *
   * Scoping (Critical #5 preserved): resolves Payment → Contract → Branch
   * and rejects (NotFoundException — does not leak existence) when the
   * branch is not in the requesting user's accessible set. Without this
   * any authenticated user could fetch any payment's customer PII.
   *
   * Thai text is rendered via the Noto Sans Thai variable font bundled
   * by PR #843 — see `thai-font.util.ts`. Cloud Run's `node:20-slim` has
   * NO Thai system fonts so this embedding is mandatory.
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

    // ผู้ออก (issuer) = FINANCE legal entity. VAT registration sits on
    // CompanyInfo by `companyCode = 'FINANCE'`. We don't trust the
    // branch's company directly — VAT invoice must be issued under the
    // VAT-registered FINANCE entity (per business model documented in
    // .claude/CLAUDE.md). Fall back to the branch's company if FINANCE
    // not yet seeded (dev env), and finally to a placeholder.
    const issuer =
      (await this.prisma.companyInfo.findFirst({
        where: { companyCode: 'FINANCE', deletedAt: null },
        select: {
          nameTh: true,
          address: true,
          taxId: true,
          phone: true,
        },
      })) ??
      (await this.prisma.companyInfo.findFirst({
        where: { id: branch.companyId, deletedAt: null },
        select: {
          nameTh: true,
          address: true,
          taxId: true,
          phone: true,
        },
      }));

    return this.buildInvoicePdf({
      payment,
      base,
      vat,
      total,
      issuer,
    });
  }

  /**
   * Build the ม.86/4 PDF — kept separate from `generateInvoicePdf` so the
   * service is easier to unit-test (callers can stub the prisma loads then
   * verify the buffer shape directly).
   *
   * Layout (A4 portrait, units = pt):
   *   - Header: "ใบกำกับภาษี" + "(ต้นฉบับ)" badge + เลขที่ + วันที่
   *   - 2-col block: ผู้ออก (FINANCE) // ผู้ซื้อ (customer)
   *   - Item table: รายการ / จำนวน / ราคา/หน่วย / รวม
   *   - Summary: ราคาก่อน VAT, VAT 7%, รวมทั้งสิ้น
   *   - Footer disclaimer (Phase 1 — XML submission not yet implemented)
   */
  private buildInvoicePdf(args: {
    payment: {
      id: string;
      paidDate: Date | null;
      installmentNo: number;
      contract: { contractNumber: string; customer: { name: string; nationalId: string | null; addressIdCard: string | null } };
    };
    base: Prisma.Decimal;
    vat: Prisma.Decimal;
    total: Prisma.Decimal;
    issuer: { nameTh: string; address: string; taxId: string; phone: string | null } | null;
  }): Buffer {
    const { payment, base, vat, total, issuer } = args;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });

    // Register Thai font (Noto Sans Thai VF — PR #843 bundle).
    // If font is missing on disk this returns 'helvetica' as a fallback;
    // Thai text will still appear as tofu but PDF renders.
    const fontFamily = registerThaiFont(doc);
    const setBold = () => doc.setFont(fontFamily, 'bold');
    const setNormal = () => doc.setFont(fontFamily, 'normal');

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 40;
    const contentWidth = pageWidth - margin * 2;

    // ─── HEADER ────────────────────────────────────────────────────
    setBold();
    doc.setFontSize(20);
    doc.text('ใบกำกับภาษี', pageWidth / 2, 56, { align: 'center' });
    doc.setFontSize(11);
    doc.text('(ต้นฉบับ / ORIGINAL)', pageWidth / 2, 76, { align: 'center' });
    setNormal();

    // เลขที่ใบกำกับภาษี + วันที่ (Asia/Bangkok). Use Payment.id as the
    // invoice number for now — Phase 2 (SP5) will introduce a dedicated
    // running number per `TX-YYYYMMDD-NNNN` convention when we wire the
    // RD submission queue.
    const invoiceNumber = `TX-${payment.id.slice(0, 8).toUpperCase()}`;
    const paidDateThai = payment.paidDate
      ? formatThaiDate(payment.paidDate)
      : '-';
    doc.setFontSize(10);
    doc.text(`เลขที่ใบกำกับภาษี: ${invoiceNumber}`, margin, 110);
    doc.text(`วันที่ออกใบกำกับ: ${paidDateThai}`, pageWidth - margin, 110, {
      align: 'right',
    });

    // ─── ISSUER (left) + BUYER (right) BLOCKS ──────────────────────
    const blockTop = 140;
    const colWidth = (contentWidth - 20) / 2;

    setBold();
    doc.setFontSize(11);
    doc.text('ผู้ออกใบกำกับภาษี (ผู้ขาย)', margin, blockTop);
    doc.text('ผู้ซื้อ / ผู้รับบริการ', margin + colWidth + 20, blockTop);
    setNormal();

    doc.setFontSize(10);
    const issuerLines = buildPartyLines({
      name: issuer?.nameTh ?? 'BESTCHOICE FINANCE',
      taxId: issuer?.taxId ?? '-',
      address: issuer?.address ?? '-',
      phone: issuer?.phone ?? null,
    });
    const buyerLines = buildPartyLines({
      name: payment.contract.customer.name,
      taxId: payment.contract.customer.nationalId ?? '-',
      address: payment.contract.customer.addressIdCard ?? '-',
      phone: null,
    });

    // Both blocks share a fixed leading. Wrap each line to colWidth.
    let yL = blockTop + 18;
    let yR = blockTop + 18;
    const lineHeight = 14;
    for (const line of issuerLines) {
      const wrapped = doc.splitTextToSize(line, colWidth) as string[];
      for (const w of wrapped) {
        doc.text(w, margin, yL);
        yL += lineHeight;
      }
    }
    for (const line of buyerLines) {
      const wrapped = doc.splitTextToSize(line, colWidth) as string[];
      for (const w of wrapped) {
        doc.text(w, margin + colWidth + 20, yR);
        yR += lineHeight;
      }
    }

    // ─── REFERENCE LINE (สัญญา / งวด) ─────────────────────────────
    const refTop = Math.max(yL, yR) + 8;
    doc.setFontSize(10);
    doc.text(
      `อ้างอิงสัญญา: ${payment.contract.contractNumber}    งวดที่: ${payment.installmentNo}`,
      margin,
      refTop,
    );

    // ─── ITEM TABLE ───────────────────────────────────────────────
    // ม.86/4: must list ชนิด/ประเภท/จำนวน/ราคาต่อหน่วย/รวม
    const description = `ค่างวดผ่อนชำระตามสัญญา ${payment.contract.contractNumber} งวดที่ ${payment.installmentNo}`;
    autoTable(doc, {
      startY: refTop + 14,
      head: [['ลำดับ', 'รายการ', 'จำนวน', 'ราคา/หน่วย (บาท)', 'รวม (บาท)']],
      body: [['1', description, '1', base.toFixed(2), base.toFixed(2)]],
      styles: { font: fontFamily, fontSize: 10, cellPadding: 6 },
      headStyles: { font: fontFamily, fontStyle: 'bold', fillColor: [240, 240, 240], textColor: [0, 0, 0] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 40 },
        2: { halign: 'right', cellWidth: 50 },
        3: { halign: 'right', cellWidth: 100 },
        4: { halign: 'right', cellWidth: 100 },
      },
      margin: { left: margin, right: margin },
    });

    // ─── SUMMARY ─────────────────────────────────────────────────
    // jspdf-autotable mutates doc internal cursor — read it back.
    const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } })
      .lastAutoTable?.finalY ?? refTop + 60;

    const summaryRows: Array<[string, string]> = [
      ['ราคาก่อนภาษีมูลค่าเพิ่ม', base.toFixed(2)],
      ['ภาษีมูลค่าเพิ่ม 7%', vat.toFixed(2)],
      ['รวมทั้งสิ้น', total.toFixed(2)],
    ];
    let sumY = finalY + 18;
    for (let i = 0; i < summaryRows.length; i++) {
      const [label, value] = summaryRows[i];
      if (i === summaryRows.length - 1) setBold();
      doc.setFontSize(10);
      doc.text(label, pageWidth - margin - 140, sumY, { align: 'right' });
      doc.text(value, pageWidth - margin, sumY, { align: 'right' });
      if (i === summaryRows.length - 1) setNormal();
      sumY += 16;
    }

    // ─── FOOTER DISCLAIMER ───────────────────────────────────────
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    const disclaimer =
      'เอกสารฉบับนี้เป็นใบกำกับภาษีแบบกระดาษตาม ม.86/4 ป.รัษฎากร — ' +
      'การส่งแบบอิเล็กทรอนิกส์ (XML + PKCS#7) ให้กรมสรรพากร อยู่ระหว่างเตรียมการ.';
    const wrapped = doc.splitTextToSize(disclaimer, contentWidth) as string[];
    let footY = pageHeight - 30 - wrapped.length * 10;
    for (const w of wrapped) {
      doc.text(w, margin, footY);
      footY += 10;
    }
    doc.setTextColor(0, 0, 0);

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
