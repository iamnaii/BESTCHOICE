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
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { ParseFilePipe, MaxFileSizeValidator, FileTypeValidator } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PromptPayQrService } from './promptpay/promptpay-qr.service';
import { PaymentLinkService } from './payment-links/payment-link.service';
import { PaymentEvidenceService } from './services/payment-evidence.service';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
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
    private promptPayQrService: PromptPayQrService,
    private paymentLinkService: PaymentLinkService,
    private paymentEvidenceService: PaymentEvidenceService,
  ) {}

  // ─── Slip Review API (Staff) ──────────────────────────

  @Get('evidence/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async getEvidenceStats() {
    return this.paymentEvidenceService.getEvidenceStats();
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
    return this.paymentEvidenceService.getEvidenceList(
      status,
      search,
      dateFrom,
      dateTo,
      amountMin,
      amountMax,
      limit,
    );
  }

  @Post('evidence/batch-approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async batchApproveEvidence(
    @Body() body: BatchApproveEvidenceDto,
    @Req() req: Request,
  ) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    return this.paymentEvidenceService.batchApproveEvidence(body, userId);
  }

  @Post('evidence/batch-reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async batchRejectEvidence(
    @Body() body: BatchRejectEvidenceDto,
    @Req() req: Request,
  ) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    return this.paymentEvidenceService.batchRejectEvidence(body, userId);
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
    return this.paymentEvidenceService.approveEvidence(id, body, userId);
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
    return this.paymentEvidenceService.rejectEvidence(id, body, userId);
  }

  @Get('evidence/:id/suggested-matches')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async getSuggestedMatches(@Param('id') id: string) {
    return this.paymentEvidenceService.getSuggestedMatches(id);
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
    return this.paymentLinkService.resolvePaymentLink(token);
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
    return this.paymentEvidenceService.uploadSlipFromLiff(file, body);
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

  /**
   * Send payment link as Flex Card via LINE Finance — picks
   * `paymentReminder` (orange) or `overdueNotice` (red) based on whether
   * the contract has past-due unpaid installments.
   */
  @Post('payment-flex')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async sendPaymentFlex(
    @Body() body: { contractId: string },
    @Req() req: { user: { id: string } },
  ) {
    return this.paymentLinkService.sendPaymentFlex(body, req);
  }

}
