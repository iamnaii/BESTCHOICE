import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AssignmentOutcome } from '@prisma/client';

export class ActionDto {
  @IsEnum(AssignmentOutcome, { message: 'ผลการดำเนินการไม่ถูกต้อง' })
  outcome: AssignmentOutcome;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsString()
  paymentId?: string;

  @IsOptional()
  @IsString()
  lineMessageId?: string;
}
