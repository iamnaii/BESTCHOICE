import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

type LineMessage =
  | { type: 'text'; text: string }
  | { type: 'image'; originalContentUrl: string; previewImageUrl: string }
  | { type: 'flex'; altText: string; contents: any };

interface BroadcastMessageItem {
  type: string;
  content: any;
}

interface SendBroadcastParams {
  messages: BroadcastMessageItem[]; // array of { type, content }, up to 5
  audience: string; // ALL | EXISTING | OVERDUE | NEW
  scheduledAt?: Date;
  createdById: string;
}

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private storageService: StorageService,
  ) {}

  // ─── Audience ────────────────────────────────────────────────────────────────

  /** Count audience per group */
  async getAudienceCount(): Promise<{
    all: number;
    existing: number;
    overdue: number;
    new: number;
  }> {
    const [allCount, existingCount, overdueCount] = await Promise.all([
      // ALL — unique customers with any LINE link
      this.prisma.customerLineLink.count({
        where: { deletedAt: null, unlinkedAt: null },
      }),
      // EXISTING — customers with at least one active/overdue/default contract
      this.prisma.customer.count({
        where: {
          deletedAt: null,
          contracts: {
            some: {
              deletedAt: null,
              status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] },
            },
          },
          lineLinks: { some: { deletedAt: null, unlinkedAt: null } },
        },
      }),
      // OVERDUE — customers with OVERDUE or DEFAULT contracts
      this.prisma.customer.count({
        where: {
          deletedAt: null,
          contracts: {
            some: {
              deletedAt: null,
              status: { in: ['OVERDUE', 'DEFAULT'] },
            },
          },
          lineLinks: { some: { deletedAt: null, unlinkedAt: null } },
        },
      }),
    ]);

    return {
      all: allCount,
      existing: existingCount,
      overdue: overdueCount,
      new: Math.max(0, allCount - existingCount),
    };
  }

  /** Return LINE user IDs for a given audience group */
  async getAudienceUserIds(audience: string): Promise<string[]> {
    if (audience === 'ALL') return []; // use broadcast API instead

    if (audience === 'OVERDUE') {
      const links = await this.prisma.customerLineLink.findMany({
        where: {
          deletedAt: null,
          unlinkedAt: null,
          customer: {
            deletedAt: null,
            contracts: {
              some: { deletedAt: null, status: { in: ['OVERDUE', 'DEFAULT'] } },
            },
          },
        },
        select: { lineUserId: true },
      });
      return [...new Set(links.map((l) => l.lineUserId))];
    }

    if (audience === 'EXISTING') {
      const links = await this.prisma.customerLineLink.findMany({
        where: {
          deletedAt: null,
          unlinkedAt: null,
          customer: {
            deletedAt: null,
            contracts: {
              some: {
                deletedAt: null,
                status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] },
              },
            },
          },
        },
        select: { lineUserId: true },
      });
      return [...new Set(links.map((l) => l.lineUserId))];
    }

    if (audience === 'NEW') {
      // NEW = has LINE link but NO active/overdue/default contracts
      const links = await this.prisma.customerLineLink.findMany({
        where: {
          deletedAt: null,
          unlinkedAt: null,
          customer: {
            deletedAt: null,
            contracts: {
              none: {
                deletedAt: null,
                status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] },
              },
            },
          },
        },
        select: { lineUserId: true },
      });
      return [...new Set(links.map((l) => l.lineUserId))];
    }

    return [];
  }

  // ─── Send ─────────────────────────────────────────────────────────────────────

  /** Send or schedule a broadcast */
  async sendBroadcast(params: SendBroadcastParams): Promise<{
    success: boolean;
    message: string;
    id?: string;
  }> {
    const { messages, audience, scheduledAt, createdById } = params;

    // Get audience count for saving
    const counts = await this.getAudienceCount();
    const audienceCount =
      audience === 'ALL'
        ? counts.all
        : audience === 'EXISTING'
          ? counts.existing
          : audience === 'OVERDUE'
            ? counts.overdue
            : counts.new;

    // If scheduled → save as SCHEDULED, no send
    if (scheduledAt && scheduledAt > new Date()) {
      const record = await this.prisma.broadcastMessage.create({
        data: {
          messages: messages as any,
          audience,
          audienceCount,
          status: 'SCHEDULED',
          scheduledAt,
          createdById,
        },
      });
      return { success: true, message: 'บันทึกตั้งเวลาส่งสำเร็จ', id: record.id };
    }

    // Build LINE messages array (up to 5)
    const lineMessages = messages
      .map((m) => this.buildLineMessage(m.type, m.content))
      .filter((m): m is LineMessage => m !== null);
    if (lineMessages.length === 0) {
      return { success: false, message: 'รูปแบบข้อความไม่ถูกต้อง' };
    }

    const result = await this.dispatchLineMessages(audience, lineMessages);

    const record = await this.prisma.broadcastMessage.create({
      data: {
        messages: messages as any,
        audience,
        audienceCount,
        status: result.success ? 'SENT' : 'FAILED',
        sentAt: result.success ? new Date() : null,
        errorMessage: result.success ? null : result.message,
        createdById,
      },
    });

    return { ...result, id: record.id };
  }

  /** Called by cron — process all due SCHEDULED messages */
  async sendScheduledMessages(): Promise<{ sent: number; failed: number }> {
    const due = await this.prisma.broadcastMessage.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { lte: new Date() },
      },
    });

    let sent = 0;
    let failed = 0;

    for (const msg of due) {
      try {
        const msgItems = (msg.messages as unknown as BroadcastMessageItem[]) ?? [];
        const lineMessages = msgItems
          .map((m) => this.buildLineMessage(m.type, m.content))
          .filter((m): m is LineMessage => m !== null);
        if (lineMessages.length === 0) {
          await this.prisma.broadcastMessage.update({
            where: { id: msg.id },
            data: { status: 'FAILED', errorMessage: 'รูปแบบข้อความไม่ถูกต้อง' },
          });
          failed++;
          continue;
        }

        const result = await this.dispatchLineMessages(msg.audience, lineMessages);

        await this.prisma.broadcastMessage.update({
          where: { id: msg.id },
          data: {
            status: result.success ? 'SENT' : 'FAILED',
            sentAt: result.success ? new Date() : null,
            errorMessage: result.success ? null : result.message,
          },
        });

        if (result.success) sent++;
        else failed++;
      } catch (error: any) {
        this.logger.error(`Failed to send scheduled broadcast ${msg.id}`, error);
        await this.prisma.broadcastMessage.update({
          where: { id: msg.id },
          data: { status: 'FAILED', errorMessage: error.message ?? 'เกิดข้อผิดพลาด' },
        });
        failed++;
      }
    }

    return { sent, failed };
  }

  // ─── History ──────────────────────────────────────────────────────────────────

  async getHistory(
    page = 1,
    limit = 20,
  ): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.broadcastMessage.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { createdBy: { select: { id: true, name: true } } },
      }),
      this.prisma.broadcastMessage.count(),
    ]);
    return { data, total, page, limit };
  }

  // ─── Cancel ───────────────────────────────────────────────────────────────────

  async cancelScheduled(id: string): Promise<{ success: boolean; message: string }> {
    const msg = await this.prisma.broadcastMessage.findUnique({ where: { id } });
    if (!msg) throw new NotFoundException('ไม่พบข้อความ Broadcast');
    if (msg.status !== 'SCHEDULED') {
      return { success: false, message: 'สามารถยกเลิกได้เฉพาะข้อความที่อยู่ในสถานะ SCHEDULED' };
    }
    await this.prisma.broadcastMessage.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    return { success: true, message: 'ยกเลิกการส่งสำเร็จ' };
  }

  // ─── Image Upload ─────────────────────────────────────────────────────────────

  async uploadImage(file: Buffer, filename: string): Promise<{ url: string }> {
    const key = `broadcast/images/${Date.now()}-${filename}`;
    await this.storageService.upload(key, file, 'image/jpeg');

    // Build public URL
    const s3Endpoint = this.configService.get<string>('S3_ENDPOINT');
    const s3Bucket = this.configService.get<string>('S3_BUCKET') || 'bestchoice-documents';
    const gcsBucket = this.configService.get<string>('GCS_BUCKET');
    const appUrl = this.configService.get<string>('APP_URL') || 'https://app.bestchoice.co.th';

    let url: string;
    if (s3Endpoint) {
      url = `${s3Endpoint}/${s3Bucket}/${key}`;
    } else if (gcsBucket) {
      url = `https://storage.googleapis.com/${gcsBucket}/${key}`;
    } else {
      // Fallback — serve via API
      url = `${appUrl}/api/files/${encodeURIComponent(key)}`;
    }

    return { url };
  }

  // ─── Legacy: kept for backward-compat with existing controller ────────────────

  /** Send broadcast to all LINE OA followers (legacy simple API) */
  async broadcast(
    message:
      | { type: 'text'; text: string }
      | { type: 'flex'; altText: string; contents: any },
  ): Promise<{ success: boolean; message: string }> {
    return this.dispatchLineMessage('ALL', message as LineMessage);
  }

  /** Get follower count via LINE Insight API */
  async getFollowerCount(): Promise<number> {
    const token = this.configService.get<string>('LINE_CHANNEL_ACCESS_TOKEN');
    if (!token) return 0;

    try {
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const insightRes = await fetch(
        `https://api.line.me/v2/bot/insight/followers?date=${date}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (insightRes.ok) {
        const data = await insightRes.json();
        return data.followers ?? 0;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private buildLineMessage(type: string, content: any): LineMessage | null {
    if (type === 'text') {
      return { type: 'text', text: content.text ?? content ?? '' };
    }
    if (type === 'image') {
      return {
        type: 'image',
        originalContentUrl: content.originalContentUrl,
        previewImageUrl: content.previewImageUrl ?? content.originalContentUrl,
      };
    }
    if (type === 'flex') {
      return {
        type: 'flex',
        altText: content.altText ?? 'ข้อความจาก BESTCHOICE',
        contents: content.contents ?? content,
      };
    }
    return null;
  }

  /** Dispatch a single LINE message (legacy wrapper for broadcast() method) */
  private async dispatchLineMessage(
    audience: string,
    message: LineMessage,
  ): Promise<{ success: boolean; message: string }> {
    return this.dispatchLineMessages(audience, [message]);
  }

  /** Dispatch multiple LINE messages (up to 5) to the given audience */
  private async dispatchLineMessages(
    audience: string,
    messages: LineMessage[],
  ): Promise<{ success: boolean; message: string }> {
    const token = this.configService.get<string>('LINE_CHANNEL_ACCESS_TOKEN');
    if (!token) return { success: false, message: 'LINE token not configured' };

    try {
      if (audience === 'ALL') {
        // Broadcast to all followers
        const res = await fetch('https://api.line.me/v2/bot/message/broadcast', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ messages }),
          signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
          const text = await res.text();
          return { success: false, message: `LINE API error: ${res.status} ${text}` };
        }

        // Keep lastSentAt log
        await this.prisma.systemConfig.upsert({
          where: { key: 'broadcast.lastSentAt' },
          create: {
            key: 'broadcast.lastSentAt',
            value: new Date().toISOString(),
            label: 'Last broadcast sent',
          },
          update: { value: new Date().toISOString() },
        });

        return { success: true, message: 'ส่ง Broadcast สำเร็จ' };
      }

      // Targeted: multicast
      const userIds = await this.getAudienceUserIds(audience);
      if (userIds.length === 0) {
        return { success: false, message: 'ไม่มีผู้รับในกลุ่มที่เลือก' };
      }

      // LINE multicast limit = 500 per request; chunk if needed
      const CHUNK_SIZE = 500;
      for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
        const chunk = userIds.slice(i, i + CHUNK_SIZE);
        const res = await fetch('https://api.line.me/v2/bot/message/multicast', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ to: chunk, messages }),
          signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
          const text = await res.text();
          return {
            success: false,
            message: `LINE multicast error (chunk ${i / CHUNK_SIZE + 1}): ${res.status} ${text}`,
          };
        }
      }

      return { success: true, message: `ส่ง Multicast สำเร็จ (${userIds.length} คน)` };
    } catch (error: any) {
      this.logger.error('Dispatch LINE message failed', error);
      return { success: false, message: error.message ?? 'เกิดข้อผิดพลาด' };
    }
  }
}
