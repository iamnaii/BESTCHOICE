import type { InboundAttribution } from '../interfaces/channel-adapter.interface';
import {
  Injectable,
  Logger,
  Optional,
  Inject,
  forwardRef,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AdsPlatform,
  ChatChannel,
  ChatRoom,
  ChatRoomStatus,
  ChatPriority,
  MessageRole,
  MessageType,
  Prisma,
  TodoStatus,
} from '@prisma/client';
import { AssignmentService } from './assignment.service';
import { MessageRouterService } from './message-router.service';
import { StorageService } from '../../storage/storage.service';
import { signMessageMedia } from './media-url.util';
import { linkRoomCreditHistory, lockCreditRoom } from '../../credit-check/services/room-credit-history';
import { ChatProspectService } from '../../chat-prospects/chat-prospect.service';
import { CustomerMergeService } from '../../chat-prospects/customer-merge.service';
import { PLACEHOLDER_FIELDS_SELECT, isLivePlaceholder } from '../../chat-prospects/chat-placeholder';
import * as Sentry from '@sentry/nestjs';

/** ตัวกรองห้องแชท — ใช้ร่วมกันระหว่างรายการห้อง (listRooms) กับตัวนับบนป้าย
 *  (getRoomBadgeCounts) เพื่อไม่ให้ "เลขบนป้าย" กับ "จำนวนแถวที่แท็บนั้นแสดง"
 *  เพี้ยนจากกันได้อีก */
/** นัดถัดไปของห้อง (ยังไม่เสร็จ มีวันเวลา) — ป้ายในแถวรายชื่อ + ชิปหัวห้อง (เจ้าของเคาะ 2026-09-06 ชั้น 1) */
const ROOM_NEXT_APPOINTMENT = {
  where: { deletedAt: null, status: { not: TodoStatus.DONE }, dueDate: { not: null } },
  orderBy: { dueDate: 'asc' as const },
  take: 1,
  select: { id: true, title: true, dueDate: true, status: true },
};

export interface RoomFilterParams {
  channel?: ChatChannel;
  status?: ChatRoomStatus;
  priority?: ChatPriority;
  assignedToId?: string;
  customerId?: string;
  unassignedOnly?: boolean;
  unreadOnly?: boolean;
  /** แท็บ "รอตอบ" — ลูกค้ารอคำตอบจากคน **และยังตอบทัน** (FACEBOOK ต้องมี lastCustomerAt ใน 24 ชม. · ช่องทางอื่นไม่มีหน้าต่าง)
   *  เรียงสองชั้น: ใกล้หมดเวลาก่อน แล้วรอนานก่อน (สเปก §7 แก้ไข 2026-09-05) */
  waiting?: boolean;
  /** เฉพาะห้องที่ยังไม่ปิดงาน (resolvedAt ว่าง) — แท็บ "ของฉัน" */
  openOnly?: boolean;
  /** มุมมอง "ตอบไม่ทัน" — FACEBOOK ที่รออยู่แต่พ้นหน้าต่าง 24 ชม. แล้ว (หรือยังไม่มี lastCustomerAt) */
  expired?: boolean;
  channels?: ChatChannel[];
  aiStatus?: 'ai' | 'human' | 'pending';
  search?: string;
}

/** แท็บของกล่องข้อความ — ป้ายแต่ละใบต้องนับ "จำนวนแถวที่แท็บนั้นแสดง" เป๊ะ ๆ */
export type InboxTabKey = 'waiting' | 'mine' | 'all';

/** หน้าต่างตอบของ Facebook Messenger นับจากข้อความล่าสุดของลูกค้า (สเปก §8) */
export const FB_WINDOW_MS = 24 * 60 * 60 * 1000;
/** "ใกล้หมดเวลา" = เหลือไม่เกิน 3 ชม. — ชั้นแรกของการเรียงคิว */
export const FB_CLOSING_MS = 3 * 60 * 60 * 1000;
/** ห้อง FACEBOOK ที่ยังตอบทัน / ใกล้หมดเวลา — จุดเดียวของกติกา ห้ามคำนวณซ้ำที่อื่น */
export function fbWindowBounds(now: Date = new Date()): { open: Date; closing: Date } {
  return {
    open: new Date(now.getTime() - FB_WINDOW_MS),
    closing: new Date(now.getTime() - FB_WINDOW_MS + FB_CLOSING_MS),
  };
}

/**
 * RoomManagerService — generalized from SessionManagerService.
 *
 * Manages chat rooms across ALL channels (not just LINE Finance).
 * Key behaviour change: ALWAYS returns the existing room for the same
 * (externalUserId, channel). Never creates a new room if one already exists.
 * If the room is IDLE it is reopened to ACTIVE.
 */
@Injectable()
export class RoomManagerService {
  private readonly logger = new Logger(RoomManagerService.name);

  /**
   * อายุ signed URL ที่ยื่นให้ adapter — ยาวกว่าที่ inbox ใช้ (1 ชม.) เพราะ LINE
   * โหลด originalContentUrl ตอนลูกค้าเปิดดู ไม่ใช่ตอนส่ง. 6 วัน = ใต้เพดาน
   * V4 signing (7 วัน) และไม่ต้องเปิด object ให้เป็น public (PDPA)
   */
  private static readonly ADAPTER_MEDIA_TTL_SEC = 6 * 24 * 3600; // 518400

  /**
   * หน้าต่างของ "ข้อความทักทายอัตโนมัติของเพจ" — greeting ยิงกลับแทบจะทันทีที่ลูกค้า
   * ทักครั้งแรก (หลักวินาที) 60 วิ จึงกว้างพอรับความหน่วงของ webhook แต่แคบพอที่
   * คำตอบของคนจริงแทบไม่มีทางตกอยู่ในนั้น — ดู shouldSkipFirstOutboundClear
   */
  private static readonly FIRST_OUTBOUND_GREETING_WINDOW_MS = 60_000;

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    // ⚠️ dead code ตั้งแต่ Task 8 — ไม่มีผู้เรียกใน production แล้ว (createRoom เลิก autoAssign;
    // การรับเรื่องย้ายไป AssignmentService.claimIfUnassigned หลังคำตอบถึงลูกค้า) เก็บไว้รอรอบเก็บกวาด
    @Optional() @Inject(forwardRef(() => AssignmentService))
    private assignmentService?: AssignmentService,
    @Optional() @Inject(forwardRef(() => MessageRouterService))
    private messageRouter?: MessageRouterService,
    @Optional()
    private chatProspects?: ChatProspectService,
    @Optional()
    private merge?: CustomerMergeService,
  ) {}

  /**
   * Find or create a room for any channel.
   * ALWAYS returns existing room for same (externalUserId, channel).
   * Only creates a new room if truly none exists.
   *
   * ผู้สนใจอัตโนมัติ (สเปค 3.2): ห้องที่ยังไม่มีเจ้าของ (ใหม่ หรือเดิมที่ backfill ไม่ทัน) ได้ customerId
   * กลับไปในผลลัพธ์เลย · `ensureProspect` ค่าตั้งต้น = ทุกช่องทางยกเว้น WEB (Ruling R3 — widget init/connect
   * สร้างห้องทุกครั้งที่เปิดหน้าเว็บ ผู้เรียกที่รู้ว่าลูกค้าทักจริงส่ง `true` เอง)
   */
  async getOrCreateRoom(params: {
    externalUserId: string;
    channel: ChatChannel;
    customerId?: string;
    displayName?: string | null;
    pictureUrl?: string | null;
    attribution?: InboundAttribution;
    ensureProspect?: boolean;
  }): Promise<ChatRoom> {
    const isLineChannel =
      params.channel === ChatChannel.LINE_FINANCE ||
      params.channel === ChatChannel.LINE_SHOP;
    const wantsProspect = params.ensureProspect ?? params.channel !== ChatChannel.WEB;

    // Always find existing room first — no status filter
    let existing: ChatRoom | null = null;

    if (isLineChannel) {
      existing = await this.prisma.chatRoom.findUnique({
        where: {
          lineUserId_channel: {
            lineUserId: params.externalUserId,
            channel: params.channel,
          },
        },
      });
    } else {
      existing = await this.prisma.chatRoom.findFirst({
        where: {
          externalUserId: params.externalUserId,
          channel: params.channel,
          deletedAt: null,
        },
      });
    }

    if (existing) {
      const updateData: Prisma.ChatRoomUpdateInput = {};
      // Reopen if IDLE — ต้องล้าง resolvedAt ด้วย (ให้ตรงกับ assignment.reopen):
      // หน้ากล่องข้อความถือ `!!resolvedAt || status === 'IDLE'` = ปิดแล้ว → ซ่อนช่องพิมพ์
      // + โชว์ "แชทนี้ปิดแล้ว" ทั้งที่ลูกค้าเพิ่งทักกลับมา (พบ 26 ห้องบน prod 2026-08-23)
      if (existing.status === ChatRoomStatus.IDLE || existing.resolvedAt) {
        updateData.status = ChatRoomStatus.ACTIVE;
        updateData.resolvedAt = null;
      }
      // Backfill profile for legacy rooms — displayName and pictureUrl handled
      // INDEPENDENTLY so a room that already has a name (e.g. from the FB
      // conversations-API fallback, which has no avatar) still gets its picture
      // filled in the next time getUserProfile can resolve one. routeInbound
      // already fetches the profile on every inbound, so this adds no API calls.
      if (!existing.displayName && params.displayName) {
        updateData.displayName = params.displayName;
      }
      if (!existing.pictureUrl && params.pictureUrl) {
        updateData.pictureUrl = params.pictureUrl;
      }
      let room =
        Object.keys(updateData).length > 0
          ? await this.prisma.chatRoom.update({ where: { id: existing.id }, data: updateData })
          : existing;
      if (!room.customerId) {
        // self-heal ห้องที่ยังไม่มีเจ้าของ (backfill ไม่ทัน / สร้างผู้สนใจล้มรอบก่อน)
        if (wantsProspect) {
          const customerId = await this.ensureProspect(room.id);
          if (customerId) room = { ...room, customerId };
        }
      } else if (updateData.displayName && this.chatProspects) {
        // ห้องเกิดก่อนรู้ชื่อ (mirrorOutbound) → placeholder ที่ยังใช้ชื่อ fallback ได้ชื่อจริงตาม
        const roomId = room.id;
        await this.chatProspects.syncNameFromRoom(roomId).catch((err) =>
          this.logger.warn(`[prospect] sync name ${roomId}: ${err instanceof Error ? err.message : err}`),
        );
      }
      // ลูกค้าเก่ากดโฆษณา/ลิงก์ซ้ำ — บันทึกที่มาครั้งล่าสุดให้ห้องเดิมด้วย (เดิมบันทึกเฉพาะห้องใหม่)
      if (params.attribution?.utmSource) {
        await this.linkAttribution(room.id, params.attribution, room.attributionId);
      }
      return room;
    }

    // Try to find linked customer
    let customerId = params.customerId;
    if (!customerId && isLineChannel) {
      const channelType = params.channel === ChatChannel.LINE_FINANCE ? 'FINANCE' : 'SHOP';
      const link = await this.prisma.customerLineLink.findUnique({
        where: {
          lineUserId_channel: {
            lineUserId: params.externalUserId,
            channel: channelType,
          },
        },
      });
      customerId = link?.customerId;
    }

    const room = await this.prisma.chatRoom.create({
      data: {
        lineUserId: isLineChannel ? params.externalUserId : null,
        externalUserId: isLineChannel ? undefined : params.externalUserId,
        channel: params.channel,
        customerId,
        verifiedAt: customerId ? new Date() : null,
        status: ChatRoomStatus.ACTIVE,
        priority: ChatPriority.NORMAL,
        displayName: params.displayName ?? null,
        pictureUrl: params.pictureUrl ?? null,
      },
    });

    // ที่มาของลูกค้า (โฆษณา/UTM) — best-effort ห้ามทำให้การสร้างห้องล้ม
    if (params.attribution?.utmSource) {
      await this.linkAttribution(room.id, params.attribution, null);
    }

    // ไม่แจกห้องอัตโนมัติอีก — ใครตอบก่อนได้เป็นเจ้าของ (AssignmentService.claimIfUnassigned · สเปก §5)

    if (!room.customerId && wantsProspect) {
      const prospectId = await this.ensureProspect(room.id);
      if (prospectId) return { ...room, customerId: prospectId };
    }
    return room;
  }

  /**
   * ผู้สนใจอัตโนมัติ (สเปค 3.2) — best-effort: ห้องต้องไม่ล้มเพราะสร้างผู้สนใจไม่ได้ (log + Sentry แล้วปล่อยผ่าน)
   * กิ่ง existing ของ getOrCreateRoom เก็บตกให้ตอนคนทักกลับ · public เพราะ widget:send (WebWidgetGateway)
   * บันทึกข้อความผู้ชมเว็บเองโดยไม่ผ่าน getOrCreateRoom/routeInbound — ไม่โยน error คืน null เมื่อไม่สำเร็จ
   */
  async ensureProspect(roomId: string): Promise<string | null> {
    if (!this.chatProspects) return null;
    try {
      const result = await this.chatProspects.ensureForRoom(roomId);
      return result?.customerId ?? null;
    } catch (err) {
      this.logger.warn(`[prospect] room ${roomId}: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { kind: 'chat-prospect' }, extra: { roomId } });
      return null;
    }
  }

  /** ชื่อพนักงานสำหรับข้อความระบบ ("มอบหมายให้ แนน โดย …") — ไม่พบคืน "พนักงาน" */
  async getStaffName(staffId: string | null | undefined): Promise<string> {
    if (!staffId) return 'พนักงาน';
    const u = await this.prisma.user.findUnique({ where: { id: staffId }, select: { name: true } });
    return u?.name || 'พนักงาน';
  }

  /** ห้องล่าสุดของผู้ใช้ภายนอกในช่องทางนั้น (ใช้ตอน referral มาโดยไม่มีข้อความ) */
  async findByExternalUser(
    externalUserId: string,
    channel: ChatChannel,
  ): Promise<{ id: string; attributionId: string | null } | null> {
    return this.prisma.chatRoom.findFirst({
      where: { externalUserId, channel, deletedAt: null },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true, attributionId: true },
    });
  }

  /**
   * ผูก "ที่มา" (โฆษณา/UTM) ให้ห้อง — ท่าเดียวกับ OBI `Util\Facebook::ads` + `chat_room.facebook_ad_id`:
   * แคมเปญคีย์ด้วย ad_id · ชื่อ/รูปโฆษณาเติมจาก ads_context_data เมื่อมี (ครั้งแรกอาจว่าง ครั้งหลังเติมได้) ·
   * ห้องที่มีที่มาอยู่แล้วและมาจากโฆษณา "ตัวเดิม" → อัปเดต lastTouch · โฆษณา "ตัวใหม่" → attribution ใหม่
   * แล้วชี้ห้องไปที่ล่าสุด (พนักงานต้องรู้ว่าลูกค้าเพิ่งเห็นชิ้นไหน ไม่ใช่ชิ้นแรกเมื่อ 3 เดือนก่อน)
   * best-effort ทั้งก้อน — ห้ามทำให้ webhook/การสร้างห้องล้ม
   */
  async linkAttribution(
    roomId: string,
    attribution: InboundAttribution,
    currentAttributionId: string | null,
  ): Promise<{ campaignName: string; adTitle: string | null; changed: boolean } | null> {
    try {
      const platformMap: Record<string, AdsPlatform> = {
        facebook: AdsPlatform.FACEBOOK_ADS,
        tiktok: AdsPlatform.TIKTOK_ADS,
        line: AdsPlatform.LINE_ADS,
        google: AdsPlatform.GOOGLE_ADS,
      };
      const platform =
        platformMap[(attribution.utmSource ?? '').toLowerCase()] ?? AdsPlatform.FACEBOOK_ADS;
      const campaignKey = attribution.adId ?? attribution.utmCampaign ?? 'organic';

      let campaign = await this.prisma.adsCampaign.findFirst({
        where: { platform, campaignId: campaignKey, deletedAt: null },
      });
      if (!campaign) {
        campaign = await this.prisma.adsCampaign.create({
          data: {
            platform,
            campaignId: campaignKey,
            campaignName: attribution.adTitle ?? attribution.utmCampaign ?? 'Auto-detected',
            adName: attribution.adTitle ?? null,
            adPhotoUrl: attribution.adPhotoUrl ?? null,
          },
        });
      } else if (
        (attribution.adTitle && !campaign.adName) ||
        (attribution.adPhotoUrl && !campaign.adPhotoUrl)
      ) {
        // referral ก่อนหน้าอาจไม่มี ads_context_data — เติมชื่อ/รูปเมื่อได้มา ไม่ทับของที่มีอยู่
        campaign = await this.prisma.adsCampaign.update({
          where: { id: campaign.id },
          data: {
            adName: campaign.adName ?? attribution.adTitle ?? null,
            adPhotoUrl: campaign.adPhotoUrl ?? attribution.adPhotoUrl ?? null,
            ...(campaign.campaignName === 'Auto-detected' && attribution.adTitle
              ? { campaignName: attribution.adTitle }
              : {}),
          },
        });
      }

      const now = new Date();
      if (currentAttributionId) {
        const current = await this.prisma.adsAttribution.findUnique({
          where: { id: currentAttributionId },
          select: { id: true, campaignId: true },
        });
        if (current && current.campaignId === campaign.id) {
          await this.prisma.adsAttribution.update({
            where: { id: current.id },
            data: { lastTouch: now },
          });
          return { campaignName: campaign.campaignName, adTitle: campaign.adName, changed: false };
        }
      }
      const created = await this.prisma.adsAttribution.create({
        data: {
          campaignId: campaign.id,
          utmSource: attribution.utmSource,
          utmCampaign: attribution.utmCampaign ?? attribution.adId,
          utmContent: attribution.utmContent,
          referrerUrl: attribution.referrerUrl,
          firstTouch: now,
          lastTouch: now,
        },
      });
      await this.prisma.chatRoom.update({
        where: { id: roomId },
        data: { attributionId: created.id },
      });
      this.logger.log(`[Attribution] Linked campaign "${campaignKey}" to room ${roomId}`);
      return { campaignName: campaign.campaignName, adTitle: campaign.adName, changed: true };
    } catch (err) {
      this.logger.error(
        `[Attribution] Failed to link attribution for room ${roomId}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  /**
   * นัดที่ถึงเวลา/ใกล้ถึง (≤15 นาที) หรือเลยมาไม่เกิน 24 ชม. ของทุกห้อง — แถบเตือนเหนือทุกแผง (ชั้น 2)
   * เลยเกิน 24 ชม. = เก่าจนเตือนไม่มีประโยชน์ ปล่อยให้เห็นเป็นป้ายแดงในแถวรายชื่อแทน
   */
  async listDueAppointments(now: Date = new Date()) {
    return this.prisma.todo.findMany({
      where: {
        deletedAt: null,
        roomId: { not: null },
        status: { not: TodoStatus.DONE },
        dueDate: { gte: new Date(now.getTime() - 24 * 3600_000), lte: new Date(now.getTime() + 15 * 60_000) },
      },
      orderBy: { dueDate: 'asc' },
      take: 20,
      select: {
        id: true, title: true, dueDate: true, status: true, roomId: true,
        room: { select: { id: true, displayName: true, customer: { select: { name: true } } } },
      },
    });
  }

  /** Save a message and update room stats */
  /**
   * ห้องนี้บอทเคยตอบไปแล้วหรือยัง — ใช้แยก "พนักงานแทรกกลางบทสนทนาที่บอทคุยอยู่"
   * (ต้อง pause AI) ออกจาก "ข้อความทักทายอัตโนมัติของเพจตอนลูกค้าทักครั้งแรก"
   * (ห้าม pause — ไม่งั้นทุกห้องใหม่โดนปิด AI ตั้งแต่ข้อความแรก)
   */
  async hasBotReplied(roomId: string): Promise<boolean> {
    const row = await this.prisma.chatMessage.findFirst({
      where: { roomId, role: MessageRole.BOT, deletedAt: null },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * พนักงานพิมพ์เอง = takeover โดยพฤตินัย — หยุด AI ห้องนี้จนกว่าจะกด "คืนให้ AI"
   * updateMany + เงื่อนไข aiPaused:false = idempotent (คืน true เฉพาะครั้งที่เปลี่ยนจริง)
   */
  async pauseAiIfActive(roomId: string, staffId?: string): Promise<boolean> {
    const res = await this.prisma.chatRoom.updateMany({
      where: { id: roomId, aiPaused: false },
      data: {
        aiPaused: true,
        aiPausedAt: new Date(),
        ...(staffId ? { aiPausedById: staffId } : {}),
      },
    });
    return res.count > 0;
  }

  async saveMessage(params: {
    roomId: string;
    externalMessageId?: string;
    role: MessageRole;
    type?: MessageType;
    text?: string;
    mediaUrl?: string;
    mediaType?: string;
    staffId?: string;
    intent?: string;
    modelUsed?: string;
    inputTokens?: number;
    outputTokens?: number;
    toolsUsed?: string[];
    costUsd?: number;
    visionExtracted?: Prisma.InputJsonValue;
    clientMessageId?: string;
    /** ข้อความระบบที่ไม่ใช่การสนทนา (มอบหมาย/ปิดงาน/โฆษณา) — ไม่แตะ lastMessageAt/totalMessages/unread
     *  ไม่งั้นห้องที่ปิดงานเด้งขึ้นบนสุดและพรีวิวรายการซ้ายกลายเป็นบรรทัดระบบ */
    silent?: boolean;
  }) {
    const msg = await this.prisma.chatMessage.create({
      data: {
        roomId: params.roomId,
        externalMessageId: params.externalMessageId,
        role: params.role,
        type: params.type ?? MessageType.TEXT,
        text: params.text,
        mediaUrl: params.mediaUrl,
        mediaType: params.mediaType,
        staffId: params.staffId,
        intent: params.intent,
        modelUsed: params.modelUsed,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        toolsUsed: params.toolsUsed ?? [],
        costUsd: params.costUsd,
        visionExtracted: params.visionExtracted,
        clientMessageId: params.clientMessageId,
      },
    });

    if (params.silent) return msg;

    // Track first staff/bot response for SLA
    const updateData: Prisma.ChatRoomUpdateInput = {
      totalMessages: { increment: 1 },
      lastMessageAt: new Date(),
    };

    if (params.role === MessageRole.CUSTOMER) {
      // Inbound message — increment unread until staff opens the room (markAsRead resets it).
      updateData.unreadCount = { increment: 1 };
    } else if (params.role === MessageRole.STAFF || params.role === MessageRole.BOT) {
      // Set firstResponseAt if not already set (SLA metric)
      const room = await this.prisma.chatRoom.findUnique({
        where: { id: params.roomId },
        select: { firstResponseAt: true },
      });
      if (!room?.firstResponseAt) {
        updateData.firstResponseAt = new Date();
      }
    }

    await this.prisma.chatRoom.update({
      where: { id: params.roomId },
      data: updateData,
    });

    if (params.role === MessageRole.CUSTOMER) {
      // "รอตอบตั้งแต่" (สเปก §4.2) — set-if-null แบบ atomic: เก็บเวลาข้อความ *แรก* ที่ยังไม่ได้ตอบ
      // ไม่ใช่ใบล่าสุด และไม่ต้องอ่านก่อนเขียน (สองข้อความมาพร้อมกันได้ค่าเดียวกัน)
      // ⚠️ ห้ามล้างที่นี่สำหรับ STAFF/BOT — การส่งที่ล้มก็ผ่าน saveMessage (save-before-send)
      await this.prisma.chatRoom.updateMany({
        where: { id: params.roomId, waitingSince: null },
        data: { waitingSince: msg.createdAt },
      });
      // เวลาข้อความ *ล่าสุด* ของลูกค้า (หน้าต่าง 24 ชม. ของ FB นับจากตัวนี้) — เดินหน้าอย่างเดียว
      // ข้อความเก่าที่มาถึงช้า (retry/echo) ต้องไม่ดึงค่าถอยหลัง
      await this.prisma.chatRoom.updateMany({
        where: {
          id: params.roomId,
          OR: [{ lastCustomerAt: null }, { lastCustomerAt: { lt: msg.createdAt } }],
        },
        data: { lastCustomerAt: msg.createdAt },
      });
    }

    return msg;
  }

  /** Look up an existing message by its client-generated idempotency token. */
  async findByClientMessageId(roomId: string, clientMessageId: string) {
    return this.prisma.chatMessage.findFirst({
      where: { roomId, clientMessageId },
    });
  }

  /**
   * echo ใบนี้ "หน้าตาเหมือนข้อความทักทายอัตโนมัติของเพจ" หรือไม่ — ถ้าใช่ ห้ามล้าง waitingSince
   *
   * ที่มา: `facebook-webhook.controller.ts` stamp role STAFF ให้ echo ทุกใบที่ไม่ได้มาจาก
   * `FACEBOOK_APP_ID` ของเราเอง ซึ่งรวม **ข้อความทักทายอัตโนมัติของเพจ** ที่ยิงทุกครั้งที่
   * ลูกค้าทักครั้งแรก (บั๊กจริง 2026-08-21: greeting ตัวเดียวกันนี้ปิด AI ไป 633 ห้อง)
   * ⇒ ถ้าปล่อยให้ล้าง ลูกค้าใหม่จะหลุดจากแท็บ "รอตอบ" ทั้งที่ยังไม่มีคนตอบ = อาการที่ฟีเจอร์นี้
   * ถูกสร้างมาเพื่อป้องกันพอดี
   *
   * เงื่อนไขต้องครบทั้งสอง (= รูปร่างเฉพาะตัวของ greeting: ใบแรกสุด + ทันที):
   *   1. หลังบันทึก echo ใบนี้แล้ว ห้องมีข้อความ STAFF+BOT รวมกัน **หนึ่งใบพอดี** (คือใบนี้)
   *   2. มาถึงภายใน 60 วินาทีนับจาก `waitingSince` ของห้อง
   * คำตอบของคนจริงจะโดนด่านนี้ก็ต่อเมื่อตอบภายในหนึ่งนาทีหลังข้อความแรกสุดของลูกค้า
   * **และไม่เคยมีคำตอบใบถัดไปอีกเลย** — ผลคือห้องยังค้างในคิวเฉย ๆ ซึ่งเป็นทิศที่ปลอดภัย
   *
   * ด่านนี้ถอดออกได้เมื่อเจ้าของปิดข้อความทักทายอัตโนมัติของเพจ (ดูคำถามค้างในสเปก §10)
   */
  async shouldSkipFirstOutboundClear(
    roomId: string,
    outboundMessageId: string,
  ): Promise<boolean> {
    const [room, outbound, outboundCount] = await Promise.all([
      this.prisma.chatRoom.findUnique({
        where: { id: roomId },
        select: { waitingSince: true },
      }),
      this.prisma.chatMessage.findUnique({
        where: { id: outboundMessageId },
        select: { createdAt: true },
      }),
      this.prisma.chatMessage.count({
        where: {
          roomId,
          deletedAt: null,
          role: { in: [MessageRole.STAFF, MessageRole.BOT] },
        },
      }),
    ]);

    // ไม่มีใครรออยู่ / อ่านแถวไม่ได้ → ไม่ต้องกัน (clearWaiting เป็น no-op อยู่แล้ว)
    if (!room?.waitingSince || !outbound) return false;
    // ห้องเคยมีคำตอบใบอื่นมาก่อน → ไม่ใช่ greeting ใบแรก
    if (outboundCount !== 1) return false;

    const elapsedMs = outbound.createdAt.getTime() - room.waitingSince.getTime();
    return elapsedMs <= RoomManagerService.FIRST_OUTBOUND_GREETING_WINDOW_MS;
  }

  /**
   * ล้าง "รอตอบ" — เรียกได้เฉพาะเมื่อคำตอบจาก "คน" ถึงลูกค้าแล้ว (สเปก §3 / §4.3):
   *   markOutboundSent (inbox ส่งสำเร็จ) · mirrorOutbound STAFF (echo จาก Page Inbox) · resolve
   * ห้ามเรียกจาก saveMessage / BOT / การส่งที่ล้ม / markAsRead
   */
  async clearWaiting(roomId: string): Promise<void> {
    await this.prisma.chatRoom.updateMany({
      where: { id: roomId, waitingSince: { not: null } },
      data: { waitingSince: null },
    });
  }

  /**
   * Mark a message as successfully delivered to the customer (idempotency flag).
   * เก็บ platform message id ด้วยเมื่อ adapter คืนมา — FB echo webhook dedup
   * ชั้นที่ 2 อาศัย UNIQUE บน ChatMessage.externalMessageId
   * (facebook-webhook.controller.ts:298-303) ถ้าไม่ stamp ไว้ echo ของข้อความที่
   * เราส่งเองจะกลายเป็น bubble STAFF ซ้ำเมื่อ env FACEBOOK_APP_ID ไม่ได้ตั้ง
   */
  async markOutboundSent(messageId: string, externalMessageId?: string): Promise<void> {
    let roomId: string | undefined;
    try {
      const row = await this.prisma.chatMessage.update({
        where: { id: messageId },
        data: {
          outboundSentAt: new Date(),
          ...(externalMessageId ? { externalMessageId } : {}),
        },
      });
      roomId = row.roomId;
    } catch (err) {
      // echo webhook อาจมาถึงก่อน HTTP ของเราจะ return แล้วจอง mid ไปก่อน —
      // ยอมเสีย stamp ดีกว่า throw (ข้อความส่งถึงลูกค้าแล้ว ถ้า throw client จะ retry = ส่งซ้ำ)
      //
      // Accepted residual: this fallback only narrows the FB-echo-duplicate window,
      // it does NOT eliminate it. In the race that lands here, `mirrorOutbound`
      // (message-router.service.ts) has ALREADY inserted the echo as a second
      // ChatMessage row before this update collided — this P2002 fires strictly
      // after that insert, so there is no undo path back to one row here. What this
      // fallback DOES prevent is compounding that into a second problem: without it,
      // markOutboundSent would throw, the caller would treat the send as failed, and
      // a client retry would re-deliver the message to the customer for real (see
      // sendStaffMessage's own "Accepted residual" jsdoc — this is the same class of
      // unavoidable-without-2PC gap, one layer down). Trigger: env `FACEBOOK_APP_ID`
      // unset or mismatched, so facebook-webhook.controller.ts's layer-1 app_id check
      // (:319-330) can't short-circuit the echo before it reaches mirrorOutbound.
      if ((err as { code?: string })?.code === 'P2002' && externalMessageId) {
        this.logger.warn(
          `[markOutboundSent] externalMessageId ${externalMessageId} ถูกใช้แล้ว — stamp เฉพาะ outboundSentAt`,
        );
        const row = await this.prisma.chatMessage.update({
          where: { id: messageId },
          data: { outboundSentAt: new Date() },
        });
        roomId = row.roomId;
      } else {
        throw err;
      }
    }
    // ส่งถึงลูกค้าแล้วจริง (ทั้งสองทางด้านบน) → ลูกค้าไม่ได้รออีก
    if (roomId) await this.clearWaiting(roomId);
  }

  /** Get recent messages for AI context or display */
  async getRecentMessages(roomId: string, limit = 20, opts?: { signMedia?: boolean }) {
    const msgs = await this.prisma.chatMessage.findMany({
      where: {
        roomId,
        deletedAt: null,
        // WS1: ซ่อน draft เก่าที่ไม่เคยส่งถึงลูกค้า — pipeline ถูกถอดแล้ว
        // NULL-safe form: `NOT (intent LIKE 'DRAFT:%' AND deliveredAt IS NULL)`
        // evaluates to NULL (row dropped) when intent IS NULL under SQL
        // three-valued logic — and intent IS NULL on every customer/staff
        // message, so that form blanked the whole inbox. Enumerate the
        // visible cases instead of negating the hidden one.
        OR: [
          { intent: null },
          { NOT: { intent: { startsWith: 'DRAFT:' } } },
          { deliveredAt: { not: null } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { staff: { select: { id: true, name: true, avatarUrl: true } } },
    });
    const ordered = msgs.reverse();
    // Sign storage-key mediaUrls so the inbox can render staff-uploaded media
    // directly (uploadFile persists a raw key). Inbound LINE images already
    // carry an http(s) URL; line:// refs are fetched via the media endpoint.
    // NOTE: getSignedDownloadUrl makes a storage-API call per media message;
    // signMessageMedia runs them in parallel (Promise.all), so latency is the
    // slowest single presign, not the sum. Bounded by `limit` (default 20).
    if (opts?.signMedia === false || !this.storageService.configured) return ordered;
    return signMessageMedia(ordered, (key) => this.storageService.getSignedDownloadUrl(key, 3600));
  }

  /** Find room by ID with customer and assignment info */
  async findById(roomId: string) {
    return this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      include: {
        customer: { select: { id: true, name: true, phone: true, nationalId: true } },
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
        tags: true,
        todos: ROOM_NEXT_APPOINTMENT,
        // โน้ตปักหมุดของห้อง (ห้องละ 1) — แถบใต้หัวห้องในกระทู้
        notes: {
          where: { deletedAt: null, pinnedAt: { not: null } },
          orderBy: { pinnedAt: 'desc' },
          take: 1,
          include: { staff: { select: { id: true, name: true } } },
        },
        // "มาจากโฆษณา" ในแผงขวา — ชื่อ/รูปโฆษณา + ครั้งแรก/ล่าสุดที่ทักจากโฆษณา
        attribution: {
          select: {
            firstTouch: true,
            lastTouch: true,
            campaign: { select: { campaignId: true, campaignName: true, adName: true, adPhotoUrl: true } },
          },
        },
      },
    });
  }

  /**
   * Link an existing Customer record to a ChatRoom. Throws if the room is
   * already linked to a different customer — relinking requires explicit
   * unlink-then-link, not silent overwrite.
   * ยกเว้นห้องที่ผูก "ผู้สนใจอัตโนมัติ" (placeholder) อยู่ — ดูดเข้าคนที่เลือกแทน (สเปค 3.3 ก)
   */
  async linkCustomer(roomId: string, customerId: string, actor: { id: string; role: string }) {
    // ทำนอกทรานแซกชันด้านล่าง เพราะ absorbPlaceholder เปิดทรานแซกชันของตัวเอง
    // (ลูกค้าจริง ↔ ลูกค้าจริง ยังโยน "ผูกกับลูกค้ารายอื่น" ในทรานแซกชันเหมือนเดิม)
    if (this.merge) {
      const current = await this.prisma.chatRoom.findUnique({
        where: { id: roomId },
        select: {
          id: true, customerId: true, deletedAt: true, assignedToId: true,
          customer: { select: PLACEHOLDER_FIELDS_SELECT },
        },
      });
      if (current && !current.deletedAt && current.customerId && current.customerId !== customerId
        && isLivePlaceholder(current.customer)) {
        // ตรวจสิทธิ์ก่อนรวม — การรวมย้ายห้องทุกห้องของ placeholder จึงห้ามเกิดก่อนด่านนี้
        if (actor.role === 'SALES' && current.assignedToId && current.assignedToId !== actor.id) {
          throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงห้องแชทนี้');
        }
        await this.merge.absorbPlaceholder(current.customerId, customerId, actor);
        // แล้วไหลต่อทางผูกเดิม: ห้องอยู่กับคนที่เลือกแล้วจึงไม่ชน 409 และยังนำเข้าผลสเตทเม้นของห้อง
        // ที่ค้างอยู่ (creditCheckId ว่าง) — absorb ย้ายเฉพาะผลที่นำเข้าแล้ว
      }
    }
    return this.prisma.$transaction(async tx => {
    await lockCreditRoom(tx, roomId);
    const room = await tx.chatRoom.findUnique({
      where: { id: roomId },
      select: { id: true, customerId: true, deletedAt: true, assignedToId: true },
    });
    if (!room || room.deletedAt) {
      throw new NotFoundException('ห้องแชทไม่พบหรือถูกลบ');
    }
    if (actor.role === 'SALES' && room.assignedToId && room.assignedToId !== actor.id) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงห้องแชทนี้');
    }
    if (room.customerId && room.customerId !== customerId) {
      throw new ConflictException('ห้องแชทนี้ผูกกับลูกค้ารายอื่นอยู่แล้ว');
    }
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: { id: true, deletedAt: true },
    });
    if (!customer || customer.deletedAt) {
      throw new NotFoundException('ไม่พบลูกค้า');
    }
    const linked = await tx.chatRoom.update({
      where: { id: roomId },
      data: { customerId },
    });
    await linkRoomCreditHistory(tx, roomId, customerId);
    return linked;
    });
  }

  /** ประกอบ where ของห้องแชทจากตัวกรองชุดเดียว — แหล่งเดียวของทั้งรายการและตัวนับ
   *  ห้ามเขียนสำเนาที่สอง: ป้ายที่นับด้วยตัวกรองคนละชุดกับรายการคือป้ายที่โกหก */
  private buildRoomWhere(params: RoomFilterParams): Prisma.ChatRoomWhereInput {
    const where: Prisma.ChatRoomWhereInput = {
      deletedAt: null,
    };
    // เงื่อนไขที่มี OR ของตัวเอง (ค้นหา / รอตอบ / ตอบไม่ทัน / ช่องทางหลายอัน) ต้องซ้อนใน AND
    // — เดิมเขียน where.OR ทับกัน: ค้นหาบนแท็บรอตอบถูกทิ้งเงียบ ๆ และ expired+channels ทับ channel=FACEBOOK
    const and: Prisma.ChatRoomWhereInput[] = [];

    if (params.channel) where.channel = params.channel;
    if (params.status) where.status = params.status;
    if (params.priority) where.priority = params.priority;
    if (params.assignedToId) where.assignedToId = params.assignedToId;
    if (params.customerId) where.customerId = params.customerId;
    if (params.unassignedOnly) where.assignedToId = null;
    if (params.openOnly) where.resolvedAt = null;
    if (params.search) {
      and.push({
        OR: [
          { customer: { name: { contains: params.search, mode: 'insensitive' } } },
          { customer: { phone: { contains: params.search } } },
          { lineUserId: { contains: params.search } },
          // FB/TikTok/Web rooms often have no linked Customer yet — match on
          // the platform-fetched displayName + the channel-specific user id
          // (FB PSID, TikTok user id, web visitor id).
          { displayName: { contains: params.search, mode: 'insensitive' } },
          { externalUserId: { contains: params.search } },
        ],
      });
    }
    if (params.unreadOnly) where.unreadCount = { gt: 0 };
    if (params.waiting) {
      // รอตอบ *และยังตอบทัน*: ช่องทางที่ไม่ใช่ FACEBOOK ไม่มีหน้าต่าง · FACEBOOK ต้องมี lastCustomerAt ภายใน 24 ชม.
      // (null = ยังไม่เติมค่า = ถือว่าพ้นแล้ว — บน prod ทุกห้องเป็น null จนกว่า CLI จะรัน และ 44/68 ห้องพ้นจริง)
      where.waitingSince = { not: null };
      and.push({
        OR: [
          { channel: { not: ChatChannel.FACEBOOK } },
          { channel: ChatChannel.FACEBOOK, lastCustomerAt: { gte: fbWindowBounds().open } },
        ],
      });
    }
    if (params.expired) {
      where.waitingSince = { not: null };
      and.push({ channel: ChatChannel.FACEBOOK });
      and.push({ OR: [{ lastCustomerAt: null }, { lastCustomerAt: { lt: fbWindowBounds().open } }] });
    }
    // ช่องทางที่เลือกซ้อนกับเงื่อนไขอื่น (expired + LINE ⇒ ว่าง ซึ่งคือความจริง ไม่ใช่ห้อง LINE ที่ถูกป้ายว่าพ้น 24 ชม.)
    if (params.channels && params.channels.length > 0) and.push({ channel: { in: params.channels } });
    if (params.aiStatus === 'ai') {
      where.aiPaused = false;
      where.handoffMode = false;
    } else if (params.aiStatus === 'human') {
      where.aiPaused = true;
    } else if (params.aiStatus === 'pending') {
      where.handoffMode = true;
    }
    if (and.length > 0) where.AND = and;

    return where;
  }

  /** List rooms for the unified inbox with pagination and filters */
  async listRooms(params: RoomFilterParams & { page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const skip = (page - 1) * limit;

    const where = this.buildRoomWhere(params);
    const include = {
      customer: { select: { id: true, name: true, phone: true } },
      assignedTo: { select: { id: true, name: true, avatarUrl: true } },
      tags: true,
      todos: ROOM_NEXT_APPOINTMENT,
      messages: {
        // พรีวิว = ข้อความสนทนาล่าสุด — ข้อความระบบ (มอบหมาย/ปิดงาน/โฆษณา) ห้ามมาแทนที่ข้อความลูกค้า
        where: { deletedAt: null, role: { not: MessageRole.SYSTEM } },
        orderBy: { createdAt: 'desc' as const },
        take: 1,
        select: { text: true, role: true, createdAt: true },
      },
    };

    if (params.waiting) {
      // แท็บรอตอบเรียงสองชั้น (สเปก §7 แก้ไข 2026-09-05): ชั้น 1 = FACEBOOK ที่เหลือ ≤ 3 ชม. เรียงเหลือน้อยสุด
      // ชั้น 2 = ที่เหลือทุกช่องทาง เรียงรอนานสุด · Prisma เรียงด้วย CASE ไม่ได้ จึงดึง key ของทุกห้องที่ผ่าน where
      // (ชุดนี้เล็กโดยนิยาม — ห้องพ้นหน้าต่างถูกกันออกแล้ว) เรียงในหน่วยความจำ แล้ว hydrate เฉพาะหน้าที่ขอ
      // ⇒ where ยังเป็นชุดเดียวกับตัวนับ (buildRoomWhere) ไม่มีสำเนา SQL ที่สอง
      const { closing } = fbWindowBounds();
      const keys = await this.prisma.chatRoom.findMany({
        where,
        select: { id: true, channel: true, lastCustomerAt: true, waitingSince: true },
      });
      const tier = (k: (typeof keys)[number]) =>
        k.channel === ChatChannel.FACEBOOK && k.lastCustomerAt && k.lastCustomerAt < closing ? 0 : 1;
      keys.sort((a, b) => {
        const ta = tier(a), tb = tier(b);
        if (ta !== tb) return ta - tb;
        if (ta === 0) return a.lastCustomerAt!.getTime() - b.lastCustomerAt!.getTime();
        return (a.waitingSince?.getTime() ?? 0) - (b.waitingSince?.getTime() ?? 0);
      });
      const pageIds = keys.slice(skip, skip + limit).map((k) => k.id);
      const rows = pageIds.length
        ? await this.prisma.chatRoom.findMany({ where: { id: { in: pageIds } }, include })
        : [];
      const byId = new Map(rows.map((r) => [r.id, r]));
      const data = pageIds.map((id) => byId.get(id)!).filter(Boolean);
      return { data, total: keys.length, page, limit };
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.chatRoom.findMany({
        where,
        // แท็บอื่น: ปักหมุดก่อน แล้ว lastMessageAt (parity เดิม · priority ไม่ใช่ sort key โดยตั้งใจ)
        // มุมมอง "ตอบไม่ทัน": ใช้ลำดับเดียวกัน (ไม่มีอะไรให้เร่ง แค่ให้เห็นล่าสุดก่อน)
        orderBy: [
          { pinnedAt: { sort: 'desc' as const, nulls: 'last' as const } },
          // ห้องที่ปิดงานแล้วไปอยู่ท้ายรายการ (ปิดล่าสุดก่อน) — ไม่ปนกับงานที่ยังเปิด
          { resolvedAt: { sort: 'desc' as const, nulls: 'first' as const } },
          { lastMessageAt: 'desc' as const },
        ],
        skip,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          assignedTo: { select: { id: true, name: true, avatarUrl: true } },
          tags: true,
          todos: ROOM_NEXT_APPOINTMENT,
          messages: {
            // พรีวิวแถวรายชื่อ = ข้อความสนทนาล่าสุด — ข้อความระบบ (ปิดงาน/มอบหมาย/โฆษณา) ห้ามมาแทนที่
            // (listRooms มี 2 ทาง: คิวรอตอบใช้ `const include` ข้างบน · ทางปกติใช้ include ตรงนี้ — #1524 กรองแค่ทางแรก)
            where: { deletedAt: null, role: { not: MessageRole.SYSTEM } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { text: true, role: true, createdAt: true },
          },
        },
      }),
      this.prisma.chatRoom.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /** Link room to a verified customer */
  async linkRoomToCustomer(roomId: string, customerId: string): Promise<void> {
    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: {
        customerId,
        verifiedAt: new Date(),
        verificationAttempts: 0,
      },
    });
  }

  /** Get active room count for a staff member (or all if no staffId) */
  async getUnreadCount(staffId?: string) {
    const where: Prisma.ChatRoomWhereInput = {
      deletedAt: null,
      status: ChatRoomStatus.ACTIVE,
      handoffMode: true,
    };
    if (staffId) {
      where.OR = [{ assignedToId: staffId }, { assignedToId: null }];
    }
    const count = await this.prisma.chatRoom.count({ where });
    return { unread: count };
  }

  /** ตัวนับบนป้ายแท็บ + ชิปช่องทาง — นับทั้งจักรวาลห้อง ไม่ถูกตัดด้วย pagination
   *
   *  กติกาเดียวของเมธอดนี้: **เลขบนป้ายต้องเท่ากับจำนวนแถวที่แท็บนั้นแสดง**
   *
   *  ก่อน 2026-09-05 ทุกตัวนับใช้ตัวกรอง "ยังไม่อ่าน" ตัวเดียวกันหมด ⇒ ป้าย "ทั้งหมด"
   *  รายงานจำนวนห้องที่ยังไม่อ่าน · `unread` เป็นตัวแปรตัวเดียวกับ `all` เป๊ะ ๆ ·
   *  ป้าย "ของฉัน" นับเฉพาะห้องของฉัน**ที่ยังไม่อ่าน** · และชิปช่องทางนับเฉพาะห้อง
   *  ที่ยังไม่อ่านทั้งที่ชิปกรองทั้งแท็บ — สามในสี่ตัวโกหก
   *
   *  ชิปช่องทางนับ "ในจักรวาลของแท็บที่เปิดอยู่" ไม่ใช่ทั้งบริษัท เพราะชิปกรองทับแท็บ
   *  ตัวเลขบนชิปจึงตอบคำถามที่คนกดถามจริง ๆ ว่า "กดแล้วเหลือกี่ห้อง"
   */
  async getRoomBadgeCounts(
    staffId?: string,
    params?: { tab?: InboxTabKey; aiStatus?: 'ai' | 'human' | 'pending' },
  ): Promise<{
    /** ห้องที่ฉันดูแล — ทุกห้อง ไม่ใช่เฉพาะที่ยังไม่อ่าน */
    mine: number;
    /** ห้องทั้งหมดที่ยังไม่ถูกลบ */
    all: number;
    /** ห้องที่ลูกค้ารอคำตอบจากคน **และยังตอบทัน** — ทั้งบริษัท ไม่ผูกคน (สเปก §4.5, §7 แก้ไข) */
    waiting: number;
    /** ห้อง FACEBOOK ที่รออยู่แต่พ้นหน้าต่าง 24 ชม. แล้ว — มุมมอง "ตอบไม่ทัน" */
    expired: number;
    byChannel: Record<string, number>;
  }> {
    // ตัวกรองพื้นฐาน = สิ่งที่ผู้ใช้เลือกไว้นอกเหนือแท็บ (สถานะบอท) — ชุดเดียวกับรายการ
    const base = this.buildRoomWhere({ aiStatus: params?.aiStatus });
    const waitingWhere = this.buildRoomWhere({ aiStatus: params?.aiStatus, waiting: true });
    const expiredWhere = this.buildRoomWhere({ aiStatus: params?.aiStatus, expired: true });
    // ไม่รู้ว่าใครถาม = ไม่มี "ของฉัน" ให้นับ — ปล่อย assignedToId เป็น undefined ไม่ได้
    // เพราะ Prisma อ่านว่า "ไม่กรอง" ⇒ ทุกห้องกลายเป็นห้องของคนคนนั้น
    // "ของฉัน" = งานที่ยังเปิดของฉัน — ห้องที่ปิดงานแล้วไม่นับ (ชุดเดียวกับรายการ openOnly)
    const mineWhere: Prisma.ChatRoomWhereInput | null = staffId
      ? { ...base, assignedToId: staffId, resolvedAt: null }
      : null;
    const tabWhere: Prisma.ChatRoomWhereInput | null =
      params?.tab === 'waiting' ? waitingWhere : params?.tab === 'mine' ? mineWhere : base;

    const [all, mine, waiting, expired, byChannelRaw] = await Promise.all([
      this.prisma.chatRoom.count({ where: base }),
      mineWhere ? this.prisma.chatRoom.count({ where: mineWhere }) : Promise.resolve(0),
      this.prisma.chatRoom.count({ where: waitingWhere }),
      this.prisma.chatRoom.count({ where: expiredWhere }),
      this.prisma.chatRoom.groupBy({
        by: ['channel'],
        // tabWhere = null คือแท็บ "ของฉัน" ที่ไม่รู้ว่าใครถาม ⇒ ไม่มีห้องให้นับ
        where: tabWhere ?? { id: { in: [] } },
        _count: { id: true },
      }),
    ]);
    const byChannel: Record<string, number> = {};
    for (const g of byChannelRaw) byChannel[g.channel] = g._count.id;
    return { mine, all, waiting, expired, byChannel };
  }

  /** Search messages across all rooms */
  async searchMessages(params: {
    query: string;
    channel?: ChatChannel;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ChatMessageWhereInput = {
      deletedAt: null,
      text: { contains: params.query, mode: 'insensitive' },
    };
    if (params.channel) {
      where.room = { channel: params.channel, deletedAt: null };
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.chatMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          room: {
            select: {
              id: true,
              channel: true,
              customer: { select: { id: true, name: true } },
            },
          },
          staff: { select: { id: true, name: true } },
        },
      }),
      this.prisma.chatMessage.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /** Update room status */
  async updateRoomStatus(
    roomId: string,
    status: ChatRoomStatus,
  ): Promise<ChatRoom> {
    const data: Prisma.ChatRoomUpdateInput = { status };
    if (status === ChatRoomStatus.IDLE) {
      data.resolvedAt = new Date();
    }
    return this.prisma.chatRoom.update({ where: { id: roomId }, data });
  }

  /** Mark all unread customer messages in a room as read */
  async markMessagesRead(
    roomId: string,
    readAt: Date,
  ): Promise<{ count: number }> {
    const result = await this.prisma.chatMessage.updateMany({
      where: {
        roomId,
        role: MessageRole.CUSTOMER,
        readAt: null,
      },
      data: { readAt },
    });
    return { count: result.count };
  }

  /**
   * Throw a clean 404 for an unknown/soft-deleted room instead of letting the
   * subsequent `update` raise Prisma P2025 — which the global filter would
   * surface as a 500 + Sentry alert for what is an ordinary not-found.
   */
  private async assertRoomExists(roomId: string): Promise<void> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { id: true, deletedAt: true },
    });
    if (!room || room.deletedAt) throw new NotFoundException('ไม่พบห้องแชท');
  }

  /** Pin a room (records who pinned it and when) */
  async pinRoom(roomId: string, userId: string): Promise<void> {
    await this.assertRoomExists(roomId);
    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: { pinnedAt: new Date(), pinnedById: userId },
    });
  }

  /** Unpin a room */
  async unpinRoom(roomId: string): Promise<void> {
    await this.assertRoomExists(roomId);
    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: { pinnedAt: null, pinnedById: null },
    });
  }

  /**
   * Mark all unread customer messages in a room as read, recompute the
   * remaining unread count, and persist it on the room — all in one
   * transaction so the room's unreadCount can never drift from the
   * messages' readAt state.
   */
  async markAsRead(roomId: string): Promise<{ markedCount: number }> {
    await this.assertRoomExists(roomId);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.chatMessage.updateMany({
        where: { roomId: roomId, role: 'CUSTOMER', readAt: null },
        data: { readAt: now },
      });
      const remaining = await tx.chatMessage.count({
        where: { roomId: roomId, role: 'CUSTOMER', readAt: null },
      });
      await tx.chatRoom.update({
        where: { id: roomId },
        data: { unreadCount: remaining },
      });
      return { markedCount: updated.count };
    });
  }

  /** Bulk variant of markAsRead — marks every CUSTOMER message in the given
   *  rooms read and zeroes their unreadCount. Mirrors markAsRead's end-state. */
  async markAllAsRead(roomIds: string[]): Promise<{ count: number }> {
    if (!roomIds.length) return { count: 0 };
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.chatMessage.updateMany({
        where: { roomId: { in: roomIds }, role: 'CUSTOMER', readAt: null },
        data: { readAt: now },
      });
      const res = await tx.chatRoom.updateMany({
        where: { id: { in: roomIds }, deletedAt: null },
        data: { unreadCount: 0 },
      });
      return { count: res.count };
    });
  }

  /**
   * Store an uploaded file and deliver it to the customer.
   *
   * บั๊กเดิม (ถึง 2026-08-04): เมธอดนี้ saveMessage เป็น role BOT อย่างเดียว
   * ไม่เคยเรียก adapter → รูปที่แอดมินอัปโหลดไม่เคยถึงลูกค้าเลย. ตอนนี้รูปวิ่ง
   * ผ่าน sendStaffMessage (มี clientMessageId exactly-once) ส่วนไฟล์ที่ไม่ใช่รูป
   * ยังบันทึกในห้องอย่างเดียว (LINE ไม่มี file bubble) แต่ persist เป็น STAFF
   * และคืน delivered=false ให้ UI บอกแอดมินตรงๆ
   *
   * ข้อจำกัดที่ยอมรับ: ถ้า sendStaffMessage ล้มเหลว "ก่อน" บันทึก (room ไม่พบ /
   * ไม่มี adapter ของ channel) รูปจะไม่ถูก persist เลย. ทั้ง 5 channel ลงทะเบียน
   * adapter ครบที่ chat-adapters.module.ts:85-89 และ roomId มาจากห้องที่เปิดอยู่
   * → เกิดได้เฉพาะตอน config พัง; แอดมินเห็น error จาก toast (Task 8) แล้วส่งใหม่ได้
   *
   * แก้แล้ว (2026-08-08, Task 8 forward-flag): แต่ก่อน branch ไฟล์ non-image เรียก
   * saveMessage ตรงโดยไม่มี P2002 handling — เมื่อ frontend เริ่มส่ง clientMessageId
   * เดิมซ้ำตอน retry (unique [roomId, clientMessageId]) จะ throw 500 แทนที่จะ
   * idempotent เหมือน sendStaffMessage. ตอนนี้ catch P2002 แล้วยืนยันว่าแถวเดิมมีจริง
   * ก่อนคืน success — ดู try/catch รอบ saveMessage ด้านล่าง
   *
   * แก้แล้ว (2026-08-08, Task 8 review round 1, I1): P2002 catch ด้านบนกัน 500 ได้ แต่
   * storageService.upload() (ก่อนหน้านั้นในเมธอดนี้) ยังรันไปแล้วด้วย Date.now() key
   * ใหม่ทุกครั้งก่อนจะรู้ว่ามันคือ retry — ไฟล์ที่เพิ่ง upload ซ้ำนั้นกลายเป็น orphan ใน
   * storage เพราะแถว DB ยังชี้ key เดิมจาก attempt แรก (ไม่มี caller ไหนอ่าน key ใหม่นี้
   * เลย). ตอนนี้เช็ค findByClientMessageId ก่อน upload (non-image เท่านั้น — image ไม่ต้อง
   * เพราะ idempotency ของมันอยู่ใน sendStaffMessage อยู่แล้ว) เจอแถวเดิม → คืนแถวเดิมทันที
   * ไม่ upload ไม่ save; ไม่เจอ → เดินเส้นเดิม (P2002 catch ที่มีอยู่แล้วยังคงเป็น
   * race-net ชั้นสอง สำหรับ 2 request แข่งกันในหน้าต่างเวลาแคบๆ ระหว่างเช็คกับ insert)
   */
  async uploadFile(
    roomId: string,
    file: Express.Multer.File,
    userId: string | undefined,
    clientMessageId?: string,
  ): Promise<{
    success: boolean;
    url: string;
    key: string;
    filename: string;
    delivered: boolean;
    error?: string;
  }> {
    const isImage = file.mimetype.startsWith('image/');

    if (!isImage && clientMessageId) {
      const existing = await this.findByClientMessageId(roomId, clientMessageId);
      if (existing) {
        const existingKey = existing.mediaUrl ?? '';
        const url = this.storageService.configured && existingKey
          ? await this.storageService.getSignedDownloadUrl(existingKey, 3600)
          : existingKey;
        return {
          success: true,
          url,
          key: existingKey,
          filename: existing.text ?? file.originalname,
          delivered: false,
        };
      }
    }

    const extMap: Record<string, string> = {
      'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
      'application/pdf': '.pdf',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    };
    const ext = extMap[file.mimetype] || '';
    const key = `staff-chat/${roomId}/${Date.now()}${ext}`;

    await this.storageService.upload(key, file.buffer, file.mimetype);
    const downloadUrl = this.storageService.configured
      ? await this.storageService.getSignedDownloadUrl(key, 3600)
      : key;

    if (isImage && this.messageRouter && userId) {
      const deliveryMediaUrl = this.storageService.configured
        ? await this.storageService.getSignedDownloadUrl(
            key,
            RoomManagerService.ADAPTER_MEDIA_TTL_SEC,
          )
        : key;
      const sent = await this.messageRouter.sendStaffMessage({
        roomId,
        staffId: userId,
        type: MessageType.IMAGE,
        mediaUrl: key,
        mediaType: file.mimetype,
        deliveryMediaUrl,
        clientMessageId,
      });
      return {
        success: true,
        url: downloadUrl,
        key,
        filename: file.originalname,
        delivered: sent.success,
        ...(sent.success ? {} : { error: sent.error }),
      };
    }

    try {
      await this.saveMessage({
        roomId,
        role: MessageRole.STAFF,
        type: isImage ? MessageType.IMAGE : MessageType.FILE,
        text: file.originalname,
        mediaUrl: key,
        mediaType: file.mimetype,
        staffId: userId,
        clientMessageId,
      });
    } catch (e: any) {
      if (e?.code === 'P2002' && clientMessageId) {
        // Retry ด้วย clientMessageId เดิม (ไฟล์ non-image) — แถวก่อนหน้าถูกบันทึกแล้ว
        // จาก attempt ที่แล้ว (unique [roomId, clientMessageId]). คืนแถวเดิมแทนที่จะ
        // throw 500 ให้ frontend (idempotent) — เหมือน sendStaffMessage's P2002
        // branch (message-router.service.ts) แต่ response shape ของ uploadFile ไม่มี
        // field message ให้คืน จึงแค่ re-fetch ยืนยันว่าแถวมีจริงแล้วปล่อยผ่าน
        const existing = await this.findByClientMessageId(roomId, clientMessageId);
        if (!existing) throw e; // unreachable in practice — P2002 implies the row exists
      } else {
        throw e;
      }
    }

    return { success: true, url: downloadUrl, key, filename: file.originalname, delivered: false };
  }

  /**
   * Last N messages across the customer's LINE rooms (LINE_FINANCE preferred).
   * Used by the Customer 360 LineChatPanel — collectors don't need to leave
   * the collections workspace to see what was said in chat.
   *
   * Returns messages in reverse-chronological order (newest first) so
   * `before=<oldest.id>` paging walks backward through history. The frontend
   * reverses for display.
   */
  async getCustomerMessages(customerId: string, take: number, before?: string) {
    // Find the customer's LINE Finance room (preferred) or fall back to any
    // LINE room. Collections is a finance-only workflow — no point pulling
    // shop-side LINE chat here.
    const room = await this.prisma.chatRoom.findFirst({
      where: {
        customerId,
        deletedAt: null,
        channel: { in: [ChatChannel.LINE_FINANCE, ChatChannel.LINE_SHOP] },
      },
      orderBy: [
        // Prefer LINE_FINANCE if both exist (alphabetical "LINE_FINANCE" <
        // "LINE_SHOP" so an explicit ordering by lastMessageAt is the
        // tiebreaker that matters).
        { lastMessageAt: 'desc' },
      ],
      select: {
        id: true,
        channel: true,
        lineUserId: true,
        lastMessageAt: true,
        unreadCount: true,
      },
    });

    if (!room) {
      return { roomId: null, channel: null, messages: [], hasMore: false };
    }

    let cursorWhere: { createdAt?: { lt: Date } } = {};
    if (before) {
      const cursor = await this.prisma.chatMessage.findUnique({
        where: { id: before },
        select: { createdAt: true },
      });
      if (cursor) cursorWhere = { createdAt: { lt: cursor.createdAt } };
    }

    const messages = await this.prisma.chatMessage.findMany({
      where: { roomId: room.id, deletedAt: null, ...cursorWhere },
      orderBy: { createdAt: 'desc' },
      take: take + 1, // overfetch by 1 to detect hasMore
      select: {
        id: true,
        role: true,
        type: true,
        text: true,
        mediaUrl: true,
        mediaType: true,
        createdAt: true,
        readAt: true,
        deliveredAt: true,
        staff: { select: { id: true, name: true } },
      },
    });

    const hasMore = messages.length > take;
    const sliced = hasMore ? messages.slice(0, take) : messages;

    return {
      roomId: room.id,
      channel: room.channel,
      messages: sliced,
      hasMore,
    };
  }

  /**
   * Resolve the customer's LINE room (Finance preferred) and forward the
   * staff message through MessageRouterService. Returns `{ room: null }`
   * when the customer has no LINE room so the caller can surface a
   * non-throwing error; otherwise returns the resolved room + send result.
   */
  async sendCustomerMessage(
    customerId: string,
    staffId: string,
    text: string,
  ): Promise<
    | { room: null }
    | { room: { id: string }; result: { success: boolean; error?: string } }
  > {
    const room = await this.prisma.chatRoom.findFirst({
      where: {
        customerId,
        deletedAt: null,
        channel: { in: [ChatChannel.LINE_FINANCE, ChatChannel.LINE_SHOP] },
      },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true },
    });

    if (!room) {
      return { room: null };
    }

    const result = await this.messageRouter!.sendStaffMessage({
      roomId: room.id,
      staffId,
      text,
    });

    return { room, result };
  }

  /** All of a room's customer's rooms across channels, with the latest message each */
  async getCrossChannelRooms(roomId: string) {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { customerId: true },
    });
    if (!room?.customerId) return [];
    return this.prisma.chatRoom.findMany({
      where: { customerId: room.customerId, deletedAt: null },
      select: {
        id: true,
        channel: true,
        lastMessageAt: true,
        messages: {
          where: { deletedAt: null, role: { not: MessageRole.SYSTEM } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { text: true, createdAt: true },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
  }
}
