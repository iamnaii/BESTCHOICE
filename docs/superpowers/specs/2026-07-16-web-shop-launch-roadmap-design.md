# Web-Shop Launch Roadmap — 13 ข้อ + เครื่องมือแอดมิน (5 Tracks)

**วันที่:** 2026-07-16
**สถานะ:** รอ user review
**ที่มา:** QA เว็บ shop พบว่าระบบ (โค้ด) ครบแต่ "ของจริง" ไม่ครบ — ผู้ใช้สั่งวางแผนแก้ทั้ง 13 ข้อ
**ข้อค้นพบระหว่างวางแผน:** ไม่มี admin UI ใดเขียน `Product.gallery` / `isOnlineVisible` / `onlineDescription` ได้เลย (shop-catalog อ่านอย่างเดียว; สินค้าบนเว็บตอนนี้คือ test data ที่เซ็ตตรงใน DB) → ต้องเพิ่ม Track A เป็น blocker ของข้อ 1/4

## เป้าหมายรวม

เว็บ shop (apps/web-shop → bestchoicephone-shop.web.app) พร้อมเปิดรับลูกค้าจริง:
ลูกค้าเห็นรูปเครื่องจริง เกรดจริง ติดต่อร้านได้จริง ล็อกอิน/สั่งซื้อได้จริง
และร้านมีเครื่องมือจัดการสินค้าขึ้นเว็บเองโดยไม่ต้องแตะ DB

## โครง 5 Tracks

### Track 0 — ปล่อยของที่เสร็จแล้ว ✅ (เสร็จแล้ว รอ merge)
| งาน | สถานะ |
|---|---|
| PR #1352 flow ซื้อ + login/404 + search + mobile menu + header/token fix | ✅ เปิดแล้ว CI เขียว รอ user merge |
| PR #1354 สีส้ม CTA (stacked บน #1352) | ✅ เปิดแล้ว — **ต้อง retarget base → main หลัง #1352 merge ก่อนกด merge** |

### Track A — "ตัวเลือกรูป + สวิตช์ขึ้นเว็บ" (photo-picker — ปลดล็อกข้อ 1+4)
**ปัญหา (แก้ไขหลัง scrutinize):** ระบบ**มีรูปสินค้าอยู่แล้ว 2 ชุด** — `Product.photos[]`
(ถ่ายตอนรับเข้า/QC, purchasing v2 B3) และ `ProductPhoto` (รูป 6 ด้านจาก ProductCreatePage/QC)
แต่เว็บ shop อ่าน field ที่สาม (`gallery`) ที่ไม่มีใครเขียน → **ห้ามสร้างท่ออัปโหลดใหม่**
(จะกลายเป็นถ่ายรูปซ้ำรอบสาม) — ให้ทำตัวเลือกรูปจากของที่มี
**เหตุที่ต้อง "เลือก" ไม่ auto-map:** รูปคลังมีรูปตำหนิ/IMEI/สภาพแกะเครื่อง ที่ไม่ควรโชว์ลูกค้า
**scope:**
- Backend (apps/api): endpoint PATCH online-listing ของ Product —
  `isOnlineVisible`, `gallery[]` (รับ subset ของ URL ที่มีอยู่ใน `photos[]`+`ProductPhoto`
  ของเครื่องนั้น — validate ห้าม URL นอกระบบ), `onlineDescription`;
  Roles: OWNER/BRANCH_MANAGER; อัปโหลดรูปเพิ่มเป็น option รอง (reuse FileInterceptor+S3 เดิม)
- Frontend (apps/web): ใน UI stock ที่มีอยู่ (ขยาย edit form เดิม ไม่สร้างหน้าใหม่ถ้าเลี่ยงได้) —
  แกลเลอรีรูปที่มีทั้งหมดของเครื่อง → ติ๊กเลือก+ลากเรียงเข้า "รูปขึ้นเว็บ", toggle ขึ้นเว็บ, ช่องคำอธิบาย
- นิยาม "พร้อมขึ้นเว็บ" = gallery ≥1 รูป + เกรดไม่ว่าง — API **ปฏิเสธ** การเปิด
  `isOnlineVisible=true` ถ้าไม่ครบ (BadRequestException ข้อความไทย); frontend
  แสดงเงื่อนไขที่ขาดก่อนกด (ปิดขึ้นเว็บ/แก้ field อื่นทำได้เสมอ)
**ไม่ทำ:** bulk import, gallery360, ท่ออัปโหลดแยกใหม่

### Track B — ข้อมูล/บัญชีจากฝั่งร้าน (checklist ของ USER — ผมช่วย config ฝั่งระบบ)
| # | รายการ | ใครทำ | หมายเหตุ |
|---|---|---|---|
| 2 | เบอร์โทรจริง | ร้านให้เบอร์ → ผมแก้ `shopInfo` ใน copy.ts จุดเดียว | |
| 3 | ยืนยัน LINE OA handle จริง (@bestchoice?) | ร้าน | กระทบทุกปุ่มทักไลน์ + ข้อ 10 |
| 9 | ลงโปรโมชัน 1-2 อัน | ร้าน (admin UI `/promotions` มีอยู่แล้ว) | |
| 7 | สร้าง LINE Login channel + ให้ ID/Secret | ร้าน (LINE Developers Console) → ผมตั้ง env `LINE_LOGIN_CHANNEL_ID`/`SECRET`/`SHOP_BASE_URL` บน Cloud Run + callback URL | เปิด login/checkout/ออเดอร์ |
| 13 | GA4 Measurement ID + FB Pixel ID | ร้าน → ผมใส่ผ่าน IntegrationConfig (settings) | ระบบ analytics พร้อมแล้ว |
| 6 | DNS `shop.bestchoicephone.app` | ผม (Z.com + Firebase Hosting custom domain ตาม topology เดิม) | ตอนนี้ NXDOMAIN |
| — | รูปหน้าร้าน + พิกัด Google Maps + ลิงก์ Google Business Profile | ร้าน | ใช้ใน Track D ข้อ 11 |
| 1,4 | เลือกรูปขึ้นเว็บ + กรอกเกรด | ร้าน **หลัง Track A เสร็จ** | รูปมีในระบบแล้วจาก receiving/QC |
| — | **เคลียร์สินค้าทดสอบบน prod** (test data ที่ `isOnlineVisible=true` เช่น iPhone 16 ฿17,000) | ผม+ร้านยืนยันรายการ | ต้องทำ**ก่อน**ประกาศเว็บ ไม่งั้นของปลอมโชว์ปนของจริง |

### Track C — Discoverability (โค้ด PR เดียว, เริ่มก่อน) ← **sub-project แรก**
**ปัญหา:** เก่าแลกใหม่ (`/trade-in`) และรับซื้อ (`/buyback`) มีหน้า+ระบบครบแต่ไม่มีลิงก์ใดชี้ไป = ลูกค้าเข้าไม่ถึง
**ดีไซน์:**
1. `ShopHeader` — เพิ่ม 2 ลิงก์ใน `NAV_LINKS`: "เก่าแลกใหม่" → `/trade-in`, "รับซื้อมือถือ" → `/buyback`
   (desktop nav 7 ลิงก์ยังพอดีจอ; hamburger mobile ได้อัตโนมัติเพราะใช้ NAV_LINKS ร่วมกัน)
2. `ShopFooter` — คอลัมน์ "บริการ" เพิ่ม 2 ลิงก์เดียวกัน
3. `HomePage` — section ใหม่ "บริการของเรา" (หลัง "ทำไมเลือก BESTCHOICE", ก่อนแบนเนอร์ออมดาวน์):
   การ์ด 3 ใบ = ผ่อนมือถือ (→ `/products`) / เก่าแลกใหม่ ตีราคาถึง ฿15,000 (→ `/trade-in`) /
   รับซื้อจ่ายสด (→ `/buyback`) — ใช้ `Card`+`Section`+`SectionHeader` pattern เดิม, ไอคอน lucide,
   copy ใหม่ลง `copy.ts` (`home.servicesTitle`, `home.serviceXTitle/Description`)
4. แบนเนอร์ออมดาวน์คงเดิม (เป็นบริการที่ 4 ที่มีที่ของตัวเองแล้ว)
**Gate ก่อน merge (จาก scrutinize):** หน้า `/trade-in` และ `/buyback` **ยังไม่เคยถูกเปิดทดสอบใน browser เลย**
(QA รอบแรกเช็คแค่ route มีอยู่) — ก่อนเพิ่มลิงก์พาลูกค้าเข้าไป ต้อง QA ทั้ง 2 flow จนจบ
(estimate/quick-quote → submit → status) บน local; ถ้าพบพัง ให้แก้ในตัว PR นี้หรือถอดลิงก์ตัวที่พังออกก่อน
**การทดสอบ:** typecheck + build + เปิด browser จริง (desktop nav, hamburger, footer, การ์ดหน้าแรก, ลิงก์ถึงปลายทางถูก, nav ไม่ล้นที่ความกว้าง ~1024px)
**ฐาน branch:** ต่อจาก `feat/web-shop-cta-orange` (แตะ ShopHeader ที่ #1352 rewrite) — แนะนำ user merge #1352 → retarget #1354 → merge → Track C ออกจาก main ตรง

### Track D — Conversion (โค้ด PR เดียว, หลัง C)
1. **ทักไลน์แนบชื่อรุ่น (ข้อ 10):** ปุ่ม LINE ใน ProductDetailPage (+StickyBottomBar) เปลี่ยนเป็น
   `https://line.me/R/oaMessage/{handle}/?{text}` โดย text = "สนใจ {brand} {model} {storage} เกรด {grade} ครับ/ค่ะ"
   — helper กลาง `lineOaMessageUrl()` ใน copy.ts/utils; ต้องได้ handle จริงจาก Track B ก่อน deploy (โค้ดใช้ shopInfo)
2. **Social proof หน้าแรก (ข้อ 11):** section รีวิวจริงจาก `GET /api/shop/reviews` (ReviewsSection มีแล้ว —
   ทำ variant homepage แสดง 3 รีวิวเด่น) + การ์ดหน้าร้าน: รูป (รอ Track B) + Google Maps embed + เวลาเปิด
3. **SEO (ข้อ 12):** dynamic `document.title`/meta description ต่อ route (hook `usePageMeta` เอง — ไม่เพิ่ม dependency),
   OG tags ใน index.html, `sitemap.xml`+`robots.txt` ใน public/ (static — SPA), และ structured data (LocalBusiness JSON-LD)
   ⚠️ **ข้อจำกัดที่ยอมรับโดยรู้ตัว (จาก scrutinize):** bot ของ LINE/Facebook ไม่รัน JS —
   ลิงก์สินค้าที่แชร์ในแชทจะได้ preview กลางของเว็บ (จาก OG static) ไม่ใช่รูป/ชื่อเครื่องรายตัว
   dynamic OG ต่อสินค้า (bot-UA rewrite/prerender บน hosting) = งานอนาคต ประเมินหลังเว็บมี traffic จริง
**ไม่ทำ:** SSR/prerender (Google render JS ได้; ค่อยประเมินหลังวัดผล), dynamic OG ต่อสินค้า (ดูข้อจำกัดข้างบน), รีวิวปลอม (ใช้ของจริงจากระบบเท่านั้น)

## ลำดับ + Dependencies

```
Track 0 (user merge #1352 → retarget+merge #1354)
   └→ Track C (โค้ด ~ครึ่งวัน) → Track A (โค้ด ~1-2 วัน) → Track D (โค้ด ~1 วัน)
Track B (คู่ขนานตลอด — ของร้าน; ผม config เมื่อได้ข้อมูล)
ข้อ 1/4 (รูป+เกรด) ทำได้เมื่อ Track A เสร็จ
D-1 (ทักไลน์แนบรุ่น) deploy ได้เมื่อยืนยัน LINE handle (B-3)
D-2 (การ์ดหน้าร้าน) สมบูรณ์เมื่อได้รูป+พิกัด (Track B)
```

## Success criteria (ทั้ง roadmap)
- ลูกค้าเข้าเว็บด้วยโดเมนจริง เห็นสินค้ามีรูป+เกรด กดจอง/สมัครผ่อน/ล็อกอินได้ครบ
- เมนูเข้าถึงทุกบริการ (ผ่อน/เก่าแลกใหม่/รับซื้อ/ออมดาวน์) จากทุกอุปกรณ์
- ร้านจัดการสินค้าขึ้นเว็บเองได้จาก /stock โดยไม่ต้องพึ่ง dev
- GA4/Pixel เก็บ funnel ได้ → วัดผลชุดสีใหม่และ conversion ได้จริง
