# Launch-Readiness Wave — Design

**วันที่:** 2026-07-23
**สถานะ:** อนุมัติแล้ว (owner) + แก้ตามผล scrutinize (23-agent trace เทียบ main `5dc1a95ea` + infra จริง)
**เป้าหมาย:** ปิดข้อค้างเว็บ shop ให้พร้อมรับลูกค้าจริง: โดเมน `www.bestchoicephone.com`, staff ปฏิบัติงานได้ครบ (accept/ค้นหา), ราคา MANUAL สอดคล้องทุกหน้าจอ, ลบซาก 410

## 0. ข้อเท็จจริงที่ scrutiny ยืนยัน (ฐานของ design นี้)

- main ปัจจุบัน = `5dc1a95ea` — **เบอร์จริง 095-567-8887 ลงแล้ว** (PR #1374 นอกรอบ) → งานเบอร์เหลือแค่เก็บตก 2 จุด (§1.3)
- `/sell` live มา ~5 วัน 10 releases → cleanup 410 **ครบกำหนดแล้ว**; HTML เสิร์ฟ no-store (firebase.json:72) → bundle ค้างแทบศูนย์
- Firebase Hosting REST API v1beta1 ใช้ได้จริงกับ gcloud creds ปัจจุบัน (ต้องส่ง header `x-goog-user-project: bestchoice-prod`) — ทดสอบ 200 แล้ว; **มี customDomain ค้าง `shop.bestchoicephone.app`** (สร้าง 2026-07-17, OWNERSHIP_MISSING) ต้องลบ
- `www.bestchoicephone.com` ปัจจุบันชี้ Cloudflare proxy (ส้ม) + redirect วนลูป; apex ชี้ parking; **เครื่องนี้ไม่มี Cloudflare credentials** → ฝั่ง Cloudflare = owner กดเองตาม record ที่เราส่งให้ (ทางเดียว)
- Cloud Run prod **ไม่มี `SHOP_BASE_URL`** และ deploy workflow ใช้ `--set-env-vars` แบบ**ล้างทั้งชุดทุก deploy** — เพิ่มมือเฉยๆ จะถูกลบรอบถัดไป
- Server search ของ trade-ins **ครบอยู่แล้ว** (sellerName/sellerPhone/imei/device/voucher/customer — query.service:71-81); ที่ขาดคือ frontend ไม่ส่ง `search` param เลย + กล่อง client-filter เดิม semantics พัง (column เป็น object)
- BRANCH_MANAGER **ไม่มีเมนูไป /trade-in** (menu.ts BM config ไม่มี entry) = root cause "OWNER เท่านั้น accept ได้"; ใน accept() มีผู้ใช้ branchId 3 จุดรวม JE cash resolver ที่ fail-closed
- MANUAL ปัจจุบันไม่แตะ breakdown/estimatedValue เลย → หลัง OWNER แก้ราคา **หน้าลูกค้ายังโชว์ราคาเก่า** (ทั้งสอง flow)

## 1. Track A — โดเมน `www.bestchoicephone.com`

### 1.1 Ops (ผมรันเอง — Firebase Hosting API, ไม่มี code)
1. `DELETE customDomains/shop.bestchoicephone.app` (ของค้าง)
2. `POST customDomains?customDomainId=www.bestchoicephone.com` บน site `bestchoicephone-shop`
3. `POST customDomains?customDomainId=bestchoicephone.com` แบบ **redirectTarget → www** (apex ใช้ Firebase redirect — ระบบเดียว, DNS-only ทั้งคู่; ไม่พึ่ง Cloudflare rule)
4. Poll `requiredDnsUpdates`/cert state → สรุป **รายการ record ให้ owner กดใน Cloudflare**: ปิด proxy (grey) ของ `www`, **ลบ redirect rule เดิมที่ทำ www วนลูป**, เพิ่ม TXT ownership + A/CNAME ตามที่ API ตอบ (ทั้ง www และ apex), ทุกตัว **DNS-only** — cert ไม่ออกถ้าเปิดส้ม
5. รอ cert ACTIVE → verify `https://www.bestchoicephone.com/sell` 200 + apex redirect → www; ระหว่างรอ `web.app` ใช้ได้ตลอด (custom domain สืบทอด rewrites `/api/**` จาก site เดิมอัตโนมัติ — ยืนยันแล้ว ไม่มี CORS/CSRF ติด: CsrfGuard เช็ค header ไม่เช็ค origin)

### 1.2 Code (SEO/env)
- `apps/web-shop/index.html`: og:url (:17), canonical (:18), JSON-LD url (:35) → `https://www.bestchoicephone.com` + **เพิ่ม `"telephone": "+66955678887"`** ใน JSON-LD (ยังไม่มี property นี้)
- `public/sitemap.xml` ทั้ง 11 `<loc>` + `public/robots.txt` บรรทัด Sitemap → โดเมนใหม่
- `usePageMeta` ขยาย: เขียน `<link rel="canonical">` per-route (base = www.bestchoicephone.com) — แก้ข้อจำกัด canonical เดียวทั้งเว็บ
- `.github/workflows/deploy-gcp.yml`: เพิ่ม `SHOP_BASE_URL=https://www.bestchoicephone.com` ใน `--set-env-vars` block (:333-363) + แก้ comment :448; `.env.example:142` อัปเดต
- `apps/api/src/main.ts:111-112` CORS: เพิ่ม `https://www.bestchoicephone.com` (defensive — flow ปกติใช้ same-origin rewrite)
- Comment sweeps: `integration-registry.ts:405`, `apps/web-shop/src/lib/api.ts:12`
- **LINE consolidation:** แทน literal `https://line.me/R/ti/p/@bestchoice` 10 จุด/9 ไฟล์ (HomeHero:38, InstallmentTermsPage:150, ContactPage:68, ReturnsPage:76, PromotionsPage:109, ApplyStatusPage:198, ApplySuccessPage:78, SellStatusPage:243+260, SellQuotePage:493) → `shopInfo.lineUrl` จาก copy.ts — พร้อมเปลี่ยน handle จริงทีเดียวเมื่อ owner มี

### 1.3 เก็บตกเบอร์โทร
- JSON-LD telephone (รวมใน 1.2 แล้ว)
- เบอร์ `063-134-6356` ใน `chatbot-finance/services/verification.service.ts:152` — **คงไว้ รอ owner ยืนยัน** (§6 checklist) ห้ามแก้ใน wave นี้

## 2. Track B — Staff accept record ออนไลน์

- `menu.ts`: เพิ่ม `/trade-in` เข้า BRANCH_MANAGER_CONFIG (label เดียวกับ SALES/OWNER) + เพิ่มรายการใน CommandPalette pages
- `AcceptTradeInDto`: เพิ่ม `@IsOptional() @IsString() branchId?`
- `AcceptModal` (apps/web): dropdown สาขา — **mirror pattern QuickBuyModal** (query `/branches`, default `user.branchId`, **disabled/ล็อกเป็นสาขาตัวเองสำหรับ role ที่ไม่ใช่ CROSS_BRANCH**, บังคับเลือกเมื่อ record ไม่มีสาขา); ส่ง `branchId` เฉพาะเมื่อ record.branchId เป็น null
- `trade-in-lifecycle.service.ts` accept(): `const effectiveBranchId = tradeIn.branchId ?? dto.branchId` — ใช้ที่ **3 จุด**: null-guard (throw Thai 400 ถ้ายัง null), `product.create` branchId, `resolveOutflowCashAccount` (JE — ห้ามแก้ template ตัว resolver แค่รับค่า) + persist `branchId: effectiveBranchId` ลง TradeIn ใน update เดียวกัน
- **กติกาชนกัน:** ถ้า `tradeIn.branchId` มีอยู่แล้วและ `dto.branchId` ส่งมาต่างค่า → 400 `'รายการนี้ผูกสาขาแล้ว'` (กัน re-home ข้ามสาขาเงียบๆ; OWNER ที่ผ่าน BranchGuard ก็โดนกติกานี้)
- หมายเหตุ BranchGuard: guard อ่าน `body.branchId` ก่อน validation → BM เลือกสาขาอื่น = 403 ของ guard เดิม (พฤติกรรมถูกต้อง ไม่ต้องแก้ guard)
- **ห้ามแตะ findAll scoping** (ปัจจุบันไม่ scope ตามสาขา — ถ้าอนาคตเพิ่ม ต้อง OR branchId-null ไม่งั้น record ออนไลน์หายจากตา BM — จดเป็น note ใน code comment)

## 3. Track C — ค้นหาตาราง trade-in (frontend-only)

- `TradeInPage/index.tsx`: search input + `useDebounce` (import ไว้แล้วไม่ได้ใช้) → ส่ง `search` เข้า params + queryKey, reset page=1 เมื่อค่า debounced เปลี่ยน
- `TradeInTable.tsx`: **ถอด `searchable`/client-filter เดิม** (semantics พังกับ column object) — เหลือ search เดียวฝั่ง server
- **ห้ามแตะ backend** — server ครบแล้ว

## 4. Track D — MANUAL re-stamp (ทั้งสอง flow)

ใน `online-appraisal.service.ts` MANUAL branch — เพิ่ม `extraData` (เข้า CAS updateMany เดิม → race-safe):
- ทั้งสอง flow: `estimatedValue = Decimal(manual)`, `quoteBreakdown.price = manual.toFixed(2)` (invariant price==estimatedValue==offeredPrice กลับมาถูกทุกหน้าจอ รวมหน้า status ลูกค้า)
- BUYBACK: `quoteBreakdown.cashPrice = manual.toFixed(2)` (price==cash เสมอของ flow นี้)
- EXCHANGE: `quoteBreakdown.exchangePrice = manual.toFixed(2)` + `cashPrice = floor(manual × 100 ÷ (100 + bonusPct) ÷ 10) × 10` — **Decimal ล้วน**: `manual.mul(100).div(HUNDRED.plus(bonusPct))` ห้ามสร้างจาก float; `bonusPct` จาก **snapshot `breakdown.bonusPct`** (ไม่ใช่ config ปัจจุบัน); ถ้า snapshot ไม่มี (record เก่าก่อน dual-price) → ใช้ `cashPrice = manual` (flow เก่าไม่มีโบนัส)
- ยอมรับ+จดไว้: inverse ไม่ round-trip เป๊ะ (label `+X%` คลาดได้ ~1% บน record ที่แก้มือ — ราคาเครดิตที่ตกลงกับลูกค้าเป็นตัวจริง)
- **Hardening แถม:** ย้าย `auditLog.create` ของ MANUAL ไปหลัง CAS สำเร็จ (`result.count === 1`) — เลิกเขียน audit ให้ราคาที่ไม่เคยเกิด (race-loser)
- accept() `costPrice` อ่าน `breakdown.cashPrice` อยู่แล้ว → ได้ค่าที่ถูกโดยอัตโนมัติหลัง re-stamp

## 5. Track E — Cleanup 410 (ครบกำหนด)

- ลบ dir `apps/api/src/modules/shop-trade-in/` (**เหลือ 2 ไฟล์**: controller stub + module)
- `app.module.ts`: ถอด import (:123) + registration (:355) — **รอบนี้ต้องแตะ** (ตรงข้าม wave ก่อน)
- `shop-buyback.controller.ts`: ลบ route `quick-quote` (:41-45) + ถอด `GoneException` จาก import (:1) — ไม่งั้น eslint gate แดง
- `shop-buyback.routing.spec.ts`: ลบ/แก้ case ที่ assert 410 (:54-56)
- `.claude/rules/security.md:33`: ถอด `shop-trade-in` จากรายการ public endpoints
- `shop-buyback.service.ts:31-32`: reword comment ("ปลดระวางและลบแล้ว")
- **Keep-list (ห้ามแตะ):** `modules/journal/cpa-templates/shop-trade-in.template.ts` + `journal.module.ts` + `journal/shop-templates/shop-trade-in.template.spec.ts` + ทุกอย่างใต้ `modules/trade-in/` ที่ไม่ได้ระบุใน Track B/D — ลบตาม path ที่ระบุเท่านั้น ห้าม grep-delete

## 6. Owner checklist (นอกโค้ด)

1. **Cloudflare** (ตอน Track A ops): ปิด proxy www + ลบ redirect rule + เพิ่ม records ตามที่ผมส่ง (DNS-only ทุกตัว)
2. ยืนยัน **เบอร์ 063-134-6356** ใน LINE chatbot: เบอร์สาขาจริง หรือให้เปลี่ยนเป็น 095-567-8887?
3. LINE OA handle จริง + LINE Login channel → เมื่อมี: แก้ `shopInfo.lineUrl` จุดเดียว + ตั้ง LINE Dev callback `https://www.bestchoicephone.com/auth/line-callback` + env `LINE_LOGIN_CHANNEL_ID`
4. GA4/FB Pixel: เมื่อมี ID ใส่ในแอดมิน (IntegrationConfig) — ไม่ต้อง deploy
5. ก่อน launch จริง: ลบสินค้า demo (`CLEAN=1 bash scripts/seed-demo-products-prod.sh`) + ลงเครื่องจริง

## 7. Testing

- Jest: accept effectiveBranchId (3 เคส: online+dto, walk-in เดิม, ชนกัน 400) + JE resolver ได้ branch ถูก; MANUAL re-stamp (BUYBACK/EXCHANGE/legacy-no-bonusPct + invariant + audit-after-CAS + race-loser ไม่มี audit); routing spec หลังลบ 410; suites เดิมเขียวหมด (โดยเฉพาะ journal/shop-templates + trade-in)
- Frontend: typecheck+build ทั้ง apps/web และ web-shop; browser pass: BM login → เมนูเห็น → accept record ออนไลน์เลือกสาขา → สำเร็จ; ค้นหาด้วยเบอร์ลูกค้า; OWNER MANUAL แก้ราคา → หน้า status ลูกค้าเห็นราคาใหม่
- Domain: verify www 200 + apex redirect + canonical per-route + `/qa` รอบสุดท้ายบนโดเมนจริง (หลัง DNS ติด — ระหว่างรอไม่ block track อื่น)

## 8. ลำดับ/การพึ่งพา

Track E, C, D, B = โค้ดอิสระต่อกัน (PR เดียวได้); Track A code รวม PR เดียวกัน; Track A ops รันคู่ขนาน (ไม่รอโค้ด) แต่ verify domain ได้หลัง owner เพิ่ม records; `/qa` สุดท้ายรอ DNS
