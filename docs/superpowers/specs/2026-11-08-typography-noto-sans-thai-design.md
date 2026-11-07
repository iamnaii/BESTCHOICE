# Typography: Noto Sans Thai + Sarabun ทั้ง web-shop และ bestchoicephone.app

วันที่: 2026-11-08 · สถานะ: ร่างรอเจ้าของเคาะ mockup (ด่าน 1 ของแผน)
แผน: `docs/superpowers/plans/2026-11-08-typography-noto-sans-thai.md`

## 1. ต้นแบบที่ลอกมา (ตรวจจริงบน heygoody.com 2026-11-08)

ตรวจด้วย `getComputedStyle` ทุก text node บนหน้าแรกและหน้าประกันรถยนต์:

| ส่วนของ heygoody | ฟอนต์ | น้ำหนัก / ขนาด |
|---|---|---|
| เมนูบน | Noto Sans Thai | 500 / 16px (หัวหมวด dropdown 700) |
| แถบประกาศ | Noto Sans Thai | 700 / 16px |
| Hero หัวข้อ / ตัวรอง | Noto Sans Thai | 700 / 24px · 400 / 16–18px |
| ไอคอนผลิตภัณฑ์ (ป้ายใต้ไอคอน) | Noto Sans Thai | 400 / 16px |
| ปุ่ม/แท็บคูปอง | Noto Sans Thai | 700 / 18px · 400 / 16px |
| หัวข้อ section | Noto Sans Thai | 700 / 32–40px |
| H1 หน้าผลิตภัณฑ์ / H2 | Noto Sans Thai | 700 / 36px · 700 / 32px |
| การ์ดรีวิว / รางวัล | Noto Sans Thai | 400 / 18px · 400 / 14px |
| Footer | Noto Sans Thai | หัวหมวด 700 · ลิงก์ 400 / 16px |
| เนื้อหาอธิบายกรมธรรม์, ตารางความคุ้มครอง, FAQ | **Sarabun** | 400 และ 700 / 14–16px |

ข้อเท็จจริงสำคัญ:
- ข้อความอังกฤษ/ตัวเลขทั้งหมด (heygoody, EV, 40%, 1,200) เรนเดอร์ด้วย Noto Sans Thai ชุดเดียว ไม่สลับฟอนต์ละติน
- ฟอนต์โหลดเอง (self-host woff2) ไม่ดึง Google Fonts
- Poppins / DM Sans / Inter ประกาศไว้แต่ไม่ถูกใช้บนหน้าที่ตรวจ ⇒ ไม่ลอก

## 2. สถานะปัจจุบันของเรา

| แอป | ฟอนต์ UI | ฟอนต์เอกสาร | วิธีโหลด |
|---|---|---|---|
| `apps/web-shop` (bestchoicephone.com) | Prompt 400–800 (`--font-sans`, `--font-head` alias) | — | self-host `public/fonts/prompt/` + `styles/fonts.css` (unicode-range) · preload Thai 400 |
| `apps/web` (bestchoicephone.app + LIFF) | Inter + IBM Plex Sans Thai + IBM Plex Mono | TH Sarabun PSK (`font-sarabun`, สัญญา/ใบเสร็จ/จดหมาย) | `@import` Google Fonts ใน `index.css` + TTF ใน `public/fonts/` |

การใช้น้ำหนัก (นับจาก tsx): web `font-medium` 2,333 · `font-semibold` 1,510 · `font-bold` 492 · `font-extrabold` 8 · `tracking-tight` 57 · `leading-none` 43 · web-shop `font-semibold` 87 · `font-medium` 47 · `font-bold` 45 · `font-extrabold` 2 · `tracking-tight/leading-none` 2

## 3. การตัดสินใจ

### 3.1 บทบาทฟอนต์ (เหมือน heygoody)

| บทบาท | ฟอนต์ | น้ำหนักที่ส่ง | ใช้ที่ |
|---|---|---|---|
| UI ทั้งหมด (`--font-sans`) | **Noto Sans Thai** (ละติน+ตัวเลขจาก subset latin ของตระกูลเดียวกัน) | 400 · 500 · 600 · 700 | ทุกข้อความบนจอทั้งสองแอป รวม LIFF |
| อ่านยาว (`--font-reading`) | **Sarabun** | 400 · 700 | **web-shop เท่านั้น**: how-it-works, เงื่อนไขผ่อน, FAQ, บทความ, คำอธิบายสินค้าแบบย่อหน้า, นโยบายความเป็นส่วนตัว |
| เอกสารถึงลูกค้า / เอกสารพิมพ์ | **ไม่เปลี่ยนทุกชนิด** (คำสั่งเจ้าของ 2026-11-08) | — | สัญญา ใบเสร็จ ใบลดหนี้ จดหมาย ใบรับฝาก/ส่งมอบ voucher สติกเกอร์ PDF/HTML ฝั่ง API และ Flex LINE — ทั้ง `font-sarabun`/TH Sarabun PSK, Noto Sans Thai ใน `receipt-pdf.service.ts`, paper CSS, preview `.template-paper`, Tiptap editor ของแม่แบบเอกสาร คงเดิมทุกตัวอักษร |
| สติกเกอร์ (`/stickers`) | IBM Plex Sans Thai self-host โหลดเฉพาะหน้านั้น | 400 · 500 · 600 · 700 | `StickerCard.tsx` เขียนชื่อฟอนต์ตายตัว — เมื่อถอด Google Fonts ต้องมีไฟล์ให้ ไม่งั้น layout 50×30 mm ที่เจ้าของเคาะ 2026-09-12 เพี้ยน |
| mono (`--font-mono`) | IBM Plex Mono self-host | 400 · 500 · 600 | เฉพาะที่ `admin-typography.css` ยกเว้นไว้ (สติกเกอร์/paper) — บนจอ `.font-mono` ถูก map เป็น `--font-sans` อยู่แล้ว |

เหตุผลเพิ่ม 600 (heygoody ไม่ใช้): `font-semibold` 1,510 จุดใน apps/web ถ้าไม่ส่ง 600 เบราว์เซอร์จะ snap ไป 700 ทำให้ปุ่ม/ป้ายหนาเท่าหัวข้อ. ไม่ส่ง 800: `font-extrabold` 10 จุดแก้เป็น `font-bold`.

Sarabun (Google) ≠ TH Sarabun PSK — คนละไฟล์ คนละ metrics ห้ามใช้แทนกันในเอกสารพิมพ์.

### 3.2 วิธีโหลด (ทั้งสองแอปเหมือนกัน)

- ไฟล์ woff2 จาก `@fontsource/noto-sans-thai@5.3.0`, `@fontsource/sarabun@5.3.0`, `@fontsource/ibm-plex-sans-thai@5.3.0`, `@fontsource/ibm-plex-mono@5.3.0` (SIL OFL) ดึงด้วย `npm pack` ครั้งเดียวแล้ว cp ลง `public/fonts/<family>/` และ **commit ไฟล์** — ไม่เพิ่ม dependency หรือสคริปต์ (แบบเดียวกับ Prompt ใน PR #1657) · คำสั่งดึงจดไว้ที่หัว `fonts.css`
- Firebase cache `**/*.woff2` 30 วันแบบ immutable และชื่อไฟล์ไม่มี hash ⇒ **ห้ามแทนที่ไฟล์ชื่อเดิม** เปลี่ยนไฟล์ = ตั้งชื่อใหม่
- `@font-face` ต่อ subset (thai / latin) พร้อม `unicode-range` และ `font-display: swap` ใน `src/styles/fonts.css` ของแต่ละแอป ซึ่ง `index.css` `@import` เป็นบรรทัดแรก (แบบเดียวกันทั้งสองแอป)
- `index.html` preload เฉพาะ `noto-sans-thai-thai-400-normal.woff2` (เหมือน heygoody preload Thai 400 ตัวเดียว)
- ไม่มีคำขอไป `fonts.googleapis.com` อีก (prerender ของ web-shop abort โฮสต์ภายนอกอยู่แล้ว; LIFF/สาขาโหลดเร็วขึ้น)
- fallback stack: `'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif` (Tahoma มีไทยบน Windows)

ขนาดรวม: Noto Sans Thai 4 น้ำหนัก × 2 subset ≈ 78 KB · Sarabun 2 × 2 ≈ 43 KB · IBM Plex Mono 3 subset-latin ≈ 30 KB

### 3.3 แผนที่การใช้ต่อส่วน — web-shop (ลอก heygoody แล้วจัดเข้าโทเคนเรา)

| ส่วน | ฟอนต์ / น้ำหนัก / ขนาด | หมายเหตุ |
|---|---|---|
| Header nav | Noto 500 / `text-base` (16) | เหมือน heygoody; เมนูเปิด = 700 หัวหมวด, 400 รายการ |
| แถบประกาศ/โปร | Noto 700 / 16 | |
| Hero h1 | Noto 700 / `text-4xl` มือถือ · `text-5xl` desktop | เดิม Prompt 800 — ชดเชยความหนักด้วยขนาด+สีเขียว ไม่ใช่ 800 |
| Hero ตัวรอง | Noto 400 / `text-lg` | |
| หัวข้อ section (h2) | Noto 700 / `text-3xl` (30) | heygoody 32–40; ของเรา 30 บนมือถือ 36 desktop |
| การ์ดสินค้า: ชื่อรุ่น | Noto 700 / `text-lg` (18) | เหมือนการ์ดคูปอง heygoody 700/18 |
| การ์ดสินค้า: ราคา/ค่างวด | Noto 700 / `text-2xl` ทาง `.num` (tabular-nums) | ตัวเลขใช้ Noto ไม่สลับฟอนต์ |
| การ์ดสินค้า: meta (สภาพ, ประกัน) | Noto 400 / `text-sm` (14) | |
| ป้าย/badge | Noto 700 / `text-xs` (12) | |
| ปุ่ม CTA (ทักแชท/โทร/ดูสินค้า) | Noto 600 / 16 · ปุ่ม lg 700 / 19 | เกณฑ์ contrast ตัวใหญ่เดิมคงไว้ |
| ตัวเลือกสด/ผ่อน, แท็บ, ชิป | Noto 500 / 14–16 | |
| รีวิวลูกค้า | Noto 400 / 18 | เหมือน heygoody |
| บล็อกอ่านยาว (how-it-works, เงื่อนไข, FAQ, นโยบาย, คำอธิบายสินค้า) | **Sarabun 400 / 16 · lh 1.75** · หัวข้อย่อยในบล็อก Sarabun 700 / 18 | ยูทิลิตี `reading-block` (Tailwind `@utility`) ครอบทั้งบล็อก; ปุ่ม/ลิงก์ในบล็อกยัง Noto · โทเคน `--font-reading` อยู่ใน `@theme` จึงมีคลาส `font-reading` (family อย่างเดียว) ให้ใช้กับข้อความเดี่ยว ๆ ได้ แต่บล็อกต้องใช้ `reading-block` |
| Footer | Noto 700 หัวหมวด · 400 ลิงก์ / 16 · เลขใบอนุญาต 14 | |
| Cookie/consent | Noto 400 / 14 | heygoody ใช้ Noto ไม่ใช่ Sarabun |

### 3.4 แผนที่การใช้ต่อส่วน — apps/web (bestchoicephone.app)

| ส่วน | ฟอนต์ / น้ำหนัก / ขนาด | หมายเหตุ |
|---|---|---|
| body / ตาราง / ฟอร์ม | Noto 400 / 14 · lh 1.5 | ความหนาแน่น admin เดิม |
| Sidebar เมนู | Noto 500 / 14 | |
| ชื่อหน้า `#main h1` | Noto 600 / 24 · lh 1.5 (admin-typography เดิม) | |
| หัวการ์ด / section | Noto 600 / 16–18 | |
| KPI ตัวเลขใหญ่ | Noto 700 / 24–36 · tabular-nums | แทน Inter |
| ชิปสถานะ / badge | Noto 500–600 / 12 | ต้องมีคำ/ไอคอน ไม่ใช่สีอย่างเดียว (กติกาเดิม) |
| ปุ่ม | Noto 500 / 14 | |
| Dialog / Sheet / Toast | Noto (สืบทอด) | |
| Tiptap editor (แก้แม่แบบเอกสาร) | **ไม่เปลี่ยน** — ย้ายกติกา `.tiptap.ProseMirror` ให้ชี้ IBM Plex Sans Thai ที่ self-host ชุดเดียวกับสติกเกอร์ | เป็นเครื่องมือแก้เอกสารถึงลูกค้า อยู่ใต้คำสั่ง "ไม่แตะเอกสาร" |
| LIFF ลูกค้า (`/liff/*`) | Noto 400 / 16 · หัว 700 / 20–24 | เหมือนหน้าร้าน |
| สัญญา/ใบเสร็จ/จดหมาย/สติกเกอร์ (print + preview) | TH Sarabun PSK / IBM Plex Mono — **ไม่เปลี่ยน** | guard `body:has(.app-shell):not(:has(.template-paper, .font-sarabun, …))` เดิมคุมอยู่ |

### 3.5 การปรับเพื่อให้ "สวยกับฟอนต์ใหม่" (ผล ui-ux-pro-max + ตรวจ metrics)

ตรวจด้วย `search.py --domain typography|ux` 4 คำค้น: "Thai Modern" (Noto Sans Thai ทั้งหัวและเนื้อ) เป็นคู่ที่แนะนำสำหรับเว็บไทย · line-height เนื้อ 1.5–1.75 · ห้าม `leading-none` · ต้องมี fallback + `font-display: swap` กัน layout shift · ใช้ type scale คงที่ (12 14 16 18 24 32).

1. Noto Sans Thai มีสระบน/วรรณยุกต์สูงกว่า IBM Plex Sans Thai ⇒ `apps/web` ผ่อน line-height หัวข้อ: `--text-2xl--line-height` 1.33→1.35 · `--text-3xl` 1.27→1.3 · `--text-4xl` 1.11→1.25
2. `tracking-tight`/`tracking-tighter` บนข้อความไทยทำให้วรรณยุกต์ชนกัน ⇒ ยกเลิกบนจอผ่านกติกาใน `admin-typography.css` (ภายใต้ guard เดิม) และแก้ 2 จุดใน web-shop ตรง ๆ — ไม่ไล่แก้ 57 จุดใน web
3. `leading-none` 43 จุดใน web เป็นการฝืนกติกา `.claude/rules/frontend.md` อยู่แล้ว — แก้เฉพาะที่โผล่ในชุดภาพตรวจ (ภาพก่อน → แก้ → ภาพหลัง) ไม่กวาดทั้ง repo และ**ไม่ใส่ override ทั้งแอป**
4. web-shop: Prompt กว้างกว่า Noto ⇒ body line-height 1.7→1.65 (ยังอยู่ในช่วง 1.5–1.75) · `.font-brand` (wordmark BESTCHOICE) ปรับ `letter-spacing` 0.02em→0.01em · hero ขนาดขึ้น 1 ขั้นบน desktop ชดเชยน้ำหนัก 800 ที่หายไป
5. `.num` ยังใช้ `font-feature-settings: 'tnum'` — subset latin ของ Noto Sans Thai รองรับ (ยืนยันในภาพ mockup ด่าน 1)
6. สีและโทเคนอื่นไม่เปลี่ยน (primary `#167F5E` web-shop · emerald ของ web)

### 3.6 ด่านและกติกาที่ต้องผ่าน

- **ด่าน 1 mockup ก่อนแตะโค้ด** (คำสั่งเจ้าของ 2026-09-06): design canvas เทียบ "เดิม vs ใหม่" 3 กระดาน web-shop + 3 กระดาน web; หยุดรอเจ้าของเคาะ
- ผ่าน `ui-ux-pro-max` ก่อนส่ง mockup (ทำแล้ว 2026-11-08 — ผลอยู่ข้อ 3.5) และห้าม `--design-system` ทับโทเคน
- bump `version` ใน `apps/web/package.json` ทุก deploy
- repo เป็น public — spec/plan นี้ไม่มีราคา/ข้อมูลภายใน ผ่าน
- ห้ามแตะ `modules/mdm` (ไม่เกี่ยว) · **ห้ามเปลี่ยนฟอนต์เอกสารถึงลูกค้า/เอกสารพิมพ์** — เทสต์ปักว่า `--font-sarabun` ยังเป็น TH Sarabun PSK และ diff ของ PR ต้องไม่มีไฟล์ในรายการข้อ 4

## 4. นอกขอบเขต

- เปลี่ยน layout/สี/คอมโพเนนต์ · รีดีไซน์หน้าใด ๆ
- **เอกสารถึงลูกค้าทุกชนิด** (คำสั่งเจ้าของ 2026-11-08): ใบเสร็จ/ใบลดหนี้ (`receipt-pdf.service.ts`), สัญญา (`hire-purchase-contract.html`, `document-rendering.service.ts`), จดหมาย (`letter-pdf.service.ts`), ใบหลังการขาย (`after-sales-doc-html.ts`), voucher รับซื้อ, สติกเกอร์, หน้าแชร์ GFIN (`finance-share-page.util.ts`), rich menu LINE, Flex message, PDF ฝั่ง web (`pdfGenerator.ts` + `document-fonts.ts`) — ไม่มีไฟล์ไหนในรายการนี้ถูกแก้
- กวาด `leading-none` / `tracking-tight` ทั้ง repo
- ตัดคำไทย (`wordBreak`/`<wbr>`) — ปัญหาแยก

## 5. ความเสี่ยง

| ความเสี่ยง | รับมือ |
|---|---|
| ข้อความไทยสูงขึ้น → หัวตาราง/ชิป/เมนูล้นหรือขึ้นบรรทัดใหม่ | ภาพตรวจ 390/1280 ชุดคงที่ (ด่าน 4) + แก้จุดที่พบ |
| ผู้ใช้สาขาเคยชิน IBM Plex | เจ้าของเคาะจาก mockup ก่อน |
| ลืมไฟล์ฟอนต์ → fallback เงียบ | vitest ตรวจทุก `url()` ใน fonts.css ชี้ไฟล์ที่มีจริง + ไม่มีคำว่า Prompt / googleapis |
| เอกสารพิมพ์เพี้ยน | `--font-sarabun` และ paper CSS ไม่แตะ; เทสต์ปักว่ายังเป็น TH Sarabun PSK |
