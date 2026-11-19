import {
  IsString,
  IsNumber,
  IsArray,
  IsBoolean,
  IsOptional,
  IsInt,
  IsPositive,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** แถวของตารางดอกเบี้ยรายงวด — `ratePct` = ดอกเบี้ยรวมทั้งสัญญาเป็นเศษส่วน (0.5 = 50%) */
export class InterestRateRowDto {
  @IsInt({ message: 'จำนวนงวดต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'จำนวนงวดต้องอย่างน้อย 1' })
  @Max(120, { message: 'จำนวนงวดต้องไม่เกิน 120' })
  months: number;

  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'ดอกเบี้ยรวมทศนิยมได้ไม่เกิน 4 ตำแหน่ง' })
  @IsPositive({ message: 'ดอกเบี้ยรวมต้องมากกว่า 0' })
  @Max(9.9999, { message: 'ดอกเบี้ยรวมต้องไม่เกิน 999.99%' })
  ratePct: number;
}

/**
 * ไม่มีช่อง `vatPct` (คำตัดสินเจ้าของ #22, 2026-10-31): VAT ของตั้งค่าดอกเบี้ยอ่านจากบริษัท FINANCE ที่เดียว — แก้ที่
 * ตั้งค่า › บริษัท & สาขา › บริษัทในเครือ · ค่าที่หน้าเว็บรุ่นเก่าส่งมาถูก ValidationPipe (whitelist) ตัดทิ้ง
 */
export class CreateInterestConfigDto {
  @IsString()
  name: string;

  @IsArray()
  @IsString({ each: true })
  productCategories: string[]; // e.g. ["PHONE_NEW"], ["PHONE_USED"]

  @IsNumber()
  @Min(0, { message: 'อัตราดอกเบี้ยต้องไม่น้อยกว่า 0' })
  @Max(1, { message: 'อัตราดอกเบี้ยต้องไม่เกิน 1' })
  interestRate: number;

  @IsNumber()
  @Min(0, { message: 'เงินดาวน์ขั้นต่ำต้องไม่น้อยกว่า 0' })
  @Max(1, { message: 'เงินดาวน์ขั้นต่ำต้องไม่เกิน 1' })
  minDownPaymentPct: number;

  @IsNumber()
  @Min(0, { message: 'ค่าคอมมิชชั่นต้องไม่น้อยกว่า 0' })
  @Max(1, { message: 'ค่าคอมมิชชั่นต้องไม่เกิน 1' })
  @IsOptional()
  storeCommissionPct?: number;

  @IsNumber()
  @Min(1, { message: 'จำนวนงวดขั้นต่ำต้องอย่างน้อย 1' })
  minInstallmentMonths: number;

  @IsNumber()
  @Min(1, { message: 'จำนวนงวดสูงสุดต้องอย่างน้อย 1' })
  maxInstallmentMonths: number;

  /** ไม่ส่ง = ไม่แตะตาราง · [] = ลบทุกแถว (ใช้ดอกเบี้ยต่อเดือน × งวด) · มีค่า = แทนทั้งชุด */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InterestRateRowDto)
  rates?: InterestRateRowDto[];
}

export class UpdateInterestConfigDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  productCategories?: string[];

  @IsNumber()
  @Min(0, { message: 'อัตราดอกเบี้ยต้องไม่น้อยกว่า 0' })
  @Max(1, { message: 'อัตราดอกเบี้ยต้องไม่เกิน 1' })
  @IsOptional()
  interestRate?: number;

  @IsNumber()
  @Min(0, { message: 'เงินดาวน์ขั้นต่ำต้องไม่น้อยกว่า 0' })
  @Max(1, { message: 'เงินดาวน์ขั้นต่ำต้องไม่เกิน 1' })
  @IsOptional()
  minDownPaymentPct?: number;

  @IsNumber()
  @Min(0, { message: 'ค่าคอมมิชชั่นต้องไม่น้อยกว่า 0' })
  @Max(1, { message: 'ค่าคอมมิชชั่นต้องไม่เกิน 1' })
  @IsOptional()
  storeCommissionPct?: number;

  @IsNumber()
  @Min(1, { message: 'จำนวนงวดขั้นต่ำต้องอย่างน้อย 1' })
  @IsOptional()
  minInstallmentMonths?: number;

  @IsNumber()
  @Min(1, { message: 'จำนวนงวดสูงสุดต้องอย่างน้อย 1' })
  @IsOptional()
  maxInstallmentMonths?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  /** ไม่ส่ง = ไม่แตะตาราง · [] = ลบทุกแถว (ใช้ดอกเบี้ยต่อเดือน × งวด) · มีค่า = แทนทั้งชุด */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InterestRateRowDto)
  rates?: InterestRateRowDto[];
}
