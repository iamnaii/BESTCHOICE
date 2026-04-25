import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CustomerTagType } from '@prisma/client';

/**
 * Manual tag application by an OWNER / FINANCE_MANAGER.
 *
 * Source is forced to MANUAL server-side — the AUTO source is reserved for the
 * recompute cron and the manual recompute endpoint, never for client requests.
 * BLACKLIST is the only tag that is *exclusively* manual (the auto recompute
 * never applies it).
 */
export class CreateTagDto {
  @IsUUID('4', { message: 'customerId ไม่ถูกต้อง' })
  customerId!: string;

  @IsEnum(CustomerTagType, { message: 'tag ไม่ถูกต้อง' })
  tag!: CustomerTagType;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'reason ยาวเกินไป (จำกัด 200 ตัวอักษร)' })
  reason?: string;
}
