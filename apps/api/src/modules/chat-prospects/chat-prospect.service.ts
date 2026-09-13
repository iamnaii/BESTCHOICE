import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel, LineChannelType, Prisma } from '@prisma/client';
import { chatSourceOf } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { isChatPlaceholder, placeholderName } from './chat-placeholder';

type Tx = Prisma.TransactionClient;
const LINE_CHANNELS: ReadonlySet<ChatChannel> = new Set([ChatChannel.LINE_SHOP, ChatChannel.LINE_FINANCE]);

/**
 * ผู้สนใจอัตโนมัติจากแชท — หนึ่งคน (ช่องทาง + รหัสผู้ใช้) = หนึ่งแถว customers
 * (docs/superpowers/specs/2026-09-13-chat-prospects-design.md §3.2)
 *
 * ล็อกต่อคนด้วย pg_advisory_xact_lock(hashtext('<channel>:<key>')) ในทรานแซกชันเดียวกับการหา/สร้าง
 * ⇒ ข้อความแรกสองชิ้นที่มาพร้อมกัน (พิมพ์+รูป) ได้ลูกค้าคนเดียว แม้จะเผลอได้สองห้อง
 * (ห้องซ้ำเป็นบั๊กเดิมของ getOrCreateRoom ที่ findFirst ไม่มี lock — ไม่แก้ในรอบนี้)
 */
@Injectable()
export class ChatProspectService {
  private readonly logger = new Logger(ChatProspectService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureForRoom(roomId: string): Promise<{ customerId: string; created: boolean } | null> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { id: true, channel: true, lineUserId: true, externalUserId: true, customerId: true, displayName: true, createdAt: true, deletedAt: true },
    });
    if (!room || room.deletedAt) return null;
    if (room.customerId) return { customerId: room.customerId, created: false };
    const externalKey = room.lineUserId ?? room.externalUserId;
    if (!externalKey) return null;

    return this.prisma.$transaction(async (tx) => {
      // ล็อกต่อคน — ปล่อยเองตอนทรานแซกชันจบ · ต้องเป็น $executeRaw: $queryRaw อ่านผลชนิด void ไม่ได้ (Ruling R2)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${room.channel}:${externalKey}`}))`;
      // อ่านซ้ำหลังได้ล็อก: อีกคำขออาจผูกห้องนี้ไปแล้วระหว่างรอ
      const fresh = await tx.chatRoom.findUnique({ where: { id: roomId }, select: { customerId: true } });
      if (fresh?.customerId) return { customerId: fresh.customerId, created: false };

      const existingId = await this.findExistingCustomerId(tx, room.channel, externalKey);
      if (existingId) {
        await tx.chatRoom.update({ where: { id: roomId }, data: { customerId: existingId } });
        return { customerId: existingId, created: false };
      }

      const created = await tx.customer.create({
        data: {
          name: placeholderName(room.channel, externalKey, room.displayName),
          phone: null,
          acquisitionSource: chatSourceOf(room.channel),
          createdAt: room.createdAt, // วันที่เพิ่ม = วันทักครั้งแรก
          ...(room.channel === ChatChannel.FACEBOOK
            ? { facebookUserId: externalKey, facebookName: room.displayName?.trim() || null }
            : {}),
        },
        select: { id: true },
      });
      // verifiedAt ไม่แตะ — placeholder ยังไม่ยืนยันตัวตน (สเปค §3.1)
      await tx.chatRoom.update({ where: { id: roomId }, data: { customerId: created.id } });
      this.logger.log(`[prospect] created ${created.id} for room ${roomId} (${room.channel})`);
      return { customerId: created.id, created: true };
    });
  }

  /**
   * หาคนเดิมก่อนสร้าง (สเปค 3.2 ข้อ 3): (ก) ห้องอื่นของคนเดียวกันในช่องทางนี้ที่ผูกแล้ว
   * (ข) LINE: CustomerLineLink ที่ยังผูกอยู่ แล้วค่อยคอลัมน์ lineIdShop / lineIdFinance — ฝั่ง LINE ร้านผูกที่คอลัมน์
   * (line-customer-link.service.ts selfLinkByPhone) ไม่ใช่ตาราง link
   * ทุกทางข้ามลูกค้าที่ถูกลบแล้ว
   */
  private async findExistingCustomerId(tx: Tx, channel: ChatChannel, externalKey: string): Promise<string | null> {
    const isLine = LINE_CHANNELS.has(channel);
    const sibling = await tx.chatRoom.findFirst({
      where: {
        deletedAt: null,
        channel,
        customerId: { not: null },
        customer: { is: { deletedAt: null } },
        ...(isLine ? { lineUserId: externalKey } : { externalUserId: externalKey }),
      },
      orderBy: { createdAt: 'asc' },
      select: { customerId: true },
    });
    if (sibling?.customerId) return sibling.customerId;
    if (!isLine) return null;

    const linkChannel = channel === ChatChannel.LINE_SHOP ? LineChannelType.SHOP : LineChannelType.FINANCE;
    const link = await tx.customerLineLink.findUnique({
      where: {
        lineUserId_channel: { lineUserId: externalKey, channel: linkChannel },
        // link ที่ยกเลิก/ลบแล้ว หรือชี้ลูกค้าที่ถูกลบ = ไม่ได้ผูกอยู่ (ตรงกับ verification.service isLinked)
        unlinkedAt: null,
        deletedAt: null,
        customer: { is: { deletedAt: null } },
      },
      select: { customerId: true },
    });
    if (link) return link.customerId;

    const byColumn = await tx.customer.findFirst({
      where: { ...(channel === ChatChannel.LINE_SHOP ? { lineIdShop: externalKey } : { lineIdFinance: externalKey }), deletedAt: null },
      select: { id: true },
    });
    return byColumn?.id ?? null;
  }

  /** ชื่อโปรไฟล์มาทีหลัง (mirrorOutbound สร้างห้องก่อนรู้ชื่อ) → ตั้งชื่อ placeholder ที่ยังเป็น fallback ตาม */
  async syncNameFromRoom(roomId: string): Promise<boolean> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: {
        id: true, channel: true, lineUserId: true, externalUserId: true, displayName: true,
        customer: { select: { id: true, name: true, acquisitionSource: true, phone: true, nationalId: true, deletedAt: true } },
      },
    });
    const displayName = room?.displayName?.trim();
    const customer = room?.customer;
    if (!room || !displayName || !customer || customer.deletedAt || !isChatPlaceholder(customer)) return false;
    const externalKey = room.lineUserId ?? room.externalUserId;
    if (!externalKey) return false;
    if (customer.name !== placeholderName(room.channel, externalKey, null)) return false; // ถูกแก้มือแล้ว ไม่ทับ
    if (customer.name === displayName) return false;
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { name: displayName, ...(room.channel === ChatChannel.FACEBOOK ? { facebookName: displayName } : {}) },
    });
    return true;
  }
}
