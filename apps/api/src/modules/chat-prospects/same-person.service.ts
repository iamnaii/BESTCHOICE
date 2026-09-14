import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { chatLogoOf, normalizePersonName, type ChatLogo } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { isLivePlaceholder, PLACEHOLDER_FIELDS_SELECT } from './chat-placeholder';

export interface PossibleSamePerson {
  customerId: string;
  name: string;
  channel: ChatLogo | null;
  hasPhone: boolean;
  chatPlaceholder: boolean;
  createdAt: Date;
  mergeDirection: 'absorb_current_into_other' | 'absorb_other_into_current' | 'none';
}

const MAX_HINTS = 3;
const SCAN_LIMIT = 50;

/**
 * คำใบ้ "อาจเป็นคนเดียวกัน" (สเปค 3.6): ชื่อตรงกันเป๊ะหลัง normalize ในช่องทางอื่น หรือคนที่มีเบอร์แล้ว
 * ไม่ทำ fuzzy · ไม่รวมอัตโนมัติ · พนักงานกด "รวม" หรือ "ไม่ใช่" (dismiss เก็บที่ห้อง)
 */
@Injectable()
export class SamePersonService {
  constructor(private readonly prisma: PrismaService) {}

  async findForRoom(roomId: string): Promise<PossibleSamePerson[]> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        channel: true,
        customerId: true,
        dismissedSamePersonIds: true,
        // R6: id/name/facebookName/createdAt สำหรับหน้าจอ + PLACEHOLDER_FIELDS_SELECT
        // (acquisitionSource/phone/nationalId/deletedAt) สำหรับ isLivePlaceholder — ห้ามเขียน select ซ้ำ
        customer: {
          select: { id: true, name: true, facebookName: true, createdAt: true, ...PLACEHOLDER_FIELDS_SELECT },
        },
      },
    });
    const me = room?.customer;
    if (!room || !me || me.deletedAt) return [];
    const keys = [...new Set([normalizePersonName(me.name), normalizePersonName(me.facebookName)].filter(Boolean))];
    if (keys.length === 0) return [];

    // ค้นหยาบด้วย contains (ไม่สนตัวพิมพ์) แล้วกรอง "ตรงเป๊ะหลัง normalize" ใน JS — ตัดคำนำหน้า/ช่องว่างซ้ำไม่ได้ใน SQL
    const candidates = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        id: { not: me.id, notIn: room.dismissedSamePersonIds },
        OR: keys.flatMap((k) => [
          { name: { contains: k, mode: 'insensitive' as const } },
          { facebookName: { contains: k, mode: 'insensitive' as const } },
        ]),
      },
      select: {
        id: true,
        name: true,
        facebookName: true,
        createdAt: true,
        ...PLACEHOLDER_FIELDS_SELECT,
        chatRooms: {
          where: { deletedAt: null },
          orderBy: { lastMessageAt: 'desc' },
          take: 1,
          select: { channel: true },
        },
      },
      take: SCAN_LIMIT,
    });

    const mePlaceholder = isLivePlaceholder(me);
    return candidates
      .filter((c) => keys.includes(normalizePersonName(c.name)) || keys.includes(normalizePersonName(c.facebookName)))
      .map((c) => {
        const channelRaw = c.chatRooms[0]?.channel ?? null;
        const hasPhone = !!c.phone;
        const otherPlaceholder = isLivePlaceholder(c);
        return {
          customerId: c.id,
          name: c.name,
          channel: channelRaw ? chatLogoOf(channelRaw) : null,
          hasPhone,
          chatPlaceholder: otherPlaceholder,
          createdAt: c.createdAt,
          differentChannel: !!channelRaw && channelRaw !== room.channel,
          mergeDirection: this.direction(mePlaceholder, me.createdAt, otherPlaceholder, c.createdAt),
        };
      })
      .filter((c) => c.hasPhone || c.differentChannel)
      .sort((a, b) => Number(b.hasPhone) - Number(a.hasPhone) || a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, MAX_HINTS)
      .map(({ differentChannel: _differentChannel, ...rest }) => rest);
  }

  /** สเปค 3.6: ห้องนี้ placeholder → เข้าอีกคน · อีกคน placeholder + ห้องนี้จริง → เข้าห้องนี้ · ทั้งคู่ placeholder → ใหม่เข้าเก่า · จริงทั้งคู่ → ไม่มีปุ่ม */
  private direction(
    mePlaceholder: boolean,
    meCreatedAt: Date,
    otherPlaceholder: boolean,
    otherCreatedAt: Date,
  ): PossibleSamePerson['mergeDirection'] {
    if (mePlaceholder && !otherPlaceholder) return 'absorb_current_into_other';
    if (!mePlaceholder && otherPlaceholder) return 'absorb_other_into_current';
    if (mePlaceholder && otherPlaceholder) {
      return meCreatedAt <= otherCreatedAt ? 'absorb_other_into_current' : 'absorb_current_into_other';
    }
    return 'none';
  }

  /** กด "ไม่ใช่" — ไม่ถามซ้ำสำหรับคนนั้นในห้องนี้อีก (สเปค 3.6)
   * ใช้กติกาเข้าถึงห้องเดียวกับ RoomManagerService.linkCustomer (sibling write path, I1/R19) —
   * เขียนห้ามหลวมกว่าอ่าน: SALES เปิดห้องที่ถูกคนอื่นถืออยู่ไม่ได้ ก็กด "ไม่ใช่" ไม่ได้เหมือนกัน
   */
  async dismiss(roomId: string, customerId: string, actor: { id: string; role: string }): Promise<void> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { id: true, deletedAt: true, assignedToId: true },
    });
    if (!room || room.deletedAt) {
      throw new NotFoundException('ห้องแชทไม่พบหรือถูกลบ');
    }
    if (actor.role === 'SALES' && room.assignedToId && room.assignedToId !== actor.id) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงห้องแชทนี้');
    }
    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: { dismissedSamePersonIds: { push: customerId } },
    });
  }
}
