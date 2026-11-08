# Typography Noto Sans Thai + Sarabun Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปลี่ยนฟอนต์ UI ของ `apps/web-shop` (bestchoicephone.com) และ `apps/web` (bestchoicephone.app + LIFF) จาก Noto Sans Thai **Looped** (มีหัว) เป็น **Noto Sans Thai** (ไม่มีหัว) + Sarabun สำหรับบล็อกอ่านยาวบนหน้าร้าน ตามแบบ heygoody.com โดยฟอนต์เอกสารทุกชนิดเหมือนเดิมทุกพิกเซล

**Architecture:** ฟอนต์ self-host เป็น woff2 ใน `public/fonts/<family>/` (คัดจาก `@fontsource/*@5.3.0` ผ่าน `npm pack` ครั้งเดียวแล้ว commit พร้อม `OFL.txt` + `SOURCE.json`) ประกาศ `@font-face` ต่อ subset ใน `src/styles/*.css` ที่ `index.css` import · โทเคน `--font-sans` / `--font-reading` เปลี่ยนที่เดียวแล้วไหลผ่าน Tailwind v4 `@theme` · ฟอนต์เอกสารใน apps/web (Inter / IBM Plex Sans Thai / IBM Plex Mono) ย้ายจาก Google Fonts มา self-host โดยชื่อ family/โทเคน/selector ไม่เปลี่ยน

**Tech Stack:** Vite 6 · Tailwind CSS v4 (`@theme`, `@utility`) · vitest · Playwright (ภาพตรวจ) · `@fontsource/{noto-sans-thai,sarabun,inter,ibm-plex-sans-thai,ibm-plex-mono}@5.3.0`

**Spec:** `docs/superpowers/specs/2026-11-08-typography-noto-sans-thai-design.md` (แก้ไขครั้งที่ 1 — อ่านข้อ 2 สถานะจริงก่อน)

## Global Constraints

- **ห้ามแก้ไฟล์เอกสาร** — รายการเต็มใน spec §4 · ตรวจก่อน commit ทุก Task ด้วยคำสั่ง **Doc guard** ด้านล่าง
- `apps/web/src/index.css`: บรรทัดที่แตะได้มีแค่ (ก) ลบ Google `@import url(...)` บรรทัด 1–3 (ข) เพิ่ม `@import './styles/document-ui-fonts.css';` (ค) ค่า `--font-sans` (ง) Task 5: ค่า `--text-*--line-height` เฉพาะที่ภาพฟ้อง (จ) คอมเมนต์บรรทัด ~397 "Primary Thai font is now IBM Plex Sans Thai (loaded via Google Fonts above)" → บอกว่า UI ใช้ Noto Sans Thai และฟอนต์เอกสารอยู่ใน `styles/document-ui-fonts.css` (คอมเมนต์เท่านั้น) · ห้ามแตะ `--font-document-ui`, `--font-sarabun`, `--font-mono`, บล็อก `@font-face` TH Sarabun PSK, `@utility font-sarabun`, `:where(.voucher-sheet, …) { --font-sans: var(--font-document-ui) }`, `.tiptap.ProseMirror`
- น้ำหนัก/subset ที่ส่ง (spec §3.1–3.2):
  | ตระกูล | แอป | น้ำหนัก | subset |
  |---|---|---|---|
  | Noto Sans Thai | web-shop | 400 500 600 700 | thai latin latin-ext (12 ไฟล์) |
  | Noto Sans Thai | web | 300 400 500 600 700 | thai latin latin-ext (15) |
  | Sarabun | web-shop | 400 700 | thai latin latin-ext (6) |
  | Inter | web | 300 400 500 600 700 | latin latin-ext (10) |
  | IBM Plex Sans Thai | web | 300 400 500 600 700 | thai latin latin-ext (15) |
  | IBM Plex Mono | web | 300 400 500 600 | latin latin-ext (8) |
- ชื่อไฟล์ตาม @fontsource: `<pkg>-<subset>-<weight>-normal.woff2` ใต้ `public/fonts/<pkg>/` · ทุกโฟลเดอร์มี `OFL.txt` (= `package/LICENSE`) และ `SOURCE.json` รูป `{"package":"@fontsource/<pkg>","version":"5.3.0","license":"SIL Open Font License 1.1; see OFL.txt","files":[{"file":"…","bytes":n,"sha256":"…"}]}` (สร้างด้วยคำสั่ง shell ครั้งเดียว ไม่ commit สคริปต์)
- `@font-face` ทุกบล็อก: `font-family` · `font-style: normal` · `font-weight` · `font-display: swap` · `src: url(/fonts/<pkg>/<file>) format('woff2')` · `unicode-range` **คัดจาก `package/<weight>.css` ของ subset นั้น** (ห้ามพิมพ์เอง)
- fallback: `--font-sans: 'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif` · `--font-reading: 'Sarabun', 'Noto Sans Thai', system-ui, sans-serif`
- `index.html` ทั้งสองแอป preload ฟอนต์เพียง `/fonts/noto-sans-thai/noto-sans-thai-thai-400-normal.woff2` (+ apps/web คง preload THSarabunPSK 2 ไฟล์)
- ไม่มี `googleapis` / `gstatic` / `Looped` / `Prompt` เหลือใน `src/`, `index.html`, `public/privacy.html`, `public/terms.html` ของทั้งสองแอป · `public/design-preview-*.html` ไม่แตะ
- Firebase cache `**/*.woff2` 30 วัน immutable ⇒ ห้ามแทนที่ไฟล์ชื่อเดิม (ชื่อใหม่ไม่ชน Looped)
- ไม่เปลี่ยนสี layout คอมโพเนนต์ ขนาดตัวอักษร หรือระยะบรรทัด นอกจากที่ Task ระบุ · `leading-none` แก้เฉพาะจุดที่ภาพตรวจฟ้อง ห้าม override ทั้งแอป
- ไม่เพิ่ม dependency/สคริปต์ · ไม่รัน `npm run lint` ของ web-shop (มี `--fix` แก้ไฟล์อื่น) — ใช้ `npx eslint` ตรง ๆ
- ทำใน worktree `.claude/worktrees/typography-noto` (branch `feat/typography-noto-sans-thai`) ด้วย `git -C` หรือ path เต็ม · **ห้ามสลับ branch / รันอะไรใน checkout หลัก** (มี dev server ของ session อื่น)
- bump `version` ใน `apps/web/package.json` = ค่าใน `origin/main` +1 patch (ตอนเขียนแผน `26.11.4` → `26.11.5`; ตรวจซ้ำก่อนเปิด PR)

**Doc guard** (ต้องได้ `exit=1` = ไม่มีไฟล์ต้องห้ามใน diff):
```bash
W=/Users/iamnaii/Desktop/App/BESTCHOICE/.claude/worktrees/typography-noto
FILES=$(git -C $W diff --name-only origin/main...HEAD; git -C $W diff --name-only; git -C $W diff --name-only --cached)
echo "$FILES" | grep -E "receipt-pdf|hire-purchase-contract|document-rendering|generated-document-effects|letter-pdf|after-sales-doc-html|after-sales-pdf|voucher-html|voucher-pdf|sale-receipt-pdf|asset-receipt-pdf|expense-voucher-pdf|e-tax\.service|pdf-report|finance-share-page|rich-menu|flex-messages|\.flex\.ts|apps/api/src/assets/fonts|document-style\.ts|lib/document-fonts|pdfGenerator|DocumentStyles|DocumentPreview|StickerCard|parcelLabel|MobileReceipt|THSarabunPSK|design-preview|modules/mdm"; echo "exit=$?"
```

## Review Focus

1. **เอกสาร/สติกเกอร์/ป้ายพัสดุ/ใบเสร็จมือถือเปลี่ยนหน้าตา** หลังถอด Google Fonts — เจ้าของคาดว่าของที่พิมพ์เหมือนเดิมทุก mm (Task 4 ข้อ 7 ภาพเทียบต่อพิกเซล + `document.fonts`)
2. **ตัวเลขยอดเงินใน LIFF (`font-light`) หนาขึ้น** ถ้าลืมน้ำหนัก 300 (Task 4 เทสต์ปัก 300)
3. **หัวตาราง/ชิป/เมนูล้นหรือขึ้น 2 บรรทัด, สระบนถูกตัด** (Task 3 ข้อ 5, Task 5 ภาพก่อน/หลัง)
4. **ไฟล์ฟอนต์หาย/ชื่อไม่ตรง/sha ไม่ตรง** → fallback เงียบ (vitest ตรวจทุก `url()` + `SOURCE.json`)
5. **e2e ที่ปักชื่อ Looped แดงใน CI** (Task 4 ข้อ 5)

---

### Task 1: Mockup "เดิม vs ใหม่" — ✅ เสร็จ (เจ้าของเคาะ 2026-11-08)

canvas `https://claude.ai/artifact/3Mf9pC8wXKXjq1QZJPBfYL` (7 กระดาน: ตัวอักษรเทียบ + หน้าร้าน 3 + หลังบ้าน/LIFF 3) · ui-ux-pro-max `--domain ux` 5 คำค้นผ่าน · คำตัดสิน: เปลี่ยนเป็นไม่มีหัวทั้งสองแอป · ใช้ Sarabun บล็อกอ่านยาวหน้าร้าน · แก้ spec+plan ก่อนเริ่ม (ฉบับนี้)

---

### Task 2: web-shop — ไฟล์ฟอนต์ + fonts.css + โทเคน (TDD)

**Files:**
- Create: `apps/web-shop/public/fonts/noto-sans-thai/` (12 woff2 + `OFL.txt` + `SOURCE.json`), `apps/web-shop/public/fonts/sarabun/` (6 woff2 + `OFL.txt` + `SOURCE.json`)
- Modify: `apps/web-shop/src/styles/fonts.css` (เขียนใหม่ทั้งไฟล์), `apps/web-shop/src/styles/tokens.css:134-137` (บล็อก `--font-sans`/`--font-head`), `apps/web-shop/src/index.css:6-7` (คอมเมนต์ Looped), `apps/web-shop/index.html:38-44` (preload)
- Delete: `apps/web-shop/public/fonts/noto-sans-thai-looped/`, `apps/web-shop/public/fonts/prompt/`
- Test: `apps/web-shop/src/styles/fonts.test.ts`

**Interfaces:**
- Produces: ใน `@theme` — `--font-sans` (Noto stack) · `--font-reading` (Sarabun stack — Tailwind สร้างคลาส `font-reading` ให้เอง) · `--font-head: var(--font-sans)` คงไว้

- [ ] **Step 0: เตรียม worktree** — `npm ci` ที่ราก worktree (ยังไม่มี `node_modules`) · ถ่ายภาพ baseline ของหน้าร้านตาม Task 3 ข้อ 5 **ก่อนแก้ไฟล์แรก** เก็บใน `<scratchpad>/typo-shots/shop-before/`

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**

```ts
// apps/web-shop/src/styles/fonts.test.ts
import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const app = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(app, p), 'utf8');
const fontsCss = read('src/styles/fonts.css');
const tokensCss = read('src/styles/tokens.css');
const indexCss = read('src/index.css');
const indexHtml = read('index.html');

const faces = (css: string) =>
  css.split('@font-face').slice(1).map((b) => {
    const family = b.match(/font-family:\s*'([^']+)'/)?.[1];
    const weight = b.match(/font-weight:\s*(\d+)/)?.[1];
    const url = b.match(/url\((\/fonts\/[^)]+\.woff2)\)/)?.[1];
    return `${family}|${weight}|${url}`;
  });
const SUBSETS = ['thai', 'latin', 'latin-ext'];
const expectFaces = (family: string, pkg: string, weights: string[]) =>
  weights.flatMap((w) => SUBSETS.map((s) => `${family}|${w}|/fonts/${pkg}/${pkg}-${s}-${w}-normal.woff2`));

describe('storefront fonts', () => {
  test('sans token is Noto Sans Thai with system fallback', () => {
    expect(tokensCss).toMatch(/--font-sans:\s*'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif;/);
    expect(tokensCss).toMatch(/--font-head:\s*var\(--font-sans\);/);
  });
  test('reading token is Sarabun falling back to Noto Sans Thai', () => {
    expect(tokensCss).toMatch(/--font-reading:\s*'Sarabun', 'Noto Sans Thai', system-ui, sans-serif;/);
  });
  test('declares exactly Noto Sans Thai 400–700 and Sarabun 400/700 per subset', () => {
    const expected = [
      ...expectFaces('Noto Sans Thai', 'noto-sans-thai', ['400', '500', '600', '700']),
      ...expectFaces('Sarabun', 'sarabun', ['400', '700']),
    ];
    expect(faces(fontsCss).sort()).toEqual(expected.sort());
  });
  test('every face swaps, has a unicode-range and an existing file', () => {
    for (const b of fontsCss.split('@font-face').slice(1)) {
      expect(b).toMatch(/font-display:\s*swap/);
      expect(b).toMatch(/unicode-range:/);
      const url = b.match(/url\((\/fonts\/[^)]+\.woff2)\)/)![1];
      expect(existsSync(resolve(app, 'public', url.slice(1)))).toBe(true);
    }
  });
  test('each font folder ships OFL.txt and a SOURCE.json matching its files', () => {
    for (const dir of ['noto-sans-thai', 'sarabun']) {
      const base = resolve(app, 'public/fonts', dir);
      expect(existsSync(resolve(base, 'OFL.txt'))).toBe(true);
      const source = JSON.parse(readFileSync(resolve(base, 'SOURCE.json'), 'utf8'));
      expect(source.version).toBe('5.3.0');
      const woff = readdirSync(base).filter((f) => f.endsWith('.woff2')).sort();
      expect(source.files.map((f: { file: string }) => f.file).sort()).toEqual(woff);
      for (const f of source.files) {
        expect(createHash('sha256').update(readFileSync(resolve(base, f.file))).digest('hex')).toBe(f.sha256);
      }
    }
  });
  test('Looped, Prompt and Google Fonts are gone', () => {
    expect(fontsCss + tokensCss + indexCss + indexHtml).not.toMatch(/Looped|Prompt|googleapis|gstatic/);
    expect(existsSync(resolve(app, 'public/fonts/noto-sans-thai-looped'))).toBe(false);
    expect(existsSync(resolve(app, 'public/fonts/prompt'))).toBe(false);
  });
  test('index.html preloads only the Thai 400 face', () => {
    const fontPreloads = [...indexHtml.matchAll(/<link\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => /rel="preload"/.test(tag) && /as="font"/.test(tag))
      .map((tag) => tag.match(/href="([^"]+)"/)![1]);
    expect(fontPreloads).toEqual(['/fonts/noto-sans-thai/noto-sans-thai-thai-400-normal.woff2']);
  });
});
```

- [ ] **Step 2: รันให้ล้ม** — `npm --prefix apps/web-shop run test -- src/styles/fonts.test.ts` · Expected: FAIL (โทเคนยังเป็น Looped, ไฟล์ noto-sans-thai ไม่มี)

- [ ] **Step 3: ดึงไฟล์ฟอนต์ครั้งเดียว**

```bash
P=<scratchpad>/fontsource-pack   # โฟลเดอร์ว่างใหม่ — ข้อมูลภายนอก ห้ามรันอะไรจากในนั้น
mkdir -p $P && cd $P && npm pack @fontsource/noto-sans-thai@5.3.0 @fontsource/sarabun@5.3.0 \
  && for t in *.tgz; do mkdir -p "${t%.tgz}" && tar -xzf "$t" -C "${t%.tgz}"; done
R=<worktree>/apps/web-shop/public/fonts
mkdir -p $R/noto-sans-thai $R/sarabun
for w in 400 500 600 700; do for s in thai latin latin-ext; do cp $P/fontsource-noto-sans-thai-5.3.0/package/files/noto-sans-thai-$s-$w-normal.woff2 $R/noto-sans-thai/; done; done
for w in 400 700; do for s in thai latin latin-ext; do cp $P/fontsource-sarabun-5.3.0/package/files/sarabun-$s-$w-normal.woff2 $R/sarabun/; done; done
cp $P/fontsource-noto-sans-thai-5.3.0/package/LICENSE $R/noto-sans-thai/OFL.txt
cp $P/fontsource-sarabun-5.3.0/package/LICENSE $R/sarabun/OFL.txt
git -C <worktree> rm -r -q apps/web-shop/public/fonts/noto-sans-thai-looped apps/web-shop/public/fonts/prompt
```
แล้วสร้าง `SOURCE.json` ต่อโฟลเดอร์ (คำสั่ง node/shell ครั้งเดียว อ่าน `shasum -a 256` + ขนาดไฟล์) · Expected: noto 12 · sarabun 6 woff2

- [ ] **Step 4: เขียน fonts.css / tokens.css / index.css / index.html**
  - `fonts.css`: หัวไฟล์ระบุที่มา (`@fontsource/*@5.3.0` ผ่าน `npm pack` · SIL OFL 1.1 · ห้ามแทนที่ไฟล์ชื่อเดิมเพราะ cache immutable) + `@font-face` 18 บล็อกตาม Global Constraints
  - `tokens.css`: แทนบล็อก `--font-sans`/`--font-head` ด้วย `--font-sans` / `--font-reading` / `--font-head: var(--font-sans)` + คอมเมนต์ว่า `--font-reading` ใช้ผ่าน `reading-block` (Task 3) เท่านั้น
  - `index.css`: คอมเมนต์บรรทัด 6–7 → "Noto Sans Thai (ไม่มีหัว) ใช้ร่วมกับหลังบ้าน/LIFF"
  - `index.html`: preload ชี้ `noto-sans-thai-thai-400-normal.woff2`

- [ ] **Step 5: เทสต์ผ่าน + build** — `npm --prefix apps/web-shop run test -- src/styles/fonts.test.ts && npm --prefix apps/web-shop run build` · Expected: PASS 7 เทสต์ · build ผ่าน · `grep -rlE "Looped|Prompt|googleapis" apps/web-shop/dist/assets/*.css apps/web-shop/dist/index.html` ไม่พบ

- [ ] **Step 6: Doc guard → `exit=1` แล้ว commit**

```bash
git -C <worktree> add apps/web-shop/public/fonts apps/web-shop/src/styles apps/web-shop/src/index.css apps/web-shop/index.html
git -C <worktree> commit -m "feat(web-shop): self-host Noto Sans Thai + Sarabun, retire Looped/Prompt files"
```

---

### Task 3: web-shop — บล็อกอ่านยาวเป็น Sarabun + wordmark

**Files:**
- Modify: `apps/web-shop/src/index.css` (เพิ่ม `@utility reading-block`)
- Modify: `apps/web-shop/src/components/layout/ShopHeader.tsx:85`, `ShopFooter.tsx:38` (`font-extrabold` → `font-bold`)
- Modify (ครอบ container ของย่อหน้าด้วย `reading-block` ไม่ครอบหัว section/ปุ่ม): `components/shop/FaqAccordion.tsx` (ตัวคำตอบ — ครอบทุก FAQ ทีเดียว), `pages/HowItWorksPage.tsx` (คำอธิบายขั้นตอน), `pages/InstallmentTermsPage.tsx`, `pages/ReturnsPage.tsx`, `pages/ShippingPage.tsx`, `pages/AboutPage.tsx`, `pages/landing/{InstallmentLopburiPage,NoCreditCardPage,UsedIphoneLopburiPage}.tsx` (เฉพาะย่อหน้าอธิบาย), `pages/ProductDetailPage.tsx` (บล็อกคำอธิบายสินค้าแบบย่อหน้า ถ้ามี)
- **ไม่แตะ**: body line-height 1.7, `.font-brand` letter-spacing, ขนาด hero (spec §3.5 ข้อ 1)
- Test: `apps/web-shop/src/styles/typography-utilities.test.ts`

**Interfaces:**
- Consumes: `--font-reading` จาก Task 2
- Produces: `@utility reading-block { font-family: var(--font-reading); font-size: 1rem; line-height: 1.75; & :is(h2, h3) { font-family: var(--font-reading); font-weight: 700; } & h3 { font-size: 1.125rem; } & :is(button, [role='button'], .btn, a) { font-family: var(--font-sans); } }` — ชื่อห้ามเป็น `font-reading` (ชนคลาสที่ Tailwind สร้างจากโทเคน)

- [ ] **Step 1: เทสต์ที่ล้ม**

```ts
// apps/web-shop/src/styles/typography-utilities.test.ts
import { expect, test } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const app = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(app, p), 'utf8');
const css = read('src/index.css');

test('reading-block is a Tailwind @utility that keeps controls in the UI face', () => {
  const block = css.match(/@utility reading-block\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  expect(block).toMatch(/font-family:\s*var\(--font-reading\)/);
  expect(block).toMatch(/line-height:\s*1\.75/);
  expect(block).toMatch(/& :is\(button, \[role='button'\], \.btn, a\)\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
  expect(css).not.toMatch(/\.font-reading\s*\{/);
});
test('long-form surfaces use reading-block', () => {
  for (const f of [
    'src/components/shop/FaqAccordion.tsx', 'src/pages/HowItWorksPage.tsx', 'src/pages/InstallmentTermsPage.tsx',
    'src/pages/ReturnsPage.tsx', 'src/pages/ShippingPage.tsx', 'src/pages/AboutPage.tsx',
    'src/pages/landing/InstallmentLopburiPage.tsx', 'src/pages/landing/NoCreditCardPage.tsx', 'src/pages/landing/UsedIphoneLopburiPage.tsx',
  ]) expect(read(f), f).toMatch(/\breading-block\b/);
});
test('no 800 weight, tight tracking, Looped or Prompt remains in storefront src', () => {
  const out = execSync("grep -rlE 'font-extrabold|tracking-tight|Looped|Prompt' src --include='*.tsx' --include='*.ts' --include='*.css' || true", { cwd: app }).toString().trim();
  expect(out).toBe('');
});
```
(ถ้า `ProductDetailPage.tsx` มีบล็อกคำอธิบายแบบย่อหน้า ให้เพิ่มเข้า list ด้วย)

- [ ] **Step 2: รันให้ล้ม** — Expected: FAIL 3 เทสต์

- [ ] **Step 3: แก้ CSS + tsx** ตาม Files/Interfaces

- [ ] **Step 4: เทสต์ทั้งแอป + lint** — `npm --prefix apps/web-shop run test && (cd apps/web-shop && npx eslint "src/**/*.{ts,tsx}")` · Expected: PASS ทั้งหมด (รวม `FaqAccordion.test.tsx` เดิม) · 0 lint error

- [ ] **Step 5: ภาพตรวจ 390/1280 ของ 6 หน้า** (home, catalog, product detail, how-it-works, installment terms, sell) — `vite preview` ของ worktree (พอร์ตที่ไม่ชน เช่น 5280) + Playwright จาก `node_modules` ของ worktree (ห้าม `chrome --headless` ซ้อน instance) · หน้าที่ต้องใช้ข้อมูลสินค้าให้ `page.route('**/api/**')` ตอบ fixture JSON ขั้นต่ำ (ไม่มี mock server ใน repo) · เทียบกับ `shop-before/` จาก Task 2 Step 0 — Expected: ไม่มีสระบนถูกตัด · hero/การ์ดไม่ล้น · ราคาเลขตรงหลัก · บล็อก Sarabun 16px อ่านออก · `leading-none` 2 จุด (ตัวเลข 5.0 / 33,000+) ไม่ต้องแก้ถ้าภาพไม่ฟ้อง · เก็บภาพใน scratchpad แนบ PR

- [ ] **Step 6: Doc guard → `exit=1` แล้ว commit** — `git -C <worktree> commit -am "feat(web-shop): Sarabun reading blocks, bold wordmark for Noto Sans Thai"`

---

### Task 4: apps/web — Noto Sans Thai + ย้ายฟอนต์เอกสารจาก Google มา self-host (TDD)

**Files:**
- Create: `apps/web/public/fonts/noto-sans-thai/` (15 woff2 + `OFL.txt` + `SOURCE.json` + `fonts.css` สำหรับหน้าคงที่), `apps/web/public/fonts/inter/` (10), `apps/web/public/fonts/ibm-plex-sans-thai/` (15), `apps/web/public/fonts/ibm-plex-mono/` (8) — ทุกโฟลเดอร์มี `OFL.txt` + `SOURCE.json`
- Create: `apps/web/src/styles/document-ui-fonts.css` (Inter 10 + IBM Plex Sans Thai 15 + IBM Plex Mono 8 = 33 บล็อก · หัวไฟล์: "ฟอนต์เอกสาร/สติกเกอร์/ป้ายพัสดุ/Tiptap — ย้ายจาก Google Fonts 2026-11-08 · น้ำหนักเท่าที่ Google import เคยขอ · ห้ามเปลี่ยนหน้าตา")
- Modify: `apps/web/src/styles/fonts.css` (เขียนใหม่: Noto Sans Thai 15 บล็อก), `apps/web/src/index.css` (ลบบรรทัด 1–3 · เพิ่ม `@import './styles/document-ui-fonts.css';` ใต้ `@import './styles/fonts.css';` · `--font-sans`), `apps/web/index.html:19` (preload) และ `:28` (font stack ของ "กำลังโหลด..." → `'Noto Sans Thai',system-ui,-apple-system,sans-serif`), `apps/web/public/privacy.html:16-17,105` และ `apps/web/public/terms.html:16-17,47` (ชี้ `/fonts/noto-sans-thai/fonts.css` + preload + family)
- Modify (e2e ที่ปักชื่อ Looped — 6 จุด): `apps/api/e2e/documents/uxui-pages.browser.docs-spec.ts:153-154`, `apps/api/e2e/ui-fields/{fields.audit-spec.ts:109,po-filters.audit-spec.ts:81,report-controls.audit-spec.ts:35,reports-data.audit-spec.ts:57,shared-controls.audit-spec.ts:57}`
- Modify: `.claude/rules/frontend.md:49` (บรรทัด Font → "Noto Sans Thai (ไม่มีหัว) ใน UI ทั้งระบบ · Sarabun เฉพาะ `reading-block` หน้าร้าน · เอกสาร/พิมพ์/สติกเกอร์/Tiptap คงฟอนต์เอกสารเดิม (คำสั่งเจ้าของ 2026-11-08)")
- Delete: `apps/web/public/fonts/noto-sans-thai-looped/`
- **ห้ามแตะ**: ทุกไฟล์ใน spec §4 รวม `StickerCard.tsx`, `parcelLabel.ts` (fallback `'Noto Sans Thai Looped'` ในไฟล์นั้นคงไว้ — IBM Plex Sans Thai ที่ self-host แล้วยังเป็นตัวแรก), `StickerPrintPage/index.tsx`, `RichTextEditor.tsx` (ไม่ต้อง import อะไร — `document-ui-fonts.css` โหลดทั้งแอป)
- Test: `apps/web/src/styles/fonts.test.ts`

**Interfaces:**
- Produces: `--font-sans: 'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif` · `--font-document-ui` / `--font-mono` / `--font-sarabun` ค่าเดิมทุกตัวอักษร

- [ ] **Step 0: ภาพ baseline ก่อนแก้ไฟล์แรก (origin/main ของ apps/web = HEAD ตอนนี้)** — รัน dev ของ worktree ที่พอร์ตแยก (เช่น `npx vite --port 5280` ใน `apps/web`) โดยใช้ API ที่รันอยู่แล้วที่ `:3000` (ตรวจ `curl -s localhost:3000/health`; ถ้าไม่รันให้หยุดถามเจ้าของ — ห้ามไปสตาร์ทใน checkout หลัก) · login บัญชี dev · ถ่าย 1280 + 390 เก็บ `<scratchpad>/typo-shots/web-before/`:
  - **ชุดเอกสาร** (ต้องเหมือนเดิมหลังแก้): `/stickers` (เลือกสินค้าให้เห็นสติกเกอร์), หน้าแก้แม่แบบสัญญา (preview `.template-paper` + Tiptap), หน้าป้ายพัสดุ, ใบเสร็จมือถือ (`MobileReceipt`), dialog พิมพ์เอกสาร (`.document-print-dialog`), voucher รับซื้อ — พร้อมผล `[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family+' '+f.weight)` ต่อหน้า
  - **ชุด UI** (ใช้ใน Task 5): `/` `/customers` `/contracts/:id` `/stock` `/payments` `/pos` และ LIFF `/liff/contract` `/liff/early-payoff` `/liff/history` (ตัวเลข `font-light`)

- [ ] **Step 1: เทสต์ที่ล้ม**

```ts
// apps/web/src/styles/fonts.test.ts
import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const app = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(app, p), 'utf8');
const indexCss = read('src/index.css');
const fontsCss = read('src/styles/fonts.css');
const docFontsCss = read('src/styles/document-ui-fonts.css');
const indexHtml = read('index.html');
const staticPages = read('public/privacy.html') + read('public/terms.html');

const faces = (css: string) =>
  css.split('@font-face').slice(1).map((b) => {
    const family = b.match(/font-family:\s*'([^']+)'/)?.[1];
    const weight = b.match(/font-weight:\s*(\d+)/)?.[1];
    const url = b.match(/url\((\/fonts\/[^)]+\.woff2)\)/)?.[1];
    return `${family}|${weight}|${url}`;
  });
const expectFaces = (family: string, pkg: string, weights: string[], subsets: string[]) =>
  weights.flatMap((w) => subsets.map((s) => `${family}|${w}|/fonts/${pkg}/${pkg}-${s}-${w}-normal.woff2`));
const W5 = ['300', '400', '500', '600', '700'];

describe('admin app fonts', () => {
  test('no Google Fonts, Looped or Prompt remains in the app bundle and static pages', () => {
    expect(indexCss + fontsCss + docFontsCss + indexHtml + staticPages).not.toMatch(/googleapis|gstatic|Looped|Prompt/);
    expect(existsSync(resolve(app, 'public/fonts/noto-sans-thai-looped'))).toBe(false);
  });
  test('index.css imports the UI faces then the document faces', () => {
    expect(indexCss).toMatch(/@import '\.\/styles\/fonts\.css';\s*\n@import '\.\/styles\/document-ui-fonts\.css';/);
  });
  test('UI face is Noto Sans Thai 300–700 (300 keeps LIFF light amounts)', () => {
    expect(indexCss).toMatch(/--font-sans:\s*'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif;/);
    expect(faces(fontsCss).sort()).toEqual(expectFaces('Noto Sans Thai', 'noto-sans-thai', W5, ['thai', 'latin', 'latin-ext']).sort());
  });
  test('document faces are unchanged (owner rule 2026-11-08)', () => {
    expect(indexCss).toMatch(/--font-document-ui:\s*'Inter', 'IBM Plex Sans Thai', system-ui, -apple-system, sans-serif;/);
    expect(indexCss).toMatch(/--font-sarabun:\s*'TH Sarabun PSK', sans-serif;/);
    expect(indexCss).toMatch(/--font-mono:\s*'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;/);
    expect(indexCss).toMatch(/font-family:\s*'TH Sarabun PSK';\s*src:\s*url\('\/fonts\/THSarabunPSK-Regular\.ttf'\)/);
    expect(indexCss).toMatch(/font-family:\s*'TH Sarabun PSK';\s*src:\s*url\('\/fonts\/THSarabunPSK-Bold\.ttf'\)/);
    expect(indexCss).toMatch(/\.sticker, \.print-stickers, \.tiptap\) \{\s*--font-sans: var\(--font-document-ui\);\s*font-family: var\(--font-document-ui\);/);
    expect(indexCss).toMatch(/\.tiptap\.ProseMirror\s*\{[^}]*font-family:\s*'IBM Plex Sans Thai', sans-serif/);
    expect(indexHtml).toMatch(/href="\/fonts\/THSarabunPSK-Regular\.ttf"/);
    expect(indexHtml).toMatch(/href="\/fonts\/THSarabunPSK-Bold\.ttf"/);
  });
  test('document faces are self-hosted at the weights the Google import requested', () => {
    expect(faces(docFontsCss).sort()).toEqual([
      ...expectFaces('Inter', 'inter', W5, ['latin', 'latin-ext']),
      ...expectFaces('IBM Plex Sans Thai', 'ibm-plex-sans-thai', W5, ['thai', 'latin', 'latin-ext']),
      ...expectFaces('IBM Plex Mono', 'ibm-plex-mono', ['300', '400', '500', '600'], ['latin', 'latin-ext']),
    ].sort());
  });
  test('every face swaps, has a unicode-range and an existing file', () => {
    for (const b of (fontsCss + docFontsCss).split('@font-face').slice(1)) {
      expect(b).toMatch(/font-display:\s*swap/);
      expect(b).toMatch(/unicode-range:/);
      const url = b.match(/url\((\/fonts\/[^)]+\.woff2)\)/)![1];
      expect(existsSync(resolve(app, 'public', url.slice(1))), url).toBe(true);
    }
  });
  test('each font folder ships OFL.txt and a SOURCE.json matching its files', () => {
    for (const dir of ['noto-sans-thai', 'inter', 'ibm-plex-sans-thai', 'ibm-plex-mono']) {
      const base = resolve(app, 'public/fonts', dir);
      expect(existsSync(resolve(base, 'OFL.txt')), dir).toBe(true);
      const source = JSON.parse(readFileSync(resolve(base, 'SOURCE.json'), 'utf8'));
      const woff = readdirSync(base).filter((f) => f.endsWith('.woff2')).sort();
      expect(source.files.map((f: { file: string }) => f.file).sort()).toEqual(woff);
      for (const f of source.files) {
        expect(createHash('sha256').update(readFileSync(resolve(base, f.file))).digest('hex')).toBe(f.sha256);
      }
    }
  });
  test('index.html preloads the Noto Thai 400 face and no Looped file', () => {
    expect(indexHtml).toMatch(/href="\/fonts\/noto-sans-thai\/noto-sans-thai-thai-400-normal\.woff2"[^>]*as="font"/);
  });
});
```

- [ ] **Step 2: รันให้ล้ม** — `npm --prefix apps/web run test -- src/styles/fonts.test.ts` · Expected: FAIL (document-ui-fonts.css ไม่มี — readFileSync throw ถือว่าล้ม)

- [ ] **Step 3: ดึงไฟล์** — วิธีเดียวกับ Task 2 Step 3 (เพิ่ม `@fontsource/inter@5.3.0 @fontsource/ibm-plex-sans-thai@5.3.0 @fontsource/ibm-plex-mono@5.3.0`) ตามตารางน้ำหนัก/subset · `OFL.txt` + `SOURCE.json` ทุกโฟลเดอร์ · `git rm -r` โฟลเดอร์ Looped

- [ ] **Step 4: เขียนไฟล์** ตาม Files · `public/fonts/noto-sans-thai/fonts.css` = เนื้อเดียวกับ `src/styles/fonts.css` (หน้า privacy/terms อ่านไฟล์นี้)

- [ ] **Step 5: แก้ e2e ที่ปักชื่อ Looped** — ทุกจุดเปลี่ยนเป็นตรวจว่า family แรกคือ `Noto Sans Thai` และไม่ใช่ Looped:
  - เงื่อนไข computed font: `/^["']?Noto Sans Thai["']?,/.test(fontFamily)` (แทน `.includes('Noto Sans Thai Looped')`)
  - `expect(field.font).toMatch(/^["']?Noto Sans Thai["']?,/)` (แทน `toContain('Noto Sans Thai Looped')`)
  - `document.fonts`: `f.family.replace(/["']/g, '') === 'Noto Sans Thai'`
  - ตรวจ: `git -C <worktree> grep -n "Looped" -- apps ':!apps/web/src/pages/ParcelLabelPage/parcelLabel.ts'` → ไม่พบ

- [ ] **Step 6: เทสต์ + type-check** — `npm --prefix apps/web run test -- src/styles/fonts.test.ts && (cd <worktree> && ./tools/check-types.sh web)` · Expected: PASS 8 เทสต์ · 0 TS errors

- [ ] **Step 7: พิสูจน์เอกสารไม่เปลี่ยน** — ถ่ายชุดเอกสารจาก Step 0 ซ้ำ (หน้า ข้อมูล ขนาดหน้าต่างเดียวกัน) แล้วเทียบต่อพิกเซล (`pixelmatch`/Playwright `toMatchSnapshot` ใน scratchpad, threshold 0; mask เฉพาะเวลา/วันที่ที่เปลี่ยนเอง) + เทียบผล `document.fonts` — Expected: **0 พิกเซลต่าง** ทุกหน้า · `/stickers` โหลด `IBM Plex Sans Thai` (+ `IBM Plex Mono`) · preview มี `TH Sarabun PSK` · Network ไม่มีคำขอ `fonts.googleapis.com`/`fonts.gstatic.com` · **ถ้าต่าง**: หยุด รายงานพร้อมภาพ แล้วเสนอใช้ไฟล์ที่ Google เสิร์ฟจริงแบบ PR #1700 สำหรับตระกูลนั้น (spec §5) — ห้ามแก้ CSS เอกสารให้ "ตรง"

- [ ] **Step 8: Doc guard → `exit=1` แล้ว commit**

```bash
git -C <worktree> add apps/web/public/fonts apps/web/public/privacy.html apps/web/public/terms.html apps/web/src/styles apps/web/src/index.css apps/web/index.html apps/api/e2e .claude/rules/frontend.md
git -C <worktree> commit -m "feat(web): Noto Sans Thai UI, self-host document faces (Inter/IBM Plex) unchanged"
```

---

### Task 5: apps/web — ภาพตรวจ UI แล้วปรับเท่าที่ภาพฟ้อง + bump version

**Files:**
- Modify: `apps/web/src/styles/admin-typography.css` (เพิ่มกติกาเดียวใต้ `body:has(.app-shell) {` ในรูปเดียวกับกติกาอื่น: `& :is(.tracking-tight, .tracking-tighter):not(:where(<รายการยกเว้นเอกสารชุดเดียวกับกติกาแรกของไฟล์ ทุกตัวอักษร>)) { letter-spacing: normal; }` — **ไม่มี** override `leading-none`)
- Modify (เฉพาะที่ภาพขั้น 1 ฟ้อง): tsx รายจุด `leading-none` → `leading-tight` · `apps/web/src/index.css` `--text-*--line-height` (ถ้าหัวข้อตัดสระ — ระบุค่าที่ใช้ในเทสต์ด้วย)
- Modify: `apps/web/package.json:3` (`version` = `origin/main` +1 patch)
- Test: `apps/web/src/styles/admin-typography.test.ts`

- [ ] **Step 1: ภาพ "หลังเปลี่ยนฟอนต์ ก่อนจูน"** — ชุด UI เดียวกับ Task 4 Step 0 → `<scratchpad>/typo-shots/web-after4/` เทียบกับ `web-before/` · จดจุดที่ (ก) สระบน/วรรณยุกต์ถูกตัด (ข) หัวตาราง/ชิป/เมนูขึ้น 2 บรรทัดที่ 1440 (งบความกว้าง sidebar 292px) (ค) ตัวเลข LIFF `font-light` หนาผิด — พร้อมไฟล์:บรรทัดของคลาสที่ทำให้เกิด · ไม่มีจุดฟ้อง = ไม่แก้ tsx/line-height

- [ ] **Step 2: เทสต์ที่ล้ม**

```ts
// apps/web/src/styles/admin-typography.test.ts
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const css = readFileSync(resolve(__dirname, 'admin-typography.css'), 'utf8');
const docGuard = css.match(/:not\(:where\(([^)]*)\)\)/)![1]; // รายการยกเว้นเอกสารของกติกาแรกในไฟล์

test('tight tracking is neutralised on screen UI only, with the same document exclusions', () => {
  const start = css.indexOf('body:has(.app-shell) {');
  const m = css.match(/& :is\(\.tracking-tight, \.tracking-tighter\):not\(:where\(([^)]*)\)\)\s*\{([^}]*)\}/);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(m).not.toBeNull();
  expect(css.indexOf(m![0])).toBeGreaterThan(start);
  expect(m![1]).toBe(docGuard);
  expect(docGuard).toContain('.template-paper');
  expect(docGuard).toContain('.sticker');
  expect(docGuard).toContain('.tiptap');
  expect(m![2]).toMatch(/letter-spacing:\s*normal/);
});
test('no blanket leading-none override exists', () => {
  expect(css).not.toMatch(/\.leading-none/);
});
```
(ถ้า Step 1 ทำให้ต้องเปลี่ยน `--text-*--line-height` ให้เพิ่มเทสต์ปักค่าที่เลือก)

- [ ] **Step 3: รันให้ล้ม** — `npm --prefix apps/web run test -- src/styles/admin-typography.test.ts` · Expected: FAIL เทสต์แรก

- [ ] **Step 4: แก้ CSS + จุดที่ภาพฟ้อง + version** — `version`: `git -C <worktree> show origin/main:apps/web/package.json | grep '"version"'` แล้ว +1 patch

- [ ] **Step 5: เทสต์ทั้งแอป + type-check** — `npm --prefix apps/web run test && (cd <worktree> && ./tools/check-types.sh all)` · Expected: PASS · 0 errors (ล้ม = รายงานพร้อม output ห้ามบอกว่าเสร็จ)

- [ ] **Step 6: ภาพ "หลังจูน"** — ชุดเดิม → `web-after5/` · Expected: รายการจาก Step 1 หายครบ ไม่มีจุดใหม่ · ชุดเอกสารยังเท่ากับ `web-before/` 0 พิกเซล · เก็บภาพก่อน/หลังแนบ PR

- [ ] **Step 7: Doc guard → `exit=1` แล้ว commit** — `git -C <worktree> commit -am "feat(web): neutralise tight tracking on screen for Noto Sans Thai; bump version"`

---

### Task 6: Skill `bestchoice-typography` (ตาม superpowers:writing-skills) + PR

**Files:**
- Create: `.claude/skills/bestchoice-typography/SKILL.md`
- Modify: `.claude/CLAUDE.md` ตาราง Agent Skills (เพิ่มแถว `/bestchoice-typography`) และบรรทัด Theme `IBM Plex Sans Thai font` → `Noto Sans Thai font`

- [ ] **Step 1: RED — baseline ไม่มี skill** — subagent (general-purpose, sonnet) ตอบ 3 ข้อโดยไม่ให้ skill: "(1) คอมโพเนนต์ใหม่ใน apps/web-shop ที่แสดงเงื่อนไขผ่อนแบบย่อหน้ายาว ใช้ฟอนต์/คลาสอะไร (2) KPI ตัวเลขใน apps/web ใช้ font-family อะไร ต้อง tabular ไหม (3) จะแก้ฟอนต์ของใบเสร็จ PDF หรือสติกเกอร์ให้เป็น Noto Sans Thai ได้ไหม" · บันทึก verbatim ลง `<scratchpad>/skill-test/baseline.md`

- [ ] **Step 2: GREEN — เขียน SKILL.md** (<400 คำ) · frontmatter `name: bestchoice-typography` · `description: Use when adding or restyling any on-screen text in BESTCHOICE apps/web or apps/web-shop (font family, weight, size, line-height, long-form reading blocks), when Thai text looks clipped or wrapped, or when asked to change fonts of receipts, contracts, letters, stickers or other documents` · เนื้อหา: ตารางบทบาท (Noto Sans Thai ไม่มีหัว UI · Sarabun `reading-block` web-shop เท่านั้น · ตาราง spec §2.1 ฟอนต์เอกสารห้ามแตะ + รายชื่อไฟล์ spec §4) · ขนาดต่อส่วนย่อจาก spec §3.3/3.4 · Common mistakes (Looped · `tracking-tight` · `leading-none` · `font-extrabold` = แสดง 700 · Sarabun ในตาราง/ปุ่ม · Google Fonts · ถอด Inter/IBM Plex เพราะคิดว่าไม่ใช้) · วิธีเพิ่มน้ำหนัก = `npm pack @fontsource/<pkg>@5.3.0` แล้ว cp ไฟล์ใหม่ + อัปเดต `SOURCE.json` (ห้ามแทนที่ไฟล์ชื่อเดิม)

- [ ] **Step 3: GREEN — ถามซ้ำกับ subagent ที่ได้ skill** — Expected: (1) `reading-block` Sarabun 400/16 (2) Noto Sans Thai + `tabular-nums` (3) ปฏิเสธ อ้างคำสั่งเจ้าของ 2026-11-08 · ข้อใดไม่ผ่าน แก้ skill แล้วถามซ้ำเฉพาะข้อนั้น

- [ ] **Step 4: Doc guard → `exit=1` · commit · push · PR**
  - `git -C <worktree> add .claude/skills/bestchoice-typography .claude/CLAUDE.md && git -C <worktree> commit -m "docs: add bestchoice-typography skill"`
  - ตรวจ `git -C <worktree> status -sb` (บรรทัดแรกต้องเป็น `feat/typography-noto-sans-thai`) → `git -C <worktree> push -u origin feat/typography-noto-sans-thai`
  - `gh pr create --base main` หัวข้อ "Typography: Noto Sans Thai + Sarabun (web, web-shop) — documents untouched" · body: สรุป spec §3.1 + ลิงก์ canvas + ภาพก่อน/หลัง + ผลเทียบเอกสาร 0 พิกเซล + "เอกสารถึงลูกค้าไม่เปลี่ยน (owner 2026-11-08)" + attribution
  - ผล `gh pr checks` เก็บลงตัวแปรก่อนตรวจ (กับดัก pipefail) · **ห้าม merge/deploy เอง** — รอเจ้าของ
