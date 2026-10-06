# Chat Operations UX prototype — ผลตรวจ

วันที่ตรวจ: 2026-10-06 (Asia/Bangkok)

## Artifact และขอบเขต

- [ต้นแบบ HTML](../prototypes/chat-operations/index.html), [วิธีทดลอง](../prototypes/chat-operations/README.md)
- Local preview ของต้นแบบ: http://localhost:5286
- เพิ่มเฉพาะ design artifacts ใน docs; ไม่มีการแก้ source ของแอป API/schema/React
- ใช้ข้อมูลสมมติใน memory ไม่ส่งข้อความหรือเข้าถึงฐานข้อมูลจริง

## ต้นแบบ: PASS

ตรวจด้วย Chromium/Playwright และดู screenshots จริง:

- ส่งล้มไม่ล้างคิวรอตอบ; retry สำเร็จจึงล้าง
- ตั้งนัดแล้วแสดง next action/วัน/ผู้รับผิดชอบ
- ส่งงาน → เปลี่ยนเป็นผู้รับ → เปิดแจ้งเตือน → รับงาน → จบงาน; ผู้ดูแลแชทยังเป็นคนเดิม
- บันทึกโน้ตและ Mention แยกจาก customer message
- ตอบคอมเมนต์ผ่าน composer สาธารณะ
- รับเรื่องบริการก่อนผูกเคส; มีข้อความว่ายังไม่ใช่รับฝากเครื่อง; ไม่ผูกเคสให้ลูกค้า/เครื่องที่ไม่ตรงกับ fixture
- กดแชทค้างในรายงานแล้วกลับไปคิว; สลับ SHOP/FINANCE แล้วรายการแยกกัน; ไม่แสดงยอดขาย SHOP ใน FINANCE
- 320/390/768/1024/1440px: queue, conversation, customer details, schedule dialog, comments, report รวม 30 layout checks ไม่พบ horizontal overflow
- เพิ่ม 2 behavior checks สำหรับ no false case match และ scoped sales รวมรอบสุดท้าย 32 checks ไม่มี pageerror
- Escape ปิด dialog; แชท/ข้อมูลลูกค้าบนมือถือสลับกลับได้; reduced-motion media query และ focus-visible มีให้ใช้งาน

ผลเครื่องตรวจ: `.tmp/chat-ux-review/verification.json`

## แอปหลัก: local:check ไม่ผ่านครบ

`npm run local:check` ผ่าน Local tooling, Prisma ทั้งสองชุด, TypeScript API/Web, lint, Web/Shared/Storefront tests และ builds. Browser checks ผ่าน Inbox light/dark 320–1920px, Inbox 1440, customers/FINANCE portfolio 1440 และ SHOP/FINANCE navigation 1440

หยุดใน `tools/check-local-trade-in.mjs` ที่คลิก menuitem “ดูรายละเอียด” (30s timeout; element unstable แล้ว detached). จึงไม่อ้างว่าการตรวจแอปหลักทั้งหมดผ่าน. ไม่มีการแก้ flow รับซื้อในงานต้นแบบนี้

ผลเต็มอยู่ `.tmp/local-preview/check.json` และ `.tmp/local-preview/checks.log`; managed app preview อยู่ http://localhost:5207/inbox ซึ่งแยกจากต้นแบบใหม่

## Screenshots

- [Inbox desktop](../prototypes/chat-operations/screens/inbox-desktop.png)
- [Inbox mobile](../prototypes/chat-operations/screens/inbox-mobile.png)
- [ข้อมูลลูกค้าบนมือถือ](../prototypes/chat-operations/screens/context-mobile.png)
- [คอมเมนต์](../prototypes/chat-operations/screens/comments-desktop.png)
- [รายงาน](../prototypes/chat-operations/screens/report-desktop.png)

## ยังไม่ได้พิสูจน์จากต้นแบบ

สิทธิ์จริง, concurrency, server persistence, Meta live integration, workflow เครดิต/บัญชี, dark theme ของดีไซน์ใหม่ และ large dataset. งานเหล่านี้อยู่ในแผน implementation หกชุดและยังต้องตรวจตอนเชื่อมเข้าระบบจริง

## Superseded by V2 review

The user identified missing work in V1 and requested a comprehensive redesign using `ui-ux-pro-max`. See the [V2 parity audit and verification](2026-10-06-chat-ux-v2-parity.md). The current root preview serves V2; `/v1/` preserves the earlier prototype. A fresh `npm run local:check` passed, including the trade-in browser check that timed out during this V1 review.
