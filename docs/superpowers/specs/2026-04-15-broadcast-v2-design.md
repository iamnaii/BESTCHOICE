# Broadcast V2 — LINE OA Style

> ส่งหลายข้อความพร้อมกัน + Rich Message + Coupon + Survey + A/B Test + JSON Editor + Insight

## Features เพิ่มจาก V1

### 1. ส่งหลายข้อความพร้อมกัน (Multi-message)
- 1 broadcast = สูงสุด 5 ข้อความ (LINE API limit)
- เพิ่ม/ลบ/เรียงลำดับข้อความได้
- แต่ละข้อความเลือกประเภทได้อิสระ (text, image, flex, rich message, video)

### 2. ประเภทข้อความเพิ่ม

| Type | รายละเอียด |
|------|-----------|
| ข้อความ | Text ธรรมดา (มีแล้ว) |
| รูปภาพ | Upload + caption (มีแล้ว) |
| วิดีโอ | Upload video + thumbnail |
| Flex Card | Template mode + JSON mode |
| Rich Message | รูปภาพที่กดแล้วไปลิงก์ (image map) |
| Coupon | คูปองส่วนลด (ใส่โค้ด + เงื่อนไข) |
| Survey | โพล 2-4 ตัวเลือก |

### 3. Flex Message — 2 modes

**Template Mode** (default):
- เลือก template: สินค้า, โปรโมชัน, ใบเสร็จ, กำหนดเอง
- กรอกข้อมูล: ชื่อ, รูป, ราคา, ปุ่ม, สี
- Preview real-time

**JSON Mode** (advanced):
- Code editor พิมพ์/paste Flex JSON ได้เลย
- รองรับ copy จาก LINE Flex Message Simulator
- Preview real-time ข้างๆ editor
- Validate JSON ก่อนส่ง
- Toggle สลับ template ↔ JSON ได้

### 4. Rich Message (Image Map)
- Upload รูปภาพ 1 รูป
- กำหนดพื้นที่กดได้ (แบ่งเป็น grid: 1x1, 2x1, 1x2, 2x2, 2x3)
- แต่ละพื้นที่ = link URI หรือ send message
- ใช้ LINE Imagemap API

### 5. Coupon
- สร้างคูปอง: ชื่อ, ส่วนลด (บาท/%), โค้ด, วันหมดอายุ
- ส่งเป็น Flex Message card สวยๆ
- ลูกค้ากดดูเงื่อนไข + copy โค้ด

### 6. Survey/Poll
- คำถาม + 2-4 ตัวเลือก
- ส่งเป็น Flex Message + Quick Reply
- เก็บผลโหวตใน DB
- ดูผล real-time ในหน้า broadcast history

### 7. A/B Testing
- สร้าง 2 versions ของข้อความ
- ส่ง version A ให้ 50%, version B ให้ 50% (หรือ custom %)
- เทียบผล: อัตราเปิด, กดลิงก์

### 8. Insight / Analytics
- จำนวนคนที่ได้รับ
- จำนวนคนเปิดอ่าน (ถ้า LINE API รองรับ)
- จำนวนคนกดลิงก์ (tracking URL)
- แสดงใน broadcast history

## UI — Broadcast Composer

```
┌─────────────────────────────────────────┐
│ Broadcast                               │
│ ส่งข้อความหาลูกค้า                         │
├─────────────────────────────────────────┤
│ [สร้างข้อความ] [ประวัติ]                    │
├─────────────────────────────────────────┤
│                                         │
│ ── ข้อความที่ 1 ─────────────────────── │
│ [💬] [🖼️] [🎬] [📦Flex] [🖼️Rich] [🎫] [📊] │
│ ┌─────────────────────────────────┐     │
│ │ (content area per type)         │     │
│ └─────────────────────────────────┘     │
│                                         │
│ ── ข้อความที่ 2 ─────────────────────── │
│ [💬] [🖼️] [🎬] [📦Flex] [🖼️Rich] [🎫] [📊] │
│ ┌─────────────────────────────────┐     │
│ │ (content area per type)         │     │
│ └─────────────────────────────────┘     │
│                                         │
│ [+ เพิ่มข้อความ] (สูงสุด 5)               │
│                                         │
│ ── Flex JSON Mode ──────────────────── │
│ [Template Mode ↔ JSON Mode]              │
│ ┌──────────────┬──────────────────┐     │
│ │ JSON Editor  │ Live Preview     │     │
│ │              │                  │     │
│ └──────────────┴──────────────────┘     │
│                                         │
│ ── กลุ่มเป้าหมาย ─────────────────── │
│ ○ ทั้งหมด (500) ○ ลูกค้าเก่า (120)      │
│ ○ ค้างชำระ (15)  ○ ลูกค้าใหม่ (365)      │
│                                         │
│ ── เวลาส่ง ──────────────────────── │
│ ○ ส่งทันที  ○ ตั้งเวลา [__|__]          │
│                                         │
│ ── A/B Testing (optional) ──────── │
│ □ เปิด A/B Testing                      │
│ Version A: [select message]  50%        │
│ Version B: [select message]  50%        │
│                                         │
│ ── Preview ──────────────────────── │
│ [LINE bubble mock]                      │
│ จะส่งถึง 500 คน                          │
│ [ส่ง Broadcast]                          │
└─────────────────────────────────────────┘
```

## DB Changes

```prisma
// Update BroadcastMessage
model BroadcastMessage {
  // ... existing fields
  messages    Json[]    // array of messages (multi-message support)
  abTestEnabled Boolean @default(false) @map("ab_test_enabled")
  abVariantB    Json?   @map("ab_variant_b") // second variant messages
  abSplitPct    Int?    @map("ab_split_pct") // % for variant A (rest = B)
}

model BroadcastSurveyResponse {
  id            String   @id @default(uuid())
  broadcastId   String   @map("broadcast_id")
  broadcast     BroadcastMessage @relation(fields: [broadcastId], references: [id])
  userId        String   @map("user_id")
  answer        String
  createdAt     DateTime @default(now()) @map("created_at")

  @@unique([broadcastId, userId])
  @@map("broadcast_survey_responses")
}
```

## Implementation Priority

เรื่องนี้ scope ใหญ่ — แบ่ง phase:

### Phase 1 (ทำตอนนี้)
- Multi-message (สูงสุด 5)
- Video message
- Flex JSON Editor + preview
- Rich Message (image map)
- Insight (จำนวนคนได้รับ)

### Phase 2 (ทำทีหลัง)
- Coupon
- Survey/Poll
- A/B Testing
- Advanced analytics
