# Typography Noto Sans Thai + Sarabun Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปลี่ยนฟอนต์ UI ของ `apps/web-shop` (bestchoicephone.com) และ `apps/web` (bestchoicephone.app + LIFF) เป็น Noto Sans Thai ทั้งหมด + Sarabun สำหรับบล็อกอ่านยาวบนหน้าร้าน ตามแบบ heygoody.com โดยไม่แตะเอกสารถึงลูกค้า

**Architecture:** ฟอนต์ self-host เป็น woff2 ใน `public/fonts/<family>/` ของแต่ละแอป (คัดลอกจาก `@fontsource/*` ผ่าน `npm pack` ครั้งเดียวแล้ว commit — ไม่มีสคริปต์/dependency) ประกาศ `@font-face` ต่อ subset ใน `src/styles/fonts.css`; โทเคน `--font-sans` / `--font-reading` เปลี่ยนที่เดียวแล้วไหลผ่าน Tailwind v4 `@theme` ไปทุกคอมโพเนนต์. เอกสารพิมพ์/เอกสารถึงลูกค้าถูกกันด้วย guard เดิมใน `admin-typography.css` และเทสต์ปัก.

**Tech Stack:** Vite 6 · Tailwind CSS v4 (`@theme`) · vitest · Playwright (ภาพตรวจ) · `@fontsource/noto-sans-thai@5.3.0` `@fontsource/sarabun@5.3.0` `@fontsource/ibm-plex-sans-thai@5.3.0` `@fontsource/ibm-plex-mono@5.3.0`

**Spec:** `docs/superpowers/specs/2026-11-08-typography-noto-sans-thai-design.md`

## Global Constraints

- **ห้ามแก้ไฟล์เอกสารถึงลูกค้า** (spec §4): `receipt-pdf.service.ts`, `hire-purchase-contract.html`, `document-rendering.service.ts`, `letter-pdf.service.ts`, `after-sales-doc-html.ts`, `voucher-html.builder.ts`, `finance-share-page.util.ts`, `rich-menu/templates/base-html.ts`, `pdfGenerator.ts`, `document-fonts.ts`, `StickerCard.tsx`, Flex messages — diff ของ PR ต้องไม่มีไฟล์เหล่านี้
- `--font-sarabun: 'TH Sarabun PSK', sans-serif` และ `@font-face` TH Sarabun PSK ใน `apps/web/src/index.css` คงเดิมทุกตัวอักษร
- ไม่มีคำขอไป `fonts.googleapis.com` / `fonts.gstatic.com` เหลือในทั้งสองแอป
- น้ำหนักที่ส่ง: Noto Sans Thai 400/500/600/700 · Sarabun 400/700 · IBM Plex Sans Thai 400/500/600/700 (เฉพาะ `/stickers` + Tiptap) · IBM Plex Mono 400/500/600
- fallback stack: `'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif` · `--font-reading: 'Sarabun', 'Noto Sans Thai', system-ui, sans-serif`
- ทุก `@font-face` มี `font-display: swap` และ `unicode-range` ต่อ subset (thai: `U+02D7, U+0303, U+0331, U+0E01-0E5B, U+200C-200D, U+25CC`)
- `index.html` preload เฉพาะ `/fonts/noto-sans-thai/noto-sans-thai-thai-400-normal.woff2`
- ไม่เปลี่ยนสี layout คอมโพเนนต์ หรือโทเคนอื่นนอกจากที่ spec §3.5 ระบุ · `leading-none` แก้เฉพาะจุดที่ภาพตรวจฟ้อง ห้ามใส่ override ทั้งแอป
- ไฟล์ฟอนต์ cache 30 วันแบบ immutable บน Firebase (`firebase.json` `**/*.woff2`) ⇒ ห้ามแทนที่ไฟล์ชื่อเดิม ถ้าเปลี่ยนไฟล์ต้องตั้งชื่อใหม่
- ไม่เพิ่ม dependency/สคริปต์เพื่อจัดการฟอนต์ — คัดลอกไฟล์จาก `npm pack` ครั้งเดียวแล้ว commit (แบบเดียวกับ Prompt ใน PR #1657)
- bump `version` ใน `apps/web/package.json` ก่อน merge — อ่านค่าปัจจุบันจาก `origin/main` แล้ว +1 patch (checkout หลักอยู่ branch เก่า ตัวเลขในนั้นใช้ไม่ได้)
- งาน UI ต้องมี mockup ให้เจ้าของเคาะก่อนแตะโค้ด (Task 1 เป็นด่าน) — ห้ามเริ่ม Task 2 ก่อนเจ้าของตอบ
- ทำบน worktree แยก (`superpowers:using-git-worktrees`) จาก `origin/main`; checkout หลักมี dev server ของ session อื่น ห้ามสลับ branch

## Review Focus

1. **หัวตาราง/ชิปสถานะ/เมนู sidebar ล้นหรือขึ้น 2 บรรทัด** เพราะ Noto Sans Thai สูงกว่า IBM Plex — ผู้ใช้คาดว่าตารางที่เคยพอดีจอ 1440 ยังพอดี (ภาพตรวจ Task 5 ข้อ 3 ปัก)
2. **สระบน/วรรณยุกต์ถูกตัด** ในองค์ประกอบที่ยังมี `leading-none`/`tracking-tight` — ผู้ใช้คาดว่า "ปุ่ม" "ชื่อลูกค้า" อ่านครบ (Task 5 ข้อ 2 ปักกติกา override + ภาพ)
3. **ไฟล์ฟอนต์หาย/ชื่อไม่ตรง** → เบราว์เซอร์ fallback เงียบเป็น Tahoma/system — ผู้ใช้คาดว่าทุกเครื่องเห็นฟอนต์เดียวกัน (vitest ใน Task 2/4 ตรวจทุก `url()`)
4. **สติกเกอร์และ preview เอกสารเปลี่ยนหน้าตา** หลังถอด Google Fonts — เจ้าของคาดว่าของที่พิมพ์เหมือนเดิมทุก mm (Task 4 ข้อ 6 ปักว่า IBM Plex Sans Thai ยังโหลดบน `/stickers`, TH Sarabun PSK ไม่ถูกแตะ)
5. **prerender/LIFF โหลดฟอนต์จาก path ผิดฐาน** (เช่น `/liff/...` หรือ route ซ้อน) — path ต้องเป็น absolute `/fonts/...` ไม่ใช่ relative (เทสต์ใน Task 2/4 ปักรูปแบบ `url(/fonts/`)

---

### Task 1: Mockup "เดิม vs ใหม่" + ตรวจ ui-ux-pro-max — ด่านเจ้าของเคาะ

**Files:**
- Create: `<scratchpad>/typography-mockup/project/canvas.json`, `<scratchpad>/typography-mockup/project/*.dc.html` (design canvas 6 กระดาน)
- Reference: `apps/web-shop/src/styles/tokens.css`, `apps/web/src/index.css` (ลอกโทเคนสีจริง)

**Interfaces:**
- Consumes: spec §3.3–3.5
- Produces: artifact URL ของ design canvas + คำตอบเจ้าของ (เคาะ / แก้) — Task 2 ขึ้นไปห้ามเริ่มก่อนได้คำตอบ · **Task นี้ทำใน session หลักเท่านั้น ไม่ส่งให้ subagent** (ด่านหยุดรอต้องอยู่กับคนที่คุยกับเจ้าของ)

- [ ] **Step 1: โหลดฟอนต์ให้กระดาน mockup**

ใน `.dc.html` ทุกกระดาน ใส่ `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&family=Sarabun:wght@400;700&family=Prompt:wght@400;500;600;700;800&family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap">` (mockup เท่านั้น — โค้ดจริง self-host)

- [ ] **Step 2: กระดาน web-shop 3 แผ่น (กว้าง 1298) แต่ละแผ่นแบ่งซ้าย "เดิม Prompt" ขวา "ใหม่ Noto Sans Thai"**

1. หน้าแรก: header nav · hero h1+ตัวรอง · การ์ดสินค้า 3 ใบ (ชื่อรุ่น 700/18, ราคา `.num` 700/24, meta 400/14, ป้าย 700/12) · ปุ่ม CTA
2. หน้ารายละเอียดสินค้า: ราคาใหญ่ · spec rows · บล็อกคำอธิบายสินค้าแบบย่อหน้าเป็น **Sarabun 400/16 lh 1.75** · การ์ดเงินดาวน์
3. how-it-works / เงื่อนไขผ่อน: หัว section Noto 700/30 · เนื้อหา Sarabun · FAQ accordion
ใช้สีจริง: primary `#167F5E` · ink `#0F5F44` · muted `#E8FAF4` · border `#DCE7E3` · พื้นขาว. ใส่ sticky note ต่อกระดาน: ขนาด/น้ำหนักที่ใช้ และเหตุผล (hero 800→700 ชดเชยด้วยขนาด)

- [ ] **Step 3: กระดาน apps/web 3 แผ่น ซ้าย "เดิม IBM Plex Sans Thai + Inter" ขวา "ใหม่ Noto Sans Thai"**

1. หน้ารายการ (ตาราง 8 คอลัมน์ 14px + ชิปสถานะ + sidebar เมนู 500/14 + `#main h1` 600/24)
2. หน้ารายละเอียดสัญญา (KPI 700/24 tabular · การ์ด · ปุ่ม · dialog)
3. LIFF จ่ายค่างวด (390px: หัว 700/20 · ยอด 700/32 · ปุ่ม 600/16)
โทเคน: primary `hsl(160 84% 26%)` · พื้น `#F9F8F6` · card `#FDFDFC` · border `#E4E1DD` · muted-fg `#746A63` (ชิปเทาใช้ `#5F554F`). sticky note: "เอกสาร/ใบเสร็จ/สัญญา/สติกเกอร์ ไม่เปลี่ยน"

- [ ] **Step 4: ตรวจ ui-ux-pro-max กับ mockup แล้วแก้ก่อนส่ง**

Run:
```bash
python3 ~/.claude/skills/ui-ux-pro-max/scripts/search.py "line height Thai body text" --domain ux
python3 ~/.claude/skills/ui-ux-pro-max/scripts/search.py "font loading layout shift fallback" --domain ux
python3 ~/.claude/skills/ui-ux-pro-max/scripts/search.py "touch target button size mobile" --domain ux
python3 ~/.claude/skills/ui-ux-pro-max/scripts/search.py "status badge color only" --domain ux
```
Expected: body lh อยู่ใน 1.5–1.75 · ปุ่ม ≥44px บนมือถือ ≥36px desktop · ชิปสถานะมีคำ/ไอคอน · ไม่มี `--design-system`

- [ ] **Step 5: publish canvas (Artifact `type_url` https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd ด้วย `root` + `files`) แล้วหยุดรอเจ้าของ**

ส่งลิงก์ + สรุป 3 บรรทัด (สิ่งที่เปลี่ยน / สิ่งที่ไม่เปลี่ยน / สิ่งที่ตรวจไปแล้ว) แล้ว **STOP** — ไม่แตะโค้ดจนกว่าเจ้าของเคาะ. ถ้าเจ้าของขอแก้ (เช่น น้ำหนัก hero, ขนาดตาราง) ให้แก้ spec §3.3/3.4 ก่อน Task 2

---

### Task 2: web-shop — ไฟล์ฟอนต์ + fonts.css + โทเคน (TDD)

**Files:**
- Create: `apps/web-shop/public/fonts/noto-sans-thai/*.woff2` (8 ไฟล์), `apps/web-shop/public/fonts/sarabun/*.woff2` (4 ไฟล์)
- Modify: `apps/web-shop/src/styles/fonts.css` (เขียนใหม่ทั้งไฟล์), `apps/web-shop/src/styles/tokens.css:134-137`, `apps/web-shop/index.html:37-44`
- Delete: `apps/web-shop/public/fonts/prompt/`
- Test: `apps/web-shop/src/styles/fonts.test.ts`

**Interfaces:**
- Produces: โทเคนใน `@theme` — `--font-sans` (Noto Sans Thai stack), `--font-reading` (Sarabun stack — Tailwind v4 สร้างคลาส `font-reading` ที่ตั้ง family อย่างเดียวให้เอง), `--font-head: var(--font-sans)` คงไว้
- ไฟล์ฟอนต์: ชื่อตาม @fontsource `<pkg>-<subset>-<weight>-normal.woff2` ใต้ `public/fonts/<pkg>/`

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**

```ts
// apps/web-shop/src/styles/fonts.test.ts
import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const app = resolve(__dirname, '../..');
const fontsCss = readFileSync(resolve(app, 'src/styles/fonts.css'), 'utf8');
const tokensCss = readFileSync(resolve(app, 'src/styles/tokens.css'), 'utf8');
const indexHtml = readFileSync(resolve(app, 'index.html'), 'utf8');

describe('storefront fonts', () => {
  test('sans token is Noto Sans Thai with system fallback', () => {
    expect(tokensCss).toMatch(/--font-sans:\s*'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif;/);
  });
  test('reading token is Sarabun falling back to Noto Sans Thai', () => {
    expect(tokensCss).toMatch(/--font-reading:\s*'Sarabun', 'Noto Sans Thai', system-ui, sans-serif;/);
  });
  test('declares exactly Noto Sans Thai 400/500/600/700 and Sarabun 400/700 per subset', () => {
    const faces = [...fontsCss.matchAll(/font-family:\s*'([^']+)';[\s\S]*?font-weight:\s*(\d+);[\s\S]*?url\((\/fonts\/[^)]+\.woff2)\)/g)]
      .map((m) => `${m[1]}|${m[2]}|${m[3]}`);
    const expected = [
      ...['400', '500', '600', '700'].flatMap((w) => ['thai', 'latin'].map((s) => `Noto Sans Thai|${w}|/fonts/noto-sans-thai/noto-sans-thai-${s}-${w}-normal.woff2`)),
      ...['400', '700'].flatMap((w) => ['thai', 'latin'].map((s) => `Sarabun|${w}|/fonts/sarabun/sarabun-${s}-${w}-normal.woff2`)),
    ];
    expect(faces.sort()).toEqual(expected.sort());
  });
  test('every @font-face file exists under public/', () => {
    for (const m of fontsCss.matchAll(/url\((\/fonts\/[^)]+\.woff2)\)/g)) {
      expect(existsSync(resolve(app, 'public', m[1].slice(1)))).toBe(true);
    }
  });
  test('every face declares font-display: swap and a unicode-range', () => {
    for (const b of fontsCss.split('@font-face').slice(1)) {
      expect(b).toMatch(/font-display:\s*swap/);
      expect(b).toMatch(/unicode-range:/);
    }
  });
  test('Prompt and Google Fonts are gone', () => {
    expect(fontsCss + tokensCss + indexHtml).not.toMatch(/Prompt|googleapis|gstatic/);
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

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --workspace apps/web-shop run test -- src/styles/fonts.test.ts`
Expected: FAIL — `--font-sans` ยังเป็น Prompt, ไฟล์ noto-sans-thai ไม่มี

- [ ] **Step 3: ดึงไฟล์ฟอนต์ครั้งเดียว (ไม่เพิ่ม dependency)**

```bash
cd <scratchpad>/fonts && npm pack @fontsource/noto-sans-thai@5.3.0 @fontsource/sarabun@5.3.0 \
  && for t in *.tgz; do mkdir -p "${t%.tgz}" && tar -xzf "$t" -C "${t%.tgz}"; done
R=<repo>/apps/web-shop/public/fonts
mkdir -p $R/noto-sans-thai $R/sarabun
for w in 400 500 600 700; do for s in thai latin; do cp fontsource-noto-sans-thai-5.3.0/package/files/noto-sans-thai-$s-$w-normal.woff2 $R/noto-sans-thai/; done; done
for w in 400 700; do for s in thai latin; do cp fontsource-sarabun-5.3.0/package/files/sarabun-$s-$w-normal.woff2 $R/sarabun/; done; done
rm -rf $R/prompt
```
Expected: `ls $R/noto-sans-thai | wc -l` = 8 · `ls $R/sarabun | wc -l` = 4 · unicode-range ของแต่ละ subset อ่านจาก `fontsource-noto-sans-thai-5.3.0/package/400.css`

- [ ] **Step 4: เขียน fonts.css / tokens.css / index.html**

`fonts.css`: หัวไฟล์ระบุที่มาและคำสั่งดึงไฟล์ (Noto Sans Thai — Google, SIL OFL 1.1 · Sarabun — Cadson Demak, SIL OFL 1.1 · `@fontsource/*@5.3.0` ผ่าน `npm pack` · ห้ามแทนที่ไฟล์ชื่อเดิมเพราะ cache immutable) แล้ว `@font-face` 12 บล็อก — ลำดับ property คงที่: `font-family` → `font-style` → `font-weight` → `font-display` → `src` → `unicode-range` (เทสต์ parse ตามลำดับนี้)
`tokens.css`: แทนบรรทัด 134–137 ด้วย `--font-sans` / `--font-reading` / `--font-head: var(--font-sans)` + comment ว่า `--font-reading` ใช้เฉพาะบล็อกอ่านยาวผ่าน `reading-block` (Task 3)
`index.html`: preload ชี้ไฟล์ Thai 400 ของ Noto

- [ ] **Step 5: รันเทสต์ให้ผ่าน + build**

Run: `npm --workspace apps/web-shop run test -- src/styles/fonts.test.ts && npm --workspace apps/web-shop run build`
Expected: PASS ทั้ง 7 เทสต์ · build ผ่าน · `grep -ril "prompt" apps/web-shop/dist/assets/*.css` ไม่พบ

- [ ] **Step 6: Commit**

```bash
git add apps/web-shop/public/fonts apps/web-shop/src/styles/fonts.css apps/web-shop/src/styles/tokens.css apps/web-shop/index.html apps/web-shop/src/styles/fonts.test.ts
git commit -m "feat(web-shop): self-host Noto Sans Thai + Sarabun, retire Prompt"
```
---

### Task 3: web-shop — จัดตัวอักษรให้เข้ากับ Noto + บล็อกอ่านยาวเป็น Sarabun

**Files:**
- Modify: `apps/web-shop/src/index.css:7-60` (comment + `@utility reading-block`), `apps/web-shop/src/styles/tokens.css:145-146` (`--text-base--line-height` 1.7→1.65)
- Modify: ไฟล์ที่ `grep -rn "font-extrabold\|tracking-tight\|Prompt" apps/web-shop/src --include='*.tsx'` พบ (คาด 4 จุด + คอมเมนต์ `CatalogPage.tsx:74`)
- Modify: หน้าอ่านยาว — `apps/web-shop/src/pages/HowItWorksPage.tsx`, `InstallmentTermsPage.tsx`, `ReturnsPage.tsx`, `ShippingPage.tsx`, `AboutPage.tsx`, `landing/InstallmentLopburiPage.tsx`, `landing/NoCreditCardPage.tsx`, `landing/UsedIphoneLopburiPage.tsx` (เฉพาะย่อหน้าอธิบาย/FAQ) และบล็อกคำอธิบายสินค้าใน `ProductDetailPage.tsx`
- Test: `apps/web-shop/src/styles/typography-utilities.test.ts`

**Interfaces:**
- Consumes: `--font-reading` จาก Task 2
- Produces: `@utility reading-block` ใน `index.css` (ไม่ใช่ `@layer utilities` — ชื่อห้ามซ้ำกับ `font-reading` ที่ Tailwind สร้างจากโทเคน): `font-family: var(--font-reading); font-size: 1rem; line-height: 1.75;` ลูก `& :is(h2, h3) { font-family: var(--font-reading); font-weight: 700; }` · `& h3 { font-size: 1.125rem; }` · `& :is(button, [role='button'], .btn) { font-family: var(--font-sans); }`

- [ ] **Step 1: เทสต์ยูทิลิตีที่ล้ม**

```ts
// apps/web-shop/src/styles/typography-utilities.test.ts
import { expect, test } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const app = resolve(__dirname, '../..');
const css = readFileSync(resolve(app, 'src/index.css'), 'utf8');
const tokens = readFileSync(resolve(app, 'src/styles/tokens.css'), 'utf8');

test('reading-block is a Tailwind @utility that keeps controls in the UI face', () => {
  const block = css.match(/@utility reading-block\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  expect(block).toMatch(/font-family:\s*var\(--font-reading\)/);
  expect(block).toMatch(/line-height:\s*1\.75/);
  expect(block).toMatch(/& :is\(button, \[role='button'\], \.btn\)\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
  expect(css).not.toMatch(/\.font-reading\s*\{/);
});
test('body line-height is 1.65 for Noto Sans Thai', () => {
  expect(tokens).toMatch(/--text-base--line-height:\s*1\.65;/);
});
test('no 800 weight, tight tracking, or Prompt mention remains in storefront src', () => {
  const out = execSync("grep -rln 'font-extrabold\\|tracking-tight\\|Prompt' src --include='*.tsx' --include='*.ts' --include='*.css' || true", { cwd: app }).toString().trim();
  expect(out).toBe('');
});
```

- [ ] **Step 2: รันให้ล้ม** — Run: `npm --workspace apps/web-shop run test -- src/styles/typography-utilities.test.ts` · Expected: FAIL 3 เทสต์

- [ ] **Step 3: แก้ CSS + tsx**

`index.css`: แก้ comment หัวไฟล์ (Prompt → Noto Sans Thai), เพิ่ม `@utility reading-block` ตาม Interfaces, `.font-brand` letter-spacing 0.02em→0.01em · `tokens.css` lh 1.65 · tsx: `font-extrabold`→`font-bold`, `tracking-tight`→ลบ, คอมเมนต์ Prompt ใน `CatalogPage.tsx:74`→Noto · hero h1 เพิ่ม `lg:text-5xl` ถ้ายังไม่มี · ครอบบล็อกอ่านยาวของหน้าในรายการ Files ด้วย `className="reading-block"` ที่ container ของย่อหน้า (ไม่ครอบหัว section/ปุ่ม) · **`leading-none` 2 จุด ยังไม่แตะ** — รอภาพในขั้น 5

- [ ] **Step 4: รันเทสต์ทั้งแอปให้ผ่าน** — Run: `npm --workspace apps/web-shop run test && npm --workspace apps/web-shop run lint` · Expected: PASS ทั้งหมด (เทสต์เดิม 5 ไฟล์ไม่แตะฟอนต์)

- [ ] **Step 5: ภาพตรวจ 390/1280 ของ 5 หน้า** (home, catalog, product detail, how-it-works, sell) ด้วย Playwright จาก `node_modules` ของ repo (ห้าม `chrome --headless` ซ้อน instance) ต่อ mock `:5261` ตามสูตรเดิมใน `apps/web-shop/scripts/` — Expected: ไม่มีสระบนถูกตัด · hero ไม่ทับ · การ์ดราคาเรียงเลขตรง (tnum) · บล็อก Sarabun อ่านออกที่ 16px · ถ้า `leading-none` จุดใดตัดสระ แก้จุดนั้นเป็น `leading-tight` แล้วถ่ายซ้ำ; เก็บภาพไว้ใน scratchpad แนบ PR

- [ ] **Step 6: Commit** — `git commit -am "feat(web-shop): tune typography for Noto Sans Thai, Sarabun reading blocks"`
---

### Task 4: apps/web — ถอด Google Fonts, self-host Noto/IBM Plex, ปักเอกสารไม่เปลี่ยน (TDD)

**Files:**
- Create: `apps/web/public/fonts/noto-sans-thai/*.woff2` (8), `apps/web/public/fonts/ibm-plex-sans-thai/*.woff2` (8), `apps/web/public/fonts/ibm-plex-mono/*.woff2` (3 · latin)
- Create: `apps/web/src/styles/fonts.css` (Noto Sans Thai + IBM Plex Mono), `apps/web/src/styles/document-editor-fonts.css` (IBM Plex Sans Thai 4 น้ำหนัก)
- Modify: `apps/web/src/index.css:1-3` (แทน `@import url(...googleapis...) layer(base);` ด้วย `@import './styles/fonts.css';`), `:12` (`--font-sans`), `:436-441` (body font-family → `var(--font-sans)`), `apps/web/index.html:13-15` (เพิ่ม preload Noto Thai 400; คง preload THSarabun) และ `:22` (สไตล์ inline ของ "กำลังโหลด..." → `'Noto Sans Thai',system-ui,sans-serif`), `apps/web/src/pages/StickerPrintPage/index.tsx` และ `apps/web/src/components/template-editor/editor/RichTextEditor.tsx` (`import '@/styles/document-editor-fonts.css'`)
- **ห้ามแตะ**: บล็อก TH Sarabun PSK และ `.tiptap.ProseMirror` ใน `index.css`, `main.tsx`
- Test: `apps/web/src/styles/fonts.test.ts`

**Interfaces:**
- Consumes: ไฟล์จาก `npm pack` (วิธีเดียวกับ Task 2 ขั้น 3 — เพิ่ม `@fontsource/ibm-plex-sans-thai@5.3.0` และ `@fontsource/ibm-plex-mono@5.3.0`)
- Produces: `--font-sans: 'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif` · `--font-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace` (ค่าเดิม) · `--font-sarabun` ไม่เปลี่ยน

- [ ] **Step 1: เทสต์ที่ล้ม**

```ts
// apps/web/src/styles/fonts.test.ts
import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const app = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(app, p), 'utf8');
const indexCss = read('src/index.css');
const fontsCss = read('src/styles/fonts.css');
const editorFontsCss = read('src/styles/document-editor-fonts.css');
const indexHtml = read('index.html');

describe('admin app fonts', () => {
  test('no Google Fonts request remains', () => {
    expect(indexCss + fontsCss + editorFontsCss + indexHtml).not.toMatch(/googleapis|gstatic/);
  });
  test('fonts.css is imported from index.css (same pattern as web-shop)', () => {
    expect(indexCss).toMatch(/^@import '\.\/styles\/fonts\.css';/m);
  });
  test('UI face is Noto Sans Thai; mono unchanged', () => {
    expect(indexCss).toMatch(/--font-sans:\s*'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif;/);
    expect(indexCss).toMatch(/--font-mono:\s*'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;/);
  });
  test('document font is untouched (owner rule 2026-11-08)', () => {
    expect(indexCss).toMatch(/--font-sarabun:\s*'TH Sarabun PSK', sans-serif;/);
    expect(indexCss).toMatch(/font-family:\s*'TH Sarabun PSK';\s*src:\s*url\('\/fonts\/THSarabunPSK-Regular\.ttf'\)/);
    expect(indexCss).toMatch(/font-family:\s*'TH Sarabun PSK';\s*src:\s*url\('\/fonts\/THSarabunPSK-Bold\.ttf'\)/);
    expect(indexHtml).toMatch(/href="\/fonts\/THSarabunPSK-Bold\.ttf"/);
  });
  test('Tiptap editor keeps IBM Plex Sans Thai and that face is self-hosted', () => {
    expect(indexCss).toMatch(/\.tiptap\.ProseMirror\s*\{[^}]*font-family:\s*'IBM Plex Sans Thai', sans-serif/);
    const faces = [...editorFontsCss.matchAll(/font-weight:\s*(\d+);[\s\S]*?url\((\/fonts\/ibm-plex-sans-thai\/[^)]+)\)/g)].map((m) => m[1]);
    expect(new Set(faces)).toEqual(new Set(['400', '500', '600', '700']));
  });
  test('every declared woff2 exists', () => {
    for (const m of (fontsCss + editorFontsCss).matchAll(/url\((\/fonts\/[^)]+\.woff2)\)/g)) {
      expect(existsSync(resolve(app, 'public', m[1].slice(1)))).toBe(true);
    }
  });
  test('index.html preloads the Noto Thai 400 face', () => {
    expect(indexHtml).toMatch(/href="\/fonts\/noto-sans-thai\/noto-sans-thai-thai-400-normal\.woff2"[^>]*as="font"/);
  });
});
```

- [ ] **Step 2: รันให้ล้ม** — Run: `npm --workspace apps/web run test -- src/styles/fonts.test.ts` · Expected: FAIL (fonts.css ไม่มี, googleapis ยังอยู่)

- [ ] **Step 3: ดึงไฟล์ + เขียนไฟล์**

ดึงไฟล์ด้วยวิธี Task 2 ขั้น 3 ลง `apps/web/public/fonts/{noto-sans-thai,ibm-plex-sans-thai,ibm-plex-mono}/` (Noto 8 · IBM Plex Sans Thai 8 · IBM Plex Mono latin 400/500/600 = 3)
`fonts.css`: 8 บล็อก Noto Sans Thai + 3 บล็อก IBM Plex Mono (ลำดับ property เหมือน Task 2) · `document-editor-fonts.css`: 8 บล็อก IBM Plex Sans Thai (thai+latin × 4) พร้อม comment "เฉพาะสติกเกอร์และ Tiptap — เอกสารถึงลูกค้าไม่เปลี่ยน" · `index.css`: บรรทัด 1–3 → `@import './styles/fonts.css';`, แก้ `--font-sans`, body `font-family: var(--font-sans)` · `StickerPrintPage/index.tsx` + `RichTextEditor.tsx`: `import '@/styles/document-editor-fonts.css';` · `index.html`: เพิ่ม preload Noto Thai 400 ใต้ preload THSarabun และแก้ font stack inline บรรทัด 22

- [ ] **Step 4: รันเทสต์ + type-check** — Run: `npm --workspace apps/web run test -- src/styles/fonts.test.ts && ./tools/check-types.sh web` · Expected: PASS 7 เทสต์ · 0 TS errors

- [ ] **Step 5: ตรวจว่าไฟล์เอกสารไม่ถูกแตะ** — Run: `git diff --name-only origin/main | grep -E "receipt-pdf|hire-purchase|document-rendering|letter-pdf|after-sales-doc|voucher-html|finance-share-page|base-html|pdfGenerator|document-fonts|StickerCard|flex|main\.tsx" ; echo "exit=$?"` · Expected: ไม่มีบรรทัด · `exit=1`

- [ ] **Step 6: ยืนยันสติกเกอร์/preview เอกสารไม่เปลี่ยน** — เปิด `/stickers` และ `/contract-templates` (preview) บน dev แล้วอ่าน `document.fonts` ใน console: `[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family)` ต้องมี `IBM Plex Sans Thai` บน `/stickers` และ `TH Sarabun PSK` บน preview · screenshot เทียบกับ `origin/main` ที่ 100% zoom — Expected: เหมือนกันทุก mm

- [ ] **Step 7: Commit** — `git add apps/web/public/fonts apps/web/src/styles apps/web/src/index.css apps/web/index.html apps/web/src/pages/StickerPrintPage/index.tsx apps/web/src/components/template-editor/editor/RichTextEditor.tsx && git commit -m "feat(web): self-host Noto Sans Thai for UI, keep document faces untouched"`
---

### Task 5: apps/web — ภาพตรวจก่อน แล้วปรับระยะบรรทัด/ตัวอักษรบนจอเท่าที่ภาพฟ้อง

**Files:**
- Modify: `apps/web/src/index.css:30-35` (`--text-2xl--line-height` 1.35 · `--text-3xl` 1.3 · `--text-4xl` 1.25)
- Modify: `apps/web/src/styles/admin-typography.css` (เพิ่มกติกาเดียวใต้ guard เดิม: `& :is(.tracking-tight, .tracking-tighter) { letter-spacing: normal; }` — **ไม่มี** override `leading-none`)
- Modify: ไฟล์ tsx เฉพาะจุดที่ภาพในขั้น 1 ฟ้อง (`leading-none` → `leading-tight` รายตัว)
- Modify: `.claude/rules/frontend.md` บรรทัด `- **Font**: Inter (English) + IBM Plex Sans Thai (ไทย)` → Noto Sans Thai ทั้งหมด + ข้อห้ามเอกสาร
- Modify: `apps/web/package.json:3` (`version`)
- Test: `apps/web/src/styles/admin-typography.test.ts`

**Interfaces:**
- Consumes: `--font-sans` จาก Task 4

- [ ] **Step 1: ภาพตรวจชุดคงที่ "ก่อนจูน" 1280 + 390** — หน้า `/` `/customers` `/contracts/:id` `/stock` `/payments` `/pos` `/liff/pay/:token` (dev seed) ด้วย Playwright (`cd apps/web && npx playwright test e2e/<screenshot spec ชั่วคราว>` หรือสคริปต์ใน scratchpad) · จดรายการจุดที่ (ก) สระบน/วรรณยุกต์ถูกตัด (ข) หัวตาราง 8 คอลัมน์ขึ้น 2 บรรทัดที่ 1440 (งบความกว้าง sidebar 292px) (ค) ชิปสถานะขึ้น 2 บรรทัด — พร้อมชื่อไฟล์+บรรทัดของคลาสที่ทำให้เกิด

- [ ] **Step 2: เทสต์ที่ล้ม**

```ts
// apps/web/src/styles/admin-typography.test.ts
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const css = readFileSync(resolve(__dirname, 'admin-typography.css'), 'utf8');
const index = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
test('tight tracking is neutralised on screen UI only (inside the document guard)', () => {
  const guardStart = css.indexOf('body:has(.app-shell):not(:has(');
  const rule = css.indexOf(':is(.tracking-tight, .tracking-tighter) {');
  expect(rule).toBeGreaterThan(guardStart);
  expect(css.slice(rule)).toMatch(/letter-spacing:\s*normal/);
});
test('no blanket leading-none override exists', () => {
  expect(css).not.toMatch(/\.leading-none/);
});
test('heading line-heights leave room for Thai marks', () => {
  expect(index).toMatch(/--text-2xl--line-height:\s*1\.35;/);
  expect(index).toMatch(/--text-3xl--line-height:\s*1\.3;/);
  expect(index).toMatch(/--text-4xl--line-height:\s*1\.25;/);
});
```

- [ ] **Step 3: รันให้ล้ม** — Run: `npm --workspace apps/web run test -- src/styles/admin-typography.test.ts` · Expected: FAIL (2 ใน 3)

- [ ] **Step 4: แก้ CSS + จุดที่ภาพฟ้อง + rules + version** — ตาม Files; `leading-none` แก้เฉพาะรายการจากขั้น 1; `version` = ค่าใน `origin/main` +1 patch

- [ ] **Step 5: รันเทสต์ทั้งแอป** — Run: `npm --workspace apps/web run test && ./tools/check-types.sh all` · Expected: PASS · 0 errors

- [ ] **Step 6: ภาพตรวจชุดเดิม "หลังจูน"** — Expected: รายการจากขั้น 1 หายครบ ไม่มีจุดใหม่ · เก็บภาพก่อน/หลังแนบ PR

- [ ] **Step 7: Commit** — `git commit -am "feat(web): relax heading leading and tracking for Noto Sans Thai; bump version"`
---

### Task 6: Skill `bestchoice-typography` (ตาม superpowers:writing-skills) + PR

**Files:**
- Create: `.claude/skills/bestchoice-typography/SKILL.md`
- Modify: `.claude/CLAUDE.md` ตาราง Agent Skills (เพิ่มแถว `/bestchoice-typography`)

**Interfaces:**
- Consumes: โทเคน/ยูทิลิตีจริงหลัง Task 2–5 merge ใน branch

- [ ] **Step 1: RED — baseline ไม่มี skill** — dispatch subagent (general-purpose, sonnet) ด้วยคำถาม 3 ข้อ: "(1) คอมโพเนนต์ใหม่ใน apps/web-shop ที่แสดงเงื่อนไขผ่อนแบบย่อหน้ายาว ใช้ฟอนต์/คลาสอะไร (2) KPI ตัวเลขใน apps/web ใช้ font-family อะไร ต้อง tabular ไหม (3) จะแก้ฟอนต์ของใบเสร็จ PDF ให้เป็น Noto ได้ไหม" โดย**ไม่**ให้ skill — บันทึกคำตอบ verbatim ลง `<scratchpad>/skill-test/baseline.md`. Expected: ตอบ (1) ไม่รู้จัก `reading-block`/ตอบ Noto แทน Sarabun (2) ตอบ Inter หรือไม่แน่ใจ (3) ตอบว่าแก้ได้

- [ ] **Step 2: GREEN — เขียน SKILL.md** (reference skill, <400 คำ): frontmatter `name: bestchoice-typography` · `description: Use when adding or restyling any on-screen text in BESTCHOICE apps/web or apps/web-shop (choosing font family, weight, size, line-height, reading blocks), or when Thai text looks clipped or wrapped, or when asked to change fonts of receipts/contracts/documents` · เนื้อหา: ตารางบทบาท (Noto UI 400/500/600/700 · Sarabun `reading-block` web-shop เท่านั้น · เอกสาร/สติกเกอร์/Tiptap ห้ามแตะ — รายชื่อไฟล์จาก spec §4) · Quick reference ขนาดต่อส่วน (spec §3.3/3.4 ย่อ) · Common mistakes (tracking-tight · leading-none · font-extrabold · ใส่ Sarabun ในตาราง/ปุ่ม · เพิ่ม Google Fonts) · วิธีเพิ่มน้ำหนัก = `npm pack @fontsource/<pkg>@5.3.0` แล้ว cp ไฟล์ใหม่ (ห้ามแทนที่ไฟล์ชื่อเดิม)

- [ ] **Step 3: GREEN — รันคำถามเดิม 3 ข้อกับ subagent ที่ได้ skill** — Expected: (1) `reading-block` Sarabun 400/16 (2) Noto Sans Thai + `tabular-nums` (3) ปฏิเสธ อ้างคำสั่งเจ้าของ 2026-11-08 · ถ้าข้อใดไม่ผ่าน แก้ skill แล้วรันซ้ำเฉพาะข้อนั้น (REFACTOR)

- [ ] **Step 4: Commit + PR** — `git add .claude/skills/bestchoice-typography .claude/CLAUDE.md && git commit -m "docs: add bestchoice-typography skill"` แล้ว `gh pr create` หัวข้อ "Typography: Noto Sans Thai + Sarabun (web, web-shop) — documents untouched" body สรุป spec §3.1 + ลิงก์ mockup + ภาพตรวจ + บรรทัด "เอกสารถึงลูกค้าไม่เปลี่ยน (owner 2026-11-08)" ลงท้ายด้วย attribution; เก็บผล `gh pr checks` ลงตัวแปรก่อนตรวจ (กับดัก pipefail) · **ห้าม merge/deploy เอง** — รอเจ้าของ
