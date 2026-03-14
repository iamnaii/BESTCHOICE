import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { randomBytes } from 'crypto';

@Injectable()
export class PaymentLinkService {
  private readonly logger = new Logger(PaymentLinkService.name);
  private readonly baseUrl: string;
  private readonly expiryHours: number;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.baseUrl = this.configService.get<string>('PAYMENT_LINK_BASE_URL') || 'https://bestchoice.example.com';
    this.expiryHours = 24; // Payment links expire in 24 hours
  }

  /**
   * Create a payment link for a specific contract/installment
   */
  async createPaymentLink(contractId: string, installmentNo?: number, overrideAmount?: number): Promise<{
    token: string;
    url: string;
    expiresAt: Date;
    amount: number;
  }> {
    // Find the contract and next pending payment
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        payments: {
          orderBy: { installmentNo: 'asc' },
          where: installmentNo ? { installmentNo } : { status: { not: 'PAID' } },
          take: 1,
        },
      },
    });

    if (!contract) {
      throw new NotFoundException('ไม่พบสัญญา');
    }

    const payment = contract.payments[0];
    if (!payment) {
      throw new NotFoundException('ไม่พบงวดค้างชำระ');
    }

    const amount = overrideAmount ?? (Number(payment.amountDue) + Number(payment.lateFee) - Number(payment.amountPaid));

    // Generate unique token
    const token = randomBytes(32).toString('hex');

    // Set expiry time
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.expiryHours);

    // Create payment link record
    await this.prisma.paymentLink.create({
      data: {
        token,
        contractId,
        paymentId: payment.id,
        amount,
        status: 'ACTIVE',
        expiresAt,
      },
    });

    const url = `${this.baseUrl}/pay/${token}`;

    this.logger.log(`Payment link created for contract ${contract.contractNumber} installment ${payment.installmentNo}`);

    return { token, url, expiresAt, amount };
  }

  /**
   * Validate and retrieve payment link details
   */
  async getPaymentLink(token: string) {
    const link = await this.prisma.paymentLink.findUnique({
      where: { token },
      include: {
        contract: {
          include: {
            customer: { select: { name: true, phone: true, lineId: true } },
            payments: { orderBy: { installmentNo: 'asc' } },
          },
        },
        payment: true,
      },
    });

    if (!link) {
      return null;
    }

    // Check expiry
    if (link.expiresAt < new Date()) {
      // Auto-expire
      if (link.status === 'ACTIVE') {
        await this.prisma.paymentLink.update({
          where: { id: link.id },
          data: { status: 'EXPIRED' },
        });
      }
      return { ...link, status: 'EXPIRED' as const };
    }

    return link;
  }

  /**
   * Mark payment link as used
   */
  async markAsUsed(token: string): Promise<void> {
    await this.prisma.paymentLink.update({
      where: { token },
      data: {
        status: 'USED',
        usedAt: new Date(),
      },
    });
  }

  /**
   * Expire old payment links (cleanup job)
   */
  async expireOldLinks(): Promise<number> {
    const result = await this.prisma.paymentLink.updateMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });

    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} payment links`);
    }

    return result.count;
  }
}
