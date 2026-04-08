import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { LineChannelType, MessageRole, ChatSession } from '@prisma/client';

const OTP_TTL_MS = 5 * 60 * 1000; // 5 นาที
const OTP_MAX_ATTEMPTS = 3;
const OTP_LENGTH = 6;
const OTP_MARKER = '__OTP_HASH__:'; // marker ใน ChatMessage.text สำหรับ system records

export type VerifyState =
  | { kind: 'verified'; customerId: string; customerName: string }
  | { kind: 'awaiting_phone' }
  | { kind: 'awaiting_otp'; phone: string }
  | { kind: 'blocked' };

export interface VerifyResult {
  reply: string;
  newState: VerifyState;
  customerId?: string;
}

/**
 * Verification flow: phone → OTP → bind LINE userId กับ Customer
 *
 * State machine ใช้ DB เป็น source of truth (ไม่ใช่ in-memory)
 * เก็บใน ChatSession.verifiedAt + ChatMessage (role=SYSTEM) สำหรับ OTP records
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  /** ตรวจ state ปัจจุบันของ session */
  async getState(session: ChatSession): Promise<VerifyState> {
    if (session.verifiedAt && session.customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: session.customerId },
        select: { id: true, name: true },
      });
      if (customer) {
        return { kind: 'verified', customerId: customer.id, customerName: customer.name };
      }
    }

    if (session.verificationAttempts >= OTP_MAX_ATTEMPTS) {
      return { kind: 'blocked' };
    }

    // หา OTP record ที่ยัง active
    const otpRecord = await this.prisma.chatMessage.findFirst({
      where: {
        sessionId: session.id,
        role: MessageRole.SYSTEM,
        text: { startsWith: OTP_MARKER },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (otpRecord && otpRecord.text) {
      const parsed = this.parseOtpRecord(otpRecord.text);
      if (parsed && parsed.expiresAt > Date.now()) {
        return { kind: 'awaiting_otp', phone: parsed.phone };
      }
    }

    return { kind: 'awaiting_phone' };
  }

  /**
   * จัดการ message ตอน user ยังไม่ verified
   * Returns: { reply, newState } — orchestrator ใช้ reply ส่งกลับลูกค้า
   */
  async handleVerificationStep(
    session: ChatSession,
    state: VerifyState,
    text: string,
  ): Promise<VerifyResult> {
    if (state.kind === 'verified') {
      return { reply: '', newState: state, customerId: state.customerId };
    }

    if (state.kind === 'blocked') {
      return {
        reply:
          '❌ คุณยืนยันตัวตนผิดเกินจำนวนครั้งที่กำหนดค่ะ\nรบกวนติดต่อเจ้าหน้าที่ที่ 063-134-6356 นะคะ 🙏',
        newState: state,
      };
    }

    if (state.kind === 'awaiting_phone') {
      return this.handlePhoneInput(session, text);
    }

    // awaiting_otp
    return this.handleOtpInput(session, state.phone, text);
  }

  // ─── private handlers ─────────────────────────────────────

  private async handlePhoneInput(session: ChatSession, text: string): Promise<VerifyResult> {
    const phone = this.normalizePhone(text);
    if (!phone) {
      return {
        reply:
          'รบกวนพิมพ์เบอร์โทรที่ลงทะเบียนไว้กับ BESTCHOICE นะคะ 📱\n(เช่น 0891234567)',
        newState: { kind: 'awaiting_phone' },
      };
    }

    const customer = await this.prisma.customer.findFirst({
      where: { phone, deletedAt: null },
      select: { id: true, name: true, phone: true },
    });

    if (!customer) {
      return {
        reply:
          'ไม่พบเบอร์นี้ในระบบค่ะ 🙏\nรบกวนตรวจสอบเบอร์อีกครั้ง หรือติดต่อเจ้าหน้าที่ 063-134-6356',
        newState: { kind: 'awaiting_phone' },
      };
    }

    // สร้าง OTP + เก็บ hash + ส่ง SMS
    const otp = this.generateOtp();
    const hash = this.hashOtp(otp);
    const expiresAt = Date.now() + OTP_TTL_MS;

    await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: MessageRole.SYSTEM,
        text: `${OTP_MARKER}${customer.phone}|${hash}|${expiresAt}`,
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
    }

    return {
      reply:
        `ส่งรหัส OTP ไปที่เบอร์ ${this.maskPhone(customer.phone)} แล้วค่ะ ☎️\n` +
        `รบกวนพิมพ์รหัส 6 หลักที่ได้รับนะคะ\n` +
        `(หมดอายุภายใน 5 นาที)`,
      newState: { kind: 'awaiting_otp', phone: customer.phone },
    };
  }

  private async handleOtpInput(
    session: ChatSession,
    phone: string,
    text: string,
  ): Promise<VerifyResult> {
    const otpInput = text.replace(/\D/g, '');
    if (otpInput.length !== OTP_LENGTH) {
      return {
        reply: `รหัส OTP มี ${OTP_LENGTH} หลักนะคะ รบกวนพิมพ์ใหม่ค่ะ 🙏`,
        newState: { kind: 'awaiting_otp', phone },
      };
    }

    // หา OTP record ล่าสุด
    const record = await this.prisma.chatMessage.findFirst({
      where: {
        sessionId: session.id,
        role: MessageRole.SYSTEM,
        text: { startsWith: OTP_MARKER },
      },
      orderBy: { createdAt: 'desc' },
    });

    const parsed = record?.text ? this.parseOtpRecord(record.text) : null;
    if (!parsed || parsed.expiresAt < Date.now()) {
      return {
        reply: 'OTP หมดอายุแล้วค่ะ 🙏 รบกวนพิมพ์เบอร์โทรอีกครั้งเพื่อขอใหม่นะคะ',
        newState: { kind: 'awaiting_phone' },
      };
    }

    if (this.hashOtp(otpInput) !== parsed.hash) {
      // เพิ่ม attempt count
      const updated = await this.prisma.chatSession.update({
        where: { id: session.id },
        data: { verificationAttempts: { increment: 1 } },
      });
      const remaining = OTP_MAX_ATTEMPTS - updated.verificationAttempts;

      if (remaining <= 0) {
        return {
          reply:
            '❌ ใส่ OTP ผิดเกินจำนวนครั้งที่กำหนดค่ะ\nรบกวนติดต่อเจ้าหน้าที่ที่ 063-134-6356 นะคะ 🙏',
          newState: { kind: 'blocked' },
        };
      }
      return {
        reply: `OTP ไม่ถูกต้องค่ะ 🙏 ลองอีกครั้งนะคะ (เหลือ ${remaining} ครั้ง)`,
        newState: { kind: 'awaiting_otp', phone },
      };
    }

    // ✅ OTP ถูก — bind!
    const customer = await this.prisma.customer.findFirst({
      where: { phone, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!customer) {
      // ไม่ควรเกิด แต่ defensive
      return {
        reply: 'เกิดข้อผิดพลาด รบกวนติดต่อเจ้าหน้าที่ 063-134-6356 นะคะ 🙏',
        newState: { kind: 'awaiting_phone' },
      };
    }

    await this.bind(session, customer.id);

    return {
      reply: `✅ ยืนยันสำเร็จค่ะ คุณ${customer.name} 😊\nครั้งต่อไปไม่ต้องยืนยันแล้วนะคะ\n\nมีอะไรให้น้องเบสช่วยไหมคะ?`,
      newState: { kind: 'verified', customerId: customer.id, customerName: customer.name },
      customerId: customer.id,
    };
  }

  /** Bind LINE user → Customer (สร้าง CustomerLineLink + อัพเดต ChatSession) */
  private async bind(session: ChatSession, customerId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.chatSession.update({
        where: { id: session.id },
        data: {
          customerId,
          verifiedAt: new Date(),
          verificationAttempts: 0,
        },
      }),
      this.prisma.customerLineLink.upsert({
        where: {
          lineUserId_channel: {
            lineUserId: session.lineUserId,
            channel: LineChannelType.FINANCE,
          },
        },
        create: {
          customerId,
          lineUserId: session.lineUserId,
          channel: LineChannelType.FINANCE,
        },
        update: {
          customerId,
          unlinkedAt: null,
          linkedAt: new Date(),
        },
      }),
    ]);
    this.logger.log(`[Verify] Bound ${session.lineUserId} → customer ${customerId}`);
  }

  // ─── helpers ──────────────────────────────────────────────

  /** Normalize เบอร์ไทย: ตัด ‐, space, country code 66 → 10 หลักขึ้นต้นด้วย 0 */
  private normalizePhone(input: string): string | null {
    const digits = input.replace(/\D/g, '');
    if (digits.length === 10 && digits.startsWith('0')) return digits;
    if (digits.length === 11 && digits.startsWith('66')) return '0' + digits.slice(2);
    if (digits.length === 12 && digits.startsWith('660')) return '0' + digits.slice(3);
    return null;
  }

  private generateOtp(): string {
    // สุ่ม 6 หลัก ไม่มี leading zero (อ่านง่ายกว่า)
    return String(randomInt(100000, 1000000));
  }

  private hashOtp(otp: string): string {
    return createHash('sha256').update(otp).digest('hex');
  }

  private maskPhone(phone: string): string {
    if (phone.length < 7) return phone;
    return `${phone.slice(0, 3)}-***-${phone.slice(-4)}`;
  }

  private parseOtpRecord(text: string): {
    phone: string;
    hash: string;
    expiresAt: number;
  } | null {
    const payload = text.slice(OTP_MARKER.length);
    const [phone, hash, expiresStr] = payload.split('|');
    const expiresAt = Number(expiresStr);
    if (!phone || !hash || !expiresAt) return null;
    return { phone, hash, expiresAt };
  }
}
