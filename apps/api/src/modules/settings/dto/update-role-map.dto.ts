import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateRoleMapDto {
  @IsOptional()
  @IsString({ message: 'รหัสบัญชีต้องเป็นข้อความ' })
  @MaxLength(20, { message: 'รหัสบัญชีต้องไม่เกิน 20 ตัวอักษร' })
  accountCode?: string;

  @IsOptional()
  @IsInt({ message: 'ลำดับความสำคัญต้องเป็นเลขจำนวนเต็ม' })
  @Min(1, { message: 'ลำดับความสำคัญต้องมากกว่า 0' })
  priority?: number;

  @IsOptional()
  @IsBoolean({ message: 'สถานะใช้งานต้องเป็น true/false' })
  isActive?: boolean;

  /**
   * Free-text note shown in the admin UI alongside the role mapping.
   *
   * PDPA / Privacy notice (S5): this field is mirrored into the
   * `AuditLog.oldValue/newValue` JSON columns whenever the row changes
   * (see `AccountRoleService.update` → `audit.log`). Audit logs are
   * retained for 7 years and surfaced via the global audit-log feed
   * — they are NOT a place to store customer phone numbers, ID cards,
   * email addresses, or any other PII. Keep the note to operational
   * intent only (e.g. "secondary mapping for FY2026 fallback").
   *
   * The 500-char `@MaxLength` caps storage size to prevent abuse of the
   * audit-log JSON column for log-injection / oversized payloads.
   */
  @IsOptional()
  @IsString({ message: 'หมายเหตุต้องเป็นข้อความ' })
  @MaxLength(500, { message: 'หมายเหตุต้องไม่เกิน 500 ตัวอักษร' })
  note?: string | null;
}
