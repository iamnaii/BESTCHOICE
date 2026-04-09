import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ChatconeService } from './chatcone.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { IsString, IsOptional, IsIn, IsNumber } from 'class-validator';
import { Transform } from 'class-transformer';

export class SendMessageDto {
  @IsString()
  contactId: string;

  @IsString()
  @IsIn(['LINE', 'FACEBOOK', 'TIKTOK'])
  channel: 'LINE' | 'FACEBOOK' | 'TIKTOK';

  @IsString()
  message: string;

  @IsString()
  @IsOptional()
  templateId?: string;
}

@Controller('chatcone')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ChatconeController {
  constructor(private chatconeService: ChatconeService) {}

  /** GET /chatcone/status — ตรวจสอบสถานะการเชื่อมต่อ */
  @Get('status')
  @Roles('OWNER')
  getStatus() {
    return this.chatconeService.getStatus();
  }

  /** POST /chatcone/send — ส่งข้อความหาลูกค้าผ่าน CHATCONE */
  @Post('send')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  sendMessage(@Body() dto: SendMessageDto) {
    return this.chatconeService.sendMessage(dto);
  }

  /** GET /chatcone/conversations — รายการ conversations ล่าสุด */
  @Get('conversations')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  getConversations(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('channel') channel?: string,
    @Query('status') status?: 'OPEN' | 'RESOLVED' | 'ALL',
  ) {
    return this.chatconeService.getConversations({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
      channel,
      status,
    });
  }

  /** GET /chatcone/customers/:contactId/chat — ประวัติแชทของลูกค้า */
  @Get('customers/:contactId/chat')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  getCustomerChat(
    @Param('contactId') contactId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chatconeService.getCustomerChat(
      contactId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 50,
    );
  }

  /** GET /chatcone/contacts/search?phone= — ค้นหา contact จากเบอร์โทร */
  @Get('contacts/search')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  findContact(@Query('phone') phone: string) {
    return this.chatconeService.findContactByPhone(phone);
  }
}
