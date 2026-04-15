# Broadcast Enhancement

> ส่งข้อความ/รูป/Flex Card ให้กลุ่มเป้าหมาย + ตั้งเวลา + ประวัติ

## Features

### 1. ประเภทข้อความ (3 แบบ)

| Type | รายละเอียด |
|------|-----------|
| ข้อความ | Text ธรรมดา (มีอยู่แล้ว) |
| รูปภาพ | Upload รูป + caption (optional) |
| Flex Card | เลือก template สินค้า/โปร → กรอกข้อมูล → preview |

### 2. กลุ่มเป้าหมาย (4 กลุ่ม)

| กลุ่ม | เงื่อนไข |
|-------|---------|
| ทั้งหมด | ทุกคนที่ follow LINE OA |
| ลูกค้าเก่า | มีสัญญาในระบบ (Customer + Contract) |
| ค้างชำระ | มีสัญญาสถานะ OVERDUE/DEFAULT |
| ลูกค้าใหม่ | Follow LINE แต่ยังไม่มีสัญญา |

แสดงจำนวนคนแต่ละกลุ่ม real-time

ส่งแบบ narrowcast (เฉพาะกลุ่ม) ใช้ LINE Narrowcast API สำหรับกลุ่มเฉพาะ, Broadcast API สำหรับทั้งหมด

### 3. ตั้งเวลาส่ง

- ส่งทันที
- ตั้งเวลา: เลือกวัน + เวลา
- Cron ตรวจทุก 1 นาที → ส่ง scheduled messages ที่ถึงเวลา

### 4. Preview

แสดง mock LINE bubble ก่อนส่ง — ข้อความ/รูป/Flex card

### 5. ประวัติ Broadcast

ตารางแสดง:
- ข้อความ (ตัด 50 ตัวอักษร)
- ประเภท (text/image/flex)
- กลุ่มเป้าหมาย + จำนวนคน
- วันเวลาส่ง
- สถานะ: ส่งแล้ว / ตั้งเวลา / ล้มเหลว

## Database

```prisma
model BroadcastMessage {
  id            String    @id @default(uuid())
  type          String    // text, image, flex
  content       Json      // { text } or { imageUrl, caption } or { flexContents, altText }
  audience      String    // ALL, EXISTING, OVERDUE, NEW
  audienceCount Int       @map("audience_count")
  status        String    // SENT, SCHEDULED, FAILED, CANCELLED
  scheduledAt   DateTime? @map("scheduled_at")
  sentAt        DateTime? @map("sent_at")
  errorMessage  String?   @map("error_message")
  createdById   String    @map("created_by_id")
  createdBy     User      @relation(fields: [createdById], references: [id])
  createdAt     DateTime  @default(now()) @map("created_at")

  @@index([status, scheduledAt])
  @@index([createdAt])
  @@map("broadcast_messages")
}
```

## API Endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/line-oa/broadcast` | ส่งทันที |
| POST | `/line-oa/broadcast/schedule` | ตั้งเวลา |
| GET | `/line-oa/broadcast/history` | ประวัติ (paginated) |
| GET | `/line-oa/broadcast/audience-count` | จำนวนคนแต่ละกลุ่ม |
| DELETE | `/line-oa/broadcast/:id` | ยกเลิก scheduled |
| POST | `/line-oa/broadcast/upload-image` | Upload รูป → S3 → return URL |

## Implementation

### Files to Create
- `apps/api/prisma/migrations/XXXXXX_add_broadcast_messages/migration.sql`
- `apps/api/src/modules/line-oa/broadcast.cron.ts` — ตรวจ scheduled messages ทุกนาที

### Files to Modify
- `apps/api/src/modules/line-oa/broadcast.service.ts` — เพิ่ม audience targeting, schedule, history
- `apps/api/src/modules/line-oa/broadcast.controller.ts` — เพิ่ม endpoints
- `apps/web/src/pages/BroadcastPage.tsx` — rewrite ใหม่ทั้งหน้า
