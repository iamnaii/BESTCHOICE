import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsEnum,
  Min,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum AssetCategoryDto {
  OFFICE_EQUIPMENT = 'OFFICE_EQUIPMENT',
  BUILDING_IMPROVEMENT = 'BUILDING_IMPROVEMENT',
  OFFICE_FURNITURE = 'OFFICE_FURNITURE',
  VEHICLE = 'VEHICLE',
}

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

  /** Phase A.5c: typed category for precise account code routing */
  @IsOptional()
  @IsEnum(AssetCategoryDto, { message: 'ประเภทสินทรัพย์ไม่ถูกต้อง' })
  assetCategory?: AssetCategoryDto;

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

  /** Phase A.5c: useful life in months (takes precedence over usefulLife when set) */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'อายุการใช้งาน (เดือน) ต้องเป็นตัวเลข' })
  @Min(1, { message: 'อายุการใช้งาน (เดือน) ต้องอย่างน้อย 1 เดือน' })
  usefulLifeMonths?: number;

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

  /** Phase A.5c: proceeds from asset sale (0 = write-off/no proceeds) */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'รายได้จากการจำหน่ายต้องเป็นตัวเลข' })
  @Min(0, { message: 'รายได้จากการจำหน่ายต้องไม่ต่ำกว่า 0' })
  disposalProceeds?: number = 0;

  /** Phase A.5c: cash/bank account to receive proceeds; defaults to 11-1101 */
  @IsOptional()
  @IsString()
  depositAccountCode?: string;
}
