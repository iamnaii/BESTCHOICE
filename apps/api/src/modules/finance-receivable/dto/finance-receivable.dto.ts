import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsDateString,
  Min,
} from 'class-validator';
import { FinanceReceivableStatus } from '@prisma/client';

export class RecordReceiveDto {
  @IsNumber()
  @Min(0.01)
  receivedAmount: number;

  @IsDateString()
  receivedDate: string;

  @IsOptional()
  @IsString()
  bankRef?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateFinanceReceivableDto {
  @IsOptional()
  @IsString()
  financeRefNumber?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  commissionRate?: number;

  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @IsOptional()
  @IsEnum(FinanceReceivableStatus)
  status?: FinanceReceivableStatus;

  @IsOptional()
  @IsString()
  note?: string;
}
