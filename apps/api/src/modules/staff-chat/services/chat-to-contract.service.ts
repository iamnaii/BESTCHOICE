import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * ChatToContractService — pre-fill contract creation from chat context.
 *
 * When staff clicks "สร้างสัญญา" in chat, this service extracts:
 * - Customer info (id, name, phone) from the linked session
 * - Suggested products by searching recent messages for brand/model keywords
 */
@Injectable()
export class ChatToContractService {
  private readonly logger = new Logger(ChatToContractService.name);

  constructor(private prisma: PrismaService) {}

  async getContractPrefill(sessionId: string): Promise<{
    customerId?: string;
    customerName?: string;
    phone?: string;
    suggestedProducts?: Array<{ id: string; name: string; brand: string }>;
  }> {
    // 1. Find session with customer info
    const session = await this.prisma.chatRoom.findUnique({
      where: { id: sessionId },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
    });

    if (!session) {
      throw new NotFoundException('ไม่พบห้องแชท');
    }

    // 2. Find mentioned products in recent messages (simple keyword search)
    // Look for product names/brands in last 20 messages
    const messages = await this.prisma.chatMessage.findMany({
      where: { sessionId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { text: true },
    });

    // 3. Search for products matching keywords from messages
    const allText = messages
      .map((m) => m.text)
      .filter(Boolean)
      .join(' ');
    const suggestedProducts: Array<{ id: string; name: string; brand: string }> = [];

    // Extract meaningful keywords (words > 3 chars) and search for matching IN_STOCK products
    if (allText.length > 0) {
      const keywords = this.extractKeywords(allText);

      if (keywords.length > 0) {
        const orConditions = keywords.map((keyword) => ({
          OR: [
            { name: { contains: keyword, mode: 'insensitive' as const } },
            { brand: { contains: keyword, mode: 'insensitive' as const } },
            { model: { contains: keyword, mode: 'insensitive' as const } },
          ],
        }));

        const products = await this.prisma.product.findMany({
          where: {
            status: 'IN_STOCK',
            deletedAt: null,
            OR: orConditions.flatMap((c) => c.OR),
          },
          take: 5,
          select: { id: true, name: true, brand: true },
        });
        suggestedProducts.push(...products);
      }
    }

    return {
      customerId: session.customer?.id,
      customerName: session.customer?.name,
      phone: session.customer?.phone ?? undefined,
      suggestedProducts,
    };
  }

  /**
   * Extract meaningful keywords from chat text for product matching.
   * Filters out common Thai/English stopwords and short words.
   */
  private extractKeywords(text: string): string[] {
    const stopwords = new Set([
      'สวัสดี', 'ครับ', 'ค่ะ', 'คะ', 'ขอบคุณ', 'ต้องการ', 'อยากได้', 'สนใจ',
      'ราคา', 'เท่าไหร่', 'มี', 'ไหม', 'ได้', 'ไม่', 'the', 'and', 'for', 'with',
    ]);

    // Common phone brands/models that are useful for matching
    const brandKeywords = [
      'iphone', 'samsung', 'oppo', 'vivo', 'xiaomi', 'realme', 'huawei',
      'galaxy', 'redmi', 'poco', 'nothing', 'pixel', 'ipad', 'pro', 'max',
      'plus', 'ultra', 'mini', 'fold', 'flip',
    ];

    const words = text
      .toLowerCase()
      .split(/[\s,.\-!?()]+/)
      .filter((w) => w.length > 2)
      .filter((w) => !stopwords.has(w));

    // Prioritize brand keywords found in text
    const matched = words.filter(
      (w) => brandKeywords.some((bk) => w.includes(bk)) || /\d{2,}/.test(w),
    );

    // Deduplicate and limit
    return [...new Set(matched)].slice(0, 5);
  }
}
