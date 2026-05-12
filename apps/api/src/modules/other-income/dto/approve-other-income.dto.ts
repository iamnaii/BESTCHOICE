import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveOtherIncomeDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
