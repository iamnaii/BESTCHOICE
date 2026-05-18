import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * P3-SP3: PEAK external code mapping per ChartOfAccount.
 *
 * peakCode regex `/^[A-Za-z0-9\-_.]{0,20}$/` matches PEAK's external account
 * code format (alphanumeric + dash/underscore/dot, max 20). Null or omitted
 * means the account is intentionally unmapped — the export endpoint will skip
 * journal lines whose account has no PEAK code.
 *
 * NB: Empty string is rejected here so the service can rely on `null vs string`
 * to distinguish "unmapped" from "deliberately empty value". UI must convert
 * empty input to `null`.
 */
const PEAK_CODE_RE = /^[A-Za-z0-9\-_.]{0,20}$/;

export class PeakMappingItemDto {
  @IsUUID('all', { message: 'รหัสบัญชีในระบบไม่ถูกต้อง' })
  id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'รหัส PEAK ยาวไม่เกิน 20 ตัวอักษร' })
  @Matches(PEAK_CODE_RE, {
    message: 'รหัส PEAK ต้องเป็นตัวอักษร ตัวเลข ขีดกลาง ขีดล่าง หรือจุด',
  })
  peakCode!: string | null;
}

export class UpdatePeakMappingDto {
  @IsArray()
  @ArrayMaxSize(500, { message: 'อัปเดตได้สูงสุด 500 รายการต่อครั้ง' })
  @ValidateNested({ each: true })
  @Type(() => PeakMappingItemDto)
  mappings!: PeakMappingItemDto[];
}
