# Integration Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หน้า Settings รวมศูนย์สำหรับ OWNER ตั้งค่า + test connection ทุก external integration ผ่าน UI เก็บ credentials ใน DB (encrypted) แทน .env

**Architecture:** สร้าง IntegrationsModule ใหม่ที่มี IntegrationConfigService เป็น centralized config resolver (DB → env fallback) ใช้ crypto.util.ts ที่มีอยู่แล้วเข้ารหัส credentials ก่อนเก็บลง SystemConfig table Frontend เป็นหน้าเดียว card grid + drawer ต่อ integration

**Tech Stack:** NestJS, Prisma (SystemConfig), AES-256-CBC (crypto.util.ts), React, TanStack Query, Radix UI Sheet

**Spec:** `docs/superpowers/specs/2026-04-15-integration-hub-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `apps/api/src/modules/integrations/integrations.module.ts` | Module registration |
| `apps/api/src/modules/integrations/integrations.controller.ts` | CRUD config + test connection endpoints |
| `apps/api/src/modules/integrations/integrations.service.ts` | Test connection logic for each integration |
| `apps/api/src/modules/integrations/integration-config.service.ts` | Read/write encrypted config with DB→env fallback |
| `apps/api/src/modules/integrations/integration-registry.ts` | Registry of all integrations (keys, fields, env var mappings) |
| `apps/web/src/pages/IntegrationHubPage.tsx` | Hub page with card grid + drawer |

### Files to Modify

| File | Change |
|------|--------|
| `apps/api/src/app.module.ts` | Register IntegrationsModule |
| `apps/web/src/App.tsx` | Add route `/settings/integrations` |
| `apps/web/src/config/menu.ts` | Add Integration Hub to OWNER menu |

---

## Task 1: Integration Registry + Config Service

**Files:**
- Create: `apps/api/src/modules/integrations/integration-registry.ts`
- Create: `apps/api/src/modules/integrations/integration-config.service.ts`

- [ ] **Step 1: Create integration-registry.ts**

Defines all integrations, their config fields, which are sensitive, and corresponding env var names.

```typescript
// apps/api/src/modules/integrations/integration-registry.ts

export interface IntegrationField {
  key: string;        // e.g. 'apiKey'
  label: string;      // e.g. 'API Key'
  sensitive: boolean;  // true = encrypt in DB, mask in response
  required: boolean;
  defaultValue?: string;
  envVar: string;      // fallback env var name
}

export interface IntegrationDef {
  key: string;
  name: string;
  description: string;
  icon: string;        // lucide icon name
  fields: IntegrationField[];
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    key: 'line-oa',
    name: 'LINE OA',
    description: 'LINE Official Account (Shop + Finance + Staff)',
    icon: 'MessageCircle',
    fields: [
      { key: 'shopChannelToken', label: 'Shop Channel Access Token', sensitive: true, required: false, envVar: 'LINE_CHANNEL_ACCESS_TOKEN' },
      { key: 'shopChannelSecret', label: 'Shop Channel Secret', sensitive: true, required: false, envVar: 'LINE_CHANNEL_SECRET' },
      { key: 'financeChannelToken', label: 'Finance Channel Access Token', sensitive: true, required: false, envVar: 'LINE_FINANCE_CHANNEL_ACCESS_TOKEN' },
      { key: 'financeChannelSecret', label: 'Finance Channel Secret', sensitive: true, required: false, envVar: 'LINE_FINANCE_CHANNEL_SECRET' },
      { key: 'staffChannelToken', label: 'Staff Channel Access Token', sensitive: true, required: false, envVar: 'LINE_STAFF_CHANNEL_ACCESS_TOKEN' },
      { key: 'liffId', label: 'LIFF ID', sensitive: false, required: false, envVar: 'VITE_LIFF_ID' },
    ],
  },
  {
    key: 'sms',
    name: 'SMS (ThaiBulkSMS)',
    description: 'ส่ง SMS แจ้งเตือนลูกค้า',
    icon: 'MessageSquare',
    fields: [
      { key: 'apiKey', label: 'API Key', sensitive: true, required: true, envVar: 'SMS_API_KEY' },
      { key: 'apiSecret', label: 'API Secret', sensitive: true, required: true, envVar: 'SMS_API_SECRET' },
      { key: 'sender', label: 'Sender Name', sensitive: false, required: true, envVar: 'SMS_SENDER' },
    ],
  },
  {
    key: 'facebook',
    name: 'Facebook Messenger',
    description: 'รับ-ส่งข้อความผ่าน Facebook Page',
    icon: 'Facebook',
    fields: [
      { key: 'pageAccessToken', label: 'Page Access Token', sensitive: true, required: true, envVar: 'FB_PAGE_ACCESS_TOKEN' },
      { key: 'pageId', label: 'Page ID', sensitive: false, required: true, envVar: 'FB_PAGE_ID' },
      { key: 'appSecret', label: 'App Secret', sensitive: true, required: true, envVar: 'FB_APP_SECRET' },
      { key: 'verifyToken', label: 'Verify Token', sensitive: true, required: true, envVar: 'FB_VERIFY_TOKEN' },
    ],
  },
  {
    key: 'paysolutions',
    name: 'PaySolutions',
    description: 'รับชำระเงินผ่าน QR Code',
    icon: 'CreditCard',
    fields: [
      { key: 'merchantId', label: 'Merchant ID', sensitive: false, required: true, envVar: 'PAYSOLUTIONS_MERCHANT_ID' },
      { key: 'secretKey', label: 'Secret Key', sensitive: true, required: true, envVar: 'PAYSOLUTIONS_SECRET_KEY' },
      { key: 'apiKey', label: 'API Key', sensitive: true, required: true, envVar: 'PAYSOLUTIONS_API_KEY' },
      { key: 'apiUrl', label: 'API URL', sensitive: false, required: true, defaultValue: 'https://apis.paysolutions.asia', envVar: 'PAYSOLUTIONS_API_URL' },
      { key: 'terminalId', label: 'Terminal ID', sensitive: false, required: false, defaultValue: 'TID00001', envVar: 'PAYSOLUTIONS_TERMINAL_ID' },
    ],
  },
  {
    key: 'peak',
    name: 'PEAK Accounting',
    description: 'ซิงค์ข้อมูลบัญชีกับ PEAK',
    icon: 'BookOpen',
    fields: [
      { key: 'userToken', label: 'User Token', sensitive: true, required: true, envVar: 'PEAK_USER_TOKEN' },
      { key: 'connectId', label: 'Connect ID', sensitive: false, required: true, envVar: 'PEAK_CONNECT_ID' },
      { key: 'secretKey', label: 'Secret Key', sensitive: true, required: true, envVar: 'PEAK_SECRET_KEY' },
    ],
  },
  {
    key: 'mdm',
    name: 'MDM (PJ-Soft)',
    description: 'ล็อค/ปลดล็อคเครื่องมือถือ',
    icon: 'Smartphone',
    fields: [
      { key: 'apiKey', label: 'API Key', sensitive: true, required: true, envVar: 'MDM_API_KEY' },
      { key: 'baseUrl', label: 'Base URL', sensitive: false, required: true, defaultValue: 'https://mdm-th.com', envVar: 'MDM_BASE_URL' },
    ],
  },
  {
    key: 'claude-ai',
    name: 'Claude AI (Anthropic)',
    description: 'AI สำหรับ OCR, แชท, แนะนำข้อความ',
    icon: 'Brain',
    fields: [
      { key: 'apiKey', label: 'API Key', sensitive: true, required: true, envVar: 'ANTHROPIC_API_KEY' },
    ],
  },
  {
    key: 'email',
    name: 'Email (SMTP)',
    description: 'ส่งอีเมลรีเซ็ตรหัสผ่าน, เชิญผู้ใช้',
    icon: 'Mail',
    fields: [
      { key: 'host', label: 'SMTP Host', sensitive: false, required: true, envVar: 'SMTP_HOST' },
      { key: 'port', label: 'SMTP Port', sensitive: false, required: true, defaultValue: '587', envVar: 'SMTP_PORT' },
      { key: 'user', label: 'Username', sensitive: false, required: true, envVar: 'SMTP_USER' },
      { key: 'pass', label: 'Password', sensitive: true, required: true, envVar: 'SMTP_PASS' },
      { key: 'from', label: 'From Address', sensitive: false, required: true, envVar: 'SMTP_FROM' },
    ],
  },
];

export function getIntegrationDef(key: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.key === key);
}
```

- [ ] **Step 2: Create integration-config.service.ts**

Centralized config service: read from DB (SystemConfig) first → fallback to env. Encrypt sensitive values before save.

```typescript
// apps/api/src/modules/integrations/integration-config.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptPII, decryptPII, isEncrypted } from '../../utils/crypto.util';
import { getIntegrationDef } from './integration-registry';

@Injectable()
export class IntegrationConfigService {
  private readonly logger = new Logger(IntegrationConfigService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  private getEncryptionKey(): string {
    return this.configService.get<string>('INTEGRATION_ENCRYPTION_KEY') ?? '';
  }

  /** Get a single config value: DB → env fallback */
  async getValue(integrationKey: string, fieldKey: string): Promise<string | null> {
    const dbKey = `integration.${integrationKey}.${fieldKey}`;
    const record = await this.prisma.systemConfig.findUnique({ where: { key: dbKey } });

    if (record?.value) {
      const key = this.getEncryptionKey();
      return isEncrypted(record.value) ? decryptPII(record.value, key) : record.value;
    }

    // Fallback to env var
    const def = getIntegrationDef(integrationKey);
    const field = def?.fields.find((f) => f.key === fieldKey);
    if (field?.envVar) {
      return this.configService.get<string>(field.envVar) ?? null;
    }

    return null;
  }

  /** Get all config for an integration */
  async getConfig(integrationKey: string): Promise<Record<string, string | null>> {
    const def = getIntegrationDef(integrationKey);
    if (!def) return {};

    const result: Record<string, string | null> = {};
    for (const field of def.fields) {
      result[field.key] = await this.getValue(integrationKey, field.key);
    }
    return result;
  }

  /** Get config with sensitive values masked (for frontend) */
  async getMaskedConfig(integrationKey: string): Promise<Record<string, string | null>> {
    const def = getIntegrationDef(integrationKey);
    if (!def) return {};

    const config = await this.getConfig(integrationKey);
    const masked: Record<string, string | null> = {};

    for (const field of def.fields) {
      const val = config[field.key];
      if (!val) {
        masked[field.key] = null;
      } else if (field.sensitive) {
        masked[field.key] = val.length > 4 ? '••••' + val.slice(-4) : '••••';
      } else {
        masked[field.key] = val;
      }
    }
    return masked;
  }

  /** Save config for an integration */
  async saveConfig(integrationKey: string, values: Record<string, string>): Promise<void> {
    const def = getIntegrationDef(integrationKey);
    if (!def) return;

    const encKey = this.getEncryptionKey();

    for (const field of def.fields) {
      const val = values[field.key];
      if (val === undefined) continue;

      const dbKey = `integration.${integrationKey}.${field.key}`;
      const stored = field.sensitive && encKey ? encryptPII(val, encKey) : val;

      await this.prisma.systemConfig.upsert({
        where: { key: dbKey },
        create: { key: dbKey, value: stored, label: `${def.name} — ${field.label}` },
        update: { value: stored },
      });
    }
  }

  /** Delete all config for an integration (revert to env) */
  async deleteConfig(integrationKey: string): Promise<void> {
    await this.prisma.systemConfig.deleteMany({
      where: { key: { startsWith: `integration.${integrationKey}.` } },
    });
  }

  /** Check if integration has any config (DB or env) */
  async isConfigured(integrationKey: string): Promise<boolean> {
    const def = getIntegrationDef(integrationKey);
    if (!def) return false;

    const required = def.fields.filter((f) => f.required);
    for (const field of required) {
      const val = await this.getValue(integrationKey, field.key);
      if (!val) return false;
    }
    return true;
  }
}
```

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh api
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/integrations/
git commit -m "feat(api): add integration registry and config service with encrypted DB storage"
```

---

## Task 2: Integration Test Service

**Files:**
- Create: `apps/api/src/modules/integrations/integrations.service.ts`

- [ ] **Step 1: Create integrations.service.ts**

Service that tests each integration's connection using their respective APIs.

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { IntegrationConfigService } from './integration-config.service';
import { INTEGRATIONS } from './integration-registry';

interface TestResult {
  success: boolean;
  message: string;
  details?: Record<string, any>;
}

interface IntegrationStatus {
  key: string;
  name: string;
  description: string;
  icon: string;
  status: 'connected' | 'not_configured' | 'error';
  lastTestAt?: string;
}

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(private configService: IntegrationConfigService) {}

  async listAll(): Promise<IntegrationStatus[]> {
    const results: IntegrationStatus[] = [];

    for (const def of INTEGRATIONS) {
      const configured = await this.configService.isConfigured(def.key);
      results.push({
        key: def.key,
        name: def.name,
        description: def.description,
        icon: def.icon,
        status: configured ? 'connected' : 'not_configured',
      });
    }

    return results;
  }

  async testConnection(integrationKey: string): Promise<TestResult> {
    const config = await this.configService.getConfig(integrationKey);

    try {
      switch (integrationKey) {
        case 'line-oa':
          return this.testLineOa(config);
        case 'sms':
          return this.testSms(config);
        case 'facebook':
          return this.testFacebook(config);
        case 'paysolutions':
          return this.testPaySolutions(config);
        case 'peak':
          return this.testPeak(config);
        case 'mdm':
          return this.testMdm(config);
        case 'claude-ai':
          return this.testClaudeAi(config);
        case 'email':
          return this.testEmail(config);
        default:
          return { success: false, message: `ไม่รู้จัก integration: ${integrationKey}` };
      }
    } catch (error: any) {
      this.logger.error(`Test failed for ${integrationKey}`, error);
      return { success: false, message: error.message ?? 'เกิดข้อผิดพลาด' };
    }
  }

  private async testLineOa(config: Record<string, string | null>): Promise<TestResult> {
    const token = config.shopChannelToken || config.financeChannelToken;
    if (!token) return { success: false, message: 'ไม่มี Channel Access Token' };

    const res = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { success: false, message: `LINE API error: ${res.status}` };
    const data = await res.json();
    return { success: true, message: `เชื่อมต่อสำเร็จ: ${data.displayName}`, details: { displayName: data.displayName, userId: data.userId } };
  }

  private async testSms(config: Record<string, string | null>): Promise<TestResult> {
    if (!config.apiKey || !config.apiSecret) return { success: false, message: 'ไม่มี API Key/Secret' };

    const res = await fetch('https://bulk.thaibulksms.com/sms-api/v2/credit', {
      method: 'GET',
      headers: { Authorization: `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64')}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { success: false, message: `SMS API error: ${res.status}` };
    const data = await res.json();
    return { success: true, message: `เชื่อมต่อสำเร็จ: เครดิตเหลือ ${data.credit ?? 'N/A'}`, details: data };
  }

  private async testFacebook(config: Record<string, string | null>): Promise<TestResult> {
    if (!config.pageAccessToken) return { success: false, message: 'ไม่มี Page Access Token' };

    const res = await fetch(`https://graph.facebook.com/v25.0/me?fields=name,id&access_token=${config.pageAccessToken}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { success: false, message: `Facebook API error: ${res.status}` };
    const data = await res.json();
    return { success: true, message: `เชื่อมต่อสำเร็จ: ${data.name}`, details: { name: data.name, id: data.id } };
  }

  private async testPaySolutions(config: Record<string, string | null>): Promise<TestResult> {
    if (!config.merchantId || !config.apiKey) return { success: false, message: 'ไม่มี Merchant ID หรือ API Key' };
    // PaySolutions doesn't have a health endpoint — verify by checking config completeness
    return { success: true, message: `ตั้งค่าสำเร็จ: Merchant ${config.merchantId}`, details: { merchantId: config.merchantId } };
  }

  private async testPeak(config: Record<string, string | null>): Promise<TestResult> {
    if (!config.userToken || !config.connectId || !config.secretKey) return { success: false, message: 'ไม่มี credentials ครบ' };

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const crypto = await import('crypto');
    const signature = crypto.createHmac('sha1', config.secretKey).update(timestamp).digest('hex');

    const res = await fetch('https://api.peakaccount.com/api/v1/company', {
      headers: {
        'Authorization': `Bearer ${config.userToken}`,
        'Connect-Id': config.connectId,
        'Time-Stamp': timestamp,
        'Time-Signature': signature,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { success: false, message: `PEAK API error: ${res.status}` };
    const data = await res.json();
    return { success: true, message: `เชื่อมต่อสำเร็จ: ${data.data?.name ?? 'PEAK'}`, details: data.data };
  }

  private async testMdm(config: Record<string, string | null>): Promise<TestResult> {
    if (!config.apiKey) return { success: false, message: 'ไม่มี API Key' };
    const baseUrl = config.baseUrl ?? 'https://mdm-th.com';

    const res = await fetch(`${baseUrl}/api/v1/devices?limit=1`, {
      headers: { 'X-API-Key': config.apiKey },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { success: false, message: `MDM API error: ${res.status}` };
    return { success: true, message: 'เชื่อมต่อ PJ-Soft สำเร็จ' };
  }

  private async testClaudeAi(config: Record<string, string | null>): Promise<TestResult> {
    if (!config.apiKey) return { success: false, message: 'ไม่มี API Key' };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'ping' }] }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { success: false, message: `Anthropic API error: ${res.status}` };
    return { success: true, message: 'เชื่อมต่อ Claude AI สำเร็จ' };
  }

  private async testEmail(config: Record<string, string | null>): Promise<TestResult> {
    if (!config.host || !config.user || !config.pass) return { success: false, message: 'ไม่มี SMTP config ครบ' };

    const nodemailer = await import('nodemailer');
    const port = parseInt(config.port ?? '587', 10);
    const transporter = nodemailer.createTransport({
      host: config.host,
      port,
      secure: port === 465,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
    });

    await transporter.verify();
    return { success: true, message: `เชื่อมต่อ SMTP ${config.host} สำเร็จ` };
  }
}
```

- [ ] **Step 2: Type check + commit**

```bash
./tools/check-types.sh api
git commit -m "feat(api): add IntegrationsService with test connection for all 8 integrations"
```

---

## Task 3: Controller + Module Registration

**Files:**
- Create: `apps/api/src/modules/integrations/integrations.controller.ts`
- Create: `apps/api/src/modules/integrations/integrations.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create controller**

```typescript
// apps/api/src/modules/integrations/integrations.controller.ts
import { Controller, Get, Put, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { IntegrationsService } from './integrations.service';
import { IntegrationConfigService } from './integration-config.service';
import { getIntegrationDef, INTEGRATIONS } from './integration-registry';

@Controller('integrations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IntegrationsController {
  constructor(
    private integrations: IntegrationsService,
    private configService: IntegrationConfigService,
  ) {}

  @Get()
  @Roles('OWNER')
  async listAll() {
    return this.integrations.listAll();
  }

  @Get(':key/config')
  @Roles('OWNER')
  async getConfig(@Param('key') key: string) {
    const def = getIntegrationDef(key);
    if (!def) return { error: 'Integration not found' };
    const masked = await this.configService.getMaskedConfig(key);
    return { integration: def, config: masked };
  }

  @Put(':key/config')
  @Roles('OWNER')
  async saveConfig(@Param('key') key: string, @Body() body: Record<string, string>) {
    await this.configService.saveConfig(key, body);
    return { success: true };
  }

  @Post(':key/test')
  @Roles('OWNER')
  async testConnection(@Param('key') key: string) {
    return this.integrations.testConnection(key);
  }

  @Delete(':key/config')
  @Roles('OWNER')
  async deleteConfig(@Param('key') key: string) {
    await this.configService.deleteConfig(key);
    return { success: true };
  }

  @Get('registry')
  @Roles('OWNER')
  async getRegistry() {
    return INTEGRATIONS.map(({ key, name, description, icon, fields }) => ({
      key, name, description, icon,
      fields: fields.map(({ key, label, sensitive, required, defaultValue }) => ({ key, label, sensitive, required, defaultValue })),
    }));
  }
}
```

- [ ] **Step 2: Create module**

```typescript
// apps/api/src/modules/integrations/integrations.module.ts
import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { IntegrationConfigService } from './integration-config.service';

@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, IntegrationConfigService],
  exports: [IntegrationConfigService],
})
export class IntegrationsModule {}
```

- [ ] **Step 3: Register in app.module.ts**

Add import and register after MdmModule (~line 193).

- [ ] **Step 4: Type check + commit**

```bash
./tools/check-types.sh api
git commit -m "feat(api): add IntegrationsController with CRUD + test endpoints"
```

---

## Task 4: Frontend — Integration Hub Page

**Files:**
- Create: `apps/web/src/pages/IntegrationHubPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 1: Create IntegrationHubPage**

Page with:
- `GET /integrations` → card grid showing all integrations with status badges
- Click card → open Sheet (Radix UI) with form to configure + test
- `GET /integrations/:key/config` → load current config (masked)
- `PUT /integrations/:key/config` → save
- `POST /integrations/:key/test` → test connection
- `GET /integrations/registry` → get field definitions

UI structure:
- PageHeader: "การเชื่อมต่อ" 
- Card grid (2-3 columns): each card shows icon, name, description, status badge
- Status badges: เชื่อมแล้ว (green), ยังไม่ตั้งค่า (gray), มีปัญหา (red)
- Sheet drawer: form with fields per integration definition, show/hide sensitive values toggle, Test Connection button, Save button

Use existing patterns from LineOaSettingsPage: useQuery, useMutation, toast, form state.

For sensitive fields: show toggle eye icon to reveal/hide. When saving, only send fields that were actually changed (skip masked `••••xxxx` values).

- [ ] **Step 2: Add route in App.tsx**

```typescript
const IntegrationHubPage = lazy(() => import('./pages/IntegrationHubPage'));
// Route:
<Route path="/settings/integrations" element={<ProtectedRoute roles={['OWNER']}><IntegrationHubPage /></ProtectedRoute>} />
```

- [ ] **Step 3: Add to OWNER menu in config/menu.ts**

Add to OWNER "ตั้งค่า & ระบบ" section:

```typescript
{ label: 'การเชื่อมต่อ', path: '/settings/integrations', icon: Plug },
```

`Plug` should already be imported.

- [ ] **Step 4: Type check + commit**

```bash
./tools/check-types.sh web
git commit -m "feat(web): add Integration Hub page with card grid and config drawer"
```

---

## Task 5: Final Type Check + Push

**Files:**
- Full verification

- [ ] **Step 1: Full type check**

```bash
./tools/check-types.sh all
```

Expected: 0 errors.

- [ ] **Step 2: Commit + push**

```bash
git commit -m "feat: Integration Hub — centralized settings for all 8 external integrations"
git push
```

---

## Verification

1. **TypeScript**: `./tools/check-types.sh all` — 0 errors
2. **Hub page**: Login as OWNER → `/settings/integrations` → see 8 integration cards
3. **Config save**: Click MDM card → enter API Key + Base URL → Save → reload → values show masked
4. **Test connection**: Click "ทดสอบการเชื่อมต่อ" → see success/failure result
5. **DB storage**: Check SystemConfig table → encrypted values stored
6. **Env fallback**: Remove DB config → service still reads from .env
7. **Masking**: GET config → sensitive fields show `••••xxxx`
