import { BadRequestException } from '@nestjs/common';
import { matchesDocumentMime } from '../contracts/services/document-mime.util';

export function validateEvidencePhoto(value: string): { bytes: Buffer; mime: string } {
  const data = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!data || value.length > 7_000_000) throw new BadRequestException('รูปหลักฐานต้องเป็น JPG, PNG, WEBP หรือ GIF ไม่เกิน 5MB');
  const bytes = Buffer.from(data[2], 'base64');
  if (!bytes.length || bytes.length > 5 * 1024 * 1024 || bytes.toString('base64') !== data[2] || !matchesDocumentMime(bytes, data[1])) {
    throw new BadRequestException('รูปหลักฐานไม่สมบูรณ์หรือประเภทไฟล์ไม่ตรง กรุณาเลือกไฟล์ใหม่');
  }
  return { bytes, mime: data[1] };
}
