# Typography: Noto Sans Thai + Sarabun ทั้ง web-shop และ bestchoicephone.app

วันที่: 2026-11-08 · สถานะ: **เจ้าของเคาะ mockup แล้ว 2026-11-08** (เปลี่ยนเป็นแบบไม่มีหัวทั้งสองแอป · ใช้ Sarabun กับบล็อกอ่านยาวหน้าร้าน)
แผน: `docs/superpowers/plans/2026-11-08-typography-noto-sans-thai.md` · mockup: design canvas `3Mf9pC8wXKXjq1QZJPBfYL` (7 กระดาน)

> **แก้ไขครั้งที่ 1 (2026-11-08 หลังทำ mockup):** ร่างแรกบรรยาย "สถานะปัจจุบัน" ผิด — อ่านจาก checkout ที่ค้าง branch
> ของ 2026-10-06 (ก่อน PR #1700) จึงเขียนว่าหน้าร้านใช้ Prompt และหลังบ้านใช้ Inter + IBM Plex Sans Thai. ของจริงบน
> `origin/main` คือ **Noto Sans Thai Looped (แบบมีหัว) ทั้งสองแอปตั้งแต่ 2026-10-15** ⇒ งานนี้คือ "มีหัว → ไม่มีหัว" +
> Sarabun บล็อกอ่านยาว ไม่ใช่การเปลี่ยนตระกูลฟอนต์. ข้อ 2, 3.2, 3.5 และ 4 เขียนใหม่ตามนั้น และเพิ่มฟอนต์เอกสาร
> (Inter / IBM Plex Sans Thai / IBM Plex Mono) ที่ร่างแรกตกไป.

> **แก้ไขครั้งที่ 2 (2026-11-08 ระหว่างทำ):** คำตัดสินเจ้าของ
> 1. ข้อความบรรทัดเดียวและคำอธิบายหนึ่งประโยคใต้หัวการ์ดคงเป็น Noto 14px · Sarabun (`reading-block`) เฉพาะย่อหน้าหลายประโยค คำตอบ FAQ และคำอธิบายสินค้า
> 2. Inter โฮสต์เองจากไฟล์ variable ที่ Google เสิร์ฟ (Inter แบบ static ของ @fontsource แสดงน้ำหนัก 500/700 ต่างจากเดิม) · IBM Plex ยังใช้ @fontsource
> 3. ไม่สร้าง skill `bestchoice-typography` (baseline สองรอบผ่านโดยไม่ต้องมี)

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
- ข้อความอังกฤษ/ตัวเลขทั้งหมดเรนเดอร์ด้วย Noto Sans Thai ชุดเดียว ไม่สลับฟอนต์ละติน
- ฟอนต์โหลดเอง (self-host) ไม่ดึง Google Fonts · ชื่อ family มาจาก computedStyle (เว็บใช้ปลั๊กอิน Use Any Font) — เจ้าของเทียบหน้าตาจาก mockup แล้ว
- Poppins / DM Sans / Inter ประกาศไว้แต่ไม่ถูกใช้บนหน้าที่ตรวจ ⇒ ไม่ลอก

## 2. สถานะปัจจุบันของเรา (`origin/main` 2026-11-08)

| แอป | ฟอนต์ UI | ฟอนต์เอกสาร/สิ่งพิมพ์ | วิธีโหลด |
|---|---|---|---|
| `apps/web-shop` | **Noto Sans Thai Looped** variable 100–900 (`--font-sans`, `--font-head` alias) | — | self-host `public/fonts/noto-sans-thai-looped/` (thai · latin · latin-ext + `OFL.txt` + `SOURCE.json`) ผ่าน `src/styles/fonts.css` · preload Thai · `public/fonts/prompt/` = ไฟล์ค้างไม่มีใครใช้ |
| `apps/web` (+ LIFF) | **Noto Sans Thai Looped** แบบเดียวกัน | ดูตารางข้อ 2.1 | Looped self-host ผ่าน `src/styles/fonts.css` · **Inter + IBM Plex Sans Thai + IBM Plex Mono ยังโหลดจาก Google Fonts** (`@import url(...)` บรรทัด 1–3 ของ `index.css`) |

### 2.1 ฟอนต์เอกสาร (ทั้งหมดอยู่นอกขอบเขต — ไม่เปลี่ยน)

| เอกสาร | ฟอนต์ที่ใช้จริง | ไฟล์ฟอนต์มาจาก |
|---|---|---|
| สัญญา · จดหมาย · ใบเสร็จ/ใบกำกับภาษี · ใบลดหนี้ · ใบเสร็จขาย/รายได้อื่น/ทรัพย์สิน · ใบสำคัญจ่าย · ใบรับฝาก/ส่งมอบ · voucher รับซื้อ · e-Tax · รายงาน PDF (API) | TH Sarabun PSK | TTF ฝังใน PDF (`apps/api/src/assets/fonts/document-fonts.ts` + `documentTypographyCss` `!important`) — ใบเสร็จค่างวดประกาศ Noto Sans Thai ใน CSS ฐานแต่ถูก TH Sarabun PSK ทับ |
| PDF ที่สร้างในเบราว์เซอร์ · preview กระดาษ `.template-paper` | TH Sarabun PSK | `apps/web/public/fonts/THSarabunPSK-*.ttf` |
| สติกเกอร์ 50×30 · ป้ายพัสดุ | IBM Plex Sans Thai + IBM Plex Mono | **Google Fonts** |
| ส่วนประกอบรอบกระดาษ / ใบเสร็จมือถือ / voucher-sheet ฯลฯ (`--font-document-ui`) | Inter + IBM Plex Sans Thai | **Google Fonts** |
| ตัวแก้แม่แบบเอกสาร (Tiptap) | IBM Plex Sans Thai | **Google Fonts** |
| rich menu (render ฝั่ง API) · Flex (ฟอนต์แอป LINE) · หน้าแชร์ GFIN · อีเมล | ของตัวเอง | ไม่เกี่ยวกับงานนี้ |

การใช้น้ำหนัก (tsx): web `font-light` 13 (ตัวเลขยอดเงินใหญ่ใน LIFF) · `font-extrabold` 8 (โลโก้ตัวหนังสือ) · web-shop `font-extrabold` 2 (wordmark) · `tracking-tight` web ~57 · `leading-none` web ~43 / web-shop 2 (ตัวเลข "5.0", "33,000+" เท่านั้น) · hero หน้าแรกหน้าร้านเป็น 700 `text-3xl md:text-4xl lg:text-5xl` อยู่แล้ว

## 3. การตัดสินใจ

### 3.1 บทบาทฟอนต์

| บทบาท | ฟอนต์ | น้ำหนักที่ส่ง | ใช้ที่ |
|---|---|---|---|
| UI ทั้งหมด (`--font-sans`) | **Noto Sans Thai** (แบบไม่มีหัว) | web-shop 400 · 500 · 600 · 700 · apps/web **300** · 400 · 500 · 600 · 700 | ทุกข้อความบนจอทั้งสองแอป รวม LIFF และ `privacy.html` / `terms.html` |
| อ่านยาว (`--font-reading`) | **Sarabun** | 400 · 700 | **web-shop เท่านั้น** ผ่าน `@utility reading-block`: how-it-works, เงื่อนไขผ่อน, คำตอบ FAQ, คำอธิบายสินค้าแบบย่อหน้า, คืนสินค้า/จัดส่ง/เกี่ยวกับเรา, landing pages |
| ฟอนต์เอกสาร (`--font-document-ui`, สติกเกอร์, ป้ายพัสดุ, Tiptap, `--font-mono`) | **Inter · IBM Plex Sans Thai · IBM Plex Mono — ไม่เปลี่ยน** | เท่ากับที่ Google import ขอวันนี้: Inter 300–700 · IBM Plex Sans Thai 300–700 · IBM Plex Mono 300–600 | ย้ายจาก Google Fonts มา self-host อย่างเดียว ชื่อ family/โทเคน/selector คงเดิมทุกตัวอักษร |
| เอกสาร PDF/พิมพ์ (TH Sarabun PSK) | **ไม่แตะ** | — | คำสั่งเจ้าของ 2026-11-08 |

- เหตุผลส่ง 600 (heygoody ไม่ใช้): `font-semibold` ~1,510 จุดใน apps/web — ไม่ส่งจะถูก snap ไป 700
- เหตุผลส่ง 300 เฉพาะ apps/web: `font-light` 13 จุดใน LIFF (ตัวเลขยอดเงิน) — ไม่ส่งจะหนาขึ้นเป็น 400
- ไม่ส่ง 800: `font-extrabold` (โลโก้ตัวหนังสือ web 8 · web-shop 2) แสดงเป็น 700 · web-shop แก้คลาสเป็น `font-bold` 2 จุด (ให้โค้ดตรงกับที่เห็น) · apps/web ไม่ไล่แก้ (ผลบนจอเท่ากัน)
- Sarabun (Google) ≠ TH Sarabun PSK — คนละไฟล์ คนละ metrics ห้ามใช้แทนกันในเอกสารพิมพ์

### 3.2 วิธีโหลด

- ไฟล์ woff2 จาก `@fontsource/noto-sans-thai@5.3.0`, `@fontsource/sarabun@5.3.0`, `@fontsource/inter@5.3.0`, `@fontsource/ibm-plex-sans-thai@5.3.0`, `@fontsource/ibm-plex-mono@5.3.0` (SIL OFL 1.1) ดึงด้วย `npm pack` ครั้งเดียวแล้ว cp ลง `public/fonts/<family>/` และ **commit ไฟล์** — ไม่เพิ่ม dependency หรือสคริปต์
- ทุกโฟลเดอร์ฟอนต์มี `OFL.txt` (คัดจาก `LICENSE` ของแพ็กเกจ) + `SOURCE.json` (แพ็กเกจ@เวอร์ชัน + sha256 ทุกไฟล์) — แบบเดียวกับ `noto-sans-thai-looped/` ของ PR #1700
- subset: Noto Sans Thai / Sarabun / IBM Plex Sans Thai = thai · latin · latin-ext · Inter / IBM Plex Mono = latin · latin-ext (ครอบคลุมเท่า Looped วันนี้; เอกสารมีแต่ไทย/ละติน)
- `unicode-range` ของแต่ละ subset คัดจาก `<weight>.css` ในแพ็กเกจ (ห้ามพิมพ์เอง) · ทุก `@font-face` มี `font-display: swap` · path เป็น absolute `/fonts/...`
- Firebase cache `**/*.woff2` 30 วันแบบ immutable และชื่อไฟล์ไม่มี hash ⇒ ห้ามแทนที่ไฟล์ชื่อเดิม เปลี่ยนไฟล์ = ตั้งชื่อใหม่ (ชื่อจาก @fontsource ไม่ชนกับ Looped)
- web-shop: `src/styles/fonts.css` (Noto + Sarabun) · apps/web: `src/styles/fonts.css` (Noto) + `src/styles/document-ui-fonts.css` (Inter + IBM Plex Sans Thai + IBM Plex Mono) import จาก `index.css` แทน Google `@import` — **โหลดทั้งแอปเหมือน Google import เดิม** (เบราว์เซอร์ดาวน์โหลดเฉพาะ face ที่ถูกใช้ เพราะ `--font-document-ui` ครอบหลายหน้า ไม่ใช่แค่ `/stickers`)
- `index.html` preload เฉพาะ `noto-sans-thai-thai-400-normal.woff2` · apps/web คง preload THSarabunPSK
- ลบ `public/fonts/noto-sans-thai-looped/` ทั้งสองแอป และ `apps/web-shop/public/fonts/prompt/`
- fallback stack: `'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif` · `--font-reading: 'Sarabun', 'Noto Sans Thai', system-ui, sans-serif`
- หลังงานนี้ไม่มีคำขอไป `fonts.googleapis.com` / `fonts.gstatic.com` จาก bundle ของทั้งสองแอป (`src/`, `index.html`, `privacy.html`, `terms.html`) · `apps/web/public/design-preview-*.html` (หน้าตัวอย่างนิ่ง ไม่อยู่ในแอป) ไม่แตะ

### 3.3 แผนที่การใช้ต่อส่วน — web-shop (ขนาด/สีคงของเดิม ต่างแค่ฟอนต์)

| ส่วน | ฟอนต์ / น้ำหนัก / ขนาด | หมายเหตุ |
|---|---|---|
| Header nav | Noto 500 / 16 | wordmark `font-extrabold` → `font-bold` |
| Hero h1 | Noto 700 / `text-3xl md:text-4xl lg:text-5xl` (เดิม) | ไม่ต้องชดเชยน้ำหนัก — เป็น 700 อยู่แล้ว |
| Hero ตัวรอง | Noto 400 / `text-lg` | |
| หัวข้อ section (h2) | Noto 700 / `text-2xl`–`text-3xl` (เดิม) | |
| การ์ดสินค้า: ชื่อรุ่น / ราคา / meta / ป้าย | Noto 700/18 · 700/24 `.num` tnum · 400/14 · 700/12 | |
| ปุ่ม CTA · ตัวเลือกสด/ผ่อน · ชิป | Noto 600/16 · 500/14–16 | |
| บล็อกอ่านยาว | **Sarabun 400 / 16 · lh 1.75** · หัวข้อย่อยในบล็อก Sarabun 700 / 18 | `reading-block` ใช้เฉพาะย่อหน้าหลายประโยค คำตอบ FAQ และคำอธิบายสินค้า (ข้อความบรรทัดเดียว/คำอธิบายการ์ดหนึ่งประโยค = Noto 14px, แก้ไขครั้งที่ 2); ครอบ container ของย่อหน้า; ปุ่ม/ลิงก์ในบล็อกยัง Noto · หัวข้อ section และคำถาม FAQ (ปุ่ม) เป็น Noto |
| Footer · cookie | Noto | |

### 3.4 แผนที่การใช้ต่อส่วน — apps/web (ขนาด/สีคงของเดิม ต่างแค่ฟอนต์)

| ส่วน | ฟอนต์ / น้ำหนัก / ขนาด |
|---|---|
| body / ตาราง / ฟอร์ม | Noto 400 / 14 · lh 1.5 |
| Sidebar · ปุ่ม | Noto 500 / 14 |
| `#main h1` · หัวการ์ด | Noto 600 / 24 · 600 / 16–18 |
| KPI | Noto 700 / 24–36 tabular-nums |
| ชิปสถานะ | Noto 500–600 / 12 (มีไอคอน/คำ ไม่ใช่สีอย่างเดียว — กติกาเดิม) |
| LIFF | Noto 400 / 16 · หัว 700 / 20 · ยอด 700 / 32 · ตัวเลขยอดใหญ่ `font-light` = Noto 300 |
| ทุกอย่างในตาราง 2.1 | **ไม่เปลี่ยน** — guard `body:has(.app-shell) … :not(:where(.voucher-sheet, .document-sheet, .bc-document, .document-landscape, .document-print-dialog, .template-paper, .font-sarabun, .mobile-receipt, .sticker, .print-stickers, .tiptap, iframe, …))` และ `:where(...) { --font-sans: var(--font-document-ui) }` เดิมคุมอยู่ |

### 3.5 การปรับเพื่อให้สวยกับฟอนต์ใหม่ (ผล ui-ux-pro-max + ภาพตรวจ)

ตรวจด้วย `search.py --domain ux` 5 คำค้น (2026-11-08): lh เนื้อ 1.5–1.75 · `font-display: swap` + fallback · ปุ่มมือถือ ≥44 · สถานะไม่ใช้สีอย่างเดียว · ตัวเลขมีจุลภาค — mockup ผ่านทุกข้อ

1. **ไม่ปรับระยะบรรทัดล่วงหน้า** — Looped กับไม่มีหัวอยู่ตระกูล Noto เดียวกัน เหตุผลในร่างแรก ("Noto สูงกว่า IBM Plex", "Prompt กว้างกว่า") ไม่จริงแล้ว ⇒ web-shop body lh 1.7 และ `.font-brand` 0.02em คงเดิม · apps/web `--text-2xl/3xl/4xl--line-height` คงเดิม เว้นแต่ภาพตรวจ Task 5 พบสระ/วรรณยุกต์ถูกตัด
2. `tracking-tight`/`tracking-tighter` บนข้อความไทยทำให้วรรณยุกต์ชนกัน ⇒ ยกเลิกบนจอด้วยกติกาเดียวใน `admin-typography.css` ใต้ `body:has(.app-shell)` **พร้อมรายการยกเว้นเอกสาร `:not(:where(...))` ชุดเดียวกับกติกาอื่นในไฟล์** — ไม่ไล่แก้ทีละจุด
3. `leading-none` แก้เฉพาะจุดที่ภาพตรวจฟ้อง (ภาพก่อน → แก้ → ภาพหลัง) ไม่กวาดทั้ง repo และ**ไม่ใส่ override ทั้งแอป**
4. `.num` ยังใช้ `font-feature-settings: 'tnum'`
5. สีและโทเคนอื่นไม่เปลี่ยน

### 3.6 ด่านและกติกาที่ต้องผ่าน

- ✅ **ด่าน 1 mockup** (คำสั่งเจ้าของ 2026-09-06): เคาะแล้ว 2026-11-08
- bump `version` ใน `apps/web/package.json` (ค่าใน `origin/main` +1) ก่อนเปิด PR
- repo เป็น public — spec/plan นี้ไม่มีราคา/ข้อมูลภายใน ผ่าน
- ห้ามแตะ `modules/mdm` · **ห้ามเปลี่ยนฟอนต์เอกสาร** — เทสต์ปักโทเคน/`@font-face`/selector เอกสาร และ diff ของ PR ต้องไม่มีไฟล์ในรายการข้อ 4 · ภาพเอกสาร/สติกเกอร์เทียบ `origin/main` ต้องเหมือนกัน

## 4. นอกขอบเขต

- เปลี่ยน layout/สี/คอมโพเนนต์ · รีดีไซน์หน้าใด ๆ
- **เอกสารถึงลูกค้าทุกชนิด** (คำสั่งเจ้าของ 2026-11-08) — ไฟล์ที่ห้ามอยู่ใน diff:
  - API: `receipt-pdf.service.ts` (ทุกโมดูล), `hire-purchase-contract.html`, `document-rendering.service.ts`, `generated-document-effects.ts`, `letter-pdf.service.ts`, `after-sales-doc-html.ts`, `after-sales-pdf.renderer.ts`, `voucher-html.builder.ts`, `voucher-pdf.renderer.ts`, `sale-receipt-pdf.service.ts`, `asset-receipt-pdf.service.ts`, `expense-voucher-pdf.service.ts`, `e-tax.service.ts`, `pdf-report.service.ts`, `finance-share-page.util.ts`, `rich-menu/templates/base-html.ts`, Flex message builders, `apps/api/src/assets/fonts/*`
  - shared/web: `packages/shared/src/document-style.ts`, `apps/web/src/lib/document-fonts.ts`, `pdfGenerator.ts`, `DocumentStyles.tsx`, `DocumentPreview.tsx`, `StickerCard.tsx`, `parcelLabel.ts`, `MobileReceipt.tsx`, `public/fonts/THSarabunPSK-*.ttf`, `public/design-preview-*.html`
  - บล็อก `@font-face` TH Sarabun PSK, `@utility font-sarabun`, `:where(.voucher-sheet, …) { --font-sans: var(--font-document-ui) }`, `.tiptap.ProseMirror` ใน `apps/web/src/index.css` และโทเคน `--font-document-ui` / `--font-sarabun` / `--font-mono`
- กวาด `leading-none` / `tracking-tight` / `font-extrabold` ทั้ง repo
- ตัดคำไทย (`wordBreak`/`<wbr>`) — ปัญหาแยก

## 5. ความเสี่ยง

| ความเสี่ยง | รับมือ |
|---|---|
| ถอด Google Fonts แล้วเอกสาร/สติกเกอร์/ป้ายพัสดุเปลี่ยนหน้าตา (Inter/IBM Plex หาย หรือไฟล์ @fontsource ต่างจาก Google) | self-host ครบทุกน้ำหนักที่ Google import ขอ + ภาพเทียบ `origin/main` ต่อพิกเซล (Task 4) · ถ้าต่าง: ใช้ไฟล์ที่ Google เสิร์ฟจริงแบบ PR #1700 (SOURCE.json) แทน @fontsource เฉพาะตระกูลนั้น |
| ข้อความไทยบนจอล้น/ขึ้นบรรทัดใหม่ | ภาพตรวจ 390/1280 ชุดคงที่ (Task 3 ข้อ 5, Task 5) + แก้จุดที่พบ |
| ผู้ใช้สาขาเคยชินแบบมีหัว (ตัวเล็กในตาราง) | เจ้าของเคาะจาก mockup กระดาน 0 แล้ว |
| ลืมไฟล์ฟอนต์ → fallback เงียบ | vitest ตรวจทุก `url()` ชี้ไฟล์ที่มีจริง + ไม่มี Looped/Prompt/googleapis |
| เทสต์ e2e ที่ปักชื่อ `Noto Sans Thai Looped` (6 จุดใน `apps/api/e2e`) แดง | แก้ใน Task 4 ให้ตรวจ `Noto Sans Thai` และต้องไม่มี `Looped` |
