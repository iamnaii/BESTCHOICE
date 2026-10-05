import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { EVIDENCE_IMAGE_MAX_BYTES } from '../../utils/upload-image.util';

/** รูปหลักฐานของคำขอตัดสินค้า — เพดานเดียวกับรูปตอนรับฝากหลังการขาย */
export const MAX_ADJUSTMENT_PHOTOS = 6;

const TOO_MANY_PHOTOS = `รูปหลักฐานแนบได้ไม่เกิน ${MAX_ADJUSTMENT_PHOTOS} รูป`;
const PHOTO_TOO_LARGE = `รูปมีขนาดเกิน ${EVIDENCE_IMAGE_MAX_BYTES / 1024 / 1024}MB`;

/**
 * Multer ตัดไฟล์ที่ 7 ทิ้งก่อน service จะได้เช็ค ⇒ Nest ตอบ 400 ภาษาอังกฤษ ("Unexpected field - photos" /
 * "Too many files") และไฟล์ใหญ่เกินตอบ 413 "File too large". ห่อ FilesInterceptor แล้วแปลเฉพาะ error ตอน
 * แกะไฟล์เป็นไทย — error จาก handler/service อยู่ใน Observable ที่ next.handle() คืน ไม่ถูกแตะ
 * (ลอกจาก `after-sales/intake-photos.interceptor.ts`).
 */
export function toThaiAdjustmentUploadError(err: unknown): unknown {
  if (!(err instanceof HttpException)) return err;
  const message = String((err.getResponse() as { message?: unknown })?.message ?? err.message);
  if (err instanceof PayloadTooLargeException && message.startsWith('File too large')) {
    return new PayloadTooLargeException(PHOTO_TOO_LARGE);
  }
  if (
    err instanceof BadRequestException &&
    (message.startsWith('Unexpected field') || message.startsWith('Too many files'))
  ) {
    return new BadRequestException(TOO_MANY_PHOTOS);
  }
  return err;
}

const BaseAdjustmentPhotosInterceptor = FilesInterceptor('photos', MAX_ADJUSTMENT_PHOTOS, {
  limits: { fileSize: EVIDENCE_IMAGE_MAX_BYTES },
});

@Injectable()
export class AdjustmentPhotosInterceptor extends BaseAdjustmentPhotosInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await super.intercept(context, next);
    } catch (err) {
      throw toThaiAdjustmentUploadError(err);
    }
  }
}
