import { Injectable, Logger, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { formatDateShort } from '../../utils/thai-date.util';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import * as puppeteer from 'puppeteer';
import { LineOaService } from '../line-oa/line-oa.service';

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);
  constructor(
    private prisma: PrismaService,
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
    // from getting the same sequence number
    const result = await db.$queryRaw<Array<{ receiptNumber: string }>>`
      SELECT "receiptNumber" FROM "Receipt"
      WHERE "receiptNumber" LIKE ${prefix + '%'}
      ORDER BY "receiptNumber" DESC
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
    const where: Prisma.ReceiptWhereInput = { deletedAt: null };

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
      where: { contractId, deletedAt: null },
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
  async voidReceipt(id: string, reason: string, issuedById: string) {
    return this.prisma.$transaction(async (tx) => {
      const receipt = await tx.receipt.findUnique({ where: { id } });
      if (!receipt || receipt.deletedAt) throw new NotFoundException('ไม่พบใบเสร็จ');
      if (receipt.isVoided) throw new BadRequestException('ใบเสร็จนี้ถูกยกเลิกแล้ว');

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

      // Mark original as voided
      await tx.receipt.update({
        where: { id },
        data: { isVoided: true, voidReason: reason },
      });

      return { voidedReceipt: receipt, creditNote };
    });
  }

  /**
   * Generate PDF from receipt HTML
   */
  async generatePDF(id: string): Promise<Buffer> {
    const receipt = await this.getReceipt(id);

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    // HTML template (simplified version)
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Noto Sans Thai', sans-serif; margin: 0; padding: 20px; }
    .receipt { max-width: 600px; margin: 0 auto; }
    .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 20px; }
    .company { font-size: 24px; font-weight: bold; }
    .type { font-size: 18px; color: #2563eb; margin-top: 10px; }
    .number { font-size: 14px; color: #666; }
    .section { margin: 20px 0; }
    .row { display: flex; justify-content: space-between; margin: 10px 0; }
    .label { color: #666; }
    .value { font-weight: 500; }
    .amount { font-size: 24px; font-weight: bold; color: #16a34a; }
    .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #ccc; color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <div class="company">${receipt.company?.nameTh || 'BESTCHOICE'}</div>
      ${receipt.company?.taxId ? `<div>เลขประจำตัวผู้เสียภาษี: ${receipt.company.taxId}</div>` : ''}
      <div class="type">ใบเสร็จรับเงิน</div>
      <div class="number">${receipt.receiptNumber}</div>
    </div>

    <div class="section">
      <div class="row">
        <span class="label">ผู้ชำระเงิน:</span>
        <span class="value">${receipt.payerName}</span>
      </div>
      <div class="row">
        <span class="label">เลขสัญญา:</span>
        <span class="value">${receipt.contract?.contractNumber || '-'}</span>
      </div>
      ${receipt.contract?.product ? `
      <div class="row">
        <span class="label">สินค้า:</span>
        <span class="value">${receipt.contract.product.name}</span>
      </div>` : ''}
      <div class="row">
        <span class="label">วันที่ชำระ:</span>
        <span class="value">${formatDateShort(receipt.paidDate)}</span>
      </div>
    </div>

    <div class="section" style="text-align: center; padding: 20px; background: #f3f4f6; border-radius: 8px;">
      <div>จำนวนเงินที่ชำระ</div>
      <div class="amount">${Number(receipt.amount).toLocaleString()} บาท</div>
      ${receipt.installmentNo ? `<div>งวดที่ ${receipt.installmentNo}</div>` : ''}
    </div>

    ${receipt.remainingBalance ? `
    <div class="section">
      <div class="row">
        <span class="label">ยอดคงเหลือ:</span>
        <span class="value" style="color: #ea580c;">${Number(receipt.remainingBalance).toLocaleString()} บาท</span>
      </div>
      ${receipt.remainingMonths ? `
      <div class="row">
        <span class="label">งวดที่เหลือ:</span>
        <span class="value">${receipt.remainingMonths} งวด</span>
      </div>` : ''}
    </div>` : ''}

    <div class="footer">
      <p>เอกสารนี้สร้างโดยระบบอัตโนมัติ</p>
      <p>www.bestchoice.com</p>
    </div>
  </div>
</body>
</html>`;

    await page.setContent(html);

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
    });

    await browser.close();

    return Buffer.from(pdf);
  }
}
