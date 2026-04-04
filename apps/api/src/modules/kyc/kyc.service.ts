import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import * as crypto from 'crypto';

const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;
const MAX_OTP_SENDS_PER_HOUR = 3;

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Send OTP to customer's phone or LINE
   */
  async sendOtp(
    contractId: string,
    channel: string,
    req: { ip?: string; userAgent?: string },
  ) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { customer: true },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    const customer = contract.customer;
    if (!customer) throw new NotFoundException('ไม่พบข้อมูลลูกค้า');

    // Determine recipient
    const recipient = channel === 'LINE' ? customer.lineId : customer.phone;
    if (!recipient) {
      throw new BadRequestException(
        channel === 'LINE'
          ? 'ลูกค้ายังไม่ได้เชื่อมต่อ LINE'
          : 'ไม่พบเบอร์โทรลูกค้า',
      );
    }

    // Rate limit: max sends per hour per contract
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentSends = await this.prisma.kycVerification.count({
      where: {
        contractId,
        createdAt: { gte: oneHourAgo },
      },
    });
    if (recentSends >= MAX_OTP_SENDS_PER_HOUR) {
      throw new BadRequestException('ส่ง OTP เกินจำนวนที่กำหนด กรุณารอ 1 ชั่วโมง');
    }

    // Generate OTP + ref code
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const refCode = crypto.randomBytes(2).toString('hex').toUpperCase().slice(0, 4);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Send OTP via notification service FIRST (before creating DB record)
    const message = `[BESTCHOICE] รหัส OTP: ${otp} (Ref: ${refCode}) หมดอายุใน ${OTP_EXPIRY_MINUTES} นาที`;
    try {
      const result = await this.notificationsService.send({
        channel: channel as 'SMS' | 'LINE',
        recipient,
        message,
        relatedId: contractId,
        fallbackPhone: channel === 'LINE' ? customer.phone : undefined,
      });
      if (result.status === 'FAILED') {
        throw new InternalServerErrorException('Notification service returned FAILED status');
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to send OTP for contract ${contractId} via ${channel}: ${errMessage}`,
      );

      let userMessage = 'ไม่สามารถส่ง OTP ได้ กรุณาลองใหม่';
      if (errMessage.includes('credentials invalid') || errMessage.includes('401')) {
        userMessage = 'ระบบ SMS ขัดข้อง กรุณาติดต่อผู้ดูแลระบบ';
      } else if (errMessage.includes('number invalid') || errMessage.includes('Invalid phone')) {
        userMessage = 'เบอร์โทรศัพท์ไม่ถูกต้อง กรุณาตรวจสอบเบอร์โทร';
      } else if (errMessage.includes('credit') || errMessage.includes('insufficient')) {
        userMessage = 'ระบบ SMS ขัดข้อง กรุณาติดต่อผู้ดูแลระบบ';
      } else if (errMessage.includes('not configured')) {
        userMessage = 'ระบบ SMS ยังไม่ได้ตั้งค่า กรุณาติดต่อผู้ดูแลระบบ';
      }

      throw new BadRequestException(userMessage);
    }

    // OTP sent successfully — now persist to database
    // Expire any existing pending verifications for this contract
    await this.prisma.kycVerification.updateMany({
      where: { contractId, status: { in: ['PENDING', 'OTP_VERIFIED'] } },
      data: { status: 'EXPIRED' },
    });

    // Create new KYC record
    const kyc = await this.prisma.kycVerification.create({
      data: {
        contractId,
        customerId: customer.id,
        otpHash,
        otpPhone: customer.phone,
        otpChannel: channel,
        otpSentCount: 1,
        otpRefCode: refCode,
        ipAddress: req.ip || null,
        deviceInfo: req.userAgent || null,
        expiresAt,
      },
    });

    return {
      id: kyc.id,
      channel,
      phone: this.maskPhone(customer.phone),
      refCode,
      expiresAt,
      expiryMinutes: OTP_EXPIRY_MINUTES,
      message: `ส่ง OTP ไปยัง ${channel === 'LINE' ? 'LINE' : this.maskPhone(customer.phone)} แล้ว`,
    };
  }

  /**
   * Verify OTP entered by customer
   */
  async verifyOtp(contractId: string, otp: string) {
    const kyc = await this.prisma.kycVerification.findFirst({
      where: { contractId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (!kyc) throw new BadRequestException('ไม่พบ OTP ที่รอยืนยัน กรุณาส่ง OTP ใหม่');

    // Dev mode: accept any OTP code
    if (process.env.NODE_ENV !== 'production') {
      this.logger.warn(`[KYC-DEV] Auto-accepting OTP for contract ${contractId}`);
      await this.prisma.kycVerification.update({
        where: { id: kyc.id },
        data: { otpVerifiedAt: new Date(), status: 'OTP_VERIFIED' },
      });
      return { verified: true, message: 'OTP ถูกต้อง (dev mode)' };
    }

    // Check expiry
    if (new Date() > kyc.expiresAt) {
      await this.prisma.kycVerification.update({
        where: { id: kyc.id },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestException('OTP หมดอายุแล้ว กรุณาส่ง OTP ใหม่');
    }

    // Check max attempts
    if (kyc.otpAttempts >= MAX_OTP_ATTEMPTS) {
      await this.prisma.kycVerification.update({
        where: { id: kyc.id },
        data: { status: 'FAILED' },
      });
      throw new BadRequestException('กรอก OTP ผิดเกินจำนวนที่กำหนด กรุณาส่ง OTP ใหม่');
    }

    // Verify OTP hash
    const inputHash = crypto.createHash('sha256').update(otp).digest('hex');
    if (inputHash !== kyc.otpHash) {
      await this.prisma.kycVerification.update({
        where: { id: kyc.id },
        data: { otpAttempts: kyc.otpAttempts + 1 },
      });
      const remaining = MAX_OTP_ATTEMPTS - kyc.otpAttempts - 1;
      throw new BadRequestException(`OTP ไม่ถูกต้อง (เหลืออีก ${remaining} ครั้ง)`);
    }

    // OTP verified
    await this.prisma.kycVerification.update({
      where: { id: kyc.id },
      data: { otpVerifiedAt: new Date(), status: 'OTP_VERIFIED' },
    });

    return { verified: true, message: 'OTP ถูกต้อง' };
  }

  /**
   * Upload ID card photo for verification
   */
  async uploadIdCard(
    contractId: string,
    imageBase64: string,
    req: { ip?: string; userAgent?: string },
  ) {
    const kyc = await this.prisma.kycVerification.findFirst({
      where: { contractId, status: 'OTP_VERIFIED' },
      orderBy: { createdAt: 'desc' },
    });
    if (!kyc) throw new BadRequestException('กรุณายืนยัน OTP ก่อนถ่ายรูปบัตรประชาชน');

    // Validate base64 image
    if (!imageBase64.startsWith('data:image/')) {
      throw new BadRequestException('รูปภาพไม่ถูกต้อง');
    }

    // Check size (rough estimate: base64 is ~33% larger than binary)
    const sizeBytes = (imageBase64.length * 3) / 4;
    if (sizeBytes > 5 * 1024 * 1024) {
      throw new BadRequestException('รูปภาพใหญ่เกิน 5MB');
    }

    // For now, store as data URL reference. When StorageService (S3) is added in Part 3,
    // this will be replaced with actual S3 upload.
    const idCardImageUrl = `kyc/${contractId}/id-card-${Date.now()}.jpg`;

    // Mark KYC as fully verified
    await this.prisma.kycVerification.update({
      where: { id: kyc.id },
      data: {
        idCardImageUrl,
        idCardVerified: true,
        status: 'VERIFIED',
        deviceInfo: req.userAgent || kyc.deviceInfo,
      },
    });

    return {
      verified: true,
      status: 'VERIFIED',
      message: 'ยืนยันตัวตนสำเร็จ',
    };
  }

  /**
   * Get KYC verification status for a contract
   */
  async getStatus(contractId: string) {
    const kyc = await this.prisma.kycVerification.findFirst({
      where: {
        contractId,
        status: { in: ['PENDING', 'OTP_VERIFIED', 'VERIFIED'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!kyc) {
      return {
        status: 'NOT_STARTED',
        otpVerified: false,
        idCardUploaded: false,
      };
    }

    return {
      id: kyc.id,
      status: kyc.status,
      otpVerified: !!kyc.otpVerifiedAt,
      otpChannel: kyc.otpChannel,
      otpPhone: this.maskPhone(kyc.otpPhone),
      idCardUploaded: kyc.idCardVerified,
      expiresAt: kyc.expiresAt,
      createdAt: kyc.createdAt,
    };
  }

  private maskPhone(phone: string): string {
    if (phone.length < 4) return '***';
    return phone.slice(0, 3) + '-xxx-x' + phone.slice(-3);
  }
}
