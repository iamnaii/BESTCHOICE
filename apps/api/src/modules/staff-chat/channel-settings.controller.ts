import { Controller, Get, Post, Body, Req, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/** Keys for each channel's configuration in SystemConfig */
const CHANNEL_CONFIG = {
  LINE_SHOP: {
    keys: ['line_channel_access_token', 'line_channel_secret', 'liff_id'],
    secretKeys: ['line_channel_access_token', 'line_channel_secret'],
    label: 'LINE Shop OA',
  },
  LINE_FINANCE: {
    keys: [
      'line_finance_channel_access_token',
      'line_finance_channel_secret',
      'line_finance_liff_id',
    ],
    secretKeys: ['line_finance_channel_access_token', 'line_finance_channel_secret'],
    label: 'LINE Finance OA (น้องเบส)',
  },
  FACEBOOK: {
    keys: ['fb_page_access_token', 'fb_page_id', 'fb_app_secret', 'fb_verify_token'],
    secretKeys: ['fb_page_access_token', 'fb_app_secret'],
    label: 'Facebook Messenger',
  },
  TIKTOK: {
    keys: ['tiktok_bm_access_token', 'tiktok_bm_business_id'],
    secretKeys: ['tiktok_bm_access_token'],
    label: 'TikTok Business Messaging',
  },
} as const;

type ChannelKey = keyof typeof CHANNEL_CONFIG;

function maskSecret(value: string): string {
  if (value.length <= 8) return '****';
  return value.substring(0, 4) + '****' + value.substring(value.length - 4);
}

@Controller('channel-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChannelSettingsController {
  private readonly logger = new Logger(ChannelSettingsController.name);

  constructor(private prisma: PrismaService) {}

  /** Get all channel configurations (secrets masked) */
  @Get()
  @Roles('OWNER')
  async getAll() {
    const allKeys = Object.values(CHANNEL_CONFIG).flatMap((c) => c.keys);
    const configs = await this.prisma.systemConfig.findMany({
      where: { key: { in: allKeys } },
    });
    const configMap = new Map(configs.map((c) => [c.key, c.value]));

    const channels: Record<string, { label: string; isConfigured: boolean; settings: Record<string, string> }> = {};

    for (const [channel, cfg] of Object.entries(CHANNEL_CONFIG)) {
      const settings: Record<string, string> = {};
      let hasRequired = false;

      for (const key of cfg.keys) {
        const value = configMap.get(key) ?? '';
        if ((cfg.secretKeys as readonly string[]).includes(key) && value) {
          settings[key] = maskSecret(value);
          hasRequired = true;
        } else {
          settings[key] = value;
          if (value) hasRequired = true;
        }
      }

      // isConfigured = at least one secret key has a real value
      const isConfigured = cfg.secretKeys.some((k) => {
        const v = configMap.get(k);
        return v && v.length > 5;
      });

      channels[channel] = { label: cfg.label, isConfigured, settings };
    }

    return { channels };
  }

  /** Save settings for a specific channel */
  @Post()
  @Roles('OWNER')
  async save(@Body() body: { channel: string; settings: Record<string, string> }) {
    const channelKey = body.channel as ChannelKey;
    const cfg = CHANNEL_CONFIG[channelKey];
    if (!cfg) {
      return { success: false, error: 'ช่องทางไม่ถูกต้อง' };
    }

    for (const key of cfg.keys) {
      const value = body.settings[key];
      // Skip masked values (user didn't change the secret)
      if (value === undefined || value === '' || value.includes('****')) continue;

      await this.prisma.systemConfig.upsert({
        where: { key },
        create: { key, value, label: `${cfg.label}: ${key}` },
        update: { value },
      });
    }

    this.logger.log(`[ChannelSettings] ${channelKey} updated by admin`);
    return { success: true, message: `บันทึกการตั้งค่า ${cfg.label} เรียบร้อย` };
  }

  /** Get webhook URLs for each channel */
  @Get('webhooks')
  @Roles('OWNER')
  async getWebhookUrls(@Req() req: any) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const baseUrl = `${protocol}://${host}/api`;

    return {
      webhooks: {
        LINE_SHOP: { url: `${baseUrl}/line-oa/webhook`, method: 'POST' },
        LINE_FINANCE: { url: `${baseUrl}/chatbot/finance/webhook`, method: 'POST' },
        FACEBOOK: { url: `${baseUrl}/chat-adapters/facebook/webhook`, method: 'POST (ยังไม่เปิด)' },
        TIKTOK: { url: `${baseUrl}/chat-adapters/tiktok/webhook`, method: 'POST (รอ partner access)' },
      },
    };
  }
}
