# Inbox Image Lightbox — popup ดูรูปแบบ CHATCONE

**Date:** 2026-07-16 · **Status:** approved (owner, in-chat) · **Scope:** apps/web only

## Goal

กดรูปภาพในห้องแชท staff inbox แล้วเปิด popup viewer ในแอป (overlay มืด + ซูม −/+)
แทนพฤติกรรมเดิมที่ `window.open` เด้งแท็บใหม่ — อ้างอิง UX จาก CHATCONE

## Decisions (owner-approved)

- ขอบเขต = "แบบ CHATCONE": ซูม −/+, ปิดด้วย X / ESC / คลิกพื้นหลัง
- ไม่มีปุ่มดาวน์โหลด / เปิดแท็บใหม่ / ลูกศร prev-next (YAGNI — เพิ่มทีหลังได้)
- เฉพาะรูปภาพที่ render ผ่าน `ChatImage` (FILE tile และ GIF token ไม่เกี่ยว)
- ที่อื่นที่มี lightbox เดิม (EvidenceThumbnailGrid ฯลฯ) ยังไม่ migrate ในงานนี้

## Design

### `apps/web/src/components/ImageLightbox.tsx` (component กลาง ใช้ซ้ำได้)

- Props: `{ src: string | null; alt?: string; onClose: () => void }` — เปิดเมื่อ `src !== null`
- สร้างบน shadcn `Dialog` (Radix) — ได้ ESC + outside-click + focus-trap ฟรี
- `DialogContent` ต้อง override หนัก: `max-w-[95vw] p-0 bg-transparent border-0 shadow-none`
  + ซ่อนปุ่ม X ในตัวของ shadcn แล้ววางปุ่มเอง + `DialogTitle` แบบ `sr-only` (Radix a11y)
- **กลไกซูม = layout size ไม่ใช่ transform** (scrutinize finding #1 — transform:scale
  ไม่ขยาย scroll area ขอบรูปจะเลื่อนไปไม่ถึง): `<img style={{ height: `${scale × 80}vh`,
  width: 'auto', maxWidth: 'none' }}>` ใน container `overflow-auto` — ใช้ height เป็นแกน
  เพราะรูปแชทส่วนใหญ่เป็นแนวตั้ง (สลิป/เอกสาร) ได้สัดส่วนซูมสม่ำเสมอโดยไม่ต้องวัด
  naturalWidth; รูปแนวนอนกว้างเกินจอ = scroll แนวนอนได้ตามปกติ; จัดกลางด้วย
  `m-auto` ใน flex container (ไม่ใช้ justify-center — ชน overflow-clip ขอบซ้าย)
- ซูม: step 25%, clamp 50%–400%, double-click สลับ 100%↔200%, เปลี่ยน `src` รีเซ็ต 100%
- Controls อยู่ **ใน** DialogContent เสมอ (นอก content = โดน outside-click ปิด):
  แถบล่างกลาง `− / xx% / +` + ปุ่ม X มุมขวาบน, touch target ≥ 44px, aria-label ไทย
- ปุ่ม disabled ที่ขอบ clamp; แสดง % ปัจจุบันระหว่างปุ่ม

### จุดเปลี่ยนใน inbox

`ChatImage` ใน `apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.tsx`:
`onClick` เดิม `window.open(src, '_blank')` → `setLightboxSrc(src)` + render
`<ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />`
(state อยู่ใน ChatImage — สลับห้องแล้ว lightbox ปิดตาม unmount = พฤติกรรมเดียวกับ dialog อื่นในหน้า)

## Known trade-offs (ยอมรับแล้ว)

- เสีย "เปิดรูปในแท็บใหม่" (คลิกขวา → Save/Open image ของเบราว์เซอร์ยังใช้ได้)
- presigned URL หมดอายุ ~1 ชม. → รูปเก่าใน popup อาจ 403 — เท่าเดิมกับแท็บใหม่ ไม่ใช่ regression
- กด j/k ระหว่าง lightbox เปิดจะสลับห้อง + lightbox หาย — pattern เดียวกับ dialog อื่นทุกตัว

## Testing

- `ImageLightbox.test.tsx` (vitest + RTL): เปิดเมื่อมี src, ซูม +/− เปลี่ยน width%,
  clamp ขอบบนล่าง + ปุ่ม disabled, double-click toggle, reset เมื่อ src เปลี่ยน, ปิดด้วยปุ่ม X
- MessageBubble: กดรูปแล้ว lightbox เปิด (ไม่เรียก window.open)
- Browser e2e บน local ก่อนส่ง PR
