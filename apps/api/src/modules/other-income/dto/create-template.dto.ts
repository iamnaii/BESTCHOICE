import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class TemplateItemDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาเลือกบัญชี' })
  accountCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @Type(() => Number)
  @IsNumber({ allowNaN: false }, { message: 'จำนวนต้องเป็นตัวเลข' })
  @Min(0, { message: 'จำนวนต้องไม่ติดลบ' })
  quantity!: number;

  @Type(() => Number)
  @IsNumber({ allowNaN: false }, { message: 'ราคา/หน่วยต้องเป็นตัวเลข' })
  @Min(0, { message: 'ราคา/หน่วยต้องไม่ติดลบ' })
  unitAmount!: number;

  @Type(() => Number)
  @IsNumber({ allowNaN: false })
  @Min(0)
  discountAmount!: number;

  @Type(() => Number)
  @IsNumber({ allowNaN: false })
  @Min(0)
  vatPct!: number;

  @Type(() => Number)
  @IsNumber({ allowNaN: false })
  @Min(0)
  whtPct!: number;
}

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุชื่อ Template' })
  @MaxLength(100)
  name!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateItemDto)
  items!: TemplateItemDto[];

  @IsEnum(['EXCLUSIVE', 'INCLUSIVE'])
  priceType!: 'EXCLUSIVE' | 'INCLUSIVE';
}

export class CreateTemplateFromDocDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุชื่อ Template' })
  @MaxLength(100)
  name!: string;
}
