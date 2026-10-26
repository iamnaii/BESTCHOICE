import { IsOptional, IsString, Matches } from 'class-validator';

export class RecurringBillsQueryDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'เดือนต้องเป็นรูปแบบ YYYY-MM' })
  month!: string;

  @IsOptional()
  @IsString()
  branchId?: string;
}
