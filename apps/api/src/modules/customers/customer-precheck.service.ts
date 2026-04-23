import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerTierService } from './customer-tier.service';
import type { CustomerTier } from './dto/tier.dto';
import type { CustomerPreCheckResponse, PreCheckDecision } from './dto/precheck.dto';

const PASS_THRESHOLD = 50;
const REVIEW_THRESHOLD = 40;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

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
  ) {}

  decideOutcome(
    tier: CustomerTier,
    aiScore: number | undefined,
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
    // NEW
    if (aiScore === undefined) {
      reasons.push({
        code: 'NEW_NO_DATA',
        message: 'ลูกค้าใหม่ยังไม่มี statement — ต้องตรวจเพิ่ม',
      });
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

  private cacheKey(nationalId: string, statementHash?: string) {
    return `${nationalId}:${statementHash ?? 'none'}`;
  }

  private hashStatement(files?: string[]): string | undefined {
    if (!files || files.length === 0) return undefined;
    return createHash('sha256').update(files.join('|')).digest('hex').slice(0, 16);
  }

  async runPreCheck(input: {
    nationalId: string;
    phone: string;
    bankName?: string;
    statementFiles?: string[];
  }): Promise<CustomerPreCheckResponse> {
    const stmtHash = this.hashStatement(input.statementFiles);
    const key = this.cacheKey(input.nationalId, stmtHash);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      this.logger.debug(`pre-check cache hit for ${input.nationalId}`);
      return cached.result;
    }

    // Look up INCLUDING soft-deleted rows. `nationalId` has a @unique
    // constraint (encrypted AES-256), so a soft-deleted ghost will block
    // any create() with the same nationalId (P2002). Revive instead of
    // crashing — the person behind the national ID is the same person.
    const existing = await this.prisma.customer.findFirst({
      where: { nationalId: input.nationalId },
      select: { id: true, deletedAt: true },
    });

    let customer: { id: string };
    let isNewCustomer = false;

    if (existing?.deletedAt) {
      await this.prisma.customer.update({
        where: { id: existing.id },
        data: {
          deletedAt: null,
          phone: input.phone,
          creditCheckStatus: 'UNDER_REVIEW',
        },
      });
      customer = { id: existing.id };
      this.logger.log(`[pre-check] revived soft-deleted customer ${existing.id}`);
    } else if (existing) {
      customer = { id: existing.id };
    } else {
      customer = await this.prisma.customer.create({
        data: {
          nationalId: input.nationalId,
          name: 'ลูกค้าใหม่ (Pre-check)',
          phone: input.phone,
          creditCheckStatus: 'UNDER_REVIEW',
        },
        select: { id: true },
      });
      isNewCustomer = true;
    }

    const tierResp = await this.tierService.getCustomerTier(customer.id);

    let creditCheckId: string | undefined;
    const aiScore: number | undefined = undefined;
    const outcome = this.decideOutcome(tierResp.tier, aiScore);

    const nextStatus =
      outcome.decision === 'PASS'
        ? 'PRE_CHECK_PASSED'
        : outcome.decision === 'FAIL'
          ? 'REJECTED'
          : 'UNDER_REVIEW';

    // Wrap credit-check create + customer.creditCheckStatus update in one
    // transaction so the Customer row and the CreditCheck row never drift
    // (e.g. creditCheck persisted but customer status update crashed).
    await this.prisma.$transaction(async (tx) => {
      if (input.statementFiles && input.statementFiles.length > 0 && tierResp.tier !== 'BLACKLIST') {
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

        // Idempotency guard: the in-memory cache above only covers this
        // instance. Across Cloud Run replicas or restarts, concurrent
        // pre-check calls can race past the cache. Query DB for a recent
        // PRE check (30s window) and reuse it instead of creating a duplicate.
        const recentCutoff = new Date(Date.now() - 30_000);
        const recentDuplicate = await tx.creditCheck.findFirst({
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

        const cc =
          recentDuplicate ??
          (await tx.creditCheck.create({
            data: {
              customerId: customer.id,
              bankName: input.bankName || null,
              statementFiles: input.statementFiles,
              statementMonths: 3,
              checkType: 'PRE',
              status: ccStatus,
            },
            select: { id: true, aiScore: true },
          }));
        creditCheckId = cc.id;
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
}
