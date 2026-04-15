# LINE Enhancement

> Rich Menu + Flex Message + Quick Reply + Broadcast + Auto-greeting

## ฟีเจอร์ทั้งหมด 5 อย่าง

### 1. Rich Menu — เมนูด้านล่างแชท LINE

ลูกค้าเปิดแชท LINE → เห็นเมนูปุ่มด้านล่าง กดเข้าหน้าต่างๆ ได้เลย

**Layout 6 ปุ่ม (2x3):**

```
┌──────────┬──────────┬──────────┐
│ 📱 ดูสินค้า │ 💰 ผ่อนชำระ │ 📄 สัญญา  │
├──────────┼──────────┼──────────┤
│ 💳 ชำระเงิน │ 🎁 โปรโมชัน │ 📞 ติดต่อ  │
└──────────┴──────────┴──────────┘
```

| ปุ่ม | Action | ไปที่ |
|------|--------|------|
| ดูสินค้า | URI | LIFF หน้าสินค้า หรือ website |
| ผ่อนชำระ | URI | LIFF /liff/contract (ดูสัญญา+ผ่อน) |
| สัญญาของฉัน | URI | LIFF /liff/contract |
| ชำระเงิน | URI | LIFF /liff/early-payoff หรือ payment link |
| โปรโมชัน | message | ส่งข้อความ "โปรโมชัน" → bot ตอบ Flex Message โปรล่าสุด |
| ติดต่อเรา | message | ส่งข้อความ "ติดต่อ" → handoff to staff |

**Implementation:**
- สร้าง Rich Menu ผ่าน LINE Messaging API
- Upload รูป Rich Menu (1200x810 หรือ 2500x1686 px)
- ตั้งเป็น default menu สำหรับ OA
- OWNER สร้าง/แก้ไขผ่าน Settings page

### 2. Flex Message — ข้อความสวยๆ เป็น card

แทนข้อความธรรมดา ส่งเป็น card สวยๆ สำหรับ:

**A) ใบเสร็จ/ยืนยันชำระ**
```
┌─────────────────────┐
│ ✅ ชำระเงินสำเร็จ     │
│                      │
│ สัญญา: BC-2026-0042  │
│ งวดที่: 3/12          │
│ จำนวน: ฿2,946        │
│ วันที่: 15 เม.ย. 2026 │
│                      │
│ [ดูใบเสร็จ] [ดูสัญญา]  │
└─────────────────────┘
```

**B) แจ้งเตือนค่างวด**
```
┌─────────────────────┐
│ 🔔 แจ้งเตือนค่างวด    │
│                      │
│ สัญญา: BC-2026-0042  │
│ งวดที่ 4 ครบ 15 พ.ค.  │
│ จำนวน: ฿2,946        │
│                      │
│ [ชำระเงิน]            │
└─────────────────────┘
```

**C) สินค้า/โปรโมชัน**
```
┌─────────────────────┐
│ [รูปสินค้า]           │
│ iPhone 16 Pro 256GB  │
│ ฿44,900              │
│ ผ่อนเริ่มต้น ฿2,946/ด. │
│ 🎁 แถมเคส+ฟิล์ม      │
│                      │
│ [ดูรายละเอียด] [ผ่อน]  │
└─────────────────────┘
```

**D) ค้างชำระ (overdue)**
```
┌─────────────────────┐
│ ⚠️ แจ้งเตือนค้างชำระ   │
│                      │
│ ค้างชำระ 2 งวด       │
│ ยอดรวม: ฿6,892       │
│ ค่าปรับ: ฿200        │
│                      │
│ [ชำระเงินทันที]        │
└─────────────────────┘
```

**Implementation:**
- สร้าง Flex Message templates ใน backend
- ใช้ LINE Flex Message JSON format
- Template service สำหรับ generate Flex JSON จากข้อมูล
- แทนที่ข้อความ text ธรรมดาที่ส่งอยู่ปัจจุบัน

### 3. Quick Reply — ปุ่มตอบเร็ว

เมื่อ bot/staff ส่งข้อความ → แนบปุ่ม Quick Reply ใต้ข้อความ ลูกค้ากดได้เลย

**ใช้ตอน:**
- Bot ทักทาย → Quick Reply: "ดูสินค้า" "สอบถามราคา" "ดูสัญญา" "คุยกับพนักงาน"
- Bot ถามความสนใจ → Quick Reply: "iPhone" "Samsung" "OPPO" "อื่นๆ"
- หลังชำระ → Quick Reply: "ดูใบเสร็จ" "ดูยอดคงเหลือ"
- Staff ถามลูกค้า → สร้าง Quick Reply จาก AI suggest

**Implementation:**
- LINE Quick Reply API (แนบ `quickReply.items` ในข้อความ)
- แต่ละ item = { type: "action", action: { type: "message/uri", label, text/uri } }
- สูงสุด 13 items ต่อข้อความ
- สร้าง template set สำหรับแต่ละ scenario

### 4. Broadcast — ส่งข้อความหาลูกค้าทุกคน

OWNER/BRANCH_MANAGER ส่งข้อความหาผู้ติดตาม OA ทั้งหมด

**Use cases:**
- ประกาศสินค้าใหม่
- โปรโมชันพิเศษ
- แจ้งวันหยุด/เปลี่ยนเวลา
- ข่าวสารร้าน

**Implementation:**
- LINE Broadcast API (`POST /v2/bot/message/broadcast`)
- จำกัด: 500 ข้อความ/เดือน (free plan) หรือตามแพลน
- UI: หน้า Broadcast ให้ OWNER สร้าง + preview + ส่ง
- รองรับ: text, Flex Message, image
- ตั้งเวลาส่งล่วงหน้าได้ (schedule)
- Track: จำนวนคนเห็น, คนกด link

### 5. Auto-greeting — ข้อความต้อนรับ

ลูกค้า follow OA ครั้งแรก → ส่งข้อความต้อนรับอัตโนมัติ

**ข้อความ:**
```
┌─────────────────────┐
│ 🎉 ยินดีต้อนรับสู่      │
│ BESTCHOICE!          │
│                      │
│ ร้านมือถือผ่อนราคาดี   │
│ ดาวน์น้อย อนุมัติไว    │
│                      │
│ [ดูสินค้า] [โปรโมชัน]   │
│ [สาขา] [คุยกับเรา]     │
└─────────────────────┘
```

+ Quick Reply: "ดูสินค้า" "สอบถามราคา" "คุยกับพนักงาน"

**Implementation:**
- LINE follow event webhook → ส่ง Flex Message ต้อนรับ
- OWNER แก้ข้อความต้อนรับผ่าน Settings
- Track: จำนวน follow/unfollow

## Implementation Order

| ลำดับ | Feature | เหตุผล |
|-------|---------|--------|
| 1 | **Flex Message** | foundation — ใช้ใน Rich Menu, Broadcast, Greeting |
| 2 | **Auto-greeting** | ง่ายสุด + ใช้ Flex Message |
| 3 | **Quick Reply** | เพิ่ม UX ให้ bot/staff |
| 4 | **Rich Menu** | ต้องออกแบบรูป + upload |
| 5 | **Broadcast** | ซับซ้อนสุด (schedule, tracking) |

## Files

### New Files

| File | Purpose |
|------|---------|
| `apps/api/src/modules/line-oa/flex-templates.service.ts` | Generate Flex Message JSON templates |
| `apps/api/src/modules/line-oa/quick-reply.service.ts` | Generate Quick Reply items |
| `apps/api/src/modules/line-oa/rich-menu.service.ts` | Create/manage Rich Menu via API |
| `apps/api/src/modules/line-oa/broadcast.service.ts` | Broadcast messaging + scheduling |
| `apps/api/src/modules/line-oa/broadcast.controller.ts` | Broadcast API endpoints |
| `apps/web/src/pages/BroadcastPage.tsx` | Broadcast UI (create, preview, send, schedule) |

### Files to Modify

| File | Change |
|------|--------|
| `apps/api/src/modules/line-oa/line-oa.service.ts` | Use Flex Message instead of plain text |
| `apps/api/src/modules/notifications/notifications.service.ts` | Use Flex templates for payment notifications |
| `apps/api/src/modules/chatbot-finance/chatbot-finance.service.ts` | Add Quick Reply to bot responses |
| `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` | Handle follow event → auto-greeting |
| `apps/web/src/pages/LineOaSettingsPage.tsx` | Add greeting message editor + Rich Menu config |
