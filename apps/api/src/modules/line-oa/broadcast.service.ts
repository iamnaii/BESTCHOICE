import { randomUUID } from 'crypto';
import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

/**
 * กลุ่มผู้รับของ broadcast = ลูกค้าที่ผูก LINE **ช่องร้าน** ไว้แล้ว
 *
 * เดิมดึงผู้รับจากตาราง `CustomerLineLink` โดยไม่กรอง channel แล้วส่งด้วย token ของ
 * `line-shop` (ดู `getValue('line-shop', 'channelToken')` ในเมธอดส่ง) — ตารางนั้นมีแต่แถว
 * ช่อง FINANCE (ตัวเดียวที่เขียนคือ OTP ของ chatbot-finance ซึ่ง hardcode FINANCE)
 * ⇒ ยิง userId ของ OA ไฟแนนซ์ด้วย token ของ OA ร้าน = ผิด OA เชิงโครงสร้าง
 *
 * ตัวตนฝั่งร้านอยู่ที่คอลัมน์ `customer.lineIdShop` (เขียนโดย
 * `LineCustomerLinkService.selfLinkByPhone` ตอนลูกค้าพิมพ์เบอร์โทรคุยกับ OA ร้าน)
 * — แหล่งเดียวกับที่ `SavingPlanReminderCron` และการแจ้งประกันใช้
 */
const SHOP_LINKED = {
  deletedAt: null,
  lineIdShop: { not: null },
} satisfies Prisma.CustomerWhereInput;

type LineMessage =
  | { type: 'text'; text: string }
  | { type: 'video'; originalContentUrl: string; previewImageUrl: string }
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
    private integrationConfig: IntegrationConfigService,
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
      // ALL — ลูกค้าที่ผูก LINE ร้านไว้แล้ว
      this.prisma.customer.count({ where: SHOP_LINKED }),
      // EXISTING — มีสัญญา active/overdue/default อย่างน้อยหนึ่งใบ
      this.prisma.customer.count({
        where: {
          ...SHOP_LINKED,
          contracts: {
            some: {
              deletedAt: null,
              status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] },
            },
          },
        },
      }),
      // OVERDUE — มีสัญญาค้างชำระ
      this.prisma.customer.count({
        where: {
          ...SHOP_LINKED,
          contracts: {
            some: {
              deletedAt: null,
              status: { in: ['OVERDUE', 'DEFAULT'] },
            },
          },
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
      return this.shopLineIds({
        contracts: { some: { deletedAt: null, status: { in: ['OVERDUE', 'DEFAULT'] } } },
      });
    }

    if (audience === 'EXISTING') {
      return this.shopLineIds({
        contracts: {
          some: { deletedAt: null, status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] } },
        },
      });
    }

    if (audience === 'NEW') {
      // NEW = ผูก LINE ร้านแล้วแต่ยังไม่มีสัญญา active/overdue/default
      // (ลูกค้าซื้อเงินสด/ไฟแนนซ์นอกอยู่กลุ่มนี้)
      return this.shopLineIds({
        contracts: {
          none: { deletedAt: null, status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] } },
        },
      });
    }

    return [];
  }

  /** ดึง LINE userId ของช่องร้านตามเงื่อนไขลูกค้าที่ให้มา */
  private async shopLineIds(extraWhere: Prisma.CustomerWhereInput): Promise<string[]> {
    const rows = await this.prisma.customer.findMany({
      where: { ...SHOP_LINKED, ...extraWhere },
      select: { lineIdShop: true },
    });
    return rows
      .map((r) => r.lineIdShop)
      .filter((id): id is string => !!id);
  }

  // ─── Send / Approve / Reject ─────────────────────────────────────────────

  /**
   * Create a broadcast as PENDING_APPROVAL (P2Q15=A — two-person SoD).
   * The request no longer dispatches immediately; a second manager must call
   * approveBroadcast() to either send it now or queue it at scheduledAt.
   */
  async sendBroadcast(params: SendBroadcastParams): Promise<{
    success: boolean;
    message: string;
    id?: string;
  }> {
    const { messages, scheduledAt, createdById } = params;
    const audience = this.normalizeAudience(params.audience);
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 5) {
      throw new BadRequestException('กรุณาระบุข้อความ 1–5 ข้อความ');
    }

    const lineMessages = messages
      .map((m) => this.buildLineMessage(m.type, m.content))
      .filter((m): m is LineMessage => m !== null);
    if (lineMessages.length === 0) {
      return { success: false, message: 'รูปแบบข้อความไม่ถูกต้อง' };
    }

    const counts = await this.getAudienceCount();
    const audienceCount =
      audience === 'ALL'
        ? counts.all
        : audience === 'EXISTING'
          ? counts.existing
          : audience === 'OVERDUE'
            ? counts.overdue
            : counts.new;

    const record = await this.prisma.broadcastMessage.create({
      data: {
        messages: messages as any,
        audience,
        audienceCount,
        status: 'PENDING_APPROVAL',
        scheduledAt: scheduledAt ?? null,
        createdById,
      },
    });

    return {
      success: true,
      message: 'บันทึก broadcast แล้ว รอผู้อนุมัติคนที่สองก่อนส่งจริง',
      id: record.id,
    };
  }

  /**
   * Approve a PENDING_APPROVAL broadcast and dispatch / queue it.
   *   - approverId must differ from createdById (SoD guard)
   *   - scheduledAt in future  → status becomes SCHEDULED, cron picks up
   *   - otherwise              → dispatch LINE messages immediately
   */
  async approveBroadcast(
    id: string,
    approverId: string,
  ): Promise<{ success: boolean; message: string; id: string }> {
    const record = await this.prisma.broadcastMessage.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('ไม่พบ broadcast');
    if (record.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        `broadcast อยู่ในสถานะ ${record.status} — อนุมัติได้เฉพาะสถานะ PENDING_APPROVAL`,
      );
    }
    if (record.createdById === approverId) {
      throw new ForbiddenException(
        'ผู้อนุมัติต้องไม่ใช่ผู้สร้าง broadcast (Segregation of Duties)',
      );
    }

    const now = new Date();
    const scheduled = !!record.scheduledAt && record.scheduledAt > now;
    const audience = this.normalizeAudience(record.audience);
    const msgItems = (record.messages as unknown as BroadcastMessageItem[]) ?? [];
    if (msgItems.length < 1 || msgItems.length > 5) throw new BadRequestException('กรุณาระบุข้อความ 1–5 ข้อความ');
    const lineMessages = msgItems.map((m) => this.buildLineMessage(m.type, m.content));
    // Only one reviewer may claim a pending broadcast; rejection uses the same condition.
    const claim = await this.prisma.broadcastMessage.updateMany({
      where: { id, status: 'PENDING_APPROVAL' },
      data: { status: scheduled ? 'SCHEDULED' : 'SENDING', approvedById: approverId, approvedAt: now },
    });
    if (claim.count !== 1) throw new BadRequestException('รายการนี้ถูกดำเนินการโดยผู้ใช้อื่นแล้ว');
    if (scheduled) {
      return { success: true, message: `อนุมัติแล้ว — จะถูกส่งตามเวลา ${record.scheduledAt!.toLocaleString('th-TH')}`, id };
    }

    const result = await this.dispatchLineMessages(audience, lineMessages);

    await this.prisma.broadcastMessage.update({
      where: { id },
      data: {
        status: result.success ? 'SENT' : 'FAILED',
        sentAt: result.success ? now : null,
        errorMessage: result.success ? null : result.message,
        approvedById: approverId,
        approvedAt: now,
      },
    });

    return { success: result.success, message: result.message, id };
  }

  async rejectBroadcast(
    id: string,
    rejecterId: string,
    reason: string,
  ): Promise<{ success: boolean; message: string; id: string }> {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('กรุณาระบุเหตุผลการปฏิเสธ (อย่างน้อย 5 ตัวอักษร)');
    }
    const record = await this.prisma.broadcastMessage.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('ไม่พบ broadcast');
    if (record.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        `broadcast อยู่ในสถานะ ${record.status} — ปฏิเสธได้เฉพาะสถานะ PENDING_APPROVAL`,
      );
    }
    if (record.createdById === rejecterId) {
      throw new ForbiddenException(
        'ผู้ปฏิเสธต้องไม่ใช่ผู้สร้าง broadcast (Segregation of Duties)',
      );
    }

    const claim = await this.prisma.broadcastMessage.updateMany({
      where: { id, status: 'PENDING_APPROVAL' },
      data: {
        status: 'REJECTED',
        rejectedById: rejecterId,
        rejectedAt: new Date(),
        rejectedReason: reason.trim(),
      },
    });

    if (claim.count !== 1) throw new BadRequestException('รายการนี้ถูกดำเนินการโดยผู้ใช้อื่นแล้ว');
    return { success: true, message: 'ปฏิเสธ broadcast แล้ว', id };
  }

  /** Called by cron — process all due SCHEDULED messages */
  async sendScheduledMessages(): Promise<{ sent: number; failed: number }> {
    // (Audit finding P1) Multi-instance safe: claim each candidate via a
    // conditional updateMany(SCHEDULED → SENDING). Two Cloud Run instances
    // racing on the same row will both try to flip the status; only one
    // wins (count=1), the other gets count=0 and skips. Without this
    // claim, a 1-min cron + 2 instances meant duplicate LINE messages
    // were being sent to customers on every horizontal scale event.
    const candidates = await this.prisma.broadcastMessage.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { lte: new Date() },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 200,
      select: { id: true },
    });

    let sent = 0;
    let failed = 0;

    for (const candidate of candidates) {
      // Atomic claim: flip SCHEDULED → SENDING. count=0 means another
      // instance already claimed this row — skip silently.
      const claim = await this.prisma.broadcastMessage.updateMany({
        where: { id: candidate.id, status: 'SCHEDULED' },
        data: { status: 'SENDING' },
      });
      if (claim.count !== 1) continue;

      // Re-read with full payload now that we own the row
      const msg = await this.prisma.broadcastMessage.findUnique({
        where: { id: candidate.id },
      });
      if (!msg) continue;

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
    const claim = await this.prisma.broadcastMessage.updateMany({
      where: { id, status: 'SCHEDULED' },
      data: { status: 'CANCELLED' },
    });
    if (claim.count !== 1) return { success: false, message: 'รายการนี้เริ่มส่งหรือถูกดำเนินการแล้ว' };
    return { success: true, message: 'ยกเลิกการส่งสำเร็จ' };
  }

  // ─── Image Upload ─────────────────────────────────────────────────────────────

  async uploadImage(file: Buffer): Promise<{ url: string }> {
    // FileTypeValidator checks bytes but leaves the client MIME header untouched.
    const signature = file.subarray(0, 12);
    const contentType = signature.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'image/png'
      : signature.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ? 'image/jpeg'
      : ['GIF87a', 'GIF89a'].includes(signature.subarray(0, 6).toString()) ? 'image/gif'
      : signature.subarray(0, 4).toString() === 'RIFF' && signature.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : '';
    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
    };
    const extension = extensions[contentType];
    if (!extension) throw new BadRequestException('รูปแบบรูปภาพไม่รองรับ');
    return this.uploadMedia(file, `images/${randomUUID()}.${extension}`, contentType);
  }

  async uploadVideo(file: Buffer): Promise<{ url: string }> {
    return this.uploadMedia(file, `videos/${randomUUID()}.mp4`, 'video/mp4');
  }

  private async uploadMedia(file: Buffer, name: string, contentType: string) {
    if (!this.storageService.configured || this.storageService.describe().backend === 'local') {
      throw new ServiceUnavailableException('กรุณาตั้งค่าที่เก็บไฟล์สาธารณะสำหรับ Broadcast');
    }
    const key = `broadcast/${name}`;
    await this.storageService.upload(key, file, contentType);
    return { url: this.storageService.getPublicUrl(key) };
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
    const token = await this.integrationConfig.getValue('line-shop', 'channelToken');
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

  private normalizeAudience(audience: string): string {
    const key = String(audience).toUpperCase();
    if (key === 'ACTIVE') return 'EXISTING'; // Older composer drafts used this name.
    if (['ALL', 'EXISTING', 'OVERDUE', 'NEW'].includes(key)) return key;
    throw new BadRequestException('กลุ่มผู้รับไม่ถูกต้อง');
  }

  private mediaUrl(value: unknown): string {
    if (typeof value === 'string' && value.length <= 2000) {
      try {
        const url = new URL(value);
        if (url.protocol === 'https:' && !url.username && !url.password) return value;
      } catch { /* Report the same actionable validation error below. */ }
    }
    throw new BadRequestException('ลิงก์สื่อและรูปปกต้องเป็น HTTPS ที่เข้าถึงได้');
  }

  private buildLineMessage(type: string, content: any): LineMessage {
    if (type === 'text') {
      const text = typeof content === 'string' ? content : content?.text;
      if (typeof text !== 'string' || !text.trim() || text.length > 5000) {
        throw new BadRequestException('ข้อความต้องมีความยาว 1–5,000 ตัวอักษร');
      }
      return { type: 'text', text };
    }
    if (type === 'image') {
      const url = this.mediaUrl(content?.imageUrl ?? content?.originalContentUrl);
      return { type: 'image', originalContentUrl: url, previewImageUrl: this.mediaUrl(content?.previewImageUrl ?? url) };
    }
    if (type === 'video') {
      return {
        type: 'video',
        originalContentUrl: this.mediaUrl(content?.videoUrl ?? content?.originalContentUrl),
        previewImageUrl: this.mediaUrl(content?.thumbnailUrl ?? content?.previewImageUrl),
      };
    }
    if (type === 'flex') {
      const contents = content?.flexContents ?? content?.contents ?? content;
      if (!contents || !['bubble', 'carousel'].includes(contents.type)) {
        throw new BadRequestException('รูปแบบข้อความ Flex ไม่ถูกต้อง');
      }
      return { type: 'flex', altText: content.altText ?? 'ข้อความจาก BESTCHOICE', contents };
    }
    if (type === 'rich') {
      const url = this.mediaUrl(content?.imageUrl);
      return { type: 'flex', altText: 'ข้อความจาก BESTCHOICE', contents: {
        type: 'bubble', hero: { type: 'image', url, size: 'full', aspectMode: 'fit',
          ...(content.linkUrl ? { action: { type: 'uri', uri: this.mediaUrl(content.linkUrl) } } : {}),
        },
      } };
    }
    throw new BadRequestException('รูปแบบข้อความไม่รองรับ');
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
    audience = this.normalizeAudience(audience);
    try {
      const token = await this.integrationConfig.getValue('line-shop', 'channelToken');
      if (!token) return { success: false, message: 'LINE token not configured' };

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
