import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class ReceiptsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generate receipt number: RC-YYYY-MM-NNNNN
   */
  private async generateReceiptNumber(tx?: any): Promise<string> {
    const db = tx || this.prisma;
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `RC-${year}-${month}-`;

    const lastReceipt = await db.receipt.findFirst({
      where: { receiptNumber: { startsWith: prefix } },
      orderBy: { receiptNumber: 'desc' },
      select: { receiptNumber: true },
    });

    let seq = 1;
    if (lastReceipt) {
      const lastSeq = parseInt(lastReceipt.receiptNumber.replace(prefix, ''));
      seq = lastSeq + 1;
    }

    return `${prefix}${String(seq).padStart(5, '0')}`;
  }

  /**
   * Auto-generate e-Receipt after payment recording
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
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        customer: { select: { name: true } },
        payments: { where: { status: 'PAID' }, select: { amountPaid: true } },
      },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    // Get company info
    const company = await this.prisma.companyInfo.findFirst({ where: { isActive: true } });
    const receiverName = company?.nameTh || 'บริษัท เบสท์ช้อยส์โฟน จำกัด';

    // Calculate remaining balance
    const totalPaid = contract.payments.reduce((sum, p) => sum + Number(p.amountPaid), 0);
    const remainingBalance = Number(contract.financedAmount) - totalPaid;
    const totalMonths = contract.totalMonths;
    const paidMonths = contract.payments.length;
    const remainingMonths = totalMonths - paidMonths;

    const receiptNumber = await this.generateReceiptNumber();

    // Generate receipt content hash
    const receiptContent = JSON.stringify({
      receiptNumber,
      contractId,
      amount,
      installmentNo,
      paidDate: new Date().toISOString(),
    });
    const fileHash = crypto.createHash('sha256').update(receiptContent).digest('hex');

    const receipt = await this.prisma.receipt.create({
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

    return receipt;
  }

  /** Get receipts for a contract */
  async getContractReceipts(contractId: string) {
    return this.prisma.receipt.findMany({
      where: { contractId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Get a single receipt */
  async getReceipt(id: string) {
    const receipt = await this.prisma.receipt.findUnique({ where: { id } });
    if (!receipt) throw new NotFoundException('ไม่พบใบเสร็จ');
    return receipt;
  }

  /** Get receipt by number */
  async getReceiptByNumber(receiptNumber: string) {
    const receipt = await this.prisma.receipt.findUnique({ where: { receiptNumber } });
    if (!receipt) throw new NotFoundException('ไม่พบใบเสร็จ');
    return receipt;
  }

  /**
   * Void a receipt (ถ้าผิด → ออกใบลดหนี้/ใบแก้ไขแทน)
   * ใบเสร็จที่ออกแล้วห้ามแก้ไข/ลบ
   */
  async voidReceipt(id: string, reason: string, issuedById: string) {
    const receipt = await this.prisma.receipt.findUnique({ where: { id } });
    if (!receipt) throw new NotFoundException('ไม่พบใบเสร็จ');
    if (receipt.isVoided) throw new BadRequestException('ใบเสร็จนี้ถูกยกเลิกแล้ว');

    // Create credit note receipt
    const creditNoteNumber = await this.generateReceiptNumber();
    const creditNote = await this.prisma.receipt.create({
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
    await this.prisma.receipt.update({
      where: { id },
      data: { isVoided: true, voidReason: reason },
    });

    return { voidedReceipt: receipt, creditNote };
  }
}
