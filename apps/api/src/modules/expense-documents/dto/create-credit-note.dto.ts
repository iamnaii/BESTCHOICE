import {
  IsString,
  IsOptional,
  IsIn,
  IsDateString,
  IsNumber,
  Min,
  IsUUID,
  MinLength,
} from 'class-validator';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';

export class CreateCreditNoteDto {
  @IsString()
  branchId!: string;

  @IsDateString({}, { message: 'วันที่ใบกำกับไม่ถูกต้อง' })
  documentDate!: string;

  @IsUUID('4', { message: 'รหัสเอกสารต้นฉบับไม่ถูกต้อง' })
  originalDocumentId!: string;

  @IsString()
  @MinLength(3, { message: 'เหตุผลต้องมีอย่างน้อย 3 ตัวอักษร' })
  reason!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'จำนวนเงินต้องมากกว่า 0' })
  subtotal!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  vatAmount?: number;

  // Refund-account: required when original was POSTED + already paid
  @IsString()
  @IsOptional()
  @IsIn([...CASH_ACCOUNT_CODES], { message: 'บัญชีรับเงินคืนไม่ถูกต้อง' })
  depositAccountCode?: string;

  @IsString()
  @IsOptional()
  receiptImageUrl?: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsOptional()
  fromTemplateId?: string;
}
