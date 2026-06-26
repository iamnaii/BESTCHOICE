import { IsArray, IsUUID, ArrayMaxSize, ArrayNotEmpty } from 'class-validator';

export class ReadAllDto {
  @IsArray({ message: 'roomIds ต้องเป็น array' })
  @ArrayNotEmpty({ message: 'ต้องระบุอย่างน้อย 1 ห้อง' })
  @ArrayMaxSize(1000, { message: 'มากเกินไป (สูงสุด 1000 ห้อง)' })
  @IsUUID('4', { each: true, message: 'roomId ไม่ถูกต้อง' })
  roomIds: string[];
}
