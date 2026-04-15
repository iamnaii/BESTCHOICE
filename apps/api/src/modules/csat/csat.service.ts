import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { LineMessagePayload } from '../line-oa/dto/webhook-event.dto';
import { SubmitRatingDto } from './dto/submit-rating.dto';

@Injectable()
export class CsatService {
  private readonly logger = new Logger(CsatService.name);

  constructor(
    private prisma: PrismaService,
    private lineOaService: LineOaService,
  ) {}

  /**
   * Send CSAT survey to customer after room resolution
   */
  async sendSurvey(roomId: string): Promise<void> {
    const room = await this.prisma.chatRoom.findFirst({
      where: { id: roomId, deletedAt: null },
    });

    if (!room) {
      throw new NotFoundException('ไม่พบห้องแชท');
    }

    if (!room.lineUserId) {
      this.logger.warn(`[CSAT] Room ${roomId} has no lineUserId — skipping survey`);
      return;
    }

    const surveyMessage: LineMessagePayload = {
      type: 'text',
      text: [
        '🙏 ขอบคุณที่ใช้บริการ BESTCHOICE',
        '',
        'กรุณาให้คะแนนความพึงพอใจ (1-5 ดาว)',
        '⭐ 1 = ไม่พอใจ',
        '⭐⭐ 2 = พอใช้',
        '⭐⭐⭐ 3 = ปานกลาง',
        '⭐⭐⭐⭐ 4 = ดี',
        '⭐⭐⭐⭐⭐ 5 = ยอดเยี่ยม',
        '',
        'ตอบกลับด้วยตัวเลข 1-5 หรือพิมพ์ข้อเสนอแนะเพิ่มเติมได้เลยค่ะ',
      ].join('\n'),
    } as unknown as LineMessagePayload;

    await this.lineOaService.pushMessage(room.lineUserId, [surveyMessage]);
    this.logger.log(`[CSAT] Survey sent for room ${roomId} to ${room.lineUserId}`);
  }

  /**
   * Submit rating (called from LIFF or webhook)
   */
  async submitRating(dto: SubmitRatingDto): Promise<{ id: string }> {
    const room = await this.prisma.chatRoom.findFirst({
      where: { id: dto.roomId, deletedAt: null },
    });

    if (!room) {
      throw new NotFoundException('ไม่พบห้องแชท');
    }

    const feedback = await this.prisma.chatFeedback.upsert({
      where: {
        // Use roomId index — one feedback per room
        id: await this.findExistingFeedbackId(dto.roomId),
      },
      create: {
        roomId: dto.roomId,
        rating: dto.rating,
        feedbackText: dto.feedbackText ?? null,
      },
      update: {
        rating: dto.rating,
        feedbackText: dto.feedbackText ?? null,
      },
    });

    this.logger.log(`[CSAT] Rating ${dto.rating}/5 submitted for room ${dto.roomId}`);
    return { id: feedback.id };
  }

  /**
   * Get CSAT stats (aggregate ratings)
   */
  async getStats(startDate?: Date, endDate?: Date) {
    const start = startDate ?? new Date(Date.now() - 30 * 86400000);
    const end = endDate ?? new Date();

    const where = {
      deletedAt: null,
      createdAt: { gte: start, lte: end },
    };

    const [totalCount, ratingAgg, ratingDistribution] = await Promise.all([
      this.prisma.chatFeedback.count({ where }),
      this.prisma.chatFeedback.aggregate({
        where,
        _avg: { rating: true },
        _min: { rating: true },
        _max: { rating: true },
      }),
      this.prisma.chatFeedback.groupBy({
        by: ['rating'],
        where,
        _count: { rating: true },
        orderBy: { rating: 'asc' },
      }),
    ]);

    return {
      totalResponses: totalCount,
      averageRating: ratingAgg._avg.rating ? Number(ratingAgg._avg.rating.toFixed(2)) : null,
      minRating: ratingAgg._min.rating,
      maxRating: ratingAgg._max.rating,
      distribution: ratingDistribution.map((d) => ({
        rating: d.rating,
        count: d._count.rating,
      })),
      period: { start, end },
    };
  }

  /**
   * Find existing feedback ID for upsert, or generate a new UUID placeholder
   */
  private async findExistingFeedbackId(roomId: string): Promise<string> {
    const existing = await this.prisma.chatFeedback.findFirst({
      where: { roomId, deletedAt: null },
      select: { id: true },
    });
    // If no existing feedback, return a non-existent UUID so upsert creates a new record
    return existing?.id ?? '00000000-0000-0000-0000-000000000000';
  }
}
