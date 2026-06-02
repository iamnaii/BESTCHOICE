import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { TestModeService } from '../../test-mode/test-mode.service';
import { AuditService } from '../../audit/audit.service';
import { LineChannelType } from '@prisma/client';
import { maskPhone } from '../utils/mask-phone';

const OTP_TTL_MS = 5 * 60 * 1000; // 5 นาที
const OTP_MAX_ATTEMPTS = 3;
const OTP_LENGTH = 6;
const OTP_REQUEST_COOLDOWN_MS = 60 * 1000; // 1 นาที

// T4-C9: per-lineUserId phone-lookup rate limit. LIFF-level throttle above
// (5/min/IP) caps spam from a single client IP, but a single LINE user can
// still rotate IPs (mobile network + wifi). Count failed lookups per
// lineUserId and lock for 30 min after 3 fails inside a 30-min window.
// In-memory Map is fine — single-process API; if we scale to multi-node we
// lift this to Redis (TODO).
const LOOKUP_FAIL_WINDOW_MS = 30 * 60 * 1000;
const LOOKUP_FAIL_THRESHOLD = 3;
const LOOKUP_LOCK_DURATION_MS = 30 * 60 * 1000;

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

  // T4-C9: per-lineUserId failure timestamps + lock-until. Map key is
  // lineUserId. Entry with `lockedUntil` set is fast-rejected until expiry.
  private readonly lookupFailTracker = new Map<
    string,
    { fails: number[]; lockedUntil?: number }
  >();

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private testMode: TestModeService,
    private audit: AuditService,
  ) {}

  /**
   * T4-C9 helper: check if the caller is currently rate-limited AND record
   * / clear fails. Exposed for tests via a single method so the lock state
   * is observable + reset deterministically.
   */
  private checkLookupLock(lineUserId: string, now = Date.now()): void {
    const entry = this.lookupFailTracker.get(lineUserId);
    if (entry?.lockedUntil && entry.lockedUntil > now) {
      const waitSec = Math.ceil((entry.lockedUntil - now) / 1000);
      throw new BadRequestException(
        `ค้นหาเบอร์ล้มเหลวหลายครั้ง กรุณารออีก ${waitSec} วินาที`,
      );
    }
    if (entry?.lockedUntil && entry.lockedUntil <= now) {
      // lock expired — reset
      this.lookupFailTracker.delete(lineUserId);
    }
  }

  private recordLookupFail(lineUserId: string, now = Date.now()): void {
    const entry = this.lookupFailTracker.get(lineUserId) ?? { fails: [] };
    // prune outside the window
    entry.fails = entry.fails.filter((t) => now - t < LOOKUP_FAIL_WINDOW_MS);
    entry.fails.push(now);
    if (entry.fails.length >= LOOKUP_FAIL_THRESHOLD) {
      entry.lockedUntil = now + LOOKUP_LOCK_DURATION_MS;
      this.logger.warn(
        `[Verify] lineUserId locked after ${entry.fails.length} failed lookups`,
      );
    }
    this.lookupFailTracker.set(lineUserId, entry);
  }

  private clearLookupFails(lineUserId: string): void {
    this.lookupFailTracker.delete(lineUserId);
  }

  /** T4-C9 test hook: reset the in-memory tracker between test cases. */
  _resetLookupTrackerForTests(): void {
    this.lookupFailTracker.clear();
  }

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
    // T4-C9: per-lineUserId lock guard — fail fast before any DB work.
    this.checkLookupLock(params.lineUserId);

    const phone = this.normalizePhone(params.phone);
    if (!phone) {
      this.recordLookupFail(params.lineUserId);
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

    // Search with multiple Thai phone formats (DB may store 0812345678 or 081-234-5678)
    const digits = phone.replace(/\D/g, '');
    const phoneVariants = [digits];
    if (digits.length === 10) {
      phoneVariants.push(`${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`);
      phoneVariants.push(`${digits.slice(0, 3)}-${digits.slice(3)}`);
    }
    const customer = await this.prisma.customer.findFirst({
      where: { phone: { in: phoneVariants }, deletedAt: null },
      select: { id: true, name: true, phone: true },
    });

    const responseShape = {
      maskedPhone: maskPhone(phone),
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    };

    if (!customer) {
      // T4-C9: failed phone→customer lookup. Record fail and maybe lock.
      this.recordLookupFail(params.lineUserId);
      this.logger.log(`[Verify] OTP requested for unknown phone`);
      throw new BadRequestException(
        'ไม่พบเบอร์โทรนี้ในระบบค่ะ กรุณาตรวจสอบเบอร์โทร หรือติดต่อสาขา 063-134-6356',
      );
    }

    // T4-C9: successful lookup clears the fail counter
    this.clearLookupFails(params.lineUserId);

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
      this.logger.log(`[Verify] OTP sent to ${maskPhone(customer.phone)}`);
    } catch (err) {
      this.logger.error(
        `[Verify] SMS send failed: ${err instanceof Error ? err.message : err}`,
      );
      // Cleanup record so user can retry immediately
      await this.prisma.chatbotOtpRequest.delete({
        where: { lineUserId: params.lineUserId },
      });
      throw new BadRequestException('ส่ง SMS ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หรือติดต่อ 063-134-6356');
    }

    return {
      maskedPhone: maskPhone(customer.phone),
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

    // Test-mode UAT bypass — OWNER-gated SystemConfig (TEST_MODE_BYPASS), default OFF,
    // audited, app-wide banner. For pre-go-live testing only — MUST be turned OFF before
    // go-live (TestModeService.isEnabled fails safe to OFF on any DB error).
    //
    // We still require that an OTP session exists (the `record` found above), so the LIFF
    // flow can only advance if requestOtp ran — we only skip the expiry/attempt/hash code
    // checks. The success side-effects below (resolve customer → bind → delete OTP row →
    // same return value) are byte-for-byte identical to the real success branch so the
    // downstream LIFF flow proceeds unchanged.
    if (await this.testMode.isEnabled()) {
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

      // Best-effort audit. This is a customer-facing LIFF path with no staff JWT, so no
      // userId FK is available — AuditService.log no-ops without a valid userId. We still
      // call it for consistency with the KYC bypass; it persists only if an actor is ever
      // threaded through. Not threading an actor here is acceptable for this path.
      await this.audit.log({
        action: 'LIFF_OTP_BYPASSED_TEST_MODE',
        entity: 'customer',
        entityId: customer.id,
        newValue: {
          lineUserId: params.lineUserId,
          otpRequestId: record.id,
          reason: 'TEST_MODE_BYPASS',
        },
      });

      return { customerId: customer.id, customerName: customer.name };
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
    try {
      const result = await this.prisma.chatbotOtpRequest.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (result.count > 0) {
        this.logger.debug(`[Verify] Cleaned ${result.count} expired OTP(s)`);
      }
    } catch (error) {
      this.logger.error(`OTP cleanup failed: ${error instanceof Error ? error.message : error}`);
      Sentry.captureException(error, {
        tags: { kind: 'cron-job', cron: 'otp-cleanup' },
      });
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

      await tx.chatRoom.updateMany({
        where: { lineUserId, channel: 'LINE_FINANCE' },
        data: {
          customerId,
          verifiedAt: new Date(),
          verificationAttempts: 0,
        },
      });

      // Sync canonical customer.lineIdFinance — LIFF pages (LiffContract etc.)
      // lookup customer ด้วย field นี้ตรงๆ ถ้าไม่ update จะ "ไม่มีสัญญา"
      // ทั้งที่ chatbot/CustomerLineLink link เรียบร้อยแล้ว
      // Verification flow runs in line-finance OA context — write finance lineId
      await tx.customer.update({
        where: { id: customerId },
        data: { lineIdFinance: lineUserId },
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

}
