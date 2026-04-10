import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Feedback Service — collect 👍/👎 from customers after tool-use replies.
 *
 * Flow:
 *   1. After bot answers via tool → send Quick Reply "ข้อมูลถูกต้องไหมคะ?"
 *   2. Customer taps 👍 or 👎 → save to ChatFeedback
 *   3. 👎 → create ChatKbSuggestion for admin review
 *   4. Auto-adjust KB priority based on feedback
 *
 * Limit: max 1 feedback request per session per conversation turn.
 */
@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(private prisma: PrismaService) {}

  async saveFeedback(params: {
    lineUserId: string;
    sessionId: string;
    messageId?: string;
    rating: number; // 0=👎, 1=👍
    feedbackText?: string;
  }) {
    // Verify session belongs to this LINE user
    const session = await this.prisma.chatSession.findFirst({
      where: { id: params.sessionId, lineUserId: params.lineUserId },
    });
    if (!session) {
      throw new ForbiddenException('ไม่พบ session');
    }

    const feedback = await this.prisma.chatFeedback.create({
      data: {
        sessionId: params.sessionId,
        messageId: params.messageId,
        rating: params.rating,
        feedbackText: params.feedbackText,
      },
    });

    this.logger.log(
      `[Feedback] session=${params.sessionId} rating=${params.rating === 1 ? '👍' : '👎'}`,
    );

    // 👎 → auto-create KB suggestion for review
    if (params.rating === 0 && params.messageId) {
      await this.createSuggestionFromNegativeFeedback(params.sessionId, params.messageId);
    }

    // Auto-adjust KB priority
    await this.adjustKbPriority(params.sessionId, params.rating);

    return feedback;
  }

  /** Get feedback stats for a date range */
  async getStats(startDate: Date, endDate: Date) {
    const [total, positive, negative] = await Promise.all([
      this.prisma.chatFeedback.count({
        where: { createdAt: { gte: startDate, lte: endDate } },
      }),
      this.prisma.chatFeedback.count({
        where: { createdAt: { gte: startDate, lte: endDate }, rating: 1 },
      }),
      this.prisma.chatFeedback.count({
        where: { createdAt: { gte: startDate, lte: endDate }, rating: 0 },
      }),
    ]);

    return {
      total,
      positive,
      negative,
      positiveRate: total > 0 ? Math.round((positive / total) * 100) : 0,
    };
  }

  // ─── Private ──────────────────────────────────────────

  private async createSuggestionFromNegativeFeedback(
    sessionId: string,
    messageId: string,
  ): Promise<void> {
    try {
      // Get the bot message and the customer message before it
      const botMessage = await this.prisma.chatMessage.findFirst({
        where: { id: messageId, sessionId },
      });
      if (!botMessage) return;

      const customerMessage = await this.prisma.chatMessage.findFirst({
        where: {
          sessionId,
          role: 'CUSTOMER',
          createdAt: { lt: botMessage.createdAt },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!customerMessage?.text) return;

      await this.prisma.chatKbSuggestion.create({
        data: {
          sessionId,
          customerQuestion: customerMessage.text,
          suggestedIntent: botMessage.intent ?? 'unknown',
          source: 'low_rating',
          status: 'PENDING',
        },
      });

      this.logger.log(`[Feedback] Created KB suggestion from negative feedback`);
    } catch (err) {
      this.logger.error(
        `[Feedback] Failed to create suggestion: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** 👍 → KB entry priority +1, 👎 → priority -2 (atomic, no race condition) */
  private async adjustKbPriority(sessionId: string, rating: number): Promise<void> {
    try {
      const lastBotMsg = await this.prisma.chatMessage.findFirst({
        where: { sessionId, role: 'BOT', intent: { not: null } },
        orderBy: { createdAt: 'desc' },
      });
      if (!lastBotMsg?.intent) return;

      const kbEntry = await this.prisma.chatKnowledgeBase.findFirst({
        where: { intent: lastBotMsg.intent, active: true, deletedAt: null },
      });
      if (!kbEntry) return;

      // Atomic increment/decrement — no read-then-write race
      if (rating === 1) {
        await this.prisma.chatKnowledgeBase.update({
          where: { id: kbEntry.id },
          data: { priority: { increment: 1 } },
        });
      } else {
        // Ensure priority doesn't go below 0 using raw SQL
        await this.prisma.$executeRaw`
          UPDATE chat_knowledge_base
          SET priority = GREATEST(0, priority - 2)
          WHERE id = ${kbEntry.id}
        `;
      }

      this.logger.debug(`[Feedback] KB "${kbEntry.intent}" priority adjusted (rating=${rating})`);
    } catch {
      // Non-critical — don't fail the feedback save
    }
  }
}
