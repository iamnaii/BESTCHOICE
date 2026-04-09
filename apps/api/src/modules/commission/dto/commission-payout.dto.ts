import { IsString, IsOptional, IsEnum, MaxLength } from 'class-validator';

export enum PayoutStatusDto {
  DRAFT = 'DRAFT',
  APPROVED = 'APPROVED',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

export class GeneratePayoutDto {
  @IsString({ message: 'กรุณาระบุเดือน (YYYY-MM)' })
  period: string; // "YYYY-MM"

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ApprovePayoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
