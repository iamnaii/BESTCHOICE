import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Recovery analytics by dunning channel (P2 Task 8 / E3).
 *
 * For each DunningAction in [from, to] window, mark "recovered" if the
 * associated contract received a Payment (paidDate IS NOT NULL) within
 * 7 days inclusive AFTER the action's `executedAt`. Aggregate per
 * channel: actions sent, recovered count, recovery rate (%) and the
 * average baht recovered per recovered action.
 *
 * Channel mapping for the UI: `CALL_TASK` is surfaced as `CALL` for
 * brevity in the chart legend; `INTERNAL_ALERT` is kept as-is so the
 * owner can see internal-only nudges separately.
 *
 * The 7-day window is inclusive on both ends — i.e. a payment whose
 * `paid_date` equals `executed_at` (same instant) counts, and so does
 * one paid exactly 7 × 24h later. Window definition matches CEO spec.
 */
export type RecoveryChannel = 'LINE' | 'SMS' | 'CALL' | 'INTERNAL_ALERT';

export interface RecoveryByChannelRow {
  channel: RecoveryChannel;
  actionsSent: number;
  recovered: number;
  recoveryRate: number; // 0-100, 1 decimal
  avgRecoveryAmount: number; // baht, integer
}

interface RawRow {
  channel: string;
  actions_sent: bigint;
  recovered: bigint;
  recovered_amount: number | string | null;
}

const ALL_CHANNELS: RecoveryChannel[] = ['LINE', 'SMS', 'CALL', 'INTERNAL_ALERT'];

@Injectable()
export class AnalyticsRecoveryService {
  private readonly logger = new Logger(AnalyticsRecoveryService.name);

  constructor(private prisma: PrismaService) {}

  async getRecoveryByChannel(params: {
    from: Date;
    to: Date;
  }): Promise<RecoveryByChannelRow[]> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<RawRow[]>(
        `
        WITH actions_in_range AS (
          SELECT
            da.id,
            da.contract_id,
            da.channel::text AS channel,
            da.executed_at
          FROM dunning_actions da
          WHERE da.deleted_at IS NULL
            AND da.executed_at IS NOT NULL
            AND da.executed_at >= $1
            AND da.executed_at <= $2
            AND da.status IN ('SENT', 'DELIVERED')
        ),
        with_recovery AS (
          SELECT
            air.id,
            air.channel,
            (
              SELECT MIN(p.amount_paid)
              FROM payments p
              WHERE p.contract_id = air.contract_id
                AND p.deleted_at IS NULL
                AND p.paid_date IS NOT NULL
                AND p.paid_date >= air.executed_at
                AND p.paid_date <= air.executed_at + INTERVAL '7 days'
            ) AS recovered_amount
          FROM actions_in_range air
        )
        SELECT
          channel,
          COUNT(*)::bigint AS actions_sent,
          COUNT(recovered_amount)::bigint AS recovered,
          COALESCE(AVG(recovered_amount), 0)::numeric AS recovered_amount
        FROM with_recovery
        GROUP BY channel
        `,
        params.from,
        params.to,
      );

      const map = new Map<RecoveryChannel, RecoveryByChannelRow>();
      for (const ch of ALL_CHANNELS) {
        map.set(ch, {
          channel: ch,
          actionsSent: 0,
          recovered: 0,
          recoveryRate: 0,
          avgRecoveryAmount: 0,
        });
      }

      for (const r of rows) {
        const ch = this.mapChannel(r.channel);
        if (!ch) continue;
        const sent = Number(r.actions_sent);
        const rec = Number(r.recovered);
        const avg = r.recovered_amount == null ? 0 : Number(r.recovered_amount);
        map.set(ch, {
          channel: ch,
          actionsSent: sent,
          recovered: rec,
          recoveryRate: sent > 0 ? Math.round((rec / sent) * 1000) / 10 : 0,
          avgRecoveryAmount: Math.round(avg),
        });
      }

      return ALL_CHANNELS.map((c) => map.get(c)!);
    } catch (err) {
      this.logger.error('recovery-by-channel query failed', err);
      return ALL_CHANNELS.map((c) => ({
        channel: c,
        actionsSent: 0,
        recovered: 0,
        recoveryRate: 0,
        avgRecoveryAmount: 0,
      }));
    }
  }

  private mapChannel(raw: string): RecoveryChannel | null {
    switch (raw) {
      case 'LINE':
        return 'LINE';
      case 'SMS':
        return 'SMS';
      case 'CALL_TASK':
        return 'CALL';
      case 'INTERNAL_ALERT':
        return 'INTERNAL_ALERT';
      default:
        return null;
    }
  }
}
