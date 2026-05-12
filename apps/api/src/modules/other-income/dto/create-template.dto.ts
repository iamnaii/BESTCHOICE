import { IsArray, IsEnum, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class TemplateItemDto {
  @IsString()
  accountCode!: string;

  @IsString()
  @MaxLength(200)
  description?: string;

  // Allow string or number from form
  quantity!: number | string;
  unitAmount!: number | string;
  discountAmount!: number | string;
  vatPct!: number | string;
  whtPct!: number | string;
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
