import { Controller, Get, GoneException, Post, UseGuards } from '@nestjs/common';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

const GONE_MSG = 'เวอร์ชันหน้าเว็บเก่าเกินไป กรุณารีเฟรชหน้า (Ctrl+R) แล้วลองใหม่';

/**
 * RETIRED (spec /sell 2026-07-18): flow เก่าแลกใหม่แบบเก่าถูกยุบเข้า /sell —
 * ตอบ 410 คงไว้ 1 release กัน SPA bundle เก่าค้าง cache แล้วลบ module ทิ้งใน
 * release ถัดไป (นัดรวมกับ quick-quote 410 + อัปเดต .claude/rules/security.md)
 * สถานะ record เก่า: ลูกค้าเข้าผ่าน /sell/:id → GET /shop/buyback/:id แทน
 */
@Controller('shop/trade-in')
@UseGuards(ShopBotDefenseGuard)
export class ShopTradeInController {
  @Post('estimate')
  estimate() {
    throw new GoneException(GONE_MSG);
  }

  @Post('submit')
  submit() {
    throw new GoneException(GONE_MSG);
  }

  @Get(':id')
  getStatus() {
    throw new GoneException(GONE_MSG);
  }
}
