# Yeastar PBX Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เชื่อม BESTCHOICE กับ Yeastar P-Series Cloud Edition PBX เพื่อ click-to-call, inbound screen pop, CDR auto-log, และ recording storage

**Architecture:** Webhook-driven — Yeastar ส่ง events มาที่ public endpoint ของ BESTCHOICE real-time; CDR cron ทุก 15 นาทีเป็น fallback; recording ดาวน์โหลดจาก Yeastar แล้ว upload ขึ้น GCS; socket.io `EventsGateway` (มีอยู่แล้ว) ส่ง inbound popup ไปที่ agent

**Tech Stack:** NestJS + Prisma + native `fetch()` (pattern จาก MDM service) + `@nestjs/schedule` Cron + Socket.io (`EventsGateway`) + React + socket.io-client

**Spec:** `docs/superpowers/specs/2026-04-25-yeastar-pbx-integration-design.md`

---

## File Map

### New Backend Files
- `apps/api/src/modules/yeastar/yeastar-token.service.ts` — OAuth token cache + auto-refresh
- `apps/api/src/modules/yeastar/yeastar-token.service.spec.ts`
- `apps/api/src/modules/yeastar/yeastar.service.ts` — HTTP client (originate, extensions, CDR, recording)
- `apps/api/src/modules/yeastar/yeastar.service.spec.ts`
- `apps/api/src/modules/yeastar/yeastar-webhook.controller.ts` — รับ events จาก Yeastar (public)
- `apps/api/src/modules/yeastar/yeastar-webhook.controller.spec.ts`
- `apps/api/src/modules/yeastar/yeastar-cdr.cron.ts` — fallback CDR pull ทุก 15 นาที
- `apps/api/src/modules/yeastar/yeastar-cdr.cron.spec.ts`
- `apps/api/src/modules/yeastar/yeastar.controller.ts` — click-to-call, extensions list, ping
- `apps/api/src/modules/yeastar/yeastar.module.ts`

### Modified Backend Files
- `apps/api/prisma/schema.prisma` — เพิ่ม `User.yeastarExtension` + `CallLog` fields + `CallDirection` enum
- `apps/api/src/modules/integrations/integration-registry.ts` — เพิ่ม Yeastar entry
- `apps/api/src/modules/users/users.controller.ts` — เพิ่ม `PATCH /users/me/extension`
- `apps/api/src/modules/users/users.service.ts` — เพิ่ม `updateExtension()`
- `apps/api/src/app.module.ts` — register `YeastarModule`

### New Frontend Files
- `apps/web/src/hooks/useYeastarSocket.ts` — socket.io hook สำหรับ inbound events
- `apps/web/src/components/InboundCallPopup.tsx` — popup เมื่อมีสายเข้า
- `apps/web/src/components/CallButton.tsx` — ปุ่มโทรออก (reusable)

### Modified Frontend Files
- `apps/web/src/components/layout/MainLayout.tsx` — mount `InboundCallPopup`
- `apps/web/src/pages/IntegrationHubPage.tsx` — เพิ่ม Yeastar icon map
- `apps/web/src/pages/CollectionsPage/components/ContactLogDialog.tsx` — เพิ่ม recording audio player

---

## Task 1: Prisma — Migration 1 (User.yeastarExtension)

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: เพิ่ม field ใน User model**

ใน `schema.prisma` หา model `User` แล้วเพิ่ม field นี้ต่อจาก fields สุดท้ายก่อน `@@map`:

```prisma
  yeastarExtension  String?  @map("yeastar_extension")
```

- [ ] **Step 2: สร้าง migration**

```bash
cd apps/api
npx prisma migrate dev --name add_user_yeastar_extension
```

Expected: migration file สร้างใน `prisma/migrations/` และ DB อัปเดต

- [ ] **Step 3: Verify schema**

```bash
npx prisma generate
```

Expected: Prisma Client regenerated ไม่มี error

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(yeastar): add User.yeastarExtension field"
```

---

## Task 2: Prisma — Migration 2 (CallLog fields + CallDirection enum)

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: เพิ่ม enum CallDirection**

ในส่วน enums ของ `schema.prisma` (หา enum อื่นๆ เพิ่มต่อท้าย):

```prisma
enum CallDirection {
  INBOUND
  OUTBOUND
}
```

- [ ] **Step 2: เพิ่ม fields ใน CallLog model**

ใน model `CallLog` เพิ่มก่อน `createdAt`:

```prisma
  yeastarCallId             String?        @unique @map("yeastar_call_id")
  callDirection             CallDirection? @map("call_direction")
  duration                  Int?
  recordingUrl              String?        @map("recording_url")
  recordingStorageTier      String?        @default("STANDARD") @map("recording_storage_tier")
  recordingDownloadedAt     DateTime?      @map("recording_downloaded_at")
  yeastarRecordingPath      String?        @map("yeastar_recording_path")
  autoLogged                Boolean        @default(false) @map("auto_logged")
```

- [ ] **Step 3: สร้าง migration**

```bash
cd apps/api
npx prisma migrate dev --name add_calllog_yeastar_fields
```

Expected: migration file สร้างสำเร็จ

- [ ] **Step 4: Verify**

```bash
npx prisma generate
./tools/check-types.sh api
```

Expected: 0 TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(yeastar): add CallLog Yeastar fields + CallDirection enum"
```

---

## Task 3: Integration Registry — เพิ่ม Yeastar Entry

**Files:**
- Modify: `apps/api/src/modules/integrations/integration-registry.ts`

- [ ] **Step 1: เพิ่ม Yeastar entry ใน INTEGRATIONS array**

ใน `integration-registry.ts` เพิ่ม entry นี้ต่อจาก entry สุดท้ายก่อน `]`:

```typescript
  {
    key: 'yeastar',
    name: 'Yeastar PBX',
    description: 'ระบบโทรศัพท์ — click-to-call, screen pop, บันทึกเสียง',
    icon: 'phone',
    webhookUrl: `${BASE}/api/yeastar/webhook`,
    webhookNote: 'ตั้งค่า Webhook URL นี้ที่ Yeastar PBX → Integrations → API → Webhook',
    fields: [
      {
        key: 'pbxUrl',
        label: 'PBX URL',
        sensitive: false,
        required: true,
        defaultValue: '',
        envVar: 'YEASTAR_PBX_URL',
      },
      {
        key: 'clientId',
        label: 'Client ID',
        sensitive: false,
        required: true,
        defaultValue: '',
        envVar: 'YEASTAR_CLIENT_ID',
      },
      {
        key: 'clientSecret',
        label: 'Client Secret',
        sensitive: true,
        required: true,
        defaultValue: '',
        envVar: 'YEASTAR_CLIENT_SECRET',
      },
      {
        key: 'webhookSecret',
        label: 'Webhook Secret Token',
        sensitive: true,
        required: false,
        defaultValue: '',
        envVar: 'YEASTAR_WEBHOOK_SECRET',
      },
    ],
  },
```

- [ ] **Step 2: Verify TypeScript**

```bash
./tools/check-types.sh api
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/integrations/integration-registry.ts
git commit -m "feat(yeastar): register Yeastar in integration registry"
```

---

## Task 4: YeastarTokenService

**Files:**
- Create: `apps/api/src/modules/yeastar/yeastar-token.service.ts`
- Create: `apps/api/src/modules/yeastar/yeastar-token.service.spec.ts`

- [ ] **Step 1: เขียน failing test**

สร้าง `apps/api/src/modules/yeastar/yeastar-token.service.spec.ts`:

```typescript
import { YeastarTokenService } from './yeastar-token.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

const mockConfig = jest.fn();
const mockConfigService = {
  getConfig: mockConfig,
} as unknown as IntegrationConfigService;

describe('YeastarTokenService', () => {
  let service: YeastarTokenService;

  beforeEach(() => {
    service = new YeastarTokenService(mockConfigService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('fetches token when cache is empty', async () => {
    mockConfig.mockResolvedValue({
      pbxUrl: 'https://pbx.example.com',
      clientId: 'test-id',
      clientSecret: 'test-secret',
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'tok-123',
        refresh_token: 'ref-456',
        expires_in: 1800,
      }),
    }) as jest.Mock;

    const token = await service.getToken();
    expect(token).toBe('tok-123');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns cached token on second call', async () => {
    mockConfig.mockResolvedValue({
      pbxUrl: 'https://pbx.example.com',
      clientId: 'test-id',
      clientSecret: 'test-secret',
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'tok-123',
        refresh_token: 'ref-456',
        expires_in: 1800,
      }),
    }) as jest.Mock;

    await service.getToken();
    await service.getToken();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws if Yeastar not configured', async () => {
    mockConfig.mockResolvedValue({ pbxUrl: '', clientId: '', clientSecret: '' });
    await expect(service.getToken()).rejects.toThrow('Yeastar ยังไม่ได้ตั้งค่า');
  });
});
```

- [ ] **Step 2: รัน test ให้ fail**

```bash
cd apps/api
npx jest yeastar-token.service.spec.ts --no-coverage 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: สร้าง YeastarTokenService**

สร้าง `apps/api/src/modules/yeastar/yeastar-token.service.ts`:

```typescript
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { IntegrationConfigService } from '../integrations/integration-config.service';

interface TokenCache {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

@Injectable()
export class YeastarTokenService implements OnModuleDestroy {
  private readonly logger = new Logger(YeastarTokenService.name);
  private cache: TokenCache | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(private readonly configService: IntegrationConfigService) {}

  onModuleDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  /** Return a valid access token, refreshing automatically if needed. */
  async getToken(): Promise<string> {
    const config = await this.configService.getConfig('yeastar');
    if (!config.pbxUrl || !config.clientId || !config.clientSecret) {
      throw new Error('Yeastar ยังไม่ได้ตั้งค่า — กรุณาตั้งค่า PBX URL, Client ID, Client Secret');
    }

    // Refresh if cache is empty or expires in < 2 minutes
    if (!this.cache || this.cache.expiresAt - Date.now() < 2 * 60 * 1000) {
      if (this.cache?.refreshToken) {
        await this.refreshAccessToken(config.pbxUrl, this.cache.refreshToken);
      } else {
        await this.fetchNewToken(config.pbxUrl, config.clientId, config.clientSecret);
      }
    }

    return this.cache!.accessToken;
  }

  /** Revoke current token (called on reconfigure). */
  clearCache() {
    this.cache = null;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async fetchNewToken(pbxUrl: string, clientId: string, clientSecret: string) {
    const url = `${pbxUrl}/openapi/v1.0/get_token`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'BESTCHOICE/1.0',
      },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    });

    if (!res.ok) {
      const text = await res.text();
      Sentry.captureMessage(`[Yeastar] get_token failed: ${res.status} ${text}`, 'error');
      throw new Error(`Yeastar authentication failed: ${res.status}`);
    }

    const data = await res.json();
    this.setCache(data);
    this.logger.log('[Yeastar] Token acquired');
  }

  private async refreshAccessToken(pbxUrl: string, refreshToken: string) {
    try {
      const url = `${pbxUrl}/openapi/v1.0/refresh_token`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'BESTCHOICE/1.0',
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
      const data = await res.json();
      this.setCache(data);
      this.logger.log('[Yeastar] Token refreshed');
    } catch (err) {
      // Fallback: clear cache so next call re-authenticates with credentials
      this.logger.warn('[Yeastar] Token refresh failed, clearing cache');
      this.cache = null;
      Sentry.captureException(err);
      throw err;
    }
  }

  private setCache(data: { access_token: string; refresh_token: string; expires_in: number }) {
    this.cache = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }
}
```

- [ ] **Step 4: รัน test ให้ผ่าน**

```bash
cd apps/api
npx jest yeastar-token.service.spec.ts --no-coverage 2>&1 | tail -5
```

Expected: PASS — 3 tests passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/yeastar/
git commit -m "feat(yeastar): YeastarTokenService with OAuth token cache"
```

---

## Task 5: YeastarService (HTTP Client)

**Files:**
- Create: `apps/api/src/modules/yeastar/yeastar.service.ts`
- Create: `apps/api/src/modules/yeastar/yeastar.service.spec.ts`

- [ ] **Step 1: เขียน failing tests**

สร้าง `apps/api/src/modules/yeastar/yeastar.service.spec.ts`:

```typescript
import { YeastarService } from './yeastar.service';
import { YeastarTokenService } from './yeastar-token.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

const mockTokenService = {
  getToken: jest.fn().mockResolvedValue('tok-123'),
} as unknown as YeastarTokenService;

const mockConfigService = {
  getConfig: jest.fn().mockResolvedValue({
    pbxUrl: 'https://pbx.example.com',
    clientId: 'id',
    clientSecret: 'secret',
  }),
} as unknown as IntegrationConfigService;

describe('YeastarService', () => {
  let service: YeastarService;

  beforeEach(() => {
    service = new YeastarService(mockTokenService, mockConfigService);
    jest.clearAllMocks();
  });

  it('originateCall calls Yeastar dial API', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ call_id: 'call-abc' }),
    }) as jest.Mock;

    const result = await service.originateCall('1001', '0812345678');
    expect(result).toEqual({ callId: 'call-abc' });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/openapi/v1.0/call/dial'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('getExtensions returns list', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        extension_list: [{ number: '1001', name: 'แนน', status: 'Idle' }],
      }),
    }) as jest.Mock;

    const result = await service.getExtensions();
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe('1001');
  });

  it('throws when Yeastar API returns error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad request',
    }) as jest.Mock;

    await expect(service.originateCall('1001', '0812345678')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: รัน test ให้ fail**

```bash
cd apps/api
npx jest yeastar.service.spec.ts --no-coverage 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: สร้าง YeastarService**

สร้าง `apps/api/src/modules/yeastar/yeastar.service.ts`:

```typescript
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { YeastarTokenService } from './yeastar-token.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

export interface YeastarExtension {
  number: string;
  name: string;
  status: string;
}

export interface YeastarCdrRecord {
  id: string;
  callFrom: string;
  callTo: string;
  callType: 'Inbound' | 'Outbound' | 'Internal';
  startTime: string;
  duration: number;
  talkDuration: number;
  answeredBy?: string;
  recordingFile?: string;
}

@Injectable()
export class YeastarService {
  private readonly logger = new Logger(YeastarService.name);

  constructor(
    private readonly tokenService: YeastarTokenService,
    private readonly configService: IntegrationConfigService,
  ) {}

  private async pbxUrl(): Promise<string> {
    const config = await this.configService.getConfig('yeastar');
    return config.pbxUrl.replace(/\/$/, '');
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const [base, token] = await Promise.all([this.pbxUrl(), this.tokenService.getToken()]);
    const url = `${base}/openapi/v1.0${path}?access_token=${token}`;

    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'BESTCHOICE/1.0',
        ...(options.headers ?? {}),
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`[Yeastar] ${path} → ${res.status}: ${text}`);
      Sentry.captureMessage(`[Yeastar] API error ${path}: ${res.status}`, 'error');
      throw new ServiceUnavailableException(`Yeastar API error: ${res.status}`);
    }

    return res.json() as Promise<T>;
  }

  /** สั่งโทรออก: PBX โทรหา extension ก่อน แล้วค่อยต่อไปหา callee */
  async originateCall(extensionNumber: string, callee: string): Promise<{ callId: string }> {
    const data = await this.request<{ call_id: string }>('/call/dial', {
      method: 'POST',
      body: JSON.stringify({ caller: extensionNumber, callee }),
    });
    return { callId: data.call_id };
  }

  /** ดึง extension ทั้งหมดจาก PBX */
  async getExtensions(): Promise<YeastarExtension[]> {
    const data = await this.request<{ extension_list: Array<{ number: string; name: string; status: string }> }>('/extension/list');
    return (data.extension_list ?? []).map((e) => ({
      number: e.number,
      name: e.name,
      status: e.status,
    }));
  }

  /** ทดสอบ connection — return true ถ้าเชื่อมต่อได้ */
  async ping(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.getExtensions();
      return { ok: true, message: 'เชื่อมต่อ Yeastar สำเร็จ' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'เชื่อมต่อไม่ได้' };
    }
  }

  /** ดึง CDR ตาม time range (epoch seconds) */
  async queryCdr(startTime: number, endTime: number): Promise<YeastarCdrRecord[]> {
    const data = await this.request<{ cdr_list?: YeastarCdrRecord[] }>(
      `/cdr/search?start_time=${startTime}&end_time=${endTime}`,
    );
    return data.cdr_list ?? [];
  }

  /** ดาวน์โหลด recording file จาก Yeastar → return Buffer */
  async downloadRecording(recordingPath: string): Promise<Buffer> {
    const [base, token] = await Promise.all([this.pbxUrl(), this.tokenService.getToken()]);
    const url = `${base}/openapi/v1.0/recording/download?access_token=${token}&recording_file=${encodeURIComponent(recordingPath)}`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'BESTCHOICE/1.0' },
    });

    if (!res.ok) {
      throw new Error(`[Yeastar] recording download failed: ${res.status}`);
    }

    return Buffer.from(await res.arrayBuffer());
  }
}
```

- [ ] **Step 4: รัน test ให้ผ่าน**

```bash
cd apps/api
npx jest yeastar.service.spec.ts --no-coverage 2>&1 | tail -5
```

Expected: PASS — 3 tests passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/yeastar/
git commit -m "feat(yeastar): YeastarService HTTP client (originate, extensions, CDR, recording)"
```

---

## Task 6: YeastarWebhookController

**Files:**
- Create: `apps/api/src/modules/yeastar/yeastar-webhook.controller.ts`
- Create: `apps/api/src/modules/yeastar/yeastar-webhook.controller.spec.ts`

- [ ] **Step 1: เขียน failing tests**

สร้าง `apps/api/src/modules/yeastar/yeastar-webhook.controller.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { YeastarWebhookController } from './yeastar-webhook.controller';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsGateway } from '../notifications/events.gateway';

const mockConfigService = {
  getConfig: jest.fn().mockResolvedValue({ webhookSecret: 'secret123' }),
} as unknown as IntegrationConfigService;

const mockPrisma = {
  customer: { findFirst: jest.fn() },
  contract: { findFirst: jest.fn() },
  callLog: { upsert: jest.fn() },
  user: { findFirst: jest.fn() },
} as unknown as PrismaService;

const mockGateway = {
  emitToUser: jest.fn(),
} as unknown as EventsGateway;

describe('YeastarWebhookController', () => {
  let controller: YeastarWebhookController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [YeastarWebhookController],
      providers: [
        { provide: IntegrationConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsGateway, useValue: mockGateway },
      ],
    }).compile();

    controller = module.get(YeastarWebhookController);
    jest.clearAllMocks();
  });

  it('rejects request with wrong token', async () => {
    await expect(
      controller.handleEvent({ event: 'ExtensionCallStatus' }, 'wrong-token'),
    ).rejects.toThrow();
  });

  it('handles ExtensionCallStatus RINGING — emits socket to agent', async () => {
    (mockPrisma.customer.findFirst as jest.Mock).mockResolvedValue({
      id: 'cust-1',
      name: 'สมชาย',
    });
    (mockPrisma.contract.findFirst as jest.Mock).mockResolvedValue({
      id: 'con-1',
      contractNumber: 'BC-001',
    });
    (mockPrisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'user-1' });

    await controller.handleEvent(
      {
        event: 'ExtensionCallStatus',
        callId: 'call-abc',
        callStatus: 'RINGING',
        callerNumber: '0812345678',
        answeredBy: '1001',
      },
      'secret123',
    );

    expect(mockGateway.emitToUser).toHaveBeenCalledWith(
      'user-1',
      'yeastar:inbound',
      expect.objectContaining({ callerNumber: '0812345678' }),
    );
  });

  it('skips NewCdr when no matching customer', async () => {
    (mockPrisma.customer.findFirst as jest.Mock).mockResolvedValue(null);

    await controller.handleEvent(
      {
        event: 'NewCdr',
        id: 'cdr-1',
        callFrom: '0899999999',
        callTo: '1001',
        duration: 120,
        startTime: '2026-04-25T10:00:00Z',
        callType: 'Inbound',
      },
      'secret123',
    );

    expect(mockPrisma.callLog.upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: รัน test ให้ fail**

```bash
cd apps/api
npx jest yeastar-webhook.controller.spec.ts --no-coverage 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: สร้าง YeastarWebhookController**

สร้าง `apps/api/src/modules/yeastar/yeastar-webhook.controller.ts`:

```typescript
import {
  Controller,
  Post,
  Body,
  Query,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { EventsGateway } from '../notifications/events.gateway';
import { CallDirection } from '@prisma/client';

/**
 * รับ events จาก Yeastar PBX — intentionally public (ไม่มี JwtAuthGuard)
 * ตรวจสอบด้วย query param ?token=<webhookSecret> ที่ตั้งไว้ใน IntegrationConfig
 */
@Controller('yeastar/webhook')
export class YeastarWebhookController {
  private readonly logger = new Logger(YeastarWebhookController.name);

  constructor(
    private readonly configService: IntegrationConfigService,
    private readonly prisma: PrismaService,
    private readonly gateway: EventsGateway,
  ) {}

  @Post()
  async handleEvent(@Body() body: Record<string, unknown>, @Query('token') token: string) {
    await this.verifyToken(token);

    const event = body.event as string;
    this.logger.debug(`[Yeastar Webhook] event: ${event}`);

    try {
      if (event === 'ExtensionCallStatus') {
        await this.handleCallStatus(body);
      } else if (event === 'NewCdr') {
        await this.handleNewCdr(body);
      }
    } catch (err) {
      Sentry.captureException(err, { extra: { event, body } });
      this.logger.error(`[Yeastar Webhook] error handling ${event}`, err);
    }

    return { ok: true };
  }

  private async verifyToken(token: string) {
    const config = await this.configService.getConfig('yeastar');
    const secret = config.webhookSecret;

    if (!secret) return; // ถ้าไม่ตั้ง webhookSecret → ข้ามการตรวจ (dev mode)

    if (!token) throw new UnauthorizedException('Missing webhook token');

    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      Sentry.captureMessage('[Yeastar] Invalid webhook token — possible spoofing', 'warning');
      throw new UnauthorizedException('Invalid webhook token');
    }
  }

  private async handleCallStatus(body: Record<string, unknown>) {
    const callStatus = body.callStatus as string;
    if (callStatus !== 'RINGING' && callStatus !== 'ANSWERED') return;

    const callerNumber = body.callerNumber as string;
    const answeredBy = body.answeredBy as string | undefined;
    const callId = body.callId as string;

    // หา customer จาก caller ID
    const customer = await this.prisma.customer.findFirst({
      where: { phone: callerNumber, deletedAt: null },
      select: { id: true, name: true },
    });

    // หา contract active ของ customer
    const contract = customer
      ? await this.prisma.contract.findFirst({
          where: {
            customerId: customer.id,
            status: { in: ['ACTIVE', 'OVERDUE'] },
            deletedAt: null,
          },
          select: {
            id: true,
            contractNumber: true,
          },
          orderBy: { createdAt: 'desc' },
        })
      : null;

    // หา agent จาก extension
    const agentUser = answeredBy
      ? await this.prisma.user.findFirst({
          where: { yeastarExtension: answeredBy, deletedAt: null },
          select: { id: true },
        })
      : null;

    if (agentUser) {
      this.gateway.emitToUser(agentUser.id, 'yeastar:inbound', {
        callId,
        callerNumber,
        customer: customer ? { id: customer.id, name: customer.name } : null,
        contract: contract
          ? {
              id: contract.id,
              contractNumber: contract.contractNumber,
            }
          : null,
      });
    }
  }

  private async handleNewCdr(body: Record<string, unknown>) {
    const cdrId = body.id as string;
    const callFrom = body.callFrom as string;
    const callTo = body.callTo as string;
    const callType = body.callType as string;
    const duration = body.talkDuration as number ?? body.duration as number ?? 0;
    const startTime = new Date(body.startTime as string);
    const recordingFile = body.recordingFile as string | undefined;

    // ตรวจสอบว่าเป็น inbound หรือ outbound
    const direction: CallDirection =
      callType === 'Inbound' ? CallDirection.INBOUND : CallDirection.OUTBOUND;

    // เบอร์ลูกค้า = caller ถ้า inbound, callee ถ้า outbound
    const customerPhone = direction === CallDirection.INBOUND ? callFrom : callTo;

    // หา customer + contract
    const customer = await this.prisma.customer.findFirst({
      where: { phone: customerPhone, deletedAt: null },
      select: { id: true },
    });

    if (!customer) return;

    const contract = await this.prisma.contract.findFirst({
      where: {
        customerId: customer.id,
        status: { in: ['ACTIVE', 'OVERDUE'] },
        deletedAt: null,
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!contract) return;

    // หา caller user (agent) จาก extension
    const agentExtension = direction === CallDirection.INBOUND ? callTo : callFrom;
    const agentUser = await this.prisma.user.findFirst({
      where: { yeastarExtension: agentExtension, deletedAt: null },
      select: { id: true },
    });

    await this.prisma.callLog.upsert({
      where: { yeastarCallId: cdrId },
      create: {
        contractId: contract.id,
        callerId: agentUser?.id ?? 'system',
        calledAt: startTime,
        result: 'AUTO_LOGGED',
        yeastarCallId: cdrId,
        callDirection: direction,
        duration,
        yeastarRecordingPath: recordingFile ?? null,
        autoLogged: true,
      },
      update: {
        duration,
        yeastarRecordingPath: recordingFile ?? null,
      },
    });

    this.logger.log(`[Yeastar] Auto-logged CDR ${cdrId} → contract ${contract.id}`);
  }
}
```

- [ ] **Step 4: รัน test ให้ผ่าน**

```bash
cd apps/api
npx jest yeastar-webhook.controller.spec.ts --no-coverage 2>&1 | tail -5
```

Expected: PASS — 3 tests passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/yeastar/
git commit -m "feat(yeastar): YeastarWebhookController for inbound events + CDR auto-log"
```

---

## Task 7: YeastarCdrCron (Fallback)

**Files:**
- Create: `apps/api/src/modules/yeastar/yeastar-cdr.cron.ts`
- Create: `apps/api/src/modules/yeastar/yeastar-cdr.cron.spec.ts`

- [ ] **Step 1: เขียน failing test**

สร้าง `apps/api/src/modules/yeastar/yeastar-cdr.cron.spec.ts`:

```typescript
import { YeastarCdrCron } from './yeastar-cdr.cron';
import { YeastarService } from './yeastar.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

const mockYeastarService = {
  queryCdr: jest.fn(),
  downloadRecording: jest.fn(),
} as unknown as YeastarService;

const mockPrisma = {
  callLog: {
    upsert: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
  },
  customer: { findFirst: jest.fn() },
  contract: { findFirst: jest.fn() },
  user: { findFirst: jest.fn() },
} as unknown as PrismaService;

const mockConfigService = {
  isConfigured: jest.fn().mockResolvedValue(true),
} as unknown as IntegrationConfigService;

describe('YeastarCdrCron', () => {
  let cron: YeastarCdrCron;

  beforeEach(() => {
    cron = new YeastarCdrCron(mockYeastarService, mockPrisma, mockConfigService);
    jest.clearAllMocks();
  });

  it('skips run if Yeastar not configured', async () => {
    (mockConfigService.isConfigured as jest.Mock).mockResolvedValueOnce(false);
    await cron.pullCdr();
    expect(mockYeastarService.queryCdr).not.toHaveBeenCalled();
  });

  it('processes CDR records and upserts CallLog', async () => {
    (mockYeastarService.queryCdr as jest.Mock).mockResolvedValue([
      {
        id: 'cdr-1',
        callFrom: '0812345678',
        callTo: '1001',
        callType: 'Inbound',
        startTime: '2026-04-25T10:00:00Z',
        duration: 120,
        talkDuration: 100,
      },
    ]);
    (mockPrisma.customer.findFirst as jest.Mock).mockResolvedValue({ id: 'cust-1' });
    (mockPrisma.contract.findFirst as jest.Mock).mockResolvedValue({ id: 'con-1' });
    (mockPrisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'user-1' });

    await cron.pullCdr();

    expect(mockPrisma.callLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { yeastarCallId: 'cdr-1' },
      }),
    );
  });
});
```

- [ ] **Step 2: รัน test ให้ fail**

```bash
cd apps/api
npx jest yeastar-cdr.cron.spec.ts --no-coverage 2>&1 | tail -5
```

Expected: FAIL

- [ ] **Step 3: สร้าง YeastarCdrCron**

สร้าง `apps/api/src/modules/yeastar/yeastar-cdr.cron.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { CallDirection } from '@prisma/client';
import { YeastarService } from './yeastar.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

@Injectable()
export class YeastarCdrCron {
  private readonly logger = new Logger(YeastarCdrCron.name);

  constructor(
    private readonly yeastar: YeastarService,
    private readonly prisma: PrismaService,
    private readonly configService: IntegrationConfigService,
  ) {}

  /** ดึง CDR ทุก 15 นาที — fallback ถ้า webhook พลาด */
  @Cron('*/15 * * * *', { timeZone: 'Asia/Bangkok' })
  async pullCdr(): Promise<void> {
    const configured = await this.configService.isConfigured('yeastar');
    if (!configured) return;

    try {
      const now = Math.floor(Date.now() / 1000);
      const from = now - 20 * 60; // ย้อนหลัง 20 นาที (overlap 5 นาที)

      const records = await this.yeastar.queryCdr(from, now);
      let processed = 0;

      for (const cdr of records) {
        const saved = await this.processCdr(cdr);
        if (saved) processed++;
      }

      if (processed > 0) {
        this.logger.log(`[YeastarCdrCron] processed ${processed}/${records.length} CDR records`);
      }

      // Retry pending recording downloads
      await this.retryPendingRecordings();
    } catch (err) {
      Sentry.captureException(err, { tags: { cron: 'YeastarCdrCron' } });
      this.logger.error('[YeastarCdrCron] failed', err);
    }
  }

  async processCdr(cdr: {
    id: string;
    callFrom: string;
    callTo: string;
    callType: string;
    startTime: string;
    duration?: number;
    talkDuration?: number;
    recordingFile?: string;
  }): Promise<boolean> {
    const direction: CallDirection =
      cdr.callType === 'Inbound' ? CallDirection.INBOUND : CallDirection.OUTBOUND;

    const customerPhone = direction === CallDirection.INBOUND ? cdr.callFrom : cdr.callTo;

    const customer = await this.prisma.customer.findFirst({
      where: { phone: customerPhone, deletedAt: null },
      select: { id: true },
    });
    if (!customer) return false;

    const contract = await this.prisma.contract.findFirst({
      where: {
        customerId: customer.id,
        status: { in: ['ACTIVE', 'OVERDUE'] },
        deletedAt: null,
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!contract) return false;

    const agentExtension = direction === CallDirection.INBOUND ? cdr.callTo : cdr.callFrom;
    const agentUser = await this.prisma.user.findFirst({
      where: { yeastarExtension: agentExtension, deletedAt: null },
      select: { id: true },
    });

    await this.prisma.callLog.upsert({
      where: { yeastarCallId: cdr.id },
      create: {
        contractId: contract.id,
        callerId: agentUser?.id ?? 'system',
        calledAt: new Date(cdr.startTime),
        result: 'AUTO_LOGGED',
        yeastarCallId: cdr.id,
        callDirection: direction,
        duration: cdr.talkDuration ?? cdr.duration ?? 0,
        yeastarRecordingPath: cdr.recordingFile ?? null,
        autoLogged: true,
      },
      update: {
        duration: cdr.talkDuration ?? cdr.duration ?? 0,
        yeastarRecordingPath: cdr.recordingFile ?? null,
      },
    });

    return true;
  }

  /** Retry downloading recordings ที่ยังไม่มี recordingUrl */
  private async retryPendingRecordings(): Promise<void> {
    const pending = await this.prisma.callLog.findMany({
      where: {
        yeastarRecordingPath: { not: null },
        recordingUrl: null,
        deletedAt: null,
      },
      select: { id: true, contractId: true, yeastarRecordingPath: true },
      take: 10,
    });

    for (const log of pending) {
      try {
        const buffer = await this.yeastar.downloadRecording(log.yeastarRecordingPath!);
        // TODO Task 8: upload to GCS and update recordingUrl
        this.logger.debug(`[YeastarCdrCron] Downloaded recording for CallLog ${log.id} (${buffer.length} bytes)`);
      } catch (err) {
        Sentry.captureException(err, { extra: { callLogId: log.id } });
      }
    }
  }
}
```

- [ ] **Step 4: รัน test ให้ผ่าน**

```bash
cd apps/api
npx jest yeastar-cdr.cron.spec.ts --no-coverage 2>&1 | tail -5
```

Expected: PASS — 2 tests passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/yeastar/
git commit -m "feat(yeastar): YeastarCdrCron fallback CDR pull every 15 min"
```

---

## Task 8: YeastarController + YeastarModule + PATCH /users/me/extension

**Files:**
- Create: `apps/api/src/modules/yeastar/yeastar.controller.ts`
- Create: `apps/api/src/modules/yeastar/yeastar.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/modules/users/users.controller.ts`
- Modify: `apps/api/src/modules/users/users.service.ts`

- [ ] **Step 1: สร้าง YeastarController**

สร้าง `apps/api/src/modules/yeastar/yeastar.controller.ts`:

```typescript
import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { YeastarService } from './yeastar.service';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('yeastar')
@UseGuards(JwtAuthGuard, RolesGuard)
export class YeastarController {
  constructor(
    private readonly yeastar: YeastarService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('call/originate')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async originateCall(
    @Body() body: { customerId: string; contractId: string },
    @CurrentUser() user: { id: string },
  ) {
    const agent = await this.prisma.user.findFirst({
      where: { id: user.id, deletedAt: null },
      select: { yeastarExtension: true, displayName: true },
    });

    if (!agent?.yeastarExtension) {
      throw new BadRequestException('กรุณาตั้ง Extension Yeastar ใน Profile ก่อนโทรออก');
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: body.customerId, deletedAt: null },
      select: { phone: true, name: true },
    });

    if (!customer?.phone) {
      throw new BadRequestException('ไม่พบเบอร์โทรของลูกค้า');
    }

    return this.yeastar.originateCall(agent.yeastarExtension, customer.phone);
  }

  @Get('extensions')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async listExtensions() {
    return this.yeastar.getExtensions();
  }

  @Get('ping')
  @Roles('OWNER')
  async ping() {
    return this.yeastar.ping();
  }
}
```

- [ ] **Step 2: สร้าง YeastarModule**

สร้าง `apps/api/src/modules/yeastar/yeastar.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { YeastarTokenService } from './yeastar-token.service';
import { YeastarService } from './yeastar.service';
import { YeastarController } from './yeastar.controller';
import { YeastarWebhookController } from './yeastar-webhook.controller';
import { YeastarCdrCron } from './yeastar-cdr.cron';
import { IntegrationsModule } from '../integrations/integrations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  imports: [IntegrationsModule, NotificationsModule],
  controllers: [YeastarController, YeastarWebhookController],
  providers: [YeastarTokenService, YeastarService, YeastarCdrCron, PrismaService],
  exports: [YeastarService],
})
export class YeastarModule {}
```

- [ ] **Step 3: Register YeastarModule ใน app.module.ts**

ใน `apps/api/src/app.module.ts` เพิ่ม import:

```typescript
// เพิ่มใน imports list
import { YeastarModule } from './modules/yeastar/yeastar.module';
```

และเพิ่ม `YeastarModule` ใน `imports: [...]` array

- [ ] **Step 4: เพิ่ม PATCH /users/me/extension ใน UsersService**

ใน `apps/api/src/modules/users/users.service.ts` เพิ่ม method:

```typescript
async updateExtension(userId: string, extension: string | null): Promise<void> {
  await this.prisma.user.update({
    where: { id: userId },
    data: { yeastarExtension: extension || null },
  });
}
```

- [ ] **Step 5: เพิ่ม PATCH /users/me/extension ใน UsersController**

ใน `apps/api/src/modules/users/users.controller.ts` เพิ่ม:

```typescript
@Patch('me/extension')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
updateExtension(
  @CurrentUser('id') userId: string,
  @Body('extension') extension: string,
) {
  return this.usersService.updateExtension(userId, extension);
}
```

- [ ] **Step 6: TypeScript check**

```bash
./tools/check-types.sh api
```

Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/yeastar/ apps/api/src/app.module.ts apps/api/src/modules/users/
git commit -m "feat(yeastar): YeastarModule + controller + PATCH /users/me/extension"
```

---

## Task 9: Frontend — Profile Extension Field

**Files:**
- ค้นหาหน้า Profile หรือ Settings page ที่ user แก้ข้อมูลส่วนตัวได้

- [ ] **Step 1: ค้นหา Profile page**

```bash
grep -r "displayName\|me/signature\|updateProfile\|profile" apps/web/src --include="*.tsx" -l | head -10
```

บันทึก path ของไฟล์ที่เจอ แล้วดู structure ของ profile section

- [ ] **Step 2: เพิ่ม Extension field ใน Profile**

ในไฟล์ที่เจอ เพิ่ม section สำหรับตั้ง Yeastar extension:

```tsx
// เพิ่ม state
const [extension, setExtension] = useState('');
const [extLoading, setExtLoading] = useState(false);

// โหลด extensions จาก PBX
const { data: pbxExtensions } = useQuery({
  queryKey: ['yeastar-extensions'],
  queryFn: () => api.get('/yeastar/extensions').then((r) => r.data as Array<{ number: string; name: string }>),
  staleTime: 5 * 60 * 1000,
});

// บันทึก extension
const saveExtension = async () => {
  setExtLoading(true);
  try {
    await api.patch('/users/me/extension', { extension });
    toast.success('บันทึก Extension สำเร็จ');
  } catch {
    toast.error('บันทึกไม่สำเร็จ');
  } finally {
    setExtLoading(false);
  }
};
```

```tsx
{/* Yeastar Extension Section */}
<div className="space-y-2">
  <label className="text-sm font-medium">Extension Yeastar</label>
  <div className="flex gap-2">
    <Select value={extension} onValueChange={setExtension}>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="เลือก extension" />
      </SelectTrigger>
      <SelectContent>
        {(pbxExtensions ?? []).map((e) => (
          <SelectItem key={e.number} value={e.number}>
            {e.number} — {e.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    <Button onClick={saveExtension} disabled={extLoading} size="sm">
      {extLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึก'}
    </Button>
  </div>
  <p className="text-xs text-muted-foreground">ใช้สำหรับโทรออกและรับสายผ่านระบบ Yeastar PBX</p>
</div>
```

- [ ] **Step 3: TypeScript check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/
git commit -m "feat(yeastar): profile extension selector"
```

---

## Task 10: Frontend — CallButton Component

**Files:**
- Create: `apps/web/src/components/CallButton.tsx`

- [ ] **Step 1: สร้าง CallButton**

สร้าง `apps/web/src/components/CallButton.tsx`:

```tsx
import { useState } from 'react';
import { Phone, Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CallButtonProps {
  customerId: string;
  contractId: string;
  phone?: string;
  className?: string;
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'icon';
}

export function CallButton({
  customerId,
  contractId,
  phone,
  className,
  variant = 'ghost',
  size = 'sm',
}: CallButtonProps) {
  const [status, setStatus] = useState<'idle' | 'calling' | 'connected'>('idle');

  const { mutate: originate, isPending } = useMutation({
    mutationFn: () =>
      api.post('/yeastar/call/originate', { customerId, contractId }).then((r) => r.data),
    onMutate: () => setStatus('calling'),
    onSuccess: () => {
      setStatus('connected');
      toast.success('กำลังโทรออก — รับสายจากโทรศัพท์ของคุณ');
      setTimeout(() => setStatus('idle'), 10_000);
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setStatus('idle');
      toast.error(err?.response?.data?.message ?? 'โทรออกไม่สำเร็จ');
    },
  });

  return (
    <Button
      variant={variant}
      size={size}
      className={cn('gap-1.5', className)}
      onClick={() => originate()}
      disabled={isPending || status === 'calling' || status === 'connected'}
      title={phone ? `โทร ${phone}` : 'โทรออก'}
    >
      {isPending || status === 'calling' ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Phone className={cn('h-4 w-4', status === 'connected' && 'text-emerald-500')} />
      )}
      {size !== 'icon' && (phone ?? 'โทร')}
    </Button>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/CallButton.tsx
git commit -m "feat(yeastar): CallButton reusable component for click-to-call"
```

---

## Task 11: Frontend — useYeastarSocket + InboundCallPopup

**Files:**
- Create: `apps/web/src/hooks/useYeastarSocket.ts`
- Create: `apps/web/src/components/InboundCallPopup.tsx`
- Modify: `apps/web/src/components/layout/MainLayout.tsx`

- [ ] **Step 1: สร้าง useYeastarSocket hook**

สร้าง `apps/web/src/hooks/useYeastarSocket.ts`:

```typescript
import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/contexts/AuthContext';
import { getAccessToken } from '@/lib/api';
import { API_URL } from '@/lib/env';

export interface InboundCallEvent {
  callId: string;
  callerNumber: string;
  customer: { id: string; name: string } | null;
  contract: {
    id: string;
    contractNumber: string;
  } | null;
}

export function useYeastarSocket(onInbound: (event: InboundCallEvent) => void) {
  const { user } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const onInboundRef = useRef(onInbound);
  onInboundRef.current = onInbound;

  useEffect(() => {
    if (!user) return;

    const token = getAccessToken();
    const socket = io(`${API_URL}/events`, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('yeastar:inbound', (data: InboundCallEvent) => {
      onInboundRef.current(data);
    });

    return () => {
      socket.disconnect();
    };
  }, [user]);
}
```

- [ ] **Step 2: สร้าง InboundCallPopup**

สร้าง `apps/web/src/components/InboundCallPopup.tsx`:

```tsx
import { useState, useCallback } from 'react';
import { Phone, X, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useYeastarSocket, InboundCallEvent } from '@/hooks/useYeastarSocket';
import { cn } from '@/lib/utils';

export function InboundCallPopup() {
  const navigate = useNavigate();
  const [popup, setPopup] = useState<InboundCallEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [dismissTimer, setDismissTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleInbound = useCallback((event: InboundCallEvent) => {
    setPopup(event);
    setVisible(true);

    // auto-dismiss หลัง 30 วินาที
    if (dismissTimer) clearTimeout(dismissTimer);
    const timer = setTimeout(() => setVisible(false), 30_000);
    setDismissTimer(timer);
  }, [dismissTimer]);

  useYeastarSocket(handleInbound);

  if (!visible || !popup) return null;

  const dismiss = () => {
    setVisible(false);
    if (dismissTimer) clearTimeout(dismissTimer);
  };

  return (
    <div className="fixed top-4 right-4 z-50 w-80 animate-in slide-in-from-right-4">
      <Card className="border-emerald-200 shadow-lg">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="rounded-full bg-emerald-100 p-2">
                <Phone className="h-4 w-4 text-emerald-600 animate-pulse" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-snug">สายเข้า</p>
                <p className="text-xs text-muted-foreground leading-snug">{popup.callerNumber}</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={dismiss}>
              <X className="h-3 w-3" />
            </Button>
          </div>

          {popup.customer ? (
            <div className="mt-3 space-y-1">
              <p className="text-sm font-medium leading-snug">{popup.customer.name}</p>
              {popup.contract && (
                <>
                  <p className="text-xs text-muted-foreground leading-snug">
                    สัญญา {popup.contract.contractNumber}
                  </p>
                  <Badge variant="secondary" className="text-xs">
                    {popup.contract.contractNumber}
                  </Badge>
                </>
              )}
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground leading-snug">ไม่พบข้อมูลลูกค้า</p>
          )}

          {popup.contract && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full gap-1.5 text-xs"
              onClick={() => {
                navigate(`/contracts/${popup.contract!.id}`);
                dismiss();
              }}
            >
              <ExternalLink className="h-3 w-3" />
              ดูสัญญา
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: เพิ่ม InboundCallPopup ใน MainLayout**

ใน `apps/web/src/components/layout/MainLayout.tsx`:

เพิ่ม import:
```tsx
import { InboundCallPopup } from '@/components/InboundCallPopup';
```

เพิ่ม component ใน JSX (ก่อน closing div สุดท้าย):
```tsx
<InboundCallPopup />
```

- [ ] **Step 4: TypeScript check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useYeastarSocket.ts apps/web/src/components/InboundCallPopup.tsx apps/web/src/components/layout/MainLayout.tsx
git commit -m "feat(yeastar): inbound call popup via socket + useYeastarSocket hook"
```

---

## Task 12: Frontend — Integration Hub Yeastar Card

**Files:**
- Modify: `apps/web/src/pages/IntegrationHubPage.tsx`

- [ ] **Step 1: เพิ่ม Phone icon ใน ICON_MAP**

ใน `IntegrationHubPage.tsx` หา `ICON_MAP` แล้วเพิ่ม:

```tsx
import { Phone } from 'lucide-react'; // เพิ่มใน lucide-react imports

// ใน ICON_MAP เพิ่ม:
yeastar: Phone,
```

- [ ] **Step 2: TypeScript check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/IntegrationHubPage.tsx
git commit -m "feat(yeastar): add Yeastar to integration hub icon map"
```

---

## Task 13: Frontend — Recording Audio Player ใน ContactLogDialog

**Files:**
- Modify: `apps/web/src/pages/CollectionsPage/components/ContactLogDialog.tsx`

- [ ] **Step 1: ดู CallLog type ที่มีในหน้านี้**

```bash
grep -n "CallLog\|callLog\|recording\|voiceMemo" apps/web/src/pages/CollectionsPage/components/ContactLogDialog.tsx | head -20
```

- [ ] **Step 2: เพิ่ม recording player ใน view mode ของ existing CallLog**

ในส่วนที่แสดง CallLog list items เพิ่ม audio player:

```tsx
{/* Recording Player — auto-logged from Yeastar */}
{log.recordingUrl && (
  <div className="mt-2">
    <p className="text-xs text-muted-foreground leading-snug mb-1">เสียงบันทึกสาย</p>
    {log.recordingStorageTier === 'COLDLINE' ? (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>กำลัง restore... รอสักครู่</span>
      </div>
    ) : (
      <audio
        controls
        src={log.recordingUrl}
        className="w-full h-8"
        preload="none"
      >
        เบราว์เซอร์ไม่รองรับ audio player
      </audio>
    )}
  </div>
)}
{log.yeastarRecordingPath && !log.recordingUrl && (
  <p className="mt-1 text-xs text-muted-foreground leading-snug">
    กำลังดาวน์โหลดเสียงจาก PBX...
  </p>
)}
```

เพิ่ม `Loader2` ใน lucide-react imports ถ้ายังไม่มี

- [ ] **Step 3: ตรวจว่า CallLog type มี fields ใหม่**

ใน type ที่ใช้ใน component เพิ่ม fields:
```tsx
recordingUrl?: string | null;
recordingStorageTier?: string | null;
yeastarRecordingPath?: string | null;
autoLogged?: boolean;
callDirection?: 'INBOUND' | 'OUTBOUND' | null;
```

- [ ] **Step 4: TypeScript check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors

- [ ] **Step 5: Full type check**

```bash
./tools/check-types.sh all
```

Expected: 0 errors ทั้ง api และ web

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/CollectionsPage/components/ContactLogDialog.tsx
git commit -m "feat(yeastar): recording audio player in ContactLogDialog"
```

---

## Task 14: Final Integration Test + CallButton ใน Collections

**Files:**
- Modify: `apps/web/src/pages/CollectionsPage/index.tsx` (หรือ component ที่แสดง customer row)

- [ ] **Step 1: เพิ่ม CallButton ใน Collections หน้าหลัก**

```bash
grep -n "phone\|โทร\|ContactLogDialog" apps/web/src/pages/CollectionsPage/index.tsx | head -15
```

ใน row ที่แสดงข้อมูล contract เพิ่ม `<CallButton>`:

```tsx
import { CallButton } from '@/components/CallButton';

// ใน JSX row:
<CallButton
  customerId={contract.customerId}
  contractId={contract.id}
  phone={contract.customer?.phone}
  size="sm"
  variant="ghost"
/>
```

- [ ] **Step 2: Full type + lint check**

```bash
./tools/check-types.sh all
```

Expected: 0 errors

- [ ] **Step 3: Final commit**

```bash
git add apps/web/src/pages/CollectionsPage/
git commit -m "feat(yeastar): add CallButton to Collections page"
```

---

## Environment Variables ที่ต้องเพิ่ม

ใน `.env.example` และ GCP Secret Manager (ตาม pattern ที่มี):

```bash
YEASTAR_PBX_URL=https://your-pbx.yeastar.com
YEASTAR_CLIENT_ID=your-client-id
YEASTAR_CLIENT_SECRET=your-client-secret
YEASTAR_WEBHOOK_SECRET=random-secret-token-for-webhook-verification
```

เพิ่มใน `deploy-gcp.yml` ใน `--set-secrets` flag ด้วย (ตาม pattern ที่มีสำหรับ LINE secrets)

---

## Spec Coverage Check

| Spec Requirement | Task |
|-----------------|------|
| Click-to-call | Task 8 (controller) + Task 10 (CallButton) + Task 14 |
| Inbound screen pop | Task 6 (webhook) + Task 11 (InboundCallPopup) |
| CDR auto-log | Task 6 (webhook) + Task 7 (cron) |
| Recording download + GCS | Task 7 (cron retryPendingRecordings) — GCS upload ใน retryPendingRecordings is marked TODO; implement alongside storage module |
| User extension mapping | Task 1 (migration) + Task 8 (PATCH endpoint) + Task 9 (Profile UI) |
| OAuth token management | Task 4 (YeastarTokenService) |
| Integration Hub card | Task 3 (registry) + Task 12 (icon) |
| Webhook signature verify | Task 6 (YeastarWebhookController) |
| CDR fallback cron | Task 7 (YeastarCdrCron) |
| Audio player UI | Task 13 (ContactLogDialog) |

> **Note:** Recording upload to GCS (in `retryPendingRecordings`) references existing `StorageService` or GCS client in the codebase. Before implementing Task 7, verify which GCS upload utility is available (`grep -r "Storage\|uploadToGcs\|putObject" apps/api/src --include="*.ts" -l`) and wire it in accordingly. The `recordingUrl` upsert pattern follows the existing `voiceMemoUrl` flow in `CallLog`.
