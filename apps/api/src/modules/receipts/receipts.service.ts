import { Injectable, Logger, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { formatDateShort } from '../../utils/thai-date.util';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import * as puppeteer from 'puppeteer';
import { LineOaService } from '../line-oa/line-oa.service';
import { validatePeriodOpen } from '../../utils/period-lock.util';
import { JournalAutoService } from '../journal/journal-auto.service';

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);
  constructor(
    private prisma: PrismaService,
    private journalAutoService: JournalAutoService,
    @Inject(forwardRef(() => LineOaService))
    private lineOaService?: LineOaService,
  ) {}

  /**
   * Generate receipt number: RC-YYYY-MM-NNNNN
   * Uses SELECT FOR UPDATE to prevent race conditions with concurrent payments.
   */
  private async generateReceiptNumber(tx?: Prisma.TransactionClient): Promise<string> {
    const db = tx || this.prisma;
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `RC-${year}-${month}-`;

    // Use raw query with FOR UPDATE to lock the row and prevent concurrent reads
    // from getting the same sequence number.
    // Schema maps Receipt → "receipts" with column "receipt_number" (snake_case).
    const result = await db.$queryRaw<Array<{ receiptNumber: string }>>`
      SELECT receipt_number AS "receiptNumber" FROM receipts
      WHERE receipt_number LIKE ${prefix + '%'}
      ORDER BY receipt_number DESC
      LIMIT 1
      FOR UPDATE
    `;

    let seq = 1;
    if (result.length > 0) {
      const lastSeq = parseInt(result[0].receiptNumber.replace(prefix, ''));
      seq = lastSeq + 1;
    }

    return `${prefix}${String(seq).padStart(5, '0')}`;
  }

  /**
   * Auto-generate e-Receipt after payment recording.
   * Wrapped in a transaction with FOR UPDATE lock on sequence to prevent
   * duplicate receipt numbers under concurrent payments.
   */
  async generateReceipt(
    contractId: string,
    paymentId: string | null,
    receiptType: string,
    amount: number,
    installmentNo: number | null,
    paymentMethod: string | null,
    transactionRef: string | null,
    issuedById: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.findUnique({
        where: { id: contractId },
        include: {
          customer: { select: { name: true } },
          payments: { where: { status: 'PAID', deletedAt: null }, select: { amountPaid: true } },
        },
      });
      if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

      // Get company info
      const company = await tx.companyInfo.findFirst({ where: { isActive: true, deletedAt: null } });
      const receiverName = company?.nameTh || 'บริษัท เบสท์ช้อยส์โฟน จำกัด';

      // Calculate remaining balance
      const totalPaid = contract.payments.reduce((sum, p) => sum + Number(p.amountPaid), 0);
      const remainingBalance = Number(contract.financedAmount) - totalPaid;
      const totalMonths = contract.totalMonths;
      const paidMonths = contract.payments.length;
      const remainingMonths = totalMonths - paidMonths;

      // Generate receipt number inside transaction (uses FOR UPDATE lock)
      const receiptNumber = await this.generateReceiptNumber(tx);

      // Generate receipt content hash
      const receiptContent = JSON.stringify({
        receiptNumber,
        contractId,
        amount,
        installmentNo,
        paidDate: new Date().toISOString(),
      });
      const fileHash = crypto.createHash('sha256').update(receiptContent).digest('hex');

      const receipt = await tx.receipt.create({
        data: {
          receiptNumber,
          contractId,
          paymentId,
          receiptType,
          payerName: contract.customer?.name || '',
          receiverName,
          amount,
          installmentNo,
          remainingBalance: Math.max(0, remainingBalance),
          remainingMonths: Math.max(0, remainingMonths),
          paymentMethod,
          transactionRef,
          paidDate: new Date(),
          fileHash,
          issuedById,
        },
      });

      // Send receipt via LINE if customer is linked
      if (this.lineOaService) {
        try {
          const customer = await tx.customer.findFirst({
            where: {
              contracts: { some: { id: contractId } },
              lineId: { not: null },
              deletedAt: null
            },
            select: { id: true }
          });

          if (customer) {
            // Send receipt in background (don't wait)
            this.lineOaService.sendPaymentReceipt(customer.id, receipt).catch(err => {
              this.logger.error('[Receipt] Failed to send LINE receipt:', err);
            });
          }
        } catch (error) {
          // Log but don't fail the receipt generation
          this.logger.error('[Receipt] Error checking LINE status:', error);
        }
      }

      return receipt;
    });
  }

  /** List receipts with search, filter, pagination */
  async findAll(filters: {
    search?: string;
    receiptType?: string;
    dateFrom?: string;
    dateTo?: string;
    branchId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 200);
    const where: Prisma.ReceiptWhereInput = { deletedAt: null, isVoided: false };

    if (filters.search) {
      where.OR = [
        { receiptNumber: { contains: filters.search, mode: 'insensitive' } },
        { payerName: { contains: filters.search, mode: 'insensitive' } },
        { contract: { contractNumber: { contains: filters.search, mode: 'insensitive' } } },
        { contract: { customer: { phone: { contains: filters.search } } } },
      ];
    }

    if (filters.receiptType) {
      where.receiptType = filters.receiptType;
    }

    if (filters.dateFrom || filters.dateTo) {
      where.paidDate = {};
      if (filters.dateFrom) {
        where.paidDate.gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        const endDate = new Date(filters.dateTo);
        endDate.setHours(23, 59, 59, 999);
        where.paidDate.lte = endDate;
      }
    }

    if (filters.branchId) {
      where.contract = {
        ...(typeof where.contract === 'object' ? where.contract : {}),
        branchId: filters.branchId,
      } as Prisma.ContractWhereInput;
    }

    const [data, total, summary] = await Promise.all([
      this.prisma.receipt.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          contract: {
            select: {
              contractNumber: true,
              customer: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.receipt.count({ where }),
      this.prisma.receipt.aggregate({
        where,
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary: {
        totalAmount: summary._sum.amount || 0,
        totalCount: summary._count,
      },
    };
  }

  /** Get receipts for a contract */
  async getContractReceipts(contractId: string) {
    return this.prisma.receipt.findMany({
      where: { contractId, deletedAt: null, isVoided: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Get a single receipt */
  async getReceipt(id: string) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id },
      include: {
        contract: {
          select: {
            contractNumber: true,
            customer: { select: { name: true } },
            branch: {
              select: {
                id: true,
                name: true,
                location: true,
                phone: true,
              },
            },
            product: {
              select: {
                id: true,
                name: true,
                imeiSerial: true,
                serialNumber: true,
              },
            },
          },
        },
      },
    });
    if (!receipt || receipt.deletedAt) throw new NotFoundException('ไม่พบใบเสร็จ');

    // Get company info
    const company = await this.prisma.companyInfo.findFirst({
      where: { isActive: true, deletedAt: null },
      select: {
        nameTh: true,
        nameEn: true,
        taxId: true,
        address: true,
        phone: true,
        logoUrl: true,
      },
    });

    return { ...receipt, company };
  }

  /** Get receipt by number */
  async getReceiptByNumber(receiptNumber: string) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { receiptNumber },
      include: {
        contract: {
          select: {
            contractNumber: true,
            customer: { select: { name: true } },
            branch: {
              select: {
                id: true,
                name: true,
                location: true,
                phone: true,
              },
            },
            product: {
              select: {
                id: true,
                name: true,
                imeiSerial: true,
                serialNumber: true,
              },
            },
          },
        },
      },
    });
    if (!receipt || receipt.deletedAt) throw new NotFoundException('ไม่พบใบเสร็จ');

    // Get company info
    const company = await this.prisma.companyInfo.findFirst({
      where: { isActive: true, deletedAt: null },
      select: {
        nameTh: true,
        nameEn: true,
        taxId: true,
        address: true,
        phone: true,
        logoUrl: true,
      },
    });

    return { ...receipt, company };
  }

  /**
   * Void a receipt (ถ้าผิด → ออกใบลดหนี้/ใบแก้ไขแทน)
   * ใบเสร็จที่ออกแล้วห้ามแก้ไข/ลบ
   */
  async voidReceipt(id: string, reason: string, issuedById: string, approvedById: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('กรุณาระบุเหตุผลในการยกเลิก');
    }
    // CR-7: Validate void date is not in a closed accounting period
    await validatePeriodOpen(this.prisma, new Date());
    return this.prisma.$transaction(async (tx) => {
      const receipt = await tx.receipt.findUnique({ where: { id } });
      if (!receipt || receipt.deletedAt) throw new NotFoundException('ไม่พบใบเสร็จ');
      if (receipt.isVoided) throw new BadRequestException('ใบเสร็จนี้ถูกยกเลิกแล้ว');

      // W-006: Credit Note 30-day time limit
      const daysSinceIssue = Math.floor(
        (Date.now() - receipt.createdAt.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSinceIssue > 30) {
        throw new BadRequestException('ไม่สามารถยกเลิกใบเสร็จที่ออกเกิน 30 วัน');
      }

      // Generate credit note number inside transaction (uses FOR UPDATE lock)
      const creditNoteNumber = await this.generateReceiptNumber(tx);
      const creditNote = await tx.receipt.create({
        data: {
          receiptNumber: creditNoteNumber,
          contractId: receipt.contractId,
          paymentId: receipt.paymentId,
          receiptType: 'CREDIT_NOTE',
          payerName: receipt.payerName,
          receiverName: receipt.receiverName,
          amount: receipt.amount,
          installmentNo: receipt.installmentNo,
          paymentMethod: receipt.paymentMethod,
          paidDate: new Date(),
          voidedReceiptId: receipt.id,
          issuedById,
        },
      });

      // Mark original as voided with approval trail
      await tx.receipt.update({
        where: { id },
        data: {
          isVoided: true,
          voidReason: reason.trim(),
          voidApprovedById: approvedById,
          voidApprovedAt: new Date(),
        },
      });

      // Auto journal — create reversal entry for the original payment
      if (receipt.paymentId) {
        try {
          // Find the original journal entry by payment reference
          const originalEntry = await tx.journalEntry.findFirst({
            where: {
              referenceType: 'PAYMENT',
              referenceId: receipt.paymentId,
              status: 'POSTED',
              deletedAt: null,
            },
          });
          if (originalEntry) {
            await this.journalAutoService.createReversalJournal(tx, {
              originalEntryId: originalEntry.id,
              reason: reason.trim(),
              userId: issuedById,
            });
          }
        } catch (err) {
          this.logger.error(`Auto-reversal failed for receipt ${id}: ${err}`);
        }
      }

      return { voidedReceipt: receipt, creditNote };
    });
  }

  /**
   * Generate PDF from receipt HTML
   */
  /** Escape HTML special characters to prevent XSS in PDF templates */
  private escapeHtml(text: string | null | undefined): string {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async generatePDF(id: string): Promise<Buffer> {
    const receipt = await this.getReceipt(id);

    // Payment method labels (matches Prisma PaymentMethod enum)
    const methodLabels: Record<string, string> = {
      CASH: 'เงินสด',
      BANK_TRANSFER: 'โอนเงินผ่านธนาคาร',
      QR_EWALLET: 'QR / e-Wallet',
      CREDIT_BALANCE: 'ใช้ยอดเครดิตในสัญญา',
      ONLINE_GATEWAY: 'ชำระออนไลน์',
    };

    // Sanitize all user-provided data before HTML interpolation
    const safe = {
      companyName: this.escapeHtml(receipt.company?.nameTh) || 'BESTCHOICE',
      companyAddress: this.escapeHtml(receipt.company?.address),
      companyPhone: this.escapeHtml(receipt.company?.phone),
      taxId: this.escapeHtml(receipt.company?.taxId),
      payerName: this.escapeHtml(receipt.payerName),
      payerAddress: this.escapeHtml(receipt.payerAddress),
      payerTaxId: this.escapeHtml(receipt.payerTaxId),
      contractNumber: this.escapeHtml(receipt.contract?.contractNumber),
      productName: this.escapeHtml(receipt.contract?.product?.name),
      imeiSerial: this.escapeHtml(receipt.contract?.product?.imeiSerial),
      serialNumber: this.escapeHtml(receipt.contract?.product?.serialNumber),
      branchName: this.escapeHtml(receipt.contract?.branch?.name),
      branchPhone: this.escapeHtml(receipt.contract?.branch?.phone),
      receiptNumber: this.escapeHtml(receipt.receiptNumber),
      paymentMethodLabel: methodLabels[receipt.paymentMethod ?? ''] ?? this.escapeHtml(receipt.paymentMethod),
      transactionRef: this.escapeHtml(receipt.transactionRef),
    };

    const amountBeforeVat = receipt.amountBeforeVat ? Number(receipt.amountBeforeVat) : null;
    const vatAmount = receipt.vatAmount ? Number(receipt.vatAmount) : null;
    const total = Number(receipt.amount);

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Noto Sans Thai', 'IBM Plex Sans Thai', 'Sarabun', sans-serif;
      margin: 0;
      padding: 16mm 14mm;
      color: #18181b;
      font-size: 11pt;
      line-height: 1.55;
    }
    .receipt { max-width: 100%; }
    .top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      padding-bottom: 14px;
      border-bottom: 2px solid #047857;
      margin-bottom: 18px;
    }
    .top-left { flex: 1; }
    .top-right { text-align: right; }
    .company { font-size: 16pt; font-weight: 700; color: #047857; margin-bottom: 4px; }
    .small { font-size: 9.5pt; color: #52525b; line-height: 1.45; }
    .doc-type {
      display: inline-block;
      font-size: 14pt;
      font-weight: 700;
      color: #047857;
      border: 1.5px solid #047857;
      padding: 4px 14px;
      border-radius: 6px;
      margin-bottom: 6px;
    }
    .doc-meta { font-size: 9.5pt; color: #52525b; }
    .doc-num { font-family: 'IBM Plex Mono', monospace; font-size: 11pt; font-weight: 600; color: #18181b; }

    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 14px;
    }
    .info-card {
      background: #fafaf9;
      border: 1px solid #e4e4e7;
      border-radius: 6px;
      padding: 10px 12px;
    }
    .info-card h4 {
      margin: 0 0 6px 0;
      font-size: 9.5pt;
      font-weight: 600;
      color: #71717a;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .info-card .name { font-weight: 600; font-size: 11pt; }
    .info-card .line { font-size: 9.5pt; color: #52525b; line-height: 1.5; }

    table.items {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
      font-size: 10.5pt;
    }
    table.items th {
      text-align: left;
      padding: 8px 10px;
      background: #ecfdf5;
      color: #065f46;
      font-weight: 600;
      font-size: 9.5pt;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      border-bottom: 2px solid #047857;
    }
    table.items th.right { text-align: right; }
    table.items td {
      padding: 10px;
      border-bottom: 1px solid #e4e4e7;
      vertical-align: top;
    }
    table.items td.right { text-align: right; font-variant-numeric: tabular-nums; }
    .item-name { font-weight: 600; }
    .item-meta { font-size: 9pt; color: #71717a; margin-top: 2px; }

    .totals {
      width: 50%;
      margin-left: auto;
      margin-bottom: 14px;
    }
    .totals .row {
      display: flex;
      justify-content: space-between;
      padding: 5px 12px;
      font-size: 10.5pt;
    }
    .totals .row.subtle { color: #52525b; }
    .totals .row.grand {
      background: #ecfdf5;
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 12pt;
      font-weight: 700;
      color: #047857;
      margin-top: 4px;
    }
    .totals .row.grand .amount { font-size: 14pt; }

    .pay-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      background: #fafaf9;
      border: 1px solid #e4e4e7;
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 14px;
      font-size: 10pt;
    }
    .pay-info .label { color: #71717a; font-size: 9pt; }
    .pay-info .value { font-weight: 600; margin-top: 1px; }

    .balance-bar {
      display: flex;
      justify-content: space-between;
      padding: 10px 14px;
      background: linear-gradient(90deg, #fff7ed 0%, #ffedd5 100%);
      border: 1px solid #fed7aa;
      border-radius: 6px;
      font-size: 10pt;
      margin-bottom: 18px;
    }
    .balance-bar .label { color: #9a3412; font-weight: 500; }
    .balance-bar .value { font-weight: 700; color: #c2410c; font-variant-numeric: tabular-nums; }

    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 60px;
      margin-top: 36px;
      margin-bottom: 18px;
    }
    .sig-block { text-align: center; }
    .sig-line {
      border-top: 1px solid #71717a;
      margin: 0 16px 6px 16px;
      padding-top: 4px;
    }
    .sig-block .small { color: #71717a; }

    .footer {
      text-align: center;
      padding-top: 14px;
      border-top: 1px solid #e4e4e7;
      color: #a1a1aa;
      font-size: 8.5pt;
    }

    .void-overlay {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-15deg);
      font-size: 80pt;
      font-weight: 900;
      color: rgba(220, 38, 38, 0.18);
      letter-spacing: 0.1em;
      pointer-events: none;
    }
  </style>
</head>
<body>
  ${receipt.isVoided ? `<div class="void-overlay">VOID / ยกเลิก</div>` : ''}

  <div class="receipt">
    <!-- Header -->
    <div class="top">
      <div class="top-left">
        <div class="company">${safe.companyName}</div>
        ${safe.companyAddress ? `<div class="small">${safe.companyAddress}</div>` : ''}
        <div class="small">
          ${safe.companyPhone ? `โทร. ${safe.companyPhone}` : ''}
          ${safe.taxId ? ` &nbsp;·&nbsp; เลขประจำตัวผู้เสียภาษี ${safe.taxId}` : ''}
        </div>
      </div>
      <div class="top-right">
        <div class="doc-type">ใบเสร็จรับเงิน</div>
        <div class="doc-meta">
          เลขที่: <span class="doc-num">${safe.receiptNumber}</span><br/>
          วันที่: <span style="font-weight:600">${formatDateShort(receipt.paidDate)}</span>
        </div>
      </div>
    </div>

    <!-- Customer + Branch info -->
    <div class="grid-2">
      <div class="info-card">
        <h4>ผู้ชำระเงิน</h4>
        <div class="name">${safe.payerName}</div>
        ${safe.payerAddress ? `<div class="line">${safe.payerAddress}</div>` : ''}
        ${safe.payerTaxId ? `<div class="line">เลขประจำตัวผู้เสียภาษี ${safe.payerTaxId}</div>` : ''}
      </div>
      <div class="info-card">
        <h4>สาขาที่รับชำระ</h4>
        <div class="name">${safe.branchName || '-'}</div>
        ${safe.branchPhone ? `<div class="line">โทร. ${safe.branchPhone}</div>` : ''}
        <div class="line">เลขสัญญา: <strong>${safe.contractNumber || '-'}</strong></div>
      </div>
    </div>

    <!-- Items table -->
    <table class="items">
      <thead>
        <tr>
          <th>รายการ</th>
          <th class="right">จำนวนเงิน</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <div class="item-name">
              ${receipt.installmentNo ? `ค่างวดผ่อนชำระ งวดที่ ${receipt.installmentNo}` : 'การชำระเงิน'}
            </div>
            ${safe.productName ? `<div class="item-meta">สินค้า: ${safe.productName}</div>` : ''}
            ${safe.imeiSerial ? `<div class="item-meta">IMEI: ${safe.imeiSerial}</div>` : (safe.serialNumber ? `<div class="item-meta">S/N: ${safe.serialNumber}</div>` : '')}
          </td>
          <td class="right">${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>
      </tbody>
    </table>

    <!-- Totals -->
    <div class="totals">
      ${amountBeforeVat !== null && vatAmount !== null ? `
        <div class="row subtle">
          <span>มูลค่าก่อน VAT</span>
          <span>${amountBeforeVat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</span>
        </div>
        <div class="row subtle">
          <span>ภาษีมูลค่าเพิ่ม 7%</span>
          <span>${vatAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</span>
        </div>
      ` : ''}
      <div class="row grand">
        <span>รวมเงินที่ชำระ</span>
        <span class="amount">${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</span>
      </div>
    </div>

    <!-- Payment info -->
    <div class="pay-info">
      <div>
        <div class="label">ช่องทางการชำระ</div>
        <div class="value">${safe.paymentMethodLabel || '-'}</div>
      </div>
      <div>
        <div class="label">เลขอ้างอิงธุรกรรม</div>
        <div class="value" style="font-family: 'IBM Plex Mono', monospace; font-size: 9.5pt;">${safe.transactionRef || '-'}</div>
      </div>
    </div>

    <!-- Remaining balance -->
    ${receipt.remainingBalance && Number(receipt.remainingBalance) > 0 ? `
    <div class="balance-bar">
      <span class="label">ยอดคงเหลือของสัญญา</span>
      <span class="value">${Number(receipt.remainingBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท ${receipt.remainingMonths ? `(${receipt.remainingMonths} งวด)` : ''}</span>
    </div>` : ''}

    <!-- Signatures -->
    <div class="signatures">
      <div class="sig-block">
        <div class="sig-line">&nbsp;</div>
        <div class="small">ผู้รับเงิน</div>
      </div>
      <div class="sig-block">
        <div class="sig-line">&nbsp;</div>
        <div class="small">ผู้ชำระเงิน</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      เอกสารนี้สร้างโดยระบบอัตโนมัติ &nbsp;·&nbsp; ${safe.companyName}
    </div>
  </div>
</body>
</html>`;

    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    await browser.close();

    return Buffer.from(pdf);
  }
}
