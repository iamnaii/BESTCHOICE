import { IsUUID, IsString, IsArray, ArrayMaxSize, IsOptional, MinLength } from 'class-validator';

export class SubmitExchangeRequestDto {
  @IsUUID('all', { message: 'oldContractId ต้องเป็น UUID' })
  oldContractId!: string;

  @IsUUID('all', { message: 'oldProductId ต้องเป็น UUID' })
  oldProductId!: string;

  @IsUUID('all', { message: 'newProductId ต้องเป็น UUID' })
  newProductId!: string;

  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'หมายเหตุอย่างน้อย 3 ตัวอักษร' })
  conditionNote?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5, { message: 'ภาพถ่ายไม่เกิน 5 รูป' })
  @IsString({ each: true })
  conditionPhotos?: string[];
}
