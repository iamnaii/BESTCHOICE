import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PaymentLinkPurpose, PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  FINANCE_LINE_RECIPIENT_SELECT,
  financeLineRecipient,
  findOtpVerifiedCustomerId,
} from '../../line-oa/services/otp-verified-customer';
import { LineOaService } from '../../line-oa/line-oa.service';
import { buildPartialPaymentQRFlex } from '../../line-oa/flex-messages/partial-payment-qr.flex';
import { buildRescheduleQRFlex } from '../../line-oa/flex-messages/reschedule-qr.flex';
import { d, dAdd, dSub, dClose } from '../../../utils/decimal.util';
import { loadLateFeeConfig } from '../../../utils/late-fee.util';
import { computeRescheduleQuote } from '../../../utils/reschedule-quote.util';
import { addBkkDays } from '../../../utils/date.util';
import { PaySolutionsGatewayClient, PAYSOLUTIONS_TIMEOUT_MS } from './paysolutions-gateway.client';
import { shopBaseUrl } from '../../../utils/shop-base-url.util';
import { PAY_LINK_TOKEN_PATTERN } from '../pay-link-token';
import { assertNoPendingBankRefund } from '../../refunds/pending-bank-refund';
import {
  buildPayoffQuoteSnapshot,
  PAYOFF_ELIGIBLE_CONTRACT_STATUSES,
  type PaySolutionsPayoffPort,
  type PayoffQuoteSnapshot,
} from '../payoff-quote-snapshot';
import {
  findOpenPayoffIntent,
  lockPayoffIntent,
  openPayoffIntentMessage,
} from '../payoff-intent-guard';

/**
 * Task 39 — ลิงก์ `/pay/:token` ที่ชำระไปแล้ว (webhook ตั้ง USED เมื่อเงินเข้า) · หน้าที่ลูกค้ากดอยู่คือ `/pay/:token` ซึ่งมีปุ่ม
 * "กลับไปดูสัญญา" (`/liff/contract` — มี "ประวัติชำระเงิน" และปุ่ม "ชำระค่างวดตอนนี้")
 */
export const PAY_LINK_USED_MESSAGE =
  'ลิงก์นี้ชำระเงินแล้ว — กด "กลับไปดูสัญญา" ด้านล่างเพื่อดูประวัติชำระเงินและยอดคงเหลือ';

/**
 * Task 41 — ยอดที่หน้าปิดยอด (`LiffEarlyPayoff`) ส่งมาไม่ตรงยอดปิดของ server (เปิดหน้าค้างข้ามวัน / มีงวดถึงกำหนดหรือค่าปรับเพิ่ม) · ทางไปต่อ
 * ที่มีจริงบนหน้านั้น: ลิงก์ "กลับไปดูสัญญา" ท้ายหน้า → `/liff/contract` ปุ่ม "ปิดยอดก่อนกำหนด · ลดดอกเบี้ย" (โหลดยอดล่าสุดใหม่)
 */
export function payoffAmountChangedMessage(totalPayoff: string): string {
  const formatted = Number(totalPayoff).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    `ยอดปิดสัญญาเปลี่ยนแล้ว — ยอดล่าสุด ${formatted} บาท · กด "กลับไปดูสัญญา" ด้านล่าง ` +
    'แล้วกด "ปิดยอดก่อนกำหนด · ลดดอกเบี้ย" อีกครั้งเพื่อดูยอดล่าสุดก่อนชำระ'
  );
}

/**
 * Task 41 fix round (ข้อ 3) — ลิงก์ `/pay/:token` ที่ `purpose = PAYOFF` แต่ยอดของลิงก์ไม่ตรงยอดปิดของ server แล้ว · ทางไปต่อที่มีจริงบนหน้า
 * `/pay/:token` (`LiffPayment.tsx`): ลิงก์ "กลับไปดูสัญญา" ท้ายหน้า → `/liff/contract` ปุ่ม "ปิดยอดก่อนกำหนด · ลดดอกเบี้ย" (หน้าปิดยอดคิดยอดล่าสุด)
 */
export function stalePayoffLinkMessage(totalPayoff: string): string {
  const formatted = Number(totalPayoff).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    `ลิงก์ปิดยอดนี้ใช้ไม่ได้แล้ว เพราะยอดปิดสัญญาเปลี่ยน (ยอดล่าสุด ${formatted} บาท) — กด "กลับไปดูสัญญา" ด้านล่าง ` +
    'แล้วกด "ปิดยอดก่อนกำหนด · ลดดอกเบี้ย" เพื่อดูยอดล่าสุดและชำระ'
  );
}

export interface PaymentIntentResult {
  paymentId: string;
  paymentUrl: string;
  gatewayRef: string;
  qrCodeUrl?: string;
}

/**
 * Owns the four "mint a Pay Solutions intent" flows (staff `createEarlyPayoffQR` removed in Task 41 — it had no caller and minted PAYOFF rows without a quote snapshot). NO regulated JE — the
 * line-266 intent-tracking $transaction does NOT touch the ledger. Constructed
 * internally by {@link PaySolutionsService}; the gateway mechanics live in
 * {@link PaySolutionsGatewayClient}.
 */
@Injectable()
export class PaySolutionsIntentService {
  private readonly logger = new Logger(PaySolutionsIntentService.name);
  private readonly returnUrl: string;
  private readonly apiBaseUrl: string;

  constructor(
    private gateway: PaySolutionsGatewayClient,
    private prisma: PrismaService,
    private lineOaService: LineOaService,
    private config: ConfigService,
    /** Task 41 — ยอดปิดของ server สำหรับ intent ปิดยอด (ไม่ส่ง = intent ปิดยอดถูกปฏิเสธ — fail closed) */
    private payoff?: PaySolutionsPayoffPort,
  ) {
    this.returnUrl = this.config.get<string>('PAYSOLUTIONS_RETURN_URL', '');
    this.apiBaseUrl = this.config.get<string>(
      'API_BASE_URL',
      'https://api.bestchoicephone.app',
    );
  }

  /**
   * สร้าง payment intent — เรียก Pay Solutions API สร้าง payment request
   * ได้ payment URL สำหรับ redirect ลูกค้าไปชำระเงิน
   */
  async createPaymentIntent(
    contractId: string,
    amount: number,
    description?: string,
    lineId?: string,
    installmentNo?: number,
    paymentLinkToken?: string,
  ): Promise<PaymentIntentResult> {
    // ตรวจสอบว่า contract มีอยู่จริง
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        customer: { select: { name: true, phone: true, email: true } },
      },
    });

    if (!contract || contract.deletedAt) {
      throw new NotFoundException('ไม่พบสัญญาที่ระบุ');
    }

    // ตรวจสอบว่า contract เป็นของ customer ที่ผูก LINE (บังคับ — ป้องกันสร้าง intent โดยไม่ยืนยันตัวตน)
    // Task 22 I-1 (ก): เจ้าของ = ลูกค้าของแถว OTP ช่อง FINANCE ที่ยังผูกของ LINE นี้ (findOtpVerifiedCustomerId) — ไม่ใช่คอลัมน์
    // `line_id_finance` (แยกจากแถว OTP ได้: ค่าที่พนักงาน/นำเข้าเขียนก่อน Task 22 · กู้ลูกค้าที่ถูกลบ) · ไม่มีแถว = ปฏิเสธ
    if (!lineId) {
      throw new BadRequestException('กรุณาระบุ LINE ID เพื่อยืนยันตัวตน');
    }
    if ((await findOtpVerifiedCustomerId(this.prisma, lineId)) !== contract.customerId) {
      throw new BadRequestException('สัญญานี้ไม่ตรงกับบัญชี LINE ของคุณ');
    }
    // Task 39 — ลิงก์ `/pay/:token` ที่ไม่ใช่ `INSTALLMENT` (ส่ง token แทนเลขงวด): ยอดที่ตัดเงิน = ยอดของลิงก์ที่เก็บไว้ (server ตัดสิน
    // ไม่เชื่อ client) · ตรวจลิงก์ก่อนด่าน #24 (token ใช้ไม่ได้ = ข้อความของลิงก์)
    const sourceLink =
      !installmentNo && paymentLinkToken
        ? await this.amountPayLink(contractId, paymentLinkToken, amount)
        : null;
    if (sourceLink) amount = sourceLink.amount;
    // การปิดยอด = ลิงก์ `PAYOFF` และทางที่ไม่มีทั้งเลขงวดและ token (`LiffEarlyPayoff`) · ลิงก์ `AMOUNT` (แจ้งล็อก · ยอดนัด) และลิงก์งวดจ่ายได้
    // เหมือนจ่ายที่สาขา (FIFO — ไม่ใช่ JP4)
    const isPayoff =
      !installmentNo && (!sourceLink || sourceLink.purpose === PaymentLinkPurpose.PAYOFF);
    let payoffQuote: PayoffQuoteSnapshot | null = null;
    if (isPayoff) {
      // Task 41 — สถานะเดียวกับหน้า LIFF ยอดปิด (ข้อความลูกค้าเดียวกัน) · เดิม create-intent ไม่ตรวจสถานะ (Task 39 m-5)
      if (!PAYOFF_ELIGIBLE_CONTRACT_STATUSES.includes(contract.status)) {
        throw new BadRequestException('สัญญานี้ไม่สามารถปิดยอดก่อนกำหนดได้');
      }
      // คำตัดสินเจ้าของ #24 (2026-10-31): ห้ามปิดยอดก่อนกำหนด (JP4) ขณะมีคำขอคืนเงินที่อนุมัติแล้วแต่ยังไม่บันทึกผลธนาคาร — บังคับที่นี่
      // (ก่อนเรียก gateway) เพราะ webhook ห้ามปฏิเสธเงินที่ตัดแล้ว (แบบเดียวกับกติกา "ห้ามข้ามงวด" ที่บังคับตอนส่ง QR) · webhook ตรวจซ้ำ
      // ในธุรกรรมของ JP4 แล้วถอยเป็น FIFO + งานแจ้ง (Task 41)
      await assertNoPendingBankRefund(this.prisma, contractId, 'EARLY_PAYOFF', 'customer');
      // Task 41 (ค) — มี QR ปิดยอดของสัญญานี้ที่ยังเปิดอยู่ = 400 ก่อนเรียก gateway (ชั้นที่ 1 · ชั้นที่ 2 ใต้ล็อกตอนสร้างแถวติดตามข้างล่าง)
      const openPayoff = await findOpenPayoffIntent(this.prisma, contractId);
      if (openPayoff) {
        throw new BadRequestException(openPayoffIntentMessage(openPayoff.expiresAt));
      }
      // Task 41 (คำตัดสินเจ้าของ #43) — ยอดปิดของ server (ตัวเดียวกับหน้า LIFF ยอดปิด · % ส่วนลดค่าเริ่มต้นเดียวกัน) เก็บเป็น snapshot บน
      // แถวติดตาม ให้ webhook คำนวณใหม่ ณ เวลาที่เงินเข้าแล้วลง JP4 · ทาง `LiffEarlyPayoff`: ยอดที่ตัดเงิน = ยอดปิดของ server (ไม่เชื่อยอดจาก
      // client — ไม่ตรง ±0.01 = 400) · ลิงก์ `PAYOFF`: ยอดที่ตัดเงินยังเป็นยอดของลิงก์ (Task 39) — ยอดของลิงก์ที่ไม่ตรงยอดปิด ณ เวลาที่เงินเข้า
      // ถูกลงแบบ FIFO + งานแจ้งพนักงาน
      payoffQuote = await this.serverPayoffQuote(contractId);
      if (!sourceLink) {
        if (!dClose(amount, payoffQuote.totalPayoff)) {
          throw new BadRequestException(payoffAmountChangedMessage(payoffQuote.totalPayoff));
        }
        amount = Number(payoffQuote.totalPayoff);
      } else if (!dClose(sourceLink.amount, payoffQuote.totalPayoff)) {
        // Task 41 fix round (ข้อ 3) — ลิงก์ PAYOFF ที่ยอดของลิงก์ไม่ตรงยอดปิดของ server แล้ว (ลิงก์อายุ 24 ชม. — ข้ามวันมีงวดถึงกำหนด/ค่าปรับเพิ่ม/
        // จ่ายทางอื่นไปบางส่วน) ปฏิเสธก่อนตัดเงิน · webhook จึงเหลือแค่ช่องข้ามวันระหว่างสร้าง QR กับเงินเข้า
        throw new BadRequestException(stalePayoffLinkMessage(payoffQuote.totalPayoff));
      }
    }

    // PaySolutions referenceNo: max 12 chars, must be unique.
    // PDF sample uses all-digits ("123456789012") and the payment UI
    // at payments.paysolutions.asia rejected alphanumeric refs with
    // "Invalid data, please check the referenceNo" — so stick to digits.
    // Date.now() is 13 digits; last 12 gives us a unique ref per ms.
    const orderRef = String(Date.now()).slice(-12);

    // หา payment record ที่ต้องชำระ (ถ้าระบุ installmentNo)
    let paymentRecord: Awaited<ReturnType<typeof this.prisma.payment.findUnique>> = null;
    if (installmentNo) {
      paymentRecord = await this.prisma.payment.findUnique({
        where: { contractId_installmentNo: { contractId, installmentNo } },
      });
      if (!paymentRecord) {
        throw new NotFoundException(`ไม่พบงวดที่ ${installmentNo}`);
      }
      if (paymentRecord.status === 'PAID') {
        throw new BadRequestException(`งวดที่ ${installmentNo} ชำระเรียบร้อยแล้ว`);
      }

      // Validate amount matches actual outstanding for this installment
      const expectedAmount = dSub(dAdd(paymentRecord.amountDue, paymentRecord.lateFee), paymentRecord.amountPaid);
      if (!dClose(amount, expectedAmount)) {
        throw new BadRequestException(
          `ยอดชำระไม่ตรง: ส่งมา ${amount.toLocaleString()} บาท แต่ยอดค้างจริง ${expectedAmount.toNumber().toLocaleString()} บาท`,
        );
      }
    }

    // Task 41 — id ของแถวติดตามกำหนดก่อนเรียก gateway เพื่อใส่ใน returnUrl: หน้า `/liff/contract?ref=` poll `GET /paysolutions/status/:id`
    // (ParseUUIDPipe) — เดิมส่งเลขอ้างอิง 12 หลัก ⇒ 400 ทุกครั้ง หน้าไม่เคยขึ้น "ชำระเงินสำเร็จ!" · `getPaymentStatus` หาแถวด้วย id (Task 39)
    const trackingId = randomUUID();

    // เรียก Pay Solutions API v2 (ตาม Web API Guideline v1.2.2)
    const returnUrlWithRef = `${this.returnUrl || `${this.config.get('FRONTEND_URL', 'http://localhost:5173')}/liff/contract`}?ref=${trackingId}`;

    const paymentPayload = {
      merchantId: await this.gateway.getMerchantId(),
      customerEmail: contract.customer.email || 'noreply@bestchoice.com',
      referenceNo: orderRef,
      description: description || `ชำระค่างวด สัญญา ${contract.contractNumber}`,
      amount,
      paymentChannel: 'Qrcode',
      paymentGateway: 'Promptpay',
      currencyCode: '00',
      lang: 'TH',
      returnUrl: returnUrlWithRef,
      postbackUrl: `${this.apiBaseUrl}/api/paysolutions/webhook`,
      terminalId: await this.gateway.getTerminalId(),
      keyVersion: 1,
    };

    const { gatewayResponse, paymentUrl } = await this.gateway.createUiPayment(paymentPayload, {
      orderRef,
      buildErrorLog: (response, gr, parsed) =>
        `Pay Solutions API error: HTTP ${response.status} statusCode=${parsed.statusCode} message="${parsed.message}" — ${JSON.stringify(gr)}`,
      errorMessagePrefix: 'ไม่สามารถสร้างรายการชำระเงินได้',
      buildMissingUrlLog: (gr) => `Pay Solutions missing redirectUrl: ${JSON.stringify(gr)}`,
      missingUrlMessage: 'ไม่ได้รับลิงก์ชำระเงินจากระบบ',
      buildTimeoutLog: () =>
        `Pay Solutions timeout after ${PAYSOLUTIONS_TIMEOUT_MS}ms for orderRef=${orderRef}`,
      timeoutSentryKey: 'paysolutions-timeout',
      timeoutSentryExtra: { contractId, amount, timeoutMs: PAYSOLUTIONS_TIMEOUT_MS },
      timeoutMessage: 'ระบบชำระเงินใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง',
      buildGenericErrorLog: (error) => `Pay Solutions API call failed: ${error}`,
      genericErrorMessage: 'ไม่สามารถเชื่อมต่อระบบชำระเงินได้ กรุณาลองใหม่',
    });

    // Pay Solutions v2 response: { redirectUrl, transactionId, status }
    const gatewayRef = (gatewayResponse.transactionId as string) || orderRef;

    // CRITICAL: gateway intent ได้สร้างไปแล้ว — ถ้า DB write fail ตรงนี้
    // เราจะมี orphaned gateway intent (ลูกค้า redirect ไปจ่ายได้แต่ webhook
    // จะหา PaymentLink ไม่เจอ → ลูกค้าจ่ายเงินแต่ระบบไม่บันทึก)
    // → wrap ใน $transaction ให้ payment.update + paymentLink.create เป็น atomic
    // → ถ้า fail ส่ง Sentry ทันทีพร้อม gatewayRef เพื่อให้ ops reconcile ได้
    let tracking: { id: string } | null = null;
    try {
      tracking = await this.prisma.$transaction(async (tx) => {
        if (payoffQuote) {
          // Task 41 (ค) ชั้นที่ 2 — ล็อกต่อสัญญาแล้วตรวจซ้ำในธุรกรรมที่สร้างแถว: สองคำขอพร้อมกันที่ผ่านชั้นที่ 1 มาทั้งคู่ คำขอที่สองเห็นแถวของ
          // คำขอแรก (commit แล้ว) → 400 และไม่ได้ลิงก์ชำระ (ล็อกไม่ถือข้ามการเรียก gateway)
          await lockPayoffIntent(tx, contractId);
          const raced = await findOpenPayoffIntent(tx, contractId);
          if (raced) {
            throw new BadRequestException(openPayoffIntentMessage(raced.expiresAt));
          }
        }
        if (paymentRecord) {
          await tx.payment.update({
            where: { id: paymentRecord.id },
            data: {
              gatewayRef,
              gatewayStatus: 'PENDING',
              gatewayResponse: gatewayResponse as object,
              paymentMethod: PaymentMethod.ONLINE_GATEWAY,
            },
          });
        }

        return tx.paymentLink.create({
          data: {
            id: trackingId,
            token: orderRef,
            contractId,
            paymentId: paymentRecord?.id || null,
            amount,
            // Task 39 — เงินของรายการนี้จ่ายอะไร · ลิงก์ต้นทาง (webhook สำเร็จตั้งลิงก์ต้นทางเป็น USED — จ่ายซ้ำจากลิงก์เดียวกันไม่ได้)
            purpose: paymentRecord
              ? PaymentLinkPurpose.INSTALLMENT
              : (sourceLink?.purpose ?? PaymentLinkPurpose.PAYOFF),
            sourceLinkId: sourceLink?.id ?? null,
            // Task 41 — ยอดปิดของ server ตอนสร้าง intent (เฉพาะการปิดยอด) — webhook คำนวณใหม่ด้วย % ส่วนลดตัวนี้
            ...(payoffQuote ? { payoffQuote: payoffQuote as unknown as Prisma.InputJsonObject } : {}),
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min expiry
          },
        });
      });
    } catch (dbError) {
      if (dbError instanceof BadRequestException) {
        // Task 41 (ค) — แพ้คำขอปิดยอดอีกใบที่สร้างพร้อมกัน: ไม่ส่งลิงก์ชำระให้ลูกค้า ⇒ intent ที่ gateway สร้างไว้ไม่มีใครเห็น QR (ไม่ใช่ orphan
        // ที่มีเงินเข้าได้) · เก็บเลขอ้างอิงไว้ใน log เผื่อตรวจย้อน
        this.logger.warn(
          `Payoff intent rejected after gateway call — another payoff QR is open. orderRef=${orderRef} gatewayRef=${gatewayRef} contractId=${contractId} (payment URL not returned)`,
        );
        throw dbError;
      }
      // Gateway intent created but DB tracking failed → ORPHAN risk
      this.logger.error(
        `CRITICAL: PaySolutions intent created but DB tracking failed. orderRef=${orderRef} gatewayRef=${gatewayRef} contractId=${contractId}`,
      );
      Sentry.captureException(dbError, {
        level: 'fatal',
        tags: {
          critical: 'paysolutions-orphan-intent',
          orderRef,
          gatewayRef,
        },
        extra: {
          contractId,
          paymentRecordId: paymentRecord?.id,
          amount,
        },
      });
      throw new InternalServerErrorException(
        'ระบบบันทึกข้อมูลชำระเงินไม่สำเร็จ กรุณาติดต่อแอดมิน',
      );
    }

    this.logger.log(
      `Payment intent created: ${orderRef} for contract ${contractId}, amount ${amount}`,
    );

    return {
      // ไม่มีงวด (ลิงก์ PAYOFF / AMOUNT · LiffEarlyPayoff) → id ของแถวติดตาม (UUID) ให้หน้าเว็บ poll `GET /paysolutions/status/:id` ได้
      // (เดิมคืนเลขอ้างอิง 12 หลัก ซึ่ง endpoint สถานะ (ParseUUIDPipe) ตอบ 400 — Task 39)
      paymentId: paymentRecord?.id || tracking?.id || orderRef,
      paymentUrl,
      gatewayRef,
    };
  }

  /** Task 41 — ยอดปิดของ server (ตัวเดียวกับหน้า LIFF ยอดปิด `GET liff/early-payoff-quote` — % ส่วนลดค่าเริ่มต้น) เป็น snapshot ของแถวติดตาม */
  private async serverPayoffQuote(contractId: string): Promise<PayoffQuoteSnapshot> {
    if (!this.payoff) {
      // fail closed — ไม่มีตัวคำนวณ = ไม่รู้ยอดปิดที่ถูก ห้ามตัดเงินตามยอดของ client
      throw new InternalServerErrorException('ระบบคำนวณยอดปิดสัญญาไม่พร้อม กรุณาติดต่อเจ้าหน้าที่');
    }
    const quote = await this.payoff.getEarlyPayoffQuote(contractId, undefined, undefined, this.prisma, {
      skipJournalPreview: true,
    });
    return buildPayoffQuoteSnapshot(quote);
  }

  /**
   * Task 39 — ลิงก์ `/pay/:token` ที่ไม่ใช่ `INSTALLMENT` (`PAYOFF` ยอดปิด · `AMOUNT` ยอดค้างรวมแจ้งล็อก/ยอดนัด): ยอดที่ตัดเงิน =
   * `PaymentLink.amount` ที่เก็บไว้ (ยอดเดียวกับข้อความที่ลูกค้าได้) · ยอดจาก client ต้องตรง ±0.01 ไม่งั้น 400 (ไม่เชื่อ client) ·
   * token ต้องเป็นของ `createPaymentLink` (64 hex — ไม่ใช่เลขอ้างอิง 12 หลักของแถวติดตาม intent) · ลิงก์ต้องเป็นของสัญญานี้ ไม่ถูกลบ
   * ไม่ใช่ลิงก์ออม และ purpose เป็น `PAYOFF`/`AMOUNT` (`INSTALLMENT` ต้องมาทางเลขงวด · null = แถวเก่า) · ชำระไปแล้ว (USED — webhook ตั้ง)
   * = `PAY_LINK_USED_MESSAGE` · หมดอายุ = ข้อความเดิม
   *
   * ยอดค้างเปลี่ยนระหว่างส่งลิงก์กับกดจ่าย (เช่น ลูกค้าจ่ายที่สาขาไปบางส่วน): ยอดของลิงก์ยังเป็นยอดที่ตัด — webhook กระจาย FIFO ตามงวด
   * (เงินไม่พอปิดงวด = `PARTIALLY_PAID`) และส่วนที่เกินทุกงวดค้างพักเป็นเงินรับล่วงหน้า 21-1103 + ใบ `ADVANCE_SURPLUS` (กติกาเดิมของ
   * ลิงก์ชำระ — PR-843/I2 #3 · PR4ข) ไม่มีรายการบัญชีใหม่ · **ไม่มียอดค้างเลย** (ทุกงวด PAID) = 400 ก่อนตัดเงิน — แบบเดียวกับทางผูกงวด
   * ที่ปฏิเสธงวดที่ชำระแล้ว (ไม่งั้นเงินทั้งก้อนกลายเป็นเงินรับล่วงหน้าของสัญญาที่ปิดแล้ว) · ยอดค้าง = สูตรเดียวกับ webhook
   * (`status ≠ PAID` · ไม่ถูกลบ · ค่าปรับที่ยกเว้น = 0 · แถวที่ owed ≤ 0 ไม่นับ)
   */
  private async amountPayLink(
    contractId: string,
    token: string,
    clientAmount: number,
  ): Promise<{ id: string; amount: number; purpose: PaymentLinkPurpose }> {
    if (!PAY_LINK_TOKEN_PATTERN.test(token)) {
      throw new BadRequestException('ลิงก์ชำระเงินไม่ถูกต้อง');
    }
    const link = await this.prisma.paymentLink.findUnique({ where: { token } });
    if (
      !link ||
      link.deletedAt ||
      link.contractId !== contractId ||
      link.savingPlanId ||
      (link.purpose !== PaymentLinkPurpose.PAYOFF && link.purpose !== PaymentLinkPurpose.AMOUNT)
    ) {
      throw new BadRequestException('ลิงก์ชำระเงินไม่ถูกต้อง');
    }
    if (link.status === 'USED') {
      throw new BadRequestException(PAY_LINK_USED_MESSAGE);
    }
    if (link.status !== 'ACTIVE' || link.expiresAt <= new Date()) {
      throw new BadRequestException('ลิงก์ชำระเงินหมดอายุหรือถูกใช้แล้ว');
    }
    if (!dClose(clientAmount, link.amount)) {
      throw new BadRequestException(
        `ยอดชำระไม่ตรง: ส่งมา ${clientAmount.toLocaleString()} บาท แต่ยอดของลิงก์ ${link.amount.toNumber().toLocaleString()} บาท`,
      );
    }

    const unpaid = await this.prisma.payment.findMany({
      where: { contractId, status: { not: 'PAID' }, deletedAt: null },
      select: { amountDue: true, amountPaid: true, lateFee: true, lateFeeWaived: true },
    });
    const outstanding = unpaid.reduce((sum, p) => {
      const owed = dSub(dAdd(p.amountDue, p.lateFeeWaived ? 0 : p.lateFee), p.amountPaid);
      return owed.gt(0) ? dAdd(sum, owed) : sum;
    }, d(0));
    if (outstanding.lte(0)) {
      throw new BadRequestException('สัญญานี้ชำระครบแล้ว');
    }

    return { id: link.id, amount: link.amount.toNumber(), purpose: link.purpose };
  }

  /**
   * สร้าง payment intent สำหรับ online order (ร้านค้าออนไลน์)
   * — เรียก Pay Solutions API สร้างลิงก์ชำระเงิน
   * — บันทึก PaymentLink ที่ contractId=null + link กลับมาหา OnlineOrder
   * — Retry safe: ถ้ามี PaymentLink ACTIVE อยู่แล้วจะ reuse ไม่สร้างใหม่
   */
  async createOnlineOrderIntent(input: {
    onlineOrderId: string;
    amount: number;
    description: string;
    channel: 'PROMPTPAY_QR' | 'CREDIT_DEBIT_CARD';
  }): Promise<{ paymentLinkId: string; paymentUrl: string; qrCodeUrl?: string }> {
    const order = await this.prisma.onlineOrder.findUnique({
      where: { id: input.onlineOrderId },
      include: { customer: { select: { email: true, name: true } } },
    });
    if (!order) throw new NotFoundException('ไม่พบคำสั่งซื้อ');
    if (order.paymentLinkId) {
      const existing = await this.prisma.paymentLink.findUnique({
        where: { id: order.paymentLinkId },
      });
      if (existing && existing.status === 'ACTIVE') {
        // Reuse — avoid creating a new gateway intent on retry
        return { paymentLinkId: existing.id, paymentUrl: '' };
      }
    }

    // Numeric-only ref (see createPaymentIntent for rationale).
    const orderRef = String(Date.now()).slice(-12);
    // ⚠️ ห้ามใช้ this.returnUrl (PAYSOLUTIONS_RETURN_URL) ตรงนี้ — ค่านั้นเป็น deep-link
    // ของ LIFF สัญญาผ่อน ซึ่งถูกสำหรับ 4 flow ของพนักงาน/สัญญาในไฟล์นี้ แต่ผิดสำหรับ
    // "ลูกค้าหน้าร้านที่เพิ่งจ่ายเงินเสร็จ" — เขาต้องกลับมาหน้าคำสั่งซื้อบนหน้าร้าน
    // (ก่อนหน้านี้จ่ายเสร็จแล้วเด้งไปหน้า LINE login/หน้าสัญญาที่ไม่มี route ของ order)
    const shopBase = shopBaseUrl();
    const returnUrlBase = shopBase
      ? `${shopBase}/orders`
      : `${this.config.get('FRONTEND_URL', 'http://localhost:5174')}/orders`;
    const returnUrl = `${returnUrlBase}/${order.orderNumber}`;

    const paymentPayload: Record<string, unknown> = {
      merchantId: await this.gateway.getMerchantId(),
      customerEmail: order.customer.email || 'noreply@bestchoice.com',
      referenceNo: orderRef,
      description: input.description,
      amount: input.amount,
      paymentChannel: input.channel === 'PROMPTPAY_QR' ? 'Qrcode' : 'CreditDebit',
      paymentGateway: input.channel === 'PROMPTPAY_QR' ? 'Promptpay' : undefined,
      currencyCode: '00',
      lang: 'TH',
      returnUrl,
      postbackUrl: `${this.apiBaseUrl}/api/paysolutions/webhook`,
      terminalId: await this.gateway.getTerminalId(),
      keyVersion: 1,
    };

    const { paymentUrl } = await this.gateway.createUiPayment(paymentPayload, {
      orderRef,
      buildErrorLog: (response, gr, parsed) =>
        `Pay Solutions online-order API error: HTTP ${response.status} statusCode=${parsed.statusCode} message="${parsed.message}" — ${JSON.stringify(gr)}`,
      errorMessagePrefix: 'ไม่สามารถสร้างรายการชำระเงินได้',
      missingUrlMessage: 'ไม่ได้รับลิงก์ชำระเงินจากระบบ',
      timeoutSentryKey: 'paysolutions-online-timeout',
      timeoutSentryExtra: { onlineOrderId: input.onlineOrderId, amount: input.amount },
      timeoutMessage: 'ระบบชำระเงินใช้เวลานานเกินไป กรุณาลองใหม่',
      genericErrorMessage: 'ไม่สามารถเชื่อมต่อระบบชำระเงินได้',
    });

    try {
      const paymentLink = await this.prisma.paymentLink.create({
        data: {
          token: orderRef,
          amount: input.amount,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      });
      await this.prisma.onlineOrder.update({
        where: { id: input.onlineOrderId },
        data: { paymentLinkId: paymentLink.id },
      });
      this.logger.log(
        `Online order payment intent: ${orderRef} for order ${input.onlineOrderId}`,
      );
      return { paymentLinkId: paymentLink.id, paymentUrl };
    } catch (dbError) {
      Sentry.captureException(dbError, {
        level: 'fatal',
        tags: { critical: 'paysolutions-online-orphan', orderRef },
        extra: { onlineOrderId: input.onlineOrderId },
      });
      throw new InternalServerErrorException('ระบบบันทึกข้อมูลชำระเงินไม่สำเร็จ');
    }
  }

  /**
   * Cashier-initiated PARTIAL payment QR.
   *
   * Wizard flow: cashier opens RecordPaymentWizard for a Payment row, types
   * an amount (typically < installment total), picks method=QR, clicks "ส่ง QR".
   * We:
   *   1. Cancel any earlier active PartialPaymentLink for the same Payment
   *      (single outstanding QR per installment — avoids customer paying twice).
   *   2. Call PaySolutions to mint a PromptPay QR with the requested amount.
   *   3. Save a PartialPaymentLink row (24h expiry) tracking the open QR.
   *   4. Best-effort push a STYLE_D info-role Flex to the customer's LINE OA.
   *
   * When the webhook fires, handlePaymentCallback looks up the token in
   * PartialPaymentLink first and routes through PaymentService.recordPayment
   * with case='PARTIAL' so the existing tolerance/JE/snapshot pipeline runs
   * exactly as if the cashier had recorded it manually.
   */
  async createPartialPaymentQR(input: {
    paymentId: string;
    amount: number;
    additionalLateFee?: number;
    requestedById?: string;
    description?: string;
  }): Promise<{ partialPaymentLinkId: string; paymentUrl: string; orderRef: string; sentToLine: boolean }> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: input.paymentId },
      include: {
        contract: {
          include: {
            customer: {
              select: { id: true, email: true, name: true, ...FINANCE_LINE_RECIPIENT_SELECT },
            },
          },
        },
      },
    });
    if (!payment || payment.deletedAt) {
      throw new NotFoundException('ไม่พบรายการชำระ');
    }
    if (payment.status === 'PAID') {
      throw new BadRequestException('งวดนี้ชำระครบแล้ว');
    }
    if (input.amount <= 0) {
      throw new BadRequestException('ยอดที่ส่ง QR ต้องมากกว่า 0');
    }

    const additionalLateFee = input.additionalLateFee ?? 0;
    if (!Number.isFinite(additionalLateFee) || additionalLateFee < 0 ||
        !d(additionalLateFee).eq(d(additionalLateFee).toDecimalPlaces(2)) ||
        (additionalLateFee > 0 && !input.requestedById)) {
      throw new BadRequestException('ค่าปรับที่เพิ่มต้องมีผู้บันทึก ไม่ติดลบ และมีทศนิยมไม่เกิน 2 ตำแหน่ง');
    }

    // Single outstanding QR per installment — cancel any earlier active one.
    await this.prisma.partialPaymentLink.updateMany({
      where: { paymentId: input.paymentId, status: 'ACTIVE' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    const orderRef = String(Date.now()).slice(-12);
    const returnUrlBase =
      this.returnUrl || `${this.config.get('FRONTEND_URL', 'http://localhost:5173')}/payments`;
    const returnUrl = `${returnUrlBase}?partial=${payment.contract.contractNumber}`;

    const paymentPayload: Record<string, unknown> = {
      merchantId: await this.gateway.getMerchantId(),
      customerEmail: payment.contract.customer.email || 'noreply@bestchoice.com',
      referenceNo: orderRef,
      description:
        input.description ||
        `แบ่งชำระงวด ${payment.installmentNo} สัญญา ${payment.contract.contractNumber}`,
      amount: input.amount,
      paymentChannel: 'Qrcode',
      paymentGateway: 'Promptpay',
      currencyCode: '00',
      lang: 'TH',
      returnUrl,
      postbackUrl: `${this.apiBaseUrl}/api/paysolutions/webhook`,
      terminalId: await this.gateway.getTerminalId(),
      keyVersion: 1,
    };

    const { gatewayResponse, paymentUrl } = await this.gateway.createUiPayment(paymentPayload, {
      orderRef,
      buildErrorLog: (response, gr) =>
        `Pay Solutions partial-payment API error: ${response.status} ${JSON.stringify(gr)}`,
      errorMessagePrefix: 'ไม่สามารถสร้าง QR ได้',
      missingUrlMessage: 'ไม่ได้รับลิงก์ชำระเงิน',
      timeoutSentryKey: 'paysolutions-partial-timeout',
      timeoutSentryExtra: { paymentId: input.paymentId, amount: input.amount },
      timeoutMessage: 'ระบบชำระเงินใช้เวลานานเกินไป',
      genericErrorMessage: 'ไม่สามารถเชื่อมต่อระบบชำระเงินได้',
    });

    try {
      const link = await this.prisma.partialPaymentLink.create({
        data: {
          paymentId: input.paymentId,
          contractId: payment.contractId,
          customerId: payment.contract.customer.id,
          token: orderRef,
          amount: input.amount,
          metadata: { additionalLateFee: additionalLateFee.toFixed(2), requestedById: input.requestedById ?? null },
          gatewayRef: (gatewayResponse.refNo as string | undefined) ?? null,
          paymentUrl,
          status: 'ACTIVE',
          // 24h — generous window so customers can scan later in the day
          // (vs. the 30-min PaymentLink default for in-checkout flows).
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      this.logger.log(
        `Partial-payment QR created: ${orderRef} for payment ${input.paymentId}, amount ${input.amount}`,
      );

      let sentToLine = false;
      // ปลายทาง LINE การเงิน = แถว OTP ของลูกค้า (Task 22 I-1 ง) ไม่ใช่คอลัมน์ line_id_finance ที่อาจค้าง
      const lineId = financeLineRecipient(payment.contract.customer);
      if (lineId) {
        try {
          const totalInstallments = await this.prisma.payment.count({
            where: { contractId: payment.contractId, deletedAt: null },
          });
          const flex = buildPartialPaymentQRFlex({
            customerName: payment.contract.customer.name,
            contractNumber: payment.contract.contractNumber,
            installmentNo: payment.installmentNo,
            totalInstallments,
            fullAmount: Number(payment.amountDue),
            partialAmount: input.amount,
            paymentUrl,
            orderRef,
          });
          await this.lineOaService.pushMessage(lineId, [flex], 'line-finance');
          sentToLine = true;
          this.logger.log(
            `Partial-payment Flex pushed to LINE: payment=${input.paymentId} lineId=${lineId.slice(0, 8)}...`,
          );
        } catch (pushErr) {
          this.logger.error(`Partial-payment Flex push failed: ${pushErr}`);
          // swallow — the cashier can resend or fall back to manual record
        }
      }

      return { partialPaymentLinkId: link.id, paymentUrl, orderRef, sentToLine };
    } catch (dbError) {
      Sentry.captureException(dbError, {
        level: 'fatal',
        tags: { critical: 'paysolutions-partial-orphan', orderRef },
        extra: { paymentId: input.paymentId },
      });
      throw new InternalServerErrorException('ระบบบันทึกข้อมูลชำระเงินไม่สำเร็จ');
    }
  }

  /**
   * ปรับดิว (reschedule) QR — เงินไม่เข้า ดิวไม่เลื่อน (owner directive 2026-07-02).
   *
   * Mints a PromptPay QR for the collect amount (6a: ค่าธรรมเนียม + ค่าปรับ;
   * 6b: ค่าปรับเท่านั้น) and stores a PartialPaymentLink with purpose='RESCHEDULE'
   * carrying the frozen quote in metadata. The reschedule itself is NOT executed
   * here — the PaySolutions webhook routes a paid RESCHEDULE link through
   * PaymentsService.rescheduleWithCollect, which posts the collect JE + resets the
   * late fee + shifts due dates in one atom. Link expires in 24h via the existing
   * partial-payment-expire cron (expired → no money → no reschedule).
   *
   * Zero-collect (6b, no late fee) is rejected — the cashier should confirm
   * directly in the overlay; a 0-baht QR is meaningless.
   */
  async createRescheduleQR(input: {
    paymentId: string;
    daysToShift: number;
    splitMode: 'SINGLE' | 'SPLIT';
    requestedById: string;
  }): Promise<{
    partialPaymentLinkId: string;
    paymentUrl: string;
    orderRef: string;
    sentToLine: boolean;
    collectAmount: string;
    rescheduleFee: string;
    lateFee: string;
  }> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: input.paymentId },
      include: {
        contract: {
          include: {
            customer: {
              select: { id: true, email: true, name: true, ...FINANCE_LINE_RECIPIENT_SELECT },
            },
          },
        },
      },
    });
    if (!payment || payment.deletedAt) {
      throw new NotFoundException('ไม่พบรายการชำระ');
    }
    if (payment.status === 'PAID') {
      throw new BadRequestException('งวดนี้ชำระครบแล้ว — ไม่ต้องปรับดิว');
    }
    if (!input.daysToShift || input.daysToShift < 1) {
      throw new BadRequestException('กรุณาระบุจำนวนวันที่เลื่อนมากกว่า 0');
    }
    // 6b (SINGLE = จ่ายทั้งก้อนวันนี้, owner correction 2026-07-09) books the
    // installment through the payment orchestrator — the async QR webhook books
    // the frozen quote as a fee/late-fee collect JE only, which cannot carry the
    // installment portion (the JE would not balance). QR reschedule = 6a only.
    if (input.splitMode !== 'SPLIT') {
      throw new BadRequestException(
        'ปรับดิวผ่าน QR รองรับเฉพาะโหมดแบ่งชำระ (6a) — โหมดชำระทั้งก้อน (6b) ใช้เงินสด/โอน',
      );
    }

    // Server-authoritative quote — the SAME pure util the collect service uses.
    const lateFeeCfg = await loadLateFeeConfig(this.prisma);
    const quote = computeRescheduleQuote({
      monthlyPayment: payment.contract.monthlyPayment,
      daysToShift: input.daysToShift,
      splitMode: input.splitMode,
      payment,
      lateFeeCfg,
      now: new Date(),
    });
    if (quote.collectAmount.lte(0)) {
      throw new BadRequestException(
        'ไม่มียอดต้องเก็บ (6b + ไม่มีค่าปรับ) — ยืนยันปรับดิวได้โดยตรง ไม่ต้องส่ง QR',
      );
    }
    const collectNumber = quote.collectAmount.toDecimalPlaces(2).toNumber();

    // Single outstanding QR per installment — cancel any earlier active link
    // (both purposes: a stale partial-QR racing a reschedule-QR would double-charge).
    await this.prisma.partialPaymentLink.updateMany({
      where: { paymentId: input.paymentId, status: 'ACTIVE' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    const orderRef = String(Date.now()).slice(-12);
    const returnUrlBase =
      this.returnUrl || `${this.config.get('FRONTEND_URL', 'http://localhost:5173')}/payments`;
    const returnUrl = `${returnUrlBase}?reschedule=${payment.contract.contractNumber}`;

    const paymentPayload: Record<string, unknown> = {
      merchantId: await this.gateway.getMerchantId(),
      customerEmail: payment.contract.customer.email || 'noreply@bestchoice.com',
      referenceNo: orderRef,
      description: `ปรับดิวงวด ${payment.installmentNo} สัญญา ${payment.contract.contractNumber} (+${input.daysToShift} วัน)`,
      amount: collectNumber,
      paymentChannel: 'Qrcode',
      paymentGateway: 'Promptpay',
      currencyCode: '00',
      lang: 'TH',
      returnUrl,
      postbackUrl: `${this.apiBaseUrl}/api/paysolutions/webhook`,
      terminalId: await this.gateway.getTerminalId(),
      keyVersion: 1,
    };

    const { gatewayResponse, paymentUrl } = await this.gateway.createUiPayment(paymentPayload, {
      orderRef,
      buildErrorLog: (response, gr) =>
        `Pay Solutions reschedule-QR API error: ${response.status} ${JSON.stringify(gr)}`,
      errorMessagePrefix: 'ไม่สามารถสร้าง QR ได้',
      missingUrlMessage: 'ไม่ได้รับลิงก์ชำระเงิน',
      timeoutSentryKey: 'paysolutions-reschedule-timeout',
      timeoutSentryExtra: { paymentId: input.paymentId, amount: collectNumber },
      timeoutMessage: 'ระบบชำระเงินใช้เวลานานเกินไป',
      genericErrorMessage: 'ไม่สามารถเชื่อมต่อระบบชำระเงินได้',
    });

    try {
      const link = await this.prisma.partialPaymentLink.create({
        data: {
          paymentId: input.paymentId,
          contractId: payment.contractId,
          customerId: payment.contract.customer.id,
          token: orderRef,
          amount: collectNumber,
          gatewayRef: (gatewayResponse.refNo as string | undefined) ?? null,
          paymentUrl,
          status: 'ACTIVE',
          purpose: 'RESCHEDULE',
          metadata: {
            daysToShift: input.daysToShift,
            splitMode: input.splitMode,
            rescheduleFee: quote.rescheduleFee.toString(),
            lateFee: quote.lateFee.toString(),
            collectAmount: quote.collectAmount.toString(),
            requestedById: input.requestedById,
          },
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      this.logger.log(
        `Reschedule QR created: ${orderRef} for payment ${input.paymentId}, collect ${collectNumber} (+${input.daysToShift}d, ${quote.variant})`,
      );

      let sentToLine = false;
      // ปลายทาง LINE การเงิน = แถว OTP ของลูกค้า (Task 22 I-1 ง) ไม่ใช่คอลัมน์ line_id_finance ที่อาจค้าง
      const lineId = financeLineRecipient(payment.contract.customer);
      if (lineId) {
        try {
          const newDue = addBkkDays(payment.dueDate, input.daysToShift);
          const newDueDateText = newDue.toLocaleDateString('th-TH', {
            day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok',
          });
          const flex = buildRescheduleQRFlex({
            customerName: payment.contract.customer.name,
            contractNumber: payment.contract.contractNumber,
            installmentNo: payment.installmentNo,
            daysToShift: input.daysToShift,
            newDueDateText,
            rescheduleFee: quote.variant === '6a' ? quote.rescheduleFee.toNumber() : 0,
            lateFee: quote.lateFee.toNumber(),
            collectAmount: collectNumber,
            paymentUrl,
            orderRef,
          });
          await this.lineOaService.pushMessage(lineId, [flex], 'line-finance');
          sentToLine = true;
          this.logger.log(
            `Reschedule Flex pushed to LINE: payment=${input.paymentId} lineId=${lineId.slice(0, 8)}...`,
          );
        } catch (pushErr) {
          this.logger.error(`Reschedule Flex push failed: ${pushErr}`);
          // swallow — cashier can resend or collect cash/transfer instead
        }
      }

      return {
        partialPaymentLinkId: link.id,
        paymentUrl,
        orderRef,
        sentToLine,
        collectAmount: quote.collectAmount.toFixed(2),
        rescheduleFee: quote.rescheduleFee.toFixed(2),
        lateFee: quote.lateFee.toFixed(2),
      };
    } catch (dbError) {
      Sentry.captureException(dbError, {
        level: 'fatal',
        tags: { critical: 'paysolutions-reschedule-orphan', orderRef },
        extra: { paymentId: input.paymentId },
      });
      throw new InternalServerErrorException('ระบบบันทึกข้อมูลชำระเงินไม่สำเร็จ');
    }
  }

  /**
   * สร้าง payment intent สำหรับ saving plan (ออมดาวน์)
   * — เรียก PaySolutions API สร้าง PromptPay QR
   * — บันทึก PaymentLink พร้อม savingPlanId
   * — Webhook จะ confirmSavingPlanPayment เมื่อชำระสำเร็จ
   */
  async createSavingPlanIntent(input: {
    savingPlanId: string;
    amount: number;
    description: string;
  }): Promise<{ paymentLinkId: string; paymentUrl: string }> {
    const plan = await this.prisma.savingPlan.findUnique({
      where: { id: input.savingPlanId },
      include: { customer: { select: { email: true, name: true } } },
    });
    if (!plan) throw new NotFoundException('ไม่พบแผนออม');

    // Numeric-only ref (see createPaymentIntent for rationale).
    const orderRef = String(Date.now()).slice(-12);
    // เหตุผลเดียวกับ createOnlineOrderIntent — ปลายทางคือหน้าร้าน ไม่ใช่ LIFF สัญญา
    const shopBase = shopBaseUrl();
    const returnUrlBase = shopBase
      ? `${shopBase}/saving-plan`
      : `${this.config.get('FRONTEND_URL', 'http://localhost:5174')}/saving-plan`;
    const returnUrl = `${returnUrlBase}/${plan.id}`;

    const paymentPayload: Record<string, unknown> = {
      merchantId: await this.gateway.getMerchantId(),
      customerEmail: plan.customer.email || 'noreply@bestchoice.com',
      referenceNo: orderRef,
      description: input.description,
      amount: input.amount,
      paymentChannel: 'Qrcode',
      paymentGateway: 'Promptpay',
      currencyCode: '00',
      lang: 'TH',
      returnUrl,
      postbackUrl: `${this.apiBaseUrl}/api/paysolutions/webhook`,
      terminalId: await this.gateway.getTerminalId(),
      keyVersion: 1,
    };

    const { paymentUrl } = await this.gateway.createUiPayment(paymentPayload, {
      orderRef,
      buildErrorLog: (response, gr, parsed) =>
        `Pay Solutions saving-plan API error: HTTP ${response.status} statusCode=${parsed.statusCode} message="${parsed.message}" — ${JSON.stringify(gr)}`,
      errorMessagePrefix: 'ไม่สามารถสร้างรายการชำระเงินได้',
      missingUrlMessage: 'ไม่ได้รับลิงก์ชำระเงินจากระบบ',
      timeoutSentryKey: 'paysolutions-saving-plan-timeout',
      timeoutSentryExtra: { savingPlanId: input.savingPlanId, amount: input.amount },
      timeoutMessage: 'ระบบชำระเงินใช้เวลานานเกินไป กรุณาลองใหม่',
      genericErrorMessage: 'ไม่สามารถเชื่อมต่อระบบชำระเงินได้',
    });

    try {
      const paymentLink = await this.prisma.paymentLink.create({
        data: {
          token: orderRef,
          amount: input.amount,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          savingPlanId: input.savingPlanId,
        },
      });
      this.logger.log(
        `Saving-plan payment intent: ${orderRef} for plan ${input.savingPlanId}`,
      );
      return { paymentLinkId: paymentLink.id, paymentUrl };
    } catch (dbError) {
      Sentry.captureException(dbError, {
        level: 'fatal',
        tags: { critical: 'paysolutions-saving-plan-orphan', orderRef },
        extra: { savingPlanId: input.savingPlanId },
      });
      throw new InternalServerErrorException('ระบบบันทึกข้อมูลชำระเงินไม่สำเร็จ');
    }
  }
}
