import {
  formatDateShort,
} from '../../utils/thai-date.util';
import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
  Logger,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { ParseFilePipe, MaxFileSizeValidator, FileTypeValidator } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { LineOaService } from './line-oa.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toNum as d, calcOutstanding as sumOutstanding } from '../../utils/decimal.util';
import { maskThaiName } from '../../utils/mask-name.util';
import { PromptPayQrService } from './promptpay/promptpay-qr.service';
import { PaymentLinkService } from './payment-links/payment-link.service';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { StorageService } from '../storage/storage.service';
import {
  SlipUploadBodyDto,
  ApproveEvidenceDto,
  BatchApproveEvidenceDto,
  BatchRejectEvidenceDto,
} from './dto/evidence.dto';

@ApiTags('LINE OA - Payments')
@ApiBearerAuth('JWT')
@Controller('line-oa')
export class LineOaPaymentController {
  private readonly logger = new Logger(LineOaPaymentController.name);

  constructor(
    private lineOaService: LineOaService,
    private prisma: PrismaService,
    private promptPayQrService: PromptPayQrService,
    private paymentLinkService: PaymentLinkService,
    private storageService: StorageService,
  ) {}

  // ─── Slip Review API (Staff) ──────────────────────────

  @Get('evidence/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
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

  @Get('evidence')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async getEvidenceList(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('amountMin') amountMin?: string,
    @Query('amountMax') amountMax?: string,
    @Query('limit') limit?: string,
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

  @Post('evidence/batch-approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async batchApproveEvidence(
    @Body() body: BatchApproveEvidenceDto,
    @Req() req: Request,
  ) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    const errors: string[] = [];
    let count = 0;

    for (const id of body.ids) {
      try {
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

          try {
            const flex = this.lineOaService.buildPaymentSuccess({
              customerName: customer.name,
              contractNumber: contract.contractNumber,
              installmentNo: 1,
              totalInstallments,
              amountPaid: evidence.amount ? d(evidence.amount) : 0,
              paymentMethod: body.paymentMethod,
              paidDate: formatDateShort(new Date()),
              remainingInstallments: totalInstallments - paidCount - 1,
            });
            await this.lineOaService.sendFlexMessage(evidence.lineUserId, flex);
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

  @Post('evidence/batch-reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async batchRejectEvidence(
    @Body() body: BatchRejectEvidenceDto,
    @Req() req: Request,
  ) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
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
            await this.lineOaService.pushMessage(evidence.lineUserId, [
              {
                type: 'text',
                text: `ขออภัยค่ะ สลิปที่ส่งมาไม่ผ่านการตรวจสอบ${body.reviewNote ? `\nเหตุผล: ${body.reviewNote}` : ''}\n\nกรุณาส่งสลิปใหม่ หรือติดต่อสาขาค่ะ`,
              },
            ]);
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

  @Post('evidence/:id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async approveEvidence(
    @Param('id') id: string,
    @Body() body: ApproveEvidenceDto,
    @Req() req: Request,
  ) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
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

    // Validate amount against actual payment due (±100 baht tolerance for rounding)
    const targetPayment = evidence.contract.payments.find(
      (p) => p.installmentNo === body.installmentNo,
    );
    if (targetPayment) {
      const expectedAmount = sumOutstanding(targetPayment);
      if (Math.abs(body.amount - expectedAmount) > 100) {
        this.logger.warn(
          `[SlipReview] Amount mismatch: approved=${body.amount}, expected=${expectedAmount} for evidence ${id}`,
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
        await this.lineOaService.sendFlexMessage(evidence.lineUserId, flex);
      } catch (err) {
        this.logger.error(`Failed to send payment success notification: ${err}`);
      }
    }

    return { success: true, message: 'อนุมัติสลิปเรียบร้อย' };
  }

  @Post('evidence/:id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async rejectEvidence(
    @Param('id') id: string,
    @Body() body: { reviewNote?: string },
    @Req() req: Request,
  ) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
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
        await this.lineOaService.pushMessage(evidence.lineUserId, [
          {
            type: 'text',
            text: `ขออภัยค่ะ สลิปที่ส่งมาไม่ผ่านการตรวจสอบ${body.reviewNote ? `\nเหตุผล: ${body.reviewNote}` : ''}\n\nกรุณาส่งสลิปใหม่ หรือติดต่อสาขาค่ะ`,
          },
        ]);
      } catch (err) {
        this.logger.error(`Failed to send rejection notification: ${err}`);
      }
    }

    return { success: true, message: 'ปฏิเสธสลิปเรียบร้อย' };
  }

  @Get('evidence/:id/suggested-matches')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async getSuggestedMatches(@Param('id') id: string) {
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

  // ─── PromptPay QR Code ──────────────────────────────

  @Get('payment/:paymentId/qr')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async generateQrCode(
    @Param('paymentId') paymentId: string,
    @Query('amount') amountStr: string,
    @Res() res: Response,
  ) {
    const amount = amountStr ? Number(amountStr) : undefined;

    try {
      const buffer = await this.promptPayQrService.generateQrBuffer(amount);
      res.set({
        'Content-Type': 'image/png',
        'Content-Disposition': `inline; filename="promptpay-qr-${paymentId}.png"`,
        'Cache-Control': 'no-cache',
      });
      res.send(buffer);
    } catch (err) {
      this.logger.error(`QR generation failed: ${err}`);
      res.status(500).json({ error: 'ไม่สามารถสร้าง QR Code ได้' });
    }
  }

  // ─── Payment Link (LIFF) ────────────────────────────

  @Get('pay/:token')
  async resolvePaymentLink(@Param('token') token: string) {
    const link = await this.paymentLinkService.getPaymentLink(token);

    if (!link) {
      return { error: 'ลิงก์ชำระเงินไม่ถูกต้อง', valid: false };
    }

    if (link.status !== 'ACTIVE') {
      return { error: 'ลิงก์ชำระเงินหมดอายุหรือถูกใช้แล้ว', valid: false, status: link.status };
    }

    // This LIFF endpoint only handles contract-based payment links.
    // Online-order PaymentLinks (contract === null) are paid via PaySolutions hosted page.
    if (!link.contract) {
      return { error: 'ลิงก์ชำระเงินไม่ถูกต้อง', valid: false };
    }

    const payment = link.payment!;
    const contract = link.contract;
    // Use link.amount (authoritative) — createPaymentLink honors the
    // overrideAmount for early-payoff links. Recomputing from the linked
    // installment would return the single-installment total, not the full
    // payoff amount.
    const amount = d(link.amount);

    // Generate PromptPay QR as data URL for the LIFF page
    let qrDataUrl: string | null = null;
    try {
      qrDataUrl = await this.promptPayQrService.generateQrDataUrl(amount);
    } catch (err) {
      this.logger.warn(`QR generation failed for payment link: ${err}`);
    }

    return {
      valid: true,
      token,
      amount,
      status: link.status,
      expiresAt: link.expiresAt,
      contract: {
        id: contract.id,
        contractNumber: contract.contractNumber,
        customer: { name: maskThaiName(contract.customer.name) },
      },
      payment: {
        installmentNo: payment.installmentNo,
        amountDue: d(payment.amountDue),
        lateFee: d(payment.lateFee),
        dueDate: payment.dueDate,
      },
      promptPay: {
        qrDataUrl,
        accountName: this.promptPayQrService.getAccountName(),
        maskedId: this.promptPayQrService.getMaskedPromptPayId(),
      },
    };
  }

  // ─── LIFF Slip Upload ───────────────────────────────

  // Rate limit: 5 slip uploads per minute per IP.
  // Defense in depth — serves two purposes:
  //   1. Operational: prevents slip queue flooding if a buggy client or
  //      retry storm fires multiple uploads. Real customers upload 1 slip
  //      per payment — 5/min is generous for legitimate retries.
  //   2. Security belt: @nestjs/platform-express@11 still transitively
  //      pulls multer@1.4.5-lts.1 (GHSA incomplete-cleanup DoS). We pin
  //      multer=2.1.1 via root package.json `overrides`, but this throttle
  //      is a second layer in case the override is ever removed.
  @Post('slip-upload')
  @SkipCsrf()
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @UseInterceptors(FileInterceptor('slip'))
  async uploadSlipFromLiff(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024, message: 'ไฟล์มีขนาดเกิน 5MB' }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp|heic|heif)$/ }),
        ],
        fileIsRequired: true,
        errorHttpStatusCode: 400,
      }),
    )
    file: Express.Multer.File,
    @Body() body: SlipUploadBodyDto,
  ) {

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
          lineUserId: linkContract.customer.lineId || null,
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
    const customerLineId = linkContract.customer.lineId;
    if (customerLineId) {
      try {
        const payment = link.payment!;
        const paidCount = await this.prisma.payment.count({
          where: { contractId: linkContract.id, status: 'PAID' },
        });
        const totalInstallments = linkContract.totalMonths;
        const amount = body.amount ? d(body.amount) : sumOutstanding(payment);

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
        await this.lineOaService.sendFlexMessage(customerLineId, flex);
      } catch (err) {
        this.logger.warn(`Failed to send slip confirmation: ${err}`);
      }
    }

    this.logger.log(`[LIFF] Slip uploaded for contract ${linkContract.contractNumber}`);

    return { success: true, message: 'อัพโหลดสลิปเรียบร้อย กำลังตรวจสอบ' };
  }

  // ─── Create Payment Link (Staff) ────────────────────

  @Post('payment-link')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async createPaymentLink(
    @Body() body: { contractId: string; installmentNo?: number },
  ) {
    const result = await this.paymentLinkService.createPaymentLink(
      body.contractId,
      body.installmentNo,
    );

    return {
      success: true,
      ...result,
    };
  }

}
