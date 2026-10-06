import { BadRequestException, ConflictException, HttpException, Injectable } from '@nestjs/common';
import type { ChatWorkActor, LibraryDeliveryResult, WorkScope } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { MessageRouterService } from '../../chat-engine/services/message-router.service';
import { RoomCreditService } from '../../credit-check/services/room-credit.service';
import { readLimited } from '../../credit-check/services/media-fetch.util';
import { ChatWorkAccessService } from './chat-work-access.service';
import { ChatLibraryService } from './chat-library.service';
import { LibraryItemDto, SendLibraryFilesDto } from '../dto/chat-library.dto';
@Injectable()
export class ChatLibraryDeliveryService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: ChatWorkAccessService,
    private readonly library: ChatLibraryService,
    private readonly storage: StorageService,
    private readonly router: MessageRouterService,
    private readonly credits: RoomCreditService,
  ) {}
  private async bind(
    actor: ChatWorkActor,
    scope: WorkScope,
    roomId: string,
    item: LibraryItemDto,
    action: 'SEND' | 'CREDIT',
  ) {
    const requestKey = `${actor.id}:${item.requestKey}`;
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestKey}))`;
      await this.access.assertRoom(roomId, actor, scope, tx);
      const file = await this.library.resolve(actor, scope, item.fileId, tx);
      const previous = await tx.chatLibraryOperation.findUnique({ where: { requestKey } });
      if (
        previous &&
        (previous.company !== scope.company ||
          previous.action !== action ||
          previous.roomId !== roomId ||
          previous.fileId !== item.fileId)
      )
        throw new ConflictException('คำขอนี้ผูกกับไฟล์หรือห้องอื่นแล้ว กรุณาเลือกไฟล์ใหม่');
      const operation =
        previous ??
        (await tx.chatLibraryOperation.create({
          data: {
            requestKey,
            company: scope.company,
            action,
            actorId: actor.id,
            roomId,
            fileId: item.fileId,
          },
        }));
      return { file, operation };
    });
  }
  async send(
    actor: ChatWorkActor,
    scope: WorkScope,
    roomId: string,
    input: SendLibraryFilesDto,
  ): Promise<LibraryDeliveryResult[]> {
    if (input.mode !== 'chat' || !input.items.length || input.items.length > 10)
      throw new BadRequestException('ส่งไฟล์ได้เฉพาะโหมดตอบลูกค้า ครั้งละ 1–10 ไฟล์');
    await this.access.assertRoom(roomId, actor, scope);
    await this.library.context(actor, scope);
    const results: LibraryDeliveryResult[] = [];
    for (const item of input.items) {
      let operationId: string | undefined;
      try {
        const { file, operation } = await this.bind(actor, scope, roomId, item, 'SEND');
        operationId = operation.id;
        const existing = await this.db.chatMessage.findFirst({
          where: { roomId, clientMessageId: operation.id },
        });
        if (existing?.outboundSentAt) {
          results.push({ ...item, status: 'SENT' });
          continue;
        }
        const url = await this.storage.getSignedDownloadUrl(file.key, 900);
        if (!url.startsWith('https://'))
          throw new BadRequestException('ไม่สามารถสร้างลิงก์ส่งไฟล์ได้');
        await this.access.assertRoom(roomId, actor, scope);
        await this.library.resolve(actor, scope, file.id);
        const image = file.mimeType.startsWith('image/');
        const sent = await this.router.sendStaffMessage({
          trackDelivery: true,
          roomId,
          staffId: actor.id,
          clientMessageId: operation.id,
          type: image ? 'IMAGE' : 'FILE',
          text: file.name,
          mediaUrl: file.key,
          mediaType: file.mimeType,
          deliveryMediaUrl: url,
          ...(!image ? { deliveryText: `${file.name}\nดาวน์โหลดภายใน 15 นาที: ${url}` } : {}),
        });
        const message = await this.db.chatMessage.findFirst({
          where: { roomId, clientMessageId: operation.id },
        });
        const uncertain =
          message &&
          !message.outboundSentAt &&
          ['SENDING', 'UNKNOWN'].includes(message.outboundAttemptState ?? '');
        results.push({
          ...item,
          status:
            sent.success || message?.outboundSentAt ? 'SENT' : uncertain ? 'UNKNOWN' : 'FAILED',
          ...(sent.success
            ? {}
            : {
                error: uncertain
                  ? 'ยังยืนยันผลไม่ได้ กรุณาตรวจในช่องทางก่อนส่งใหม่'
                  : sent.error || 'ส่งไม่สำเร็จ',
              }),
        });
      } catch (error) {
        const message = operationId
          ? await this.db.chatMessage.findFirst({ where: { roomId, clientMessageId: operationId } })
          : null;
        const unknown =
          message &&
          !message.outboundSentAt &&
          ['SENDING', 'UNKNOWN'].includes(message.outboundAttemptState ?? '');
        results.push({
          ...item,
          status: message?.outboundSentAt ? 'SENT' : unknown ? 'UNKNOWN' : 'FAILED',
          error: unknown
            ? 'ยังยืนยันผลไม่ได้ กรุณาตรวจในช่องทางก่อนส่งใหม่'
            : error instanceof HttpException
              ? error.message
              : 'ส่งไฟล์ไม่สำเร็จ กรุณาลองใหม่',
        });
      }
    }
    return results;
  }
  async credit(actor: ChatWorkActor, scope: WorkScope, roomId: string, item: LibraryItemDto) {
    const { file, operation } = await this.bind(actor, scope, roomId, item, 'CREDIT');
    const bytes = await readLimited(await this.storage.getStream(file.key));
    return this.credits.importLibrary(
      roomId,
      bytes,
      actor,
      { fileId: file.id, requestKey: operation.id, name: file.name },
      async (tx) => {
        await this.access.assertRoom(roomId, actor, scope, tx);
        await this.library.resolve(actor, scope, file.id, tx);
      },
    );
  }
}
