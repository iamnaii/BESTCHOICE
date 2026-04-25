import { Injectable } from '@nestjs/common';
import { CustomerTagType, DunningRule } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Shape of `DunningRule.tagConditions` JSON column (P3 Task 7).
 *
 * Authoritative reference for any front-end editor or back-end consumer.
 *
 * Resolution priority (first applicable wins per category):
 *  1. immediateForTags  → bypasses delay, sends immediately
 *  2. skipForTags       → skip the rule entirely
 *  3. skipSoftForTags   → skip soft-language variants, jump to firm
 *  4. delayDaysForTags  → defer the scheduled send by N days
 *
 * A customer can carry multiple tags. The resolver applies the conditions in
 * the order BLACKLIST > HIGH_RISK > VIP so the most aggressive policy wins
 * when conflicting tags coexist (e.g. a HIGH_RISK customer is never delayed
 * even if they also have VIP).
 */
export interface DunningTagConditions {
  /** If any of these tags is present, send immediately (override delay). */
  immediateForTags?: CustomerTagType[];
  /** If any of these tags is present, skip the rule entirely. */
  skipForTags?: CustomerTagType[];
  /** If any of these tags is present, skip soft-language variants. */
  skipSoftForTags?: CustomerTagType[];
  /** If a tag is present, add the configured days to the scheduled send. */
  delayDaysForTags?: Partial<Record<CustomerTagType, number>>;
}

export type DunningResolution =
  | { action: 'skip'; reason: string }
  | {
      action: 'send';
      /**
       * Days to add to the scheduled send. 0 = send now (immediate). Engines
       * wanting to honour delay can compare to scheduledFor + delayDays.
       */
      delayDays: number;
      /**
       * When true the engine should bypass any soft-template variant and use
       * the firm version. Resolver flags this for HIGH_RISK by default.
       */
      skipSoft: boolean;
      /** Free-form audit trail string for logging the resolved decision. */
      reason: string;
    };

/**
 * Applies BLACKLIST/HIGH_RISK/VIP-style conditions to a DunningRule before
 * dispatch. Used by both the scheduled engine and the event-trigger path so
 * the same policy is enforced everywhere.
 *
 * Built-in defaults (applied in addition to whatever JSON is on the rule):
 *  - BLACKLIST → immediate (delayDays = 0, skipSoft = true)
 *  - HIGH_RISK → skipSoft = true
 *  - VIP       → +3 days delay before LINE/SMS
 *
 * Per-rule JSON values WIN over the defaults when they conflict (e.g. an
 * owner can set `delayDaysForTags.VIP = 7` to be more conservative).
 */
@Injectable()
export class DunningRuleResolverService {
  // Built-in defaults; apply when the rule's tagConditions does not set the
  // category. Frozen so accidental mutation doesn't leak state across calls.
  private static readonly DEFAULT_IMMEDIATE: ReadonlyArray<CustomerTagType> = ['BLACKLIST'];
  private static readonly DEFAULT_SKIP_SOFT: ReadonlyArray<CustomerTagType> = [
    'BLACKLIST',
    'HIGH_RISK',
  ];
  private static readonly DEFAULT_VIP_DELAY_DAYS = 3;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Look up active CustomerTag types for a single customer. Cheap join that
   * the engine calls once per execution loop.
   */
  async fetchTagsForCustomer(customerId: string): Promise<CustomerTagType[]> {
    const rows = await this.prisma.customerTag.findMany({
      where: { customerId, deletedAt: null },
      select: { tag: true },
    });
    return rows.map((r) => r.tag);
  }

  /**
   * Pure decision function. Pass in rule + active customer tags and get back a
   * directive the engine consumes. No I/O — easy to unit-test.
   */
  resolve(rule: DunningRule, customerTags: CustomerTagType[]): DunningResolution {
    const conditions = (rule.tagConditions as DunningTagConditions | null) ?? {};
    const tagSet = new Set(customerTags);

    const immediate = new Set<CustomerTagType>([
      ...DunningRuleResolverService.DEFAULT_IMMEDIATE,
      ...(conditions.immediateForTags ?? []),
    ]);
    const skip = new Set<CustomerTagType>(conditions.skipForTags ?? []);
    const skipSoft = new Set<CustomerTagType>([
      ...DunningRuleResolverService.DEFAULT_SKIP_SOFT,
      ...(conditions.skipSoftForTags ?? []),
    ]);

    // 1. Immediate wins over everything (BLACKLIST policy: send now even if
    // VIP delay would otherwise apply).
    for (const t of immediate) {
      if (tagSet.has(t)) {
        return {
          action: 'send',
          delayDays: 0,
          skipSoft: true, // immediate always implies firm
          reason: `${t}: ส่งทันที (immediate override)`,
        };
      }
    }

    // 2. Skip-rule short-circuits the rest.
    for (const t of skip) {
      if (tagSet.has(t)) {
        return { action: 'skip', reason: `${t}: ข้ามกฎตาม tagConditions.skipForTags` };
      }
    }

    // 3. Build the send directive from delayDays + skipSoft.
    let delayDays = 0;
    const delayMap = conditions.delayDaysForTags ?? {};
    for (const tag of customerTags) {
      const configured = delayMap[tag];
      if (typeof configured === 'number' && configured > delayDays) {
        delayDays = configured;
      }
    }
    // Apply VIP default delay only when the rule did not explicitly set a
    // VIP delay (zero or absent). Caller-set value still wins.
    if (tagSet.has('VIP') && delayMap.VIP === undefined && delayDays === 0) {
      delayDays = DunningRuleResolverService.DEFAULT_VIP_DELAY_DAYS;
    }

    let skipSoftFlag = false;
    for (const t of skipSoft) {
      if (tagSet.has(t)) {
        skipSoftFlag = true;
        break;
      }
    }

    const reasons: string[] = [];
    if (delayDays > 0) reasons.push(`delay ${delayDays} วัน`);
    if (skipSoftFlag) reasons.push('skip soft → firm');
    const reason = reasons.length === 0 ? 'no tag override' : reasons.join(', ');

    return { action: 'send', delayDays, skipSoft: skipSoftFlag, reason };
  }
}
