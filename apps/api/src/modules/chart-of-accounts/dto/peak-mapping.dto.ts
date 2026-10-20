import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
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

/**
 * FINANCE mapping v5 (ฝ่ายบัญชี 19/10/2569): where the PEAK sub-account code
 * ("รหัสบัญชีย่อย") of a journal line comes from at export time.
 *   none    — account has no sub-account in PEAK
 *   fixed   — always the same code, stored in `peakSubCode` (e.g. ADV001, CSH002)
 *   contact — the contact's PEAK code (Contact.peakContactCode), resolved per line
 *   bank    — the bank-account sub-code, resolved per line
 *   cashbox — the cash-holder sub-code, resolved per line
 * Only `fixed` carries a value in `peakSubCode`; the other dynamic sources are
 * resolved by the export rules (follow-up work) and must store null.
 */
export const PEAK_SUB_CODE_SOURCES = ['none', 'fixed', 'contact', 'bank', 'cashbox'] as const;
export type PeakSubCodeSource = (typeof PEAK_SUB_CODE_SOURCES)[number];

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

  /**
   * Omitted = leave the stored sub-code untouched (so the older UI that only
   * sends `peakCode` never wipes sub-codes). Null/"" = clear.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'รหัสย่อย PEAK ยาวไม่เกิน 20 ตัวอักษร' })
  @Matches(PEAK_CODE_RE, {
    message: 'รหัสย่อย PEAK ต้องเป็นตัวอักษร ตัวเลข ขีดกลาง ขีดล่าง หรือจุด',
  })
  peakSubCode?: string | null;

  /** Omitted = leave the stored source untouched. */
  @IsOptional()
  @IsIn(PEAK_SUB_CODE_SOURCES, {
    message: 'แหล่งรหัสย่อยต้องเป็น none / fixed / contact / bank / cashbox',
  })
  peakSubCodeSource?: PeakSubCodeSource;
}

export class UpdatePeakMappingDto {
  @IsArray()
  @ArrayMaxSize(500, { message: 'อัปเดตได้สูงสุด 500 รายการต่อครั้ง' })
  @ValidateNested({ each: true })
  @Type(() => PeakMappingItemDto)
  mappings!: PeakMappingItemDto[];
}
