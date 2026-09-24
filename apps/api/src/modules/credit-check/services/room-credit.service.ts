import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, RoomCreditFile } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { OcrService } from '../../ocr/ocr.service';
import { creditFileUrl, linkRoomCreditHistory, lockCreditRoom } from './room-credit-history';
import { detectFile, readLimited, fetchProviderMedia } from './media-fetch.util';

export type CreditRoomActor = { id: string; role: string };
const MAX_FILES = 10;
const ANALYSIS_LEASE_MS = 5 * 60 * 1000;

@Injectable()
export class RoomCreditService {
  private readonly logger = new Logger(RoomCreditService.name);
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private ocr: OcrService,
  ) {}

  private async access(db: Prisma.TransactionClient, roomId: string, actor: CreditRoomActor) {
    const room = await db.chatRoom.findFirst({ where: { id: roomId, deletedAt: null } });
    if (!room) throw new NotFoundException('ไม่พบห้องแชท');
    if (actor.role === 'SALES' && room.assignedToId && room.assignedToId !== actor.id)
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงห้องแชทนี้');
    return room;
  }

  private async ensureIdle(tx: Prisma.TransactionClient, roomId: string) {
    const busy = await tx.roomCreditAnalysis.findFirst({
      where: { roomId, status: 'ANALYZING', deletedAt: null },
    });
    if (!busy) return;
    if (Date.now() - busy.createdAt.getTime() < ANALYSIS_LEASE_MS)
      throw new ConflictException('กำลังวิเคราะห์ กรุณารอผลก่อนเปลี่ยนไฟล์หรือวิเคราะห์ซ้ำ');
    await tx.roomCreditAnalysis.updateMany({
      where: { id: busy.id, status: 'ANALYZING' },
      data: { status: 'FAILED', error: 'การวิเคราะห์ใช้เวลานานเกินไป กรุณาลองใหม่' },
    });
  }

  private presentFile(file: RoomCreditFile) {
    const { key: _key, ...safe } = file;
    return { ...safe, url: creditFileUrl(file.roomId, file.id) };
  }

  async get(roomId: string, actor: CreditRoomActor) {
    await this.access(this.prisma, roomId, actor);
    const [files, analysis] = await Promise.all([
      this.prisma.roomCreditFile.findMany({
        where: { roomId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.roomCreditAnalysis.findFirst({
        where: { roomId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const current =
      analysis?.status === 'ANALYZING' &&
      Date.now() - analysis.createdAt.getTime() >= ANALYSIS_LEASE_MS
        ? { ...analysis, status: 'FAILED', error: 'การวิเคราะห์ใช้เวลานานเกินไป กรุณาลองใหม่' }
        : analysis;
    return { files: files.map((file) => this.presentFile(file)), analysis: current };
  }

  async attachMessage(roomId: string, messageId: string, actor: CreditRoomActor) {
    await this.access(this.prisma, roomId, actor);
    const message = await this.prisma.chatMessage.findFirst({
      where: { id: messageId, roomId, deletedAt: null, type: { in: ['IMAGE', 'FILE'] } },
    });
    if (!message?.mediaUrl) throw new NotFoundException('ไม่พบไฟล์ในห้องแชทนี้');
    // Local storage messages use server-owned keys. No arbitrary URLs from clients.
    const media = message.mediaUrl.startsWith('staff-chat/')
      ? {
          bytes: await readLimited(await this.storage.getStream(message.mediaUrl)),
          contentType: message.mediaType || '',
        }
      : await fetchProviderMedia(message.mediaUrl);
    return this.attach(roomId, media.bytes, actor, messageId, media.contentType);
  }

  async upload(roomId: string, file: Express.Multer.File | undefined, actor: CreditRoomActor) {
    await this.access(this.prisma, roomId, actor);
    if (!file) throw new BadRequestException('กรุณาเลือกไฟล์');
    return this.attach(roomId, file.buffer, actor, null, file.mimetype);
  }

  private async attach(
    roomId: string,
    bytes: Buffer,
    actor: CreditRoomActor,
    sourceMessageId: string | null,
    contentType: string,
  ) {
    const type = detectFile(bytes, contentType);
    if (!this.storage.configured)
      throw new ServiceUnavailableException('ยังไม่ได้ตั้งค่าที่เก็บไฟล์');
    const key = `room-credit/${roomId}/${randomUUID()}.${type.ext}`;
    let retained = false;
    try {
      await this.storage.upload(key, bytes, type.mimeType);
      const saved = await this.prisma.$transaction(async (tx) => {
        await lockCreditRoom(tx, roomId);
        await this.access(tx, roomId, actor);
        await this.ensureIdle(tx, roomId);
        const files = await tx.roomCreditFile.findMany({ where: { roomId, deletedAt: null } });
        const duplicate =
          sourceMessageId && files.find((file) => file.sourceMessageId === sourceMessageId);
        if (duplicate) return { file: duplicate, created: false };
        if (files.length >= MAX_FILES)
          throw new BadRequestException('แนบได้สูงสุด 10 ไฟล์ กรุณาเอาไฟล์ที่ไม่ใช้ออกก่อน');
        const file = await tx.roomCreditFile.create({
          data: {
            roomId,
            key,
            name: `Statement.${type.ext}`,
            mimeType: type.mimeType,
            size: bytes.length,
            sourceMessageId,
          },
        });
        return { file, created: true };
      });
      retained = saved.created;
      return this.presentFile(saved.file);
    } finally {
      if (!retained) {
        try {
          await this.storage.delete(key);
        } catch {
          this.logger.warn(`Could not remove unreferenced credit attachment ${key}`);
        }
      }
    }
  }

  async remove(roomId: string, fileId: string, actor: CreditRoomActor) {
    return this.prisma.$transaction(async (tx) => {
      await lockCreditRoom(tx, roomId);
      await this.access(tx, roomId, actor);
      await this.ensureIdle(tx, roomId);
      const file = await tx.roomCreditFile.findFirst({
        where: { id: fileId, roomId, deletedAt: null },
      });
      if (!file) throw new NotFoundException('ไม่พบไฟล์');
      // Retain the stored object for immutable analysis history.
      await tx.roomCreditFile.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
      return { success: true };
    });
  }

  async download(roomId: string, fileId: string, actor: CreditRoomActor) {
    await this.access(this.prisma, roomId, actor);
    const file = await this.prisma.roomCreditFile.findFirst({ where: { id: fileId, roomId } });
    if (!file) throw new NotFoundException('ไม่พบไฟล์');
    if (file.deletedAt) {
      const history = await this.prisma.roomCreditAnalysis.findFirst({
        where: { roomId, deletedAt: null, status: 'COMPLETED', fileIds: { has: fileId } },
      });
      if (!history) throw new NotFoundException('ไม่พบไฟล์');
    }
    return { file: this.presentFile(file), stream: await this.storage.getStream(file.key) };
  }

  async analyze(roomId: string, fileIds: string[], actor: CreditRoomActor) {
    const { files, analysis } = await this.prisma.$transaction(async (tx) => {
      await lockCreditRoom(tx, roomId);
      await this.access(tx, roomId, actor);
      await this.ensureIdle(tx, roomId);
      const files = await tx.roomCreditFile.findMany({
        where: { roomId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      if (
        !files.length ||
        files.length > MAX_FILES ||
        fileIds.length !== files.length ||
        new Set(fileIds).size !== files.length ||
        !files.every((file) => fileIds.includes(file.id))
      ) {
        throw new ConflictException('รายการไฟล์เปลี่ยนไป กรุณาโหลดแผงใหม่แล้วกดวิเคราะห์อีกครั้ง');
      }
      const analysis = await tx.roomCreditAnalysis.create({
        data: { roomId, fileIds, status: 'ANALYZING' },
      });
      return { files, analysis };
    });
    try {
      const base64: string[] = [];
      for (const file of files) {
        const bytes = await readLimited(await this.storage.getStream(file.key));
        const { mimeType } = detectFile(bytes);
        base64.push(`data:${mimeType};base64,${bytes.toString('base64')}`);
      }
      const { confidence: _confidence, ...result } = await this.ocr.analyzeBankStatement(base64, actor.id);
      if (
        ![result.totalIncome, result.totalExpense, result.balance, result.monthlyIncome].some(
          (value) => typeof value === 'number' && Number.isFinite(value),
        )
      ) {
        throw new BadRequestException(
          'อ่านตัวเลขในเอกสารไม่ได้ กรุณาใช้สเตทเม้นหรือรูปที่ชัดเจนขึ้น',
        );
      }
      await this.prisma.$transaction(async (tx) => {
        await lockCreditRoom(tx, roomId);
        const updated = await tx.roomCreditAnalysis.updateMany({
          where: { id: analysis.id, status: 'ANALYZING' },
          data: { status: 'COMPLETED', result: result as Prisma.InputJsonValue },
        });
        if (!updated.count)
          throw new ConflictException('การวิเคราะห์รอบนี้หมดเวลาแล้ว กรุณาลองใหม่');
        const room = await tx.chatRoom.findFirst({ where: { id: roomId, deletedAt: null } });
        if (room?.customerId) await linkRoomCreditHistory(tx, roomId, room.customerId);
      });
      return this.get(roomId, actor);
    } catch (error) {
      const message =
        error instanceof BadRequestException
          ? error.message
          : 'วิเคราะห์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
      await this.prisma.roomCreditAnalysis.updateMany({
        where: { id: analysis.id, status: 'ANALYZING' },
        data: { status: 'FAILED', error: message },
      });
      throw error;
    }
  }
}
