import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdsTrackingService } from './ads-tracking.service';
import { AdsPlatform } from '@prisma/client';

@Controller('ads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdsTrackingController {
  constructor(private adsService: AdsTrackingService) {}

  @Get('campaigns')
  @Roles('OWNER')
  async listCampaigns(
    @Query('platform') platform?: AdsPlatform,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adsService.listCampaigns({
      platform,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('campaigns')
  @Roles('OWNER')
  async createCampaign(@Body() body: any) {
    return this.adsService.createCampaign(body);
  }

  @Patch('campaigns/:id')
  @Roles('OWNER')
  async updateCampaign(@Param('id') id: string, @Body() body: any) {
    return this.adsService.updateCampaign(id, body);
  }

  @Get('roi')
  @Roles('OWNER')
  async getROI(
    @Query('platform') platform?: AdsPlatform,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.adsService.getROI({
      platform,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }
}
