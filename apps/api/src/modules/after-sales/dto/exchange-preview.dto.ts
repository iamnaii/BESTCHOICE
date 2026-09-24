import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';

/** Query DTO ของ `GET /after-sales/exchange/preview` — mirror
 * `SubmitExchangeRequestDto` (contract-exchange) เพราะส่งพารามิเตอร์ชุดเดียวกันให้
 * `ContractExchangeService.buildPreview` ต่อ (ผ่าน `AfterSalesExchangeService.preview`) */
export class ExchangePreviewDto {
  @IsString()
  @MinLength(4, { message: 'IMEI อย่างน้อย 4 ตัว' })
  imei!: string;

  @IsOptional()
  @IsUUID()
  replacementProductId?: string;

  // ===== PRICED mode (ดูค่างวด/ยอดปิดก่อนส่งคำขอจริง) =====
  @IsOptional()
  @IsNumberString({}, { message: 'ราคารับซื้อต้องเป็นตัวเลข' })
  buybackPrice?: string;

  @IsOptional()
  @IsIn(['A', 'B', 'C', 'D'], { message: 'สภาพเครื่องต้องเป็น A-D' })
  deviceCondition?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'จำนวนงวดต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'จำนวนงวดอย่างน้อย 1' })
  @Max(48, { message: 'จำนวนงวดไม่เกิน 48' })
  newTotalMonths?: number;

  @IsOptional()
  @IsNumberString({}, { message: 'อัตราดอกเบี้ยต้องเป็นตัวเลข' })
  newInterestRate?: string;
}
