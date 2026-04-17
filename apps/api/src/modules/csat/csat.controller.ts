import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CsatService } from './csat.service';
import { SubmitRatingDto } from './dto/submit-rating.dto';

@Controller('csat')
export class CsatController {
  constructor(private csatService: CsatService) {}

  /**
   * POST /api/csat/submit — public endpoint (customer access via LIFF)
   * No JwtAuthGuard — customers submit ratings without staff login
   */
  @Post('submit')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async submitRating(@Body() dto: SubmitRatingDto) {
    return this.csatService.submitRating(dto);
  }

  /**
   * GET /api/csat/stats — OWNER only, aggregate CSAT ratings
   */
  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async getStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.csatService.getStats(start, end);
  }
}
