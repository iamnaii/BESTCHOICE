import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import {
  CreateAdCampaignDto,
  CreateLiveVideoDto,
  PublishVideoDto,
  SendStandardMessageDto,
  SubscribePageWebhooksDto,
  UpdateCampaignStatusDto,
} from './dto/facebook-app-review.dto';

const GRAPH_BASE = 'https://graph.facebook.com/v25.0';
const TIMEOUT_MS = 15_000;

export interface FbError {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    type?: string;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
}

export type FbJson = Record<string, unknown> & FbError;

/**
 * FacebookAppReviewService — exercises every Graph API permission required by
 * BESTCHOICE's Facebook App Review submission. Each public method wraps a
 * single REST call so reviewers (and our own CI) can trigger them one-by-one.
 *
 * Credentials are read DB-first via IntegrationConfigService (which falls back
 * to env vars), so the owner can manage them from Integration Hub UI without
 * redeploying.
 *
 * Required FB integration fields (Integration Hub → Facebook Messenger):
 * - pageAccessToken / FB_PAGE_ACCESS_TOKEN
 * - pageId / FB_PAGE_ID
 * - userAccessToken / FB_USER_ACCESS_TOKEN     (for /me/accounts)
 * - adAccountId / FB_AD_ACCOUNT_ID             (for Marketing API)
 * - systemUserToken / FB_SYSTEM_USER_TOKEN     (optional fallback for ads)
 */
@Injectable()
export class FacebookAppReviewService {
  private readonly logger = new Logger(FacebookAppReviewService.name);

  constructor(private readonly integrationConfig: IntegrationConfigService) {}

  private async getCreds(): Promise<{
    pageToken?: string;
    pageId?: string;
    userToken?: string;
    systemUserToken?: string;
    adAccountId?: string;
  }> {
    const cfg = await this.integrationConfig.getConfig('facebook');
    return {
      pageToken: cfg.pageAccessToken || undefined,
      pageId: cfg.pageId || undefined,
      userToken: cfg.userAccessToken || cfg.systemUserToken || undefined,
      systemUserToken: cfg.systemUserToken || undefined,
      adAccountId: cfg.adAccountId || undefined,
    };
  }

  private adsToken(c: Awaited<ReturnType<FacebookAppReviewService['getCreds']>>): string | undefined {
    return c.systemUserToken ?? c.userToken ?? c.pageToken;
  }

  // ─── pages_show_list ──────────────────────────────────────────────────────
  /**
   * GET /me/accounts — list all Pages the user manages.
   * Permission: pages_show_list
   */
  async listManagedPages(): Promise<FbJson> {
    const c = await this.getCreds();
    const token = c.userToken ?? c.pageToken;
    if (!token) {
      throw new BadRequestException('ยังไม่ได้ตั้งค่า FB access token');
    }

    const url = `${GRAPH_BASE}/me/accounts?fields=id,name,category,tasks&access_token=${token}`;
    return this.call('GET', url, undefined, 'list_pages');
  }

  // ─── pages_manage_ads + pages_read_engagement ────────────────────────────
  /**
   * GET /{PAGE_ID}/promotable_posts — list posts that can be boosted as ads.
   * Permissions: pages_manage_ads, pages_read_engagement
   */
  async listPromotablePosts(): Promise<FbJson> {
    const c = await this.getCreds();
    if (!c.pageToken || !c.pageId) {
      throw new BadRequestException('ยังไม่ได้ตั้งค่า FB page token/id');
    }

    const fields = ['id', 'message', 'created_time', 'is_eligible_for_promotion'].join(',');
    const url = `${GRAPH_BASE}/${c.pageId}/promotable_posts?fields=${fields}&access_token=${c.pageToken}`;
    return this.call('GET', url, undefined, 'list_promotable_posts');
  }

  // ─── ads_management + Ads Management Standard Access ─────────────────────
  /**
   * POST /act_{AD_ACCOUNT_ID}/campaigns — create a new ad campaign in PAUSED state.
   * Permissions: ads_management, Ads Management Standard Access, business_management
   */
  async createAdCampaign(dto: CreateAdCampaignDto): Promise<FbJson> {
    const c = await this.getCreds();
    const token = this.adsToken(c);
    if (!c.adAccountId || !token) {
      throw new BadRequestException('ยังไม่ได้ตั้งค่า FB Ad Account ID หรือ access token');
    }

    // Marketing API requires the `act_` prefix; tolerate operators who paste
    // just the numeric ID into Integration Hub.
    const accountId = c.adAccountId.startsWith('act_') ? c.adAccountId : `act_${c.adAccountId}`;

    const url = `${GRAPH_BASE}/${accountId}/campaigns`;
    const body: Record<string, unknown> = {
      name: dto.name,
      objective: dto.objective ?? 'OUTCOME_TRAFFIC',
      status: 'PAUSED',
      special_ad_categories: [],
      access_token: token,
    };

    if (dto.dailyBudget) {
      // Campaign-level daily_budget requires a bid_strategy (Campaign Budget
      // Optimization). Without it FB returns a bare "Invalid parameter".
      body.daily_budget = Math.round(dto.dailyBudget * 100);
      body.bid_strategy = 'LOWEST_COST_WITHOUT_CAP';
    }

    return this.call('POST', url, body, 'create_campaign');
  }

  /**
   * POST /{CAMPAIGN_ID} — update status (pause/resume/delete).
   * Permissions: ads_management
   */
  async updateCampaignStatus(
    campaignId: string,
    dto: UpdateCampaignStatusDto,
  ): Promise<FbJson> {
    const c = await this.getCreds();
    const token = this.adsToken(c);
    if (!token) {
      throw new BadRequestException('ยังไม่ได้ตั้งค่า FB access token');
    }

    const url = `${GRAPH_BASE}/${campaignId}`;
    const body = { status: dto.status, access_token: token };
    return this.call('POST', url, body, 'update_campaign_status');
  }

  // ─── leads_retrieval ──────────────────────────────────────────────────────
  /**
   * GET /{FORM_ID}/leads — retrieve leads submitted via a Lead Ad form.
   * Permissions: leads_retrieval, pages_manage_ads, pages_show_list
   */
  async fetchLeadsForForm(formId: string): Promise<FbJson> {
    const c = await this.getCreds();
    if (!c.pageToken) {
      throw new BadRequestException('ยังไม่ได้ตั้งค่า FB page token');
    }

    const url = `${GRAPH_BASE}/${formId}/leads?access_token=${c.pageToken}`;
    return this.call('GET', url, undefined, 'fetch_leads');
  }

  /**
   * GET /{PAGE_ID}/leadgen_forms — list Lead Ad forms on the page.
   * Helper so the reviewer can discover a form_id to pass to fetchLeadsForForm.
   * Permissions: leads_retrieval, pages_show_list
   */
  async listLeadForms(): Promise<FbJson> {
    const c = await this.getCreds();
    if (!c.pageToken || !c.pageId) {
      throw new BadRequestException('ยังไม่ได้ตั้งค่า FB page token/id');
    }

    const url = `${GRAPH_BASE}/${c.pageId}/leadgen_forms?access_token=${c.pageToken}`;
    return this.call('GET', url, undefined, 'list_lead_forms');
  }

  // ─── Live Video API ──────────────────────────────────────────────────────
  /**
   * POST /{PAGE_ID}/live_videos — create a scheduled or immediate live video.
   * Returns stream URL/key without broadcasting. Safe for reviewer testing.
   * Permissions: Live Video API, pages_read_engagement
   */
  async createLiveVideo(dto: CreateLiveVideoDto): Promise<FbJson> {
    const c = await this.getCreds();
    if (!c.pageToken || !c.pageId) {
      throw new BadRequestException('ยังไม่ได้ตั้งค่า FB page token/id');
    }

    const url = `${GRAPH_BASE}/${c.pageId}/live_videos?access_token=${c.pageToken}`;
    const body: Record<string, unknown> = {
      title: dto.title,
      description: dto.description ?? '',
      status: dto.status ?? 'SCHEDULED_UNPUBLISHED',
    };

    if (dto.plannedStartTime) {
      body.planned_start_time = dto.plannedStartTime;
    }

    return this.call('POST', url, body, 'create_live_video');
  }

  // ─── ads_read ────────────────────────────────────────────────────────────
  /**
   * GET /act_{AD_ACCOUNT_ID}/insights — read campaign performance metrics.
   * Permissions: ads_read, Ads Management Standard Access
   */
  async getCampaignInsights(): Promise<FbJson> {
    const c = await this.getCreds();
    const token = this.adsToken(c);
    if (!c.adAccountId || !token) {
      throw new BadRequestException('ยังไม่ได้ตั้งค่า FB Ad Account ID หรือ access token');
    }

    const accountId = c.adAccountId.startsWith('act_') ? c.adAccountId : `act_${c.adAccountId}`;
    const fields = ['spend', 'impressions', 'clicks', 'reach', 'cpc', 'ctr'].join(',');
    const url = `${GRAPH_BASE}/${accountId}/insights?fields=${fields}&date_preset=last_30d&access_token=${token}`;
    return this.call('GET', url, undefined, 'get_insights');
  }

  // ─── pages_messaging ─────────────────────────────────────────────────────
  /**
   * POST /{PAGE_ID}/messages — send a normal Messenger reply within the
   * 24-hour customer-initiated conversation window. No tag, just a regular
   * response (messaging_type=RESPONSE).
   *
   * Permissions: pages_messaging
   */
  async sendStandardMessage(dto: SendStandardMessageDto): Promise<FbJson> {
    const c = await this.getCreds();
    if (!c.pageToken || !c.pageId) {
      throw new BadRequestException('ยังไม่ได้ตั้งค่า FB page token/id');
    }

    const url = `${GRAPH_BASE}/${c.pageId}/messages?access_token=${c.pageToken}`;
    const body = {
      messaging_type: 'RESPONSE',
      recipient: { id: dto.recipientPsid },
      message: { text: dto.text },
    };

    return this.call('POST', url, body, 'send_standard_message');
  }

  // ─── pages_manage_metadata ───────────────────────────────────────────────
  /**
   * POST /{PAGE_ID}/subscribed_apps — subscribe the app to Page webhook
   * events (messages, messaging_postbacks, etc.). Required to receive
   * Messenger webhook callbacks.
   *
   * Permissions: pages_manage_metadata
   */
  async subscribePageWebhooks(dto: SubscribePageWebhooksDto): Promise<FbJson> {
    const c = await this.getCreds();
    if (!c.pageToken || !c.pageId) {
      throw new BadRequestException('ยังไม่ได้ตั้งค่า FB page token/id');
    }

    const fields = dto.fields ?? 'messages,messaging_postbacks,message_deliveries,message_reads';
    const url = `${GRAPH_BASE}/${c.pageId}/subscribed_apps?access_token=${c.pageToken}`;
    const body = { subscribed_fields: fields };
    return this.call('POST', url, body, 'subscribe_page_webhooks');
  }

  // ─── publish_video ───────────────────────────────────────────────────────
  /**
   * POST /{PAGE_ID}/videos — publish a video from a public URL to the Page.
   * Permissions: publish_video, pages_read_engagement
   */
  async publishVideo(dto: PublishVideoDto): Promise<FbJson> {
    const c = await this.getCreds();
    if (!c.pageToken || !c.pageId) {
      throw new BadRequestException('ยังไม่ได้ตั้งค่า FB page token/id');
    }

    const url = `${GRAPH_BASE}/${c.pageId}/videos?access_token=${c.pageToken}`;
    const body: Record<string, unknown> = {
      file_url: dto.fileUrl,
      title: dto.title ?? 'BESTCHOICE product video',
      description: dto.description ?? '',
    };

    return this.call('POST', url, body, 'publish_video');
  }

  // ─── shared HTTP helper ──────────────────────────────────────────────────
  private async call(
    method: 'GET' | 'POST',
    url: string,
    body: unknown,
    action: string,
  ): Promise<FbJson> {
    const redacted = url.replace(/access_token=[^&]+/g, 'access_token=***');
    this.logger.log(`[FB App Review] ${action} ${method} ${redacted}`);

    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const json = (await res.json().catch(() => ({}))) as FbJson;

      if (!res.ok || json.error) {
        const e = json.error ?? {};
        const parts = [e.message ?? `HTTP ${res.status}`];
        if (e.error_user_msg && e.error_user_msg !== e.message) parts.push(e.error_user_msg);
        if (e.error_subcode) parts.push(`subcode ${e.error_subcode}`);
        if (e.fbtrace_id) parts.push(`trace ${e.fbtrace_id}`);
        const msg = parts.join(' | ');
        this.logger.error(`[FB App Review] ${action} failed: ${msg}`);
        Sentry.captureMessage(`FB App Review ${action} failed: ${msg}`, 'warning');
        throw new BadRequestException(`Facebook API error: ${msg}`);
      }

      return json;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      this.logger.error(
        `[FB App Review] ${action} exception${isTimeout ? ' (timeout)' : ''}: ${errorMsg}`,
      );
      if (isTimeout) {
        Sentry.captureException(err, {
          tags: { module: 'facebook-app-review', action, reason: 'timeout' },
        });
      }
      throw new BadRequestException(`Facebook API error: ${errorMsg}`);
    }
  }
}
