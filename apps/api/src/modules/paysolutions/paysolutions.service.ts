import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

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
  private readonly apiUrl: string;
  private readonly returnUrl: string;
  private readonly webhookSecret: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.merchantId = this.config.get<string>('PAYSOLUTIONS_MERCHANT_ID', '');
    this.secretKey = this.config.get<string>('PAYSOLUTIONS_SECRET_KEY', '');
    this.apiUrl = this.config.get<string>(
      'PAYSOLUTIONS_API_URL',
      'https://api.paysolutions.asia',
    );
    this.returnUrl = this.config.get<string>('PAYSOLUTIONS_RETURN_URL', '');
    this.webhookSecret = this.config.get<string>('PAYSOLUTIONS_WEBHOOK_SECRET', '');
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

    // สร้าง unique order reference
    const orderRef = `BC-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

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

    // เรียก Pay Solutions API
    const customerName = contract.customer.name;
    const productDetail = description || `ชำระค่างวด สัญญา ${contract.contractNumber}`;

    const paymentPayload = {
      merchantid: this.merchantId,
      refno: orderRef,
      customeremail: contract.customer.email || 'noreply@bestchoice.com',
      productdetail: productDetail,
      total: amount.toFixed(2),
      lang: 'TH',
      postback_url: `${this.config.get('FRONTEND_URL', 'http://localhost:5173')}/api/paysolutions/webhook`,
      return_url: this.returnUrl || `${this.config.get('FRONTEND_URL', 'http://localhost:5173')}/liff/contract`,
      cc: '00', // Allow all payment methods
      customer_name: customerName,
      customer_phone: contract.customer.phone,
    };

    let gatewayResponse: Record<string, unknown>;
    let paymentUrl: string;
    let gatewayRef: string;

    try {
      const response = await fetch(`${this.apiUrl}/api/v2/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.secretKey}`,
        },
        body: JSON.stringify(paymentPayload),
      });

      gatewayResponse = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        this.logger.error(`Pay Solutions API error: ${JSON.stringify(gatewayResponse)}`);
        throw new InternalServerErrorException('ไม่สามารถสร้างรายการชำระเงินได้ กรุณาลองใหม่');
      }

      // Pay Solutions returns payment URL and reference
      paymentUrl = (gatewayResponse.payment_url as string) || (gatewayResponse.url as string) || '';
      gatewayRef = (gatewayResponse.refno as string) || orderRef;

      if (!paymentUrl) {
        this.logger.error(`Pay Solutions missing payment_url: ${JSON.stringify(gatewayResponse)}`);
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
   * ตรวจสอบ webhook signature จาก Pay Solutions
   * ใช้ HMAC-SHA256 กับ webhookSecret
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.webhookSecret) {
      this.logger.warn('PAYSOLUTIONS_WEBHOOK_SECRET not configured — skipping verification');
      return true; // ถ้าไม่ได้ config secret ให้ผ่าน (dev mode)
    }

    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex'),
    );
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
