import { IsIn, IsOptional } from 'class-validator';

/**
 * Audit summary period selector — week | month.
 */
export class ComplianceAuditQueryDto {
  @IsOptional()
  @IsIn(['week', 'month'], { message: 'period ต้องเป็น week หรือ month' })
  period?: 'week' | 'month';
}
