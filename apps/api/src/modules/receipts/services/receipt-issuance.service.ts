import { Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { LineOaService } from '../../line-oa/line-oa.service';
import { ReceiptNumberService } from './receipt-number.service';

/**
 * Receipt issuance: e-Receipt generation ($tx #1, NO journal entry) + manual
 * LINE OA push. Shares the receipt-number sequencer with the void path.
 */
export class ReceiptIssuanceService {
  private readonly logger = new Logger(ReceiptIssuanceService.name);
  constructor(
    private prisma: PrismaService,
    private lineOaService: LineOaService | undefined,
    private numbers: ReceiptNumberService,
  ) {}

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
    /** วันที่รับเงินจริง (D4 backdating) — default = ตอนออกใบ. ใบเสร็จต้องลงวันที่เงินเข้า ไม่ใช่วันที่พิมพ์ */
    paidDate?: Date,
  ) {
    const receiptPaidDate = paidDate ?? new Date();
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

      // Calculate remaining balance with Decimal arithmetic — avoids float
      // drift on the persisted remainingBalance field (Decimal(12,2)).
      const totalPaid = contract.payments.reduce(
        (sum, p) => sum.add(new Prisma.Decimal(p.amountPaid.toString())),
        new Prisma.Decimal(0),
      );
      const remainingBalanceDec = new Prisma.Decimal(contract.financedAmount.toString()).sub(
        totalPaid,
      );
      const remainingBalance = Prisma.Decimal.max(remainingBalanceDec, new Prisma.Decimal(0));
      const totalMonths = contract.totalMonths;
      const paidMonths = contract.payments.length;
      const remainingMonths = totalMonths - paidMonths;

      // Per-installment partial receipt fields (CPA Policy A spec):
      //   paymentStatus: PARTIAL until Payment.status flips to PAID, then PAID
      //   installmentPartialSeq: 1, 2, 3 ... within same installment (null on full payment)
      //   remainingAmount: amountDue - cumulative receipt amounts for this installment
      //
      // Voided receipts are intentionally excluded from priorReceipts: a voided
      // receipt is legally non-existent (มาตรฐานการบัญชี — กลับรายการแล้วถือ
      // เสมือนไม่ได้ออก) so the next receipt re-uses its slot in the seq —
      // e.g. if seq #2 is voided, the following partial becomes #2, not #3.
      // This matches how an accountant would re-issue a corrected receipt.
      let paymentStatus = 'PAID';
      let installmentPartialSeq: number | null = null;
      let remainingAmount: Prisma.Decimal | null = null;
      if (paymentId && installmentNo != null) {
        const payment = await tx.payment.findUnique({
          where: { id: paymentId },
          select: { status: true, amountDue: true },
        });
        if (payment) {
          const priorReceipts = await tx.receipt.findMany({
            where: {
              contractId,
              installmentNo,
              isVoided: false,
              deletedAt: null,
            },
            select: { amount: true },
          });
          const priorTotal = priorReceipts.reduce(
            (acc, r) => acc.plus(r.amount),
            new Prisma.Decimal(0),
          );
          const cumulative = priorTotal.plus(amount);
          const due = new Prisma.Decimal((payment.amountDue ?? 0).toString());
          paymentStatus = payment.status === 'PAID' ? 'PAID' : 'PARTIAL';
          installmentPartialSeq = paymentStatus === 'PARTIAL' ? priorReceipts.length + 1 : null;
          const remainder = due.minus(cumulative);
          remainingAmount = remainder.gt(0) ? remainder : new Prisma.Decimal(0);
        }
      }

      // Generate receipt number inside transaction (uses FOR UPDATE lock)
      const receiptNumber = await this.numbers.generateReceiptNumber(tx);

      // Generate receipt content hash
      const receiptContent = JSON.stringify({
        receiptNumber,
        contractId,
        amount,
        installmentNo,
        paidDate: receiptPaidDate.toISOString(),
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
          remainingBalance,
          remainingMonths: Math.max(0, remainingMonths),
          paymentStatus,
          installmentPartialSeq,
          remainingAmount,
          paymentMethod,
          transactionRef,
          paidDate: receiptPaidDate,
          fileHash,
          issuedById,
        },
      });

      // Send receipt via LINE if customer is linked
      if (this.lineOaService) {
        try {
          // Payment receipts go through FINANCE OA (channelKey='line-finance').
          const customer = await tx.customer.findFirst({
            where: {
              contracts: { some: { id: contractId } },
              lineIdFinance: { not: null },
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

  /** Manually push the receipt to the customer's LINE OA. */
  async sendReceiptToCustomer(id: string) {
    if (!this.lineOaService) {
      throw new BadRequestException('LINE OA ยังไม่ได้ตั้งค่า');
    }
    const receipt = await this.prisma.receipt.findUnique({
      where: { id },
      include: { contract: { select: { customerId: true } } },
    });
    if (!receipt || receipt.deletedAt) throw new NotFoundException('ไม่พบใบเสร็จ');
    if (!receipt.contract?.customerId) {
      throw new BadRequestException('ใบเสร็จนี้ไม่มีลูกค้าที่เชื่อมโยง');
    }
    const sent = await this.lineOaService.sendPaymentReceipt(receipt.contract.customerId, receipt);
    if (!sent) {
      throw new BadRequestException(
        'ไม่สามารถส่งได้ ลูกค้ายังไม่ได้เชื่อม LINE หรือยังไม่ได้ให้ความยินยอม PDPA',
      );
    }
    return { success: true };
  }
}
