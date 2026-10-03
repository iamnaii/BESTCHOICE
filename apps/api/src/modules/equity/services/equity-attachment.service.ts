import { matchesMimeMagicBytes } from '../../../utils/attachment-mime.util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

/** แนบไฟล์มติที่ประชุม — pattern เดียวกับ interco uploadSlip (magic-byte re-check + rollback) */
@Injectable()
export class EquityAttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private async findDocOrFail(docId: string) {
    const doc = await this.prisma.equityDocument.findFirst({
      where: { id: docId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('ไม่พบเอกสาร');
    return doc;
  }

  async upload(docId: string, file: Express.Multer.File, userId: string) {
    const doc = await this.findDocOrFail(docId);
    if (doc.status !== 'DRAFT' && doc.status !== 'READY') {
      throw new ConflictException('แนบไฟล์ได้เฉพาะเอกสารสถานะร่างหรือรออนุมัติ');
    }
    if (!matchesMimeMagicBytes(file)) {
      throw new BadRequestException(
        'ประเภทไฟล์ไม่ตรงกับเนื้อหา (รองรับเฉพาะ PDF, JPEG, PNG, WEBP)',
      );
    }
    const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    // eslint-disable-next-line no-control-regex
    const safeName = decodedName.replace(/[<>:"/\\|?*\x00-\s]/g, '_');
    const key = `equity/${docId}/${Date.now()}-${randomUUID()}-${safeName}`;

    await this.storage.upload(key, file.buffer, file.mimetype);
    try {
      return await this.prisma.equityAttachment.create({
        data: {
          documentId: docId,
          s3Key: key,
          filename: decodedName,
          size: file.size,
          mimeType: file.mimetype,
          uploadedById: userId,
        },
      });
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }
  }

  async getSignedUrl(attachmentId: string): Promise<{ url: string; expiresIn: number }> {
    const att = await this.prisma.equityAttachment.findFirst({ where: { id: attachmentId } });
    if (!att) throw new NotFoundException('ไม่พบไฟล์แนบ');
    const expiresIn = 900;
    const url = await this.storage.getSignedDownloadUrl(att.s3Key, expiresIn);
    return { url, expiresIn };
  }

  async remove(docId: string, attachmentId: string, userId: string) {
    const doc = await this.findDocOrFail(docId);
    if (doc.status !== 'DRAFT' && doc.status !== 'READY') {
      throw new ConflictException('ลบไฟล์ได้เฉพาะเอกสารสถานะร่างหรือรออนุมัติ');
    }
    const att = await this.prisma.equityAttachment.findFirst({
      where: { id: attachmentId, documentId: docId },
    });
    if (!att) throw new NotFoundException('ไม่พบไฟล์แนบ');
    await this.prisma.equityAttachment.delete({ where: { id: attachmentId } });
    await this.storage.delete(att.s3Key).catch(() => undefined);
    return { success: true, removedBy: userId };
  }
}
