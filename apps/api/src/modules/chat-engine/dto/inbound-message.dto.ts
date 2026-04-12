import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ChatChannel, MessageType } from '@prisma/client';

export class InboundMessageDto {
  @IsString({ message: 'กรุณาระบุ externalMessageId' })
  externalMessageId: string;

  @IsString({ message: 'กรุณาระบุ externalUserId' })
  externalUserId: string;

  @IsEnum(ChatChannel, { message: 'channel ไม่ถูกต้อง' })
  channel: ChatChannel;

  @IsEnum(MessageType, { message: 'ประเภทข้อความไม่ถูกต้อง' })
  type: MessageType;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @IsOptional()
  @IsString()
  mediaType?: string;
}
