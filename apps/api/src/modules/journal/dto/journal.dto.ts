import {
  IsString,
  IsNotEmpty,
  IsDateString,
  IsOptional,
  IsNumber,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class JournalLineDto {
  @IsString({ message: 'กรุณาระบุรหัสบัญชี' })
  @IsNotEmpty({ message: 'กรุณาระบุรหัสบัญชี' })
  accountCode: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber({}, { message: 'ยอดเดบิตต้องเป็นตัวเลข' })
  @Min(0, { message: 'ยอดเดบิตต้องไม่ติดลบ' })
  debit: number = 0;

  @IsNumber({}, { message: 'ยอดเครดิตต้องเป็นตัวเลข' })
  @Min(0, { message: 'ยอดเครดิตต้องไม่ติดลบ' })
  credit: number = 0;
}

export class CreateJournalEntryDto {
  @IsString({ message: 'กรุณาระบุบริษัท' })
  @IsNotEmpty({ message: 'กรุณาระบุบริษัท' })
  companyId: string;

  @IsDateString({}, { message: 'กรุณาระบุวันที่' })
  entryDate: string;

  @IsString({ message: 'กรุณาระบุรายละเอียด' })
  @IsNotEmpty({ message: 'กรุณาระบุรายละเอียด' })
  description: string;

  @IsOptional()
  @IsString()
  referenceType?: string;

  @IsOptional()
  @IsString()
  referenceId?: string;

  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  @ArrayMinSize(2, { message: 'ต้องมีอย่างน้อย 2 รายการ' })
  lines: JournalLineDto[];
}
