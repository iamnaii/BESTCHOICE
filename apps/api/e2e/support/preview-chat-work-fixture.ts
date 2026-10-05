import { FinanceApplicationService } from '../../src/modules/external-finance-application/services/finance-application.service';
import { StaffMessageService } from '../../src/modules/staff-chat/services/staff-message.service';
import { ProductDetectService } from '../../src/modules/staff-chat/services/product-detect.service';
import { ProductQuoteService } from '../../src/modules/staff-chat/services/product-quote.service';
/** Only loaded by the disposable managed preview. No external adapters are invoked. */
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ResponseCycleService } from '../../src/modules/chat-engine/services/response-cycle.service';
import { RoomManagerService } from '../../src/modules/chat-engine/services/room-manager.service';
import { ChatWorkAccessService } from '../../src/modules/staff-chat/services/chat-work-access.service';
import { StaffInboxService } from '../../src/modules/staff-chat/services/staff-inbox.service';
export async function seedChatWork(db: PrismaService, manager: RoomManagerService, actorId: string) {
  await db.systemConfig.upsert({ where: { key: 'chat_work_queue_enabled' }, create: { key: 'chat_work_queue_enabled', value: 'true' }, update: { value: 'true', deletedAt: null } });
  await db.systemConfig.upsert({ where: { key: 'chat_follow_up_enabled' }, create: { key: 'chat_follow_up_enabled', value: 'true' }, update: { value: 'true', deletedAt: null } });
  const rooms: Record<string, string> = {};
  const inbox = new StaffInboxService(db, new ChatWorkAccessService(db));
  for (const company of ['SHOP', 'FINANCE'] as const) {
    const displayName = `คิวทดลอง ${company}`;
    let room = await db.chatRoom.findFirst({ where: { displayName } });
    if (!room) {
      room = await db.chatRoom.create({ data: { displayName, channel: company === 'SHOP' ? 'FACEBOOK' : 'LINE_FINANCE', assignedToId: actorId } });
      await manager.saveMessage({ roomId: room.id, role: 'CUSTOMER', text: 'ขอสอบถามรายละเอียดสินค้า' });
      await db.todo.create({ data: { title: `ติดตามลูกค้า ${company}`, createdById: actorId, assigneeId: actorId, roomId: room.id, dueDate: new Date() } });
      await db.$transaction(tx => inbox.enqueue(tx, { recipientId: actorId, kind: 'CHAT_SLA', roomId: room!.id, dedupeKey: `preview:${room!.id}`, title: `มีแชทรอตอบ ${company}`, targetType: 'ROOM', targetId: room!.id }));
    }
    rooms[company] = room.id;
  }
  return rooms;
}
export function previewWorkController(db: PrismaService, manager: RoomManagerService, actorId: () => string) {
  const cycles = new ResponseCycleService(db);
  const failNext = new Set<string>();
  const notes = Object.assign(Object.create(StaffMessageService.prototype), { prisma: db }) as StaffMessageService;
  const products = new ProductDetectService(db, new ProductQuoteService(db));
  // Real local query; LINE membership is explicitly disconnected in this synthetic preview.
  const finance = Object.assign(Object.create(FinanceApplicationService.prototype), {
    prisma: db, lineGroup: { status: async () => ({ groupId: null, groupName: null, botInGroup: false, tokenConfigured: false, ready: false, reason: 'NOT_LINKED' }) },
  }) as FinanceApplicationService;
  @Controller()
  class PreviewWorkController {
    @Get('staff-chat/rooms/:id/cross-channel') crossChannel(@Param('id') id: string) { return manager.getCrossChannelRooms(id); }
    @Get('staff-chat/rooms/:id/notes') notes(@Param('id') id: string) { return notes.getNotes(id); }
    @Get('staff-chat/rooms/:id/products') async products(@Param('id') id: string) {
      const rows = await db.chatMessage.findMany({ where: { roomId: id, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 20, select: { text: true } });
      return products.detectProducts(rows.map(row => row.text || ''));
    }
    @Get('staff-chat/rooms/:id/finance-applications') finance(@Param('id') id: string) { return finance.listForRoom(id, { id: actorId(), role: 'OWNER' }); }
    @Post('preview/chat-work/:id/inbound') inbound(@Param('id') roomId: string) { return manager.saveMessage({ roomId, role: 'CUSTOMER', text: 'ข้อความทดลองรอตอบ' }); }
    @Post('preview/chat-work/:id/fail-next') fail(@Param('id') id: string) { failNext.add(id); return { synthetic: true }; }
    @Post('staff-chat/rooms/:id/read') read(@Param('id') id: string) { return db.chatRoom.update({ where: { id }, data: { unreadCount: 0 } }); }
    @Post('staff-chat/rooms/:id/messages') async send(@Param('id') roomId: string, @Body() body: { text: string; clientMessageId?: string }) {
      const token = body.clientMessageId || randomUUID();
      const existing = await db.chatMessage.findFirst({ where: { roomId, clientMessageId: token } });
      if (existing?.outboundSentAt) return { success: true, messageId: existing.id };
      const message = existing || await manager.saveMessage({ roomId, role: 'STAFF', text: body.text, staffId: actorId(), clientMessageId: token });
      if (!await manager.prepareOutboundAttempt(message.id)) return { success: false, error: 'รอยืนยันการส่ง' };
      if (failNext.delete(roomId)) {
        await cycles.failAttempt(message.id, true);
        return { success: false, error: 'จำลองการส่งล้มเหลว กรุณาลองใหม่' };
      }
      await manager.markOutboundSent(message.id, `preview:${message.id}`);
      return { success: true, messageId: message.id, synthetic: true };
    }
  }
  return PreviewWorkController;
}
