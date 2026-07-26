import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import {
  computeInstallmentOutstanding,
  type CnBreakdownContractInput,
  type CnPaymentInput,
  type InstallmentOutstandingRow,
} from '../journal/compute-cn-breakdown';
import { BadDebtProvisionTemplate } from '../journal/cpa-templates/bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from '../journal/cpa-templates/bad-debt-writeoff.template';
import { EclStageReverseTemplate } from '../journal/cpa-templates/ecl-stage-reverse.template';
import { glContractBalance } from '../journal/gl-contract-balance';
import { ConsecutiveMissedService } from '../overdue/consecutive-missed.service';
import { CreditNoteDocumentService } from '../receipts/services/credit-note-document.service';
import { CreditNoteDeliveryService } from '../receipts/services/credit-note-delivery.service';

// CPA ECL v3.0 — NPAEs Ch.13 Aging-based (6 buckets B0-B5)
// Refs: docs/superpowers/specs/2026-05-09-cpa-policy-a-100-compliance-design.md
//       + สรุปการบันทึกรับชำระค่างวด.csv §6 ECL Provision
//
// Note: 0-day bucket (B0) handled implicitly = no provision created
//       (only installments WITH overdue days get a provision row).
const DEFAULT_PROVISION_RATES: Record<string, number> = {
  '1-30': 0.02,    // B1 ACTIVE
  '31-60': 0.15,   // B2 ACTIVE (alert 60d trigger)
  '61-90': 0.50,   // B3 → contract should be TERMINATED (manual)
  '91-180': 0.75,  // B4 TERMINATED
  '180+': 1.00,    // B5 TERMINATED (NPL)
};

@Injectable()
export class BadDebtService {
  private readonly logger = new Logger(BadDebtService.name);

  constructor(
    private prisma: PrismaService,
    private journalAutoService: JournalAutoService,
    private badDebtProvisionTemplate: BadDebtProvisionTemplate,
    private badDebtWriteOffTemplate: BadDebtWriteOffTemplate,
    private eclStageReverseTemplate: EclStageReverseTemplate,
    private consecutiveMissed: ConsecutiveMissedService,
    private creditNoteDocumentService: CreditNoteDocumentService,
    private cnDeliveryService: CreditNoteDeliveryService,
  ) {}

  /** Load provision rates from system config or use defaults */
  private async getProvisionRates(): Promise<Record<string, number>> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: 'bad_debt_provision_rates' },
    });
    if (config) {
      try {
        const parsed = JSON.parse(config.value) as Record<string, number>;
        // Merge over defaults so a partial/stale config (e.g. missing B4/B5
        // after a bucket-key rename) never silently zeroes out a bucket via
        // `rates[bucket] || 0` downstream — a missing key here must fall back
        // to the safe default rate, not 0%.
        const merged = { ...DEFAULT_PROVISION_RATES, ...parsed };
        const missingKeys = Object.keys(DEFAULT_PROVISION_RATES).filter(
          (k) => !(k in parsed),
        );
        if (missingKeys.length > 0) {
          const msg = `bad_debt_provision_rates SystemConfig is missing canonical bucket(s) [${missingKeys.join(', ')}] — falling back to DEFAULT_PROVISION_RATES for those keys`;
          this.logger.warn(msg);
          Sentry.captureMessage(msg, {
            level: 'warning',
            tags: { subsystem: 'bad-debt', key: 'bad_debt_provision_rates' },
            extra: { missingKeys },
          });
        }
        // C1: legacy bucket keys ('181-360'/'360+', pre-v3 naming) surviving
        // alongside the canonical keys is a distinct hazard from "missing" —
        // the row VALIDATES as present (has '91-180'/'180+') but its VALUES
        // may still be stale ones the merge above happily takes as-is (stale
        // values win over v3 defaults, since `parsed` overrides `merged` for
        // any key it defines). Merging can't fix a stale VALUE under the
        // correct key name, only a missing key — so alarm distinctly here.
        const legacyKeys = ['181-360', '360+'].filter((k) => k in parsed);
        if (legacyKeys.length > 0) {
          const msg = `bad_debt_provision_rates SystemConfig still has legacy bucket key(s) [${legacyKeys.join(', ')}] (pre-v3 naming) — values for the canonical keys still come from the stored config as-is (stale VALUES win, not just missing keys); migrate this row via apps/api/prisma/migrations-manual/2026-07-23-enable-letter-auto-generate-and-jp5-strict.sql`;
          this.logger.warn(msg);
          Sentry.captureMessage(msg, {
            level: 'warning',
            tags: { subsystem: 'bad-debt', key: 'bad_debt_provision_rates' },
            extra: { legacyKeys },
          });
        }
        return merged;
      } catch (err) {
        // Corrupt/edited provision-rate JSON must NOT silently revert to
        // defaults — these rates drive the TFRS-9 ECL allowance JE (Cr 11-2102),
        // so a stale basis would post with zero signal. Alarm, THEN fall back to
        // defaults (safe) so the provisioning cron keeps running. Silent drift
        // on a regulated provision is the failure we refuse.
        Sentry.captureException(err, {
          level: 'error',
          tags: { subsystem: 'bad-debt', key: 'bad_debt_provision_rates' },
        });
        this.logger.error(
          `Corrupt bad_debt_provision_rates SystemConfig JSON — using DEFAULT_PROVISION_RATES: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return DEFAULT_PROVISION_RATES;
  }

  /** Determine aging bucket for a given number of overdue days (CPA ECL v3.0) */
  private getAgingBucket(daysOverdue: number): string {
    if (daysOverdue <= 30) return '1-30';     // B1
    if (daysOverdue <= 60) return '31-60';    // B2 (alert 60d)
    if (daysOverdue <= 90) return '61-90';    // B3 (TERMINATED)
    if (daysOverdue <= 180) return '91-180';  // B4 (TERMINATED)
    return '180+';                             // B5 (NPL)
  }

  /**
   * Load streak→bucket map from SystemConfig.
   *
   * Streak-floor DORMANT semantics (2026-07-26 per-installment plan, spec
   * §2.2 — scrutinize blocker resolution): a MISSING row, an EMPTY object,
   * or CORRUPT JSON all mean **NO floor at all** — this is a deliberate
   * reversal of the old behaviour where any of those cases silently fell
   * back to a code-default map (DEFAULT_STREAK_BUCKET_MAP, now retired).
   * Only an explicit, non-empty SystemConfig row activates the floor. If the
   * CPA later reinstates the floor as the default, that's a 1-row config
   * INSERT — no code change.
   */
  private async getStreakBucketMap(): Promise<Record<string, string> | null> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: 'consecutive_missed_bucket_map' },
    });
    if (!config) return null;
    try {
      const parsed = JSON.parse(config.value) as Record<string, string>;
      if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
        return null;
      }
      return parsed;
    } catch (err) {
      Sentry.captureException(err, {
        level: 'error',
        tags: { subsystem: 'bad-debt', key: 'consecutive_missed_bucket_map' },
      });
      this.logger.error(
        'Corrupt consecutive_missed_bucket_map — no floor applied (2026-07-26 dormant-by-default semantics)',
      );
      return null;
    }
  }

  /**
   * Floor bucket for a streak: the entry whose threshold is the largest <=
   * streak. `map` is required — no code-default fallback (see
   * `getStreakBucketMap`); callers must only invoke this once they already
   * know a non-null map is configured.
   */
  private streakToBucket(streak: number, map: Record<string, string>): string | null {
    let best: string | null = null;
    let bestThreshold = -1;
    for (const [k, bucket] of Object.entries(map)) {
      const threshold = Number(k);
      if (streak >= threshold && threshold > bestThreshold) {
        bestThreshold = threshold;
        best = bucket;
      }
    }
    return best;
  }

  /** Of (aging, streak-floor) buckets, return the one with the higher provision rate. */
  private effectiveBucket(
    agingBucket: string,
    streakBucket: string | null,
    rates: Record<string, number>,
  ): string {
    if (!streakBucket) return agingBucket;
    return (rates[streakBucket] || 0) > (rates[agingBucket] || 0) ? streakBucket : agingBucket;
  }

  /**
   * ฐาน ECL = amountDue − amountPaid เท่านั้น (ตรงกับ 11-2103) — ค่าปรับล่าช้า
   * ไม่ใช่สินทรัพย์ใน GL (รับรู้เป็นรายได้ 42-1103 ตอนรับเงิน) จึงห้ามเข้าฐาน
   * (Excel v3 §1 + spec 2026-07-23 §4 1b)
   */
  private computeOutstanding(p: { amountDue: Prisma.Decimal; amountPaid: Prisma.Decimal }): Decimal {
    return new Decimal(p.amountDue.toString()).sub(new Decimal(p.amountPaid.toString()));
  }

  /**
   * GL balance ราย contract — thin delegate to the shared
   * `journal/gl-contract-balance.ts` helper (2026-07-26, ECL-per-installment
   * Task 5 — extracted from this exact method + the identical copies in
   * `BadDebtWriteOffTemplate` and `RepossessionJP5Template`). Kept as a
   * same-signature wrapper (contractId first, `db` defaulted last) so every
   * existing call site in this file, and every jest mock of
   * `prisma.journalLine.findMany`, keeps working unchanged.
   */
  private async glBalance(
    contractId: string,
    accountCode: string,
    side: 'dr' | 'cr',
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Decimal> {
    return glContractBalance(db, contractId, accountCode, side);
  }

  /**
   * Shared per-installment provision math — the SINGLE place that turns a set
   * of engine rows (`computeInstallmentOutstanding(..., { selection: 'DUE' })`)
   * into a bucket/provision aggregation. Used by BOTH `calculateProvisions`
   * (daily cron) and `reverseStageOnPayment` (real-time payment hook) so the
   * two can never independently drift on what "the current provision for
   * this contract" means (2026-07-26 Task 4 — extracted from T3's
   * `calculateProvisions` loop, behavior-identical).
   *
   * `floorBucket` is the ONE contract-level streak-floor bucket (or null if
   * the floor is dormant) — compared per-row against that row's own aging
   * bucket via `effectiveBucket` (higher provision rate wins).
   */
  private computePerInstallmentProvision(
    rows: InstallmentOutstandingRow[],
    rates: Record<string, number>,
    floorBucket: string | null,
  ): {
    bucketAgg: Record<string, { count: number; base: Decimal; provision: Decimal }>;
    contractOutstanding: Decimal;
    contractProvision: Decimal;
    oldest: InstallmentOutstandingRow;
  } {
    const bucketAgg: Record<string, { count: number; base: Decimal; provision: Decimal }> = {};
    let contractOutstanding = new Decimal(0);
    let contractProvision = new Decimal(0);
    let oldest = rows[0];

    for (const row of rows) {
      const rowDays = row.daysOverdue ?? 0;
      if (rowDays > (oldest.daysOverdue ?? 0)) oldest = row;

      const rowAgingBucket = this.getAgingBucket(rowDays);
      const bucket = this.effectiveBucket(rowAgingBucket, floorBucket, rates);
      const rate = rates[bucket] || 0;
      const rowProvision = row.outstanding
        .mul(new Decimal(rate))
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      contractOutstanding = contractOutstanding.add(row.outstanding);
      contractProvision = contractProvision.add(rowProvision);

      if (!bucketAgg[bucket]) {
        bucketAgg[bucket] = { count: 0, base: new Decimal(0), provision: new Decimal(0) };
      }
      bucketAgg[bucket].count++;
      bucketAgg[bucket].base = bucketAgg[bucket].base.add(row.outstanding);
      bucketAgg[bucket].provision = bucketAgg[bucket].provision.add(rowProvision);
    }

    return { bucketAgg, contractOutstanding, contractProvision, oldest };
  }

  /**
   * Calculate Bad Debt provisions per TFRS for NPAEs Chapter 13.
   *
   * Per-installment engine (2026-07-26 ECL-per-installment plan, spec §2.1-2.2):
   * every outstanding installment ages INDEPENDENTLY off its own
   * `Payment.dueDate` via `computeInstallmentOutstanding(..., { selection: 'DUE' })`
   * — the same fee-netted engine that powers the CN (ใบลดหนี้) pro-rate. A
   * contract with 4 unpaid installments at 120/90/60/30 days gets 4 separate
   * bucket provisions summed together, NOT one whole-contract bucket keyed
   * off the oldest installment (the retired v3 model). TERMINATED contracts
   * use the SAME per-installment aging as ACTIVE — the old carrying-amount
   * base (`terminatedCarryingAmount`) is retired entirely (Task 4,
   * 2026-07-26) — `reverseStageOnPayment` now shares this same math via
   * `computePerInstallmentProvision`.
   *
   * CPA ECL v3.0 buckets (NPAEs Ch.13 Aging-based · 6 buckets B0-B5), unchanged:
   *   B0: 0 days (ปกติ)    0%   ACTIVE (no provision row created)
   *   B1: 1-30 days        2%   ACTIVE
   *   B2: 31-60 days       15%  ACTIVE (alert 60d trigger)
   *   B3: 61-90 days       50%  → contract should be TERMINATED (manual)
   *   B4: 91-180 days      75%  TERMINATED
   *   B5: >180 days        100% TERMINATED (NPL)
   *
   * Streak floor is DORMANT by default (spec §2.2) — an empty/missing/corrupt
   * `consecutive_missed_bucket_map` SystemConfig means NO floor at all; only
   * an explicit non-empty row activates it. When active, ONE floor bucket
   * per contract (streak is a contract-level metric) is compared against
   * EACH installment's own aging bucket — higher provision rate wins
   * per-installment (see `getStreakBucketMap`).
   *
   * Approved NPAEs simplification per Ch.13 — forward-looking macro factors
   * not required at NPAEs level. Rates are configurable via
   * SystemConfig key `bad_debt_provision_rates`; if unset the defaults above
   * apply.
   *
   * Reverses existing ACTIVE provisions for in-scope contracts before
   * creating fresh ones, so re-running is idempotent. Posts a delta JE
   * per contract via BadDebtProvisionTemplate (Phase A.5a) — delta-vs-GL
   * mechanics are untouched by the per-installment engine swap.
   *
   * Refs: docs/superpowers/specs/2026-07-26-ecl-per-installment-design.md §2.2
   */
  async calculateProvisions(
    calculatedById: string,
    branchId?: string,
    dryRun = false,
  ): Promise<{
    created: number;
    totalProvision: number;
    byBucket: Record<string, { count: number; amount: number }>;
    deltas?: { contractId: string; bucket: string; prevGl: string; target: string; delta: string }[];
  }> {
    const rates = await this.getProvisionRates();
    const now = new Date();
    const branchFilter = branchId ? { branchId } : {};

    // Find all overdue payments from in-scope contracts — same scope as
    // before (PENDING/PARTIALLY_PAID/OVERDUE, dueDate < now, contract in
    // ACTIVE/OVERDUE/DEFAULT/TERMINATED) — PLUS the contract money fields the
    // per-installment engine needs (financedAmount/storeCommission/
    // interestTotal/vatAmount/totalMonths), fetched once here so the
    // per-contract engine call below never re-queries either the contract or
    // its payments (preloaded — no N+1).
    const overduePayments = await this.prisma.payment.findMany({
      where: {
        // OVERDUE included (2026-07-24 hotfix): overdue-lifecycle cron flips past-due
        // payments PENDING → OVERDUE on prod — excluding it made ECL blind to every
        // aged installment (ConsecutiveMissedService already counts OVERDUE; now consistent)
        status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
        dueDate: { lt: now },
        contract: {
          deletedAt: null,
          // TERMINATED เข้า scope ตาม Excel v3 B4/B5 — escalate ต่อระหว่างรอยึด/ตัดหนี้สูญ
          // (ยึดแล้ว = CLOSED_BAD_DEBT หลุด scope เอง — spec 2026-07-23 §4 1c)
          status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT', 'TERMINATED'] },
          ...branchFilter,
        },
      },
      include: {
        contract: {
          select: {
            id: true,
            totalMonths: true,
            financedAmount: true,
            storeCommission: true,
            interestTotal: true,
            vatAmount: true,
          },
        },
      },
      take: 10000, // safety cap — prevent unbounded memory usage
      orderBy: { dueDate: 'asc' },
    });

    // Group payments per contract — every row already matches
    // computeInstallmentOutstanding's DUE filter (status/dueDate), so this
    // preload lets the engine skip its own payment query entirely per contract.
    type ContractGroup = { contract: CnBreakdownContractInput; payments: CnPaymentInput[] };
    const contractGroups = new Map<string, ContractGroup>();
    for (const p of overduePayments) {
      let group = contractGroups.get(p.contract.id);
      if (!group) {
        group = { contract: p.contract, payments: [] };
        contractGroups.set(p.contract.id, group);
      }
      group.payments.push({
        installmentNo: p.installmentNo,
        status: p.status,
        amountDue: p.amountDue,
        amountPaid: p.amountPaid,
        lateFee: p.lateFee,
        lateFeeWaived: p.lateFeeWaived,
        dueDate: p.dueDate,
      });
    }

    // Reverse existing ACTIVE provisions only for contracts in scope.
    // Wrap REVERSE + CREATE in a single $transaction — without it, a
    // failed createMany after the reverse would leave provisions REVERSED
    // with no replacement, dropping coverage on the balance sheet.
    const contractIdsInScope = [...contractGroups.keys()];

    // Streak floor is OPT-IN (2026-07-26 semantics, see getStreakBucketMap) —
    // a missing/empty/corrupt config means NO floor, so skip the streak
    // query entirely in that case (nothing would read it anyway).
    const streakMap = await this.getStreakBucketMap();
    const streaks = streakMap
      ? await this.consecutiveMissed.getStreaks({ contractIds: contractIdsInScope }, now)
      : new Map<string, number>();

    // Pre-compute provision rows (Decimal — no Number cast in persisted values)
    type ProvisionRow = {
      contractId: string;
      provisionDate: Date;
      agingBucket: string;
      daysOverdue: number;
      outstandingAmount: Prisma.Decimal;
      provisionRate: Prisma.Decimal;
      provisionAmount: Prisma.Decimal;
      bucketBreakdown: Record<string, { count: number; base: string; provision: string }>;
    };
    const byBucket: Record<string, { count: number; amount: Decimal }> = {};
    const provisions: ProvisionRow[] = [];

    for (const [contractId, group] of contractGroups) {
      const { rows } = await computeInstallmentOutstanding(this.prisma, group.contract, {
        selection: 'DUE',
        asOf: now,
        preloaded: { payments: group.payments },
      });
      // All installments fully covered net of fees (incl. overpaid edge
      // case) — nothing to provision. The contract stays in
      // `contractIdsInScope` so a stale ACTIVE provision still gets
      // REVERSED below (correctly reflects "no allowance needed anymore").
      if (rows.length === 0) continue;

      // ONE floor bucket per contract (streak is a contract-level metric) —
      // compared against EACH installment's own aging bucket, higher rate wins.
      const floorBucket = streakMap
        ? this.streakToBucket(streaks.get(contractId) ?? 0, streakMap)
        : null;

      const { bucketAgg, contractOutstanding, contractProvision, oldest } =
        this.computePerInstallmentProvision(rows, rates, floorBucket);

      // agingBucket (display/sort, spec §2.3) = bucket of the OLDEST
      // installment, post-floor — reflects what actually drove that row's rate.
      const contractBucket = this.effectiveBucket(
        this.getAgingBucket(oldest.daysOverdue ?? 0),
        floorBucket,
        rates,
      );
      const outstandingDec = contractOutstanding.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const provisionAmountDec = contractProvision.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      // Blended rate for backward-compat with UI/reports reading a single
      // provisionRate per contract (spec §2.3) — provision/base, 4dp.
      const provisionRateDec = outstandingDec.gt(0)
        ? contractProvision.div(outstandingDec).toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
        : new Decimal(0);

      const bucketBreakdown: Record<string, { count: number; base: string; provision: string }> = {};
      for (const [b, agg] of Object.entries(bucketAgg)) {
        bucketBreakdown[b] = {
          count: agg.count,
          base: agg.base.toFixed(2),
          provision: agg.provision.toFixed(2),
        };
      }

      provisions.push({
        contractId,
        provisionDate: now,
        agingBucket: contractBucket,
        daysOverdue: oldest.daysOverdue ?? 0,
        outstandingAmount: outstandingDec,
        provisionRate: provisionRateDec,
        provisionAmount: provisionAmountDec,
        bucketBreakdown,
      });

      // byBucket aggregates from the PER-INSTALLMENT bucketAgg (Task 7 fix) —
      // NOT the whole-contract provisionAmountDec dumped onto contractBucket
      // (the oldest installment's display bucket). A contract spanning
      // multiple buckets (e.g. {90,60,30} → 757.92/227.37/30.32) must show its
      // TRUE per-bucket split, not the full 1,015.61 attributed to '61-90'
      // alone — that was the deferred Warning from the earlier review.
      for (const [bucket, agg] of Object.entries(bucketAgg)) {
        if (!byBucket[bucket]) byBucket[bucket] = { count: 0, amount: new Decimal(0) };
        byBucket[bucket].count += agg.count;
        byBucket[bucket].amount = byBucket[bucket].amount.add(agg.provision);
      }
    }

    // Atomic REVERSE + CREATE — never leave the balance sheet without coverage.
    // dryRun (Task 8) skips this entirely — no row writes for a read-only report.
    if (!dryRun) {
      await this.prisma.$transaction(async (tx) => {
        if (contractIdsInScope.length > 0) {
          await tx.badDebtProvision.updateMany({
            where: { status: 'ACTIVE', contractId: { in: contractIdsInScope }, deletedAt: null },
            data: { status: 'REVERSED' },
          });
        }

        if (provisions.length > 0) {
          await tx.badDebtProvision.createMany({ data: provisions });
        }
      });
    }

    // Post delta-based provision JEs (non-blocking — a single JE failure must not abort the run)
    // Delta เทียบ GL 11-2102 จริง (ไม่ใช่ DB rows) — JE ที่เคย fail จะถูกเติมคืนรอบถัดไป (self-healing)
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const runDate = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

    const deltas: { contractId: string; bucket: string; prevGl: string; target: string; delta: string }[] = [];

    // CRITICAL fix (second-reviewer finding, post-Task-4): iterate
    // `contractIdsInScope`, NOT `provisions`. A contract whose engine rows all
    // dropped (rows.length === 0 in the loop above — e.g. fee-netted fully
    // covered, status not yet flipped to PAID) never gets a `provisions`
    // entry, so looping over `provisions` alone silently skipped its
    // delta-vs-GL evaluation entirely — a stale 11-2102 GL balance from a
    // PRIOR run would never be released, diverging from the DB row (which
    // still gets REVERSED above). Every in-scope contract must get a GL
    // evaluation with target defaulting to 0 when no provision was computed —
    // this restores the pre-Task-4 guarantee ("delta-vs-GL กลไกเดิม ไม่แตะ").
    const provisionsByContract = new Map(provisions.map((p) => [p.contractId, p]));

    for (const contractId of contractIdsInScope) {
      try {
        const p = provisionsByContract.get(contractId);
        const target = p ? new Decimal(p.provisionAmount.toString()) : new Decimal(0);
        const bucket = p ? p.agingBucket : 'CURRENT';
        const glPrev = await this.glBalance(contractId, '11-2102', 'cr');
        const delta = target.sub(glPrev);

        if (dryRun) {
          // Report completeness: include zero-delta AND zero-target contracts
          // too (they would be skipped for posting, but still reflect target
          // vs GL state).
          deltas.push({
            contractId,
            bucket,
            prevGl: glPrev.toFixed(2),
            target: target.toFixed(2),
            delta: delta.toFixed(2),
          });
          continue;
        }

        if (delta.abs().lt(new Decimal('0.005'))) continue;

        await this.badDebtProvisionTemplate.execute({
          contractId,
          provisionAmount: delta,
          period,
          runDate,
        });
      } catch (err) {
        Sentry.captureException(err, { extra: { contractId, period } });
        this.logger.error(
          `[A.5a] Bad debt provision JE failed for contract ${contractId} period ${period}: ${(err as Error).message}`,
        );
      }
    }

    // Decimal sum for total provision (TFRS 9 / v4 mandate — avoid float drift on aggregation)
    const totalProvisionDecimal = provisions.reduce(
      (sum, p) => sum.add(p.provisionAmount),
      new Decimal(0),
    );
    const totalProvision = totalProvisionDecimal.toNumber();
    // Convert byBucket Decimals to numbers for the response shape (display only)
    const byBucketResp: Record<string, { count: number; amount: number }> = {};
    for (const [bucket, agg] of Object.entries(byBucket)) {
      byBucketResp[bucket] = { count: agg.count, amount: agg.amount.toNumber() };
    }
    return {
      created: provisions.length,
      totalProvision,
      byBucket: byBucketResp,
      ...(dryRun ? { deltas } : {}),
    };
  }

  /**
   * Get provision summary (current ACTIVE provisions).
   *
   * byBucket (2026-07-26, Task 7 — reports+docs alignment): aggregated from
   * Σ `bucketBreakdown` across ACTIVE rows, NOT the row's single `agingBucket`
   * (oldest-installment display bucket) — a contract spanning multiple
   * buckets (e.g. {90,60,30}) must contribute its TRUE per-bucket share to
   * each bucket, not dump its whole provisionAmount onto the oldest one.
   * Rows persisted BEFORE the per-installment migration (Task 2/3) carry no
   * `bucketBreakdown` — those fall back to the old whole-row attribution
   * (their entire outstanding/provision keyed under their single agingBucket)
   * so pre-migration data still reports sensibly instead of vanishing.
   */
  async getProvisionSummary() {
    const rates = await this.getProvisionRates();
    const provisions = await this.prisma.badDebtProvision.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      include: {
        contract: {
          select: {
            contractNumber: true,
            customerId: true,
            customer: { select: { name: true } },
          },
        },
      },
      orderBy: { daysOverdue: 'desc' },
    });

    // Decimal accumulation (TFRS 9 / v4 mandate — avoid float drift on aggregation)
    let totalOutstandingDec = new Decimal(0);
    let totalProvisionDec = new Decimal(0);
    const bucketDec = new Map<string, { count: number; outstanding: Decimal; provision: Decimal }>();

    const addBucket = (bucket: string, count: number, outstanding: Decimal, provision: Decimal) => {
      const entry = bucketDec.get(bucket);
      if (!entry) {
        bucketDec.set(bucket, { count, outstanding, provision });
      } else {
        entry.count += count;
        entry.outstanding = entry.outstanding.add(outstanding);
        entry.provision = entry.provision.add(provision);
      }
    };

    for (const p of provisions) {
      const outstandingDec = new Decimal(p.outstandingAmount.toString());
      const provisionDec = new Decimal(p.provisionAmount.toString());
      totalOutstandingDec = totalOutstandingDec.add(outstandingDec);
      totalProvisionDec = totalProvisionDec.add(provisionDec);

      const breakdown = p.bucketBreakdown as Record<
        string,
        { count: number; base: string; provision: string }
      > | null;

      if (breakdown && typeof breakdown === 'object' && Object.keys(breakdown).length > 0) {
        // Per-installment engine (Task 3+) — true per-bucket share.
        for (const [bucket, agg] of Object.entries(breakdown)) {
          addBucket(bucket, agg.count, new Decimal(agg.base), new Decimal(agg.provision));
        }
      } else {
        // Legacy row (pre per-installment migration, no bucketBreakdown
        // persisted) — fall back to whole-row attribution under its single
        // agingBucket, same as the retired v3 behavior.
        addBucket(p.agingBucket, 1, outstandingDec, provisionDec);
      }
    }

    const byBucket: Record<
      string,
      { count: number; outstanding: number; provision: number; rate: number }
    > = {};
    for (const [bucket, entry] of bucketDec) {
      // Rate derived from the actual data (provision/outstanding) rather than
      // the current rates config — a contract's persisted provision reflects
      // whatever rate was in effect WHEN it was calculated, which may differ
      // from the live SystemConfig by the time this summary is read. Falls
      // back to the configured rate only for the (should-be-impossible)
      // zero-outstanding case.
      byBucket[bucket] = {
        count: entry.count,
        outstanding: entry.outstanding.toNumber(),
        provision: entry.provision.toNumber(),
        rate: entry.outstanding.gt(0)
          ? entry.provision.div(entry.outstanding).toNumber()
          : (rates[bucket] ?? 0),
      };
    }

    const summary = {
      totalOutstanding: totalOutstandingDec.toNumber(),
      totalProvision: totalProvisionDec.toNumber(),
      byBucket,
      details: provisions.map((p) => ({
        contractId: p.contractId,
        contractNumber: p.contract.contractNumber,
        customerName: p.contract.customer?.name,
        agingBucket: p.agingBucket,
        daysOverdue: p.daysOverdue,
        outstandingAmount: new Decimal(p.outstandingAmount.toString()).toNumber(),
        provisionRate: Number(p.provisionRate),
        provisionAmount: new Decimal(p.provisionAmount.toString()).toNumber(),
        // Passthrough (Task 7) — per-bucket breakdown for this contract's
        // provision, null for legacy pre-migration rows.
        bucketBreakdown: (p.bucketBreakdown as Record<
          string,
          { count: number; base: string; provision: string }
        > | null) ?? null,
      })),
    };

    return summary;
  }

  /**
   * Write off a bad debt (ตัดหนี้สูญ)
   *
   * T3-C6 — amount-based approval tiers (phone-shop pricing reality):
   *   0-10,000฿:  writer BM/ACCT/FM/OWNER,  approver must be BM/FM/OWNER
   *   10,000-30,000฿: approver must be FM or OWNER
   *   30,000฿+:  approver must be OWNER, writer must be FM or OWNER
   *
   * Writer and approver must always be different people (Segregation of Duties
   * — pre-existing rule).
   */
  private assertWriteOffTierPermitted(
    outstandingAmount: number,
    writerRole: string,
    approverRole: string,
  ): void {
    const approverAllowedByTier =
      outstandingAmount <= 10_000
        ? ['BRANCH_MANAGER', 'FINANCE_MANAGER', 'OWNER']
        : outstandingAmount <= 30_000
          ? ['FINANCE_MANAGER', 'OWNER']
          : ['OWNER'];

    if (!approverAllowedByTier.includes(approverRole)) {
      throw new ForbiddenException(
        `ตัดหนี้สูญ ${outstandingAmount.toLocaleString()} บาท ต้องอนุมัติโดย ${approverAllowedByTier.join(' หรือ ')} (ปัจจุบัน: ${approverRole})`,
      );
    }

    // Top tier (>30k) also constrains who can _originate_ the request so the
    // OWNER isn't paired with a low-privilege writer who might not
    // understand what they are signing off on.
    if (outstandingAmount > 30_000) {
      const writerAllowed = ['FINANCE_MANAGER', 'OWNER'];
      if (!writerAllowed.includes(writerRole)) {
        throw new ForbiddenException(
          `ตัดหนี้สูญ > 30,000 บาท ผู้ขอต้องเป็น FINANCE_MANAGER หรือ OWNER (ปัจจุบัน: ${writerRole})`,
        );
      }
    }
  }

  async writeOffBadDebt(
    contractId: string,
    writtenOffById: string,
    approvedById: string,
    notes?: string,
  ) {
    if (writtenOffById === approvedById) {
      throw new BadRequestException('ผู้ตัดหนี้สูญต้องไม่ใช่ผู้อนุมัติ');
    }

    // Resolve both users' roles up front so we can apply the T3-C6 tier
    // rules before any write.
    const [writer, approver] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: writtenOffById },
        select: { id: true, role: true, isActive: true, deletedAt: true },
      }),
      this.prisma.user.findUnique({
        where: { id: approvedById },
        select: { id: true, role: true, isActive: true, deletedAt: true },
      }),
    ]);
    if (!writer || !writer.isActive || writer.deletedAt) {
      throw new NotFoundException('ไม่พบผู้ขอตัดหนี้สูญ หรือถูกปิดการใช้งาน');
    }
    if (!approver || !approver.isActive || approver.deletedAt) {
      throw new NotFoundException('ไม่พบผู้อนุมัติ หรือถูกปิดการใช้งาน');
    }

    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');
    if (contract.status === 'CLOSED_BAD_DEBT') {
      throw new BadRequestException('สัญญานี้ถูกตัดหนี้สูญไปแล้ว');
    }
    if (contract.status !== 'TERMINATED') {
      throw new BadRequestException(
        'ตัดหนี้สูญได้เฉพาะสัญญาที่บอกเลิกแล้ว (TERMINATED) — กรุณาออกหนังสือบอกเลิก (CONTRACT_TERMINATION_60D) และบันทึกการส่ง EMS ก่อน (ปพพ.386)',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Calculate outstanding amount from unpaid/partial payments (Decimal arithmetic)
      const unpaidPayments = await tx.payment.findMany({
        where: {
          contractId,
          // OVERDUE included (2026-07-24 hotfix): overdue-lifecycle cron flips past-due
        // payments PENDING → OVERDUE on prod — excluding it made ECL blind to every
        // aged installment (ConsecutiveMissedService already counts OVERDUE; now consistent)
        status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
          deletedAt: null,
        },
        select: { amountDue: true, amountPaid: true },
      });
      const outstandingDec = unpaidPayments.reduce(
        (sum, p) => sum.add(this.computeOutstanding(p)),
        new Decimal(0),
      );
      const outstandingAmount = outstandingDec.toNumber();

      // T3-C6 — enforce amount-tier approval rule before any write.
      this.assertWriteOffTierPermitted(outstandingAmount, writer.role, approver.role);

      // Capture provision amount from the real 11-2102 GL balance — NOT the
      // badDebtProvision rows. BadDebtWriteOffTemplate derives its
      // provisionConsumed the same way; if a past provision JE ever failed
      // silently the DB rows and the GL can diverge, and this audit log must
      // report what the JE actually consumed, not what the rows claim.
      const existingProvisionDec = await this.glBalance(contractId, '11-2102', 'cr', tx);
      const existingProvisionAmount = existingProvisionDec.toNumber();

      // Update contract status to CLOSED_BAD_DEBT
      await tx.contract.update({
        where: { id: contractId },
        data: { status: 'CLOSED_BAD_DEBT' },
      });

      // Update active provisions to WRITTEN_OFF
      await tx.badDebtProvision.updateMany({
        where: { contractId, status: 'ACTIVE', deletedAt: null },
        data: {
          status: 'WRITTEN_OFF',
          writtenOffAt: new Date(),
          writtenOffById,
          approvedById,
          approvedAt: new Date(),
          notes,
        },
      });

      // Phase A.5a + Wave 1 Task 5: write-off JE inside same $transaction.
      // Template now accepts tx parameter (Task 1) — JE failure rolls back the whole
      // write-off. No more silent fail / orphan AR (TFRS 9 Critical 1).
      const woResult = await this.badDebtWriteOffTemplate.execute(
        {
          contractId,
          writeOffReason: notes ?? undefined,
        },
        tx,
      );

      // Phase 3 Task 3: auto-issue ใบลดหนี้ (CN) for accrued-unpaid
      // installments swept by the write-off JE — MUST stay inside this same
      // tx (atomic with the JE: throw here rolls back the whole write-off).
      // LINE delivery of the CN is intentionally NOT triggered here (Task 5)
      // — must only fire after the $transaction commits, otherwise a
      // rollback could hand the customer a link to a receipt that was never
      // actually created.
      const cnResult = await this.creditNoteDocumentService.issueForContract(
        {
          contractId,
          source: 'WRITE_OFF',
          sourceJournalEntryNo: woResult.entryNo,
          actorUserId: writtenOffById,
        },
        tx,
      );
      const creditNote = {
        outcome: cnResult.outcome,
        receiptId: cnResult.outcome === 'ISSUED' ? cnResult.receiptId : undefined,
      };

      // T1-C7: Immutable audit log inside the same transaction. Captures
      // both parties' roles at write-off time (role can change later, the
      // snapshot cannot). Insertion failure = whole write-off rolls back.
      await tx.badDebtWriteOffAuditLog.create({
        data: {
          contractId: contract.id,
          contractNumber: contract.contractNumber,
          outstandingAmount,
          provisionAmount: existingProvisionAmount,
          writtenOffById,
          writtenOffByRole: writer.role,
          approvedById,
          approvedByRole: approver.role,
          notes,
        },
      });

      return { contractId, status: 'CLOSED_BAD_DEBT', writtenOffAt: new Date(), creditNote };
    });

    // Phase 3 Task 5: LINE delivery of the auto-issued CN fires ONLY after the
    // $transaction above has committed — firing it from inside the tx would
    // risk handing the customer a link to a receipt a later rollback erased.
    // Fire-and-forget: never await, never let a delivery failure surface to
    // the caller.
    if (result.creditNote?.outcome === 'ISSUED' && result.creditNote.receiptId) {
      void this.cnDeliveryService
        .deliver(result.creditNote.receiptId)
        .catch((err) => Sentry.captureException(err));
    }

    return result;
  }

  /**
   * Fully releases an ACTIVE provision back to P&L (toBucket: 'CURRENT') and
   * marks it REVERSED. Shared by both the non-TERMINATED "fully current"
   * early-exit and the TERMINATED "carrying amount settled" path in
   * `reverseStageOnPayment` — same JE + same status transition either way.
   */
  private async fullReverseProvision(
    contractId: string,
    existing: { id: string; provisionAmount: Prisma.Decimal; agingBucket: string },
    db: Prisma.TransactionClient | PrismaService,
    tx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; reverseAmount: string; fromBucket: string; toBucket: string } | null> {
    const rowAmount = new Decimal(existing.provisionAmount.toString());
    // I1: cap the release at what the GL actually holds on 11-2102. The
    // BadDebtProvision row is only ever as trustworthy as the JE that posted
    // it — if a past provision JE ever failed silently the row can claim more
    // than the GL has, and releasing more than that would falsely credit
    // 51-1103 (reversed ECL expense) with money that was never provisioned.
    const glBal = await this.glBalance(contractId, '11-2102', 'cr', db);
    const reverseAmount = Decimal.min(rowAmount, glBal);
    if (reverseAmount.lte(0)) {
      // Nothing left on the GL to release (or the row itself was already
      // zero) — the row is operationally dead either way, so mark it
      // REVERSED without posting a JE for zero/negative money.
      await db.badDebtProvision.update({
        where: { id: existing.id },
        data: { status: 'REVERSED' },
      });
      return null;
    }
    const result = await this.eclStageReverseTemplate.execute(
      {
        contractId,
        reverseAmount,
        fromBucket: existing.agingBucket,
        toBucket: 'CURRENT',
      },
      tx,
    );
    if (!result) return null;
    await db.badDebtProvision.update({
      where: { id: existing.id },
      data: { status: 'REVERSED' },
    });
    return {
      entryNo: result.entryNo,
      reverseAmount: reverseAmount.toFixed(2),
      fromBucket: existing.agingBucket,
      toBucket: 'CURRENT',
    };
  }

  /**
   * ECL Stage Reverse on payment (CPA Policy A §3.6 → per-installment engine,
   * Task 4 2026-07-26).
   *
   * Called from PaymentReceipt2BTemplate / payments.service after a successful
   * payment posts. Recomputes the contract's TARGET provision using the exact
   * same per-installment engine + math as `calculateProvisions`
   * (`computeInstallmentOutstanding(..., { selection: 'DUE' })` →
   * `computePerInstallmentProvision`) — never a separate formula, so the
   * real-time payment hook and the daily cron can never compute a different
   * number for the same contract state.
   *
   * release = min(existing.provisionAmount − target, GL 11-2102) when > 0.
   * target === 0 (no outstanding installments left) → full release via the
   * shared `fullReverseProvision` helper (already GL-capped). TERMINATED
   * contracts are NOT special-cased anymore — the old GL-carrying-amount
   * override (`terminatedCarryingAmount`, reading 11-2103/11-2101/11-2106)
   * is retired; a TERMINATED contract's outstanding installments age exactly
   * like an ACTIVE one's.
   *
   * Pass `tx` to chain into the caller's transaction so a JE failure rolls
   * back the parent receipt JE. Returns null when no reverse is needed (no
   * ACTIVE provision, or the target didn't drop below the persisted amount).
   *
   * fromBucket/toBucket on the returned metadata (and the JE) are cosmetic —
   * "bucket of the oldest outstanding installment" before/after, same as
   * `calculateProvisions`'s `agingBucket` display convention. They do not
   * drive the release math (the release is amount-based, not rate-based).
   */
  async reverseStageOnPayment(
    contractId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; reverseAmount: string; fromBucket: string; toBucket: string } | null> {
    const db = tx ?? this.prisma;

    const existing = await db.badDebtProvision.findFirst({
      where: { contractId, status: 'ACTIVE', deletedAt: null },
      orderBy: { provisionDate: 'desc' },
    });
    if (!existing) return null;

    const contract = await db.contract.findUnique({
      where: { id: contractId },
      select: {
        id: true,
        totalMonths: true,
        financedAmount: true,
        storeCommission: true,
        interestTotal: true,
        vatAmount: true,
      },
    });
    // Defensive — contract vanished between the provision row existing and
    // this payment posting (should not happen in practice).
    if (!contract) return null;

    const now = new Date();
    const { rows } = await computeInstallmentOutstanding(db, contract, {
      selection: 'DUE',
      asOf: now,
    });

    if (rows.length === 0) {
      // No outstanding installments left (fully current / fully paid off) —
      // target is 0 → full release, same path for ACTIVE and TERMINATED.
      return this.fullReverseProvision(contractId, existing, db, tx);
    }

    const rates = await this.getProvisionRates();
    // Streak floor is opt-in (2026-07-26 semantics, see getStreakBucketMap) —
    // skip the streak query entirely when no map is configured.
    const streakMap = await this.getStreakBucketMap();
    const streaks = streakMap
      ? await this.consecutiveMissed.getStreaks({ contractIds: [contractId] }, now, db)
      : new Map<string, number>();
    const floorBucket = streakMap ? this.streakToBucket(streaks.get(contractId) ?? 0, streakMap) : null;

    const { bucketAgg, contractOutstanding, contractProvision, oldest } =
      this.computePerInstallmentProvision(rows, rates, floorBucket);

    const target = contractProvision.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const rowDelta = new Decimal(existing.provisionAmount.toString()).sub(target);
    if (rowDelta.lte(0)) return null; // Target didn't drop (cron owns any increase)

    const outstandingDec = contractOutstanding.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const newBucket = this.effectiveBucket(this.getAgingBucket(oldest.daysOverdue ?? 0), floorBucket, rates);
    const provisionRateDec = outstandingDec.gt(0)
      ? contractProvision.div(outstandingDec).toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      : new Decimal(0);
    const bucketBreakdown: Record<string, { count: number; base: string; provision: string }> = {};
    for (const [b, agg] of Object.entries(bucketAgg)) {
      bucketBreakdown[b] = { count: agg.count, base: agg.base.toFixed(2), provision: agg.provision.toFixed(2) };
    }

    // I1: cap the release at what the GL actually holds on 11-2102 — same
    // rationale as fullReverseProvision. The row-based delta can overstate a
    // real GL balance if a past provision JE ever failed silently.
    const glBal = await this.glBalance(contractId, '11-2102', 'cr', db);
    const reverseAmount = Decimal.min(rowDelta, glBal);

    const rowUpdateData = {
      agingBucket: newBucket,
      daysOverdue: oldest.daysOverdue ?? 0,
      outstandingAmount: outstandingDec,
      provisionRate: new Prisma.Decimal(provisionRateDec.toString()),
      provisionAmount: target,
      bucketBreakdown,
    };

    if (reverseAmount.lte(0)) {
      // GL has no room left to release — skip the JE, but the aging state
      // still moved, so the row still needs to reflect the new bucket/amount.
      await db.badDebtProvision.update({ where: { id: existing.id }, data: rowUpdateData });
      return null;
    }

    const result = await this.eclStageReverseTemplate.execute(
      {
        contractId,
        reverseAmount,
        fromBucket: existing.agingBucket,
        toBucket: newBucket,
      },
      tx,
    );
    if (!result) return null;

    await db.badDebtProvision.update({
      where: { id: existing.id },
      data: rowUpdateData,
    });

    return {
      entryNo: result.entryNo,
      reverseAmount: reverseAmount.toFixed(2),
      fromBucket: existing.agingBucket,
      toBucket: newBucket,
    };
  }
}
