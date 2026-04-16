import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { INTEGRATIONS, IntegrationDef } from './integration-registry';
import { IntegrationConfigService } from './integration-config.service';

export interface IntegrationStatus {
  key: string;
  name: string;
  description: string;
  icon: string;
  status: 'connected' | 'not_configured';
  webhookUrl?: string;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

@Injectable()
export class IntegrationsService {
  constructor(private readonly configService: IntegrationConfigService) {}

  async listAll(): Promise<IntegrationStatus[]> {
    return Promise.all(
      INTEGRATIONS.map(async (integration: IntegrationDef) => {
        const config = await this.configService.getConfig(integration.key);
        const requiredFields = integration.fields.filter((f) => f.required);
        const isConfigured =
          config !== null &&
          requiredFields.every((f) => {
            const value = (config as Record<string, unknown>)[f.key];
            return value !== undefined && value !== null && value !== '';
          });

        return {
          key: integration.key,
          name: integration.name,
          description: integration.description,
          icon: integration.icon,
          status: isConfigured ? ('connected' as const) : ('not_configured' as const),
          webhookUrl: integration.webhookUrl,
        };
      }),
    );
  }

  async testConnection(integrationKey: string): Promise<TestConnectionResult> {
    switch (integrationKey) {
      case 'line-oa':
        return this.testLineOa();
      case 'sms':
        return this.testSms();
      case 'facebook':
        return this.testFacebook();
      case 'paysolutions':
        return this.testPaysolutions();
      case 'peak':
        return this.testPeak();
      case 'mdm':
        return this.testMdm();
      case 'claude-ai':
        return this.testClaudeAi();
      case 'email':
        return this.testEmail();
      default:
        return { success: false, message: `ไม่พบ integration: ${integrationKey}` };
    }
  }

  // ─── LINE OA ───────────────────────────────────────────────────────────────

  private async testLineOa(): Promise<TestConnectionResult> {
    try {
      const config = await this.configService.getConfig('line-oa');
      const token =
        (config as Record<string, string> | null)?.shopChannelToken ||
        process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (!token) {
        return { success: false, message: 'ยังไม่ได้ตั้งค่า LINE Channel Access Token' };
      }

      const res = await fetch('https://api.line.me/v2/bot/info', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        return { success: false, message: `LINE API ตอบกลับ HTTP ${res.status}` };
      }

      const data = (await res.json()) as { displayName?: string; basicId?: string };
      return {
        success: true,
        message: `เชื่อมต่อสำเร็จ: ${data.displayName ?? 'unknown'}`,
        details: { displayName: data.displayName, basicId: data.basicId },
      };
    } catch (err: unknown) {
      return { success: false, message: (err as Error).message };
    }
  }

  // ─── SMS ───────────────────────────────────────────────────────────────────

  private async testSms(): Promise<TestConnectionResult> {
    try {
      const config = await this.configService.getConfig('sms');
      const apiKey =
        (config as Record<string, string> | null)?.apiKey || process.env.SMS_API_KEY;
      const apiSecret =
        (config as Record<string, string> | null)?.apiSecret || process.env.SMS_API_SECRET;

      if (!apiKey || !apiSecret) {
        return { success: false, message: 'ยังไม่ได้ตั้งค่า SMS API Key / Secret' };
      }

      const basicAuth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
      const res = await fetch('https://bulk.thaibulksms.com/sms-api/v2/credit', {
        headers: { Authorization: `Basic ${basicAuth}` },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        return { success: false, message: `SMS API ตอบกลับ HTTP ${res.status}` };
      }

      const data = (await res.json()) as { credit?: number | string };
      return {
        success: true,
        message: `เชื่อมต่อสำเร็จ — เครดิตคงเหลือ: ${data.credit ?? 'unknown'}`,
        details: { credit: data.credit },
      };
    } catch (err: unknown) {
      return { success: false, message: (err as Error).message };
    }
  }

  // ─── Facebook ──────────────────────────────────────────────────────────────

  private async testFacebook(): Promise<TestConnectionResult> {
    try {
      const config = await this.configService.getConfig('facebook');
      const token =
        (config as Record<string, string> | null)?.pageAccessToken ||
        process.env.FB_PAGE_ACCESS_TOKEN;

      if (!token) {
        return { success: false, message: 'ยังไม่ได้ตั้งค่า Facebook Page Access Token' };
      }

      const url = `https://graph.facebook.com/v25.0/me?fields=name,id&access_token=${token}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

      if (!res.ok) {
        return { success: false, message: `Facebook API ตอบกลับ HTTP ${res.status}` };
      }

      const data = (await res.json()) as { name?: string; id?: string; error?: { message: string } };
      if (data.error) {
        return { success: false, message: `Facebook error: ${data.error.message}` };
      }

      return {
        success: true,
        message: `เชื่อมต่อสำเร็จ: ${data.name ?? 'unknown'} (ID: ${data.id ?? 'unknown'})`,
        details: { name: data.name, id: data.id },
      };
    } catch (err: unknown) {
      return { success: false, message: (err as Error).message };
    }
  }

  // ─── PaySolutions ──────────────────────────────────────────────────────────

  private async testPaysolutions(): Promise<TestConnectionResult> {
    try {
      const config = await this.configService.getConfig('paysolutions');
      const merchantId =
        (config as Record<string, string> | null)?.merchantId ||
        process.env.PAYSOLUTIONS_MERCHANT_ID;
      const secretKey =
        (config as Record<string, string> | null)?.secretKey ||
        process.env.PAYSOLUTIONS_SECRET_KEY;
      const apiKey =
        (config as Record<string, string> | null)?.apiKey || process.env.PAYSOLUTIONS_API_KEY;

      if (!merchantId || !secretKey || !apiKey) {
        return { success: false, message: 'ยังไม่ได้ตั้งค่า PaySolutions ให้ครบ (Merchant ID, Secret Key, API Key)' };
      }

      return {
        success: true,
        message: `ตั้งค่าครบถ้วน — Merchant ID: ${merchantId}`,
        details: { merchantId },
      };
    } catch (err: unknown) {
      return { success: false, message: (err as Error).message };
    }
  }

  // ─── PEAK ──────────────────────────────────────────────────────────────────

  private async testPeak(): Promise<TestConnectionResult> {
    try {
      const config = await this.configService.getConfig('peak');
      const userToken =
        (config as Record<string, string> | null)?.userToken || process.env.PEAK_USER_TOKEN;
      const connectId =
        (config as Record<string, string> | null)?.connectId || process.env.PEAK_CONNECT_ID;
      const secretKey =
        (config as Record<string, string> | null)?.secretKey || process.env.PEAK_SECRET_KEY;

      if (!userToken || !connectId || !secretKey) {
        return { success: false, message: 'ยังไม่ได้ตั้งค่า PEAK ให้ครบ (User Token, Connect ID, Secret Key)' };
      }

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = crypto.createHmac('sha1', secretKey).update(timestamp).digest('hex');

      const res = await fetch('https://api.peakaccount.com/api/v1/company', {
        headers: {
          Authorization: `Bearer ${userToken}`,
          'X-PeakConnect-ID': connectId,
          'X-Timestamp': timestamp,
          'X-Signature': signature,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        return { success: false, message: `PEAK API ตอบกลับ HTTP ${res.status}` };
      }

      const data = (await res.json()) as { name?: string; id?: string; companyName?: string };
      const companyName = data.companyName ?? data.name ?? 'unknown';

      return {
        success: true,
        message: `เชื่อมต่อสำเร็จ: ${companyName}`,
        details: { companyName },
      };
    } catch (err: unknown) {
      return { success: false, message: (err as Error).message };
    }
  }

  // ─── MDM ───────────────────────────────────────────────────────────────────

  private async testMdm(): Promise<TestConnectionResult> {
    try {
      const config = await this.configService.getConfig('mdm');
      const apiKey =
        (config as Record<string, string> | null)?.apiKey || process.env.MDM_API_KEY;
      const baseUrl =
        (config as Record<string, string> | null)?.baseUrl ||
        process.env.MDM_BASE_URL ||
        'https://mdm-th.com';

      if (!apiKey) {
        return { success: false, message: 'ยังไม่ได้ตั้งค่า MDM API Key' };
      }

      const res = await fetch(`${baseUrl}/api/v1/devices?limit=1`, {
        headers: { 'X-API-Key': apiKey },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        return { success: false, message: `MDM API ตอบกลับ HTTP ${res.status}` };
      }

      return {
        success: true,
        message: 'เชื่อมต่อ MDM สำเร็จ',
        details: { baseUrl },
      };
    } catch (err: unknown) {
      return { success: false, message: (err as Error).message };
    }
  }

  // ─── Claude AI ─────────────────────────────────────────────────────────────

  private async testClaudeAi(): Promise<TestConnectionResult> {
    try {
      const config = await this.configService.getConfig('claude-ai');
      const apiKey =
        (config as Record<string, string> | null)?.apiKey || process.env.ANTHROPIC_API_KEY;

      if (!apiKey) {
        return { success: false, message: 'ยังไม่ได้ตั้งค่า Anthropic API Key' };
      }

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        return {
          success: false,
          message: err.error?.message ?? `Anthropic API ตอบกลับ HTTP ${res.status}`,
        };
      }

      return { success: true, message: 'เชื่อมต่อ Claude AI สำเร็จ' };
    } catch (err: unknown) {
      return { success: false, message: (err as Error).message };
    }
  }

  // ─── Email (SMTP) ──────────────────────────────────────────────────────────

  private async testEmail(): Promise<TestConnectionResult> {
    try {
      const config = await this.configService.getConfig('email');
      const cfg = config as Record<string, string> | null;

      const host = cfg?.host || process.env.SMTP_HOST;
      const port = parseInt(cfg?.port || process.env.SMTP_PORT || '587', 10);
      const user = cfg?.user || process.env.SMTP_USER;
      const pass = cfg?.pass || process.env.SMTP_PASS;

      if (!host || !user || !pass) {
        return { success: false, message: 'ยังไม่ได้ตั้งค่า SMTP ให้ครบ (Host, User, Password)' };
      }

      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });

      await transporter.verify();

      return {
        success: true,
        message: `เชื่อมต่อ SMTP สำเร็จ: ${host}:${port}`,
        details: { host, port },
      };
    } catch (err: unknown) {
      return { success: false, message: (err as Error).message };
    }
  }
}
