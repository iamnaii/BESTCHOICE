import { IsUUID } from 'class-validator';

export class AttachCreditMessageDto {
  @IsUUID('4', { message: 'รหัสข้อความไม่ถูกต้อง' })
  messageId: string;
}
