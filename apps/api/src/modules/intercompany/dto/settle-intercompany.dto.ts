import {
  IsString,
  IsOptional,
  IsNumber,
  IsPositive,
  IsUUID,
  Matches,
  MaxLength,
  IsDateString,
} from 'class-validator';

export class SettleIntercompanyDto {
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'จำนวนเงินไม่ถูกต้อง' })
  @IsPositive({ message: 'จำนวนเงินต้องมากกว่า 0' })
  amount!: number;

  @IsString({ message: 'กรุณาระบุเลขที่อ้างอิง' })
  @MaxLength(50)
  reference!: string;

  /**
   * SP2: optional InterCompanyTransaction.id — when provided, settle() posts
   * the JE Dr 21-1101 + Dr 21-1102 / Cr <depositAccountCode>, updates the txn
   * to RECONCILED, and stores journalEntryId.
   */
  @IsOptional()
  @IsUUID('4', { message: 'กรุณาระบุรหัสรายการที่ถูกต้อง' })
  transactionId?: string;

  /**
   * SP2: bank/cash account to credit when posting settlement JE.
   * Defaults to 11-1201 (KBank). Must match one of the 6 cash account codes.
   */
  @IsOptional()
  @IsString()
  @Matches(/^11-1[12]0[123]$/, { message: 'รหัสบัญชีเงินสด/ธนาคารไม่ถูกต้อง' })
  depositAccountCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsDateString()
  paidDate?: string;
}
