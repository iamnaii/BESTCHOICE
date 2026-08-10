// @nestjs/mapped-types ไม่อยู่ใน dependencies ของ apps/api/package.json (เช็คแล้ว — เป็น
// transitive dep ของแพ็กเกจอื่นเท่านั้น) — จึงเขียน DTO นี้เองแทนการใช้ PartialType ทุก field
// เป็น optional ตามความหมายของ partial update (ห้ามเพิ่ม dependency ใหม่)
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EquityTxnType } from '@prisma/client';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';
import { EquityLineDto } from './create-equity-document.dto';

export class UpdateEquityDocumentDto {
  @IsOptional()
  @IsEnum(EquityTxnType, { message: 'ประเภทธุรกรรมไม่ถูกต้อง' })
  txnType?: EquityTxnType;

  @IsOptional()
  @IsDateString({}, { message: 'วันที่ทำรายการไม่ถูกต้อง' })
  txnDate?: string;

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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EquityLineDto)
  lines?: EquityLineDto[];
}
