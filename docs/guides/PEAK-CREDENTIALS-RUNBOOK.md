# PEAK Credentials Runbook

> **Owner:** OWNER role only (credentials grant production journal-write access)
> **Cadence:** Quarterly rotation + on-demand after any suspected leak
> **Related:** T6-C9 rotation alert, T6-C4 HMAC fix, T6-C5 idempotent sync
> **Stale alarm:** `cron: credential-rotation` fires every Monday 06:00 Asia/Bangkok — Sentry warning if any sensitive credential > 90 days old

## What PEAK credentials exist

| Field | Stored at | Purpose | Sensitive |
|-------|-----------|---------|-----------|
| `peak.userToken` | `system_config` key `integration.peak.userToken` | Authenticates คน (OWNER) ที่สร้าง access | ✅ yes |
| `peak.connectId` | `system_config` key `integration.peak.connectId` | Identifies ลูกค้า PEAK account | ⚠️ semi (public identifier) |
| `peak.secretKey` | `system_config` key `integration.peak.secretKey` | **HMAC-SHA1 key** สำหรับ Time-Signature | 🔴 HIGH |
| `peak.baseUrl` | `system_config` key `integration.peak.baseUrl` | API endpoint (defaults to prod) | low |

ค่าที่ sensitive จะถูก encrypt ด้วย `INTEGRATION_ENCRYPTION_KEY` (env) ก่อนเก็บ ดู [integration-config.service.ts](../../apps/api/src/modules/integrations/integration-config.service.ts) `encryptPII()`

## Who can read PEAK credentials

- **OWNER role เท่านั้น** — ผ่าน `GET /integrations/peak` (`IntegrationsController`) แสดง masked (`••••xxxx`)
- **Runtime code** — `PeakService.getConfig()` decrypt ด้วย `INTEGRATION_ENCRYPTION_KEY`
- **DB admin access** — ถ้า DB ถูก compromise แต่ไม่มี key → เห็น ciphertext เท่านั้น

Access จาก code path ใดๆก็ตามบันทึกใน `AuditLog` (global `AuditInterceptor` on mutation; read access ไม่ได้ log)

## When to rotate

**Required (immediate):**
- Credentials leaked ใน git, Slack, email, logs, customer-facing
- PEAK account compromised / suspicious journals appeared
- OWNER departure (person who created them leaves role)
- After T6-C4 fix deployed — เดิมเคย sign ด้วย connectId; ทีม PEAK ถ้ารู้ว่าเคย bug นี้อาจขอ rotate

**Routine:**
- Quarterly (mark in OWNER's calendar — 1 Jan / 1 Apr / 1 Jul / 1 Oct)
- When Sentry alarm `cron: credential-rotation` fires (90-day staleness)

## Rotation procedure

### 1. Generate new credentials บน PEAK portal
1. Login `https://app.peakaccount.com` ด้วย OWNER account
2. Settings → API → Regenerate User Token (หรือ regenerate whole app)
3. Copy new `UserToken`, `ConnectId`, `SecretKey` ไว้ในที่ปลอดภัย (password manager)

### 2. เขียนค่าใหม่ลงระบบ
- วิธี A (UI): OWNER login BESTCHOICE → `/settings/integrations` → card "PEAK" → "Edit" → paste ค่าใหม่ → "Save"
- วิธี B (API): `POST /integrations/peak/config` body `{ userToken, connectId, secretKey }` with OWNER JWT

### 3. Verify
```bash
# ทดสอบ connect (OWNER JWT)
curl -X POST https://api.bestchoice.app/integrations/peak/test \
  -H "Authorization: Bearer $OWNER_JWT"
# expect: { "success": true, "message": "เชื่อมต่อ PEAK สำเร็จ (Client-Token ได้รับแล้ว)" }
```

### 4. Trigger manual sync เพื่อ flush backlog
```bash
curl -X POST https://api.bestchoice.app/peak/export \
  -H "Authorization: Bearer $OWNER_JWT" \
  -H "Content-Type: application/json" \
  -d '{ "startDate": "2026-04-01", "endDate": "2026-04-30" }'
```

### 5. Monitor
- Sentry filter: `kind:peak-sync` — ไม่ควรมี error หลัง rotate
- PEAK portal: Journal entries tab — verify entries ปรากฏถูก date
- `cron: credential-rotation` Monday morning ต่อไปจะ reset

## HMAC signature spec (T6-C4 reference)

ระบบ sign ทุก request ด้วย:
```
Time-Signature = HMAC-SHA1(message=Time-Stamp, key=secretKey)
```
โดย `Time-Stamp` = yyyyMMddHHmmss (Asia/Bangkok local time)

Fixture vector สำหรับ self-test:
```
timeStamp  = "20260419120000"
secretKey  = "testSecret"
signature  = "0c592fa5db6e3cb5b2c10f1a0d79c49b295761a6"  (hex, lowercase)
```

ถ้า sign output ไม่ตรง fixture นี้ = bug กลับมาใหม่

**Legacy bug (ปิดแล้ว ใน PR T6-C4):** เคย sign ด้วย `connectId` แทน `secretKey` — ทำให้คนที่มี connectId (public identifier) forge signed requests ได้ ถ้า PEAK ฝั่ง server ไม่ strict validate

## Encryption key (INTEGRATION_ENCRYPTION_KEY)

- Separate lifecycle จาก PEAK credentials
- ถ้า key หมุน (rotate) → ต้อง re-encrypt existing SystemConfig rows (ยังไม่มี migration script — ถ้า rotate ต้องเขียน migration ด้วย)
- ห้าม commit ลง git; ห้าม log — `integration-config.service.ts` `onModuleInit()` แค่ warn ถ้า missing

## Incident checklist (credentials leaked)

- [ ] Rotate ทันที (section above)
- [ ] ดู Sentry + audit logs — `AuditLog.action` ที่ mutate `integration.peak.*` หลัง leak timestamp
- [ ] Check PEAK portal: Journal entries tab — entries ที่ไม่ได้ส่งจาก BESTCHOICE?
- [ ] ถ้าพบ unauthorized entries → reverse ใน PEAK + Sentry report + filing report
- [ ] Revoke OWNER JWT (logout all sessions) ถ้าสงสัย endpoint leak
- [ ] Verify `INTEGRATION_ENCRYPTION_KEY` ไม่ leak เช่นกัน — ถ้า leak ต้อง rotate + re-encrypt ทุก integration credentials

## Related files

- [peak.service.ts](../../apps/api/src/modules/peak/peak.service.ts) — HMAC + export logic
- [integration-config.service.ts](../../apps/api/src/modules/integrations/integration-config.service.ts) — encrypt/decrypt
- [credential-rotation.cron.ts](../../apps/api/src/modules/integrations/credential-rotation.cron.ts) — weekly staleness alarm
- [integration-registry.ts](../../apps/api/src/modules/integrations/integration-registry.ts) — `sensitive: true` flag per field
