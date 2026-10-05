import { Response } from 'express';
import { pipeline } from 'stream/promises';
import { StorageService } from '../../src/modules/storage/storage.service';
import { ChatWorkAccessService } from '../../src/modules/staff-chat/services/chat-work-access.service';
/** Synthetic ACKs only. This factory is never imported by a production module. */
import { Body, Controller, Get, Logger, Post, Param, Res, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RoomManagerService } from '../../src/modules/chat-engine/services/room-manager.service';
import { MessageRouterService } from '../../src/modules/chat-engine/services/message-router.service';
import type { OutboundMessage } from '../../src/modules/chat-engine/interfaces/channel-adapter.interface';
export function previewChatLibrary(db: PrismaService, manager: RoomManagerService, storage: StorageService, actorId: () => string) {
  if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) throw new Error('Library preview requires isolated database');
  let next: 'SUCCESS' | 'FAILED' | 'UNKNOWN' = 'SUCCESS';
  const sent: OutboundMessage[] = [];
  const adapter = { async sendMessage(message: OutboundMessage) {
    sent.push(message); const result = next; next = 'SUCCESS';
    return result === 'SUCCESS' ? { success: true, externalMessageId: `preview-library:${randomUUID()}` }
      : { success: false, definitelyNotSent: result === 'FAILED', error: result === 'FAILED' ? 'จำลองช่องทางปฏิเสธไฟล์' : 'จำลองการรอยืนยันจากช่องทาง' };
  }};
  const router = Object.assign(Object.create(MessageRouterService.prototype), { roomManager: manager, logger: new Logger('PreviewLibraryRouter'), adapterMap: new Map(['FACEBOOK','LINE_SHOP','LINE_FINANCE','WEB','TIKTOK'].map(channel => [channel, adapter])) }) as MessageRouterService;
  @Controller('preview/library')
  class PreviewLibraryController {
    @Post('next') next(@Body('result') value: 'SUCCESS' | 'FAILED' | 'UNKNOWN') { next = value; return { synthetic: true }; }
    @Get('media/:id') async media(@Param('id') id: string, @Res() res: Response) {
      const message = await db.chatMessage.findUnique({where:{id}});
      if(!message?.mediaUrl?.startsWith('staff-chat/library/')) throw new NotFoundException();
      await new ChatWorkAccessService(db).roomContext(message.roomId,{id:actorId()});
      res.setHeader('Content-Type',message.mediaType || 'application/octet-stream');
      res.setHeader('Cache-Control','private, no-store');
      res.setHeader('X-Content-Type-Options','nosniff');
      await pipeline(await storage.getStream(message.mediaUrl),res);
    }
    @Get('sent') sent() { return { count: sent.length, synthetic: true }; }
  }
  return { controller: PreviewLibraryController, router };
}
