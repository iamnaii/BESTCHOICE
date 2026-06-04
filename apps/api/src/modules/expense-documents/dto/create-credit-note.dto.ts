import {
  IsString,
  IsOptional,
  IsIn,
  IsDateString,
  IsUUID,
  IsArray,
  ArrayMinSize,
  MinLength,
  MaxLength,
  Matches,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';
import { ExpenseLineInput } from './expense-line-input.dto';

export const CREDIT_NOTE_MODES = ['LINKED', 'STANDALONE'] as const;
export type CreditNoteMode = (typeof CREDIT_NOTE_MODES)[number];

export class CreateCreditNoteDto {
  @IsString()
  branchId!: string;

  @IsDateString({}, { message: 'วันที่ใบกำกับไม่ถูกต้อง' })
  documentDate!: string;

  /**
   * C4 · 2-Mode UX.
   * - `LINKED` (default): reverses a specific source EX document. Requires
   *   `originalDocumentId`. Server enforces cap, branch match, status, no-WHT.
   * - `STANDALONE`: free-form refund / supplier credit with no source FK.
   *   Requires `vendorName`. Skips cap + source lookup.
   *
   * Defaults to LINKED so legacy callers (web form before C4.1) work unchanged.
   */
  @IsString()
  @IsIn([...CREDIT_NOTE_MODES], { message: 'โหมดใบลดหนี้ต้องเป็น LINKED หรือ STANDALONE' })
  @IsOptional()
  mode?: CreditNoteMode;

  // LINKED-only: required when mode === 'LINKED' (default).
  @ValidateIf((o) => (o.mode ?? 'LINKED') === 'LINKED')
  @IsUUID('4', { message: 'รหัสเอกสารต้นฉบับไม่ถูกต้อง' })
  originalDocumentId?: string;

  // STANDALONE-only: required when mode === 'STANDALONE'.
  @ValidateIf((o) => o.mode === 'STANDALONE')
  @IsString()
  @MinLength(1, { message: 'กรุณาระบุชื่อผู้ขาย' })
  @MaxLength(255)
  vendorName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  vendorTaxId?: string;

  /**
   * Party-master link (Phase 3 P3). Durable FK to the Supplier behind
   * `vendorName` (STANDALONE mode). Optional.
   */
  @IsString()
  @IsOptional()
  vendorSupplierId?: string;

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

  // Refund-account: required when original was POSTED + already paid (LINKED)
  // or when STANDALONE CN involves actual cash refund.
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
