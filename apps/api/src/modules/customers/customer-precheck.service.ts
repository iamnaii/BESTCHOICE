import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerTierService } from './customer-tier.service';
import { CustomersService } from './customers.service';
import { TestModeService } from '../test-mode/test-mode.service';
import { AuditService } from '../audit/audit.service';
import { CreditCheckService } from '../credit-check/credit-check.service';
import type { CustomerTier } from './dto/tier.dto';
import type { CustomerPreCheckResponse, PreCheckDecision } from './dto/precheck.dto';
import type { UpdateCustomerDto } from './dto/customer.dto';
import { PLACEHOLDER_CUSTOMER_NAME } from './services/customer-write.service';

/** Actor context for audit trails (optional — controller threads it through). */
export interface PreCheckActor {
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

const PASS_THRESHOLD = 50;
const REVIEW_THRESHOLD = 40;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * สวิตช์ปิดการอ่าน statement ด้วย AI ตอน pre-check — **ไม่มีแถว = เปิด**
 *
 * มีไว้เพราะทุกครั้งที่ตรวจคือการเรียก Claude Vision (รูปสูงสุด 5 ใบ) = มีค่าใช้จ่ายจริง
 * ต่อการตรวจหนึ่งครั้ง เจ้าของปิดได้เองโดยไม่ต้อง deploy: ตั้งค่าเป็นสตริง `'false'`
 * ปิดแล้วระบบกลับไปพฤติกรรมเดิมเป๊ะ ๆ (ไม่มีคะแนน → ลูกค้าใหม่ได้ REVIEW)
 */
const AI_PRECHECK_ENABLED_KEY = 'credit_precheck_ai_enabled';

/**
 * เพดานเวลารอ AI — ลูกค้ายืนรออยู่ที่เคาน์เตอร์ เกินนี้ถือว่าไม่มีคะแนนแล้วตัดสินไปก่อน
 * (งานวิเคราะห์ที่ค้างอยู่ยังเขียน `aiScore` ลงแถวต่อไปเองสำหรับดูย้อนหลัง)
 */
const AI_TIMEOUT_MS = 25_000;

/**
 * decision → Customer.creditCheckStatus ที่ `runPreCheck` เขียนลงแถว.
 *
 * แหล่งเดียว — `abandonPreCheck` derive รายการสถานะที่ "ลบทิ้งได้" จากค่าของ map นี้
 * (`ABANDONABLE_STATUSES` ข้างล่าง) จึงแยกจากกันไม่ได้โดยโครงสร้าง. ก่อนหน้านี้ทั้งสอง
 * ฝั่งเขียนแยกกัน แล้ว abandon เช็คแค่ `UNDER_REVIEW` ตัวเดียว ⇒ decision PASS/FAIL
 * ลบแถว placeholder ไม่ออกเลย และเส้นทาง FAIL (ที่ผู้ใช้กด "กลับ"/"เริ่มใหม่" ซึ่งเรียก
 * abandon ทั้งคู่) ทิ้งแถวชื่อ `ลูกค้าใหม่ (Pre-check)` ค้างทะเบียนทุกครั้งที่เช็คไม่ผ่าน.
 */
const DECISION_TO_STATUS = {
  PASS: 'PRE_CHECK_PASSED',
  FAIL: 'REJECTED',
  REVIEW: 'UNDER_REVIEW',
} as const satisfies Record<PreCheckDecision, string>;

/**
 * สถานะที่พิสูจน์ว่าแถวนี้ถูกสร้างโดย pre-check และยังไม่กลายเป็นลูกค้าจริง.
 *
 * `NONE` (ค่า default ของคอลัมน์) จงใจ **ไม่อยู่ในนี้** — แถว NONE คือลูกค้าที่สร้างผ่าน
 * `POST /customers` ซึ่ง pre-check ไม่เคยแตะ ⇒ ลบทิ้งไม่ได้. `FULL_CHECK_PASSED` ก็ไม่อยู่
 * ด้วยเหตุผลเดียวกัน (ผ่านการตรวจเต็มแล้ว = ข้อมูลจริง).
 */
const ABANDONABLE_STATUSES = new Set<string>(Object.values(DECISION_TO_STATUS));

/**
 * บทบาทที่แก้ข้อมูลลูกค้า "ที่มีอยู่แล้ว" ได้ — ต้องตรงกับ `@Roles` ของ
 * `PATCH /customers/:id` ใน customers.controller.ts เสมอ (แก้ที่หนึ่งต้องแก้อีกที่).
 * ปักด้วย customers.controller.spec.ts — เทสอ่าน metadata ของ `@Roles` จริงมาเทียบ
 */
export const FULL_EDIT_ROLES = new Set(['OWNER', 'BRANCH_MANAGER']);

interface CacheEntry {
  result: CustomerPreCheckResponse;
  expires: number;
}

@Injectable()
export class CustomerPreCheckService {
  private readonly logger = new Logger(CustomerPreCheckService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tierService: CustomerTierService,
    private readonly customersService: CustomersService,
    private readonly testMode: TestModeService,
    private readonly audit: AuditService,
    private readonly creditCheck: CreditCheckService,
  ) {}

  decideOutcome(
    tier: CustomerTier,
    aiScore: number | undefined,
    hasStatement = false,
  ): { decision: PreCheckDecision; reasons: { code: string; message: string }[] } {
    const reasons: { code: string; message: string }[] = [];

    if (tier === 'BLACKLIST') {
      reasons.push({ code: 'BLACKLIST', message: 'ลูกค้าอยู่ในรายชื่อห้ามทำสัญญา' });
      return { decision: 'FAIL', reasons };
    }
    if (tier === 'RISKY') {
      reasons.push({ code: 'RISKY_TIER', message: 'มีประวัติค้างชำระ — ต้องให้ผู้จัดการตรวจเพิ่ม' });
      return { decision: 'REVIEW', reasons };
    }
    if (tier === 'GOLD') {
      reasons.push({ code: 'GOLD_TIER', message: 'ลูกค้า VIP — ผ่านเกณฑ์อัตโนมัติ' });
      return { decision: 'PASS', reasons };
    }
    if (tier === 'GOOD') {
      if (aiScore === undefined) {
        reasons.push({ code: 'GOOD_HISTORY', message: 'ประวัติดี — ผ่านเกณฑ์' });
        return { decision: 'PASS', reasons };
      }
      if (aiScore >= PASS_THRESHOLD) {
        reasons.push({ code: 'GOOD_HISTORY_AI_PASS', message: `ประวัติดี + AI ${aiScore}` });
        return { decision: 'PASS', reasons };
      }
      if (aiScore >= REVIEW_THRESHOLD) {
        reasons.push({
          code: 'GOOD_HISTORY_AI_BORDERLINE',
          message: `ประวัติดี แต่ AI ${aiScore} ก้ำกึ่ง`,
        });
        return { decision: 'REVIEW', reasons };
      }
      reasons.push({ code: 'AI_FAIL_OVERRIDE', message: `ประวัติดี แต่ AI ${aiScore} ต่ำเกิน` });
      return { decision: 'FAIL', reasons };
    }
    // NEW — no scoring engine yet, so the only path that produces a verdict
    // for new customers is "manager review". Differentiate the message by
    // whether the user actually attached a statement, so the result step
    // doesn't lie to a user who just uploaded one.
    if (aiScore === undefined) {
      if (hasStatement) {
        reasons.push({
          code: 'NEW_PENDING_REVIEW',
          message: 'แนบ statement แล้ว — รอผู้จัดการพิจารณา',
        });
      } else {
        reasons.push({
          code: 'NEW_NO_DATA',
          message: 'ลูกค้าใหม่ยังไม่มี statement — ต้องตรวจเพิ่ม',
        });
      }
      return { decision: 'REVIEW', reasons };
    }
    if (aiScore >= PASS_THRESHOLD) {
      reasons.push({ code: 'NEW_AI_PASS', message: `ลูกค้าใหม่ AI ${aiScore} ผ่าน` });
      return { decision: 'PASS', reasons };
    }
    if (aiScore >= REVIEW_THRESHOLD) {
      reasons.push({ code: 'NEW_AI_BORDERLINE', message: `ลูกค้าใหม่ AI ${aiScore} ก้ำกึ่ง` });
      return { decision: 'REVIEW', reasons };
    }
    reasons.push({ code: 'NEW_AI_FAIL', message: `ลูกค้าใหม่ AI ${aiScore} ต่ำ` });
    return { decision: 'FAIL', reasons };
  }

  /**
   * เรียกตัวอ่าน statement แล้วคืนคะแนน 0-100 — คืน `undefined` ทุกกรณีที่ไม่สำเร็จ
   *
   * **ห้าม throw**: pre-check ต้องให้คำตอบที่เคาน์เตอร์เสมอ ล้มเหลว/ปิดสวิตช์/ช้าเกิน
   * ⇒ ไม่มีคะแนน ⇒ `decideOutcome` ตัดสินจาก tier อย่างเดียว = พฤติกรรมเดิมก่อนต่อ AI
   */
  private async runAiAnalysis(creditCheckId: string): Promise<number | undefined> {
    try {
      const flag = await this.prisma.systemConfig.findUnique({
        where: { key: AI_PRECHECK_ENABLED_KEY },
      });
      if (flag?.value === 'false') return undefined;

      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('AI analysis timeout')), AI_TIMEOUT_MS);
      });
      try {
        const analyzed = await Promise.race([
          this.creditCheck.ai.analyzeForCustomer(creditCheckId),
          timeout,
        ]);
        return analyzed.aiScore ?? undefined;
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (err) {
      this.logger.warn(
        `[pre-check] อ่าน statement ด้วย AI ไม่สำเร็จ (${creditCheckId}) — ตัดสินโดยไม่ใช้คะแนน: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return undefined;
    }
  }

  private cacheKey(nationalId: string, statementHash?: string) {
    return `${nationalId}:${statementHash ?? 'none'}`;
  }

  private hashStatement(files?: string[]): string | undefined {
    if (!files || files.length === 0) return undefined;
    return createHash('sha256').update(files.join('|')).digest('hex').slice(0, 16);
  }

  async runPreCheck(
    input: {
      nationalId: string;
      phone: string;
      bankName?: string;
      statementFiles?: string[];
    },
    actor?: PreCheckActor,
  ): Promise<CustomerPreCheckResponse> {
    if (await this.testMode.isEnabled()) {
      // Test-mode UAT bypass (OWNER-gated SystemConfig TEST_MODE_BYPASS,
      // default off, audited). Turn OFF before go-live. Skips real credit
      // precheck so the system can be exercised end-to-end without external
      // dependencies. No placeholder customer exists yet at this point, so the
      // audit marker carries the nationalId for traceability instead of a
      // customerId (audit.log is a no-op without a valid userId FK, so this
      // only persists when an authenticated actor is threaded through).
      await this.audit.log({
        userId: actor?.userId,
        action: 'CREDIT_PRECHECK_BYPASSED_TEST_MODE',
        entity: 'customer',
        newValue: { nationalId: input.nationalId, reason: 'TEST_MODE_BYPASS' },
        ipAddress: actor?.ipAddress,
        userAgent: actor?.userAgent,
      });
      return {
        customerId: '',
        isNewCustomer: false,
        tier: 'NEW',
        decision: 'PASS',
        reasons: [
          {
            code: 'TEST_MODE_BYPASS',
            message: 'โหมดทดสอบเปิดอยู่ — ข้ามการตรวจเครดิตจริง',
          },
        ],
      };
    }

    const stmtHash = this.hashStatement(input.statementFiles);
    const key = this.cacheKey(input.nationalId, stmtHash);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      this.logger.debug(`pre-check cache hit for ${input.nationalId}`);
      return cached.result;
    }

    // Find-or-create the placeholder customer via CustomersService — the SAME
    // PII pipeline (nationalIdHash + encrypted columns) + party-master Contact
    // link as the canonical create(). Previously this looked up + created on
    // PLAINTEXT nationalId only (no hash/encrypted/Contact), so create()'s
    // nationalIdHash + contactId dedup MISSED the pre-check row and the same
    // person got a SECOND duplicate Customer when they completed registration
    // (splitting contracts/payments across two identities). It also no longer
    // depends on the plaintext national_id column (dropped in Phase 6). The
    // helper revives a soft-deleted ghost and upgrades an ensureRole stub.
    const placeholder = await this.customersService.findOrCreatePrecheckCustomer({
      nationalId: input.nationalId,
      phone: input.phone,
    });
    const customer = { id: placeholder.id };
    const isNewCustomer = placeholder.isNew;

    const tierResp = await this.tierService.getCustomerTier(customer.id);

    let creditCheckId: string | undefined;
    let aiScore: number | undefined;
    const hasStatement = !!input.statementFiles && input.statementFiles.length > 0;

    // ── 1) สร้าง (หรือใช้ซ้ำ) แถว CreditCheck ก่อน — ตัววิเคราะห์ AI อ้างด้วย id ──
    //
    // เดิมขั้นนี้อยู่ใน tx เดียวกับการสรุปผล และ `aiScore` ถูกฮาร์ดโค้ดเป็น undefined
    // ⇒ `decideOutcome` เข้าสาขา "ไม่มีข้อมูล AI" เสมอ ⇒ **ลูกค้าใหม่ทุกคนได้ REVIEW 100%**
    // ทั้งที่ wizard บังคับให้อัปโหลด statement มาแล้ว และมีตัวอ่าน statement ด้วย
    // Claude Vision (`CreditCheckAiAnalysisService`) ต่อไว้ครบ แค่ไม่มีใครเรียก
    //
    // แถวถูกสร้างด้วยสถานะ `PENDING` ก่อน แล้วค่อยอัปเดตเป็นผลจริงใน tx ท้ายสุดพร้อมกับ
    // `customer.creditCheckStatus` ⇒ **ผลสรุปของสองตารางยังเขียนพร้อมกันแบบ atomic เหมือนเดิม**
    // ถ้าโปรเซสตายกลางทาง แถวจะค้างที่ PENDING ซึ่งอ่านออกว่า "วิเคราะห์ไม่จบ" ไม่ใช่ผลผิด
    if (hasStatement && tierResp.tier !== 'BLACKLIST') {
      // Idempotency guard: แคชในหน่วยความจำครอบแค่อินสแตนซ์นี้ — ข้าม replica/รีสตาร์ต
      // ยังชนกันได้ จึงถาม DB หา PRE check ที่เพิ่งสร้าง (30 วินาที) มาใช้ซ้ำ
      const recentCutoff = new Date(Date.now() - 30_000);
      const recentDuplicate = await this.prisma.creditCheck.findFirst({
        where: {
          customerId: customer.id,
          checkType: 'PRE',
          deletedAt: null,
          createdAt: { gte: recentCutoff },
          bankName: input.bankName || null,
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, aiScore: true },
      });

      if (recentDuplicate) {
        creditCheckId = recentDuplicate.id;
        // ใบเดิมวิเคราะห์ไปแล้ว — ใช้คะแนนเดิม ไม่จ่ายค่า Claude ซ้ำ
        aiScore = recentDuplicate.aiScore ?? undefined;
      } else {
        const created = await this.prisma.creditCheck.create({
          data: {
            customerId: customer.id,
            bankName: input.bankName || null,
            statementFiles: input.statementFiles,
            statementMonths: 3,
            checkType: 'PRE',
            status: 'PENDING',
          },
          select: { id: true },
        });
        creditCheckId = created.id;
      }

      // ── 2) ให้ AI อ่าน statement ── (ล้มเหลว/ปิดสวิตช์/ช้าเกิน = ไม่มีคะแนน
      //    ⇒ ตกกลับไปพฤติกรรมเดิมเป๊ะ ๆ ไม่ใช่ error)
      if (aiScore === undefined) {
        aiScore = await this.runAiAnalysis(creditCheckId);
      }
    }

    // ── 3) สรุปผล — `decideOutcome` เป็นผู้ตัดสินสุดท้าย ไม่ใช่คะแนน AI ดิบ ──
    //    เพราะมันรู้ tier ด้วย (BLACKLIST = FAIL เสมอ, RISKY = REVIEW เสมอ, GOLD = PASS เสมอ)
    //    ส่วน `analyzeForCustomer` เขียน `status` ด้วยเกณฑ์ของตัวเอง (60/40) ซึ่งจะถูก
    //    ทับด้วยผลจากตรงนี้ใน tx ข้างล่าง — ตั้งใจ ไม่ใช่การเขียนซ้ำโดยพลาด
    const outcome = this.decideOutcome(tierResp.tier, aiScore, hasStatement);
    const nextStatus = DECISION_TO_STATUS[outcome.decision];

    await this.prisma.$transaction(async (tx) => {
      if (creditCheckId) {
        // Map decision → CreditCheckStatus so contract creation can proceed:
        //   PASS    → APPROVED      (auto-approved, can create contract immediately)
        //   REVIEW  → MANUAL_REVIEW (manager must review before contract)
        //   FAIL    → REJECTED      (no contract allowed)
        const ccStatus =
          outcome.decision === 'PASS'
            ? 'APPROVED'
            : outcome.decision === 'FAIL'
              ? 'REJECTED'
              : 'MANUAL_REVIEW';
        await tx.creditCheck.update({
          where: { id: creditCheckId },
          data: { status: ccStatus },
        });
      }

      await tx.customer.update({
        where: { id: customer.id },
        data: { creditCheckStatus: nextStatus },
      });
    });

    const reasons = [...tierResp.reasons, ...outcome.reasons];
    const result: CustomerPreCheckResponse = {
      customerId: customer.id,
      isNewCustomer,
      tier: tierResp.tier,
      decision: outcome.decision,
      reasons,
      aiScore,
      creditCheckId,
    };

    this.cache.set(key, { result, expires: Date.now() + CACHE_TTL_MS });
    return result;
  }

  /**
   * Abandon a pre-check session and soft-delete the placeholder customer that
   * `runPreCheck` created on first contact.
   *
   * Safety guards (refuse to delete if any are violated):
   *   - customer must still be on the placeholder name `ลูกค้าใหม่ (Pre-check)`
   *     (sentinel proving the user never advanced to FullIntakeStep — the
   *     full-intake form rewrites `name` from firstName+lastName)
   *   - must have no contracts (active or historical)
   *   - status must be one `runPreCheck` itself wrote (`ABANDONABLE_STATUSES`)
   *
   * Any of those failing means the row is real customer data — never delete.
   */
  /**
   * "ยังเป็นแถวที่ pre-check สร้างไว้และยังไม่กลายเป็นลูกค้าจริงหรือเปล่า" — ด่านร่วมของ
   * `abandonPreCheck` (ลบทิ้ง) และ `completePreCheck` (เขียนข้อมูลเต็มลงไป). สองเส้นทาง
   * ต้องตัดสินด้วยเกณฑ์ชุดเดียวกัน ไม่งั้นจะมีกรณีที่ "เขียนต่อได้แต่ลบไม่ได้" หรือกลับกัน
   */
  private async loadPlaceholderState(customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: {
        id: true,
        name: true,
        creditCheckStatus: true,
        _count: { select: { contracts: true } },
      },
    });
    if (!customer) return null;
    return {
      customer,
      isPlaceholder: customer.name === PLACEHOLDER_CUSTOMER_NAME,
      hasNoContracts: customer._count.contracts === 0,
      isPrecheckStatus: ABANDONABLE_STATUSES.has(customer.creditCheckStatus),
    };
  }

  /**
   * เขียนข้อมูลเต็มจากขั้นสุดท้ายของ intake wizard ลงแถวที่ pre-check เพิ่งสร้าง.
   *
   * มีอยู่เพราะ `PATCH /customers/:id` เป็น `@Roles('OWNER','BRANCH_MANAGER')` แต่
   * `POST /customers/pre-check` เปิดถึง SALES ⇒ พนักงานขายเดินครบ wizard แล้วโดน 403
   * ที่ปุ่ม "บันทึก" ทุกครั้ง และทิ้งแถว placeholder ไว้ (นี่คือต้นตอหลักของแถวผี ไม่ใช่
   * การปิดแท็บ). ทางแก้คือ **ไม่ขยายสิทธิ์ PATCH** — เปิดช่องที่แคบกว่า: แก้ได้เฉพาะแถวที่
   * ยังเป็น placeholder ของ pre-check เท่านั้น ⇒ SALES ปิดงานที่ตัวเองเปิดได้ แต่ยังแก้
   * ข้อมูลลูกค้าคนอื่นไม่ได้เหมือนเดิม.
   */
  async completePreCheck(customerId: string, dto: UpdateCustomerDto, actorRole?: string) {
    const state = await this.loadPlaceholderState(customerId);
    if (!state) throw new NotFoundException('ไม่พบลูกค้ารายนี้');

    // pre-check เจอลูกค้าเดิม (isNewCustomer=false) ⇒ แถวไม่ใช่ placeholder ⇒ นี่คือการ
    // "แก้ข้อมูลลูกค้าที่มีอยู่" ซึ่งยังต้องเป็นสิทธิ์เดิมของ PATCH /customers/:id เท่านั้น
    // (ไม่งั้นช่องนี้จะกลายเป็นทางอ้อมให้ SALES แก้ข้อมูลใครก็ได้ผ่าน wizard)
    const isPrecheckPlaceholder =
      state.isPlaceholder && state.hasNoContracts && state.isPrecheckStatus;

    if (!isPrecheckPlaceholder && !FULL_EDIT_ROLES.has(actorRole ?? '')) {
      this.logger.warn(
        `[pre-check] refuse complete ${customerId} (role=${actorRole}): placeholder=${state.isPlaceholder} noContracts=${state.hasNoContracts} precheckStatus=${state.isPrecheckStatus} (${state.customer.creditCheckStatus})`,
      );
      throw new ForbiddenException(
        'ลูกค้ารายนี้มีข้อมูลในระบบอยู่แล้ว การแก้ไขต้องให้ผู้จัดการทำจากหน้าข้อมูลลูกค้า',
      );
    }

    return this.customersService.update(customerId, dto);
  }

  async abandonPreCheck(customerId: string): Promise<{ deleted: boolean }> {
    const state = await this.loadPlaceholderState(customerId);
    if (!state) return { deleted: false };
    const { customer, isPlaceholder, hasNoContracts, isPrecheckStatus } = state;

    if (!isPlaceholder || !hasNoContracts || !isPrecheckStatus) {
      this.logger.warn(
        `[pre-check] refuse abandon ${customerId}: placeholder=${isPlaceholder} noContracts=${hasNoContracts} precheckStatus=${isPrecheckStatus} (${customer.creditCheckStatus})`,
      );
      return { deleted: false };
    }

    // ใบตรวจเครดิตของ session ที่ถูกทิ้งต้องหลุดจากคิว /credit-checks ไปด้วย —
    // `credit-check-crud.service.ts` กรอง `deletedAt: null` ของ **ตัว CreditCheck**
    // (ไม่ได้ join เช็ค customer.deletedAt) ⇒ ถ้าลบแค่แถวลูกค้า ใบตรวจจะยังโผล่ในคิว
    // พร้อมชื่อ "ลูกค้าใหม่ (Pre-check)" และนับรวมในตัวเลขสรุป.
    // soft-delete ไม่ hard-delete ตาม `.claude/rules/database.md` — แถวยังอยู่ให้ตรวจย้อนได้
    // จำกัดที่ `checkType: 'PRE'` เท่านั้น: ใบ FULL เกิดจากคนละเส้นทางที่ต้องมีลูกค้าจริง
    // อยู่ก่อน ถ้ามีติดอยู่บน placeholder แปลว่าผิดปกติ — ปล่อยให้เห็นดีกว่าลบทิ้งเงียบ ๆ
    const now = new Date();
    const [, checks] = await this.prisma.$transaction([
      this.prisma.customer.update({ where: { id: customerId }, data: { deletedAt: now } }),
      this.prisma.creditCheck.updateMany({
        where: { customerId, checkType: 'PRE', deletedAt: null },
        data: { deletedAt: now },
      }),
    ]);
    this.logger.log(
      `[pre-check] abandoned placeholder customer ${customerId} (+${checks.count} PRE credit check(s))`,
    );
    return { deleted: true };
  }
}
