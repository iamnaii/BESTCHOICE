# After-Sales Hub PR 3 — LINE ลูกค้า 3 จังหวะ · เตือนรับเครื่อง · LIFF "เคสของฉัน" · ประกันใกล้หมด — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ลูกค้าที่ผูก LINE ฝั่งร้านได้รับข้อความอัตโนมัติ 3 จังหวะของเคสหลังการขาย (รับเรื่องแล้ว · มารับได้แล้ว · ปิดเคส) + เตือนซ้ำ 1 ครั้งเมื่อครบ 7 วันยังไม่มารับ + เห็น "เคสของฉัน" ในหน้า LIFF `/liff/warranty` + `warranty.cron.ts` ส่ง LINE "ประกันใกล้หมด 7 วัน" ได้จริง (แม่แบบปิดไว้จนเจ้าของเคาะข้อความ)

**Architecture:** ไม่มี migration โครงสร้าง — มีแค่ seed แม่แบบ `NotificationTemplate` 5 แถว (แก้ได้ที่ `/notifications`) · ส่งผ่าน `NotificationsService.sendFromTemplate` ตัวเดิม (channelKey `line-shop`, ผู้รับ = `customer.lineIdShop` — **ไม่ใช่** `CustomerLineLink` ซึ่งไม่มีแถวช่องร้านเลย) · service ใหม่ `AfterSalesLineService` เป็นตัวเดียวที่ส่ง+บันทึก `AfterSalesEvent` (`LINE_SENT` / `LINE_SKIPPED_NO_LINK` / `NOTE` เมื่อส่งไม่ได้) เรียกแบบ fire-and-forget หลัง commit จาก 5 จุดที่มีอยู่แล้ว (เปิดเคส · ซ่อมเสร็จ · ส่งมอบคืน · ยืนยันเปลี่ยน/ส่งมอบเครื่องใหม่ · อนุมัติคำขอ) · cron ใหม่ `after-sales-line.cron.ts` (10:00 BKK) ทำ 2 เรื่อง: เตือนรับเครื่องครบ 7 วัน และส่งจังหวะ 3 ให้เคสเปลี่ยนแบบมีราคาที่ปิดจากการเปิดใช้สัญญาใหม่ (engine ปิดให้ ไม่มี hook) · LIFF ใช้ controller/guard เดิมของ `/liff/my-warranties` เพิ่ม endpoint `my-after-sales-cases` · ประกันใกล้หมดอยู่ในโมดูล `warranty` เอง (service ใหม่เล็ก ๆ ไม่พึ่ง after-sales กัน circular import)

**Tech Stack:** NestJS + Prisma (`NotificationsService`, `IntegrationConfigService`, `@Cron`), vitest integration บน DB จริง + jest unit, React + react-query (หน้า LIFF + หน้าเคส), Playwright ไม่เพิ่ม (spec ข้อ 13 มี 1 เส้นแล้ว)

**Spec:** `docs/superpowers/specs/2026-09-23-after-sales-hub-design.md` — ข้อ 8 (LINE ลูกค้า), 4.3 ข้อ 4 (LINE จังหวะ 1 หลังบันทึก), 4.4 (ป้าย "ยังไม่ผูก LINE — โทรแจ้ง" + timeline รวม LINE), 12 ข้อ 7 (`warranty.cron.ts`), 13 (LINE: มี link ส่ง / ไม่มี link ลง event), 14 แถว 3, 15 ข้อ 2–3 · ร่างข้อความ = mockup กระดาน 6 (artifact SoThf1rbZEaxas5KJgudxp `project/Line.dc.html`) ที่เจ้าของเคาะ V4 แล้ว

## Global Constraints

- ผู้รับฝั่งร้าน = `customer.lineIdShop` เท่านั้น + `channelKey: 'line-shop'` — **ห้ามอ่าน `customerLineLink` สำหรับช่องร้าน** (มีแต่แถว FINANCE; `broadcast-audience.spec.ts` ปักไว้ว่าห้าม) · `lineIdShop` เป็น PII **ห้ามหลุดไป response/log** (ส่งได้แค่ boolean `lineLinked` ตามที่ `getCase` ทำอยู่)
- ส่ง LINE = **หลัง commit เสมอ, fire-and-forget, ห้าม throw** (pattern `SaleWarrantyNotifierService` / `DeviceReturnNotifyService`): `void this.line.notifyMoment(...)` — ความล้มเหลวของ LINE ต้องไม่ทำให้ POST ของเคสล้ม · ทุกครั้งที่ส่ง/ไม่ส่ง ลง `AfterSalesEvent` (สเปก 8)
- แม่แบบ = `NotificationTemplate` (placeholder `${var}` ไม่ใช่ `{{var}}`), seed ด้วย SQL `INSERT … ON CONFLICT (event_type) DO NOTHING` (pattern `20261003200000_seed_device_return_templates`) — **migration ห้ามทับแถวที่มีอยู่** ; ข้อความแก้ที่ `/notifications` (สเปกเขียนว่า SystemConfig — ใช้ตารางแม่แบบที่มี UI อยู่แล้วแทน = เจตนาเดียวกัน)
- category ของ 3 จังหวะ + เตือนรับเครื่อง = `TRANSACTIONAL` (ข้ามด่านความยินยอม/quiet hours เหมือน `DEVICE_RETURNED` — แจ้งตามงานที่ลูกค้าฝากไว้) · ประกันใกล้หมด = `REMINDER` (ผ่านด่าน PDPA + เวลาทำการ + cap 1/วัน) และ seed `is_active = false` จนเจ้าของเคาะข้อความ (สเปก 12.7 "เจ้าของเคาะข้อความก่อน")
- kill switch: `SystemConfig` key `after_sales_line_enabled` อ่านด้วย `readBoolFlag(prisma, key, true)` — **ไม่มีแถว = เปิด** (แบบ `shop_receivable_aging_alerts_enabled`); ปิด = ไม่ส่ง + event `NOTE` "[<eventType>] ปิดการส่ง LINE"
- cron: root `PrismaService` เท่านั้น · ห้าม throw ออกจาก tick (outer try/catch + per-row try/catch) · `Sentry.captureException(err, { tags: { subsystem: 'after-sales-line', cron } })` · `@Cron('0 10 * * *', { timeZone: 'Asia/Bangkok' })` · ไฟล์ใต้ `apps/api/src/modules/after-sales/crons/` (convention โมดูลใหม่) — เทสต์ cron เป็น **jest unit** (`*.cron.spec.ts` ข้าง ๆ ไฟล์) ไม่ต้องเพิ่ม glob CI; integration spec ใหม่ทุกไฟล์ต้องอยู่ที่ `apps/api/src/modules/after-sales/__tests__/` (glob `AFTERSALES_FILES` ไม่ recurse)
- ห้ามแตะเครื่องยนต์บัญชี/สถานะภายในของ repair-tickets, defect-exchange, contract-exchange (เหมือน PR 1–2) · ห้าม LINE ถึงพนักงาน (สเปก 3)
- คำที่ใช้ (สเปก 4.0): ข้อความถึงลูกค้าใช้ร่างจากกระดาน 6 ตามตัวอักษร — **ข้อยกเว้นเดียว**: ข้อความถึงลูกค้าใช้คำว่า "รับเครื่องของคุณไว้ที่สาขาแล้ว" / "รอรับเครื่อง" ได้ (เจ้าของเคาะในกระดาน 6; กฎห้าม "รับเครื่อง" เป็นกฎของหน้าจอพนักงาน) · หน้าจอพนักงาน/LIFF ยังห้าม "รับเครื่อง" (LIFF ใช้ "รอรับเครื่อง" ตามกระดาน 6 ซึ่งเป็นหน้าลูกค้า)
- เว็บ: tokens เท่านั้น · `leading-snug` · สถานะมีไอคอน/ข้อความ · หน้า LIFF ใช้ `liffApi` + `useLiffInit` เดิม (ไม่แตะ auth) · ห้าม `npm run lint` ใน apps/api · bump `version` ใน `apps/web/package.json` (ดูค่าปัจจุบัน ณ วันทำ) · commit ลงท้าย `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`

## Review Focus

1. **ลูกค้าไม่ผูก LINE** (walk-in / ขายสดที่ไม่เคยผูก): ทุกจังหวะต้องไม่ error, ลง event `LINE_SKIPPED_NO_LINK` ครั้งเดียวต่อจังหวะ, หน้าเคสขึ้นป้าย "ยังไม่ผูก LINE — โทรแจ้ง" — เทสต์ที่ Task 2 (b) + Task 3 integration (ข)
2. **LINE API ล้ม/429/แม่แบบถูกปิด** ระหว่างบันทึกซ่อมเสร็จ: การบันทึกสำเร็จเหมือนเดิม, `NotificationLog` FAILED/BLOCKED, event `NOTE` บอกเหตุ, ไม่ throw — Task 2 (c)(d)
3. **ส่งซ้ำ**: กด "บันทึกซ่อมเสร็จ" → ส่งซ่อมต่อ → ซ่อมเสร็จอีก = ส่งจังหวะ 2 อีกครั้งได้ (เหตุการณ์จริง) แต่ **เตือน 7 วันต้องส่งครั้งเดียวต่อเคส** และจังหวะ 3 ของเคสมีราคาต้องส่งครั้งเดียวแม้ cron รันทุกวัน — Task 4 (a)(c)
4. **PII**: `lineIdShop` ต้องไม่โผล่ใน response ของ lookup/getCase/LIFF, ใน `AfterSalesEvent.note`, หรือใน log — Task 2 (e) + Task 6 (c)
5. **ประกันใกล้หมด**: ลูกค้าขายสด (ตาราง `Sale`) ต้องถูกนับด้วย ไม่ใช่แค่สัญญาผ่อน, ส่ง 1 ครั้งต่อ (เครื่อง, ชนิดประกัน) แม้ cron รันทุกวันใน 7 วันนั้น, และแม่แบบที่ปิดอยู่ = ไม่ส่งแต่ไม่ error — Task 5 (a)(b)(c)

---

## File Structure

**API — สร้าง**
- `apps/api/prisma/migrations/20261010000000_seed_after_sales_line_templates/migration.sql` — 5 แม่แบบ
- `apps/api/src/modules/after-sales/utils/after-sales-line-copy.util.ts` — ค่าคงที่ eventType/tag + ตัวประกอบข้อมูล `${var}` (pure, ทดสอบง่าย)
- `apps/api/src/modules/after-sales/services/after-sales-line.service.ts` — `AfterSalesLineService.notifyMoment(caseId, moment, actorId)` (ผู้รับ · kill switch · ส่ง · event) — ที่เดียวที่ส่ง LINE ของเคส
- `apps/api/src/modules/after-sales/crons/after-sales-line.cron.ts` — `AfterSalesLineCron` (เตือน 7 วัน + จังหวะ 3 ของเคสมีราคา)
- `apps/api/src/modules/warranty/warranty-line-notifier.service.ts` — `WarrantyLineNotifierService.notifyExpiring(item)` (โมดูล warranty เอง)
- `apps/api/src/modules/line-oa/liff-after-sales.service.ts` — `LiffAfterSalesService.getMyCases(lineUserId)`
- เทสต์: `after-sales/__tests__/line-copy.spec.ts`, `after-sales/__tests__/line-service.spec.ts`, `after-sales/crons/after-sales-line.cron.spec.ts`, `after-sales/__tests__/line-templates-migration.spec.ts`, `warranty/warranty-line-notifier.service.spec.ts`, `warranty/warranty.cron.spec.ts`, `line-oa/liff-after-sales.service.spec.ts`

**API — แก้**
- `after-sales/after-sales.module.ts` (imports `NotificationsModule`, `IntegrationsModule`; providers + exports ใหม่) · `services/after-sales-case.service.ts` (จังหวะ 1 หลัง audit) · `services/after-sales-repair.service.ts` (จังหวะ 2 หลัง `markRepaired`, จังหวะ 3 หลัง `returnToCustomer`) · `services/after-sales-exchange.service.ts` (จังหวะ 2 หลัง `confirmSameModel` และ `approvePriced` PRICED, จังหวะ 3 หลัง `deliver` และ `approvePriced` MEMO) · `services/after-sales-lookup.service.ts` (`lineLinked` ใน `LookupResult`) · `services/after-sales-query.service.ts` (`lineEvents` สรุปในเคส)
- `warranty/warranty.cron.ts` · `warranty/warranty.service.ts` (`getExpiringWarranties` รวม `Sale`) · `warranty/warranty.module.ts`
- `line-oa/liff-warranty.controller.ts` (route ใหม่) · `line-oa/line-oa.module.ts` (provider ใหม่)
- integration spec เดิม `after-sales/__tests__/after-sales-flow.integration.spec.ts` (เพิ่ม describe LINE) — constructor ของ 3 service เปลี่ยน ต้องแก้ทั้ง 2 integration spec + unit spec ที่ `new` service เอง

**Web — สร้าง/แก้**
- `apps/web/src/pages/liff/components/MyAfterSalesCases.tsx` (ใหม่) · `apps/web/src/pages/liff/LiffWarranty.tsx` (เพิ่มส่วน)
- `apps/web/src/pages/AfterSalesCasePage.tsx` (การ์ด "LINE ลูกค้า" ของจริง) · `apps/web/src/pages/after-sales/CaseTimeline.tsx` (label `LINE_SENT`/`LINE_SKIPPED_NO_LINK`) · `apps/web/src/pages/after-sales/after-sales.ts` (`LookupResult.lineLinked`, `CaseDetail.lineEvents`) · `apps/web/src/pages/AfterSalesNewPage.tsx` (บรรทัด "จะส่ง LINE" ในสรุปก่อนบันทึก)
- เทสต์: `apps/web/src/pages/liff/components/MyAfterSalesCases.test.tsx`, เพิ่มใน `AfterSalesCasePage.test.tsx`, `AfterSalesNewPage.test.tsx`

---

### Task 1: แม่แบบ LINE 5 แถว (migration seed) + ค่าคงที่/ตัวประกอบข้อมูล (pure util)

**Files:**
- Create: `apps/api/prisma/migrations/20261010000000_seed_after_sales_line_templates/migration.sql`
- Create: `apps/api/src/modules/after-sales/utils/after-sales-line-copy.util.ts`
- Test: `apps/api/src/modules/after-sales/__tests__/line-copy.spec.ts` · `apps/api/src/modules/after-sales/__tests__/line-templates-migration.spec.ts`

**Interfaces:**
- Produces:

```ts
export type AfterSalesLineMoment = 'RECEIVED' | 'READY' | 'CLOSED' | 'PICKUP_REMINDER';
export const AFTER_SALES_LINE_EVENT_TYPE: Record<AfterSalesLineMoment, string> = {
  RECEIVED: 'AFTER_SALES_RECEIVED', READY: 'AFTER_SALES_READY',
  CLOSED: 'AFTER_SALES_CLOSED', PICKUP_REMINDER: 'AFTER_SALES_PICKUP_REMINDER',
};
export const WARRANTY_EXPIRING_EVENT_TYPE = 'WARRANTY_EXPIRING_7D';
/** note ของ AfterSalesEvent ทุกแถวที่ service นี้เขียน ขึ้นต้นด้วย tag เพื่อ dedup/ค้นย้อน */
export function lineEventTag(eventType: string): string; // → `[${eventType}]`
export function lineEventNote(eventType: string, status: 'SENT' | 'NO_LINK' | 'DISABLED' | 'FAILED' | 'BLOCKED', detail?: string): string;
export interface LineCaseRow { /* ฟิลด์ที่ builder ต้องใช้ — ดู Step 3 */ }
export function buildLineData(row: LineCaseRow, moment: AfterSalesLineMoment, liffLine: string): Record<string, string>;
export function buildLiffLine(liffId: string | null, label: string): string; // '' เมื่อไม่มี liffId
```

- [ ] **Step 1: เทสต์ util** — `line-copy.spec.ts`:
  (a) `lineEventNote('AFTER_SALES_READY','SENT')` = `'[AFTER_SALES_READY] มารับได้แล้ว · ส่งแล้ว'`; `('AFTER_SALES_RECEIVED','NO_LINK')` = `'[AFTER_SALES_RECEIVED] รับเรื่องแล้ว · ไม่ได้ส่ง — ลูกค้ายังไม่ผูก LINE'`; `('AFTER_SALES_CLOSED','FAILED','429')` = `'[AFTER_SALES_CLOSED] ปิดเคส · ส่งไม่สำเร็จ (429)'`
  (b) `buildLiffLine('123-abc','ดูสถานะเคส')` = `'ดูสถานะเคส: https://liff.line.me/123-abc/liff/warranty'` · `buildLiffLine(null,'x')` = `''`
  (c) `buildLineData` RECEIVED · outcome REPAIR · warranty IN_SHOP_WARRANTY · payer SHOP → `entitlementLine` = `'อยู่ในประกันร้าน ไม่มีค่าใช้จ่าย'`, `nextLine` = `'ซ่อมเสร็จเมื่อไร ทางร้านจะแจ้งทาง LINE นี้ทันที'`; payer CUSTOMER estimatedCost 1500 → `'หมดประกัน ค่าซ่อมประมาณ 1,500 บาท ยืนยันราคาก่อนซ่อมทุกครั้ง'` (ใช้ `OUT_OF_WARRANTY`) ; IN_MANUFACTURER + SUPPLIER_CLAIM → `'อยู่ในประกันศูนย์ ส่งเคลมศูนย์ ไม่มีค่าใช้จ่าย'`; outcome SAME_MODEL_EXCHANGE → `entitlementLine` `'เปลี่ยนรุ่นเดิม รอผู้จัดการยืนยัน'` + `nextLine` `'เมื่อพร้อมรับเครื่อง ทางร้านจะแจ้งทาง LINE นี้ทันที'`; PRICED_EXCHANGE → `'เปลี่ยนแบบมีราคา รออนุมัติ'`
  (d) READY: REPAIR payer CUSTOMER actualCost 1500 → `readyLine` `'ซ่อมเสร็จแล้ว มารับได้เลย'`, `costLine` `'ค่าซ่อม 1,500 บาท ชำระที่สาขา'`; REPAIR payer SHOP → `costLine` `'ไม่มี (ในประกันร้าน)'`; SAME_MODEL → `readyLine` `'เปลี่ยนเครื่องใหม่ให้แล้ว มารับได้เลย'`, `costLine` `'ไม่มี'`; PRICED → `readyLine` `'คำขอเปลี่ยนเครื่องอนุมัติแล้ว มาทำสัญญาใหม่ที่สาขาได้เลย'`
  (e) CLOSED: REPAIR → `deviceLine` = deviceName, `warrantyLines` = `'ประกันร้าน ถึง <thai date>\nประกันศูนย์ ถึง <thai date>'` (ตัดบรรทัดที่ไม่มีค่า; ทั้งคู่ไม่มี = `'—'`); SAME_MODEL + newImei → `deviceLine` `'เครื่องใหม่ iPhone 13 128GB · IMEI 3568…'` + `warrantyLines` ขึ้นต้น `'ประกันนับใหม่จากวันส่งมอบ'`
  (f) PICKUP_REMINDER: `readyKind` `'ซ่อมเสร็จ'` (REPAIR) / `'พร้อมส่งมอบ'` (exchange), `readySince` = thai date ของ `readyAt`
  (g) ทุก moment: ไม่มี key ใดมีค่า `undefined`/`'undefined'`; `deviceName` = `'<brand> <model>'` + storage ถ้ามี; `symptom` ตัดที่ 120 ตัวอักษร + `'…'`
- [ ] **Step 2: เทสต์ migration** — `line-templates-migration.spec.ts` (แบบ `exchange-link-migration.spec.ts` ของ PR 2): อ่านไฟล์ SQL แล้ว assert มี `ON CONFLICT (event_type) DO NOTHING`, มี 5 `event_type` ครบ (`AFTER_SALES_RECEIVED`, `AFTER_SALES_READY`, `AFTER_SALES_CLOSED`, `AFTER_SALES_PICKUP_REMINDER`, `WARRANTY_EXPIRING_7D`), `channel_key = 'line-shop'` ทุกแถว, 4 แถวแรก `'TRANSACTIONAL'` + `is_active true`, แถว `WARRANTY_EXPIRING_7D` `'REMINDER'` + `is_active false`, ไม่มี `{{` และทุก `${var}` ในข้อความอยู่ในชุดตัวแปรที่ util ผลิต (regex `\$\{([^}]+)\}` เทียบกับ `Object.keys(buildLineData(fixture, moment, ''))`)
- [ ] **Step 3: รันให้แดง** — `cd apps/api && npx jest src/modules/after-sales/__tests__/line-copy.spec.ts src/modules/after-sales/__tests__/line-templates-migration.spec.ts`
- [ ] **Step 4: util** — `after-sales-line-copy.util.ts`:

```ts
import { formatThaiDateText } from '../../../utils/thai-date.util'; // อ่าน signature จริงก่อนใช้ (รับ string|Date)

export interface LineCaseRow {
  caseNumber: string;
  outcome: 'REPAIR' | 'SAME_MODEL_EXCHANGE' | 'PRICED_EXCHANGE' | 'CASH_SAME_MODEL_EXCHANGE' | null;
  symptom: string;
  deviceBrand: string | null; deviceModel: string | null; deviceStorage?: string | null; deviceImei: string | null;
  branch: { name: string };
  warrantySnapshot: { status: string; shopWarrantyEndDate: string | null; manufacturerWarrantyEndDate: string | null } | null;
  repairTicket: { payer: 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM'; estimatedCost: string | null; actualCost: string | null } | null;
  replacement?: { brand: string; model: string; storage: string | null; imeiSerial: string | null; shopWarrantyEndDate: string | null } | null;
  readyAt?: Date | null; // stageSince ของ READY_FOR_PICKUP — ใช้ในเตือน 7 วัน
}
const MOMENT_LABEL: Record<string, string> = {
  AFTER_SALES_RECEIVED: 'รับเรื่องแล้ว', AFTER_SALES_READY: 'มารับได้แล้ว',
  AFTER_SALES_CLOSED: 'ปิดเคส', AFTER_SALES_PICKUP_REMINDER: 'เตือนรับเครื่อง 7 วัน',
  WARRANTY_EXPIRING_7D: 'ประกันใกล้หมด',
};
export function lineEventTag(t: string) { return `[${t}]`; }
export function lineEventNote(t: string, status: 'SENT'|'NO_LINK'|'DISABLED'|'FAILED'|'BLOCKED', detail?: string) {
  const s = { SENT: 'ส่งแล้ว', NO_LINK: 'ไม่ได้ส่ง — ลูกค้ายังไม่ผูก LINE', DISABLED: 'ไม่ได้ส่ง — ปิดการส่ง LINE (after_sales_line_enabled)',
    FAILED: `ส่งไม่สำเร็จ${detail ? ` (${detail})` : ''}`, BLOCKED: `ไม่ได้ส่ง — ${detail ?? 'ถูกบล็อก'}` }[status];
  return `${lineEventTag(t)} ${MOMENT_LABEL[t] ?? t} · ${s}`;
}
export function buildLiffLine(liffId: string | null, label: string) {
  return liffId ? `${label}: https://liff.line.me/${liffId}/liff/warranty` : '';
}
const baht = (v: string | null) => v ? Number(v).toLocaleString('th-TH', { maximumFractionDigits: 0 }) : null;
export function buildLineData(row: LineCaseRow, moment: AfterSalesLineMoment, liffLine: string): Record<string, string> {
  const deviceName = [row.deviceBrand, row.deviceModel, row.deviceStorage].filter(Boolean).join(' ') || 'เครื่องของคุณ';
  const isExchange = row.outcome === 'SAME_MODEL_EXCHANGE' || row.outcome === 'PRICED_EXCHANGE' || row.outcome === 'CASH_SAME_MODEL_EXCHANGE';
  const payer = row.repairTicket?.payer ?? 'SHOP';
  const est = baht(row.repairTicket?.estimatedCost ?? null);
  const actual = baht(row.repairTicket?.actualCost ?? null);
  const w = row.warrantySnapshot?.status;
  const entitlementLine = row.outcome === 'SAME_MODEL_EXCHANGE' ? 'เปลี่ยนรุ่นเดิม รอผู้จัดการยืนยัน'
    : row.outcome === 'PRICED_EXCHANGE' ? 'เปลี่ยนแบบมีราคา รออนุมัติ'
    : payer === 'SUPPLIER_CLAIM' ? 'อยู่ในประกันศูนย์ ส่งเคลมศูนย์ ไม่มีค่าใช้จ่าย'
    : payer === 'CUSTOMER' ? `${w === 'OUT_OF_WARRANTY' || w === 'WALK_IN' ? 'หมดประกัน ' : ''}ค่าซ่อมประมาณ ${est ?? '—'} บาท ยืนยันราคาก่อนซ่อมทุกครั้ง`
    : 'อยู่ในประกันร้าน ไม่มีค่าใช้จ่าย';
  // … readyLine/costLine/deviceLine/warrantyLines/readyKind/readySince ตามเทสต์ (c)–(f)
  return { caseNumber: row.caseNumber, branchName: row.branch.name, deviceName, symptom: trim120(row.symptom),
    entitlementLine, nextLine, readyLine, costLine, deviceLine, warrantyLines, readyKind, readySince, liffLine };
}
```
(เขียนทุกกิ่งให้ครบตามเทสต์ — ค่าที่ไม่เกี่ยวกับ moment ยังต้องเป็น string ว่างไม่ใช่ undefined เพราะ `replacePlaceholders` ของ dispatcher ใส่ตัวแปรที่ไม่มีค่าเป็นข้อความดิบ)

- [ ] **Step 5: migration** — SQL 5 แถว (ข้อความจากกระดาน 6 แบบตัวอักษร; บรรทัดที่เป็นตัวแปรใช้ `${...}`):

```sql
-- After-sales hub PR 3 — แม่แบบ LINE ลูกค้า (ช่องร้าน) · แก้ข้อความที่ /notifications · migration ไม่ทับแถวเดิม
INSERT INTO notification_templates (id, event_type, name, category, channel_key, channel, format, message_template, sample_data, description, is_active, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'AFTER_SALES_RECEIVED', 'หลังการขาย 1 · รับเรื่องแล้ว', 'TRANSACTIONAL', 'line-shop', 'LINE', 'text',
   E'รับเครื่องของคุณไว้ที่สาขาแล้ว\nเคส ${caseNumber} · ${branchName}\n${deviceName}\nอาการที่แจ้ง: ${symptom}\n\nสิทธิ์: ${entitlementLine}\n${nextLine}\n${liffLine}',
   '{"caseNumber":"AS-20260907-0004","branchName":"สาขาลพบุรี","deviceName":"iPhone 13 128GB","symptom":"เปิดไม่ติด ชาร์จไม่เข้า","entitlementLine":"อยู่ในประกันร้าน ไม่มีค่าใช้จ่าย","nextLine":"ซ่อมเสร็จเมื่อไร ทางร้านจะแจ้งทาง LINE นี้ทันที","liffLine":"ดูสถานะเคส: https://liff.line.me/xxxx/liff/warranty"}'::jsonb,
   'ส่งทันทีที่เปิดเคสหลังการขาย (ลูกค้าที่ผูก LINE ฝั่งร้าน)', true, now(), now()),
  (gen_random_uuid(), 'AFTER_SALES_READY', 'หลังการขาย 2 · มารับได้แล้ว', 'TRANSACTIONAL', 'line-shop', 'LINE', 'text',
   E'${readyLine}\nเคส ${caseNumber}\n${deviceName}\n\nรับได้ที่ ${branchName} ทุกวัน 10:00–20:00\nค่าใช้จ่าย: ${costLine}\nนำบัตรประชาชนหรือใบรับฝากเครื่องมาด้วย\n${liffLine}',
   '{...}'::jsonb, 'ซ่อมเสร็จ / ผจก.ยืนยันเปลี่ยนเครื่อง / คำขออนุมัติแล้ว (เวลาเปิดสาขาแก้ในข้อความนี้)', true, now(), now()),
  (gen_random_uuid(), 'AFTER_SALES_CLOSED', 'หลังการขาย 3 · ปิดเคส', 'TRANSACTIONAL', 'line-shop', 'LINE', 'text',
   E'ส่งมอบเครื่องเรียบร้อย\nเคส ${caseNumber} ปิดแล้ว\n${deviceLine}\n\n${warrantyLines}\nมีปัญหาอีก ทักมาที่ LINE นี้ได้เลย ขอบคุณที่ไว้วางใจ BESTCHOICE\n${liffLine}',
   '{...}'::jsonb, 'ส่งเมื่อส่งมอบเครื่องคืน/เครื่องใหม่ หรือคำขอเปลี่ยนเครื่องลงผลแล้ว', true, now(), now()),
  (gen_random_uuid(), 'AFTER_SALES_PICKUP_REMINDER', 'หลังการขาย · เตือนรับเครื่องครบ 7 วัน', 'TRANSACTIONAL', 'line-shop', 'LINE', 'text',
   E'เครื่องของคุณ${readyKind}รอรับที่ ${branchName} ตั้งแต่ ${readySince}\nเคส ${caseNumber} · ${deviceName}\nรับได้ทุกวัน 10:00–20:00 นำบัตรประชาชนหรือใบรับฝากเครื่องมาด้วย\n${liffLine}',
   '{...}'::jsonb, 'cron 10:00 ส่ง 1 ครั้งเมื่อครบ 7 วันยังไม่มารับ', true, now(), now()),
  (gen_random_uuid(), 'WARRANTY_EXPIRING_7D', 'ประกันใกล้หมด 7 วัน', 'REMINDER', 'line-shop', 'LINE', 'text',
   E'ประกัน${warrantyType}ของ ${deviceName} จะหมดในอีก ${daysRemaining} วัน (${expireDate})\nถ้ามีอาการผิดปกติ นำเครื่องมาเช็คที่สาขาก่อนหมดประกันได้เลย\n${liffLine}',
   '{...}'::jsonb, 'ปิดไว้จนเจ้าของเคาะข้อความ — เปิดที่ /notifications (ผ่านด่านความยินยอม/เวลาทำการ)', false, now(), now())
ON CONFLICT (event_type) DO NOTHING;
```
(`sample_data` ทุกแถวกรอกครบทุกตัวแปรที่ข้อความใช้ — หน้า preview ของ `/notifications` ใช้ค่านี้; `${liffLine}` เมื่อว่างจะเป็นบรรทัดว่างท้ายข้อความ ยอมรับได้)

- [ ] **Step 6: รันให้เขียว + `prisma migrate deploy` บนฐานทดสอบทิ้ง** (`DATABASE_URL=postgresql://iamnaii@localhost:5432/after_sales_pr1_test?schema=public`) แล้ว `SELECT event_type,is_active FROM notification_templates WHERE event_type LIKE 'AFTER_SALES_%' OR event_type='WARRANTY_EXPIRING_7D'` = 5 แถว · Commit — `git commit -m "feat(after-sales): แม่แบบ LINE ลูกค้า 5 แบบ + ตัวประกอบข้อมูลข้อความ"`

---

### Task 2: `AfterSalesLineService` — ส่ง 1 จังหวะ + บันทึก event (ที่เดียวที่ส่ง LINE ของเคส)

**Files:**
- Create: `apps/api/src/modules/after-sales/services/after-sales-line.service.ts`
- Modify: `apps/api/src/modules/after-sales/after-sales.module.ts` (imports `NotificationsModule`, `IntegrationsModule`; providers + exports `AfterSalesLineService`)
- Test: `apps/api/src/modules/after-sales/__tests__/line-service.spec.ts`

**Interfaces:**
- Consumes: `NotificationsService.sendFromTemplate(eventType, data, recipient, { customerId, relatedId }) → { id: string|null; status: string; blockReason?: string }` (throw `InternalServerErrorException` เมื่อไม่มีแม่แบบ) · `IntegrationConfigService.getValue('line-shop','liffId')` · `readBoolFlag(prisma,'after_sales_line_enabled', true)` · util จาก Task 1
- Produces: `notifyMoment(caseId: string, moment: AfterSalesLineMoment, actorId: string | null): Promise<{ status: 'SENT'|'NO_LINK'|'DISABLED'|'FAILED'|'BLOCKED'|'SKIPPED_DUP' }>` — **ไม่ throw ทุกกรณี** · `hasLineEvent(caseId, eventType): Promise<boolean>` (probe `AfterSalesEvent.note startsWith tag`) ให้ cron ใช้ dedup

- [ ] **Step 1: เทสต์** (jest, mock prisma/notifications/integrationConfig):
  (a) เคสมี `customer.lineIdShop` → `sendFromTemplate('AFTER_SALES_RECEIVED', data, 'U…', { customerId, relatedId: caseId })` ถูกเรียก, `afterSalesEvent.create({ caseId, kind:'LINE_SENT', actorId, note:'[AFTER_SALES_RECEIVED] รับเรื่องแล้ว · ส่งแล้ว' })`, คืน `{status:'SENT'}`
  (b) ไม่มี `lineIdShop` → ไม่เรียก send, event `LINE_SKIPPED_NO_LINK` note NO_LINK
  (c) `sendFromTemplate` reject (Error 'LINE 429') → event `NOTE` note FAILED ('LINE 429'), `Sentry.captureException` tags `{subsystem:'after-sales-line'}`, คืน FAILED, **ไม่ throw**
  (d) `sendFromTemplate` คืน `{status:'BLOCKED', blockReason:'TEMPLATE_INACTIVE'}` → event `NOTE` BLOCKED ('TEMPLATE_INACTIVE'), ไม่ Sentry
  (e) PII: `data` ที่ส่งเข้า template และ `note` ทุกแถว **ไม่มี** ค่า `lineIdShop`; log ที่ logger ถูกเรียกไม่มีค่านั้น (spy `Logger.prototype.log/warn`)
  (f) kill switch off (`systemConfig.findFirst` → `{value:'false'}`) → ไม่ส่ง, event `NOTE` DISABLED
  (g) `liffId` ไม่มี → `data.liffLine === ''` ; มี → ขึ้นต้น `'ดูสถานะเคส: https://liff.line.me/'` (moment CLOSED ใช้ label `'ประกันของฉัน'`)
  (h) `hasLineEvent(caseId,'AFTER_SALES_PICKUP_REMINDER')` → `afterSalesEvent.findFirst({ where:{ caseId, kind:'LINE_SENT', note:{ startsWith:'[AFTER_SALES_PICKUP_REMINDER]' } } })` truthy → true
  (i) เคสไม่พบ → คืน `{status:'FAILED'}` + Sentry, ไม่ throw
- [ ] **Step 2: รันให้แดง** — `npx jest src/modules/after-sales/__tests__/line-service.spec.ts`
- [ ] **Step 3: service**

```ts
@Injectable()
export class AfterSalesLineService {
  private readonly logger = new Logger(AfterSalesLineService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly integrationConfig: IntegrationConfigService,
  ) {}

  async hasLineEvent(caseId: string, eventType: string): Promise<boolean> {
    const hit = await this.prisma.afterSalesEvent.findFirst({
      where: { caseId, kind: 'LINE_SENT', note: { startsWith: lineEventTag(eventType) } }, select: { id: true },
    });
    return !!hit;
  }

  /** ห้าม throw — ผู้เรียกใช้ `void` หลัง commit */
  async notifyMoment(caseId: string, moment: AfterSalesLineMoment, actorId: string | null) {
    const eventType = AFTER_SALES_LINE_EVENT_TYPE[moment];
    try {
      const c = await this.prisma.afterSalesCase.findFirst({
        where: { id: caseId, deletedAt: null },
        select: { id: true, caseNumber: true, outcome: true, symptom: true, deviceBrand: true, deviceModel: true, deviceImei: true,
          warrantySnapshot: true, replacementProductId: true, replacementContractId: true, approvedAt: true,
          customer: { select: { id: true, lineIdShop: true } }, branch: { select: { name: true } },
          repairTicket: { select: { payer: true, estimatedCost: true, actualCost: true, repairedAt: true } } },
      });
      if (!c) { Sentry.captureMessage('after-sales line: case not found', { level: 'warning', tags: { subsystem: 'after-sales-line' }, extra: { caseId, moment } }); return { status: 'FAILED' as const }; }
      const enabled = await readBoolFlag(this.prisma, 'after_sales_line_enabled', true);
      if (!enabled) return this.record(caseId, 'NOTE', lineEventNote(eventType, 'DISABLED'), actorId, 'DISABLED');
      const to = c.customer.lineIdShop; // PII — อยู่ในเมธอดนี้เท่านั้น
      if (!to) return this.record(caseId, 'LINE_SKIPPED_NO_LINK', lineEventNote(eventType, 'NO_LINK'), actorId, 'NO_LINK');
      const replacement = await this.loadReplacement(c); // product ทดแทน + shopWarrantyEndDate ของสัญญาใหม่ (ถ้ามี)
      const liffId = await this.integrationConfig.getValue('line-shop', 'liffId').catch(() => null);
      const liffLine = buildLiffLine(liffId ?? null, moment === 'CLOSED' ? 'ประกันของฉัน' : 'ดูสถานะเคส');
      const data = buildLineData(toLineCaseRow(c, replacement), moment, liffLine);
      const res = await this.notifications.sendFromTemplate(eventType, data, to, { customerId: c.customer.id, relatedId: caseId });
      if (res.status === 'SENT' || res.status === 'PENDING' || res.status === 'RETRY_PENDING' || res.status === 'DELAYED')
        return this.record(caseId, 'LINE_SENT', lineEventNote(eventType, 'SENT'), actorId, 'SENT');
      return this.record(caseId, 'NOTE', lineEventNote(eventType, 'BLOCKED', res.blockReason ?? res.status), actorId, 'BLOCKED');
    } catch (err) {
      Sentry.captureException(err, { tags: { subsystem: 'after-sales-line', moment } });
      this.logger.warn(`LINE ${eventType} ของเคส ${caseId} ส่งไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
      await this.record(caseId, 'NOTE', lineEventNote(eventType, 'FAILED', err instanceof Error ? err.message.slice(0, 80) : undefined), actorId, 'FAILED').catch(() => undefined);
      return { status: 'FAILED' as const };
    }
  }
  private async record(caseId, kind: 'LINE_SENT'|'LINE_SKIPPED_NO_LINK'|'NOTE', note: string, actorId, status) {
    await this.prisma.afterSalesEvent.create({ data: { caseId, kind, note, actorId } });
    return { status };
  }
}
```
(`DELAYED` = compliance เลื่อนส่งนอกเวลาทำการ — ไม่เกิดกับ TRANSACTIONAL แต่รองรับไว้ · `loadReplacement`: `replacementProductId` → `product.findFirst({ where:{id, deletedAt:null}, select:{brand,model,storage,imeiSerial} })`, `replacementContractId` → `contract.findFirst({ select:{ shopWarrantyEndDate } })`)

- [ ] **Step 4: module** — `after-sales.module.ts` imports เพิ่ม `NotificationsModule` (`../notifications/notifications.module`) และ `IntegrationsModule` (`../integrations/integrations.module` — ตรวจชื่อจริงจาก `apps/api/src/modules/sales/sales.module.ts`); providers/exports เพิ่ม `AfterSalesLineService` · `npx tsc --noEmit` + boot check `npx nest build`
- [ ] **Step 5: รันให้เขียว + Commit** — `git commit -m "feat(after-sales): AfterSalesLineService ส่ง LINE ลูกค้าต่อจังหวะ + บันทึก event (ไม่ throw)"`

---

### Task 3: ต่อ 3 จังหวะเข้าจุดที่มีอยู่ + `lineLinked` ใน lookup + integration บน DB จริง

**Files:**
- Modify: `services/after-sales-case.service.ts` (จังหวะ 1) · `services/after-sales-repair.service.ts` (จังหวะ 2/3) · `services/after-sales-exchange.service.ts` (จังหวะ 2/3) · `services/after-sales-lookup.service.ts` + `LookupResult` (`lineLinked: boolean`)
- Test: `__tests__/case-create.spec.ts`, `__tests__/repair-proxy.spec.ts`, `__tests__/exchange-service.spec.ts` (เพิ่ม assertion), `__tests__/lookup.spec.ts` (ถ้ามี — ไม่งั้นเพิ่มใน spec lookup ที่มีอยู่), `__tests__/after-sales-flow.integration.spec.ts` (describe ใหม่), `__tests__/after-sales-exchange.integration.spec.ts` (เคส 12)

**Interfaces:**
- Consumes: `AfterSalesLineService.notifyMoment` (Task 2) · `lookupByImei` ของ repair-tickets คืน customer (ต้องอ่าน `lineIdShop` ใน service แล้วแปลงเป็น boolean เท่านั้น)
- Produces: `LookupResult.lineLinked: boolean` (false เมื่อไม่พบลูกค้า) · จุดเรียก: `createCase` → `void this.line.notifyMoment(result.id,'RECEIVED',user.id)` หลัง `audit.log` (ทุก outcome; PRICED เรียกหลัง link/compensation สำเร็จเท่านั้น — เคสที่ถูก CANCELLED เพราะ submit ล้ม **ไม่ส่ง**) · `AfterSalesRepairService.markRepaired` → หลัง `sync(...'REPAIR_DONE')` `void notifyMoment(caseId,'READY',user.id)` · `returnToCustomer` → หลัง `sync(...'CLOSED')` `void notifyMoment(caseId,'CLOSED',user.id)` · `AfterSalesExchangeService.confirmSameModel` → หลัง update READY_FOR_PICKUP `void notifyMoment(caseId,'READY',user.id)` · `deliver` → หลัง CLOSED `void notifyMoment(caseId,'CLOSED',user.id)` · `approvePriced` → `res.mode==='MEMO'` → `'CLOSED'`, `'PRICED'` → `'READY'`

- [ ] **Step 1: เทสต์ unit** — ทุก spec ที่ `new` service เพิ่ม `line = { notifyMoment: jest.fn().mockResolvedValue({status:'SENT'}) }` เป็น dependency ใหม่ (constructor พารามิเตอร์ท้ายสุดของ `AfterSalesCaseService`, `AfterSalesRepairService`, `AfterSalesExchangeService`) และ assert: (a) createCase REPAIR → `notifyMoment(id,'RECEIVED','u-1')` ถูกเรียก **หลัง** `audit.log` (ลำดับ invocation) (b) createCase PRICED ที่ submit ล้ม → ไม่เรียก (c) markRepaired → `READY`; returnToCustomer → `CLOSED` (d) confirmSameModel → `READY`; deliver → `CLOSED`; approvePriced MEMO → `CLOSED`, PRICED → `READY` (e) `notifyMoment` reject → เมธอดหลักยัง resolve (fire-and-forget: ใช้ `void` + `.catch(() => undefined)` ภายใน service เอง ดังนั้น reject ไม่ propagate — เทสต์ด้วย `mockRejectedValue` แล้ว `await expect(svc.markRepaired(...)).resolves`)
- [ ] **Step 2: เทสต์ lookup** — `lookup({imei})` ลูกค้ามี `lineIdShop` → `lineLinked:true`; ไม่มี → false; ไม่พบเครื่อง → false; **`lineIdShop` ไม่อยู่ใน `LookupResult`** (`expect(res).not.toHaveProperty('customer.lineIdShop')`)
- [ ] **Step 3: เทสต์ integration** (vitest, ฐานทดสอบทิ้ง; `NotificationsService` ปลอม `{ sendFromTemplate: vi.fn().mockResolvedValue({ id:'n1', status:'SENT' }) }`, `integrationConfig` ปลอม `{ getValue: async () => 'liff-test' }`; `AfterSalesLineService` **ของจริง**):
  (ก) ลูกค้าตั้ง `lineIdShop = 'Utest…'` → `createCase` REPAIR → รอ `notifyMoment` (ให้ spec เรียก `await line.notifyMoment(id,'RECEIVED',uid)` ตรง ๆ หลังจากนั้น เพื่อไม่แข่งกับ fire-and-forget) → `after_sales_events` มี `LINE_SENT` note `[AFTER_SALES_RECEIVED]…` · `sendFromTemplate` ถูกเรียกด้วย `data.caseNumber`, `data.branchName`, `data.liffLine` ขึ้นต้น `ดูสถานะเคส: https://liff.line.me/liff-test/`
  (ข) ลูกค้าไม่มี `lineIdShop` → `LINE_SKIPPED_NO_LINK` และ `sendFromTemplate` ไม่ถูกเรียก · `getCase().lineLinked === false` และ timeline มีแถว kind `LINE_SKIPPED_NO_LINK`
  (ค) markRepaired (ซ่อมที่ร้าน ผู้จ่ายลูกค้า 500) → `READY` data `costLine === 'ค่าซ่อม 500 บาท ชำระที่สาขา'` · returnToCustomer → `CLOSED` data `warrantyLines` มี `'ประกันร้าน ถึง'`
  (ง) exchange spec เคส 12: confirmSameModel → `READY` data `readyLine === 'เปลี่ยนเครื่องใหม่ให้แล้ว มารับได้เลย'`
  cleanup: ลบ `after_sales_events` ของเคสก่อนเคส (มีอยู่แล้วในลำดับ)
- [ ] **Step 4: รันให้แดง** — `npx jest src/modules/after-sales` + integration ทั้ง 2 ไฟล์ (`DATABASE_URL=… npx vitest run --no-file-parallelism …`)
- [ ] **Step 5: implement** — ตามจุดเรียกใน Interfaces; ทุกจุดเป็น

```ts
// หลัง commit + audit — fire-and-forget: LINE ล้มต้องไม่ทำให้การบันทึกล้ม (Global Constraints)
void this.line.notifyMoment(caseId, 'READY', user.id);
```
`AfterSalesLookupService.lookup`: หลังได้ `r.customer` ใส่ `lineLinked: !!r.customer?.lineIdShop` และ **ไม่ใส่** `lineIdShop` ใน `customer` ที่คืน (ตรวจ select ของ `lookupByImei` ว่าคืน `lineIdShop` — ถ้าไม่ ให้เพิ่ม `select` เฉพาะใน service นี้แล้วตัดออกก่อนคืน)
- [ ] **Step 6: รันให้เขียว + Commit** — `git commit -m "feat(after-sales): ส่ง LINE ลูกค้า 3 จังหวะจากจุดเปิดเคส/ซ่อมเสร็จ/ส่งมอบ/ยืนยันเปลี่ยน/อนุมัติ + lineLinked ใน lookup"`

---

### Task 4: cron `after-sales-line.cron.ts` — เตือนรับเครื่องครบ 7 วัน + จังหวะ 3 ของเคสมีราคาที่ปิดจากการเปิดใช้สัญญา

**Files:**
- Create: `apps/api/src/modules/after-sales/crons/after-sales-line.cron.ts` · Test: `apps/api/src/modules/after-sales/crons/after-sales-line.cron.spec.ts` (jest unit, mock prisma + line)
- Modify: `after-sales.module.ts` (provider `AfterSalesLineCron`)

**Interfaces:**
- Consumes: `AfterSalesLineService.notifyMoment` / `hasLineEvent` · `stageSince(stage, ticket, receivedAt, approvedAt)` + `reconcileStage` จาก PR 1/2 · `readBoolFlag` · `readIntFlag(prisma,'after_sales_pickup_reminder_days', 7, 1, 60)`
- Produces: `AfterSalesLineCron.tick(now = new Date()): Promise<{ reminded: number; closedNotified: number; skipped: number; failed: number }>` (เรียกจาก `@Cron('0 10 * * *', { timeZone: 'Asia/Bangkok' }) run()`)

- [ ] **Step 1: เทสต์**
  (a) เคส READY_FOR_PICKUP ที่ `stageSince` ≥ 7 วัน (REPAIR: `repairTicket.repairedAt` = now−8d; SAME_MODEL: `approvedAt` = now−8d) และ `hasLineEvent(id,'AFTER_SALES_PICKUP_REMINDER')` = false → `notifyMoment(id,'PICKUP_REMINDER', null)` ถูกเรียก 1 ครั้ง; เคสที่ 6 วัน → ไม่เรียก; เคสที่ `hasLineEvent` = true → ไม่เรียก (ครั้งเดียวต่อเคส)
  (b) เคส stored stage READY_FOR_PICKUP แต่ reconcile แล้วเป็น CLOSED (ใบซ่อมถูกปิดนอก proxy) → ไม่เตือน (ใช้ `reconcileStage` ก่อนตัดสิน เหมือน list/summary)
  (c) เคส `outcome: PRICED_EXCHANGE`, stage CLOSED, `closedAt` ใน 3 วัน, ไม่มี `[AFTER_SALES_CLOSED]` → `notifyMoment(id,'CLOSED',null)`; มีแล้ว → ไม่ส่ง; `closedAt` เกิน 3 วัน → ไม่ส่ง (กันย้อนส่งของเก่าหลัง deploy)
  (d) `after_sales_line_enabled=false` → tick คืน `{reminded:0, closedNotified:0, skipped:N, failed:0}` ไม่เรียก notifyMoment
  (e) `notifyMoment` โยน → นับ `failed` และเคสถัดไปยังถูกประมวลผล (per-row try/catch); prisma โยนใน findMany → outer catch, `Sentry.captureException` tags `{subsystem:'after-sales-line', cron:'after-sales-line'}`, คืน zeroed result, **ไม่ throw**
- [ ] **Step 2: รันให้แดง** — `npx jest src/modules/after-sales/crons`
- [ ] **Step 3: cron**

```ts
@Injectable()
export class AfterSalesLineCron {
  private readonly logger = new Logger(AfterSalesLineCron.name);
  constructor(private readonly prisma: PrismaService, private readonly line: AfterSalesLineService) {}

  @Cron('0 10 * * *', { timeZone: 'Asia/Bangkok' })
  async run() { await this.tick(); }

  async tick(now = new Date()) {
    const out = { reminded: 0, closedNotified: 0, skipped: 0, failed: 0 };
    try {
      if (!(await readBoolFlag(this.prisma, 'after_sales_line_enabled', true))) { out.skipped = -1; return out; }
      const days = await readIntFlag(this.prisma, 'after_sales_pickup_reminder_days', 7, 1, 60);
      // (1) เตือนรับเครื่อง — ผู้สมัคร: stored stage READY_FOR_PICKUP; reconcile ก่อนตัดสิน
      const ready = await this.prisma.afterSalesCase.findMany({ where: { deletedAt: null, stage: 'READY_FOR_PICKUP' }, select: READY_SELECT /* ROW_SELECT-like + approvedAt + receivedAt */ });
      for (const row of ready) {
        try {
          const r = await reconcileStage(this.prisma, row);
          if (r.stage !== 'READY_FOR_PICKUP') { out.skipped++; continue; }
          const since = stageSince('READY_FOR_PICKUP', row.repairTicket, row.receivedAt, row.approvedAt);
          if (now.getTime() - since.getTime() < days * 86_400_000) { out.skipped++; continue; }
          if (await this.line.hasLineEvent(row.id, AFTER_SALES_LINE_EVENT_TYPE.PICKUP_REMINDER)) { out.skipped++; continue; }
          const res = await this.line.notifyMoment(row.id, 'PICKUP_REMINDER', null);
          res.status === 'SENT' ? out.reminded++ : out.skipped++;
        } catch (e) { out.failed++; Sentry.captureException(e, { tags: { subsystem: 'after-sales-line', cron: 'after-sales-line', step: 'reminder' }, extra: { caseId: row.id } }); }
      }
      // (2) จังหวะ 3 ของเคสมีราคาที่ engine ปิดให้ (เปิดใช้สัญญาใหม่ → reconcile เป็น CLOSED โดยไม่มี hook)
      const closed = await this.prisma.afterSalesCase.findMany({ where: { deletedAt: null, outcome: 'PRICED_EXCHANGE', stage: 'CLOSED', cancelledAt: null, closedAt: { gte: new Date(now.getTime() - 3 * 86_400_000) } }, select: { id: true } });
      for (const c of closed) { /* hasLineEvent(id, AFTER_SALES_CLOSED) → skip; else notifyMoment(id,'CLOSED',null) → closedNotified++ ; per-row try/catch เหมือน (1) */ }
      this.logger.log(`after-sales line cron: ${JSON.stringify(out)}`);
      return out;
    } catch (err) {
      Sentry.captureException(err, { tags: { subsystem: 'after-sales-line', cron: 'after-sales-line', scope: 'tick' } });
      this.logger.error('after-sales line cron failed', err instanceof Error ? err.stack : String(err));
      return out;
    }
  }
}
```
(เคสมีราคาที่ปิดด้วย MEMO ได้ LINE จาก `approvePriced` แล้ว — probe `hasLineEvent` กันซ้ำให้เอง)
- [ ] **Step 4: รันให้เขียว + Commit** — `git commit -m "feat(after-sales): cron 10:00 เตือนรับเครื่องครบ 7 วัน + LINE ปิดเคสของคำขอมีราคาที่เปิดใช้สัญญาแล้ว"`

---

### Task 5: `warranty.cron.ts` ส่ง LINE "ประกันใกล้หมด 7 วัน" จริง (รวมลูกค้าขายสด) — แม่แบบปิดจนเจ้าของเคาะ

**Files:**
- Create: `apps/api/src/modules/warranty/warranty-line-notifier.service.ts` · Test: `apps/api/src/modules/warranty/warranty-line-notifier.service.spec.ts`, `apps/api/src/modules/warranty/warranty.cron.spec.ts` (ไฟล์เทสต์แรกของ cron นี้)
- Modify: `apps/api/src/modules/warranty/warranty.cron.ts` · `warranty.service.ts` (`getExpiringWarranties`) · `warranty.module.ts` (imports `NotificationsModule`, `IntegrationsModule`; provider ใหม่) · `warranty.service.spec.ts` (เพิ่มเคส Sale)

**Interfaces:**
- Consumes: `NotificationsService.sendFromTemplate('WARRANTY_EXPIRING_7D', data, to, { customerId, relatedId })` (แม่แบบ `REMINDER` ปิดอยู่ → คืน `{status:'BLOCKED', blockReason:'TEMPLATE_INACTIVE'}` ไม่ throw) · `IntegrationConfigService.getValue('line-shop','liffId')`
- Produces: `WarrantyService.getExpiringWarranties(daysAhead)` คืนเพิ่มฟิลด์ `source: 'CONTRACT'|'SALE'`, `sourceId`, `customerId`, `deviceName` และรวมแถวจาก `Sale` (`contractId: null`, `deletedAt: null`, `shopWarrantyEndDate` ในช่วง) · `WarrantyLineNotifierService.notifyExpiring(item): Promise<'SENT'|'NO_LINK'|'DUP'|'BLOCKED'|'FAILED'>` — dedup ด้วย `NotificationLog` probe `{ relatedId: `warranty:${source}:${sourceId}:${type}`, subject: 'WARRANTY_EXPIRING_7D', status: { in: ['SENT','PENDING','RETRY_PENDING','DELAYED'] } }` (ส่ง 1 ครั้งต่อเครื่อง/ชนิดประกัน) · ผู้รับ `customer.lineIdShop`

- [ ] **Step 1: เทสต์**
  (a) `getExpiringWarranties(7)`: มี Sale ขายสด `shopWarrantyEndDate` = now+3d (customer มี lineIdShop) → อยู่ในผล `source:'SALE'`; Contract เดิมยังอยู่ `source:'CONTRACT'`; Sale ที่ `contractId` ไม่ null ไม่ซ้ำ
  (b) notifier: มี `lineIdShop` + ยังไม่เคยส่ง → `sendFromTemplate` ถูกเรียกด้วย `data = { warrantyType:'ร้าน'|'ศูนย์', deviceName, daysRemaining:'3', expireDate:<thai>, liffLine }`, `relatedId` ตามสูตร; เคยส่ง (probe เจอ) → `'DUP'` ไม่ส่ง; ไม่มี lineIdShop → `'NO_LINK'`; แม่แบบปิด (`BLOCKED`) → `'BLOCKED'` ไม่ Sentry; send throw → `'FAILED'` + Sentry, ไม่ throw
  (c) cron: `checkExpiringWarranties()` เรียก notifier ต่อ item, นับผล, log สรุป, item ที่ throw ไม่หยุด loop; `PrismaService` ที่ไม่ได้ใช้ถูกถอดจาก constructor
- [ ] **Step 2: รันให้แดง** — `npx jest src/modules/warranty`
- [ ] **Step 3: implement** — `getExpiringWarranties`: เพิ่ม `sale.findMany({ where: { deletedAt: null, contractId: null, shopWarrantyEndDate: { gte: now, lte: targetDate } }, include: { product: { select:{ brand, model, storage } }, customer: { select:{ id, name, lineIdShop } } } })` (ตรวจชื่อคอลัมน์จริงบน `Sale`; `LiffWarrantyService.getMyWarranties` อ่านฟิลด์เดียวกัน — ใช้เป็นแบบ) · notifier ตามสัญญา (ไม่ต้องมี `AfterSalesEvent` — ไม่มีเคส) · cron:

```ts
@Cron('0 9 * * *', { timeZone: 'Asia/Bangkok' })
async checkExpiringWarranties(): Promise<void> {
  try {
    const expiring = await this.warrantyService.getExpiringWarranties(7);
    const tally = { SENT: 0, NO_LINK: 0, DUP: 0, BLOCKED: 0, FAILED: 0 };
    for (const item of expiring) { try { tally[await this.notifier.notifyExpiring(item)]++; } catch (e) { tally.FAILED++; Sentry.captureException(e, { tags: { kind: 'cron-job', cron: 'warranty-check', step: 'notify' } }); } }
    this.logger.log(`Expiring warranties ${expiring.length}: ${JSON.stringify(tally)}`);
  } catch (error) { this.logger.error('Warranty check failed', error); Sentry.captureException(error, { tags: { kind: 'cron-job', cron: 'warranty-check' } }); }
}
```
- [ ] **Step 4: รันให้เขียว + Commit** — `git commit -m "feat(warranty): cron ประกันใกล้หมด 7 วันส่ง LINE จริง (รวมขายสด) — แม่แบบปิดจนเจ้าของเคาะ"`

---

### Task 6: LIFF API `GET /line-oa/liff/my-after-sales-cases`

**Files:**
- Create: `apps/api/src/modules/line-oa/liff-after-sales.service.ts` · Test: `apps/api/src/modules/line-oa/liff-after-sales.service.spec.ts`
- Modify: `apps/api/src/modules/line-oa/liff-warranty.controller.ts` (route ใหม่ใต้ guard เดิม) · `line-oa.module.ts` (provider)

**Interfaces:**
- Consumes: `LiffTokenGuard` + `req.liffUserId` (แบบ `getMyWarranties`) · `reconcileStage`, `stageSince` จาก after-sales utils (import ตรงจาก `../after-sales/utils/...` และ `../after-sales/services/after-sales-stage-reconcile` — **ไม่ import module** กัน circular)
- Produces:

```ts
export interface LiffAfterSalesCase {
  caseNumber: string; outcome: 'REPAIR'|'SAME_MODEL_EXCHANGE'|'PRICED_EXCHANGE'|'CASH_SAME_MODEL_EXCHANGE'|null;
  stageLabel: string;                       // ป้ายมุมขวา: 'รับเรื่องแล้ว'|'กำลังซ่อม'|'รอผู้จัดการยืนยัน'|'รออนุมัติ'|'รอรับเครื่อง'|'ปิดเคส'|'ยกเลิก'
  deviceName: string; branchName: string;
  steps: { title: string; state: 'done'|'now'|'idle'; hint: string | null }[]; // 4 ขั้นตามทางออก (ข้อความลูกค้า)
  updatedAt: string; costLine: string;      // 'ไม่มี (ในประกันร้าน)' / 'ค่าซ่อม 1,500 บาท ชำระที่สาขา' / 'ค่าซ่อมประมาณ …'
}
export interface LiffAfterSalesResponse { linked: boolean; cases: LiffAfterSalesCase[] } // เคสเปิด + ปิดใน 14 วัน, ใหม่สุดก่อน, ไม่มี id/IMEI เต็ม/ชื่อพนักงาน
```
ขั้นของลูกค้า (ต่างจากหน้าพนักงาน): REPAIR `['รับเรื่องแล้ว','กำลังซ่อม','รอรับเครื่อง','ปิดเคส']` · SAME_MODEL/CASH `['รับเรื่องแล้ว','รอผู้จัดการยืนยัน','รอรับเครื่องใหม่','ปิดเคส']` · PRICED `['รับเรื่องแล้ว','รออนุมัติ','ทำสัญญาใหม่','ปิดเคส']` · `hint` ของขั้น now = วันที่ไทยของ `stageSince` (เช่น `'ส่งศูนย์ 8 ก.ย.'` เมื่อ IN_REPAIR มี `sentToRepairAt`)

- [ ] **Step 1: เทสต์** (mock prisma): (a) ไม่พบลูกค้าจาก `lineIdShop` → `{linked:false, cases:[]}` (b) ลูกค้ามี 2 เคส (REPAIR IN_REPAIR วันนี้ · SAME_MODEL CLOSED 20 วันก่อน) → คืน 1 เคส, `steps[1].state==='now'`, `stageLabel==='กำลังซ่อม'`, `costLine` ตามผู้จ่าย (c) response ไม่มีคีย์ `id`, `deviceImei`, `receivedBy`, `lineIdShop` (d) เคสที่ stored stage ค้าง (ใบซ่อม CLOSED นอก proxy) → reconcile แล้วโชว์ 'ปิดเคส'
- [ ] **Step 2: รันให้แดง** → **Step 3: implement** — service: `customer.findFirst({ where:{ lineIdShop, deletedAt:null }, select:{ id:true } })` → `afterSalesCase.findMany({ where:{ customerId, deletedAt:null, OR:[{ stage:{ notIn:['CLOSED','CANCELLED'] } }, { closedAt:{ gte: now-14d } }] }, select: ROW-like + repairTicket{status,payer,estimatedCost,actualCost,sentToRepairAt,repairedAt,returnedToCustomerAt,deletedAt} + exchangeRequest{…} , orderBy:{ receivedAt:'desc' }, take: 10 })` → reconcile → map · controller:

```ts
@Get('liff/my-after-sales-cases')
@Throttle({ short: { ttl: 60000, limit: 20 } })
async getMyAfterSalesCases(@Req() req: Request): Promise<LiffAfterSalesResponse> {
  return this.afterSales.getMyCases((req as LiffRequest).liffUserId);
}
```
(ไม่ใส่ `@LiffChannel(SHOP)` ด้วยเหตุผลเดียวกับ `my-warranties` — เขียนคอมเมนต์อ้างอิงไว้)
- [ ] **Step 4: เขียว + `nest build` + Commit** — `git commit -m "feat(line-oa): LIFF endpoint เคสหลังการขายของฉัน (อ่านจาก lineIdShop)"`

---

### Task 7: เว็บ LIFF — ส่วน "เคสของฉัน" ใน `/liff/warranty`

**Files:**
- Create: `apps/web/src/pages/liff/components/MyAfterSalesCases.tsx` · Test: `apps/web/src/pages/liff/components/MyAfterSalesCases.test.tsx`
- Modify: `apps/web/src/pages/liff/LiffWarranty.tsx`

**Interfaces:**
- Consumes: `liffApi.get('/line-oa/liff/my-after-sales-cases')` → `LiffAfterSalesResponse` (Task 6) · `useLiffInit` (`lineId`)
- Produces: `MyAfterSalesCases({ lineId }: { lineId: string })` — การ์ดต่อเคสตามกระดาน 6: หัว `caseNumber` + `stageLabel` (ชิปสี warning สำหรับกำลังซ่อม/รอ, primary สำหรับรอรับ, muted ปิด/ยกเลิก — มีข้อความเสมอ) · บรรทัด `deviceName · branchName` · `<ol aria-label="ขั้นตอน">` 4 ขั้น (done = ไอคอน check, now = เลขในวงเหลือง, idle = เลขเทา) · บรรทัด `อัปเดตล่าสุด <thaiDateTime> · ค่าใช้จ่าย: <costLine>` · ว่าง = ไม่ render ส่วนนี้เลย (ไม่มีข้อความ "ไม่มีเคส" — หน้าประกันยังเป็นหลัก) · loading skeleton สั้น ๆ · error = ซ่อนเงียบ (`liffApi` 401 จัดการเองอยู่แล้ว)

- [ ] **Step 1: เทสต์** — (a) mock 1 เคส REPAIR now=1 → มีหัว "เคสของฉัน", เลขเคส, ชิป "กำลังซ่อม", `ol[aria-label="ขั้นตอน"]` 4 `li`, ขั้นที่ 2 มีข้อความ "กำลังซ่อม" และ `aria-current="step"` (b) `cases: []` → ไม่มีหัว "เคสของฉัน" ใน DOM (c) ข้อความไม่มี "รับเครื่อง" ยกเว้น "รอรับเครื่อง" (กระดาน 6 อนุญาต) — assert เฉพาะว่าไม่มี "ใบรับเครื่อง"/"รับเครื่องคืน"
- [ ] **Step 2: รันให้แดง** → **Step 3: implement** — วางส่วนนี้ **เหนือ** `<h1>ประกันของฉัน</h1>` ใน `LiffWarranty.tsx` เฉพาะเมื่อ `data?.linked` (ส่งต่อ `lineId`); โทเคนตาม frontend.md (`text-warning-strong` บนชิปเหลือง, `bg-primary/10 text-primary` รอรับ) · `leading-snug`
- [ ] **Step 4: เขียว (`npx vitest run src/pages/liff`) + tsc + Commit** — `git commit -m "feat(web/liff): ส่วน 'เคสของฉัน' ในหน้าประกันของฉัน"`

---

### Task 8: เว็บพนักงาน — การ์ด "LINE ลูกค้า" ของจริง · label timeline · บรรทัด "จะส่ง LINE" ในสรุปก่อนบันทึก

**Files:**
- Modify: `apps/web/src/pages/AfterSalesCasePage.tsx` (การ์ด LINE ที่ตอนนี้เขียนว่า "พร้อมส่ง (เปิดใช้รอบถัดไป)") · `apps/web/src/pages/after-sales/CaseTimeline.tsx` (`KIND_LABEL` + `labelOf`) · `apps/web/src/pages/after-sales/after-sales.ts` (`LookupResult.lineLinked`, `CaseDetail.lineEvents`) · `apps/web/src/pages/AfterSalesNewPage.tsx` (สรุปก่อนบันทึก) · API `after-sales-query.service.ts` `getCase` เพิ่ม `lineEvents`
- Test: `AfterSalesCasePage.test.tsx`, `AfterSalesNewPage.test.tsx`, `after-sales.test.ts`, API `query.spec.ts`

**Interfaces:**
- Produces (API `getCase`): `lineEvents: { at: string; kind: 'LINE_SENT'|'LINE_SKIPPED_NO_LINK'|'NOTE'; note: string }[]` = event ที่ note ขึ้นต้น `[AFTER_SALES_` (เรียงใหม่สุดก่อน, สูงสุด 5) — ใช้ `lineEventTag` จาก util เดียวกัน
- Produces (web): การ์ด "LINE ลูกค้า": `lineLinked` false → ชิปเดิม "ยังไม่ผูก LINE — โทรแจ้ง"; true และ `lineEvents` ว่าง → "ผูก LINE แล้ว — ยังไม่มีข้อความส่ง"; มี → รายการ ≤3 บรรทัด `<ป้ายจังหวะ> · <ส่งแล้ว/ไม่สำเร็จ> · <เวลาไทย>` (ตัด tag `[…]` ออกตอนแสดง) · timeline: `LINE_SENT`→"ส่ง LINE", `LINE_SKIPPED_NO_LINK`→"ไม่ได้ส่ง LINE (ไม่ผูก)", `NOTE` ที่ note ขึ้นต้น `[AFTER_SALES_`→"LINE" (ลบ `labelOf` กิ่ง `startsWith('LINE_')` เดิมที่คืน 'LINE' ลอย ๆ) · หน้าแจ้งปัญหา: บรรทัดในสรุปก่อนบันทึก `lookup.lineLinked ? 'จะส่ง LINE แจ้งลูกค้าเมื่อบันทึก' : 'ลูกค้าไม่ผูก LINE — โทรแจ้งเอง'` (walk-in ที่ไม่มีลูกค้า = ข้อความหลัง)

- [ ] **Step 1: เทสต์** — API: `getCase` ของเคสที่มี event `LINE_SENT '[AFTER_SALES_READY] …'` + `NOTE '[AFTER_SALES_CLOSED] … ส่งไม่สำเร็จ (429)'` + `NOTE 'บันทึกทั่วไป'` → `lineEvents` มี 2 แถว (ไม่รวมบันทึกทั่วไป) · web: การ์ด 3 สถานะ; timeline label; สรุปก่อนบันทึก 2 กรณี; `after-sales.test.ts` type/`stripLineTag('[AFTER_SALES_READY] มารับได้แล้ว · ส่งแล้ว')` = `'มารับได้แล้ว · ส่งแล้ว'`
- [ ] **Step 2: รันให้แดง** → **Step 3: implement** → **Step 4: เขียว + tsc + Commit** — `git commit -m "feat(web/after-sales): การ์ด LINE ลูกค้าแสดงประวัติส่งจริง + label timeline + สรุปก่อนบันทึกบอกว่าจะส่ง LINE"`

---

### Task 9: bump version · ตรวจทั้งชุด · ดูหน้าจริง (LIFF + หน้าเคส) · ร่าง PR

**Files:** `apps/web/package.json` (`version` → ลำดับถัดไปของเดือน — ดูค่าปัจจุบัน) · `docs/superpowers/specs/2026-09-23-after-sales-hub-design.md` (บรรทัดสถานะ "PR 3 implemented …" + แก้ข้อ 8 บรรทัดแรกให้ตรงของจริง: ผู้รับ = `customer.lineIdShop`, แม่แบบ = `NotificationTemplate` ที่ `/notifications`)

- [ ] **Step 1: API** — `cd apps/api && npx jest src/modules/after-sales src/modules/warranty src/modules/line-oa --runInBand` PASS · integration 2 ไฟล์บนฐานทดสอบทิ้ง (หลัง `prisma migrate deploy`) PASS · `npx tsc --noEmit -p tsconfig.json` · `npx nest build` · boot: `node -e "require('./dist/src/app.module')"` ไม่ throw
- [ ] **Step 2: เว็บ** — `cd apps/web && npx vitest run` ทั้งชุด PASS · `npx tsc --noEmit` · `npx eslint src/pages/liff src/pages/after-sales src/pages/AfterSales*.tsx` 0 error
- [ ] **Step 3: ดูหน้าจริง** (สูตร PR 2 Task 14: mock API พอร์ต 3002 + Vite 5177 + Chrome headless 9338 โปรไฟล์แยก — ห้ามแตะ 5173/3001/9222 · ยืนยัน `location.pathname` + หัวข้อด้วย DOM ก่อนถ่ายทุกภาพ): หน้า LIFF `/liff/warranty` (mock `useLiffInit` ผ่าน `sessionStorage` cache key `bcp_liff_session_v1` หรือ mock endpoint LINE login — อ่าน `useLiffInit.ts` ก่อน; ถ้าทำไม่ได้ให้ render `MyAfterSalesCases` ในหน้า Storybook-แบบชั่วคราวผ่าน vitest snapshot แล้วบันทึกเหตุผล) · หน้าเคส การ์ด LINE 3 สถานะ · จอสว่าง/มืด + มือถือ 390 · เช็ค: ไม่มีคำ "รับเครื่อง" บนหน้าพนักงาน, ชิปเหลืองอ่านออกในจอมืด, ไม่มี scroll แนวนอน · ปิดทุก process ด้วย PID
- [ ] **Step 4: bump + spec + commit** — `git commit -m "chore(web): bump version 26.9.<n> — after-sales PR 3"`
- [ ] **Step 5: ร่าง PR (ยัง push/เปิด PR เมื่อเจ้าของสั่ง)** — title `feat(after-sales): หลังการขาย PR 3 — LINE ลูกค้า 3 จังหวะ เตือนรับเครื่อง LIFF เคสของฉัน ประกันใกล้หมด` · body: ไม่มี migration โครงสร้าง (seed แม่แบบ 5 แถว `ON CONFLICT DO NOTHING`) · แม่แบบแก้ที่ `/notifications` · `WARNING_EXPIRING_7D` **ปิดอยู่** รอเจ้าของเคาะ (เปิดด้วยสวิตช์ is_active) · kill switch `after_sales_line_enabled` (ไม่มีแถว = เปิด) + `after_sales_pickup_reminder_days` (7) · endpoint LIFF ใหม่ 1 เส้น · route พนักงานไม่เปลี่ยน · ปิดท้าย `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

---

## Self-review (ทำแล้ว 2026-09-25)

- **Spec coverage:** ข้อ 8 จังหวะ 1 → T1 แม่แบบ + T3 createCase · จังหวะ 2 (ซ่อมเสร็จ/ยืนยันเปลี่ยน/อนุมัติ) → T3 markRepaired/confirmSameModel/approvePriced PRICED + เตือนซ้ำ 7 วัน → T4 · จังหวะ 3 (ส่งมอบ) → T3 returnToCustomer/deliver/approvePriced MEMO + เคสมีราคาที่เปิดใช้สัญญา → T4 (2) · LIFF "เคสของฉัน" → T6+T7 · ไม่มี LINE → T2 (b) + ป้ายเดิม + T8 · แม่แบบแก้เองได้ → T1 (`/notifications`) · ทุกครั้งลง event → T2 · 4.3 ข้อ 4 "จะส่ง LINE ไหม" ในสรุป → T8 · 4.4 timeline รวม LINE → T8 · 12.7 warranty.cron → T5 · 13 "LINE: มี link ส่ง / ไม่มี link ลง event" → T3 integration (ก)(ข) · 14 แถว 3 ครบ · 15.2 ข้อความ = ร่างกระดาน 6 (3 จังหวะ+เตือน) ใช้จริง; ประกันใกล้หมดยังไม่มีร่าง → seed ปิดไว้ · 15.3 walk-in ไม่เก็บมัดจำ (ค่าเริ่มต้น) — ไม่กระทบ PR นี้
- **Deviation จากสเปกที่ตั้งใจ (รายงานเจ้าของ):** (1) ผู้รับใช้ `customer.lineIdShop` ไม่ใช่ `customerLineLink` (ตารางนั้นไม่มีแถวช่องร้าน — สเปกเขียนตามชื่อ precedent ที่จริง ๆ ก็ใช้ lineIdShop) (2) แม่แบบเก็บใน `NotificationTemplate` + หน้า `/notifications` แทน SystemConfig (3) cron ใหม่แยกไฟล์ในโมดูล after-sales แทน "ขยาย warranty.cron.ts" — warranty.cron ยังอยู่ที่เดิมและส่งประกันใกล้หมดเอง (4) ประกันใกล้หมดรวมลูกค้าขายสดจากตาราง `Sale` (สเปกไม่ระบุ แต่ข้อ 1 ตั้งเป้าปิดช่องว่างลูกค้าเงินสด) (5) ข้อความข้อ 2 ใส่เวลาเปิดสาขา "ทุกวัน 10:00–20:00" เป็นข้อความคงที่ในแม่แบบ (ตาราง Branch ไม่มีเวลาเปิด) แก้ที่ `/notifications`
- **Placeholder scan:** ไม่มี TBD/TODO; ทุก step มีโค้ดหรือค่าตรง ๆ; `'{...}'::jsonb` ใน Step 5 ของ T1 หมายถึงกรอกจริงตามตัวแปรของแม่แบบนั้น (ระบุไว้แล้วว่าต้องครบทุกตัวแปร)
- **Type consistency:** `AfterSalesLineMoment`/`AFTER_SALES_LINE_EVENT_TYPE`/`lineEventTag`/`lineEventNote`/`buildLineData`/`buildLiffLine` (T1) ← T2 ← T3/T4 · `notifyMoment(caseId, moment, actorId)` + `hasLineEvent(caseId, eventType)` (T2) ← T3/T4 · `LiffAfterSalesResponse` (T6) ← T7 · `lineEvents` (T8 API ↔ web) · `LookupResult.lineLinked` (T3 API ↔ T8 web)
- **Review Focus → เทสต์:** 1 → T2 (b) + T3 (ข) · 2 → T2 (c)(d) · 3 → T4 (a)(c) · 4 → T2 (e) + T3 Step 2 + T6 (c) · 5 → T5 (a)(b)(c)
- **Rulings ที่ฝังในแผน (เจ้าของยังไม่เห็น):** L1 kill switch ไม่มีแถว = เปิด · L2 category TRANSACTIONAL สำหรับ 3 จังหวะ+เตือน / REMINDER สำหรับประกันใกล้หมด · L3 ประกันใกล้หมด seed ปิด (`is_active=false`) จนเจ้าของเคาะ · L4 ส่งไม่สำเร็จ/ถูกบล็อก/ปิดสวิตช์ ลง event `NOTE` (enum ไม่มี LINE_FAILED — ไม่เพิ่ม enum เพื่อไม่มี migration โครงสร้าง) · L5 จังหวะ 2 ส่งซ้ำได้เมื่อเกิดเหตุการณ์จริงซ้ำ แต่เตือน 7 วันและจังหวะ 3 ส่งครั้งเดียวต่อเคส · L6 เคส PRICED ที่ปิดจากการเปิดใช้สัญญา ได้จังหวะ 3 จาก cron ภายใน 1 วัน (ไม่ทันที) และไม่ย้อนส่งเคสที่ปิดก่อน deploy เกิน 3 วัน · L7 LIFF โชว์เคสเปิด + ปิดใน 14 วัน สูงสุด 10 เคส
