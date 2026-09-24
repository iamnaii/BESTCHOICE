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
import { MAX_INTAKE_PHOTOS } from './services/after-sales-case.service';

const TOO_MANY_PHOTOS = `รูปตอนรับฝากได้ไม่เกิน ${MAX_INTAKE_PHOTOS} รูป`;
const PHOTO_TOO_LARGE = `รูปมีขนาดเกิน ${EVIDENCE_IMAGE_MAX_BYTES / 1024 / 1024}MB`;

/**
 * Multer ตัดไฟล์ที่ 7 ทิ้งก่อน service จะได้เช็ค ⇒ Nest (transformException) ตอบ 400 ภาษาอังกฤษ
 * ("Unexpected field - photos" / "Too many files") และไฟล์ใหญ่เกินตอบ 413 "File too large".
 * ห่อ FilesInterceptor เดิมแล้วแปลเฉพาะ error ตอนแกะไฟล์เป็นภาษาไทย — error จาก handler/service
 * อยู่ใน Observable ที่ next.handle() คืน ไม่ผ่าน try/catch นี้ จึงไม่ถูกแตะ
 */
export function toThaiIntakeUploadError(err: unknown): unknown {
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

const BaseIntakePhotosInterceptor = FilesInterceptor('photos', MAX_INTAKE_PHOTOS, {
  limits: { fileSize: EVIDENCE_IMAGE_MAX_BYTES },
});

@Injectable()
export class IntakePhotosInterceptor extends BaseIntakePhotosInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await super.intercept(context, next);
    } catch (err) {
      throw toThaiIntakeUploadError(err);
    }
  }
}
