# LINE Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** เพิ่ม Flex Message, Auto-greeting, Quick Reply, Rich Menu, Broadcast สำหรับ LINE OA

**Architecture:** สร้าง FlexTemplateService เป็น foundation แล้วต่อยอด greeting/quick reply/broadcast ทับ

**Tech Stack:** NestJS, LINE Messaging API, React

---

## Task 1: Flex Message Template Service

**Files:**
- Create: `apps/api/src/modules/line-oa/flex-templates.service.ts`

Flex Message JSON templates สำหรับ:
- paymentReceipt(contract, payment) → ใบเสร็จ card
- paymentReminder(contract, payment) → แจ้งเตือนค่างวด
- overdueNotice(contract, overdueInfo) → ค้างชำระ
- productCard(product, pricing) → สินค้า+ราคา+โปร
- welcomeGreeting(config) → ข้อความต้อนรับ

แต่ละ method return LINE Flex Message JSON object ตาม spec.

Register in line-oa.module.ts.

---

## Task 2: Auto-greeting on Follow

**Files:**
- Modify: `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` (or chatbot-finance webhook)

เมื่อรับ follow event → ส่ง Flex welcome message + Quick Reply buttons

---

## Task 3: Quick Reply Service

**Files:**
- Create: `apps/api/src/modules/line-oa/quick-reply.service.ts`

Generate Quick Reply items สำหรับ scenarios:
- greeting: "ดูสินค้า" "สอบถามราคา" "ดูสัญญา" "คุยกับพนักงาน"
- afterPayment: "ดูใบเสร็จ" "ดูยอดคงเหลือ"
- productInquiry: "iPhone" "Samsung" "OPPO" "อื่นๆ"

---

## Task 4: Replace Plain Text with Flex Messages

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.service.ts`
- Modify: `apps/api/src/modules/line-oa/line-oa.service.ts`

เปลี่ยนจาก pushMessage(text) → pushMessage(flexMessage) สำหรับ:
- Payment success notification
- Payment reminder
- Overdue notice

---

## Task 5: Rich Menu Service + API

**Files:**
- Create: `apps/api/src/modules/line-oa/rich-menu.service.ts`

Methods:
- createRichMenu(config) → สร้าง Rich Menu ผ่าน LINE API
- uploadRichMenuImage(menuId, imageBuffer) → upload รูป
- setDefaultRichMenu(menuId) → ตั้งเป็น default
- getRichMenuList() → ดู menus ทั้งหมด
- deleteRichMenu(menuId) → ลบ

---

## Task 6: Broadcast Service + API + Frontend

**Files:**
- Create: `apps/api/src/modules/line-oa/broadcast.service.ts`
- Create: `apps/api/src/modules/line-oa/broadcast.controller.ts`
- Create: `apps/web/src/pages/BroadcastPage.tsx`

Broadcast: สร้าง + preview + ส่ง/ตั้งเวลา
- POST /line-oa/broadcast (send immediately)
- POST /line-oa/broadcast/schedule (send later)
- GET /line-oa/broadcast/history
- รองรับ text + Flex Message + image

---

## Task 7: Final — Settings UI + Type Check + Push

เพิ่ม greeting message editor ใน LINE OA Settings + routes + menu items
