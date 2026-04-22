import { IsDateString } from 'class-validator';

export class ScheduleApplicationDto {
  @IsDateString({}, { message: 'กรุณาระบุวัน-เวลานัดหมายในรูปแบบ ISO 8601' })
  scheduledAt!: string;
}
