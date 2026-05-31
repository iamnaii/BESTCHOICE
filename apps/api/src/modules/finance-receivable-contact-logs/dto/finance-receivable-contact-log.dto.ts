import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { FinanceContactChannel, FinanceContactResult } from '@prisma/client';

export class CreateFinanceContactLogDto {
  @IsOptional()
  @IsUUID('4', { message: 'financeCompanyContactId ต้องเป็น UUID' })
  financeCompanyContactId?: string;

  @IsOptional()
  @IsEnum(FinanceContactChannel, { message: 'channel ไม่ถูกต้อง' })
  channel?: FinanceContactChannel;

  @IsEnum(FinanceContactResult, { message: 'result ไม่ถูกต้อง' })
  result!: FinanceContactResult;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsDateString({}, { message: 'contactedAt ต้องเป็นวันที่ ISO' })
  contactedAt?: string;

  @IsOptional()
  @IsDateString({}, { message: 'promisedDate ต้องเป็นวันที่ ISO' })
  promisedDate?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'promisedAmount ต้องเป็นตัวเลข' })
  @IsPositive({ message: 'promisedAmount ต้องมากกว่า 0' })
  promisedAmount?: number;
}

export class UpdateFinanceContactLogDto extends PartialType(
  CreateFinanceContactLogDto,
) {}
