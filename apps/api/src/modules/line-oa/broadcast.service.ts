import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  constructor(
    private configService: ConfigService,
    private storageService: StorageService,
  ) {}

  async uploadImage(file: Buffer, filename: string): Promise<{ url: string }> {
    const key = `broadcast/images/${Date.now()}-${filename}`;
    await this.storageService.upload(key, file, 'image/jpeg');

    // Build public URL
    const s3Endpoint = this.configService.get<string>('S3_ENDPOINT');
    const s3Bucket = this.configService.get<string>('S3_BUCKET') || 'bestchoice-documents';
    const gcsBucket = this.configService.get<string>('GCS_BUCKET');
    const appUrl = this.configService.get<string>('APP_URL') || 'https://app.bestchoice.co.th';

    let url: string;
    if (s3Endpoint) {
      url = `${s3Endpoint}/${s3Bucket}/${key}`;
    } else if (gcsBucket) {
      url = `https://storage.googleapis.com/${gcsBucket}/${key}`;
    } else {
      // Fallback — serve via API
      url = `${appUrl}/api/files/${encodeURIComponent(key)}`;
    }

    return { url };
  }
}
