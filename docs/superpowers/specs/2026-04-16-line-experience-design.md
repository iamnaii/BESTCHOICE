# LINE Experience Upgrade — Design Spec

**Date:** 2026-04-16
**Approach:** All-in-One (ship ทุกส่วนพร้อมกัน)
**Scope:** Rich Menu Personalized + Greeting Onboarding + Flex Message Visual + Chatbot Context-Aware

---

## 1. Overview

ยกระดับ LINE OA ทั้ง 2 ช่อง (SHOP + FINANCE) ให้ professional เทียบเงินติดล้อ/KTC:

| ส่วน | สถานะปัจจุบัน | เป้าหมาย |
|------|--------------|----------|
| Rich Menu | มี 1 menu ต่อ OA, ไม่ personalized | 4 menus (2 OA × 2 สถานะ), สลับอัตโนมัติ |
| Greeting | ไม่มี greeting flow | Interactive onboarding (ลูกค้าเดิม vs ใหม่) |
| Flex Message | มี 12 templates, design พื้นฐาน | Style C (Card + Status + Progress), SVG icons, ไม่มี emoji |
| Chatbot | Claude Haiku ตอบ FAQ | เพิ่ม tool use ดึงข้อมูลสัญญา/ยอดได้ |

### Design Principles

- **Branding เดียวกัน** ทั้ง 2 OA — สี, font, icon style เหมือนกัน แต่ฟังก์ชันต่าง
- **ไม่ใช้ emoji** — ใช้ SVG/PNG icon host บน S3/CDN แทน
- **Design Language: Style C** — icon header (44px rounded) + status badge + info card (rounded-12) + progress bar + CTA buttons
- **Color system:** เขียว = ปกติ/สำเร็จ, แดง = ค้างชำระ, น้ำเงิน = ข้อมูล, ส้ม = โปรโมชั่น/เตือน

---

## 2. Rich Menu — Personalized Menu System

### สถานะลูกค้า → Menu ที่เห็น

| สถานะ | SHOP OA | FINANCE OA |
|--------|---------|------------|
| ยังไม่ verify (add OA แล้ว ยังไม่ลงทะเบียน) | Shop Default Menu | Finance Default Menu |
| Verify แล้ว (ลงทะเบียนสำเร็จ) | Shop Verified Menu | Finance Verified Menu |

รวม **4 Rich Menu images** (2500×1686 px)

### SHOP OA — Default (ยังไม่ verify)

```
┌─────────────────┬─────────────────┬─────────────────┐
│  ดูรุ่นที่มี     │  คำนวณค่างวด    │  โปรโมชั่น      │
├─────────────────┼─────────────────┼─────────────────┤
│  สาขาใกล้ฉัน    │  ลงทะเบียน      │  แชทกับเรา      │
└─────────────────┴─────────────────┴─────────────────┘
```

- ปุ่ม "ลงทะเบียน" เด่น (สีต่าง/มี badge) เพื่อ nudge ให้ verify
- Actions: ดูสินค้า (URI website), คำนวณ (URI calculator), โปรโมชั่น (message), สาขา (URI LIFF branches), ลงทะเบียน (URI LIFF register), แชท (message)

### SHOP OA — Verified

```
┌─────────────────┬─────────────────┬─────────────────┐
│  ดูรุ่นที่มี     │  คำนวณค่างวด    │  สัญญาของฉัน    │
├─────────────────┼─────────────────┼─────────────────┤
│  จ่ายค่างวด     │  โปรโมชั่น      │  แชทกับเรา      │
└─────────────────┴─────────────────┴─────────────────┘
```

- "ลงทะเบียน" หายไป → แทนที่ด้วย "สัญญาของฉัน" + "จ่ายค่างวด"
- Actions: สัญญา (URI LIFF contract), จ่ายค่างวด (URI LIFF payment)

### FINANCE OA — Default (ยังไม่ verify)

```
┌─────────────────┬─────────────────┬─────────────────┐
│  เช็คยอด        │  ลงทะเบียน      │  วิธีชำระเงิน   │
├─────────────────┼─────────────────┼─────────────────┤
│  สาขาใกล้ฉัน    │  ติดต่อเรา      │  ถามน้องเบส     │
└─────────────────┴─────────────────┴─────────────────┘
```

- "ลงทะเบียน" ตรงกลาง row แรก เด่นสุด
- Actions: เช็คยอด (message), ลงทะเบียน (URI LIFF finance-verify), วิธีชำระ (message), สาขา (URI LIFF branches), ติดต่อ (message), ถามน้องเบส (message)

### FINANCE OA — Verified

```
┌─────────────────┬─────────────────┬─────────────────┐
│  เช็คยอด        │  ชำระเงิน       │  สัญญาของฉัน    │
├─────────────────┼─────────────────┼─────────────────┤
│  ประวัติชำระ    │  ตารางงวด       │  ถามน้องเบส     │
└─────────────────┴─────────────────┴─────────────────┘
```

- เต็มไปด้วย financial features
- Actions: เช็คยอด (message), ชำระเงิน (URI LIFF payment), สัญญา (URI LIFF contract), ประวัติ (URI LIFF history), ตารางงวด (URI LIFF contract), ถามน้องเบส (message)

### Technical: วิธีสลับ Menu

ใช้ LINE Messaging API:
- `POST /v2/bot/user/{userId}/richmenu/{richMenuId}` — link menu ให้ user
- `DELETE /v2/bot/user/{userId}/richmenu` — unlink menu

Trigger points:
- **Follow event** → link default menu
- **LIFF register/finance-verify success** → link verified menu
- **Unlink profile (LIFF)** → link default menu กลับ
- **Re-follow (เคย verify)** → link verified menu ทันที (ตรวจจาก DB ว่า lineUserId มี customer ผูกอยู่)

ต้องเก็บ Rich Menu IDs 4 ตัวใน `SystemConfig` หรือ `.env`:
- `RICH_MENU_SHOP_DEFAULT`
- `RICH_MENU_SHOP_VERIFIED`
- `RICH_MENU_FINANCE_DEFAULT`
- `RICH_MENU_FINANCE_VERIFIED`

### Rich Menu Image — Prompt สำหรับ Gemini/Canva

สร้าง 4 รูป ขนาด **2500×1686 px** (PNG/JPEG)

**Design spec ทุกรูป:**
- Grid: 2 rows × 3 columns
- พื้นหลัง: gradient เขียว BESTCHOICE (#10b981 → #059669) สำหรับ SHOP, gradient น้ำเงิน (#3b82f6 → #2563eb) สำหรับ FINANCE
- แต่ละช่อง: icon สีขาว (line-style, ไม่ใช่ emoji) + label สีขาว ตัวหนา
- เส้นแบ่งช่อง: เส้นสีขาว opacity 20%
- มุมบนซ้าย: โลโก้ BESTCHOICE เล็กๆ (ถ้ามี)
- Font: clean sans-serif (Inter / Noto Sans Thai)

**Prompt (ใช้ได้กับ Gemini/Midjourney/Canva AI):**

```
SHOP Default:
"Design a LINE Rich Menu image, 2500x1686 pixels, 2 rows × 3 columns grid layout.
Green gradient background (#10b981 to #059669). Each cell has a white line-style icon
and white bold Thai label below. Thin white separator lines between cells (20% opacity).
Clean, modern, professional look like a banking app.
Row 1: [smartphone icon] ดูรุ่นที่มี | [calculator icon] คำนวณค่างวด | [gift icon] โปรโมชั่น
Row 2: [map-pin icon] สาขาใกล้ฉัน | [check-circle icon, highlighted] ลงทะเบียน | [chat icon] แชทกับเรา
The 'ลงทะเบียน' cell should have a slightly brighter/lighter background to stand out.
Small 'BESTCHOICE' wordmark in top-left corner."

SHOP Verified:
"Same design as above but:
Row 1: [smartphone icon] ดูรุ่นที่มี | [calculator icon] คำนวณค่างวด | [file-text icon] สัญญาของฉัน
Row 2: [credit-card icon] จ่ายค่างวด | [gift icon] โปรโมชั่น | [chat icon] แชทกับเรา
No highlighted cell."

FINANCE Default:
"Design a LINE Rich Menu image, 2500x1686 pixels, 2 rows × 3 columns grid layout.
Blue gradient background (#3b82f6 to #2563eb). Same style as above.
Row 1: [dollar-sign icon] เช็คยอด | [check-circle icon, highlighted] ลงทะเบียน | [help-circle icon] วิธีชำระเงิน
Row 2: [map-pin icon] สาขาใกล้ฉัน | [phone icon] ติดต่อเรา | [message-circle icon] ถามน้องเบส
The 'ลงทะเบียน' cell should have a slightly brighter/lighter background."

FINANCE Verified:
"Same blue gradient design but:
Row 1: [dollar-sign icon] เช็คยอด | [credit-card icon] ชำระเงิน | [file-text icon] สัญญาของฉัน
Row 2: [list icon] ประวัติชำระ | [calendar icon] ตารางงวด | [message-circle icon] ถามน้องเบส
No highlighted cell."
```

---

## 3. Greeting & Interactive Onboarding Flow

### SHOP OA — Follow Event

```
[Follow Event]
    │
    ├─ ตรวจ: lineUserId มี customer ผูกอยู่ใน DB?
    │
    ├─ YES (re-follow, เคย verify) ──→ Link verified Rich Menu
    │                                    + ส่ง Flex: "ยินดีต้อนรับกลับมา!"
    │                                    + Quick Reply: "เช็คยอด" / "ดูสัญญา" / "ช่วยเหลือ"
    │
    └─ NO (ใหม่ หรือไม่เคย verify) ──→ Link default Rich Menu
                                         + ส่ง Flex Welcome Bubble:
                                           "ยินดีต้อนรับสู่ BESTCHOICE!"
                                           "ร้านมือถือครบวงจร ผ่อนสบาย ดอกเบี้ยต่ำ"
                                           + banner image
                                         + Quick Reply 2 ปุ่ม:
                                           "ฉันเป็นลูกค้าใหม่" → Carousel แนะนำบริการ
                                           "ฉันมีสัญญาอยู่แล้ว" → Flex ปุ่มลงทะเบียน → LIFF Register
```

### FINANCE OA — Follow Event

```
[Follow Event]
    │
    ├─ ตรวจ: lineUserId มี customer ผูกอยู่ใน DB (Finance)?
    │
    ├─ YES (re-follow) ──→ Link verified Rich Menu
    │                       + ส่ง Flex: "ยินดีต้อนรับกลับมา!"
    │                       + Quick Reply: "เช็คยอด" / "ชำระเงิน" / "ช่วยเหลือ"
    │
    └─ NO ──→ Link default Rich Menu
              + ส่ง Flex Welcome Bubble:
                "สวัสดีค่ะ! BESTCHOICE FINANCE"
                "จัดการสัญญาผ่อนชำระ ชำระค่างวด ดูประวัติ ได้ที่นี่"
              + Quick Reply 2 ปุ่ม:
                "ลงทะเบียนสัญญา" → LIFF Finance Verify (OTP)
                "วิธีชำระเงิน" → Flex แนะนำ 3 ช่องทาง + ปุ่มลงทะเบียน
```

### หลัง Verify สำเร็จ (ทั้ง 2 OA)

```
[Verify Success]
    │
    ├─→ สลับ Rich Menu → Verified version
    │
    └─→ ส่ง Flex "ลงทะเบียนสำเร็จ!"
         แสดง: ชื่อลูกค้า + สัญญาที่ผูก
         + Quick Reply: "เช็คยอด" / "ดูสัญญา" / "ช่วยเหลือ"
```

### Unfollow Event

- Unlink Rich Menu (LINE ทำอัตโนมัติ)
- ไม่ลบข้อมูลลูกค้าจาก DB — เก็บไว้สำหรับ re-follow

---

## 4. Flex Message Visual Upgrade

### Design Language: Style C — Card with Status + Progress

ทุก template ใช้โครงสร้างเดียวกัน:

```
┌───────────────────────────────────────┐
│ [icon 44px]  Title           [badge]  │  ← Header
│              Subtitle                 │
├───────────────────────────────────────┤
│ ┌───────────────────────────────────┐ │
│ │ Label             Value           │ │  ← Info Card
│ │ ฿X,XXX.XX                        │ │     (rounded-12, tinted bg)
│ │ Sub-info                          │ │
│ └───────────────────────────────────┘ │
│                                       │
│ ████████░░░░░░░░░░░░░  33%           │  ← Progress Bar (ถ้ามี)
│ ชำระแล้ว 4 งวด    เหลือ 8 งวด       │
│                                       │
│ [  Primary CTA  ] [ Secondary CTA ]  │  ← Buttons
└───────────────────────────────────────┘
```

### Icon System

ไม่ใช้ emoji — ใช้ icon PNG/SVG host บน S3/CDN:

| Icon | ใช้กับ | สี background |
|------|--------|---------------|
| credit-card | แจ้งเตือนค่างวด | เขียว gradient |
| alert-triangle | ค้างชำระ | แดง gradient |
| check-circle | ชำระสำเร็จ | เขียว gradient |
| bar-chart | สรุปยอด | น้ำเงิน gradient |
| smartphone | Welcome | เขียว gradient |
| gift | โปรโมชั่น | ส้ม gradient |
| file-text | สัญญา | เขียว gradient |
| qr-code | PromptPay QR | เขียว gradient |

Icon ต้อง host เป็น URL เพราะ LINE Flex Message ใช้ `icon.url` property (ไม่รองรับ inline SVG)

### Templates ที่ต้อง upgrade (12 ตัว)

| # | Template | สีหลัก | มี Progress | Badge |
|---|----------|--------|------------|-------|
| 1 | payment-reminder | เขียว | Yes | เหลือง "อีก X วัน" |
| 2 | overdue-notice | แดง | No | แดง "ค้างชำระ" |
| 3 | payment-success | เขียว | Yes | เขียว "สำเร็จ" |
| 4 | balance-summary | น้ำเงิน | Yes | เขียว "ปกติ" / แดง "ค้างชำระ" |
| 5 | promptpay-qr | เขียว | No | — |
| 6 | contract-signed | เขียว | No | เขียว "เปิดสัญญา" |
| 7 | campaign | ส้ม | No | — |
| 8 | contract-selector | เขียว | No | — |
| 9 | daily-report | น้ำเงิน | No | — (staff only) |
| 10 | receipt | เขียว | No | เขียว "สำเร็จ" |
| 11 | receipt-history | เขียว | No | — |
| 12 | welcome (ใหม่) | เขียว | No | — |

### Color System

```
เขียว (ปกติ/สำเร็จ):  bg: #10b981→#059669  badge-bg: #dcfce7  badge-text: #16a34a  info-bg: #f0fdf4  info-border: #bbf7d0
แดง (ค้างชำระ):       bg: #ef4444→#dc2626  badge-bg: #fee2e2  badge-text: #dc2626  info-bg: #fef2f2  info-border: #fecaca
น้ำเงิน (ข้อมูล):     bg: #3b82f6→#2563eb  badge-bg: #dbeafe  badge-text: #2563eb  info-bg: #eff6ff  info-border: #bfdbfe
เหลือง (เตือน):       badge-bg: #fef3c7  badge-text: #d97706
ส้ม (โปรโมชั่น):      bg: #f59e0b→#ea580c  hint-bg: #fef3c7  hint-text: #92400e  tip-bg: #fffbeb
```

### Mockups

Visual mockups อยู่ใน `.superpowers/brainstorm/` directory — เปิดดูได้ผ่าน visual companion server

---

## 5. Chatbot Context-Aware (น้องเบส)

### Approach

ต่อยอดจากโครงสร้างเดิมใน `chatbot.service.ts` + `line-oa-chatbot.controller.ts` — เพิ่ม tool use ให้ Claude Haiku ดึงข้อมูลลูกค้าผ่าน LINE userId ที่ผูกไว้

### ขอบเขต

- **อ่านได้อย่างเดียว** — bot ดึงข้อมูลมาตอบ แต่ไม่ทำ transaction
- **Action ส่งไป LIFF** — ถ้าลูกค้าอยากจ่ายเงิน bot ส่ง Flex พร้อมปุ่มเปิด LIFF
- **ต้อง verify แล้วเท่านั้น** — ถ้า lineUserId ไม่ผูก → ตอบ FAQ + แนะนำลงทะเบียน
- **ข้อมูลส่งเป็น Flex Message** — ไม่ส่งยอดเงินเป็น plain text เพื่อความปลอดภัย

### Implementation

ยึดตามโครงสร้างเดิม — ดู `chatbot.service.ts`, `chatbot-system-prompt.constants.ts`, `quick-reply.service.ts` เป็น reference แล้วเพิ่ม:
1. ตรวจ lineUserId → หา Customer ที่ผูกอยู่
2. ถ้าพบ → inject ข้อมูลสัญญาเป็น context ให้ Claude Haiku
3. Claude ตอบ + สร้าง Flex Message ตาม template ที่มี

---

## 6. Existing Infrastructure (ไม่ต้องสร้างใหม่)

สิ่งที่มีอยู่แล้วและ reuse ได้:

| Component | Location | สถานะ |
|-----------|----------|-------|
| LIFF 10 pages | `apps/web/src/pages/liff/` | ใช้ได้เลย |
| LINE OA module | `apps/api/src/modules/line-oa/` | ต่อยอด |
| RichMenuService | `rich-menu/rich-menu.service.ts` | เพิ่ม linkToUser/unlinkFromUser |
| Flex templates 12 ตัว | `flex-messages/` | upgrade visual |
| Chatbot + Claude Haiku | `chatbot.service.ts` | เพิ่ม tool use |
| Broadcast/Campaign cron | `broadcast.service.ts` | ใช้ได้เลย |
| LIFF auth guard | `liff-token.guard.ts` | ใช้ได้เลย |
| LINE Login OAuth | `line-login.controller.ts` | ใช้ได้เลย |
| Quick Reply service | `quick-reply.service.ts` | ต่อยอด |
| Webhook dedup | `WebhookDedupService` | ใช้ได้เลย |

---

## 7. New Work Summary

| งาน | ประเภท | ความซับซ้อน |
|-----|--------|------------|
| Rich Menu image × 4 | Design (Gemini/Canva) | ต่ำ |
| Rich Menu personalized switching | Backend (LINE API) | กลาง |
| Greeting flow — SHOP OA | Backend (webhook handler) | กลาง |
| Greeting flow — FINANCE OA | Backend (webhook handler) | กลาง |
| Welcome Flex template | Backend (new flex template) | ต่ำ |
| Re-welcome Flex template | Backend (new flex template) | ต่ำ |
| Verify success Flex template | Backend (new flex template) | ต่ำ |
| Flex visual upgrade × 12 | Backend (rewrite templates) | กลาง-สูง |
| Icon set host on S3 | Infra (upload PNGs) | ต่ำ |
| Chatbot context-aware | Backend (tool use + DB query) | กลาง |
| Chatbot Flex responses | Backend (flex builder) | กลาง |
| Admin: Rich Menu ID config | Frontend + Backend | ต่ำ |
