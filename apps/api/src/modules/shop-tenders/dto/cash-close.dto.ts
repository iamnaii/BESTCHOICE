import { ShopCashDestination } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const MAX_AMOUNT = 99_999_999.99;

export class CountCashCloseDto {
  // ไม่ใช้ IsUUID: สาขาจาก seed/ข้อมูลเก่ามี id ที่ไม่ใช่ UUID (เช่น `branch-002`) — service ตรวจเองว่าสาขามีจริงและเป็นสาขาของผู้นับ
  @IsString({ message: 'กรุณาเลือกสาขา' })
  @IsNotEmpty({ message: 'กรุณาเลือกสาขา' })
  branchId!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'ยอดที่นับได้ต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง' })
  @Min(0, { message: 'ยอดที่นับได้ต้องไม่ติดลบ' })
  @Max(MAX_AMOUNT, { message: 'ยอดที่นับได้สูงเกินไป' })
  countedAmount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'เหตุผลของส่วนต่างยาวเกิน 500 ตัวอักษร' })
  varianceReason?: string;
}

export class ConfirmCashCloseDto {
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'เงินที่รับมาจริงต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง' })
  @Min(0, { message: 'เงินที่รับมาจริงต้องไม่ติดลบ' })
  @Max(MAX_AMOUNT, { message: 'เงินที่รับมาจริงสูงเกินไป' })
  receivedAmount!: number;

  @IsEnum(ShopCashDestination, { message: 'กรุณาเลือกว่านำเงินไปไว้ที่ไหน' })
  destination!: ShopCashDestination;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'หมายเหตุยาวเกิน 500 ตัวอักษร' })
  note?: string;
}

export class SendBackCashCloseDto {
  @IsString()
  @IsNotEmpty({ message: 'กรอกเหตุผลที่ตีกลับให้นับใหม่' })
  @MaxLength(500, { message: 'เหตุผลยาวเกิน 500 ตัวอักษร' })
  reason!: string;
}
