# รายงานตรวจสเกลและสัดส่วนตัวอักษร ก่อน/หลังเปลี่ยนเป็น Noto Sans Thai (2026-11)

สร้างเมื่อ 2026-11-08 ด้วย `node tools/typography-audit/report.mjs` · ข้อมูลทั้งหมดเป็นข้อมูลจำลองของชุดทดสอบ (ไม่มีข้อมูลลูกค้าจริง) · ภาพหน้าจอและ contact sheet อยู่ใน `.tmp/typo-audit/` (ไม่ commit) — ชื่อภาพในตารางนับจากโฟลเดอร์นั้น

**อ่านอย่างไร** — "ก่อน" = commit `70eb82556` (ฟอนต์เดิม Noto Sans Thai Looped) · "หลัง" = commit `f2f9977b8` (Noto Sans Thai แบบไม่มีหัว — commit ที่รันเครื่องมือตรวจ แยกตามโฟลเดอร์ในตาราง "จำนวนที่วัด") · วัดด้วยเบราว์เซอร์จริงทุกหน้า × ความกว้าง 1440/390/320 × ธีมสว่าง/มืด (หน้าร้านมีแต่ธีมสว่าง) แล้วจับคู่หน้าเดียวกันก่อน/หลังมาเทียบ
ระดับ: **P1 ต้องแก้** · **P2 ควรแก้** · **P3 ขัดเกลา** · "ครั้ง" = จำนวนที่พบจริงทุกหน้า · "จุด" = นับปัญหาเดียวกัน (กฎ+ชนิด+ข้อความ+ความกว้าง+ธีม+role เดียวกัน) ที่ซ้ำตั้งแต่ 5 หน้าขึ้นไปเป็น 1 จุด — คือส่วนที่ใช้ร่วมทุกหน้า เช่น เมนูซ้าย หัวหน้า เมนูล่าง หรือคอมโพเนนต์ร่วม · role: owner = เจ้าของ · salesA = พนักงานขาย · LIFF = ลูกค้าใน LINE (session ลูกค้าจำลอง) · guest = ผู้เยี่ยมชมหน้าร้าน · customer = ลูกค้าที่ล็อกอินหน้าร้าน

## สรุปสั้น

- **เกิดจากฟอนต์ใหม่** 18 จุด (18 ครั้ง): P1 0 จุด (0 ครั้ง) · P2 0 จุด (0 ครั้ง) · P3 18 จุด (18 ครั้ง) — ในจำนวนนี้ "มีอยู่แล้วแต่ระดับสูงขึ้น" 0 จุด (0 ครั้ง) · อยู่บนหน้าที่ข้อมูลเปลี่ยนทุกรอบ 18 ครั้ง (※ น่าจะเป็นสัญญาณรบกวน)
- **ควรดูด้วยตา** (ไม่ใช่ระดับปัญหา): ความกว้างเปลี่ยนเกิน 8% (D1) 79 จุด (79 ครั้ง) · ตัวอักษรเยื้องในปุ่ม (D2) 1,859 จุด (3,449 ครั้ง)
- **มีอยู่ก่อนแล้ว** (ไม่เกี่ยวกับฟอนต์ใหม่) 3,054 จุด (9,042 ครั้ง) — เกณฑ์ R3 ระยะบรรทัดและ R7 ความสูงปุ่ม/ช่องกรอกตามแบบที่บ้านกำหนดแล้ว (เจ้าของตัดสิน 2026-11-08: ตัวเล็กกว่า 20px ×1.35 ขึ้นไป · ปุ่มจอกว้าง 32px ขึ้นไป) ตัวเลข R3/R7 ทุกตัวจึงเป็นปัญหาจริง · **หายไปหลังเปลี่ยน** 215 จุด (473 ครั้ง)
- **ฟอนต์ผิดในรอบหลัง** 0 จุด (0 ครั้ง) — ดูหัวข้อ "AFTER เท่านั้น"
- จับคู่เทียบได้ 2,043 ชุด (หน้า × ความกว้าง × ธีม × role) · เทียบไม่ได้ 1,335 ชุด — ดูหัวข้อ "ตรวจไม่ได้/ไม่วัด"

## จำนวนที่วัด (หน้า × ความกว้าง × ธีม × role)

| โฟลเดอร์ | มีไหม | ไฟล์ JSON | ใช้ | ซ้ำ (LIFF) | ข้าม | ผลรัน | commit |
|---|---|---|---|---|---|---|---|
| `.tmp/typo-audit/admin-before-owner` (admin-before-owner) | มี | 1,674 | 1,674 | 0 | 0 | PASS | `70eb82556` |
| `.tmp/typo-audit/admin-after-owner` (admin-after-owner) | มี | 1,674 | 1,674 | 0 | 0 | PASS | `f2f9977b8` |
| `.tmp/typo-audit/admin-before-salesA` (admin-before-sales) | มี | 1,674 | 1,596 | 78 | 0 | PASS | `70eb82556` |
| `.tmp/typo-audit/admin-after-salesA` (admin-after-sales) | มี | 1,674 | 1,596 | 78 | 0 | PASS | `f2f9977b8` |
| `.tmp/typo-audit/shop-before` (shop-before) | มี | 108 | 108 | 0 | 1 | — | `70eb82556` (ระบุตอนรัน) |
| `.tmp/typo-audit/shop-after` (shop-after) | มี | 108 | 108 | 0 | 1 | — | `f2f9977b8` (ระบุตอนรัน) |

"ใช้" = แถวที่เข้ารายงาน · "ซ้ำ (LIFF)" = หน้า LIFF ที่วัดซ้ำในรอบ role ที่สอง (session ลูกค้าจำลองเดียวกัน) นับครั้งเดียว · "ข้าม" = ไฟล์ที่ไม่ใช่ผลของหน้า (เช่น `unmatched.json`) · commit มาจาก `run.json` ของรอบนั้น; หน้าร้านไม่มี `run.json` จึง "ระบุตอนรัน" (`--revision`)

### หน้าร้าน

| รอบ | role | วัดได้ | ถูกพาไปหน้าอื่น | หน้าว่าง | ผิดพลาด | ถูกกัน | หน้าเอกสาร | ไม่ทราบสถานะ | รวม |
|---|---|---|---|---|---|---|---|---|---|
| ก่อน | customer | 6 | 3 | 0 | 0 | 0 | 0 | 0 | 9 |
| ก่อน | guest | 57 | 42 | 0 | 0 | 0 | 0 | 0 | 99 |
| หลัง | customer | 6 | 3 | 0 | 0 | 0 | 0 | 0 | 9 |
| หลัง | guest | 57 | 42 | 0 | 0 | 0 | 0 | 0 | 99 |

### หลังบ้าน

| รอบ | role | วัดได้ | ถูกพาไปหน้าอื่น | หน้าว่าง | ผิดพลาด | ถูกกัน | หน้าเอกสาร | ไม่ทราบสถานะ | รวม |
|---|---|---|---|---|---|---|---|---|---|
| ก่อน | LIFF | 60 | 18 | 0 | 0 | 0 | 0 | 0 | 78 |
| ก่อน | owner | 1,254 | 300 | 0 | 0 | 0 | 42 | 0 | 1,596 |
| ก่อน | salesA | 666 | 888 | 0 | 0 | 0 | 42 | 0 | 1,596 |
| หลัง | LIFF | 60 | 18 | 0 | 0 | 0 | 0 | 0 | 78 |
| หลัง | owner | 1,254 | 300 | 0 | 0 | 0 | 42 | 0 | 1,596 |
| หลัง | salesA | 666 | 888 | 0 | 0 | 0 | 42 | 0 | 1,596 |

นับเป็น "วัดได้" เฉพาะสถานะ `rendered` เท่านั้น — สถานะอื่นไม่นับว่าผ่าน · ก่อน 2,043 · หลัง 2,043 ชุด

## ตรวจไม่ได้/ไม่วัด

- **role ที่ไม่ได้วัด:** FINANCE_MANAGER, ACCOUNTANT, BRANCH_MANAGER — วัดเฉพาะ owner และ salesA (เมนู/การ์ดต่างกันตาม role)
- **หน้าเอกสาร (ไม่วัดตามข้อกำหนด — ใบเสร็จ/ป้ายพัสดุ/สติกเกอร์/หน้าตรวจเอกสาร):** 7 เส้นทาง `/cn/:token`, `/r/:token`, `/receipts/verify/:receiptNumber`, `/sales/:id/parcel-label`, `/stickers`, `/verify/:identifier`, `/verify/contracts/:id`
- **ถูกกัน (blocked):** ไม่มี
- **ผิดพลาด/หน้าว่าง:** ไม่มี
- **โฟลเดอร์ผลที่ไม่มี:** ไม่มี — ครบทั้ง 6 โฟลเดอร์

### เทียบก่อน/หลังไม่ได้ (ฝั่งใดฝั่งหนึ่งไม่ใช่ "วัดได้")

| แอป | role | ก่อน → หลัง | ชุด | ตัวอย่างหน้า |
|---|---|---|---|---|
| หลังบ้าน | salesA | ถูกพาไปหน้าอื่น → ถูกพาไปหน้าอื่น | 888 | `*`, `/accounting/intercompany`, `/accounting/periods`, `/assets`, `/attendance`, `/chat` และอีก 140 หน้า |
| หลังบ้าน | owner | ถูกพาไปหน้าอื่น → ถูกพาไปหน้าอื่น | 300 | `*`, `/accounting/periods`, `/chat`, `/contract`, `/customer-intake`, `/defect-exchange` และอีก 44 หน้า |
| หน้าร้าน | guest | ถูกพาไปหน้าอื่น → ถูกพาไปหน้าอื่น | 42 | `/apply`, `/apply/:id`, `/apply/status`, `/apply/success/*`, `/buyback`, `/buyback/:id` และอีก 8 หน้า |
| หลังบ้าน | owner | หน้าเอกสาร → หน้าเอกสาร | 42 | `/cn/:token`, `/r/:token`, `/receipts/verify/:receiptNumber`, `/sales/:id/parcel-label`, `/stickers`, `/verify/:identifier` และอีก 1 หน้า |
| หลังบ้าน | salesA | หน้าเอกสาร → หน้าเอกสาร | 42 | `/cn/:token`, `/r/:token`, `/receipts/verify/:receiptNumber`, `/sales/:id/parcel-label`, `/stickers`, `/verify/:identifier` และอีก 1 หน้า |
| หลังบ้าน | LIFF | ถูกพาไปหน้าอื่น → ถูกพาไปหน้าอื่น | 18 | `/liff`, `/liff/*`, `/liff/register` |
| หน้าร้าน | customer | ถูกพาไปหน้าอื่น → ถูกพาไปหน้าอื่น | 3 | `/account/saving-plans` |

**สถานะเปลี่ยนระหว่างก่อน/หลัง (ต้องดู):** ไม่มี — ทุกชุดที่เทียบไม่ได้มีสถานะเดียวกันทั้งก่อนและหลัง (เช่น salesA ถูกพาออกจากหน้าที่เป็นของ owner — เป็นปกติ ไม่ใช่ข้อผิดพลาด)

### หมายเหตุขอบเขต

- salesA ถูกพาไปหน้าอื่นบนหน้าที่เป็นของ owner (เช่น ตั้งค่า บัญชี) — เป็นสิทธิ์ตามปกติ ไม่ใช่ข้อผิดพลาด
- หน้า `/kiosk` วัดได้เฉพาะหน้าลงทะเบียนเครื่อง (ไม่มีเครื่องที่จับคู่ไว้ในชุดทดสอบ)
- หน้า LIFF วัดด้วย session ลูกค้าจำลองเดียวกันทั้งสองรอบ role จึงรายงานครั้งเดียวใต้ role "LIFF"
- 8 เส้นทางอยู่ในรายการหน้าสองแถว เข้าจากคนละทาง จึงเป็นการวัดแยกกันสองครั้ง (จำนวนข้อความ/ปลายทางต่างกันได้) — นับทั้งสองแถวในตารางจำนวน แต่ปัญหา key เดียวกันนับครั้งเดียว และถ้าแถวหนึ่ง "มีอยู่ก่อน" อีกแถว "ใหม่/หายไป" นับเป็นมีอยู่ก่อน (ตัดออก ใหม่ 6 · หายไป 12 · มีอยู่ก่อนที่อีกแถวระดับสูงขึ้น 0): `/audit-logs (128, 265)`, `/branches (32, 217)`, `/contract-templates (82, 243)`, `/promotions (160, 242)`, `/settings/document-config (67, 233)`, `/settings/rich-menu (192, 246)`, `/system-status (142, 266)`, `/users (119, 219)`
- **ข้อจำกัดของเครื่องมือ:** ตัวอ่านรายการหน้า (`routes.mjs`) จะมองไม่เห็น `<Route>` ที่อยู่ใน `{expression}` (เงื่อนไข/วนลูป) หรือถ้ามีคำว่า `<Routes` ในคอมเมนต์ก่อนหน้า — รอบปรับให้ทนทานถูกพักไว้ตามคำสั่งเจ้าของ · รายการวันนี้ตรวจแยกแล้วว่าครบทุกหน้า

## เกิดจากฟอนต์ใหม่ (มีในรอบหลังแต่ไม่มีในรอบก่อน หรือระดับสูงขึ้น)

เรียงตามระดับ แล้วตามจำนวนหน้าที่ได้รับผล · แถวที่ระดับเขียนว่า "P2 → P1" คือมีอยู่แล้วแต่ฟอนต์ใหม่ทำให้หนักขึ้น

### ต้องแก้ (P1) — ใหม่ 0 จุด (0 ครั้ง)

_ไม่มี_

### ควรแก้ (P2) — ใหม่ 0 จุด (0 ครั้ง)

_ไม่มี_

### ขัดเกลา (P3) — ใหม่ 18 จุด (18 ครั้ง)

| # | กฎ | ระดับ | แอป | หน้า | กว้าง | ธีม | role | ข้อความ | ค่าที่วัด | ภาพ |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | R10 | P3 | หลังบ้าน | `/audit-logs` ※ | 1440 | light | owner | 16 | ไม่มี tabular-nums (td, 12px) | admin-after-owner/uxui-pages/route-265-1440-light.png |
| 2 | R10 | P3 | หลังบ้าน | `/audit-logs` ※ | 1440 | light | owner | 18 | ไม่มี tabular-nums (td, 12px) | admin-after-owner/uxui-pages/route-265-1440-light.png |
| 3 | R10 | P3 | หลังบ้าน | `/audit-logs` ※ | 1440 | light | owner | 22 | ไม่มี tabular-nums (td, 12px) | admin-after-owner/uxui-pages/route-265-1440-light.png |
| 4 | R10 | P3 | หลังบ้าน | `/audit-logs` ※ | 1440 | dark | owner | 16 | ไม่มี tabular-nums (td, 12px) | admin-after-owner/uxui-pages/route-265-1440-dark.png |
| 5 | R10 | P3 | หลังบ้าน | `/audit-logs` ※ | 1440 | dark | owner | 18 | ไม่มี tabular-nums (td, 12px) | admin-after-owner/uxui-pages/route-265-1440-dark.png |
| 6 | R10 | P3 | หลังบ้าน | `/audit-logs` ※ | 1440 | dark | owner | 22 | ไม่มี tabular-nums (td, 12px) | admin-after-owner/uxui-pages/route-265-1440-dark.png |
| 7 | R10 | P3 | หลังบ้าน | `/audit-logs` ※ | 390 | light | owner | 16 | ไม่มี tabular-nums (td, 12px) | admin-after-owner/uxui-pages/route-265-390-light.png |
| 8 | R10 | P3 | หลังบ้าน | `/audit-logs` ※ | 390 | light | owner | 18 | ไม่มี tabular-nums (td, 12px) | admin-after-owner/uxui-pages/route-265-390-light.png |
| 9 | R10 | P3 | หลังบ้าน | `/audit-logs` ※ | 390 | light | owner | 22 | ไม่มี tabular-nums (td, 12px) | admin-after-owner/uxui-pages/route-265-390-light.png |
| 10 | R10 | P3 | หลังบ้าน | `/audit-logs` ※ | 390 | dark | owner | 16 | ไม่มี tabular-nums (td, 12px) | admin-after-owner/uxui-pages/route-265-390-dark.png |
| 11 | R10 | P3 | หลังบ้าน | `/audit-logs` ※ | 390 | dark | owner | 18 | ไม่มี tabular-nums (td, 12px) | admin-after-owner/uxui-pages/route-265-390-dark.png |
| 12 | R10 | P3 | หลังบ้าน | `/audit-logs` ※ | 390 | dark | owner | 22 | ไม่มี tabular-nums (td, 12px) | admin-after-owner/uxui-pages/route-265-390-dark.png |
| 13 | R10 | P3 | หลังบ้าน | `/audit-logs` ※ | 320 | light | owner | 16 | ไม่มี tabular-nums (td, 12px) | admin-after-owner/uxui-pages/route-265-320-light.png |
| 14 | R10 | P3 | หลังบ้าน | `/audit-logs` ※ | 320 | light | owner | 18 | ไม่มี tabular-nums (td, 12px) | admin-after-owner/uxui-pages/route-265-320-light.png |
| 15 | R10 | P3 | หลังบ้าน | `/audit-logs` ※ | 320 | light | owner | 22 | ไม่มี tabular-nums (td, 12px) | admin-after-owner/uxui-pages/route-265-320-light.png |
| 16 | R10 | P3 | หลังบ้าน | `/audit-logs` ※ | 320 | dark | owner | 16 | ไม่มี tabular-nums (td, 12px) | admin-after-owner/uxui-pages/route-265-320-dark.png |
| 17 | R10 | P3 | หลังบ้าน | `/audit-logs` ※ | 320 | dark | owner | 18 | ไม่มี tabular-nums (td, 12px) | admin-after-owner/uxui-pages/route-265-320-dark.png |
| 18 | R10 | P3 | หลังบ้าน | `/audit-logs` ※ | 320 | dark | owner | 22 | ไม่มี tabular-nums (td, 12px) | admin-after-owner/uxui-pages/route-265-320-dark.png |

※ หน้าที่ข้อมูลเปลี่ยนทุกรอบ (`/liff/debug` พิมพ์หมายเลขพอร์ตของรอบทดสอบ · `/audit-logs` ตัวเลขในตารางคือจำนวนรายการ audit ของรอบนั้น · `/system-status` เวลาตอบสนองและหน่วยความจำของรอบนั้น) — ตัวเลขที่ต่างกันระหว่างรอบทำให้นับเป็นใหม่/หายไปได้ทั้งที่ไม่เกี่ยวกับฟอนต์ · หัวข้อนี้มี 18 ครั้งบนหน้าเหล่านี้

## ควรดูด้วยตา (D1/D2 — เทียบก่อน/หลังเท่านั้น ไม่ใช่ระดับปัญหา)

- **D1** ข้อความเดียวกันกว้างขึ้นหรือแคบลงเกิน 8% — ตัวอักษรใหม่กว้างไม่เท่าเดิม อาจทำให้ล้นหรือขึ้นบรรทัดใหม่ · กว้างขึ้น 67 ครั้ง · แคบลง 12 ครั้ง · ค่ากลาง +13.2%
- **D2** ในปุ่ม/ชิป/ช่องกรอกที่สูงเท่าเดิม ตัวอักษรเยื้องจากกึ่งกลางเกิน 1.5px และเยื้องมากกว่าเดิม · อยู่สูงกว่ากึ่งกลาง 3,449 ครั้ง · ต่ำกว่า 0 ครั้ง · ค่ากลางห่างจากกึ่งกลาง -2.3px (ขยับจากเดิม -1.5px; ค่าลบ = ขึ้นบน) — ถ้าเกือบทั้งหมดไปทางเดียวกัน แปลว่าเป็นผลรวมจากระยะบน/ล่างของฟอนต์ใหม่ แก้ได้ที่จุดเดียว ไม่ใช่ทีละปุ่ม
- ตัดออก 0 รายการจาก `/liff/debug` (หน้านี้พิมพ์หมายเลขพอร์ตของรอบทดสอบ ข้อความจึงต่างกันทุกครั้ง — สัญญาณรบกวนที่รู้อยู่แล้ว)

### D1 — 79 จุด (79 ครั้ง)

| # | กฎ | ระดับ | แอป | หน้า | กว้าง | ธีม | role | ข้อความ | ค่าที่วัด | ภาพ |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | D1 | — | หลังบ้าน | `/` | 1440 | light | owner | ใบ | ความกว้างหมึก 12 → 10.6px (-11.7%) | admin-after-owner/uxui-pages/route-31-1440-light.png |
| 2 | D1 | — | หลังบ้าน | `/` | 1440 | light | salesA | ใบ | ความกว้างหมึก 12 → 10.6px (-11.7%) | admin-after-salesA/uxui-pages/route-31-1440-light.png |
| 3 | D1 | — | หน้าร้าน | `/how-it-works` | 1440 | light | guest | ผ่อนได้ครับ ใช้บัตรประชาชนใบเดียว ไม่เช… | ความกว้างหมึก 473.6 → 542.5px (+14.6%) | shop-after/shop/route-how-it-works-1440.png |
| 4 | D1 | — | หน้าร้าน | `/installment-terms` | 1440 | light | guest | ก่อนตัดสินใจ คุณกดลองปรับจำนวนงวด (สูงส… | ความกว้างหมึก 982.9 → 1124.2px (+14.4%) | shop-after/shop/route-installment-terms-1440.png |
| 5 | D1 | — | หน้าร้าน | `/installment-terms` | 1440 | light | guest | การแจ้งล่วงหน้าไม่มีผลเสียใดๆ — ลูกค้าท… | ความกว้างหมึก 510.3 → 577.5px (+13.2%) | shop-after/shop/route-installment-terms-1440.png |
| 6 | D1 | — | หน้าร้าน | `/installment-terms` | 1440 | light | guest | คุณใช้เครื่องได้ปกติทุกอย่างตั้งแต่วันแ… | ความกว้างหมึก 539.5 → 600.9px (+11.4%) | shop-after/shop/route-installment-terms-1440.png |
| 7 | D1 | — | หน้าร้าน | `/installment-terms` | 1440 | light | guest | เครื่องจะถูกล็อคการใช้งานชั่วคราว เฉพาะ… | ความกว้างหมึก 825.8 → 949.4px (+15%) | shop-after/shop/route-installment-terms-1440.png |
| 8 | D1 | — | หน้าร้าน | `/installment-terms` | 1440 | light | guest | เครื่องผ่อนทุกเครื่องติดตั้งระบบดูแลเคร… | ความกว้างหมึก 1416.8 → 1617.4px (+14.2%) | shop-after/shop/route-installment-terms-1440.png |
| 9 | D1 | — | หน้าร้าน | `/installment-terms` | 1440 | light | guest | ชำระผ่าน LINE ได้ตลอด — สแกน QR พร้อมเพ… | ความกว้างหมึก 1018.3 → 1150.9px (+13%) | shop-after/shop/route-installment-terms-1440.png |
| 10 | D1 | — | หน้าร้าน | `/installment-terms` | 1440 | light | guest | ชำระล่าช้ามีค่าปรับตามที่ระบุในสัญญา แต… | ความกว้างหมึก 1184 → 1361.3px (+15%) | shop-after/shop/route-installment-terms-1440.png |
| 11 | D1 | — | หน้าร้าน | `/installment-terms` | 1440 | light | guest | ระหว่างผ่อน กรรมสิทธิ์เครื่องเป็นของ BE… | ความกว้างหมึก 876.3 → 996.5px (+13.7%) | shop-after/shop/route-installment-terms-1440.png |
| 12 | D1 | — | หน้าร้าน | `/installment-terms` | 1440 | light | guest | เราใช้ดอกเบี้ยแบบคงที่ (flat rate) — ค่… | ความกว้างหมึก 763.6 → 849.6px (+11.3%) | shop-after/shop/route-installment-terms-1440.png |
| 13 | D1 | — | หน้าร้าน | `/installment-terms` | 1440 | light | guest | อยากปิดยอดเร็ว? ทำได้ทุกเมื่อผ่าน LINE … | ความกว้างหมึก 1148.9 → 1306.6px (+13.7%) | shop-after/shop/route-installment-terms-1440.png |
| 14 | D1 | — | หน้าร้าน | `/iphone-มือสอง-ลพบุรี` | 1440 | light | guest | การรับประกันและคืนสินค้า | ความกว้างหมึก 146.7 → 162.1px (+10.5%) | shop-after/shop/route-iphone-93ff8928-1440.png |
| 15 | D1 | — | หน้าร้าน | `/iphone-มือสอง-ลพบุรี` | 1440 | light | guest | ทุกเครื่องแสดงรูปถ่ายเครื่องจริง ราคาเง… | ความกว้างหมึก 528.1 → 599.3px (+13.5%) | shop-after/shop/route-iphone-93ff8928-1440.png |
| 16 | D1 | — | หน้าร้าน | `/iphone-มือสอง-ลพบุรี` | 1440 | light | guest | สินค้าทั้งหมด | ความกว้างหมึก 74.9 → 82.7px (+10.4%) | shop-after/shop/route-iphone-93ff8928-1440.png |
| 17 | D1 | — | หน้าร้าน | `/returns` | 1440 | light | guest | คืนสินค้าภายใน 7 วัน หากเครื่องอยู่ในสภ… | ความกว้างหมึก 736.7 → 840.6px (+14.1%) | shop-after/shop/route-returns-1440.png |
| 18 | D1 | — | หน้าร้าน | `/returns` | 1440 | light | guest | ทุกเครื่องรับประกันจากร้าน 60 วัน ครอบค… | ความกว้างหมึก 760.6 → 871.2px (+14.5%) | shop-after/shop/route-returns-1440.png |
| 19 | D1 | — | หน้าร้าน | `/ผ่อนไอโฟนลพบุรี` | 1440 | light | guest | เงื่อนไขการผ่อน | ความกว้างหมึก 88.1 → 98.4px (+11.6%) | shop-after/shop/route-p-df68e697-1440.png |
| 20 | D1 | — | หน้าร้าน | `/ผ่อนไอโฟนลพบุรี` | 1440 | light | guest | วิธีผ่อน | ความกว้างหมึก 40.6 → 45.9px (+13.1%) | shop-after/shop/route-p-df68e697-1440.png |
| 21 | D1 | — | หน้าร้าน | `/ผ่อนไอโฟนลพบุรี` | 1440 | light | guest | อ่านขั้นตอนละเอียดได้ที่ และเงื่อนไขทั้… | ความกว้างหมึก 251.8 → 289.6px (+15%) | shop-after/shop/route-p-df68e697-1440.png |
| 22 | D1 | — | หลังบ้าน | `/` | 1440 | dark | owner | ใบ | ความกว้างหมึก 12 → 10.6px (-11.7%) | admin-after-owner/uxui-pages/route-31-1440-dark.png |
| 23 | D1 | — | หลังบ้าน | `/` | 1440 | dark | salesA | ใบ | ความกว้างหมึก 12 → 10.6px (-11.7%) | admin-after-salesA/uxui-pages/route-31-1440-dark.png |
| 24 | D1 | — | หลังบ้าน | `/` | 390 | light | owner | ใบ | ความกว้างหมึก 12 → 10.6px (-11.7%) | admin-after-owner/uxui-pages/route-31-390-light.png |
| 25 | D1 | — | หลังบ้าน | `/` | 390 | light | salesA | ใบ | ความกว้างหมึก 12 → 10.6px (-11.7%) | admin-after-salesA/uxui-pages/route-31-390-light.png |
| 26 | D1 | — | หน้าร้าน | `/about` | 390 | light | guest | BESTCHOICE Phone Shop เริ่มต้นที่ลพบุรี… | ความกว้างหมึก 973.9 → 1092.2px (+12.1%) | shop-after/shop/route-about-390.png |
| 27 | D1 | — | หน้าร้าน | `/about` | 390 | light | guest | วันนี้เราดูแลลูกค้ามาแล้วกว่า 1,000 ราย… | ความกว้างหมึก 883.8 → 999.5px (+13.1%) | shop-after/shop/route-about-390.png |
| 28 | D1 | — | หน้าร้าน | `/how-it-works` | 390 | light | guest | ผ่อนได้ครับ ใช้บัตรประชาชนใบเดียว ไม่เช… | ความกว้างหมึก 473.6 → 542.5px (+14.6%) | shop-after/shop/route-how-it-works-390.png |
| 29 | D1 | — | หน้าร้าน | `/installment-terms` | 390 | light | guest | ก่อนตัดสินใจ คุณกดลองปรับจำนวนงวด (สูงส… | ความกว้างหมึก 982.9 → 1124.2px (+14.4%) | shop-after/shop/route-installment-terms-390.png |
| 30 | D1 | — | หน้าร้าน | `/installment-terms` | 390 | light | guest | การแจ้งล่วงหน้าไม่มีผลเสียใดๆ — ลูกค้าท… | ความกว้างหมึก 510.3 → 577.5px (+13.2%) | shop-after/shop/route-installment-terms-390.png |
| 31 | D1 | — | หน้าร้าน | `/installment-terms` | 390 | light | guest | คุณใช้เครื่องได้ปกติทุกอย่างตั้งแต่วันแ… | ความกว้างหมึก 539.5 → 600.9px (+11.4%) | shop-after/shop/route-installment-terms-390.png |
| 32 | D1 | — | หน้าร้าน | `/installment-terms` | 390 | light | guest | เครื่องจะถูกล็อคการใช้งานชั่วคราว เฉพาะ… | ความกว้างหมึก 825.8 → 949.4px (+15%) | shop-after/shop/route-installment-terms-390.png |
| 33 | D1 | — | หน้าร้าน | `/installment-terms` | 390 | light | guest | เครื่องผ่อนทุกเครื่องติดตั้งระบบดูแลเคร… | ความกว้างหมึก 1416.8 → 1617.4px (+14.2%) | shop-after/shop/route-installment-terms-390.png |
| 34 | D1 | — | หน้าร้าน | `/installment-terms` | 390 | light | guest | ชำระผ่าน LINE ได้ตลอด — สแกน QR พร้อมเพ… | ความกว้างหมึก 1018.3 → 1150.9px (+13%) | shop-after/shop/route-installment-terms-390.png |
| 35 | D1 | — | หน้าร้าน | `/installment-terms` | 390 | light | guest | ชำระล่าช้ามีค่าปรับตามที่ระบุในสัญญา แต… | ความกว้างหมึก 1184 → 1361.3px (+15%) | shop-after/shop/route-installment-terms-390.png |
| 36 | D1 | — | หน้าร้าน | `/installment-terms` | 390 | light | guest | ระหว่างผ่อน กรรมสิทธิ์เครื่องเป็นของ BE… | ความกว้างหมึก 876.3 → 996.5px (+13.7%) | shop-after/shop/route-installment-terms-390.png |
| 37 | D1 | — | หน้าร้าน | `/installment-terms` | 390 | light | guest | เราใช้ดอกเบี้ยแบบคงที่ (flat rate) — ค่… | ความกว้างหมึก 763.6 → 849.6px (+11.3%) | shop-after/shop/route-installment-terms-390.png |
| 38 | D1 | — | หน้าร้าน | `/installment-terms` | 390 | light | guest | อยากปิดยอดเร็ว? ทำได้ทุกเมื่อผ่าน LINE … | ความกว้างหมึก 1148.9 → 1306.6px (+13.7%) | shop-after/shop/route-installment-terms-390.png |
| 39 | D1 | — | หน้าร้าน | `/iphone-มือสอง-ลพบุรี` | 390 | light | guest | การรับประกันและคืนสินค้า | ความกว้างหมึก 146.7 → 162.1px (+10.5%) | shop-after/shop/route-iphone-93ff8928-390.png |
| 40 | D1 | — | หน้าร้าน | `/iphone-มือสอง-ลพบุรี` | 390 | light | guest | ทุกเครื่องแสดงรูปถ่ายเครื่องจริง ราคาเง… | ความกว้างหมึก 528.1 → 599.3px (+13.5%) | shop-after/shop/route-iphone-93ff8928-390.png |
| 41 | D1 | — | หน้าร้าน | `/iphone-มือสอง-ลพบุรี` | 390 | light | guest | สินค้าทั้งหมด | ความกว้างหมึก 74.9 → 82.7px (+10.4%) | shop-after/shop/route-iphone-93ff8928-390.png |
| 42 | D1 | — | หน้าร้าน | `/products/:id` | 390 | light | guest | iPhone 15 มือสอง ตรวจเช็ก 30 จุดก่อนวาง… | ความกว้างหมึก 271.5 → 303px (+11.6%) | shop-after/shop/route-products_id-670fcab7-390.png |
| 43 | D1 | — | หน้าร้าน | `/returns` | 390 | light | guest | คืนสินค้าภายใน 7 วัน หากเครื่องอยู่ในสภ… | ความกว้างหมึก 736.7 → 840.6px (+14.1%) | shop-after/shop/route-returns-390.png |
| 44 | D1 | — | หน้าร้าน | `/returns` | 390 | light | guest | ทุกเครื่องรับประกันจากร้าน 60 วัน ครอบค… | ความกว้างหมึก 760.6 → 871.2px (+14.5%) | shop-after/shop/route-returns-390.png |
| 45 | D1 | — | หน้าร้าน | `/shipping` | 390 | light | guest | BESTCHOICE จัดส่งเครื่องทั่วประเทศไทยสำ… | ความกว้างหมึก 645.4 → 735.9px (+14%) | shop-after/shop/route-shipping-390.png |
| 46 | D1 | — | หน้าร้าน | `/shipping` | 390 | light | guest | สำหรับลูกค้าผ่อน ต้องมารับเครื่องที่สาข… | ความกว้างหมึก 482.3 → 555.4px (+15.2%) | shop-after/shop/route-shipping-390.png |
| 47 | D1 | — | หน้าร้าน | `/ผ่อนไอโฟนลพบุรี` | 390 | light | guest | เงื่อนไขการผ่อน | ความกว้างหมึก 88.1 → 98.4px (+11.6%) | shop-after/shop/route-p-df68e697-390.png |
| 48 | D1 | — | หน้าร้าน | `/ผ่อนไอโฟนลพบุรี` | 390 | light | guest | วิธีผ่อน | ความกว้างหมึก 40.6 → 45.9px (+13.1%) | shop-after/shop/route-p-df68e697-390.png |
| 49 | D1 | — | หน้าร้าน | `/ผ่อนไอโฟนลพบุรี` | 390 | light | guest | อ่านขั้นตอนละเอียดได้ที่ และเงื่อนไขทั้… | ความกว้างหมึก 251.8 → 289.6px (+15%) | shop-after/shop/route-p-df68e697-390.png |
| 50 | D1 | — | หลังบ้าน | `/` | 390 | dark | owner | ใบ | ความกว้างหมึก 12 → 10.6px (-11.7%) | admin-after-owner/uxui-pages/route-31-390-dark.png |
| 51 | D1 | — | หลังบ้าน | `/` | 390 | dark | salesA | ใบ | ความกว้างหมึก 12 → 10.6px (-11.7%) | admin-after-salesA/uxui-pages/route-31-390-dark.png |
| 52 | D1 | — | หลังบ้าน | `/` | 320 | light | owner | ใบ | ความกว้างหมึก 12 → 10.6px (-11.7%) | admin-after-owner/uxui-pages/route-31-320-light.png |
| 53 | D1 | — | หลังบ้าน | `/` | 320 | light | salesA | ใบ | ความกว้างหมึก 12 → 10.6px (-11.7%) | admin-after-salesA/uxui-pages/route-31-320-light.png |
| 54 | D1 | — | หน้าร้าน | `/about` | 320 | light | guest | BESTCHOICE Phone Shop เริ่มต้นที่ลพบุรี… | ความกว้างหมึก 973.9 → 1092.2px (+12.1%) | shop-after/shop/route-about-320.png |
| 55 | D1 | — | หน้าร้าน | `/about` | 320 | light | guest | วันนี้เราดูแลลูกค้ามาแล้วกว่า 1,000 ราย… | ความกว้างหมึก 883.8 → 999.5px (+13.1%) | shop-after/shop/route-about-320.png |
| 56 | D1 | — | หน้าร้าน | `/how-it-works` | 320 | light | guest | ผ่อนได้ครับ ใช้บัตรประชาชนใบเดียว ไม่เช… | ความกว้างหมึก 473.6 → 542.5px (+14.6%) | shop-after/shop/route-how-it-works-320.png |
| 57 | D1 | — | หน้าร้าน | `/installment-terms` | 320 | light | guest | ก่อนตัดสินใจ คุณกดลองปรับจำนวนงวด (สูงส… | ความกว้างหมึก 982.9 → 1124.2px (+14.4%) | shop-after/shop/route-installment-terms-320.png |
| 58 | D1 | — | หน้าร้าน | `/installment-terms` | 320 | light | guest | การแจ้งล่วงหน้าไม่มีผลเสียใดๆ — ลูกค้าท… | ความกว้างหมึก 510.3 → 577.5px (+13.2%) | shop-after/shop/route-installment-terms-320.png |
| 59 | D1 | — | หน้าร้าน | `/installment-terms` | 320 | light | guest | คุณใช้เครื่องได้ปกติทุกอย่างตั้งแต่วันแ… | ความกว้างหมึก 539.5 → 600.9px (+11.4%) | shop-after/shop/route-installment-terms-320.png |
| 60 | D1 | — | หน้าร้าน | `/installment-terms` | 320 | light | guest | เครื่องจะถูกล็อคการใช้งานชั่วคราว เฉพาะ… | ความกว้างหมึก 825.8 → 949.4px (+15%) | shop-after/shop/route-installment-terms-320.png |

… อีก 19 จุด — ดูทั้งหมดใน `findings.json`

### D2 — 1,859 จุด (3,449 ครั้ง)

| # | กฎ | ระดับ | แอป | หน้า | กว้าง | ธีม | role | ข้อความ | ค่าที่วัด | ภาพ |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | D2 | — | หลังบ้าน | ส่วนร่วม 122 หน้า เช่น `/`, `/accounting/intercompany`, `/after-sales` | 1440 | light | owner | ตั้งค่ากลาง | เยื้องจากกึ่งกลาง -0.8 → -1.8px | admin-after-owner/uxui-pages/route-31-1440-light.png |
| 2 | D2 | — | หลังบ้าน | ส่วนร่วม 122 หน้า เช่น `/`, `/accounting/intercompany`, `/after-sales` | 1440 | dark | owner | ตั้งค่ากลาง | เยื้องจากกึ่งกลาง -0.8 → -1.8px | admin-after-owner/uxui-pages/route-31-1440-dark.png |
| 3 | D2 | — | หลังบ้าน | ส่วนร่วม 40 หน้า เช่น `/collection-dashboard`, `/collections`, `/commissions` | 1440 | light | owner | จัดการจดหมาย | เยื้องจากกึ่งกลาง 0.5 → -2px | admin-after-owner/uxui-pages/route-104-1440-light.png |
| 4 | D2 | — | หลังบ้าน | ส่วนร่วม 40 หน้า เช่น `/collection-dashboard`, `/collections`, `/commissions` | 1440 | light | owner | รับเครื่องคืน / ยึดคืน | เยื้องจากกึ่งกลาง -1.3 → -3.8px | admin-after-owner/uxui-pages/route-104-1440-light.png |
| 5 | D2 | — | หลังบ้าน | ส่วนร่วม 40 หน้า เช่น `/collection-dashboard`, `/collections`, `/commissions` | 1440 | light | owner | รับชำระค่างวด | เยื้องจากกึ่งกลาง 0.3 → -2.5px | admin-after-owner/uxui-pages/route-104-1440-light.png |
| 6 | D2 | — | หลังบ้าน | ส่วนร่วม 40 หน้า เช่น `/collection-dashboard`, `/collections`, `/commissions` | 1440 | light | owner | รายได้อื่น | เยื้องจากกึ่งกลาง -1.3 → -3.8px | admin-after-owner/uxui-pages/route-104-1440-light.png |
| 7 | D2 | — | หลังบ้าน | ส่วนร่วม 40 หน้า เช่น `/collection-dashboard`, `/collections`, `/commissions` | 1440 | light | owner | ล็อคเครื่อง (MDM) | เยื้องจากกึ่งกลาง -0.2 → -2.7px | admin-after-owner/uxui-pages/route-104-1440-light.png |
| 8 | D2 | — | หลังบ้าน | ส่วนร่วม 40 หน้า เช่น `/collection-dashboard`, `/collections`, `/commissions` | 1440 | dark | owner | จัดการจดหมาย | เยื้องจากกึ่งกลาง 0.5 → -2px | admin-after-owner/uxui-pages/route-104-1440-dark.png |
| 9 | D2 | — | หลังบ้าน | ส่วนร่วม 40 หน้า เช่น `/collection-dashboard`, `/collections`, `/commissions` | 1440 | dark | owner | รับเครื่องคืน / ยึดคืน | เยื้องจากกึ่งกลาง -1.3 → -3.8px | admin-after-owner/uxui-pages/route-104-1440-dark.png |
| 10 | D2 | — | หลังบ้าน | ส่วนร่วม 40 หน้า เช่น `/collection-dashboard`, `/collections`, `/commissions` | 1440 | dark | owner | รับชำระค่างวด | เยื้องจากกึ่งกลาง 0.3 → -2.5px | admin-after-owner/uxui-pages/route-104-1440-dark.png |
| 11 | D2 | — | หลังบ้าน | ส่วนร่วม 40 หน้า เช่น `/collection-dashboard`, `/collections`, `/commissions` | 1440 | dark | owner | รายได้อื่น | เยื้องจากกึ่งกลาง -1.3 → -3.8px | admin-after-owner/uxui-pages/route-104-1440-dark.png |
| 12 | D2 | — | หลังบ้าน | ส่วนร่วม 40 หน้า เช่น `/collection-dashboard`, `/collections`, `/commissions` | 1440 | dark | owner | ล็อคเครื่อง (MDM) | เยื้องจากกึ่งกลาง -0.2 → -2.7px | admin-after-owner/uxui-pages/route-104-1440-dark.png |
| 13 | D2 | — | หลังบ้าน | ส่วนร่วม 23 หน้า เช่น `/settings/:categoryId`, `/settings/access`, `/settings/access#accounting-permissions` | 1440 | light | owner | ค้นหาการตั้งค่า… | เยื้องจากกึ่งกลาง -1 → -2.1px | admin-after-owner/uxui-pages/route-123-1440-light.png |
| 14 | D2 | — | หลังบ้าน | ส่วนร่วม 23 หน้า เช่น `/settings/:categoryId`, `/settings/access`, `/settings/access#accounting-permissions` | 1440 | dark | owner | ค้นหาการตั้งค่า… | เยื้องจากกึ่งกลาง -1 → -2.1px | admin-after-owner/uxui-pages/route-123-1440-dark.png |
| 15 | D2 | — | หลังบ้าน | ส่วนร่วม 23 หน้า เช่น `/settings/:categoryId`, `/settings/access`, `/settings/access#accounting-permissions` | 390 | light | owner | ค้นหาการตั้งค่า… | เยื้องจากกึ่งกลาง -1.6 → -2.5px | admin-after-owner/uxui-pages/route-123-390-light.png |
| 16 | D2 | — | หลังบ้าน | ส่วนร่วม 23 หน้า เช่น `/settings/:categoryId`, `/settings/access`, `/settings/access#accounting-permissions` | 390 | light | owner | เลือกหมวดตั้งค่า | เยื้องจากกึ่งกลาง -1.6 → -2.5px | admin-after-owner/uxui-pages/route-123-390-light.png |
| 17 | D2 | — | หลังบ้าน | ส่วนร่วม 23 หน้า เช่น `/settings/:categoryId`, `/settings/access`, `/settings/access#accounting-permissions` | 390 | dark | owner | ค้นหาการตั้งค่า… | เยื้องจากกึ่งกลาง -1.6 → -2.5px | admin-after-owner/uxui-pages/route-123-390-dark.png |
| 18 | D2 | — | หลังบ้าน | ส่วนร่วม 23 หน้า เช่น `/settings/:categoryId`, `/settings/access`, `/settings/access#accounting-permissions` | 390 | dark | owner | เลือกหมวดตั้งค่า | เยื้องจากกึ่งกลาง -1.6 → -2.5px | admin-after-owner/uxui-pages/route-123-390-dark.png |
| 19 | D2 | — | หลังบ้าน | ส่วนร่วม 23 หน้า เช่น `/settings/:categoryId`, `/settings/access`, `/settings/access#accounting-permissions` | 320 | light | owner | ค้นหาการตั้งค่า… | เยื้องจากกึ่งกลาง -1.6 → -2.5px | admin-after-owner/uxui-pages/route-123-320-light.png |
| 20 | D2 | — | หลังบ้าน | ส่วนร่วม 23 หน้า เช่น `/settings/:categoryId`, `/settings/access`, `/settings/access#accounting-permissions` | 320 | light | owner | เลือกหมวดตั้งค่า | เยื้องจากกึ่งกลาง -1.6 → -2.5px | admin-after-owner/uxui-pages/route-123-320-light.png |
| 21 | D2 | — | หลังบ้าน | ส่วนร่วม 23 หน้า เช่น `/settings/:categoryId`, `/settings/access`, `/settings/access#accounting-permissions` | 320 | dark | owner | ค้นหาการตั้งค่า… | เยื้องจากกึ่งกลาง -1.6 → -2.5px | admin-after-owner/uxui-pages/route-123-320-dark.png |
| 22 | D2 | — | หลังบ้าน | ส่วนร่วม 23 หน้า เช่น `/settings/:categoryId`, `/settings/access`, `/settings/access#accounting-permissions` | 320 | dark | owner | เลือกหมวดตั้งค่า | เยื้องจากกึ่งกลาง -1.6 → -2.5px | admin-after-owner/uxui-pages/route-123-320-dark.png |
| 23 | D2 | — | หลังบ้าน | ส่วนร่วม 17 หน้า เช่น `/audit-logs`, `/collections`, `/contacts` (21 ครั้ง) | 1440 | light | owner | ทั้งหมด | เยื้องจากกึ่งกลาง -1.2 → -2.2px | admin-after-owner/uxui-pages/route-128-1440-light.png |
| 24 | D2 | — | หลังบ้าน | ส่วนร่วม 17 หน้า เช่น `/audit-logs`, `/collections`, `/contacts` (21 ครั้ง) | 1440 | dark | owner | ทั้งหมด | เยื้องจากกึ่งกลาง -1.2 → -2.2px | admin-after-owner/uxui-pages/route-128-1440-dark.png |
| 25 | D2 | — | หลังบ้าน | ส่วนร่วม 16 หน้า เช่น `/audit-logs`, `/collections`, `/contacts` (20 ครั้ง) | 390 | light | owner | ทั้งหมด | เยื้องจากกึ่งกลาง -1.2 → -2.2px | admin-after-owner/uxui-pages/route-128-390-light.png |
| 26 | D2 | — | หลังบ้าน | ส่วนร่วม 16 หน้า เช่น `/audit-logs`, `/collections`, `/contacts` (20 ครั้ง) | 390 | dark | owner | ทั้งหมด | เยื้องจากกึ่งกลาง -1.2 → -2.2px | admin-after-owner/uxui-pages/route-128-390-dark.png |
| 27 | D2 | — | หลังบ้าน | ส่วนร่วม 16 หน้า เช่น `/audit-logs`, `/collections`, `/contacts` (20 ครั้ง) | 320 | light | owner | ทั้งหมด | เยื้องจากกึ่งกลาง -1.2 → -2.2px | admin-after-owner/uxui-pages/route-128-320-light.png |
| 28 | D2 | — | หลังบ้าน | ส่วนร่วม 16 หน้า เช่น `/audit-logs`, `/collections`, `/contacts` (20 ครั้ง) | 320 | dark | owner | ทั้งหมด | เยื้องจากกึ่งกลาง -1.2 → -2.2px | admin-after-owner/uxui-pages/route-128-320-dark.png |
| 29 | D2 | — | หลังบ้าน | ส่วนร่วม 14 หน้า เช่น `/assets`, `/assets/:id`, `/assets/:id/audit` | 1440 | light | owner | สินทรัพย์ถาวร | เยื้องจากกึ่งกลาง 0.1 → -2.1px | admin-after-owner/uxui-pages/route-161-1440-light.png |
| 30 | D2 | — | หลังบ้าน | ส่วนร่วม 14 หน้า เช่น `/assets`, `/assets/:id`, `/assets/:id/audit` | 1440 | dark | owner | สินทรัพย์ถาวร | เยื้องจากกึ่งกลาง 0.1 → -2.1px | admin-after-owner/uxui-pages/route-161-1440-dark.png |
| 31 | D2 | — | หลังบ้าน | ส่วนร่วม 13 หน้า เช่น `/appointments`, `/attendance`, `/attendance/me` | 1440 | light | owner | การจอง / มัดจำ | เยื้องจากกึ่งกลาง 0.5 → -2.1px | admin-after-owner/uxui-pages/route-105-1440-light.png |
| 32 | D2 | — | หลังบ้าน | ส่วนร่วม 13 หน้า เช่น `/appointments`, `/attendance`, `/attendance/me` | 1440 | light | owner | ขายสินค้า | เยื้องจากกึ่งกลาง 0.1 → -2.5px | admin-after-owner/uxui-pages/route-105-1440-light.png |
| 33 | D2 | — | หลังบ้าน | ส่วนร่วม 13 หน้า เช่น `/appointments`, `/attendance`, `/attendance/me` | 1440 | light | owner | ตรวจเครดิต | เยื้องจากกึ่งกลาง 0.6 → -1.5px | admin-after-owner/uxui-pages/route-105-1440-light.png |
| 34 | D2 | — | หลังบ้าน | ส่วนร่วม 13 หน้า เช่น `/appointments`, `/attendance`, `/attendance/me` | 1440 | light | owner | นัดเข้าร้าน | เยื้องจากกึ่งกลาง 0.1 → -2.5px | admin-after-owner/uxui-pages/route-105-1440-light.png |
| 35 | D2 | — | หลังบ้าน | ส่วนร่วม 13 หน้า เช่น `/appointments`, `/attendance`, `/attendance/me` | 1440 | light | owner | เวลาทำงานของฉัน | เยื้องจากกึ่งกลาง 0.5 → -2.1px | admin-after-owner/uxui-pages/route-105-1440-light.png |
| 36 | D2 | — | หลังบ้าน | ส่วนร่วม 13 หน้า เช่น `/appointments`, `/attendance`, `/attendance/me` | 1440 | light | owner | หลังการขาย | เยื้องจากกึ่งกลาง 0.5 → -2px | admin-after-owner/uxui-pages/route-105-1440-light.png |
| 37 | D2 | — | หลังบ้าน | ส่วนร่วม 13 หน้า เช่น `/appointments`, `/attendance`, `/attendance/me` | 1440 | dark | owner | การจอง / มัดจำ | เยื้องจากกึ่งกลาง 0.5 → -2.1px | admin-after-owner/uxui-pages/route-105-1440-dark.png |
| 38 | D2 | — | หลังบ้าน | ส่วนร่วม 13 หน้า เช่น `/appointments`, `/attendance`, `/attendance/me` | 1440 | dark | owner | ขายสินค้า | เยื้องจากกึ่งกลาง 0.1 → -2.5px | admin-after-owner/uxui-pages/route-105-1440-dark.png |
| 39 | D2 | — | หลังบ้าน | ส่วนร่วม 13 หน้า เช่น `/appointments`, `/attendance`, `/attendance/me` | 1440 | dark | owner | ตรวจเครดิต | เยื้องจากกึ่งกลาง 0.6 → -1.5px | admin-after-owner/uxui-pages/route-105-1440-dark.png |
| 40 | D2 | — | หลังบ้าน | ส่วนร่วม 13 หน้า เช่น `/appointments`, `/attendance`, `/attendance/me` | 1440 | dark | owner | นัดเข้าร้าน | เยื้องจากกึ่งกลาง 0.1 → -2.5px | admin-after-owner/uxui-pages/route-105-1440-dark.png |
| 41 | D2 | — | หลังบ้าน | ส่วนร่วม 13 หน้า เช่น `/appointments`, `/attendance`, `/attendance/me` | 1440 | dark | owner | เวลาทำงานของฉัน | เยื้องจากกึ่งกลาง 0.5 → -2.1px | admin-after-owner/uxui-pages/route-105-1440-dark.png |
| 42 | D2 | — | หลังบ้าน | ส่วนร่วม 13 หน้า เช่น `/appointments`, `/attendance`, `/attendance/me` | 1440 | dark | owner | หลังการขาย | เยื้องจากกึ่งกลาง 0.5 → -2px | admin-after-owner/uxui-pages/route-105-1440-dark.png |
| 43 | D2 | — | หลังบ้าน | ส่วนร่วม 12 หน้า เช่น `/audit-logs`, `/expenses/recurring-bills`, `/finance-portfolio` | 1440 | light | owner | เดือนนี้ | เยื้องจากกึ่งกลาง -1.3 → -2.5px | admin-after-owner/uxui-pages/route-128-1440-light.png |
| 44 | D2 | — | หลังบ้าน | ส่วนร่วม 12 หน้า เช่น `/audit-logs`, `/expenses/recurring-bills`, `/finance-portfolio` | 1440 | dark | owner | เดือนนี้ | เยื้องจากกึ่งกลาง -1.3 → -2.5px | admin-after-owner/uxui-pages/route-128-1440-dark.png |
| 45 | D2 | — | หลังบ้าน | ส่วนร่วม 12 หน้า เช่น `/audit-logs`, `/expenses/recurring-bills`, `/finance-portfolio` | 390 | light | owner | เดือนนี้ | เยื้องจากกึ่งกลาง -1.3 → -2.5px | admin-after-owner/uxui-pages/route-128-390-light.png |
| 46 | D2 | — | หลังบ้าน | ส่วนร่วม 12 หน้า เช่น `/audit-logs`, `/expenses/recurring-bills`, `/finance-portfolio` | 390 | dark | owner | เดือนนี้ | เยื้องจากกึ่งกลาง -1.3 → -2.5px | admin-after-owner/uxui-pages/route-128-390-dark.png |
| 47 | D2 | — | หลังบ้าน | ส่วนร่วม 12 หน้า เช่น `/audit-logs`, `/expenses/recurring-bills`, `/finance-portfolio` | 320 | light | owner | เดือนนี้ | เยื้องจากกึ่งกลาง -1.3 → -2.5px | admin-after-owner/uxui-pages/route-128-320-light.png |
| 48 | D2 | — | หลังบ้าน | ส่วนร่วม 12 หน้า เช่น `/audit-logs`, `/expenses/recurring-bills`, `/finance-portfolio` | 320 | dark | owner | เดือนนี้ | เยื้องจากกึ่งกลาง -1.3 → -2.5px | admin-after-owner/uxui-pages/route-128-320-dark.png |
| 49 | D2 | — | หลังบ้าน | ส่วนร่วม 10 หน้า เช่น `/finance/dividend-register`, `/finance/equity`, `/finance/equity/:id` | 1440 | light | owner | ค่าคอมมิชชัน | เยื้องจากกึ่งกลาง 0.3 → -2.5px | admin-after-owner/uxui-pages/route-136-1440-light.png |
| 50 | D2 | — | หลังบ้าน | ส่วนร่วม 10 หน้า เช่น `/finance/dividend-register`, `/finance/equity`, `/finance/equity/:id` | 1440 | light | owner | รายงานลูกหนี้ระหว่างบริษัท | เยื้องจากกึ่งกลาง 0.8 → -1.9px | admin-after-owner/uxui-pages/route-136-1440-light.png |
| 51 | D2 | — | หลังบ้าน | ส่วนร่วม 10 หน้า เช่น `/finance/dividend-register`, `/finance/equity`, `/finance/equity/:id` | 1440 | light | owner | รายงานลูกหนี้และอายุหนี้ | เยื้องจากกึ่งกลาง 0.8 → -1.9px | admin-after-owner/uxui-pages/route-136-1440-light.png |
| 52 | D2 | — | หลังบ้าน | ส่วนร่วม 10 หน้า เช่น `/finance/dividend-register`, `/finance/equity`, `/finance/equity/:id` | 1440 | light | owner | รายงานหนี้สูญ | เยื้องจากกึ่งกลาง 0.8 → -1.9px | admin-after-owner/uxui-pages/route-136-1440-light.png |
| 53 | D2 | — | หลังบ้าน | ส่วนร่วม 10 หน้า เช่น `/finance/dividend-register`, `/finance/equity`, `/finance/equity/:id` | 1440 | light | owner | ส่งออก PEAK CSV | เยื้องจากกึ่งกลาง 0.4 → -2.5px | admin-after-owner/uxui-pages/route-136-1440-light.png |
| 54 | D2 | — | หลังบ้าน | ส่วนร่วม 10 หน้า เช่น `/finance/dividend-register`, `/finance/equity`, `/finance/equity/:id` | 1440 | dark | owner | ค่าคอมมิชชัน | เยื้องจากกึ่งกลาง 0.3 → -2.5px | admin-after-owner/uxui-pages/route-136-1440-dark.png |
| 55 | D2 | — | หลังบ้าน | ส่วนร่วม 10 หน้า เช่น `/finance/dividend-register`, `/finance/equity`, `/finance/equity/:id` | 1440 | dark | owner | รายงานลูกหนี้ระหว่างบริษัท | เยื้องจากกึ่งกลาง 0.8 → -1.9px | admin-after-owner/uxui-pages/route-136-1440-dark.png |
| 56 | D2 | — | หลังบ้าน | ส่วนร่วม 10 หน้า เช่น `/finance/dividend-register`, `/finance/equity`, `/finance/equity/:id` | 1440 | dark | owner | รายงานลูกหนี้และอายุหนี้ | เยื้องจากกึ่งกลาง 0.8 → -1.9px | admin-after-owner/uxui-pages/route-136-1440-dark.png |
| 57 | D2 | — | หลังบ้าน | ส่วนร่วม 10 หน้า เช่น `/finance/dividend-register`, `/finance/equity`, `/finance/equity/:id` | 1440 | dark | owner | รายงานหนี้สูญ | เยื้องจากกึ่งกลาง 0.8 → -1.9px | admin-after-owner/uxui-pages/route-136-1440-dark.png |
| 58 | D2 | — | หลังบ้าน | ส่วนร่วม 10 หน้า เช่น `/finance/dividend-register`, `/finance/equity`, `/finance/equity/:id` | 1440 | dark | owner | ส่งออก PEAK CSV | เยื้องจากกึ่งกลาง 0.4 → -2.5px | admin-after-owner/uxui-pages/route-136-1440-dark.png |
| 59 | D2 | — | หลังบ้าน | ส่วนร่วม 9 หน้า เช่น `/accounting/intercompany`, `/expenses/recurring-bills`, `/expenses/verify-number/:number` | 1440 | light | owner | ค่าใช้จ่ายดำเนินงาน | เยื้องจากกึ่งกลาง -0.1 → -2.5px | admin-after-owner/uxui-pages/route-138-1440-light.png |
| 60 | D2 | — | หลังบ้าน | ส่วนร่วม 9 หน้า เช่น `/accounting/intercompany`, `/expenses/recurring-bills`, `/expenses/verify-number/:number` | 1440 | light | owner | จ่ายให้หน้าร้าน | เยื้องจากกึ่งกลาง -0.2 → -2.5px | admin-after-owner/uxui-pages/route-138-1440-light.png |

… อีก 1,799 จุด — ดูทั้งหมดใน `findings.json`

## มีอยู่ก่อนแล้ว (พบทั้งก่อนและหลัง — ไม่ได้เกิดจากฟอนต์ใหม่)

| กฎ | ตรวจอะไร | ระดับ (ครั้ง) | จุด | ครั้ง | หน้า | ตัวอย่าง |
|---|---|---|---|---|---|---|
| R1 | ขนาดตัวอักษรไม่อยู่ในสเกล | P3 3,566 | 894 | 3,566 | 204 | “AI”, “การเงิน & สินเชื่อ”, “เชื่อมต่อ” |
| R2 | หัวข้อรองใหญ่กว่าหัวข้อหลัก | P2 12 | 12 | 12 | 3 | “งวดบัญชี (Accounting Pe…” |
| R3 | ระยะบรรทัดไม่พอดี (ไทยแน่นเกิน = P1) | P1 52 · P2 748 | 710 | 800 | 28 | “ของเรา”, “ช่องทาง”, “ติดต่อ” |
| R4 | สระ/วรรณยุกต์ถูกตัด | P1 50 | 50 | 50 | 6 | “สาขา: ทดสอบระบบ DOCS-5B…”, “สาขา: ทดสอบระบบ DOCS-CE…”, “ระบบจัดการร้านครบวงจร” |
| R5 | ปุ่ม/ชิป/เมนู/หัวตารางขึ้นสองบรรทัด | P1 122 · P2 325 | 303 | 447 | 42 | “ค่าใช้จ่าย”, “รับเรื่องแล้ว”, “สัญญาผ่อน” |
| R6 | ข้อความในปุ่ม/ป้ายถูกตัดแนวนอน | P2 30 | 30 | 30 | 1 | “ธนาคาร - กสิกรไทย ออมทร…”, “ธนาคาร - ไทยพาณิชย์ ออม…”, “เงินสด - พนักงานบัญชี” |
| R7 | ปุ่ม/ช่องกรอกเตี้ยกว่าเกณฑ์ | P2 396 | 336 | 396 | 41 | “แก้ไข”, “กลับไปหน้ารายการ”, “ล้างชื่อผู้ขาย” |
| R7b | ช่องกรอกบนมือถือตัวเล็กกว่า 16px (iOS ซูม) | P2 8 | 8 | 8 | 1 | “กรอกเลข IMEI 15 หลัก” |
| R9 | น้ำหนักตัวอักษรไม่อยู่ในชุดที่ส่ง | P3 1,256 | 88 | 1,256 | 195 | “BEST”, “CHOICE” |
| R10 | ตัวเลขไม่เรียงหลัก (ไม่มี tabular-nums) | P3 960 | 522 | 960 | 27 | “2”, “0”, “0 ฿” |
| R11 | ไอคอนไม่สมส่วนกับตัวอักษร | P3 1,488 | 72 | 1,488 | 196 | “เพิ่มเติม”, “ออกจากตั้งค่า”, “เลือกแม่แบบเพื่อแก้ไข” |
| R12 | ย่อหน้ากว้างเกินอ่านสบาย | P3 29 | 29 | 29 | 6 | “OT นับเมื่อออกหลังเวลาเ…”, “BESTCHOICE เป็นร้านขาย …”, “บริษัท เบสช้อยส์ จำกัด …” |

### P1 ที่มีอยู่ก่อนแล้ว — 224 จุด (224 ครั้ง) · ต้องแก้ แม้ไม่ได้เกิดจากฟอนต์ใหม่

| # | กฎ | ระดับ | แอป | หน้า | กว้าง | ธีม | role | ข้อความ | ค่าที่วัด | ภาพ |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | light | owner | ของเรา | ระยะบรรทัด ×1.11 (40/36px) | admin-after-owner/uxui-pages/route-1-1440-light.png |
| 2 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | light | salesA | ของเรา | ระยะบรรทัด ×1.11 (40/36px) | admin-after-salesA/uxui-pages/route-1-1440-light.png |
| 3 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | light | owner | ช่องทาง | ระยะบรรทัด ×1.11 (40/36px) | admin-after-owner/uxui-pages/route-1-1440-light.png |
| 4 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | light | salesA | ช่องทาง | ระยะบรรทัด ×1.11 (40/36px) | admin-after-salesA/uxui-pages/route-1-1440-light.png |
| 5 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | light | owner | ติดต่อ | ระยะบรรทัด ×1.11 (40/36px) | admin-after-owner/uxui-pages/route-1-1440-light.png |
| 6 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | light | salesA | ติดต่อ | ระยะบรรทัด ×1.11 (40/36px) | admin-after-salesA/uxui-pages/route-1-1440-light.png |
| 7 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | light | owner | แนะนำ | ระยะบรรทัด ×1.11 (40/36px) | admin-after-owner/uxui-pages/route-1-1440-light.png |
| 8 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | light | salesA | แนะนำ | ระยะบรรทัด ×1.11 (40/36px) | admin-after-salesA/uxui-pages/route-1-1440-light.png |
| 9 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | light | owner | บริการ | ระยะบรรทัด ×1.11 (40/36px) | admin-after-owner/uxui-pages/route-1-1440-light.png |
| 10 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | light | salesA | บริการ | ระยะบรรทัด ×1.11 (40/36px) | admin-after-salesA/uxui-pages/route-1-1440-light.png |
| 11 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | light | owner | พร้อมเป็นเจ้าของสมาร์ทโฟนในฝัน? | ระยะบรรทัด ×1.11 (40/36px) | admin-after-owner/uxui-pages/route-1-1440-light.png |
| 12 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | light | salesA | พร้อมเป็นเจ้าของสมาร์ทโฟนในฝัน? | ระยะบรรทัด ×1.11 (40/36px) | admin-after-salesA/uxui-pages/route-1-1440-light.png |
| 13 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | light | owner | สินค้า | ระยะบรรทัด ×1.11 (40/36px) | admin-after-owner/uxui-pages/route-1-1440-light.png |
| 14 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | light | salesA | สินค้า | ระยะบรรทัด ×1.11 (40/36px) | admin-after-salesA/uxui-pages/route-1-1440-light.png |
| 15 | R3 | P1 | หลังบ้าน | `/liff/history` | 1440 | light | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-1440-light.png |
| 16 | R3 | P1 | หลังบ้าน | `/liff/history` | 1440 | light | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-1440-light.png |
| 17 | R3 | P1 | หลังบ้าน | `/liff/history` | 1440 | light | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-1440-light.png |
| 18 | R3 | P1 | หลังบ้าน | `/liff/history` | 1440 | light | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-1440-light.png |
| 19 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | dark | owner | ของเรา | ระยะบรรทัด ×1.11 (40/36px) | admin-after-owner/uxui-pages/route-1-1440-dark.png |
| 20 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | dark | salesA | ของเรา | ระยะบรรทัด ×1.11 (40/36px) | admin-after-salesA/uxui-pages/route-1-1440-dark.png |
| 21 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | dark | owner | ช่องทาง | ระยะบรรทัด ×1.11 (40/36px) | admin-after-owner/uxui-pages/route-1-1440-dark.png |
| 22 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | dark | salesA | ช่องทาง | ระยะบรรทัด ×1.11 (40/36px) | admin-after-salesA/uxui-pages/route-1-1440-dark.png |
| 23 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | dark | owner | ติดต่อ | ระยะบรรทัด ×1.11 (40/36px) | admin-after-owner/uxui-pages/route-1-1440-dark.png |
| 24 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | dark | salesA | ติดต่อ | ระยะบรรทัด ×1.11 (40/36px) | admin-after-salesA/uxui-pages/route-1-1440-dark.png |
| 25 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | dark | owner | แนะนำ | ระยะบรรทัด ×1.11 (40/36px) | admin-after-owner/uxui-pages/route-1-1440-dark.png |
| 26 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | dark | salesA | แนะนำ | ระยะบรรทัด ×1.11 (40/36px) | admin-after-salesA/uxui-pages/route-1-1440-dark.png |
| 27 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | dark | owner | บริการ | ระยะบรรทัด ×1.11 (40/36px) | admin-after-owner/uxui-pages/route-1-1440-dark.png |
| 28 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | dark | salesA | บริการ | ระยะบรรทัด ×1.11 (40/36px) | admin-after-salesA/uxui-pages/route-1-1440-dark.png |
| 29 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | dark | owner | พร้อมเป็นเจ้าของสมาร์ทโฟนในฝัน? | ระยะบรรทัด ×1.11 (40/36px) | admin-after-owner/uxui-pages/route-1-1440-dark.png |
| 30 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | dark | salesA | พร้อมเป็นเจ้าของสมาร์ทโฟนในฝัน? | ระยะบรรทัด ×1.11 (40/36px) | admin-after-salesA/uxui-pages/route-1-1440-dark.png |
| 31 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | dark | owner | สินค้า | ระยะบรรทัด ×1.11 (40/36px) | admin-after-owner/uxui-pages/route-1-1440-dark.png |
| 32 | R3 | P1 | หลังบ้าน | `/landing` | 1440 | dark | salesA | สินค้า | ระยะบรรทัด ×1.11 (40/36px) | admin-after-salesA/uxui-pages/route-1-1440-dark.png |
| 33 | R3 | P1 | หลังบ้าน | `/liff/history` | 1440 | dark | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-1440-dark.png |
| 34 | R3 | P1 | หลังบ้าน | `/liff/history` | 1440 | dark | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-1440-dark.png |
| 35 | R3 | P1 | หลังบ้าน | `/liff/history` | 1440 | dark | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-1440-dark.png |
| 36 | R3 | P1 | หลังบ้าน | `/liff/history` | 1440 | dark | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-1440-dark.png |
| 37 | R3 | P1 | หลังบ้าน | `/liff/history` | 390 | light | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-390-light.png |
| 38 | R3 | P1 | หลังบ้าน | `/liff/history` | 390 | light | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-390-light.png |
| 39 | R3 | P1 | หลังบ้าน | `/liff/history` | 390 | light | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-390-light.png |
| 40 | R3 | P1 | หลังบ้าน | `/liff/history` | 390 | light | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-390-light.png |
| 41 | R3 | P1 | หลังบ้าน | `/liff/history` | 390 | dark | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-390-dark.png |
| 42 | R3 | P1 | หลังบ้าน | `/liff/history` | 390 | dark | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-390-dark.png |
| 43 | R3 | P1 | หลังบ้าน | `/liff/history` | 390 | dark | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-390-dark.png |
| 44 | R3 | P1 | หลังบ้าน | `/liff/history` | 390 | dark | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-390-dark.png |
| 45 | R3 | P1 | หลังบ้าน | `/liff/history` | 320 | light | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-320-light.png |
| 46 | R3 | P1 | หลังบ้าน | `/liff/history` | 320 | light | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-320-light.png |
| 47 | R3 | P1 | หลังบ้าน | `/liff/history` | 320 | light | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-320-light.png |
| 48 | R3 | P1 | หลังบ้าน | `/liff/history` | 320 | light | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-320-light.png |
| 49 | R3 | P1 | หลังบ้าน | `/liff/history` | 320 | dark | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-320-dark.png |
| 50 | R3 | P1 | หลังบ้าน | `/liff/history` | 320 | dark | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-320-dark.png |
| 51 | R3 | P1 | หลังบ้าน | `/liff/history` | 320 | dark | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-320-dark.png |
| 52 | R3 | P1 | หลังบ้าน | `/liff/history` | 320 | dark | LIFF | ใบเสร็จ | ระยะบรรทัด ×1 (10/10px) | admin-after-owner/uxui-pages/route-20-320-dark.png |
| 53 | R4 | P1 | หลังบ้าน | `/contracts/create` | 1440 | light | owner | สาขา: ทดสอบระบบ DOCS-5BC867FF สาขา A | เนื้อหาล้นกล่องแนวตั้ง | admin-after-owner/uxui-pages/route-79-1440-light.png |
| 54 | R4 | P1 | หลังบ้าน | `/contracts/create` | 1440 | light | owner | สาขา: ทดสอบระบบ DOCS-5BC867FF สาขา B | เนื้อหาล้นกล่องแนวตั้ง | admin-after-owner/uxui-pages/route-79-1440-light.png |
| 55 | R4 | P1 | หลังบ้าน | `/contracts/create` | 1440 | light | salesA | สาขา: ทดสอบระบบ DOCS-CE62414F สาขา A | เนื้อหาล้นกล่องแนวตั้ง | admin-after-salesA/uxui-pages/route-79-1440-light.png |
| 56 | R4 | P1 | หลังบ้าน | `/contracts/create` | 1440 | light | salesA | สาขา: ทดสอบระบบ DOCS-CE62414F สาขา B | เนื้อหาล้นกล่องแนวตั้ง | admin-after-salesA/uxui-pages/route-79-1440-light.png |
| 57 | R4 | P1 | หลังบ้าน | `/forgot-password` | 1440 | light | owner | ระบบจัดการร้านครบวงจร | เนื้อหาล้นกล่องแนวตั้ง | admin-after-owner/uxui-pages/route-6-1440-light.png |
| 58 | R4 | P1 | หลังบ้าน | `/forgot-password` | 1440 | light | salesA | ระบบจัดการร้านครบวงจร | เนื้อหาล้นกล่องแนวตั้ง | admin-after-salesA/uxui-pages/route-6-1440-light.png |
| 59 | R4 | P1 | หลังบ้าน | `/landing` | 1440 | light | owner | สินค้าคุณภาพราคาเป็นกันเอง | เนื้อหาล้นกล่องแนวตั้ง | admin-after-owner/uxui-pages/route-1-1440-light.png |
| 60 | R4 | P1 | หลังบ้าน | `/landing` | 1440 | light | salesA | สินค้าคุณภาพราคาเป็นกันเอง | เนื้อหาล้นกล่องแนวตั้ง | admin-after-salesA/uxui-pages/route-1-1440-light.png |

… อีก 164 จุด — ดูทั้งหมดใน `findings.json`

### R3/R7 ใช้เกณฑ์ตามแบบที่บ้านกำหนด (เจ้าของตัดสิน 2026-11-08) — ตัวเลขคือปัญหาจริงทั้งหมด

เกณฑ์ของเครื่องมือปรับให้ตรงแบบที่บ้านแล้ว: ข้อความเล็กกว่า 20px ระยะบรรทัด ×1.35–×1.8 (`leading-snug` ×1.375 ตาม `.claude/rules/frontend.md` ผ่าน) · ปุ่ม/ช่องกรอกบนจอกว้างตั้งแต่ 768px สูงอย่างน้อย 32px (ปุ่ม/SelectTrigger ขนาด md ของ shadcn 34px · รายการเมนูซ้าย 32–34px ผ่าน) · มือถือ (กว้างไม่เกิน 430px) ยังต้องสูง 44px · ข้อความไทยระยะบรรทัดต่ำกว่า ×1.2 ยังเป็น P1 ⇒ แบบที่บ้านไม่ถูกนับเป็นปัญหาอีก และไม่มีการหักแบบบ้านออกจากตัวเลขข้างล่าง · นับรวม "มีอยู่ก่อน" และ "เกิดจากฟอนต์ใหม่" · `findings.json` → `totals.houseStyle`

- **R3 ระยะบรรทัด P2 748 ครั้ง** (ตัวเล็กกว่า 20px นอก ×1.35–×1.8 · ตัวตั้งแต่ 20px นอก ×1.2–×1.6) — ตัวอย่าง “BEST CHOICE” (หลังบ้าน `/liff/branches` 1440px, ระยะบรรทัด ×1.33 (16/12px)) · “5.0” (หน้าร้าน `/` 1440px, ระยะบรรทัด ×1 (36/36px)) · “฿0.00” (หลังบ้าน `/accounting/intercompany` 1440px, ระยะบรรทัด ×1.65 (35.8/21.7px))
- **R3 ระยะบรรทัด P1 52 ครั้ง** (ข้อความไทยระยะบรรทัดต่ำกว่า ×1.2 — สระ/วรรณยุกต์ชนบรรทัด) — ตัวอย่าง “ใบเสร็จ” (หลังบ้าน `/liff/history` 1440px, ระยะบรรทัด ×1 (10/10px)) · “สินค้า” (หลังบ้าน `/landing` 1440px, ระยะบรรทัด ×1.11 (40/36px)) · “แนะนำ” (หลังบ้าน `/landing` 1440px, ระยะบรรทัด ×1.11 (40/36px))
- **R7 ความสูงปุ่ม/ช่องกรอก มือถือต่ำกว่า 44px 220 ครั้ง** (กดยากบนจอสัมผัส) — ตัวอย่าง “การลงบัญชี” (หลังบ้าน `/payments` 390px, สูง 32px < 44px (button)) · “ตามรุ่น” (หลังบ้าน `/` 390px, สูง 36px < 44px (button)) · “ดูรายละเอียดลูกค้า (ข้อมูลปัจจุบัน)” (หลังบ้าน `/contracts/:id` 390px, สูง 18px < 44px (button))
- **R7 ความสูงปุ่ม/ช่องกรอก จอกว้างต่ำกว่า 32px 176 ครั้ง** — ตัวอย่าง “ประเภท” (หลังบ้าน `/stock/products` 1440px, สูง 24px < 32px (button)) · “วันที่/เวลา” (หลังบ้าน `/trade-in` 1440px, สูง 24px < 32px (button)) · “เลข PO” (หลังบ้าน `/purchase-orders` 1440px, สูง 24px < 32px (button))

## หายไปหลังเปลี่ยน (พบในรอบก่อน ไม่พบในรอบหลัง)

| กฎ | ตรวจอะไร | ระดับ (ครั้ง) | จุด | ครั้ง | หน้า | ตัวอย่าง |
|---|---|---|---|---|---|---|
| R4 | สระ/วรรณยุกต์ถูกตัด | P1 139 | 139 | 139 | 12 | “ผ่อน iPhone ใช้บัตรประช…”, “ราย”, “0/6 งวด” |
| R5 | ปุ่ม/ชิป/เมนู/หัวตารางขึ้นสองบรรทัด | P1 44 · P2 4 | 12 | 48 | 9 | “รายจ่าย: บันทึก & POST”, “รายจ่าย: ยกเลิก”, “รายรับ: บันทึก & POST” |
| R9 | น้ำหนักตัวอักษรไม่อยู่ในชุดที่ส่ง | P3 252 | 30 | 252 | 21 | “BEST”, “CHOICE” |
| R10 | ตัวเลขไม่เรียงหลัก (ไม่มี tabular-nums) | P3 30 | 30 | 30 | 1 | “1”, “2”, “8” |
| R12 | ย่อหน้ากว้างเกินอ่านสบาย | P3 4 | 4 | 4 | 1 | “บริษัทจะดำเนินการลบข้อม…” |

※ หน้าที่ข้อมูลเปลี่ยนทุกรอบ (`/liff/debug` พิมพ์หมายเลขพอร์ตของรอบทดสอบ · `/audit-logs` ตัวเลขในตารางคือจำนวนรายการ audit ของรอบนั้น · `/system-status` เวลาตอบสนองและหน่วยความจำของรอบนั้น) — ตัวเลขที่ต่างกันระหว่างรอบทำให้นับเป็นใหม่/หายไปได้ทั้งที่ไม่เกี่ยวกับฟอนต์ · หัวข้อนี้มี 30 ครั้งบนหน้าเหล่านี้

ตัวอย่าง (ภาพ = รอบก่อน):

| # | กฎ | ระดับ | แอป | หน้า | กว้าง | ธีม | role | ข้อความ | ค่าที่วัด | ภาพ |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | R5 | P1 | หลังบ้าน | ส่วนร่วม 7 หน้า เช่น `/settings/access`, `/settings/access#accounting-permissions`, `/settings/access#attachment` | 1440 | light | owner | รายจ่าย: บันทึก & POST | ขึ้น 2 บรรทัด (th) | admin-before-owner/uxui-pages/route-218-1440-light.png |
| 2 | R5 | P1 | หลังบ้าน | ส่วนร่วม 7 หน้า เช่น `/settings/access`, `/settings/access#accounting-permissions`, `/settings/access#attachment` | 1440 | light | owner | รายจ่าย: ยกเลิก | ขึ้น 2 บรรทัด (th) | admin-before-owner/uxui-pages/route-218-1440-light.png |
| 3 | R5 | P1 | หลังบ้าน | ส่วนร่วม 7 หน้า เช่น `/settings/access`, `/settings/access#accounting-permissions`, `/settings/access#attachment` | 1440 | light | owner | รายรับ: บันทึก & POST | ขึ้น 2 บรรทัด (th) | admin-before-owner/uxui-pages/route-218-1440-light.png |
| 4 | R5 | P1 | หลังบ้าน | ส่วนร่วม 7 หน้า เช่น `/settings/access`, `/settings/access#accounting-permissions`, `/settings/access#attachment` | 1440 | dark | owner | รายจ่าย: บันทึก & POST | ขึ้น 2 บรรทัด (th) | admin-before-owner/uxui-pages/route-218-1440-dark.png |
| 5 | R5 | P1 | หลังบ้าน | ส่วนร่วม 7 หน้า เช่น `/settings/access`, `/settings/access#accounting-permissions`, `/settings/access#attachment` | 1440 | dark | owner | รายจ่าย: ยกเลิก | ขึ้น 2 บรรทัด (th) | admin-before-owner/uxui-pages/route-218-1440-dark.png |
| 6 | R5 | P1 | หลังบ้าน | ส่วนร่วม 7 หน้า เช่น `/settings/access`, `/settings/access#accounting-permissions`, `/settings/access#attachment` | 1440 | dark | owner | รายรับ: บันทึก & POST | ขึ้น 2 บรรทัด (th) | admin-before-owner/uxui-pages/route-218-1440-dark.png |
| 7 | R4 | P1 | หน้าร้าน | `/` | 1440 | light | guest | ผ่อน iPhone ใช้บัตรประชาชนใบเดียว | เนื้อหาล้นกล่องแนวตั้ง | shop-before/shop/route-root-1440.png |
| 8 | R4 | P1 | หลังบ้าน | `/collections` | 1440 | light | owner | ราย | เนื้อหาล้นกล่องแนวตั้ง | admin-before-owner/uxui-pages/route-102-1440-light.png |
| 9 | R4 | P1 | หลังบ้าน | `/collections` | 1440 | light | owner | ราย | เนื้อหาล้นกล่องแนวตั้ง | admin-before-owner/uxui-pages/route-102-1440-light.png |
| 10 | R4 | P1 | หลังบ้าน | `/collections` | 1440 | light | owner | ราย | เนื้อหาล้นกล่องแนวตั้ง | admin-before-owner/uxui-pages/route-102-1440-light.png |
| 11 | R4 | P1 | หลังบ้าน | `/collections` | 1440 | light | owner | ราย | เนื้อหาล้นกล่องแนวตั้ง | admin-before-owner/uxui-pages/route-102-1440-light.png |
| 12 | R4 | P1 | หลังบ้าน | `/contracts/:id` | 1440 | light | owner | 0/6 งวด | เนื้อหาล้นกล่องแนวตั้ง | admin-before-owner/uxui-pages/route-80-1440-light.png |
| 13 | R4 | P1 | หลังบ้าน | `/contracts/:id` | 1440 | light | salesA | 0/6 งวด | เนื้อหาล้นกล่องแนวตั้ง | admin-before-salesA/uxui-pages/route-80-1440-light.png |
| 14 | R4 | P1 | หลังบ้าน | `/contracts/:id` | 1440 | light | owner | 1,413.33 บาท | เนื้อหาล้นกล่องแนวตั้ง | admin-before-owner/uxui-pages/route-80-1440-light.png |
| 15 | R4 | P1 | หลังบ้าน | `/contracts/:id` | 1440 | light | salesA | 1,413.33 บาท | เนื้อหาล้นกล่องแนวตั้ง | admin-before-salesA/uxui-pages/route-80-1440-light.png |
| 16 | R4 | P1 | หลังบ้าน | `/contracts/:id` | 1440 | light | owner | 8,479.98 บาท | เนื้อหาล้นกล่องแนวตั้ง | admin-before-owner/uxui-pages/route-80-1440-light.png |
| 17 | R4 | P1 | หลังบ้าน | `/contracts/:id` | 1440 | light | salesA | 8,479.98 บาท | เนื้อหาล้นกล่องแนวตั้ง | admin-before-salesA/uxui-pages/route-80-1440-light.png |
| 18 | R4 | P1 | หลังบ้าน | `/finance/aging-report` | 1440 | light | owner | รายชื่อลูกหนี้ค้างชำระ (0 ราย) | เนื้อหาล้นกล่องแนวตั้ง | admin-before-owner/uxui-pages/route-208-1440-light.png |
| 19 | R4 | P1 | หลังบ้าน | `/finance/bad-debt-report` | 1440 | light | owner | รายการบันทึกหนี้สูญ | เนื้อหาล้นกล่องแนวตั้ง | admin-before-owner/uxui-pages/route-210-1440-light.png |
| 20 | R4 | P1 | หลังบ้าน | `/finance/contract-cancellation` | 1440 | light | owner | รายการรอการอนุมัติ | เนื้อหาล้นกล่องแนวตั้ง | admin-before-owner/uxui-pages/route-206-1440-light.png |

… อีก 195 จุด — ดูทั้งหมดใน `findings.json`

## AFTER เท่านั้น — ฟอนต์ผิด (R8)

กฎ R8 ตรวจว่าตัวอักษรของหน้าจอใช้ Noto Sans Thai (หรือ Sarabun เฉพาะเนื้อหาอ่านยาวของหน้าร้าน) — ตรวจเฉพาะรอบหลัง เพราะรอบก่อนใช้ Looped ทุกตัวโดยนิยาม จึงไม่อยู่ในหัวข้อเทียบก่อน/หลังใด ๆ

พบ 0 จุด (0 ครั้ง) — `findings.json` → `totals.afterOnlyR8` / `afterOnlyR8`

_ไม่มี_

## 30 จุดที่ควรดูก่อน

ลำดับ: ใหม่ P1 → ใหม่ P2 → ใหม่ P3 → ดูด้วยตา (สลับ D1/D2) → **P1 ที่มีอยู่ก่อนแล้ว** (กันที่ไว้ 10 อันดับท้าย สลับตามกฎเพื่อให้ทุกกลุ่ม P1 ปรากฏ — รายการเต็มอยู่ในหัวข้อ "มีอยู่ก่อนแล้ว") → มีอยู่ก่อนอื่น ๆ → จุดใหม่ที่อยู่เฉพาะบนหน้าที่ข้อมูลเปลี่ยนทุกรอบ (※) · ในกลุ่มเดียวกันเรียงตามจำนวนหน้าที่ได้รับผล · ภาพ = ภาพรอบหลังของหน้าแรกในจุดนั้น

| # | ประเภท | กฎ | ระดับ | แอป | หน้า | กว้าง | ธีม | role | ข้อความ | ค่าที่วัด | ภาพ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ดูด้วยตา | D1 | — | หน้าร้าน | `/shipping` | 390 | light | guest | สำหรับลูกค้าผ่อน ต้องมารับเครื่องที่สาข… | ความกว้างหมึก 482.3 → 555.4px (+15.2%) | shop-after/shop/route-shipping-390.png |
| 2 | ดูด้วยตา | D2 | — | หลังบ้าน | ส่วนร่วม 122 หน้า เช่น `/`, `/accounting/intercompany`, `/after-sales` | 1440 | light | owner | ตั้งค่ากลาง | เยื้องจากกึ่งกลาง -0.8 → -1.8px | admin-after-owner/uxui-pages/route-31-1440-light.png |
| 3 | ดูด้วยตา | D1 | — | หน้าร้าน | `/shipping` | 320 | light | guest | สำหรับลูกค้าผ่อน ต้องมารับเครื่องที่สาข… | ความกว้างหมึก 482.3 → 555.4px (+15.2%) | shop-after/shop/route-shipping-320.png |
| 4 | ดูด้วยตา | D2 | — | หลังบ้าน | ส่วนร่วม 122 หน้า เช่น `/`, `/accounting/intercompany`, `/after-sales` | 1440 | dark | owner | ตั้งค่ากลาง | เยื้องจากกึ่งกลาง -0.8 → -1.8px | admin-after-owner/uxui-pages/route-31-1440-dark.png |
| 5 | ดูด้วยตา | D1 | — | หน้าร้าน | `/ผ่อนไอโฟนลพบุรี` | 1440 | light | guest | อ่านขั้นตอนละเอียดได้ที่ และเงื่อนไขทั้… | ความกว้างหมึก 251.8 → 289.6px (+15%) | shop-after/shop/route-p-df68e697-1440.png |
| 6 | ดูด้วยตา | D2 | — | หลังบ้าน | ส่วนร่วม 40 หน้า เช่น `/collection-dashboard`, `/collections`, `/commissions` | 1440 | light | owner | รับเครื่องคืน / ยึดคืน | เยื้องจากกึ่งกลาง -1.3 → -3.8px | admin-after-owner/uxui-pages/route-104-1440-light.png |
| 7 | ดูด้วยตา | D1 | — | หน้าร้าน | `/ผ่อนไอโฟนลพบุรี` | 390 | light | guest | อ่านขั้นตอนละเอียดได้ที่ และเงื่อนไขทั้… | ความกว้างหมึก 251.8 → 289.6px (+15%) | shop-after/shop/route-p-df68e697-390.png |
| 8 | ดูด้วยตา | D2 | — | หลังบ้าน | ส่วนร่วม 40 หน้า เช่น `/collection-dashboard`, `/collections`, `/commissions` | 1440 | light | owner | รายได้อื่น | เยื้องจากกึ่งกลาง -1.3 → -3.8px | admin-after-owner/uxui-pages/route-104-1440-light.png |
| 9 | ดูด้วยตา | D1 | — | หน้าร้าน | `/ผ่อนไอโฟนลพบุรี` | 320 | light | guest | อ่านขั้นตอนละเอียดได้ที่ และเงื่อนไขทั้… | ความกว้างหมึก 251.8 → 289.6px (+15%) | shop-after/shop/route-p-df68e697-320.png |
| 10 | ดูด้วยตา | D2 | — | หลังบ้าน | ส่วนร่วม 40 หน้า เช่น `/collection-dashboard`, `/collections`, `/commissions` | 1440 | dark | owner | รับเครื่องคืน / ยึดคืน | เยื้องจากกึ่งกลาง -1.3 → -3.8px | admin-after-owner/uxui-pages/route-104-1440-dark.png |
| 11 | ดูด้วยตา | D1 | — | หน้าร้าน | `/installment-terms` | 1440 | light | guest | ชำระล่าช้ามีค่าปรับตามที่ระบุในสัญญา แต… | ความกว้างหมึก 1184 → 1361.3px (+15%) | shop-after/shop/route-installment-terms-1440.png |
| 12 | ดูด้วยตา | D2 | — | หลังบ้าน | ส่วนร่วม 40 หน้า เช่น `/collection-dashboard`, `/collections`, `/commissions` | 1440 | dark | owner | รายได้อื่น | เยื้องจากกึ่งกลาง -1.3 → -3.8px | admin-after-owner/uxui-pages/route-104-1440-dark.png |
| 13 | ดูด้วยตา | D1 | — | หน้าร้าน | `/installment-terms` | 390 | light | guest | ชำระล่าช้ามีค่าปรับตามที่ระบุในสัญญา แต… | ความกว้างหมึก 1184 → 1361.3px (+15%) | shop-after/shop/route-installment-terms-390.png |
| 14 | ดูด้วยตา | D2 | — | หลังบ้าน | ส่วนร่วม 40 หน้า เช่น `/collection-dashboard`, `/collections`, `/commissions` | 1440 | light | owner | ล็อคเครื่อง (MDM) | เยื้องจากกึ่งกลาง -0.2 → -2.7px | admin-after-owner/uxui-pages/route-104-1440-light.png |
| 15 | ดูด้วยตา | D1 | — | หน้าร้าน | `/installment-terms` | 320 | light | guest | ชำระล่าช้ามีค่าปรับตามที่ระบุในสัญญา แต… | ความกว้างหมึก 1184 → 1361.3px (+15%) | shop-after/shop/route-installment-terms-320.png |
| 16 | ดูด้วยตา | D2 | — | หลังบ้าน | ส่วนร่วม 40 หน้า เช่น `/collection-dashboard`, `/collections`, `/commissions` | 1440 | dark | owner | ล็อคเครื่อง (MDM) | เยื้องจากกึ่งกลาง -0.2 → -2.7px | admin-after-owner/uxui-pages/route-104-1440-dark.png |
| 17 | ดูด้วยตา | D1 | — | หน้าร้าน | `/installment-terms` | 1440 | light | guest | เครื่องจะถูกล็อคการใช้งานชั่วคราว เฉพาะ… | ความกว้างหมึก 825.8 → 949.4px (+15%) | shop-after/shop/route-installment-terms-1440.png |
| 18 | ดูด้วยตา | D2 | — | หลังบ้าน | ส่วนร่วม 40 หน้า เช่น `/collection-dashboard`, `/collections`, `/commissions` | 1440 | light | owner | รับชำระค่างวด | เยื้องจากกึ่งกลาง 0.3 → -2.5px | admin-after-owner/uxui-pages/route-104-1440-light.png |
| 19 | ดูด้วยตา | D1 | — | หน้าร้าน | `/installment-terms` | 390 | light | guest | เครื่องจะถูกล็อคการใช้งานชั่วคราว เฉพาะ… | ความกว้างหมึก 825.8 → 949.4px (+15%) | shop-after/shop/route-installment-terms-390.png |
| 20 | ดูด้วยตา | D2 | — | หลังบ้าน | ส่วนร่วม 40 หน้า เช่น `/collection-dashboard`, `/collections`, `/commissions` | 1440 | dark | owner | รับชำระค่างวด | เยื้องจากกึ่งกลาง 0.3 → -2.5px | admin-after-owner/uxui-pages/route-104-1440-dark.png |
| 21 | มีอยู่ก่อน (P1) | R3 | P1 | หลังบ้าน | `/landing` | 1440 | light | owner | ของเรา | ระยะบรรทัด ×1.11 (40/36px) | admin-after-owner/uxui-pages/route-1-1440-light.png |
| 22 | มีอยู่ก่อน (P1) | R4 | P1 | หลังบ้าน | `/contracts/create` | 1440 | light | owner | สาขา: ทดสอบระบบ DOCS-5BC867FF สาขา A | เนื้อหาล้นกล่องแนวตั้ง | admin-after-owner/uxui-pages/route-79-1440-light.png |
| 23 | มีอยู่ก่อน (P1) | R5 | P1 | หลังบ้าน | `/after-sales` | 1440 | light | owner | ค่าใช้จ่าย | ขึ้น 2 บรรทัด (th) | admin-after-owner/uxui-pages/route-56-1440-light.png |
| 24 | มีอยู่ก่อน (P1) | R3 | P1 | หลังบ้าน | `/landing` | 1440 | light | salesA | ของเรา | ระยะบรรทัด ×1.11 (40/36px) | admin-after-salesA/uxui-pages/route-1-1440-light.png |
| 25 | มีอยู่ก่อน (P1) | R4 | P1 | หลังบ้าน | `/contracts/create` | 1440 | light | owner | สาขา: ทดสอบระบบ DOCS-5BC867FF สาขา B | เนื้อหาล้นกล่องแนวตั้ง | admin-after-owner/uxui-pages/route-79-1440-light.png |
| 26 | มีอยู่ก่อน (P1) | R5 | P1 | หลังบ้าน | `/after-sales` | 1440 | light | salesA | ค่าใช้จ่าย | ขึ้น 2 บรรทัด (th) | admin-after-salesA/uxui-pages/route-56-1440-light.png |
| 27 | มีอยู่ก่อน (P1) | R3 | P1 | หลังบ้าน | `/landing` | 1440 | light | owner | ช่องทาง | ระยะบรรทัด ×1.11 (40/36px) | admin-after-owner/uxui-pages/route-1-1440-light.png |
| 28 | มีอยู่ก่อน (P1) | R4 | P1 | หลังบ้าน | `/contracts/create` | 1440 | light | salesA | สาขา: ทดสอบระบบ DOCS-CE62414F สาขา A | เนื้อหาล้นกล่องแนวตั้ง | admin-after-salesA/uxui-pages/route-79-1440-light.png |
| 29 | มีอยู่ก่อน (P1) | R5 | P1 | หลังบ้าน | `/after-sales` | 1440 | light | owner | รับเรื่องแล้ว | ขึ้น 2 บรรทัด (badge) | admin-after-owner/uxui-pages/route-56-1440-light.png |
| 30 | มีอยู่ก่อน (P1) | R3 | P1 | หลังบ้าน | `/landing` | 1440 | light | salesA | ช่องทาง | ระยะบรรทัด ×1.11 (40/36px) | admin-after-salesA/uxui-pages/route-1-1440-light.png |

## หมายเหตุสำหรับการตรวจด้วยตา

- `/liff/debug` พิมพ์หมายเลขพอร์ตของรอบทดสอบ ข้อความจึงต่างกันระหว่างก่อน/หลัง — ปัดตกได้
- ภาพเต็มหน้าของหน้าร้านมีปุ่ม LINE ลอย/แถบล่างค้างทับเนื้อหา — เป็นผลของการถ่ายภาพเต็มหน้า ไม่ใช่ปัญหาของหน้า
- หน้า LIFF ที่ถูกบังคับธีมมืดมีตัวอักษรสีจางอ่านยาก — เป็นปัญหาจริงแต่เป็นเรื่องสี ไม่เกี่ยวกับฟอนต์
- contact sheet (`.tmp/typo-audit/contact-sheet.html`) แสดงคู่ภาพก่อน|หลังของหน้าที่มีจุดใหม่ P1/P2 หรือ D1/D2 ทั้งสองธีม · จุดที่เป็นส่วนร่วมหลายหน้าแสดงเป็นตัวอย่าง 2 หน้าแรก

## ตัวเลขมาจากไหน

ทุกตัวเลขในรายงานนี้มาจาก `findings.json` ไฟล์เดียวกัน:

- จำนวนที่วัด → `coverage` (ต่อแอป × รอบ × role × สถานะ) · โฟลเดอร์ → `sources`
- ตรวจไม่ได้/ไม่วัด → `uncovered` (`roles`, `documentRoutes`, `blocked`, `errors`, `unpaired`, `missingRuns`)
- เกิดจากฟอนต์ใหม่ → `totals.new.P1/P2/P3` (`points` = จุด, `findings` = ครั้ง) · รายการเต็ม `added` + `escalated`
- ควรดูด้วยตา → `totals.deltas` · รายการเต็ม `deltas.D1` / `deltas.D2`
- มีอยู่ก่อน → `totals.persisting` (ไม่รวมที่ระดับสูงขึ้น) · `persisting` เก็บเป็นจำนวนต่อกฎ × ระดับ × หน้า × ความกว้าง × ธีม × role พร้อมตัวอย่างไม่เกิน 5 ข้อความ
- หายไป → `totals.resolved` · รายการเต็ม `resolved` · 30 จุด → `top30` · สถานะรายชุด → `routes`
- จุดที่เป็นส่วนร่วม (`"shell": true`) เก็บ `routeCount`, `occurrences` และรายชื่อหน้าไม่เกิน 20 หน้าแรก · ข้อความตัดที่ 120 ตัวอักษร · ข้อมูลรายตัวอักษรเต็มอยู่ใน `.tmp/typo-audit/` (รันคำสั่งเดิมซ้ำได้)

## ตรวจด้วยตา (2026-11-08)

วิธีตรวจ: ตัดภาพก่อน|หลังรอบองค์ประกอบจริงจากภาพหน้าจอของชุดวัด ขยาย 2–5 เท่า เทียบคู่กัน (ภาพอยู่ใน `.tmp/typo-audit/t7/` ไม่ commit) · ค้นแนวทางจาก ui-ux-pro-max (`--domain ux`): Compact Label Overflow · Chip Collection Reflow · Table Handling · Touch Target Size / Target Size (Minimum)

**เกิดจากฟอนต์ใหม่**
- **ตัวอักษรในปุ่ม/เมนู/ช่องกรอกเยื้องขึ้น (D2) — ยืนยัน:** ทุกจุดขึ้นทางเดียวกัน 1–2.5px (เช่น เมนูซ้าย "รับชำระค่างวด" +0.3 → −2.5px · "ตั้งค่ากลาง" −0.8 → −1.8px) เพราะ Noto Sans Thai เว้นที่ใต้ตัวอักษรให้สระล่างมากกว่าแบบมีหัว — เห็นชัดเฉพาะตอนขยาย · เจ้าของเคาะ: ไม่แก้
- **ความกว้างเปลี่ยนเกิน 8% (D1) — ปัดตก (ตั้งใจ):** ส่วนใหญ่คือย่อหน้าอ่านยาวของหน้าร้านที่เปลี่ยนเป็น Sarabun 16px ระยะ 1.75 ตามข้อกำหนด และคำสั้นที่แคบลง (เช่น "ใบ" −11.7%) ไม่ล้นที่ใด
- **P3 ใหม่ 18 จุด — ปัดตก:** อยู่บน `/audit-logs` ซึ่งตัวเลขในตารางเปลี่ยนทุกรอบวัด
- **หายไปหลังเปลี่ยน — ยืนยันว่าดีขึ้นจริง:** เช่น หัวข้อหน้าแรกหน้าร้าน "ผ่อน iPhone ใช้บัตรประชาชนใบเดียว" ขึ้นบรรทัดใหม่ตรงคำและพอดีกล่องแล้ว

**มีอยู่ก่อนแล้ว — ยืนยันเป็นปัญหาจริง (ภาพก่อน/หลังเหมือนกัน)**
- ป้าย/ชิปคำสั้นขึ้นสองบรรทัดจนล้นกรอบ: "เปิดใช้งาน" (`/suppliers/:id` ที่ 320) · "สัญญาผ่อน" "รับเรื่องแล้ว" (`/after-sales` ที่ 1440) · "ใช้งาน" "ไม่ใช้งาน" (`/branches`, ผังบัญชี)
- หัวตาราง/ปุ่มเรียงลำดับขึ้น 2–3 บรรทัดที่จอ 1440: "วันเริ่มงาน" (3 บรรทัด) "รหัสพนง." "เข้าสู่ระบบล่าสุด" (`/users`) · "ราคาเต็มจำนวน" "ยอดผ่อนต่อเดือน" "คงเหลือ" (`/stock/products`) · "ลำดับความสำคัญ" "รหัสบัญชี" (`/settings/access/account-roles`)
- หัวข้อ 36px ระยะบรรทัด ×1.11 บน `/landing` (ข้อความไทย) · ป้าย "ใบเสร็จ" ตัว 10px ระยะ ×1.0 ใน LIFF `/liff/history`
- ปุ่มบนมือถือต่ำกว่า 44px (เช่น LIFF "แสดงอีก N งวด") และปุ่มจอใหญ่ต่ำกว่า 32px — นับจากเกณฑ์ใหม่ในหัวข้อ "มีอยู่ก่อนแล้ว"

**มีอยู่ก่อนแล้ว — ปัดตก (ภาพไม่พบปัญหา)**
- R4 P1 ที่เหลือบนหัวข้อใหญ่ของ `/forgot-password` `/register` `/reset-password` `/landing` และข้อความ "สาขา: …" ใน `/contracts/create`: ข้อความครบ ไม่มีสระ/วรรณยุกต์ถูกตัด — กฎฟ้องจากทาง "เนื้อหาสูงเกินกล่องที่ซ่อนส่วนเกิน" ซึ่งเกินเพียง 1–2px · ยกเว้น "เปิดใช้งาน" ซึ่งล้นจริง (อยู่ในหัวข้อป้ายข้างบน)

**ปรับเครื่องมือตามคำตัดสินเจ้าของ (2026-11-08) แล้ววัดใหม่ทั้ง 6 ชุด**
- เลิกนับ "฿" เป็นข้อความไทย (ยอดเงินอย่าง "฿12,126.64" เคยถูกตรวจแบบข้อความไทย)
- ข้อความที่ตั้งใจตัดด้วย "…" หรือ line-clamp ไม่นับเป็นสระถูกตัด (ทางหมึกล้นบรรทัดยังตรวจตามเดิม)
- เกณฑ์ตามแบบบ้าน: ระยะบรรทัดตัว < 20px ขั้นต่ำ ×1.35 (`leading-snug` ผ่าน) · ปุ่มจอใหญ่ขั้นต่ำ 32px (ปุ่มมาตรฐาน 34px ผ่าน) · มือถือคง 44px · ข้อความไทยระยะต่ำกว่า ×1.2 ยังเป็น P1
- ผล: เกิดจากฟอนต์ใหม่ยังเป็น P1 0 · P2 0 · ที่มีอยู่ก่อนลดจาก 19,094 เหลือ 9,042 ครั้ง (ส่วนที่เหลือเป็นปัญหาจริงตามเกณฑ์ใหม่)

**คำตัดสินเจ้าของ (2026-11-08):** 1 ตัวอักษรเยื้องขึ้น — ไม่แก้ · 2 ป้าย/ชิป — ห้ามตัดบรรทัดที่ `Badge` · 3 หัวตาราง — ห้ามตัดบรรทัดที่ `TableHead` และให้ตารางเลื่อนแนวนอน · 4 หัวข้อ `/landing` และป้าย LIFF — แก้เฉพาะจุด · 5 คงแบบบ้าน ปรับเกณฑ์เครื่องมือ และแก้ส่วนที่เป็นปัญหาจริง · 6 แก้เครื่องมือ (ทำแล้วในรายงานนี้) — การแก้หน้าตาแอปทำเป็นแผนและ PR แยก
