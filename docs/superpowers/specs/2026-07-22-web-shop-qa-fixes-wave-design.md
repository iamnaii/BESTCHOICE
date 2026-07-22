# Web-shop: QA fixes wave (จากผล /qa 2026-07-22 — Score 4/5)

สถานะ: APPROVED (user เลือก 0.99%/เดือน + ให้เบอร์จริง 0955678887)
ที่มา: QA ด้วย cloud browser บน prod — 4 findings, ไม่มีตัวไหน block แต่ควรแก้ก่อน launch

## A. Font ไทยใน `.num` (แก้ "ผ่อน…/เดือน" เป็นกล่องบนเครื่องไม่มี font ไทย)
`apps/web-shop/src/index.css` — `.num` เดิม `font-family: "Inter", sans-serif` (Inter ไม่มีอักษรไทย)
→ `"Inter", "IBM Plex Sans Thai", "Noto Sans Thai", "Leelawadee UI", "Thonburi", sans-serif`
(เลขยังเป็น Inter + tnum; อักษรไทย fallback ไป font ไทยของทุก OS)

## B. ScrollToTop ตอนเปลี่ยนหน้า (แก้เข้าหน้าใหม่ค้างกลางหน้า)
component ใหม่ `apps/web-shop/src/components/ScrollToTop.tsx`: `useLocation` + `useNavigationType`
→ `window.scrollTo(0,0)` เมื่อ pathname เปลี่ยน **เฉพาะ PUSH/REPLACE** (POP = Back/Forward ปล่อยให้ browser restore ตามปกติ) · mount ใน App ระดับบนสุด

## C. Seed ตารางดอกเบี้ยผ่อน (แก้ `no_interest_config` — ผ่อนเริ่ม/เครื่องคิดผ่อนไม่โชว์เลข)
`apps/api/prisma/seed-interest-config.ts` — **idempotent: ถ้ามี InterestConfig active อยู่แล้ว = ข้าม ไม่ทับ**
ค่า: `productCategories [PHONE_NEW, PHONE_USED]` · `interestRate 0.0099` (0.99%/เดือน — ตรงตัวประมาณบนการ์ด) · `minDownPaymentPct 0.15` · งวด 3–12 · commission/vat ตาม default (0.10/0.07)
ไม่มี rates rows → preview ใช้ fallback สังเคราะห์ rate×เดือน (โค้ดรองรับอยู่แล้ว)
**เป็น config จริงตั้งต้น ไม่ใช่ demo** — เจ้าของแก้ได้ที่ settings → InterestConfigPage; ไม่ผูก `--clean`
รัน: `SEED_FILE=apps/api/prisma/seed-interest-config.ts bash scripts/seed-demo-products-prod.sh`

## D. เบอร์โทรจริง 095-567-8887
- `copy.ts` `shopInfo`: `phoneDisplay '095-567-8887'`, `phoneHref 'tel:+66955678887'` (ไหลไป footer/contact/returns เอง — verified 3 consumers)
- `index.html` JSON-LD: เพิ่ม `"telephone": "+66955678887"` (เดิมเว้นเพราะไม่มีเบอร์จริง) + ปรับ description "ไอโฟนมือสอง" → "ไอโฟนมือ 1 และมือสอง" ให้ตรง positioning #1368 (สำเนา static ต้องแก้คู่ shopInfo เสมอ)

## Verify
web-shop tsc+build · seeder local รัน 2 รอบ (สร้าง → ข้าม) · PR → merge/deploy → รัน seed job → prod: preview `available:true` + ผ่อนเริ่มโชว์, footer เบอร์จริง, กดการ์ดขึ้นบนสุด. ไม่มี migration
