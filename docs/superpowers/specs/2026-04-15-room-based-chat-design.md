# Room-Based Chat Refactor

> เปลี่ยนจาก session-based เป็น room-based เหมือน LINE/Facebook — 1 ห้อง = 1 ลูกค้า + 1 channel ประวัติอยู่ตลอด

## Problem

ระบบแชทปัจจุบันเป็น session-based (เหมือน Zendesk ticket):
- ลูกค้าทักมา → สร้าง session → พนักงานตอบ → resolve → ลูกค้าทักอีก → สร้าง session ใหม่
- ประวัติกระจายหลาย sessions — พนักงานเปิดมาไม่เห็นว่าคุยอะไรก่อนหน้า
- ลูกค้าคุยสลับ LINE ↔ Facebook → พนักงานไม่รู้ว่าถามอะไรมาแล้วอีก channel

ระบบยังไม่ได้ใช้งานจริง — refactor ใหม่ทั้งหมดได้เลย

## Design

### Core: 1 ลูกค้า + 1 channel = 1 ห้อง ตลอดชีวิต

```
ChatRoom (ไม่มีวันปิด)
  ├─ customerId + channel = unique key
  ├─ ChatMessage[] (ข้อความทั้งหมด timeline เดียว)
  ├─ assignedToId (พนักงานที่ดูแล)
  ├─ lastMessageAt (เรียง inbox)
  ├─ unreadCount (ข้อความที่ยังไม่อ่าน)
  ├─ pinnedAt (ปักหมุด)
  └─ status: ACTIVE | IDLE (ไม่มี RESOLVED/CLOSED)
```

- ลูกค้าทักมา → เข้าห้องเดิมเสมอ ไม่สร้างใหม่
- ข้อความทั้งหมดอยู่ในห้องเดียว scroll ย้อนดูได้
- ห้องไม่ปิด ไม่ resolve — ACTIVE = มีข้อความใหม่, IDLE = ไม่มีข้อความนาน

### Inbox ด้านซ้าย (3 tabs)

| Tab | แสดง |
|-----|------|
| **ของฉัน** | ห้องที่ assign ให้ฉัน |
| **ทั้งหมด** | ทุกห้อง |
| **ยังไม่อ่าน** | ห้องที่ unreadCount > 0 |

- เรียงตาม: pin อยู่บนสุด → lastMessageAt (ล่าสุดอยู่บน)
- Channel filter: LINE / Facebook / TikTok / Web
- Search: ค้นหาชื่อลูกค้า / เบอร์โทร
- ไม่มี status tabs (OPEN/RESOLVED) อีก

### ห้องแยก channel — Customer360 เชื่อม

ลูกค้า 1 คนทักมาหลาย channel = หลายห้อง (ไม่รวมข้าม channel):

```
ลูกค้า สมชาย:
  ห้อง LINE Finance     ← ห้องแยก
  ห้อง Facebook         ← ห้องแยก
```

**Customer360 Panel (ด้านขวา)** แสดงทุกห้องของลูกค้าคนเดียว:

```
── ห้องแชททั้งหมด ──
🟢 LINE:     "iPhone 16 เท่าไหร่"        14 เม.ย. 15:30
🔵 Facebook: "ผ่อนกี่เดือนได้บ้าง"       15 เม.ย. 10:15 ← กำลังคุย
```

- แสดง: channel icon, ข้อความล่าสุด, วัน+เวลา
- กดข้ามไปดูห้องอื่นได้
- AI Summary รวมจากทุก channel: "ลูกค้าสนใจ iPhone 16 ถามราคาใน LINE เมื่อวาน วันนี้ถามเรื่องผ่อนใน Facebook"

### ตอบกลับ

พนักงานตอบ → ส่งกลับช่องทางของห้องนั้นอัตโนมัติ (ห้อง LINE ก็ส่ง LINE, ห้อง FB ก็ส่ง FB)

## ฟีเจอร์ใหม่ (รวมใน refactor)

### 1. @mention ในทีม

- พิมพ์ `@` ใน internal note → แสดง dropdown รายชื่อพนักงาน
- เลือก → ส่ง notification ไปหาคนนั้น (WebSocket + bell icon)
- คนถูก mention เห็น badge ใน inbox ว่ามีคนเรียก

### 2. Typing Indicator ฝั่งลูกค้า

- LINE/Facebook ส่ง typing event มา → แสดง "กำลังพิมพ์..." ใน chat panel
- ใช้ WebSocket emit `TYPING` event → frontend แสดง animation
- Auto-hide หลัง 5 วินาทีถ้าไม่มี typing event ใหม่

### 3. Read Receipt ✓✓ per message

- พนักงานเปิดห้อง → mark messages as read → `readAt = now()` per message
- แสดง ✓✓ (สองติ๊กสีฟ้า) ข้างข้อความที่อ่านแล้ว
- ✓ (ติ๊กเดียว) = ส่งแล้วยังไม่อ่าน
- unreadCount ลดลงเมื่อพนักงานเปิดดู

### 4. Pin ห้อง

- พนักงานกดปักหมุดห้อง → `pinnedAt = now()`
- ห้องที่ pin อยู่ด้านบน inbox เสมอ ไม่ว่าจะมีข้อความใหม่หรือไม่
- กด unpin → `pinnedAt = null`

## Database Changes

### Rename ChatSession → ChatRoom

```prisma
model ChatRoom {
  id                String         @id @default(uuid())
  externalUserId    String         @map("external_user_id")
  customerId        String?        @map("customer_id")
  customer          Customer?      @relation(fields: [customerId], references: [id])
  channel           ChatChannel
  
  // Room state (no RESOLVED/CLOSED)
  status            ChatRoomStatus @default(ACTIVE) // ACTIVE, IDLE
  assignedToId      String?        @map("assigned_to_id")
  assignedTo        User?          @relation(fields: [assignedToId], references: [id])
  
  // Metrics
  unreadCount       Int            @default(0) @map("unread_count")
  lastMessageAt     DateTime       @default(now()) @map("last_message_at")
  totalMessages     Int            @default(0) @map("total_messages")
  
  // Features
  pinnedAt          DateTime?      @map("pinned_at")
  pinnedById        String?        @map("pinned_by_id")
  
  // AI/Lead
  leadScore         Int?           @map("lead_score")
  leadTemperature   String?        @map("lead_temperature")
  attributionId     String?        @map("attribution_id")
  
  // Handoff
  handoffMode       Boolean        @default(false) @map("handoff_mode")
  handoffReason     String?        @map("handoff_reason")
  handoffStaffId    String?        @map("handoff_staff_id")
  
  // MDM
  // (MDM is on Contract, not room)
  
  // Relations
  messages          ChatMessage[]
  tags              ConversationTag[]
  notes             ChatNote[]
  trainingPairs     AiTrainingPair[]
  autoReplyLogs     AiAutoReplyLog[]
  
  createdAt         DateTime       @default(now()) @map("created_at")
  updatedAt         DateTime       @updatedAt @map("updated_at")
  deletedAt         DateTime?      @map("deleted_at")

  @@unique([externalUserId, channel])
  @@index([customerId])
  @@index([assignedToId, status])
  @@index([lastMessageAt])
  @@index([pinnedAt])
  @@map("chat_rooms")
}

enum ChatRoomStatus {
  ACTIVE
  IDLE
}
```

### Update ChatMessage — add readAt

```prisma
model ChatMessage {
  // ... existing fields
  readAt            DateTime?      @map("read_at")    // NEW: null = unread, set = read
  
  // Rename relation
  roomId            String         @map("room_id")    // was sessionId
  room              ChatRoom       @relation(fields: [roomId], references: [id])
}
```

### Remove

- Remove `ChatSessionStatus` enum (OPEN/PENDING/HANDOFF/RESOLVED/ARCHIVED)
- Add `ChatRoomStatus` enum (ACTIVE/IDLE)
- Remove `ChatSession` model (replaced by `ChatRoom`)

## Implementation Scope

### Backend — Rename + Refactor

| Area | Files (~) | Change |
|------|-----------|--------|
| DB Schema | 1 | ChatSession → ChatRoom, add readAt, new enum |
| Room Manager | 1 | session-manager → room-manager, never create new for same user+channel |
| Message Router | 1 | Reference ChatRoom instead of ChatSession |
| Staff Chat Controller | 1 | Rename endpoints /sessions/ → /rooms/ |
| Staff Chat Gateway | 1 | WS rooms: chat:session → chat:room |
| Assignment Service | 1 | Use ChatRoom |
| Handoff Service | 1 | Use ChatRoom |
| AI Services | 4 | ai-suggest, lead-scoring, ai-training, ai-auto-reply → use roomId |
| Chat Adapters | 5 | Facebook, LINE, TikTok, Web → use ChatRoom |
| Cron Jobs | 3 | Remove autoResolve, update SLA check, training extract |
| After Hours | 1 | Use ChatRoom |
| Other refs | ~20 | Any file referencing ChatSession / sessionId |

### Frontend — Refactor Inbox

| Area | Files (~) | Change |
|------|-----------|--------|
| UnifiedInboxPage | 1 | 3 tabs (ของฉัน/ทั้งหมด/ยังไม่อ่าน) + channel filter |
| ConversationList | 1 | Remove status tabs, add pin sort |
| ConversationItem | 1 | Show pin icon, unread badge per room |
| ChatPanel | 1 | Add read receipt ✓✓, typing indicator |
| Customer360Panel | 1 | Show all rooms per customer with last message + datetime |
| ChannelFilter | 1 | Remove status filters, keep channel only |
| AiSuggestPanel | 1 | roomId instead of sessionId |
| ProductContextCard | 1 | roomId instead of sessionId |
| Internal Notes | 1 | Add @mention dropdown |
| New: PinButton | 1 | Pin/unpin room |
| useChatSocket hook | 1 | chat:room:{id} instead of chat:session:{id} |

### API Endpoint Changes

| Before | After |
|--------|-------|
| `GET /staff-chat/sessions` | `GET /staff-chat/rooms` |
| `GET /staff-chat/sessions/:id` | `GET /staff-chat/rooms/:id` |
| `GET /staff-chat/sessions/:id/messages` | `GET /staff-chat/rooms/:id/messages` |
| `PATCH /staff-chat/sessions/:id/assign` | `PATCH /staff-chat/rooms/:id/assign` |
| `POST /staff-chat/sessions/:id/suggest` | `POST /staff-chat/rooms/:id/suggest` |
| `GET /staff-chat/sessions/:id/products` | `GET /staff-chat/rooms/:id/products` |
| `GET /staff-chat/sessions/:id/lead-score` | `GET /staff-chat/rooms/:id/lead-score` |
| ... | ... (ทุก /sessions/ → /rooms/) |

New endpoints:
| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/staff-chat/rooms/:id/pin` | Pin room |
| DELETE | `/staff-chat/rooms/:id/pin` | Unpin room |
| POST | `/staff-chat/rooms/:id/read` | Mark all messages as read |
| GET | `/staff-chat/rooms/:id/cross-channel` | Get all rooms for same customer |
| POST | `/staff-chat/notes/:id/mention` | @mention notification |

## Migration Strategy

ยังไม่มีข้อมูลจริง → **drop and recreate**:
1. Drop ChatSession table + related
2. Create ChatRoom table + updated ChatMessage
3. Re-seed dev data if needed
4. Global find-replace: ChatSession → ChatRoom, sessionId → roomId, session → room

## UI Refactor — LINE OA Chat Style

### Design Reference

สไตล์เหมือน LINE OA Chat: สะอาด เรียบง่าย พนักงานร้านมือถือคุ้นเคย

### Layout: 3-Panel (คงเดิมแต่ refactor ทุก panel)

```
┌─────────────┬──────────────────┬───────────┐
│  Inbox      │  Chat            │  Info     │
│  (w-80)     │  (flex-1)        │  (w-72)   │
│             │                  │           │
│ 🔍 Search   │ สมชาย (🟢LINE)   │ 👤 ลูกค้า │
│             │                  │           │
│ ของฉัน|ทั้งหมด|ใหม่│              │ สัญญา   │
│ LINE|FB|TT|Web│              │ ชำระ     │
│             │  ╭───────╮       │           │
│ 📌สมชาย  3  │  │สวัสดีครับ│      │ ── ห้องอื่น── │
│ 🟢สมหญิง   │  ╰───────╯       │ 🟢LINE 14เมย│
│   ผ่อนกี่..  │      ╭─────╮    │ 🔵FB   15เมย│
│ 🔵สมศักดิ์  │      │เท่าไหร่│   │           │
│   ให้ไหม..  │      ╰─────╯    │           │
│             │                  │           │
│             │ ✨AI: 2 suggest  │           │
│             │ [พิมพ์...]  ส่ง  │           │
└─────────────┴──────────────────┴───────────┘
```

### Panel 1: Inbox (ด้านซ้าย)

**Search bar** — ค้นหาชื่อ/เบอร์โทร

**3 Tabs:**
- ของฉัน (ห้องที่ assign ให้ฉัน)
- ทั้งหมด
- ยังไม่อ่าน (unreadCount > 0)

**Channel filter chips:** LINE | Facebook | TikTok | Web (เลือกได้หลายอัน)

**Room item แต่ละรายการ:**
- Avatar วงกลม + สี channel (เขียว=LINE, น้ำเงิน=FB, ชมพู=TikTok, เทา=Web)
- ชื่อลูกค้า + lead badge (🔥HOT / WARM)
- ข้อความล่าสุด (1 บรรทัด ตัด)
- เวลา (14:30 / เมื่อวาน / 14 เม.ย.)
- Unread count badge (วงกลมแดง + ตัวเลข)
- 📌 Pin icon ถ้าปักหมุด

**เรียงลำดับ:** Pin อยู่บน → ล่าสุดอยู่บน

### Panel 2: Chat (กลาง)

**Header:**
- ชื่อลูกค้า + channel badge (🟢LINE / 🔵Facebook)
- ปุ่ม: assign, transfer, pin, more actions

**Messages:**
- ลูกค้า: bubble สีเทาอ่อน ชิดซ้าย (rounded-2xl, rounded-bl-sm)
- พนักงาน: bubble สีน้ำเงิน ชิดขวา (rounded-2xl, rounded-br-sm)
- Bot/AI: bubble สีม่วงอ่อน ชิดขวา
- System: pill สีเทากลาง
- ทุกข้อความมี: เวลา + ✓✓ (อ่านแล้ว) / ✓ (ส่งแล้ว)
- Typing indicator: "กำลังพิมพ์..." animation จุด 3 จุด
- วันที่ separator: "── 14 เมษายน 2026 ──"

**AI Suggest Panel:** (ใต้ messages, เหนือ input)
- แถบ suggestion cards แนวนอน scroll
- กด → ใส่ใน input

**Input area:**
- ปุ่มแนบไฟล์ + emoji
- Textarea (auto-grow)
- ปุ่มส่ง (สีน้ำเงิน)

### Panel 3: Info (ด้านขวา)

**Customer profile:** ชื่อ, เบอร์, avatar

**สัญญา & ชำระ:** (เหมือน Customer360 เดิม)

**ห้องแชททั้งหมด (NEW):**
```
── ห้องแชททั้งหมด ──
🟢 LINE:     "iPhone 16 เท่าไหร่"     14 เม.ย. 15:30
🔵 Facebook: "ผ่อนกี่เดือนได้บ้าง"    15 เม.ย. 10:15 ← กำลังคุย
```
- แสดง: channel icon + ข้อความล่าสุด + วัน+เวลา
- กดข้ามไปดูห้องอื่นได้

**AI Summary:** สรุปรวมจากทุก channel (2-3 บรรทัด)

**สินค้าที่สนใจ:** ProductContextCard ย้ายมาอยู่ถาวร (AI detect จากแชท + ราคา/สต็อก/โปร)

**ประวัติ MDM:** สถานะเครื่อง (ล็อค/ไม่ล็อค) + วันที่ล็อค/ปลดล็อคล่าสุด (จาก contract.mdmLockedAt)

**ประกันสินค้า:** วันหมดประกัน + เหลือกี่วัน (จาก product.warrantyExpireDate ที่มีอยู่)

**Quick actions:** ส่งลิงก์ชำระ, สร้างสัญญา, ดูข้อมูลลูกค้า

### Mobile (responsive)

- **Mobile:** แสดงทีละ panel — กดห้อง → เข้า chat → กด info → เห็น customer panel
- **Bottom nav:** ยังใช้ role-based จาก sidemenu redesign (แชทอยู่ใน bottom nav)

### Color Scheme

| Element | Color |
|---------|-------|
| Customer bubble | `bg-gray-100 text-gray-900` |
| Staff bubble | `bg-blue-500 text-white` |
| Bot bubble | `bg-purple-50 text-purple-900 border-purple-100` |
| System message | `bg-gray-50 text-gray-500` |
| Unread badge | `bg-red-500 text-white` |
| Read receipt ✓✓ | `text-blue-400` |
| PIN icon | `text-amber-500` |
| LINE channel | `bg-green-500` |
| Facebook channel | `bg-blue-600` |
| TikTok channel | `bg-pink-500` |
| Web channel | `bg-gray-500` |

## สิ่งที่คงเดิม

- Chat adapters (LINE, Facebook, TikTok, Web) — แค่เปลี่ยน reference
- AI Suggest, Lead Scoring, Product Detect — logic เดิม แค่ใช้ roomId
- Handoff system — ยังทำงานเหมือนเดิม
- Canned Responses — ไม่เปลี่ยน
- Collision Detection, Presence — เปลี่ยน room name
- Auto-reply, Training, Metrics — แค่ rename references
