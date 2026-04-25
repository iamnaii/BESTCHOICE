import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type ContactTimeBucket = 'MORNING' | 'AFTERNOON' | 'EVENING';
export type InsightChannel = 'LINE' | 'SMS' | 'CALL';

export interface CustomerInsights {
  preferredContactTime: ContactTimeBucket | null;
  preferredChannel: InsightChannel | null;
  channelResponseRates: Partial<Record<InsightChannel, number>>;
  lineOnlineAt: Date | null;
}

/**
 * Smart Customer Data Panel (P2 Task 5).
 *
 * Aggregates per-customer behaviour signals for the Collections "Customer 360" view:
 *
 * - **Preferred contact time** — bucket the calledAt of ANSWERED CallLogs
 *   into MORNING / AFTERNOON / EVENING (Bangkok wall-clock) and pick the
 *   bucket with the most answered calls.
 *
 *   Hour buckets (Asia/Bangkok, UTC+7, no DST):
 *     06:00–12:00  → MORNING
 *     12:00–18:00  → AFTERNOON
 *     18:00–24:00  → EVENING
 *     00:00–06:00  → ignored (graveyard hours rarely useful for outreach)
 *
 * - **Preferred channel** — pick the DunningChannel with highest absolute
 *   `DELIVERED` count (not rate) to favour channels that actually reach the
 *   customer in volume.
 *
 * - **Channel response rates** — `delivered / total * 100` (rounded) per
 *   channel from DunningAction history. CALL_TASK is reported as `CALL`.
 *
 * - **lineOnlineAt** — most recent `ChatRoom.lastMessageAt` for any LINE
 *   channel chat room owned by this customer (proxy for "saw a LINE message
 *   from us recently").
 */
@Injectable()
export class CustomerInsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async getInsights(
    customerId: string,
    requester?: { role?: string; branchId?: string | null },
  ): Promise<CustomerInsights> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException('ไม่พบลูกค้านี้');
    }

    // Z6: SALES users may only see insights for customers with at least one
    // contract in their branch. Cross-branch roles (OWNER/FM/Acct/BM) bypass
    // — BRANCH_MANAGER is naturally branch-scoped at higher layers.
    if (requester?.role === 'SALES' && requester.branchId) {
      const sameBranch = await this.prisma.contract.findFirst({
        where: {
          customerId,
          branchId: requester.branchId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!sameBranch) {
        throw new ForbiddenException('ลูกค้านี้ไม่ได้อยู่ในสาขาของคุณ');
      }
    }

    // Pull CallLogs via the customer's contracts. Only ANSWERED calls
    // contribute to the preferred-time signal.
    const callLogs = await this.prisma.callLog.findMany({
      where: {
        deletedAt: null,
        contract: { customerId, deletedAt: null },
      },
      select: { callResult: true, calledAt: true },
    });

    const dunningActions = await this.prisma.dunningAction.findMany({
      where: {
        deletedAt: null,
        contract: { customerId, deletedAt: null },
      },
      select: { channel: true, status: true },
    });

    const room = await this.prisma.chatRoom.findFirst({
      where: { customerId, deletedAt: null },
      orderBy: { lastMessageAt: 'desc' },
      select: { lastMessageAt: true },
    });

    return {
      preferredContactTime: this.computePreferredTime(callLogs),
      preferredChannel: this.computePreferredChannel(dunningActions),
      channelResponseRates: this.computeChannelRates(dunningActions),
      lineOnlineAt: room?.lastMessageAt ?? null,
    };
  }

  private computePreferredTime(
    callLogs: Array<{ callResult: string | null; calledAt: Date }>,
  ): ContactTimeBucket | null {
    const counts: Record<ContactTimeBucket, number> = {
      MORNING: 0,
      AFTERNOON: 0,
      EVENING: 0,
    };
    for (const log of callLogs) {
      if (log.callResult !== 'ANSWERED') continue;
      const bucket = bangkokHourBucket(log.calledAt);
      if (bucket) counts[bucket]++;
    }
    const total = counts.MORNING + counts.AFTERNOON + counts.EVENING;
    if (total === 0) return null;
    let best: ContactTimeBucket = 'MORNING';
    let bestN = counts.MORNING;
    if (counts.AFTERNOON > bestN) {
      best = 'AFTERNOON';
      bestN = counts.AFTERNOON;
    }
    if (counts.EVENING > bestN) {
      best = 'EVENING';
    }
    return best;
  }

  private computeChannelRates(
    actions: Array<{ channel: string; status: string }>,
  ): Partial<Record<InsightChannel, number>> {
    const totals: Partial<Record<InsightChannel, { delivered: number; total: number }>> = {};
    for (const a of actions) {
      const ch = mapDunningChannel(a.channel);
      if (!ch) continue;
      const slot = totals[ch] ?? { delivered: 0, total: 0 };
      slot.total++;
      if (a.status === 'DELIVERED') slot.delivered++;
      totals[ch] = slot;
    }
    const out: Partial<Record<InsightChannel, number>> = {};
    for (const ch of Object.keys(totals) as InsightChannel[]) {
      const slot = totals[ch]!;
      out[ch] = slot.total === 0 ? 0 : Math.round((slot.delivered / slot.total) * 100);
    }
    return out;
  }

  private computePreferredChannel(
    actions: Array<{ channel: string; status: string }>,
  ): InsightChannel | null {
    const delivered: Partial<Record<InsightChannel, number>> = {};
    for (const a of actions) {
      if (a.status !== 'DELIVERED') continue;
      const ch = mapDunningChannel(a.channel);
      if (!ch) continue;
      delivered[ch] = (delivered[ch] ?? 0) + 1;
    }
    const entries = Object.entries(delivered) as Array<[InsightChannel, number]>;
    if (entries.length === 0) return null;
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0];
  }
}

function mapDunningChannel(raw: string): InsightChannel | null {
  switch (raw) {
    case 'LINE':
      return 'LINE';
    case 'SMS':
      return 'SMS';
    case 'CALL_TASK':
      return 'CALL';
    default:
      return null; // INTERNAL_ALERT and friends are not customer-facing
  }
}

/**
 * Convert a UTC Date into the Bangkok hour bucket. Asia/Bangkok is fixed
 * UTC+7 (no DST) so we can shift by +7h and read the calendar hour.
 *
 * Returns null for the 00:00–06:00 window since outreach is not allowed
 * (and would skew the "best time to call" signal toward graveyard noise).
 */
function bangkokHourBucket(date: Date): ContactTimeBucket | null {
  const bangkok = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const hour = bangkok.getUTCHours();
  if (hour >= 6 && hour < 12) return 'MORNING';
  if (hour >= 12 && hour < 18) return 'AFTERNOON';
  if (hour >= 18 && hour < 24) return 'EVENING';
  return null;
}
