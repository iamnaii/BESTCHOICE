import { Module } from '@nestjs/common';
import { ShopTradeInController } from './shop-trade-in.controller';

/** RETIRED — โฮสต์ 410 stub เท่านั้น (app.module ยัง import module นี้อยู่ ห้ามถอด ไม่งั้น 404) */
@Module({ controllers: [ShopTradeInController] })
export class ShopTradeInModule {}
