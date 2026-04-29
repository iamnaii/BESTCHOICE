import { IsInt, IsString, Max, Min, MinLength } from 'class-validator';

/**
 * F-6-004 — Reopening a closed period rewrites filed financial statements,
 * so we require:
 *   - boardResolutionId  (mandatory — reference to the board minute that
 *     authorised the reopen; logged in AuditLog for traceability)
 *   - reason             (≥20 chars — short narrative captured in AuditLog)
 *
 * Caller must be OWNER (enforced at controller level).
 */
export class ReopenPeriodDto {
  @IsString({ message: 'companyId ต้องเป็น string' })
  companyId!: string;

  @IsInt({ message: 'ปีต้องเป็นจำนวนเต็ม' })
  @Min(2020)
  year!: number;

  @IsInt({ message: 'เดือนต้องเป็น 1-12' })
  @Min(1)
  @Max(12)
  month!: number;

  @IsString({ message: 'boardResolutionId ต้องเป็น string' })
  @MinLength(1, { message: 'กรุณาระบุ boardResolutionId' })
  boardResolutionId!: string;

  @IsString({ message: 'reason ต้องเป็น string' })
  @MinLength(20, { message: 'reason ต้อง ≥20 ตัวอักษร' })
  reason!: string;
}
