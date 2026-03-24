import { IsString, IsNumber, IsArray, IsBoolean, IsOptional, Min, Max } from 'class-validator';

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
  @Min(0, { message: 'VAT ต้องไม่น้อยกว่า 0' })
  @Max(1, { message: 'VAT ต้องไม่เกิน 1' })
  @IsOptional()
  vatPct?: number;

  @IsNumber()
  @Min(1, { message: 'จำนวนงวดขั้นต่ำต้องอย่างน้อย 1' })
  minInstallmentMonths: number;

  @IsNumber()
  @Min(1, { message: 'จำนวนงวดสูงสุดต้องอย่างน้อย 1' })
  maxInstallmentMonths: number;
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
  @Min(0, { message: 'VAT ต้องไม่น้อยกว่า 0' })
  @Max(1, { message: 'VAT ต้องไม่เกิน 1' })
  @IsOptional()
  vatPct?: number;

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
}
