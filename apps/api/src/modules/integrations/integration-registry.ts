/**
 * Integration Registry
 *
 * Defines all external integrations, their config fields, sensitivity flags,
 * and environment variable mappings.
 */

export interface IntegrationField {
  key: string;
  label: string;
  sensitive: boolean;
  required: boolean;
  defaultValue?: string;
  envVar: string;
}

export interface IntegrationDef {
  key: string;
  name: string;
  description: string;
  icon: string;
  fields: IntegrationField[];
  /** Webhook URL that the external service should POST to (shown in UI as read-only info). */
  webhookUrl?: string;
  /** Short instruction shown next to the webhook URL. */
  webhookNote?: string;
}

const BASE = process.env.API_BASE_URL || 'https://api.bestchoicephone.app';

export const INTEGRATIONS: IntegrationDef[] = [
  {
    key: 'line-shop',
    name: 'LINE SHOP (ลูกค้า)',
    description: 'ไลน์ร้าน — แชทกับลูกค้า, ส่งโปรโมชั่น',
    icon: 'line',
    webhookUrl: `${BASE}/api/line-oa/webhook`,
    webhookNote: 'ตั้งค่า Webhook URL นี้ที่ LINE Developers Console → Messaging API → Webhook URL',
    fields: [
      {
        key: 'channelToken',
        label: 'Channel Access Token',
        sensitive: true,
        required: true,
        envVar: 'LINE_CHANNEL_ACCESS_TOKEN',
      },
      {
        key: 'channelSecret',
        label: 'Channel Secret',
        sensitive: true,
        required: true,
        envVar: 'LINE_CHANNEL_SECRET',
      },
      {
        key: 'liffId',
        label: 'LIFF ID',
        sensitive: false,
        required: false,
        envVar: 'VITE_LIFF_ID',
      },
    ],
  },
  {
    key: 'line-finance',
    name: 'LINE FINANCE (น้องเบส)',
    description: 'ไลน์การเงิน — แจ้งค่างวด, รับชำระ',
    icon: 'line',
    webhookUrl: `${BASE}/api/chatbot/finance/webhook`,
    webhookNote: 'ตั้งค่า Webhook URL นี้ที่ LINE Developers Console → Messaging API → Webhook URL',
    fields: [
      {
        key: 'channelToken',
        label: 'Channel Access Token',
        sensitive: true,
        required: true,
        envVar: 'LINE_FINANCE_CHANNEL_ACCESS_TOKEN',
      },
      {
        key: 'channelSecret',
        label: 'Channel Secret',
        sensitive: true,
        required: true,
        envVar: 'LINE_FINANCE_CHANNEL_SECRET',
      },
      {
        key: 'liffId',
        label: 'LIFF ID',
        sensitive: false,
        required: false,
        envVar: 'VITE_LIFF_ID_FINANCE',
      },
    ],
  },
  {
    key: 'line-staff',
    name: 'LINE STAFF (พนักงาน)',
    description: 'ไลน์พนักงาน — แจ้งเตือนทีมงาน',
    icon: 'line',
    fields: [
      {
        key: 'channelToken',
        label: 'Channel Access Token',
        sensitive: true,
        required: true,
        envVar: 'LINE_STAFF_CHANNEL_ACCESS_TOKEN',
      },
      {
        key: 'channelSecret',
        label: 'Channel Secret',
        sensitive: true,
        required: true,
        envVar: 'LINE_STAFF_CHANNEL_SECRET',
      },
      {
        key: 'notifyTargets',
        label: 'กลุ่มที่ต้องการแจ้งเตือน (คั่นด้วย comma)',
        sensitive: false,
        required: false,
        envVar: 'LINE_STAFF_NOTIFY_TARGETS',
      },
    ],
  },
  {
    key: 'sms',
    name: 'SMS Gateway',
    description: 'ส่ง SMS แจ้งเตือนลูกค้า',
    icon: 'message-square',
    webhookUrl: `${BASE}/api/sms-webhook`,
    webhookNote: 'ตั้งค่า Delivery Report URL นี้ที่ ThaiBulkSMS dashboard (optional)',
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        sensitive: true,
        required: true,
        envVar: 'SMS_API_KEY',
      },
      {
        key: 'apiSecret',
        label: 'API Secret',
        sensitive: true,
        required: true,
        envVar: 'SMS_API_SECRET',
      },
      {
        key: 'sender',
        label: 'Sender Name',
        sensitive: false,
        required: true,
        envVar: 'SMS_SENDER',
      },
      {
        key: 'force',
        label: 'SMS Force Mode',
        sensitive: false,
        required: false,
        defaultValue: 'standard',
        envVar: 'SMS_FORCE',
      },
    ],
  },
  {
    key: 'facebook',
    name: 'Facebook Messenger',
    description: 'Facebook Page สำหรับรับส่งข้อความลูกค้า',
    icon: 'facebook',
    fields: [
      {
        key: 'pageAccessToken',
        label: 'Page Access Token',
        sensitive: true,
        required: true,
        envVar: 'FB_PAGE_ACCESS_TOKEN',
      },
      {
        key: 'pageId',
        label: 'Page ID',
        sensitive: false,
        required: true,
        envVar: 'FB_PAGE_ID',
      },
      {
        key: 'appSecret',
        label: 'App Secret',
        sensitive: true,
        required: true,
        envVar: 'FB_APP_SECRET',
      },
      {
        key: 'verifyToken',
        label: 'Webhook Verify Token',
        sensitive: true,
        required: true,
        envVar: 'FB_VERIFY_TOKEN',
      },
      {
        key: 'userAccessToken',
        label: 'User Access Token (App Review)',
        sensitive: true,
        required: false,
        envVar: 'FB_USER_ACCESS_TOKEN',
      },
      {
        key: 'systemUserToken',
        label: 'System User Token (Marketing API)',
        sensitive: true,
        required: false,
        envVar: 'FB_SYSTEM_USER_TOKEN',
      },
      {
        key: 'adAccountId',
        label: 'Ad Account ID (เช่น act_123456789)',
        sensitive: false,
        required: false,
        envVar: 'FB_AD_ACCOUNT_ID',
      },
    ],
  },
  {
    key: 'paysolutions',
    name: 'PaySolutions',
    description: 'รับชำระค่างวดผ่าน QR Code',
    icon: 'credit-card',
    webhookUrl: `${BASE}/api/paysolutions/webhook`,
    webhookNote: 'ตั้งค่า Postback URL นี้ที่ PaySolutions merchant dashboard',
    fields: [
      {
        key: 'merchantId',
        label: 'Merchant ID',
        sensitive: false,
        required: true,
        envVar: 'PAYSOLUTIONS_MERCHANT_ID',
      },
      {
        key: 'secretKey',
        label: 'Secret Key',
        sensitive: true,
        required: true,
        envVar: 'PAYSOLUTIONS_SECRET_KEY',
      },
      {
        key: 'apiKey',
        label: 'API Key',
        sensitive: true,
        required: true,
        envVar: 'PAYSOLUTIONS_API_KEY',
      },
      {
        key: 'apiUrl',
        label: 'API URL',
        sensitive: false,
        required: false,
        defaultValue: 'https://apis.paysolutions.asia',
        envVar: 'PAYSOLUTIONS_API_URL',
      },
      {
        key: 'terminalId',
        label: 'Terminal ID',
        sensitive: false,
        required: false,
        defaultValue: 'TID00001',
        envVar: 'PAYSOLUTIONS_TERMINAL_ID',
      },
    ],
  },
  {
    key: 'peak',
    name: 'PEAK (บัญชี)',
    description: 'ซิงค์ข้อมูลบัญชีกับระบบ PEAK',
    icon: 'bar-chart-2',
    fields: [
      {
        key: 'userToken',
        label: 'User Token',
        sensitive: true,
        required: true,
        envVar: 'PEAK_USER_TOKEN',
      },
      {
        key: 'connectId',
        label: 'Connect ID',
        sensitive: false,
        required: true,
        envVar: 'PEAK_CONNECT_ID',
      },
      {
        key: 'secretKey',
        label: 'Secret Key',
        sensitive: true,
        required: true,
        envVar: 'PEAK_SECRET_KEY',
      },
      {
        key: 'baseUrl',
        label: 'PEAK API Base URL',
        sensitive: false,
        required: false,
        defaultValue: 'https://api.peakaccount.com/api/v1',
        envVar: 'PEAK_BASE_URL',
      },
    ],
  },
  {
    key: 'mdm',
    name: 'MDM PJ-Soft',
    description: 'ระบบล็อคเครื่องมือถือจากระยะไกล',
    icon: 'shield',
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        sensitive: true,
        required: true,
        envVar: 'MDM_API_KEY',
      },
      {
        key: 'apiKeyPrevious',
        label: 'API Key (ก่อนหน้า) — ใช้ช่วง grace period หลัง rotate',
        sensitive: true,
        required: false,
        envVar: 'MDM_API_KEY_PREVIOUS',
      },
      {
        key: 'baseUrl',
        label: 'Base URL',
        sensitive: false,
        required: false,
        defaultValue: 'https://mdm-th.com',
        envVar: 'MDM_BASE_URL',
      },
    ],
  },
  {
    key: 'claude-ai',
    name: 'Claude AI (Anthropic)',
    description: 'AI assistant สำหรับวิเคราะห์และช่วยงาน',
    icon: 'bot',
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        sensitive: true,
        required: true,
        envVar: 'ANTHROPIC_API_KEY',
      },
    ],
  },
  {
    key: 'email',
    name: 'Email (SMTP)',
    description: 'ส่งอีเมลแจ้งเตือนและเอกสาร',
    icon: 'mail',
    fields: [
      {
        key: 'host',
        label: 'SMTP Host',
        sensitive: false,
        required: true,
        envVar: 'SMTP_HOST',
      },
      {
        key: 'port',
        label: 'SMTP Port',
        sensitive: false,
        required: false,
        defaultValue: '587',
        envVar: 'SMTP_PORT',
      },
      {
        key: 'user',
        label: 'SMTP Username',
        sensitive: false,
        required: true,
        envVar: 'SMTP_USER',
      },
      {
        key: 'pass',
        label: 'SMTP Password',
        sensitive: true,
        required: true,
        envVar: 'SMTP_PASS',
      },
      {
        key: 'from',
        label: 'From Address',
        sensitive: false,
        required: true,
        envVar: 'SMTP_FROM',
      },
    ],
  },
  {
    key: 'ga4',
    name: 'Google Analytics 4',
    description: 'วัดพฤติกรรมผู้ใช้ในหน้าร้านออนไลน์ (bestchoicephone.app)',
    icon: 'line-chart',
    fields: [
      {
        key: 'measurementId',
        label: 'Measurement ID',
        sensitive: false,
        required: false,
        envVar: 'VITE_GA4_ID',
      },
    ],
  },
  {
    key: 'facebook-pixel',
    name: 'Facebook Pixel',
    description: 'ส่ง conversion events (ViewContent / AddToCart / Purchase) ให้ Meta Ads',
    icon: 'facebook',
    fields: [
      {
        key: 'pixelId',
        label: 'Pixel ID',
        sensitive: false,
        required: false,
        envVar: 'VITE_FB_PIXEL_ID',
      },
    ],
  },
];

/**
 * Look up an integration definition by its key.
 * Returns undefined if not found.
 */
export function getIntegrationDef(key: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.key === key);
}
