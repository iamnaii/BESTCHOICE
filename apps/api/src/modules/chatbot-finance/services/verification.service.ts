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
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { bangkokCalendarParts, bangkokMidnight } from '../../../utils/date.util';
import { NotificationsService } from '../../notifications/notifications.service';
import { TestModeService } from '../../test-mode/test-mode.service';
import { AuditService } from '../../audit/audit.service';
import { LineChannelType, Prisma } from '@prisma/client';
import { maskPhone } from '../utils/mask-phone';
import { CustomerMergeService, SYSTEM_ACTOR } from '../../chat-prospects/customer-merge.service';
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { lineLinkedEntry } from '../../customer-journey/chat-identity-entries';
import { RichMenuService } from '../../line-oa/rich-menu/rich-menu.service';

const OTP_TTL_MS = 5 * 60 * 1000; // 5 นาที
const OTP_MAX_ATTEMPTS = 3;
const OTP_LENGTH = 6;
const OTP_REQUEST_COOLDOWN_MS = 60 * 1000; // 1 นาที

/**
 * Task 20 I1 + fix round 1 (I-B) — เพดานขอ OTP ต่อวัน (ปฏิทินไทย) สามชั้น:
 * - ต่อลูกค้า รวมทุกบัญชี LINE = 8 ⇒ เดารหัสของลูกค้าหนึ่งคนได้ ≤ 8 × 3 = 24 ครั้ง/วัน (≈ 2.7×10⁻⁵) · SMS ≤ 8/วัน
 * - ต่อ (ลูกค้า, LINE) = 2 กินก่อนเพดานลูกค้า ⇒ LINE หนึ่งบัญชีเผาเพดานของเจ้าของเบอร์ได้แค่ 2 — ผู้โจมตี 3 บัญชี
 *   เผาได้ 6 เจ้าของเบอร์ยังเหลือ 2 (ต้องใช้ ≥ 4 บัญชีถึงจะล็อกเจ้าของเบอร์ได้ทั้งวัน)
 * - ต่อ LINE ข้ามทุกเบอร์ (นับทั้งเบอร์จริงและ decoy) = 5 ⇒ ชะลอการไล่เบอร์/ไล่ล็อกหลายเหยื่อ
 */
export const OTP_DAILY_REQUESTS_PER_CUSTOMER = 8;
export const OTP_DAILY_REQUESTS_PER_CUSTOMER_LINE = 2;
export const OTP_DAILY_REQUESTS_PER_LINE = 5;
/**
 * แถวนับเพดานเก็บในตาราง `chatbot_otp_requests` เดิม (ไม่ต้อง migration) — คีย์ `line_user_id` ขึ้นต้นด้วย
 * `otp-quota:` (LINE user id จริงเป็น `U` + hex 32 ตัว ชนกันไม่ได้) · `attempts` = จำนวนครั้งที่ขอวันนี้ ·
 * `expires_at` = เที่ยงคืนไทยถัดไป ⇒ cron `cleanupExpiredOtps` ล้างให้เองเมื่อขึ้นวันใหม่
 *   ลูกค้า `otp-quota:customer:<customerId>` · ลูกค้า+LINE `otp-quota:customer:<customerId>:line:<lineUserId>` ·
 *   LINE `otp-quota:line:<lineUserId>`
 */
export const OTP_QUOTA_KEY_PREFIX = 'otp-quota:customer:';
export const OTP_LINE_QUOTA_KEY_PREFIX = 'otp-quota:line:';
/**
 * คีย์ advisory lock ต่อ LINE ของขั้นขอ OTP (cooldown atomic — I-B) · Task 21 R-2: ใช้ `pg_try_advisory_xact_lock`
 * — คำขอที่ซ้อนได้คำตอบ cooldown ทันที ไม่เข้าคิวถือ connection ของ pool
 */
export const OTP_REQUEST_LOCK_PREFIX = 'otp-request:';
/**
 * M1 — เวลาตอบขั้นต่ำของ requestOtp ที่สำเร็จ (ทั้งเบอร์จริงและ decoy) · SMS ไม่ถูก await จึงไม่ทำให้เวลาตอบต่างกัน
 * และค่านี้ให้เวลาส่ง SMS จบระหว่างที่ request ยังเปิดอยู่ (Cloud Run ลด CPU หลังตอบ)
 */
const OTP_RESPONSE_FLOOR_MS = 1000;
/** แถว OTP ที่ไม่ผูกลูกค้า (เบอร์ไม่พบ / เกินเพดาน) — ตอบเหมือนจริงทุกอย่าง แต่ไม่มีรหัสที่ใช้ได้ */
const DECOY_CUSTOMER_ID = '';

/**
 * รหัสที่ออกในขั้นขอ OTP (หลัง commit จึงส่ง SMS) — quotaKeys = แถวนับที่ต้องคืนถ้าส่ง SMS ไม่สำเร็จ ·
 * attemptsAtIssue = attempts ของแถวหลังเขียนรหัสนี้ (Task 21 R-1: คืนโควตาเฉพาะเมื่อยังไม่มีใครเดารหัสนี้)
 */
type IssuedOtp = {
  otp: string;
  hash: string;
  phone: string;
  quotaKeys: string[];
  attemptsAtIssue: number;
};

// T4-C9: per-lineUserId lock — เดิมนับ "เบอร์ไม่พบ" ซึ่งกลายเป็น oracle ว่าเบอร์ไหนเป็นลูกค้า (M4)
// ตอนนี้นับเฉพาะเบอร์ผิดรูปแบบ (ไม่บอกอะไรเกี่ยวกับลูกค้า) · lock 30 นาทีหลังผิด 3 ครั้งใน 30 นาที
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
 *   - Same response for found/not-found phone (anti-enumeration, M4) — ไม่พบ = แถว decoy ไม่ส่ง SMS ·
 *     SMS ไม่ถูก await + เวลาตอบขั้นต่ำคงที่ (M1)
 *   - Cooldown 60s per lineUserId — atomic: อ่าน→ตรวจ→เขียนใต้ advisory lock ต่อ LINE (I-B)
 *   - Max 3 attempts per window (5 นาที) — กินแบบ atomic ก่อนเทียบรหัส · ขอใหม่ในช่วงเดิมไม่รีเซ็ต ·
 *     ผิดครบแล้วล็อกจนหมดช่วง (Task 20 I1)
 *   - เพดานต่อวันใน DB: ต่อ LINE · ต่อ (ลูกค้า, LINE) · ต่อลูกค้า — ส่ง SMS ไม่สำเร็จคืนโควตา
 *   - SHA-256 hashed OTP, never stored plaintext
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  // T4-C9: per-lineUserId failure timestamps + lock-until. Map key is
  // lineUserId. Entry with `lockedUntil` set is fast-rejected until expiry.
  private readonly lookupFailTracker = new Map<string, { fails: number[]; lockedUntil?: number }>();

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
      throw new BadRequestException(`ค้นหาเบอร์ล้มเหลวหลายครั้ง กรุณารออีก ${waitSec} วินาที`);
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
      this.logger.warn(`[Verify] lineUserId locked after ${entry.fails.length} failed lookups`);
    }
    this.lookupFailTracker.set(lineUserId, entry);
  }

  /** T4-C9 test hook: reset the in-memory tracker between test cases. */
  _resetLookupTrackerForTests(): void {
    this.lookupFailTracker.clear();
  }

  private responseFloorMs = OTP_RESPONSE_FLOOR_MS;

  /** M1 test hook: เวลาตอบขั้นต่ำ (สเปคส่วนใหญ่ตั้ง 0 · สเปคของ M1 ตั้งค่าสั้น ๆ) */
  _setResponseFloorForTests(ms: number): void {
    this.responseFloorMs = ms;
  }

  /**
   * Step 1: เริ่ม OTP flow
   *
   * IMPORTANT (M4): ตอบเหมือนกันทุกไบต์ทั้งเจอ/ไม่เจอเบอร์ — กัน phone enumeration
   * - เจอลูกค้า + ยังไม่ถึงเพดานวันนี้ → ส่ง SMS จริง
   * - ไม่เจอ / ไม่มีเบอร์ / ถึงเพดานแล้ว → เขียนแถว decoy (ไม่มีรหัสที่ใช้ได้) ไม่ส่ง SMS
   * maskedPhone มาจากเบอร์ที่ผู้ใช้กรอก (normalize แล้ว) เสมอ — ไม่ใช่รูปแบบเบอร์ใน DB
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

    const startedAt = Date.now();
    const response = {
      maskedPhone: maskPhone(phone),
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    };
    // Test-mode UAT skip — OWNER-gated SystemConfig (TEST_MODE_BYPASS) + env gate (Task 20 I2),
    // default OFF, fails safe to OFF on any DB error. When ON we skip the real SMS (and the daily
    // quotas, which only exist to bound guesses/SMS) so UAT doesn't cost money / bother real numbers.
    // The OTP row is still written, so the verify-bypass precondition (a pending OTP session exists)
    // + the UI countdown still hold. MUST be OFF before go-live.
    const testMode = await this.testMode.isEnabled();

    // I-B: อ่านแถว → cooldown → เพดาน → เขียนแถว ใต้ advisory lock ต่อ LINE ในทรานแซกชันเดียว
    // (เดิมอ่าน/เขียนแยกกัน ⇒ LINE เดียวยิงขนาน 5 คำขอผ่าน cooldown หมด แล้วเผาเพดานของเจ้าของเบอร์)
    const issued = await this.withOtpRequestLock(params.lineUserId, (tx) =>
      this.issueOtpLocked(tx, params.lineUserId, phone, testMode, new Date()),
    );

    if (issued && testMode) {
      this.logger.warn(
        `[TEST MODE] Skipping real OTP SMS send for ${maskPhone(issued.phone)} (TEST_MODE_BYPASS ON)`,
      );
    } else if (issued) {
      // M1: ไม่ await ผลส่ง — เวลาตอบไม่บอกว่าเบอร์มีจริงไหม · ล้ม = log + Sentry + ทิ้งรหัส + คืนโควตา
      this.dispatchOtpSms(params.lineUserId, issued);
    }
    await this.waitForResponseFloor(startedAt);
    return response;
  }

  /**
   * ขั้นขอ OTP ภายใต้ล็อกของ LINE นี้ — คืนรหัสที่ต้องส่ง SMS หรือ null (แถว decoy: ไม่พบเบอร์ / เกินเพดาน)
   * M4: ทุกทางที่ไม่ throw ให้คำตอบเดียวกัน · cooldown/ล็อกใช้แถวของ lineUserId ซึ่งแถว decoy ก็นับ
   */
  private async issueOtpLocked(
    tx: Prisma.TransactionClient,
    lineUserId: string,
    phone: string,
    testMode: boolean,
    now: Date,
  ): Promise<IssuedOtp | null> {
    const existing = await tx.chatbotOtpRequest.findUnique({ where: { lineUserId } });
    if (existing && now.getTime() - existing.lastRequestAt.getTime() < OTP_REQUEST_COOLDOWN_MS) {
      throw new BadRequestException(
        this.cooldownMessage(
          OTP_REQUEST_COOLDOWN_MS - (now.getTime() - existing.lastRequestAt.getTime()),
        ),
      );
    }
    // I1: ผิดครบแล้วในช่วงเดิม → ขอรหัสใหม่ไม่ได้จนหมดช่วง (เดิม upsert รีเซ็ต attempts เป็น 0 ทุกครั้ง)
    if (existing && existing.expiresAt > now && existing.attempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException(this.lockedOutMessage(existing.expiresAt, now));
    }
    const decoy = async (): Promise<null> => {
      await this.writeOtpRow(tx, lineUserId, existing, now, {
        customerId: DECOY_CUSTOMER_ID,
        phone,
        hash: this.decoyHash(),
      });
      return null;
    };

    // I-B: เพดานต่อ LINE ข้ามทุกเบอร์ (นับก่อนค้นเบอร์ ⇒ เบอร์จริงและ decoy นับเท่ากัน)
    const lineKey = `${OTP_LINE_QUOTA_KEY_PREFIX}${lineUserId}`;
    if (
      !testMode &&
      !(await this.consumeDailyQuota(
        tx,
        lineKey,
        DECOY_CUSTOMER_ID,
        OTP_DAILY_REQUESTS_PER_LINE,
        now,
      ))
    ) {
      this.reportQuotaHit('line', lineUserId);
      return decoy();
    }

    // Search with multiple Thai phone formats (DB may store 0812345678 or 081-234-5678)
    const digits = phone.replace(/\D/g, '');
    const phoneVariants = [digits];
    if (digits.length === 10) {
      phoneVariants.push(`${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`);
      phoneVariants.push(`${digits.slice(0, 3)}-${digits.slice(3)}`);
    }
    const customer = await tx.customer.findFirst({
      where: { phone: { in: phoneVariants }, deletedAt: null },
      select: { id: true, name: true, phone: true },
    });

    // ค้นเจอด้วยเบอร์ แปลว่ามีเบอร์ — กันชนิด null จาก schema (ผู้สนใจจากแชทไม่มีทางถูกค้นเจอทางนี้)
    const customerPhone = customer?.phone;
    if (!customer || !customerPhone) {
      // M4: ไม่บันทึก "ค้นไม่เจอ" ใน lock (lock จะกลายเป็น oracle) — ตอบเหมือนเจอทุกอย่าง
      this.logger.log(`[Verify] OTP requested for unknown phone (decoy)`);
      return decoy();
    }

    const quotaKeys: string[] = [];
    if (!testMode) {
      // เพดานย่อย (ลูกค้า, LINE) กินก่อนเพดานลูกค้า — LINE เดียวเผาโควตาของเจ้าของเบอร์ได้ไม่เกิน 2
      const customerLineKey = `${OTP_QUOTA_KEY_PREFIX}${customer.id}:line:${lineUserId}`;
      const customerKey = `${OTP_QUOTA_KEY_PREFIX}${customer.id}`;
      // M4: เกินเพดานต้องตอบเหมือนสำเร็จ ไม่งั้นเป็น oracle ว่าเบอร์นี้เป็นลูกค้า — ไม่มีรหัส ไม่ส่ง SMS
      if (
        !(await this.consumeDailyQuota(
          tx,
          customerLineKey,
          customer.id,
          OTP_DAILY_REQUESTS_PER_CUSTOMER_LINE,
          now,
        ))
      ) {
        this.reportQuotaHit('customer-line', lineUserId, customer.id);
        return decoy();
      }
      quotaKeys.push(customerLineKey);
      if (
        !(await this.consumeDailyQuota(
          tx,
          customerKey,
          customer.id,
          OTP_DAILY_REQUESTS_PER_CUSTOMER,
          now,
        ))
      ) {
        this.reportQuotaHit('customer', lineUserId, customer.id);
        return decoy();
      }
      quotaKeys.push(customerKey);
    }

    const otp = this.generateOtp();
    const hash = this.hashOtp(otp);
    const attemptsAtIssue = await this.writeOtpRow(tx, lineUserId, existing, now, {
      customerId: customer.id,
      phone: customerPhone,
      hash,
    });
    return { otp, hash, phone: customerPhone, quotaKeys, attemptsAtIssue };
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

    // Test-mode UAT bypass — OWNER-gated SystemConfig (TEST_MODE_BYPASS), default OFF,
    // audited, app-wide banner. For pre-go-live testing only — MUST be turned OFF before
    // go-live (TestModeService.isEnabled fails safe to OFF on any DB error).
    //
    // We still require that an OTP session exists (the `record` below), so the LIFF
    // flow can only advance if requestOtp ran — we only skip the expiry/attempt/hash code
    // checks. The success side-effects below (resolve customer → bind → delete OTP row →
    // same return value) are byte-for-byte identical to the real success branch so the
    // downstream LIFF flow proceeds unchanged.
    if (await this.testMode.isEnabled()) {
      const record = await this.prisma.chatbotOtpRequest.findUnique({
        where: { lineUserId: params.lineUserId },
      });
      if (!record) {
        throw new BadRequestException('กรุณาขอ OTP ใหม่');
      }
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

    // I1: กิน attempt ก่อนเทียบรหัสด้วย UPDATE … WHERE attempts < max AND expires_at > now RETURNING
    // คำสั่งเดียว — คำขอขนานกี่ตัวก็ได้ไม่เกิน OTP_MAX_ATTEMPTS ครั้งต่อรหัส (เดิมอ่าน → เทียบ → increment
    // แยกกัน ⇒ ยิงขนานได้เกิน 3) · เทียบกับแถวที่ UPDATE คืนมา ไม่ใช่แถวที่อ่านไว้ก่อนหน้า
    const now = new Date();
    const [consumed] = await this.prisma.chatbotOtpRequest.updateManyAndReturn({
      where: {
        lineUserId: params.lineUserId,
        attempts: { lt: OTP_MAX_ATTEMPTS },
        expiresAt: { gt: now },
      },
      data: { attempts: { increment: 1 } },
    });
    if (!consumed) {
      // ไม่ได้ attempt — แยกเหตุจากแถวปัจจุบัน
      const current = await this.prisma.chatbotOtpRequest.findUnique({
        where: { lineUserId: params.lineUserId },
      });
      if (!current) throw new BadRequestException('กรุณาขอ OTP ใหม่');
      if (current.expiresAt <= now) {
        await this.prisma.chatbotOtpRequest.deleteMany({ where: { id: current.id } });
        throw new BadRequestException('OTP หมดอายุ กรุณาขอใหม่');
      }
      if (current.attempts >= OTP_MAX_ATTEMPTS) {
        // ผิดครบแล้ว — คงแถวไว้จนหมดช่วง (ลบ = ขอใหม่แล้วได้ attempts ใหม่ทันที)
        throw new BadRequestException(this.lockedOutMessage(current.expiresAt, now));
      }
      // แถวถูกเขียนใหม่ระหว่างคำสั่ง (ขอรหัสใหม่พร้อมกัน) — ให้ลองอีกครั้ง ไม่เทียบรหัสโดยไม่กิน attempt
      throw new BadRequestException('กรุณาลองใหม่อีกครั้ง');
    }

    if (!this.otpMatches(otpInput, consumed.hash)) {
      const remaining = OTP_MAX_ATTEMPTS - consumed.attempts;
      throw new BadRequestException(
        remaining > 0
          ? `OTP ไม่ถูกต้อง (เหลือ ${remaining} ครั้ง)`
          : this.lockedOutMessage(consumed.expiresAt, now),
      );
    }

    // ✅ Verified — bind
    const customer = await this.prisma.customer.findUnique({
      where: { id: consumed.customerId },
      select: { id: true, name: true },
    });
    if (!customer) {
      await this.prisma.chatbotOtpRequest.delete({ where: { id: consumed.id } });
      throw new NotFoundException('ไม่พบข้อมูลลูกค้า');
    }

    await this.linkVerifiedLine(params.lineUserId, customer.id);
    await this.prisma.chatbotOtpRequest.delete({ where: { id: consumed.id } });

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

  /**
   * Task 21 R-2: ลบเฉพาะแถวที่ล็อกได้ทันที (`FOR UPDATE SKIP LOCKED`) — แถวที่คำขอ OTP/เพดานกำลังถืออยู่ถูกข้าม
   * (รอบถัดไปใน 10 นาทีลบเอง) ⇒ cron ไม่รอล็อกแถวของใคร จึงไม่มีวงจร deadlock กับทรานแซกชันขอ OTP ช่วงข้ามเที่ยงคืน.
   * `expires_at` เป็น timestamp ไม่มี timezone (Prisma เก็บเวลา UTC) ⇒ เทียบกับ `now() AT TIME ZONE 'UTC'`
   * ไม่ขึ้นกับ timezone ของ session
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async cleanupExpiredOtps(): Promise<void> {
    try {
      const count = await this.prisma.$executeRaw`
        DELETE FROM chatbot_otp_requests
        WHERE id IN (
          SELECT id FROM chatbot_otp_requests
          WHERE expires_at < (now() AT TIME ZONE 'UTC')
          FOR UPDATE SKIP LOCKED
        )`;
      if (count > 0) {
        this.logger.debug(`[Verify] Cleaned ${count} expired OTP(s)`);
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
      !previous ||
      previous.customerId !== customerId ||
      previous.unlinkedAt !== null ||
      previous.deletedAt !== null;
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
    this.logger.log(
      `[Verify] Bound ${lineUserId.slice(0, 8)}... → customer ${customerId.slice(0, 8)}...`,
    );
    // LINE_LINKED หลัง commit เท่านั้น — ห้ามย้ายเข้า $transaction (writer ใช้ prisma ของตัวเอง) · ไม่เก็บ lineUserId
    if (newlyLinked) {
      await this.journey?.recordAfterCommit(
        lineLinkedEntry({
          customerId,
          channel: 'FINANCE',
          via: 'VERIFICATION',
          occurredAt: linkedAt,
        }),
      );
    }
  }

  // ─── Task 20 I1 / M4 helpers ──────────────────────────────

  /**
   * เขียนแถว OTP ของ lineUserId — ขอใหม่ในช่วงเดิม (แถวยังไม่หมดอายุ) **ไม่รีเซ็ต attempts** (ไม่ใส่ฟิลด์ใน
   * update ⇒ คงค่าใน DB แม้มี verify ขนานมา increment) · แถวหมดอายุแล้ว = ช่วงใหม่ เริ่ม 0 ·
   * คืน attempts ของแถวหลังเขียน (ค่าจริงจาก RETURNING — ไม่ใช่ค่าที่อ่านไว้ก่อนซึ่ง verify ขนานอาจเปลี่ยนไปแล้ว)
   */
  private async writeOtpRow(
    client: Prisma.TransactionClient,
    lineUserId: string,
    existing: { expiresAt: Date } | null,
    now: Date,
    data: { customerId: string; phone: string; hash: string },
  ): Promise<number> {
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
    const sameWindow = !!existing && existing.expiresAt > now;
    const row = await client.chatbotOtpRequest.upsert({
      where: { lineUserId },
      create: { lineUserId, ...data, expiresAt, attempts: 0, lastRequestAt: now },
      update: { ...data, expiresAt, lastRequestAt: now, ...(sameWindow ? {} : { attempts: 0 }) },
      select: { attempts: true },
    });
    return row.attempts;
  }

  /**
   * I-B: ขั้นขอ OTP ของ LINE เดียวกันทำทีละคำขอ — ล็อกเป็นคำสั่งแรกของทรานแซกชัน ⇒ อ่านแถว→cooldown→เพดาน→เขียนแถว
   * ไม่ซ้อนกัน · ปล่อยเองตอนทรานแซกชันจบ · ส่ง SMS หลัง commit.
   * Task 21 R-2: `pg_try_advisory_xact_lock` (ไม่รอ) — ล็อกไม่ได้ = มีคำขอของ LINE นี้กำลังออกรหัสอยู่ ⇒ ตอบ cooldown
   * ทันที (เดิม `pg_advisory_xact_lock` ให้คำขอซ้อนเข้าคิวถือ connection ของ pool ไว้ระหว่างรอ — pool prod = 10)
   */
  private withOtpRequestLock<T>(
    lineUserId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${OTP_REQUEST_LOCK_PREFIX + lineUserId})) AS locked`;
      if (!lock?.locked) {
        throw new BadRequestException(this.cooldownMessage(OTP_REQUEST_COOLDOWN_MS));
      }
      return fn(tx);
    });
  }

  private cooldownMessage(waitMs: number): string {
    return `รบกวนรอ ${Math.ceil(waitMs / 1000)} วินาทีก่อนขอ OTP ใหม่`;
  }

  /** M1: ส่ง SMS โดยไม่ให้ requestOtp รอผล — ล้มเมื่อไร handleSmsFailure เก็บกวาด (ไม่ throw ออกไป) */
  private dispatchOtpSms(lineUserId: string, issued: IssuedOtp): void {
    let sending: Promise<unknown>;
    try {
      sending = this.notifications.sendSmsFromQueue(
        issued.phone,
        `BESTCHOICE: รหัส OTP ของคุณคือ ${issued.otp} (ใช้ได้ใน 5 นาที)`,
      );
    } catch (err) {
      sending = Promise.reject(err);
    }
    void sending
      .then(
        () => this.logger.log(`[Verify] OTP sent to ${maskPhone(issued.phone)}`),
        (err: unknown) => this.handleSmsFailure(lineUserId, issued, err),
      )
      // Task 21 R-3: logger/Sentry ที่โยนเองต้องไม่กลายเป็น unhandled rejection (งานนี้ไม่มีใครรอ)
      .catch(() => undefined);
  }

  /**
   * ส่ง SMS ไม่สำเร็จ: log + Sentry · ทิ้งรหัสที่เพิ่งออก (เฉพาะแถวที่ยังถือ hash นี้) + ปลด cooldown ให้ขอใหม่ได้ทันที ·
   * คืนโควตาลูกค้า/(ลูกค้า, LINE) 1 ครั้ง — provider สะดุดต้องไม่เผาโควตาของลูกค้าจริง (ผู้โจมตีสั่งให้ล้มไม่ได้).
   * Task 21 R-1: คืนเฉพาะเมื่อรหัสนี้ **ยังไม่ถูกเดาเลย** (แถวยังถือ hash นี้และ attempts เท่าตอนออก — ตัดสินใน UPDATE
   * คำสั่งเดียวกับการทิ้งรหัส ⇒ verify ขนานแทรกไม่ได้) · ถูกเดาแล้ว = ทิ้งรหัสแต่ไม่คืน ⇒ เดาได้ ≤ 24 ครั้ง/ลูกค้า/วัน
   * จริงทุกกรณี แม้ provider ล่ม
   */
  private async handleSmsFailure(
    lineUserId: string,
    issued: IssuedOtp,
    err: unknown,
  ): Promise<void> {
    this.logger.error(`[Verify] SMS send failed: ${err instanceof Error ? err.message : err}`);
    Sentry.captureException(err, { tags: { kind: 'otp-sms', flow: 'finance-verify' } });
    try {
      const discard = { hash: this.decoyHash(), lastRequestAt: new Date(0) };
      const unguessed = await this.prisma.chatbotOtpRequest.updateMany({
        where: { lineUserId, hash: issued.hash, attempts: issued.attemptsAtIssue },
        data: discard,
      });
      if (unguessed.count !== 1) {
        // รหัสถูกเดาไปแล้ว (หรือถูกแทนด้วยรหัสใหม่) — ยังทิ้งรหัสนี้ถ้าแถวยังถืออยู่ แต่ไม่คืนโควตา
        await this.prisma.chatbotOtpRequest.updateMany({
          where: { lineUserId, hash: issued.hash },
          data: discard,
        });
        return;
      }
      for (const key of issued.quotaKeys) {
        await this.prisma.chatbotOtpRequest.updateMany({
          where: { lineUserId: key, attempts: { gt: 0 } },
          data: { attempts: { decrement: 1 } },
        });
      }
    } catch (cleanupErr) {
      this.logger.error(
        `[Verify] SMS failure cleanup failed: ${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`,
      );
      Sentry.captureException(cleanupErr, {
        tags: { kind: 'otp-sms-cleanup', flow: 'finance-verify' },
      });
    }
  }

  /** M1: คำตอบที่สำเร็จทุกทางรออย่างน้อย responseFloorMs นับจากเริ่ม — เบอร์จริง/decoy ใช้เวลาเท่ากัน */
  private async waitForResponseFloor(startedAt: number): Promise<void> {
    const remaining = startedAt + this.responseFloorMs - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }

  private reportQuotaHit(
    scope: 'line' | 'customer-line' | 'customer',
    lineUserId: string,
    customerId?: string,
  ): void {
    this.logger.warn(
      `[Verify] daily OTP quota (${scope}) reached — LINE ${lineUserId.slice(0, 8)}...`,
    );
    Sentry.captureMessage('[Verify] daily OTP request quota reached', {
      level: 'warning',
      tags: { kind: 'otp-quota', flow: 'finance-verify', scope },
      extra: { customerId, linePrefix: lineUserId.slice(0, 8) },
    });
  }

  /** ไม่ใช่ hex 64 ตัว ⇒ ไม่มีรหัส 6 หลักใดที่ sha256 แล้วตรง */
  private decoyHash(): string {
    return `decoy:${randomUUID()}`;
  }

  private otpMatches(otpInput: string, storedHash: string): boolean {
    const input = Buffer.from(this.hashOtp(otpInput));
    const stored = Buffer.from(storedHash);
    return input.length === stored.length && timingSafeEqual(input, stored);
  }

  private lockedOutMessage(expiresAt: Date, now: Date): string {
    const minutes = Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 60_000));
    return `ใส่ OTP ผิดครบ ${OTP_MAX_ATTEMPTS} ครั้งแล้ว — ขอรหัสใหม่ได้ในอีก ${minutes} นาที`;
  }

  /**
   * กินเพดานวันนี้ของแถวนับ `key` 1 ครั้ง — false = ครบ `limit` แล้ว. แถวนับอยู่ใน chatbot_otp_requests
   * ทุกคำสั่งเป็น statement เดียว: ลบแถวของวันก่อน → INSERT … ON CONFLICT DO NOTHING →
   * UPDATE … WHERE attempts < limit (increment แบบมีเงื่อนไข ⇒ คำขอขนานจากหลายบัญชี LINE ผ่านได้ไม่เกินเพดาน)
   */
  private async consumeDailyQuota(
    client: Prisma.TransactionClient,
    key: string,
    customerId: string,
    limit: number,
    now: Date,
  ): Promise<boolean> {
    const { year, month, day } = bangkokCalendarParts(now);
    const windowEnd = bangkokMidnight(year, month, day + 1);
    await client.chatbotOtpRequest.deleteMany({
      where: { lineUserId: key, expiresAt: { lte: now } },
    });
    await client.chatbotOtpRequest.createMany({
      data: [
        {
          lineUserId: key,
          customerId,
          phone: '',
          hash: '',
          expiresAt: windowEnd,
          attempts: 0,
          lastRequestAt: now,
        },
      ],
      skipDuplicates: true,
    });
    const { count } = await client.chatbotOtpRequest.updateMany({
      where: { lineUserId: key, attempts: { lt: limit } },
      data: { attempts: { increment: 1 }, lastRequestAt: now },
    });
    return count > 0;
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
