import { IsDateString, IsNotEmpty } from 'class-validator';

export class ExportJournalEntriesDto {
  @IsDateString()
  @IsNotEmpty({ message: 'กรุณาระบุวันที่เริ่มต้น' })
  startDate: string;

  @IsDateString()
  @IsNotEmpty({ message: 'กรุณาระบุวันที่สิ้นสุด' })
  endDate: string;
}
