import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { LiffTokenGuard } from './guards/liff-token.guard';
import { LiffWarrantyService, LiffWarrantyResponse } from './liff-warranty.service';
import { LiffAfterSalesService, LiffAfterSalesResponse } from './liff-after-sales.service';

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
 * OTP ของ chatbot-finance และ hardcode FINANCE) ⇒ ถ้าใส่ decorator ไป ลูกค้าที่ยืนยัน OTP แล้ว (แถว FINANCE)
 * จะโดน 403 ที่หน้าประกัน — ทั้งที่แถวนั้นคือหลักฐานตัวตนที่หน้านี้ใช้ (Task 22)
 *
 * ความปลอดภัยมาจากตัว lookup เอง: `LiffTokenGuard` ยืนยัน LINE ID token กับ LINE จริง แล้ว service หาลูกค้าด้วย
 * `findShopLiffCustomerId` — แถว OTP ช่อง FINANCE ของ LINE นั้น (สำรองด้วย `customer.lineIdShop` เฉพาะค่าที่เขียนก่อน Task 20)
 * ⇒ LINE ที่ยังไม่ยืนยัน OTP ได้ `linked: false` ข้อมูลว่าง
 */
@ApiTags('LIFF API')
@Controller('line-oa')
@SkipCsrf()
@UseGuards(LiffTokenGuard)
export class LiffWarrantyController {
  constructor(
    private readonly warrantyService: LiffWarrantyService,
    private readonly afterSalesService: LiffAfterSalesService,
  ) {}

  @Get('liff/my-warranties')
  @Throttle({ short: { ttl: 60000, limit: 20 } })
  @ApiOperation({
    summary: 'ประกันของลูกค้า (ช่อง SHOP) — รวมเครื่องจากใบขาย (ขายสด/ไฟแนนซ์นอก) และสัญญาผ่อน',
  })
  async getMyWarranties(@Req() req: Request): Promise<LiffWarrantyResponse> {
    const lineUserId = (req as unknown as LiffRequest).liffUserId;
    return this.warrantyService.getMyWarranties(lineUserId);
  }

  @Get('liff/my-after-sales-cases')
  @Throttle({ short: { ttl: 60000, limit: 20 } })
  @ApiOperation({
    summary: 'เคสหลังการขายของลูกค้า (ช่อง SHOP) — เคสเปิดอยู่ + เคสปิดภายใน 14 วัน',
  })
  // ไม่ใส่ @LiffChannel(SHOP) ด้วยเหตุผลเดียวกับ my-warranties ด้านบน — CustomerLineLink
  // ยังไม่มีแถวช่อง SHOP เลยสักแถว ความปลอดภัยมาจาก lookup (findShopLiffCustomerId — แถว OTP) เอง
  async getMyAfterSalesCases(@Req() req: Request): Promise<LiffAfterSalesResponse> {
    return this.afterSalesService.getMyCases((req as unknown as LiffRequest).liffUserId);
  }
}
