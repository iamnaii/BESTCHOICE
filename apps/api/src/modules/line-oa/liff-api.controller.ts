import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { LiffApiService } from './liff-api.service';
import { RichMenuService } from './rich-menu/rich-menu.service';
import { PaymentLinkService } from './payment-links/payment-link.service';
import { ContractPaymentService } from '../contracts/contract-payment.service';
import { toNum } from '../../utils/decimal.util';
import { DocumentsService } from '../contracts/documents.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { LiffTokenGuard, LiffRequest } from './guards/liff-token.guard';
import { LiffChannel } from './guards/liff-channel.decorator';
import { LineChannelType } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import {
  LiffRegisterLookupDto,
  LiffRegisterConfirmDto,
  LiffCreatePaymentLinkDto,
  LiffEarlyPayoffDto,
  LiffConsentDto,
  LiffNotificationPreferencesDto,
} from './dto/liff.dto';
// Return types (mirrors packages/shared/src/liff-types.ts)
interface LiffContractResponse { customer: { name: string }; contracts: unknown[]; }
interface LiffHistoryResponse { customer: { name: string }; payments: unknown[]; }
interface LiffProfileResponse { name: string; phone: string; lineDisplayName: string; contractCount: number; totalPoints: number; }
interface LiffPaymentLinkResult { url: string; token: string; totalPayoff?: number; }

@ApiTags('LIFF API')
@Controller('line-oa')
@SkipCsrf()
@UseGuards(LiffTokenGuard)
@LiffChannel(LineChannelType.SHOP)
export class LiffApiController {
  private readonly logger = new Logger(LiffApiController.name);

  constructor(
    private liffApiService: LiffApiService,
    private richMenuService: RichMenuService,
    private paymentLinkService: PaymentLinkService,
    private contractPaymentService: ContractPaymentService,
    private documentsService: DocumentsService,
    private prisma: PrismaService,
  ) {}

  // ─── LIFF Contracts ─────────────────────────────────

  @Get('liff/contracts')
  async getLiffContracts(@Req() req: Request): Promise<LiffContractResponse> {
    const lineId = (req as unknown as LiffRequest).liffUserId;

    const result = await this.liffApiService.findCustomerContractsFull(lineId);
    if (!result) {
      throw new NotFoundException('ไม่พบข้อมูลลูกค้า กรุณาลงทะเบียนก่อน');
    }

    return result;
  }

  // ─── LIFF Registration ──────────────────────────────

  @Post('liff/register/lookup')
  @SkipCsrf()
  @UseGuards(LiffTokenGuard)
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  async liffRegisterLookup(@Req() req: Request, @Body() dto: LiffRegisterLookupDto): Promise<{ customerId: string; maskedName: string }> {
    const lineId = (req as unknown as LiffRequest).liffUserId;

    const isLinked = await this.liffApiService.isLineIdLinked(lineId);
    if (isLinked) {
      throw new BadRequestException('บัญชี LINE นี้เชื่อมต่อกับลูกค้าแล้ว');
    }

    const result = await this.liffApiService.lookupCustomerByPhone(dto.phone, lineId);
    if (!result) {
      throw new NotFoundException(
        'ไม่พบเบอร์โทรนี้ในระบบ กรุณาตรวจสอบเบอร์โทร หรือติดต่อสาขา',
      );
    }

    return result;
  }

  @Post('liff/register/confirm')
  @SkipCsrf()
  @UseGuards(LiffTokenGuard)
  @Throttle({ short: { ttl: 60000, limit: 3 } })
  async liffRegisterConfirm(@Req() req: Request, @Body() dto: LiffRegisterConfirmDto) {
    const lineId = (req as unknown as LiffRequest).liffUserId;

    const result = await this.liffApiService.confirmLinkLine(dto.customerId, lineId);
    if (!result.success) {
      throw new BadRequestException(result.error || 'ลงทะเบียนไม่สำเร็จ');
    }

    // Switch Rich Menu to verified after successful registration (non-blocking)
    if (lineId) {
      try {
        await this.richMenuService.switchRichMenu(lineId, true, 'finance');
      } catch (err) {
        this.logger.error('Failed to switch Rich Menu after verify', err);
      }
    }

    return { success: true, message: 'ลงทะเบียนสำเร็จ' };
  }

  // ─── LIFF History & Profile ─────────────────────────

  @Get('liff/history')
  async getLiffPaymentHistory(@Req() req: Request): Promise<LiffHistoryResponse> {
    const lineId = (req as unknown as LiffRequest).liffUserId;

    const result = await this.liffApiService.findCustomerPaymentHistory(lineId);
    if (!result) {
      throw new NotFoundException('ไม่พบข้อมูลลูกค้า กรุณาลงทะเบียนก่อน');
    }

    return result;
  }

  @Get('liff/profile')
  async getLiffProfile(@Req() req: Request): Promise<LiffProfileResponse> {
    const lineId = (req as unknown as LiffRequest).liffUserId;

    const result = await this.liffApiService.findCustomerProfile(lineId);
    if (!result) {
      throw new NotFoundException('ไม่พบข้อมูลลูกค้า กรุณาลงทะเบียนก่อน');
    }

    return result;
  }

  @Post('liff/unlink')
  @SkipCsrf()
  @UseGuards(LiffTokenGuard)
  @Throttle({ short: { ttl: 60000, limit: 3 } })
  async unlinkLine(@Req() req: Request) {
    const lineId = (req as unknown as LiffRequest).liffUserId;

    const result = await this.liffApiService.unlinkLineAccount(lineId);
    if (!result.success) {
      throw new BadRequestException(result.error || 'ยกเลิกไม่สำเร็จ');
    }

    return { success: true, message: 'ยกเลิกผูก LINE เรียบร้อย' };
  }

  // ─── LIFF Payment Link ──────────────────────────────

  @Post('liff/create-payment-link')
  @SkipCsrf()
  @UseGuards(LiffTokenGuard)
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  async liffCreatePaymentLink(
    @Req() req: Request,
    @Body() dto: LiffCreatePaymentLinkDto,
  ): Promise<LiffPaymentLinkResult> {
    const lineId = (req as unknown as LiffRequest).liffUserId;

    const customer = await this.liffApiService.findCustomerByLineId(lineId);
    if (!customer) {
      throw new NotFoundException('ไม่พบข้อมูลลูกค้า');
    }

    const contract = await this.liffApiService.findContractForCustomer(
      dto.contractId,
      customer.id,
    );
    if (!contract) {
      throw new NotFoundException('ไม่พบสัญญา');
    }

    // Rate limit: max 5 active payment links per contract in 24 hours
    const recentLinks = await this.liffApiService.countRecentPaymentLinks(dto.contractId);
    if (recentLinks >= 5) {
      throw new BadRequestException('สร้างลิงก์ชำระเงินได้สูงสุด 5 ครั้งต่อ 24 ชั่วโมง');
    }

    const result = await this.paymentLinkService.createPaymentLink(dto.contractId);
    return { url: result.url, token: result.token };
  }

  // ─── LIFF Early Payoff ──────────────────────────────

  @Get('liff/early-payoff-quote')
  async getLiffEarlyPayoffQuote(@Req() req: Request, @Query('contractId') contractId: string) {
    const lineId = (req as unknown as LiffRequest).liffUserId;

    if (!contractId) {
      throw new BadRequestException('กรุณาระบุ contractId');
    }

    const customer = await this.liffApiService.findCustomerByLineId(lineId);
    if (!customer) {
      throw new NotFoundException('ไม่พบข้อมูลลูกค้า');
    }

    const contract = await this.liffApiService.findContractForCustomer(contractId, customer.id);
    if (!contract) {
      throw new NotFoundException('ไม่พบสัญญา');
    }

    if (!['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status)) {
      throw new BadRequestException('สัญญานี้ไม่สามารถปิดยอดก่อนกำหนดได้');
    }

    const quote = await this.contractPaymentService.getEarlyPayoffQuote(contractId);
    return {
      ...quote,
      contractNumber: contract.contractNumber,
      customerName: customer.name,
    };
  }

  @Post('liff/early-payoff')
  async liffEarlyPayoff(
    @Req() req: Request,
    @Body() dto: LiffEarlyPayoffDto,
  ): Promise<LiffPaymentLinkResult> {
    const lineId = (req as unknown as LiffRequest).liffUserId;

    const customer = await this.liffApiService.findCustomerByLineId(lineId);
    if (!customer) {
      throw new NotFoundException('ไม่พบข้อมูลลูกค้า');
    }

    const contract = await this.liffApiService.findContractForCustomer(
      dto.contractId,
      customer.id,
    );
    if (!contract) {
      throw new NotFoundException('ไม่พบสัญญา');
    }

    if (!['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status)) {
      throw new BadRequestException('สัญญานี้ไม่สามารถปิดยอดก่อนกำหนดได้');
    }

    const quote = await this.contractPaymentService.getEarlyPayoffQuote(dto.contractId);
    const result = await this.paymentLinkService.createPaymentLink(
      dto.contractId,
      undefined,
      quote.totalPayoff,
    );
    return { url: result.url, token: result.token, totalPayoff: quote.totalPayoff };
  }

  // ─── LIFF PDPA Consent ──────────────────────────────

  @Get('liff/consent')
  async getConsentStatus(@Req() req: Request) {
    const lineId = (req as unknown as LiffRequest).liffUserId;

    const result = await this.liffApiService.getConsentStatus(lineId);
    if (!result) {
      throw new NotFoundException('ไม่พบข้อมูลลูกค้า กรุณาลงทะเบียนก่อน');
    }

    return result;
  }

  @Post('liff/consent')
  async updateConsent(@Req() req: Request, @Body() dto: LiffConsentDto) {
    const lineId = (req as unknown as LiffRequest).liffUserId;

    const result = await this.liffApiService.updateConsent(lineId, dto.consent);
    if (!result.success) {
      throw new BadRequestException(result.error || 'ไม่สามารถอัปเดตการยินยอมได้');
    }

    return { success: true, consent: dto.consent };
  }

  // ─── LIFF Contract Document Download ────────────────

  @Get('liff/contracts/:contractId/document')
  async getLiffContractDocument(
    @Req() req: Request,
    @Res() res: Response,
    @Param('contractId') contractId: string,
  ) {
    const lineId = (req as unknown as LiffRequest).liffUserId;

    const customer = await this.liffApiService.findCustomerByLineId(lineId);
    if (!customer) throw new NotFoundException('ไม่พบข้อมูลลูกค้า');

    const contract = await this.liffApiService.findContractForCustomer(contractId, customer.id);
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    // Find the CONTRACT type document
    const doc = await this.prisma.eDocument.findFirst({
      where: { contractId, documentType: 'CONTRACT' },
      orderBy: { createdAt: 'desc' },
    });
    if (!doc) throw new NotFoundException('ยังไม่มีเอกสารสัญญา กรุณาติดต่อพนักงาน');

    const { stream, filename, contentType } = await this.documentsService.getDocumentStream(doc.id);
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
    });
    stream.pipe(res);
  }

  // ─── LIFF Receipts ──────────────────────────────────

  @Get('liff/receipts')
  async getLiffReceipts(@Req() req: Request) {
    const lineId = (req as unknown as LiffRequest).liffUserId;

    const customer = await this.liffApiService.findCustomerByLineId(lineId);
    if (!customer) throw new NotFoundException('ไม่พบข้อมูลลูกค้า');

    const receipts = await this.prisma.receipt.findMany({
      where: {
        contract: { customerId: customer.id, deletedAt: null },
        isVoided: false,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        receiptNumber: true,
        receiptType: true,
        amount: true,
        paidDate: true,
        paymentMethod: true,
        installmentNo: true,
        fileUrl: true,
        contractId: true,
      },
    });

    // Resolve contract numbers
    const contractIds = [...new Set(receipts.map((r) => r.contractId))];
    const contracts = await this.prisma.contract.findMany({
      where: { id: { in: contractIds } },
      select: { id: true, contractNumber: true },
    });
    const contractMap = new Map(contracts.map((c) => [c.id, c.contractNumber]));

    return receipts.map((r) => ({
      id: r.id,
      receiptNumber: r.receiptNumber,
      receiptType: r.receiptType,
      amount: toNum(r.amount),
      paidDate: r.paidDate.toISOString(),
      paymentMethod: r.paymentMethod,
      installmentNo: r.installmentNo,
      contractNumber: contractMap.get(r.contractId) || '-',
      hasFile: !!r.fileUrl,
    }));
  }

  @Get('liff/receipts/:receiptId/download')
  async downloadLiffReceipt(
    @Req() req: Request,
    @Res() res: Response,
    @Param('receiptId') receiptId: string,
  ) {
    const lineId = (req as unknown as LiffRequest).liffUserId;

    const customer = await this.liffApiService.findCustomerByLineId(lineId);
    if (!customer) throw new NotFoundException('ไม่พบข้อมูลลูกค้า');

    // Verify receipt belongs to this customer
    const receipt = await this.prisma.receipt.findFirst({
      where: {
        id: receiptId,
        contract: { customerId: customer.id, deletedAt: null },
        isVoided: false,
      },
      select: { id: true, fileUrl: true, receiptNumber: true },
    });
    if (!receipt) throw new NotFoundException('ไม่พบใบเสร็จ');

    if (!receipt.fileUrl) {
      throw new NotFoundException('ใบเสร็จนี้ยังไม่มีไฟล์ PDF กรุณาติดต่อพนักงาน 063-134-6356');
    }

    // Find eDocument linked to this receipt's fileUrl
    const doc = await this.prisma.eDocument.findFirst({
      where: { fileUrl: receipt.fileUrl },
    });
    if (!doc) throw new NotFoundException('ไม่พบไฟล์ใบเสร็จ กรุณาติดต่อพนักงาน 063-134-6356');

    const { stream, filename, contentType } = await this.documentsService.getDocumentStream(doc.id);
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
    });
    stream.pipe(res);
  }

  // ─── LIFF Branch Contact Info ───────────────────────

  @Get('liff/branches')
  async getLiffBranches(@Req() req: Request) {
    const lineId = (req as unknown as LiffRequest).liffUserId;

    const customer = await this.liffApiService.findCustomerByLineId(lineId);

    // Get branches — if customer has contracts, prioritize their branch
    const branches = await this.prisma.branch.findMany({
      where: { isActive: true, deletedAt: null },
      select: {
        id: true,
        name: true,
        location: true,
        phone: true,
      },
      orderBy: { name: 'asc' },
    });

    // Find customer's primary branch
    let primaryBranchId: string | null = null;
    if (customer) {
      const contract = await this.prisma.contract.findFirst({
        where: { customerId: customer.id, deletedAt: null },
        select: { branchId: true },
        orderBy: { createdAt: 'desc' },
      });
      primaryBranchId = contract?.branchId || null;
    }

    return {
      branches: branches.map((b) => ({
        ...b,
        isPrimary: b.id === primaryBranchId,
      })),
    };
  }

  // ─── LIFF Notification Preferences ──────────────────

  @Get('liff/notification-preferences')
  async getNotificationPreferences(@Req() req: Request) {
    const lineId = (req as unknown as LiffRequest).liffUserId;
    return this.liffApiService.getNotificationPreferences(lineId);
  }

  @Post('liff/notification-preferences')
  async updateNotificationPreferences(
    @Req() req: Request,
    @Body() dto: LiffNotificationPreferencesDto,
  ) {
    const lineId = (req as unknown as LiffRequest).liffUserId;
    return this.liffApiService.updateNotificationPreferences(lineId, dto);
  }
}
