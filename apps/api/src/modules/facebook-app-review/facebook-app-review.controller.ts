import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FacebookAppReviewService } from './facebook-app-review.service';
import {
  CreateAdCampaignDto,
  CreateLiveVideoDto,
  HideCommentDto,
  LikeCommentDto,
  PublishVideoDto,
  ReplyToCommentDto,
  SendStandardMessageDto,
  SendTemplateMessageDto,
  SubscribePageWebhooksDto,
  UpdateCampaignStatusDto,
} from './dto/facebook-app-review.dto';

/**
 * FacebookAppReviewController — OWNER-only endpoints used to exercise each
 * Graph API permission BESTCHOICE has requested. Hit each endpoint once from
 * Live Mode; Facebook's App Dashboard will then show the permission as tested
 * within 24 hours.
 *
 * Permission → endpoint map (post 2026-05-09 resubmit scope):
 * - pages_show_list               → GET    /facebook/app-review/pages
 * - pages_messaging (RESPONSE)    → POST   /facebook/app-review/messenger-message
 * - pages_manage_metadata         → POST   /facebook/app-review/subscribe-webhooks
 * - pages_utility_messaging       → POST   /facebook/app-review/template-message
 * - pages_read_engagement         → GET    /facebook/app-review/page-posts
 *                                 → GET    /facebook/app-review/post-comments
 * - pages_manage_engagement       → POST   /facebook/app-review/comment-reply
 *                                 → POST   /facebook/app-review/comment-like
 *                                 → POST   /facebook/app-review/comment-hide
 * - ads_read                      → GET    /facebook/app-review/insights
 * - business_management           → GET    /facebook/app-review/businesses
 *                                 → GET    /facebook/app-review/businesses/:id/ad-accounts
 *                                 → GET    /facebook/app-review/businesses/:id/pages
 *
 * Legacy (kept for back-compat / future resubmit, not in current request):
 * - pages_manage_ads              → GET    /facebook/app-review/promotable-posts
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

  // ─── pages_show_list ─────────────────────────────────────────────────────
  @Get('pages')
  @Roles('OWNER')
  async listPages() {
    return this.service.listManagedPages();
  }

  // ─── pages_messaging ─────────────────────────────────────────────────────
  @Post('messenger-message')
  @Roles('OWNER')
  async sendStandardMessage(@Body() dto: SendStandardMessageDto) {
    return this.service.sendStandardMessage(dto);
  }

  // ─── pages_manage_metadata ───────────────────────────────────────────────
  @Post('subscribe-webhooks')
  @Roles('OWNER')
  async subscribePageWebhooks(@Body() dto: SubscribePageWebhooksDto) {
    return this.service.subscribePageWebhooks(dto);
  }

  // ─── pages_utility_messaging ─────────────────────────────────────────────
  @Post('template-message')
  @Roles('OWNER')
  async sendTemplateMessage(@Body() dto: SendTemplateMessageDto) {
    return this.service.sendTemplateMessage(dto);
  }

  // ─── pages_read_engagement ───────────────────────────────────────────────
  @Get('page-posts')
  @Roles('OWNER')
  async listPagePosts() {
    return this.service.listPagePosts();
  }

  @Get('post-comments/:postId')
  @Roles('OWNER')
  async listPostComments(@Param('postId') postId: string) {
    return this.service.listPostComments({ postId });
  }

  // ─── pages_manage_engagement ─────────────────────────────────────────────
  @Post('comment-reply')
  @Roles('OWNER')
  async replyToComment(@Body() dto: ReplyToCommentDto) {
    return this.service.replyToComment(dto);
  }

  @Post('comment-like')
  @Roles('OWNER')
  async likeComment(@Body() dto: LikeCommentDto) {
    return this.service.likeComment(dto);
  }

  @Post('comment-hide')
  @Roles('OWNER')
  async hideComment(@Body() dto: HideCommentDto) {
    return this.service.hideComment(dto);
  }

  // ─── ads_read ────────────────────────────────────────────────────────────
  @Get('insights')
  @Roles('OWNER')
  async getInsights() {
    return this.service.getCampaignInsights();
  }

  // ─── business_management ─────────────────────────────────────────────────
  @Get('businesses')
  @Roles('OWNER')
  async listBusinesses() {
    return this.service.listBusinesses();
  }

  @Get('businesses/:id/ad-accounts')
  @Roles('OWNER')
  async listBusinessAdAccounts(@Param('id') businessId: string) {
    return this.service.listBusinessAdAccounts({ businessId });
  }

  @Get('businesses/:id/pages')
  @Roles('OWNER')
  async listBusinessPages(@Param('id') businessId: string) {
    return this.service.listBusinessPages({ businessId });
  }

  // ─── Legacy endpoints (out of current scope, kept for back-compat) ───────

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
  async updateCampaignStatus(@Param('id') id: string, @Body() dto: UpdateCampaignStatusDto) {
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
