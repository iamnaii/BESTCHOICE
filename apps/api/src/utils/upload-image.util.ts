import { BadRequestException } from '@nestjs/common';

/** รูปหลักฐาน (สลิปฝากเงิน ฯลฯ) — รับเฉพาะรูป ไม่รับ PDF: ถ่ายจากมือถือหน้าตู้/หน้าเคาน์เตอร์ */
export const EVIDENCE_IMAGE_MIME = /^image\/(jpeg|png|webp)$/;
export const EVIDENCE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * ตรวจ byte แรกของไฟล์ให้ตรงกับ mimetype ที่ประกาศ — ชั้นที่สองต่อจาก `FileTypeValidator` ของ controller
 * (header `Content-Type` ผู้ส่งกำหนดเองได้). กติกาเดียวกับ `matchesMimeMagicBytes` ของ interco/equity/other-income เฉพาะส่วนรูปภาพ
 */
export function isEvidenceImage(file: Pick<Express.Multer.File, 'buffer' | 'mimetype'>): boolean {
  const buf = file.buffer;
  if (!buf || buf.length < 12) return false;
  if (file.mimetype === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (file.mimetype === 'image/png') {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => buf[index] === byte);
  }
  if (file.mimetype === 'image/webp') {
    return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  }
  return false;
}

export function assertEvidenceImage(file: Express.Multer.File | undefined, label: string): asserts file is Express.Multer.File {
  if (!file) throw new BadRequestException(`กรุณาแนบรูป${label}`);
  if (!isEvidenceImage(file)) throw new BadRequestException(`รูป${label}ต้องเป็นไฟล์ JPEG, PNG หรือ WEBP`);
}

export const evidenceImageExtension = (mimetype: string) => (mimetype === 'image/png' ? 'png' : mimetype === 'image/webp' ? 'webp' : 'jpg');
