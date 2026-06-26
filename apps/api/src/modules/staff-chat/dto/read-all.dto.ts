import { IsArray, IsUUID, ArrayMaxSize } from 'class-validator';

export class ReadAllDto {
  @IsArray({ message: 'roomIds ต้องเป็น array' })
  @ArrayMaxSize(1000, { message: 'มากเกินไป (สูงสุด 1000 ห้อง)' })
  @IsUUID('4', { each: true, message: 'roomId ไม่ถูกต้อง' })
  roomIds: string[];
}
