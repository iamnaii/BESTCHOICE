import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { LineOaService } from './line-oa.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CampaignSendDto } from './dto/campaign-send.dto';

@ApiTags('LINE OA - Campaigns')
@ApiBearerAuth('JWT')
@Controller('line-oa')
export class LineOaCampaignController {
  constructor(private lineOaService: LineOaService) {}

  // ─── Bulk Campaign ───────────────────────────────────

  @Post('campaign/send')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  @Throttle({ short: { ttl: 600000, limit: 1 } }) // Max 1 campaign per 10 minutes
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async sendCampaign(@Body() dto: CampaignSendDto) {
    const result = await this.lineOaService.sendCampaign(dto);
    return {
      success: true,
      message: 'เริ่มส่งแคมเปญแล้ว ระบบกำลังดำเนินการส่งข้อความ',
      ...result,
    };
  }

  @Get('campaign/history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async getCampaignHistory() {
    const history = await this.lineOaService.getCampaignHistory();
    return { data: history };
  }
}
