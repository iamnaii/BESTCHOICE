import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { chatLogoOf, type ChatLogo } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';

/** จำนวน id ต่อหนึ่งรอบ query — ตรงกับ CustomerTierService.getCustomerTiers */
const CHUNK_SIZE = 200;

export interface CustomerChatRoomRef {
  /** ใช้ทำลิงก์ /inbox/<roomId> */
  roomId: string;
  channel: string;
  logo: ChatLogo;
}

export interface CustomerChatSummary {
  chatRooms: CustomerChatRoomRef[];
  lastContactAt: string | null;
  /** ฟิลด์ที่ให้ค่า lastContactAt — CUSTOMER = lastCustomerAt, ROOM = lastMessageAt */
  lastContactSource: 'CUSTOMER' | 'ROOM' | null;
  assignedTo: { id: string; name: string } | null;
}

/**
 * ห้องแชท / ติดต่อล่าสุด / ผู้ดูแล ของลูกค้าหลายคนพร้อมกัน
 *
 * 🔴 1 query ต่อ 200 id — ห้ามกลับไปเรียก getChatSummary(customerId) รายแถว
 * (customer-analytics.service.ts:413-426 เป็นเวอร์ชันรายคน ใช้กับหน้ารายละเอียดเท่านั้น)
 *
 * ⚠️ `db` ต้องรับ TransactionClient ได้ ไม่งั้น Excel export อ่านออกนอก snapshot ตัวเอง
 */
@Injectable()
export class CustomerChatRoomsService {
  constructor(private readonly prisma: PrismaService) {}

  async forCustomers(
    ids: string[],
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<Map<string, CustomerChatSummary>> {
    const result = new Map<string, CustomerChatSummary>();
    for (const id of ids) {
      result.set(id, { chatRooms: [], lastContactAt: null, lastContactSource: null, assignedTo: null });
    }
    for (let offset = 0; offset < ids.length; offset += CHUNK_SIZE) {
      const chunk = ids.slice(offset, offset + CHUNK_SIZE);
      if (!chunk.length) continue;
      const rooms = await db.chatRoom.findMany({
        // deletedAt: null บังคับ — ห้องที่ถูกลบยังเป็นแถวอยู่ ถ้าไม่กรองลิงก์แชทจะพาไปห้องที่ตายแล้ว
        where: { customerId: { in: chunk }, deletedAt: null },
        // ใหม่สุดมาก่อน · id ปิดท้ายกันลิงก์แกว่งเมื่อ lastMessageAt ชนกัน
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true, customerId: true, channel: true,
          lastMessageAt: true, lastCustomerAt: true,
          assignedTo: { select: { id: true, name: true } },
        },
      });

      for (const room of rooms) {
        if (!room.customerId) continue;
        const summary = result.get(room.customerId);
        if (!summary) continue;

        // ยุบเป็นโลโก้เดียวต่อช่องทาง — LINE_FINANCE + LINE_SHOP = โลโก้ LINE ใบเดียว
        // (คำสั่งเจ้าของ: ต่างกันแค่ tooltip) ห้องที่มาก่อนในลำดับ = ห้องที่ "คุยล่าสุด"
        // จึงเป็นห้องที่ลิงก์พาไป
        const logo = chatLogoOf(room.channel);
        if (!summary.chatRooms.some(existing => existing.logo === logo)) {
          summary.chatRooms.push({ roomId: room.id, channel: room.channel, logo });
        }

        // ติดต่อล่าสุด = ค่าที่ใหม่สุดข้ามทุกห้องของคนนี้
        // lastCustomerAt (ลูกค้าพิมพ์จริง) มาก่อน lastMessageAt (รวมข้อความของเราเอง)
        const contactAt = room.lastCustomerAt ?? room.lastMessageAt ?? null;
        if (contactAt) {
          const iso = contactAt.toISOString();
          if (!summary.lastContactAt || iso > summary.lastContactAt) {
            summary.lastContactAt = iso;
            summary.lastContactSource = room.lastCustomerAt ? 'CUSTOMER' : 'ROOM';
          }
        }

        // ผู้ดูแล = คนที่ถูกมอบหมายในห้องที่คุยล่าสุดซึ่ง "มีคนดูแล" จริง
        // (ห้องใหม่สุดที่ยังไม่มอบหมายไม่ควรลบผู้ดูแลของห้องก่อนหน้าออกจากคอลัมน์)
        if (!summary.assignedTo && room.assignedTo) summary.assignedTo = room.assignedTo;
      }
    }
    return result;
  }
}
