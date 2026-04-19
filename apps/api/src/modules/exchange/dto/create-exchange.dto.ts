import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsEnum,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';

export enum ExchangeReason {
  DEFECT = 'DEFECT',
  WRONG_PRODUCT = 'WRONG_PRODUCT',
  BUYER_REMORSE = 'BUYER_REMORSE',
  UPGRADE = 'UPGRADE',
}

export class CreateExchangeDto {
  @IsString({ message: 'กรุณาระบุสัญญาเดิม' })
  oldContractId: string;

  @IsString({ message: 'กรุณาระบุสินค้าใหม่' })
  newProductId: string;

  @IsString({ message: 'กรุณาระบุราคา' })
  newPriceId: string;

  @IsNumber({}, { message: 'กรุณาระบุเงินดาวน์' })
  newDownPayment: number;

  @IsNumber({}, { message: 'กรุณาระบุจำนวนงวด' })
  newTotalMonths: number;

  @IsNumber({}, { message: 'กรุณาระบุอัตราดอกเบี้ย' })
  @IsOptional()
  newInterestRate?: number;

  @IsEnum(ExchangeReason, {
    message: 'reason ต้องเป็น DEFECT / WRONG_PRODUCT / BUYER_REMORSE / UPGRADE',
  })
  reason: ExchangeReason;

  /// เมื่อ reason=DEFECT ต้องมีรูปอย่างน้อย 3 รูปเพื่อหลักฐาน
  /// (T5-C10 anti-fraud — ลูกค้าที่อ้าง "defect" บ่อย ๆ แสดงว่าอาจ abuse)
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  @IsOptional()
  defectPhotos?: string[];

  @IsString({ message: 'กรุณาระบุหมายเหตุเป็นข้อความ' })
  @IsOptional()
  notes?: string;
}
