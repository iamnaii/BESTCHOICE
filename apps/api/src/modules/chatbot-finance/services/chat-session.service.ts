import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatChannel, ChatSession, MessageRole, MessageType, Prisma } from '@prisma/client';

/**
 * จัดการ ChatSession + ChatMessage สำหรับ Finance Bot
 */
@Injectable()
export class ChatSessionService {
  private readonly logger = new Logger(ChatSessionService.name);

  constructor(private prisma: PrismaService) {}

  /** หา session เดิม หรือสร้างใหม่ */
  async getOrCreate(lineUserId: string): Promise<ChatSession> {
    const existing = await this.prisma.chatSession.findUnique({
      where: {
        lineUserId_channel: {
          lineUserId,
          channel: ChatChannel.LINE_FINANCE,
        },
      },
    });
    if (existing) return existing;

    // ลองหา customer ที่ link ไว้แล้วผ่าน CustomerLineLink
    const link = await this.prisma.customerLineLink.findUnique({
      where: {
        lineUserId_channel: {
          lineUserId,
          channel: 'FINANCE',
        },
      },
    });

    return this.prisma.chatSession.create({
      data: {
        lineUserId,
        channel: ChatChannel.LINE_FINANCE,
        customerId: link?.customerId,
        verifiedAt: link ? new Date() : null,
      },
    });
  }

  /** บันทึกข้อความ + อัปเดต session stats */
  async saveMessage(params: {
    sessionId: string;
    role: MessageRole;
    type?: MessageType;
    text?: string;
    mediaUrl?: string;
    mediaType?: string;
    intent?: string;
    modelUsed?: string;
    inputTokens?: number;
    outputTokens?: number;
    toolsUsed?: string[];
    costUsd?: number;
    visionExtracted?: Prisma.InputJsonValue;
  }) {
    const msg = await this.prisma.chatMessage.create({
      data: {
        sessionId: params.sessionId,
        role: params.role,
        type: params.type ?? MessageType.TEXT,
        text: params.text,
        mediaUrl: params.mediaUrl,
        mediaType: params.mediaType,
        intent: params.intent,
        modelUsed: params.modelUsed,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        toolsUsed: params.toolsUsed ?? [],
        costUsd: params.costUsd,
        visionExtracted: params.visionExtracted,
      },
    });

    await this.prisma.chatSession.update({
      where: { id: params.sessionId },
      data: {
        totalMessages: { increment: 1 },
        lastMessageAt: new Date(),
      },
    });

    return msg;
  }

  /** ดึง history N ข้อความล่าสุด (สำหรับใส่ใน AI context) */
  async getRecentMessages(sessionId: string, limit = 20) {
    const msgs = await this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return msgs.reverse();
  }

  /** Sync session.customerId หลังจาก LIFF verify (CustomerLineLink ถูกสร้างแล้ว) */
  async linkSessionToCustomer(sessionId: string, customerId: string): Promise<void> {
    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        customerId,
        verifiedAt: new Date(),
        verificationAttempts: 0,
      },
    });
  }
}
