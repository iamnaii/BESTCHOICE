import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { buildPaymentSuccessFlex } from '../line-oa/flex-messages/payment-success.flex';

export interface PaymentIntentResult {
  paymentId: string;
  paymentUrl: string;
  gatewayRef: string;
  qrCodeUrl?: string;
}

export interface PaymentStatusResult {
  paymentId: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
  gatewayRef?: string;
  gatewayStatus?: string;
  amount: number;
  paidAt?: Date;
}

@Injectable()
export class PaySolutionsService {
  private readonly logger = new Logger(PaySolutionsService.name);
  private readonly merchantId: string;
  private readonly secretKey: string;
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly returnUrl: string;
  private readonly apiBaseUrl: string;
  private readonly terminalId: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private lineOaService: LineOaService,
  ) {
    this.merchantId = this.config.get<string>('PAYSOLUTIONS_MERCHANT_ID', '');
    this.secretKey = this.config.get<string>('PAYSOLUTIONS_SECRET_KEY', '');
    this.apiKey = this.config.get<string>('PAYSOLUTIONS_API_KEY', '');
    this.apiUrl = this.config.get<string>(
      'PAYSOLUTIONS_API_URL',
      'https://apis.paysolutions.asia',
    );
    this.returnUrl = this.config.get<string>('PAYSOLUTIONS_RETURN_URL', '');
    this.apiBaseUrl = this.config.get<string>(
      'API_BASE_URL',
      'https://api.bestchoicephone.app',
    );
    this.terminalId = this.config.get<string>('PAYSOLUTIONS_TERMINAL_ID', 'TID00001');
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
  ): Promise<PaymentIntentResult> {
    // ตรวจสอบว่า contract มีอยู่จริง
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        customer: { select: { name: true, phone: true, email: true, lineId: true } },
      },
    });

    if (!contract || contract.deletedAt) {
      throw new NotFoundException('ไม่พบสัญญาที่ระบุ');
    }

    // ถ้าระบุ lineId ตรวจสอบว่า contract เป็นของ customer ที่ผูก LINE
    if (lineId) {
      if (contract.customer.lineId !== lineId) {
        throw new BadRequestException('สัญญานี้ไม่ตรงกับบัญชี LINE ของคุณ');
      }
    }

    // สร้าง unique reference (max 12 chars ตาม API spec)
    const orderRef = `BC${Date.now().toString(36).toUpperCase()}`.slice(0, 12);

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
    }

    // เรียก Pay Solutions API v2 (ตาม Web API Guideline v1.2.2)
    const returnUrlWithRef = `${this.returnUrl || `${this.config.get('FRONTEND_URL', 'http://localhost:5173')}/liff/contract`}?ref=${orderRef}`;

    const paymentPayload = {
      merchantId: this.merchantId,
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
      terminalId: this.terminalId,
      keyVersion: 1,
    };

    let gatewayResponse: Record<string, unknown>;
    let paymentUrl: string;
    let gatewayRef: string;

    try {
      const response = await fetch(
        `${this.apiUrl}/payment/gateway/v2/ui-payments`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'apiKey': this.apiKey,
            'secretKey': this.secretKey,
          },
          body: JSON.stringify(paymentPayload),
        },
      );

      gatewayResponse = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        const status = gatewayResponse.status as Record<string, string> | undefined;
        this.logger.error(
          `Pay Solutions API error: ${status?.statusCode} ${status?.message} — ${JSON.stringify(gatewayResponse)}`,
        );
        throw new InternalServerErrorException(
          `ไม่สามารถสร้างรายการชำระเงินได้: ${status?.message || 'กรุณาลองใหม่'}`,
        );
      }

      // Pay Solutions v2 response: { redirectUrl, transactionId, status }
      paymentUrl = (gatewayResponse.redirectUrl as string) || '';
      gatewayRef = (gatewayResponse.transactionId as string) || orderRef;

      if (!paymentUrl) {
        this.logger.error(`Pay Solutions missing redirectUrl: ${JSON.stringify(gatewayResponse)}`);
        throw new InternalServerErrorException('ไม่ได้รับลิงก์ชำระเงินจากระบบ');
      }
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      this.logger.error(`Pay Solutions API call failed: ${error}`);
      throw new InternalServerErrorException('ไม่สามารถเชื่อมต่อระบบชำระเงินได้ กรุณาลองใหม่');
    }

    // อัปเดต payment record ใน DB (ถ้ามี installmentNo)
    if (paymentRecord) {
      await this.prisma.payment.update({
        where: { id: paymentRecord.id },
        data: {
          gatewayRef,
          gatewayStatus: 'PENDING',
          gatewayResponse: gatewayResponse as object,
          paymentMethod: PaymentMethod.ONLINE_GATEWAY,
        },
      });
    }

    // สร้าง PaymentLink record สำหรับ tracking
    await this.prisma.paymentLink.create({
      data: {
        token: orderRef,
        contractId,
        paymentId: paymentRecord?.id || null,
        amount,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min expiry
      },
    });

    this.logger.log(
      `Payment intent created: ${orderRef} for contract ${contractId}, amount ${amount}`,
    );

    return {
      paymentId: paymentRecord?.id || orderRef,
      paymentUrl,
      gatewayRef,
    };
  }

  /**
   * ตรวจสอบ webhook callback จาก Pay Solutions
   * Pay Solutions ส่ง form POST กลับมาพร้อม merchantid — ตรวจว่าตรงกับ config
   */
  verifyWebhookMerchant(merchantid: string): boolean {
    if (!this.merchantId) {
      this.logger.warn('PAYSOLUTIONS_MERCHANT_ID not configured — skipping verification');
      return true;
    }

    const isValid = merchantid === this.merchantId;
    if (!isValid) {
      this.logger.warn(
        `Webhook merchantid mismatch: received=${merchantid}, expected=${this.merchantId}`,
      );
    }
    return isValid;
  }

  /**
   * จัดการ webhook callback จาก Pay Solutions
   * อัปเดตสถานะ payment ใน DB
   */
  async handlePaymentCallback(webhookData: Record<string, string>): Promise<void> {
    const { refno, result_code, order_no, transaction_id, total } = webhookData;

    this.logger.log(
      `Webhook received: refno=${refno}, result_code=${result_code}, order_no=${order_no}`,
    );

    // หา payment จาก gatewayRef หรือ PaymentLink token
    const paymentLink = await this.prisma.paymentLink.findFirst({
      where: { token: refno, status: 'ACTIVE' },
      include: { payment: true },
    });

    if (!paymentLink) {
      this.logger.warn(`Webhook for unknown refno: ${refno}`);
      return; // ไม่ throw — return 200 OK ให้ Pay Solutions
    }

    const isSuccess = result_code === '00';

    if (isSuccess) {
      // ชำระสำเร็จ
      await this.prisma.$transaction(async (tx) => {
        // อัปเดต PaymentLink
        await tx.paymentLink.update({
          where: { id: paymentLink.id },
          data: { status: 'USED', usedAt: new Date() },
        });

        // อัปเดต Payment record ถ้ามี
        if (paymentLink.paymentId) {
          await tx.payment.update({
            where: { id: paymentLink.paymentId },
            data: {
              status: 'PAID',
              amountPaid: total ? parseFloat(total) : paymentLink.amount,
              paidDate: new Date(),
              paidAt: new Date(),
              paymentMethod: PaymentMethod.ONLINE_GATEWAY,
              gatewayRef: refno,
              gatewayStatus: 'SUCCESS',
              gatewayResponse: webhookData as object,
              notes: `ชำระผ่าน Pay Solutions (${transaction_id || refno})`,
            },
          });
        }
      });

      this.logger.log(`Payment SUCCESS: refno=${refno}, contractId=${paymentLink.contractId}`);

      // ส่ง LINE notification แจ้งลูกค้า
      await this.sendPaymentSuccessNotification(paymentLink.contractId, paymentLink.paymentId);
    } else {
      // ชำระไม่สำเร็จ
      if (paymentLink.paymentId) {
        await this.prisma.payment.update({
          where: { id: paymentLink.paymentId },
          data: {
            gatewayStatus: 'FAILED',
            gatewayResponse: webhookData as object,
          },
        });
      }

      // Expire the link so customer can retry
      await this.prisma.paymentLink.update({
        where: { id: paymentLink.id },
        data: { status: 'EXPIRED' },
      });

      this.logger.log(`Payment FAILED: refno=${refno}, result_code=${result_code}`);
    }
  }

  /**
   * ส่ง LINE flex message แจ้งลูกค้าว่าชำระสำเร็จ
   */
  private async sendPaymentSuccessNotification(
    contractId: string,
    paymentId: string | null,
  ): Promise<void> {
    try {
      const contract = await this.prisma.contract.findUnique({
        where: { id: contractId },
        include: {
          customer: { select: { name: true, lineId: true } },
          payments: { orderBy: { installmentNo: 'asc' } },
        },
      });

      if (!contract?.customer.lineId) return;

      const payment = paymentId
        ? contract.payments.find((p) => p.id === paymentId)
        : null;

      if (!payment) return;

      const paidCount = contract.payments.filter((p) => p.status === 'PAID').length;

      const flex = buildPaymentSuccessFlex({
        customerName: contract.customer.name,
        contractNumber: contract.contractNumber,
        installmentNo: payment.installmentNo,
        totalInstallments: contract.payments.length,
        amountPaid: Number(payment.amountPaid),
        paymentMethod: 'ONLINE_GATEWAY',
        paidDate: new Date().toLocaleDateString('th-TH', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
        remainingInstallments: contract.payments.length - paidCount,
      });

      await this.lineOaService.sendFlexMessage(contract.customer.lineId, flex);
      this.logger.log(`LINE notification sent for contract ${contract.contractNumber}`);
    } catch (err) {
      // ไม่ให้ notification error ทำให้ webhook fail
      this.logger.error(`Failed to send LINE notification: ${err}`);
    }
  }

  /**
   * ดึงสถานะ payment สำหรับ frontend polling
   */
  async getPaymentStatus(paymentId: string): Promise<PaymentStatusResult> {
    // ลองหาจาก Payment ID ก่อน
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (payment) {
      return {
        paymentId: payment.id,
        status: payment.status === 'PAID' ? 'PAID' : payment.gatewayStatus === 'FAILED' ? 'FAILED' : 'PENDING',
        gatewayRef: payment.gatewayRef || undefined,
        gatewayStatus: payment.gatewayStatus || undefined,
        amount: Number(payment.amountDue),
        paidAt: payment.paidAt || undefined,
      };
    }

    // ลองหาจาก PaymentLink token (กรณี order reference)
    const link = await this.prisma.paymentLink.findFirst({
      where: { token: paymentId },
      include: { payment: true },
    });

    if (!link) {
      throw new NotFoundException('ไม่พบรายการชำระเงิน');
    }

    if (link.status === 'USED' && link.payment?.status === 'PAID') {
      return {
        paymentId: link.payment.id,
        status: 'PAID',
        gatewayRef: link.payment.gatewayRef || undefined,
        gatewayStatus: link.payment.gatewayStatus || undefined,
        amount: Number(link.amount),
        paidAt: link.payment.paidAt || undefined,
      };
    }

    if (link.status === 'EXPIRED') {
      return {
        paymentId: link.id,
        status: 'FAILED',
        amount: Number(link.amount),
      };
    }

    return {
      paymentId: link.id,
      status: 'PENDING',
      amount: Number(link.amount),
    };
  }
}
