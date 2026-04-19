import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { VisionService, SlipExtraction } from './vision.service';
import { StaffNotificationService } from './staff-notification.service';
import { FinanceConfigService } from './finance-config.service';

const AMOUNT_TOLERANCE = 0.5; // ±0.50 บาท

/**
 * OCR confidence threshold for auto-approving a slip.
 * Below this, evidence stays PENDING_REVIEW for human verification.
 * 0.90 is the team's calibrated minimum — Claude Haiku self-reports >= 0.90
 * almost always when bank name + amount + ref are all legible.
 */
const AUTO_APPROVE_CONFIDENCE = 0.9;

export interface SlipProcessResult {
  ok: boolean;
  reply: string;
  evidenceId?: string;
  matched?: boolean;
}

/**
 * Slip Processing — รับรูปจากลูกค้า, extract, match, save PaymentEvidence
 *
 * Flow:
 *   1. Upload image → S3
 *   2. Vision extract
 *   3. Match: บัญชีถูกไหม + ยอดตรงไหม
 *   4. สร้าง PaymentEvidence (status: PENDING_REVIEW หรือ APPROVED ถ้า auto-match)
 *   5. Return ข้อความตอบกลับลูกค้า
 */
@Injectable()
export class SlipProcessingService {
  private readonly logger = new Logger(SlipProcessingService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private vision: VisionService,
    private staffNotify: StaffNotificationService,
    private financeConfig: FinanceConfigService,
  ) {}

  async processSlip(params: {
    imageBuffer: Buffer;
    mediaType: string;
    customerId: string;
    lineUserId: string;
  }): Promise<SlipProcessResult> {
    // 1. Upload to S3
    let imageUrl: string;
    try {
      const key = `chatbot-finance/slips/${Date.now()}-${params.lineUserId.slice(0, 8)}.jpg`;
      imageUrl = await this.storage.upload(key, params.imageBuffer, params.mediaType);
    } catch (err) {
      this.logger.error(
        `[Slip] Upload failed: ${err instanceof Error ? err.message : err}`,
      );
      return {
        ok: false,
        reply: 'อัปโหลดสลิปไม่สำเร็จค่ะ 🙏 รบกวนลองใหม่อีกครั้งนะคะ',
      };
    }

    // 2. Vision extract
    const extracted = await this.vision.extractSlip(params.imageBuffer, params.mediaType);

    if (!extracted || !extracted.isSlip) {
      return {
        ok: false,
        reply:
          'รูปนี้ไม่ใช่สลิปการโอนเงินค่ะ 🙏\nรบกวนถ่ายสลิปใหม่ให้ชัดกว่านี้นะคะ',
      };
    }

    // 3. หา active contract + customer
    const contract = await this.prisma.contract.findFirst({
      where: {
        customerId: params.customerId,
        deletedAt: null,
        status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { name: true, phone: true } },
      },
    });

    if (!contract) {
      return {
        ok: false,
        reply: 'ไม่พบสัญญาที่ active ค่ะ 🙏\nรบกวนติดต่อเจ้าหน้าที่ 063-134-6356 นะคะ',
      };
    }

    // 4. Match บัญชี (exact digits-only match against current SystemConfig)
    const wrongAccount =
      extracted.toAccount && !this.financeConfig.isCompanyBankAccount(extracted.toAccount);
    if (wrongAccount) {
      const evidence = await this.createEvidence({
        contractId: contract.id,
        lineUserId: params.lineUserId,
        imageUrl,
        amount: extracted.amount,
        note: `โอนผิดบัญชี: ${extracted.toAccount}`,
      });
      // Notify staff (fire-and-forget with error capture)
      this.staffNotify.notifySlipReview({
        customerName: contract.customer.name,
        customerPhone: contract.customer.phone,
        contractNumber: contract.contractNumber,
        slipAmount: extracted.amount ?? 0,
        reason: 'wrong_account',
        evidenceId: evidence.id,
      }).catch((err) => {
        this.logger.error(`[Slip] Staff notify failed: ${err instanceof Error ? err.message : err}`);
        Sentry.captureException(err, { tags: { module: 'chatbot-finance', action: 'slip_notify' } });
      });
      return {
        ok: false,
        reply:
          '⚠️ สลิปนี้โอนเข้าบัญชีอื่นนะคะ\n\n' +
          `🏦 บัญชีที่ถูกต้อง: ${this.financeConfig.bankName}\n` +
          `🔢 ${this.financeConfig.accountNumber}\n` +
          `👤 ${this.financeConfig.accountName}\n\n` +
          'แอดมินจะตรวจสอบให้นะคะ',
        evidenceId: evidence.id,
        matched: false,
      };
    }

    // 5. หางวดที่กำลังจะจ่าย
    const nextPayment = await this.prisma.payment.findFirst({
      where: {
        contractId: contract.id,
        status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
      },
      orderBy: { installmentNo: 'asc' },
    });

    const expectedAmount = nextPayment ? Number(nextPayment.amountDue) : null;
    const slipAmount = extracted.amount ?? 0;

    // Compare using Decimal to avoid floating-point precision errors on money
    const matched =
      expectedAmount !== null &&
      new Prisma.Decimal(slipAmount)
        .sub(new Prisma.Decimal(expectedAmount))
        .abs()
        .lte(new Prisma.Decimal(AMOUNT_TOLERANCE));

    // 6. สร้าง PaymentEvidence
    // Auto-approve เฉพาะกรณีที่ทุก guard ผ่าน: amount ตรง + บัญชีถูก + paymentId เจอ +
    // OCR confidence >= 0.9 ถ้าเงื่อนไขใดขาดหาย → PENDING_REVIEW ให้ staff ตรวจ
    const canAutoApprove =
      matched &&
      !!nextPayment &&
      extracted.confidence !== undefined &&
      extracted.confidence >= AUTO_APPROVE_CONFIDENCE;

    const evidence = await this.createEvidence({
      contractId: contract.id,
      paymentId: nextPayment?.id,
      lineUserId: params.lineUserId,
      imageUrl,
      amount: slipAmount,
      note: this.buildExtractedNote(extracted, canAutoApprove),
      autoApprove: canAutoApprove,
    });

    // 7. Reply
    if (matched) {
      return {
        ok: true,
        evidenceId: evidence.id,
        matched: true,
        reply:
          `รับสลิปแล้วค่ะ ขอบคุณค่ะ 😊\n` +
          `💰 ยอด ${slipAmount.toLocaleString()} บาท\n` +
          `แอดมินจะตรวจสอบและออกใบเสร็จให้ในไม่ช้าค่ะ`,
      };
    }

    if (expectedAmount === null) {
      this.staffNotify.notifySlipReview({
        customerName: contract.customer.name,
        customerPhone: contract.customer.phone,
        contractNumber: contract.contractNumber,
        slipAmount,
        reason: 'unmatched',
        evidenceId: evidence.id,
      }).catch((err) => {
        this.logger.error(`[Slip] Staff notify failed: ${err instanceof Error ? err.message : err}`);
        Sentry.captureException(err, { tags: { module: 'chatbot-finance', action: 'slip_notify' } });
      });
      return {
        ok: true,
        evidenceId: evidence.id,
        matched: false,
        reply: `รับสลิปแล้วค่ะ 🙏\n💰 ยอด ${slipAmount.toLocaleString()} บาท\nแอดมินจะตรวจสอบให้นะคะ`,
      };
    }

    // ยอดไม่ตรง — notify staff
    this.staffNotify.notifySlipReview({
      customerName: contract.customer.name,
      customerPhone: contract.customer.phone,
      contractNumber: contract.contractNumber,
      slipAmount,
      expectedAmount,
      reason: 'amount_mismatch',
      evidenceId: evidence.id,
    }).catch((err) => {
      this.logger.error(`[Slip] Staff notify failed: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { module: 'chatbot-finance', action: 'slip_notify' } });
    });

    return {
      ok: true,
      evidenceId: evidence.id,
      matched: false,
      reply:
        `รับสลิปแล้วค่ะ 🙏\n` +
        `💰 ยอดในสลิป: ${slipAmount.toLocaleString()} บาท\n` +
        `💰 ยอดงวดนี้: ${expectedAmount.toLocaleString()} บาท\n` +
        `ยอดไม่ตรง แอดมินจะตรวจสอบและติดต่อกลับนะคะ`,
    };
  }

  // ─── helpers ─────────────────────────────────────────────

  private buildExtractedNote(s: SlipExtraction, autoApproved = false): string {
    const parts: string[] = ['[chatbot-finance]'];
    if (autoApproved) parts.push('auto-approved');
    if (s.bankName) parts.push(`bank=${s.bankName}`);
    if (s.date) parts.push(`date=${s.date}`);
    if (s.time) parts.push(`time=${s.time}`);
    if (s.refNo) parts.push(`ref=${s.refNo}`);
    if (s.confidence) parts.push(`confidence=${s.confidence}`);
    return parts.join(' | ');
  }

  private async createEvidence(params: {
    contractId: string;
    paymentId?: string;
    lineUserId: string;
    imageUrl: string;
    amount?: number;
    note: string;
    autoApprove?: boolean;
  }) {
    return this.prisma.paymentEvidence.create({
      data: {
        contractId: params.contractId,
        paymentId: params.paymentId,
        lineUserId: params.lineUserId,
        imageUrl: params.imageUrl,
        amount: params.amount,
        status: params.autoApprove ? 'APPROVED' : 'PENDING_REVIEW',
        reviewedById: params.autoApprove ? null : undefined,
        reviewedAt: params.autoApprove ? new Date() : undefined,
        reviewNote: params.note,
      },
    });
  }
}
