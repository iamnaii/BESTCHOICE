import { IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * D1.1.5.5 — PUT /settings/petty-cash/custodian payload.
 *
 * `userId` is OPTIONAL — passing `null` (or omitting) clears the seat,
 * which is a legitimate transition (e.g. previous custodian left). When
 * provided it must be a valid UUID + reference a user whose role is on
 * the configured whitelist (validated server-side).
 */
export class AssignPettyCashCustodianDto {
  @IsOptional()
  @IsString({ message: 'companyId ต้องเป็น string UUID' })
  @IsUUID('4', { message: 'companyId ต้องเป็น UUID' })
  companyId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'userId ต้องเป็น UUID หรือ null เพื่อยกเลิกผู้ดูแล' })
  userId?: string | null;
}
