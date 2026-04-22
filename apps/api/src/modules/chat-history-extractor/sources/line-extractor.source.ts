import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface ExtractedMessage {
  roomId: string;
  channel: 'LINE_FINANCE' | 'FACEBOOK';
  role: 'CUSTOMER' | 'STAFF';
  text: string;
  createdAt: Date;
  externalMessageId?: string;
}

@Injectable()
export class LineExtractorSource {
  constructor(private readonly prisma: PrismaService) {}

  async extract(opts: { channel: 'LINE_FINANCE'; since: Date }): Promise<ExtractedMessage[]> {
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        room: { channel: opts.channel },
        createdAt: { gte: opts.since },
        deletedAt: null,
        text: { not: null },
      },
      orderBy: [{ roomId: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        roomId: true,
        role: true,
        text: true,
        createdAt: true,
        externalMessageId: true,
      },
    });

    return rows
      .filter((r): r is typeof r & { text: string } => r.text !== null)
      .map((r) => ({
        roomId: r.roomId,
        channel: 'LINE_FINANCE' as const,
        // MessageRole enum: CUSTOMER, BOT, STAFF, AUTO_TRIGGER, SYSTEM
        // Treat BOT + STAFF as outgoing (STAFF side); everything else is inbound (CUSTOMER).
        role: r.role === 'STAFF' || r.role === 'BOT' ? 'STAFF' : 'CUSTOMER',
        text: r.text,
        createdAt: r.createdAt,
        externalMessageId: r.externalMessageId ?? undefined,
      }));
  }
}
