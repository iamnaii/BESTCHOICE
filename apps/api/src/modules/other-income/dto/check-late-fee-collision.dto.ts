import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/**
 * DTO for the late-fee collision check (Fix C14).
 *
 * Used by the OI Entry page to surface a soft warning when:
 *   - the user is picking 42-1103 (ค่าปรับชำระล่าช้า) as an income account
 *   - AND the same customer already has Payment.lateFee > 0 for the issue month
 *
 * Non-blocking — the warning is purely informational so the operator can
 * confirm the booking is intentional and not a duplicate.
 */
class CheckCollisionItemDto {
  @IsInt()
  lineNo!: number;

  @IsString()
  accountCode!: string;
}

export class CheckLateFeeCollisionDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsDateString({}, { message: 'รูปแบบวันที่ออกเอกสารไม่ถูกต้อง' })
  issueDate!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'ต้องมีรายการอย่างน้อย 1 รายการ' })
  @ValidateNested({ each: true })
  @Type(() => CheckCollisionItemDto)
  items!: CheckCollisionItemDto[];
}
