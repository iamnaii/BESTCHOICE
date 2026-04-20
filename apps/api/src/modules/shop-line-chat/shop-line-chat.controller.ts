import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';
import { ShopLineChatService } from './shop-line-chat.service';

export class ContactInquiryDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุชื่อ' })
  @MaxLength(100, { message: 'ชื่อต้องไม่เกิน 100 ตัวอักษร' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเบอร์โทรศัพท์' })
  @MaxLength(20, { message: 'เบอร์โทรศัพท์ต้องไม่เกิน 20 ตัวอักษร' })
  phone: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุข้อความ' })
  @MaxLength(1000, { message: 'ข้อความต้องไม่เกิน 1,000 ตัวอักษร' })
  message: string;
}

@Controller('shop/contact')
@UseGuards(ShopBotDefenseGuard)
export class ShopLineChatController {
  constructor(private readonly shopLineChatService: ShopLineChatService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async submitContactInquiry(@Body() dto: ContactInquiryDto): Promise<{ success: boolean }> {
    await this.shopLineChatService.notifyStaffOfInquiry({
      name: dto.name,
      phone: dto.phone,
      message: dto.message,
    });
    return { success: true };
  }
}
