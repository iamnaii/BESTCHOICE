# MDM Auto Lock/Unlock

> PJ-Soft โหมดสูญหาย — test page + auto lock/unlock จากการชำระเงิน

## Problem

ลูกค้าจ่ายเงินแล้วเครื่องยังล็อค — พนักงานต้องไปกด PJ-Soft manual ทุกครั้ง ทำให้ลูกค้ารอนาน + พนักงาน FINANCE ต้องทำหลายขั้นตอน

## Phasing

| Phase | Scope | Goal |
|-------|-------|------|
| **Phase 1 (spec นี้)** | MDM Test Page + Auto Lock/Unlock | ทดสอบ API จริง + ระบบ auto |
| **Phase 2 (อนาคต)** | Batch operations, MDM dashboard | จัดการหลายเครื่องพร้อมกัน |

## Existing System

- `MdmService` — มี `lockDevice(imei, reason)`, `unlockDevice(imei)`, `findDeviceByImei(imei)`, `getDeviceStatus(imei)` พร้อมใช้
- `MdmController` — มี endpoints `/mdm/lock`, `/mdm/unlock`, `/mdm/device-status`, `/mdm/devices` (OWNER only)
- Integration Hub — MDM card + test connection (API Key + Base URL) พร้อมใช้
- Product model — มี `imeiSerial` field
- Contract → Product relation — ดึง IMEI ผ่าน `contract.product.imeiSerial`
- Dunning system — escalation cron ทุกวัน 01:00
- Payment service — `recordPayment()` + `checkContractCompletion()`

## Feature 1: MDM Test Page

### หน้า `/settings/mdm-test` — OWNER only

**UI:**
1. **ค้นหาเครื่อง** — input IMEI + ปุ่ม "ค้นหา"
2. **แสดงผล** — Device info: ชื่อ, model, IMEI, สถานะ (ล็อค/ไม่ล็อค), management status
3. **Actions:**
   - ปุ่ม "ล็อคเครื่อง" (สีแดง) — ต้องกรอกเหตุผล → confirm dialog → เรียก `/mdm/lock`
   - ปุ่ม "ปลดล็อค" (สีเขียว) — confirm dialog → เรียก `/mdm/unlock`
4. **Log** — แสดงผล action ล่าสุด (สำเร็จ/ล้มเหลว + timestamp)

**ยังสามารถค้นหาจากสัญญาได้:**
- input สัญญา/ลูกค้า → ดึง contract → ดึง product.imeiSerial → ค้นหาใน MDM

### API Calls (ใช้ endpoints ที่มีอยู่)

- `GET /mdm/device-status?imei=xxx` → ดูสถานะ
- `POST /mdm/lock` → ล็อค (body: { imei, reason })
- `POST /mdm/unlock` → ปลดล็อค (body: { imei })
- `GET /mdm/devices` → list devices

## Feature 2: Auto Lock

### Trigger

Cron ทุกวัน (ร่วมกับ dunning escalation cron ที่ 01:00)

### Logic

```
สำหรับทุกสัญญาที่ status = OVERDUE หรือ DEFAULT:
  ↓
คำนวณ daysOverdue จากงวดที่ค้างนานสุด
  ↓
daysOverdue >= mdmAutoLockDays (OWNER ตั้งค่า, default 30)?
  ├─ YES + เครื่องยังไม่ถูกล็อค?
  │   → MdmService.lockDevice(imei, "ค้างชำระ {daysOverdue} วัน")
  │   → ส่ง LINE แจ้งลูกค้า: "เครื่องของคุณถูกล็อคเนื่องจากค้างชำระ กรุณาชำระเงินเพื่อปลดล็อค"
  │   → บันทึก MdmActionLog
  └─ NO → ข้าม
```

### Settings

| Setting | Key | Default | Description |
|---------|-----|---------|-------------|
| Auto Lock เปิด/ปิด | `mdm.autoLockEnabled` | false | เปิด/ปิดระบบล็อคอัตโนมัติ |
| จำนวนวันก่อนล็อค | `mdm.autoLockDays` | 30 | ค้างกี่วันถึงล็อค |
| Auto Unlock เปิด/ปิด | `mdm.autoUnlockEnabled` | false | เปิด/ปิดระบบปลดล็อคอัตโนมัติ |
| แจ้ง LINE | `mdm.notifyLine` | true | ส่ง LINE แจ้งลูกค้าเมื่อล็อค/ปลดล็อค |

เก็บใน SystemConfig (ผ่าน IntegrationConfigService ที่มีอยู่)

### Tracking

ไม่ต้องสร้าง model ใหม่ — ใช้ Contract field `mdmLockedAt` เพื่อ track:
- `mdmLockedAt DateTime?` — ถ้ามีค่า = เครื่องถูกล็อคอยู่
- ล็อคสำเร็จ → set `mdmLockedAt = now()`
- ปลดล็อคสำเร็จ → set `mdmLockedAt = null`
- ป้องกันล็อคซ้ำ: ถ้า `mdmLockedAt != null` → ข้าม

## Feature 3: Auto Unlock

### Trigger

หลัง `recordPayment()` สำเร็จ (ใน payments.service.ts)

### Logic

```
บันทึกชำระสำเร็จ
  ↓
สัญญานี้มี mdmLockedAt != null? (เครื่องถูกล็อคอยู่)
  ├─ NO → ข้าม (ไม่ได้ล็อค ไม่ต้องปลดล็อค)
  └─ YES ↓
       ตรวจสอบ: สัญญายังมีงวดค้างชำระอยู่ไหม?
         ├─ ยังค้างอยู่ → ไม่ปลดล็อค (จ่ายแค่บางส่วน)
         └─ ไม่ค้างแล้ว (จ่ายงวดที่ค้าง + ค่าปรับครบ)
              → MdmService.unlockDevice(imei)
              → ส่ง LINE แจ้งลูกค้า: "เครื่องปลดล็อคแล้ว ขอบคุณที่ชำระ"
              → set mdmLockedAt = null
              → บันทึก AuditLog
```

### Safety

- Lock/Unlock เป็น **non-blocking** — ถ้า MDM API ล่ม ไม่กระทบ payment flow
- ทุก action บันทึก AuditLog (ใคร, เมื่อไหร่, IMEI, สำเร็จ/ล้มเหลว)
- OWNER สามารถ manual lock/unlock ได้เสมอผ่าน MDM Test Page
- Auto lock ไม่ล็อคซ้ำ (check `mdmLockedAt`)
- Auto unlock ไม่ปลดล็อคถ้ายังค้าง (check outstanding payments)

### LINE Notifications

| Event | ข้อความ |
|-------|--------|
| Auto Lock | "เครื่อง {productName} ของคุณถูกล็อคเนื่องจากค้างชำระ {days} วัน กรุณาชำระเงินเพื่อปลดล็อค โทร {shopPhone}" |
| Auto Unlock | "เครื่อง {productName} ของคุณปลดล็อคแล้ว ขอบคุณที่ชำระเงินครับ/ค่ะ" |

ส่งผ่าน LINE Finance OA (ChatbotFinance channel)

## Implementation Notes

### Database Change

```prisma
// เพิ่มใน Contract model
mdmLockedAt     DateTime?   @map("mdm_locked_at")
```

### New Files

| File | Purpose |
|------|---------|
| `apps/api/src/modules/mdm/mdm-auto.service.ts` | Auto lock/unlock logic + settings |
| `apps/api/src/modules/mdm/mdm-auto.cron.ts` | Daily cron for auto lock |
| `apps/web/src/pages/MdmTestPage.tsx` | MDM test page (search, lock, unlock) |

### Files to Modify

| File | Change |
|------|--------|
| `apps/api/prisma/schema.prisma` | Add `mdmLockedAt` to Contract |
| `apps/api/src/modules/payments/payments.service.ts` | Add auto unlock after payment |
| `apps/api/src/modules/mdm/mdm.module.ts` | Register new services, export MdmAutoService |
| `apps/web/src/App.tsx` | Add route `/settings/mdm-test` |
| `apps/web/src/config/menu.ts` | Add MDM Test to OWNER menu |

### Settings Storage

ใช้ IntegrationConfigService (Integration Hub) เก็บใน SystemConfig:
- `mdm.autoLockEnabled` → "true"/"false"
- `mdm.autoLockDays` → "30"
- `mdm.autoUnlockEnabled` → "true"/"false"
- `mdm.notifyLine` → "true"/"false"

อ่านผ่าน `IntegrationConfigService.getValue('mdm', 'autoLockEnabled')`
