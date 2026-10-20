import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * mapping v5 (ฝ่ายบัญชี 19/10/2569): PEAK contact code ("รหัสผู้ติดต่อ" C00xxx) —
 * the per-line sub-code of receivable / payable lines in the PEAK export.
 * Same character rules as a PEAK account code. Empty / null clears it.
 */
export class SetPeakContactCodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'รหัสผู้ติดต่อ PEAK ยาวไม่เกิน 20 ตัวอักษร' })
  @Matches(/^[A-Za-z0-9\-_.\s]{0,20}$/, {
    message: 'รหัสผู้ติดต่อ PEAK ต้องเป็นตัวอักษร ตัวเลข ขีดกลาง ขีดล่าง หรือจุด',
  })
  peakContactCode?: string | null;
}
