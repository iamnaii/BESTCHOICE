import { Module } from '@nestjs/common';
import { WarrantyService } from './warranty.service';

// ไม่มี cron ในโมดูลนี้แล้ว — ตัวไล่ส่งไลน์ "ประกันใกล้หมด 7 วัน" ถูกถอดตามคำสั่งเจ้าของ 2026-09-27
// (แม่แบบไม่เคยเปิดใช้ · migration 20261012100000 ลบแถวแม่แบบแบบ soft delete)
@Module({
  providers: [WarrantyService],
  exports: [WarrantyService],
})
export class WarrantyModule {}
