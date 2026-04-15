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
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    key: 'line-oa',
    name: 'LINE Official Account',
    description: 'LINE OA สำหรับแจ้งเตือนลูกค้าและพนักงาน',
    icon: 'line',
    fields: [
      {
        key: 'shopChannelToken',
        label: 'Shop Channel Access Token',
        sensitive: true,
        required: true,
        envVar: 'LINE_CHANNEL_ACCESS_TOKEN',
      },
      {
        key: 'shopChannelSecret',
        label: 'Shop Channel Secret',
        sensitive: true,
        required: true,
        envVar: 'LINE_CHANNEL_SECRET',
      },
      {
        key: 'financeChannelToken',
        label: 'Finance Channel Access Token',
        sensitive: true,
        required: true,
        envVar: 'LINE_FINANCE_CHANNEL_ACCESS_TOKEN',
      },
      {
        key: 'financeChannelSecret',
        label: 'Finance Channel Secret',
        sensitive: true,
        required: true,
        envVar: 'LINE_FINANCE_CHANNEL_SECRET',
      },
      {
        key: 'staffChannelToken',
        label: 'Staff Channel Access Token',
        sensitive: true,
        required: false,
        envVar: 'LINE_STAFF_CHANNEL_ACCESS_TOKEN',
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
    key: 'sms',
    name: 'SMS Gateway',
    description: 'ส่ง SMS แจ้งเตือนลูกค้า',
    icon: 'message-square',
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
    ],
  },
  {
    key: 'paysolutions',
    name: 'PaySolutions',
    description: 'รับชำระค่างวดผ่าน QR Code',
    icon: 'credit-card',
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
];

/**
 * Look up an integration definition by its key.
 * Returns undefined if not found.
 */
export function getIntegrationDef(key: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.key === key);
}
