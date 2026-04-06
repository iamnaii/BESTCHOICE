import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFixedAssetDto {
  @IsString({ message: 'กรุณาระบุรหัสสินทรัพย์' })
  @IsNotEmpty({ message: 'กรุณาระบุรหัสสินทรัพย์' })
  assetCode: string;

  @IsString({ message: 'กรุณาระบุชื่อสินทรัพย์' })
  @IsNotEmpty({ message: 'กรุณาระบุชื่อสินทรัพย์' })
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'กรุณาระบุราคาทุน' })
  @Min(0, { message: 'ราคาทุนต้องไม่ต่ำกว่า 0' })
  costValue: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  salvageValue?: number = 0;

  @Type(() => Number)
  @IsNumber({}, { message: 'กรุณาระบุอายุการใช้งาน (ปี)' })
  @Min(1, { message: 'อายุการใช้งานต้องอย่างน้อย 1 ปี' })
  usefulLife: number;

  @IsDateString({}, { message: 'กรุณาระบุวันที่ซื้อ' })
  purchaseDate: string;

  @IsOptional()
  @IsString()
  depreciationAccountCode?: string = '53-1601';

  @IsOptional()
  @IsString()
  accumulatedAccountCode?: string = '12-2102';
}

export class UpdateFixedAssetDto {
  @IsOptional()
  @IsString()
  assetCode?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costValue?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  salvageValue?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  usefulLife?: number;

  @IsOptional()
  @IsDateString()
  purchaseDate?: string;

  @IsOptional()
  @IsString()
  depreciationAccountCode?: string;

  @IsOptional()
  @IsString()
  accumulatedAccountCode?: string;
}

export class DisposeAssetDto {
  @IsOptional()
  @IsString()
  disposalNote?: string;
}
