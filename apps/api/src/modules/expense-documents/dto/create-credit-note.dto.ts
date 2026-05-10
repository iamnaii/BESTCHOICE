import {
  IsString,
  IsOptional,
  IsIn,
  IsDateString,
  IsUUID,
  MinLength,
  Matches,
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

  // Accept Decimal string from server-side /preview-je — never user-keyed,
  // so parseFloat/IsNumber conversion risk is eliminated at the money boundary.
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'จำนวนเงิน subtotal ไม่ถูกต้อง' })
  subtotal!: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'จำนวนเงิน vatAmount ไม่ถูกต้อง' })
  vatAmount?: string;

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
