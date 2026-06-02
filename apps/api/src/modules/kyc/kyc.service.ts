import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationCategory } from '../notifications/notification-category.enum';
import { TestModeService } from '../test-mode/test-mode.service';
import { AuditService } from '../audit/audit.service';
import * as crypto from 'crypto';

const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;
const MAX_OTP_SENDS_PER_HOUR = 3;

/** Actor context for audit trails (optional — controller threads it through). */
export interface KycActor {
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private testMode: TestModeService,
    private audit: AuditService,
  ) {}

  /**
   * Send KYC OTP to customer's phone via SMS.
   *
   * Historically supported LINE as a second channel, but LINE was removed on
   * 2026-04-23: OTP-via-LINE doesn't prove phone ownership (same device/session
   * that's already identified), which defeats the verification. SMS only.
   */
  async sendOtp(
    contractId: string,
    req: { ip?: string; userAgent?: string },
  ) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { customer: true },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    const customer = contract.customer;
    if (!customer) throw new NotFoundException('ไม่พบข้อมูลลูกค้า');

    if (!customer.phone) {
      throw new BadRequestException('ไม่พบเบอร์โทรลูกค้า');
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

    // Send OTP via notification service FIRST (before creating DB record).
    //
    // Test-mode UAT skip — OWNER-gated SystemConfig (TEST_MODE_BYPASS), default OFF,
    // fails safe to OFF on any DB error. When ON we skip the real SMS so UAT doesn't
    // cost money / bother real numbers, but we STILL fall through to the row create +
    // success return below — the verify-bypass precondition ("a pending OTP exists")
    // and the UI ref/countdown both depend on that row. MUST be OFF before go-live.
    const message = `[BESTCHOICE] รหัส OTP: ${otp} (Ref: ${refCode}) หมดอายุใน ${OTP_EXPIRY_MINUTES} นาที`;
    if (await this.testMode.isEnabled()) {
      this.logger.warn(
        `[TEST MODE] Skipping real OTP SMS send for contract ${contractId} (TEST_MODE_BYPASS ON)`,
      );
    } else {
      try {
        const result = await this.notificationsService.send({
          channel: 'SMS',
          recipient: customer.phone,
          message,
          relatedId: contractId,
          noRetry: true, // OTP expires in 10 min — retry queue would only spam
          customerId: customer.id,
          category: NotificationCategory.TRANSACTIONAL,
        });
        if (result.status === 'FAILED') {
          throw new InternalServerErrorException(
            result.errorMsg || 'Notification service returned FAILED status',
          );
        }
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to send OTP for contract ${contractId} via SMS: ${errMessage}`,
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
    }

    // OTP sent successfully (or skipped in test-mode) — now persist to database
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
        otpChannel: 'SMS',
        otpSentCount: 1,
        otpRefCode: refCode,
        ipAddress: req.ip || null,
        deviceInfo: req.userAgent || null,
        expiresAt,
      },
    });

    return {
      id: kyc.id,
      channel: 'SMS',
      phone: this.maskPhone(customer.phone),
      refCode,
      expiresAt,
      expiryMinutes: OTP_EXPIRY_MINUTES,
      message: `ส่ง OTP ไปยัง ${this.maskPhone(customer.phone)} แล้ว`,
    };
  }

  /**
   * Verify OTP entered by customer
   */
  async verifyOtp(contractId: string, otp: string, actor?: KycActor) {
    const kyc = await this.prisma.kycVerification.findFirst({
      where: { contractId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (!kyc) throw new BadRequestException('ไม่พบ OTP ที่รอยืนยัน กรุณาส่ง OTP ใหม่');

    // Test-mode UAT bypass — OWNER-gated SystemConfig (TEST_MODE_BYPASS), default OFF,
    // audited, app-wide banner. Intentionally overrides the prior always-validate stance
    // per owner decision for pre-go-live testing. MUST be turned OFF before go-live.
    //
    // We still require that an OTP session exists (the PENDING row found above), so the
    // contract flow can only advance if send-otp ran — we only skip the hash/expiry/
    // attempt checks. The success side-effects below are byte-for-byte identical to the
    // real success branch (mark the row OTP_VERIFIED + same return value) so the
    // downstream contract flow (uploadIdCard → VERIFIED) proceeds unchanged.
    if (await this.testMode.isEnabled()) {
      await this.prisma.kycVerification.update({
        where: { id: kyc.id },
        data: { otpVerifiedAt: new Date(), status: 'OTP_VERIFIED' },
      });

      // Best-effort audit (AuditService.log is a no-op without a valid userId FK,
      // so this only persists when an authenticated actor is threaded through).
      await this.audit.log({
        userId: actor?.userId,
        action: 'KYC_OTP_BYPASSED_TEST_MODE',
        entity: 'contract',
        entityId: contractId,
        newValue: { kycVerificationId: kyc.id, reason: 'TEST_MODE_BYPASS' },
        ipAddress: actor?.ipAddress,
        userAgent: actor?.userAgent,
      });

      return { verified: true, message: 'OTP ถูกต้อง' };
    }

    // OTP must always be validated via hash + expiry + attempt count,
    // even in non-production environments, to prevent accidental auth bypass
    // if NODE_ENV is mis-set in prod. (Exception: the OWNER-gated test-mode
    // bypass above — see comment there.)

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
