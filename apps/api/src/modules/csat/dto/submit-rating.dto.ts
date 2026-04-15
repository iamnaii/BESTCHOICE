import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class SubmitRatingDto {
  @IsUUID('4', { message: 'กรุณาระบุรหัส room ที่ถูกต้อง' })
  roomId: string;

  @IsInt({ message: 'กรุณาระบุคะแนนเป็นจำนวนเต็ม' })
  @Min(1, { message: 'คะแนนต้องอยู่ระหว่าง 1-5' })
  @Max(5, { message: 'คะแนนต้องอยู่ระหว่าง 1-5' })
  rating: number;

  @IsOptional()
  @IsString({ message: 'กรุณาระบุข้อเสนอแนะเป็นข้อความ' })
  feedbackText?: string;
}
