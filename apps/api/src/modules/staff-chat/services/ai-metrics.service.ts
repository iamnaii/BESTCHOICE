import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface AiMetrics {
  autoReplyRate: number;
  handoffRate: number;
  acceptRate: number;
  editRate: number;
  rejectRate: number;
  avgConfidence: number;
  totalTrainingPairs: number;
  usableTrainingPairs: number;
}

@Injectable()
export class AiMetricsService {
  constructor(private prisma: PrismaService) {}

  async getMetrics(from?: Date, to?: Date): Promise<AiMetrics> {
    const dateFilter = { ...(from && { gte: from }), ...(to && { lte: to }) };
    const hasDateFilter = from || to;

    const autoLogs = await this.prisma.aiAutoReplyLog.findMany({
      where: hasDateFilter ? { createdAt: dateFilter } : {},
      select: { autoSent: true, confidence: true },
    });

    const totalAuto = autoLogs.length;
    const autoSent = autoLogs.filter((l) => l.autoSent).length;
    const avgConfidence =
      totalAuto > 0 ? autoLogs.reduce((sum, l) => sum + l.confidence, 0) / totalAuto : 0;

    const feedbacks = await this.prisma.aiTrainingPair.findMany({
      where: {
        source: 'SUGGEST_FEEDBACK',
        ...(hasDateFilter ? { createdAt: dateFilter } : {}),
      },
      select: { type: true },
    });

    const totalFeedback = feedbacks.length;
    const accepts = feedbacks.filter((f) => f.type === 'ACCEPT').length;
    const edits = feedbacks.filter((f) => f.type === 'EDIT').length;
    const rejects = feedbacks.filter((f) => f.type === 'REJECT').length;

    const totalPairs = await this.prisma.aiTrainingPair.count();
    const usablePairs = await this.prisma.aiTrainingPair.count({
      where: { quality: { gte: 0.7 } },
    });

    return {
      autoReplyRate: totalAuto > 0 ? (autoSent / totalAuto) * 100 : 0,
      handoffRate: totalAuto > 0 ? ((totalAuto - autoSent) / totalAuto) * 100 : 0,
      acceptRate: totalFeedback > 0 ? (accepts / totalFeedback) * 100 : 0,
      editRate: totalFeedback > 0 ? (edits / totalFeedback) * 100 : 0,
      rejectRate: totalFeedback > 0 ? (rejects / totalFeedback) * 100 : 0,
      avgConfidence: avgConfidence * 100,
      totalTrainingPairs: totalPairs,
      usableTrainingPairs: usablePairs,
    };
  }
}
