import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto } from './dto/webhook.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Webhooks')
@ApiBearerAuth('JWT')
@Controller('webhooks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class WebhooksController {
  constructor(private webhooksService: WebhooksService) {}

  @Post()
  @ApiOperation({ summary: 'ลงทะเบียน webhook subscription ใหม่' })
  register(
    @Body() dto: CreateWebhookDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.webhooksService.registerWebhook(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'ดูรายการ webhook subscriptions ทั้งหมด' })
  list() {
    return this.webhooksService.listWebhooks();
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดู webhook subscription รวมประวัติการส่ง' })
  findOne(@Param('id') id: string) {
    return this.webhooksService.getWebhook(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'ลบ webhook subscription (soft delete)' })
  remove(@Param('id') id: string) {
    return this.webhooksService.deleteWebhook(id);
  }

  @Post('test/:id')
  @ApiOperation({ summary: 'ส่ง test event ไปยัง webhook URL' })
  sendTest(@Param('id') id: string) {
    return this.webhooksService.sendTestEvent(id);
  }
}
