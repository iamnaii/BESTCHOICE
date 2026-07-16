# Web-Shop Track C — Discoverability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้บริการ เก่าแลกใหม่ (`/trade-in`) และ รับซื้อมือถือ (`/buyback`) ที่มีระบบครบแต่ไม่มีทางเข้า ถูกค้นพบได้จาก nav/footer/หน้าแรกของเว็บ shop

**Architecture:** โค้ดล้วนฝั่ง `apps/web-shop` 4 ไฟล์ — เพิ่มลิงก์ใน `NAV_LINKS` (ShopHeader ใช้ร่วม desktop+hamburger อัตโนมัติ), เพิ่มลิงก์ footer, เพิ่ม section "บริการของเรา" 3 การ์ดบนหน้าแรก โดยมี **QA gate ก่อนเริ่ม**: ต้องพิสูจน์ว่า flow trade-in/buyback ใช้ได้จริงใน browser ก่อนพาลูกค้าเข้าไป (สองหน้านี้ไม่เคยถูกเปิดทดสอบ)

**Tech Stack:** React 18 + Vite 6 + Tailwind v4 (tokens ใน `src/styles/tokens.css`), components เดิม (`Section`/`SectionHeader`/`Card`/`Button`), lucide-react icons

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-16-web-shop-launch-roadmap-design.md` (Track C)
- **ฐาน branch:** ต้องมีโค้ดจาก PR #1352 (`fix/web-shop-critical-flows` — ShopHeader แบบ NAV_LINKS+hamburger) และ #1354 (`feat/web-shop-cta-orange`) — ถ้าทั้งคู่ merge เข้า main แล้วให้แตกจาก `origin/main`; ถ้ายัง ให้แตกจาก `origin/feat/web-shop-cta-orange` แล้วเปิด PR แบบ stacked (ห้าม merge ก่อน retarget — บทเรียนเดิม)
- `apps/web-shop` **ไม่มี unit-test runner** (ไม่มี jest/vitest ใน package.json) — ห้ามเพิ่ม framework ใหม่ (YAGNI); วงจรทดสอบของทุก task = `npx tsc --noEmit` + `npm run build` + เปิด browser จริงบน `vite preview` (local API :3000 ต้องรันอยู่ — `cd apps/api && npm run dev`)
- ข้อความ UI = ภาษาไทย รวมศูนย์ใน `src/lib/copy.ts`; Thai text ใช้ `leading-snug`
- สีตาม token เท่านั้น: การ์ดบริการใช้โทนเขียว/outline — **ห้ามใช้สีส้ม CTA** (สงวนให้ปุ่มจอง/เลือกเครื่องตาม isolation effect ของ #1354)
- ทำงานใน worktree แยก (มี session อื่นใช้ checkout หลัก): `git worktree add <scratchpad>/wt-track-c <base>`
- commit แรกของ branch = ไฟล์ spec + plan สองไฟล์นี้ (ยัง uncommitted อยู่ใน checkout หลัก — copy เข้า worktree)

---

### Task 0: ตั้ง branch + commit เอกสาร

**Files:**
- Create (commit): `docs/superpowers/specs/2026-07-16-web-shop-launch-roadmap-design.md` (copy จาก checkout หลัก)
- Create (commit): `docs/superpowers/plans/2026-07-16-web-shop-track-c-discoverability.md` (copy จาก checkout หลัก)

**Interfaces:**
- Produces: branch `feat/web-shop-track-c-discoverability` ที่ task ถัดไปทำงานต่อ

- [ ] **Step 1: เช็คสถานะ merge ของ #1352/#1354 เพื่อเลือกฐาน**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE && git fetch origin && gh pr view 1352 --json state --jq .state && gh pr view 1354 --json state --jq .state`
Expected: `MERGED`/`OPEN` อย่างใดอย่างหนึ่งต่อ PR — ถ้าทั้งคู่ MERGED → BASE=`origin/main`; ไม่งั้น BASE=`origin/feat/web-shop-cta-orange`

- [ ] **Step 2: สร้าง worktree + branch**

```bash
git worktree add -b feat/web-shop-track-c-discoverability \
  /private/tmp/claude-501/-Users-iamnaii-Desktop-App/0ce3acaf-ea81-4fa1-933a-f8c873d0dac5/scratchpad/wt-track-c \
  <BASE จาก Step 1>
```

- [ ] **Step 3: copy เอกสาร 2 ไฟล์จาก checkout หลักเข้า worktree (path เดิม) แล้ว commit**

```bash
cd <worktree>
mkdir -p docs/superpowers/specs docs/superpowers/plans
cp /Users/iamnaii/Desktop/App/BESTCHOICE/docs/superpowers/specs/2026-07-16-web-shop-launch-roadmap-design.md docs/superpowers/specs/
cp /Users/iamnaii/Desktop/App/BESTCHOICE/docs/superpowers/plans/2026-07-16-web-shop-track-c-discoverability.md docs/superpowers/plans/
git add docs && git commit -m "docs(web-shop): spec แผน launch roadmap 5 tracks + plan Track C discoverability"
```

---

### Task 1: QA gate — พิสูจน์ flow trade-in + buyback ใน browser (ห้ามข้าม)

**Files:** ไม่แก้ไฟล์ — ผลลัพธ์คือบันทึก QA ในคอมเมนต์ของ PR / รายงานต่อ user

**Interfaces:**
- Produces: คำตัดสิน PASS/FAIL ต่อ flow — Task 2 ใส่ลิงก์เฉพาะ flow ที่ PASS

- [ ] **Step 1: build + เสิร์ฟ web-shop จาก worktree** (ใช้ dist แยก กัน conflict กับ checkout หลัก)

```bash
cd <worktree>/apps/web-shop && npm run build && npx vite preview --port 5178 &
curl -s -o /dev/null -w "%{http_code}" http://localhost:5178/   # expect 200
```

- [ ] **Step 2: QA /trade-in ผ่าน browser-harness จนจบ flow**

เปิด `http://localhost:5178/trade-in` → กด CTA เริ่มทำเรื่อง → กรอก wizard (อุปกรณ์→สภาพ→รูป (ทดสอบ `useSignedUpload` ด้วยรูปจริง 1 รูป)→ผู้ขาย ชื่อ/เบอร์ 10 หลัก) → submit → ต้องได้หน้า success/เลขเรื่อง → เปิด `/trade-in/{id}` ต้องแสดงสถานะ
Expected: ครบทุกขั้นไม่มี error console/หน้าขาว; ข้อมูลถึง backend (`GET /api/shop/trade-in/{id}` ตอบ 200)

- [ ] **Step 3: QA /buyback แบบเดียวกัน**

เปิด `http://localhost:5178/buyback` → quick-quote (ต้องได้ราคาประเมิน) → submit พร้อมรูป → status page
Expected: เหมือน Step 2 (endpoint `POST /api/shop/buyback/quick-quote` + `submit` + `GET :id`)

- [ ] **Step 4: บันทึกผล + ตัดสิน**

PASS ทั้งคู่ → ไป Task 2 เต็มรูปแบบ | FAIL flow ไหน → **หยุด รายงาน user พร้อมหลักฐาน** (ตัดสินใจ: แก้ในตัว PR / ถอดลิงก์ตัวนั้น) — ห้ามเพิ่มลิงก์พาไปหน้าพัง

---

### Task 2: เพิ่มทางเข้า — copy.ts + ShopHeader + ShopFooter

**Files:**
- Modify: `apps/web-shop/src/lib/copy.ts` (section `home`)
- Modify: `apps/web-shop/src/components/layout/ShopHeader.tsx` (const `NAV_LINKS`)
- Modify: `apps/web-shop/src/components/layout/ShopFooter.tsx` (คอลัมน์ "บริการ")

**Interfaces:**
- Consumes: `NAV_LINKS` array + hamburger ที่ #1352 สร้าง (desktop nav กับเมนูมือถือ render จาก array เดียวกัน)
- Produces: strings `copy.home.servicesTitle/servicesDescription/serviceBuyTitle/...` (รายชื่อเต็มใน Step 1) ที่ Task 3 ใช้

- [ ] **Step 1: เพิ่ม strings ใน copy.ts** — แทรกท้าย section `home` (หลัง `testimonialsTitle`):

```ts
    servicesTitle: 'บริการของเรา',
    servicesDescription: 'ครบทุกเรื่องมือถือ ซื้อ ผ่อน แลก หรือขายคืน จบที่ร้านเดียว',
    serviceBuyTitle: 'ซื้อ/ผ่อนมือถือ',
    serviceBuyDescription: 'เครื่องผ่านตรวจ 30 จุด ผ่อนได้บัตรประชาชนใบเดียว 3-12 งวด',
    serviceBuyCta: 'ดูสินค้า',
    serviceTradeInTitle: 'เก่าแลกใหม่',
    serviceTradeInDescription: 'ตีราคาเครื่องเก่าสูงสุด ฿15,000 เอาส่วนต่างออกเครื่องใหม่ในร้าน',
    serviceTradeInCta: 'ประเมินราคา',
    serviceBuybackTitle: 'รับซื้อมือถือ',
    serviceBuybackDescription: 'ขายเครื่องรับเงินสดหรือโอนทันที ตีราคาเบื้องต้นออนไลน์ได้เลย',
    serviceBuybackCta: 'ขายเครื่อง',
```

- [ ] **Step 2: ShopHeader — ขยาย NAV_LINKS** (แทนที่ array เดิมทั้งก้อน):

```ts
const NAV_LINKS = [
  { to: '/products', label: 'สินค้าทั้งหมด' },
  { to: '/trade-in', label: 'เก่าแลกใหม่' },
  { to: '/buyback', label: 'รับซื้อมือถือ' },
  { to: '/promotions', label: 'โปรโมชัน' },
  { to: '/how-it-works', label: 'วิธีซื้อ' },
  { to: '/about', label: 'เกี่ยวกับเรา' },
  { to: '/contact', label: 'ติดต่อ' },
];
```

- [ ] **Step 3: ShopFooter — เพิ่ม 2 ลิงก์ในคอลัมน์ "บริการ"** ใต้ `สินค้าทั้งหมด`:

```tsx
            <li><Link to="/trade-in">เก่าแลกใหม่</Link></li>
            <li><Link to="/buyback">รับซื้อมือถือ</Link></li>
```

- [ ] **Step 4: verify**

Run: `cd <worktree>/apps/web-shop && npx tsc --noEmit && npm run build`
Expected: ทั้งคู่ exit 0
Browser (:5178 rebuild แล้ว): desktop เห็น nav 7 ลิงก์ไม่ล้น (เช็คที่กว้าง 1512 และ **1024px** ผ่าน `Emulation.setDeviceMetricsOverride`); mobile (390px) hamburger มี 7 รายการ; footer มี 2 ลิงก์ใหม่; คลิกแล้วถึง `/trade-in`, `/buyback`

- [ ] **Step 5: commit**

```bash
git add apps/web-shop/src/lib/copy.ts apps/web-shop/src/components/layout/ShopHeader.tsx apps/web-shop/src/components/layout/ShopFooter.tsx
git commit -m "feat(web-shop): เพิ่มทางเข้า เก่าแลกใหม่/รับซื้อ ใน nav + hamburger + footer"
```

---

### Task 3: section "บริการของเรา" บนหน้าแรก

**Files:**
- Modify: `apps/web-shop/src/pages/HomePage.tsx`

**Interfaces:**
- Consumes: strings จาก Task 2 Step 1; components เดิม `Section/SectionHeader/Card/CardBody/Button` (import อยู่แล้วใน HomePage ทุกตัว)

- [ ] **Step 1: เพิ่ม icons ใน import lucide-react** (แถวบนไฟล์ — เพิ่ม `Smartphone, Repeat, Banknote` ต่อท้าย list เดิม):

```ts
import {
  Search,
  ShieldCheck,
  BadgeCheck,
  Wallet,
  MessageCircle,
  PiggyBank,
  Target,
  ShoppingBag,
  Smartphone,
  Repeat,
  Banknote,
} from 'lucide-react';
```

- [ ] **Step 2: เพิ่ม const SERVICE_ITEMS ใต้ `WHY_US_ITEMS`:**

```tsx
const SERVICE_ITEMS = [
  {
    icon: <Smartphone className="size-7" />,
    title: copy.home.serviceBuyTitle,
    description: copy.home.serviceBuyDescription,
    cta: copy.home.serviceBuyCta,
    to: '/products',
  },
  {
    icon: <Repeat className="size-7" />,
    title: copy.home.serviceTradeInTitle,
    description: copy.home.serviceTradeInDescription,
    cta: copy.home.serviceTradeInCta,
    to: '/trade-in',
  },
  {
    icon: <Banknote className="size-7" />,
    title: copy.home.serviceBuybackTitle,
    description: copy.home.serviceBuybackDescription,
    cta: copy.home.serviceBuybackCta,
    to: '/buyback',
  },
];
```

- [ ] **Step 3: แทรก Section หลังปิด `</Section>` ของ whyUs (บรรทัด ~131) ก่อน comment ออมดาวน์:**

```tsx
      <Section padding="md">
        <Container>
          <SectionHeader
            title={copy.home.servicesTitle}
            description={copy.home.servicesDescription}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {SERVICE_ITEMS.map((s) => (
              <Card key={s.to} variant="outlined" className="h-full">
                <CardBody className="flex h-full flex-col space-y-3 leading-snug">
                  <span className="inline-flex items-center justify-center size-12 rounded-xl bg-emerald-100 text-emerald-600">
                    {s.icon}
                  </span>
                  <div className="font-semibold text-base">{s.title}</div>
                  <p className="text-sm text-muted-foreground flex-1">{s.description}</p>
                  <Button asChild variant="outline" size="md" className="self-start">
                    <Link to={s.to}>{s.cta}</Link>
                  </Button>
                </CardBody>
              </Card>
            ))}
          </div>
        </Container>
      </Section>
```

- [ ] **Step 4: verify**

Run: `npx tsc --noEmit && npm run build` → exit 0
Browser: หน้าแรกมี section "บริการของเรา" 3 การ์ดระหว่าง "ทำไมเลือก BESTCHOICE" กับแบนเนอร์ออมดาวน์; mobile (390px) การ์ดเรียง 1 คอลัมน์; ปุ่ม 3 ปุ่มลิงก์ถูก; ปุ่มเป็น outline (ไม่ใช่ส้ม/เขียวทึบ)

- [ ] **Step 5: commit**

```bash
git add apps/web-shop/src/pages/HomePage.tsx
git commit -m "feat(web-shop): section บริการของเรา บนหน้าแรก — ซื้อผ่อน/เก่าแลกใหม่/รับซื้อ"
```

---

### Task 4: sweep สุดท้าย + PR

**Files:** ไม่แก้เพิ่ม (ยกเว้นแก้ตาม findings)

- [ ] **Step 1: full verify รอบเดียว**

Run: `npx tsc --noEmit && npm run build` + browser sweep: `/`, `/products`, `/trade-in`, `/buyback` ที่ 1512/1024/390px — ไม่มี regression จาก #1352/#1354 (header ทึบ, ปุ่มส้มยังอยู่, search ใช้ได้)

- [ ] **Step 2: push + เปิด PR**

```bash
git push -u origin feat/web-shop-track-c-discoverability
gh pr create --base <main ถ้าฐานคือ main | feat/web-shop-cta-orange ถ้า stacked> \
  --title "feat(web-shop): Track C — ทางเข้า เก่าแลกใหม่/รับซื้อ + section บริการหน้าแรก" \
  --body "<สรุป + ผล QA gate จาก Task 1 + screenshots>"
```
ถ้า stacked: ใส่คำเตือน retarget ใน PR body เหมือน #1354

- [ ] **Step 3: ลบ worktree + รายงานผล user** (PR ลิงก์ + ผล QA gate + สิ่งที่พบ)

---

## Self-Review (ทำแล้ว)

- Spec coverage: ครบ — เมนู (Task 2), footer (Task 2), section หน้าแรก (Task 3), QA gate (Task 1), เช็ค 1024px (Task 2/4), เอกสารลง repo (Task 0)
- Placeholder: `<BASE>`/`<worktree>` เป็นตัวแปรที่ Task 0 กำหนดค่า — ไม่ใช่ TBD
- Type consistency: strings ใน Task 3 อ้างชื่อเดียวกับที่ประกาศใน Task 2 Step 1 ครบทุกตัว
