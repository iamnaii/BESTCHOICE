import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  /** Send broadcast to all LINE OA followers */
  async broadcast(
    message:
      | { type: 'text'; text: string }
      | { type: 'flex'; altText: string; contents: any },
  ): Promise<{ success: boolean; message: string }> {
    const token = this.configService.get<string>('LINE_CHANNEL_ACCESS_TOKEN');
    if (!token) return { success: false, message: 'LINE token not configured' };

    try {
      const res = await fetch('https://api.line.me/v2/bot/message/broadcast', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages: [message] }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        const text = await res.text();
        return { success: false, message: `LINE API error: ${res.status} ${text}` };
      }

      // Log broadcast
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
    } catch (error: any) {
      this.logger.error('Broadcast failed', error);
      return { success: false, message: error.message ?? 'เกิดข้อผิดพลาด' };
    }
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
}
