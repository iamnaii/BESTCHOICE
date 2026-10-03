import { randomUUID } from 'crypto';
import { Injectable, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';

/**
 * เหลือเฉพาะ "อัปโหลดรูป" — ระบบ Broadcast (ส่ง/ตั้งเวลา/อนุมัติ/ประวัติ + cron ทุกนาที)
 * ถูกถอด 2026-09-28 ตามคำสั่งเจ้าของ: ส่งได้เฉพาะ LINE ขณะที่ลูกค้าอยู่ Facebook ทั้งหมด
 * และหน้าเว็บไม่มีปุ่มอนุมัติ ข้อความจึงค้าง PENDING_APPROVAL ตลอด (prod 0 แถว)
 *
 * ตัวอัปโหลดรูปต้องอยู่ต่อเพราะตัวแก้ข้อความสำเร็จรูปของอินบ็อกซ์เรียกใช้
 * (`apps/web/src/pages/canned-response-admin/bubble-editors/ImageBubbleEditor.tsx`)
 * — path `line-oa/broadcast/upload-image` และ key `broadcast/images/…` จึงคงเดิม
 * ตาราง `broadcast_messages` / `broadcast_approvals` ยังอยู่ในฐานข้อมูล
 */
@Injectable()
export class BroadcastService {
  constructor(private storageService: StorageService) {}

  async uploadImage(file: Buffer): Promise<{ url: string }> {
    // FileTypeValidator checks bytes but leaves the client MIME header untouched.
    const signature = file.subarray(0, 12);
    const contentType = signature.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'image/png'
      : signature.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ? 'image/jpeg'
      : ['GIF87a', 'GIF89a'].includes(signature.subarray(0, 6).toString()) ? 'image/gif'
      : signature.subarray(0, 4).toString() === 'RIFF' && signature.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : '';
    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
    };
    const extension = extensions[contentType];
    if (!extension) throw new BadRequestException('รูปแบบรูปภาพไม่รองรับ');
    return this.uploadMedia(file, `images/${randomUUID()}.${extension}`, contentType);
  }

  private async uploadMedia(file: Buffer, name: string, contentType: string) {
    if (!this.storageService.configured || this.storageService.describe().backend === 'local') {
      throw new ServiceUnavailableException('กรุณาตั้งค่าที่เก็บไฟล์สาธารณะสำหรับ Broadcast');
    }
    const key = `broadcast/${name}`;
    await this.storageService.upload(key, file, contentType);
    return { url: this.storageService.getPublicUrl(key) };
  }
}
