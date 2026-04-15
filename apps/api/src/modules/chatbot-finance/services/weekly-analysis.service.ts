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
 *   1. รวบรวม rooms 7 วันล่าสุดที่ handoff / 👎
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

      // 1. Find rooms with handoff or negative feedback
      const handoffRooms = await this.prisma.chatRoom.findMany({
        where: {
          channel: 'LINE_FINANCE',
          handoffMode: true,
          handoffTaggedAt: { gte: sevenDaysAgo },
        },
        select: { id: true },
      });

      const negativeFeedbackRooms = await this.prisma.chatFeedback.findMany({
        where: {
          rating: 0,
          createdAt: { gte: sevenDaysAgo },
        },
        select: { roomId: true },
        distinct: ['roomId'],
      });

      const roomIds = new Set([
        ...handoffRooms.map((r) => r.id),
        ...negativeFeedbackRooms.map((f) => f.roomId),
      ]);

      if (roomIds.size === 0) {
        this.logger.log('[WeeklyAnalysis] No failed rooms found — nothing to analyze');
        return;
      }

      const roomIdArray = [...roomIds];

      // 2. Batch: find existing suggestions to skip
      const existingSuggestions = await this.prisma.chatKbSuggestion.findMany({
        where: { roomId: { in: roomIdArray }, source: 'auto_analysis' },
        select: { roomId: true },
      });
      const alreadyAnalyzed = new Set(existingSuggestions.map((s) => s.roomId));

      // 3. Batch: get first customer message per room
      const newRoomIds = roomIdArray.filter((id) => !alreadyAnalyzed.has(id));
      if (newRoomIds.length === 0) {
        this.logger.log(`[WeeklyAnalysis] All ${roomIds.size} rooms already analyzed`);
        return;
      }

      const customerMessages = await this.prisma.chatMessage.findMany({
        where: {
          roomId: { in: newRoomIds },
          role: 'CUSTOMER',
          text: { not: null },
        },
        orderBy: { createdAt: 'asc' },
        distinct: ['roomId'],
      });

      // Group by roomId
      const msgByRoom = new Map(customerMessages.map((m) => [m.roomId, m]));

      // 4. Create suggestions
      let created = 0;
      let skipped = alreadyAnalyzed.size;

      for (const roomId of newRoomIds) {
        const msg = msgByRoom.get(roomId);
        if (!msg?.text) {
          skipped++;
          continue;
        }

        await this.prisma.chatKbSuggestion.create({
          data: {
            roomId,
            customerQuestion: msg.text,
            suggestedIntent: msg.intent ?? 'auto_analyzed',
            source: 'auto_analysis',
            status: 'PENDING',
          },
        });
        created++;
      }

      this.logger.log(
        `[WeeklyAnalysis] Done. Rooms analyzed: ${roomIds.size}, Suggestions created: ${created}, Skipped: ${skipped}`,
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
