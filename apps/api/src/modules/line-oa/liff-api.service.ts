import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toNum, calcOutstanding } from '../../utils/decimal.util';
import { maskThaiName } from '../../utils/mask-name.util';
// Return types for LIFF API (mirrors packages/shared/src/liff-types.ts)
interface LiffPaymentItem { installmentNo: number; dueDate: string; amountDue: number; amountPaid: number; lateFee: number; status: string; paidDate: string | null; paymentMethod: string | null; }
interface LiffContractItem { id: string; contractNumber: string; status: string; dunningStage: string; daysOverdue: number; product: string; sellingPrice: number; downPayment: number; monthlyPayment: number; totalMonths: number; paidInstallments: number; totalOutstanding: number; createdAt: string; payments: LiffPaymentItem[]; }
interface LiffContractResponse { customer: { name: string }; contracts: LiffContractItem[]; }
interface LiffHistoryPayment { contractNumber: string; installmentNo: number; amountPaid: number; paidDate: string | null; paymentMethod: string | null; lateFee: number; receiptId: string | null; }
interface LiffHistoryResponse { customer: { name: string }; payments: LiffHistoryPayment[]; }
interface LiffProfileResponse { name: string; phone: string; lineDisplayName: string; contractCount: number; totalPoints: number; }
interface LiffRegisterLookupResponse { customerId: string; maskedName: string; }

@Injectable()
export class LiffApiService {
  private readonly logger = new Logger(LiffApiService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Contracts ──────────────────────────────────────

  async findCustomerContractsFull(lineId: string): Promise<LiffContractResponse | null> {
    const customer = await this.prisma.customer.findFirst({
      where: { lineIdShop: lineId, deletedAt: null },
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
            // T4-C5 — surface the dunning stage so the LIFF badge can show
            // the customer where they are in the collection cycle rather
            // than them only finding out via a surprise SMS.
            dunningStage: true,
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
        const totalOutstanding = calcOutstanding(
          c.payments.filter((p) => p.status !== 'PAID'),
        );

        // T4-C5 — compute days past due from the oldest unpaid installment.
        // The LIFF badge uses this number directly; service is the single
        // source of truth so the client never invents a count of its own.
        const now = Date.now();
        const oldestUnpaid = c.payments
          .filter((p) => p.status !== 'PAID')
          .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
        const daysOverdue =
          oldestUnpaid && oldestUnpaid.dueDate.getTime() < now
            ? Math.floor((now - oldestUnpaid.dueDate.getTime()) / 86_400_000)
            : 0;

        return {
          id: c.id,
          contractNumber: c.contractNumber,
          status: c.status,
          dunningStage: c.dunningStage ?? 'NONE',
          daysOverdue,
          product: c.product
            ? `${c.product.brand || ''} ${c.product.model || c.product.name}`.trim()
            : '-',
          sellingPrice: toNum(c.sellingPrice),
          downPayment: toNum(c.downPayment),
          monthlyPayment: toNum(c.monthlyPayment),
          totalMonths: c.totalMonths,
          paidInstallments: totalPaid,
          totalOutstanding: Math.round(totalOutstanding * 100) / 100,
          createdAt: c.createdAt.toISOString(),
          payments: c.payments.map((p) => ({
            installmentNo: p.installmentNo,
            dueDate: p.dueDate.toISOString(),
            amountDue: toNum(p.amountDue),
            amountPaid: toNum(p.amountPaid),
            lateFee: toNum(p.lateFee),
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
      where: { lineIdShop: lineId, deletedAt: null },
    });
    return !!customer;
  }

  async lookupCustomerByPhone(
    phone: string,
    lineId: string,
  ): Promise<LiffRegisterLookupResponse | null> {
    // Check if this lineId is already linked
    const alreadyLinked = await this.prisma.customer.findFirst({
      where: { lineIdShop: lineId, deletedAt: null },
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
      maskedName: maskThaiName(customer.name),
    };
  }

  async confirmLinkLine(
    customerId: string,
    lineId: string,
  ): Promise<{ success: boolean; error?: string }> {
    // Check if lineId already linked to another customer (shop OA)
    const existingLink = await this.prisma.customer.findFirst({
      where: { lineIdShop: lineId, deletedAt: null },
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
    if (customer.lineIdShop && customer.lineIdShop !== lineId) {
      return { success: false, error: 'ลูกค้ารายนี้เชื่อมต่อกับบัญชี LINE อื่นแล้ว' };
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: { lineIdShop: lineId },
    });

    this.logger.log(`[LIFF] Linked LINE ${lineId} to customer ${customer.name} via shop registration`);
    return { success: true };
  }

  // ─── History & Profile ──────────────────────────────

  async findCustomerPaymentHistory(lineId: string): Promise<LiffHistoryResponse | null> {
    const customer = await this.prisma.customer.findFirst({
      where: { lineIdShop: lineId, deletedAt: null },
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
                id: true,
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

    // Collect paymentIds to look up receipts in one follow-up query.
    // Receipt has a scalar paymentId (no Prisma back-relation on Payment),
    // so we can't `include` it from the payment tree above.
    const paymentIds = customer.contracts.flatMap((c) => c.payments.map((p) => p.id));
    const receipts = paymentIds.length
      ? await this.prisma.receipt.findMany({
          where: {
            paymentId: { in: paymentIds },
            isVoided: false,
            deletedAt: null,
          },
          select: { id: true, paymentId: true },
        })
      : [];
    const receiptByPaymentId = new Map<string, string>();
    for (const r of receipts) {
      if (r.paymentId) receiptByPaymentId.set(r.paymentId, r.id);
    }

    const payments = customer.contracts.flatMap((c) =>
      c.payments.map((p) => ({
        contractNumber: c.contractNumber,
        installmentNo: p.installmentNo,
        amountPaid: toNum(p.amountPaid),
        paidDate: p.paidDate ? p.paidDate.toISOString() : null,
        paymentMethod: p.paymentMethod,
        lateFee: toNum(p.lateFee),
        receiptId: receiptByPaymentId.get(p.id) ?? null,
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
      where: { lineIdShop: lineId, deletedAt: null },
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
      where: { lineIdShop: lineId, deletedAt: null },
    });

    if (!customer) {
      return { success: false, error: 'ไม่พบบัญชีที่ผูกกับ LINE นี้' };
    }

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { lineIdShop: null },
    });

    this.logger.log(`[LIFF] Unlinked LINE ${lineId} from customer ${customer.name}`);
    return { success: true };
  }

  // ─── Payment Helpers ────────────────────────────────

  async findCustomerByLineId(lineId: string) {
    return this.prisma.customer.findFirst({
      where: { lineIdShop: lineId, deletedAt: null },
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
      where: { lineIdShop: lineId, deletedAt: null },
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
      where: { lineIdShop: lineId, deletedAt: null },
    });
    if (!customer) {
      return { success: false, error: 'ไม่พบข้อมูลลูกค้า' };
    }

    // Always set chatConsentAt to track when the last consent action happened (grant or revoke).
    // PDPA requires audit trail — never null out the timestamp.
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        chatConsent: consent,
        chatConsentAt: new Date(),
      },
    });

    this.logger.log(`[LIFF] Consent ${consent ? 'granted' : 'revoked'} for LINE ${lineId}`);
    return { success: true };
  }

  // ─── Notification Preferences ────────────────────────

  async getNotificationPreferences(lineId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { lineIdShop: lineId, deletedAt: null },
      select: {
        notifPaymentReminder: true,
        notifOverdueNotice: true,
        notifReceipt: true,
      },
    });
    if (!customer) return null;
    return {
      paymentReminder: customer.notifPaymentReminder,
      overdueNotice: customer.notifOverdueNotice,
      receiptNotification: customer.notifReceipt,
    };
  }

  async updateNotificationPreferences(
    lineId: string,
    prefs: { paymentReminder: boolean; overdueNotice: boolean; receiptNotification: boolean },
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { lineIdShop: lineId, deletedAt: null },
    });
    if (!customer) return { success: false, error: 'ไม่พบข้อมูลลูกค้า' };

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        notifPaymentReminder: prefs.paymentReminder,
        notifOverdueNotice: prefs.overdueNotice,
        notifReceipt: prefs.receiptNotification,
      },
    });

    this.logger.log(`[LIFF] Notification prefs updated for LINE ${lineId}`);
    return { success: true };
  }

}
