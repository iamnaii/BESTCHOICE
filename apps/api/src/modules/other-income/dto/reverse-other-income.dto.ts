import { IsEnum, IsString, MinLength } from 'class-validator';
import { OtherIncomeReverseReason } from '@prisma/client';

export class ReverseOtherIncomeDto {
  @IsEnum(OtherIncomeReverseReason)
  reason!: OtherIncomeReverseReason;

  @IsString()
  @MinLength(5)
  note!: string;
}
