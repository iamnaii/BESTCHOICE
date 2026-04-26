import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AdsPlatform, Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';

/**
 * FacebookAdsSyncService — syncs campaign data from Facebook Marketing API.
 *
 * Runs every 4 hours to pull campaign spend, impressions, clicks, and reach.
 * Upserts AdsCampaign records matched by (platform=FACEBOOK_ADS, campaignId).
 *
 * API: GET /act_{AD_ACCOUNT_ID}/campaigns?fields=id,name,status,...
 * https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/
 *
 * Required env:
 * - FB_AD_ACCOUNT_ID (e.g. "act_123456789")
 * - FB_PAGE_ACCESS_TOKEN (must have ads_read permission)
 */
@Injectable()
export class FacebookAdsSyncService {
  private readonly logger = new Logger(FacebookAdsSyncService.name);
  private readonly adAccountId?: string;
  private readonly accessToken?: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.adAccountId = this.configService.get<string>('FB_AD_ACCOUNT_ID');
    this.accessToken = this.configService.get<string>('FB_PAGE_ACCESS_TOKEN');
  }

  private get isConfigured(): boolean {
    return !!this.adAccountId && !!this.accessToken;
  }

  /**
   * Sync campaigns every 4 hours.
   * Runs at minute 0 of hours 0, 4, 8, 12, 16, 20.
   */
  @Cron('0 */4 * * *')
  async syncCampaigns(): Promise<void> {
    if (!this.isConfigured) {
      this.logger.debug('[FB Ads Sync] Not configured — skipping');
      return;
    }

    this.logger.log('[FB Ads Sync] Starting campaign sync...');

    try {
      const campaigns = await this.fetchCampaigns();
      let upserted = 0;

      for (const campaign of campaigns) {
        await this.upsertCampaign(campaign);
        upserted++;
      }

      this.logger.log(`[FB Ads Sync] Synced ${upserted} campaigns`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[FB Ads Sync] Failed: ${errorMsg}`);
      Sentry.captureException(err, { tags: { cron: 'facebook-ads-sync' } });
    }
  }

  private async fetchCampaigns(): Promise<FbCampaignData[]> {
    const fields = [
      'id',
      'name',
      'status',
      'daily_budget',
      'lifetime_budget',
      'start_time',
      'stop_time',
      'insights{spend,impressions,clicks,reach}',
    ].join(',');

    const url = `https://graph.facebook.com/v25.0/${this.adAccountId}/campaigns?fields=${fields}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Facebook Marketing API ${res.status}: ${body}`);
    }

    const json = (await res.json()) as { data: FbCampaignData[] };
    return json.data ?? [];
  }

  private async upsertCampaign(fb: FbCampaignData): Promise<void> {
    const budget = fb.lifetime_budget
      ? Number(fb.lifetime_budget) / 100 // FB returns in cents
      : fb.daily_budget
        ? Number(fb.daily_budget) / 100
        : 0;

    const insights = fb.insights?.data?.[0];
    const spend = insights?.spend ? Number(insights.spend) : undefined;

    // Find existing campaign
    const existing = await this.prisma.adsCampaign.findFirst({
      where: {
        platform: AdsPlatform.FACEBOOK_ADS,
        campaignId: fb.id,
        deletedAt: null,
      },
    });

    const data = {
      campaignName: fb.name,
      budget: new Prisma.Decimal(spend ?? budget),
      isActive: fb.status === 'ACTIVE',
      startDate: fb.start_time ? new Date(fb.start_time) : undefined,
      endDate: fb.stop_time ? new Date(fb.stop_time) : undefined,
    };

    if (existing) {
      await this.prisma.adsCampaign.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await this.prisma.adsCampaign.create({
        data: {
          platform: AdsPlatform.FACEBOOK_ADS,
          campaignId: fb.id,
          ...data,
        },
      });
    }
  }
}

/** Raw response shape from Facebook Marketing API */
interface FbCampaignData {
  id: string;
  name: string;
  status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
  insights?: {
    data?: Array<{
      spend?: string;
      impressions?: string;
      clicks?: string;
      reach?: string;
    }>;
  };
}
