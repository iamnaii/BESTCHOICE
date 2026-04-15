# Integration Hub

> หน้ารวมตั้งค่า external integrations ทั้งหมด — OWNER กรอก credentials + test connection ผ่าน UI ไม่ต้องแก้ .env

## Problem

ตอนนี้ 6 จาก 8 integrations ตั้งค่าผ่าน `.env` เท่านั้น — OWNER ไม่สามารถตั้งค่าเอง ต้องให้ developer แก้ .env + redeploy ทุกครั้ง ไม่มีทางรู้ว่า integration ไหนทำงานหรือไม่ทำงานนอกจากลองใช้แล้วพัง

| Integration | ก่อน | หลัง |
|------------|------|------|
| LINE OA | ✅ มี UI | ✅ ย้ายเข้า Hub |
| SMS | ✅ มี UI | ✅ ย้ายเข้า Hub |
| Facebook | ⚠️ form บางส่วน | ✅ ครบ + test |
| PaySolutions | ❌ env only | ✅ UI + test |
| PEAK | ❌ env only | ✅ UI + test |
| MDM (PJ-Soft) | ❌ env only | ✅ UI + test |
| Claude AI | ❌ env only | ✅ UI + test |
| Email (SMTP) | ❌ env only | ✅ UI + test |

## Design

### หน้า `/settings/integrations` — OWNER only

Card grid แสดงทุก integration:
- แต่ละ card: ไอคอน, ชื่อ, คำอธิบายสั้น, สถานะ badge
- สถานะ: `เชื่อมแล้ว` (green), `ยังไม่ตั้งค่า` (gray), `มีปัญหา` (red)
- กด card → เปิด Sheet/Drawer ด้านขวา → form กรอก credentials + test + save

### Integration Cards (8 ตัว)

#### 1. LINE OA (3 channels)

**Fields:**
- LINE Shop: Channel Access Token, Channel Secret
- LINE Finance: Channel Access Token, Channel Secret
- LINE Staff: Channel Access Token, Notify Targets
- LIFF ID

**Test Connection:** ยิง LINE Messaging API `/bot/info` → แสดงชื่อ bot + profile picture

**Note:** ย้าย logic จาก `/settings/line-oa` มาอยู่ใน Hub ใช้ component เดียวกัน URL เดิม redirect

#### 2. SMS (ThaiBulkSMS)

**Fields:**
- API Key, API Secret
- Sender Name
- SMS Type (standard/corporate)

**Test Connection:** ยิง ThaiBulkSMS API → แสดง credit balance

**Note:** ย้ายจาก `/settings/sms`

#### 3. Facebook Messenger

**Fields:**
- Page Access Token
- App Secret
- Verify Token
- Page ID

**Test Connection:** ยิง Graph API `GET /me?fields=name,id` → แสดง page name + ID

**Webhook URL:** แสดง URL ให้ copy ไปตั้งใน Facebook Developer Console

#### 4. PaySolutions

**Fields:**
- Merchant ID
- Secret Key
- API Key
- API URL (default: `https://apis.paysolutions.asia`)
- Terminal ID
- Return URL

**Test Connection:** ยิง PaySolutions API health check → แสดง status

#### 5. PEAK Accounting

**Fields:**
- User Token
- Connect ID
- Secret Key

**Test Connection:** ยิง PEAK API `/api/v1/company` → แสดงชื่อบริษัท + status

#### 6. MDM (PJ-Soft)

**Fields:**
- API Key
- Base URL (default: `https://mdm-th.com`)

**Test Connection:** ยิง PJ-Soft API `/devices/count` → แสดงจำนวนอุปกรณ์ที่จัดการ

#### 7. Claude AI (Anthropic)

**Fields:**
- API Key

**Test Connection:** ยิง Anthropic API → ดู model availability + credit remaining (ถ้ามี)

#### 8. Email (SMTP)

**Fields:**
- Host
- Port (default: 587)
- Username
- Password
- From Address
- From Name

**Test Connection:** ส่ง test email ไปหา OWNER email → แสดง "ส่งสำเร็จ" หรือ error

## Credentials Storage

### ย้ายจาก .env → DB (SystemConfig)

**ตาราง `SystemConfig`** ที่มีอยู่แล้ว — ใช้เก็บ integration credentials:

```
key: "integration.peak.userToken"
value: "encrypted_value_here"
isEncrypted: true
```

**Encryption:** AES-256-GCM
- Encrypt ก่อน save ลง DB
- Decrypt เมื่ออ่าน
- Encryption key จาก env var `INTEGRATION_ENCRYPTION_KEY` (ตัวเดียวที่ยังต้องอยู่ใน .env)

**Backward Compatible:**
- Services อ่านจาก DB ก่อน (SystemConfig)
- ถ้า DB ไม่มี → fallback ไป env var เดิม
- ทำให้ระบบเดิมยังทำงานได้โดยไม่ต้อง migrate ทันที

### Resolution Order

```
1. SystemConfig (DB, encrypted) ← ใหม่ ถ้ามีใช้เลย
2. Environment variable          ← เดิม fallback
3. null (not configured)         ← แสดง "ยังไม่ตั้งค่า"
```

## Implementation Notes

### New Files

| File | Purpose |
|------|---------|
| `apps/api/src/modules/integrations/integrations.module.ts` | Integration Hub module |
| `apps/api/src/modules/integrations/integrations.controller.ts` | CRUD config + test connection endpoints |
| `apps/api/src/modules/integrations/integrations.service.ts` | Read/write encrypted config, test connections |
| `apps/api/src/modules/integrations/integration-config.service.ts` | Centralized config resolver (DB → env fallback) |
| `apps/api/src/modules/integrations/crypto.util.ts` | AES-256-GCM encrypt/decrypt |
| `apps/web/src/pages/IntegrationHubPage.tsx` | Hub page with card grid |
| `apps/web/src/pages/IntegrationHubPage/IntegrationDrawer.tsx` | Drawer component for each integration form |

### Files to Modify

| File | Change |
|------|--------|
| `apps/api/src/app.module.ts` | Register IntegrationsModule |
| `apps/api/src/modules/line-oa/line-oa.service.ts` | Read config from IntegrationConfigService instead of direct env |
| `apps/api/src/modules/notifications/notifications.service.ts` | Same — use config service |
| `apps/api/src/modules/paysolutions/paysolutions.service.ts` | Same |
| `apps/api/src/modules/peak/peak.service.ts` | Same |
| `apps/api/src/modules/mdm/mdm.service.ts` | Same |
| `apps/api/src/modules/ocr/ocr.service.ts` | Same (Anthropic key) |
| `apps/api/src/modules/email/email.service.ts` | Same |
| `apps/api/src/modules/chat-adapters/facebook.adapter.ts` | Same |
| `apps/web/src/App.tsx` | Add route `/settings/integrations` |
| `apps/web/src/config/menu.ts` | Add Integration Hub to OWNER menu |

### Existing Code to Reuse

- `SystemConfig` model — already exists in Prisma schema
- `LineOaSettingsPage.tsx` — reference for form pattern
- `SmsSettingsPage.tsx` — reference for test connection pattern
- Each service already has `isConfigured()` method — extend to use config resolver

### API Endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/integrations` | List all integrations with status |
| GET | `/integrations/:key/config` | Get config for specific integration (masked secrets) |
| PUT | `/integrations/:key/config` | Save config (encrypts before save) |
| POST | `/integrations/:key/test` | Test connection → return result |
| DELETE | `/integrations/:key/config` | Remove config (revert to env) |

### Integration Keys

```typescript
type IntegrationKey =
  | 'line-oa'
  | 'sms'
  | 'facebook'
  | 'paysolutions'
  | 'peak'
  | 'mdm'
  | 'claude-ai'
  | 'email';
```

### Config Masking

When returning config to frontend, mask sensitive values:
- API keys: show last 4 chars only (`****abcd`)
- Passwords: show `••••••••`
- Non-sensitive fields (URLs, names): show full value

### Status Detection

แต่ละ integration มี status:

```typescript
type IntegrationStatus = 'connected' | 'not_configured' | 'error';
```

- `connected` — config exists + last test passed
- `not_configured` — no config in DB and no env var
- `error` — config exists but last test failed

Store last test result + timestamp in SystemConfig:
```
integration.peak.lastTestAt: "2026-04-15T10:30:00Z"
integration.peak.lastTestStatus: "connected"
integration.peak.lastTestError: null
```

## Migration Path

1. Deploy Integration Hub — services still read from env (fallback)
2. OWNER enters credentials via UI → saved to DB
3. Services now read from DB (priority) instead of env
4. Eventually remove credentials from .env (optional, env still works as fallback)

No breaking changes — everything backward compatible.

## Future: MDM Auto-Unlock (ต่อยอดจาก Hub)

เมื่อ Integration Hub เสร็จ:
- MDM Settings อยู่ใน Hub แล้ว (API Key + Base URL)
- ต่อยอด: เพิ่ม auto lock/unlock logic ที่ trigger จาก payment events
- Spec แยก: `mdm-auto-unlock-design.md`
