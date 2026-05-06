import { IsDateString } from 'class-validator';

export class DailySheetQueryDto {
  @IsDateString()
  date!: string;
}
