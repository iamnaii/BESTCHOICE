import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { TestModeService } from '../../test-mode/test-mode.service';
import { AuditService } from '../../audit/audit.service';
import { LineChannelType } from '@prisma/client';
import { maskPhone } from '../utils/mask-phone';
import { CustomerMergeService, SYSTEM_ACTOR } from '../../chat-prospects/customer-merge.service';
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { lineLinkedEntry } from '../../customer-journey/chat-identity-entries';
import { RichMenuService } from '../../line-oa/rich-menu/rich-menu.service';

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
 * แถว customer_line_links (FINANCE) unique ทั้ง (lineUserId) และ (customerId) — ผูกลูกค้ากับ LINE
 * ใหม่ได้เมื่อแถวเดิมของลูกค้าถูกปิดแล้วเท่านั้น (ยกเลิกผูกจากหน้าโปรไฟล์ของ LINE เดิม)
 */
export const CUSTOMER_LINKED_TO_OTHER_LINE_MESSAGE =
  'ลูกค้ารายนี้ผูกกับบัญชี LINE อื่นอยู่แล้ว — เปิดหน้า "โปรไฟล์ของฉัน" จากบัญชี LINE เดิมแล้วกด "ยกเลิกผูก LINE" ก่อน หรือติดต่อสาขา 063-134-6356';
export const LINE_LINK_NEEDS_STAFF_MESSAGE =
  'ผูกบัญชีไม่สำเร็จ — บัญชี LINE นี้เคยผูกกับลูกค้ารายอื่นไว้ กรุณาติดต่อสาขา 063-134-6356';

/** วิธีเขียนแถว customer_line_links ที่ตัดสินก่อนเริ่มผูก (ดู planLink) */
type LinkPlan = { kind: 'upsert-by-line' } | { kind: 'repoint-customer-row'; rowId: string };

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
    @Optional() private merge?: CustomerMergeService,
    // การเดินทางของลูกค้า — LINE_LINKED (ผูกซ้ำรีเซ็ต customer_line_links.linkedAt ประวัติรอบก่อนจึงหาย)
    @Optional() private journey?: JourneyEntryWriter,
    // สลับ rich menu FINANCE เป็นแบบ "ยืนยันแล้ว" หลังผูก — RichMenuService อยู่ใน LineOaModule ซึ่ง import
    // โมดูลนี้อยู่แล้ว จึงหยิบผ่าน ModuleRef (strict: false) ตอนใช้ แทนการ import โมดูลกลับเป็นวงจร
    // (precedent: ContractWorkflowService.resolveCreditApplier) · @Optional เพื่อ spec ที่ new service เอง
    @Optional() private moduleRef?: ModuleRef,
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

    if (!customer) {
      // T4-C9: failed phone→customer lookup. Record fail and maybe lock.
      this.recordLookupFail(params.lineUserId);
      this.logger.log(`[Verify] OTP requested for unknown phone`);
      throw new BadRequestException(
        'ไม่พบเบอร์โทรนี้ในระบบค่ะ กรุณาตรวจสอบเบอร์โทร หรือติดต่อสาขา 063-134-6356',
      );
    }

    // ค้นด้วยเบอร์เจอแถวนี้ แปลว่ามีเบอร์แน่ — กันชนิด null จาก schema (ผู้สนใจจากแชทไม่มีทางถูกค้นเจอทางนี้)
    const customerPhone = customer.phone;
    if (!customerPhone) {
      this.recordLookupFail(params.lineUserId);
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
        phone: customerPhone,
        hash,
        expiresAt,
        attempts: 0,
        lastRequestAt: now,
      },
      update: {
        customerId: customer.id,
        phone: customerPhone,
        hash,
        expiresAt,
        attempts: 0,
        lastRequestAt: now,
      },
    });

    // Test-mode UAT skip — OWNER-gated SystemConfig (TEST_MODE_BYPASS), default OFF,
    // fails safe to OFF on any DB error. When ON we skip the real SMS so UAT doesn't
    // cost money / bother real numbers. The OTP row was already upserted above, so the
    // verify-bypass precondition (a pending OTP session exists) + the UI countdown still
    // hold, and we fall through to the normal success return. MUST be OFF before go-live.
    if (await this.testMode.isEnabled()) {
      this.logger.warn(
        `[TEST MODE] Skipping real OTP SMS send for ${maskPhone(customerPhone)} (TEST_MODE_BYPASS ON)`,
      );
    } else {
      try {
        await this.notifications.sendSmsFromQueue(
          customerPhone,
          `BESTCHOICE: รหัส OTP ของคุณคือ ${otp} (ใช้ได้ใน 5 นาที)`,
        );
        this.logger.log(`[Verify] OTP sent to ${maskPhone(customerPhone)}`);
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
    }

    return {
      maskedPhone: maskPhone(customerPhone),
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

      await this.linkVerifiedLine(params.lineUserId, customer.id);
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

    await this.linkVerifiedLine(params.lineUserId, customer.id);
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

  /**
   * ผูก LINE การเงินกับลูกค้าหลังพิสูจน์การถือเบอร์ด้วย OTP แล้ว — ทางผูกทางเดียวของระบบ (Task 19:
   * `liff/register/lookup|confirm` ที่ผูกได้โดยไม่มี OTP ตอบ 410 แล้ว) จึงต้องทำผลข้างเคียงครบทุกอย่าง
   * ที่ทางเดิมเคยทำ: ดูดห้องผู้สนใจ → customer_line_links + chat_rooms + customers.line_id_finance (tx เดียว)
   * → LINE_LINKED หลัง commit → rich menu "ยืนยันแล้ว". ยืนยันจริงและ test-mode bypass ใช้ helper นี้ตัวเดียว
   *
   * planLink ตัดสินก่อน absorb — ถ้าการผูกจะถูกปฏิเสธ ห้องของ LINE นี้ต้องไม่ถูกย้ายไปหาลูกค้า
   */
  private async linkVerifiedLine(lineUserId: string, customerId: string): Promise<void> {
    const plan = await this.planLink(lineUserId, customerId);
    await this.absorbRoomsBeforeBind(lineUserId, customerId);
    await this.bind(lineUserId, customerId, plan);
    await this.switchToVerifiedRichMenu(lineUserId);
  }

  /**
   * customer_line_links (FINANCE) unique ทั้ง (lineUserId, channel) และ (customerId, channel):
   * - ลูกค้ายังไม่มีแถว หรือแถวของลูกค้าเป็นของ LINE นี้ → upsert ตาม lineUserId (สร้าง / เปิดแถวเดิมกลับ /
   *   ย้ายแถวของ LINE นี้จากลูกค้าเดิม — พฤติกรรมเดิมของ bind)
   * - ลูกค้ามีแถวของ LINE อื่นที่ยังผูกอยู่ → 409 (เดิมชน unique เป็น 500) — ทางเดิมก็ปฏิเสธเคสนี้
   * - แถวของ LINE อื่นถูกปิดแล้ว (ยกเลิกผูก) → ชี้แถวนั้นมาที่ LINE นี้ (เปลี่ยนบัญชี LINE หลังยกเลิกผูก)
   *   เว้นแต่ LINE นี้มีแถวของตัวเองอยู่แล้วด้วย (สองแถวรวมกันไม่ได้โดยไม่ลบแถว) → 409 ให้พนักงานดู
   */
  private async planLink(lineUserId: string, customerId: string): Promise<LinkPlan> {
    const customerRow = await this.prisma.customerLineLink.findUnique({
      where: { customerId_channel: { customerId, channel: LineChannelType.FINANCE } },
      select: { id: true, lineUserId: true, unlinkedAt: true, deletedAt: true },
    });
    if (!customerRow || customerRow.lineUserId === lineUserId) return { kind: 'upsert-by-line' };
    if (customerRow.unlinkedAt === null && customerRow.deletedAt === null) {
      throw new ConflictException(CUSTOMER_LINKED_TO_OTHER_LINE_MESSAGE);
    }
    const lineRow = await this.prisma.customerLineLink.findUnique({
      where: { lineUserId_channel: { lineUserId, channel: LineChannelType.FINANCE } },
      select: { id: true },
    });
    if (lineRow) throw new ConflictException(LINE_LINK_NEEDS_STAFF_MESSAGE);
    return { kind: 'repoint-customer-row', rowId: customerRow.id };
  }

  /** หา RichMenuService ของ LineOaModule ตอนใช้ — ไม่มี (spec ที่ new เอง / โมดูลถูกแยก) = null */
  private resolveRichMenu(): RichMenuService | null {
    if (!this.moduleRef) return null;
    try {
      return this.moduleRef.get(RichMenuService, { strict: false });
    } catch (err) {
      this.logger.warn(
        `[Verify] RichMenuService unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** best-effort เหมือนทางเดิม (liff/register/confirm) — ผูกสำเร็จแล้ว เมนูสลับไม่ได้ต้องไม่ทำให้ล้ม */
  private async switchToVerifiedRichMenu(lineUserId: string): Promise<void> {
    const richMenu = this.resolveRichMenu();
    if (!richMenu) return;
    try {
      await richMenu.switchRichMenu(lineUserId, true, 'finance');
    } catch (err) {
      this.logger.warn(
        `[Verify] switch rich menu for ${lineUserId.slice(0, 8)}... failed: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, { tags: { kind: 'rich-menu', flow: 'finance-verify' } });
    }
  }

  /**
   * Ruling R11 — bind() ด้านล่างนี้ re-point ห้อง LINE_FINANCE ทั้งหมดของ lineUserId ตรงๆ
   * ผ่าน tx.chatRoom.updateMany ของตัวเอง โดยไม่ผ่าน hook ของ Task 10 เลย (ChatRoomService.
   * linkRoomToCustomer เช็ค session.customerId !== linkStatus.customerId แต่พอถึงข้อความถัดไป
   * ค่าทั้งสองเท่ากันแล้วเพราะ bind() ตั้งไปแล้ว) — ถ้ามี placeholder ถือห้องเหล่านั้นอยู่ก่อน
   * ประวัติของ placeholder จะถูกตัดขาดเงียบ ๆ (ห้องเปลี่ยนเจ้าของตรง ไม่ผ่าน absorbPlaceholder เลย)
   * ต้อง absorb ก่อน bind() เสมอ ขณะที่ห้องยังชี้ placeholder เดิมอยู่ — รันนอก transaction ใดๆ
   * (ก่อน bind() เปิด tx ของมันเอง) best-effort: การยืนยัน OTP ต้องไม่มีวันถูกบล็อกเพราะ merge
   * ล้ม (เช่น placeholder มีเอกสารพ่วงแบบ Task 8's absorbPlaceholder 409) — ยังต้องเรียก bind()
   * ต่อเสมอไม่ว่า absorb จะสำเร็จหรือไม่
   */
  private async absorbRoomsBeforeBind(lineUserId: string, customerId: string): Promise<void> {
    try {
      await this.merge?.absorbRoomsOfLineUser(lineUserId, 'LINE_FINANCE', customerId, SYSTEM_ACTOR);
    } catch (err) {
      this.logger.warn(
        `[prospect] absorb rooms of ${lineUserId.slice(0, 8)}... → ${customerId.slice(0, 8)}...: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, {
        tags: { kind: 'chat-prospect' },
        extra: { lineUserId, customerId },
      });
    }
  }

  private async bind(lineUserId: string, customerId: string, plan: LinkPlan): Promise<void> {
    // LINE_LINKED นับเฉพาะการผูกที่เปลี่ยนจริง — ยืนยัน OTP ซ้ำกับลูกค้าคนเดิมที่ยังผูกอยู่ไม่ใช่เหตุการณ์ใหม่
    const previous = await this.prisma.customerLineLink.findUnique({
      where: { lineUserId_channel: { lineUserId, channel: LineChannelType.FINANCE } },
      select: { customerId: true, unlinkedAt: true, deletedAt: true },
    });
    const newlyLinked =
      !previous || previous.customerId !== customerId || previous.unlinkedAt !== null || previous.deletedAt !== null;
    const linkedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (plan.kind === 'repoint-customer-row') {
        await tx.customerLineLink.update({
          where: { id: plan.rowId },
          data: { lineUserId, unlinkedAt: null, deletedAt: null, linkedAt },
        });
      } else {
        await tx.customerLineLink.upsert({
          where: {
            lineUserId_channel: { lineUserId, channel: LineChannelType.FINANCE },
          },
          create: { customerId, lineUserId, channel: LineChannelType.FINANCE },
          update: { customerId, unlinkedAt: null, linkedAt },
        });
      }

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
    // LINE_LINKED หลัง commit เท่านั้น — ห้ามย้ายเข้า $transaction (writer ใช้ prisma ของตัวเอง) · ไม่เก็บ lineUserId
    if (newlyLinked) {
      await this.journey?.recordAfterCommit(
        lineLinkedEntry({ customerId, channel: 'FINANCE', via: 'VERIFICATION', occurredAt: linkedAt }),
      );
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

}
