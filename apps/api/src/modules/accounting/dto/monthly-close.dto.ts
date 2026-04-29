import { IsInt, Min, Max, IsOptional, IsString, MinLength } from 'class-validator';

export class CloseMonthDto {
  @IsInt({ message: 'ปีต้องเป็นจำนวนเต็ม' })
  @Min(2020)
  year: number;

  @IsInt({ message: 'เดือนต้องเป็น 1-12' })
  @Min(1)
  @Max(12)
  month: number;

  @IsString()
  companyId: string;

  @IsString()
  @IsOptional()
  notes?: string;

  /**
   * T2-C10 — Required only when reopening a CLOSED period that is older than
   * 90 days. Pass the ID / reference number of the board resolution that
   * authorises the retroactive reopen. Ignored for fresh (< 90 days) reopens
   * and for OPEN/REVIEW transitions.
   */
  @IsString()
  @IsOptional()
  boardResolutionId?: string;

  /**
   * F-6-003 — OWNER override required when closing a REVIEW period whose
   * `auditIssues.hasIssues=true`. Must be ≥50 characters explaining the
   * acknowledged issues and rationale. Force close creates an AuditLog
   * with action=`PERIOD_FORCE_CLOSE` for traceability.
   */
  @IsOptional()
  @IsString()
  @MinLength(50, { message: 'forceCloseReason ต้อง ≥50 ตัวอักษร' })
  forceCloseReason?: string;
}
