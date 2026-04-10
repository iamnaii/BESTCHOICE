import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Req,
  UseGuards,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { LiffApiService } from './liff-api.service';
import { PaymentLinkService } from './payment-links/payment-link.service';
import { ContractPaymentService } from '../contracts/contract-payment.service';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { LiffTokenGuard, LiffRequest } from './guards/liff-token.guard';
import { Throttle } from '@nestjs/throttler';
import {
  LiffRegisterLookupDto,
  LiffRegisterConfirmDto,
  LiffCreatePaymentLinkDto,
  LiffEarlyPayoffDto,
} from './dto/liff.dto';
import type {
  LiffContractResponse,
  LiffHistoryResponse,
  LiffProfileResponse,
  LiffPaymentLinkResult,
} from '@installment/shared';

@ApiTags('LIFF API')
@Controller('line-oa')
export class LiffApiController {
  private readonly logger = new Logger(LiffApiController.name);

  constructor(
    private liffApiService: LiffApiService,
    private paymentLinkService: PaymentLinkService,
    private contractPaymentService: ContractPaymentService,
  ) {}

  // ─── LIFF Contracts ─────────────────────────────────

  @Get('liff/contracts')
  @SkipCsrf()
  @UseGuards(LiffTokenGuard)
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
  async liffRegisterLookup(@Req() req: Request, @Body() dto: LiffRegisterLookupDto) {
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

    return { success: true, message: 'ลงทะเบียนสำเร็จ' };
  }

  // ─── LIFF History & Profile ─────────────────────────

  @Get('liff/history')
  @SkipCsrf()
  @UseGuards(LiffTokenGuard)
  async getLiffPaymentHistory(@Req() req: Request): Promise<LiffHistoryResponse> {
    const lineId = (req as unknown as LiffRequest).liffUserId;

    const result = await this.liffApiService.findCustomerPaymentHistory(lineId);
    if (!result) {
      throw new NotFoundException('ไม่พบข้อมูลลูกค้า กรุณาลงทะเบียนก่อน');
    }

    return result;
  }

  @Get('liff/profile')
  @SkipCsrf()
  @UseGuards(LiffTokenGuard)
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
  @SkipCsrf()
  @UseGuards(LiffTokenGuard)
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
  @SkipCsrf()
  @UseGuards(LiffTokenGuard)
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

    const quote = await this.contractPaymentService.getEarlyPayoffQuote(dto.contractId);
    const result = await this.paymentLinkService.createPaymentLink(
      dto.contractId,
      undefined,
      quote.totalPayoff,
    );
    return { url: result.url, token: result.token, totalPayoff: quote.totalPayoff };
  }
}
