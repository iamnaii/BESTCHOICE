# B4 — เว็บลูกค้า: แชร์ลิงก์มีการ์ด + ข้อมูลต่อเครื่อง Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แชร์ลิงก์สินค้าไป LINE/Facebook แล้วขึ้นการ์ด (รูป+ชื่อ+ราคา) แทนลิงก์เปล่า, ลูกค้าเห็นข้อมูลจริงต่อเครื่อง (รูปตามเครื่อง/สาขา/อุปกรณ์/ตำหนิ/QC/ประกันจริง), ทักแชทแล้วแอดมินรู้ทันทีว่ามาจากเครื่องไหน, และ "ผ่อนเริ่มต้น" บนหน้ารายการเป็นเลขที่ทำสัญญาได้จริงแทน rate ปลอม 0.99%

**Architecture:** เพิ่ม endpoint `GET /api/shop/share/:id` บน `apps/api` (NestJS) ที่เสิร์ฟ HTML สั้น escaped ทั้งหมด (OG + JSON-LD + canonical + meta-refresh/JS redirect ไป `/products/:id`) — วิ่งบน Firebase rewrite `/api/**` → Cloud Run ที่มีอยู่แล้ว **ไม่แตะ** `firebase.json` / `setGlobalPrefix('api')` / `Dockerfile` / deploy ordering; `apps/web-shop` (React storefront) ใช้ URL นี้เป็นลิงก์แชร์/prefill แชททุกที่; `ShopBotDefenseService` เพิ่ม social crawler เป็น KNOWN_GOOD + แก้บั๊ก 429 ที่ทำให้ counter ไม่รีเซ็ต; `FacebookWebhookController` รับ standalone referral (`m.me/<page>?ref=p:<unitId>`) ที่ทุกวันนี้โดน drop แล้ว post SYSTEM message ในห้อง

**Tech Stack:** NestJS 10 + Prisma + PostgreSQL (`apps/api`), React 19 + Vite 6 + Tailwind 4 (`apps/web-shop`), React + vitest (`apps/web` — แตะแค่ `buildShopProductUrl` ใน Task 10), jest 29 + ts-jest (เทสต์ฝั่ง api), decimal.js สำหรับเลขเงิน

## Global Constraints

- **Branch:** `feat/pa-b4-web-shop-share-og` (แตกจาก `main` หลัง B0 merge แล้ว — ดู Task 0)
- **Migration:** **ไม่มี** ใน batch นี้ (B0 = `20260985000000`, B3 = `20260983000000`; B4 ใช้คอลัมน์ที่ B0 สร้างไว้แล้ว ห้ามสร้าง migration ใหม่)
- **Red line:** ห้ามแตะ accounting/finance JE paths (`apps/api/src/modules/journal/**`, `apps/api/src/modules/accounting/**`, `apps/api/src/modules/payments/**`, `apps/api/src/modules/contracts/**`) — batch นี้ไม่มีไฟล์ใดในรายการนั้น; จุดเดียวที่แตะเลขเงินคือ "ผ่อนเริ่มต้น" หน้ารายการ (Task 6) ซึ่งเป็น **display-only** และต้องมี parity golden test ยืนยันว่าเลขเท่ากับ `InstallmentPreviewService` ทุกสตางค์
- **เทสต์ (ค่าจริงของ repo นี้ — อย่าเดา):**
  - `apps/api` = **jest** (`testRegex: .*\.spec\.ts$`, `rootDir: src`) → `cd apps/api && npx jest src/modules/<path>/<file>.spec.ts`
  - `apps/web` = **vitest ไม่ใช่ jest** (`apps/web/package.json` → `vitest run`, glob `src/**/*.{test,spec}.{ts,tsx}`) → `cd apps/web && npx vitest run src/pages/ProductDetailPage/utils/buildCustomerSummary.test.ts` (Task 10 แตะไฟล์นี้ไฟล์เดียว)
  - `apps/web-shop` = **ไม่มี test runner และไม่มี eslint config** (`npm run lint` ในนั้นพังด้วย "couldn't find eslint.config") → ตรวจด้วย `cd apps/web-shop && npx tsc --noEmit` (ต้อง exit 0) + QA เบราว์เซอร์ local เท่านั้น
- **Lint (คำสั่งที่ใช้ได้จริง — ยืนยันแล้ว 2026-08-04, ถ้อยคำเดียวกับ B0):**
  - api: `cd apps/api && npx eslint src/<path ที่แก้>` (เฉพาะไฟล์ใน `src/`) และ gate ของ CI คือ `npm run lint --workspace=apps/api` (= `eslint "{src,test}/**/*.ts" --fix`)
    ⚠️ **ห้ามใช้ `cd apps/api && npx eslint .` เป็น gate** — วันนี้มี **34 error ค้างอยู่ก่อน B4** ล้วนเป็น `Parsing error` ของไฟล์นอก `tsconfig.json` include (`e2e/*.e2e-spec.ts`, `scripts/*.ts`, `eslint.config.mjs`) → เป้าหมายคือ **ไม่เพิ่ม error ใหม่ (baseline 34)** ไม่ใช่ 0 สัมบูรณ์. **ห้ามไปแก้ `tsconfig.json`/`eslint.config.mjs` เพื่อไล่ error พวกนี้ — อยู่นอก scope ของ B4**
  - web-shop: **ไม่มี eslint config ในโปรเจกต์นี้** → gate เดียวคือ `npx tsc --noEmit`
  - (eslint config ของ api ตั้ง `no-unused-vars`/`no-explicit-any` เป็น **warn** — warning ไม่ทำให้ exit code ไม่เป็น 0)
- **Gate ปิด batch (รันแยกทีละคำสั่ง ห้ามร้อยด้วย `&&` เพราะจะกลบผลของคำสั่งหลัง):**
  1. `cd apps/api && npx tsc --noEmit` = 0 error
  2. `npm run lint --workspace=apps/api` = ไม่มี error ใหม่เกิน baseline 34
  3. `cd apps/web-shop && npx tsc --noEmit` = 0 error
  4. `cd apps/api && npx jest src/modules/shop-catalog src/modules/shop-bot-defense src/modules/chat-adapters src/modules/chat-engine src/modules/shop-public-config` เขียวทั้งหมด (ต้องมี `chat-engine` เพราะ Task 8 แก้ `message-router.service.ts` และ `shop-public-config` เพราะ Task 10 แก้ service นั้น)
- **เงิน:** ใช้ `Decimal` จาก `decimal.js` (แบบเดียวกับ `installment-preview.service.ts`) — ห้าม `Number()` ในการคำนวณค่างวด
- **UI copy:** ภาษาไทยทั้งหมด, ข้อความไทยใช้ `leading-snug`, ห้าม hardcoded hex/gray → ใช้ design token
- **Commit:** ทุก commit ลงท้ายด้วย
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```
- **Scope ที่ spec ตัดออกแล้ว — ห้ามใส่กลับ:** `/p/:slug`, dynamic sitemap, `ChatRoom.attachedProductId`, ตัวแปรสินค้าใน canned responses
- **QA เบราว์เซอร์ = local เท่านั้น** (prod ปฏิเสธ seed account ทุกตัว) — `cd apps/api && npm run dev` (:3000) + `cd apps/web-shop && npm run dev` (:5174, vite proxy `/api` → :3000)

## File Structure

**สร้างใหม่ (apps/api)**
| ไฟล์ | รับผิดชอบ |
|---|---|
| `apps/api/src/modules/shop-catalog/share-page.util.ts` | pure function สร้าง HTML หน้าแชร์ + `escapeHtml` + `buildShareDescription` (ไม่มี I/O เลย → เทสต์ง่าย) |
| `apps/api/src/modules/shop-catalog/share-page.util.spec.ts` | เทสต์ escaping/XSS, og:image, redirect, JSON-LD |
| `apps/api/src/modules/shop-catalog/shop-share.controller.ts` | `GET /api/shop/share/:id` — เสิร์ฟ HTML + CSP nonce + cache header |
| `apps/api/src/modules/shop-catalog/shop-share.controller.spec.ts` | เทสต์ 404 / headers / เนื้อ HTML |
| `apps/api/src/modules/shop-catalog/product-unit-detail.util.ts` | parse `checklistResults` / `accessoriesIncluded` (Json หลายรูปแบบ) แบบ defensive |
| `apps/api/src/modules/shop-catalog/product-unit-detail.util.spec.ts` | เทสต์ parser ทุกรูปแบบ Json |
| `apps/api/src/modules/shop-catalog/shop-catalog.installment-parity.spec.ts` | golden: `monthlyPaymentFrom` ของ catalog === `monthlyPayment` ของ preview ที่ input เดียวกัน |
| `apps/api/src/modules/shop-bot-defense/skip-bot-rate-limit.decorator.ts` | `@SkipBotRateLimit()` metadata |
| `apps/api/src/modules/shop-bot-defense/shop-bot-defense.guard.spec.ts` | เทสต์ guard: normalize path, skip rate-limit, ยัง log |

**แก้ไข (apps/api)**
| ไฟล์ | แก้อะไร |
|---|---|
| `shop-bot-defense/shop-bot-defense.service.ts` | KNOWN_GOOD social crawlers, แก้บั๊ก window ไม่รีเซ็ต, ค่าคงที่ limit |
| `shop-bot-defense/shop-bot-defense.service.spec.ts` | เทสต์ใหม่ + คงของเดิม |
| `shop-bot-defense/shop-bot-defense.guard.ts` | normalize `/api` prefix, อ่าน `@SkipBotRateLimit()` |
| `shop-catalog/shop-catalog.service.ts` | `_min installmentPrice`, monthly จริงผ่าน `resolveBcConfigForCategory` (util ของ B3), ฟิลด์ต่อเครื่อง, ค้นไทย AND-composable |
| `shop-catalog/shop-catalog.service.spec.ts` | อัปเดต assertion ที่พฤติกรรมเปลี่ยน + เทสต์ใหม่ |
| `shop-catalog/shop-catalog.module.ts` | ลงทะเบียน controller ใหม่ (ไม่มี provider ใหม่ — resolver เป็น pure util ของ B3) |
| `chat-adapters/facebook-webhook.controller.ts` | branch `referral && !message && !postback` + note จาก postback referral |
| `chat-adapters/facebook-webhook.controller.spec.ts` | เทสต์ referral 3 เคส |
| `chat-adapters/facebook-admin.controller.ts` | route `setup-messenger-profile` ใน `@Controller('admin/facebook')` (URL จริงมี `admin` ซ้ำ — ดู Task 9) |
| `chat-engine/services/message-router.service.ts` | `postSystemNote(roomId, text)` |
| `facebook-domain/facebook-persistent-menu.service.ts` | creds จาก IntegrationConfig + `setupGetStarted()` |
| `facebook-domain/facebook-domain.module.ts` | import `IntegrationsModule` |
| `integrations/integration-registry.ts` | +field `pageUsername` ใน integration `facebook` (owner กรอกเองได้จากหน้า Settings) |
| `shop-public-config/shop-public-config.service.ts` | +`getShopConfig()` → `{ facebookPageHandle }` (username ?? pageId) |
| `shop-public-config/shop-public-config.controller.ts` | +`@Get('shop')` |
| `shop-public-config/shop-public-config.service.spec.ts` | เทสต์ `getShopConfig` 3 เคส (username / fallback pageId / ไม่ได้ตั้ง) |
| `staff-chat/services/chat-commerce.service.ts` | `shareUrl` 2 จุด (B2 สร้าง) → ชี้ share endpoint |
| `sales-bot/tools/search-products.tool.ts` | `webUrl` (B3 สร้าง) → ชี้ share endpoint |
| `sales-bot/tools/calculate-installment.tool.ts` | `webUrl` (B3 สร้าง) → ชี้ share endpoint |

**แก้ไข (apps/web — admin)**
| ไฟล์ | แก้อะไร |
|---|---|
| `src/pages/ProductDetailPage/utils/buildCustomerSummary.ts` | `buildShopProductUrl` → `${base}/api/shop/share/:id` (B1 ฝากไว้ให้ B4 เปลี่ยนจุดเดียว) |
| `src/pages/ProductDetailPage/utils/buildCustomerSummary.test.ts` | อัปเดต 2 เทสต์ของ `buildShopProductUrl` |

**แก้ไข (apps/web-shop)**
| ไฟล์ | แก้อะไร |
|---|---|
| `src/lib/copy.ts` | `productShareUrl`, `messengerRefUrl(productId, pageHandle)`, `lineProductPrefill` + copy ใหม่ (**ไม่มี** `facebookPageUsername` hardcode — อ่านจาก public-config) |
| `src/types/product.ts` | ฟิลด์ใหม่ใน `ProductUnit` |
| `src/pages/ProductDetailPage.tsx` | รูปตามเครื่อง + reset activeImage, ปุ่มแชร์, LINE prefill ใหม่, ปุ่ม Messenger, ประกันจริงใน meta |
| `src/components/catalog/SpecTable.tsx` | แถวสาขา/อุปกรณ์/ตำหนิ + บล็อก QC |
| `src/components/catalog/ProductCard.tsx` | `monthlyPaymentFrom: number \| null` — **B0 Step 4d ทำไปแล้ว** ให้ตรวจก่อนแก้ (ปกติจะไม่มี diff จาก B4) |

---

## Task 0 — ตรวจ precondition จาก B0 + เปิด branch

B4 กินของ 3 อย่างจาก batch ก่อนหน้า: คอลัมน์ `accessoriesIncluded`/`cosmeticNotes` (B0 → Task 5), util แปลงคำค้นไทย (B0 → Task 7) และ resolver ของ `InterestConfig` (B3 → Task 6) **ห้ามเริ่มถ้ายังไม่มี** — และ **ห้ามสร้าง util ซ้ำเอง**

⚠️ **B0/B1/B3 แก้ไฟล์ชุดเดียวกับ B4 ไปก่อนแล้ว** (`shop-catalog.service.ts` + `shop-catalog.service.spec.ts` + `apps/web-shop/.../ProductDetailPage.tsx` โดน B0, `installment-preview.service.ts` โดน B3, `buildCustomerSummary.ts` โดน B1, `chat-commerce.service.ts` โดน B2, `sales-bot/tools/*` โดน B3) → **เลขบรรทัดทุกตัวในแผนนี้เป็นค่า ณ วันเขียนแผน (pre-B0) ใช้อ้างอิงคร่าว ๆ เท่านั้น**. ทุก step ที่ต้องแก้ไฟล์เหล่านี้ให้ใช้ **grep-anchor** (หา "บรรทัดที่ match X" แล้วแทน/แทรกตรงนั้น) ไม่ใช่เลขบรรทัดตรง ๆ

### Files
- Read: `apps/api/prisma/schema.prisma` (block `model Product`, บรรทัด ~1690-1720)
- Read: `apps/api/src/utils/device-query-normalize.util.ts` (สร้างโดย B0)
- Read: `apps/api/src/utils/bc-installment-config.util.ts` (สร้างโดย B3)

### Interfaces
- **Consumes (จาก B0):** `Product.accessoriesIncluded Json?`, `Product.cosmeticNotes String?`
- **Consumes (จาก B0):** `export function parseDeviceQuery(utterance: string): DeviceQuery` โดย `DeviceQuery = { brand: string | null; model: string | null; storage: string | null; color: string | null; rest: string }` — `apps/api/src/utils/device-query-normalize.util.ts`
- **Consumes (จาก B3):** `export async function resolveBcConfigForCategory(prisma, category): Promise<{ found: boolean; config?: BcConfig }>` — `apps/api/src/utils/bc-installment-config.util.ts`

### Steps
- [ ] ตรวจว่าคอลัมน์ B0 ลงแล้ว:
  ```bash
  cd /Users/iamnaii/Desktop/App/BESTCHOICE
  grep -n "accessoriesIncluded\|cosmeticNotes\|priceAutofilledAt" apps/api/prisma/schema.prisma
  ```
  คาดหวัง 3 บรรทัด ถ้าได้ 0 บรรทัด → **หยุด** แล้วรอ B0 merge ก่อน
- [ ] ตรวจ util ค้นไทยของ B0 + ชื่อ export จริง:
  ```bash
  grep -n 'export function parseDeviceQuery' apps/api/src/utils/device-query-normalize.util.ts
  grep -n "^export" apps/api/src/utils/device-query-normalize.util.ts
  ```
  คาดหวังเห็น `export function parseDeviceQuery` (**ถ้าชื่อต่างจากนี้ ให้บันทึกชื่อจริงไว้แล้วทำต่อ** — ใช้ชื่อจริงนั้นใน Task 7 แทน ห้ามหยุดรอ และ **ห้ามเขียน util ใหม่ซ้ำ**). ถ้าไฟล์ไม่มีเลย = B0 ยังไม่ merge → หยุดรอ B0
- [ ] ตรวจ resolver ของ B3 (Task 6 ใช้ตัวนี้ ห้ามสร้าง service ซ้ำ):
  ```bash
  grep -n 'export async function resolveBcConfigForCategory' apps/api/src/utils/bc-installment-config.util.ts
  grep -n 'resolveBcConfigForCategory' apps/api/src/modules/shop-catalog/installment-preview.service.ts
  ```
  คาดหวังเจอทั้ง 2 บรรทัด (บรรทัดที่สองยืนยันว่า B3 re-point `previewBc` มาใช้ util แล้ว — หลัง B3 บล็อก resolve config ใน `previewBc` **เหลือบรรทัดเดียว** จึงห้ามทำตามคำสั่งเก่าที่ให้ "ยกโค้ดจาก previewBc มาทั้งดุ้น"). ถ้าไม่เจอ = B3 ยังไม่ merge → **หยุดรอ B3** (Task 6 ทั้ง task ขึ้นกับ util ตัวนี้)
- [ ] จดตำแหน่งจริง (grep-anchor) ของไฟล์ที่ batch ก่อนหน้าแก้ไปแล้ว — ใช้แทนเลขบรรทัดในแผนนี้ทุกจุด:
  ```bash
  cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
  grep -n "INTEREST_RATE_PER_MONTH\|DEFAULT_MONTHS\|DEFAULT_DOWN_PCT\|calculateMonthlyPayment\|monthlyPaymentFrom\|constructor(private prisma\|filters.search\|_min: { cashPrice\|shopBaseWhere\|productReadinessWhere" src/modules/shop-catalog/shop-catalog.service.ts
  grep -n "constructor(\|previewBc\|resolveBcConfigForCategory" src/modules/shop-catalog/installment-preview.service.ts
  cd ../web-shop && grep -n "monthlyPaymentFrom" src/components/catalog/ProductCard.tsx
  grep -n "selectedUnit?.cashPrice\|usePageMeta\|data.gallery360\|lineOaMessageUrl\|activeImage" src/pages/ProductDetailPage.tsx
  ```
  **หมายเหตุ:** B0 ลบ `const SHOP_BRAND`/`const PHONE_CATEGORIES` และย่อ `shopBaseWhere()` ให้เหลือ `return { ...productReadinessWhere() }` → บล็อกค่าคงที่และเมธอด `calculateMonthlyPayment` เลื่อนขึ้นราว 6 บรรทัดจากเลขในแผนนี้
- [ ] ตรวจว่า B0 **ยังไม่ได้** ทำงานของ Task 5/Task 11 ไปแล้ว (spec §2.2 เขียนกำกวมว่า "expose ฟิลด์ทั้งหมดใน shop `ProductUnit`") — ถ้าทำไปแล้วให้ตัดสเต็ปที่ซ้ำออกแทนที่จะเขียนทับ:
  ```bash
  cd /Users/iamnaii/Desktop/App/BESTCHOICE
  grep -n "accessories\|cosmeticNotes\|qcChecklist\|branchName" apps/api/src/modules/shop-catalog/shop-catalog.service.ts apps/web-shop/src/types/product.ts
  grep -n "สอบถามราคา" apps/web-shop/src/pages/ProductDetailPage.tsx
  ```
  คาดหวัง 0 บรรทัดจากคำสั่งแรก (ถ้าเจอ → Task 5 เหลือแค่ส่วนที่ขาด); คำสั่งที่สองบอกว่า B0 แตะ `price ?? 0` ไปแล้วหรือยัง (มีผลกับ Task 11)
- [ ] ตรวจว่า Prisma client ถูก generate ตาม schema ใหม่แล้ว:
  ```bash
  cd apps/api && npx prisma generate && grep -c "accessoriesIncluded" node_modules/.prisma/client/index.d.ts
  ```
  คาดหวังตัวเลข > 0
- [ ] เปิด branch:
  ```bash
  cd /Users/iamnaii/Desktop/App/BESTCHOICE && git checkout main && git pull && git checkout -b feat/pa-b4-web-shop-share-og
  ```
- [ ] บันทึก baseline ให้รู้ว่าอะไรเขียวอยู่ก่อนเริ่ม (ชุดเดียวกับ gate ปิด batch ใน Task 12 — ต้องมี `chat-engine` + `shop-public-config`):
  ```bash
  cd apps/api && npx jest src/modules/shop-catalog src/modules/shop-bot-defense src/modules/chat-adapters src/modules/chat-engine src/modules/shop-public-config 2>&1 | tail -6
  ```
  คาดหวัง `Tests: N passed` ไม่มี failed (จดตัวเลข N ไว้เทียบตอนจบ; ตัวเลข ณ เวลาเขียนแผน **ก่อน B0/B3**: shop-catalog.service 20 + installment-preview 5 + shop-bot-defense.service 14 + facebook-webhook.controller 10 + line-shop.adapter 3 = 52 บวกของ chat-engine + shop-public-config 3 — **B0/B3 เพิ่ม/แก้เทสต์ในโมดูลเหล่านี้ไปแล้ว ตัวเลขจริงจะสูงกว่านี้ ให้ยึดเลขที่รันได้จริงวันนี้**)
- [ ] บันทึก baseline lint (ต้องไม่เพิ่ม error ใหม่ตอนปิด batch):
  ```bash
  cd /Users/iamnaii/Desktop/App/BESTCHOICE && npm run lint --workspace=apps/api 2>&1 | tail -3
  ```
  คาดหวังเห็นบรรทัดสรุปแบบ `✖ N problems (34 errors, ...)` — **34 error นี้เป็นของเดิม (Parsing error ของ `e2e/`, `scripts/`, `eslint.config.mjs` ที่อยู่นอก tsconfig include) ห้ามไปไล่แก้** จดเลขไว้เทียบตอนปิด batch

---

## Task 1 — bot-defense: แก้บั๊ก 429 + รู้จัก social crawler

**บั๊ก 429 ของจริง (อ่านโค้ดแล้ว):** ใน `recordRateLimit` ตัวแปร `windowStart` = `now - (now % 60000)` = ต้นนาทีปัจจุบันเสมอ ดังนั้นเงื่อนไข `now.getTime() - windowStart.getTime() > 60_000` **เป็น false ตลอดกาล** (ค่าที่ได้อยู่ระหว่าง 0-59999) → ทุก request จะ (ก) เลื่อน `windowStart` ไปต้นนาทีปัจจุบัน และ (ข) `requestCount: { increment: 1 }` โดย **ไม่เคยรีเซ็ตกลับเป็น 1** → `getRequestRate` เห็น `elapsedMs < 60_000` เสมอ จึงคืน **ยอดสะสมตลอดชีพ** ของ IP นั้น ⇒ IP ไหนเคยยิงครบ 100 ครั้งจะโดน 429 **ถาวร**

บั๊กรอง: `decideAction` เช็ค `input.pagePath?.startsWith('/products')` แต่ guard ส่ง `req.path` ซึ่งมี global prefix เป็น `/api/shop/products/...` → branch นี้ **ตายสนิท** (แก้ path ใน Task 2 พร้อมทำ limit ให้ "หลวมขึ้น" ไม่ใช่แน่นขึ้น)

### Files
- Modify: `apps/api/src/modules/shop-bot-defense/shop-bot-defense.service.ts` (บรรทัด 16-17 ค่าคงที่, 25-32 `classifyUserAgent`, 34-63 `decideAction`, 65-89 `recordRateLimit`, 91-100 `getRequestRate`)
- Modify: `apps/api/src/modules/shop-bot-defense/shop-bot-defense.service.spec.ts` (ต่อท้าย describe เดิม บรรทัด 26-81)

### Interfaces
- **Produces:** `classifyUserAgent(ua: string): BotType | null` (พฤติกรรมเพิ่ม: social crawler → `'KNOWN_GOOD'`)
- **Produces:** `decideAction(input: { userAgent: string; requestRate: number; pagePath?: string }): BotAction` (เดิม)
- **Produces:** `recordRateLimit(ip: string, userAgent: string, pagePath: string): Promise<void>` (เดิม, semantics ใหม่ = sliding 60s window ที่รีเซ็ตจริง)
- **Produces:** `export const RATE_LIMIT_WINDOW_MS = 60_000`
- **Consumes:** `PrismaService.ipRateLimit` (`findUnique` / `upsert` / `update`), `hashPII(value, salt)` จาก `../../utils/pii.util`

### Steps
- [ ] เขียนเทสต์ที่ fail ก่อน — ต่อท้ายไฟล์ `apps/api/src/modules/shop-bot-defense/shop-bot-defense.service.spec.ts` (ก่อนปีกกาปิด `});` บรรทัดสุดท้าย) แทรก:
  ```ts
    describe('classifyUserAgent — social preview crawlers (B4)', () => {
      it('detects facebookexternalhit as KNOWN_GOOD', () => {
        expect(
          service.classifyUserAgent('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'),
        ).toBe('KNOWN_GOOD');
      });
      it('detects Facebot as KNOWN_GOOD', () => {
        expect(service.classifyUserAgent('Facebot')).toBe('KNOWN_GOOD');
      });
      it('detects Twitterbot as KNOWN_GOOD', () => {
        expect(service.classifyUserAgent('Twitterbot/1.0')).toBe('KNOWN_GOOD');
      });
      it('detects the LINE link preview crawler as KNOWN_GOOD', () => {
        expect(service.classifyUserAgent('Mozilla/5.0 (compatible; Line-Poker/1.0)')).toBe('KNOWN_GOOD');
      });
      it('never rate-limits a social crawler even at a huge request rate', () => {
        expect(
          service.decideAction({ userAgent: 'facebookexternalhit/1.1', requestRate: 9999, pagePath: '/shop/share/abc' }),
        ).toBe('LOGGED');
      });
    });

    describe('recordRateLimit — sliding window actually resets (B4 429 bug)', () => {
      it('resets requestCount to 1 when the stored window is older than 60s', async () => {
        prisma.ipRateLimit.findUnique.mockResolvedValue({
          ipHash: 'h',
          windowStart: new Date(Date.now() - 61_000),
          requestCount: 500,
        });
        await service.recordRateLimit('1.2.3.4', 'Mozilla/5.0', '/shop/products');
        expect(prisma.ipRateLimit.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({ requestCount: 1, pagesVisited: 1 }),
          }),
        );
        expect(prisma.ipRateLimit.update).not.toHaveBeenCalled();
      });

      it('increments (does not reset) inside the same 60s window', async () => {
        prisma.ipRateLimit.findUnique.mockResolvedValue({
          ipHash: 'h',
          windowStart: new Date(Date.now() - 5_000),
          requestCount: 7,
        });
        await service.recordRateLimit('1.2.3.4', 'Mozilla/5.0', '/shop/products');
        expect(prisma.ipRateLimit.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ requestCount: { increment: 1 } }),
          }),
        );
        expect(prisma.ipRateLimit.upsert).not.toHaveBeenCalled();
      });

      it('creates a fresh row when the IP has never been seen', async () => {
        prisma.ipRateLimit.findUnique.mockResolvedValue(null);
        await service.recordRateLimit('9.9.9.9', 'Mozilla/5.0', '/shop/products');
        expect(prisma.ipRateLimit.upsert).toHaveBeenCalledWith(
          expect.objectContaining({ create: expect.objectContaining({ requestCount: 1 }) }),
        );
      });
    });

    describe('getRequestRate — expired window reads as 0', () => {
      it('returns 0 when the stored window is older than 60s', async () => {
        prisma.ipRateLimit.findUnique.mockResolvedValue({
          ipHash: 'h',
          windowStart: new Date(Date.now() - 60_001),
          requestCount: 900,
        });
        expect(await service.getRequestRate('1.2.3.4')).toBe(0);
      });
      it('returns the stored count inside the window', async () => {
        prisma.ipRateLimit.findUnique.mockResolvedValue({
          ipHash: 'h',
          windowStart: new Date(Date.now() - 1_000),
          requestCount: 12,
        });
        expect(await service.getRequestRate('1.2.3.4')).toBe(12);
      });
    });
  ```
- [ ] เพิ่ม `update: jest.fn().mockResolvedValue({})` ใน mock prisma ของไฟล์เดียวกัน (บรรทัด 12-15) ให้เป็น:
  ```ts
      prisma = {
        ipRateLimit: {
          upsert: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
          findUnique: jest.fn().mockResolvedValue(null),
        },
        botDetectionLog: { create: jest.fn().mockResolvedValue({}) },
      };
  ```
- [ ] รันให้เห็น fail:
  ```bash
  cd apps/api && npx jest src/modules/shop-bot-defense/shop-bot-defense.service.spec.ts
  ```
  คาดหวัง: เทสต์ social crawler fail (ได้ `null` แทน `'KNOWN_GOOD'`) + เทสต์ reset fail (`prisma.ipRateLimit.update` ไม่เคยถูกเรียก)
- [ ] แก้ `apps/api/src/modules/shop-bot-defense/shop-bot-defense.service.ts` บรรทัด 16-17 เป็น:
  ```ts
  /** ความยาวหน้าต่างนับ rate — ใช้ร่วมกันทั้ง record และ read เพื่อกันค่าคลาดกัน */
  export const RATE_LIMIT_WINDOW_MS = 60_000;

  const RATE_LIMIT_PER_MIN = 100;
  /**
   * หน้ารายการ/รายละเอียดสินค้ายิงหลาย request ต่อการเปิด 1 หน้า (list + models +
   * detail + related + installment-preview) และลูกค้าหลายคนอาจอยู่หลัง NAT เดียวกัน
   * → เพดานต้อง "หลวมกว่า" ปกติ ไม่ใช่แน่นกว่า (บั๊กเดิมตั้งใจให้แน่นกว่าแต่ dead code อยู่)
   */
  const CATALOG_RATE_LIMIT_PER_MIN = 240;

  /** path (หลังตัด prefix /api แล้ว) ที่ถือเป็นการเดินดูสินค้าปกติ */
  function isCatalogPath(pagePath?: string): boolean {
    if (!pagePath) return false;
    return pagePath.startsWith('/shop/products') || pagePath.startsWith('/products');
  }
  ```
- [ ] แก้ `classifyUserAgent` (บรรทัด 25-32) โดยแทรกบรรทัดแรกสุดของ body:
  ```ts
    classifyUserAgent(ua: string): BotType | null {
      // Social/link-preview crawlers ต้องเช็คก่อนทุกกฎ — ตัวมันคือคนดึงการ์ด OG
      // ของ /api/shop/share/:id ถ้าโดนจัดเป็น SCRAPER/RATE_ABUSE การ์ดจะไม่ขึ้นเลย
      if (/facebookexternalhit|Facebot|Twitterbot|Line-?Poker|LineBot|Slackbot|Discordbot|WhatsApp|TelegramBot|LinkedInBot/i.test(ua))
        return 'KNOWN_GOOD';
      if (/GPTBot|ClaudeBot|Anthropic-AI|PerplexityBot|Google-Extended/i.test(ua)) return 'AI_CRAWLER';
  ```
  (บรรทัดที่เหลือของฟังก์ชันคงเดิม)
- [ ] แก้บรรทัด 58 ใน `decideAction` จาก
  ```ts
      const limit = input.pagePath?.startsWith('/products') ? CATALOG_RATE_LIMIT_PER_MIN * 2 : RATE_LIMIT_PER_MIN;
  ```
  เป็น
  ```ts
      const limit = isCatalogPath(input.pagePath) ? CATALOG_RATE_LIMIT_PER_MIN : RATE_LIMIT_PER_MIN;
  ```
- [ ] แทนที่ `recordRateLimit` ทั้งฟังก์ชัน (บรรทัด 65-89) ด้วย:
  ```ts
    /**
     * นับ request ต่อ IP ในหน้าต่าง 60 วินาทีแบบ "รีเซ็ตได้จริง"
     *
     * บั๊กเดิม: windowStart ถูกคำนวณเป็นต้นนาทีปัจจุบันแล้วเขียนทับทุกครั้ง ส่วน
     * requestCount ใช้ increment อย่างเดียว → counter ไม่เคยกลับเป็น 1 และ
     * getRequestRate ก็เห็น window ใหม่เสมอ ⇒ IP ที่เคยยิงครบเพดานโดน 429 ถาวร
     *
     * อ่านก่อนเขียน (2 query) แทน raw upsert แบบมีเงื่อนไข เพื่อให้ตรรกะรีเซ็ต
     * ทดสอบได้ด้วย unit test; ช่อง race ที่เหลือทำให้นับพลาดได้ไม่กี่ครั้งต่อ
     * หน้าต่าง ซึ่งรับได้สำหรับ bot-defense (ไม่ใช่เส้นทางเงิน)
     */
    async recordRateLimit(ip: string, userAgent: string, _pagePath: string): Promise<void> {
      const salt = process.env.PII_HASH_SALT;
      if (!salt) return;
      const ipHash = hashPII(ip, salt);
      const now = new Date();

      const existing = await this.prisma.ipRateLimit.findUnique({ where: { ipHash } });
      const expired =
        !existing || now.getTime() - existing.windowStart.getTime() >= RATE_LIMIT_WINDOW_MS;

      if (expired) {
        await this.prisma.ipRateLimit.upsert({
          where: { ipHash },
          create: {
            ipHash,
            windowStart: now,
            requestCount: 1,
            pagesVisited: 1,
            uniquePagesVisited: 1,
            lastUserAgent: userAgent,
          },
          update: {
            windowStart: now,
            requestCount: 1,
            pagesVisited: 1,
            lastUserAgent: userAgent,
          },
        });
        return;
      }

      await this.prisma.ipRateLimit.update({
        where: { ipHash },
        data: {
          requestCount: { increment: 1 },
          pagesVisited: { increment: 1 },
          lastUserAgent: userAgent,
        },
      });
    }
  ```
  (พารามิเตอร์ตัวที่ 3 ยังคงรับไว้เพื่อคง signature เดิมของผู้เรียก — ไม่ต้องเปลี่ยน guard; ตั้งชื่อ `_pagePath` เพราะ eslint ของ repo นี้ตั้ง `@typescript-eslint/no-unused-vars` เป็น warn พร้อม `argsIgnorePattern: '^_'` จึงไม่ทิ้ง warning ใหม่ไว้)
- [ ] แก้ `getRequestRate` บรรทัด 97-98 ให้ใช้ค่าคงที่ร่วม:
  ```ts
      const elapsedMs = Date.now() - row.windowStart.getTime();
      if (elapsedMs >= RATE_LIMIT_WINDOW_MS) return 0; // window expired
  ```
- [ ] รันให้ผ่าน:
  ```bash
  cd apps/api && npx jest src/modules/shop-bot-defense/shop-bot-defense.service.spec.ts
  ```
  คาดหวัง `Tests: 24 passed` (14 เดิม + 10 ใหม่) ไม่มี failed
- [ ] commit:
  ```bash
  git add apps/api/src/modules/shop-bot-defense && git commit -m "$(cat <<'EOF'
  fix(shop-bot-defense): reset rate-limit window + treat social crawlers as KNOWN_GOOD

  หน้าต่างนับเดิมไม่เคยรีเซ็ต (windowStart เป็นต้นนาทีปัจจุบันเสมอ) ทำให้ requestCount
  สะสมตลอดชีพและ IP ที่เคยยิงครบเพดานโดน 429 ถาวร; เพิ่ม facebookexternalhit/Facebot/
  Twitterbot/Line-Poker เป็น KNOWN_GOOD เพื่อให้การ์ด OG ของหน้าแชร์ดึงได้

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 2 — `@SkipBotRateLimit()` + guard: normalize path และยกเว้น endpoint แชร์

หน้าแชร์ต้องไม่มีวันโดน 429 (ลิงก์ที่แชร์ไปกลุ่มไลน์เดียวอาจถูกเปิดพร้อมกันหลังจาก NAT เดียว) แต่ยังต้องถูก classify + log ตามปกติ

### Files
- Create: `apps/api/src/modules/shop-bot-defense/skip-bot-rate-limit.decorator.ts`
- Create: `apps/api/src/modules/shop-bot-defense/shop-bot-defense.guard.spec.ts`
- Modify: `apps/api/src/modules/shop-bot-defense/shop-bot-defense.guard.ts` (ทั้งไฟล์ 1-31)

### Interfaces
- **Produces:** `export const SKIP_BOT_RATE_LIMIT = 'skipBotRateLimit'`
- **Produces:** `export const SkipBotRateLimit: () => CustomDecorator<string>`
- **Consumes:** `Reflector` จาก `@nestjs/core` (NestJS ให้มาเองไม่ต้อง provide), `ShopBotDefenseService.{getRequestRate, decideAction, classifyUserAgent, logDetection, recordRateLimit}`

### Steps
- [ ] สร้าง `apps/api/src/modules/shop-bot-defense/skip-bot-rate-limit.decorator.ts`:
  ```ts
  import { SetMetadata } from '@nestjs/common';

  export const SKIP_BOT_RATE_LIMIT = 'skipBotRateLimit';

  /**
   * ยกเว้น route นี้จากการ throw 429 ของ ShopBotDefenseGuard
   * (ยัง classify + log + นับ rate ตามปกติ — แค่ไม่ปิดประตู)
   *
   * ใช้กับ endpoint ที่ "ต้องเปิดได้เสมอ" เช่นหน้าแชร์ OG ที่ crawler และคนกด
   * ลิงก์จากกลุ่มแชทเดียวกันอาจยิงมาพร้อมกันจาก IP เดียว
   */
  export const SkipBotRateLimit = () => SetMetadata(SKIP_BOT_RATE_LIMIT, true);
  ```
- [ ] เขียนเทสต์ที่ fail ก่อน — สร้าง `apps/api/src/modules/shop-bot-defense/shop-bot-defense.guard.spec.ts`:
  ```ts
  import { ExecutionContext, HttpException } from '@nestjs/common';
  import { Reflector } from '@nestjs/core';
  import { ShopBotDefenseGuard } from './shop-bot-defense.guard';
  import { ShopBotDefenseService } from './shop-bot-defense.service';

  function ctx(path: string, ua = 'Mozilla/5.0'): ExecutionContext {
    const req = { path, ip: '1.2.3.4', headers: { 'user-agent': ua } };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => function handler() {},
      getClass: () => class Ctl {},
    } as unknown as ExecutionContext;
  }

  describe('ShopBotDefenseGuard', () => {
    let guard: ShopBotDefenseGuard;
    let service: jest.Mocked<Pick<ShopBotDefenseService,
      'getRequestRate' | 'decideAction' | 'classifyUserAgent' | 'logDetection' | 'recordRateLimit'>>;
    let reflector: { getAllAndOverride: jest.Mock };

    beforeEach(() => {
      service = {
        getRequestRate: jest.fn().mockResolvedValue(5),
        decideAction: jest.fn().mockReturnValue('LOGGED'),
        classifyUserAgent: jest.fn().mockReturnValue(null),
        logDetection: jest.fn().mockResolvedValue(undefined),
        recordRateLimit: jest.fn().mockResolvedValue(undefined),
      } as any;
      reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
      guard = new ShopBotDefenseGuard(service as unknown as ShopBotDefenseService, reflector as unknown as Reflector);
    });

    it('strips the /api global prefix before classifying the page path', async () => {
      await guard.canActivate(ctx('/api/shop/products'));
      expect(service.decideAction).toHaveBeenCalledWith(
        expect.objectContaining({ pagePath: '/shop/products' }),
      );
    });

    it('throws 429 on RATE_LIMITED by default', async () => {
      service.decideAction.mockReturnValue('RATE_LIMITED');
      await expect(guard.canActivate(ctx('/api/shop/products'))).rejects.toBeInstanceOf(HttpException);
    });

    it('does NOT throw 429 when the route opts out, but still logs', async () => {
      service.decideAction.mockReturnValue('RATE_LIMITED');
      reflector.getAllAndOverride.mockReturnValue(true);
      await expect(guard.canActivate(ctx('/api/shop/share/abc'))).resolves.toBe(true);
      expect(service.logDetection).toHaveBeenCalled();
    });

    it('still throws 403 on BLOCKED even when the route opts out of rate limiting', async () => {
      service.decideAction.mockReturnValue('BLOCKED');
      reflector.getAllAndOverride.mockReturnValue(true);
      await expect(guard.canActivate(ctx('/api/shop/share/abc'))).rejects.toBeInstanceOf(HttpException);
    });
  });
  ```
- [ ] รันให้เห็น fail:
  ```bash
  cd apps/api && npx jest src/modules/shop-bot-defense/shop-bot-defense.guard.spec.ts
  ```
  คาดหวัง fail ตั้งแต่ constructor (guard ยังรับ 1 argument) และ pagePath ยังเป็น `/api/shop/products`
- [ ] แทนที่ `apps/api/src/modules/shop-bot-defense/shop-bot-defense.guard.ts` ทั้งไฟล์ด้วย:
  ```ts
  import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
  import { Reflector } from '@nestjs/core';
  import type { Request } from 'express';
  import { ShopBotDefenseService } from './shop-bot-defense.service';
  import { SKIP_BOT_RATE_LIMIT } from './skip-bot-rate-limit.decorator';

  @Injectable()
  export class ShopBotDefenseGuard implements CanActivate {
    constructor(
      private botDefense: ShopBotDefenseService,
      private reflector: Reflector,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const req = context.switchToHttp().getRequest<Request>();
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
      const userAgent = req.headers['user-agent'] || '';
      // setGlobalPrefix('api') ทำให้ req.path เป็น /api/shop/... — ตัด prefix ออกก่อน
      // ไม่งั้นกฎที่จับ path สินค้าใน decideAction เป็น dead code (บั๊กเดิม)
      const pagePath = req.path.replace(/^\/api(?=\/|$)/, '') || '/';

      const requestRate = await this.botDefense.getRequestRate(ip);
      const action = this.botDefense.decideAction({ userAgent, requestRate, pagePath });

      const detectedType = this.botDefense.classifyUserAgent(userAgent) || 'GENERIC_BOT';
      void this.botDefense.logDetection({ ip, userAgent, pagePath, detectedType, action, signals: { requestRate } });
      void this.botDefense.recordRateLimit(ip, userAgent, pagePath);

      if (action === 'BLOCKED') {
        throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      }

      const skipRateLimit = this.reflector.getAllAndOverride<boolean>(SKIP_BOT_RATE_LIMIT, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (action === 'RATE_LIMITED' && !skipRateLimit) {
        throw new HttpException({ message: 'Too many requests', retryAfter: 60 }, HttpStatus.TOO_MANY_REQUESTS);
      }
      // CAPTCHA_REQUIRED handled in next phase (Cloudflare Turnstile)
      return true;
    }
  }
  ```
- [ ] รันให้ผ่าน + ตรวจว่าไม่ทำ suite อื่นพัง:
  ```bash
  cd apps/api && npx jest src/modules/shop-bot-defense
  ```
  คาดหวัง 2 suites passed, `Tests: 28 passed`
- [ ] commit:
  ```bash
  git add apps/api/src/modules/shop-bot-defense && git commit -m "$(cat <<'EOF'
  feat(shop-bot-defense): add @SkipBotRateLimit + strip /api prefix in guard

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 3 — share-page.util.ts: สร้าง HTML หน้าแชร์แบบ escape ทุกค่า

API ไม่เคยเสิร์ฟ HTML มาก่อน (helmet ปิด CSP ด้วยเหตุผลนี้ตรง ๆ — คอมเมนต์ "Disabled options: contentSecurityPolicy: API serves no HTML" ที่ `main.ts:85-87` และธง `contentSecurityPolicy: false` จริงที่ `main.ts:97`) — ฟังก์ชันนี้จึงต้อง escape ทุกค่าที่ inject และปิดทาง `</script>` breakout ใน JSON-LD **ห้ามพึ่ง CSP อย่างเดียว**

### Files
- Create: `apps/api/src/modules/shop-catalog/share-page.util.ts`
- Create: `apps/api/src/modules/shop-catalog/share-page.util.spec.ts`

### Interfaces
- **Produces:**
  ```ts
  export function escapeHtml(value: string): string;
  export function buildShareDescription(input: {
    title: string;
    condition: 'NEW' | 'USED';
    conditionGrade?: string;
    batteryHealth?: number;
    shopWarrantyDays?: number;
    price: number | null;
  }): string;
  export interface SharePageInput {
    title: string;
    description: string;
    brand: string;
    condition: 'NEW' | 'USED';
    price: number | null;
    imageUrl?: string;
    inStock: boolean;
    canonicalUrl: string;
    nonce: string;
  }
  export function buildSharePage(input: SharePageInput): string;
  ```
- **Consumes:** ไม่มี (pure, ไม่มี import จาก Nest/Prisma)

### Steps
- [ ] เขียนเทสต์ที่ fail ก่อน — สร้าง `apps/api/src/modules/shop-catalog/share-page.util.spec.ts`:
  ```ts
  import { buildSharePage, buildShareDescription, escapeHtml } from './share-page.util';

  const base = {
    title: 'iPhone 15 Pro 256GB Blue',
    description: 'มือสอง เกรด A · ฿29,900',
    brand: 'Apple',
    condition: 'USED' as const,
    price: 29900,
    imageUrl: 'https://cdn.example.com/a.jpg',
    inStock: true,
    canonicalUrl: 'https://www.bestchoicephone.com/products/p-1',
    nonce: 'NONCE123',
  };

  describe('escapeHtml', () => {
    it('escapes the five HTML-significant characters', () => {
      expect(escapeHtml(`<a href="x" data-y='z'>&</a>`)).toBe(
        '&lt;a href=&quot;x&quot; data-y=&#39;z&#39;&gt;&amp;&lt;/a&gt;',
      );
    });
  });

  describe('buildSharePage — XSS hardening', () => {
    it('never emits a raw <script> that came from product data', () => {
      const html = buildSharePage({ ...base, title: '<script>alert(1)</script>iPhone' });
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('escapes double quotes so an attribute cannot be broken out of', () => {
      const html = buildSharePage({ ...base, title: 'iPhone" onload="alert(1)' });
      expect(html).not.toContain('" onload="alert(1)');
      expect(html).toContain('&quot; onload=&quot;alert(1)');
    });

    it('escapes < inside the JSON-LD block so </script> cannot break out', () => {
      const html = buildSharePage({ ...base, description: 'x </script><img src=1 onerror=alert(1)>' });
      const ld = html.slice(html.indexOf('application/ld+json'));
      expect(ld).not.toContain('</script><img');
      expect(html).toContain('\\u003c/script');
    });
  });

  describe('buildSharePage — Open Graph', () => {
    it('emits og:image from the gallery image', () => {
      expect(buildSharePage(base)).toContain(
        '<meta property="og:image" content="https://cdn.example.com/a.jpg">',
      );
    });
    it('omits og:image entirely when there is no image', () => {
      const html = buildSharePage({ ...base, imageUrl: undefined });
      expect(html).not.toContain('og:image');
    });
    it('emits og:title / og:url / canonical pointing at the SPA product page', () => {
      const html = buildSharePage(base);
      expect(html).toContain('<meta property="og:title" content="iPhone 15 Pro 256GB Blue">');
      expect(html).toContain(
        '<meta property="og:url" content="https://www.bestchoicephone.com/products/p-1">',
      );
      expect(html).toContain(
        '<link rel="canonical" href="https://www.bestchoicephone.com/products/p-1">',
      );
    });
    it('emits the price meta pair when a price exists and skips it when null', () => {
      expect(buildSharePage(base)).toContain('<meta property="product:price:amount" content="29900">');
      expect(buildSharePage({ ...base, price: null })).not.toContain('product:price:amount');
    });
  });

  describe('buildSharePage — redirect', () => {
    it('emits both a meta refresh and a JS replace to the canonical URL', () => {
      const html = buildSharePage(base);
      expect(html).toContain(
        '<meta http-equiv="refresh" content="0;url=https://www.bestchoicephone.com/products/p-1">',
      );
      expect(html).toContain('window.location.replace("https://www.bestchoicephone.com/products/p-1")');
    });
    it('keeps a plain <a> fallback for crawlers/no-JS', () => {
      expect(buildSharePage(base)).toContain('href="https://www.bestchoicephone.com/products/p-1"');
    });
    it('stamps the CSP nonce on every script tag', () => {
      const html = buildSharePage(base);
      const scripts = html.match(/<script[^>]*>/g) ?? [];
      expect(scripts.length).toBe(2);
      expect(scripts.every((s) => s.includes('nonce="NONCE123"'))).toBe(true);
    });
  });

  describe('buildSharePage — JSON-LD', () => {
    it('emits Product + Offer with THB price and availability', () => {
      const html = buildSharePage(base);
      const start = html.indexOf('{', html.indexOf('application/ld+json'));
      const json = JSON.parse(html.slice(start, html.indexOf('</script>', start)));
      expect(json['@type']).toBe('Product');
      expect(json.offers.priceCurrency).toBe('THB');
      expect(json.offers.price).toBe('29900');
      expect(json.offers.availability).toBe('https://schema.org/InStock');
      expect(json.itemCondition).toBe('https://schema.org/UsedCondition');
    });
    it('drops offers entirely when there is no price', () => {
      const html = buildSharePage({ ...base, price: null });
      const start = html.indexOf('{', html.indexOf('application/ld+json'));
      const json = JSON.parse(html.slice(start, html.indexOf('</script>', start)));
      expect(json.offers).toBeUndefined();
    });
  });

  describe('buildShareDescription', () => {
    it('composes grade + battery + warranty + price for a used phone', () => {
      expect(
        buildShareDescription({
          title: 'iPhone 15 Pro 256GB',
          condition: 'USED',
          conditionGrade: 'A',
          batteryHealth: 92,
          shopWarrantyDays: 45,
          price: 29900,
        }),
      ).toBe(
        'iPhone 15 Pro 256GB · มือสอง เกรด A · แบต 92% · ประกันร้าน 45 วัน · ฿29,900 — ผ่อนได้บัตรประชาชนใบเดียว ร้าน BESTCHOICE ลพบุรี',
      );
    });
    it('says สอบถามราคา when there is no price and skips missing facts', () => {
      expect(buildShareDescription({ title: 'iPhone 16 128GB', condition: 'NEW', price: null })).toBe(
        'iPhone 16 128GB · เครื่องใหม่ มือ 1 · สอบถามราคา — ผ่อนได้บัตรประชาชนใบเดียว ร้าน BESTCHOICE ลพบุรี',
      );
    });
  });
  ```
- [ ] รันให้เห็น fail:
  ```bash
  cd apps/api && npx jest src/modules/shop-catalog/share-page.util.spec.ts
  ```
  คาดหวัง `Cannot find module './share-page.util'`
- [ ] สร้าง `apps/api/src/modules/shop-catalog/share-page.util.ts`:
  ```ts
  /**
   * หน้า "แชร์" ของสินค้า — HTML สั้น ๆ ที่ API เสิร์ฟเองเพื่อให้ LINE/Facebook
   * ดึง Open Graph ได้ (SPA ของ web-shop เป็น client-render ล้วน crawler จึงไม่เห็น
   * meta ที่ usePageMeta ใส่ตอน runtime)
   *
   * ข้อควรระวังที่ทำให้ไฟล์นี้มีอยู่:
   * - API ตัวนี้ปิด CSP ทั้งระบบ (main.ts:97 contentSecurityPolicy:false — เหตุผล
   *   "API serves no HTML" ที่คอมเมนต์ :85-87) → ทุกค่าที่
   *   inject ต้อง escape ที่นี่ ไม่พึ่ง header
   * - ชื่อ/รายละเอียดสินค้าเป็นข้อความที่แอดมินพิมพ์เอง = untrusted stored input
   */

  const SITE_NAME = 'BESTCHOICE';
  const TITLE_SUFFIX = 'BESTCHOICE ลพบุรี';

  const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
  }

  /** JSON ที่ฝังใน <script> — กัน `</script>` breakout ด้วยการ escape `<` */
  function escapeJsonForScript(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
  }

  export function buildShareDescription(input: {
    title: string;
    condition: 'NEW' | 'USED';
    conditionGrade?: string;
    batteryHealth?: number;
    shopWarrantyDays?: number;
    price: number | null;
  }): string {
    const parts: string[] = [input.title];
    parts.push(
      input.condition === 'NEW'
        ? 'เครื่องใหม่ มือ 1'
        : input.conditionGrade
          ? `มือสอง เกรด ${input.conditionGrade}`
          : 'มือสอง',
    );
    if (input.batteryHealth != null) parts.push(`แบต ${input.batteryHealth}%`);
    if (input.shopWarrantyDays != null) parts.push(`ประกันร้าน ${input.shopWarrantyDays} วัน`);
    parts.push(input.price != null && input.price > 0 ? `฿${input.price.toLocaleString('en-US')}` : 'สอบถามราคา');
    return `${parts.join(' · ')} — ผ่อนได้บัตรประชาชนใบเดียว ร้าน ${TITLE_SUFFIX}`;
  }

  export interface SharePageInput {
    title: string;
    description: string;
    brand: string;
    condition: 'NEW' | 'USED';
    price: number | null;
    imageUrl?: string;
    inStock: boolean;
    /** URL ของหน้าจริงบน SPA — ทั้ง canonical, og:url และปลายทาง redirect */
    canonicalUrl: string;
    nonce: string;
  }

  export function buildSharePage(input: SharePageInput): string {
    const title = escapeHtml(input.title);
    const description = escapeHtml(input.description);
    const url = escapeHtml(input.canonicalUrl);
    const nonce = escapeHtml(input.nonce);
    const image = input.imageUrl ? escapeHtml(input.imageUrl) : null;
    const hasPrice = input.price != null && input.price > 0;

    const jsonLd: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: input.title,
      description: input.description,
      brand: { '@type': 'Brand', name: input.brand },
      itemCondition:
        input.condition === 'NEW' ? 'https://schema.org/NewCondition' : 'https://schema.org/UsedCondition',
    };
    if (input.imageUrl) jsonLd.image = [input.imageUrl];
    if (hasPrice) {
      jsonLd.offers = {
        '@type': 'Offer',
        url: input.canonicalUrl,
        priceCurrency: 'THB',
        price: String(input.price),
        availability: input.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      };
    }

    const lines: string[] = [
      '<!doctype html>',
      '<html lang="th">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      `<title>${title} | ${TITLE_SUFFIX}</title>`,
      `<link rel="canonical" href="${url}">`,
      `<meta name="description" content="${description}">`,
      '<meta property="og:type" content="product">',
      `<meta property="og:site_name" content="${SITE_NAME}">`,
      '<meta property="og:locale" content="th_TH">',
      `<meta property="og:title" content="${title}">`,
      `<meta property="og:description" content="${description}">`,
      `<meta property="og:url" content="${url}">`,
    ];
    if (image) lines.push(`<meta property="og:image" content="${image}">`);
    if (hasPrice) {
      lines.push(`<meta property="product:price:amount" content="${String(input.price)}">`);
      lines.push('<meta property="product:price:currency" content="THB">');
    }
    lines.push(
      image ? '<meta name="twitter:card" content="summary_large_image">' : '<meta name="twitter:card" content="summary">',
      `<meta name="twitter:title" content="${title}">`,
      `<meta name="twitter:description" content="${description}">`,
    );
    if (image) lines.push(`<meta name="twitter:image" content="${image}">`);
    lines.push(
      `<meta http-equiv="refresh" content="0;url=${url}">`,
      `<script nonce="${nonce}">window.location.replace(${escapeJsonForScript(input.canonicalUrl)});</script>`,
      `<script type="application/ld+json" nonce="${nonce}">${escapeJsonForScript(jsonLd)}</script>`,
      '</head>',
      '<body>',
      `<p>กำลังพาไปที่หน้าสินค้า… <a href="${url}">${title}</a></p>`,
      '</body>',
      '</html>',
    );
    return lines.join('\n');
  }
  ```
- [ ] รันให้ผ่าน:
  ```bash
  cd apps/api && npx jest src/modules/shop-catalog/share-page.util.spec.ts
  ```
  คาดหวัง `Tests: 15 passed` (escapeHtml 1 + XSS 3 + Open Graph 4 + redirect 3 + JSON-LD 2 + description 2)
- [ ] commit:
  ```bash
  git add apps/api/src/modules/shop-catalog/share-page.util.ts apps/api/src/modules/shop-catalog/share-page.util.spec.ts && git commit -m "$(cat <<'EOF'
  feat(shop-catalog): add escaped OG/JSON-LD share page builder

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4 — `GET /api/shop/share/:id` — endpoint หน้าแชร์

**ห้าม**แตะ `firebase.json`, `setGlobalPrefix('api')`, `Dockerfile`, ลำดับ deploy — endpoint นี้วิ่งบน rewrite `/api/**` → Cloud Run ที่มีอยู่แล้วทั้ง target `admin` และ `shop` (`firebase.json:50-62`)

### Files
- Create: `apps/api/src/modules/shop-catalog/shop-share.controller.ts`
- Create: `apps/api/src/modules/shop-catalog/shop-share.controller.spec.ts`
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.module.ts` (**grep-anchor:** `controllers: [`)

### Interfaces
- **Consumes:** `ShopCatalogService.getProductDetail(productId: string): Promise<ProductDetail | null>` (**grep-anchor:** `async getProductDetail(`) — สืบทอด gate ของ B0 (readiness/`[DEMO]`) โดยอัตโนมัติ ไม่ต้องเขียน where ซ้ำ
- **Consumes:** `shopBaseUrl(): string | null` จาก `../../utils/shop-base-url.util` (env `SHOP_BASE_URL`, prod = `https://www.bestchoicephone.com` ตั้งไว้แล้วที่ `deploy-gcp.yml:358`)
- **Consumes:** `buildSharePage`, `buildShareDescription` (Task 3), `SkipBotRateLimit` (Task 2), `ShopBotDefenseGuard`
- **Produces:** `GET /api/shop/share/:id` → `200 text/html; charset=utf-8` หรือ `404` (NotFoundException มาตรฐาน)

### Steps
- [ ] เขียนเทสต์ที่ fail ก่อน — สร้าง `apps/api/src/modules/shop-catalog/shop-share.controller.spec.ts`:
  ```ts
  import { Test, TestingModule } from '@nestjs/testing';
  import { NotFoundException } from '@nestjs/common';
  import type { Response } from 'express';
  import { ShopShareController } from './shop-share.controller';
  import { ShopCatalogService } from './shop-catalog.service';
  import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

  function resMock() {
    const res = {
      setHeader: jest.fn(),
      removeHeader: jest.fn(),
      status: jest.fn(),
      send: jest.fn(),
    };
    res.status.mockReturnValue(res);
    return res as unknown as Response & {
      setHeader: jest.Mock;
      removeHeader: jest.Mock;
      status: jest.Mock;
      send: jest.Mock;
    };
  }

  const detail = {
    id: 'p-1',
    brand: 'Apple',
    model: 'iPhone 15 Pro',
    storage: '256GB',
    color: 'Blue',
    category: 'PHONE_USED',
    condition: 'USED' as const,
    description: undefined,
    gallery: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
    gallery360: [],
    cashPrice: 31900,
    installmentPrice: 34900,
    tiers: {
      A: {
        minPrice: 29900,
        maxPrice: 31900,
        units: [
          {
            id: 'u-1',
            conditionGrade: 'A',
            batteryHealth: 92,
            shopWarrantyDays: 45,
            cashPrice: 29900,
            installmentPrice: 32900,
            gallery: [],
            gallery360: [],
            accessories: [],
            qcChecklist: [],
          },
        ],
      },
    },
  };

  describe('ShopShareController', () => {
    let controller: ShopShareController;
    let catalog: { getProductDetail: jest.Mock };

    beforeEach(async () => {
      process.env.SHOP_BASE_URL = 'https://www.bestchoicephone.com';
      catalog = { getProductDetail: jest.fn().mockResolvedValue(detail) };
      const mod: TestingModule = await Test.createTestingModule({
        controllers: [ShopShareController],
        providers: [{ provide: ShopCatalogService, useValue: catalog }],
      })
        .overrideGuard(ShopBotDefenseGuard)
        .useValue({ canActivate: () => true })
        .compile();
      controller = mod.get(ShopShareController);
    });

    afterEach(() => { delete process.env.SHOP_BASE_URL; });

    it('404s when the product is not visible on the shop', async () => {
      catalog.getProductDetail.mockResolvedValue(null);
      const res = resMock();
      await expect(controller.share('nope', res)).rejects.toBeInstanceOf(NotFoundException);
      expect(res.send).not.toHaveBeenCalled();
    });

    it('serves HTML with the right content type and a short public cache', async () => {
      const res = resMock();
      await controller.share('p-1', res);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=300');
      // main.ts ยัด Pragma/Expires ให้ทุก /api/* — ต้องถอดออก ไม่งั้น CDN/crawler
      // บางตัวอ่าน Expires:0 แล้วไม่ยอม cache แม้ Cache-Control จะบอกให้ cache
      expect(res.removeHeader).toHaveBeenCalledWith('Pragma');
      expect(res.removeHeader).toHaveBeenCalledWith('Expires');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('sets a per-response CSP nonce that matches the script tags', async () => {
      const res = resMock();
      await controller.share('p-1', res);
      const csp = res.setHeader.mock.calls.find((c) => c[0] === 'Content-Security-Policy')?.[1] as string;
      const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
      expect(nonce).toBeTruthy();
      expect(res.send.mock.calls[0][0]).toContain(`nonce="${nonce}"`);
    });

    it('uses gallery[0] as og:image and the cheapest unit price', async () => {
      const res = resMock();
      await controller.share('p-1', res);
      const html = res.send.mock.calls[0][0] as string;
      expect(html).toContain('<meta property="og:image" content="https://cdn.example.com/a.jpg">');
      expect(html).toContain('<meta property="product:price:amount" content="29900">');
      // ชื่อประกอบจาก brand+model+storage+color เหมือน displayName ของ web-shop
      // (ProductDetailPage.tsx:176) จึงมี 'Apple' นำหน้าเสมอ
      expect(html).toContain('<meta property="og:title" content="Apple iPhone 15 Pro 256GB Blue">');
    });

    it('redirects to the SPA product page, not to itself', async () => {
      const res = resMock();
      await controller.share('p-1', res);
      const html = res.send.mock.calls[0][0] as string;
      expect(html).toContain('https://www.bestchoicephone.com/products/p-1');
      expect(html).not.toContain('/api/shop/share/p-1');
    });

    it('escapes a malicious product model instead of emitting raw markup', async () => {
      catalog.getProductDetail.mockResolvedValue({ ...detail, model: '<script>alert(1)</script>' });
      const res = resMock();
      await controller.share('p-1', res);
      const html = res.send.mock.calls[0][0] as string;
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });
  ```
- [ ] รันให้เห็น fail:
  ```bash
  cd apps/api && npx jest src/modules/shop-catalog/shop-share.controller.spec.ts
  ```
  คาดหวัง `Cannot find module './shop-share.controller'`
- [ ] สร้าง `apps/api/src/modules/shop-catalog/shop-share.controller.ts`:
  ```ts
  import { Controller, Get, NotFoundException, Param, Res, UseGuards } from '@nestjs/common';
  import { randomBytes } from 'crypto';
  import type { Response } from 'express';
  import { ShopCatalogService, ProductUnit } from './shop-catalog.service';
  import { buildSharePage, buildShareDescription } from './share-page.util';
  import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';
  import { SkipBotRateLimit } from '../shop-bot-defense/skip-bot-rate-limit.decorator';
  import { shopBaseUrl } from '../../utils/shop-base-url.util';

  const FALLBACK_BASE_URL = 'https://www.bestchoicephone.com';

  /**
   * หน้าแชร์สินค้า — เสิร์ฟ HTML ที่มี Open Graph + JSON-LD ให้ LINE/Facebook
   * ดึงการ์ดได้ แล้วเด้งคนจริงไป /products/:id ของ SPA
   *
   * ทำไมไม่ rewrite /products/** มาที่ API: image ของ api ไม่มี index.html ของ
   * web-shop (Dockerfile build เฉพาะ apps/api) และ setGlobalPrefix('api') ไม่มี
   * exclude → rewrite แบบนั้นทำให้ทั้งเว็บ 404 endpoint นี้จึงอยู่ใต้ /api/**
   * ซึ่ง Firebase Hosting rewrite ไป Cloud Run อยู่แล้ว
   */
  @Controller('shop')
  @UseGuards(ShopBotDefenseGuard)
  export class ShopShareController {
    constructor(private catalogService: ShopCatalogService) {}

    @Get('share/:id')
    @SkipBotRateLimit()
    async share(@Param('id') id: string, @Res() res: Response): Promise<void> {
      const detail = await this.catalogService.getProductDetail(id);
      if (!detail) throw new NotFoundException('สินค้านี้ไม่พบ');

      const units: ProductUnit[] = Object.values(detail.tiers).flatMap((t) => t.units);
      const cheapest = units.reduce<ProductUnit | undefined>(
        (min, u) => (min == null || u.cashPrice < min.cashPrice ? u : min),
        undefined,
      );

      const title = [detail.brand, detail.model, detail.storage, detail.color]
        .filter(Boolean)
        .join(' ');
      const rawPrice = cheapest?.cashPrice ?? detail.cashPrice ?? null;
      const price = rawPrice != null && rawPrice > 0 ? rawPrice : null;
      const imageUrl = detail.gallery[0] ?? cheapest?.gallery[0];

      const description =
        detail.description?.trim() ||
        buildShareDescription({
          title,
          condition: detail.condition,
          conditionGrade: cheapest?.conditionGrade !== 'unknown' ? cheapest?.conditionGrade : undefined,
          batteryHealth: cheapest?.batteryHealth,
          shopWarrantyDays: cheapest?.shopWarrantyDays,
          price,
        });

      // productId มาจากแถวใน DB (detail.id) ไม่ใช่ param ดิบ — กัน path injection
      const base = shopBaseUrl() ?? FALLBACK_BASE_URL;
      const canonicalUrl = `${base}/products/${encodeURIComponent(detail.id)}`;
      const nonce = randomBytes(16).toString('base64');

      const html = buildSharePage({
        title,
        description,
        brand: detail.brand,
        condition: detail.condition,
        price,
        imageUrl,
        inStock: units.length > 0,
        canonicalUrl,
        nonce,
      });

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // main.ts:56-62 ใส่ Cache-Control:no-store + Pragma:no-cache + Expires:0
      // ให้ทุก /api/* — หน้านี้ทับด้วย cache สั้น ๆ เพื่อลดภาระตอนลิงก์ถูกกระจาย
      // ในกลุ่มแชท (ข้อมูลล้าได้ไม่เกิน 5 นาที) และต้อง "ถอด" Pragma/Expires ทิ้ง
      // ด้วย ไม่งั้น proxy/CDN ที่ยังอ่าน header เก่าจะไม่ยอม cache
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.removeHeader('Pragma');
      res.removeHeader('Expires');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // helmet ปิด CSP ทั้งระบบ (API ไม่เคยเสิร์ฟ HTML) — ใส่เฉพาะ response นี้
      res.setHeader(
        'Content-Security-Policy',
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src https: data:; base-uri 'none'; form-action 'none'`,
      );
      res.status(200).send(html);
    }
  }
  ```
- [ ] แก้ `apps/api/src/modules/shop-catalog/shop-catalog.module.ts` — เพิ่ม import + ลงทะเบียน controller:
  ```ts
  import { Module } from '@nestjs/common';
  import { ShopCatalogController } from './shop-catalog.controller';
  import { ShopShareController } from './shop-share.controller';
  import { ShopCatalogService } from './shop-catalog.service';
  import { InstallmentPreviewService } from './installment-preview.service';
  import { PrismaModule } from '../../prisma/prisma.module';
  import { ShopBotDefenseModule } from '../shop-bot-defense/shop-bot-defense.module';

  @Module({
    imports: [PrismaModule, ShopBotDefenseModule],
    controllers: [ShopCatalogController, ShopShareController],
    providers: [ShopCatalogService, InstallmentPreviewService],
    exports: [ShopCatalogService],
  })
  export class ShopCatalogModule {}
  ```
- [ ] รันให้ผ่าน:
  ```bash
  cd apps/api && npx jest src/modules/shop-catalog
  ```
  คาดหวัง suite `shop-share.controller.spec.ts` = `Tests: 6 passed` และ suite เดิมยังเขียว
- [ ] ตรวจว่า app boot ได้จริง (route ซ้อนกันไม่พัง):
  ```bash
  cd apps/api && npx tsc --noEmit
  ```
  คาดหวัง exit 0
- [ ] commit:
  ```bash
  git add apps/api/src/modules/shop-catalog && git commit -m "$(cat <<'EOF'
  feat(shop): serve GET /api/shop/share/:id with OG card + redirect to SPA

  ไม่แตะ firebase.json / setGlobalPrefix / Dockerfile — ใช้ rewrite /api/** เดิม

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 5 — ProductUnit: สาขา / อุปกรณ์ / ตำหนิ / QC ต่อเครื่อง

วันนี้ `ProductUnit` มีแค่เกรด/แบต/กล่อง/สี/ประกัน/ราคา/IMEI/รูป — ลูกค้าถามอะไรต่อก็ต้องทัก B4 เพิ่มของที่มีอยู่ใน DB จริงเข้าไป

`Product.checklistResults` เป็น `Json?` ที่มี **2 รูปแบบ**: array `{item, category, passed, note}[]` (จาก `po-receiving.service.ts:191`) และ object `{source:'trade-in', ...}` (จาก `trade-in-lifecycle.service.ts:428`) → parser ต้อง defensive

### Files
- Create: `apps/api/src/modules/shop-catalog/product-unit-detail.util.ts`
- Create: `apps/api/src/modules/shop-catalog/product-unit-detail.util.spec.ts`
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts` — ⚠️ **B0 แก้ไฟล์นี้ไปแล้ว (แทน `shopBaseWhere`, แทน query ของ `getProductDetail` + `allUnits`, แก้ลูป tiers ให้เลิก `?? 0`)** → ใช้ **grep-anchor**: `export interface ProductUnit`, `const allUnits = await this.prisma.product.findMany(`, และลูป `for (const u of allUnits)`
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts` (**grep-anchor:** `describe('getProductDetail'`)

### Interfaces
- **Produces:**
  ```ts
  export interface QcCheckItem { item: string; passed: boolean }
  export function parseQcChecklist(raw: unknown): QcCheckItem[];
  export function parseAccessories(raw: unknown, hasBox: boolean | null | undefined): string[];
  ```
- **Produces (ขยาย):** `ProductUnit` เพิ่ม `branchName?: string`, `accessories: string[]`, `cosmeticNotes?: string`, `qcChecklist: QcCheckItem[]`
- **Consumes:** `Product.accessoriesIncluded` (Json?, B0), `Product.cosmeticNotes` (String?, B0), `Product.checklistResults` (Json?), `Product.branch.name`

### Steps
- [ ] เขียนเทสต์ที่ fail ก่อน — สร้าง `apps/api/src/modules/shop-catalog/product-unit-detail.util.spec.ts`:
  ```ts
  import { parseAccessories, parseQcChecklist } from './product-unit-detail.util';

  describe('parseQcChecklist', () => {
    it('reads the PO-receiving array shape', () => {
      expect(
        parseQcChecklist([
          { item: 'หน้าจอ', category: 'display', passed: true },
          { item: 'ลำโพง', category: 'audio', passed: false, note: 'เสียงแตก' },
        ]),
      ).toEqual([
        { item: 'หน้าจอ', passed: true },
        { item: 'ลำโพง', passed: false },
      ]);
    });
    it('returns [] for the trade-in object shape (not a checklist)', () => {
      expect(parseQcChecklist({ source: 'trade-in', tradeInId: 't1', agreedPrice: 5000 })).toEqual([]);
    });
    it('drops entries that are missing item or passed', () => {
      expect(parseQcChecklist([{ item: 'ok', passed: true }, { item: 'x' }, null, 'nope'])).toEqual([
        { item: 'ok', passed: true },
      ]);
    });
    it('returns [] for null/undefined/garbage', () => {
      expect(parseQcChecklist(null)).toEqual([]);
      expect(parseQcChecklist(undefined)).toEqual([]);
      expect(parseQcChecklist(42)).toEqual([]);
    });
    it('caps the list at 20 items so the payload cannot balloon', () => {
      const raw = Array.from({ length: 50 }, (_, i) => ({ item: `i${i}`, passed: true }));
      expect(parseQcChecklist(raw)).toHaveLength(20);
    });
  });

  describe('parseAccessories', () => {
    it('reads a string array and prepends กล่อง when hasBox', () => {
      expect(parseAccessories(['สายชาร์จ', 'หัวชาร์จ'], true)).toEqual(['กล่อง', 'สายชาร์จ', 'หัวชาร์จ']);
    });
    it('does not duplicate กล่อง when it is already listed', () => {
      expect(parseAccessories(['กล่อง', 'สายชาร์จ'], true)).toEqual(['กล่อง', 'สายชาร์จ']);
    });
    it('falls back to กล่อง only when the column is empty', () => {
      expect(parseAccessories(null, true)).toEqual(['กล่อง']);
      expect(parseAccessories(null, false)).toEqual([]);
    });
    it('ignores non-string entries and trims blanks', () => {
      expect(parseAccessories(['สายชาร์จ', 3, '', '  หูฟัง '], false)).toEqual(['สายชาร์จ', 'หูฟัง']);
    });
  });
  ```
- [ ] รันให้เห็น fail:
  ```bash
  cd apps/api && npx jest src/modules/shop-catalog/product-unit-detail.util.spec.ts
  ```
  คาดหวัง `Cannot find module './product-unit-detail.util'`
- [ ] สร้าง `apps/api/src/modules/shop-catalog/product-unit-detail.util.ts`:
  ```ts
  /**
   * ตัวแปลงคอลัมน์ Json ของ Product ให้เป็นข้อมูลที่หน้าเว็บลูกค้าแสดงได้
   *
   * checklistResults ถูกเขียนด้วย 2 รูปแบบที่ไม่เข้ากัน:
   *  - PO receiving  → ChecklistResultDto[] = {item, category, passed, note}[]
   *  - trade-in      → object {source:'trade-in', tradeInId, agreedPrice, ...}
   * จึงต้องตรวจรูปร่างก่อนเสมอ ห้าม cast ตรง ๆ
   */

  export interface QcCheckItem {
    item: string;
    passed: boolean;
  }

  const MAX_QC_ITEMS = 20;

  export function parseQcChecklist(raw: unknown): QcCheckItem[] {
    if (!Array.isArray(raw)) return [];
    const out: QcCheckItem[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as Record<string, unknown>;
      if (typeof rec.item !== 'string' || typeof rec.passed !== 'boolean') continue;
      out.push({ item: rec.item, passed: rec.passed });
      if (out.length >= MAX_QC_ITEMS) break;
    }
    return out;
  }

  export function parseAccessories(raw: unknown, hasBox: boolean | null | undefined): string[] {
    const listed = Array.isArray(raw)
      ? raw
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : [];
    if (hasBox && !listed.includes('กล่อง')) return ['กล่อง', ...listed];
    return listed;
  }
  ```
- [ ] รันให้ผ่าน:
  ```bash
  cd apps/api && npx jest src/modules/shop-catalog/product-unit-detail.util.spec.ts
  ```
  คาดหวัง `Tests: 9 passed`
- [ ] เขียนเทสต์ service ที่ fail ก่อน — แทรกใน `apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts` ต่อท้าย describe `getProductDetail` (ก่อน `});` ของ describe นั้น — **grep-anchor:** `describe('getProductDetail'`):
  ```ts
      it('exposes per-unit branch, accessories, cosmetic notes and QC checklist', async () => {
        prisma.product.findFirst.mockResolvedValue({
          id: 'p1',
          brand: 'Apple',
          model: 'iPhone 13',
          storage: '128GB',
          category: 'PHONE_USED',
          cashPrice: 13900,
          conditionGrade: 'A',
          gallery: [],
          gallery360: [],
          isOnlineVisible: true,
        });
        prisma.product.findMany.mockResolvedValue([
          {
            id: 'u1',
            conditionGrade: 'A',
            batteryHealth: 92,
            hasBox: true,
            shopWarrantyDays: 45,
            cashPrice: 13900,
            installmentPrice: 15900,
            imeiSerial: '111122223333',
            gallery: [],
            gallery360: [],
            accessoriesIncluded: ['สายชาร์จ'],
            cosmeticNotes: 'มีรอยขีดมุมล่างซ้าย',
            checklistResults: [
              { item: 'หน้าจอ', category: 'display', passed: true },
              { item: 'ลำโพง', category: 'audio', passed: false },
            ],
            branch: { name: 'สาขาลพบุรี' },
          },
        ]);

        const result = await service.getProductDetail('p1');
        const u = result!.tiers.A.units[0];

        expect(u.branchName).toBe('สาขาลพบุรี');
        expect(u.accessories).toEqual(['กล่อง', 'สายชาร์จ']);
        expect(u.cosmeticNotes).toBe('มีรอยขีดมุมล่างซ้าย');
        expect(u.qcChecklist).toEqual([
          { item: 'หน้าจอ', passed: true },
          { item: 'ลำโพง', passed: false },
        ]);
        expect(u.shopWarrantyDays).toBe(45);
        expect(prisma.product.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ include: { branch: { select: { name: true } } } }),
        );
      });

      it('degrades to empty lists when the unit has no accessories/QC data', async () => {
        prisma.product.findFirst.mockResolvedValue({
          id: 'p1',
          brand: 'Apple',
          model: 'iPhone 13',
          storage: '128GB',
          category: 'PHONE_USED',
          cashPrice: 13900,
          conditionGrade: 'A',
          gallery: [],
          gallery360: [],
          isOnlineVisible: true,
        });
        prisma.product.findMany.mockResolvedValue([
          {
            id: 'u1',
            conditionGrade: 'A',
            cashPrice: 13900,
            gallery: [],
            gallery360: [],
            imeiSerial: null,
            checklistResults: { source: 'trade-in', tradeInId: 't1' },
          },
        ]);

        const u = (await service.getProductDetail('p1'))!.tiers.A.units[0];
        expect(u.accessories).toEqual([]);
        expect(u.qcChecklist).toEqual([]);
        expect(u.branchName).toBeUndefined();
        expect(u.cosmeticNotes).toBeUndefined();
      });
  ```
- [ ] รันให้เห็น fail:
  ```bash
  cd apps/api && npx jest src/modules/shop-catalog/shop-catalog.service.spec.ts -t "per-unit branch"
  ```
  คาดหวัง `u.branchName` เป็น undefined / `u.accessories` เป็น undefined
- [ ] แก้ interface `ProductUnit` ใน `apps/api/src/modules/shop-catalog/shop-catalog.service.ts` (**grep-anchor:** `export interface ProductUnit`) เป็น:
  ```ts
  export interface ProductUnit {
    id: string;
    conditionGrade: string;
    batteryHealth?: number;
    hasBox?: boolean;
    color?: string;
    shopWarrantyDays?: number;
    cashPrice: number;
    installmentPrice: number | null;
    imeiPartial?: string; // last 4 digits
    gallery: string[];
    gallery360: string[];
    /** ชื่อสาขาที่เครื่องนี้อยู่ — ลูกค้าถามบ่อยว่า "อยู่สาขาไหน" */
    branchName?: string;
    /** อุปกรณ์ที่ให้ไปกับเครื่อง (รวม 'กล่อง' จาก hasBox) */
    accessories: string[];
    /** ตำหนิ/รอยที่แจ้งลูกค้าตรง ๆ */
    cosmeticNotes?: string;
    /** ผลตรวจ QC รายข้อ (เฉพาะที่เก็บเป็น checklist จริง) */
    qcChecklist: QcCheckItem[];
  }
  ```
- [ ] เพิ่ม import ที่หัวไฟล์เดียวกัน (ต่อท้ายบล็อก import ที่มีอยู่ — **ห้ามลบ `productReadinessWhere` ที่ B0 เพิ่มไว้**):
  ```ts
  import { parseAccessories, parseQcChecklist, QcCheckItem } from './product-unit-detail.util';
  ```
- [ ] แก้ query units (**grep-anchor:** `const allUnits = await this.prisma.product.findMany(` — บล็อกนี้ B0 แทนไปแล้วให้ใช้ `...productReadinessWhere()` **ต้องคงไว้**) เพิ่ม `include`:
  ```ts
      // ⚠️ where ก้อนนี้เป็นของ B0 (readiness fragment) — **ห้ามเขียนกลับเป็น
      // deletedAt/isOnlineVisible/status แบบเดิม** เพิ่มแค่ `include` เท่านั้น
      const allUnits = await this.prisma.product.findMany({
        where: {
          model: product.model,
          storage: product.storage,
          category: product.category,
          ...productReadinessWhere(),
        },
        orderBy: { cashPrice: 'asc' },
        include: { branch: { select: { name: true } } },
      });
  ```
  (ถ้าเปิดไฟล์แล้วรูปของ `where` ต่างจากนี้ = B0 ปรับเพิ่ม → **คงรูปที่เจอจริงไว้ แล้วเติมแค่บรรทัด `include:`**)
- [ ] แก้การสร้าง unit ใน loop (**grep-anchor:** `tiers[grade].units.push({` — B0 แก้บรรทัด `const price = ...` ในลูปนี้ไปแล้ว **ห้ามย้อน**) เพิ่ม 4 ฟิลด์ท้าย:
  ```ts
        tiers[grade].units.push({
          id: u.id,
          conditionGrade: grade,
          batteryHealth: u.batteryHealth ?? undefined,
          hasBox: u.hasBox ?? undefined,
          color: u.color ?? undefined,
          shopWarrantyDays: u.shopWarrantyDays ?? undefined,
          cashPrice: price,
          installmentPrice: u.installmentPrice != null ? Number(u.installmentPrice) : null,
          imeiPartial,
          gallery: u.gallery,
          gallery360: u.gallery360,
          branchName: u.branch?.name ?? undefined,
          accessories: parseAccessories(u.accessoriesIncluded, u.hasBox),
          cosmeticNotes: u.cosmeticNotes ?? undefined,
          qcChecklist: parseQcChecklist(u.checklistResults),
        });
  ```
- [ ] รันให้ผ่าน + ยืนยันว่า assertion "ไม่รั่ว costPrice" เดิมยังเขียว:
  ```bash
  cd apps/api && npx jest src/modules/shop-catalog/shop-catalog.service.spec.ts
  ```
  คาดหวัง **จำนวนเทสต์ = baseline ของไฟล์นี้ที่จดไว้ใน Task 0 + 2** และไม่มี failed (ห้ามยึดเลข 20/22 ตายตัว — B0 เพิ่มเคสในไฟล์นี้ไปแล้ว)
- [ ] commit:
  ```bash
  git add apps/api/src/modules/shop-catalog && git commit -m "$(cat <<'EOF'
  feat(shop-catalog): expose branch, accessories, cosmetic notes and QC per unit

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 6 — ผ่อนเริ่มต้นจริง: `_min(installmentPrice)` + resolver ของ B3

`monthlyPaymentFrom` วันนี้คำนวณจาก `_min(cashPrice)` × rate ปลอม `0.0099` (ค่าคงที่ `INTEREST_RATE_PER_MONTH` + เมธอด `calculateMonthlyPayment` ท้ายคลาส) → เลขบนหน้ารายการไม่ตรงกับเลขที่ทำสัญญาได้จริง B4 ย้ายมาใช้ `installmentPrice` + `InterestConfig` ผ่าน `calcBcInstallment` ตัวเดียวกับ preview

**นิยาม "ผ่อนเริ่มต้น" (spec §6):** งวดยาวสุดที่มีเรตในตาราง + ดาวน์ต่ำสุดตาม config → ค่างวดต่ำสุดที่เป็นไปได้จริง; กลุ่มที่ไม่มี `installmentPrice` → `null` (หน้าเว็บไม่แสดงบรรทัดผ่อน)

> 🚫 **ห้ามสร้าง `bc-installment-config.service.ts`** — **B3 ทำ resolver ตัวนี้ไปแล้ว** เป็น pure util ที่ `apps/api/src/utils/bc-installment-config.util.ts` (`resolveBcConfigForCategory`) และ **re-point `InstallmentPreviewService.previewBc` ไปใช้แล้ว** (หลัง B3 บล็อก resolve ใน `previewBc` เหลือบรรทัดเดียว จึงไม่มี "โค้ดให้ยกมาทั้งดุ้น" อีกต่อไป). B4 แค่ **เรียก util ตัวเดียวกัน**
> 🚫 **ห้ามแตะ constructor ของ `InstallmentPreviewService`** (และห้ามแตะ `installment-preview.service.ts`/`.spec.ts` เลยใน batch นี้) — B3 มี golden parity test ผูกกับ constructor รูปปัจจุบัน การเพิ่ม dependency เข้าไปจะทำ B3 พัง. `resolveBcConfigForCategory` รับ `prisma` เป็น argument อยู่แล้ว จึงไม่ต้องแก้ DI ของใครทั้งสิ้น

### Files
- Create: `apps/api/src/modules/shop-catalog/shop-catalog.installment-parity.spec.ts`
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts` — **ใช้ grep-anchor จาก Task 0 ไม่ใช่เลขบรรทัด** (B0 แก้ไฟล์นี้ไปแล้ว: ลบ `SHOP_BRAND`/`PHONE_CATEGORIES`, ย่อ `shopBaseWhere`, แก้ `getProductDetail` → ทุกอย่างใต้นั้นเลื่อนขึ้น ~6 บรรทัด). จุดที่แก้: interface `ProductGroup` (บรรทัดที่ match `monthlyPaymentFrom: number;`), บล็อกค่าคงที่ (บรรทัดที่ match `INTEREST_RATE_PER_MONTH`), ทั้ง 2 `groupBy` (บรรทัดที่ match `_min: { cashPrice: true },`), ทั้ง 2 จุดคำนวณ monthly (บรรทัดที่ match `this.calculateMonthlyPayment(`), และเมธอด `calculateMonthlyPayment` ท้ายคลาส
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts` (mock prisma, assertion `_min`, เทสต์ `monthlyPaymentFrom` = 0 — หา describe/it ด้วยชื่อเทสต์ ไม่ใช่เลขบรรทัด เพราะ B0 เพิ่ม/แก้เคสในไฟล์นี้ไปแล้ว 6 เคส)

### Interfaces
- **Produces (เปลี่ยน type):** `ProductGroup.monthlyPaymentFrom: number | null`
- **Consumes (จาก B3):** `resolveBcConfigForCategory(prisma, category): Promise<{ found: boolean; config?: BcConfig }>` จาก `../../utils/bc-installment-config.util`
- **Consumes:** `BcConfig = { minDownPct: Decimal; commissionPct: Decimal; vatPct: Decimal; ratePctByMonths: Map<number, Decimal>; allowedMonths: number[] }` จาก `../../utils/installment-calc.types`
- **Consumes:** `calcBcInstallment(input: BcCalcInput): BcCalcOutput` จาก `../../utils/installment-calc.util` (field `config` รับ `BcConfig` ตรง ๆ)

### Steps
- [ ] ยืนยันว่า resolver ของ B3 อยู่แล้วจริง (ถ้าไม่เจอ = B3 ยังไม่ merge → หยุด):
  ```bash
  cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
  grep -n 'export async function resolveBcConfigForCategory' src/utils/bc-installment-config.util.ts
  grep -n 'resolveBcConfigForCategory' src/modules/shop-catalog/installment-preview.service.ts
  ```
- [ ] เขียน parity golden ที่ fail ก่อน — สร้าง `apps/api/src/modules/shop-catalog/shop-catalog.installment-parity.spec.ts`:
  ```ts
  import { Test, TestingModule } from '@nestjs/testing';
  import { Prisma } from '@prisma/client';
  import { ShopCatalogService } from './shop-catalog.service';
  import { InstallmentPreviewService } from './installment-preview.service';
  import { PrismaService } from '../../prisma/prisma.service';

  /**
   * Red line §10: หน้ารายการกับหน้ารายละเอียดต้องอ้างเลขเดียวกัน
   * ถ้าใครแก้ config resolution หรือ input ของ calcBcInstallment ข้างใดข้างหนึ่ง
   * เทสต์นี้จะแดงทันที
   */
  describe('ผ่อนเริ่มต้นหน้ารายการ === InstallmentPreviewService ที่ input เดียวกัน', () => {
    const INTEREST_CONFIG = {
      id: 'c1',
      minDownPaymentPct: new Prisma.Decimal('0.15'),
      storeCommissionPct: new Prisma.Decimal('0.10'),
      vatPct: new Prisma.Decimal('0.07'),
      minInstallmentMonths: 5,
      maxInstallmentMonths: 12,
      interestRate: new Prisma.Decimal('0.0417'),
      rates: [{ months: 12, ratePct: new Prisma.Decimal('0.50'), deletedAt: null }],
    };

    let catalog: ShopCatalogService;
    let preview: InstallmentPreviewService;
    let prisma: any;

    beforeEach(async () => {
      prisma = {
        product: { findMany: jest.fn(), findFirst: jest.fn(), groupBy: jest.fn(), findUnique: jest.fn() },
        interestConfig: { findFirst: jest.fn().mockResolvedValue(INTEREST_CONFIG) },
        gfinModelMapping: { findMany: jest.fn() },
        gfinOverpriceRule: { findMany: jest.fn() },
        gfinRateFactor: { findFirst: jest.fn() },
      };
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          ShopCatalogService,
          InstallmentPreviewService,
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      catalog = mod.get(ShopCatalogService);
      preview = mod.get(InstallmentPreviewService);
    });

    it('คืนค่างวดจาก installmentPrice + InterestConfig (ไม่ใช่ rate ปลอม 0.0099)', async () => {
      prisma.product.groupBy.mockResolvedValue([
        {
          brand: 'Apple',
          model: 'iPhone 14 Pro',
          storage: '128GB',
          category: 'PHONE_USED',
          _min: { cashPrice: 17900, installmentPrice: 19900 },
          _count: { id: 2 },
        },
      ]);
      prisma.product.findFirst.mockResolvedValue({ id: 'rep', gallery: [], conditionGrade: 'A' });
      prisma.product.findUnique.mockResolvedValue({
        id: 'rep',
        installmentPrice: new Prisma.Decimal('19900'),
        prices: [],
        category: 'PHONE_USED',
        brand: 'Apple',
        model: 'iPhone 14 Pro',
        storage: '128GB',
        deletedAt: null,
      });

      const list = await catalog.listGroupedByModel({});
      const p = await preview.preview({ productId: 'rep', provider: 'BC', months: 12 });

      expect(p.available).toBe(true);
      expect(list.data[0].monthlyPaymentFrom).toBe(Math.ceil(p.monthlyPayment!));
      // golden: 19,900 / 12 งวด / ดาวน์ 15% → 2,413.21 → ปัดขึ้นเป็น 2,414
      expect(list.data[0].monthlyPaymentFrom).toBe(2414);
    });

    it('คืน null เมื่อกลุ่มไม่มี installmentPrice (หน้าเว็บจะไม่แสดงบรรทัดผ่อน)', async () => {
      prisma.product.groupBy.mockResolvedValue([
        {
          brand: 'Apple',
          model: 'iPhone 12',
          storage: '64GB',
          category: 'PHONE_USED',
          _min: { cashPrice: 9900, installmentPrice: null },
          _count: { id: 1 },
        },
      ]);
      prisma.product.findFirst.mockResolvedValue({ id: 'rep2', gallery: [], conditionGrade: 'B' });

      const list = await catalog.listGroupedByModel({});
      expect(list.data[0].monthlyPaymentFrom).toBeNull();
      expect(list.data[0].minPrice).toBe(9900);
    });

    it('คืน null เมื่อไม่มี InterestConfig ที่ใช้ได้ — ไม่เดาเลขเอง', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(null);
      prisma.product.groupBy.mockResolvedValue([
        {
          brand: 'Apple',
          model: 'iPhone 15',
          storage: '128GB',
          category: 'PHONE_NEW',
          _min: { cashPrice: 29900, installmentPrice: 32900 },
          _count: { id: 1 },
        },
      ]);
      prisma.product.findFirst.mockResolvedValue({ id: 'rep3', gallery: [], conditionGrade: null });

      const list = await catalog.listGroupedByModel({});
      expect(list.data[0].monthlyPaymentFrom).toBeNull();
    });

    it('resolve InterestConfig ไม่เกิน 1 ครั้งต่อ category ต่อ 1 request', async () => {
      prisma.product.groupBy.mockResolvedValue([
        { brand: 'Apple', model: 'A', storage: '128GB', category: 'PHONE_USED', _min: { cashPrice: 1, installmentPrice: 19900 }, _count: { id: 1 } },
        { brand: 'Apple', model: 'B', storage: '128GB', category: 'PHONE_USED', _min: { cashPrice: 2, installmentPrice: 19900 }, _count: { id: 1 } },
        { brand: 'Apple', model: 'C', storage: '256GB', category: 'PHONE_NEW', _min: { cashPrice: 3, installmentPrice: 19900 }, _count: { id: 1 } },
      ]);
      prisma.product.findFirst.mockResolvedValue({ id: 'rep', gallery: [], conditionGrade: 'A' });

      await catalog.listGroupedByModel({});
      expect(prisma.interestConfig.findFirst).toHaveBeenCalledTimes(2);
    });
  });
  ```
- [ ] รันให้เห็น fail:
  ```bash
  cd apps/api && npx jest src/modules/shop-catalog/shop-catalog.installment-parity.spec.ts
  ```
  คาดหวัง fail (ได้เลขจาก rate ปลอม 0.0099)
- [ ] แก้ `shop-catalog.service.ts` — หัวไฟล์: เพิ่ม import (**คง import ที่ B0 ใส่ไว้ เช่น `productReadinessWhere` ห้ามลบ**) แล้วลบค่าคงที่ rate ปลอม:
  ```ts
  import Decimal from 'decimal.js';
  import { calcBcInstallment } from '../../utils/installment-calc.util';
  import { resolveBcConfigForCategory } from '../../utils/bc-installment-config.util';
  import type { BcConfig } from '../../utils/installment-calc.types';
  import { parseAccessories, parseQcChecklist, QcCheckItem } from './product-unit-detail.util';
  ```
  **grep-anchor:** `grep -n "INTEREST_RATE_PER_MONTH\|DEFAULT_MONTHS\|DEFAULT_DOWN_PCT" src/modules/shop-catalog/shop-catalog.service.ts` → ลบ 3 บรรทัดนั้นทิ้ง (อย่ายึดเลข 48-50 — B0 อาจเลื่อนไปแล้ว)
- [ ] แก้ `ProductGroup.monthlyPaymentFrom` (**grep-anchor:** บรรทัดที่ match `monthlyPaymentFrom: number;` ใน `export interface ProductGroup`) เป็น:
  ```ts
    /** ค่างวดต่ำสุดที่ทำสัญญาได้จริง (งวดยาวสุด + ดาวน์ต่ำสุด); null = ยังไม่ตั้งราคาผ่อน */
    monthlyPaymentFrom: number | null;
  ```
- [ ] **constructor ของ `ShopCatalogService` คงเดิม** (`constructor(private prisma: PrismaService) {}`) — resolver ของ B3 เป็น pure function รับ prisma เป็น argument จึงไม่ต้องเพิ่ม dependency ใด ๆ
- [ ] เพิ่ม private helper ท้ายคลาส (**grep-anchor:** แทนที่เมธอด `calculateMonthlyPayment(price: number, months: number, downPct: number)` ทั้งเมธอด — หาได้ด้วย `grep -n "calculateMonthlyPayment" ...`):
  ```ts
    /**
     * "ผ่อนเริ่มต้น" ของกลุ่ม = ค่างวดต่ำสุดที่ทำสัญญาได้จริง
     * (งวดยาวสุดที่มีเรต + ดาวน์ขั้นต่ำตาม InterestConfig) ผ่านเครื่องคิดตัวเดียว
     * กับ InstallmentPreviewService — ห้ามคำนวณเองด้วยสูตรย่อ
     */
    private monthlyFrom(installmentPrice: number | null, config: BcConfig | null): number | null {
      if (installmentPrice == null || installmentPrice <= 0) return null;
      if (!config || config.allowedMonths.length === 0) return null;
      const months = config.allowedMonths[config.allowedMonths.length - 1];
      const result = calcBcInstallment({
        installmentPrice: new Decimal(installmentPrice),
        months,
        downPct: config.minDownPct,
        config,
      });
      if (!result.isValid) return null;
      return Math.ceil(result.monthlyPayment.toNumber());
    }

    /** resolve config ครั้งเดียวต่อ category ต่อ request (กลุ่มมีได้แค่ 2 category) */
    private async resolveConfigsFor(categories: string[]): Promise<Map<string, BcConfig | null>> {
      const unique = Array.from(new Set(categories));
      const entries = await Promise.all(
        unique.map(async (c) => {
          const r = await resolveBcConfigForCategory(this.prisma, c);
          return [c, r.found ? r.config! : null] as const;
        }),
      );
      return new Map(entries);
    }
  ```
- [ ] แก้ `listGroupedByModel` — groupBy (**grep-anchor:** บรรทัดแรกที่ match `_min: { cashPrice: true },`) เพิ่ม `_min.installmentPrice`:
  ```ts
      const groups = await this.prisma.product.groupBy({
        by: [...GROUP_BY],
        where,
        _min: { cashPrice: true, installmentPrice: true },
        _count: { id: true },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      });

      const configs = await this.resolveConfigsFor(groups.map((g) => g.category));
  ```
- [ ] แก้ตัวคำนวณใน map — **grep-anchor:** บล็อก 6 บรรทัดที่ขึ้นต้นด้วย `const minPrice = g._min?.cashPrice != null ...` และจบที่ `: 0;` ของ `this.calculateMonthlyPayment(...)` ตัวแรก (**ห้ามกินบล็อก `return {` ที่ตามมา**) แทนด้วย:
  ```ts
          const minPrice = g._min?.cashPrice != null ? Number(g._min.cashPrice) : null;
          const minInstallment =
            g._min?.installmentPrice != null ? Number(g._min.installmentPrice) : null;
          const stockCount = g._count?.id ?? 0;
          const monthly = this.monthlyFrom(minInstallment, configs.get(g.category) ?? null);
  ```
  (บรรทัด `monthlyPaymentFrom: monthly,` คงเดิม)
- [ ] แก้ `listRelated` แบบเดียวกัน (**grep-anchor:** `_min: { cashPrice: true },` **ตัวที่สอง** และ `this.calculateMonthlyPayment(` **ตัวที่สอง**) — เป็น `_min: { cashPrice: true, installmentPrice: true }`, เพิ่ม `const configs = await this.resolveConfigsFor(groups.map((g) => g.category));` ใต้ groupBy และแทนบล็อก `const minPrice ... : 0;` ด้วย:
  ```ts
          const minPrice = g._min?.cashPrice != null ? Number(g._min.cashPrice) : null;
          const minInstallment =
            g._min?.installmentPrice != null ? Number(g._min.installmentPrice) : null;
          const monthly = this.monthlyFrom(minInstallment, configs.get(g.category) ?? null);
  ```
- [ ] **providers ใน `shop-catalog.service.spec.ts` คงเดิม** (ไม่มี service ใหม่ให้ลงทะเบียน) — แต่ต้องเพิ่ม `interestConfig: { findFirst: jest.fn().mockResolvedValue(null) }` ใน mock prisma (**grep-anchor:** ก้อน `const prisma = {` ที่หัวไฟล์) ไม่งั้น `resolveBcConfigForCategory` จะเรียก `prisma.interestConfig.findFirst` แล้ว throw
- [ ] อัปเดตเทสต์เดิมที่ผูกกับพฤติกรรมเก่า (**grep-anchor:** ทุกก้อนที่ match `_min: { cashPrice`) — เปลี่ยน `_min: { cashPrice: null }` เป็น `_min: { cashPrice: null, installmentPrice: null }` และ assertion ของเคสนั้นเป็น:
  ```ts
        expect(result.data[0].monthlyPaymentFrom).toBeNull();
  ```
  และเคสอื่น ๆ (`groups by category ...`, `uses cashPrice (not costPrice) ...`, `listRelated`) เพิ่ม `installmentPrice: null` เข้าไปใน `_min` ทุกก้อน — **รวมถึงเคสใหม่ที่ B0 เพิ่มเข้ามาในไฟล์นี้ด้วย** (`grep -c "_min: { cashPrice"` ก่อน/หลังแก้ต้องได้เท่ากัน)
- [ ] **อัปเดต assertion ที่จะแดงแน่ ๆ** — เคส `uses cashPrice (not costPrice)...` ยืนยัน shape ของ `_min` ที่ส่งเข้า groupBy ตรง ๆ (**grep-anchor:** `_min: { cashPrice: true }` ใน `toHaveBeenCalledWith`) ต้องแก้เป็น:
  ```ts
        expect(prisma.product.groupBy).toHaveBeenCalledWith(
          expect.objectContaining({ _min: { cashPrice: true, installmentPrice: true } }),
        );
  ```
  (ถ้าไม่แก้ เทสต์นี้จะ fail ทันทีที่เพิ่ม `installmentPrice: true` ใน groupBy)
- [ ] **`shop-catalog.module.ts` ไม่ต้องเพิ่ม provider ใหม่ใน Task นี้** — resolver เป็น pure util (`providers` เดิม `[ShopCatalogService, InstallmentPreviewService]` คงไว้; controller ใหม่ของ Task 4 ลงทะเบียนไปแล้ว)
- [ ] รันให้ผ่านทั้งโมดูล:
  ```bash
  cd apps/api && npx jest src/modules/shop-catalog
  ```
  คาดหวัง 6 suites passed, ไม่มี failed; parity spec `Tests: 4 passed`
  (6 suites = shop-catalog.service + installment-preview.service ของเดิม + share-page.util + shop-share.controller + product-unit-detail.util + installment-parity ของ B4)
- [ ] **ยืนยันว่าไม่ได้แตะ `installment-preview.service.ts`/`.spec.ts`** (ของ B3):
  ```bash
  cd /Users/iamnaii/Desktop/App/BESTCHOICE && git diff --name-only | grep installment-preview || echo "PREVIEW_UNTOUCHED"
  ```
  คาดหวัง `PREVIEW_UNTOUCHED`
- [ ] commit:
  ```bash
  git add apps/api/src/modules/shop-catalog && git commit -m "$(cat <<'EOF'
  feat(shop-catalog): real ผ่อนเริ่มต้น from installmentPrice via B3 InterestConfig resolver

  เลิกใช้ rate ปลอม 0.0099 บนหน้ารายการ; เพิ่ม _min(installmentPrice) ใน groupBy และ
  เรียก resolveBcConfigForCategory (util ของ B3) ตัวเดียวกับที่ previewBc ใช้
  พร้อม golden parity test ยืนยันว่าเลขสองหน้าตรงกัน

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 7 — ค้นหาไทยผ่าน util ของ B0 (AND-composable ห้าม assign `where.OR`)

โค้ดเดิมใน `listGroupedByModel` **assign** `where.OR = [...]` ตรง ๆ ซึ่งจะทับ/ชนกับ readiness fragment ของ B0 ที่คืน `{AND:[...]}` — Task นี้เปลี่ยนเป็นต่อ `where.AND` เสมอ

⚠️ **สีต้องไม่อยู่ใน where:** `parseDeviceQuery` คืนสีเป็น**คำไทย** (`'ดำ'`/`'น้ำเงิน'`/`'ทอง'` — ดู `COLORS` ใน util ของ B0) ขณะที่ `Product.color` ในฐานข้อมูลเก็บเป็น**อังกฤษ** (`'Black'`/`'Blue'`/`'Gold'`/`'Natural Titanium'` — `prisma/seed.ts` POItems และ `prisma/seed-demo-products.ts`) → ถ้าใส่ `{ color: { contains: parsed.color } }` เป็น AND clause คำค้น `'ไอโฟน 15 สีดำ'` จะได้ **0 ผลลัพธ์** (แย่กว่าเดิมที่ยังเจอ iPhone 15 อยู่) และ **B4 ไม่มี test runner ฝั่ง web-shop จึงไม่มีอะไรจับได้เลย**. ทำแบบ B3 (`search-products.tool.ts`) คือกรองสีแบบ **post-query narrowing ที่ no-op เมื่อไม่ match** (`if (byColor.length > 0) candidates = byColor`) ไม่ใช่เงื่อนไข where

### Files
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts` (**grep-anchor:** บล็อก `if (filters.search?.trim()) { ... where.OR = [ ... ]; }` — หาได้ด้วย `grep -n "filters.search" ...`; อย่ายึดเลข 94-100 เพราะ B0 แก้ไฟล์นี้ไปแล้ว)
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts` (**grep-anchor:** เทสต์ชื่อ `filters by search text on brand OR model (case-insensitive)` และ `ignores a blank search string`)

### Interfaces
- **Consumes (จาก B0):** `parseDeviceQuery(utterance: string): { brand: string | null; model: string | null; storage: string | null; color: string | null; rest: string }` จาก `../../utils/device-query-normalize.util` — ใช้ชื่อจริงที่จดไว้จาก Task 0; **ห้ามเขียน util ซ้ำ**
- **Produces:** `listGroupedByModel(filters)` — `filters.search` รองรับคำไทย (ไอโฟน / โปรแม็กซ์ / 15pm / ความจุ) และ **ไม่พังเมื่อลูกค้าพิมพ์สีไทย** (สีถูกละเลยอย่างปลอดภัย ไม่ทำให้ผลลัพธ์เป็นศูนย์)

### Steps
- [ ] เขียนเทสต์ที่ fail ก่อน — แทนที่เทสต์ `filters by search text on brand OR model (case-insensitive)` และเพิ่มตัวใหม่:
  ```ts
      it('แปลงคำค้นไทยเป็นเงื่อนไข AND (ไม่ assign where.OR ทับ fragment อื่น)', async () => {
        prisma.product.groupBy.mockResolvedValue([]);
        await service.listGroupedByModel({ search: ' ไอโฟน 15 โปรแม็กซ์ 256gb ' });
        const where = prisma.product.groupBy.mock.calls[0][0].where;
        expect(where.OR).toBeUndefined();
        expect(where.AND).toEqual(
          expect.arrayContaining([
            { model: { contains: 'iPhone 15 Pro Max', mode: 'insensitive' } },
            { storage: { equals: '256GB', mode: 'insensitive' } },
          ]),
        );
      });

      it('ถอยไป contains ธรรมดาเมื่อ util แปลงคำค้นไม่ออก', async () => {
        prisma.product.groupBy.mockResolvedValue([]);
        await service.listGroupedByModel({ search: 'zzzz' });
        const where = prisma.product.groupBy.mock.calls[0][0].where;
        expect(where.OR).toBeUndefined();
        expect(where.AND).toEqual([
          {
            OR: [
              { brand: { contains: 'zzzz', mode: 'insensitive' } },
              { model: { contains: 'zzzz', mode: 'insensitive' } },
            ],
          },
        ]);
      });

      it('ต่อท้าย where.AND ที่มีอยู่แล้วแทนที่จะเขียนทับ', async () => {
        prisma.product.groupBy.mockResolvedValue([]);
        await service.listGroupedByModel({ search: 'zzzz', model: 'iPhone 16' });
        const where = prisma.product.groupBy.mock.calls[0][0].where;
        expect(where.model).toBe('iPhone 16');
        expect(Array.isArray(where.AND)).toBe(true);
      });

      // สีที่ util คืนเป็นคำไทย แต่ Product.color เก็บอังกฤษ ('Black'/'Blue'/'Gold')
      // ถ้าเผลอเอา parsed.color ไปใส่ where จะได้ 0 ผลลัพธ์ทันที — เทสต์นี้ตรึงไว้
      it('ไม่เอาสี (คำไทย) ไปเป็นเงื่อนไข where — ไม่งั้นค้น "สีดำ" จะได้ 0 ผลลัพธ์', async () => {
        prisma.product.groupBy.mockResolvedValue([]);
        await service.listGroupedByModel({ search: 'ไอโฟน 15 สีดำ' });
        const where = prisma.product.groupBy.mock.calls[0][0].where;
        expect(JSON.stringify(where)).not.toContain('color');
        expect(where.AND).toEqual(
          expect.arrayContaining([{ model: { contains: 'iPhone 15', mode: 'insensitive' } }]),
        );
      });
  ```
  (เทสต์ `ignores a blank search string` คงเดิม แต่เปลี่ยน assertion เป็น `expect(where.AND).toBeUndefined();`)
- [ ] รันให้เห็น fail:
  ```bash
  cd apps/api && npx jest src/modules/shop-catalog/shop-catalog.service.spec.ts -t "คำค้นไทย"
  ```
  คาดหวัง `where.AND` undefined / `where.OR` ยังถูก assign
- [ ] แก้บล็อก `if (filters.search?.trim())` ใน `shop-catalog.service.ts` (**grep-anchor** ตาม Files ข้างบน) เป็น:
  ```ts
      if (filters.search?.trim()) {
        const q = filters.search.trim();
        // util กลางจาก B0 — ตัวเดียวกับที่บอทและ inbox ใช้ เพื่อให้ "ไอโฟน 15 โปร"
        // ที่ลูกค้าพิมพ์ในเว็บกับในแชทให้ผลเดียวกัน
        const parsed = parseDeviceQuery(q);
        const clauses: Record<string, unknown>[] = [];
        if (parsed.model) clauses.push({ model: { contains: parsed.model, mode: 'insensitive' } });
        if (parsed.storage) clauses.push({ storage: { equals: parsed.storage, mode: 'insensitive' } });
        // ⚠️ ห้ามใส่ parsed.color ลง where: util คืนคำไทย ('ดำ') แต่ Product.color
        // เก็บอังกฤษ ('Black') → จะกลายเป็นเงื่อนไขที่ไม่มีวันจริง = 0 ผลลัพธ์
        // สีใช้เป็น "narrowing แบบ no-op" หลัง query แทน (แบบเดียวกับ B3
        // search-products.tool: `if (byColor.length > 0) candidates = byColor`)
        // brand ถูกตรึงเป็น Apple ใน readiness fragment อยู่แล้ว จึงไม่ต้องใช้ parsed.brand
        if (clauses.length === 0) {
          clauses.push({
            OR: [
              { brand: { contains: q, mode: 'insensitive' } },
              { model: { contains: q, mode: 'insensitive' } },
            ],
          });
        }
        // ต่อ AND เสมอ — ห้าม assign where.OR ตรง ๆ เพราะจะทับ fragment
        // readiness/base ที่ประกอบมาเป็น {AND:[...]}
        where.AND = [...((where.AND as unknown[]) ?? []), ...clauses];
      }
  ```
  พร้อม import ที่หัวไฟล์:
  ```ts
  import { parseDeviceQuery } from '../../utils/device-query-normalize.util';
  ```
  (ถ้า Task 0 จดไว้ว่า B0 ตั้งชื่อ export อื่น ให้ใช้ชื่อนั้นแทนทั้ง 2 จุด)
- [ ] ตรวจว่าไม่มีสีหลุดเข้า where:
  ```bash
  cd apps/api && grep -n "color:" src/modules/shop-catalog/shop-catalog.service.ts | grep -v "^\s*//"
  ```
  คาดหวัง: ไม่มีบรรทัดไหนอยู่ในบล็อก `if (filters.search?.trim())` (บรรทัด `color:` ที่เจอควรเป็นของ `select`/`ProductUnit` เท่านั้น — บรรทัด comment ที่มีคำว่า `parsed.color` เป็นเจตนา ไม่ใช่โค้ด). เหตุผล: สีถูกละเลยโดยเจตนา — การ narrow ตามสีต่อ unit เป็นงานของ B3 ฝั่งแชท ซึ่งกรองบน `candidates` ที่ query มาแล้วจึง no-op ได้ปลอดภัย; ฝั่งเว็บ `listGroupedByModel` คืนเป็น **กลุ่มรุ่น** ไม่ใช่รายเครื่อง จึงไม่มีพื้นผิวให้ narrow และไม่ควรตัดผลลัพธ์ทิ้งเพราะคำสี)
- [ ] รันให้ผ่าน:
  ```bash
  cd apps/api && npx jest src/modules/shop-catalog/shop-catalog.service.spec.ts
  ```
  คาดหวังทุกตัวเขียว (ถ้าเทสต์ "ไอโฟน 15 โปรแม็กซ์" แดงเพราะ util ของ B0 คืนค่าต่างจากที่คาด → **แก้ค่าคาดหวังในเทสต์ให้ตรงกับ output จริงของ util** อย่าไปแก้ util ของ B0)
- [ ] ตรวจว่าไม่มีที่ไหนเหลือ assign `where.OR`:
  ```bash
  cd apps/api && grep -n "where.OR" src/modules/shop-catalog/shop-catalog.service.ts
  ```
  คาดหวัง: ไม่มีผลลัพธ์
- [ ] commit:
  ```bash
  git add apps/api/src/modules/shop-catalog && git commit -m "$(cat <<'EOF'
  feat(shop-catalog): Thai device search via B0 normalizer, AND-composable where

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 8 — FB: รับ standalone referral (`?ref=p:<unitId>`) แล้ว post SYSTEM message

**สภาพวันนี้:** `processMessagingEvent` (`facebook-webhook.controller.ts:175-291`) อ่าน referral เฉพาะตอนพ่วง postback (บรรทัด 230) เพื่อทำ ads attribution เท่านั้น; event ที่มีแต่ `referral` (คือกรณีที่ลูกค้า **เคยคุยกับเพจแล้ว** กด `m.me/<page>?ref=...`) ตกที่ `if (!message) return;` บรรทัด 259 → **หายเงียบ** แอดมินไม่มีทางรู้ว่ามาจากเครื่องไหน

**หลังแก้:** ลูกค้าใหม่ → GET_STARTED postback (มี referral) → routeInbound สร้างห้อง แล้วตามด้วย SYSTEM note; ลูกค้าเก่า → standalone referral → SYSTEM note ในห้องเดิม ทั้งสองทางไม่ยุ่งกับ ads attribution เดิมและไม่ใช้ `attachedProductId` (ตัดไปตาม §1)

### Files
- Modify: `apps/api/src/modules/chat-engine/services/message-router.service.ts` (เพิ่ม method ท้ายคลาส หลัง `sendStaffMessage` บรรทัด 514+)
- Modify: `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` (บรรทัด 175-291)
- Modify: `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` (เพิ่ม describe ใหม่ท้ายไฟล์)

### Interfaces
- **Produces:** `MessageRouterService.postSystemNote(roomId: string, text: string): Promise<void>`
- **Consumes:** `RoomManagerService.saveMessage({ roomId, role: MessageRole.SYSTEM, type: MessageType.TEXT, text })` (`room-manager.service.ts:214`) — role SYSTEM ไม่แตะ `unreadCount`/`firstResponseAt` แต่ดัน `lastMessageAt`
- **Consumes:** `IChatGateway.emitNewMessage(roomId, payload)` (`chat-gateway.interface.ts`)
- **Consumes:** `prisma.chatRoom.findFirst({ where: { externalUserId, channel: FACEBOOK, deletedAt: null }, orderBy: { lastMessageAt: 'desc' }, select: { id: true } })`, `prisma.product.findFirst({ where: { id, deletedAt: null }, select: {...} })`

### Steps
- [ ] เพิ่ม method ใน `apps/api/src/modules/chat-engine/services/message-router.service.ts` ต่อท้ายคลาส:
  ```ts
    /**
     * บันทึกโน้ตระบบลงห้อง (ไม่ส่งออกหาลูกค้า)
     *
     * ใช้กับเหตุการณ์ที่ทีมงานต้องเห็นในเธรดแต่ลูกค้าไม่ได้พิมพ์เอง เช่นลูกค้ากด
     * ลิงก์ Messenger จากหน้าสินค้าบนเว็บ (B4) — ข้อความมีชื่อรุ่นเต็มเพื่อให้
     * ProductContextCard/detection จับได้เหมือนลูกค้าพิมพ์ชื่อรุ่นมาเอง
     */
    async postSystemNote(roomId: string, text: string): Promise<void> {
      await this.roomManager.saveMessage({
        roomId,
        role: MessageRole.SYSTEM,
        type: MessageType.TEXT,
        text,
      });
      this.gateway?.emitNewMessage(roomId, {
        role: 'SYSTEM',
        text,
        type: MessageType.TEXT,
        roomId,
      });
    }
  ```
- [ ] เขียนเทสต์ที่ fail ก่อน — ต่อท้าย `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts`:
  ```ts
  describe('FacebookWebhookController — standalone referral จากลิงก์สินค้า (B4)', () => {
    const FB_APP_SECRET = 'secret';
    const PSID = 'psid_ref_1';
    const PRODUCT_ID = '11111111-2222-3333-4444-555555555555';

    let controller: FacebookWebhookController;
    let router: { routeInbound: jest.Mock; mirrorOutbound: jest.Mock; postSystemNote: jest.Mock };
    let prisma: { chatRoom: { findFirst: jest.Mock }; product: { findFirst: jest.Mock } };

    function referralEvent(ref: string) {
      return {
        object: 'page',
        entry: [
          {
            id: 'page1',
            time: 1,
            messaging: [
              {
                sender: { id: PSID },
                recipient: { id: 'page1' },
                timestamp: 1,
                referral: { ref, source: 'SHORTLINK', type: 'OPEN_THREAD' },
              },
            ],
          },
        ],
      };
    }

    beforeEach(async () => {
      router = {
        routeInbound: jest.fn().mockResolvedValue(undefined),
        mirrorOutbound: jest.fn().mockResolvedValue(undefined),
        postSystemNote: jest.fn().mockResolvedValue(undefined),
      };
      prisma = {
        chatRoom: { findFirst: jest.fn().mockResolvedValue({ id: 'room-1' }) },
        product: {
          findFirst: jest.fn().mockResolvedValue({
            brand: 'Apple',
            model: 'iPhone 15 Pro',
            storage: '256GB',
            color: 'Blue',
            imeiSerial: '111122223333',
          }),
        },
      };
      const mod: TestingModule = await Test.createTestingModule({
        controllers: [FacebookWebhookController],
        providers: [
          { provide: MessageRouterService, useValue: router },
          { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
          { provide: WebhookAnomalyService, useValue: { record: jest.fn() } },
          { provide: QuickReplyPostbackRouterService, useValue: { route: jest.fn().mockResolvedValue({ handled: false }) } },
          { provide: PrismaService, useValue: prisma },
          { provide: IntegrationConfigService, useValue: fbConfigMock(FB_APP_SECRET) },
        ],
      }).compile();
      controller = mod.get(FacebookWebhookController);
    });

    it('โพสต์โน้ตระบบพร้อมชื่อรุ่น + 4 ตัวท้าย IMEI เมื่อ ref เป็น p:<unitId>', async () => {
      const { req, signature } = signedRequest(FB_APP_SECRET, referralEvent(`p:${PRODUCT_ID}`));
      await controller.handleWebhook(req, referralEvent(`p:${PRODUCT_ID}`), signature);

      // ชื่อประกอบจาก brand+model+storage+color ตาม buildReferralNote → มี 'Apple' นำหน้า
      expect(router.postSystemNote).toHaveBeenCalledWith(
        'room-1',
        'ลูกค้ากดมาจากสินค้า Apple iPhone 15 Pro 256GB Blue (3333) บนเว็บ',
      );
      expect(router.routeInbound).not.toHaveBeenCalled();
    });

    it('ใช้ข้อความกลางเมื่อ ref ไม่ใช่รูปแบบสินค้า', async () => {
      const { req, signature } = signedRequest(FB_APP_SECRET, referralEvent('promo-songkran'));
      await controller.handleWebhook(req, referralEvent('promo-songkran'), signature);

      expect(prisma.product.findFirst).not.toHaveBeenCalled();
      expect(router.postSystemNote).toHaveBeenCalledWith(
        'room-1',
        'ลูกค้ากดเข้ามาจากลิงก์เว็บ (ref: promo-songkran)',
      );
    });

    it('ไม่พังเมื่อยังไม่มีห้องของ PSID นี้', async () => {
      prisma.chatRoom.findFirst.mockResolvedValue(null);
      const { req, signature } = signedRequest(FB_APP_SECRET, referralEvent(`p:${PRODUCT_ID}`));
      await expect(
        controller.handleWebhook(req, referralEvent(`p:${PRODUCT_ID}`), signature),
      ).resolves.toBe('EVENT_RECEIVED');
      expect(router.postSystemNote).not.toHaveBeenCalled();
    });

    it('ไม่พังเมื่อ productId ใน ref ไม่มีอยู่จริง', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      const { req, signature } = signedRequest(FB_APP_SECRET, referralEvent(`p:${PRODUCT_ID}`));
      await controller.handleWebhook(req, referralEvent(`p:${PRODUCT_ID}`), signature);
      expect(router.postSystemNote).toHaveBeenCalledWith(
        'room-1',
        'ลูกค้ากดเข้ามาจากลิงก์สินค้าบนเว็บ (ไม่พบสินค้านี้แล้ว)',
      );
    });

    it('ข้อความปกติที่ไม่มี referral ยังวิ่งเข้า routeInbound เหมือนเดิม', async () => {
      const body = {
        object: 'page',
        entry: [
          {
            id: 'page1',
            time: 1,
            messaging: [
              { sender: { id: PSID }, recipient: { id: 'page1' }, timestamp: 1, message: { mid: 'm1', text: 'สวัสดี' } },
            ],
          },
        ],
      };
      const { req, signature } = signedRequest(FB_APP_SECRET, body);
      await controller.handleWebhook(req, body, signature);
      expect(router.routeInbound).toHaveBeenCalledTimes(1);
      expect(router.postSystemNote).not.toHaveBeenCalled();
    });
  });
  ```
- [ ] รันให้เห็น fail:
  ```bash
  cd apps/api && npx jest src/modules/chat-adapters/facebook-webhook.controller.spec.ts -t "standalone referral"
  ```
  คาดหวัง `postSystemNote` ไม่เคยถูกเรียก (event ถูก drop ที่ `if (!message) return;`)
- [ ] แก้ `facebook-webhook.controller.ts` — แทรก **ก่อน** บรรทัด 259 (`if (!message) return;`):
  ```ts
      // Standalone referral: ลูกค้าที่เคยคุยกับเพจแล้วกด m.me/<page>?ref=...
      // Facebook ส่ง event ที่ "ไม่มี" ทั้ง message และ postback — ก่อน B4 ตกที่
      // `if (!message) return` ด้านล่างและหายเงียบ ทำให้แอดมินไม่รู้ว่ามาจากเครื่องไหน
      if (event.referral && !message && !postback) {
        await this.handleProductReferral(senderId, String(event.referral.ref ?? ''));
        return;
      }
  ```
- [ ] แทรกการโพสต์โน้ตในสาย postback ด้วย (ลูกค้าใหม่กด Get Started จะมาทางนี้) — ใน block postback หลังบรรทัด 255 `await this.messageRouter.routeInbound(inbound);` ให้เป็น:
  ```ts
        await this.messageRouter.routeInbound(inbound);
        // referral ที่พ่วงมากับ Get Started/ปุ่ม — ห้องเพิ่งถูกสร้างโดย routeInbound
        // ข้างบน จึง resolve ได้แล้วตอนนี้ (ads attribution ยังทำงานเหมือนเดิมด้านบน)
        if (referral?.ref) {
          await this.handleProductReferral(senderId, String(referral.ref));
        }
        return;
  ```
- [ ] เพิ่ม 2 private method ท้ายคลาส (ก่อน `parseMessage` บรรทัด 355):
  ```ts
    /**
     * แปลง `ref` จากลิงก์ m.me เป็นโน้ตระบบในห้องแชท
     *
     * รูปแบบที่เว็บลูกค้าส่งมา: `p:<productId>` (ดู apps/web-shop/src/lib/copy.ts)
     * เจตนา: ให้ทีมงาน + ProductContextCard เห็นว่าลูกค้ามาจากเครื่องไหน โดย
     * ไม่ต้องมีคอลัมน์สถานะใหม่ (ChatRoom.attachedProductId ถูกตัดออกจาก scope)
     */
    private async handleProductReferral(senderId: string, ref: string): Promise<void> {
      try {
        const room = await this.prisma.chatRoom.findFirst({
          where: {
            externalUserId: senderId,
            channel: ChatChannel.FACEBOOK,
            deletedAt: null,
          },
          orderBy: { lastMessageAt: 'desc' },
          select: { id: true },
        });
        if (!room) {
          this.logger.log(`[FB referral] PSID ${senderId} ref="${ref}" — ยังไม่มีห้อง ข้ามการโพสต์โน้ต`);
          return;
        }
        const text = await this.buildReferralNote(ref);
        if (!text) return;
        await this.messageRouter.postSystemNote(room.id, text);
        this.logger.log(`[FB referral] PSID ${senderId} ref="${ref}" → โน้ตระบบในห้อง ${room.id}`);
      } catch (err) {
        // referral เป็นข้อมูลเสริม — ห้ามทำให้ webhook ทั้งก้อนล้ม
        this.logger.warn(
          `[FB referral] failed for PSID ${senderId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    private async buildReferralNote(ref: string): Promise<string | null> {
      const trimmed = ref.trim();
      if (!trimmed) return null;
      if (!trimmed.startsWith('p:')) {
        return `ลูกค้ากดเข้ามาจากลิงก์เว็บ (ref: ${trimmed})`;
      }
      const productId = trimmed.slice(2);
      const product = await this.prisma.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { brand: true, model: true, storage: true, color: true, imeiSerial: true },
      });
      if (!product) return 'ลูกค้ากดเข้ามาจากลิงก์สินค้าบนเว็บ (ไม่พบสินค้านี้แล้ว)';
      const name = [product.brand, product.model, product.storage, product.color]
        .filter(Boolean)
        .join(' ');
      const tail = product.imeiSerial ? ` (${product.imeiSerial.slice(-4)})` : '';
      return `ลูกค้ากดมาจากสินค้า ${name}${tail} บนเว็บ`;
    }
  ```
- [ ] รันให้ผ่าน (ทั้งไฟล์ เพื่อยืนยันว่า echo/postback เดิมไม่พัง):
  ```bash
  cd apps/api && npx jest src/modules/chat-adapters/facebook-webhook.controller.spec.ts
  ```
  คาดหวัง `Tests: 15 passed` (10 เดิมในไฟล์นี้ + 5 ใหม่) ไม่มี failed
- [ ] ตรวจว่า `MessageRouterService` ยัง compile ได้กับผู้เรียกเดิมทุกที่:
  ```bash
  cd apps/api && npx tsc --noEmit
  ```
  คาดหวัง exit 0
- [ ] commit:
  ```bash
  git add apps/api/src/modules/chat-adapters apps/api/src/modules/chat-engine && git commit -m "$(cat <<'EOF'
  feat(chat): surface m.me ?ref=p:<productId> as a SYSTEM note in the room

  standalone referral เคยถูก drop ที่ `if (!message) return` — ตอนนี้ resolve ห้องจาก
  PSID แล้วโพสต์โน้ตชื่อรุ่น + 4 ตัวท้าย IMEI ให้ staff/detection เห็น
  (ไม่แตะ ads attribution, ไม่ใช้ attachedProductId)

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 9 — FB: ปุ่ม Get Started + endpoint ตั้งค่า messenger profile

ลูกค้า **ใหม่** ที่กด `m.me/<page>?ref=p:<id>` จะเห็นหน้าจอ Get Started ก่อน — ถ้าเพจไม่มีปุ่มนี้ Facebook จะไม่ส่ง postback+referral มาเลย ⇒ ref หาย ต้องตั้งปุ่มก่อนถึงจะได้ Task 8 ครบวง

พร้อมกันนี้ `FacebookPersistentMenuService` อ่าน creds จาก **env ตอน constructor** (บรรทัด 22-25) ขณะที่ทั้งระบบย้ายไปเก็บใน IntegrationConfig (DB) แล้ว → ถ้าเจ้าของกรอก token ผ่านหน้า Settings อย่างเดียว service นี้จะตอบ `Facebook not configured` ตลอด ต้องแก้ให้อ่านที่เดียวกับ adapter

### Files
- Modify: `apps/api/src/modules/facebook-domain/facebook-persistent-menu.service.ts` (บรรทัด 16-29 constructor/isConfigured, 35-104 `setupMenu`, 109-141 `removeMenu`)
- Modify: `apps/api/src/modules/facebook-domain/facebook-domain.module.ts` (imports)
- Modify: `apps/api/src/modules/chat-adapters/facebook-admin.controller.ts` (ทั้งไฟล์ 1-31)

### Interfaces
- **Produces:** `FacebookPersistentMenuService.setupGetStarted(): Promise<{ success: boolean; error?: string }>`
- **Produces:** route `@Controller('admin/facebook') @Post('setup-messenger-profile')` (`@Roles('OWNER')`) → `{ getStarted: {...}, menu: {...} }`
  - ⚠️ **URL ที่ยิงจริงไม่ใช่ `/api/admin/facebook/...`** — `AdminPrefixMiddleware` (`main.ts:45-46` + `common/middleware/admin-prefix.middleware.ts`) ตัด `/api/admin/` → `/api/` **ก่อน** routing เสมอ ฝั่ง admin web จึงตั้ง `API_URL = '/api/admin'` (`apps/web/src/lib/env.ts`) แล้วเรียก path `'/admin/facebook/...'` ⇒ URL เต็มคือ **`/api/admin/admin/facebook/setup-messenger-profile`** (เหมือน `backfill-profiles` ที่มีอยู่แล้ว — `IntegrationHubPage.tsx:313`) ยิง `/api/admin/facebook/...` ตรง ๆ จะได้ 404
- **Consumes:** `IntegrationConfigService.getConfig('facebook')` → `{ pageAccessToken, pageId, appSecret, verifyToken }` (registry `integration-registry.ts:173-205`, มี env fallback ในตัว)

### Steps
- [ ] แก้ `facebook-persistent-menu.service.ts` หัวคลาส (บรรทัด 16-29) เป็น:
  ```ts
  @Injectable()
  export class FacebookPersistentMenuService {
    private readonly logger = new Logger(FacebookPersistentMenuService.name);

    constructor(private readonly integrationConfig: IntegrationConfigService) {}

    /**
     * อ่าน creds จาก IntegrationConfig (DB → env fallback) ทุกครั้งที่เรียก
     * เหมือน FacebookAdapter — เดิมอ่านจาก env ตอน constructor ทำให้เพจที่ตั้งค่า
     * ผ่านหน้า Settings อย่างเดียวใช้ไม่ได้เลย
     */
    private async getCreds(): Promise<{ pageAccessToken?: string; pageId?: string }> {
      const cfg = await this.integrationConfig.getConfig('facebook');
      return {
        pageAccessToken: cfg.pageAccessToken || undefined,
        pageId: cfg.pageId || undefined,
      };
    }
  ```
  และเปลี่ยน import บรรทัด 1-2 เป็น:
  ```ts
  import { Injectable, Logger } from '@nestjs/common';
  import { IntegrationConfigService } from '../integrations/integration-config.service';
  ```
- [ ] แก้ `setupMenu` (บรรทัด 35-104): แทน guard 3 บรรทัดแรกด้วย
  ```ts
    async setupMenu(): Promise<{ success: boolean; error?: string }> {
      const { pageAccessToken, pageId } = await this.getCreds();
      if (!pageAccessToken || !pageId) {
        return { success: false, error: 'Facebook not configured' };
      }
  ```
  และเปลี่ยน 2 จุดที่อ้าง `this.pageId` / `this.pageAccessToken` (บรรทัด 79, 84) เป็น `pageId` / `pageAccessToken` (ตัว body ของ `menu` และ try/catch ที่เหลือคงเดิมทุกบรรทัด)
- [ ] แก้ `removeMenu` (บรรทัด 109-141) — เปลี่ยนแค่ 3 จุดเดียวกัน (guard + 2 การอ้าง `this.*` ที่บรรทัด 116, 121):
  ```ts
    async removeMenu(): Promise<{ success: boolean; error?: string }> {
      const { pageAccessToken, pageId } = await this.getCreds();
      if (!pageAccessToken || !pageId) {
        return { success: false, error: 'Facebook not configured' };
      }

      try {
        const res = await fetch(
          `https://graph.facebook.com/v25.0/${pageId}/messenger_profile`,
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${pageAccessToken}`,
            },
            body: JSON.stringify({ fields: ['persistent_menu'] }),
            signal: AbortSignal.timeout(10_000),
          },
        );
  ```
  (ตั้งแต่ `if (!res.ok)` ลงไปคงเดิมทั้งหมด)
- [ ] ลบ getter `isConfigured` (บรรทัด 27-29) ทิ้ง — ไม่มีผู้เรียกเหลือแล้ว (เป็น private, ใช้แค่ใน `setupMenu`/`removeMenu` ที่เพิ่งแก้) และ import `ConfigService` ที่ไม่ได้ใช้แล้วด้วย
- [ ] เพิ่ม method ใหม่ท้ายคลาส:
  ```ts
    /**
     * ตั้งปุ่ม "เริ่มต้นใช้งาน" + ข้อความทักทายของเพจ
     *
     * จำเป็นสำหรับลิงก์ m.me/<page>?ref=p:<productId> จากหน้าสินค้า: ผู้ใช้ใหม่ที่
     * ยังไม่เคยคุยกับเพจจะได้หน้าจอ Get Started ก่อน และ Facebook จะแนบ `ref`
     * มากับ postback ของปุ่มนี้เท่านั้น — ไม่มีปุ่ม = ref หายทั้งดุ้น
     */
    async setupGetStarted(): Promise<{ success: boolean; error?: string }> {
      const { pageAccessToken, pageId } = await this.getCreds();
      if (!pageAccessToken || !pageId) {
        return { success: false, error: 'Facebook not configured' };
      }

      const profile = {
        get_started: { payload: 'GET_STARTED' },
        greeting: [
          {
            locale: 'default',
            text: 'สวัสดีครับ ร้าน BESTCHOICE ลพบุรี 👋 ทักมาสอบถามรุ่น ราคา หรือยอดผ่อนได้เลยครับ',
          },
        ],
      };

      try {
        const res = await fetch(`https://graph.facebook.com/v25.0/${pageId}/messenger_profile`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${pageAccessToken}`,
          },
          body: JSON.stringify(profile),
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
          const errBody = await res.text();
          this.logger.error(`[FB Menu] Get Started setup failed ${res.status}: ${errBody}`);
          return { success: false, error: errBody };
        }

        this.logger.log('[FB Menu] Get Started button + greeting set successfully');
        return { success: true };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[FB Menu] Get Started setup error: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }
    }
  ```
- [ ] แก้ `facebook-domain.module.ts` เพิ่ม import:
  ```ts
  import { IntegrationsModule } from '../integrations/integrations.module';
  ```
  และใน `@Module({ imports: [ChatEngineModule, IntegrationsModule], ... })`
- [ ] แก้ `facebook-admin.controller.ts` เพิ่ม endpoint (ChatAdaptersModule import `FacebookDomainModule` อยู่แล้วบรรทัด 33 จึง inject ได้ทันที):
  ```ts
  import { Controller, Post, Query, UseGuards } from '@nestjs/common';
  import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
  import { RolesGuard } from '../auth/guards/roles.guard';
  import { Roles } from '../auth/decorators/roles.decorator';
  import { FacebookBackfillService } from './facebook-backfill.service';
  import { FacebookPersistentMenuService } from '../facebook-domain/facebook-persistent-menu.service';

  /**
   * OWNER-only admin actions for the Facebook integration.
   * Separate from the (public) FacebookWebhookController so it can be guarded.
   */
  @Controller('admin/facebook')
  @UseGuards(JwtAuthGuard, RolesGuard)
  export class FacebookAdminController {
    constructor(
      private readonly backfill: FacebookBackfillService,
      private readonly persistentMenu: FacebookPersistentMenuService,
    ) {}

    /**
     * Re-fetch display name + avatar for existing FB rooms (one-shot backfill).
     * Call repeatedly (onlyMissing defaults true) until `updatedPicture` is 0.
     */
    @Post('backfill-profiles')
    @Roles('OWNER')
    async backfillProfiles(
      @Query('onlyMissing') onlyMissing?: string,
      @Query('limit') limit?: string,
    ) {
      const parsedLimit = limit ? parseInt(limit, 10) : undefined;
      return this.backfill.backfillProfiles({
        onlyMissingPicture: onlyMissing !== 'false',
        limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      });
    }

    /**
     * ตั้งปุ่ม Get Started + ข้อความทักทาย + persistent menu ของเพจ (idempotent)
     * ต้องกด 1 ครั้งหลัง deploy B4 ไม่งั้นลิงก์ m.me?ref= จากหน้าสินค้าจะไม่ส่ง ref
     * มาให้ webhook สำหรับลูกค้าใหม่
     */
    @Post('setup-messenger-profile')
    @Roles('OWNER')
    async setupMessengerProfile() {
      const getStarted = await this.persistentMenu.setupGetStarted();
      const menu = await this.persistentMenu.setupMenu();
      return { getStarted, menu };
    }
  }
  ```
- [ ] ตรวจว่า DI graph ยังประกอบได้ (ไม่มี circular / provider หาย):
  ```bash
  cd apps/api && npx tsc --noEmit && npx jest src/modules/chat-adapters
  ```
  คาดหวัง exit 0 + suites ของ chat-adapters เขียวทั้งหมด
- [ ] commit:
  ```bash
  git add apps/api/src/modules/facebook-domain apps/api/src/modules/chat-adapters && git commit -m "$(cat <<'EOF'
  feat(facebook): add Get Started button setup endpoint + read creds from IntegrationConfig

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 10 — ต่อสายลิงก์แชร์ทุกผู้เรียก: web-shop + admin + inbox + บอท (+ page handle จาก IntegrationConfig)

`apps/web-shop` **ไม่มี test runner และไม่มี eslint config** → ส่วน web-shop ของ Task 10-11 ตรวจด้วย `npx tsc --noEmit` + QA เบราว์เซอร์ local เท่านั้น จึงต้องคุมให้ตรรกะบางที่สุดและรวมไว้ที่ `copy.ts` ที่เดียว (ทั้ง 2 call site ของ LINE prefill อยู่ในบล็อก CTA เดสก์ท็อป/มือถือของ `ProductDetailPage.tsx` — หาด้วย `grep -n lineOaMessageUrl`)

**⚠️ Task นี้ไม่ใช่งาน web-shop ล้วน — มันคือจุดที่ "ต่อสาย" ลิงก์แชร์เข้ากับผู้เรียกทั้งหมด** ถ้าไม่ทำครบ endpoint `GET /api/shop/share/:id` จะถูกใช้แค่จากหน้าเว็บลูกค้า ส่วนลิงก์ที่แอดมินคัดลอกส่งลูกค้า (B1), การ์ดสินค้าที่ staff ยิงในแชท (B2) และลิงก์ที่บอทตอบ (B3) จะยัง**ไม่มีการ์ด OG** ทั้งที่นั่นคือเหตุผลทั้งหมดของ endpoint นี้ — B1/B2/B3 ทุกตัวเขียนไว้ว่า "ค่อยเปลี่ยนตอน B4"

**Page handle ของ Messenger มาจาก IntegrationConfig ไม่ใช่ค่าคงที่ในซอร์ส** — ถ้า hardcode `facebookPageUsername: null` + `TODO(owner)` ไว้ในซอร์ส ปุ่มจะถูกซ่อนตลอดกาล, webhook branch ของ Task 8 จะไม่มีทางถูกกระตุ้น และเจ้าของแก้เองไม่ได้ (ต้องแก้ TS + deploy). เจ้าของกรอกค่าที่ **Settings → เชื่อมต่อ → Facebook** อยู่แล้ว จึงเสิร์ฟผ่าน `/api/shop/public-config` (พื้นผิวเดียวกับ GA4/Pixel) และมี **fallback เป็น `pageId`** ที่กรอกไว้แล้วแน่ ๆ (`https://m.me/<PAGE_ID>` ใช้ได้เท่ากับ username) ⇒ ปุ่มทำงานทันทีตั้งแต่วัน deploy

### Files
- Modify: `apps/api/src/modules/integrations/integration-registry.ts` (integration `facebook` — เพิ่ม field `pageUsername`)
- Modify: `apps/api/src/modules/shop-public-config/shop-public-config.service.ts` (เพิ่ม `getShopConfig()`)
- Modify: `apps/api/src/modules/shop-public-config/shop-public-config.controller.ts` (เพิ่ม `@Get('shop')`)
- Modify: `apps/api/src/modules/shop-public-config/shop-public-config.service.spec.ts` (เพิ่ม describe `getShopConfig`)
- Modify: `apps/web/src/pages/ProductDetailPage/utils/buildCustomerSummary.ts` (`buildShopProductUrl` — B1 สร้างไว้)
- Modify: `apps/web/src/pages/ProductDetailPage/utils/buildCustomerSummary.test.ts` (2 เทสต์ของ `buildShopProductUrl`)
- Modify: `apps/api/src/modules/staff-chat/services/chat-commerce.service.ts` (`shareUrl` 2 จุด — B2 สร้างไว้)
- Modify: `apps/api/src/modules/staff-chat/services/chat-commerce.service.spec.ts` (ค่าคาดหวังของ `shareUrl`)
- Modify: `apps/api/src/modules/sales-bot/tools/search-products.tool.ts` + `.spec.ts` (`webUrl` — B3 สร้างไว้)
- Modify: `apps/api/src/modules/sales-bot/tools/calculate-installment.tool.ts` + `.spec.ts` (`webUrl` — B3 สร้างไว้)
- Modify: `apps/web-shop/src/lib/copy.ts` (**grep-anchor:** `export const shopInfo`, `export function lineOaMessageUrl`, `product: {` ใน `copy`)

### Interfaces
- **Produces (apps/api):**
  ```ts
  // shop-public-config.service.ts
  export interface PublicShopConfig { facebookPageHandle: string | null }
  getShopConfig(): Promise<PublicShopConfig>;   // GET /api/shop/public-config/shop
  ```
- **Produces (apps/web-shop):**
  ```ts
  export function productShareUrl(productId: string): string;
  export function messengerRefUrl(productId: string, pageHandle: string | null | undefined): string | null;
  export function lineProductPrefill(displayName: string, imeiLast4: string | undefined, shareUrl: string): string;
  ```
- **Consumes:** `GET /api/shop/share/:id` (Task 4) — same-origin ทั้ง dev (vite proxy) และ prod (Firebase rewrite)
- **Consumes:** `IntegrationConfigService.getValue('facebook', 'pageUsername' | 'pageId')`
- **Consumes:** `shopBaseUrl()` — `apps/api/src/utils/shop-base-url.util.ts:10` (ผู้เรียกฝั่ง api ทั้ง 3 ตัวใช้อยู่แล้ว)

### Steps

**(ก) api — เสิร์ฟ page handle ให้ web-shop (เจ้าของกรอกเองได้ ไม่ต้อง deploy)**
- [ ] เพิ่ม field ใน `integration-registry.ts` ใต้ `pageId` ของ integration `facebook` (**grep-anchor:** `key: 'facebook',` แล้วหา block `key: 'pageId'`):
  ```ts
        {
          key: 'pageUsername',
          label: 'Page Username (ส่วนหลัง m.me/ เช่น bestchoicephone)',
          sensitive: false,
          required: false,
          envVar: 'FB_PAGE_USERNAME',
        },
  ```
  (ไม่ sensitive — เป็นข้อมูลสาธารณะที่โชว์บนหน้าเพจอยู่แล้ว; `integration-registry.spec.ts` ไม่ได้ล็อกจำนวน field จึงไม่มีเทสต์ไหนแดง)
- [ ] เพิ่มใน `shop-public-config.service.ts`:
  ```ts
  export interface PublicShopConfig {
    /**
     * ตัวระบุเพจสำหรับลิงก์ m.me/<handle>?ref=p:<productId>
     * ใช้ `pageUsername` ถ้าเจ้าของกรอกไว้ ไม่งั้นถอยไปใช้ `pageId`
     * (m.me รับได้ทั้งคู่) — เป็นข้อมูลสาธารณะของเพจ ไม่ใช่ความลับ
     */
    facebookPageHandle: string | null;
  }
  ```
  และเมธอด:
  ```ts
    async getShopConfig(): Promise<PublicShopConfig> {
      const [username, pageId] = await Promise.all([
        this.integrations.getValue('facebook', 'pageUsername'),
        this.integrations.getValue('facebook', 'pageId'),
      ]);
      const handle = username?.trim() || pageId?.trim() || null;
      return { facebookPageHandle: handle };
    }
  ```
- [ ] เพิ่ม route ใน `shop-public-config.controller.ts` (คลาสนี้ไม่มี guard โดยเจตนา — ดู `.claude/rules/security.md` รายการ `shop/public-config`):
  ```ts
    @Get('shop')
    getShop() {
      return this.service.getShopConfig();
    }
  ```
- [ ] เพิ่มเทสต์ใน `shop-public-config.service.spec.ts` (mock `getValue` มีอยู่แล้วใน providers):
  ```ts
    describe('getShopConfig', () => {
      const getValue = () =>
        (service as unknown as { integrations: { getValue: jest.Mock } }).integrations.getValue;

      it('ใช้ pageUsername เมื่อเจ้าของกรอกไว้', async () => {
        getValue().mockImplementation((_k: string, f: string) =>
          Promise.resolve(f === 'pageUsername' ? ' bestchoicephone ' : '123456'),
        );
        expect(await service.getShopConfig()).toEqual({ facebookPageHandle: 'bestchoicephone' });
      });

      it('ถอยไปใช้ pageId เมื่อยังไม่ได้กรอก username (m.me รับ id ได้)', async () => {
        getValue().mockImplementation((_k: string, f: string) =>
          Promise.resolve(f === 'pageUsername' ? '' : '123456'),
        );
        expect(await service.getShopConfig()).toEqual({ facebookPageHandle: '123456' });
      });

      it('คืน null เมื่อยังไม่ได้ตั้งค่า Facebook เลย (ปุ่มจะถูกซ่อน)', async () => {
        getValue().mockResolvedValue(undefined);
        expect(await service.getShopConfig()).toEqual({ facebookPageHandle: null });
      });
    });
  ```
  (ถ้า `service` ไม่ถือ reference ของ mock ให้ยกตัวแปร mock ออกมาเป็น `const integrations = { getValue: jest.fn() }` แล้ว inject ตัวเดียวกัน — สำคัญคือ assert 3 เคสนี้ ไม่ใช่รูปแบบการเข้าถึง mock)
- [ ] รัน:
  ```bash
  cd apps/api && npx jest src/modules/shop-public-config
  ```
  คาดหวังเขียว (3 เคสเดิม + 3 เคสใหม่)

**(ข) api/web — ต่อสายผู้เรียกเดิมทั้ง 3 ตัวให้ชี้ share endpoint**
- [ ] **แอดมิน (B1)** — `apps/web/src/pages/ProductDetailPage/utils/buildCustomerSummary.ts` แก้ `buildShopProductUrl` (B1 เขียน comment ฝากไว้ว่า "B4 จะเปลี่ยนปลายทางเป็น share endpoint — แก้ที่ฟังก์ชันนี้จุดเดียว"):
  ```ts
  /**
   * ลิงก์หน้าสินค้าฝั่งลูกค้า — ชี้ share endpoint ของ API ที่เสิร์ฟ Open Graph
   * (B4) เพื่อให้ลิงก์ที่แอดมินคัดลอกส่งลูกค้าขึ้นการ์ดใน LINE/Facebook
   * endpoint จะเด้งคนจริงต่อไปที่ /products/:id ทันที
   */
  export function buildShopProductUrl(productId: string, base: string = SHOP_BASE_URL): string {
    return `${base.replace(/\/+$/, '')}/api/shop/share/${productId}`;
  }
  ```
  แล้วแก้ 2 เทสต์ใน `buildCustomerSummary.test.ts` (**grep-anchor:** `describe('buildShopProductUrl'`) ให้คาดหวัง `.../api/shop/share/p-1` แทน `.../products/p-1`
  ```bash
  cd apps/web && npx vitest run src/pages/ProductDetailPage/utils/buildCustomerSummary.test.ts
  ```
  คาดหวังเขียวครบ (จำนวนเทสต์เท่าเดิม — แค่ค่าคาดหวังเปลี่ยน)
- [ ] **inbox (B2)** — `apps/api/src/modules/staff-chat/services/chat-commerce.service.ts` มี `shareUrl` **2 จุด** (ใน `searchProducts` และใน `sendProductCard`) รูป `base ? \`${base}/products/${...}\` : null` (**grep-anchor:** `grep -n "shareUrl" ...`) เปลี่ยนทั้ง 2 จุดเป็น:
  ```ts
      shareUrl: base ? `${base}/api/shop/share/${p.id}` : null,
  ```
  (จุดที่สองใช้ `product.id`) แล้วแก้ค่าคาดหวังใน `chat-commerce.service.spec.ts` ให้ตรง
- [ ] **บอท (B3)** — `search-products.tool.ts` และ `calculate-installment.tool.ts` มี `webUrl: base ? \`${base}/products/${...}\` : null` อย่างละ 1 จุด (**grep-anchor:** `grep -rn "products/\${" src/modules/sales-bot/tools/`) เปลี่ยนเป็น `\`${base}/api/shop/share/${...}\`` ทั้งคู่ แล้วแก้ค่าคาดหวังใน `.spec.ts` ทั้ง 2 ไฟล์ (B3 มี assertion ตรง ๆ ว่า `'https://shop.example.com/products/prd-1'`)
- [ ] ยืนยันว่าไม่มีใครสร้างลิงก์ `/products/:id` ไปให้ลูกค้าเหลืออยู่ในเส้นทาง "แชร์/ส่งลูกค้า":
  ```bash
  cd /Users/iamnaii/Desktop/App/BESTCHOICE && grep -rn "products/\${" apps/api/src/modules/staff-chat apps/api/src/modules/sales-bot apps/web/src/pages/ProductDetailPage/utils
  ```
  คาดหวัง: ไม่มีผลลัพธ์ (ลิงก์ภายในของ SPA เช่น `navigate('/products/...')` ไม่นับ — คำสั่งนี้จับเฉพาะ template literal ที่ประกอบ URL สาธารณะ)
- [ ] รันเทสต์ของโมดูลที่เพิ่งแตะ:
  ```bash
  cd apps/api && npx jest src/modules/staff-chat/services/chat-commerce.service.spec.ts src/modules/sales-bot/tools
  ```
  คาดหวังเขียว

**(ค) web-shop — copy.ts เป็นจุดแก้เดียว**
- [ ] เพิ่ม 3 helper ต่อจาก `lineOaMessageUrl` (**grep-anchor:** ท้ายฟังก์ชัน `lineOaMessageUrl`) — **ไม่ต้องแตะ `shopInfo`** (page handle มาจาก API ไม่ใช่ค่าคงที่):
  ```ts
  /**
   * ลิงก์ "แชร์สินค้า" — ชี้ไป share endpoint ของ API ที่เสิร์ฟ Open Graph
   * (SPA เป็น client-render ล้วน LINE/Facebook จึงไม่เห็น meta ที่ usePageMeta ใส่)
   * endpoint จะเด้งคนจริงต่อไปที่ /products/:id ทันที
   */
  export function productShareUrl(productId: string): string {
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://www.bestchoicephone.com';
    return `${origin}/api/shop/share/${encodeURIComponent(productId)}`;
  }

  /**
   * ลิงก์ Messenger พร้อม ref ต่อเครื่อง — webhook ฝั่ง API อ่าน `p:<productId>`
   * แล้วโพสต์โน้ตในห้องแชทให้ทีมงานรู้ว่าลูกค้ามาจากเครื่องไหน
   *
   * `pageHandle` มาจาก GET /api/shop/public-config/shop (username ที่เจ้าของกรอก
   * ในหน้า Settings หรือถอยไปใช้ pageId) — **ห้าม hardcode ในไฟล์นี้** เพราะจะทำให้
   * เจ้าของแก้เองไม่ได้และปุ่มถูกซ่อนถาวร. คืน null เมื่อยังไม่ได้ตั้งค่า Facebook เลย
   */
  export function messengerRefUrl(
    productId: string,
    pageHandle: string | null | undefined,
  ): string | null {
    if (!pageHandle) return null;
    return `https://m.me/${encodeURIComponent(pageHandle)}?ref=${encodeURIComponent(`p:${productId}`)}`;
  }

  /** ข้อความ prefill ตอนทักไลน์จากหน้าสินค้า — จุดแก้เดียวของทั้ง 2 ปุ่ม */
  export function lineProductPrefill(
    displayName: string,
    imeiLast4: string | undefined,
    shareUrl: string,
  ): string {
    const tail = imeiLast4 ? ` (${imeiLast4})` : '';
    return `สนใจ ${displayName}${tail} ${shareUrl}`;
  }
  ```
- [ ] เพิ่ม copy ใหม่ใน `copy.product` (**grep-anchor:** `product: {` ใน `export const copy`) ต่อท้าย:
  ```ts
      shareCta: 'แชร์เครื่องนี้',
      shareCopied: 'คัดลอกลิงก์แล้ว',
      shareFailed: 'คัดลอกลิงก์ไม่สำเร็จ',
      askMessengerCta: 'ทักเรื่องเครื่องนี้ทาง Messenger',
      branchLabel: 'เครื่องอยู่ที่',
      accessoriesLabel: 'อุปกรณ์ที่ได้',
      cosmeticLabel: 'ตำหนิที่แจ้งไว้',
      qcTitle: 'ผลตรวจสภาพเครื่อง',
      qcPassed: 'ผ่าน',
      qcFailed: 'ไม่ผ่าน',
  ```
- [ ] ตรวจ (รันแยกทีละคำสั่ง):
  ```bash
  cd apps/api && npx tsc --noEmit
  cd apps/web && npx tsc --noEmit
  cd apps/web-shop && npx tsc --noEmit
  ```
  คาดหวัง exit 0 ทั้งสาม
- [ ] commit:
  ```bash
  git add apps/api/src/modules/integrations apps/api/src/modules/shop-public-config \
    apps/api/src/modules/staff-chat apps/api/src/modules/sales-bot \
    apps/web/src/pages/ProductDetailPage/utils apps/web-shop/src/lib/copy.ts && git commit -m "$(cat <<'EOF'
  feat(share): point every customer-facing product link at the OG share endpoint

  แอดมิน (buildShopProductUrl), การ์ดสินค้าในแชท (chat-commerce shareUrl x2) และ
  ลิงก์ที่บอทตอบ (search-products / calculate-installment webUrl) ชี้ /api/shop/share/:id
  พร้อมเสิร์ฟ facebookPageHandle จาก IntegrationConfig ผ่าน /api/shop/public-config/shop
  (เจ้าของกรอกเองได้จากหน้า Settings ไม่ต้อง deploy) และ helper แชร์/LINE/Messenger ใน copy.ts

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 11 — web-shop: รูปตามเครื่อง + ปุ่มแชร์ + ข้อมูลจริงต่อเครื่อง

4 อาการที่แก้ในงานนี้: (1) เลือกเครื่องแล้วรูปไม่เปลี่ยน (อ่าน `data.gallery` ระดับรุ่นเสมอ) (2) ไม่มีปุ่มแชร์เลย (3) prefill ไลน์เป็น `สนใจ <ชื่อ> ครับ/ค่ะ` ไม่มีลิงก์/ไม่ระบุเครื่อง (2 call site ของ `lineOaMessageUrl`) (4) meta description hardcode `รับประกันร้าน 30 วัน` ใน `usePageMeta` ทั้งที่ `shopWarrantyDays` มีจริงต่อเครื่อง

⚠️ **เลขบรรทัดของ `ProductDetailPage.tsx` / `ProductCard.tsx` ในงานนี้เป็นค่า pre-B0/B1** — B0 แก้ `ProductDetailPage.tsx` (null cashPrice → 'สอบถามราคา') ไปแล้ว ให้ใช้ grep-anchor ที่จดไว้จาก Task 0 ทุกจุด

### Files
- Modify: `apps/web-shop/src/types/product.ts` (**grep-anchor:** `export interface ProductUnit`)
- Modify: `apps/web-shop/src/components/catalog/SpecTable.tsx` (ทั้งไฟล์)
- Modify: `apps/web-shop/src/components/catalog/ProductCard.tsx` (**grep-anchor:** `monthlyPaymentFrom` ใน type prop และในบล็อกราคา)
- Modify: `apps/web-shop/src/pages/ProductDetailPage.tsx` (**grep-anchor:** import block, `useState`/`useEffect` ของ `activeImage`/`selectedUnitId`, `usePageMeta(`, บล็อก derived ที่ขึ้นต้น `const displayName =`, `<Product360Viewer`, `lineOaMessageUrl(` ทั้ง 2 จุด)

### Interfaces
- **Consumes:** `ProductUnit` ที่ API ส่งมาใหม่จาก Task 5 (`branchName`, `accessories`, `cosmeticNotes`, `qcChecklist`)
- **Consumes:** `ProductGroup.monthlyPaymentFrom: number | null` จาก Task 6
- **Consumes:** `productShareUrl`, `messengerRefUrl(productId, pageHandle)`, `lineProductPrefill`, `copy.product.*` จาก Task 10
- **Consumes:** `GET /api/shop/public-config/shop` → `{ facebookPageHandle: string | null }` (Task 10)

### Steps
- [ ] แก้ `apps/web-shop/src/types/product.ts` (**grep-anchor:** `export interface ProductUnit`) เป็น:
  ```ts
  export interface QcCheckItem {
    item: string;
    passed: boolean;
  }

  export interface ProductUnit {
    id: string;
    conditionGrade: string;
    batteryHealth?: number;
    hasBox?: boolean;
    shopWarrantyDays?: number;
    color?: string;
    cashPrice: number;
    installmentPrice: number | null;
    imeiPartial?: string;
    gallery: string[];
    gallery360: string[];
    branchName?: string;
    accessories?: string[];
    cosmeticNotes?: string;
    qcChecklist?: QcCheckItem[];
  }
  ```
  (`accessories`/`qcChecklist` เป็น optional ฝั่ง client เพื่อกัน deploy skew ระหว่าง web กับ api)
- [ ] แทนที่ `apps/web-shop/src/components/catalog/SpecTable.tsx` ทั้งไฟล์ด้วย:
  ```tsx
  import type { ProductUnit } from '@/types/product';
  import { copy } from '@/lib/copy';

  function Row({ label, value }: { label: string; value: string }) {
    return (
      <div className="flex justify-between gap-4 py-2 border-b border-border last:border-0 text-sm leading-snug">
        <span className="text-muted-foreground shrink-0">{label}</span>
        <span className="text-foreground text-right font-medium">{value}</span>
      </div>
    );
  }

  export function SpecTable({
    unit,
    storage,
    isNew,
  }: {
    unit: ProductUnit;
    storage?: string;
    isNew: boolean;
  }) {
    // accessories มาจาก API แล้ว (รวม 'กล่อง' จาก hasBox ให้เสร็จ) — คง fallback
    // เดิมไว้เผื่อ deploy skew ที่ web ใหม่กว่า api
    const accessories =
      unit.accessories && unit.accessories.length > 0
        ? unit.accessories
        : ([unit.hasBox && 'กล่อง'].filter(Boolean) as string[]);
    const qc = unit.qcChecklist ?? [];
    const qcPassed = qc.filter((q) => q.passed).length;
    const qcFailed = qc.filter((q) => !q.passed);

    const rows: Array<{ label: string; value: string } | null> = [
      storage ? { label: 'ความจุ', value: storage } : null,
      unit.color ? { label: 'สี', value: unit.color } : null,
      !isNew && unit.batteryHealth != null
        ? { label: 'สุขภาพแบตเตอรี่', value: `${unit.batteryHealth}%` }
        : null,
      accessories.length ? { label: copy.product.accessoriesLabel, value: accessories.join(' · ') } : null,
      unit.cosmeticNotes ? { label: copy.product.cosmeticLabel, value: unit.cosmeticNotes } : null,
      unit.shopWarrantyDays != null
        ? { label: 'ประกันร้าน', value: `${unit.shopWarrantyDays} วัน` }
        : null,
      unit.branchName ? { label: copy.product.branchLabel, value: unit.branchName } : null,
      unit.imeiPartial ? { label: 'IMEI', value: unit.imeiPartial } : null,
    ];
    const visible = rows.filter((r): r is { label: string; value: string } => r !== null);
    if (visible.length === 0 && qc.length === 0) return null;

    return (
      <div className="rounded-2xl border border-border p-4 md:p-5">
        <h2 className="font-semibold text-base mb-1 leading-snug">รายละเอียดเครื่อง</h2>
        <div>
          {visible.map((r) => (
            <Row key={r.label} label={r.label} value={r.value} />
          ))}
        </div>

        {qc.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border leading-snug">
            <p className="text-sm font-medium text-foreground">
              {copy.product.qcTitle}{' '}
              <span className="num text-emerald-700">
                {copy.product.qcPassed} {qcPassed}/{qc.length} จุด
              </span>
            </p>
            {qcFailed.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                {qcFailed.map((q) => (
                  <li key={q.item}>
                    • {q.item} — {copy.product.qcFailed}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  }
  ```
- [ ] `ProductCard.tsx` — ⚠️ **B0 Step 4d ทำจุดนี้ไปแล้ว** (เปลี่ยน type เป็น `number | null` + เงื่อนไข `!= null && > 0`) ให้ **ตรวจก่อน ถ้าตรงแล้วข้าม ห้ามแก้ซ้ำ**:
  ```bash
  cd apps/web-shop && grep -n "monthlyPaymentFrom" src/components/catalog/ProductCard.tsx
  ```
  คาดหวังเห็น `monthlyPaymentFrom: number | null;` และ `) : p.monthlyPaymentFrom != null && p.monthlyPaymentFrom > 0 ? (`. ถ้ายังเป็นรูปเดิม (`number;` / `p.monthlyPaymentFrom > 0`) ให้แก้เป็น 2 บรรทัดข้างบน
- [ ] แก้ `ProductDetailPage.tsx` — เพิ่ม import (**grep-anchor:** บรรทัดที่ import จาก `lucide-react` และจาก `@/lib/copy`):
  ```tsx
  import { MessageCircle, Share2 } from 'lucide-react';
  import {
    copy,
    lineOaMessageUrl,
    lineProductPrefill,
    messengerRefUrl,
    productShareUrl,
  } from '@/lib/copy';
  ```
- [ ] ดึง page handle จาก public-config (hook ต้องอยู่**เหนือ** early-return เหมือน hook อื่นในไฟล์นี้ — วางต่อจาก `useQuery` ตัวที่ดึง product; `useQuery`/`api` import อยู่แล้ว):
  ```tsx
    // page handle ของ Messenger มาจาก IntegrationConfig (เจ้าของกรอกเองได้จากหน้า
    // Settings) ไม่ใช่ค่าคงที่ในซอร์ส — ยังไม่ตั้งค่า = ปุ่มถูกซ่อนโดยไม่พังหน้า
    const { data: shopConfig } = useQuery({
      queryKey: ['shop', 'public-config', 'shop'],
      queryFn: () =>
        api
          .get<{ facebookPageHandle: string | null }>('/api/shop/public-config/shop')
          .then((r) => r.data),
      staleTime: 5 * 60 * 1000,
    });
  ```
- [ ] เพิ่ม effect รีเซ็ตรูปเมื่อสลับเครื่อง — แทรกต่อจาก effect เดิม (**grep-anchor:** `useEffect` ตัวสุดท้ายเหนือ early-return):
  ```tsx
    // สลับเครื่องแล้ว gallery เป็นคนละชุด — index เดิมอาจชี้เกินขอบ/ชี้รูปเครื่องอื่น
    useEffect(() => {
      setActiveImage(0);
      setView360(false);
    }, [selectedUnitId]);
  ```
- [ ] แก้ block derived (**grep-anchor:** บล็อกที่ขึ้นต้นด้วย `const displayName =`) เป็นโค้ดข้างล่าง — ⚠️ **ก่อนแทน ให้เปิดไฟล์อ่านของจริงก่อน**: spec §2.1 ให้ B0 แก้ `ProductDetailPage.tsx` (null cashPrice → 'สอบถามราคา') ถ้า B0 ลงไปแล้ว บรรทัด `const price = selectedUnit?.cashPrice ?? 0;` จะไม่ใช่รูปเดิม — **ให้คงรูปที่ B0 ทิ้งไว้** แล้วเติมเฉพาะ 5 บรรทัดใหม่ท้ายบล็อก (`shareTargetId` / `shareUrl` / `imeiLast4` / `linePrefill` / `messengerUrl`) + การสลับ gallery ต่อเครื่อง ห้ามเขียนทับจนย้อน B0:
  ```tsx
    const displayName = [data.brand, data.model, data.storage, data.color].filter(Boolean).join(' ');
    const price = selectedUnit?.cashPrice ?? 0;
    const monthlyFrom =
      preview?.available && preview.monthlyPayment ? Math.ceil(preview.monthlyPayment) : null;
    const gradeKeys = Object.keys(data.tiers);
    const isNew = data.condition === 'NEW';
    const showGrades = !isNew && gradeKeys.length > 0;
    // รูปตามเครื่องที่เลือก — ถอยไปใช้รูประดับรุ่นเมื่อเครื่องนั้นยังไม่มีรูปของตัวเอง
    const unitGallery = selectedUnit?.gallery ?? [];
    const gallerySource = unitGallery.length > 0 ? unitGallery : (data.gallery ?? []);
    const gallery = gallerySource.length > 0 ? gallerySource : [media('product.placeholder')];
    const mainImage = gallery[activeImage] ?? gallery[0];
    const unitGallery360 = selectedUnit?.gallery360 ?? [];
    const gallery360 = unitGallery360.length > 0 ? unitGallery360 : data.gallery360;
    const has360 = gallery360.length > 0;
    const stockCount = flatUnits.length;
    const shareTargetId = selectedUnit?.id ?? data.id;
    const shareUrl = productShareUrl(shareTargetId);
    const imeiLast4 = selectedUnit?.imeiPartial?.slice(-4);
    const linePrefill = lineProductPrefill(displayName, imeiLast4, shareUrl);
    const messengerUrl = messengerRefUrl(shareTargetId, shopConfig?.facebookPageHandle);
  ```
- [ ] แก้ `<Product360Viewer frames={data.gallery360} ...>` (**grep-anchor:** `<Product360Viewer`) เป็น `frames={gallery360}`
- [ ] เพิ่ม handler แชร์ — ห้ามใช้ hook (จะผิด rules-of-hooks เพราะอยู่ใต้ early-return `if (isLoading || !data)`); ใช้ฟังก์ชันธรรมดาแทน โดยแทรก **หลัง** block derived ข้างบน (หลังบรรทัด `const messengerUrl = ...`):
  ```tsx
    async function handleShare() {
      const shareData = { title: displayName, text: `${displayName} — BESTCHOICE ลพบุรี`, url: shareUrl };
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share(shareData);
          return;
        } catch (err) {
          // ผู้ใช้กดยกเลิกชีทแชร์ — ไม่ต้องทำอะไรต่อ
          if ((err as Error)?.name === 'AbortError') return;
        }
      }
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.success(copy.product.shareCopied);
      } catch {
        toast.error(copy.product.shareFailed);
      }
    }
  ```
- [ ] แก้ meta description ให้ใช้ประกันจริง (**grep-anchor:** `usePageMeta(`) — ย้ายให้อ่านจาก tiers โดยตรง (hook ต้องอยู่เหนือ early-return เหมือนเดิม) เป็น:
  ```tsx
    const metaWarrantyDays =
      flatUnits.find((u) => u.shopWarrantyDays != null)?.shopWarrantyDays ?? null;
    usePageMeta(
      metaTitle,
      metaTitle
        ? `${metaTitle} ผ่อนได้บัตรประชาชนใบเดียว${metaWarrantyDays != null ? ` รับประกันร้าน ${metaWarrantyDays} วัน` : ''}`
        : undefined,
    );
  ```
- [ ] แทนที่บล็อก CTA เดสก์ท็อป (**grep-anchor:** `<div className="hidden md:flex flex-col gap-3 pt-2">` ถึงปีกกาปิดของ div นั้น — มี `lineOaMessageUrl(` call site ที่ 1 อยู่ข้างใน) ด้วย:
  ```tsx
            {/* Desktop primary CTA (mobile uses StickyBottomBar) */}
            <div className="hidden md:flex flex-col gap-3 pt-2">
              <Button
                variant="cta"
                size="lg"
                fullWidth
                onClick={() => reserveMut.mutate()}
                disabled={reserveMut.isPending}
                loading={reserveMut.isPending}
              >
                {copy.product.reserveCta}
              </Button>
              <Button
                variant="outline"
                size="lg"
                fullWidth
                onClick={() => nav(`/apply/${selectedUnit?.id ?? data.id}`)}
              >
                สมัครผ่อนทันที
              </Button>
              <Button variant="ghost" size="lg" fullWidth onClick={handleShare}>
                <Share2 className="size-4" aria-hidden="true" />
                {copy.product.shareCta}
              </Button>
              <div className="flex flex-col gap-1.5">
                <a
                  href={lineOaMessageUrl(linePrefill)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 text-sm text-emerald-700 hover:underline underline-offset-4 leading-snug"
                >
                  <MessageCircle className="size-4" aria-hidden="true" />
                  {copy.product.askLineCta}
                </a>
                {messengerUrl && (
                  <a
                    href={messengerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 text-sm text-emerald-700 hover:underline underline-offset-4 leading-snug"
                  >
                    <MessageCircle className="size-4" aria-hidden="true" />
                    {copy.product.askMessengerCta}
                  </a>
                )}
              </div>
            </div>
  ```
- [ ] แทนที่บล็อกลิงก์ไลน์มือถือ (**grep-anchor:** `<div className="md:hidden ...">` ที่มี `lineOaMessageUrl(` call site ที่ 2) ด้วย:
  ```tsx
        <div className="md:hidden flex flex-col items-center gap-2 py-3">
          <a
            href={lineOaMessageUrl(linePrefill)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 text-sm text-emerald-700 hover:underline underline-offset-4 leading-snug"
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            {copy.product.askLineCta}
          </a>
          {messengerUrl && (
            <a
              href={messengerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 text-sm text-emerald-700 hover:underline underline-offset-4 leading-snug"
            >
              <MessageCircle className="size-4" aria-hidden="true" />
              {copy.product.askMessengerCta}
            </a>
          )}
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex items-center justify-center gap-1.5 min-h-11 px-4 text-sm text-emerald-700 hover:underline underline-offset-4 leading-snug"
          >
            <Share2 className="size-4" aria-hidden="true" />
            {copy.product.shareCta}
          </button>
        </div>
  ```
- [ ] ตรวจ type + build จริง:
  ```bash
  cd apps/web-shop && npx tsc --noEmit && npm run build
  ```
  คาดหวัง exit 0 ทั้งสองคำสั่ง
- [ ] QA เบราว์เซอร์ local (prod ปฏิเสธ seed account) — เปิด 2 เทอร์มินัล:
  ```bash
  cd apps/api && npm run dev
  cd apps/web-shop && npm run dev
  ```
  แล้วเช็ค 6 ข้อที่ `http://localhost:5174/products/<id>` ของสินค้าที่มี ≥2 เครื่อง:
  1. กดสลับเครื่องใน UnitPicker → รูปหลัก + thumbnail เปลี่ยนตามเครื่อง และ thumbnail แรกถูกเลือก
  2. SpecTable แสดง สาขา / อุปกรณ์ / ตำหนิ / ประกันจริง (ไม่ใช่ 30 วันตายตัว) และบล็อก QC
  3. กด "แชร์เครื่องนี้" บนเดสก์ท็อป → toast "คัดลอกลิงก์แล้ว" และลิงก์ที่ได้คือ `http://localhost:5174/api/shop/share/<unitId>`
  4. วางลิงก์นั้นในเบราว์เซอร์ → เด้งไป `/products/<id>` ทันที
  5. `curl -s -A 'facebookexternalhit/1.1' http://localhost:5174/api/shop/share/<unitId> | head -25` → เห็น `og:image`, `og:title`, `product:price:amount` และไม่ติด 429
  6. กด "สอบถามเครื่องนี้ทางไลน์" → ข้อความ prefill = `สนใจ <ชื่อรุ่น> (<4 ตัวท้าย>) <share URL>`
  7. `curl -s http://localhost:3000/api/shop/public-config/shop` → ถ้ามี `facebookPageHandle` ไม่เป็น null ปุ่ม "ทักเรื่องเครื่องนี้ทาง Messenger" ต้องโผล่และลิงก์เป็น `https://m.me/<handle>?ref=p%3A<unitId>`; ถ้าเป็น null ปุ่มต้องถูกซ่อน**โดยหน้าไม่พัง**
- [ ] commit:
  ```bash
  git add apps/web-shop && git commit -m "$(cat <<'EOF'
  feat(web-shop): per-unit gallery, share button, real warranty and unit facts

  รูป/360 ตามเครื่องที่เลือก + reset activeImage, ปุ่มแชร์ (navigator.share → clipboard),
  LINE prefill พร้อม 4 ตัวท้าย + ลิงก์แชร์, ปุ่ม Messenger พร้อม ref ต่อเครื่อง,
  แสดงสาขา/อุปกรณ์/ตำหนิ/QC และเลิก hardcode ประกัน 30 วัน

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 12 — ปิดงาน: gate ครบชุด + ตรวจ red line

### Files
- ไม่มีไฟล์ใหม่ (verification เท่านั้น)

### Interfaces
- **Consumes:** ผลลัพธ์ของ Task 1-11 ทั้งหมด

### Steps
- [ ] tsc ทั้ง 3 แอปที่แตะ (Task 10 แตะ `apps/web` ด้วย) — รันแยกทีละบรรทัด:
  ```bash
  cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx tsc --noEmit && echo "API_TSC_OK"
  cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx tsc --noEmit && echo "WEB_TSC_OK"
  cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web-shop && npx tsc --noEmit && echo "SHOP_TSC_OK"
  ```
  คาดหวังเห็นครบทั้ง 3
- [ ] vitest ของ `apps/web` (Task 10 แก้ `buildShopProductUrl` + เทสต์):
  ```bash
  cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx vitest run src/pages/ProductDetailPage/utils/buildCustomerSummary.test.ts
  ```
  คาดหวังเขียว (**vitest ไม่ใช่ jest** — `apps/web` ไม่มี jest ติดตั้ง)
- [ ] eslint (apps/api เท่านั้น — web-shop ไม่มี config). **รันแยกจาก tsc ห้ามร้อย `&&`** และ **ห้ามใช้ `npx eslint .`** (มี 34 Parsing error ค้างมาก่อน B4 จากไฟล์นอก tsconfig include — `e2e/*.e2e-spec.ts`, `scripts/*.ts`, `eslint.config.mjs`):
  ```bash
  cd /Users/iamnaii/Desktop/App/BESTCHOICE && npm run lint --workspace=apps/api 2>&1 | tail -5
  ```
  เกณฑ์ผ่าน = **ไม่มี error ใหม่** เทียบ baseline ที่จดไว้ใน Task 0 (34 error, ทั้งหมดเป็น Parsing error นอก `src/`). ถ้าอยากตรวจเฉพาะไฟล์ที่ batch นี้แตะ:
  ```bash
  cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx eslint src/modules/shop-catalog src/modules/shop-bot-defense src/modules/chat-adapters src/modules/chat-engine src/modules/facebook-domain src/modules/shop-public-config src/modules/integrations 2>&1 | tail -5
  ```
  คาดหวัง 0 error (warning ปล่อยได้). **ห้ามแก้ `tsconfig.json`/`eslint.config.mjs` เพื่อไล่ 34 error เดิม — นอก scope**
- [ ] jest ทุกโมดูลที่แตะ:
  ```bash
  cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/shop-catalog src/modules/shop-bot-defense src/modules/chat-adapters src/modules/chat-engine src/modules/shop-public-config 2>&1 | tail -8
  ```
  คาดหวัง `Tests: N passed` โดย N > baseline ที่จดไว้ใน Task 0 และ `failed: 0`
- [ ] ตรวจ red line — ไม่มีไฟล์บัญชี/การเงินอยู่ใน diff:
  ```bash
  git diff --name-only main...HEAD | grep -E "modules/(journal|accounting|payments|contracts|receipts|expenses)/" || echo "RED_LINE_CLEAN"
  ```
  คาดหวัง `RED_LINE_CLEAN`
- [ ] ตรวจว่าไม่แตะไฟล์ต้องห้ามของ batch นี้:
  ```bash
  cd /Users/iamnaii/Desktop/App/BESTCHOICE && git diff --name-only main...HEAD | grep -E "^(firebase.json|Dockerfile|apps/api/src/main.ts|.github/workflows/)" || echo "INFRA_UNTOUCHED"
  ```
  คาดหวัง `INFRA_UNTOUCHED`
- [ ] ตรวจว่าไม่มี migration ใหม่:
  ```bash
  cd /Users/iamnaii/Desktop/App/BESTCHOICE && git diff --name-only main...HEAD | grep "prisma/migrations" || echo "NO_MIGRATION"
  ```
  คาดหวัง `NO_MIGRATION`
- [ ] ตรวจว่า scope ที่ตัดไม่ถูกใส่กลับ:
  ```bash
  cd /Users/iamnaii/Desktop/App/BESTCHOICE && git diff main...HEAD | grep -E "attachedProductId|sitemap|'/p/:slug'" || echo "CUT_SCOPE_CLEAN"
  ```
  คาดหวัง `CUT_SCOPE_CLEAN`
- [ ] เปิด PR:
  ```bash
  cd /Users/iamnaii/Desktop/App/BESTCHOICE && git push -u origin feat/pa-b4-web-shop-share-og && gh pr create --base main --title "B4 — เว็บลูกค้า: แชร์ลิงก์มีการ์ด + ข้อมูลต่อเครื่อง" --body "$(cat <<'EOF'
  ## สรุป
  - `GET /api/shop/share/:id` เสิร์ฟ HTML สั้น escaped ทุกค่า (OG + JSON-LD Product/Offer + canonical + meta-refresh/JS redirect) → แชร์ลิงก์ไป LINE/FB ขึ้นการ์ดพร้อมรูปและราคา
  - bot-defense: แก้บั๊ก 429 (หน้าต่างนับไม่เคยรีเซ็ต → IP โดนบล็อกถาวร) + รู้จัก facebookexternalhit/Facebot/Twitterbot/Line-Poker + `@SkipBotRateLimit()` บน endpoint แชร์
  - หน้าเว็บ: รูป/360 ตามเครื่องที่เลือก, ปุ่มแชร์, สาขา/อุปกรณ์/ตำหนิ/QC/ประกันจริงต่อเครื่อง
  - แชท: LINE prefill = `สนใจ <รุ่น> (<4 ตัวท้าย>) <share URL>`, ปุ่ม Messenger `?ref=p:<unitId>` + webhook รับ standalone referral ที่เคยถูก drop แล้วโพสต์โน้ตระบบให้ทีมงานเห็น + ปุ่ม Get Started
  - "ผ่อนเริ่มต้น" หน้ารายการเลิกใช้ rate ปลอม 0.99% → `_min(installmentPrice)` + `InterestConfig` ผ่าน `resolveBcConfigForCategory` (util ของ B3) เครื่องคิดตัวเดียวกับ preview (มี parity golden test)
  - ค้นหาไทยผ่าน `parseDeviceQuery` ของ B0 และเลิก assign `where.OR` (สีไม่เข้า where — ไทย/อังกฤษไม่ตรงกัน จะทำให้ได้ 0 ผลลัพธ์)
  - **ต่อสายลิงก์แชร์ครบทุกผู้เรียก**: แอดมิน (`buildShopProductUrl` ของ B1), การ์ดสินค้าในแชท (`shareUrl` ของ B2 x2), บอท (`webUrl` ของ B3 x2) ชี้ `/api/shop/share/:id` แล้ว
  - `facebookPageHandle` เสิร์ฟจาก IntegrationConfig ผ่าน `/api/shop/public-config/shop` (username → fallback pageId) → ปุ่ม Messenger ทำงานได้เองโดยเจ้าของไม่ต้องแก้โค้ด

  ## ไม่ได้ทำ (ตาม spec §1 / §8)
  `/p/:slug`, dynamic sitemap, `attachedProductId`, ตัวแปรสินค้าใน canned responses

  ## Verification
  - `apps/api`: tsc 0 / `npm run lint --workspace=apps/api` ไม่มี error ใหม่เกิน baseline 34 (Parsing error เดิมของไฟล์นอก tsconfig) / jest เขียวทุกโมดูลที่แตะ
  - `apps/web`: tsc 0 + vitest `buildCustomerSummary.test.ts` เขียว
  - `apps/web-shop`: tsc 0 + `npm run build` ผ่าน (แอปนี้ไม่มี test runner/eslint config)
  - ไม่มี migration, ไม่แตะ firebase.json / main.ts / Dockerfile / workflows
  EOF
  )"
  ```

---

## Deployment & Verification

### ลำดับ deploy
1. **B0 + B1 + B2 + B3 ต้อง merge ก่อน** — B4 ไม่มี migration ของตัวเอง แต่กินของจากทุก batch: B0 (คอลัมน์ `accessoriesIncluded`/`cosmeticNotes` + `parseDeviceQuery` + backfill ราคา), B3 (`resolveBcConfigForCategory` ใน Task 6 + `webUrl` ที่ Task 10 ต้องแก้), B1 (`buildShopProductUrl`), B2 (`shareUrl` ใน chat-commerce). **B0/B3 เป็น hard blocker** (Task 6/7 เรียก util ของมันตรง ๆ); **B1/B2 เป็น soft blocker** — ถ้ายังไม่ merge ให้ข้ามสเต็ปที่เกี่ยวข้องใน Task 10ข แล้ว**บันทึกไว้ใน PR ว่าเหลือต้องต่อสาย** ห้ามเงียบ
2. Merge PR → GitHub Actions (`deploy-gcp.yml`) deploy Cloud Run (`bestchoice-api`) + Firebase Hosting target `shop` ตามปกติ — **ไม่มีขั้นตอนพิเศษ** เพราะ endpoint ใหม่วิ่งบน rewrite `/api/**` ที่มีอยู่แล้ว
3. ไม่ต้องรัน migration, ไม่ต้อง restart อะไรเพิ่ม, ไม่มี env var ใหม่ (`SHOP_BASE_URL` ตั้งไว้แล้วที่ `deploy-gcp.yml:358`)

### สิ่งที่เจ้าของต้องกด (ops — ไม่ใช่โค้ด)
1. **(ไม่บังคับ) กรอก username เพจ Facebook** ที่ **Settings → เชื่อมต่อ → Facebook → Page Username** — **ไม่ต้อง deploy** เพราะค่าอ่านจาก IntegrationConfig ผ่าน `/api/shop/public-config/shop` (cache 5 นาที). ถ้าไม่กรอก ระบบถอยไปใช้ `Page ID` ที่กรอกไว้อยู่แล้ว (`m.me/<PAGE_ID>` ใช้ได้เท่ากับ username) ⇒ **ปุ่ม Messenger ทำงานตั้งแต่วัน deploy** โดยเจ้าของไม่ต้องทำอะไร; ปุ่มจะถูกซ่อนก็ต่อเมื่อยังไม่ได้ตั้งค่า Facebook เลย
2. **กดตั้งปุ่ม Get Started 1 ครั้งหลัง deploy** (ไม่งั้นลูกค้าใหม่ที่กดลิงก์ Messenger จะไม่ส่ง `ref` มา) — สังเกต `admin` **ซ้ำสองชั้น** เพราะ `AdminPrefixMiddleware` ตัดชั้นแรกทิ้งก่อน routing:
   ```bash
   curl -X POST https://api.bestchoicephone.app/api/admin/admin/facebook/setup-messenger-profile \
     -H "Authorization: Bearer <OWNER_ACCESS_TOKEN>" -H "X-Requested-With: XMLHttpRequest"
   ```
   คาดหวัง `{"getStarted":{"success":true},"menu":{"success":true}}` (ถ้าได้ 404 แปลว่าลืม `admin` ซ้ำ)
3. ถ้ายังไม่ได้กรอก Page Access Token/Page ID ในหน้า Settings → Integrations → Facebook จะได้ `Facebook not configured` ให้กรอกก่อนแล้วยิงซ้ำ

### Verify บน prod (หลัง deploy)
- [ ] การ์ดแชร์ขึ้นจริง — เอา `https://www.bestchoicephone.com/api/shop/share/<productId>` ไปวางใน **Facebook Sharing Debugger** (`developers.facebook.com/tools/debug/`) แล้วกด Scrape Again → ต้องเห็นรูป + ชื่อ + ราคา
- [ ] ทดสอบ crawler จริง:
  ```bash
  curl -s -A 'facebookexternalhit/1.1' https://www.bestchoicephone.com/api/shop/share/<productId> -i | head -30
  ```
  คาดหวัง `HTTP/2 200`, `content-type: text/html; charset=utf-8`, `cache-control: public, max-age=300` และมี `og:image`
- [ ] ยิงรัว 200 ครั้งแล้วต้องไม่ 429 (พิสูจน์ทั้ง KNOWN_GOOD และ `@SkipBotRateLimit`):
  ```bash
  for i in $(seq 1 200); do curl -s -o /dev/null -w "%{http_code} " -A 'facebookexternalhit/1.1' https://www.bestchoicephone.com/api/shop/share/<productId>; done; echo
  ```
  คาดหวัง `200` ทั้ง 200 ครั้ง
- [ ] เบราว์เซอร์ปกติเปิด share URL → เด้งไป `/products/:id` ภายใน ~0 วินาที และแถบที่อยู่เปลี่ยนเป็น `/products/:id`
- [ ] 404 ของสินค้าที่ถูกซ่อน/ลบ: `curl -s -o /dev/null -w "%{http_code}\n" https://www.bestchoicephone.com/api/shop/share/00000000-0000-0000-0000-000000000000` → `404`
- [ ] แชร์ลงห้องแชท LINE จริง 1 ครั้ง → ต้องขึ้นการ์ด (ถ้าไม่ขึ้น ให้เช็ค `bot_detection_logs` ว่า UA ของ LINE ถูกจัดเป็น `KNOWN_GOOD` หรือไม่ แล้วเติม pattern)
- [ ] ผ่อนเริ่มต้นบนหน้ารายการตรงกับหน้ารายละเอียด — เปิด `/products` แล้วกดการ์ดใดการ์ดหนึ่ง ตัวเลข "ผ่อน ฿X/เดือน" บนการ์ดต้อง **≤** ตัวเลข "ผ่อนเริ่ม" ของหน้ารายละเอียด (ซึ่งคิดที่ 12 งวด ดาวน์ 15% จากเครื่องที่เลือก) เพราะการ์ดใช้ `_min(installmentPrice)` ของทั้งกลุ่ม + งวดยาวสุด = ค่างวดต่ำสุดเสมอ (จะ "เท่ากัน" เมื่อกลุ่มมีเครื่องเดียวและงวดยาวสุด = 12); การ์ดที่ยังไม่ตั้ง `installmentPrice` ต้อง **ไม่มี** บรรทัดผ่อนเลย
- [ ] ลิงก์จาก **ทุกผู้เรียก** เป็น share URL จริง (ไม่ใช่ `/products/:id` เปล่า):
  - แอดมิน: เปิดหน้าสินค้าใน admin → กด "คัดลอกสรุปส่งลูกค้า" → ลิงก์ในข้อความต้องเป็น `.../api/shop/share/<id>`
  - inbox: ยิงการ์ดสินค้าเข้าห้องแชท → ลิงก์ท้ายการ์ดต้องเป็น `.../api/shop/share/<id>` และขึ้นการ์ด OG ในแอป LINE จริง
  - บอท: ถามบอทหารุ่นหนึ่ง → ลิงก์ที่บอทตอบต้องเป็น `.../api/shop/share/<id>`
- [ ] `curl -s https://api.bestchoicephone.app/api/shop/public-config/shop` → `{"facebookPageHandle":"..."}` ไม่เป็น null (ถ้า null = ยังไม่ได้กรอก Page ID/Username ในหน้า Settings ⇒ ปุ่ม Messenger จะถูกซ่อนและ Task 8 จะไม่มีทางถูกกระตุ้น)
- [ ] Messenger deep-link: กด `m.me/<handle>?ref=p:<unitId>` จากมือถือที่**เคยคุย**กับเพจ → เปิด `/chat` แล้วต้องเห็นข้อความระบบ `ลูกค้ากดมาจากสินค้า ... (####) บนเว็บ` ในห้องนั้น; ทดสอบซ้ำด้วยบัญชีที่**ไม่เคยคุย** → ต้องได้ปุ่ม Get Started แล้วโน้ตตามมาหลังกด
- [ ] rollback plan: batch นี้ไม่มี migration และไม่มี state ใหม่ → `git revert` PR แล้ว deploy ใหม่ได้ทันที ผลข้างเคียงเดียวคือลิงก์แชร์ที่กระจายไปแล้วจะกลายเป็น 404 (ลิงก์ `/products/:id` ที่ผู้ใช้ bookmark ไว้ไม่ได้รับผลกระทบ)

### เฝ้าดูหลัง deploy 24 ชม.
- `SELECT detected_type, action, count(*) FROM bot_detection_logs WHERE detected_at > now() - interval '1 day' GROUP BY 1,2;` → `RATE_LIMITED` ต้องลดลงอย่างมีนัยเทียบก่อน deploy (บั๊ก counter ถูกแก้แล้ว)
- Sentry: ไม่ควรมี exception ใหม่จาก `ShopShareController` หรือ `[FB referral]` (การ resolve referral ถูกห่อ try/catch ไว้แล้ว จะขึ้นเป็น warn log ไม่ใช่ error)

## สิ่งที่ batch นี้ไม่ทำ

| ไม่ทำ | เหตุผล |
|---|---|
| `/p/:slug` permalink ระดับรุ่น + dynamic sitemap | ตัดออกตาม spec §1/§8 — `/products/:id` ทำหน้าที่ permalink ได้อยู่แล้ว (เครื่องที่ขายแล้วยัง render หน้ารุ่น + เครื่องที่เหลือ) และ slug `iphone-12-64gb` ไม่ unique เพราะมือ 1/มือ 2 เป็นคนละการ์ด |
| rewrite `/products/**` ไป Cloud Run เพื่อทำ SSR meta | api image ไม่มี `index.html` ของ web-shop (Dockerfile build แค่ `apps/api`) + `setGlobalPrefix('api')` ไม่มี exclude → จะ 404 ทั้งเว็บ (spec §0) |
| `ChatRoom.attachedProductId` + ตัวแปรสินค้าใน canned responses | ตัดออกตาม spec §1 — โน้ตระบบให้ผลเดียวกันโดยไม่มี schema/สถานะค้าง |
| เปิด CSP ทั้งระบบใน `main.ts` | นอก scope และเสี่ยงพัง Swagger/dev — B4 ใส่ CSP เฉพาะ response ของหน้าแชร์เท่านั้น |
| ส่งรูป/ลิงก์จากบอทเข้าแชท, `search_products` ยกเครื่อง, grounding guard | เป็น B3 (B4 แก้แค่ **ปลายทาง** ของ `webUrl` ให้เป็น share endpoint — Task 10ข) |
| ปุ่ม "คัดลอกสรุปส่งลูกค้า"/"คัดลอกลิงก์" ในแอดมิน, การ์ด readiness | เป็น B1 (B4 แก้แค่ **ปลายทาง** ของ `buildShopProductUrl` — Task 10ข) |
| Product picker/การ์ดสินค้าใน inbox | เป็น B2 (B4 แก้แค่ **ปลายทาง** ของ `shareUrl` 2 จุด — Task 10ข) |
| guard จองซ้ำ/BANK_TRANSFER/preempt-in-tx | เป็น B5 |
| ตาราง spec รายรุ่น (จอ/กล้อง/ชิป), วิดีโอสินค้า, back-in-stock | นอกขอบเขต spec §8 |
| unit test ฝั่ง `apps/web-shop` | แอปนี้ไม่มี test runner (และไม่มี eslint config) — ตรรกะจึงถูกกดให้บางที่สุดและตรวจด้วย tsc + build + QA เบราว์เซอร์ local |
