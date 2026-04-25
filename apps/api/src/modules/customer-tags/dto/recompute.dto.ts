import { IsOptional, IsUUID } from 'class-validator';

/**
 * Manual recompute trigger. customerId optional — when omitted, the controller
 * dispatches `recomputeAll` (admin-only path).
 */
export class RecomputeDto {
  @IsOptional()
  @IsUUID('4', { message: 'customerId ไม่ถูกต้อง' })
  customerId?: string;
}
