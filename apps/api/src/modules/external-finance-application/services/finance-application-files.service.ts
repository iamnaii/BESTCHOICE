import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ExternalFinanceDocSlot, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { LineOaService } from '../../line-oa/line-oa.service';
import { LineFinanceClientService } from '../../chatbot-finance/services/line-finance-client.service';
import { OcrService } from '../../ocr/ocr.service';
import { detectFile, fetchProviderMedia, readLimited, EXPIRED_MEDIA_MSG } from '../../credit-check/services/media-fetch.util';
import { hashLockKey } from '../../../utils/advisory-lock.util';
import { FinanceApplicationService } from './finance-application.service';
import { FinanceActor, MAX_FILES, STORAGE_PREFIX } from '../constants';
import { isClosed } from '../finance-application-status.util';
import { FileFromMessageDto } from '../dto/finance-application-files.dto';

const ANGLES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
const DATA_URL_RE = /^data:image\/(jpeg|png|webp|gif);base64,(.+)$/;
const NO_SOURCE_MSG = 'ไฟล์นี้ระบบไม่ได้เก็บไว้ (ส่งมาก่อนอัปเดต) กรุณาบันทึกรูปจากแชทแล้วอัปโหลดแทน';

type AttachMeta = {
  slot: ExternalFinanceDocSlot;
  source: 'CHAT_MESSAGE' | 'UPLOAD' | 'PRODUCT_PHOTO';
  sourceMessageId?: string;
  sourceAngle?: string;
  originalName?: string;
  sortOrder?: number;
  /** รูปจากสต๊อก: ใบต้องยังชี้เครื่องนี้ตอนบันทึก (ตรวจใต้ล็อก — I3) */
  expectProductId?: string;
};

@Injectable()
export class FinanceApplicationFilesService {
  private readonly logger = new Logger(FinanceApplicationFilesService.name);
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private applications: FinanceApplicationService,
    private lineOa: LineOaService,
    private lineFinance: LineFinanceClientService,
    private ocr: OcrService,
  ) {}

  private async openApplication(id: string, actor: FinanceActor) {
    const app = await this.applications.get(id, actor);
    if (isClosed(app.status)) throw new BadRequestException('ใบยื่นปิดแล้ว เพิ่ม/ลบไฟล์ไม่ได้');
    return app;
  }

  /**
   * ดึงไบต์ของข้อความในห้อง: คีย์ staff-chat/ → storage · URL ผู้ให้บริการ (https) → fetch ·
   * ไม่มี URL หรือเป็นอ้างอิง `line://` → ดึงจาก LINE ด้วย message id **ตามช่องทางของห้องเท่านั้น** (minor 4):
   * LINE_FINANCE → OA ไฟแนนซ์ · LINE_SHOP → OA ร้าน · ช่องทางอื่นที่มีแค่ id (เช่น Facebook) = ห้ามส่ง id ไป LINE API → 404 ให้อัปโหลดแทน
   */
  private async loadMessageBytes(message: { mediaUrl: string | null; mediaType: string | null; externalMessageId: string | null }, channel: string) {
    if (message.mediaUrl?.startsWith('staff-chat/'))
      return { bytes: await readLimited(await this.storage.getStream(message.mediaUrl)), contentType: message.mediaType || '' };
    if (message.mediaUrl && !message.mediaUrl.startsWith('line://')) return fetchProviderMedia(message.mediaUrl);
    const lineDownload: Record<string, (id: string) => Promise<Buffer>> = {
      LINE_FINANCE: (id) => this.lineFinance.getMessageContent(id),
      LINE_SHOP: (id) => this.lineOa.downloadContent(id, 'line-shop'),
    };
    const download = lineDownload[channel];
    if (!message.externalMessageId || !download) throw new NotFoundException(NO_SOURCE_MSG);
    try {
      return { bytes: await download(message.externalMessageId), contentType: '' };
    } catch (error) {
      this.logger.warn(`LINE content download failed for ${message.externalMessageId}: ${(error as Error).message}`);
      throw new BadRequestException(EXPIRED_MEDIA_MSG);
    }
  }

  async fromMessage(applicationId: string, dto: FileFromMessageDto, actor: FinanceActor) {
    const app = await this.openApplication(applicationId, actor);
    const message = await this.prisma.chatMessage.findFirst({
      where: { id: dto.messageId, roomId: app.roomId, deletedAt: null, type: { in: ['IMAGE', 'FILE'] } },
      select: { id: true, mediaUrl: true, mediaType: true, externalMessageId: true },
    });
    if (!message) throw new NotFoundException('ไม่พบไฟล์ในห้องแชทนี้');
    const media = await this.loadMessageBytes(message, app.room.channel);
    return this.attach(app.id, media.bytes, actor, { slot: dto.slot, source: 'CHAT_MESSAGE', sourceMessageId: message.id });
  }

  /** อ่านบัตรจากรูปในแชทโดยไม่แนบเข้าใบยื่น — ให้ปุ่ม "สร้างลูกค้าจากรูปบัตร" ในแท็บ GFIN (spec §5.2 ขั้น 1) */
  async ocrIdCardFromMessage(roomId: string, messageId: string, actor: FinanceActor) {
    const room = await this.applications.access(this.prisma, roomId, actor);
    const message = await this.prisma.chatMessage.findFirst({ where: { id: messageId, roomId, deletedAt: null } });
    if (!message) throw new NotFoundException('ไม่พบข้อความนี้ในห้อง');
    const media = await this.loadMessageBytes(message, room.channel);
    // เชื่อ magic bytes ไม่ใช่ contentType — ข้อความ LINE (externalMessageId) ไม่มี contentType ติดมา (loadMessageBytes คืน '')
    const kind = detectFile(media.bytes);
    if (!kind.mimeType.startsWith('image/')) throw new BadRequestException('อ่านบัตรได้เฉพาะรูปภาพ — ไฟล์ PDF ให้กรอกเอง');
    return this.ocr.extractIdCard(`data:${kind.mimeType};base64,${media.bytes.toString('base64')}`, actor.id);
  }

  async upload(applicationId: string, slot: ExternalFinanceDocSlot, file: Express.Multer.File | undefined, actor: FinanceActor) {
    const app = await this.openApplication(applicationId, actor);
    if (!file) throw new BadRequestException('กรุณาเลือกไฟล์');
    return this.attach(app.id, file.buffer, actor, { slot, source: 'UPLOAD', originalName: file.originalname });
  }

  /**
   * รูป 6 มุมจากสต๊อก (ProductPhoto เก็บ data URL) — เฉพาะมือสองที่ถ่ายครบ (product-photos.service.ts:44-47)
   * การกันมุมซ้ำตัวจริงอยู่ใน attach() ใต้ล็อกของใบยื่น (I3 — เดิมกรองนอกล็อก สองคำขอพร้อมกันผ่านได้ทั้งคู่)
   * พร้อมตรวจว่าใบยังชี้เครื่องเดิม (เปลี่ยนเครื่องระหว่างดึง = 409) · ตัวกรองนอกล็อกข้างล่างเหลือไว้แค่ไม่ให้อัปโหลดเปล่า ๆ
   */
  async fromProduct(applicationId: string, actor: FinanceActor) {
    const app = await this.openApplication(applicationId, actor);
    if (!app.productId) throw new BadRequestException('เลือกเครื่องก่อน');
    const productId = app.productId;
    const product = await this.prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true, category: true } });
    const photos = product?.category === 'PHONE_USED'
      ? await this.prisma.productPhoto.findUnique({ where: { productId: product.id } })
      : null;
    const complete = !!photos && photos.isCompleted && ANGLES.every((a) => !!photos[a]);
    if (!complete) throw new BadRequestException('เครื่องนี้ไม่มีรูป 6 มุมครบในสต๊อก กรุณาถ่ายเพิ่มในช่อง "รูปเครื่อง 6 มุม"');
    const existing = await this.prisma.externalFinanceApplicationFile.findMany({ where: { applicationId: app.id, deletedAt: null, sentAt: null, source: 'PRODUCT_PHOTO' } });
    const results: Awaited<ReturnType<typeof this.attach>>[] = [];
    for (const [index, angle] of ANGLES.entries()) {
      if (existing.some((f) => f.sourceAngle === angle)) continue;
      const match = DATA_URL_RE.exec(photos![angle] as string);
      if (!match) throw new BadRequestException(`รูปมุม ${angle} ไม่อยู่ในรูปแบบที่รองรับ`);
      const saved = await this.store(app.id, Buffer.from(match[2], 'base64'), actor, { slot: 'DEVICE_PHOTO', source: 'PRODUCT_PHOTO', sourceAngle: angle, sortOrder: index, expectProductId: productId });
      if (saved.created) results.push(saved.file);
    }
    return results;
  }

  private async attach(
    applicationId: string,
    bytes: Buffer,
    actor: FinanceActor,
    meta: AttachMeta,
  ) {
    return (await this.store(applicationId, bytes, actor, meta)).file;
  }

  /** อัปโหลดแล้วบันทึกแถวใต้ล็อกของใบยื่น — `created: false` = มีแถวเดิมอยู่แล้ว (ข้อความเดิม / มุมเดิมจากสต๊อก) ไฟล์ที่เพิ่งอัปถูกลบทิ้ง */
  private async store(applicationId: string, bytes: Buffer, actor: FinanceActor, meta: AttachMeta) {
    const type = detectFile(bytes);
    if (!this.storage.configured) throw new ServiceUnavailableException('ยังไม่ได้ตั้งค่าที่เก็บไฟล์');
    const key = `${STORAGE_PREFIX}/${applicationId}/${randomUUID()}.${type.ext}`;
    let retained = false;
    try {
      await this.storage.upload(key, bytes, type.mimeType);
      const saved = await this.prisma.$transaction(async (tx) => {
        // ล็อกระดับใบยื่นก่อนเช็คซ้ำ/MAX_FILES — กัน fromMessage สองคำขอพร้อมกันสร้างแถวซ้ำ (review fix รอบ 1)
        // (ล็อกเดียวกับ FinanceApplicationService.update ตอนเปลี่ยนเครื่องล้างรูปสต๊อก)
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${hashLockKey(`finance-app-files:${applicationId}`)})`);
        if (meta.expectProductId !== undefined) {
          const sameProduct = await tx.externalFinanceApplication.count({ where: { id: applicationId, productId: meta.expectProductId, deletedAt: null } });
          if (!sameProduct) throw new ConflictException('เครื่องในใบยื่นเปลี่ยนไประหว่างดึงรูป — กด "ดึงจากสต๊อก" ในขั้นรูปอีกครั้ง');
        }
        const files = await tx.externalFinanceApplicationFile.findMany({ where: { applicationId, deletedAt: null } });
        const duplicate =
          (meta.sourceMessageId && files.find((f) => f.sourceMessageId === meta.sourceMessageId)) ||
          // มุมซ้ำนับเฉพาะรูปสต๊อกที่ยังไม่ส่ง: รูปที่ส่งไปแล้ว (หลักฐานของการส่งครั้งก่อน) อาจเป็นของเครื่องเดิมก่อนเปลี่ยน
          // (ขอเพิ่ม → เปลี่ยนเครื่อง) — ถ้านับด้วย รูปของเครื่องใหม่จะแนบไม่ได้เลย
          (meta.source === 'PRODUCT_PHOTO' && meta.sourceAngle && files.find((f) => f.source === 'PRODUCT_PHOTO' && !f.sentAt && f.sourceAngle === meta.sourceAngle));
        if (duplicate) return { file: duplicate, created: false };
        if (files.length >= MAX_FILES) throw new BadRequestException(`แนบได้สูงสุด ${MAX_FILES} ไฟล์ต่อใบยื่น`);
        const file = await tx.externalFinanceApplicationFile.create({
          data: {
            applicationId, slot: meta.slot, storageKey: key, mimeType: type.mimeType, size: bytes.length,
            originalName: meta.originalName ?? null, source: meta.source, sourceMessageId: meta.sourceMessageId ?? null,
            sourceAngle: meta.sourceAngle ?? null, sortOrder: meta.sortOrder ?? files.filter((f) => f.slot === meta.slot).length,
            createdById: actor.id,
          },
        });
        return { file, created: true };
      });
      retained = saved.created;
      return saved;
    } finally {
      if (!retained) {
        try { await this.storage.delete(key); } catch { this.logger.warn(`Could not remove unreferenced finance attachment ${key}`); }
      }
    }
  }

  async remove(applicationId: string, fileId: string, actor: FinanceActor) {
    const app = await this.openApplication(applicationId, actor);
    const file = await this.prisma.externalFinanceApplicationFile.findFirst({ where: { id: fileId, applicationId: app.id, deletedAt: null } });
    if (!file) throw new NotFoundException('ไม่พบไฟล์');
    if (file.sentAt) throw new BadRequestException('ไฟล์ที่ส่งไปแล้วลบไม่ได้ — ยกเลิกใบยื่นแทน');
    await this.prisma.externalFinanceApplicationFile.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
    if (file.storageKey) { try { await this.storage.delete(file.storageKey); } catch { this.logger.warn(`Could not delete ${file.storageKey}`); } }
    return { success: true };
  }

  async download(applicationId: string, fileId: string, actor: FinanceActor) {
    const app = await this.applications.get(applicationId, actor);
    const file = await this.prisma.externalFinanceApplicationFile.findFirst({ where: { id: fileId, applicationId: app.id, deletedAt: null } });
    if (!file?.storageKey) throw new NotFoundException('ไฟล์ถูกลบตามนโยบายเก็บข้อมูลแล้ว');
    return { file, stream: await this.storage.getStream(file.storageKey) };
  }
}
