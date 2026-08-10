import {
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EquityTxnType } from '@prisma/client';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';

export class EquityLineDto {
  @IsUUID('4', { message: 'กรุณาเลือกผู้ถือหุ้น' })
  shareholderId!: string;

  @IsNumber({}, { message: 'จำนวนเงินไม่ถูกต้อง' })
  @Min(0.01, { message: 'จำนวนเงินต้องมากกว่า 0' })
  amount!: number;

  @IsOptional()
  @IsNumber({}, { message: 'ส่วนเกินมูลค่าหุ้นไม่ถูกต้อง' })
  @Min(0)
  premium?: number;

  @IsOptional()
  @IsNumber({}, { message: 'จำนวนชำระจริงไม่ถูกต้อง' })
  @Min(0)
  paid?: number;

  /** DIV_PAY เท่านั้น — ไม่ส่ง = server คำนวณ default ตามประเภทผู้ถือหุ้น */
  @IsOptional()
  @IsNumber({}, { message: 'WHT ไม่ถูกต้อง' })
  @Min(0)
  wht?: number;
}

export class CreateEquityDocumentDto {
  @IsEnum(EquityTxnType, { message: 'ประเภทธุรกรรมไม่ถูกต้อง' })
  txnType!: EquityTxnType;

  @IsDateString({}, { message: 'วันที่ทำรายการไม่ถูกต้อง' })
  txnDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'คำอธิบายยาวเกินไป (สูงสุด 500 ตัวอักษร)' })
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'เลขที่มติยาวเกินไป' })
  resolutionNo?: string;

  @IsOptional()
  @IsDateString({}, { message: 'วันที่มติไม่ถูกต้อง' })
  resolutionDate?: string;

  @IsOptional()
  @IsIn([...CASH_ACCOUNT_CODES], {
    message: 'ช่องทางเงินต้องเป็นบัญชีเงินสด/ธนาคาร FINANCE ที่กำหนด',
  })
  paymentAccountCode?: string;

  @IsOptional()
  @IsString()
  paAccountCode?: string;

  @IsOptional()
  @IsNumber({}, { message: 'ยอดปรับปรุงไม่ถูกต้อง' })
  @Min(0.01, { message: 'ยอดปรับปรุงต้องมากกว่า 0' })
  paAmount?: number;

  @IsOptional()
  @IsIn(['DR_OTHER_CR_RE', 'DR_RE_CR_OTHER'], { message: 'ทิศทางปรับปรุงไม่ถูกต้อง' })
  paDirection?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EquityLineDto)
  lines!: EquityLineDto[];
}
