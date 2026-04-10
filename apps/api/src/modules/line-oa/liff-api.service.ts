import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  LiffContractResponse,
  LiffHistoryResponse,
  LiffProfileResponse,
  LiffRegisterLookupResponse,
} from '@installment/shared';

@Injectable()
export class LiffApiService {
  private readonly logger = new Logger(LiffApiService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Contracts ──────────────────────────────────────

  async findCustomerContractsFull(lineId: string): Promise<LiffContractResponse | null> {
    const customer = await this.prisma.customer.findFirst({
      where: { lineId, deletedAt: null },
      select: {
        id: true,
        name: true,
        contracts: {
          where: {
            status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'EARLY_PAYOFF'] },
            deletedAt: null,
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            contractNumber: true,
            status: true,
            sellingPrice: true,
            downPayment: true,
            monthlyPayment: true,
            totalMonths: true,
            createdAt: true,
            product: {
              select: { name: true, brand: true, model: true },
            },
            payments: {
              orderBy: { installmentNo: 'asc' },
              select: {
                id: true,
                installmentNo: true,
                dueDate: true,
                amountDue: true,
                amountPaid: true,
                lateFee: true,
                status: true,
                paidDate: true,
                paymentMethod: true,
              },
            },
          },
        },
      },
    });

    if (!customer) return null;

    return {
      customer: { name: customer.name },
      contracts: customer.contracts.map((c) => {
        const totalPaid = c.payments.filter((p) => p.status === 'PAID').length;
        const totalOutstanding = c.payments
          .filter((p) => p.status !== 'PAID')
          .reduce(
            (sum, p) => sum
              .add(new Prisma.Decimal(p.amountDue as unknown as string))
              .add(new Prisma.Decimal(p.lateFee as unknown as string))
              .sub(new Prisma.Decimal(p.amountPaid as unknown as string)),
            new Prisma.Decimal(0),
          );

        return {
          id: c.id,
          contractNumber: c.contractNumber,
          status: c.status,
          product: c.product
            ? `${c.product.brand || ''} ${c.product.model || c.product.name}`.trim()
            : '-',
          sellingPrice: new Prisma.Decimal(c.sellingPrice as unknown as string).toNumber(),
          downPayment: new Prisma.Decimal(c.downPayment as unknown as string).toNumber(),
          monthlyPayment: new Prisma.Decimal(c.monthlyPayment as unknown as string).toNumber(),
          totalMonths: c.totalMonths,
          paidInstallments: totalPaid,
          totalOutstanding: totalOutstanding.toDecimalPlaces(2).toNumber(),
          createdAt: c.createdAt.toISOString(),
          payments: c.payments.map((p) => ({
            installmentNo: p.installmentNo,
            dueDate: p.dueDate.toISOString(),
            amountDue: new Prisma.Decimal(p.amountDue as unknown as string).toNumber(),
            amountPaid: new Prisma.Decimal(p.amountPaid as unknown as string).toNumber(),
            lateFee: new Prisma.Decimal(p.lateFee as unknown as string).toNumber(),
            status: p.status,
            paidDate: p.paidDate ? p.paidDate.toISOString() : null,
            paymentMethod: p.paymentMethod,
          })),
        };
      }),
    };
  }

  // ─── Registration ───────────────────────────────────

  async isLineIdLinked(lineId: string): Promise<boolean> {
    const customer = await this.prisma.customer.findFirst({
      where: { lineId, deletedAt: null },
    });
    return !!customer;
  }

  async lookupCustomerByPhone(
    phone: string,
    lineId: string,
  ): Promise<LiffRegisterLookupResponse | null> {
    // Check if this lineId is already linked
    const alreadyLinked = await this.prisma.customer.findFirst({
      where: { lineId, deletedAt: null },
    });
    if (alreadyLinked) return null;

    // Normalize: strip dashes/spaces so "0922222222" matches "092-222-2222"
    const digits = phone.replace(/\D/g, '');
    const phoneVariants = [digits];
    if (digits.length === 10) {
      phoneVariants.push(`${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`);
      phoneVariants.push(`${digits.slice(0, 3)}-${digits.slice(3)}`);
    } else if (digits.length === 9) {
      phoneVariants.push(`${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`);
    }

    const customer = await this.prisma.customer.findFirst({
      where: {
        deletedAt: null,
        phone: { in: phoneVariants },
      },
    });

    if (!customer) return null;

    return {
      customerId: customer.id,
      maskedName: this.maskThaiName(customer.name),
    };
  }

  async confirmLinkLine(
    customerId: string,
    lineId: string,
  ): Promise<{ success: boolean; error?: string }> {
    // Check if lineId already linked to another customer
    const existingLink = await this.prisma.customer.findFirst({
      where: { lineId, deletedAt: null },
    });
    if (existingLink) {
      return { success: false, error: 'บัญชี LINE นี้เชื่อมต่อกับลูกค้ารายอื่นแล้ว' };
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer || customer.deletedAt) {
      return { success: false, error: 'ไม่พบข้อมูลลูกค้า' };
    }
    if (customer.lineId && customer.lineId !== lineId) {
      return { success: false, error: 'ลูกค้ารายนี้เชื่อมต่อกับบัญชี LINE อื่นแล้ว' };
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: { lineId },
    });

    this.logger.log(`[LIFF] Linked LINE ${lineId} to customer ${customer.name} via registration`);
    return { success: true };
  }

  // ─── History & Profile ──────────────────────────────

  async findCustomerPaymentHistory(lineId: string): Promise<LiffHistoryResponse | null> {
    const customer = await this.prisma.customer.findFirst({
      where: { lineId, deletedAt: null },
      select: {
        name: true,
        contracts: {
          where: { deletedAt: null },
          select: {
            contractNumber: true,
            payments: {
              where: { status: 'PAID' },
              orderBy: { paidDate: 'desc' },
              select: {
                installmentNo: true,
                amountPaid: true,
                paidDate: true,
                paymentMethod: true,
                lateFee: true,
              },
            },
          },
        },
      },
    });

    if (!customer) return null;

    const payments = customer.contracts.flatMap((c) =>
      c.payments.map((p) => ({
        contractNumber: c.contractNumber,
        installmentNo: p.installmentNo,
        amountPaid: new Prisma.Decimal(p.amountPaid as unknown as string).toNumber(),
        paidDate: p.paidDate ? p.paidDate.toISOString() : null,
        paymentMethod: p.paymentMethod,
        lateFee: new Prisma.Decimal(p.lateFee as unknown as string).toNumber(),
      })),
    );

    payments.sort((a, b) => {
      if (!a.paidDate || !b.paidDate) return 0;
      return new Date(b.paidDate).getTime() - new Date(a.paidDate).getTime();
    });

    return { customer: { name: customer.name }, payments };
  }

  async findCustomerProfile(lineId: string): Promise<LiffProfileResponse | null> {
    const customer = await this.prisma.customer.findFirst({
      where: { lineId, deletedAt: null },
      select: {
        id: true,
        name: true,
        phone: true,
        _count: { select: { contracts: { where: { deletedAt: null } } } },
      },
    });

    if (!customer) return null;

    const pointsAggregate = await this.prisma.loyaltyPoint.aggregate({
      where: { customerId: customer.id, deletedAt: null },
      _sum: { points: true },
    });

    return {
      name: customer.name,
      phone: customer.phone || '-',
      lineDisplayName: '-', // Frontend overlays with LIFF profile displayName
      contractCount: customer._count.contracts,
      totalPoints: pointsAggregate._sum.points ?? 0,
    };
  }

  // ─── Unlink ─────────────────────────────────────────

  async unlinkLineAccount(lineId: string): Promise<{ success: boolean; error?: string }> {
    const customer = await this.prisma.customer.findFirst({
      where: { lineId, deletedAt: null },
    });

    if (!customer) {
      return { success: false, error: 'ไม่พบบัญชีที่ผูกกับ LINE นี้' };
    }

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { lineId: null },
    });

    this.logger.log(`[LIFF] Unlinked LINE ${lineId} from customer ${customer.name}`);
    return { success: true };
  }

  // ─── Payment Helpers ────────────────────────────────

  async findCustomerByLineId(lineId: string) {
    return this.prisma.customer.findFirst({
      where: { lineId, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  async findContractForCustomer(contractId: string, customerId: string) {
    return this.prisma.contract.findFirst({
      where: { id: contractId, customerId, deletedAt: null },
    });
  }

  async countRecentPaymentLinks(contractId: string): Promise<number> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.prisma.paymentLink.count({
      where: {
        contractId,
        createdAt: { gte: twentyFourHoursAgo },
      },
    });
  }

  // ─── PDPA Consent ───────────────────────────────────

  async getConsentStatus(lineId: string): Promise<{ consent: boolean; consentAt: string | null } | null> {
    const customer = await this.prisma.customer.findFirst({
      where: { lineId, deletedAt: null },
      select: { chatConsent: true, chatConsentAt: true },
    });
    if (!customer) return null;
    return {
      consent: customer.chatConsent,
      consentAt: customer.chatConsentAt ? customer.chatConsentAt.toISOString() : null,
    };
  }

  async updateConsent(lineId: string, consent: boolean): Promise<{ success: boolean; error?: string }> {
    const customer = await this.prisma.customer.findFirst({
      where: { lineId, deletedAt: null },
    });
    if (!customer) {
      return { success: false, error: 'ไม่พบข้อมูลลูกค้า' };
    }

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        chatConsent: consent,
        chatConsentAt: consent ? new Date() : null,
      },
    });

    this.logger.log(`[LIFF] Consent ${consent ? 'granted' : 'revoked'} for LINE ${lineId}`);
    return { success: true };
  }

  // ─── Utilities ──────────────────────────────────────

  maskThaiName(name: string): string {
    return name
      .split(' ')
      .map((part) => {
        if (part.length <= 2) return part + '***';
        return part.substring(0, 2) + '***';
      })
      .join(' ');
  }
}
