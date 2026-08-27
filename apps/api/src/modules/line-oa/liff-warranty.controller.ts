import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { LiffTokenGuard } from './guards/liff-token.guard';
import { LiffWarrantyService, LiffWarrantyResponse } from './liff-warranty.service';

interface LiffRequest {
  liffUserId: string;
}

/**
 * "ประกันของฉัน" — ลูกค้าเปิดจาก LINE OA **ร้าน** (ช่อง SHOP)
 *
 * แยกจาก `LiffApiController` เพราะตัวนั้นติด `@LiffChannel(LineChannelType.FINANCE)`
 * ที่ระดับคลาส ⇒ ทุก endpoint ในนั้นเป็นของสายผ่อน/การเงิน
 *
 * **จงใจไม่ใส่ `@LiffChannel(SHOP)`**: `enforceChannelBoundary` อ่านตาราง
 * `CustomerLineLink` ซึ่งวันนี้ **ไม่มีแถวช่อง SHOP เลยสักแถว** (ตัวเดียวที่เขียนตารางนี้คือ
 * OTP ของ chatbot-finance และ hardcode FINANCE) ⇒ ถ้าใส่ decorator ไป ผลจะกลายเป็น:
 * ลูกค้าที่เคยผูกฝั่งไฟแนนซ์จะโดน 403 ที่หน้าประกันทั้งที่มีสิทธิ์ ส่วนคนที่ยังไม่ผูกจะผ่านฉลุย
 * — กลับหัวกลับหางจากที่ควรเป็น
 *
 * ความปลอดภัยมาจากตัว lookup เอง: `LiffTokenGuard` ยืนยัน LINE ID token กับ LINE จริง
 * แล้ว service ค้นด้วย `customer.lineIdShop = <userId นั้น>` ⇒ คนที่ไม่เคยผูกช่อง SHOP
 * ไม่ว่าจะผูกช่องอื่นไว้หรือไม่ ก็ match ไม่ได้ (ได้ `linked: false` ข้อมูลว่าง)
 */
@ApiTags('LIFF API')
@Controller('line-oa')
@SkipCsrf()
@UseGuards(LiffTokenGuard)
export class LiffWarrantyController {
  constructor(private readonly warrantyService: LiffWarrantyService) {}

  @Get('liff/my-warranties')
  @Throttle({ short: { ttl: 60000, limit: 20 } })
  @ApiOperation({
    summary:
      'ประกันของลูกค้า (ช่อง SHOP) — รวมเครื่องจากใบขาย (ขายสด/ไฟแนนซ์นอก) และสัญญาผ่อน',
  })
  async getMyWarranties(@Req() req: Request): Promise<LiffWarrantyResponse> {
    const lineUserId = (req as unknown as LiffRequest).liffUserId;
    return this.warrantyService.getMyWarranties(lineUserId);
  }
}
