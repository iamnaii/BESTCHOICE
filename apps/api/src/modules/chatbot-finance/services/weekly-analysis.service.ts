import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Weekly Analysis — batch analyze failed conversations and generate KB suggestions.
 *
 * Cron: ทุกวันจันทร์ 06:00 Asia/Bangkok
 *
 * Logic:
 *   1. รวบรวม sessions 7 วันล่าสุดที่ handoff / 👎
 *   2. Extract customer question patterns
 *   3. สร้าง KB Suggestions for admin review
 */
@Injectable()
export class WeeklyAnalysisService {
  private readonly logger = new Logger(WeeklyAnalysisService.name);

  constructor(private prisma: PrismaService) {}

  @Cron('0 6 * * 1', { timeZone: 'Asia/Bangkok' })
  async runWeeklyAnalysis(): Promise<void> {
    this.logger.log('[WeeklyAnalysis] === Starting weekly analysis ===');

    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // 1. Find sessions with handoff or negative feedback
      const handoffSessions = await this.prisma.chatSession.findMany({
        where: {
          channel: 'LINE_FINANCE',
          handoffMode: true,
          handoffTaggedAt: { gte: sevenDaysAgo },
        },
        select: { id: true },
      });

      const negativeFeedbackSessions = await this.prisma.chatFeedback.findMany({
        where: {
          rating: 0,
          createdAt: { gte: sevenDaysAgo },
        },
        select: { sessionId: true },
        distinct: ['sessionId'],
      });

      const sessionIds = new Set([
        ...handoffSessions.map((s) => s.id),
        ...negativeFeedbackSessions.map((f) => f.sessionId),
      ]);

      if (sessionIds.size === 0) {
        this.logger.log('[WeeklyAnalysis] No failed sessions found — nothing to analyze');
        return;
      }

      const sessionIdArray = [...sessionIds];

      // 2. Batch: find existing suggestions to skip
      const existingSuggestions = await this.prisma.chatKbSuggestion.findMany({
        where: { sessionId: { in: sessionIdArray }, source: 'auto_analysis' },
        select: { sessionId: true },
      });
      const alreadyAnalyzed = new Set(existingSuggestions.map((s) => s.sessionId));

      // 3. Batch: get first customer message per session
      const newSessionIds = sessionIdArray.filter((id) => !alreadyAnalyzed.has(id));
      if (newSessionIds.length === 0) {
        this.logger.log(`[WeeklyAnalysis] All ${sessionIds.size} sessions already analyzed`);
        return;
      }

      const customerMessages = await this.prisma.chatMessage.findMany({
        where: {
          sessionId: { in: newSessionIds },
          role: 'CUSTOMER',
          text: { not: null },
        },
        orderBy: { createdAt: 'asc' },
        distinct: ['sessionId'],
      });

      // Group by sessionId
      const msgBySession = new Map(customerMessages.map((m) => [m.sessionId, m]));

      // 4. Create suggestions
      let created = 0;
      let skipped = alreadyAnalyzed.size;

      for (const sessionId of newSessionIds) {
        const msg = msgBySession.get(sessionId);
        if (!msg?.text) {
          skipped++;
          continue;
        }

        await this.prisma.chatKbSuggestion.create({
          data: {
            sessionId,
            customerQuestion: msg.text,
            suggestedIntent: msg.intent ?? 'auto_analyzed',
            source: 'auto_analysis',
            status: 'PENDING',
          },
        });
        created++;
      }

      this.logger.log(
        `[WeeklyAnalysis] Done. Sessions analyzed: ${sessionIds.size}, Suggestions created: ${created}, Skipped: ${skipped}`,
      );
    } catch (error) {
      this.logger.error(
        `[WeeklyAnalysis] Failed: ${error instanceof Error ? error.message : error}`,
      );
      Sentry.captureException(error, {
        tags: { kind: 'cron-job', cron: 'weekly-analysis' },
      });
    }
  }
}
