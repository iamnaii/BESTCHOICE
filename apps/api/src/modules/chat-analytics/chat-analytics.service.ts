import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatSessionStatus, MessageRole } from '@prisma/client';

/**
 * ChatAnalyticsService — aggregates chat metrics for the analytics dashboard.
 *
 * Metrics: response time, resolution rate, channel volume, AI vs human ratio.
 */
@Injectable()
export class ChatAnalyticsService {
  private readonly logger = new Logger(ChatAnalyticsService.name);

  constructor(private prisma: PrismaService) {}

  /** Overview stats for a date range */
  async getOverview(startDate: Date, endDate: Date) {
    const where = {
      createdAt: { gte: startDate, lte: endDate },
      deletedAt: null,
    };

    const [
      totalSessions,
      resolvedSessions,
      handoffSessions,
      totalMessages,
      botMessages,
      staffMessages,
    ] = await Promise.all([
      this.prisma.chatSession.count({ where }),
      this.prisma.chatSession.count({
        where: { ...where, sessionStatus: ChatSessionStatus.RESOLVED },
      }),
      this.prisma.chatSession.count({
        where: { ...where, handoffMode: true },
      }),
      this.prisma.chatMessage.count({
        where: { createdAt: { gte: startDate, lte: endDate }, deletedAt: null },
      }),
      this.prisma.chatMessage.count({
        where: {
          createdAt: { gte: startDate, lte: endDate },
          role: MessageRole.BOT,
          deletedAt: null,
        },
      }),
      this.prisma.chatMessage.count({
        where: {
          createdAt: { gte: startDate, lte: endDate },
          role: MessageRole.STAFF,
          deletedAt: null,
        },
      }),
    ]);

    const resolutionRate =
      totalSessions > 0 ? Math.round((resolvedSessions / totalSessions) * 100) : 0;
    const handoffRate =
      totalSessions > 0 ? Math.round((handoffSessions / totalSessions) * 100) : 0;
    const aiRatio =
      totalMessages > 0 ? Math.round((botMessages / totalMessages) * 100) : 0;

    return {
      totalSessions,
      resolvedSessions,
      handoffSessions,
      totalMessages,
      botMessages,
      staffMessages,
      resolutionRate,
      handoffRate,
      aiRatio,
    };
  }

  /** Volume per channel */
  async getChannelVolume(startDate: Date, endDate: Date) {
    const result = await this.prisma.chatSession.groupBy({
      by: ['channel'],
      where: {
        createdAt: { gte: startDate, lte: endDate },
        deletedAt: null,
      },
      _count: { id: true },
    });

    return result.map((r) => ({
      channel: r.channel,
      count: r._count.id,
    }));
  }

  /** Average first response time (in minutes) */
  async getAvgFirstResponseTime(startDate: Date, endDate: Date) {
    const sessions = await this.prisma.chatSession.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        firstResponseAt: { not: null },
        deletedAt: null,
      },
      select: { createdAt: true, firstResponseAt: true },
    });

    if (sessions.length === 0) return { avgMinutes: 0, sampleSize: 0 };

    const totalMinutes = sessions.reduce((sum, s) => {
      const diff =
        (s.firstResponseAt!.getTime() - s.createdAt.getTime()) / 60000;
      return sum + diff;
    }, 0);

    return {
      avgMinutes: Math.round(totalMinutes / sessions.length),
      sampleSize: sessions.length,
    };
  }
}
