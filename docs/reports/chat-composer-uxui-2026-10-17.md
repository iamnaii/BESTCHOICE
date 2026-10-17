# แถบเครื่องมือแชท — ตรวจและปรับ UX/UI 17 ตุลาคม 2026

ขอบเขต: ปุ่มไฟล์, คลังไฟล์, สินค้า, เตรียมข้อเสนอ, อีโมจิ/สติกเกอร์/GIF, พูดเป็นข้อความ และคำอธิบายไมค์ รวม AI แนะนำบนมือถือ ใช้ UI UX Pro Max ประกอบเรื่องระยะห่างและพื้นที่กด คง Noto Sans Thai Looped และสีตาม design tokens เดิม

รายงานนี้เป็นหลักฐานรอบแรก ภายหลังผู้ใช้พบ label ของ “เตรียมข้อเสนอ” ยังเบียด input ซึ่งการตรวจ overflow รอบแรกไม่ครอบคลุม ดู [การแก้และวัดระยะเพิ่มเติม](offer-dialog-spacing-2026-10-17.md) พร้อม source fingerprint และ local check รอบใหม่

## สิ่งที่พบและแก้

- Toolbar ใช้ไอคอน 16/20 px ปะปน ระยะ padding ไม่เท่ากัน และคำอธิบายไมค์กินพื้นที่อีกแถว: ปรับเป็น 18 px desktop/20 px mobile, ปุ่มอย่างน้อย 44×44 px, gap 8 px และย้ายคำอธิบายเป็น popover เปิดเมื่อกด
- ปุ่มอีโมจิไม่มีข้อความบน desktop และพื้นที่กดตัวเลือกเล็ก: เพิ่มชื่อในปุ่มจริง ขยายตัวเลือกและหมวดเป็นอย่างน้อย 44 px พร้อมแสดงสถานะเลือก
- คลังไฟล์บนมือถือแสดงโฟลเดอร์/ฟอร์มสร้างโฟลเดอร์ก่อนรายการไฟล์จนไฟล์อยู่ใต้จอ: ยุบส่วนโฟลเดอร์ได้ แสดงรายการไฟล์ก่อน และคืน focus ไปปุ่มโฟลเดอร์เมื่อเลือกแล้วปิดส่วนนี้
- แบบฟอร์มข้อเสนอข้อความยาวและ label สองคอลัมน์ไม่ตรงแนว: ย่อคำอธิบายและ placeholder จัดหนึ่งคอลัมน์บนมือถือ
- หน้าต่างสินค้าไม่มีระยะห่างระหว่างส่วนที่เพียงพอ ปุ่มสั่งงานเล็กและรายการราคาบีบชื่อเครื่อง: เพิ่มระยะและจัดปุ่มเต็มแถวบนมือถือ พร้อมพื้นที่เลื่อนภายในหน้าต่าง
- ค้นสินค้า/โหลดสรุป/GIF ไม่สำเร็จแสดงคล้ายไม่มีข้อมูลหรือค้างโหลด: เพิ่ม error/retry และรักษาคำค้น; ยกเลิก GIF request เก่าเมื่อเปลี่ยนคำค้น/แท็บหรือออกจาก component

## วิธีตรวจ

กดผ่าน browser บน local preview ของ checkout `BESTCHOICE-layout-audit` เท่านั้น ทุกห้องและรายการเป็นข้อมูลสังเคราะห์ ไม่มีการส่งถึงลูกค้าจริง

- ไฟล์: เปิด file chooser, เลือกไฟล์, ตรวจรายการรอส่ง, นำออก
- คลังไฟล์: เปิด, ยุบ/ขยายโฟลเดอร์, เลือกโฟลเดอร์และตรวจ focus, ค้นหา/กรอง, empty state, ปิด; ชุด local check เพิ่มการสร้างโฟลเดอร์ อัปโหลด เลือกหลายไฟล์ ส่งจำลองและ retry
- สินค้า: ค้น/เลือก, ตรวจสรุป, แทรกข้อความ, ส่งรูปและการ์ดผ่าน stub; unit tests แยก search/summary failure และ retry
- ข้อเสนอ: สรุปและค้นข้อเสนอ, ดูผล, แทรกร่างโดยไม่ส่งข้อความเอง
- อีโมจิ: กดทุกหมวดและแทรกอีโมจิ; GIF: failure → retry → ส่งจำลอง; LINE: กดทุกแพ็กและส่งสติกเกอร์จำลอง
- เสียง: เริ่ม, รับข้อความจำลอง, หยุด, ตรวจว่าไม่ส่งเอง, เปิดคำอธิบาย; local check เพิ่ม permission denial/unsupported browser/room isolation
- กด Escape ปิดหน้าต่าง ตรวจขอบเขต dialog, page overflow, ขนาดปุ่มและไอคอน พร้อม screenshot แต่ละสถานะ

Product search/summary, GIPHY และ outbound ในชุดตรวจเฉพาะนี้ใช้ fixtures; speech recognition จำลอง ไม่ใช่การรับรองไมค์จริง/LINE/GIF provider หรือการส่งจริง การเตรียมข้อเสนอและคลังไฟล์ใช้ backend ของ isolated preview โดย AI และ delivery จำลอง

## หลักฐาน

- ก่อนแก้: `.tmp/composer-audit/before-*.png` (desktop และ mobile ที่บันทึกได้)
- หลังแก้/ผลกดปุ่ม: `.tmp/composer-audit/verified/`
- สคริปต์รันซ้ำ: `.tmp/composer-audit/verify.mjs`
- Unit tests เฉพาะ 4 components: 22/22 ผ่าน (`/tmp/composer-unit-final.log`)
- Reviewer รอบสุดท้าย: 0 Critical, 0 Warning, 0 Info ค้าง
- Browser เฉพาะแถบเครื่องมือ: 9 รูปแบบ / 114 สถานะผ่าน ไม่มี JavaScript page errors หรือ page/dialog overflow และปุ่ม toolbar ทุกปุ่มอย่างน้อย 44×44 px; [ผลแบบย่อ](chat-composer-uxui-2026-10-17-results.json)
- ขนาดที่ตรวจ: 1440×960 light/dark, 1024×960 light, 390×844 light/dark, 320×800 light/dark, 812×375 landscape light และ 390×844 ที่ root font 20 px; ใช้ reduced motion ทุกกรณี
- ตรวจไฟล์ภาพสติกเกอร์จาก LINE CDN แยกหลังโหลดเสร็จ: 3 แพ็ก, 34/34 ภาพสำเร็จ (`.tmp/composer-audit/sticker-assets.json`); การกดส่งยังใช้ stub ไม่มีการส่ง LINE จริง
- ภาพตัวอย่าง: [desktop](../../.tmp/composer-audit/verified/1440-960-light-16-toolbar.png), [mobile](../../.tmp/composer-audit/verified/390-844-light-16-toolbar.png), [สินค้า](../../.tmp/composer-audit/verified/390-844-light-16-product-draft.png), [คลังไฟล์](../../.tmp/composer-audit/after-390-library.png)
- Local check: 39/39 ผ่าน รวม type/lint/build และ browser regression; unit tests รวม 3,559 กรณีผ่าน (web 3,362, shared 149, storefront 48). ยังมี lint/build warnings เดิม ไม่มี errors
- Source fingerprint: `e3926444d0ef82d0faa5de55ef9f4b6ac4554ff72d7801992ad541f2508347e5`; ยืนยันว่าตรงกับ source และ preview ที่ยังทำงานอยู่
- หลักฐาน local check: `/tmp/composer-local-check.log`, `.tmp/local-preview/check.json`

ยังไม่ commit/push/merge/deploy รอบนี้

เปิดตัวอย่างหลังแก้: [แชทตัวอย่าง](http://localhost:5206/inbox/77f9f95b-3fb5-44b1-bad2-b5bf1513593b?zone=shop) · [ภาพแถบ desktop](../../.tmp/composer-audit/toolbar-desktop-final.png) · [ภาพแถบ mobile](../../.tmp/composer-audit/toolbar-mobile-final.png)
