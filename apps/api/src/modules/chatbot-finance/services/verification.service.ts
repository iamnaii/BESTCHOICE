import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { LineChannelType } from '@prisma/client';

const OTP_TTL_MS = 5 * 60 * 1000; // 5 นาที
const OTP_MAX_ATTEMPTS = 3;
const OTP_LENGTH = 6;
const OTP_REQUEST_COOLDOWN_MS = 60 * 1000; // 1 นาที — ขอใหม่ได้

interface OtpRecord {
  customerId: string;
  phone: string;
  hash: string;
  expiresAt: number;
  attempts: number;
  lastRequestAt: number;
}

/**
 * Verification (stateless) — เรียกได้จาก LIFF endpoints
 *
 * Storage: in-memory Map (single-instance OK; Phase E ค่อย migrate Redis)
 * Key: lineUserId — รับประกันว่า 1 LINE user 1 OTP active
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);
  private readonly otpStore = new Map<string, OtpRecord>();

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {
    // Cleanup expired OTPs every minute
    setInterval(() => this.cleanupExpired(), 60 * 1000).unref();
  }

  /**
   * Step 1: ค้นหา customer จากเบอร์ + ส่ง OTP ผ่าน SMS
   * Throws: NotFoundException ถ้าไม่พบเบอร์ในระบบ
   */
  async requestOtp(params: { lineUserId: string; phone: string }): Promise<{
    maskedPhone: string;
    expiresInSeconds: number;
  }> {
    const phone = this.normalizePhone(params.phone);
    if (!phone) {
      throw new BadRequestException('เบอร์โทรไม่ถูกต้อง');
    }

    // Cooldown ป้องกัน spam
    const existing = this.otpStore.get(params.lineUserId);
    if (existing && Date.now() - existing.lastRequestAt < OTP_REQUEST_COOLDOWN_MS) {
      const waitSeconds = Math.ceil(
        (OTP_REQUEST_COOLDOWN_MS - (Date.now() - existing.lastRequestAt)) / 1000,
      );
      throw new BadRequestException(`รบกวนรอ ${waitSeconds} วินาทีก่อนขอ OTP ใหม่`);
    }

    const customer = await this.prisma.customer.findFirst({
      where: { phone, deletedAt: null },
      select: { id: true, name: true, phone: true },
    });
    if (!customer) {
      throw new NotFoundException('ไม่พบเบอร์นี้ในระบบ รบกวนติดต่อเจ้าหน้าที่');
    }

    // Generate OTP
    const otp = this.generateOtp();
    const hash = this.hashOtp(otp);
    const now = Date.now();

    this.otpStore.set(params.lineUserId, {
      customerId: customer.id,
      phone: customer.phone,
      hash,
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      lastRequestAt: now,
    });

    // Send SMS (dev mode logs only)
    try {
      await this.notifications.sendSmsFromQueue(
        customer.phone,
        `BESTCHOICE: รหัส OTP ของคุณคือ ${otp} (ใช้ได้ใน 5 นาที)`,
      );
      this.logger.log(`[Verify] OTP sent to ${this.maskPhone(customer.phone)}`);
    } catch (err) {
      this.logger.error(
        `[Verify] SMS send failed: ${err instanceof Error ? err.message : err}`,
      );
      // ลบ OTP ออกถ้าส่งไม่ได้ — ลูกค้าจะ retry ได้ทันที
      this.otpStore.delete(params.lineUserId);
      throw new BadRequestException('ส่ง SMS ไม่สำเร็จ รบกวนลองใหม่');
    }

    return {
      maskedPhone: this.maskPhone(customer.phone),
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    };
  }

  /**
   * Step 2: ยืนยัน OTP + bind LINE userId กับ customer
   * Throws: BadRequestException หาก OTP ผิด/หมดอายุ/ลองเกิน
   */
  async verifyOtp(params: {
    lineUserId: string;
    otp: string;
  }): Promise<{ customerId: string; customerName: string }> {
    const otpInput = params.otp.replace(/\D/g, '');
    if (otpInput.length !== OTP_LENGTH) {
      throw new BadRequestException(`รหัส OTP ต้องเป็นตัวเลข ${OTP_LENGTH} หลัก`);
    }

    const record = this.otpStore.get(params.lineUserId);
    if (!record) {
      throw new BadRequestException('กรุณาขอ OTP ใหม่');
    }

    if (record.expiresAt < Date.now()) {
      this.otpStore.delete(params.lineUserId);
      throw new BadRequestException('OTP หมดอายุ กรุณาขอใหม่');
    }

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      this.otpStore.delete(params.lineUserId);
      throw new BadRequestException('ใส่ OTP ผิดเกินจำนวนครั้ง กรุณาขอใหม่');
    }

    if (this.hashOtp(otpInput) !== record.hash) {
      record.attempts += 1;
      const remaining = OTP_MAX_ATTEMPTS - record.attempts;
      throw new BadRequestException(
        remaining > 0 ? `OTP ไม่ถูกต้อง (เหลือ ${remaining} ครั้ง)` : 'ใส่ผิดเกินจำนวนครั้ง',
      );
    }

    // ✅ OTP ถูก — bind!
    const customer = await this.prisma.customer.findUnique({
      where: { id: record.customerId },
      select: { id: true, name: true },
    });
    if (!customer) {
      this.otpStore.delete(params.lineUserId);
      throw new NotFoundException('ไม่พบข้อมูลลูกค้า');
    }

    await this.bind(params.lineUserId, customer.id);
    this.otpStore.delete(params.lineUserId);

    return { customerId: customer.id, customerName: customer.name };
  }

  /** เช็คว่า lineUserId นี้ verify แล้วหรือยัง (ใช้ใน LIFF เพื่อกัน duplicate) */
  async isLinked(
    lineUserId: string,
  ): Promise<{ linked: boolean; customerId?: string; customerName?: string }> {
    const link = await this.prisma.customerLineLink.findUnique({
      where: {
        lineUserId_channel: { lineUserId, channel: LineChannelType.FINANCE },
      },
      include: {
        customer: { select: { id: true, name: true } },
      },
    });
    if (!link || link.unlinkedAt) return { linked: false };
    return {
      linked: true,
      customerId: link.customer.id,
      customerName: link.customer.name,
    };
  }

  // ─── private ──────────────────────────────────────────────

  /** สร้าง CustomerLineLink + อัพเดต ChatSession ที่อยู่ */
  private async bind(lineUserId: string, customerId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.customerLineLink.upsert({
        where: {
          lineUserId_channel: { lineUserId, channel: LineChannelType.FINANCE },
        },
        create: { customerId, lineUserId, channel: LineChannelType.FINANCE },
        update: { customerId, unlinkedAt: null, linkedAt: new Date() },
      });

      // ถ้ามี ChatSession อยู่แล้ว → update verifiedAt + customerId
      await tx.chatSession.updateMany({
        where: { lineUserId, channel: 'LINE_FINANCE' },
        data: {
          customerId,
          verifiedAt: new Date(),
          verificationAttempts: 0,
        },
      });
    });
    this.logger.log(`[Verify] Bound ${lineUserId} → customer ${customerId}`);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    let removed = 0;
    for (const [key, record] of this.otpStore.entries()) {
      if (record.expiresAt < now) {
        this.otpStore.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.logger.debug(`[Verify] Cleaned ${removed} expired OTP(s)`);
    }
  }

  /** Normalize เบอร์ไทย: 089-xxx-xxxx, 0891234567, 66891234567 → 0891234567 */
  private normalizePhone(input: string): string | null {
    const digits = input.replace(/\D/g, '');
    if (digits.length === 10 && digits.startsWith('0')) return digits;
    if (digits.length === 11 && digits.startsWith('66')) return '0' + digits.slice(2);
    if (digits.length === 12 && digits.startsWith('660')) return '0' + digits.slice(3);
    return null;
  }

  private generateOtp(): string {
    return String(randomInt(100000, 1000000));
  }

  private hashOtp(otp: string): string {
    return createHash('sha256').update(otp).digest('hex');
  }

  private maskPhone(phone: string): string {
    if (phone.length < 7) return phone;
    return `${phone.slice(0, 3)}-***-${phone.slice(-4)}`;
  }
}
