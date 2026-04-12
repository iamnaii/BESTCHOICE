import { IsEnum, IsString, IsOptional, IsArray } from 'class-validator';
import { ChatChannel } from '@prisma/client';

export class CreateBroadcastDto {
  @IsEnum(ChatChannel, { message: 'กรุณาระบุช่องทางที่ถูกต้อง' })
  channel: ChatChannel;

  @IsString({ message: 'กรุณาระบุข้อความ' })
  message: string;

  @IsOptional()
  @IsString({ message: 'URL สื่อต้องเป็นข้อความ' })
  mediaUrl?: string;

  @IsOptional()
  @IsArray({ message: 'รายการลูกค้าต้องเป็น array' })
  @IsString({ each: true, message: 'รหัสลูกค้าแต่ละรายการต้องเป็นข้อความ' })
  customerIds?: string[];

  @IsOptional()
  @IsArray({ message: 'แท็กต้องเป็น array' })
  @IsString({ each: true, message: 'แท็กแต่ละรายการต้องเป็นข้อความ' })
  filterTags?: string[];
}
