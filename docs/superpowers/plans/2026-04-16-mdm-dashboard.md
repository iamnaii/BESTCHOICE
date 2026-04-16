# MDM Dashboard & Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MDM Dashboard page, Contract Detail widget, config cache + DB migration, and auto-restrictions cron.

**Architecture:** Backend already has 40 MDM API endpoints. This plan adds: (1) in-memory cache to IntegrationConfigService, (2) MdmService reads config from DB via IntegrationConfigService, (3) MDM Dashboard frontend page with device table + actions, (4) auto-restrictions cron for new devices, (5) MDM widget in Contract Detail page, (6) routing + menu wiring.

**Tech Stack:** NestJS, Prisma, React 18, TypeScript, Tailwind CSS, shadcn/ui, @tanstack/react-query, lucide-react

**Design Spec:** `docs/superpowers/specs/2026-04-16-mdm-dashboard-design.md`

---

## File Map

### Backend (modify)
| File | Responsibility |
|------|---------------|
| `apps/api/src/modules/integrations/integration-config.service.ts` | Add in-memory cache (Map with TTL 5min, invalidate on save/delete) |
| `apps/api/src/modules/mdm/mdm.service.ts` | Replace ConfigService with IntegrationConfigService for API key/base URL |
| `apps/api/src/modules/mdm/mdm.module.ts` | Import IntegrationsModule |
| `apps/api/src/modules/mdm/mdm-auto.cron.ts` | Add auto-restrictions cron (hourly) |

### Backend (create)
| File | Responsibility |
|------|---------------|
| `apps/api/src/modules/mdm/mdm-restrictions.service.ts` | Auto-restrictions logic: find new devices, apply default profile, track processed IDs |

### Frontend (create)
| File | Responsibility |
|------|---------------|
| `apps/web/src/pages/MdmDashboardPage.tsx` | Full MDM device management page: table, toolbar, dialogs |
| `apps/web/src/components/mdm/MdmDeviceWidget.tsx` | Compact MDM status card for Contract Detail page |

### Frontend (modify)
| File | Responsibility |
|------|---------------|
| `apps/web/src/App.tsx` | Add lazy import + route for `/mdm` |
| `apps/web/src/config/menu.ts` | Add "จัดการอุปกรณ์" menu item under Tools for OWNER, FINANCE_MANAGER, BRANCH_MANAGER |
| `apps/web/src/pages/ContractDetailPage.tsx` | Import + render MdmDeviceWidget below product info section |

---

## Task 1: IntegrationConfigService — Add Cache Layer

**Files:**
- Modify: `apps/api/src/modules/integrations/integration-config.service.ts`

- [ ] **Step 1: Add cache data structure and TTL constant**

Add after line 15 (`private readonly logger`):

```typescript
private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
private cache = new Map<string, { config: IntegrationConfig; cachedAt: number }>();
```

- [ ] **Step 2: Add private helper to check cache freshness**

Add after the `mask()` method (after line 38):

```typescript
/** Check if cached entry is still fresh. */
private getCached(integrationKey: string): IntegrationConfig | null {
  const entry = this.cache.get(integrationKey);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > IntegrationConfigService.CACHE_TTL_MS) {
    this.cache.delete(integrationKey);
    return null;
  }
  return entry.config;
}
```

- [ ] **Step 3: Update `getConfig()` to use cache**

Replace the existing `getConfig` method (lines 76-86) with:

```typescript
async getConfig(integrationKey: string): Promise<IntegrationConfig> {
  // Check cache first
  const cached = this.getCached(integrationKey);
  if (cached) return cached;

  const def = getIntegrationDef(integrationKey);
  if (!def) throw new NotFoundException(`Integration '${integrationKey}' not found`);

  const result: IntegrationConfig = {};
  for (const field of def.fields) {
    const value = await this.getValue(integrationKey, field.key);
    result[field.key] = value ?? '';
  }

  // Store in cache
  this.cache.set(integrationKey, { config: result, cachedAt: Date.now() });
  return result;
}
```

- [ ] **Step 4: Invalidate cache on `saveConfig()`**

Add at the end of `saveConfig()` method, before the closing brace (after line 140):

```typescript
    // Invalidate cache so next read picks up new values
    this.cache.delete(integrationKey);
```

- [ ] **Step 5: Invalidate cache on `deleteConfig()`**

Add at the end of `deleteConfig()` method, before the closing brace (after line 159):

```typescript
    this.cache.delete(integrationKey);
```

- [ ] **Step 6: Run type check**

Run: `./tools/check-types.sh api`
Expected: `API: OK`

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/integrations/integration-config.service.ts
git commit -m "feat: add in-memory cache to IntegrationConfigService (TTL 5min, invalidate on save/delete)"
```

---

## Task 2: MdmService — DB→Service Migration

**Files:**
- Modify: `apps/api/src/modules/mdm/mdm.module.ts`
- Modify: `apps/api/src/modules/mdm/mdm.service.ts`

- [ ] **Step 1: Update MdmModule to import IntegrationsModule**

Replace `apps/api/src/modules/mdm/mdm.module.ts` content:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { MdmAutoCron } from './mdm-auto.cron';
import { MdmAutoService } from './mdm-auto.service';
import { MdmController } from './mdm.controller';
import { MdmService } from './mdm.service';

@Module({
  imports: [PrismaModule, LineOaModule, IntegrationsModule],
  controllers: [MdmController],
  providers: [MdmService, MdmAutoService, MdmAutoCron],
  exports: [MdmService, MdmAutoService],
})
export class MdmModule {}
```

- [ ] **Step 2: Update MdmService constructor + config methods**

In `apps/api/src/modules/mdm/mdm.service.ts`:

Replace the import section (line 2) — add IntegrationConfigService:

```typescript
import { ConfigService } from '@nestjs/config';
import { IntegrationConfigService } from '../integrations/integration-config.service';
```

Replace the constructor (around lines 86-91):

```typescript
constructor(
  private prisma: PrismaService,
  private configService: ConfigService,
  private integrationConfig: IntegrationConfigService,
) {}
```

Replace the three private config methods (`getApiKey`, `getBaseUrl`, and the removed `getSubPassword`):

```typescript
private async getApiKey(): Promise<string> {
  return (await this.integrationConfig.getValue('mdm', 'apiKey')) || '';
}

private async getBaseUrl(): Promise<string> {
  return (await this.integrationConfig.getValue('mdm', 'baseUrl')) || 'https://mdm-th.com';
}
```

- [ ] **Step 3: Update `isConfigured()` and `getStatus()` to be async**

```typescript
async isConfigured(): Promise<boolean> {
  return !!(await this.getApiKey());
}

async getStatus(): Promise<{ configured: boolean; baseUrl: string; message: string; rateLimit: MdmRateLimit | null }> {
  const configured = await this.isConfigured();
  return {
    configured,
    baseUrl: await this.getBaseUrl(),
    message: configured
      ? 'MDM PJ-Soft เชื่อมต่อแล้ว'
      : 'ยังไม่ได้ตั้งค่า — ต้องการ MDM_API_KEY',
    rateLimit: this.rateLimit,
  };
}
```

- [ ] **Step 4: Update all methods that call `isConfigured()` to await it**

Every method in mdm.service.ts that does `if (!this.isConfigured())` must change to `if (!(await this.isConfigured()))`. These methods are:
- `listDevices`
- `getDeviceTypes`
- `getDeviceById`
- `findDeviceByImei`
- `findDeviceBySerial`
- `getDeviceLocation`
- `lockDeviceByImei`
- `unlockDeviceByImei`
- `getDeviceStatus`

For each, change `if (!this.isConfigured())` to `if (!(await this.isConfigured()))`.

- [ ] **Step 5: Update `request()` method to use async config**

In the private `request()` method, replace the sync config reads:

```typescript
const url = `${await this.getBaseUrl()}${path}`;
const options: RequestInit = {
  method,
  headers: {
    'X-API-Key': await this.getApiKey(),
    'Content-Type': 'application/json',
  },
  signal: controller.signal,
};
```

- [ ] **Step 6: Run type check**

Run: `./tools/check-types.sh api`
Expected: `API: OK`

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/mdm/mdm.module.ts apps/api/src/modules/mdm/mdm.service.ts
git commit -m "feat: MdmService reads config from IntegrationConfigService (DB→env fallback with cache)"
```

---

## Task 3: MdmRestrictionsService + Cron

**Files:**
- Create: `apps/api/src/modules/mdm/mdm-restrictions.service.ts`
- Modify: `apps/api/src/modules/mdm/mdm-auto.cron.ts`
- Modify: `apps/api/src/modules/mdm/mdm.module.ts`

- [ ] **Step 1: Create MdmRestrictionsService**

Create `apps/api/src/modules/mdm/mdm-restrictions.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { MdmService } from './mdm.service';

export interface AutoRestrictionsResult {
  applied: number;
  skipped: number;
  failed: number;
}

@Injectable()
export class MdmRestrictionsService {
  private readonly logger = new Logger(MdmRestrictionsService.name);

  constructor(
    private prisma: PrismaService,
    private mdmService: MdmService,
  ) {}

  /** Read auto-restrictions settings from SystemConfig. */
  async getSettings(): Promise<{
    enabled: boolean;
    profile: Record<string, number>;
  }> {
    const keys = ['mdm.autoRestrictionsEnabled', 'mdm.autoRestrictionsProfile'];
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { in: keys }, deletedAt: null },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));

    let profile: Record<string, number> = {
      allowCamera: 1,
      allowScreenCapture: 0,
      allowAppInstallation: 0,
      allowSafari: 1,
    };

    try {
      const raw = map.get('mdm.autoRestrictionsProfile');
      if (raw) profile = JSON.parse(raw);
    } catch {
      this.logger.warn('Invalid mdm.autoRestrictionsProfile JSON — using defaults');
    }

    return {
      enabled: map.get('mdm.autoRestrictionsEnabled') === 'true',
      profile,
    };
  }

  /** Get set of device IDs that already had restrictions applied. */
  private async getProcessedDeviceIds(): Promise<Set<number>> {
    const record = await this.prisma.systemConfig.findFirst({
      where: { key: 'mdm.restrictedDevices', deletedAt: null },
    });

    if (!record?.value) return new Set();

    try {
      const ids: number[] = JSON.parse(record.value);
      return new Set(ids);
    } catch {
      return new Set();
    }
  }

  /** Persist processed device IDs back to SystemConfig. */
  private async saveProcessedDeviceIds(ids: Set<number>): Promise<void> {
    const value = JSON.stringify([...ids]);
    await this.prisma.systemConfig.upsert({
      where: { key: 'mdm.restrictedDevices' },
      create: { key: 'mdm.restrictedDevices', value, label: 'MDM: auto-restricted device IDs' },
      update: { value, deletedAt: null },
    });
  }

  /**
   * Called by cron hourly. Finds devices enrolled within 24h
   * that haven't had restrictions applied yet.
   */
  async autoApplyRestrictions(): Promise<AutoRestrictionsResult> {
    const settings = await this.getSettings();

    if (!settings.enabled) {
      this.logger.debug('MDM auto-restrictions disabled — skipping');
      return { applied: 0, skipped: 0, failed: 0 };
    }

    if (!(await this.mdmService.isConfigured())) {
      this.logger.debug('MDM not configured — skipping auto-restrictions');
      return { applied: 0, skipped: 0, failed: 0 };
    }

    // Get managed devices (status=1), page through up to 100
    const { devices } = await this.mdmService.listDevices({
      status: 1,
      pageSize: 100,
    });

    // Filter to devices enrolled within last 24h
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recentDevices = devices.filter((d) => {
      if (!d.lastTime) return false;
      return new Date(d.lastTime).getTime() >= cutoff;
    });

    const processedIds = await this.getProcessedDeviceIds();

    // Filter out already-processed
    const newDevices = recentDevices.filter((d) => !processedIds.has(d.id));

    if (newDevices.length === 0) {
      return { applied: 0, skipped: recentDevices.length, failed: 0 };
    }

    let applied = 0;
    let failed = 0;

    // Process max 40 per run (rate limit awareness: 100 req/60s)
    const batch = newDevices.slice(0, 40);

    for (const device of batch) {
      try {
        // Throttle: 1s delay between calls
        if (applied + failed > 0) {
          await new Promise((r) => setTimeout(r, 1000));
        }

        const result = await this.mdmService.installRestrictions(device.id, settings.profile);

        if (result?.code === 200) {
          processedIds.add(device.id);
          applied++;
          this.logger.log(`MDM auto-restrictions: applied to device ${device.id} (${device.deviceId})`);
        } else {
          failed++;
          this.logger.warn(`MDM auto-restrictions: failed for device ${device.id} — ${result?.msg}`);
        }
      } catch (err) {
        failed++;
        this.logger.error(`MDM auto-restrictions: error for device ${device.id}`, err);
        Sentry.captureException(err, {
          tags: { kind: 'mdm-auto-restrictions' },
          extra: { deviceId: device.id },
        });
      }
    }

    // Persist updated processed IDs
    await this.saveProcessedDeviceIds(processedIds);

    return { applied, skipped: recentDevices.length - batch.length, failed };
  }
}
```

- [ ] **Step 2: Register MdmRestrictionsService in MdmModule**

In `apps/api/src/modules/mdm/mdm.module.ts`, add to imports and providers:

```typescript
import { MdmRestrictionsService } from './mdm-restrictions.service';
```

Add `MdmRestrictionsService` to `providers` and `exports` arrays:

```typescript
providers: [MdmService, MdmAutoService, MdmAutoCron, MdmRestrictionsService],
exports: [MdmService, MdmAutoService, MdmRestrictionsService],
```

- [ ] **Step 3: Add auto-restrictions cron to MdmAutoCron**

In `apps/api/src/modules/mdm/mdm-auto.cron.ts`, add import:

```typescript
import { MdmRestrictionsService } from './mdm-restrictions.service';
```

Update constructor:

```typescript
constructor(
  private mdmAuto: MdmAutoService,
  private mdmRestrictions: MdmRestrictionsService,
) {}
```

Add new cron method after the existing one:

```typescript
@Cron('0 * * * *', { timeZone: 'Asia/Bangkok' })
async autoApplyRestrictions(): Promise<void> {
  this.logger.log('Starting MDM auto-restrictions scan');
  try {
    const result = await this.mdmRestrictions.autoApplyRestrictions();
    this.logger.log(
      `MDM auto-restrictions: ${result.applied} applied, ${result.skipped} skipped, ${result.failed} failed`,
    );
  } catch (error) {
    this.logger.error('MDM auto-restrictions cron failed', error);
    Sentry.captureException(error, {
      tags: { kind: 'cron-job', cron: 'mdm-auto-restrictions' },
    });
  }
}
```

- [ ] **Step 4: Run type check**

Run: `./tools/check-types.sh api`
Expected: `API: OK`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/mdm/
git commit -m "feat: add MdmRestrictionsService + hourly auto-restrictions cron for new devices"
```

---

## Task 4: MDM Dashboard Page — Frontend

**Files:**
- Create: `apps/web/src/pages/MdmDashboardPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 1: Create MdmDashboardPage.tsx**

Create `apps/web/src/pages/MdmDashboardPage.tsx`:

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import {
  MoreHorizontal,
  Search,
  Lock,
  Unlock,
  MapPin,
  Eye,
  Shield,
  Type,
  Image,
  Smartphone,
  Copy,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Monitor,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────

interface MdmDevice {
  id: number;
  deviceId: string;
  deviceName: string;
  imei: string;
  name: string;
  phone: string;
  deviceLock: 0 | 1;
  status: 0 | 1 | 2;
  lossStatus: 0 | 1;
  modelType: 0 | 1 | 2;
  productName: string;
  osVersion: string;
  isDel: 0 | 1 | 2;
  lastTime: string;
}

interface DeviceListResponse {
  total: number;
  devices: MdmDevice[];
}

interface DeviceLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: string;
}

// ─── Helpers ──────────────────────────────────────────────

function getStatusBadge(device: MdmDevice) {
  if (device.lossStatus === 1) return <Badge variant="destructive">Lost Mode</Badge>;
  if (device.status === 1) return <Badge className="bg-success/10 text-success border-success/20">Managed</Badge>;
  return <Badge variant="secondary">Not Managed</Badge>;
}

function getModelTypeName(modelType: 0 | 1 | 2): string {
  return modelType === 0 ? 'iPhone' : modelType === 1 ? 'iPad' : 'Mac';
}

function relativeTime(dateStr: string): string {
  if (!dateStr) return '-';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'เมื่อสักครู่';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ชม. ที่แล้ว`;
  const days = Math.floor(hours / 24);
  return `${days} วันที่แล้ว`;
}

// ─── Component ────────────────────────────────────────────

export default function MdmDashboardPage() {
  useDocumentTitle('จัดการอุปกรณ์ MDM');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { copyToClipboard } = useCopyToClipboard();
  const role = user?.role;

  const canLockUnlock = role === 'OWNER' || role === 'FINANCE_MANAGER';
  const canManagePolicy = role === 'OWNER';

  // ─── State ──────────────────────────────────────────────

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [pageNum, setPageNum] = useState(1);
  const pageSize = 20;

  // Dialog states
  const [detailDevice, setDetailDevice] = useState<MdmDevice | null>(null);
  const [lockDevice, setLockDevice] = useState<MdmDevice | null>(null);
  const [lockReason, setLockReason] = useState('');
  const [unlockDevice, setUnlockDevice] = useState<MdmDevice | null>(null);
  const [lockScreenDevice, setLockScreenDevice] = useState<MdmDevice | null>(null);
  const [gpsDevice, setGpsDevice] = useState<MdmDevice | null>(null);
  const [restrictionsDevice, setRestrictionsDevice] = useState<MdmDevice | null>(null);
  const [lockTextDevice, setLockTextDevice] = useState<MdmDevice | null>(null);
  const [lockTextValue, setLockTextValue] = useState('');
  const [wallpaperDevice, setWallpaperDevice] = useState<MdmDevice | null>(null);
  const [restrictions, setRestrictions] = useState({
    allowCamera: 1,
    allowScreenCapture: 1,
    allowAppInstallation: 1,
    allowSafari: 1,
  });

  // ─── Queries ────────────────────────────────────────────

  const buildParams = () => {
    const params: Record<string, string> = {
      pageNum: String(pageNum),
      pageSize: String(pageSize),
    };
    if (debouncedSearch) params.name = debouncedSearch;
    if (statusFilter === 'managed') params.status = '1';
    if (statusFilter === 'not_managed') params.status = '0';
    if (statusFilter === 'lost') params.lossStatus = '1';
    if (typeFilter !== 'all') params.modelType = typeFilter;
    return params;
  };

  const devicesQuery = useQuery<DeviceListResponse>({
    queryKey: ['mdm-devices', pageNum, debouncedSearch, statusFilter, typeFilter],
    queryFn: () => api.get('/mdm/devices', { params: buildParams() }).then((r) => r.data),
  });

  const gpsQuery = useQuery<{ data: DeviceLocation }>({
    queryKey: ['mdm-gps', gpsDevice?.id],
    queryFn: () => api.get(`/mdm/devices/${gpsDevice!.id}/location`).then((r) => r.data),
    enabled: !!gpsDevice,
  });

  const restrictionsQuery = useQuery({
    queryKey: ['mdm-restrictions', restrictionsDevice?.id],
    queryFn: () => api.get(`/mdm/devices/${restrictionsDevice!.id}/restrictions`).then((r) => r.data),
    enabled: !!restrictionsDevice,
  });

  const wallpapersQuery = useQuery({
    queryKey: ['mdm-wallpapers'],
    queryFn: () => api.get('/mdm/devices/wallpapers').then((r) => r.data), // proxied via our controller if needed
    enabled: !!wallpaperDevice,
  });

  // ─── Mutations ──────────────────────────────────────────

  const lockMutation = useMutation({
    mutationFn: (data: { imei: string; reason: string }) => api.post('/mdm/lock', data),
    onSuccess: () => {
      toast.success('ล็อคเครื่องสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['mdm-devices'] });
      setLockDevice(null);
      setLockReason('');
    },
    onError: () => toast.error('ล็อคเครื่องไม่สำเร็จ'),
  });

  const unlockMutation = useMutation({
    mutationFn: (imei: string) => api.post('/mdm/unlock', { imei }),
    onSuccess: () => {
      toast.success('ปลดล็อคเครื่องสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['mdm-devices'] });
      setUnlockDevice(null);
    },
    onError: () => toast.error('ปลดล็อคเครื่องไม่สำเร็จ'),
  });

  const lockScreenMutation = useMutation({
    mutationFn: (id: number) => api.post('/mdm/devices/lock-screen', { id }),
    onSuccess: () => {
      toast.success('ล็อคหน้าจอสำเร็จ');
      setLockScreenDevice(null);
    },
    onError: () => toast.error('ล็อคหน้าจอไม่สำเร็จ'),
  });

  const restrictionsMutation = useMutation({
    mutationFn: (data: { id: number; options: Record<string, number> }) =>
      api.post('/mdm/devices/restrictions', { id: data.id, ...data.options }),
    onSuccess: () => {
      toast.success('ตั้งค่า Restrictions สำเร็จ');
      setRestrictionsDevice(null);
    },
    onError: () => toast.error('ตั้งค่า Restrictions ไม่สำเร็จ'),
  });

  const lockTextMutation = useMutation({
    mutationFn: (data: { id: number; message: string }) =>
      api.post('/mdm/devices/lock-screen-text', data),
    onSuccess: () => {
      toast.success('ตั้งข้อความ Lock Screen สำเร็จ');
      setLockTextDevice(null);
      setLockTextValue('');
    },
    onError: () => toast.error('ตั้งข้อความไม่สำเร็จ'),
  });

  const wallpaperMutation = useMutation({
    mutationFn: (data: { deviceId: number; imageId: number }) =>
      api.post('/mdm/devices/wallpaper', data),
    onSuccess: () => {
      toast.success('ตั้ง Wallpaper สำเร็จ');
      setWallpaperDevice(null);
    },
    onError: () => toast.error('ตั้ง Wallpaper ไม่สำเร็จ'),
  });

  // ─── Pagination ─────────────────────────────────────────

  const total = devicesQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  // ─── Render ─────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title="จัดการอุปกรณ์ MDM"
        subtitle="ดูรายการ ล็อค/ปลดล็อค และจัดการอุปกรณ์ผ่าน MDM PJ-Soft"
      />

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="ค้นหา IMEI, ชื่อ, เบอร์..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPageNum(1); }}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPageNum(1); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="สถานะ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทั้งหมด</SelectItem>
            <SelectItem value="managed">Managed</SelectItem>
            <SelectItem value="lost">Lost Mode</SelectItem>
            <SelectItem value="not_managed">Not Managed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPageNum(1); }}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="ประเภท" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทั้งหมด</SelectItem>
            <SelectItem value="0">iPhone</SelectItem>
            <SelectItem value="1">iPad</SelectItem>
            <SelectItem value="2">Mac</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <QueryBoundary
        isLoading={devicesQuery.isLoading}
        isError={devicesQuery.isError}
        error={devicesQuery.error}
        onRetry={() => devicesQuery.refetch()}
      >
        <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ชื่อ / เบอร์</TableHead>
                <TableHead>รุ่น</TableHead>
                <TableHead>IMEI / Serial</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead>Last Seen</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {devicesQuery.data?.devices.map((device) => (
                <TableRow key={device.id}>
                  <TableCell>
                    <div className="font-medium text-foreground leading-snug">{device.name || '-'}</div>
                    <div className="text-xs text-muted-foreground">{device.phone || '-'}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm leading-snug">{device.productName || getModelTypeName(device.modelType)}</div>
                    <div className="text-xs text-muted-foreground">{device.osVersion || '-'}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono">{device.imei || device.deviceId || '-'}</span>
                      {(device.imei || device.deviceId) && (
                        <button
                          onClick={() => copyToClipboard(device.imei || device.deviceId)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Copy className="size-3" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{getStatusBadge(device)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{relativeTime(device.lastTime)}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setDetailDevice(device)}>
                          <Eye className="size-4 mr-2" /> ดูรายละเอียด
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setGpsDevice(device)}>
                          <MapPin className="size-4 mr-2" /> ดูตำแหน่ง GPS
                        </DropdownMenuItem>

                        {canLockUnlock && (
                          <>
                            <DropdownMenuSeparator />
                            {device.lossStatus !== 1 && (
                              <DropdownMenuItem onClick={() => setLockDevice(device)}>
                                <Lock className="size-4 mr-2" /> ล็อค Lost Mode
                              </DropdownMenuItem>
                            )}
                            {device.lossStatus === 1 && (
                              <DropdownMenuItem onClick={() => setUnlockDevice(device)}>
                                <Unlock className="size-4 mr-2" /> ปลดล็อค
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => setLockScreenDevice(device)}>
                              <Monitor className="size-4 mr-2" /> ล็อคหน้าจอ
                            </DropdownMenuItem>
                          </>
                        )}

                        {canManagePolicy && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setRestrictionsDevice(device)}>
                              <Shield className="size-4 mr-2" /> ตั้ง Restrictions
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setLockTextDevice(device); setLockTextValue(''); }}>
                              <Type className="size-4 mr-2" /> ตั้งข้อความ Lock Screen
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setWallpaperDevice(device)}>
                              <Image className="size-4 mr-2" /> ตั้ง Wallpaper
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {devicesQuery.data?.devices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                    ไม่พบอุปกรณ์
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <span className="text-sm text-muted-foreground">
              แสดง {(pageNum - 1) * pageSize + 1}-{Math.min(pageNum * pageSize, total)} จาก {total}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={pageNum <= 1} onClick={() => setPageNum((p) => p - 1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-sm">{pageNum} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={pageNum >= totalPages} onClick={() => setPageNum((p) => p + 1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </QueryBoundary>

      {/* ─── Dialogs ─────────────────────────────────────── */}

      {/* Detail Dialog */}
      <Dialog open={!!detailDevice} onOpenChange={() => setDetailDevice(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>รายละเอียดอุปกรณ์</DialogTitle>
          </DialogHeader>
          {detailDevice && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">ชื่อ:</span> {detailDevice.name}</div>
              <div><span className="text-muted-foreground">เบอร์:</span> {detailDevice.phone}</div>
              <div><span className="text-muted-foreground">รุ่น:</span> {detailDevice.productName}</div>
              <div><span className="text-muted-foreground">OS:</span> {detailDevice.osVersion}</div>
              <div><span className="text-muted-foreground">IMEI:</span> {detailDevice.imei}</div>
              <div><span className="text-muted-foreground">Serial:</span> {detailDevice.deviceId}</div>
              <div><span className="text-muted-foreground">ประเภท:</span> {getModelTypeName(detailDevice.modelType)}</div>
              <div><span className="text-muted-foreground">สถานะ:</span> {getStatusBadge(detailDevice)}</div>
              <div className="col-span-2"><span className="text-muted-foreground">Last Seen:</span> {relativeTime(detailDevice.lastTime)}</div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Lock Lost Mode Dialog */}
      <Dialog open={!!lockDevice} onOpenChange={() => { setLockDevice(null); setLockReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ล็อคเครื่อง (Lost Mode)</DialogTitle>
            <DialogDescription>
              เครื่องจะแสดงข้อความและเบอร์โทรร้านบนหน้าจอ ลูกค้าจะไม่สามารถใช้งานเครื่องได้
            </DialogDescription>
          </DialogHeader>
          {lockDevice && (
            <div className="space-y-4">
              <div className="text-sm">
                <span className="text-muted-foreground">เครื่อง:</span> {lockDevice.name} — {lockDevice.imei}
              </div>
              <div>
                <Label>เหตุผลในการล็อค *</Label>
                <Textarea
                  value={lockReason}
                  onChange={(e) => setLockReason(e.target.value)}
                  placeholder="เช่น ค้างชำระ 30 วัน"
                  className="mt-1"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setLockDevice(null); setLockReason(''); }}>ยกเลิก</Button>
            <Button
              variant="destructive"
              disabled={!lockReason.trim() || lockMutation.isPending}
              onClick={() => lockDevice && lockMutation.mutate({ imei: lockDevice.imei, reason: lockReason })}
            >
              {lockMutation.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Lock className="size-4 mr-2" />}
              ล็อคเครื่อง
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlock Confirm */}
      <ConfirmDialog
        open={!!unlockDevice}
        onOpenChange={() => setUnlockDevice(null)}
        title="ปลดล็อคเครื่อง"
        description={`ต้องการปลดล็อค ${unlockDevice?.name} (${unlockDevice?.imei}) หรือไม่?`}
        onConfirm={() => unlockDevice && unlockMutation.mutate(unlockDevice.imei)}
        loading={unlockMutation.isPending}
      />

      {/* Lock Screen Confirm */}
      <ConfirmDialog
        open={!!lockScreenDevice}
        onOpenChange={() => setLockScreenDevice(null)}
        title="ล็อคหน้าจอ"
        description={`ล็อคหน้าจอ ${lockScreenDevice?.name} (${lockScreenDevice?.imei})? เครื่องจะส่งเสียงแจ้งเตือน`}
        onConfirm={() => lockScreenDevice && lockScreenMutation.mutate(lockScreenDevice.id)}
        loading={lockScreenMutation.isPending}
      />

      {/* GPS Dialog */}
      <Dialog open={!!gpsDevice} onOpenChange={() => setGpsDevice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ตำแหน่ง GPS — {gpsDevice?.name}</DialogTitle>
          </DialogHeader>
          {gpsQuery.isLoading && <div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>}
          {gpsQuery.data?.data && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Latitude:</span> {gpsQuery.data.data.latitude}</div>
                <div><span className="text-muted-foreground">Longitude:</span> {gpsQuery.data.data.longitude}</div>
                <div><span className="text-muted-foreground">Accuracy:</span> {gpsQuery.data.data.accuracy}m</div>
                <div><span className="text-muted-foreground">เวลา:</span> {gpsQuery.data.data.timestamp}</div>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.open(`https://www.google.com/maps?q=${gpsQuery.data!.data.latitude},${gpsQuery.data!.data.longitude}`, '_blank')}
              >
                <ExternalLink className="size-4 mr-2" /> เปิด Google Maps
              </Button>
            </div>
          )}
          {gpsQuery.isError && <div className="text-sm text-destructive text-center py-4">ไม่สามารถดึงตำแหน่งได้</div>}
        </DialogContent>
      </Dialog>

      {/* Restrictions Dialog */}
      <Dialog open={!!restrictionsDevice} onOpenChange={() => setRestrictionsDevice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ตั้ง Restrictions — {restrictionsDevice?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {[
              { key: 'allowCamera', label: 'กล้อง' },
              { key: 'allowScreenCapture', label: 'Screenshot' },
              { key: 'allowAppInstallation', label: 'ติดตั้งแอป' },
              { key: 'allowSafari', label: 'Safari' },
            ].map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between">
                <Label>{label}</Label>
                <Switch
                  checked={restrictions[key as keyof typeof restrictions] === 1}
                  onCheckedChange={(checked) =>
                    setRestrictions((prev) => ({ ...prev, [key]: checked ? 1 : 0 }))
                  }
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestrictionsDevice(null)}>ยกเลิก</Button>
            <Button
              disabled={restrictionsMutation.isPending}
              onClick={() => restrictionsDevice && restrictionsMutation.mutate({ id: restrictionsDevice.id, options: restrictions })}
            >
              {restrictionsMutation.isPending && <Loader2 className="size-4 animate-spin mr-2" />}
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lock Screen Text Dialog */}
      <Dialog open={!!lockTextDevice} onOpenChange={() => setLockTextDevice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ตั้งข้อความ Lock Screen — {lockTextDevice?.name}</DialogTitle>
          </DialogHeader>
          <div>
            <Label>ข้อความ *</Label>
            <Textarea
              value={lockTextValue}
              onChange={(e) => setLockTextValue(e.target.value)}
              placeholder="เช่น ทรัพย์สินของ BESTCHOICE โทร 0XX-XXXXXXX"
              className="mt-1"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLockTextDevice(null)}>ยกเลิก</Button>
            <Button
              disabled={!lockTextValue.trim() || lockTextMutation.isPending}
              onClick={() => lockTextDevice && lockTextMutation.mutate({ id: lockTextDevice.id, message: lockTextValue })}
            >
              {lockTextMutation.isPending && <Loader2 className="size-4 animate-spin mr-2" />}
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wallpaper Dialog */}
      <Dialog open={!!wallpaperDevice} onOpenChange={() => setWallpaperDevice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ตั้ง Wallpaper — {wallpaperDevice?.name}</DialogTitle>
          </DialogHeader>
          {wallpapersQuery.isLoading && <div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin" /></div>}
          {wallpapersQuery.data?.data && Array.isArray(wallpapersQuery.data.data) && (
            <div className="grid grid-cols-3 gap-3">
              {wallpapersQuery.data.data.map((wp: { id: number; name?: string }) => (
                <button
                  key={wp.id}
                  onClick={() => wallpaperDevice && wallpaperMutation.mutate({ deviceId: wallpaperDevice.id, imageId: wp.id })}
                  className="rounded-lg border border-border p-3 text-center text-sm hover:bg-accent transition-colors"
                  disabled={wallpaperMutation.isPending}
                >
                  <Image className="size-8 mx-auto mb-1 text-muted-foreground" />
                  {wp.name || `#${wp.id}`}
                </button>
              ))}
            </div>
          )}
          {wallpapersQuery.data?.data && !Array.isArray(wallpapersQuery.data.data) && (
            <div className="text-sm text-muted-foreground text-center py-4">ไม่พบ Wallpaper</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Add lazy import and route in App.tsx**

In `apps/web/src/App.tsx`, add the lazy import near the other page imports (around line 8):

```typescript
const MdmDashboardPage = lazy(() => import('@/pages/MdmDashboardPage'));
```

Add the route inside the `<MainLayout>` routes section, near other tool routes:

```tsx
<Route
  path="/mdm"
  element={
    <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER']}>
      <MdmDashboardPage />
    </ProtectedRoute>
  }
/>
```

- [ ] **Step 3: Add menu item in menu.ts**

In `apps/web/src/config/menu.ts`, find the OWNER tools section (`key: 'owner-tools'`) around line 367. Add a new item:

```typescript
{ label: 'จัดการอุปกรณ์', path: '/mdm', icon: Smartphone },
```

Import `Smartphone` from lucide-react at the top of the file if not already imported.

Also add the same menu item to the FINANCE_MANAGER and BRANCH_MANAGER menu sections under their respective tools groups.

- [ ] **Step 4: Run type check**

Run: `./tools/check-types.sh all`
Expected: `TypeScript check passed!`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/MdmDashboardPage.tsx apps/web/src/App.tsx apps/web/src/config/menu.ts
git commit -m "feat: add MDM Dashboard page with device table, search/filter, lock/unlock, GPS, restrictions, wallpaper"
```

---

## Task 5: Contract Detail — MDM Widget

**Files:**
- Create: `apps/web/src/components/mdm/MdmDeviceWidget.tsx`
- Modify: `apps/web/src/pages/ContractDetailPage.tsx`

- [ ] **Step 1: Create MdmDeviceWidget component**

Create `apps/web/src/components/mdm/MdmDeviceWidget.tsx`:

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Lock, Unlock, MapPin, Loader2, ExternalLink, Smartphone } from 'lucide-react';

interface MdmDevice {
  id: number;
  deviceId: string;
  deviceName: string;
  imei: string;
  name: string;
  phone: string;
  deviceLock: 0 | 1;
  status: 0 | 1 | 2;
  lossStatus: 0 | 1;
  modelType: 0 | 1 | 2;
  productName: string;
  osVersion: string;
  lastTime: string;
}

interface DeviceStatusResponse {
  found: boolean;
  device: MdmDevice | null;
  lockStatus: string;
}

interface DeviceLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: string;
}

function relativeTime(dateStr: string): string {
  if (!dateStr) return '-';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'เมื่อสักครู่';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ชม. ที่แล้ว`;
  const days = Math.floor(hours / 24);
  return `${days} วันที่แล้ว`;
}

interface MdmDeviceWidgetProps {
  imei: string;
}

export default function MdmDeviceWidget({ imei }: MdmDeviceWidgetProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const role = user?.role;
  const canLockUnlock = role === 'OWNER' || role === 'FINANCE_MANAGER';

  const [lockOpen, setLockOpen] = useState(false);
  const [lockReason, setLockReason] = useState('');
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [gpsOpen, setGpsOpen] = useState(false);

  const statusQuery = useQuery<DeviceStatusResponse>({
    queryKey: ['mdm-device-status', imei],
    queryFn: () => api.get('/mdm/device-status', { params: { imei } }).then((r) => r.data),
  });

  const gpsQuery = useQuery<{ data: DeviceLocation }>({
    queryKey: ['mdm-gps', statusQuery.data?.device?.id],
    queryFn: () => api.get(`/mdm/devices/${statusQuery.data!.device!.id}/location`).then((r) => r.data),
    enabled: gpsOpen && !!statusQuery.data?.device?.id,
  });

  const lockMutation = useMutation({
    mutationFn: (data: { imei: string; reason: string }) => api.post('/mdm/lock', data),
    onSuccess: () => {
      toast.success('ล็อคเครื่องสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['mdm-device-status', imei] });
      setLockOpen(false);
      setLockReason('');
    },
    onError: () => toast.error('ล็อคเครื่องไม่สำเร็จ'),
  });

  const unlockMutation = useMutation({
    mutationFn: () => api.post('/mdm/unlock', { imei }),
    onSuccess: () => {
      toast.success('ปลดล็อคเครื่องสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['mdm-device-status', imei] });
      setUnlockOpen(false);
    },
    onError: () => toast.error('ปลดล็อคเครื่องไม่สำเร็จ'),
  });

  if (statusQuery.isLoading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">กำลังตรวจสอบ MDM...</span>
        </div>
      </div>
    );
  }

  if (statusQuery.isError || !statusQuery.data) return null;

  const { found, device, lockStatus } = statusQuery.data;

  // Status badge
  let badge: React.ReactNode;
  if (!found) {
    badge = <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20">ไม่พบใน MDM</Badge>;
  } else if (device?.lossStatus === 1) {
    badge = <Badge variant="destructive">Lost Mode</Badge>;
  } else if (device?.status === 1) {
    badge = <Badge className="bg-success/10 text-success border-success/20">ปกติ</Badge>;
  } else {
    badge = <Badge variant="secondary">ไม่ได้จัดการ</Badge>;
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Smartphone className="size-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">อุปกรณ์ MDM</h2>
        </div>
        {badge}
      </div>

      {found && device && (
        <>
          <div className="grid grid-cols-2 gap-2 text-sm mb-4">
            <div>
              <span className="text-muted-foreground">รุ่น: </span>
              {device.productName || '-'} · {device.osVersion || '-'}
            </div>
            <div>
              <span className="text-muted-foreground">IMEI: </span>
              <span className="font-mono text-xs">{device.imei}</span>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">Last seen: </span>
              {relativeTime(device.lastTime)}
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {canLockUnlock && device.lossStatus !== 1 && (
              <Button variant="destructive" size="sm" onClick={() => setLockOpen(true)}>
                <Lock className="size-3.5 mr-1.5" /> ล็อค Lost Mode
              </Button>
            )}
            {canLockUnlock && device.lossStatus === 1 && (
              <Button variant="outline" size="sm" onClick={() => setUnlockOpen(true)}>
                <Unlock className="size-3.5 mr-1.5" /> ปลดล็อค
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setGpsOpen(true)}>
              <MapPin className="size-3.5 mr-1.5" /> ดูตำแหน่ง
            </Button>
          </div>
        </>
      )}

      {!found && (
        <p className="text-sm text-muted-foreground">
          ไม่พบ IMEI {imei} ในระบบ MDM — อุปกรณ์อาจยังไม่ได้ลงทะเบียน
        </p>
      )}

      {/* Lock Dialog */}
      <Dialog open={lockOpen} onOpenChange={() => { setLockOpen(false); setLockReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ล็อคเครื่อง (Lost Mode)</DialogTitle>
            <DialogDescription>เครื่องจะแสดงข้อความและเบอร์ร้านบนหน้าจอ</DialogDescription>
          </DialogHeader>
          <div>
            <Label>เหตุผล *</Label>
            <Textarea
              value={lockReason}
              onChange={(e) => setLockReason(e.target.value)}
              placeholder="เช่น ค้างชำระ 30 วัน"
              className="mt-1"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setLockOpen(false); setLockReason(''); }}>ยกเลิก</Button>
            <Button
              variant="destructive"
              disabled={!lockReason.trim() || lockMutation.isPending}
              onClick={() => lockMutation.mutate({ imei, reason: lockReason })}
            >
              {lockMutation.isPending && <Loader2 className="size-4 animate-spin mr-2" />}
              ล็อคเครื่อง
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlock Confirm */}
      <ConfirmDialog
        open={unlockOpen}
        onOpenChange={() => setUnlockOpen(false)}
        title="ปลดล็อคเครื่อง"
        description={`ต้องการปลดล็อค IMEI ${imei} หรือไม่?`}
        onConfirm={() => unlockMutation.mutate()}
        loading={unlockMutation.isPending}
      />

      {/* GPS Dialog */}
      <Dialog open={gpsOpen} onOpenChange={() => setGpsOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ตำแหน่ง GPS</DialogTitle>
          </DialogHeader>
          {gpsQuery.isLoading && (
            <div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          )}
          {gpsQuery.data?.data && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Lat:</span> {gpsQuery.data.data.latitude}</div>
                <div><span className="text-muted-foreground">Lng:</span> {gpsQuery.data.data.longitude}</div>
                <div><span className="text-muted-foreground">Accuracy:</span> {gpsQuery.data.data.accuracy}m</div>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.open(`https://www.google.com/maps?q=${gpsQuery.data!.data.latitude},${gpsQuery.data!.data.longitude}`, '_blank')}
              >
                <ExternalLink className="size-4 mr-2" /> เปิด Google Maps
              </Button>
            </div>
          )}
          {gpsQuery.isError && <div className="text-sm text-destructive text-center py-4">ไม่สามารถดึงตำแหน่งได้</div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Add MdmDeviceWidget to ContractDetailPage**

In `apps/web/src/pages/ContractDetailPage.tsx`:

Add import at the top:

```typescript
import MdmDeviceWidget from '@/components/mdm/MdmDeviceWidget';
```

Find the product info section ending (around line 726, after the `ดูรายละเอียดสินค้า` button). Add the MDM widget right after the product info card's closing `</div>` and before the QR Code section:

```tsx
          {/* MDM Device Widget */}
          {contract.product.imeiSerial && (
            <MdmDeviceWidget imei={contract.product.imeiSerial} />
          )}
```

- [ ] **Step 3: Run type check**

Run: `./tools/check-types.sh all`
Expected: `TypeScript check passed!`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/mdm/MdmDeviceWidget.tsx apps/web/src/pages/ContractDetailPage.tsx
git commit -m "feat: add MDM device widget to Contract Detail page (status, lock/unlock, GPS)"
```

---

## Task 6: Backend Controller Adjustments for Frontend

**Files:**
- Modify: `apps/api/src/modules/mdm/mdm.controller.ts`

The frontend calls some endpoints that need minor controller adjustments to match the API routes used in the frontend code.

- [ ] **Step 1: Add lock-screen endpoint (POST /mdm/devices/lock-screen)**

The frontend calls `POST /mdm/devices/lock-screen` for the "ล็อคหน้าจอ" feature. Add this route to the controller:

```typescript
@Post('devices/lock-screen')
@Roles('OWNER', 'FINANCE_MANAGER')
lockScreen(@Body() body: { id: number }) {
  return this.mdmService.lockDeviceScreen(body.id);
}
```

- [ ] **Step 2: Add restrictions endpoint (POST /mdm/devices/restrictions)**

The frontend calls `POST /mdm/devices/restrictions`. Add:

```typescript
@Post('devices/restrictions')
@Roles('OWNER')
setRestrictions(@Body() body: { id: number; [key: string]: unknown }) {
  const { id, ...options } = body;
  return this.mdmService.installRestrictions(id, options as Record<string, number>);
}
```

- [ ] **Step 3: Add wallpaper endpoints**

```typescript
@Get('devices/wallpapers')
@Roles('OWNER')
getWallpapers() {
  return this.mdmService.getWallpapers();
}

@Post('devices/wallpaper')
@Roles('OWNER')
setWallpaper(@Body() body: { deviceId: number; imageId: number }) {
  return this.mdmService.setWallpaper(body.deviceId, body.imageId);
}
```

- [ ] **Step 4: Run type check**

Run: `./tools/check-types.sh api`
Expected: `API: OK`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/mdm/mdm.controller.ts
git commit -m "feat: add controller endpoints for lock-screen, restrictions, wallpaper"
```

---

## Task 7: Final Verification & Deploy

- [ ] **Step 1: Full type check**

Run: `./tools/check-types.sh all`
Expected: `TypeScript check passed!`

- [ ] **Step 2: Start dev servers and test**

Run: `npm run dev` (both API + Web)

Test in browser:
1. Navigate to `/mdm` — device table loads
2. Search by name/IMEI — filters work
3. Status/type filters work
4. Click device → detail dialog shows
5. Lock Lost Mode → dialog with reason → confirm
6. Unlock → confirm dialog
7. GPS → dialog with coordinates
8. Navigate to a contract with IMEI → MDM widget shows
9. Widget lock/unlock/GPS buttons work

- [ ] **Step 3: Push and deploy**

```bash
git push origin main
```

Wait for CI/CD to complete successfully.
