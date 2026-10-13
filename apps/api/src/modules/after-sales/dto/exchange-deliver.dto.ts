import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

class DeliveredAccessoriesDto {
  @IsOptional() @IsBoolean() box?: boolean;
  @IsOptional() @IsBoolean() charger?: boolean;
  @IsOptional() @IsBoolean() case?: boolean;
  @IsOptional() @IsString() @MaxLength(60) other?: string;
}

/** PR 5 — ส่งมอบเครื่องทดแทนของเคสขายสด: อุปกรณ์ที่ส่งมอบ (พิมพ์บนใบส่งมอบ) + หมายเหตุ · เคสสัญญาผ่อนไม่ใช้ */
export class ExchangeDeliverDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveredAccessoriesDto)
  accessories?: DeliveredAccessoriesDto;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export { deliveredAccessoriesText } from '../utils/delivered-accessories';
