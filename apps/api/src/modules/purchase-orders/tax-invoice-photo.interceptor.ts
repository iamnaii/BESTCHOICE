import { BadRequestException, CallHandler, ExecutionContext, HttpException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { EVIDENCE_IMAGE_MAX_BYTES } from '../../utils/upload-image.util';

const PHOTO_TOO_LARGE = `รูปใบกำกับภาษีมีขนาดเกิน ${EVIDENCE_IMAGE_MAX_BYTES / 1024 / 1024}MB`;

/** ก้อน 5 — รูปใบกำกับภาษีที่มาทีหลัง (ไม่บังคับ · ไฟล์เดียว) — แปล error ของ Multer เป็นไทยแบบ `AdjustmentPhotosInterceptor` */
export function toThaiTaxInvoiceUploadError(err: unknown): unknown {
  if (!(err instanceof HttpException)) return err;
  const message = String((err.getResponse() as { message?: unknown })?.message ?? err.message);
  if (err instanceof PayloadTooLargeException && message.startsWith('File too large')) return new PayloadTooLargeException(PHOTO_TOO_LARGE);
  if (err instanceof BadRequestException && (message.startsWith('Unexpected field') || message.startsWith('Too many files'))) {
    return new BadRequestException('แนบรูปใบกำกับภาษีได้ 1 รูป ในช่อง photo');
  }
  return err;
}

const Base = FileInterceptor('photo', { limits: { fileSize: EVIDENCE_IMAGE_MAX_BYTES } });

@Injectable()
export class TaxInvoicePhotoInterceptor extends Base {
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await super.intercept(context, next);
    } catch (err) {
      throw toThaiTaxInvoiceUploadError(err);
    }
  }
}
