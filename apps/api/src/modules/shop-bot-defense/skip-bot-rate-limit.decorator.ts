import { SetMetadata } from '@nestjs/common';

export const SKIP_BOT_RATE_LIMIT = 'skipBotRateLimit';

/**
 * ยกเว้น route นี้จากการ throw 429 ของ ShopBotDefenseGuard
 * (ยัง classify + log + นับ rate ตามปกติ — แค่ไม่ปิดประตู)
 *
 * ใช้กับ endpoint ที่ "ต้องเปิดได้เสมอ" เช่นหน้าแชร์ OG ที่ crawler และคนกด
 * ลิงก์จากกลุ่มแชทเดียวกันอาจยิงมาพร้อมกันจาก IP เดียว
 */
export const SkipBotRateLimit = () => SetMetadata(SKIP_BOT_RATE_LIMIT, true);
