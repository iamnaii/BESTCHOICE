# Yeastar P-Series Cloud Edition Integration — Design Spec

**Date:** 2026-04-25  
**Status:** Approved  
**Approach:** B — Webhook-driven (real-time events + CDR fallback cron)

---

## Overview

เชื่อม BESTCHOICE กับ Yeastar P-Series Cloud Edition PBX เพื่อ:
1. **Click-to-call** — โทรออกจาก UI ผ่าน PBX อัตโนมัติ
2. **Inbound screen pop** — popup real-time เมื่อลูกค้าโทรเข้า พร้อมข้อมูลสัญญา
3. **CDR auto-log** — บันทึก `CallLog` อัตโนมัติจาก CDR (เฉพาะสายที่ match customer + active contract)
4. **Recording storage** — ดาวน์โหลด recording จาก Yeastar และเก็บใน GCS แบบ tiered

---

## Architecture

```
BESTCHOICE Web (React)
    │
    ├─ Click-to-call → POST /api/yeastar/call/originate
    ├─ Screen pop ←── Socket.io (room: user:{userId})
    └─ Audio player ← GCS signed URL

BESTCHOICE API (NestJS)
    │
    ├─ YeastarModule
    │   ├─ yeastar-token.service.ts       OAuth token cache + auto-refresh
    │   ├─ yeastar.service.ts             HTTP client → Yeastar API
    │   ├─ yeastar.controller.ts          click-to-call, extension list
    │   ├─ yeastar-webhook.controller.ts  รับ events จาก Yeastar (public)
    │   └─ yeastar-cdr.cron.ts           fallback CDR pull ทุก 15 นาที
    │
    └─ integrations registry             เพิ่ม "yeastar" entry

Yeastar PBX (Cloud)
    ├─ Webhook → POST https://api.bestchoicephone.app/api/yeastar/webhook
    └─ API ← BESTCHOICE calls (originate, CDR, recording download)

GCS (Cloud Storage)
    └─ recordings/{contractId}/{callId}.mp3
        ├─ Standard (0-30 วัน)
        ├─ Nearline (30+ วัน, สัญญา active)
        ├─ Coldline (สัญญาปิด, ไม่มีคดี)
        └─ Archive → delete (คดีปิด > 1 ปี)
```

---

## Authentication (Yeastar OAuth 2.0)

- Client ID + Client Secret เก็บใน `IntegrationConfig` (encrypted)
- Access Token: หมดอายุ 30 นาที → refresh อัตโนมัติด้วย `YeastarTokenService`
- Refresh Token: หมดอายุ 24 ชั่วโมง → re-authenticate ด้วย credentials
- Token cache ใน memory (ไม่เก็บ DB) — reset เมื่อ server restart

---

## Data Model Changes

### Migration 1: `User.yeastarExtension`
```prisma
model User {
  // ... existing fields
  yeastarExtension  String?  @map("yeastar_extension")  // เช่น "1001"
}
```

### Migration 2: `CallLog` เพิ่ม fields + enum
```prisma
enum CallDirection {
  INBOUND
  OUTBOUND
}

model CallLog {
  // ... existing fields
  yeastarCallId             String?        @unique @map("yeastar_call_id")      // unique CDR ID จาก Yeastar
  callDirection             CallDirection? @map("call_direction")
  duration                  Int?                                                 // วินาที
  recordingUrl              String?        @map("recording_url")                 // GCS URL
  recordingStorageTier      String?        @default("STANDARD") @map("recording_storage_tier")
  recordingDownloadedAt     DateTime?      @map("recording_downloaded_at")
  yeastarRecordingPath      String?        @map("yeastar_recording_path")        // path ดิบจาก CDR
  autoLogged                Boolean        @default(false) @map("auto_logged")   // true = จาก CDR cron
}
```

`yeastarCallId` มี `@@unique` constraint เพื่อป้องกัน duplicate จาก webhook + cron

---

## Backend — YeastarModule

### YeastarTokenService
- เก็บ `{ accessToken, expiresAt, refreshToken }` ใน memory
- `getToken()` — return token ที่ valid, refresh อัตโนมัติถ้าเหลือ < 2 นาที
- Background interval refresh ทุก 25 นาที

### YeastarService
```
originate(agentUserId, customerId)
  → ดึง agent.yeastarExtension + customer.phone
  → POST /api/yeastar/call/originate { caller: extension, callee: phone }
  → return { callId }

getExtensions()
  → GET /api/yeastar/extension/list
  → return [{ number, name, status }]

downloadRecording(path)
  → GET /api/yeastar/recording/download?path={path}
  → stream → upload GCS → return gsUrl

queryCdr(startTime, endTime)
  → GET /api/yeastar/cdr/search
  → return CDR[]
```

### YeastarWebhookController
**Endpoint:** `POST /api/yeastar/webhook` (public — ไม่มี JwtAuthGuard)

**Signature verification:** HMAC-SHA256 จาก secret ใน IntegrationConfig (เหมือน LINE webhook)

**Events handled:**
| Event | Action |
|-------|--------|
| `ExtensionCallStatus` (INBOUND, RINGING) | ค้นหา customer จาก caller ID → ดึง `answeredBy` extension → map เป็น userId → emit `yeastar:inbound` socket event ไปที่ room `user:{userId}` |
| `NewCdr` | match customer + contract → upsert `CallLog` → trigger recording download job |
| `ExtensionCallStatus` (DISCONNECTED) | emit `yeastar:call_ended` socket event |

**Response:** HTTP 200 ทุก event (Yeastar ต้องการ 2xx)

### YeastarCdrCron
- ทำงานทุก 15 นาที
- ดึง CDR ย้อนหลัง 20 นาที (overlap 5 นาที เผื่อ delay)
- upsert `CallLog` โดย `yeastarCallId` เป็น key → ไม่ duplicate
- trigger recording download สำหรับ record ที่มี `yeastarRecordingPath` แต่ยังไม่มี `recordingUrl`
- Sentry capture บน error (ตาม pattern v4)

### Recording Download (async job)
1. รับ `yeastarRecordingPath` จาก CDR
2. ดาวน์โหลดจาก Yeastar API (stream)
3. Upload ไป GCS path: `recordings/{contractId}/{yeastarCallId}.mp3`
4. Tag GCS object ด้วย `contractId`, `legalCaseId` (ถ้ามี), `uploadDate`
5. อัปเดต `CallLog.recordingUrl`, `recordingDownloadedAt`, `recordingStorageTier = STANDARD`
6. Sentry alert ถ้า download ล้มเหลว (Yeastar file expire)

---

## GCS Lifecycle Rules

```yaml
# กำหนดใน GCS bucket lifecycle policy (ไม่ใช่ code)
rules:
  - condition: { age: 30, matchesStorageClass: [STANDARD] }
    action: { type: SetStorageClass, storageClass: NEARLINE }
    # ยกเว้น objects ที่มี tag legalCase=true

  - condition: { age: 90, matchesStorageClass: [NEARLINE] }
    action: { type: SetStorageClass, storageClass: COLDLINE }
    # เฉพาะ objects ที่ contract ปิดแล้ว (tag contractStatus=CLOSED)

  - condition: { age: 365, matchesStorageClass: [COLDLINE] }
    action: { type: Delete }
    # ยกเว้น objects ที่มี tag legalCase=true

# Legal hold: object ที่มี tag legalCase=true
# → จะไม่ถูก lifecycle rules แตะ จนกว่าจะ remove tag (เมื่อคดีปิด + 1 ปี)
```

GCS object tags อัปเดตโดย:
- `LegalCaseService` เมื่อเปิด/ปิดคดี
- `ContractService` เมื่อสัญญาปิด

---

## Frontend

### 1. Profile — ตั้ง Extension
- dropdown `<Select>` แสดง extensions จาก `GET /api/yeastar/extensions`
- บันทึกผ่าน `PATCH /api/users/me`
- แสดง status: "เชื่อมต่อแล้ว extension 1001"

### 2. CallButton Component (reusable)
```tsx
<CallButton customerId={id} contractId={id} phone="081xxxxxxx" />
```
- ปรากฏใน: Customer detail, Contract detail, Overdue list, Collections, CallLog dialog
- State: idle → calling (spinner) → connected → ended
- ถ้า agent ไม่ได้ตั้ง extension → toast "กรุณาตั้ง extension ใน Profile ก่อน"
- ถ้า Yeastar ไม่ได้ config → ปุ่ม disabled

### 3. InboundCallPopup
- subscribe socket event `yeastar:inbound` ใน `MainLayout`
- แสดง toast-style popup มุมขวาบน:
  ```
  สายเข้า — 081-xxx-xxxx
  ลูกค้า: [ชื่อ] (ถ้าเจอ)
  สัญญา: [BC-XXXX] | งวดค้าง: X งวด
  [ดูสัญญา]  [รับทราบ]
  ```
- ถ้าไม่เจอ customer → แสดงแค่เบอร์ + "ไม่พบข้อมูลลูกค้า"
- auto-dismiss 30 วินาที

### 4. Settings → Integrations — Yeastar Card
ต่อจาก Integration cards ที่มีอยู่:
- Fields: PBX URL, Client ID, Client Secret
- ปุ่ม "ทดสอบการเชื่อมต่อ" → `GET /api/yeastar/ping`
- Webhook URL (read-only): `https://api.bestchoicephone.app/api/yeastar/webhook`
- คำแนะนำ: "ตั้งค่า Webhook URL นี้ที่ Yeastar PBX → Integrations → API"

### 5. CallLog Dialog — Audio Player
- ถ้า `recordingUrl` มีค่า → แสดง `<audio controls>` หรือ custom player
- ถ้า `recordingStorageTier = COLDLINE` → แสดง "กำลัง restore... รอ ~5 วินาที" พร้อม spinner
- ถ้ายัง download ไม่เสร็จ → แสดง "กำลังดาวน์โหลดเสียงจาก PBX..."

---

## API Endpoints สรุป

| Method | Path | Auth | คำอธิบาย |
|--------|------|------|---------|
| POST | `/api/yeastar/call/originate` | JWT | click-to-call |
| GET | `/api/yeastar/extensions` | JWT | list extensions จาก PBX |
| GET | `/api/yeastar/ping` | JWT | ทดสอบ connection |
| POST | `/api/yeastar/webhook` | public (HMAC) | รับ events จาก Yeastar |

---

## Roles & Access

- **ทุก role** (OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT, SALES) เข้าถึง click-to-call และ screen pop ได้
- **Settings Yeastar config**: OWNER เท่านั้น
- **ดู recording**: OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT

---

## CDR Matching Logic

```
CDR มาถึง (webhook หรือ cron)
  → ดึง callerNumber / calleeNumber
  → ค้นหา Customer ที่มี phone ตรงกัน (deletedAt: null)
  → ถ้าไม่เจอ → skip (ไม่ log)
  → เจอ customer → ค้นหา active Contract ของ customer
  → ถ้าไม่มี active contract → skip
  → เจอ contract → upsert CallLog (key: yeastarCallId)
  → trigger recording download job
```

---

## Error Handling

| Scenario | การจัดการ |
|----------|---------|
| Yeastar API down | retry 3 ครั้ง, Sentry alert |
| Token expired ระหว่าง request | YeastarTokenService refresh อัตโนมัติ |
| Recording download ล้มเหลว | Sentry alert, `recordingUrl` ยังคง null, cron จะ retry รอบหน้า |
| Webhook signature invalid | HTTP 401, log to Sentry |
| Customer ไม่เจอจาก caller ID | skip (ไม่ log), ไม่ error |
| Agent ไม่ได้ตั้ง extension | BadRequestException กลับไปที่ UI |

---

## ประมาณการค่าใช้จ่าย Recording Storage

- สมมติ 100 สาย/วัน × 5 นาที × 0.5 MB/นาที = 250 MB/วัน = 7.5 GB/เดือน
- เดือนแรก (Standard): ~$0.15/เดือน
- สะสม 12 เดือน (Nearline): ~$0.90/เดือน
- **รวมไม่เกิน $2/เดือน** สำหรับ scale ปัจจุบัน

---

## Out of Scope

- Extension status dashboard (agent availability) — Phase 2
- IVR / Queue management — ไม่เกี่ยวกับ BESTCHOICE workflow
- WhatsApp/SMS ผ่าน Yeastar — ใช้ CHATCONE อยู่แล้ว
- Call recording transcription — Phase 2 (AI)
- GFIN call integration — defer ตาม Phase 4 deferred decision
