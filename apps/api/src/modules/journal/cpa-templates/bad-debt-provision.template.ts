import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface BadDebtProvisionInput {
  contractId: string;
  /**
   * SIGNED delta: บวก = ตั้งสำรองเพิ่ม (Dr 51-1103 / Cr 11-2102),
   * ลบ = release สำรอง (Dr 11-2102 / Cr 51-1103). ศูนย์ = skip.
   */
  provisionAmount: Decimal;
  /** Period string e.g. '2026-04' (metadata/description เท่านั้น — ไม่ใช่ idempotency key แล้ว) */
  period: string;
  /** Idempotency key: YYYY-MM-DD (BKK). default = วันนี้เวลา BKK */
  runDate?: string;
}

/**
 * Template — Bad Debt Provision (monthly close, ECL-driven).
 *
 * provisionAmount is a SIGNED delta from the ECL engine:
 *   positive → increase provision:
 *     Dr 51-1103 ค่าเผื่อหนี้สงสัยจะสูญ (เพิ่มในปี)   [amount]
 *       Cr 11-2102 ค่าเผื่อหนี้สงสัยจะสูญ (Contra)      [amount]
 *   negative → release provision:
 *     Dr 11-2102 ค่าเผื่อหนี้สงสัยจะสูญ (Contra)      [amount]
 *       Cr 51-1103 ค่าเผื่อหนี้สงสัยจะสูญ (เพิ่มในปี)   [amount]
 *
 * Idempotent per (flow, contractId, runDate) — a cron re-run on the same
 * BKK day will not double-post, but a different runDate (even same period)
 * posts again. period is descriptive metadata only.
 */
@Injectable()
export class BadDebtProvisionTemplate {
  private readonly logger = new Logger(BadDebtProvisionTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: BadDebtProvisionInput): Promise<{ entryNo: string } | null> {
    const { contractId, provisionAmount, period } = input;
    const runDate =
      input.runDate ??
      new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD

    if (provisionAmount.abs().lt(new Decimal('0.005'))) {
      this.logger.warn(
        `[A.5a] BadDebtProvision skipped — delta=${provisionAmount.toFixed(2)} for contract ${contractId} runDate ${runDate}`,
      );
      return null;
    }

    // Idempotency: (flow, contractId, runDate) — daily cron รันซ้ำวันเดียวกันไม่ post ซ้ำ
    const existing = await this.prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'provision' } } as Prisma.JournalEntryWhereInput,
          { metadata: { path: ['contractId'], equals: contractId } } as Prisma.JournalEntryWhereInput,
          { metadata: { path: ['runDate'], equals: runDate } } as Prisma.JournalEntryWhereInput,
        ],
        deletedAt: null,
      },
    });
    if (existing) {
      this.logger.log(
        `[A.5a] BadDebtProvision idempotency — JE ${existing.entryNumber} already exists for contract ${contractId} runDate ${runDate}, skipping`,
      );
      return { entryNo: existing.entryNumber };
    }

    const zero = new Decimal(0);
    const isRelease = provisionAmount.isNegative();
    const amount = provisionAmount.abs().toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const direction = isRelease ? 'release' : 'increase';

    const lines = isRelease
      ? [
          {
            accountCode: '11-2102',
            dr: amount,
            cr: zero,
            description: `กลับค่าเผื่อหนี้สงสัยจะสูญ (ลดสำรอง) — สัญญา ${contractId.slice(0, 8)}`,
          },
          {
            accountCode: '51-1103',
            dr: zero,
            cr: amount,
            description: `กลับค่าเผื่อหนี้สงสัยจะสูญ (เพิ่มในปี) — ${period}`,
          },
        ]
      : [
          {
            accountCode: '51-1103',
            dr: amount,
            cr: zero,
            description: `ค่าเผื่อหนี้สงสัยจะสูญ (เพิ่มในปี) — ${period}`,
          },
          {
            accountCode: '11-2102',
            dr: zero,
            cr: amount,
            description: `ค่าเผื่อหนี้สงสัยจะสูญ (Contra) — สัญญา ${contractId.slice(0, 8)}`,
          },
        ];

    // I3 — DB-level defense-in-depth (journal_entries_idempotency_idx,
    // P3-SP5 W8): partial unique index on (metadata->>'flow',
    // metadata->>'idempotencyKey'). Same shape as every SHOP template's key.
    const idempotencyKey = `${contractId}:${runDate}`;

    try {
      const result = await this.journal.createAndPost({
        description: `${isRelease ? 'กลับ' : 'ตั้ง'}สำรองหนี้สงสัยจะสูญ — สัญญา ${contractId.slice(0, 8)} งวด ${period}`,
        reference: `${contractId}:bad-debt-provision:${runDate}`,
        metadata: {
          tag: 'BAD-DEBT',
          flow: 'provision',
          idempotencyKey,
          direction,
          contractId,
          period,
          runDate,
          provisionAmount: provisionAmount.toFixed(2),
        },
        lines,
      });

      return { entryNo: result.entryNumber };
    } catch (err) {
      // A concurrent run can race past the findFirst probe above and lose
      // the unique-index race. Translate the P2002 into the same
      // idempotency-hit return shape the probe above would have returned,
      // instead of surfacing a raw constraint error to the caller.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const race = await this.prisma.journalEntry.findFirst({
          where: {
            AND: [
              { metadata: { path: ['flow'], equals: 'provision' } } as Prisma.JournalEntryWhereInput,
              {
                metadata: { path: ['idempotencyKey'], equals: idempotencyKey },
              } as Prisma.JournalEntryWhereInput,
            ],
            deletedAt: null,
          },
        });
        if (race) {
          this.logger.log(
            `[A.5a] BadDebtProvision race — JE ${race.entryNumber} already exists for idempotencyKey ${idempotencyKey} (P2002), returning existing`,
          );
          return { entryNo: race.entryNumber };
        }
      }
      throw err;
    }
  }
}
