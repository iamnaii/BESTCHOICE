import { IsEnum, IsUUID } from 'class-validator';
import { ExternalFinanceDocSlot } from '@prisma/client';

export class FileFromMessageDto {
  @IsUUID('4', { message: 'รหัสข้อความไม่ถูกต้อง' }) messageId: string;
  @IsEnum(ExternalFinanceDocSlot, { message: 'กรุณาเลือกช่องเอกสาร' }) slot: ExternalFinanceDocSlot;
}
export class FileUploadFieldsDto {
  @IsEnum(ExternalFinanceDocSlot, { message: 'กรุณาเลือกช่องเอกสาร' }) slot: ExternalFinanceDocSlot;
}
export class OcrFromMessageDto {
  @IsUUID('4', { message: 'messageId ไม่ถูกต้อง' }) messageId!: string;
}
