import {
  IsString,
  IsOptional,
  IsIn,
  IsDateString,
  IsNumber,
  IsUUID,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';

class SettlementLineInput {
  @IsUUID('4', { message: 'รหัสเอกสารที่ต้องการเคลียร์ไม่ถูกต้อง' })
  clearedDocumentId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'จำนวนเงินที่จ่ายต้องมากกว่า 0' })
  amountSettled!: number;
}

export class CreateSettlementDto {
  @IsString()
  branchId!: string;

  @IsDateString({}, { message: 'วันที่จ่ายไม่ถูกต้อง' })
  documentDate!: string;

  @IsString()
  @IsOptional()
  vendorName?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsIn([...CASH_ACCOUNT_CODES], { message: 'บัญชีรับเงินไม่ถูกต้อง' })
  depositAccountCode!: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  withholdingTax?: number;

  @IsString()
  @IsOptional()
  @IsIn(['PND3', 'PND53'], { message: 'แบบฟอร์ม WHT ต้องเป็น PND3 หรือ PND53' })
  whtFormType?: string;

  @ValidateNested({ each: true })
  @ArrayMinSize(1, { message: 'ต้องมีรายการอย่างน้อย 1 รายการ' })
  @Type(() => SettlementLineInput)
  lines!: SettlementLineInput[];

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
