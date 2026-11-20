import { IsBoolean, IsUUID } from 'class-validator';
export class ChatReadinessDto {
  @IsBoolean({ message: 'กรุณาระบุสถานะพร้อมรับแชท' }) ready!: boolean;
}
export class ChatReadinessHeartbeatDto {
  @IsUUID(undefined, { message: 'สถานะคิวไม่ถูกต้อง กรุณาโหลดใหม่' }) generation!: string;
}
