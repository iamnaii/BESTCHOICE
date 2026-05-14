import { IsDateString } from 'class-validator';

export class DailySheetQueryDto {
  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}
