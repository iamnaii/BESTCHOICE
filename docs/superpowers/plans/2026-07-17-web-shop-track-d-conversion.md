# Web-Shop Track D — Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ปิด 3 ข้อสุดท้ายของ roadmap ฝั่งโค้ด — ทักไลน์แนบชื่อรุ่นจากหน้าสินค้า, การ์ดหน้าร้าน+นำทางบนหน้าแรก, SEO พื้นฐานทั้งเว็บ shop

**Architecture:** โค้ดล้วน `apps/web-shop` — (1) helper `lineOaMessageUrl()` สร้าง deep-link `https://line.me/R/oaMessage/{handle}/?{text}` จาก `shopInfo` + ลิงก์ "สอบถามเครื่องนี้ทางไลน์" ใต้ CTA ของหน้าสินค้า; (2) ขยาย `shopInfo` ด้วย field ร้าน (address/hours/mapsUrl/storePhotoUrl — 2 ตัวหลัง nullable, UI ซ่อนส่วนที่ยังไม่มีข้อมูล → เปิดใช้ทีหลังด้วยการแก้ copy.ts 1 บรรทัดเมื่อร้านส่งของมา) + section "มาหาเราที่ร้าน" บนหน้าแรก; (3) hook `usePageMeta` (title+description ต่อ route — ไม่เพิ่ม dependency), JSON-LD LocalBusiness, `sitemap.xml`+`robots.txt` ใน public/, เติม OG static ใน index.html

**Tech Stack:** React+Vite (web-shop), Tailwind v4 tokens, components เดิม (`Section/SectionHeader/Card/Button`)

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-16-web-shop-launch-roadmap-design.md` (Track D) — ข้อจำกัด OG ที่ยอมรับแล้ว: **ไม่ทำ dynamic OG ต่อสินค้า** (bot LINE/FB ไม่รัน JS — ลิงก์แชร์ได้ preview กลางจาก static OG เท่านั้น); ไม่ทำ SSR/prerender; รีวิวหน้าแรกมีอยู่แล้ว (ของจริงจากระบบ) ไม่แตะ
- ทุกข้อความ UI ไทย รวมที่ `copy.ts`; `shopInfo` เป็น source เดียวของข้อมูลร้าน (LINE handle/เบอร์ยังเป็น placeholder จนกว่าร้านยืนยัน — โค้ดต้องพร้อมทำงานทันทีที่แก้ค่า)
- ปุ่ม/ลิงก์ใหม่ห้ามใช้สีส้ม CTA (สงวนให้จอง/เลือกเครื่อง); ทักไลน์ = โทนเขียว LINE ตามเดิม
- ห้าม dependency ใหม่ (meta จัดการด้วย hook เอง ไม่ใช้ react-helmet)
- Verify ต่อ task: `npx tsc --noEmit` + `npm run build` + browser จริงบน `vite preview :5178` (worktree — ถ้า CDP ยังไม่ได้ Allow: บันทึกเป็น pending และ verify ด้วย build+DOM ผ่าน curl แทน screenshot)
- Worktree: `git worktree add -b feat/web-shop-track-d <scratchpad>/wt-track-d origin/main` + symlink node_modules (root+apps/*)
- commit แรก = plan นี้

---

### Task 0: ตั้ง branch + commit plan
- [ ] worktree + symlinks ตาม Global Constraints → copy plan → `git commit -m "docs(web-shop): plan Track D — conversion (LINE prefill + การ์ดหน้าร้าน + SEO)"`

---

### Task 1: ทักไลน์แนบชื่อรุ่น

**Files:**
- Modify: `apps/web-shop/src/lib/copy.ts` (helper + string)
- Modify: `apps/web-shop/src/pages/ProductDetailPage.tsx` (ลิงก์ใต้ CTA ทั้ง desktop stack และใต้ StickyBottomBar spacer โซน mobile)

**Interfaces:**
- Produces: `lineOaMessageUrl(text: string): string` ใน copy.ts — Task อื่นใช้ซ้ำได้

- [ ] **Step 1:** copy.ts — ใต้ `shopInfo` เพิ่ม:

```ts
/** LINE OA deep-link พร้อมข้อความ prefill — ใช้ handle จาก shopInfo เสมอ */
export function lineOaMessageUrl(text: string): string {
  const handle = shopInfo.lineHandle.replace(/^@/, '');
  return `https://line.me/R/oaMessage/%40${handle}/?${encodeURIComponent(text)}`;
}
```
และใน `copy.product` เพิ่ม `askLineCta: 'สอบถามเครื่องนี้ทางไลน์'`

- [ ] **Step 2:** ProductDetailPage — ใต้ปุ่ม "สมัครผ่อนทันที" (desktop stack) เพิ่มลิงก์ tertiary:

```tsx
              <a
                href={lineOaMessageUrl(`สนใจ ${displayName} ครับ/ค่ะ`)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 text-sm text-emerald-700 hover:underline underline-offset-4 leading-snug"
              >
                <MessageCircle className="size-4" aria-hidden="true" />
                {copy.product.askLineCta}
              </a>
```
(import `MessageCircle` เพิ่มใน lucide list, import `lineOaMessageUrl` จาก `@/lib/copy`) และวางลิงก์เดียวกันแบบ centered ใต้ `<StickyBottomBarSpacer />` โซน mobile (`md:hidden text-center py-3`)

- [ ] **Step 3:** tsc + build + browser: เปิดหน้าสินค้า → ลิงก์ปรากฏทั้ง 2 จุด, href มี `oaMessage` + ชื่อรุ่น encode ถูก (เช็คผ่าน DOM query ได้ไม่ต้องคลิก)
- [ ] **Step 4:** commit `feat(web-shop): ลิงก์สอบถามเครื่องนี้ทางไลน์ — prefill ชื่อรุ่นด้วย oaMessage deep-link`

---

### Task 2: การ์ดหน้าร้าน "มาหาเราที่ร้าน" บนหน้าแรก

**Files:**
- Modify: `apps/web-shop/src/lib/copy.ts` (`shopInfo` ขยาย + `copy.home` strings)
- Modify: `apps/web-shop/src/pages/HomePage.tsx` (section ใหม่ ก่อน reviews section)

**Interfaces:**
- Consumes: `shopInfo`, `lineOaMessageUrl` จาก Task 1

- [ ] **Step 1:** copy.ts — ขยาย `shopInfo`:

```ts
  address: 'เลขที่ 99/9 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมืองลพบุรี จังหวัดลพบุรี 15000',
  hours: 'เปิดทุกวัน 09:00 - 19:00 น.',
  /** TODO(owner): ใส่ลิงก์ Google Maps จริงแล้วปุ่มนำทางจะโผล่เอง */
  mapsUrl: null as string | null,
  /** TODO(owner): ใส่ URL รูปหน้าร้านจริงแล้วรูปจะโผล่เอง */
  storePhotoUrl: null as string | null,
```
(ย้ายค่า address/hours เดิมจาก `copy.contact` มาอ้าง `shopInfo` แทน — ห้ามมีสองสำเนา) + `copy.home` เพิ่ม: `visitTitle: 'มาหาเราที่ร้าน'`, `visitDescription: 'ร้านอยู่ลพบุรี ลองเครื่องจริงก่อนตัดสินใจ ทีมงานช่วยดูให้ทุกขั้น'`, `visitNavigateCta: 'นำทางด้วย Google Maps'`, `visitLineCta: 'นัดหมายทางไลน์'`

- [ ] **Step 2:** HomePage — เพิ่ม `<Section tone="muted">` ก่อน block reviews: Card แนวนอน (md:flex) — ซ้าย: ถ้า `shopInfo.storePhotoUrl` มี → `<img>` (aspect-video, rounded, object-cover); ไม่มี → ไม่ render ฝั่งรูปเลย (การ์ดเต็มกว้าง); ขวา: `visitTitle`(h2) + `visitDescription` + ที่อยู่ (`MapPin` icon) + เวลาเปิด (`Clock` icon) + แถวปุ่ม: `mapsUrl` มี → `<Button asChild variant="primary">` ลิงก์ mapsUrl (target _blank); เสมอ → `<Button asChild variant="outline">` ลิงก์ `lineOaMessageUrl('สนใจนัดหมายเข้ามาดูเครื่องที่ร้านครับ/ค่ะ')`
- [ ] **Step 3:** tsc + build + browser/DOM: section แสดง, ไม่มีรูป/ปุ่มนำทาง (ค่า null), ที่อยู่+เวลาแสดง, ปุ่มไลน์ href ถูก; หน้า contact ยังแสดงที่อยู่เดิมถูกต้อง (จาก shopInfo)
- [ ] **Step 4:** commit `feat(web-shop): การ์ดมาหาเราที่ร้าน บนหน้าแรก — config-driven เปิดรูป/นำทางเมื่อร้านส่งข้อมูล`

---

### Task 3: SEO — usePageMeta + JSON-LD + sitemap/robots + OG

**Files:**
- Create: `apps/web-shop/src/hooks/usePageMeta.ts`
- Create: `apps/web-shop/public/robots.txt`, `apps/web-shop/public/sitemap.xml`
- Modify: `apps/web-shop/index.html` (OG ครบชุด + JSON-LD LocalBusiness)
- Modify: pages หลัก 10 ไฟล์ — เรียก `usePageMeta(...)`: HomePage, CatalogPage, ProductDetailPage (title = displayName), HowItWorksPage, PromotionsPage, AboutPage, ContactPage, TradeInLandingPage, BuybackLandingPage, SavingPlanLandingPage

- [ ] **Step 1:** hook:

```ts
// apps/web-shop/src/hooks/usePageMeta.ts
import { useEffect } from 'react';

const BASE_TITLE = 'BESTCHOICE — ร้านขายไอโฟนผ่อนได้ลพบุรี';

/** ตั้ง document.title + meta description ต่อหน้า (คืนค่าเดิมเมื่อ unmount) */
export function usePageMeta(title?: string, description?: string) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title ? `${title} | BESTCHOICE ลพบุรี` : BASE_TITLE;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDesc = meta?.content;
    if (meta && description) meta.content = description;
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc !== undefined) meta.content = prevDesc;
    };
  }, [title, description]);
}
```

- [ ] **Step 2:** เรียกใน 10 หน้า — title/description ไทยสั้น กระชับ มีคีย์เวิร์ด local เช่น Catalog: `usePageMeta('สินค้าทั้งหมด', 'iPhone มือสองตรวจ 30 จุด ผ่อนบัตรประชาชนใบเดียว ร้านมือถือลพบุรี')`; ProductDetail: `usePageMeta(displayName, \`\${displayName} ผ่อนได้บัตรประชาชนใบเดียว รับประกันร้าน 30 วัน\`)` (เรียกหลัง data โหลด — hook รับ undefined ระหว่างโหลดได้); หน้าอื่นตามหัวข้อหน้า
- [ ] **Step 3:** index.html — เพิ่ม `meta name="description"` (ถ้ายังไม่มี), `og:description`, `og:type=website`, `og:url`, และ `<script type="application/ld+json">` LocalBusiness: name บริษัท เบสท์ช้อยส์โฟน จำกัด / BESTCHOICE Phone Shop, address ลพบุรี (ตาม shopInfo), openingHours Mo-Su 09:00-19:00, url https://shop.bestchoicephone.app, telephone เว้นไว้จนกว่าได้เบอร์จริง (ไม่ใส่ placeholder ปลอมใน structured data)
- [ ] **Step 4:** public/robots.txt (`User-agent: * / Allow: / / Sitemap: https://shop.bestchoicephone.app/sitemap.xml`) + sitemap.xml รายการ 10 static routes ข้างบน (product รายตัวเป็น dynamic — ข้ามรอบนี้ จดใน PR)
- [ ] **Step 5:** tsc + build + verify: `curl dist/index.html` มี JSON-LD/OG; browser/DOM: เข้าหน้า catalog → `document.title` เปลี่ยน, กลับหน้าแรก → คืนค่า
- [ ] **Step 6:** commit `feat(web-shop): SEO พื้นฐาน — meta ต่อหน้า, LocalBusiness JSON-LD, sitemap+robots`

---

### Task 4: Sweep + final review + PR
- [ ] tsc+build + browser/DOM sweep ทุกจุดใหม่ 3 ขนาดจอ (หรือ curl-DOM ถ้า CDP ยังปิด) + regression เดิม (nav/สีส้ม/header)
- [ ] final whole-branch review → แก้ findings → push → PR base main → ลบ worktree → ledger/memory → รายงาน

## Self-Review (ทำแล้ว)
- Coverage: ข้อ 10 (Task 1), 11 ส่วนที่เหลือ (Task 2 — รีวิวมีแล้ว, config-driven รอข้อมูลร้าน), 12 (Task 3) ครบ; ข้อจำกัด OG จดแล้ว
- Placeholders: ไม่มี TBD — จุด owner-data ใช้ nullable + TODO(owner) โดยตั้งใจ (spec Track B)
- Consistency: `lineOaMessageUrl` ประกาศ Task 1 ใช้ Task 2; ไม่มี type ขัดกัน
