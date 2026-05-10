import {
  IsString,
  IsOptional,
  IsIn,
  IsDateString,
  IsUUID,
  IsArray,
  ArrayMinSize,
  MinLength,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';
import { ExpenseLineInput } from './expense-line-input.dto';

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

  // Server computes totals from lines — subtotal/vatAmount kept optional for
  // backward-compat but are IGNORED in createCreditNote (server re-derives them).
  @IsString()
  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'จำนวนเงิน subtotal ไม่ถูกต้อง' })
  subtotal?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'จำนวนเงิน vatAmount ไม่ถูกต้อง' })
  vatAmount?: string;

  /** CN expense lines — server re-computes totals from these. */
  @IsArray()
  @ArrayMinSize(1, { message: 'ต้องมีรายการบัญชีอย่างน้อย 1 บรรทัด' })
  @ValidateNested({ each: true })
  @Type(() => ExpenseLineInput)
  lines!: ExpenseLineInput[];

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
