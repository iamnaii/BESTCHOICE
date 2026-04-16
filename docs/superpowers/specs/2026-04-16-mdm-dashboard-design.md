# MDM Dashboard & Integration — Design Spec

**Date**: 2026-04-16
**Status**: Approved
**Scope**: MDM Dashboard page, Contract Detail widget, DB→Service migration, Auto Restrictions

---

## 1. Overview

Expand the MDM module from backend-only to a full-stack feature:
- **MDM Dashboard** (`/mdm`) — device management UI for OWNER/FINANCE_MANAGER/BRANCH_MANAGER
- **Contract Detail widget** — inline MDM status + quick actions on contract pages
- **DB→Service migration** — MdmService reads config from IntegrationConfigService (DB) instead of env vars
- **Auto Restrictions** — auto-apply restrictions to newly enrolled devices within 24h

---

## 2. DB→Service Migration

### 2.1 IntegrationConfigService Cache

Add in-memory cache to `IntegrationConfigService` to avoid hitting DB on every config read.

```
private cache: Map<string, { config: IntegrationConfig; cachedAt: number }>
TTL: 5 minutes (300_000 ms)
```

- `getConfig(key)` — return cache if fresh, else DB query + cache
- `getValue(key, field)` — delegates to getConfig (uses same cache)
- `saveConfig(key, body)` — save to DB + `cache.delete(key)` (instant invalidation)
- `deleteConfig(key)` — delete from DB + `cache.delete(key)`

All consumers (MDM now, other modules later) benefit automatically.

### 2.2 MdmService Changes

- `MdmModule` imports `IntegrationsModule`
- `MdmService` injects `IntegrationConfigService`
- Replace sync config reads with async:

| Before | After |
|--------|-------|
| `this.configService.get('MDM_API_KEY')` | `await this.integrationConfig.getValue('mdm', 'apiKey')` |
| `this.configService.get('MDM_BASE_URL')` | `await this.integrationConfig.getValue('mdm', 'baseUrl')` |

- Remove `MDM_SUB_PASSWORD` (not needed — unlock changed to lost-mode/disable)
- `SHOP_PHONE` stays as env var (not an integration credential)

---

## 3. MDM Dashboard Page

### 3.1 Route & Access

- **Path**: `/mdm`
- **Menu**: "จัดการอุปกรณ์" under "เครื่องมือ" group, Smartphone icon
- **Roles**: OWNER, FINANCE_MANAGER, BRANCH_MANAGER
- **Layout**: MainLayout, lazy-loaded, ProtectedRoute

### 3.2 Toolbar

- **Search**: debounced input — searches by IMEI, name, or phone
- **Filter — Status**: ทั้งหมด / Managed (1) / Lost Mode (lossStatus=1) / Not Managed (0)
- **Filter — Type**: ทั้งหมด / iPhone (0) / iPad (1) / Mac (2)

### 3.3 Device Table

| Column | Data | Notes |
|--------|------|-------|
| ชื่อ/เบอร์ | name, phone | |
| รุ่น | productName, osVersion | |
| IMEI/Serial | imei, deviceId | copyable |
| สถานะ | badge | Managed (green) / Lost Mode (red) / Not Managed (gray) |
| Last Seen | lastTime | relative time format |
| Actions | dropdown menu | role-based visibility |

Server-side pagination: default 20/page, uses MDM API pageNum/pageSize.

### 3.4 Actions (dropdown per row)

| Action | Dialog | Roles |
|--------|--------|-------|
| ดูรายละเอียด | Dialog: full device info | ALL |
| ล็อค Lost Mode | Dialog: reason input → confirm | OWNER, FINANCE_MANAGER |
| ปลดล็อค | Confirm dialog | OWNER, FINANCE_MANAGER |
| ล็อคหน้าจอ | Confirm dialog (plays sound) | OWNER, FINANCE_MANAGER |
| ดูตำแหน่ง GPS | Dialog: lat/lng + Google Maps link | ALL |
| ตั้ง Restrictions | Dialog: toggles for camera, Safari, screenshot, app install, Apple ID, WiFi | OWNER |
| ตั้งข้อความ Lock Screen | Dialog: text input | OWNER |
| ตั้ง Wallpaper | Dialog: select from wallpaper list | OWNER |

### 3.5 Role-based Visibility

| Feature | OWNER | FINANCE_MANAGER | BRANCH_MANAGER |
|---------|-------|-----------------|----------------|
| View device list | Yes | Yes | Yes |
| View device detail | Yes | Yes | Yes |
| Lock/Unlock Lost Mode | Yes | Yes | No |
| Lock screen | Yes | Yes | No |
| View GPS location | Yes | Yes | Yes |
| Set Restrictions | Yes | No | No |
| Set Lock Screen Text | Yes | No | No |
| Set Wallpaper | Yes | No | No |

---

## 4. Auto Restrictions

### 4.1 Purpose

Auto-apply a default restriction profile to newly enrolled devices within 24 hours, so every financed device has baseline security from the start.

### 4.2 Default Restrictions

- Prevent changing Apple ID / Account settings
- Prevent turning off WiFi
- (Additional restrictions configurable via SystemConfig)

### 4.3 Implementation

**New service**: `MdmRestrictionsService`

**New cron**: runs every 1 hour (alongside existing auto-lock cron)

**Flow**:
1. `GET /api/mdm/devices?status=1` — get Managed devices
2. Filter: `lastTime` within 24h (recently enrolled)
3. Check DB: `SystemConfig` key `mdm.restrictedDevices` (JSON array of device IDs already processed)
4. For new devices: `POST /api/mdm/restrictions` with default profile
5. Record device ID as processed
6. Log + Sentry on failure

**SystemConfig keys**:
- `mdm.autoRestrictionsEnabled` — boolean (default: false)
- `mdm.autoRestrictionsProfile` — JSON object of restriction flags

**Rate limit awareness**: process max 40 devices per run (each needs 1 API call), 1s delay between calls.

### 4.4 Open Question

MDM API docs only show `allowCamera`, `allowScreenCapture`, `allowAppInstallation`, `allowSafari` as restriction fields. Need to verify via `GET /api/mdm/restrictions/{id}` on a real device whether Apple ID and WiFi restriction fields exist. If not available, we log a warning and apply only available restrictions.

---

## 5. Contract Detail — MDM Widget

### 5.1 Placement

New card/section in Contract Detail page, shown only when the contract's product has an `imeiSerial`.

### 5.2 Card Layout

```
+-- อุปกรณ์ MDM -----------------------------------------+
|  iPhone 15 Pro · iOS 18.2              [ปกติ] (green)  |
|  IMEI: 356XXXXXXXXXX                                   |
|  Last seen: 2 ชม. ที่แล้ว                                |
|                                                         |
|  [ล็อค Lost Mode]  [ปลดล็อค]  [ดูตำแหน่ง]              |
+---------------------------------------------------------+
```

### 5.3 Status Badges

| Badge | Condition |
|-------|-----------|
| ปกติ (green) | lossStatus=0, status=1 (Managed) |
| Lost Mode (red) | lossStatus=1 |
| ไม่ได้จัดการ (gray) | status=0 or 2 |
| ไม่พบใน MDM (yellow) | IMEI not found in MDM |

### 5.4 Buttons by Role

| Button | OWNER | FINANCE_MANAGER | BRANCH_MANAGER |
|--------|-------|-----------------|----------------|
| ล็อค Lost Mode | Yes | Yes | No |
| ปลดล็อค | Yes | Yes | No |
| ดูตำแหน่ง GPS | Yes | Yes | Yes |

### 5.5 Data Flow

- Fetch: `GET /api/mdm/device-status?imei={product.imeiSerial}` via useQuery
- Lock: `POST /api/mdm/lock` → confirm dialog with reason → invalidateQueries
- Unlock: `POST /api/mdm/unlock` → confirm dialog → invalidateQueries
- GPS: `GET /api/mdm/devices/{id}/location` → dialog with Google Maps link

---

## 6. Files to Create/Modify

### Backend (modify)
- `apps/api/src/modules/integrations/integration-config.service.ts` — add cache layer
- `apps/api/src/modules/mdm/mdm.service.ts` — inject IntegrationConfigService, async config
- `apps/api/src/modules/mdm/mdm.module.ts` — import IntegrationsModule
- `apps/api/src/modules/mdm/mdm-auto.cron.ts` — add auto-restrictions cron

### Backend (create)
- `apps/api/src/modules/mdm/mdm-restrictions.service.ts` — auto restrictions logic

### Frontend (create)
- `apps/web/src/pages/MdmDashboardPage.tsx` — device management dashboard
- `apps/web/src/components/MdmDeviceWidget.tsx` — contract detail widget

### Frontend (modify)
- `apps/web/src/App.tsx` — add /mdm route
- `apps/web/src/config/menu.ts` — add menu item
- Contract detail page — add MdmDeviceWidget

---

## 7. Out of Scope

- DB→Service migration for other modules (PEAK, PaySolutions, LINE, etc.)
- CHATCONE integration
- Facebook/Email wiring
- MDM app management (install/restrict apps)
- Device erase / ABM unbind (destructive operations — manual via MDM dashboard only)
