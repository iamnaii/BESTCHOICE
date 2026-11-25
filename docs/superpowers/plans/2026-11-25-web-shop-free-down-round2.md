# หน้าร้าน: เงินดาวน์เป็นบาท + ตัวกรองโฉมใหม่ (รอบ 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ลูกค้าพิมพ์เงินดาวน์ที่มีเป็นบาทในตัวกรองหน้ารวมสินค้า แล้วเห็นทุกเครื่องที่ซื้อได้ด้วยเงินนั้นพร้อมดาวน์/ค่างวดที่คำนวณใหม่ทุกใบ, ตัวกรองเปลี่ยนเป็นปุ่มกด (ไม่มีตัวกรองสภาพเครื่อง), และกดการ์ดแล้วหน้ารายละเอียดเปิดเรท 1 ที่เงินดาวน์เดียวกัน

**Architecture:** API `GET /shop/products` รับ `downAmount` (บาท): คิดเรท 1 ของทุกการ์ดด้วย `customDownAmount` ผ่าน `calcBcInstallment` ตัวเดียวกับหน้ารายละเอียด, ตัดการ์ดที่เงินไม่พอทั้งสองเรทก่อนแบ่งหน้า แล้วคืน `overBudgetCount` / `nextDownFrom` · ฝั่งเว็บเก็บเงินดาวน์ใน URL (`?down=`) แบบเดียวกับ `?freeDown=1` ของรอบ 1, ช่องพิมพ์เป็น component เดียว (`DownAmountField`) ใช้ทั้งแถบข้าง แผงมือถือ และแถวบนของมือถือ · หน้ารายละเอียดรับ `?down=` เป็นค่าเริ่มต้นของช่องเงินดาวน์เรท 1 โดยไม่นับว่าลูกค้าแก้ช่อง (เรท 2 ยังเป็นค่าตั้งต้น)

**Tech Stack:** NestJS + Prisma + decimal.js + class-validator + jest (API) · React + TanStack Query + react-router + Tailwind v4 + vitest/testing-library (web-shop) · สูตรผ่อนใน `packages/shared`

**Spec:** `docs/superpowers/specs/2026-11-25-web-shop-free-down-design.md` — หัวข้อ 5 สถานะ ② (+ ข้อย่อยใต้ตาราง), 6, 7 ข้อสุดท้าย, 8 แถวรอบ 2 + ลำดับ/ลำดับความสำคัญ, 9 "รอบ 2", 10 "API รอบ 2" + เว็บรอบ 2 · หัวข้อ 12 = นอกขอบเขต
รอบ 1 ทำเสร็จแล้วและ**ยังไม่ commit** — โค้ดที่แผนนี้อ้างคือ working tree ปัจจุบัน ไม่ใช่ HEAD

## Global Constraints

- ทำใน worktree `d:\BESTCHOICE APP\wt-shop-rate-labels` branch `ui/web-shop-card-rate-labels` เท่านั้น — ทุก path ในแผนนี้นับจาก root ของ worktree · ห้ามแตะ `d:\BESTCHOICE APP\BESTCHOICE`
- **ห้าม `git commit` / `git push` / เปิด PR จนกว่าเจ้าของจะสั่งตรง ๆ** — ทุก task จบที่ "Checkpoint" (รันเทสต์ แล้วรายงาน) ไม่ใช่ commit
- เงินดาวน์ในตัวกรอง = ช่องพิมพ์จำนวนเงินเป็นบาท (จำนวนเต็ม) แทนแถบเลื่อน % · พิมพ์แล้วดาวน์ + ค่างวดของทุกการ์ดคำนวณใหม่ และแสดงทุกเครื่องที่ซื้อได้ด้วยเงินนั้น · **ไม่มีปุ่มลัดจำนวนเงิน** (3,000 / 5,000 / 10,000 ในภาพตัวอย่างถูกตัดทิ้งแล้ว)
- ฟรีดาวน์ยังเป็น `<input type="checkbox">` จริง · ติ๊กแล้วขึ้นเฉพาะเครื่องฟรีดาวน์ · พิมพ์ 0 = ติ๊กฟรีดาวน์
- ตัวกรอง: "เครื่องไทย / เครื่องนอก" และ "ช่วงราคา" เป็นปุ่มกด `<button aria-pressed>` (ตัวที่เลือก = หน้าตา `Pill` เดิม) · "รุ่น" ยังเป็นดรอปดาวน์ · **เอา "สภาพเครื่อง" ออกจาก UI ตัวกรอง** (ป้ายเกรดบนการ์ด/หน้ารายละเอียดยังอยู่ · API ยังรับ `conditionGrade`)
- หน้าตาเหมือนหน้าร้านเดิม: ฟอนต์ โทเคน มุมมน เงา ชุดเดิมเท่านั้น — **ห้ามใส่สี hex ใหม่** · ห้ามใช้ class `font-extrabold`, `tracking-tight` และคำว่า `Looped`, `Prompt` (เทสต์ typography สแกนหา)
- ห้ามบอกชื่อผู้ให้ผ่อนบนหน้าร้าน (ใช้ได้แค่ "เรท 1" / "เรท 2" ในหน้ารายละเอียด) · บนการ์ดและตัวกรองของหน้ารวม**ห้ามมีคำว่า "เรท"** ในข้อความที่แสดง · ไม่แสดงยอดรวมจ่าย · ไม่แสดง % ดาวน์บนการ์ด
- บรรทัดค่างวดบนการ์ด `ผ่อน ฿2,890 × 12 งวด` (ทำแล้วใน `PlanTiles`) — **ห้ามแก้ `PlanTiles.tsx`**
- หน้ารายละเอียด (คำตัดสิน ข1): `?down=` จากหน้ารวมใช้กับเรท 1 เท่านั้น · เรท 2 เปิดที่ค่าตั้งต้นของมันจนกว่าลูกค้าจะแก้ช่องเงินดาวน์ในหน้านั้น · การอ่าน `?down=` **ไม่นับ**ว่าลูกค้าแก้ช่อง
- ข้อความ UI ภาษาไทย · ข้อความไทยใช้ `leading-snug` · ปุ่ม / แถวช่องติ๊ก / ช่องพิมพ์ สูงอย่างน้อย 44px (`min-h-11` / `h-11`) · ช่องพิมพ์ต้องมี label ที่มองเห็น
- คำตัดสินของผู้คุมงาน (ใช้ตามนี้ทุก task):
  - สถานะ ② (พิมพ์เงิน X): เครื่องที่คิดไม่ได้ทั้งสองเรท (ไม่มีทั้งเรท 1 และแผนเรท 2) **ไม่แสดง และไม่นับ**ใน `overBudgetCount` · `overBudgetCount` / `nextDownFrom` ครอบเฉพาะเครื่องที่มีอย่างน้อยหนึ่งแผนแต่ต้องดาวน์มากกว่า X
  - `nextDownFrom` = ค่าน้อยสุดของ `min(ดาวน์ขั้นต่ำเรท 1 ของเครื่อง [ราคาผ่อน × % ขั้นต่ำของหมวด ปัดขึ้นหลักร้อย — ตัวเลขเดียวกับที่การ์ดโชว์ตอนไม่ใส่อะไร], ดาวน์ของแผนเรท 2)` ในกลุ่มที่ถูกตัด · ไม่มีเครื่องถูกตัด = `null`
  - ส่งทั้ง `downAmount` และ `downPct` → `downAmount` ชนะ · `freeDown=true` ชนะ `downAmount` · `downAmount=0` = `freeDown=true` · API ยังรับ `downPct` เพื่อเว็บรุ่นเก่า · เว็บใหม่เลิกส่ง `downPct`
  - เรท 1 ที่ `downAmount = X`: X ต่ำกว่าดาวน์ขั้นต่ำเรท 1 ของเครื่อง → ไม่มีเรท 1 ของเครื่องนั้น (ช่องเป็น null) · ไม่งั้น `customDownAmount = min(X, floor(ราคาผ่อน × 0.90))`
  - เครื่องที่ราคาผ่อนไม่มากกว่า 0 ยังได้ `rate2: null` (ด่านของรอบ 1) — ไม่เปลี่ยน
  - หน้ารายละเอียดเปิดด้วย `?down=X`: X ต่ำกว่าขั้นต่ำของเครื่อง → เรท 1 ถอยไปดาวน์ขั้นต่ำ (พฤติกรรม clamp เดิมของช่อง) · X เกินเพดาน 90% → ใช้เพดาน · ไม่ถูกรูป / ไม่มี → พฤติกรรมเดิม
  - ลิงก์ของการ์ดพา `?down=X` ไปด้วยเฉพาะสถานะ ② (ไม่พาในสถานะ ① และ ③)
  - เว็บใหม่ + API เก่า: ช่องเงินดาวน์ไม่มีผล — **ไม่ต้องทำด่านตรวจรุ่น API** สำหรับช่องนี้ · ด่าน `freeDownSupported` ของรอบ 1 คงไว้
  - ช่องติ๊กฟรีดาวน์บนมือถือย้ายจากแถวปุ่มเดิมเข้าแถวเงินดาวน์ใหม่ของมือถือ (ยังเป็น checkbox จริง แถวสูง 44px)
  - ช่องเงินดาวน์ commit ตอนออกจากช่อง / กด Enter แล้วหน่วง 250ms ก่อนเปลี่ยนคำขอ — ห้ามยิงคำขอทุกตัวอักษร
- ข้อความ (ตามนี้ทุกตัวอักษร · เก็บใน `apps/web-shop/src/lib/copy.ts` ใต้ `catalog`):
  - label ช่อง: `เงินดาวน์` หน่วย `บาท`
  - บรรทัดสรุป สถานะ ②: `พบ N เครื่องที่ดาวน์ได้ด้วยเงิน ฿X` · สถานะ ③: `พบ N เครื่องฟรีดาวน์` · นอกนั้นข้อความเดิม
  - บรรทัดท้ายรายการ สถานะ ② เมื่อ `overBudgetCount > 0`: `อีก N เครื่องต้องดาวน์มากกว่า ฿X (เริ่มที่ ฿Y)` ตามด้วยปุ่ม `ดูทั้งหมด` (ล้างเงินดาวน์)
  - รายการว่าง สถานะ ②: หัว `เงินดาวน์ ฿X ยังไม่พอ` · คำอธิบาย `ดาวน์ต่ำสุดเริ่มที่ ฿Y` (ไม่แสดงเมื่อ `nextDownFrom` เป็น null) · ปุ่ม `ดูเครื่องฟรีดาวน์` (เฉพาะเมื่อ `freeDownCount > 0`) · ปุ่ม `ล้างเงินดาวน์`
  - `ล้างตัวกรองทั้งหมด` — ล้างเงินดาวน์และติ๊กฟรีดาวน์ด้วย
- API: ห้ามส่งราคาส่ง / ส่วนลดดาวน์ของเรท 2 ออกหน้าร้าน · ช่องใหม่ของคำตอบเป็น optional ฝั่งเว็บ (เว็บใหม่ + API เก่าต้องไม่พัง)
- เทสต์เดิมห้ามทำให้อ่อนลง — ที่ใดที่รอบ 2 เอา UI ออกจริง แผนนี้ระบุ assertion เดิมและตัวแทนไว้ชัดในแต่ละ task · **ห้ามแก้ assertion เดิมนอกจากที่ระบุ** ถ้าเทสต์เดิมแดงด้วยเหตุอื่นให้หยุดและรายงาน
- รูปแบบโค้ด: Prettier (printWidth 100, single quotes, semicolons) · หลายไฟล์เดิมเป็น CRLF — **คงชนิดขึ้นบรรทัดเดิมของแต่ละไฟล์** แก้ด้วยการแทนที่เฉพาะส่วน ห้ามเขียนทับ/จัดรูปทั้งไฟล์
- คำสั่งในแผนเป็น Git Bash · เทสต์ API ต้องเพิ่ม heap ไม่งั้น jest ล้ม:
  `cd "/d/BESTCHOICE APP/wt-shop-rate-labels/apps/api" && NODE_OPTIONS="--max-old-space-size=8192 --experimental-vm-modules" node ../../node_modules/jest/bin/jest.js --runInBand --forceExit <path>`
  · type ของ API: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
- เทสต์เว็บ: `cd "/d/BESTCHOICE APP/wt-shop-rate-labels/apps/web-shop" && npx vitest run <ไฟล์หรือโฟลเดอร์>` · type: `npx tsc --noEmit -p .` (ไฟล์เทสต์ถูกตรวจ type ด้วย · เปิด `noUnusedLocals`) · web-shop ไม่มี ESLint flat config — รัน lint ไม่ได้ ไม่ต้องพยายาม
- Baseline ตอนเริ่ม: API `src/modules/shop-catalog` = 10 suites / 154 tests ผ่าน · เว็บ = 177 ผ่าน + 1 ไม่ผ่านที่รู้อยู่แล้วและไม่เกี่ยว (`src/styles/typography-utilities.test.ts` เรียก `grep` ซึ่งโปรเซสเทสต์บนเครื่อง Windows นี้หาไม่เจอ)
- Prisma client และ `packages/shared` build ไว้แล้ว — ไม่ต้องมีขั้นเตรียมเครื่อง · **ไม่มี Docker / ฐานข้อมูล local** — ห้ามมีขั้นไหนต้องเปิด API จริง · ตรวจ UI ด้วยเทสต์ component/หน้า

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `apps/api/src/modules/shop-catalog/dto/list-products.dto.ts` (แก้) | query `downAmount` |
| `apps/api/src/modules/shop-catalog/shop-catalog.service.ts` (แก้) | เรท 1 จากเงินดาวน์เป็นบาท, ตัดการ์ดที่เงินไม่พอ, `overBudgetCount`, `nextDownFrom` |
| `apps/api/src/modules/shop-catalog/shop-catalog.down-amount.spec.ts` (สร้าง) | เทสต์หน้ารวมสถานะ ② + parity เรท 1 กับ preview `customDownAmount` + DTO |
| `apps/web-shop/src/lib/copy.ts` (แก้) | ข้อความใหม่ของตัวกรอง/รายการ (`catalog.*`) |
| `apps/web-shop/src/pages/catalog-params.ts` (แก้) + `.test.ts` (แก้) | query string ของหน้ารวม (`downAmount` แทน `downPct`) + `parseDownParam` |
| `apps/web-shop/src/components/catalog/DownAmountField.tsx` (สร้าง) + `.test.tsx` (สร้าง) | ช่องพิมพ์เงินดาวน์เป็นบาท (label + ช่อง + หน่วย) สองหน้าตา: ในกล่องตัวกรอง / แถวบนมือถือ |
| `apps/web-shop/src/components/catalog/FilterSidebar.tsx` (แก้) | กล่องเงินดาวน์เป็นบาท · ปุ่มกดไทย/นอก + ช่วงราคา · เอาสภาพเครื่องออก · ล้างทั้งหมด |
| `apps/web-shop/src/components/catalog/FilterSidebar.freeDown.test.tsx` (แก้ตามที่ระบุ) | ช่องติ๊กฟรีดาวน์ (ของรอบ 1) |
| `apps/web-shop/src/components/catalog/FilterSidebar.down.test.tsx` (สร้าง) | กล่องเงินดาวน์เป็นบาท |
| `apps/web-shop/src/components/catalog/FilterSidebar.restyle.test.tsx` (สร้าง) | ปุ่มกดแทนดรอปดาวน์ · ไม่มีสภาพเครื่อง · ล้างทั้งหมด |
| `apps/web-shop/src/components/catalog/Pill.tsx` (สร้าง) | ปุ่มกดเลือก `aria-pressed` (ย้ายออกจาก `CatalogPage.tsx`) |
| `apps/web-shop/src/components/states/EmptyState.tsx` (แก้) | ช่องใส่ปุ่มการกระทำ (`children`) |
| `apps/web-shop/src/components/catalog/CatalogResults.tsx` (แก้) | บรรทัดสรุป · บรรทัดท้ายรายการ · รายการว่างสถานะ ② · ส่ง `down` ให้การ์ด |
| `apps/web-shop/src/components/catalog/CatalogResults.down.test.tsx` (สร้าง) | เทสต์ข้างบน |
| `apps/web-shop/src/components/catalog/ProductCard.tsx` (แก้) + `ProductCard.down.test.tsx` (สร้าง) | ลิงก์ของการ์ดพา `?down=` |
| `apps/web-shop/src/pages/CatalogPage.tsx` (แก้) | สถานะ `?down=` ใน URL, คำขอ, meta ใหม่, ล้างทั้งหมด, แถวเงินดาวน์บนมือถือ |
| `apps/web-shop/src/pages/CatalogPage.down.test.tsx` (สร้าง) | เทสต์หน้ารวมรอบ 2 |
| `apps/web-shop/src/components/InstallmentCalculatorCard.tsx` (แก้) + `.test.tsx` (เพิ่ม) | `initialDown` — เรท 1 เริ่มที่เงินดาวน์จากหน้ารวม |
| `apps/web-shop/src/pages/ProductDetailPage.tsx` (แก้) + `ProductDetailPage.down.test.tsx` (สร้าง) | อ่าน `?down=` ส่งให้เครื่องคิด |
| `apps/web-shop/e2e/catalog-origin.spec.ts` (แก้ตามที่ระบุ) | Playwright: ตัวกรองไทย/นอกเป็นปุ่มกดแล้ว |

---

### Task 1: API — `downAmount`: เรท 1 จากเงินดาวน์เป็นบาท, ตัดเครื่องที่เงินไม่พอ, `overBudgetCount`, `nextDownFrom`

**Files:**
- Create: `apps/api/src/modules/shop-catalog/shop-catalog.down-amount.spec.ts`
- Modify: `apps/api/src/modules/shop-catalog/dto/list-products.dto.ts` (เพิ่มช่อง `downAmount` ท้าย class)
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts` (`SortableCard`, `listGroupedByModel`, `installmentFor`, เพิ่ม `rate1For`)
- Test (regression, ห้ามแก้): ทุกไฟล์ `*.spec.ts` เดิมใต้ `apps/api/src/modules/shop-catalog/`

**Interfaces:**
- Consumes (มีอยู่แล้ว): `calcBcInstallment` (`../../utils/installment-calc.util` — รับ `customDownAmount?: Decimal` · ดาวน์ที่ส่งเป็นจำนวนเงินไม่ถูกปัด · ต่ำกว่า `config.minDownPct` = `isValid: false`) · `ShopCatalogService.installmentFor(installmentPrice, config, opts)` · `InstallmentPreviewService.preview({ productId, provider: 'BC', months, customDownAmount })` · controller ส่ง `ListProductsDto` เข้า `listGroupedByModel` ตรง ๆ อยู่แล้ว (ไม่ต้องแก้ controller)
- Produces (Task 2–5 ใช้):
  - query `GET /api/shop/products?downAmount=<จำนวนเต็มบาท 0..9999999>` — ผิดรูป = 400 พร้อมข้อความไทย
  - คำตอบเพิ่ม `overBudgetCount: number` และ `nextDownFrom: number | null`
  - ช่องเดิมของรายการ `monthlyPaymentFrom` / `downAmount` / `installmentMonths` เป็น `null` เมื่อเงินไม่พอสำหรับเรท 1 · เมื่อพอ `downAmount` = เงินที่ส่ง (ไม่เกินเพดาน 90%)

**ลำดับในโค้ด (สเปคหัวข้อ 8):** ตัวกรองอื่น → คิดเรท 1 และแผนเรท 2 ทุกรายการ → (เรียง — ของเดิมเรียงตรงนี้ ผลเท่ากับเรียงหลังกรอง จึงไม่ย้าย) → นับ `freeDownCount` → ตัดรายการที่เงินไม่พอ (นับ `overBudgetCount`, หา `nextDownFrom`) → ตัวกรองฟรีดาวน์ → แบ่งหน้า · ตัวนับทุกตัวไม่ขึ้นกับการแบ่งหน้า

**DTO:** ตามแบบช่อง `freeDown` เดิม — อ่านค่าดิบผ่าน `@Transform(({ obj }) => …)` (ValidationPipe กลางเปิด `enableImplicitConversion` ถ้าปล่อยให้แปลงเอง `?downAmount=` ที่เป็นสตริงว่างจะกลายเป็น 0 ซึ่งแปลว่าฟรีดาวน์) แล้ว**ปฏิเสธ** (ไม่ coerce) ค่าติดลบ / ทศนิยม / ไม่ใช่ตัวเลข / เกิน 9,999,999 ด้วยข้อความไทย

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `apps/api/src/modules/shop-catalog/shop-catalog.down-amount.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ShopCatalogService } from './shop-catalog.service';
import { InstallmentPreviewService } from './installment-preview.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ListProductsDto } from './dto/list-products.dto';

/**
 * สเปค 2026-11-25 รอบ 2 — เงินดาวน์เป็นบาท (สถานะ ②)
 * fixture ชุดเดียวกับ shop-catalog.rate2.spec.ts: ดาวน์ขั้นต่ำเรท 1 = 15% · เรท 2 ดาวน์ขั้นต่ำ 30%
 * ราคาส่งเรท 2 ของ iPhone 14 Pro 128GB = 22,500 → ราคาขาย 15,000 = ฟรีดาวน์ · 16,700 = ดาวน์ 1,000 · 19,900 = ดาวน์ 4,200
 */
function usedUnit(over: Record<string, unknown> = {}) {
  return {
    id: 'u-free',
    brand: 'Apple',
    model: 'iPhone 14 Pro',
    storage: '128GB',
    color: 'ดำ',
    category: 'PHONE_USED',
    deviceOrigin: 'THAI',
    cashPrice: 14000,
    installmentPrice: 15000,
    financePrice: null,
    conditionGrade: 'A',
    batteryHealth: null,
    hasBox: null,
    warrantyExpireDate: null,
    warrantyExpired: null,
    stockInDate: null,
    imeiSerial: null,
    gallery: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

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
const MAPPING_USED = {
  id: 'm1',
  gfinSeries: 'iPhone 14',
  gfinVariant: 'Pro',
  storage: '128GB',
  condition: 'HAND_2',
  maxPrice: new Prisma.Decimal('21500'),
  modelMatchPattern: 'iPhone 14 Pro',
  isActive: true,
};
const MAPPING_NEW = { ...MAPPING_USED, id: 'm2', condition: 'HAND_1' };
const RULE_USED = {
  id: 'r1',
  label: 'iPhone 14 มือ 2',
  seriesPattern: 'iPhone 14|iPhone 15',
  condition: 'HAND_2',
  allowance: new Prisma.Decimal('1000'),
  maxMonths: null,
  minDownPct: null,
  isActive: true,
};
const RULE_NEW = { ...RULE_USED, id: 'r2', label: 'iPhone 14 มือ 1', condition: 'HAND_1' };
const FACTOR = {
  months: 12,
  shopCommissionPct: 15,
  factor: new Prisma.Decimal('0.179238'),
  feePerInstallment: new Prisma.Decimal('100'),
  isActive: true,
};

// เครื่องตัวอย่าง — ดาวน์ขั้นต่ำเรท 1 = ราคาผ่อน × 15% ปัดขึ้นหลักร้อย
/** ราคาผ่อน 15,000 → เรท 1 ขั้นต่ำ 2,300 · เรท 2 ฟรีดาวน์ */
const free = () => usedUnit();
/** ราคาผ่อน 19,900 → เรท 1 ขั้นต่ำ 3,000 · เรท 2 ดาวน์ 4,200 */
const paid = () => usedUnit({ id: 'u-paid', installmentPrice: 19900, cashPrice: 18000 });
/** ราคาผ่อน 30,000 → เรท 1 ขั้นต่ำ 4,500 · ไม่มีเรท 2 (ไม่มีราคากลางของรุ่น) */
const bcOnly = () =>
  usedUnit({ id: 'u-bc', model: 'iPhone 8', installmentPrice: 30000, cashPrice: 28000 });
/** ราคาผ่อน 30,000 → เรท 1 ขั้นต่ำ 4,500 · ราคาขายเรท 2 16,700 → เรท 2 ดาวน์ 1,000 */
const low2 = () =>
  usedUnit({
    id: 'u-low2',
    installmentPrice: 30000,
    cashPrice: 28000,
    financePrice: new Prisma.Decimal('16700'),
  });
/** ไม่มีราคาผ่อน → คิดไม่ได้ทั้งสองเรท */
const noQuote = () =>
  usedUnit({ id: 'u-none', model: 'iPhone 8', installmentPrice: null, cashPrice: 9000 });
const all = () => [free(), paid(), bcOnly(), low2(), noQuote()];

describe('หน้ารวม: เงินดาวน์เป็นบาท (สถานะ ②)', () => {
  let catalog: ShopCatalogService;
  let preview: InstallmentPreviewService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      interestConfig: { findFirst: jest.fn().mockResolvedValue(INTEREST_CONFIG) },
      companyInfo: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ vatRegistered: true, vatRate: new Prisma.Decimal('0.07') }),
      },
      gfinModelMapping: { findMany: jest.fn().mockResolvedValue([MAPPING_USED, MAPPING_NEW]) },
      gfinOverpriceRule: { findMany: jest.fn().mockResolvedValue([RULE_USED, RULE_NEW]) },
      gfinRateFactor: {
        findMany: jest.fn().mockResolvedValue([FACTOR]),
        findFirst: jest.fn().mockResolvedValue(FACTOR),
      },
      pricingTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      systemConfig: {
        findFirst: jest.fn(({ where }: { where: { key: string } }) =>
          Promise.resolve(where.key === 'gfin.minDownPct' ? { value: '30' } : null),
        ),
      },
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

  const ids = (res: { data: Array<{ id: string }> }) => res.data.map((d) => d.id).sort();

  it('ไม่ส่ง downAmount → รายการและตัวเลขเท่าเดิม · overBudgetCount 0 · nextDownFrom null', async () => {
    prisma.product.findMany.mockResolvedValue(all());
    const res = await catalog.listGroupedByModel({});
    const byId = new Map(res.data.map((d) => [d.id, d]));
    expect(res.total).toBe(5);
    expect(res.overBudgetCount).toBe(0);
    expect(res.nextDownFrom).toBeNull();
    expect(byId.get('u-free')!.downAmount).toBe(2300);
    expect(byId.get('u-paid')!.downAmount).toBe(3000);
    expect(byId.get('u-bc')!.downAmount).toBe(4500);
    expect(byId.get('u-low2')!.rate2).toEqual({ down: 1000, monthly: 2923, months: 12 });
    expect(byId.get('u-none')!.monthlyPaymentFrom).toBeNull();
    expect(byId.get('u-none')!.rate2).toBeNull();
  });

  it('downAmount ≥ ดาวน์ขั้นต่ำเรท 1 → ดาวน์เท่าที่ส่ง ค่างวดลดลง', async () => {
    prisma.product.findMany.mockResolvedValue([paid()]);
    const base = await catalog.listGroupedByModel({});
    const res = await catalog.listGroupedByModel({ downAmount: 5000 });
    expect(res.data[0].downAmount).toBe(5000);
    expect(res.data[0].installmentMonths).toBe(12);
    expect(res.data[0].monthlyPaymentFrom).toBeLessThan(base.data[0].monthlyPaymentFrom!);
    expect(res.overBudgetCount).toBe(0);
  });

  it('เท่าดาวน์ขั้นต่ำพอดี → ได้เรท 1 เท่ากับตอนไม่ใส่อะไร · ต่ำกว่า 1 บาท → ไม่มีเรท 1 (ช่องเป็น null)', async () => {
    prisma.product.findMany.mockResolvedValue([free()]);
    const base = await catalog.listGroupedByModel({});
    const exact = await catalog.listGroupedByModel({ downAmount: 2300 });
    expect(exact.data[0].downAmount).toBe(2300);
    expect(exact.data[0].monthlyPaymentFrom).toBe(base.data[0].monthlyPaymentFrom);

    // เครื่องนี้ฟรีดาวน์ จึงยังอยู่ในรายการแม้เงินไม่พอเรท 1
    const under = await catalog.listGroupedByModel({ downAmount: 2299 });
    expect(under.data).toHaveLength(1);
    expect(under.data[0].monthlyPaymentFrom).toBeNull();
    expect(under.data[0].downAmount).toBeNull();
    expect(under.data[0].installmentMonths).toBeNull();
    expect(under.data[0].rate2).toEqual({ down: 0, monthly: 2923, months: 12 });
  });

  it('เกินเพดาน → ตรึงที่ 90% ของราคาผ่อน (ปัดลงเป็นบาทเต็ม)', async () => {
    prisma.product.findMany.mockResolvedValue([paid()]);
    const res = await catalog.listGroupedByModel({ downAmount: 50000 });
    expect(res.data[0].downAmount).toBe(17910);
    expect(res.data[0].monthlyPaymentFrom).not.toBeNull();
  });

  it('เงินไม่พอเรท 1 แต่ดาวน์ของแผนเรท 2 ≤ เงิน → ยังอยู่ในรายการ', async () => {
    prisma.product.findMany.mockResolvedValue([low2()]);
    const res = await catalog.listGroupedByModel({ downAmount: 2000 });
    expect(res.data).toHaveLength(1);
    expect(res.data[0].monthlyPaymentFrom).toBeNull();
    expect(res.data[0].downAmount).toBeNull();
    expect(res.data[0].rate2).toEqual({ down: 1000, monthly: 2923, months: 12 });
    expect(res.overBudgetCount).toBe(0);
    expect(res.nextDownFrom).toBeNull();
  });

  it('ไม่พอทั้งสองเรท → ตัดออก + นับ · nextDownFrom = ค่าน้อยสุดของ min(เรท 1, เรท 2) · เครื่องที่คิดไม่ได้เลยไม่แสดงและไม่นับ', async () => {
    prisma.product.findMany.mockResolvedValue(all());
    const low = await catalog.listGroupedByModel({ downAmount: 500 });
    expect(ids(low)).toEqual(['u-free']);
    expect(low.total).toBe(1);
    expect(low.overBudgetCount).toBe(3); // u-paid (3,000) · u-bc (4,500) · u-low2 (1,000)
    expect(low.nextDownFrom).toBe(1000);

    const mid = await catalog.listGroupedByModel({ downAmount: 2500 });
    expect(ids(mid)).toEqual(['u-free', 'u-low2']);
    expect(mid.overBudgetCount).toBe(2);
    expect(mid.nextDownFrom).toBe(3000);
    expect(new Map(mid.data.map((d) => [d.id, d])).get('u-free')!.downAmount).toBe(2500);
  });

  it('ตัวนับไม่ขึ้นกับการแบ่งหน้า · freeDownCount นับก่อนตัดเงิน', async () => {
    prisma.product.findMany.mockResolvedValue(all());
    const res = await catalog.listGroupedByModel({ downAmount: 2500, limit: 1, page: 2 });
    expect(res.data).toHaveLength(1);
    expect(res.total).toBe(2);
    expect(res.overBudgetCount).toBe(2);
    expect(res.nextDownFrom).toBe(3000);
    expect(res.freeDownCount).toBe(1);
  });

  it('freeDown=true ชนะ downAmount · downAmount=0 = freeDown=true', async () => {
    prisma.product.findMany.mockResolvedValue(all());
    const both = await catalog.listGroupedByModel({ freeDown: true, downAmount: 500 });
    expect(ids(both)).toEqual(['u-free']);
    expect(both.overBudgetCount).toBe(0);
    expect(both.nextDownFrom).toBeNull();
    expect(both.data[0].downAmount).toBe(2300); // ไม่ใช้เงิน 500 กับเรท 1

    const zero = await catalog.listGroupedByModel({ downAmount: 0 });
    expect(ids(zero)).toEqual(['u-free']);
    expect(zero.overBudgetCount).toBe(0);
    expect(zero.nextDownFrom).toBeNull();
  });

  it('ส่งทั้ง downAmount และ downPct → downAmount ชนะ · ไม่ส่ง downAmount → downPct เดิมยังใช้ได้', async () => {
    prisma.product.findMany.mockResolvedValue([paid()]);
    const both = await catalog.listGroupedByModel({ downAmount: 5000, downPct: 40 });
    expect(both.data[0].downAmount).toBe(5000);
    const legacy = await catalog.listGroupedByModel({ downPct: 40 });
    expect(legacy.data[0].downAmount).toBe(8000); // 19,900 × 40% = 7,960 → ปัดขึ้นหลักร้อย
    expect(legacy.overBudgetCount).toBe(0);
  });

  it('parity: เรท 1 ที่เงินดาวน์ X = หน้ารายละเอียดที่ส่ง customDownAmount X', async () => {
    prisma.product.findMany.mockResolvedValue([paid()]);
    prisma.product.findFirst.mockResolvedValue({
      id: 'u-paid',
      installmentPrice: new Prisma.Decimal('19900'),
      financePrice: null,
      prices: [],
      category: 'PHONE_USED',
      brand: 'Apple',
      model: 'iPhone 14 Pro',
      storage: '128GB',
      deviceOrigin: 'THAI',
      warrantyExpired: null,
      warrantyExpireDate: null,
      deletedAt: null,
    });
    const list = await catalog.listGroupedByModel({ downAmount: 5000, months: 12 });
    const detail = await preview.preview({
      productId: 'u-paid',
      provider: 'BC',
      months: 12,
      customDownAmount: 5000,
    });
    expect(detail.available).toBe(true);
    expect(list.data[0].downAmount).toBe(5000);
    expect(list.data[0].downAmount).toBe(Math.ceil(detail.downAmount!));
    expect(list.data[0].monthlyPaymentFrom).toBe(Math.ceil(detail.monthlyPayment!));
    expect(list.data[0].installmentMonths).toBe(detail.months);
  });

  it('การ์ดกลุ่ม (มือ 1): เรท 1 คิดจากราคาผ่อนต่ำสุดของกลุ่ม · เงินไม่พอเรท 1 แต่ฟรีดาวน์ → ยังอยู่', async () => {
    prisma.product.groupBy.mockResolvedValue([
      {
        brand: 'Apple',
        model: 'iPhone 14 Pro',
        storage: '128GB',
        category: 'PHONE_NEW',
        deviceOrigin: 'THAI',
        _min: {
          cashPrice: new Prisma.Decimal('14000'),
          installmentPrice: new Prisma.Decimal('15000'),
        },
        _max: { createdAt: new Date('2026-01-01T00:00:00Z') },
        _count: { id: 2 },
      },
    ]);
    prisma.product.findFirst.mockResolvedValue({
      id: 's1',
      gallery: [],
      conditionGrade: null,
      installmentPrice: new Prisma.Decimal('15000'),
      financePrice: null,
      warrantyExpired: null,
      warrantyExpireDate: null,
    });
    const under = await catalog.listGroupedByModel({ condition: 'NEW', downAmount: 2000 });
    expect(under.data).toHaveLength(1);
    expect(under.data[0].kind).toBe('GROUP');
    expect(under.data[0].downAmount).toBeNull();
    expect(under.data[0].rate2?.down).toBe(0);

    const enough = await catalog.listGroupedByModel({ condition: 'NEW', downAmount: 2300 });
    expect(enough.data[0].downAmount).toBe(2300);
    expect(enough.data[0].monthlyPaymentFrom).not.toBeNull();
  });

  it('ไม่ส่งตัวเลขภายใน (ดาวน์ขั้นต่ำที่ใช้ตัดรายการ · ราคาส่ง / ส่วนลดดาวน์ของเรท 2) ออกในคำตอบ', async () => {
    prisma.product.findMany.mockResolvedValue(all());
    const res = await catalog.listGroupedByModel({ downAmount: 2500 });
    for (const item of res.data) expect(Object.keys(item)).not.toContain('rate1MinDown');
    expect(JSON.stringify(res)).not.toMatch(/gfinSubmitPrice|downDiscount|maxPrice/);
  });
});

describe('ListProductsDto.downAmount', () => {
  // ValidationPipe กลางเปิด enableImplicitConversion — จำลองแบบเดียวกัน
  const parse = (raw: Record<string, unknown>) =>
    plainToInstance(ListProductsDto, raw, { enableImplicitConversion: true });
  const messages = (raw: Record<string, unknown>) =>
    validateSync(parse(raw))
      .filter((e) => e.property === 'downAmount')
      .flatMap((e) => Object.values(e.constraints ?? {}));

  it('สตริงตัวเลข → จำนวนเต็มบาท · ไม่ส่ง / สตริงว่าง → undefined (ไม่ใช่ 0 ซึ่งแปลว่าฟรีดาวน์)', () => {
    expect(parse({ downAmount: '5000' }).downAmount).toBe(5000);
    expect(parse({ downAmount: '0' }).downAmount).toBe(0);
    expect(parse({ downAmount: '' }).downAmount).toBeUndefined();
    expect(parse({}).downAmount).toBeUndefined();
    expect(messages({ downAmount: '5000' })).toEqual([]);
    expect(messages({ downAmount: '' })).toEqual([]);
  });

  it('ติดลบ / ทศนิยม / ไม่ใช่ตัวเลข / เกินเพดาน → ปฏิเสธด้วยข้อความไทย', () => {
    expect(messages({ downAmount: '-1' })).toContain('เงินดาวน์ต้องไม่ติดลบ');
    expect(messages({ downAmount: '12.5' })).toContain('เงินดาวน์ต้องเป็นจำนวนเต็มบาท');
    expect(messages({ downAmount: 'abc' })).toContain('เงินดาวน์ต้องเป็นจำนวนเต็มบาท');
    expect(messages({ downAmount: '10000000' })).toContain('เงินดาวน์เกินจำนวนที่รับได้');
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

```bash
cd "/d/BESTCHOICE APP/wt-shop-rate-labels/apps/api" && NODE_OPTIONS="--max-old-space-size=8192 --experimental-vm-modules" node ../../node_modules/jest/bin/jest.js --runInBand --forceExit src/modules/shop-catalog/shop-catalog.down-amount.spec.ts
```

Expected: FAIL — TypeScript ฟ้องว่า `downAmount` ไม่มีใน type ของ `filters` / `overBudgetCount` ไม่มีในผลลัพธ์ (หรือถ้า ts-jest ไม่ตรวจ type: assertion `overBudgetCount` ได้ `undefined`)

- [ ] **Step 3: DTO รับ `downAmount`**

ใน `apps/api/src/modules/shop-catalog/dto/list-products.dto.ts` เพิ่มต่อท้ายช่อง `freeDown` (ก่อน `}` ปิด class) — import ที่ต้องใช้ (`IsInt`, `Min`, `Max`, `IsOptional`, `Transform`) มีอยู่แล้ว:

```ts

  /**
   * เงินดาวน์ที่ลูกค้ามี เป็น **บาทเต็ม** (5000 = ฿5,000) — สเปค 2026-11-25 หัวข้อ 8
   * ส่งมาแล้ว `downPct` ไม่ถูกใช้ · 0 = ฟรีดาวน์ · `freeDown=true` ชนะค่านี้
   * อ่านจากค่าดิบ (`obj`) เหมือน `freeDown`: `?downAmount=` ที่เป็นสตริงว่างต้องเป็น "ไม่ได้ส่ง"
   * ไม่ใช่ 0 (enableImplicitConversion จะแปลง '' เป็น 0 ซึ่งแปลว่าฟรีดาวน์)
   */
  @IsOptional()
  @Transform(({ obj }) => {
    const raw = (obj as { downAmount?: unknown }).downAmount;
    if (raw === undefined || raw === null || raw === '') return undefined;
    return typeof raw === 'number' ? raw : Number(raw);
  })
  @IsInt({ message: 'เงินดาวน์ต้องเป็นจำนวนเต็มบาท' })
  @Min(0, { message: 'เงินดาวน์ต้องไม่ติดลบ' })
  @Max(9_999_999, { message: 'เงินดาวน์เกินจำนวนที่รับได้' })
  downAmount?: number;
```

- [ ] **Step 4: service — เรท 1 จากเงินดาวน์ + ตัดรายการ + ตัวนับ**

แก้ `apps/api/src/modules/shop-catalog/shop-catalog.service.ts` ตามลำดับ (ไฟล์นี้เป็น LF):

**4.1** ใน `interface SortableCard` เพิ่มช่องต่อจาก `isGroup: boolean;`:

```ts
  /** ดาวน์ขั้นต่ำเรท 1 ของการ์ด — คิดเฉพาะเมื่อลูกค้าใส่เงินดาวน์ (ใช้ตัดรายการ ไม่ส่งออกในคำตอบ) */
  rate1MinDown: number | null;
```

**4.2** ต่อจากบรรทัด `const MAX_UNIT_SCAN = 2000;` เพิ่ม:

```ts

/** เพดานเงินดาวน์เรท 1 = 90% ของราคาผ่อน ปัดลงเป็นบาทเต็ม — ค่าเดียวกับ MAX_DOWN_PCT ของหน้ารายละเอียด (web-shop) */
const MAX_CARD_DOWN_RATIO = new Decimal('0.90');
```

**4.3** ใน type ของ `filters` ของ `listGroupedByModel` เพิ่มต่อจาก `freeDown?: boolean;`:

```ts
    /** เงินดาวน์ที่ลูกค้ามี (บาทเต็ม) — สถานะ ② · 0 = ฟรีดาวน์ · ส่งมาแล้วไม่ใช้ downPct */
    downAmount?: number;
```

และใน type ของผลลัพธ์ เพิ่มต่อจาก `freeDownCount: number;`:

```ts
    /** สถานะ ②: จำนวนการ์ดที่มีแผนผ่อนแต่ต้องดาวน์มากกว่าเงินที่ลูกค้าใส่ (ถูกตัดออกจากรายการ) · นอกสถานะ ② = 0 */
    overBudgetCount: number;
    /** เงินดาวน์น้อยสุดที่ทำให้การ์ดที่ถูกตัดใบถัดไปขึ้น · null = ไม่มีใบไหนถูกตัด */
    nextDownFrom: number | null;
```

**4.4** ต่อจากบรรทัด `const limit = filters.limit ?? 24;` เพิ่ม:

```ts
    // เงินดาวน์เป็นบาท (สเปค 2026-11-25 หัวข้อ 8): freeDown ชนะ downAmount · downAmount=0 = freeDown
    // · ส่ง downAmount มาแล้วไม่ใช้ downPct (downPct คงไว้ให้เว็บรุ่นเก่า)
    const freeDownOnly = filters.freeDown === true || filters.downAmount === 0;
    const budget =
      !freeDownOnly && filters.downAmount != null && filters.downAmount > 0
        ? filters.downAmount
        : null;
    const rate1Opts = {
      downPct: filters.downAmount == null ? filters.downPct : undefined,
      months: filters.months,
      budget,
    };
```

**4.5** การ์ดกลุ่ม — แทน

```ts
          const quote = this.installmentFor(minInstallment, configs.get(g.category) ?? null, {
            downPct: filters.downPct,
            months: filters.months,
          });
```

ด้วย

```ts
          const rate1 = this.rate1For(minInstallment, configs.get(g.category) ?? null, rate1Opts);
          const quote = rate1.quote;
```

แล้วใน object ที่ return ของการ์ดกลุ่ม เพิ่ม `rate1MinDown: rate1.minDown,` ต่อจาก `isGroup: true,`

**4.6** การ์ดมือสอง — แทน

```ts
      const quote = this.installmentFor(
        u.installmentPrice != null ? Number(u.installmentPrice) : null,
        usedConfig,
        { downPct: filters.downPct, months: filters.months },
      );
```

ด้วย

```ts
      const rate1 = this.rate1For(
        u.installmentPrice != null ? Number(u.installmentPrice) : null,
        usedConfig,
        rate1Opts,
      );
      const quote = rate1.quote;
```

แล้วใน object ที่ return ของการ์ดมือสอง เพิ่ม `rate1MinDown: rate1.minDown,` ต่อจาก `isGroup: false,`

**4.7** แทน

```ts
    const isFreeDown = (card: SortableCard) => card.item.rate2?.down === 0;
    const freeDownCount = merged.filter(isFreeDown).length;
    const visible = filters.freeDown ? merged.filter(isFreeDown) : merged;
```

ด้วย

```ts
    const isFreeDown = (card: SortableCard) => card.item.rate2?.down === 0;
    const freeDownCount = merged.filter(isFreeDown).length;

    // สถานะ ②: ตัดการ์ดที่เงินไม่พอทั้งสองเรท — ทำหลังนับฟรีดาวน์ ก่อนตัวกรองฟรีดาวน์และก่อนแบ่งหน้า
    // needs = เงินดาวน์น้อยสุดที่ทำให้การ์ดขึ้น · null = คิดไม่ได้ทั้งสองเรท (ไม่แสดง และไม่นับว่า "ต้องดาวน์มากกว่า")
    const needs = (card: SortableCard): number | null => {
      const options = [card.rate1MinDown, card.item.rate2?.down ?? null].filter(
        (n): n is number => n != null,
      );
      return options.length > 0 ? Math.min(...options) : null;
    };
    let affordable: SortableCard[] = merged;
    let overBudgetCount = 0;
    let nextDownFrom: number | null = null;
    if (budget != null) {
      affordable = [];
      for (const card of merged) {
        const need = needs(card);
        if (need == null) continue;
        if (need <= budget) {
          affordable.push(card);
          continue;
        }
        overBudgetCount += 1;
        if (nextDownFrom == null || need < nextDownFrom) nextDownFrom = need;
      }
    }
    const visible = freeDownOnly ? affordable.filter(isFreeDown) : affordable;
```

**4.8** แทนบรรทัด return ของ `listGroupedByModel`

```ts
    return { data, total, page, limit, minDownPct, monthsOptions, freeDownCount };
```

ด้วย

```ts
    return {
      data,
      total,
      page,
      limit,
      minDownPct,
      monthsOptions,
      freeDownCount,
      overBudgetCount,
      nextDownFrom,
    };
```

**4.9** `installmentFor` — แก้ type ของ `opts` จาก `opts?: { downPct?: number; months?: number },` เป็น

```ts
    opts?: { downPct?: number; months?: number; downAmount?: number },
```

แล้วแทน

```ts
    const asked = opts?.downPct != null ? new Decimal(opts.downPct).div(100) : config.minDownPct;
    const downPct = Decimal.max(asked, config.minDownPct);

    const result = calcBcInstallment({
      installmentPrice: new Decimal(installmentPrice),
      months,
      downPct,
      config,
    });
```

ด้วย

```ts
    const price = new Decimal(installmentPrice);
    const down =
      opts?.downAmount != null
        ? // เงินดาวน์เป็นบาท: เกินเพดานใช้เพดาน — ส่งเป็น customDownAmount แบบเดียวกับหน้ารายละเอียด
          { customDownAmount: Decimal.min(opts.downAmount, price.mul(MAX_CARD_DOWN_RATIO).floor()) }
        : {
            downPct: Decimal.max(
              opts?.downPct != null ? new Decimal(opts.downPct).div(100) : config.minDownPct,
              config.minDownPct,
            ),
          };

    const result = calcBcInstallment({ installmentPrice: price, months, config, ...down });
```

(บรรทัด `if (!result.isValid) return null;` และ return เดิมถัดจากนั้น**ไม่แก้**)

**4.10** เพิ่ม method ใหม่ไว้เหนือ comment block `/** "ผ่อนเริ่มต้น" ของกลุ่ม …` ของ `installmentFor` (ใต้ `rate2Quoter`):

```ts
  /**
   * กล่องเรท 1 ของการ์ด · `budget` = เงินดาวน์เป็นบาทที่ลูกค้าใส่ (สถานะ ②)
   * - ต่ำกว่าดาวน์ขั้นต่ำเรท 1 ของเครื่อง (ตัวเลขเดียวกับที่การ์ดโชว์ตอนไม่ใส่อะไร) → ไม่มีกล่องเรท 1
   * - ไม่งั้นดาวน์ = เงินที่ใส่ ไม่เกินเพดาน 90%
   * `minDown` คืนเฉพาะสถานะ ② — ใช้ตัดรายการและหา nextDownFrom
   */
  private rate1For(
    installmentPrice: number | null,
    config: BcConfig | null,
    opts: { downPct?: number; months?: number; budget: number | null },
  ): {
    quote: { monthly: number; downAmount: number; months: number } | null;
    minDown: number | null;
  } {
    if (opts.budget == null) {
      return {
        quote: this.installmentFor(installmentPrice, config, {
          downPct: opts.downPct,
          months: opts.months,
        }),
        minDown: null,
      };
    }
    const floor = this.installmentFor(installmentPrice, config, { months: opts.months });
    if (!floor) return { quote: null, minDown: null };
    if (opts.budget < floor.downAmount) return { quote: null, minDown: floor.downAmount };
    return {
      quote: this.installmentFor(installmentPrice, config, {
        months: opts.months,
        downAmount: opts.budget,
      }),
      minDown: floor.downAmount,
    };
  }

```

- [ ] **Step 5: รันเทสต์ใหม่ให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/wt-shop-rate-labels/apps/api" && NODE_OPTIONS="--max-old-space-size=8192 --experimental-vm-modules" node ../../node_modules/jest/bin/jest.js --runInBand --forceExit src/modules/shop-catalog/shop-catalog.down-amount.spec.ts
```

Expected: PASS — 14 tests

- [ ] **Step 6: รันเทสต์ทั้งโมดูล + type — ของเดิมต้องไม่แดง**

```bash
cd "/d/BESTCHOICE APP/wt-shop-rate-labels/apps/api" && NODE_OPTIONS="--max-old-space-size=8192 --experimental-vm-modules" node ../../node_modules/jest/bin/jest.js --runInBand --forceExit src/modules/shop-catalog && npx tsc --noEmit -p tsconfig.json
```

Expected: 11 suites / 168 tests ผ่าน (baseline 10 / 154 + ไฟล์ใหม่ 14) · `tsc` ไม่มี error
ถ้าเทสต์เดิมแดง (เช่น `shop-catalog.rate2.spec.ts`, `shop-catalog.installment-parity.spec.ts`) = โค้ดผิด ห้ามแก้เทสต์เดิม

- [ ] **Step 7: Checkpoint** — รายงานผล Step 5–6 (จำนวน suite/test จริง) · ไม่ commit

---

### Task 2: เว็บ — ช่องเงินดาวน์เป็นบาทแทนแถบเลื่อน % + `?down=` ใน URL + คำขอ

**Files:**
- Create: `apps/web-shop/src/components/catalog/DownAmountField.tsx`
- Create: `apps/web-shop/src/components/catalog/DownAmountField.test.tsx`
- Create: `apps/web-shop/src/components/catalog/FilterSidebar.down.test.tsx`
- Create: `apps/web-shop/src/pages/CatalogPage.down.test.tsx`
- Modify: `apps/web-shop/src/lib/copy.ts` (เพิ่ม 3 คีย์ใต้ `catalog`)
- Modify: `apps/web-shop/src/pages/catalog-params.ts` (LF) + `apps/web-shop/src/pages/catalog-params.test.ts` (แก้ตามที่ระบุ)
- Modify: `apps/web-shop/src/components/catalog/FilterSidebar.tsx` (CRLF — `PlanControls`, `PlanBlock`, import)
- Modify: `apps/web-shop/src/components/catalog/FilterSidebar.freeDown.test.tsx` (แก้ตามที่ระบุ)
- Modify: `apps/web-shop/src/pages/CatalogPage.tsx` (CRLF)
- Test (regression, ห้ามแก้): `apps/web-shop/src/pages/CatalogPage.freeDown.test.tsx`, `apps/web-shop/src/components/catalog/PlanTiles.test.tsx`, `CatalogResults*.test.tsx`

**Interfaces:**
- Consumes: API ของ Task 1 (`downAmount` ใน query) · ของรอบ 1 ใน `CatalogPage.tsx`: `priceMode`, `setPriceMode`, `freeDown`, `setFreeDown`, `lastMeta` ref, `freeDownOnly`, `showFreeDown`, `buildCatalogParams` · `copy` (`@/lib/copy`) · `cn` (`@/lib/utils`)
- Produces (Task 3–5 ใช้):
  - `copy.catalog.downLabel` (`'เงินดาวน์'`), `copy.catalog.downUnit` (`'บาท'`), `copy.catalog.downHint`
  - `parseDownParam(raw: string | null): number | null` และ `CatalogQuery.downAmount: number | null` (แทน `downPct`) ใน `pages/catalog-params.ts`
  - `DownAmountField` props `{ id: string; value: number | null; onCommit: (next: number | null) => void; disabled?: boolean; variant?: 'panel' | 'pill'; hintId?: string }` · `parseDownInput(raw: string): number | null` · `MAX_DOWN_BAHT = 9_999_999`
  - `PlanControls` ใหม่: `{ down: number | null; months: number | null; monthsOptions: number[]; onDown: (v: number | null) => void; onMonths: (v: number | null) => void; freeDown: boolean; freeDownCount: number; onFreeDown: (v: boolean) => void }` (ไม่มี `downPct` / `minDownPct` / `onDownPct` แล้ว)
  - ใน `CatalogPage`: `down: number | null` (ค่าใน URL), `setDown(next: number | null)` (0 = ติ๊กฟรีดาวน์), `activeDown: number | null` (ค่าที่ใช้กับคำขอ — มีเฉพาะสถานะ ②), `setFreeDown(next: boolean)` (ล้าง `down` ด้วย)
  - ไฟล์เทสต์ `CatalogPage.down.test.tsx` มีตัวช่วยระดับไฟล์: `get` (mock ของ `api.get`), `page(over)`, `open(url)`, `listCalls()`, `paramsOf(url)`, `lastParams()`, `urlParams()`, `downInput()` — Task 3–5 เพิ่มเทสต์ต่อท้ายไฟล์นี้

**หมายเหตุการออกแบบ:**
- สถานะเก็บใน URL แบบเดียวกับ `freeDown`: `?down=5000` · `setSearchParams` ของ react-router ไม่ต่อคิวกัน — ทุกการกระทำต้องเขียน URL **ครั้งเดียว**
- กล่องเงินดาวน์แสดงทุกครั้งที่อยู่โหมดผ่อน (ไม่รอ `minDownPct` จากคำตอบแรกเหมือนแถบเลื่อนเดิม — ช่องบาทไม่ต้องใช้ค่านั้น)
- ตั้งค่าเงินดาวน์ = หน่วง 250ms ก่อนเปลี่ยนคำขอ · ล้างค่า (ว่าง / ติ๊กฟรีดาวน์ / สลับซื้อสด) = มีผลทันที
- ช่องนี้เป็น `type="text"` + `inputMode="numeric"` (แสดง `5,000` ได้) · ค่าที่ผู้ใช้พิมพ์ถูกกรองเหลือตัวเลขตอน commit

- [ ] **Step 1: เขียน/แก้เทสต์ (ยังไม่ผ่าน)**

**1.1** แทนเนื้อหาทั้งไฟล์ `apps/web-shop/src/pages/catalog-params.test.ts` (ไฟล์เล็ก · LF) — ที่เปลี่ยนจากเดิม: (ก) `base` ใช้ `downAmount: null` แทน `downPct: null` (ข) เทสต์ที่สองเปลี่ยนชื่อและใช้ `downAmount: 5000` / คาด `downAmount: '5000'` แทน `downPct: 20` / `downPct: '20'` (ค) เทสต์ใหม่ 3 ตัวท้ายไฟล์ · เทสต์ที่หนึ่งและสามคงเดิมทุกตัวอักษร

```ts
import { describe, expect, it } from 'vitest';
import { buildCatalogParams, parseDownParam } from './catalog-params';

const base = {
  filters: {},
  sort: 'popular',
  downAmount: null,
  months: null,
  freeDown: false,
  page: 1,
};

describe('buildCatalogParams', () => {
  it('ค่าเริ่มต้น: มีแค่ sort กับ page', () => {
    expect(buildCatalogParams(base).toString()).toBe('sort=popular&page=1');
  });

  it('ส่งตัวกรองเดิมครบ และเงินดาวน์ (บาท) / งวด', () => {
    const p = buildCatalogParams({
      ...base,
      filters: { deviceOrigin: 'IMPORTED', condition: 'USED', model: 'iPhone 15', minPrice: 10000, maxPrice: 15000, search: 'โปร' },
      downAmount: 5000,
      months: 12,
      page: 3,
    });
    expect(Object.fromEntries(p)).toEqual({
      deviceOrigin: 'IMPORTED',
      condition: 'USED',
      model: 'iPhone 15',
      minPrice: '10000',
      maxPrice: '15000',
      search: 'โปร',
      sort: 'popular',
      downAmount: '5000',
      months: '12',
      page: '3',
    });
  });

  it('ติ๊กฟรีดาวน์ → freeDown=true', () => {
    expect(buildCatalogParams({ ...base, freeDown: true }).get('freeDown')).toBe('true');
    expect(buildCatalogParams(base).has('freeDown')).toBe(false);
  });

  it('เว็บรุ่นนี้เลิกส่ง downPct', () => {
    expect(buildCatalogParams({ ...base, downAmount: 5000 }).has('downPct')).toBe(false);
  });

  it('ฟรีดาวน์ชนะเงินดาวน์ · เงินดาวน์ 0 ไม่ถูกส่ง', () => {
    const p = buildCatalogParams({ ...base, freeDown: true, downAmount: 5000 });
    expect(p.get('freeDown')).toBe('true');
    expect(p.has('downAmount')).toBe(false);
    expect(buildCatalogParams({ ...base, downAmount: 0 }).has('downAmount')).toBe(false);
  });
});

describe('parseDownParam', () => {
  it('รับเฉพาะจำนวนเต็มบาท ≥ 0 ไม่เกิน 7 หลัก · อย่างอื่น = null', () => {
    expect(parseDownParam('5000')).toBe(5000);
    expect(parseDownParam('0')).toBe(0);
    for (const bad of [null, '', '-1', '12.5', 'abc', '5,000', '12345678']) {
      expect(parseDownParam(bad)).toBeNull();
    }
  });
});
```

**1.2** สร้าง `apps/web-shop/src/components/catalog/DownAmountField.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DownAmountField, parseDownInput } from './DownAmountField';

describe('parseDownInput', () => {
  it('เหลือแต่ตัวเลข · ว่าง / ไม่มีตัวเลข = null · ไม่เกินเพดาน', () => {
    expect(parseDownInput('5000')).toBe(5000);
    expect(parseDownInput('5,000 บาท')).toBe(5000);
    expect(parseDownInput('0')).toBe(0);
    expect(parseDownInput('')).toBeNull();
    expect(parseDownInput('abc')).toBeNull();
    expect(parseDownInput('99999999999')).toBe(9_999_999);
  });
});

describe('DownAmountField', () => {
  function show(over: Partial<Parameters<typeof DownAmountField>[0]> = {}) {
    const onCommit = vi.fn();
    render(<DownAmountField id="t-down" value={null} onCommit={onCommit} {...over} />);
    return { onCommit, input: screen.getByLabelText('เงินดาวน์') as HTMLInputElement };
  }

  it('มี label "เงินดาวน์" หน่วย "บาท" · ช่องตัวเลขสูง 44px · ไม่ใส่ = ว่าง', () => {
    const { input } = show();
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input.className).toContain('h-11');
    expect(screen.getByText('บาท')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('ระหว่างพิมพ์ยังไม่แจ้ง · ออกจากช่องจึงแจ้ง และจัดรูปเป็น 5,000', () => {
    const { input, onCommit } = show();
    fireEvent.change(input, { target: { value: '5000' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(5000);
    expect(input).toHaveValue('5,000');
  });

  it('กด Enter = ออกจากช่อง', () => {
    const { input, onCommit } = show();
    input.focus();
    fireEvent.change(input, { target: { value: '3000' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(3000);
  });

  it('ค่าเดิม → ไม่แจ้งซ้ำ · ลบจนว่าง → แจ้ง null · พิมพ์ 0 → แจ้ง 0', () => {
    const { input, onCommit } = show({ value: 5000 });
    expect(input).toHaveValue('5,000');
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(null);
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(0);
  });

  it('disabled (ติ๊กฟรีดาวน์อยู่): ใช้ไม่ได้ และแสดง 0', () => {
    const { input } = show({ disabled: true });
    expect(input).toBeDisabled();
    expect(input).toHaveValue('0');
  });

  it('แบบ pill (แถวบนของมือถือ): label เดิม · แถวสูง 44px', () => {
    const { input } = show({ variant: 'pill' });
    expect(input.closest('div.rounded-full')?.className).toContain('min-h-11');
  });
});
```

**1.3** สร้าง `apps/web-shop/src/components/catalog/FilterSidebar.down.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterSidebar, type PlanControls } from './FilterSidebar';

function plan(over: Partial<PlanControls> = {}): PlanControls {
  return {
    down: null,
    months: null,
    monthsOptions: [10, 12],
    onDown: vi.fn(),
    onMonths: vi.fn(),
    freeDown: false,
    freeDownCount: 12,
    onFreeDown: vi.fn(),
    ...over,
  };
}
const show = (p: PlanControls) =>
  render(<FilterSidebar filters={{}} onChange={vi.fn()} models={[]} plan={p} />);

describe('กล่องเงินดาวน์เป็นบาท', () => {
  it('ช่องพิมพ์เป็นบาท — ไม่มีแถบเลื่อน ไม่มี % ไม่มีคำว่า "เรท"', () => {
    const { container } = show(plan({ down: 5000 }));
    expect(screen.getByLabelText('เงินดาวน์')).toHaveValue('5,000');
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(container.textContent).not.toContain('%');
    expect(container.textContent).not.toContain('เรท');
    expect(screen.getByText(/ใส่เงินดาวน์ที่มี/)).toBeInTheDocument();
  });

  it('ออกจากช่องแล้วแจ้งจำนวนบาทกลับ', () => {
    const p = plan();
    show(p);
    const input = screen.getByLabelText('เงินดาวน์');
    fireEvent.change(input, { target: { value: '3000' } });
    fireEvent.blur(input);
    expect(p.onDown).toHaveBeenCalledWith(3000);
  });

  it('ไม่มี plan (โหมดซื้อสด) → ไม่มีกล่องเงินดาวน์', () => {
    render(<FilterSidebar filters={{}} onChange={vi.fn()} models={[]} />);
    expect(screen.queryByLabelText('เงินดาวน์')).not.toBeInTheDocument();
  });
});
```

**1.4** แก้ `apps/web-shop/src/components/catalog/FilterSidebar.freeDown.test.tsx` — **เฉพาะ 2 จุดนี้** (แถบเลื่อน % ถูกเอาออกจริงในรอบ 2):

(ก) ตัวสร้าง `plan()` — แทน

```tsx
  return {
    downPct: 15,
    months: null,
    minDownPct: 15,
    monthsOptions: [10, 12],
    onDownPct: vi.fn(),
    onMonths: vi.fn(),
```

ด้วย

```tsx
  return {
    down: null,
    months: null,
    monthsOptions: [10, 12],
    onDown: vi.fn(),
    onMonths: vi.fn(),
```

(ข) เทสต์ที่สาม — แทนชื่อและสอง assertion

```tsx
  it('ติ๊กอยู่ → ยังแสดงแม้นับได้ 0 · ช่องดาวน์และแถบเลื่อนใช้ไม่ได้ · เอาติ๊กออกได้', () => {
```

```tsx
    expect(screen.getByLabelText('เงินดาวน์')).toBeDisabled();
    expect(screen.getByLabelText('เลื่อนปรับเงินดาวน์')).toBeDisabled();
```

ด้วย

```tsx
  it('ติ๊กอยู่ → ยังแสดงแม้นับได้ 0 · ช่องเงินดาวน์ใช้ไม่ได้และแสดง 0 (ไม่มีแถบเลื่อนแล้ว) · เอาติ๊กออกได้', () => {
```

```tsx
    expect(screen.getByLabelText('เงินดาวน์')).toBeDisabled();
    expect(screen.getByLabelText('เงินดาวน์')).toHaveValue('0');
    expect(screen.queryByLabelText('เลื่อนปรับเงินดาวน์')).not.toBeInTheDocument();
```

บรรทัดอื่นของไฟล์นี้ห้ามแตะ

**1.5** สร้าง `apps/web-shop/src/pages/CatalogPage.down.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import CatalogPage from './CatalogPage';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get } }));
vi.mock('@/components/layout/ShopLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const unit = {
  id: 'u1',
  kind: 'UNIT',
  brand: 'Apple',
  model: 'iPhone 16 Pro Max',
  storage: '256GB',
  condition: 'USED',
  minPrice: 29900,
  stockCount: 1,
  monthlyPaymentFrom: 2890,
  downAmount: 4485,
  installmentMonths: 12,
  rate2: { down: 0, monthly: 4061, months: 15 },
  stock: { display: 'พร้อมขาย', tone: 'normal' },
  images: [],
  tags: [],
};
const page = (over: Record<string, unknown> = {}) => ({
  data: {
    data: [unit],
    total: 1,
    page: 1,
    limit: 12,
    minDownPct: 15,
    monthsOptions: [10, 12],
    freeDownCount: 3,
    overBudgetCount: 0,
    nextDownFrom: null,
    ...over,
  },
});

let lastSearch = '';
function Probe() {
  lastSearch = useLocation().search;
  return null;
}
function open(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Probe />
        <CatalogPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const listCalls = () =>
  get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/shop/products'));
const paramsOf = (url: string) => new URL(url, 'https://shop.test').searchParams;
const lastParams = () => {
  const calls = listCalls();
  return paramsOf(calls[calls.length - 1]);
};
const urlParams = () => new URLSearchParams(lastSearch);
/** ช่องเงินดาวน์ช่องแรกในหน้า (แถบข้าง) */
const downInput = async () =>
  (await screen.findAllByLabelText('เงินดาวน์'))[0] as HTMLInputElement;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  vi.clearAllMocks();
  lastSearch = '';
  get.mockImplementation((url: string) =>
    url.startsWith('/api/shop/models') ? Promise.resolve({ data: [] }) : Promise.resolve(page()),
  );
});

it('ไม่ใส่เงินดาวน์ → คำขอไม่มี downAmount และเว็บเลิกส่ง downPct', async () => {
  open('/products');
  expect(await downInput()).toHaveValue('');
  await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
  await pause(400);
  for (const url of listCalls()) {
    expect(paramsOf(url).has('downAmount')).toBe(false);
    expect(paramsOf(url).has('downPct')).toBe(false);
  }
});

it('ลิงก์ ?down=5000 → คำขอแรกส่ง downAmount=5000 และช่องแสดง 5,000', async () => {
  open('/products?down=5000');
  await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
  expect(paramsOf(listCalls()[0]).get('downAmount')).toBe('5000');
  expect(await downInput()).toHaveValue('5,000');
});

it('ระหว่างพิมพ์ยังไม่ยิงคำขอ · ออกจากช่องแล้ว ?down= เข้า URL และคำขอใหม่ส่ง downAmount', async () => {
  open('/products');
  const input = await downInput();
  await waitFor(() => expect(listCalls().length).toBe(1));
  fireEvent.change(input, { target: { value: '3000' } });
  await pause(400);
  expect(listCalls().length).toBe(1);
  expect(urlParams().has('down')).toBe(false);
  fireEvent.blur(input);
  await waitFor(() => expect(urlParams().get('down')).toBe('3000'));
  await waitFor(() => expect(lastParams().get('downAmount')).toBe('3000'));
});

it('พิมพ์ 0 = ติ๊กฟรีดาวน์: URL เป็น freeDown=1 ไม่มี down · คำขอส่ง freeDown=true · ช่องเงินดาวน์ใช้ไม่ได้', async () => {
  open('/products');
  const input = await downInput();
  fireEvent.change(input, { target: { value: '0' } });
  fireEvent.blur(input);
  await waitFor(() => expect(urlParams().get('freeDown')).toBe('1'));
  expect(urlParams().has('down')).toBe(false);
  await waitFor(() => expect(lastParams().get('freeDown')).toBe('true'));
  expect(lastParams().has('downAmount')).toBe(false);
  for (const box of screen.getAllByRole('checkbox', { name: /ฟรีดาวน์/ })) expect(box).toBeChecked();
  expect(await downInput()).toBeDisabled();
});

it('มีเงินดาวน์แล้วติ๊กฟรีดาวน์ → down หายจาก URL · เอาติ๊กออก → กลับสถานะไม่ใส่อะไร', async () => {
  open('/products?down=5000');
  const boxes = await screen.findAllByRole('checkbox', { name: /ฟรีดาวน์/ });
  fireEvent.click(boxes[0]);
  await waitFor(() => expect(urlParams().get('freeDown')).toBe('1'));
  expect(urlParams().has('down')).toBe(false);
  fireEvent.click(screen.getAllByRole('checkbox', { name: /ฟรีดาวน์/ })[0]);
  await waitFor(() => expect(urlParams().has('freeDown')).toBe(false));
  expect(urlParams().has('down')).toBe(false);
  await waitFor(() => {
    const p = lastParams();
    expect(p.has('freeDown')).toBe(false);
    expect(p.has('downAmount')).toBe(false);
  });
  expect(await downInput()).toHaveValue('');
});

it('สลับเป็นซื้อสด → down หายจาก URL และจากคำขอ · ไม่มีช่องเงินดาวน์', async () => {
  open('/products?down=5000');
  await downInput();
  fireEvent.click(screen.getByRole('button', { name: 'ซื้อสด' }));
  await waitFor(() => expect(urlParams().has('down')).toBe(false));
  await waitFor(() => expect(lastParams().has('downAmount')).toBe(false));
  expect(screen.queryByLabelText('เงินดาวน์')).not.toBeInTheDocument();
});

it('ลิงก์ ?down=0 = ฟรีดาวน์', async () => {
  open('/products?down=0');
  await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
  expect(paramsOf(listCalls()[0]).get('freeDown')).toBe('true');
  expect(paramsOf(listCalls()[0]).has('downAmount')).toBe(false);
});

it('ลิงก์ ?down= ที่ไม่ใช่จำนวนเต็มบาท → ไม่ใช้', async () => {
  open('/products?down=abc');
  await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
  expect(paramsOf(listCalls()[0]).has('downAmount')).toBe(false);
  expect(await downInput()).toHaveValue('');
});
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

```bash
cd "/d/BESTCHOICE APP/wt-shop-rate-labels/apps/web-shop" && npx vitest run src/pages/catalog-params.test.ts src/components/catalog/DownAmountField.test.tsx src/components/catalog/FilterSidebar.down.test.tsx src/components/catalog/FilterSidebar.freeDown.test.tsx src/pages/CatalogPage.down.test.tsx
```

Expected: FAIL — หา `./DownAmountField` ไม่เจอ · `parseDownParam` ไม่ใช่ฟังก์ชัน · ช่อง "เงินดาวน์" ยังเป็นช่อง % (ค่าไม่ใช่ `'5,000'` / `'0'`) · คำขอยังส่ง `downPct`

- [ ] **Step 3: `copy.ts`**

ใน `apps/web-shop/src/lib/copy.ts` (CRLF) ใต้ `catalog:` เพิ่มต่อจากบรรทัด `emptyFreeDownDescription: …`:

```ts
    // ตัวกรองเงินดาวน์เป็นบาท (สเปค 2026-11-25 หัวข้อ 5–6)
    downLabel: 'เงินดาวน์',
    downUnit: 'บาท',
    downHint:
      'ใส่เงินดาวน์ที่มี ระบบจะแสดงทุกเครื่องที่ดาวน์ได้ · ไม่ใส่ = ดาวน์ขั้นต่ำของแต่ละเครื่อง',
```

- [ ] **Step 4: `catalog-params.ts`**

แทนเนื้อหาทั้งไฟล์ `apps/web-shop/src/pages/catalog-params.ts` (LF):

```ts
import type { CatalogFilters } from '@/components/catalog/FilterSidebar';

export interface CatalogQuery {
  filters: CatalogFilters;
  sort: string;
  /** เงินดาวน์ที่ลูกค้าพิมพ์ (บาทเต็ม) — null = ไม่ได้ใส่ ให้ API ใช้ดาวน์ขั้นต่ำของแต่ละเครื่อง */
  downAmount: number | null;
  months: number | null;
  /** ติ๊ก "ฟรีดาวน์" — ขอเฉพาะเครื่องที่ไม่ต้องวางดาวน์ */
  freeDown: boolean;
  page: number;
}

/** อ่าน `?down=` (หน้ารวมและหน้ารายละเอียด): จำนวนเต็มบาท ≥ 0 ไม่เกิน 7 หลัก · อย่างอื่น = null */
export function parseDownParam(raw: string | null): number | null {
  if (raw == null || !/^\d{1,7}$/.test(raw)) return null;
  return Number(raw);
}

/** query string ของ GET /api/shop/products — ที่เดียว ให้หน้ารวมกับเทสต์ใช้ร่วมกัน */
export function buildCatalogParams(q: CatalogQuery): URLSearchParams {
  const { filters } = q;
  const params = new URLSearchParams();
  if (filters.deviceOrigin) params.set('deviceOrigin', filters.deviceOrigin);
  if (filters.condition) params.set('condition', filters.condition);
  if (filters.model) params.set('model', filters.model);
  if (filters.conditionGrade) params.set('conditionGrade', filters.conditionGrade);
  if (filters.minPrice !== undefined) params.set('minPrice', String(filters.minPrice));
  if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice));
  if (filters.search) params.set('search', filters.search);
  params.set('sort', q.sort);
  if (q.months != null) params.set('months', String(q.months));
  // ฟรีดาวน์ชนะเงินดาวน์ (กติกาเดียวกับ API) · เว็บรุ่นนี้เลิกส่ง downPct — API ยังรับไว้ให้เว็บรุ่นเก่า
  if (q.freeDown) params.set('freeDown', 'true');
  else if (q.downAmount != null && q.downAmount > 0) {
    params.set('downAmount', String(q.downAmount));
  }
  params.set('page', String(q.page));
  return params;
}
```

- [ ] **Step 5: สร้าง `DownAmountField.tsx`**

สร้าง `apps/web-shop/src/components/catalog/DownAmountField.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { copy } from '@/lib/copy';
import { cn } from '@/lib/utils';

/** เพดานของช่องเงินดาวน์ — ตรงกับ `@Max` ของ `ListProductsDto.downAmount` ฝั่ง API */
export const MAX_DOWN_BAHT = 9_999_999;

/** ข้อความในช่อง → จำนวนเต็มบาท · ว่าง / ไม่มีตัวเลข = null (ไม่ได้ใส่เงินดาวน์) */
export function parseDownInput(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits === '') return null;
  return Math.min(MAX_DOWN_BAHT, Number(digits));
}

interface Props {
  id: string;
  /** เงินดาวน์ที่ใช้อยู่ (บาท) — null = ไม่ได้ใส่ */
  value: number | null;
  /** เรียกเมื่อออกจากช่อง / กด Enter และค่าเปลี่ยนจริง · 0 = ไม่มีเงินดาวน์ (ผู้เรียกแปลงเป็นฟรีดาวน์) */
  onCommit: (next: number | null) => void;
  /** ติ๊กฟรีดาวน์อยู่: ช่องใช้ไม่ได้ และแสดง 0 */
  disabled?: boolean;
  /** 'panel' = ในกล่องเงินดาวน์ของตัวกรอง · 'pill' = แถวบนของมือถือ */
  variant?: 'panel' | 'pill';
  /** id ของข้อความอธิบายใต้ช่อง (ถ้ามี) */
  hintId?: string;
}

/** "เงินดาวน์ [____] บาท" — ช่องพิมพ์จำนวนเงินที่ลูกค้ามี (สเปค 2026-11-25 หัวข้อ 5–6) */
export function DownAmountField({
  id,
  value,
  onCommit,
  disabled = false,
  variant = 'panel',
  hintId,
}: Props) {
  const shown = disabled ? '0' : value == null ? '' : value.toLocaleString();
  // เก็บข้อความดิบระหว่างพิมพ์ — ส่งค่าเฉพาะตอนออกจากช่องหรือกด Enter (ไม่ยิงคำขอทุกตัวอักษร)
  const [raw, setRaw] = useState(shown);
  useEffect(() => setRaw(shown), [shown]);

  function commit() {
    const next = parseDownInput(raw);
    setRaw(next == null ? '' : next.toLocaleString());
    if (next !== value) onCommit(next);
  }

  const pill = variant === 'pill';
  return (
    <div
      className={cn(
        'flex items-center gap-2',
        pill
          ? 'min-h-11 min-w-0 flex-1 rounded-full bg-muted pl-4 pr-3.5 ring-1 ring-inset ring-border/70 focus-within:ring-2 focus-within:ring-emerald-500/50'
          : 'justify-between',
      )}
    >
      <label
        htmlFor={id}
        className={cn(
          'text-sm leading-snug whitespace-nowrap',
          pill ? 'font-head text-accent-foreground' : 'text-emerald-900',
        )}
      >
        {copy.catalog.downLabel}
      </label>
      <div className={cn('flex items-center gap-1.5', pill && 'min-w-0 flex-1')}>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={raw}
          disabled={disabled}
          aria-describedby={hintId}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className={cn(
            'num h-11 text-right text-base font-bold leading-snug disabled:opacity-50 focus:outline-none',
            pill
              ? 'min-w-0 flex-1 bg-transparent text-primary'
              : 'w-28 rounded-lg bg-card px-2 text-emerald-800 focus:ring-2 focus:ring-emerald-500/50',
          )}
        />
        <span
          className={cn(
            'text-sm leading-snug',
            pill ? 'font-head text-accent-foreground' : 'font-bold text-emerald-800',
          )}
        >
          {copy.catalog.downUnit}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: `FilterSidebar.tsx` — กล่องเงินดาวน์เป็นบาท**

แก้ `apps/web-shop/src/components/catalog/FilterSidebar.tsx` (CRLF):

**6.1** import — แทน

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { useEffect, useState } from 'react';
import { SlidersHorizontal, Sparkles, Smartphone, X } from '@/lib/icons';
import { cn } from '@/lib/utils';
import { parseDeviceOrigin, type DeviceOrigin } from '@/lib/device-origin';
```

ด้วย

```tsx
import { NativeSelect } from '@/components/ui/native-select';
import { SlidersHorizontal, Sparkles, Smartphone, X } from '@/lib/icons';
import { copy } from '@/lib/copy';
import { cn } from '@/lib/utils';
import { parseDeviceOrigin, type DeviceOrigin } from '@/lib/device-origin';
import { DownAmountField } from './DownAmountField';
```

**6.2** แทน `export interface PlanControls { … }` ทั้งก้อน **และ** comment + `const MAX_DOWN_PCT = 80;` ที่อยู่ถัดลงมา (ตั้งแต่ `export interface PlanControls {` ถึงบรรทัด `const MAX_DOWN_PCT = 80;`) ด้วย

```tsx
export interface PlanControls {
  /** เงินดาวน์ที่ลูกค้าพิมพ์ (บาท) — null = ไม่ได้ใส่ */
  down: number | null;
  months: number | null;
  monthsOptions: number[];
  /** 0 = ไม่มีเงินดาวน์ (หน้ารวมแปลงเป็นติ๊กฟรีดาวน์) */
  onDown: (v: number | null) => void;
  onMonths: (v: number | null) => void;
  /** ลูกค้าติ๊ก "ฟรีดาวน์" อยู่ */
  freeDown: boolean;
  /** จำนวนเครื่องฟรีดาวน์ตามตัวกรองอื่น */
  freeDownCount: number;
  onFreeDown: (v: boolean) => void;
}
```

**6.3** ใน `body` แทน `{plan && <PlanBlock plan={plan} />}` ด้วย `{plan && <PlanBlock plan={plan} bare={bare} />}`

**6.4** แทน `PlanBlock` ทั้งฟังก์ชันพร้อม comment เหนือมัน (ตั้งแต่บรรทัด `/**` ของ ` * Down payment + tenure. …` ถึงท้ายไฟล์) ด้วย

```tsx
/** กล่องเงินดาวน์ของตัวกรอง: เงินดาวน์เป็นบาท · ติ๊กฟรีดาวน์ · จำนวนงวด (สเปค 2026-11-25 หัวข้อ 5–6) */
function PlanBlock({ plan, bare }: { plan: PlanControls; bare?: boolean }) {
  const downId = bare ? 'mobile-filter-down' : 'filter-down';
  return (
    <div className="rounded-2xl bg-emerald-50 p-3.5">
      <DownAmountField
        id={downId}
        hintId={`${downId}-hint`}
        value={plan.down}
        disabled={plan.freeDown}
        onCommit={plan.onDown}
      />
      <p id={`${downId}-hint`} className="mt-1.5 text-xs text-emerald-800/70 leading-snug">
        {plan.freeDown
          ? 'กำลังแสดงเฉพาะเครื่องที่ไม่ต้องวางดาวน์ — เอาติ๊กออกเพื่อตั้งเงินดาวน์เอง'
          : copy.catalog.downHint}
      </p>

      {(plan.freeDownCount > 0 || plan.freeDown) && (
        <label
          className={cn(
            'mt-3 flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-3 text-sm leading-snug',
            plan.freeDown
              ? 'bg-sand-50 font-semibold text-sand-900 ring-1 ring-inset ring-promo/60'
              : 'bg-card text-emerald-900',
          )}
        >
          <input
            type="checkbox"
            checked={plan.freeDown}
            onChange={(e) => plan.onFreeDown(e.target.checked)}
            className="size-5 shrink-0 accent-emerald-600"
          />
          ฟรีดาวน์
          <span className="num ml-auto text-xs font-normal text-muted-foreground">
            {plan.freeDownCount} เครื่อง
          </span>
        </label>
      )}

      {plan.monthsOptions.length > 0 && (
        <div className="mt-3">
          <label
            className="block text-sm text-emerald-900 mb-2 leading-snug"
            htmlFor="filter-months"
          >
            จำนวนงวด
          </label>
          <NativeSelect wrapperClassName="max-w-full w-full"
            id="filter-months"
            className="h-10 rounded-xl border-0 bg-card px-3 text-base md:text-sm text-foreground leading-snug focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            value={plan.months ?? ''}
            disabled={plan.freeDown}
            onChange={(e) => plan.onMonths(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">งวดยาวสุด (ผ่อนถูกที่สุด)</option>
            {plan.monthsOptions.map((m) => (
              <option key={m} value={m}>
                {m} งวด
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
    </div>
  );
}
```

(บล็อกช่องติ๊กฟรีดาวน์และจำนวนงวดคือของเดิมทุกตัวอักษร — ที่หายไปคือช่อง %, แถบเลื่อน, ข้อความ "ขั้นต่ำ …%" และประโยคปิดท้าย "เลื่อนหรือพิมพ์แล้ว…")

- [ ] **Step 7: `CatalogPage.tsx` — สถานะ `?down=`, คำขอ, plan**

แก้ `apps/web-shop/src/pages/CatalogPage.tsx` (CRLF):

**7.1** import — แทน `import { buildCatalogParams } from './catalog-params';` ด้วย

```tsx
import { buildCatalogParams, parseDownParam } from './catalog-params';
```

**7.2** state — แทน

```tsx
  const [sort, setSort] = useState<string>('popular');
  // null = "not chosen yet", so the first response's minimum can seed it without
  // fighting a value the shopper actually picked.
  const [downPct, setDownPct] = useState<number | null>(null);
  const [months, setMonths] = useState<number | null>(null);
  // The range input fires on every pixel of a drag; refetching that often would
  // hammer the API for figures nobody reads. Commit shortly after they stop.
  const [committedDown, setCommittedDown] = useState<number | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
```

ด้วย

```tsx
  const [sort, setSort] = useState<string>('popular');
  const [months, setMonths] = useState<number | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
```

**7.3** ลบ effect นี้ทิ้งทั้งก้อน:

```tsx
  useEffect(() => {
    const t = setTimeout(() => setCommittedDown(downPct), 250);
    return () => clearTimeout(t);
  }, [downPct]);

```

**7.4** แทนตั้งแต่ `const priceMode: PriceMode = …` ถึงจบฟังก์ชัน `setFreeDown` (ก้อนนี้)

```tsx
  const priceMode: PriceMode = searchParams.get('mode') === 'cash' ? 'cash' : 'installment';
  function setPriceMode(next: PriceMode) {
    const sp = new URLSearchParams(searchParams);
    if (next === 'cash') {
      sp.set('mode', 'cash');
      sp.delete('freeDown'); // ฟรีดาวน์เป็นเรื่องผ่อนอย่างเดียว
    } else sp.delete('mode');
    setSearchParams(sp, { replace: true });
  }

  // ฟรีดาวน์อยู่ใน URL เหมือนโหมดราคา — ลิงก์โฆษณาเปิดมาที่หน้าที่ติ๊กไว้แล้วได้
  const freeDown = priceMode === 'installment' && searchParams.get('freeDown') === '1';
  function setFreeDown(next: boolean) {
    const sp = new URLSearchParams(searchParams);
    if (next) sp.set('freeDown', '1');
    else sp.delete('freeDown');
    setSearchParams(sp, { replace: true });
  }
```

ด้วย

```tsx
  const priceMode: PriceMode = searchParams.get('mode') === 'cash' ? 'cash' : 'installment';
  function setPriceMode(next: PriceMode) {
    const sp = new URLSearchParams(searchParams);
    if (next === 'cash') {
      sp.set('mode', 'cash');
      // เงินดาวน์และฟรีดาวน์เป็นเรื่องผ่อนอย่างเดียว
      sp.delete('freeDown');
      sp.delete('down');
    } else sp.delete('mode');
    setSearchParams(sp, { replace: true });
  }

  // เงินดาวน์ (บาท) และฟรีดาวน์อยู่ใน URL เหมือนโหมดราคา — ลิงก์โฆษณา/ลิงก์แชร์เปิดมาในสถานะเดียวกันได้
  const rawDown = priceMode === 'installment' ? parseDownParam(searchParams.get('down')) : null;
  // พิมพ์ 0 = ติ๊กฟรีดาวน์ · ฟรีดาวน์ชนะเงินดาวน์ (กติกาเดียวกับ API)
  const freeDown =
    priceMode === 'installment' && (searchParams.get('freeDown') === '1' || rawDown === 0);
  const down = freeDown ? null : rawDown;
  // เขียน URL ครั้งเดียวต่อการกระทำ — setSearchParams ไม่ต่อคิวกัน
  function setDown(next: number | null) {
    const sp = new URLSearchParams(searchParams);
    sp.delete('down');
    if (next === 0) sp.set('freeDown', '1');
    else if (next != null) sp.set('down', String(next));
    setSearchParams(sp, { replace: true });
  }
  function setFreeDown(next: boolean) {
    const sp = new URLSearchParams(searchParams);
    // ติ๊ก = ไม่มีเงินดาวน์ · เอาติ๊กออก = กลับสถานะไม่ใส่อะไร (สเปคหัวข้อ 5)
    sp.delete('down');
    if (next) sp.set('freeDown', '1');
    else sp.delete('freeDown');
    setSearchParams(sp, { replace: true });
  }
  // ช่องเงินดาวน์ commit ตอนออกจากช่อง / กด Enter แล้วหน่วง 250ms ก่อนเปลี่ยนคำขอ · ล้างค่ามีผลทันที
  const [committedDown, setCommittedDown] = useState<number | null>(down);
  useEffect(() => {
    if (down == null) {
      setCommittedDown(null);
      return;
    }
    const t = setTimeout(() => setCommittedDown(down), 250);
    return () => clearTimeout(t);
  }, [down]);
  // ค่าที่ใช้กับคำขอและการ์ด — มีเฉพาะสถานะ ② (โหมดผ่อน · ไม่ได้ติ๊กฟรีดาวน์)
  const activeDown = priceMode === 'installment' && !freeDown ? committedDown : null;
```

**7.5** คำขอ — แทน

```tsx
    queryKey: ['shop', 'catalog', filters, sort, committedDown, months, freeDown],
    queryFn: ({ pageParam }) => {
      const params = buildCatalogParams({
        filters,
        sort,
        downPct: committedDown,
        months,
        freeDown,
        page: pageParam as number,
      });
```

ด้วย

```tsx
    queryKey: ['shop', 'catalog', filters, sort, activeDown, months, freeDown],
    queryFn: ({ pageParam }) => {
      const params = buildCatalogParams({
        filters,
        sort,
        downAmount: activeDown,
        months,
        freeDown,
        page: pageParam as number,
      });
```

**7.6** meta + plan — แทนตั้งแต่ comment `// ตัวควบคุมแผนผ่อน (สไลด์เดอร์ · งวด · ช่องฟรีดาวน์) …` ถึงจบ `const plan = … : undefined;` (ก้อนนี้)

```tsx
  // ตัวควบคุมแผนผ่อน (สไลด์เดอร์ · งวด · ช่องฟรีดาวน์) ต้องไม่หายระหว่างโหลดรายการใหม่ —
  // จำค่าล่าสุดจากหน้าแรกที่เคยได้ แล้วอ่านจากนั้นตอน data ยังเป็น undefined
  // (ห้ามใช้ keepPreviousData: การ์ดเก่าจะค้างใต้ตัวกรองใหม่)
  const lastMeta = useRef<{
    minDownPct: number | null;
    monthsOptions: number[];
    freeDownCount: number;
    freeDownSupported: boolean;
  } | null>(null);
  if (first) {
    lastMeta.current = {
      minDownPct: first.minDownPct ?? null,
      monthsOptions: first.monthsOptions ?? [],
      freeDownCount: first.freeDownCount ?? 0,
      freeDownSupported: first.freeDownCount !== undefined,
    };
  }
  const minDownPct = lastMeta.current?.minDownPct ?? null;
  const monthsOptions = lastMeta.current?.monthsOptions ?? [];
  const freeDownCount = lastMeta.current?.freeDownCount ?? 0;
  // API รุ่นเก่าไม่ส่ง freeDownCount และไม่รู้จักตัวกรอง — อย่าให้การ์ดขึ้นโหมดฟรีดาวน์ล้วน
  const freeDownOnly = freeDown && (lastMeta.current?.freeDownSupported ?? false);
  const showFreeDown = priceMode === 'installment' && (freeDownCount > 0 || freeDown);

  // Seed the slider from the API's floor the first time we learn it.
  useEffect(() => {
    if (minDownPct != null && downPct == null) {
      setDownPct(minDownPct);
      setCommittedDown(minDownPct);
    }
  }, [minDownPct, downPct]);

  const plan =
    minDownPct != null
      ? {
          downPct: downPct ?? minDownPct,
          months,
          minDownPct,
          monthsOptions,
          onDownPct: setDownPct,
          onMonths: setMonths,
          freeDown,
          freeDownCount,
          onFreeDown: setFreeDown,
        }
      : undefined;
```

ด้วย

```tsx
  // ตัวควบคุมแผนผ่อน (งวด · ช่องฟรีดาวน์) ต้องไม่หายระหว่างโหลดรายการใหม่ —
  // จำค่าล่าสุดจากหน้าแรกที่เคยได้ แล้วอ่านจากนั้นตอน data ยังเป็น undefined
  // (ห้ามใช้ keepPreviousData: การ์ดเก่าจะค้างใต้ตัวกรองใหม่)
  const lastMeta = useRef<{
    monthsOptions: number[];
    freeDownCount: number;
    freeDownSupported: boolean;
  } | null>(null);
  if (first) {
    lastMeta.current = {
      monthsOptions: first.monthsOptions ?? [],
      freeDownCount: first.freeDownCount ?? 0,
      freeDownSupported: first.freeDownCount !== undefined,
    };
  }
  const monthsOptions = lastMeta.current?.monthsOptions ?? [];
  const freeDownCount = lastMeta.current?.freeDownCount ?? 0;
  // API รุ่นเก่าไม่ส่ง freeDownCount และไม่รู้จักตัวกรอง — อย่าให้การ์ดขึ้นโหมดฟรีดาวน์ล้วน
  const freeDownOnly = freeDown && (lastMeta.current?.freeDownSupported ?? false);
  const showFreeDown = priceMode === 'installment' && (freeDownCount > 0 || freeDown);

  const plan = {
    down,
    months,
    monthsOptions,
    onDown: setDown,
    onMonths: setMonths,
    freeDown,
    freeDownCount,
    onFreeDown: setFreeDown,
  };
```

(`plan={priceMode === 'installment' ? plan : undefined}` ที่ส่งให้ `FilterSidebar` ทั้งสองจุด**คงเดิม** · field `minDownPct` ใน `interface CatalogResponse` คงไว้ — API ยังส่ง)

**7.7** `resultKey` — แทน `resultKey={JSON.stringify([filters, sort, committedDown, months, freeDown])}` ด้วย

```tsx
              resultKey={JSON.stringify([filters, sort, activeDown, months, freeDown])}
```

- [ ] **Step 8: รันเทสต์ + type**

```bash
cd "/d/BESTCHOICE APP/wt-shop-rate-labels/apps/web-shop" && npx vitest run src/pages src/components/catalog && npx tsc --noEmit -p .
```

Expected: ทุกไฟล์ใต้ `src/pages` และ `src/components/catalog` PASS — รวม `CatalogPage.freeDown.test.tsx` (4 เทสต์เดิม ไม่แก้) · เทสต์ใหม่/ที่แก้ของ task นี้: catalog-params 6 · DownAmountField 7 · FilterSidebar.down 3 · FilterSidebar.freeDown 4 · CatalogPage.down 8 · `tsc` ไม่มี error

- [ ] **Step 9: Checkpoint** — รายงานผล Step 8 (จำนวนเทสต์จริง) · ไม่ commit

---

### Task 3: เว็บ — บรรทัดสรุป · บรรทัดท้ายรายการ "อีก N เครื่อง…" · รายการว่างสถานะ ②

**Files:**
- Create: `apps/web-shop/src/components/catalog/CatalogResults.down.test.tsx`
- Modify: `apps/web-shop/src/lib/copy.ts` (เพิ่มคีย์ใต้ `catalog`)
- Modify: `apps/web-shop/src/components/states/EmptyState.tsx` (เพิ่ม `children`)
- Modify: `apps/web-shop/src/components/catalog/CatalogResults.tsx` (CRLF)
- Modify: `apps/web-shop/src/pages/CatalogPage.tsx` (CRLF — `CatalogResponse`, `lastMeta`, props ของ `CatalogResults`)
- Modify: `apps/web-shop/src/pages/CatalogPage.down.test.tsx` (เพิ่มเทสต์ท้ายไฟล์)
- Test (regression, ห้ามแก้): `CatalogResults.test.tsx`, `CatalogResults.freeDown.test.tsx`

**Interfaces:**
- Consumes: คำตอบ API ของ Task 1 (`overBudgetCount`, `nextDownFrom`) · จาก Task 2 ใน `CatalogPage`: `activeDown`, `setDown`, `setFreeDown`, `freeDownCount`, `lastMeta` · ตัวช่วยใน `CatalogPage.down.test.tsx`: `get`, `page(over)`, `open(url)`, `urlParams()` · `Button` (`@/components/ui/button` — `variant="primary" | "outline"`, `size="md"` = สูง 44px)
- Produces:
  - `copy.catalog.foundWithDown(count, down)`, `foundFreeDown(count)`, `overBudget(count, down, from)`, `showAll`, `emptyDownTitle(down)`, `emptyDownDescription(from)`, `seeFreeDown`, `clearDown`
  - `EmptyState` รับ `children?: React.ReactNode` (ปุ่มการกระทำใต้ข้อความ)
  - `CatalogResults` props ใหม่ (optional ทั้งหมด): `down?: number | null`, `overBudgetCount?: number`, `nextDownFrom?: number | null`, `freeDownCount?: number`, `onClearDown?: () => void`, `onShowFreeDown?: () => void` (Task 5 ใช้ `down` ต่อ)

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

**1.1** สร้าง `apps/web-shop/src/components/catalog/CatalogResults.down.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import { CatalogResults } from './CatalogResults';
import type { ProductGroup } from './ProductCard';

const product: ProductGroup = {
  id: 'phone-a',
  kind: 'UNIT',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  condition: 'USED',
  conditionGrade: 'A',
  minPrice: 21900,
  stockCount: 1,
  monthlyPaymentFrom: 1960,
  downAmount: 5000,
  installmentMonths: 12,
  rate2: null,
  stock: { display: 'พร้อมขาย', tone: 'normal' },
  images: [],
};
const base = {
  products: [product],
  total: 1,
  loading: false,
  error: false,
  updating: false,
  resultKey: 'k',
  priceMode: 'installment' as const,
  onRetry: vi.fn(),
};
const show = (over: Partial<Parameters<typeof CatalogResults>[0]> = {}) =>
  render(
    <MemoryRouter>
      <CatalogResults {...base} {...over} />
    </MemoryRouter>,
  );

it('บรรทัดสรุป สถานะ ②: "พบ N เครื่องที่ดาวน์ได้ด้วยเงิน ฿X"', () => {
  show({ total: 21, down: 5000 });
  expect(screen.getByRole('status')).toHaveTextContent('พบ 21 เครื่องที่ดาวน์ได้ด้วยเงิน ฿5,000');
});

it('บรรทัดสรุป สถานะ ③: "พบ N เครื่องฟรีดาวน์"', () => {
  show({ total: 12, freeDownOnly: true });
  expect(screen.getByRole('status')).toHaveTextContent('พบ 12 เครื่องฟรีดาวน์');
});

it('นอกสองสถานะนั้น → ข้อความเดิม', () => {
  show({ total: 3 });
  expect(screen.getByRole('status')).toHaveTextContent('พบ 3 รายการ');
});

it('สถานะ ② มีเครื่องที่เงินไม่พอ → บรรทัดท้ายรายการ + ปุ่ม "ดูทั้งหมด" ล้างเงินดาวน์', () => {
  const onClearDown = vi.fn();
  show({ total: 21, down: 5000, overBudgetCount: 8, nextDownFrom: 5400, onClearDown });
  expect(
    screen.getByText(/อีก 8 เครื่องต้องดาวน์มากกว่า ฿5,000 \(เริ่มที่ ฿5,400\)/),
  ).toBeInTheDocument();
  const button = screen.getByRole('button', { name: 'ดูทั้งหมด' });
  expect(button.className).toContain('min-h-11');
  fireEvent.click(button);
  expect(onClearDown).toHaveBeenCalledOnce();
});

it('ไม่มีเครื่องถูกตัด หรือไม่ได้ใส่เงินดาวน์ → ไม่มีบรรทัดท้ายรายการ', () => {
  const { unmount } = show({ down: 5000, overBudgetCount: 0 });
  expect(screen.queryByText(/ต้องดาวน์มากกว่า/)).not.toBeInTheDocument();
  unmount();
  show({ overBudgetCount: 8, nextDownFrom: 5400 });
  expect(screen.queryByText(/ต้องดาวน์มากกว่า/)).not.toBeInTheDocument();
});

it('สถานะ ② ไม่มีเครื่องเข้าเงื่อนไข → บอกว่าเงินดาวน์ยังไม่พอ + ปุ่มดูเครื่องฟรีดาวน์ + ปุ่มล้างเงินดาวน์', () => {
  const onClearDown = vi.fn();
  const onShowFreeDown = vi.fn();
  show({
    products: [],
    total: 0,
    down: 500,
    overBudgetCount: 5,
    nextDownFrom: 1000,
    freeDownCount: 3,
    onClearDown,
    onShowFreeDown,
  });
  expect(screen.getByText('เงินดาวน์ ฿500 ยังไม่พอ')).toBeInTheDocument();
  expect(screen.getByText('ดาวน์ต่ำสุดเริ่มที่ ฿1,000')).toBeInTheDocument();
  expect(screen.queryByText('ไม่พบสินค้าตามตัวกรอง')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'ดูเครื่องฟรีดาวน์' }));
  expect(onShowFreeDown).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'ล้างเงินดาวน์' }));
  expect(onClearDown).toHaveBeenCalledOnce();
});

it('รายการว่างสถานะ ②: ไม่รู้ดาวน์ต่ำสุด → ไม่มีคำอธิบาย · ไม่มีเครื่องฟรีดาวน์ → ไม่มีปุ่มนั้น', () => {
  show({ products: [], total: 0, down: 500, nextDownFrom: null, freeDownCount: 0 });
  expect(screen.getByText('เงินดาวน์ ฿500 ยังไม่พอ')).toBeInTheDocument();
  expect(screen.queryByText(/ดาวน์ต่ำสุดเริ่มที่/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'ดูเครื่องฟรีดาวน์' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'ล้างเงินดาวน์' })).toBeInTheDocument();
});
```

**1.2** เพิ่มต่อท้ายไฟล์ `apps/web-shop/src/pages/CatalogPage.down.test.tsx`:

```tsx

it('สถานะ ②: บรรทัดสรุป + บรรทัดท้ายรายการ · กด "ดูทั้งหมด" ล้างเงินดาวน์', async () => {
  get.mockImplementation((url: string) =>
    url.startsWith('/api/shop/models')
      ? Promise.resolve({ data: [] })
      : Promise.resolve(page({ total: 21, overBudgetCount: 8, nextDownFrom: 5400 })),
  );
  open('/products?down=5000');
  expect(await screen.findByText('พบ 21 เครื่องที่ดาวน์ได้ด้วยเงิน ฿5,000')).toBeInTheDocument();
  expect(
    screen.getByText(/อีก 8 เครื่องต้องดาวน์มากกว่า ฿5,000 \(เริ่มที่ ฿5,400\)/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'ดูทั้งหมด' }));
  await waitFor(() => expect(urlParams().has('down')).toBe(false));
  await waitFor(() => expect(screen.queryByText(/ต้องดาวน์มากกว่า/)).not.toBeInTheDocument());
});

it('สถานะ ② ไม่มีเครื่องเข้าเงื่อนไข → กด "ดูเครื่องฟรีดาวน์" แล้วเป็นสถานะติ๊กฟรีดาวน์', async () => {
  get.mockImplementation((url: string) =>
    url.startsWith('/api/shop/models')
      ? Promise.resolve({ data: [] })
      : Promise.resolve(page({ data: [], total: 0, overBudgetCount: 5, nextDownFrom: 1000 })),
  );
  open('/products?down=500');
  expect(await screen.findByText('เงินดาวน์ ฿500 ยังไม่พอ')).toBeInTheDocument();
  expect(screen.getByText('ดาวน์ต่ำสุดเริ่มที่ ฿1,000')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'ดูเครื่องฟรีดาวน์' }));
  await waitFor(() => expect(urlParams().get('freeDown')).toBe('1'));
  expect(urlParams().has('down')).toBe(false);
});
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

```bash
cd "/d/BESTCHOICE APP/wt-shop-rate-labels/apps/web-shop" && npx vitest run src/components/catalog/CatalogResults.down.test.tsx src/pages/CatalogPage.down.test.tsx
```

Expected: FAIL — บรรทัดสรุปยังเป็น `พบ 21 รายการ` · ไม่มีบรรทัด "อีก N เครื่อง…" · รายการว่างยังเป็น "ไม่พบสินค้าตามตัวกรอง" (เทสต์ 8 ตัวของ Task 2 ใน `CatalogPage.down.test.tsx` ยังผ่าน)

- [ ] **Step 3: `copy.ts`**

ใน `apps/web-shop/src/lib/copy.ts` ใต้ `catalog:` เพิ่มต่อจากคีย์ `downHint` (ของ Task 2):

```ts
    foundWithDown: (count: number, down: number) =>
      `พบ ${count} เครื่องที่ดาวน์ได้ด้วยเงิน ฿${down.toLocaleString()}`,
    foundFreeDown: (count: number) => `พบ ${count} เครื่องฟรีดาวน์`,
    /** บรรทัดท้ายรายการสถานะ ② — `from` = เงินดาวน์น้อยสุดที่ทำให้เครื่องถัดไปขึ้น */
    overBudget: (count: number, down: number, from: number | null) =>
      `อีก ${count} เครื่องต้องดาวน์มากกว่า ฿${down.toLocaleString()}` +
      (from != null ? ` (เริ่มที่ ฿${from.toLocaleString()})` : ''),
    showAll: 'ดูทั้งหมด',
    emptyDownTitle: (down: number) => `เงินดาวน์ ฿${down.toLocaleString()} ยังไม่พอ`,
    emptyDownDescription: (from: number) => `ดาวน์ต่ำสุดเริ่มที่ ฿${from.toLocaleString()}`,
    seeFreeDown: 'ดูเครื่องฟรีดาวน์',
    clearDown: 'ล้างเงินดาวน์',
```

- [ ] **Step 4: `EmptyState.tsx` รับปุ่มการกระทำ**

ใน `apps/web-shop/src/components/states/EmptyState.tsx`:

แทน

```tsx
  cta?: { label: string; to: string };
}

export function EmptyState({ icon, title, description, cta }: Props) {
```

ด้วย

```tsx
  cta?: { label: string; to: string };
  /** ปุ่มการกระทำใต้ข้อความ (เช่น ล้างตัวกรอง) — ใช้เมื่อปุ่มต้องเรียกฟังก์ชัน ไม่ใช่พาไปหน้าอื่น */
  children?: React.ReactNode;
}

export function EmptyState({ icon, title, description, cta, children }: Props) {
```

และแทน

```tsx
      {cta && (
        <Button asChild variant="primary" className="mt-6" size="lg">
          <Link to={cta.to}>{cta.label}</Link>
        </Button>
      )}
    </div>
```

ด้วย

```tsx
      {cta && (
        <Button asChild variant="primary" className="mt-6" size="lg">
          <Link to={cta.to}>{cta.label}</Link>
        </Button>
      )}
      {children && <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
```

- [ ] **Step 5: `CatalogResults.tsx`**

แก้ `apps/web-shop/src/components/catalog/CatalogResults.tsx` (CRLF):

**5.1** import — เพิ่มต่อจาก `import { ErrorState } from '@/components/states/ErrorState';`:

```tsx
import { Button } from '@/components/ui/button';
```

**5.2** Props — แทน

```tsx
  /** ลูกค้าติ๊ก "ฟรีดาวน์" — การ์ดแสดงเฉพาะกล่องฟรีดาวน์ */
  freeDownOnly?: boolean;
  onRetry: () => void;
}
```

ด้วย

```tsx
  /** ลูกค้าติ๊ก "ฟรีดาวน์" — การ์ดแสดงเฉพาะกล่องฟรีดาวน์ */
  freeDownOnly?: boolean;
  /** สถานะ ②: เงินดาวน์ที่ใช้กับรายการนี้ (บาท) — null / ไม่ส่ง = ไม่ได้ใส่ */
  down?: number | null;
  /** สถานะ ②: จำนวนเครื่องที่ต้องดาวน์มากกว่าเงินที่ใส่ (API ตัดออกจากรายการแล้ว) */
  overBudgetCount?: number;
  /** เงินดาวน์น้อยสุดที่ทำให้เครื่องถัดไปขึ้น */
  nextDownFrom?: number | null;
  /** จำนวนเครื่องฟรีดาวน์ตามตัวกรองอื่น — มีจึงเสนอปุ่ม "ดูเครื่องฟรีดาวน์" ตอนเงินดาวน์ไม่พอ */
  freeDownCount?: number;
  onClearDown?: () => void;
  onShowFreeDown?: () => void;
  onRetry: () => void;
}
```

**5.3** destructure — แทน

```tsx
  freeDownOnly = false,
  onRetry,
}: Props) {
```

ด้วย

```tsx
  freeDownOnly = false,
  down = null,
  overBudgetCount = 0,
  nextDownFrom = null,
  freeDownCount = 0,
  onClearDown,
  onShowFreeDown,
  onRetry,
}: Props) {
```

**5.4** บรรทัดสรุป — แทน

```tsx
            : updating
              ? 'กำลังอัปเดตรายการสินค้า…'
              : `พบ ${total} รายการ`}
```

ด้วย

```tsx
            : updating
              ? 'กำลังอัปเดตรายการสินค้า…'
              : down != null
                ? copy.catalog.foundWithDown(total, down)
                : freeDownOnly
                  ? copy.catalog.foundFreeDown(total)
                  : `พบ ${total} รายการ`}
```

**5.5** รายการว่าง + บรรทัดท้ายรายการ — แทน

```tsx
        ) : !products?.length ? (
          <EmptyState
            icon={<Search className="size-12" />}
            title={freeDownOnly ? copy.catalog.emptyFreeDownTitle : copy.catalog.emptyTitle}
            description={
              freeDownOnly
                ? copy.catalog.emptyFreeDownDescription
                : copy.catalog.emptyDescription
            }
          />
        ) : (
          <div className={GRID}>
            {products.map((product) => (
              <div
                key={product.id}
                data-product-card={product.id}
                className="flex [&>article]:w-full"
              >
                <ProductCard product={product} priceMode={priceMode} freeDownOnly={freeDownOnly} />
              </div>
            ))}
          </div>
        )}
```

ด้วย

```tsx
        ) : !products?.length ? (
          down != null ? (
            // สถานะ ②: ไม่มีเครื่องที่ซื้อได้ด้วยเงินนี้ — บอกว่าต้องมีเท่าไร แล้วให้ทางไปต่อ
            <EmptyState
              icon={<Search className="size-12" />}
              title={copy.catalog.emptyDownTitle(down)}
              description={
                nextDownFrom != null ? copy.catalog.emptyDownDescription(nextDownFrom) : undefined
              }
            >
              {freeDownCount > 0 && (
                <Button type="button" variant="primary" size="md" onClick={onShowFreeDown}>
                  {copy.catalog.seeFreeDown}
                </Button>
              )}
              <Button type="button" variant="outline" size="md" onClick={onClearDown}>
                {copy.catalog.clearDown}
              </Button>
            </EmptyState>
          ) : (
            <EmptyState
              icon={<Search className="size-12" />}
              title={freeDownOnly ? copy.catalog.emptyFreeDownTitle : copy.catalog.emptyTitle}
              description={
                freeDownOnly
                  ? copy.catalog.emptyFreeDownDescription
                  : copy.catalog.emptyDescription
              }
            />
          )
        ) : (
          <>
            <div className={GRID}>
              {products.map((product) => (
                <div
                  key={product.id}
                  data-product-card={product.id}
                  className="flex [&>article]:w-full"
                >
                  <ProductCard
                    product={product}
                    priceMode={priceMode}
                    freeDownOnly={freeDownOnly}
                  />
                </div>
              ))}
            </div>
            {down != null && overBudgetCount > 0 && (
              <p
                data-over-budget
                className="mt-4 rounded-2xl bg-muted px-4 py-1 text-sm text-muted-foreground leading-snug"
              >
                {copy.catalog.overBudget(overBudgetCount, down, nextDownFrom)}{' '}
                <button
                  type="button"
                  onClick={onClearDown}
                  className="inline-flex min-h-11 items-center px-1 font-semibold text-primary underline underline-offset-4"
                >
                  {copy.catalog.showAll}
                </button>
              </p>
            )}
          </>
        )}
```

- [ ] **Step 6: `CatalogPage.tsx` — meta ใหม่ + ส่งให้ `CatalogResults`**

**6.1** ใน `interface CatalogResponse` เพิ่มต่อจาก `freeDownCount?: number;`:

```tsx
  /** สถานะ ②: จำนวนเครื่องที่ต้องดาวน์มากกว่าเงินที่ใส่. ไม่มีใน API รุ่นเก่า. */
  overBudgetCount?: number;
  /** เงินดาวน์น้อยสุดที่ทำให้เครื่องถัดไปขึ้น. ไม่มีใน API รุ่นเก่า. */
  nextDownFrom?: number | null;
```

**6.2** `lastMeta` — แทน

```tsx
  const lastMeta = useRef<{
    monthsOptions: number[];
    freeDownCount: number;
    freeDownSupported: boolean;
  } | null>(null);
  if (first) {
    lastMeta.current = {
      monthsOptions: first.monthsOptions ?? [],
      freeDownCount: first.freeDownCount ?? 0,
      freeDownSupported: first.freeDownCount !== undefined,
    };
  }
  const monthsOptions = lastMeta.current?.monthsOptions ?? [];
  const freeDownCount = lastMeta.current?.freeDownCount ?? 0;
```

ด้วย

```tsx
  const lastMeta = useRef<{
    monthsOptions: number[];
    freeDownCount: number;
    freeDownSupported: boolean;
    overBudgetCount: number;
    nextDownFrom: number | null;
  } | null>(null);
  if (first) {
    lastMeta.current = {
      monthsOptions: first.monthsOptions ?? [],
      freeDownCount: first.freeDownCount ?? 0,
      freeDownSupported: first.freeDownCount !== undefined,
      overBudgetCount: first.overBudgetCount ?? 0,
      nextDownFrom: first.nextDownFrom ?? null,
    };
  }
  const monthsOptions = lastMeta.current?.monthsOptions ?? [];
  const freeDownCount = lastMeta.current?.freeDownCount ?? 0;
  const overBudgetCount = lastMeta.current?.overBudgetCount ?? 0;
  const nextDownFrom = lastMeta.current?.nextDownFrom ?? null;
```

**6.3** `<CatalogResults … />` — แทน

```tsx
              freeDownOnly={freeDownOnly}
              onRetry={() => refetch()}
```

ด้วย

```tsx
              freeDownOnly={freeDownOnly}
              down={activeDown}
              overBudgetCount={overBudgetCount}
              nextDownFrom={nextDownFrom}
              freeDownCount={freeDownCount}
              onClearDown={() => setDown(null)}
              onShowFreeDown={() => setFreeDown(true)}
              onRetry={() => refetch()}
```

- [ ] **Step 7: รันเทสต์ + type**

```bash
cd "/d/BESTCHOICE APP/wt-shop-rate-labels/apps/web-shop" && npx vitest run src/pages src/components/catalog && npx tsc --noEmit -p .
```

Expected: PASS ทั้งหมด — `CatalogResults.down.test.tsx` 7 เทสต์ · `CatalogPage.down.test.tsx` 10 เทสต์ · `CatalogResults.test.tsx` และ `CatalogResults.freeDown.test.tsx` เดิมผ่านโดยไม่แก้ · `tsc` ไม่มี error

- [ ] **Step 8: Checkpoint** — รายงานผล Step 7 · ไม่ commit

---

### Task 4: เว็บ — ตัวกรองโฉมใหม่: ปุ่มกดไทย/นอก + ช่วงราคา · เอาสภาพเครื่องออก · ล้างทั้งหมด · แถวเงินดาวน์บนมือถือ

**Files:**
- Create: `apps/web-shop/src/components/catalog/Pill.tsx`
- Create: `apps/web-shop/src/components/catalog/FilterSidebar.restyle.test.tsx`
- Modify: `apps/web-shop/src/lib/copy.ts` (เพิ่ม `catalog.clearAll`)
- Modify: `apps/web-shop/src/components/catalog/FilterSidebar.tsx` (CRLF)
- Modify: `apps/web-shop/src/pages/CatalogPage.tsx` (CRLF)
- Modify: `apps/web-shop/src/pages/CatalogPage.down.test.tsx` (เพิ่ม import `within` + เทสต์ท้ายไฟล์)
- Modify: `apps/web-shop/e2e/catalog-origin.spec.ts` (แก้ตามที่ระบุ — ตัวกรองไทย/นอกไม่ใช่ `<select>` แล้ว)
- Test (regression, ห้ามแก้): `FilterSidebar.freeDown.test.tsx`, `FilterSidebar.down.test.tsx`, `CatalogPage.freeDown.test.tsx`

**Interfaces:**
- Consumes: จาก Task 2 — `DownAmountField` (`variant="pill"`), ใน `CatalogPage`: `down`, `setDown`, `freeDown`, `setFreeDown`, `showFreeDown`, `freeDownCount`, `priceMode`, `filters`, `setFilters`, `searchParams`, `setSearchParams` · `PlanControls` (`plan.down`, `plan.freeDown`) · ตัวช่วยใน `CatalogPage.down.test.tsx`: `open(url)`, `urlParams()`, `lastParams()`, `downInput()` · `PRICE_BANDS` / `bandId` ใน `FilterSidebar.tsx`
- Produces:
  - `Pill` (`@/components/catalog/Pill`): props `{ active: boolean; onClick: () => void; children: ReactNode; className?: string }` — `<button type="button" aria-pressed>` สูง 44px
  - `FilterSidebar` prop ใหม่ `onClearAll?: () => void` (ไม่ส่ง = ใช้ `onChange` ล้างตัวกรองแบบเดิม)
  - `copy.catalog.clearAll`
  - ใน `CatalogPage`: `clearAllFilters()` · แถวมือถือ `<div data-mobile-plan …>` ที่มีช่อง `id="toolbar-down"`

**หมายเหตุการออกแบบ:**
- "ล้างตัวกรองทั้งหมด" ต้องล้างทั้งตัวกรอง (อยู่ใน state + URL) และเงินดาวน์/ฟรีดาวน์ (อยู่ใน URL) ด้วยการเขียน URL **ครั้งเดียว** — จึงทำเป็นฟังก์ชันระดับหน้า (`clearAllFilters`) แล้วส่งให้ `FilterSidebar` ผ่าน `onClearAll` (เรียก `onChange` แล้วตามด้วย `setDown` จะเขียน URL ทับกัน)
- ปุ่มกดใช้ `Pill` ตัวเดิมของหน้า (ย้ายไฟล์ ไม่เปลี่ยนหน้าตา) จัดเป็น `flex flex-wrap` — ขึ้นบรรทัดใหม่ได้เมื่อแถบข้างแคบ
- แผงตัวกรองบนมือถือคือ `FilterSidebar` ตัวเดียวกัน (`bare`) — เนื้อหาเท่าแถบข้างโดยอัตโนมัติ

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

**1.1** สร้าง `apps/web-shop/src/components/catalog/FilterSidebar.restyle.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterSidebar, type CatalogFilters, type PlanControls } from './FilterSidebar';

function plan(over: Partial<PlanControls> = {}): PlanControls {
  return {
    down: null,
    months: null,
    monthsOptions: [],
    onDown: vi.fn(),
    onMonths: vi.fn(),
    freeDown: false,
    freeDownCount: 0,
    onFreeDown: vi.fn(),
    ...over,
  };
}
function show(
  filters: CatalogFilters = {},
  extra: Partial<Parameters<typeof FilterSidebar>[0]> = {},
) {
  const onChange = vi.fn();
  const view = render(
    <FilterSidebar
      filters={filters}
      onChange={onChange}
      models={[{ model: 'iPhone 15', count: 3 }]}
      {...extra}
    />,
  );
  return { onChange, ...view };
}
const origin = () => screen.getByRole('group', { name: 'เครื่องไทย / เครื่องนอก' });
const price = () => screen.getByRole('group', { name: 'ช่วงราคา' });
const isPressed = (el: HTMLElement) => el.getAttribute('aria-pressed') === 'true';

describe('ตัวกรองโฉมใหม่', () => {
  it('เครื่องไทย / เครื่องนอก เป็นปุ่มกด 3 ตัว สูง 44px — กดแล้วแจ้งกลับ', () => {
    const { onChange } = show();
    const buttons = within(origin()).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['ทั้งหมด', 'เครื่องไทย', 'เครื่องนอก']);
    expect(buttons.map(isPressed)).toEqual([true, false, false]);
    for (const b of buttons) expect(b.className).toContain('min-h-11');
    fireEvent.click(within(origin()).getByRole('button', { name: 'เครื่องนอก' }));
    expect(onChange.mock.calls[0][0].deviceOrigin).toBe('IMPORTED');
  });

  it('ตัวที่เลือกอยู่ถูกกดค้าง · กด "ทั้งหมด" ล้างเฉพาะตัวกรองนี้', () => {
    const { onChange } = show({ deviceOrigin: 'THAI', condition: 'USED' });
    expect(isPressed(within(origin()).getByRole('button', { name: 'เครื่องไทย' }))).toBe(true);
    expect(isPressed(within(origin()).getByRole('button', { name: 'ทั้งหมด' }))).toBe(false);
    fireEvent.click(within(origin()).getByRole('button', { name: 'ทั้งหมด' }));
    expect(onChange.mock.calls[0][0].deviceOrigin).toBeUndefined();
    expect(onChange.mock.calls[0][0].condition).toBe('USED');
  });

  it('ช่วงราคาเป็นปุ่มกด 6 ช่วงเดิม — กดแล้วได้ minPrice / maxPrice', () => {
    const { onChange } = show({ minPrice: 30000 });
    const buttons = within(price()).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      'ทุกช่วงราคา',
      'ไม่เกิน ฿10,000',
      '฿10,000 – ฿15,000',
      '฿15,000 – ฿20,000',
      '฿20,000 – ฿30,000',
      '฿30,000 ขึ้นไป',
    ]);
    expect(buttons.map(isPressed)).toEqual([false, false, false, false, false, true]);
    for (const b of buttons) expect(b.className).toContain('min-h-11');
    fireEvent.click(within(price()).getByRole('button', { name: '฿10,000 – ฿15,000' }));
    expect(onChange.mock.calls[0][0]).toMatchObject({ minPrice: 10000, maxPrice: 15000 });
    fireEvent.click(within(price()).getByRole('button', { name: 'ทุกช่วงราคา' }));
    expect(onChange.mock.calls[1][0].minPrice).toBeUndefined();
    expect(onChange.mock.calls[1][0].maxPrice).toBeUndefined();
  });

  it('ไม่มีตัวกรอง "สภาพเครื่อง" · ดรอปดาวน์เหลือ "รุ่น" ตัวเดียว', () => {
    show({ condition: 'USED' });
    expect(screen.queryByText('สภาพเครื่อง')).not.toBeInTheDocument();
    expect(screen.queryByText(/เกรด A/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('combobox').map((el) => el.id)).toEqual(['filter-model']);
  });

  it('"ล้างตัวกรองทั้งหมด" ขึ้นเมื่อมีเงินดาวน์หรือติ๊กฟรีดาวน์ และเรียก onClearAll', () => {
    const onClearAll = vi.fn();
    const first = show({}, { plan: plan(), onClearAll });
    expect(screen.queryByRole('button', { name: 'ล้างตัวกรองทั้งหมด' })).not.toBeInTheDocument();
    first.unmount();

    const second = show({}, { plan: plan({ freeDown: true }), onClearAll });
    expect(screen.getByRole('button', { name: 'ล้างตัวกรองทั้งหมด' })).toBeInTheDocument();
    second.unmount();

    const { onChange } = show({}, { plan: plan({ down: 5000 }), onClearAll });
    const button = screen.getByRole('button', { name: 'ล้างตัวกรองทั้งหมด' });
    expect(button.className).toContain('min-h-11');
    fireEvent.click(button);
    expect(onClearAll).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ไม่ส่ง onClearAll → ล้างตัวกรองผ่าน onChange แบบเดิม (คำค้นหายังอยู่)', () => {
    const { onChange } = show({ condition: 'USED', search: 'โปร' });
    fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรองทั้งหมด' }));
    expect(onChange.mock.calls[0][0].condition).toBeUndefined();
    expect(onChange.mock.calls[0][0].search).toBe('โปร');
  });
});
```

**1.2** ใน `apps/web-shop/src/pages/CatalogPage.down.test.tsx` แก้บรรทัด import ของ testing-library จาก

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
```

เป็น

```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
```

แล้วเพิ่มต่อท้ายไฟล์:

```tsx

it('"ล้างตัวกรองทั้งหมด" ล้างเงินดาวน์และตัวกรองอื่นในครั้งเดียว (คำค้นหายังอยู่)', async () => {
  open('/products?down=5000&condition=USED&model=iPhone+15&search=โปร');
  await downInput();
  fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรองทั้งหมด' }));
  await waitFor(() => expect(urlParams().has('down')).toBe(false));
  expect(urlParams().has('condition')).toBe(false);
  expect(urlParams().has('model')).toBe(false);
  expect(urlParams().get('search')).toBe('โปร');
  await waitFor(() => {
    const p = lastParams();
    expect(p.has('downAmount')).toBe(false);
    expect(p.has('condition')).toBe(false);
    expect(p.has('model')).toBe(false);
    expect(p.get('search')).toBe('โปร');
  });
});

it('"ล้างตัวกรองทั้งหมด" เอาติ๊กฟรีดาวน์ออกด้วย', async () => {
  open('/products?freeDown=1');
  await screen.findAllByRole('checkbox', { name: /ฟรีดาวน์/ });
  fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรองทั้งหมด' }));
  await waitFor(() => expect(urlParams().has('freeDown')).toBe(false));
  await waitFor(() => expect(lastParams().has('freeDown')).toBe(false));
});

it('มือถือ: แถวเงินดาวน์ + ช่องติ๊กฟรีดาวน์อยู่นอกแผงตัวกรอง ใช้ได้เลย', async () => {
  open('/products');
  await screen.findAllByRole('checkbox', { name: /ฟรีดาวน์/ });
  const fields = screen.getAllByLabelText('เงินดาวน์');
  expect(fields.map((el) => el.id).sort()).toEqual(['filter-down', 'toolbar-down']);
  const toolbar = fields.find((el) => el.id === 'toolbar-down') as HTMLInputElement;
  const row = toolbar.closest('[data-mobile-plan]') as HTMLElement;
  expect(row.className).toContain('lg:hidden');
  expect(within(row).getByRole('checkbox', { name: /ฟรีดาวน์/ })).toBeInTheDocument();
  fireEvent.change(toolbar, { target: { value: '4000' } });
  fireEvent.blur(toolbar);
  await waitFor(() => expect(urlParams().get('down')).toBe('4000'));
  await waitFor(() => expect(lastParams().get('downAmount')).toBe('4000'));
});

it('โหมดซื้อสด: ไม่มีแถวเงินดาวน์บนมือถือ', async () => {
  open('/products?mode=cash');
  await waitFor(() => expect(get).toHaveBeenCalled());
  expect(document.querySelector('[data-mobile-plan]')).toBeNull();
});
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

```bash
cd "/d/BESTCHOICE APP/wt-shop-rate-labels/apps/web-shop" && npx vitest run src/components/catalog/FilterSidebar.restyle.test.tsx src/pages/CatalogPage.down.test.tsx
```

Expected: FAIL — ไม่มี `group` ชื่อ "เครื่องไทย / เครื่องนอก" / "ช่วงราคา" (ยังเป็น `<select>`) · ยังมี "สภาพเครื่อง" · ปุ่มล้างไม่ขึ้นเมื่อมีแค่เงินดาวน์ · ไม่มี `[data-mobile-plan]`

- [ ] **Step 3: `copy.ts`**

ใน `apps/web-shop/src/lib/copy.ts` ใต้ `catalog:` เพิ่มต่อจากคีย์ `clearDown` (ของ Task 3):

```ts
    clearAll: 'ล้างตัวกรองทั้งหมด',
```

- [ ] **Step 4: ย้าย `Pill` ออกเป็นไฟล์ของตัวเอง**

สร้าง `apps/web-shop/src/components/catalog/Pill.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PillProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  /** ปรับระยะ/ตัวเลขเฉพาะจุด — สีและความสูงมาจากตัวปุ่มเอง */
  className?: string;
}

/** ปุ่มกดเลือกของหน้ารวมสินค้า (`aria-pressed`) — ตัวที่เลือกอยู่พื้นเขียวเข้มตัวขาว · สูง 44px */
export function Pill({ active, onClick, children, className }: PillProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'min-h-11 px-4 py-1.5 font-head text-sm font-medium rounded-full transition-colors leading-snug whitespace-nowrap',
        active
          ? 'bg-ink text-ink-foreground font-semibold'
          : 'bg-card text-accent-foreground ring-1 ring-inset ring-border hover:bg-muted',
        className,
      )}
    >
      {children}
    </button>
  );
}
```

ใน `apps/web-shop/src/pages/CatalogPage.tsx` ลบก้อนนี้ทิ้ง:

```tsx
interface PillProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function Pill({ active, onClick, children }: PillProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'min-h-11 px-4 py-1.5 font-head text-sm font-medium rounded-full transition-colors leading-snug whitespace-nowrap',
        active
          ? 'bg-ink text-ink-foreground font-semibold'
          : 'bg-card text-accent-foreground ring-1 ring-inset ring-border hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

```

แล้วเพิ่ม import สองบรรทัดต่อจาก `import { CatalogResults } from '@/components/catalog/CatalogResults';`:

```tsx
import { Pill } from '@/components/catalog/Pill';
import { DownAmountField } from '@/components/catalog/DownAmountField';
```

(`cn` ยังถูกใช้ที่อื่นใน `CatalogPage.tsx` — import เดิมคงไว้)

- [ ] **Step 5: `FilterSidebar.tsx` — ปุ่มกด · เอาสภาพเครื่องออก · ล้างทั้งหมด**

แก้ `apps/web-shop/src/components/catalog/FilterSidebar.tsx` (CRLF):

**5.1** import — แทน

```tsx
import { parseDeviceOrigin, type DeviceOrigin } from '@/lib/device-origin';
import { DownAmountField } from './DownAmountField';
```

ด้วย

```tsx
import type { DeviceOrigin } from '@/lib/device-origin';
import { DownAmountField } from './DownAmountField';
import { Pill } from './Pill';
```

**5.2** แทน `const GRADES … ];` ทั้งก้อน

```tsx
const GRADES: Array<{ v: string; label: string }> = [
  { v: '', label: 'ทุกเกรด' },
  { v: 'A', label: 'เกรด A — สภาพสวยมาก' },
  { v: 'B', label: 'เกรด B — มีร่องรอยการใช้งาน' },
  { v: 'C', label: 'เกรด C — ตำหนิชัด ราคาคุ้ม' },
];
```

ด้วย

```tsx
/** ตัวกรองสภาพเครื่อง (เกรด) ถูกเอาออกจาก UI — เจ้าของ 2026-11-25 · ป้ายเกรดบนการ์ดยังอยู่ */
const ORIGINS: Array<{ v: DeviceOrigin | undefined; label: string }> = [
  { v: undefined, label: 'ทั้งหมด' },
  { v: 'THAI', label: 'เครื่องไทย' },
  { v: 'IMPORTED', label: 'เครื่องนอก' },
];
```

**5.3** Props — แทน

```tsx
  plan?: PlanControls;
  /** Inside the mobile dialog the panel drops its own chrome. */
  bare?: boolean;
}

export function FilterSidebar({ filters, onChange, models, plan, bare }: Props) {
  const isNew = filters.condition === 'NEW';
  const active =
    filters.deviceOrigin ||
    filters.condition ||
    filters.model ||
    filters.conditionGrade ||
    filters.minPrice !== undefined ||
    filters.maxPrice !== undefined;
```

ด้วย

```tsx
  plan?: PlanControls;
  /** ล้างตัวกรองทั้งหมด รวมเงินดาวน์/ฟรีดาวน์ ในครั้งเดียว — ไม่ส่ง = ล้างเฉพาะตัวกรองผ่าน onChange */
  onClearAll?: () => void;
  /** Inside the mobile dialog the panel drops its own chrome. */
  bare?: boolean;
}

export function FilterSidebar({ filters, onChange, models, plan, onClearAll, bare }: Props) {
  const idPrefix = bare ? 'mobile-filter' : 'filter';
  const active =
    filters.deviceOrigin ||
    filters.condition ||
    filters.model ||
    filters.conditionGrade ||
    filters.minPrice !== undefined ||
    filters.maxPrice !== undefined ||
    (plan != null && (plan.down != null || plan.freeDown));
```

**5.4** ตัวกรองไทย/นอก — แทน

```tsx
      <div>
        <label className={labelCls} htmlFor={bare ? 'mobile-filter-origin' : 'filter-origin'}>
          เครื่องไทย / เครื่องนอก
        </label>
        <NativeSelect wrapperClassName="max-w-full w-full"
          id={bare ? 'mobile-filter-origin' : 'filter-origin'}
          className={selectCls}
          value={filters.deviceOrigin ?? ''}
          onChange={(e) =>
            onChange({ ...filters, deviceOrigin: parseDeviceOrigin(e.target.value) })
          }
        >
          <option value="">ทั้งหมด</option>
          <option value="THAI">เครื่องไทย</option>
          <option value="IMPORTED">เครื่องนอก</option>
        </NativeSelect>
      </div>
```

ด้วย

```tsx
      <div role="group" aria-labelledby={`${idPrefix}-origin-label`}>
        <span id={`${idPrefix}-origin-label`} className={labelCls}>
          เครื่องไทย / เครื่องนอก
        </span>
        <div className="flex flex-wrap gap-1.5">
          {ORIGINS.map((o) => (
            <Pill
              key={o.label}
              active={filters.deviceOrigin === o.v}
              onClick={() => onChange({ ...filters, deviceOrigin: o.v })}
              className="px-3.5"
            >
              {o.label}
            </Pill>
          ))}
        </div>
      </div>
```

**5.5** ลบตัวกรองสภาพเครื่องทั้งก้อน:

```tsx
      {!isNew && (
        <div>
          <label className={labelCls} htmlFor="filter-grade">
            สภาพเครื่อง
          </label>
          <NativeSelect wrapperClassName="max-w-full w-full"
            id="filter-grade"
            className={selectCls}
            value={filters.conditionGrade ?? ''}
            onChange={(e) => onChange({ ...filters, conditionGrade: e.target.value || undefined })}
          >
            {GRADES.map((g) => (
              <option key={g.v} value={g.v}>
                {g.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}

```

**5.6** ช่วงราคา — แทน

```tsx
      <div>
        <label className={labelCls} htmlFor="filter-price">
          ช่วงราคา
        </label>
        <NativeSelect wrapperClassName="max-w-full w-full"
          id="filter-price"
          className={selectCls}
          value={bandId(filters)}
          onChange={(e) => {
            const band = PRICE_BANDS.find((b) => b.id === e.target.value);
            onChange({ ...filters, minPrice: band?.min, maxPrice: band?.max });
          }}
        >
          {PRICE_BANDS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </NativeSelect>
      </div>
```

ด้วย

```tsx
      <div role="group" aria-labelledby={`${idPrefix}-price-label`}>
        <span id={`${idPrefix}-price-label`} className={labelCls}>
          ช่วงราคา
        </span>
        <div className="flex flex-wrap gap-1.5">
          {PRICE_BANDS.map((b) => (
            <Pill
              key={b.id || 'all'}
              active={bandId(filters) === b.id}
              onClick={() => onChange({ ...filters, minPrice: b.min, maxPrice: b.max })}
              className="num px-3.5"
            >
              {b.label}
            </Pill>
          ))}
        </div>
      </div>
```

**5.7** ปุ่มล้าง — แทน

```tsx
      {active && (
        <button
          type="button"
          onClick={() =>
            onChange({
              search: filters.search,
              condition: undefined,
              model: undefined,
              conditionGrade: undefined,
              minPrice: undefined,
              maxPrice: undefined,
            })
          }
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors leading-snug"
        >
          <X className="size-4" aria-hidden />
          ล้างตัวกรองทั้งหมด
        </button>
      )}
```

ด้วย

```tsx
      {active && (
        <button
          type="button"
          onClick={() =>
            onClearAll
              ? onClearAll()
              : onChange({
                  search: filters.search,
                  condition: undefined,
                  model: undefined,
                  conditionGrade: undefined,
                  minPrice: undefined,
                  maxPrice: undefined,
                })
          }
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors leading-snug"
        >
          <X className="size-4" aria-hidden />
          {copy.catalog.clearAll}
        </button>
      )}
```

(`pickType`, `DEVICE_TYPES`, ดรอปดาวน์ "รุ่น", `selectCls`, `NativeSelect` คงเดิม — `selectCls` และ `NativeSelect` ยังถูกใช้โดย "รุ่น" และ "จำนวนงวด")

- [ ] **Step 6: `CatalogPage.tsx` — ล้างทั้งหมด + แถวเงินดาวน์บนมือถือ**

**6.1** เพิ่มฟังก์ชันต่อจาก `clearSearch()`:

```tsx

  // ล้างตัวกรอง + เงินดาวน์ + ติ๊กฟรีดาวน์ ด้วยการเขียน URL ครั้งเดียว (คำค้นหาและโหมดราคายังอยู่)
  function clearAllFilters() {
    setFilters({ search: filters.search });
    const sp = new URLSearchParams(searchParams);
    for (const key of ['deviceOrigin', 'condition', 'model', 'down', 'freeDown']) sp.delete(key);
    setSearchParams(sp, { replace: true });
  }
```

**6.2** ส่ง `onClearAll` ให้ `FilterSidebar` **ทั้งสองจุด** (แถบข้าง และในแผงมือถือ) — เพิ่ม prop ต่อจาก `onChange={updateFilters}` ของแต่ละจุด:

```tsx
              onClearAll={clearAllFilters}
```

(จัดย่อหน้าให้ตรงกับ prop ข้างเคียงของแต่ละจุด)

**6.3** แถวเงินดาวน์บนมือถือ — แทรกต่อจาก `</div>` ที่ปิดกลุ่ม `role="group" aria-label="รูปแบบราคา"` และก่อน `<div className="flex lg:hidden gap-2">` (แถวปุ่ม ทั้งหมด / มือ 1 / มือ 2):

```tsx

              {/* มือถือไม่มีแถบข้าง — ใส่เงินดาวน์ / ติ๊กฟรีดาวน์ได้เลยโดยไม่ต้องเปิดแผงตัวกรอง (สเปคหัวข้อ 6) */}
              {priceMode === 'installment' && (
                <div data-mobile-plan className="flex w-full items-center gap-2 lg:hidden">
                  <DownAmountField
                    id="toolbar-down"
                    variant="pill"
                    value={down}
                    disabled={freeDown}
                    onCommit={setDown}
                  />
                  {showFreeDown && (
                    <label
                      className={cn(
                        'inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full px-3 font-head text-sm leading-snug whitespace-nowrap',
                        freeDown
                          ? 'bg-sand-50 font-semibold text-sand-900 ring-1 ring-inset ring-promo/60'
                          : 'bg-card text-accent-foreground ring-1 ring-inset ring-border',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={freeDown}
                        onChange={(e) => setFreeDown(e.target.checked)}
                        className="size-4 shrink-0 accent-emerald-600"
                      />
                      ฟรีดาวน์
                      <span className="num text-xs font-normal text-muted-foreground">
                        {freeDownCount}
                      </span>
                    </label>
                  )}
                </div>
              )}
```

**6.4** ลบช่องติ๊กฟรีดาวน์เดิมที่อยู่หลังแถวปุ่ม (ย้ายเข้าแถวข้างบนแล้ว) — ลบก้อนนี้ทั้งก้อน:

```tsx
              {/* มือถือไม่มีแถบข้าง — ติ๊กฟรีดาวน์ได้เลยโดยไม่ต้องเปิดแผงตัวกรอง */}
              {showFreeDown && (
                <label
                  className={cn(
                    'lg:hidden inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 font-head text-sm leading-snug whitespace-nowrap',
                    freeDown
                      ? 'bg-sand-50 font-semibold text-sand-900 ring-1 ring-inset ring-promo/60'
                      : 'bg-card text-accent-foreground ring-1 ring-inset ring-border',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={freeDown}
                    onChange={(e) => setFreeDown(e.target.checked)}
                    className="size-4 shrink-0 accent-emerald-600"
                  />
                  ฟรีดาวน์
                  <span className="num text-xs font-normal text-muted-foreground">{freeDownCount}</span>
                </label>
              )}

```

- [ ] **Step 7: แก้ Playwright spec ที่อ้าง `<select>` ของไทย/นอก**

ใน `apps/web-shop/e2e/catalog-origin.spec.ts` (ไฟล์นี้ไม่อยู่ในชุด vitest — แก้เพื่อไม่ให้ spec ค้างอ้าง UI ที่ไม่มีแล้ว) แทนตามนี้ **เท่านั้น**:

เทสต์ `desktop filters, refreshes a shared link, clears and displays device origin`:

| เดิม | ใหม่ |
|---|---|
| `await page.locator('#filter-origin').selectOption('IMPORTED');` | `await page.getByRole('group', { name: 'เครื่องไทย / เครื่องนอก' }).getByRole('button', { name: 'เครื่องนอก', exact: true }).click();` |
| `await expect(page.locator('#filter-origin')).toHaveValue('IMPORTED');` | `await expect(page.getByRole('group', { name: 'เครื่องไทย / เครื่องนอก' }).getByRole('button', { name: 'เครื่องนอก', exact: true })).toHaveAttribute('aria-pressed', 'true');` |
| `await page.locator('#filter-origin').selectOption('THAI');` | `await page.getByRole('group', { name: 'เครื่องไทย / เครื่องนอก' }).getByRole('button', { name: 'เครื่องไทย', exact: true }).click();` |

เทสต์ `mobile filter combines with condition/model/search and resets without clearing search`:

| เดิม | ใหม่ |
|---|---|
| `await dialog.getByLabel('เครื่องไทย / เครื่องนอก', { exact: true }).selectOption('IMPORTED');` | `await dialog.getByRole('group', { name: 'เครื่องไทย / เครื่องนอก' }).getByRole('button', { name: 'เครื่องนอก', exact: true }).click();` |
| `await expect(dialog.getByLabel('เครื่องไทย / เครื่องนอก', { exact: true })).toHaveValue('');` | `await expect(dialog.getByRole('group', { name: 'เครื่องไทย / เครื่องนอก' }).getByRole('button', { name: 'ทั้งหมด', exact: true })).toHaveAttribute('aria-pressed', 'true');` |

บรรทัดอื่นของ spec ห้ามแตะ

- [ ] **Step 8: รันเทสต์ + type**

```bash
cd "/d/BESTCHOICE APP/wt-shop-rate-labels/apps/web-shop" && npx vitest run src/pages src/components/catalog && npx tsc --noEmit -p .
```

Expected: PASS ทั้งหมด — `FilterSidebar.restyle.test.tsx` 6 เทสต์ · `CatalogPage.down.test.tsx` 14 เทสต์ · `FilterSidebar.freeDown.test.tsx` / `FilterSidebar.down.test.tsx` / `CatalogPage.freeDown.test.tsx` ผ่านโดยไม่แก้ · `tsc` ไม่มี error (ถ้าฟ้อง `'isNew' is declared but never used` หรือ `'parseDeviceOrigin'` = ยังลบไม่ครบตาม 5.1 / 5.3)

- [ ] **Step 9: (ถ้าเครื่องมี Chromium ของ Playwright) รัน e2e ของตัวกรอง**

```bash
cd "/d/BESTCHOICE APP/wt-shop-rate-labels/apps/web-shop" && npx playwright test e2e/catalog-origin.spec.ts
```

spec นี้จำลอง API ทั้งหมดเอง (ไม่ต้องมี API/ฐานข้อมูล) · Expected: 4 passed
ถ้า Playwright ฟ้องว่าไม่มี browser — **ไม่ต้องติดตั้ง** ให้รายงานว่า "ยังไม่ได้รัน e2e" ใน Checkpoint

- [ ] **Step 10: Checkpoint** — รายงานผล Step 8–9 · ไม่ commit

---

### Task 5: เว็บ — ลิงก์ของการ์ดพา `?down=` (สถานะ ②) + หน้ารายละเอียดเปิดเรท 1 ที่เงินดาวน์นั้น

**Files:**
- Create: `apps/web-shop/src/components/catalog/ProductCard.down.test.tsx`
- Create: `apps/web-shop/src/pages/ProductDetailPage.down.test.tsx`
- Modify: `apps/web-shop/src/components/catalog/ProductCard.tsx` (CRLF)
- Modify: `apps/web-shop/src/components/catalog/CatalogResults.tsx` (CRLF — ส่ง `down` ให้การ์ด)
- Modify: `apps/web-shop/src/components/catalog/CatalogResults.down.test.tsx` (เพิ่มเทสต์ท้ายไฟล์)
- Modify: `apps/web-shop/src/pages/CatalogPage.down.test.tsx` (เพิ่มเทสต์ท้ายไฟล์)
- Modify: `apps/web-shop/src/components/InstallmentCalculatorCard.tsx` (CRLF)
- Modify: `apps/web-shop/src/components/InstallmentCalculatorCard.test.tsx` (แก้ `setup` ตามที่ระบุ + เพิ่มเทสต์ท้ายไฟล์)
- Modify: `apps/web-shop/src/pages/ProductDetailPage.tsx` (CRLF)

**Interfaces:**
- Consumes: `parseDownParam` (`pages/catalog-params.ts` — Task 2) · `CatalogResults` prop `down?: number | null` (Task 3 — หน้ารวมส่ง `activeDown` ซึ่งมีค่าเฉพาะสถานะ ②) · ใน `InstallmentCalculatorCard.tsx` ของรอบ 1: `MAX_DOWN_PCT = 90`, `DEFAULT_DOWN_PCT = 15`, state `downPct` / `downMode` / `downAmountInput`, `downTyped` ref, `downEdited`, `commitAmount`, `DownPaymentInput` (ตัว clamp เดิม: ค่าต่ำกว่าขั้นต่ำถูกปรับขึ้นเองภายใน ~0.9 วินาที) · ตัวช่วยใน `InstallmentCalculatorCard.test.tsx`: `setup`, `requests`, `answer`, `provider` · ตัวช่วยใน `CatalogPage.down.test.tsx`: `open`, `page`, `get`
- Produces:
  - `ProductCard` prop `down?: number | null` — มีค่า > 0 → ทุกลิงก์ของการ์ดเป็น `/products/<id>?down=<บาท>`
  - `InstallmentCalculatorCard` prop `initialDown?: number | null` — เงินดาวน์เริ่มต้นของเรท 1 (ไม่นับว่าลูกค้าแก้ช่อง)

**หมายเหตุการออกแบบ (คำตัดสิน ข1):**
- `initialDown` ตั้งค่าเริ่มต้นของ state เท่านั้น (`downMode = 'AMOUNT'`, `downAmountInput = min(X, floor(ราคาผ่อน × 90%))`) — **ไม่แตะ** `downTyped` / `downEdited` ⇒ คำขอเรท 2 ยังไม่ส่งดาวน์ จนกว่าลูกค้าจะพิมพ์ในช่องของหน้านั้นเอง
- X ต่ำกว่าขั้นต่ำของเครื่อง: ไม่ต้องเขียนโค้ดเพิ่ม — `DownPaymentInput` เดิมปรับค่าที่ต่ำกว่าขั้นต่ำขึ้นเองเมื่อค่านิ่ง (~0.9 วินาที) และการปรับนั้นไม่ตั้ง `downEdited` (เพราะ `downTyped` ยังเป็น false)
- หน้ารายละเอียดส่งค่าที่อ่านจาก URL ให้เครื่องคิดทุกครั้ง — เลือกเครื่องอื่นในหน้าเดียวกัน (component ถูก mount ใหม่ด้วย `key`) ก็เริ่มที่เงินดาวน์เดิมจาก URL

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

**1.1** สร้าง `apps/web-shop/src/components/catalog/ProductCard.down.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import { ProductCard, type ProductGroup } from './ProductCard';

const unit: ProductGroup = {
  id: 'u1',
  kind: 'UNIT',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  condition: 'USED',
  minPrice: 21900,
  stockCount: 1,
  monthlyPaymentFrom: 1960,
  downAmount: 5000,
  installmentMonths: 12,
  rate2: null,
  stock: { display: 'พร้อมขาย', tone: 'normal' },
  images: [],
  tags: [],
};
const hrefs = () => screen.getAllByRole('link').map((a) => a.getAttribute('href'));

it('สถานะ ②: ทุกลิงก์ของการ์ดพา ?down= ไปหน้ารายละเอียด', () => {
  render(
    <MemoryRouter>
      <ProductCard product={unit} priceMode="installment" down={5000} />
    </MemoryRouter>,
  );
  expect(hrefs().length).toBeGreaterThan(0);
  for (const href of hrefs()) expect(href).toBe('/products/u1?down=5000');
});

it('ไม่ได้ใส่เงินดาวน์ (ไม่ส่ง / null / 0) → ลิงก์เดิม', () => {
  for (const down of [undefined, null, 0]) {
    const view = render(
      <MemoryRouter>
        <ProductCard product={unit} priceMode="installment" down={down} />
      </MemoryRouter>,
    );
    for (const href of hrefs()) expect(href).toBe('/products/u1');
    view.unmount();
  }
});
```

**1.2** เพิ่มต่อท้าย `apps/web-shop/src/components/catalog/CatalogResults.down.test.tsx`:

```tsx

it('สถานะ ②: ส่งเงินดาวน์ต่อให้การ์ด — ลิงก์ของการ์ดมี ?down=', () => {
  show({ down: 5000 });
  const links = screen.getAllByRole('link');
  expect(links.length).toBeGreaterThan(0);
  for (const a of links) expect(a).toHaveAttribute('href', '/products/phone-a?down=5000');
});
```

**1.3** เพิ่มต่อท้าย `apps/web-shop/src/pages/CatalogPage.down.test.tsx`:

```tsx

it('ลิงก์ของการ์ดพา ?down= เฉพาะสถานะ ② — ไม่พาในสถานะไม่ใส่อะไรและสถานะฟรีดาวน์', async () => {
  const cardLinks = () =>
    screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href') ?? '')
      .filter((href) => href.startsWith('/products/u1'));

  const second = open('/products?down=5000');
  await screen.findByText('iPhone 16 Pro Max');
  expect(cardLinks().length).toBeGreaterThan(0);
  for (const href of cardLinks()) expect(href).toBe('/products/u1?down=5000');
  second.unmount();

  const first = open('/products');
  await screen.findByText('iPhone 16 Pro Max');
  for (const href of cardLinks()) expect(href).toBe('/products/u1');
  first.unmount();

  open('/products?freeDown=1');
  await screen.findByText('iPhone 16 Pro Max');
  for (const href of cardLinks()) expect(href).toBe('/products/u1');
});
```

**1.4** ใน `apps/web-shop/src/components/InstallmentCalculatorCard.test.tsx`:

(ก) แก้ตัวช่วย `setup` ให้ส่ง `initialDown` ได้ (เพิ่มพารามิเตอร์ที่สามแบบ optional — เทสต์เดิมทุกตัวเรียกแบบเดิมได้) — แทน

```tsx
function setup(id = 'device-1', price = 20000) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const view = (productId: string) => (
    <QueryClientProvider client={client}>
      <InstallmentCalculatorCard productId={productId} cashPrice={12000} installmentPrice={price} />
    </QueryClientProvider>
  );
```

ด้วย

```tsx
function setup(id = 'device-1', price = 20000, initialDown?: number | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const view = (productId: string) => (
    <QueryClientProvider client={client}>
      <InstallmentCalculatorCard
        productId={productId}
        cashPrice={12000}
        installmentPrice={price}
        initialDown={initialDown}
      />
    </QueryClientProvider>
  );
```

(ข) เพิ่มต่อท้ายไฟล์ (หลัง `});` ที่ปิด `describe('installment quote interactions', …)`):

```tsx

// สเปค 2026-11-25 หัวข้อ 7 (คำตัดสิน ข1) — เปิดจากการ์ดหน้ารวมที่ลูกค้าพิมพ์เงินดาวน์ไว้ (?down=)
describe('เปิดด้วยเงินดาวน์จากหน้ารวม (initialDown)', () => {
  it('เรท 1 ขอที่เงินดาวน์นั้น · เรท 2 ยังไม่ส่งดาวน์ · ไม่นับว่าลูกค้าแก้ช่อง จนกว่าจะพิมพ์เอง', async () => {
    setup('device-1', 20000, 5000);
    const [bc, gfin] = requests;
    expect(provider(bc)).toBe('BC');
    expect(bc.params.get('customDownAmount')).toBe('5000');
    expect(bc.params.get('downPct')).toBe('0.25');
    expect(provider(gfin)).toBe('GFIN');
    expect(gfin.params.has('downPct')).toBe(false);
    expect(gfin.params.has('customDownAmount')).toBe(false);
    expect(screen.getByLabelText('เงินดาวน์ เป็นบาท')).toHaveValue(5000);
    await answer([bc], 1960, { downAmount: 5000 });
    await answer([gfin], 4061, {
      downAmount: 0,
      months: 15,
      allowedMonths: [12, 15],
      defaultMonths: 15,
    });
    expect(await screen.findByText('ไม่ต้องวางดาวน์ · 15 งวด')).toBeInTheDocument();
    expect(requests).toHaveLength(2);

    const amount = screen.getByLabelText('เงินดาวน์ เป็นบาท');
    fireEvent.change(amount, { target: { value: '6000' } });
    fireEvent.blur(amount);
    const after = requests.slice(-2);
    expect(after.map(provider)).toEqual(['BC', 'GFIN']);
    expect(after.every((r) => r.params.get('customDownAmount') === '6000')).toBe(true);
  });

  it('เกินเพดาน 90% ของราคาผ่อน → ใช้เพดาน', () => {
    setup('device-1', 20000, 50000);
    const [bc, gfin] = requests;
    expect(bc.params.get('customDownAmount')).toBe('18000');
    expect(bc.params.get('downPct')).toBe('0.9');
    expect(gfin.params.has('customDownAmount')).toBe(false);
    expect(screen.getByLabelText('เงินดาวน์ เป็นบาท')).toHaveValue(18000);
  });

  it('ต่ำกว่าขั้นต่ำของเครื่อง → เรท 1 ถอยไปดาวน์ขั้นต่ำเอง โดยเรท 2 ยังไม่ถูกส่งดาวน์', async () => {
    setup('device-1', 20000, 1000);
    const [bc, gfin] = requests;
    expect(bc.params.get('customDownAmount')).toBe('1000');
    expect(
      screen.getByText('ต่ำกว่าขั้นต่ำ — กำลังปรับขึ้นเป็น 15% (฿3,000)'),
    ).toBeInTheDocument();
    await act(async () => {
      bc.resolve({ data: { available: false, minDownPct: 15, allowedMonths: [6, 8, 10, 12] } });
    });
    await answer([gfin], 4061, {
      downAmount: 0,
      months: 15,
      allowedMonths: [12, 15],
      defaultMonths: 15,
    });
    // ตัว clamp เดิมของช่องปรับขึ้นเองเมื่อค่านิ่ง (~0.9 วินาที) — จบที่ 15% = ฿3,000
    await waitFor(
      () => {
        const lastBc = requests.filter((r) => provider(r) === 'BC').slice(-1)[0];
        expect(lastBc.params.get('downPct')).toBe('0.15');
        expect(['3000', null]).toContain(lastBc.params.get('customDownAmount'));
      },
      { timeout: 3000 },
    );
    expect(screen.getByLabelText('เงินดาวน์ เป็นบาท')).toHaveValue(3000);
    const gfinRequests = requests.filter((r) => provider(r) === 'GFIN');
    expect(
      gfinRequests.every((r) => !r.params.has('downPct') && !r.params.has('customDownAmount')),
    ).toBe(true);
  });

  it('ไม่ส่ง / 0 / ไม่ใช่จำนวนเต็ม → พฤติกรรมเดิม (ดาวน์ขั้นต่ำเป็น %)', () => {
    for (const bad of [undefined, null, 0, 12.5]) {
      requests.length = 0;
      const view = setup('device-1', 20000, bad);
      const [bc] = requests;
      expect(bc.params.get('downPct')).toBe('0.15');
      expect(bc.params.has('customDownAmount')).toBe(false);
      view.unmount();
    }
  });
});
```

**1.5** สร้าง `apps/web-shop/src/pages/ProductDetailPage.down.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import ProductDetailPage from './ProductDetailPage';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get } }));
vi.mock('@/components/layout/ShopLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
// เทสต์นี้ดูแค่ว่าหน้าอ่าน ?down= แล้วส่งให้เครื่องคิด — ส่วนอื่นของหน้าแทนด้วยตัวเปล่า
vi.mock('@/components/InstallmentCalculatorCard', () => ({
  InstallmentCalculatorCard: (p: { productId: string; initialDown?: number | null }) => (
    <div
      data-testid="calc"
      data-product={p.productId}
      data-down={p.initialDown == null ? 'none' : String(p.initialDown)}
    />
  ),
}));
vi.mock('@/components/catalog/ProductGallery', () => ({ ProductGallery: () => null }));
vi.mock('@/components/catalog/RelatedSection', () => ({ RelatedSection: () => null }));
vi.mock('@/components/catalog/UnitPicker', () => ({ UnitPicker: () => null }));
vi.mock('@/components/catalog/SpecTable', () => ({ SpecTable: () => null }));
vi.mock('@/components/catalog/WarrantyDetails', () => ({ WarrantyDetails: () => null }));

const detail = {
  id: 'u1',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  color: 'ดำ',
  category: 'PHONE_USED',
  condition: 'USED',
  deviceOrigin: 'THAI',
  gallery: [],
  gallery360: [],
  cashPrice: 18000,
  installmentPrice: 20000,
  tiers: {
    A: {
      minPrice: 18000,
      maxPrice: 18000,
      units: [
        {
          id: 'u1',
          conditionGrade: 'A',
          deviceOrigin: 'THAI',
          cashPrice: 18000,
          installmentPrice: 20000,
          gallery: [],
          gallery360: [],
        },
      ],
    },
  },
};

function open(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/products/:id" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation((url: string) => {
    if (url === '/api/shop/products/u1') return Promise.resolve({ data: detail });
    if (url.startsWith('/api/shop/installment-preview')) {
      return Promise.resolve({ data: { available: false } });
    }
    return Promise.resolve({ data: {} });
  });
});

it('เปิดด้วย ?down=5000 → ส่งเงินดาวน์ให้เครื่องคิดของเครื่องนั้น', async () => {
  open('/products/u1?down=5000');
  const calc = await screen.findByTestId('calc');
  expect(calc).toHaveAttribute('data-product', 'u1');
  expect(calc).toHaveAttribute('data-down', '5000');
});

it('ไม่มี ?down= หรือไม่ใช่จำนวนเต็มบาท → ไม่ส่ง', async () => {
  const first = open('/products/u1');
  expect(await screen.findByTestId('calc')).toHaveAttribute('data-down', 'none');
  first.unmount();
  open('/products/u1?down=abc');
  expect(await screen.findByTestId('calc')).toHaveAttribute('data-down', 'none');
});
```

ถ้าเทสต์ไฟล์นี้ล้มตอน mount เพราะ component ลูกตัวอื่นของหน้า (ไม่ใช่เพราะ `data-down`) ให้เพิ่ม `vi.mock('<path ของ component นั้น>', () => ({ <ชื่อ export>: () => null }))` แบบเดียวกับห้าบรรทัดข้างบน — ห้ามแก้โค้ดของ component นั้น และห้ามแก้ assertion

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

```bash
cd "/d/BESTCHOICE APP/wt-shop-rate-labels/apps/web-shop" && npx vitest run src/components/catalog/ProductCard.down.test.tsx src/components/catalog/CatalogResults.down.test.tsx src/pages/CatalogPage.down.test.tsx src/components/InstallmentCalculatorCard.test.tsx src/pages/ProductDetailPage.down.test.tsx
```

Expected: FAIL — ลิงก์ยังเป็น `/products/u1` · คำขอเรท 1 ยังไม่มี `customDownAmount` · `data-down` เป็น `none` ทั้งที่มี `?down=5000` (เทสต์เดิมของ `InstallmentCalculatorCard.test.tsx` ในกลุ่ม `installment quote interactions` ยังผ่าน)

- [ ] **Step 3: `ProductCard.tsx` — ลิงก์พา `?down=`**

แก้ `apps/web-shop/src/components/catalog/ProductCard.tsx` (CRLF):

**3.1** ใน `interface Props` เพิ่มต่อจาก `freeDownOnly?: boolean;`:

```tsx
  /** สถานะ ②: เงินดาวน์ที่ลูกค้าพิมพ์ในหน้ารวม (บาท) — ลิงก์ของการ์ดพาไปหน้ารายละเอียดด้วย */
  down?: number | null;
```

**3.2** แทน

```tsx
export function ProductCard({ product: p, priceMode = 'combined', freeDownOnly = false }: Props) {
  const to = p.id ? `/products/${p.id}` : '/products';
```

ด้วย

```tsx
export function ProductCard({
  product: p,
  priceMode = 'combined',
  freeDownOnly = false,
  down = null,
}: Props) {
  // เงินดาวน์ที่พิมพ์ไว้ตามไปหน้ารายละเอียด (ใช้กับเรท 1 — คำตัดสิน ข1)
  const to = p.id ? `/products/${p.id}${down ? `?down=${down}` : ''}` : '/products';
```

- [ ] **Step 4: `CatalogResults.tsx` — ส่ง `down` ให้การ์ด**

แทน

```tsx
                  <ProductCard
                    product={product}
                    priceMode={priceMode}
                    freeDownOnly={freeDownOnly}
                  />
```

ด้วย

```tsx
                  <ProductCard
                    product={product}
                    priceMode={priceMode}
                    freeDownOnly={freeDownOnly}
                    down={down}
                  />
```

- [ ] **Step 5: `InstallmentCalculatorCard.tsx` — `initialDown`**

แก้ `apps/web-shop/src/components/InstallmentCalculatorCard.tsx` (CRLF):

**5.1** แทน

```tsx
interface Props {
  productId: string;
  cashPrice: number | null;
  installmentPrice: number | null;
}
```

ด้วย

```tsx
interface Props {
  productId: string;
  cashPrice: number | null;
  installmentPrice: number | null;
  /** เงินดาวน์ที่ลูกค้าพิมพ์ในหน้ารวม (`?down=`) — ค่าเริ่มต้นของเรท 1 ตอนเปิดหน้า · ไม่นับว่าลูกค้าแก้ช่อง */
  initialDown?: number | null;
}
```

**5.2** แทน

```tsx
function InstallmentCalculator({
  productId,
  installmentPrice,
}: Props & { installmentPrice: number }) {
```

ด้วย

```tsx
function InstallmentCalculator({
  productId,
  installmentPrice,
  initialDown,
}: Props & { installmentPrice: number }) {
  // เปิดจากการ์ดหน้ารวมสถานะ ② (คำตัดสิน ข1): เรท 1 เริ่มที่เงินดาวน์นั้น ไม่เกินเพดาน 90%
  // ต่ำกว่าขั้นต่ำของเครื่อง → ช่องเงินดาวน์ปรับขึ้นเองตามกติกาเดิมของมัน
  // ห้ามแตะ downTyped / downEdited ตรงนี้ — เรท 2 ต้องเปิดที่ค่าตั้งต้นจนกว่าลูกค้าจะพิมพ์เอง
  const seedDown =
    initialDown != null && Number.isInteger(initialDown) && initialDown > 0
      ? Math.min(initialDown, Math.floor((installmentPrice * MAX_DOWN_PCT) / 100))
      : null;
```

**5.3** แทน

```tsx
  const [downPct, setDownPct] = useState(DEFAULT_DOWN_PCT);
  const [downMode, setDownMode] = useState<'PCT' | 'AMOUNT'>('PCT');
  const [downAmountInput, setDownAmountInput] = useState<number | null>(null);
```

ด้วย

```tsx
  const [downPct, setDownPct] = useState(
    seedDown != null ? Math.round((seedDown / installmentPrice) * 100) : DEFAULT_DOWN_PCT,
  );
  const [downMode, setDownMode] = useState<'PCT' | 'AMOUNT'>(seedDown != null ? 'AMOUNT' : 'PCT');
  const [downAmountInput, setDownAmountInput] = useState<number | null>(seedDown);
```

(`InstallmentCalculatorCard` ตัวนอกส่ง `{...props}` อยู่แล้ว — `initialDown` ไปถึง `InstallmentCalculator` โดยไม่ต้องแก้)

- [ ] **Step 6: `ProductDetailPage.tsx` — อ่าน `?down=`**

แก้ `apps/web-shop/src/pages/ProductDetailPage.tsx` (CRLF):

**6.1** import — แทน `import { useParams, Link } from 'react-router';` ด้วย

```tsx
import { useParams, useSearchParams, Link } from 'react-router';
```

และเพิ่ม import ต่อจาก `import { StockIndicator } from '@/components/catalog/StockIndicator';`:

```tsx
import { parseDownParam } from './catalog-params';
```

**6.2** แทน

```tsx
  const { id } = useParams<{ id: string }>();
  const track = useTrackEvent();
```

ด้วย

```tsx
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  // เงินดาวน์ที่ลูกค้าพิมพ์ในหน้ารวม (ลิงก์จากการ์ดสถานะ ②) — ใช้กับเรท 1 ตอนเปิดหน้าเท่านั้น (คำตัดสิน ข1)
  const initialDown = parseDownParam(searchParams.get('down'));
  const track = useTrackEvent();
```

**6.3** แทน

```tsx
            <InstallmentCalculatorCard
              productId={selectedUnit?.id ?? data.id}
              cashPrice={selectedUnit?.cashPrice ?? data.cashPrice}
              installmentPrice={selectedUnit?.installmentPrice ?? data.installmentPrice}
            />
```

ด้วย

```tsx
            <InstallmentCalculatorCard
              productId={selectedUnit?.id ?? data.id}
              cashPrice={selectedUnit?.cashPrice ?? data.cashPrice}
              installmentPrice={selectedUnit?.installmentPrice ?? data.installmentPrice}
              initialDown={initialDown}
            />
```

- [ ] **Step 7: รันเทสต์ + type**

```bash
cd "/d/BESTCHOICE APP/wt-shop-rate-labels/apps/web-shop" && npx vitest run src/pages src/components && npx tsc --noEmit -p .
```

Expected: PASS ทั้งหมด — `ProductCard.down.test.tsx` 2 · `CatalogResults.down.test.tsx` 8 · `CatalogPage.down.test.tsx` 15 · `InstallmentCalculatorCard.test.tsx` 13 เดิม + 4 ใหม่ = 17 · `ProductDetailPage.down.test.tsx` 2 · `tsc` ไม่มี error
(เทสต์ "ต่ำกว่าขั้นต่ำของเครื่อง" รอตัว clamp จริง ~0.9 วินาที — ใช้เวลาเทสต์นั้นราว 1 วินาทีเป็นปกติ)

- [ ] **Step 8: Checkpoint** — รายงานผล Step 7 · ไม่ commit

---

### Task 6: ตรวจรวม + รายการตรวจด้วยตา (ส่วนเบราว์เซอร์ = ผู้คุมงานทำเอง)

**Files:** ไม่มีไฟล์ใหม่ (แก้เฉพาะสิ่งที่การตรวจพบ แล้วรายงาน)

**Interfaces:** Consumes ทุกอย่างจาก Task 1–5 · Produces: รายงานสรุปให้ผู้คุมงาน

- [ ] **Step 1: รันเทสต์ทั้งหมดของสองฝั่ง + type**

```bash
cd "/d/BESTCHOICE APP/wt-shop-rate-labels/apps/api" && NODE_OPTIONS="--max-old-space-size=8192 --experimental-vm-modules" node ../../node_modules/jest/bin/jest.js --runInBand --forceExit src/modules/shop-catalog && npx tsc --noEmit -p tsconfig.json
cd "/d/BESTCHOICE APP/wt-shop-rate-labels/apps/web-shop" && npx vitest run ; npx tsc --noEmit -p .
```

Expected:
- API: 11 suites / 168 tests ผ่าน · `tsc` ไม่มี error
- เว็บ: 227 ผ่าน + 1 ไม่ผ่านตัวเดิม (`src/styles/typography-utilities.test.ts` — หา `grep` ไม่เจอ ไม่เกี่ยวกับงานนี้) · baseline 177 + ใหม่ 50 (catalog-params +3 · DownAmountField 7 · FilterSidebar.down 3 · FilterSidebar.restyle 6 · CatalogResults.down 8 · CatalogPage.down 15 · ProductCard.down 2 · InstallmentCalculatorCard +4 · ProductDetailPage.down 2 · EmptyState ไม่มีไฟล์เทสต์แยก) · `tsc` ไม่มี error
- ถ้าจำนวนไม่ตรง ให้รายงานตัวเลขจริงพร้อมชื่อไฟล์ที่ต่าง — ห้ามปรับเทสต์ให้ตัวเลขตรง

- [ ] **Step 2: ค้นสิ่งต้องห้ามในไฟล์หน้าร้านที่แก้**

```bash
cd "/d/BESTCHOICE APP/wt-shop-rate-labels/apps/web-shop/src" && grep -nE "GFIN|BESTCHOICE FINANCE|รวมจ่าย|#[0-9A-Fa-f]{6}\b|font-extrabold|tracking-tight|Looped|Prompt" components/catalog/DownAmountField.tsx components/catalog/Pill.tsx components/catalog/FilterSidebar.tsx components/catalog/CatalogResults.tsx components/catalog/ProductCard.tsx components/states/EmptyState.tsx pages/CatalogPage.tsx pages/catalog-params.ts ; grep -n "เรท" components/catalog/DownAmountField.tsx components/catalog/Pill.tsx components/catalog/FilterSidebar.tsx components/catalog/CatalogResults.tsx pages/CatalogPage.tsx ; grep -n "type=\"range\"\|downPct\|สภาพเครื่อง" components/catalog/FilterSidebar.tsx pages/CatalogPage.tsx pages/catalog-params.ts
```

Expected:
- คำสั่งแรก: ไม่มีผลลัพธ์ (สี hex เดิมใน SVG ของ `CatalogPage.tsx` ใช้ `var(--color-…)` อยู่แล้ว ไม่ติด)
- คำสั่งที่สอง: ถ้าเจอ "เรท" ต้องอยู่ใน comment เท่านั้น — ห้ามอยู่ในข้อความที่แสดงบนหน้ารวม
- คำสั่งที่สาม: ไม่มี `type="range"` · `downPct` เหลือได้เฉพาะใน comment ของ `catalog-params.ts` · "สภาพเครื่อง" เหลือได้เฉพาะใน comment

- [ ] **Step 3: ตรวจว่าไม่ได้แตะไฟล์นอกขอบเขต**

```bash
cd "/d/BESTCHOICE APP/wt-shop-rate-labels" && git status --short
```

Expected: ไฟล์ที่เพิ่ม/แก้ในรอบ 2 ตรงกับตาราง File Structure ของแผนนี้ (บวกไฟล์ของรอบ 1 ที่ยังไม่ commit อยู่เดิม) · `apps/web-shop/src/components/catalog/PlanTiles.tsx` ต้องไม่มีการแก้เพิ่มจากรอบ 1 · ไม่มีการ stage / commit

- [ ] **Step 4: (ผู้คุมงานทำเอง — ผู้ลงมือไม่ต้องทำ) ดูด้วยเบราว์เซอร์กับ API จำลอง**

เครื่องนี้ไม่มี Docker / ฐานข้อมูล — ผู้คุมงานเปิด `npx vite --port 5176` ของ web-shop แล้วจำลองคำตอบ `/api/**` ในเบราว์เซอร์ (แบบเดียวกับ `e2e/catalog-origin.spec.ts`) ตรวจที่จอกว้าง 360px และ 1280px:

1. `/products` โหมดผ่อน — กล่องเงินดาวน์มี "เงินดาวน์ [____] บาท" ไม่มีแถบเลื่อน ไม่มี % ไม่มีปุ่มลัดจำนวนเงิน · ฟอนต์/สี/มุมมน/เงาเหมือนหน้าเดิม
2. พิมพ์ 5000 แล้วออกจากช่อง / กด Enter — URL มี `?down=5000` · คำขอมี `downAmount=5000` (ไม่มี `downPct`) · บรรทัดสรุป "พบ N เครื่องที่ดาวน์ได้ด้วยเงิน ฿5,000" · ท้ายรายการ "อีก N เครื่องต้องดาวน์มากกว่า ฿5,000 (เริ่มที่ ฿Y) ดูทั้งหมด" · กด "ดูทั้งหมด" กลับสถานะไม่ใส่อะไร
3. พิมพ์ 0 — กลายเป็นติ๊กฟรีดาวน์ (URL `?freeDown=1`, ช่องเงินดาวน์เทาแสดง 0, แถวติ๊กพื้นเหลือง) · เอาติ๊กออก → ช่องว่าง
4. คำตอบว่างในสถานะ ② — "เงินดาวน์ ฿X ยังไม่พอ" + "ดาวน์ต่ำสุดเริ่มที่ ฿Y" + ปุ่ม "ดูเครื่องฟรีดาวน์" (เมื่อมี) + "ล้างเงินดาวน์"
5. ตัวกรอง: ไทย/นอก และช่วงราคาเป็นปุ่มกด (ตัวที่เลือกพื้นเขียวเข้มตัวขาว ปุ่มสูง ≥ 44px ขึ้นบรรทัดใหม่ได้ไม่ล้นกรอบ) · "รุ่น" ยังเป็นดรอปดาวน์ · ไม่มี "สภาพเครื่อง" · "ล้างตัวกรองทั้งหมด" ล้างเงินดาวน์/ฟรีดาวน์ด้วย
6. จอ 360px: ใต้สวิตช์ ผ่อน/ซื้อสด มีแถว "เงินดาวน์ [____] บาท" + ช่องติ๊ก "ฟรีดาวน์" ในบรรทัดเดียว ไม่ล้นจอ พิมพ์ 10,000 แล้วเห็นตัวเลขครบ · แถวถัดไป ทั้งหมด / มือ 1 / มือ 2 / ตัวกรอง · แผง "ตัวกรอง" มีเนื้อหาเดียวกับแถบข้าง · สลับ "ซื้อสด" แล้วแถวเงินดาวน์หาย
7. การ์ดในสถานะ ②: กล่องบน "ดาวน์ ฿5,000" + "ผ่อน ฿… × … งวด" บรรทัดเดียว · เครื่องที่เงินไม่พอเรท 1 เหลือกล่องล่างกล่องเดียว · บนการ์ดไม่มีคำว่า "เรท" ไม่มี %
8. กดการ์ดในสถานะ ② — ไปที่ `/products/<id>?down=5000` · ช่องเงินดาวน์ของหน้ารายละเอียดเป็น ฿5,000 · "เรท 1" คิดที่ 5,000 · "เรท 2" ยังเป็นค่าตั้งต้นเท่ากับกล่องล่างของการ์ด · แก้ช่องเงินดาวน์แล้วทั้งสองเรทคิดใหม่ · กดการ์ดจากสถานะไม่ใส่อะไร/ฟรีดาวน์ — URL ไม่มี `?down=`
9. เปิด `/products/<id>?down=1000` (ต่ำกว่าขั้นต่ำ) — ช่องปรับขึ้นเป็นขั้นต่ำเองภายในราว 1 วินาที เรท 2 ไม่เปลี่ยน

- [ ] **Step 5: Checkpoint สุดท้าย** — สรุปให้ผู้คุมงาน: ไฟล์ที่เปลี่ยน (`git status --short`), ผลเทสต์ทุกชุด (ตัวเลขจริง), ผล e2e ของ Task 4 Step 9 (รัน/ไม่ได้รัน), สิ่งที่ยังไม่ได้ตรวจ (Step 4 เป็นของผู้คุมงาน) · **รอเจ้าของสั่งก่อน commit / push / เปิด PR** · เตือน: deploy API ก่อนหรือพร้อมเว็บ (เว็บใหม่ + API เก่า = ช่องเงินดาวน์ไม่มีผล)

---

## Self-Review

**Spec coverage (รอบ 2 ตามหัวข้อ 9 ของสเปค):**

| ข้อในสเปค | Task |
|---|---|
| §8 query `downAmount` (จำนวนเต็มบาท ≥ 0) · เรท 1 จากเงินดาวน์เป็นบาท (`customDownAmount = min(X, เพดาน 90%)` · ต่ำกว่าดาวน์ขั้นต่ำที่ปัดหลักร้อย = ไม่มีเรท 1) | 1 |
| §8 `overBudgetCount` · `nextDownFrom` · ลำดับ (นับฟรีดาวน์ → ตัดเงิน → กรองฟรีดาวน์ → แบ่งหน้า) · `freeDown` ชนะ `downAmount` · `downAmount=0` = `freeDown` · `downPct` ยังรับ · ไม่ส่งตัวเลขภายใน | 1 |
| §10 API รอบ 2 (ทุกข้อ รวม parity เรท 1 กับ preview `customDownAmount`) | 1 |
| §5 สถานะ ②: ช่องพิมพ์เป็นบาทแทนแถบเลื่อน · commit ตอน blur/Enter + หน่วง 250ms · พิมพ์ 0 = ติ๊ก · ติ๊กแล้วช่องใช้ไม่ได้ · เอาติ๊กออกกลับสถานะ ① · ซื้อสดล้าง `down`/`freeDown` · §6 `?down=` | 2 |
| §5 บรรทัด "อีก N เครื่อง… ดูทั้งหมด" · รายการว่าง "เงินดาวน์ ฿X ยังไม่พอ…" + ปุ่ม · §6 บรรทัดสรุปสถานะ ②/③ | 3 |
| §6 ปุ่มกดไทย/นอก + ช่วงราคา (`aria-pressed`, หน้าตา `Pill`) · "รุ่น" ดรอปดาวน์เดิม · เอาสภาพเครื่องออก · ล้างทั้งหมดรวมเงินดาวน์/ฟรีดาวน์ · แถวเงินดาวน์ + ติ๊กฟรีดาวน์บนมือถือ · แผงมือถือเนื้อหาเดียวกับแถบข้าง | 4 |
| §5 ตารางสถานะ ② ฝั่งการ์ด (กล่องเรท 1 = X · เงินไม่พอ = ไม่มีกล่อง · กล่องล่างตามกติกาเดิม) | ไม่ต้องแก้ `PlanTiles` — API (Task 1) ส่งช่องเรท 1 เป็น null/เป็น X แล้วกติกา `showsRate2Tile` ของรอบ 1 ให้ผลตามตารางเอง (เรท 2 ที่ดาวน์ > X ถูก API ตัดการ์ดออกไปแล้วเมื่อไม่มีเรท 1) |
| §7 ข้อสุดท้าย: เปิดด้วย `?down=` → เรท 1 เริ่มที่เงินนั้น เรท 2 ค่าตั้งต้น (ข1) · ลิงก์การ์ดพา `?down=` เฉพาะสถานะ ② | 5 |
| §10 เว็บรอบ 2 + ตาดู 360/1280 | 2–5 (เทสต์) · 6 Step 4 (ตาดู — ผู้คุมงาน) |

**ตั้งใจไม่ทำ / ทำต่างจากที่อาจคาด:**
- ไม่มีด่านตรวจรุ่น API สำหรับช่องเงินดาวน์ (คำตัดสินผู้คุมงาน) — เว็บใหม่ + API เก่า: ช่องไม่มีผล และบรรทัดสรุปจะยังเขียน "พบ N เครื่องที่ดาวน์ได้ด้วยเงิน ฿X" ทั้งที่รายการไม่ถูกกรอง ⇒ ต้อง deploy API ก่อนหรือพร้อมเว็บ
- กล่องเงินดาวน์แสดงทุกครั้งที่อยู่โหมดผ่อน (เดิมรอ `minDownPct` ของคำตอบแรก) — ช่องบาทไม่ใช้ค่านั้น และถ้ายังผูกไว้ กล่องจะหายเมื่อตัวกรองอื่นไม่มีสินค้า
- ล้างเงินดาวน์มีผลทันที (ไม่หน่วง 250ms) — หน่วงเฉพาะตอนตั้งค่า
- หน้ารายละเอียดเปิดด้วยเงินดาวน์ต่ำกว่าขั้นต่ำ: ใช้ตัว clamp เดิมของช่อง (ปรับขึ้นหลังค่านิ่ง ~0.9 วินาที มีคำขอเรท 1 ที่ไม่ผ่านหนึ่งครั้งก่อนปรับ) — ไม่เขียน clamp ชุดที่สอง เพราะขั้นต่ำจริงมาจากคำตอบของ server
- ข้อความ hint ใต้ช่อง (`copy.catalog.downHint`) ไม่อยู่ในรายการข้อความของผู้คุมงาน — ใช้ประโยคจากภาพตัวอย่างที่เจ้าของเคาะ (`filter-real-look.html`)
- ช่องติ๊กฟรีดาวน์บนมือถือยังมีตัวเลขจำนวนเครื่องต่อท้าย (ของรอบ 1) — ภาพตัวอย่างไม่มีตัวเลข
- `e2e/catalog-origin.spec.ts` ถูกแก้ (Task 4 Step 7) เพราะอ้าง `<select>` ที่ถูกแทนด้วยปุ่มกด — spec นี้ไม่อยู่ใน CI และอาจรันไม่ได้บนเครื่องนี้
- นอกขอบเขตตามสเปคหัวข้อ 12 ไม่ถูกแตะ (การ์ดโหมด `combined`, ตัวกรอง "ผ่อนต่อเดือนไม่เกิน", บอท ฯลฯ)

**Placeholder scan:** ตรวจแล้ว — ไม่มี "TBD" / "เพิ่มการจัดการที่เหมาะสม" / "เหมือน Task N" / "เขียนเทสต์ของข้างบน" · ทุกขั้นที่แก้โค้ดมีโค้ดเต็มหรือคู่ "แทน … ด้วย …" ที่คัดจากไฟล์จริงใน working tree

**Type / ชื่อ ที่ใช้ข้าม task (ตรวจตรงกันแล้ว):**
- API: `filters.downAmount` ↔ `ListProductsDto.downAmount` ↔ query `downAmount` ที่ `buildCatalogParams` ส่ง · `overBudgetCount` / `nextDownFrom` (service → `CatalogResponse` → `lastMeta` → props ของ `CatalogResults`) · `rate1MinDown` อยู่บน `SortableCard` เท่านั้น (ไม่อยู่ใน `ProductGroup`)
- เว็บ: `parseDownParam` (Task 2 → ใช้ใน `CatalogPage` และ `ProductDetailPage` ของ Task 5) · `CatalogQuery.downAmount` · `DownAmountField` props (`id`, `value`, `onCommit`, `disabled`, `variant`, `hintId`) ใช้ตรงกันใน `FilterSidebar` (Task 2) และ `CatalogPage` (Task 4) · `PlanControls.down` / `onDown` (Task 2) ถูกอ่านโดย `active` ของ Task 4 · `down` / `setDown` / `activeDown` / `setFreeDown` ของ `CatalogPage` (Task 2) ใช้ใน Task 3–4 · `CatalogResults.down` (Task 3) → `ProductCard.down` (Task 5) · `InstallmentCalculatorCard.initialDown` (Task 5) ← `ProductDetailPage` · `Pill` props (`active`, `onClick`, `children`, `className`) · `FilterSidebar.onClearAll` ← `clearAllFilters` · คีย์ `copy.catalog.*`: `downLabel` `downUnit` `downHint` (Task 2) · `foundWithDown` `foundFreeDown` `overBudget` `showAll` `emptyDownTitle` `emptyDownDescription` `seeFreeDown` `clearDown` (Task 3) · `clearAll` (Task 4)
- ตัวช่วยของ `CatalogPage.down.test.tsx` (`get`, `page`, `open`, `listCalls`, `paramsOf`, `lastParams`, `urlParams`, `downInput`, `pause`) สร้างใน Task 2 และถูกใช้ต่อใน Task 3–5 ด้วยชื่อเดิม

**จุดที่ผู้ลงมือต้องระวัง:**
- ไฟล์ CRLF (`CatalogPage.tsx`, `FilterSidebar.tsx`, `CatalogResults.tsx`, `ProductCard.tsx`, `InstallmentCalculatorCard.tsx`, `ProductDetailPage.tsx`, `copy.ts`, `list-products.dto.ts`) — แก้ด้วยการแทนที่เฉพาะส่วน อย่าเขียนทับทั้งไฟล์
- `setSearchParams` ไม่ต่อคิว: ทุกปุ่มต้องเขียน URL ครั้งเดียว (เหตุที่มี `clearAllFilters` และที่ `setFreeDown` ล้าง `down` เอง)
- เทสต์เดิมที่แผนนี้แก้มี 4 ที่เท่านั้น: `catalog-params.test.ts` (Task 2 Step 1.1), `FilterSidebar.freeDown.test.tsx` (Task 2 Step 1.4), ตัวช่วย `setup` ใน `InstallmentCalculatorCard.test.tsx` (Task 5 Step 1.4 ก — เพิ่มพารามิเตอร์ ไม่แตะ assertion), `e2e/catalog-origin.spec.ts` (Task 4 Step 7)
