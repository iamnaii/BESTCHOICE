import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BroadcastService } from './broadcast.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('LINE OA - Broadcast')
@ApiBearerAuth('JWT')
@Controller('line-oa/broadcast')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BroadcastController {
  constructor(private broadcastService: BroadcastService) {}

  @Post()
  @Roles('OWNER')
  async sendBroadcast(
    @Body()
    body: {
      type: string;
      text?: string;
      altText?: string;
      contents?: any;
    },
  ) {
    let message: any;
    if (body.type === 'flex' && body.contents) {
      message = {
        type: 'flex',
        altText: body.altText ?? 'ข้อความจาก BESTCHOICE',
        contents: body.contents,
      };
    } else {
      message = { type: 'text', text: body.text ?? '' };
    }
    return this.broadcastService.broadcast(message);
  }

  @Get('stats')
  @Roles('OWNER')
  async getStats() {
    const followers = await this.broadcastService.getFollowerCount();
    return { followers };
  }
}
