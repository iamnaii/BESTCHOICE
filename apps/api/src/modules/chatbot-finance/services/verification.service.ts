import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { LineChannelType } from '@prisma/client';

const OTP_TTL_MS = 5 * 60 * 1000; // 5 นาที
const OTP_MAX_ATTEMPTS = 3;
const OTP_LENGTH = 6;
const OTP_REQUEST_COOLDOWN_MS = 60 * 1000; // 1 นาที

/**
 * Verification — DB-backed OTP store (works across multiple instances)
 *
 * Storage: ChatbotOtpRequest table — per-lineUserId record
 * Cleanup: cron every 10 minutes
 *
 * Security:
 *   - Same response shape for found/not-found phone (anti-enumeration)
 *   - Cooldown 60s per lineUserId
 *   - Max 3 attempts → blocks until expiry
 *   - SHA-256 hashed OTP, never stored plaintext
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  /**
   * Step 1: เริ่ม OTP flow
   *
   * IMPORTANT: ตอบ shape เดียวกันทั้ง found/not-found เพื่อกัน phone enumeration
   * - ถ้าเจอเบอร์ → ส่ง SMS จริง + return masked phone
   * - ถ้าไม่เจอ → return masked phone (จาก input) แต่ไม่ส่ง SMS
   */
  async requestOtp(params: { lineUserId: string; phone: string }): Promise<{
    maskedPhone: string;
    expiresInSeconds: number;
  }> {
    const phone = this.normalizePhone(params.phone);
    if (!phone) {
      throw new BadRequestException('เบอร์โทรไม่ถูกต้อง');
    }

    // Cooldown check (uses lineUserId — works for both found + not-found cases)
    const existing = await this.prisma.chatbotOtpRequest.findUnique({
      where: { lineUserId: params.lineUserId },
    });
    if (existing && Date.now() - existing.lastRequestAt.getTime() < OTP_REQUEST_COOLDOWN_MS) {
      const waitSeconds = Math.ceil(
        (OTP_REQUEST_COOLDOWN_MS - (Date.now() - existing.lastRequestAt.getTime())) / 1000,
      );
      throw new BadRequestException(`รบกวนรอ ${waitSeconds} วินาทีก่อนขอ OTP ใหม่`);
    }

    const customer = await this.prisma.customer.findFirst({
      where: { phone, deletedAt: null },
      select: { id: true, name: true, phone: true },
    });

    const responseShape = {
      maskedPhone: this.maskPhone(phone),
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    };

    if (!customer) {
      // ไม่ส่ง SMS แต่ตอบเหมือนเดิม (anti-enumeration)
      this.logger.log(`[Verify] OTP requested for unknown phone (silent)`);
      return responseShape;
    }

    // Generate OTP + persist
    const otp = this.generateOtp();
    const hash = this.hashOtp(otp);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

    await this.prisma.chatbotOtpRequest.upsert({
      where: { lineUserId: params.lineUserId },
      create: {
        lineUserId: params.lineUserId,
        customerId: customer.id,
        phone: customer.phone,
        hash,
        expiresAt,
        attempts: 0,
        lastRequestAt: now,
      },
      update: {
        customerId: customer.id,
        phone: customer.phone,
        hash,
        expiresAt,
        attempts: 0,
        lastRequestAt: now,
      },
    });

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
      // Cleanup record so user can retry immediately
      await this.prisma.chatbotOtpRequest.delete({
        where: { lineUserId: params.lineUserId },
      });
      throw new BadRequestException('ส่ง SMS ไม่สำเร็จ รบกวนลองใหม่');
    }

    return {
      maskedPhone: this.maskPhone(customer.phone),
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    };
  }

  /**
   * Step 2: ยืนยัน OTP + bind LINE userId กับ customer
   */
  async verifyOtp(params: {
    lineUserId: string;
    otp: string;
  }): Promise<{ customerId: string; customerName: string }> {
    const otpInput = params.otp.replace(/\D/g, '');
    if (otpInput.length !== OTP_LENGTH) {
      throw new BadRequestException(`รหัส OTP ต้องเป็นตัวเลข ${OTP_LENGTH} หลัก`);
    }

    const record = await this.prisma.chatbotOtpRequest.findUnique({
      where: { lineUserId: params.lineUserId },
    });

    if (!record) {
      throw new BadRequestException('กรุณาขอ OTP ใหม่');
    }

    if (record.expiresAt < new Date()) {
      await this.prisma.chatbotOtpRequest.delete({ where: { id: record.id } });
      throw new BadRequestException('OTP หมดอายุ กรุณาขอใหม่');
    }

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      await this.prisma.chatbotOtpRequest.delete({ where: { id: record.id } });
      throw new BadRequestException('ใส่ OTP ผิดเกินจำนวนครั้ง กรุณาขอใหม่');
    }

    if (this.hashOtp(otpInput) !== record.hash) {
      const updated = await this.prisma.chatbotOtpRequest.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      const remaining = OTP_MAX_ATTEMPTS - updated.attempts;
      throw new BadRequestException(
        remaining > 0 ? `OTP ไม่ถูกต้อง (เหลือ ${remaining} ครั้ง)` : 'ใส่ผิดเกินจำนวนครั้ง',
      );
    }

    // ✅ Verified — bind
    const customer = await this.prisma.customer.findUnique({
      where: { id: record.customerId },
      select: { id: true, name: true },
    });
    if (!customer) {
      await this.prisma.chatbotOtpRequest.delete({ where: { id: record.id } });
      throw new NotFoundException('ไม่พบข้อมูลลูกค้า');
    }

    await this.bind(params.lineUserId, customer.id);
    await this.prisma.chatbotOtpRequest.delete({ where: { id: record.id } });

    return { customerId: customer.id, customerName: customer.name };
  }

  /** เช็คว่า lineUserId นี้ verify แล้วหรือยัง */
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

  // ─── Cleanup cron ─────────────────────────────────────────

  @Cron(CronExpression.EVERY_10_MINUTES)
  async cleanupExpiredOtps(): Promise<void> {
    const result = await this.prisma.chatbotOtpRequest.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      this.logger.debug(`[Verify] Cleaned ${result.count} expired OTP(s)`);
    }
  }

  // ─── private ──────────────────────────────────────────────

  private async bind(lineUserId: string, customerId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.customerLineLink.upsert({
        where: {
          lineUserId_channel: { lineUserId, channel: LineChannelType.FINANCE },
        },
        create: { customerId, lineUserId, channel: LineChannelType.FINANCE },
        update: { customerId, unlinkedAt: null, linkedAt: new Date() },
      });

      await tx.chatSession.updateMany({
        where: { lineUserId, channel: 'LINE_FINANCE' },
        data: {
          customerId,
          verifiedAt: new Date(),
          verificationAttempts: 0,
        },
      });
    });
    this.logger.log(`[Verify] Bound ${lineUserId.slice(0, 8)}... → customer ${customerId.slice(0, 8)}...`);
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
