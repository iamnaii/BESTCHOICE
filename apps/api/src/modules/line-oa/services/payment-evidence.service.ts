import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { toNum as d, calcOutstanding as sumOutstanding } from '../../../utils/decimal.util';
import { formatDateShort } from '../../../utils/thai-date.util';
import { LineOaService } from '../line-oa.service';
import { StorageService } from '../../storage/storage.service';
import { PaymentLinkService } from '../payment-links/payment-link.service';
import {
  SlipUploadBodyDto,
  ApproveEvidenceDto,
  BatchApproveEvidenceDto,
  BatchRejectEvidenceDto,
} from '../dto/evidence.dto';

@Injectable()
export class PaymentEvidenceService {
  private readonly logger = new Logger(PaymentEvidenceService.name);

  constructor(
    private prisma: PrismaService,
    private lineOaService: LineOaService,
    private storageService: StorageService,
    private paymentLinkService: PaymentLinkService,
  ) {}

  async getEvidenceStats() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [pendingCount, approvedToday, rejectedToday, approvedAmountToday] = await Promise.all([
      this.prisma.paymentEvidence.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.paymentEvidence.count({ where: { status: 'APPROVED', reviewedAt: { gte: todayStart } } }),
      this.prisma.paymentEvidence.count({ where: { status: 'REJECTED', reviewedAt: { gte: todayStart } } }),
      this.prisma.paymentEvidence.aggregate({ where: { status: 'APPROVED', reviewedAt: { gte: todayStart } }, _sum: { amount: true } }),
    ]);

    return {
      pendingCount,
      approvedToday,
      rejectedToday,
      approvedAmountToday: approvedAmountToday._sum.amount || 0,
    };
  }

  async getEvidenceList(
    status?: string,
    search?: string,
    dateFrom?: string,
    dateTo?: string,
    amountMin?: string,
    amountMax?: string,
    limit?: string,
  ) {
    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    if (search) {
      where.contract = {
        OR: [
          { contractNumber: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
        ],
      };
    }

    if (dateFrom || dateTo) {
      const dateFilter: Record<string, Date> = {};
      if (dateFrom) dateFilter.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.createdAt = dateFilter;
    }

    if (amountMin || amountMax) {
      const amountFilter: Record<string, number> = {};
      if (amountMin) amountFilter.gte = Number(amountMin);
      if (amountMax) amountFilter.lte = Number(amountMax);
      where.amount = amountFilter;
    }

    const take = limit ? Math.min(Number(limit), 10000) : 50;

    const evidences = await this.prisma.paymentEvidence.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        contract: {
          select: {
            contractNumber: true,
            customer: { select: { name: true, phone: true } },
          },
        },
        reviewedBy: { select: { name: true } },
      },
    });

    // Resolve S3 keys to signed download URLs for slip images
    if (this.storageService.configured) {
      await Promise.all(
        evidences.map(async (ev) => {
          if (ev.imageUrl && !ev.imageUrl.startsWith('http') && !ev.imageUrl.startsWith('/')) {
            try {
              (ev as { imageUrl: string }).imageUrl =
                await this.storageService.getSignedDownloadUrl(ev.imageUrl, 3600);
            } catch { /* keep original key if signing fails */ }
          }
        }),
      );
    }

    return evidences;
  }

  async batchApproveEvidence(body: BatchApproveEvidenceDto, userId?: string) {
    const errors: string[] = [];
    let count = 0;

    for (const id of body.ids) {
      try {
        const evidence = await this.prisma.paymentEvidence.findUnique({
          where: { id },
          include: {
            payment: { select: { installmentNo: true } },
            contract: {
              include: {
                customer: true,
                payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
              },
            },
          },
        });

        if (!evidence || evidence.status !== 'PENDING_REVIEW') {
          errors.push(`${id}: ข้ามรายการ (ไม่พบหรือตรวจสอบแล้ว)`);
          continue;
        }

        await this.prisma.paymentEvidence.update({
          where: { id },
          data: {
            status: 'APPROVED',
            amount: evidence.amount,
            reviewedById: userId,
            reviewedAt: new Date(),
          },
        });
        count++;

        // Send LINE notification
        if (evidence.lineUserId) {
          const customer = evidence.contract.customer;
          const contract = evidence.contract;
          const totalInstallments = contract.payments.length;
          const paidCount = contract.payments.filter((p) => p.status === 'PAID').length;
          // Derive the installment this evidence pays — the linked Payment if
          // present, else the next unpaid installment. (Was hardcoded to 1, so a
          // customer paying installment 5/12 was told "1/12" over LINE.)
          const nextUnpaid = contract.payments.find((p) => p.status !== 'PAID');
          const installmentNo =
            evidence.payment?.installmentNo ??
            nextUnpaid?.installmentNo ??
            Math.min(paidCount + 1, totalInstallments);

          try {
            const flex = this.lineOaService.buildPaymentSuccess({
              customerName: customer.name,
              contractNumber: contract.contractNumber,
              installmentNo,
              totalInstallments,
              amountPaid: evidence.amount ? d(evidence.amount) : 0,
              paymentMethod: body.paymentMethod,
              paidDate: formatDateShort(new Date()),
              remainingInstallments: totalInstallments - paidCount - 1,
            });
            await this.lineOaService.sendFlexMessage(evidence.lineUserId, flex, 'line-finance');
          } catch (err) {
            this.logger.error(`Failed to send batch approval notification for ${id}: ${err}`);
          }
        }
      } catch (err) {
        errors.push(`${id}: ${err}`);
      }
    }

    return { success: true, count, errors };
  }

  async batchRejectEvidence(body: BatchRejectEvidenceDto, userId?: string) {
    const errors: string[] = [];
    let count = 0;

    for (const id of body.ids) {
      try {
        const evidence = await this.prisma.paymentEvidence.findUnique({
          where: { id },
          include: { contract: { include: { customer: true } } },
        });

        if (!evidence || evidence.status !== 'PENDING_REVIEW') {
          errors.push(`${id}: ข้ามรายการ (ไม่พบหรือตรวจสอบแล้ว)`);
          continue;
        }

        await this.prisma.paymentEvidence.update({
          where: { id },
          data: {
            status: 'REJECTED',
            reviewedById: userId,
            reviewedAt: new Date(),
            reviewNote: body.reviewNote,
          },
        });
        count++;

        // Send LINE notification
        if (evidence.lineUserId) {
          try {
            await this.lineOaService.pushMessage(
              evidence.lineUserId,
              [
                {
                  type: 'text',
                  text: `ขออภัยค่ะ สลิปที่ส่งมาไม่ผ่านการตรวจสอบ${body.reviewNote ? `\nเหตุผล: ${body.reviewNote}` : ''}\n\nกรุณาส่งสลิปใหม่ หรือติดต่อสาขาค่ะ`,
                },
              ],
              'line-finance',
            );
          } catch (err) {
            this.logger.error(`Failed to send batch rejection notification for ${id}: ${err}`);
          }
        }
      } catch (err) {
        errors.push(`${id}: ${err}`);
      }
    }

    return { success: true, count, errors };
  }

  async approveEvidence(id: string, body: ApproveEvidenceDto, userId?: string) {
    const evidence = await this.prisma.paymentEvidence.findUnique({
      where: { id },
      include: {
        contract: {
          include: {
            customer: true,
            payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
          },
        },
      },
    });

    if (!evidence) {
      return { error: 'ไม่พบหลักฐาน' };
    }
    if (evidence.status !== 'PENDING_REVIEW') {
      return { error: 'หลักฐานนี้ได้รับการตรวจสอบแล้ว' };
    }

    // Validate amount against actual payment due (±100 baht tolerance for rounding).
    // (Audit finding) Previously logged a warning and approved anyway —
    // a fraud vector. Reject unless the reviewer sets `acceptMismatch=true`
    // in the body, which forces the override to be a deliberate, audited
    // decision.
    const targetPayment = evidence.contract.payments.find(
      (p) => p.installmentNo === body.installmentNo,
    );
    if (targetPayment) {
      const expectedAmount = sumOutstanding(targetPayment);
      const diff = Math.abs(body.amount - expectedAmount);
      if (diff > 100 && !body.acceptMismatch) {
        this.logger.warn(
          `[SlipReview] Amount mismatch rejected: approved=${body.amount}, expected=${expectedAmount} for evidence ${id} (diff ${diff.toFixed(2)} > 100)`,
        );
        throw new BadRequestException(
          `จำนวนเงินสลิป (${body.amount.toLocaleString()}) ต่างจากยอดที่ต้องชำระ (${expectedAmount.toLocaleString()}) เกิน 100 บาท — กรุณาตรวจสอบหรือเลือก "ยืนยันแม้ยอดไม่ตรง"`,
        );
      }
      if (diff > 100 && body.acceptMismatch) {
        this.logger.warn(
          `[SlipReview] Amount mismatch APPROVED via override: approved=${body.amount}, expected=${expectedAmount}, evidence=${id}, reviewer=${userId}`,
        );
      }
    }

    // Update evidence status
    await this.prisma.paymentEvidence.update({
      where: { id },
      data: {
        status: 'APPROVED',
        amount: body.amount,
        reviewedById: userId,
        reviewedAt: new Date(),
        reviewNote: body.reviewNote,
      },
    });

    // Send success notification to customer via LINE
    if (evidence.lineUserId) {
      const customer = evidence.contract.customer;
      const contract = evidence.contract;
      const totalInstallments = contract.payments.length;
      const paidCount = contract.payments.filter((p) => p.status === 'PAID').length;

      const flex = this.lineOaService.buildPaymentSuccess({
        customerName: customer.name,
        contractNumber: contract.contractNumber,
        installmentNo: body.installmentNo,
        totalInstallments,
        amountPaid: body.amount,
        paymentMethod: body.paymentMethod,
        paidDate: formatDateShort(new Date()),
        remainingInstallments: totalInstallments - paidCount - 1,
      });

      try {
        await this.lineOaService.sendFlexMessage(evidence.lineUserId, flex, 'line-finance');
      } catch (err) {
        this.logger.error(`Failed to send payment success notification: ${err}`);
      }
    }

    return { success: true, message: 'อนุมัติสลิปเรียบร้อย' };
  }

  async rejectEvidence(id: string, body: { reviewNote?: string }, userId?: string) {
    const evidence = await this.prisma.paymentEvidence.findUnique({
      where: { id },
      include: { contract: { include: { customer: true } } },
    });

    if (!evidence) {
      return { error: 'ไม่พบหลักฐาน' };
    }

    await this.prisma.paymentEvidence.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedById: userId,
        reviewedAt: new Date(),
        reviewNote: body.reviewNote,
      },
    });

    // Notify customer via LINE
    if (evidence.lineUserId) {
      try {
        await this.lineOaService.pushMessage(
          evidence.lineUserId,
          [
            {
              type: 'text',
              text: `ขออภัยค่ะ สลิปที่ส่งมาไม่ผ่านการตรวจสอบ${body.reviewNote ? `\nเหตุผล: ${body.reviewNote}` : ''}\n\nกรุณาส่งสลิปใหม่ หรือติดต่อสาขาค่ะ`,
            },
          ],
          'line-finance',
        );
      } catch (err) {
        this.logger.error(`Failed to send rejection notification: ${err}`);
      }
    }

    return { success: true, message: 'ปฏิเสธสลิปเรียบร้อย' };
  }

  async getSuggestedMatches(id: string) {
    const evidence = await this.prisma.paymentEvidence.findUnique({
      where: { id },
      include: {
        contract: {
          include: {
            payments: {
              where: { status: { not: 'PAID' } },
              orderBy: { installmentNo: 'asc' },
            },
          },
        },
      },
    });

    if (!evidence) {
      throw new NotFoundException('ไม่พบหลักฐานการชำระ');
    }

    const slipAmount = evidence.amount ? d(evidence.amount) : null;
    const today = new Date();

    const suggestions = evidence.contract.payments.map((payment) => {
      const amountDue = sumOutstanding(payment);
      let score = 0;

      if (slipAmount !== null) {
        const diff = Math.abs(slipAmount - amountDue);
        if (diff <= 1) score = 1.0;
        else if (diff <= 100) score = 0.85;
        else if (diff <= 300) score = 0.65;
        else if (diff <= 1000) score = 0.4;
        else score = 0.1;
      } else {
        // No amount from OCR — rank by due date proximity
        score = 0.3;
      }

      // Boost for overdue payments (most likely to need payment)
      const daysOverdue = Math.floor((today.getTime() - payment.dueDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysOverdue > 0 && daysOverdue <= 30) score = Math.min(score + 0.1, 1.0);

      return {
        paymentId: payment.id,
        installmentNo: payment.installmentNo,
        dueDate: payment.dueDate,
        amountDue: amountDue,
        status: payment.status,
        score: Math.round(score * 100) / 100,
        isOverdue: daysOverdue > 0,
        daysOverdue: Math.max(0, daysOverdue),
      };
    });

    // Sort by score desc, then by installmentNo asc
    suggestions.sort((a, b) => b.score - a.score || a.installmentNo - b.installmentNo);

    return {
      evidenceId: id,
      slipAmount,
      suggestions: suggestions.slice(0, 5),
    };
  }

  async uploadSlipFromLiff(file: Express.Multer.File, body: SlipUploadBodyDto) {

    // Use transaction to prevent race condition (double slip upload)
    const link = await this.paymentLinkService.getPaymentLink(body.token);
    if (!link || link.status !== 'ACTIVE') {
      throw new BadRequestException('ลิงก์ชำระเงินไม่ถูกต้องหรือหมดอายุ');
    }
    // Slip upload is only supported for contract-based payment links.
    if (!link.contract) {
      throw new BadRequestException('ลิงก์ชำระเงินไม่ถูกต้อง');
    }
    const linkContract = link.contract;

    // Determine safe file extension from MIME type
    const extMap: Record<string, string> = {
      'image/jpeg': '.jpg', 'image/png': '.png',
      'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif',
    };
    const ext = extMap[file.mimetype] || '.jpg';

    // Upload to S3/GCS storage (ephemeral filesystem on Cloud Run)
    const filename = `slips/slip-liff-${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`;
    await this.storageService.upload(filename, file.buffer, file.mimetype);
    const imageUrl = filename;

    // Atomic: create evidence + notification + mark link used in single transaction
    await this.prisma.$transaction(async (tx) => {
      // Re-check link status inside transaction to prevent TOCTOU race
      const freshLink = await tx.paymentLink.findUnique({
        where: { id: link.id },
        select: { status: true },
      });
      if (!freshLink || freshLink.status !== 'ACTIVE') {
        throw new BadRequestException('ลิงก์ชำระเงินถูกใช้แล้ว');
      }

      // Create PaymentEvidence
      const ev = await tx.paymentEvidence.create({
        data: {
          contractId: linkContract.id,
          paymentId: link.payment!.id,
          lineUserId: linkContract.customer.lineIdFinance || null,
          imageUrl,
          amount: body.amount ? new Prisma.Decimal(body.amount) : null,
          status: 'PENDING_REVIEW',
        },
      });

      // Notify staff
      await tx.notificationLog.create({
        data: {
          channel: 'IN_APP',
          recipient: 'STAFF',
          subject: `สลิปใหม่จาก ${linkContract.customer.name} (LIFF)`,
          message: `ลูกค้า ${linkContract.customer.name} ส่งสลิปผ่านลิงก์ชำระเงิน สัญญา ${linkContract.contractNumber}`,
          status: 'SENT',
          relatedId: ev.id,
          sentAt: new Date(),
        },
      });

      // Mark payment link as used atomically
      await tx.paymentLink.update({
        where: { id: link.id },
        data: { status: 'USED', usedAt: new Date() },
      });

      return ev;
    });

    // Send LINE confirmation message to customer
    const customerLineId = linkContract.customer.lineIdFinance;
    if (customerLineId) {
      try {
        const payment = link.payment!;
        const paidCount = await this.prisma.payment.count({
          where: { contractId: linkContract.id, status: 'PAID' },
        });
        const totalInstallments = linkContract.totalMonths;
        // Prefer body.amount from the LIFF form → fall back to link.amount
        // (authoritative; honors early-payoff override). Avoid sumOutstanding
        // on the linked installment because that returns the per-installment
        // total for early-payoff links.
        const amount = body.amount ? d(body.amount) : d(link.amount);

        const flex = this.lineOaService.buildPaymentSuccess({
          customerName: linkContract.customer.name,
          contractNumber: linkContract.contractNumber,
          installmentNo: payment.installmentNo,
          totalInstallments,
          amountPaid: amount,
          paymentMethod: 'BANK_TRANSFER',
          paidDate: formatDateShort(new Date()),
          remainingInstallments: totalInstallments - paidCount,
        });
        await this.lineOaService.sendFlexMessage(customerLineId, flex, 'line-finance');
      } catch (err) {
        this.logger.warn(`Failed to send slip confirmation: ${err}`);
      }
    }

    this.logger.log(`[LIFF] Slip uploaded for contract ${linkContract.contractNumber}`);

    return { success: true, message: 'อัพโหลดสลิปเรียบร้อย กำลังตรวจสอบ' };
  }
}
