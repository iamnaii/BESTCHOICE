import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Learning Service — extract knowledge from handoff conversations + manage KB suggestions.
 *
 * Flow:
 *   1. Handoff resolved → extractFromHandoff() called
 *   2. Extract customer Q + staff A → create ChatKbSuggestion
 *   3. Admin reviews → approve/reject
 *   4. Approved → create/update KB entry
 */
@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Extract learning from a completed handoff session.
   * Called when admin clicks "return to bot" after resolving.
   */
  async extractFromHandoff(sessionId: string): Promise<void> {
    // Get messages: customer questions + staff answers
    const messages = await this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, text: true, intent: true },
    });

    // Find the last customer question before handoff
    const customerMessages = messages.filter((m) => m.role === 'CUSTOMER' && m.text);
    const staffMessages = messages.filter((m) => m.role === 'STAFF' && m.text);

    if (customerMessages.length === 0) return;

    const lastCustomerQ = customerMessages[customerMessages.length - 1];
    const lastStaffA = staffMessages.length > 0
      ? staffMessages[staffMessages.length - 1]
      : null;

    if (!lastCustomerQ.text) return;

    // Check if we already have a suggestion for this session
    const existing = await this.prisma.chatKbSuggestion.findFirst({
      where: { sessionId, source: 'handoff' },
    });
    if (existing) return;

    await this.prisma.chatKbSuggestion.create({
      data: {
        sessionId,
        customerQuestion: lastCustomerQ.text,
        staffAnswer: lastStaffA?.text,
        suggestedIntent: lastCustomerQ.intent ?? 'handoff_learned',
        source: 'handoff',
        status: 'PENDING',
      },
    });

    this.logger.log(`[Learning] Created suggestion from handoff session ${sessionId}`);
  }

  // ─── Admin CRUD for suggestions ──────────────────────

  async listSuggestions(params: {
    status?: string;
    source?: string;
    page: number;
    limit: number;
  }) {
    const where = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.source ? { source: params.source } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.chatKbSuggestion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.chatKbSuggestion.count({ where }),
    ]);

    return { items, total, page: params.page, limit: params.limit };
  }

  async approveSuggestion(id: string, reviewerId: string): Promise<void> {
    const suggestion = await this.prisma.chatKbSuggestion.findFirst({
      where: { id, status: 'PENDING' },
    });
    if (!suggestion) return;

    // C3: Validate that we have a response template
    const template = suggestion.suggestedTemplate || suggestion.staffAnswer || '';
    if (!template.trim()) {
      throw new BadRequestException('ต้องระบุ template ก่อน approve — suggestion นี้ไม่มี template หรือ staff answer');
    }

    // C2: Atomic create KB + update suggestion
    await this.prisma.$transaction(async (tx) => {
      const kbEntry = await tx.chatKnowledgeBase.create({
        data: {
          channel: 'LINE_FINANCE',
          intent: suggestion.suggestedIntent,
          category: 'learned',
          triggerKeywords: suggestion.suggestedKeywords,
          exampleQuestions: [suggestion.customerQuestion],
          responseTemplate: template,
          responseType: 'auto',
          requiresAuth: false, // W5: learned entries don't require auth by default
          priority: 5,
        },
      });

      await tx.chatKbSuggestion.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          kbEntryId: kbEntry.id,
        },
      });

      this.logger.log(`[Learning] Suggestion ${id} approved → KB entry ${kbEntry.id}`);
    });
  }

  async rejectSuggestion(id: string, reviewerId: string): Promise<void> {
    await this.prisma.chatKbSuggestion.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
      },
    });
  }

  /** Stats for learning hub dashboard */
  async getStats() {
    const [pending, approved, rejected, totalFeedback, positiveFeedback] = await Promise.all([
      this.prisma.chatKbSuggestion.count({ where: { status: 'PENDING' } }),
      this.prisma.chatKbSuggestion.count({ where: { status: 'APPROVED' } }),
      this.prisma.chatKbSuggestion.count({ where: { status: 'REJECTED' } }),
      this.prisma.chatFeedback.count(),
      this.prisma.chatFeedback.count({ where: { rating: 1 } }),
    ]);

    return {
      suggestions: { pending, approved, rejected },
      feedback: {
        total: totalFeedback,
        positiveRate: totalFeedback > 0 ? Math.round((positiveFeedback / totalFeedback) * 100) : 0,
      },
    };
  }
}
