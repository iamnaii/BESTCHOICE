import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FacebookAppReviewService } from './facebook-app-review.service';
import {
  CreateAdCampaignDto,
  CreateLiveVideoDto,
  PublishVideoDto,
  SendUtilityMessageDto,
  UpdateCampaignStatusDto,
} from './dto/facebook-app-review.dto';

/**
 * FacebookAppReviewController — OWNER-only endpoints used to exercise each
 * Graph API permission BESTCHOICE has requested. Hit each endpoint once from
 * Live Mode; Facebook's App Dashboard will then show the permission as tested
 * within 24 hours.
 *
 * Permission → endpoint map:
 * - pages_show_list               → GET    /facebook/app-review/pages
 * - pages_manage_ads              → GET    /facebook/app-review/promotable-posts
 * - pages_utility_messaging       → POST   /facebook/app-review/utility-message
 * - ads_management                → POST   /facebook/app-review/campaigns
 *                                 → PATCH  /facebook/app-review/campaigns/:id/status
 * - leads_retrieval               → GET    /facebook/app-review/lead-forms
 *                                 → GET    /facebook/app-review/lead-forms/:id/leads
 * - Live Video API                → POST   /facebook/app-review/live-videos
 * - publish_video                 → POST   /facebook/app-review/videos
 */
@Controller('facebook/app-review')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FacebookAppReviewController {
  constructor(private readonly service: FacebookAppReviewService) {}

  @Get('pages')
  @Roles('OWNER')
  async listPages() {
    return this.service.listManagedPages();
  }

  @Post('utility-message')
  @Roles('OWNER')
  async sendUtilityMessage(@Body() dto: SendUtilityMessageDto) {
    return this.service.sendUtilityMessage(dto);
  }

  @Get('promotable-posts')
  @Roles('OWNER')
  async listPromotablePosts() {
    return this.service.listPromotablePosts();
  }

  @Post('campaigns')
  @Roles('OWNER')
  async createCampaign(@Body() dto: CreateAdCampaignDto) {
    return this.service.createAdCampaign(dto);
  }

  @Patch('campaigns/:id/status')
  @Roles('OWNER')
  async updateCampaignStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCampaignStatusDto,
  ) {
    return this.service.updateCampaignStatus(id, dto);
  }

  @Get('lead-forms')
  @Roles('OWNER')
  async listLeadForms() {
    return this.service.listLeadForms();
  }

  @Get('lead-forms/:id/leads')
  @Roles('OWNER')
  async fetchLeads(@Param('id') formId: string) {
    return this.service.fetchLeadsForForm(formId);
  }

  @Post('live-videos')
  @Roles('OWNER')
  async createLiveVideo(@Body() dto: CreateLiveVideoDto) {
    return this.service.createLiveVideo(dto);
  }

  @Post('videos')
  @Roles('OWNER')
  async publishVideo(@Body() dto: PublishVideoDto) {
    return this.service.publishVideo(dto);
  }
}
