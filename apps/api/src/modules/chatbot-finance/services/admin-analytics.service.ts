import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatChannel, MessageRole, Prisma } from '@prisma/client';

export interface AnalyticsOverview {
  today: {
    sessions: number;
    messages: number;
    handoffs: number;
    autoTriggers: number;
    totalCostUsd: number;
  };
  total: {
    sessions: number;
    verifiedCustomers: number;
    activeHandoffs: number;
    knowledgeEntries: number;
  };
  topIntents: { intent: string; count: number }[];
  recentDays: { date: string; messages: number }[];
}

/**
 * Admin analytics — read-only stats สำหรับหน้า dashboard
 */
@Injectable()
export class AdminAnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getOverview(): Promise<AnalyticsOverview> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const [
      sessionsToday,
      messagesToday,
      handoffsToday,
      autoTriggersToday,
      todayCostAgg,
      totalSessions,
      verifiedCustomers,
      activeHandoffs,
      knowledgeEntries,
      topIntentsRaw,
      recentDaysRaw,
    ] = await Promise.all([
      this.prisma.chatSession.count({
        where: { channel: ChatChannel.LINE_FINANCE, createdAt: { gte: startOfToday } },
      }),
      this.prisma.chatMessage.count({
        where: {
          createdAt: { gte: startOfToday },
          session: { channel: ChatChannel.LINE_FINANCE },
        },
      }),
      this.prisma.chatSession.count({
        where: {
          channel: ChatChannel.LINE_FINANCE,
          handoffMode: true,
          handoffTaggedAt: { gte: startOfToday },
        },
      }),
      this.prisma.chatMessage.count({
        where: {
          createdAt: { gte: startOfToday },
          role: MessageRole.AUTO_TRIGGER,
          session: { channel: ChatChannel.LINE_FINANCE },
        },
      }),
      this.prisma.chatMessage.aggregate({
        where: {
          createdAt: { gte: startOfToday },
          session: { channel: ChatChannel.LINE_FINANCE },
        },
        _sum: { costUsd: true },
      }),
      this.prisma.chatSession.count({
        where: { channel: ChatChannel.LINE_FINANCE, deletedAt: null },
      }),
      this.prisma.customerLineLink.count({
        where: { channel: 'FINANCE', unlinkedAt: null },
      }),
      this.prisma.chatSession.count({
        where: { channel: ChatChannel.LINE_FINANCE, handoffMode: true },
      }),
      this.prisma.chatKnowledgeBase.count({
        where: { channel: ChatChannel.LINE_FINANCE, active: true, deletedAt: null },
      }),
      this.prisma.$queryRaw<{ intent: string; count: bigint }[]>`
        SELECT intent, COUNT(*)::bigint AS count
        FROM chat_messages cm
        JOIN chat_sessions cs ON cs.id = cm.session_id
        WHERE cs.channel = 'LINE_FINANCE'
          AND cm.intent IS NOT NULL
          AND cm.created_at >= ${sevenDaysAgo}
        GROUP BY intent
        ORDER BY count DESC
        LIMIT 10
      `,
      this.prisma.$queryRaw<{ date: Date; count: bigint }[]>`
        SELECT date_trunc('day', cm.created_at) AS date, COUNT(*)::bigint AS count
        FROM chat_messages cm
        JOIN chat_sessions cs ON cs.id = cm.session_id
        WHERE cs.channel = 'LINE_FINANCE'
          AND cm.created_at >= ${sevenDaysAgo}
        GROUP BY date_trunc('day', cm.created_at)
        ORDER BY date ASC
      `,
    ]);

    return {
      today: {
        sessions: sessionsToday,
        messages: messagesToday,
        handoffs: handoffsToday,
        autoTriggers: autoTriggersToday,
        totalCostUsd: new Prisma.Decimal(todayCostAgg._sum.costUsd ?? 0).toNumber(),
      },
      total: {
        sessions: totalSessions,
        verifiedCustomers,
        activeHandoffs,
        knowledgeEntries,
      },
      topIntents: topIntentsRaw.map((r) => ({
        intent: r.intent,
        count: Number(r.count),
      })),
      recentDays: recentDaysRaw.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        messages: Number(r.count),
      })),
    };
  }

  // ─── Date-range analytics with cost breakdown ────────────

  async getDateRangeStats(startDate: Date, endDate: Date) {
    const [dailyStats, totalCostAgg, handoffCount] = await Promise.all([
      this.prisma.$queryRaw<{ date: Date; messages: bigint; cost: number }[]>`
        SELECT
          date_trunc('day', cm.created_at) AS date,
          COUNT(*)::bigint AS messages,
          COALESCE(SUM(cm.cost_usd), 0)::float AS cost
        FROM chat_messages cm
        JOIN chat_sessions cs ON cs.id = cm.session_id
        WHERE cs.channel = 'LINE_FINANCE'
          AND cm.created_at >= ${startDate}
          AND cm.created_at <= ${endDate}
        GROUP BY date_trunc('day', cm.created_at)
        ORDER BY date ASC
      `,
      this.prisma.chatMessage.aggregate({
        where: {
          createdAt: { gte: startDate, lte: endDate },
          session: { channel: ChatChannel.LINE_FINANCE },
        },
        _sum: { costUsd: true },
      }),
      this.prisma.chatSession.count({
        where: {
          channel: ChatChannel.LINE_FINANCE,
          handoffMode: true,
          handoffTaggedAt: { gte: startDate, lte: endDate },
        },
      }),
    ]);

    return {
      dailyStats: dailyStats.map((d) => ({
        date: d.date.toISOString().slice(0, 10),
        messages: Number(d.messages),
        cost: Number(d.cost),
      })),
      totalCost: new Prisma.Decimal(totalCostAgg._sum.costUsd ?? 0).toNumber(),
      totalMessages: dailyStats.reduce((s, d) => s + Number(d.messages), 0),
      handoffs: handoffCount,
    };
  }

  // ─── Sessions list with filters ──────────────────────────

  async listSessions(params: {
    page: number;
    limit: number;
    search?: string;
    handoffOnly?: boolean;
  }) {
    const skip = (params.page - 1) * params.limit;

    const where = {
      channel: ChatChannel.LINE_FINANCE,
      deletedAt: null,
      ...(params.handoffOnly ? { handoffMode: true } : {}),
      ...(params.search
        ? {
            OR: [
              { customer: { name: { contains: params.search, mode: 'insensitive' as const } } },
              { customer: { phone: { contains: params.search } } },
              { lineUserId: { contains: params.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.chatSession.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: params.limit,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          handoffStaff: { select: { id: true, name: true } },
        },
      }),
      this.prisma.chatSession.count({ where }),
    ]);

    return { items, total, page: params.page, limit: params.limit };
  }

  async getSessionDetail(sessionId: string) {
    return this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        handoffStaff: { select: { id: true, name: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 200, // limit ป้องกัน load หนัก
        },
      },
    });
  }

  async returnToBot(sessionId: string) {
    return this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        handoffMode: false,
        handoffReason: null,
        handoffStaffId: null,
        handoffTaggedAt: null,
      },
    });
  }
}
