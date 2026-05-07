# Product Sticker Print Redesign

**Date**: 2026-05-07
**Author**: Claude (brainstorm with owner)
**Status**: Draft

## Goal

แทนที่หน้า `/stickers` เดิมด้วยระบบพิมพ์สติกเกอร์ติดเครื่อง 50×30mm ที่แสดงข้อมูลครบสำหรับขายหน้าร้าน (รุ่น/สเปค/ประกัน/ราคาเงินสด/แผนผ่อน 2 เรท/IMEI/โลโก้) — พิมพ์หลายชิ้นจาก `/stock` ได้

## Context

- หน้า `/stickers` (StickerPrintPage.tsx) ปัจจุบัน: 160 บรรทัด, ใส่ Product ID ทีละตัว, preview เรียบมาก, มี QR ปลอม (ไม่ render จริง)
- `StickersService.getStickerData()` มี: brand/model/imei/grade/sellingPrice/branch/createdAt
- `StickerTemplate` model + CRUD API มีอยู่แล้ว แต่ **ไม่มี UI สำหรับสร้าง/แก้ template**
- Owner ต้องการป้ายแขวนเครื่อง (price tag) มากกว่า barcode tag — ไม่ต้องบาร์โค้ด

## Layout (fixed 50×30mm)

```
┌──────────────────────────────────────────────┐
│ iPhone 15 Pro Max                  ฿ 35,900 │   ← รุ่น (bold) + ราคาเงินสด (bold ใหญ่)
│ ดำ · 256GB · แบต 95%   ประกันศูนย์ 22/05/2027│   ← spec + warranty (DD/MM/YYYY ค.ศ.)
│ ─────────────────────────────────────────────│
│ เรทที่ 1  ดาวน์ 0      1,500 × 24 ด.        │   ← rate 1: down + monthly × term
│ เรทที่ 2  ดาวน์ 1,000  1,800 × 12 ด.        │   ← rate 2
│ IMEI: 359123456789012              [LOGO]    │   ← IMEI (mono) + logo มุมขวาล่าง
└──────────────────────────────────────────────┘
```

**ข้อกำหนด layout**:
- Font: IBM Plex Sans Thai (ในระบบอยู่แล้ว) ขนาด ~6.5pt body, ~8pt รุ่น/ราคา bold
- Logo: 7×7mm มุมขวาล่าง (absolute position, padding ~1mm จากขอบ), จาก `CompanyInfo.logoUrl` ของ company `SHOP`
- ฟิลด์ที่ไม่มีข้อมูล → ซ่อนทั้งบรรทัด (warranty null, batteryHealth null, IMEI null)
- ถ้า PricingTemplate ไม่มี rate1/rate2 fields → fallback ไป SystemSetting global default
- ถ้าทั้งคู่ไม่มี → ซ่อนบรรทัดเรท (ไม่ค้าง "ดาวน์ - × - ด.")
- ราคาเงินสด: format `฿ X,XXX` (Thai locale)
- วันหมดประกัน: `DD/MM/YYYY` (ค.ศ.)
- IMEI: mono font, ตัดถ้ายาวเกิน 17 ตัว (เผื่อ dual-IMEI ใช้แค่ตัวหลัก)

## Data Sources

| ฟิลด์ | จาก |
|---|---|
| รุ่น | `Product.brand` + `Product.model` |
| สี | `Product.color` |
| ความจุ | `Product.storage` |
| % แบตเตอร์รี่ | `Product.batteryHealth` |
| วันหมดประกันศูนย์ | `Product.warrantyExpireDate` — ซ่อนบรรทัดถ้า: (a) `warrantyExpired = true`, หรือ (b) `warrantyExpireDate < now()`, หรือ (c) ทั้งสอง field เป็น null |
| IMEI | `Product.imeiSerial` |
| โลโก้ | `CompanyInfo.logoUrl` where `companyCode = 'SHOP'` |
| ราคาเงินสด | `PricingTemplate.cashPrice` ที่ match (`brand`, `model`, `storage`, `category`, `hasWarranty`) |
| เรทที่ 1 ผ่อน/เดือน | `PricingTemplate.installmentBestchoicePrice` |
| เรทที่ 1 ดาวน์ | `PricingTemplate.rate1DownPayment` (ใหม่) → fallback `SystemConfig['sticker.rate1.defaultDown']` |
| เรทที่ 1 จำนวนเดือน | `PricingTemplate.rate1TermMonths` (ใหม่) → fallback `SystemConfig['sticker.rate1.defaultTerm']` |
| เรทที่ 2 ผ่อน/เดือน | `PricingTemplate.installmentFinancePrice` |
| เรทที่ 2 ดาวน์ | `PricingTemplate.rate2DownPayment` (ใหม่) → fallback `SystemConfig['sticker.rate2.defaultDown']` |
| เรทที่ 2 จำนวนเดือน | `PricingTemplate.rate2TermMonths` (ใหม่) → fallback `SystemConfig['sticker.rate2.defaultTerm']` |

**Note**: ถ้าไม่เจอ `PricingTemplate` ที่ match (สินค้ายังไม่มีตัวตั้งราคา) → ใช้ `Product.costPrice` × 1.15 หาก fallback หรือซ่อนทั้งราคาและเรทผ่อน (เลือก strategy ใน implementation)

## Schema Changes

### Migration 1: PricingTemplate add rate fields

```prisma
model PricingTemplate {
  // ... existing fields
  installmentBestchoicePrice Decimal @map("installment_bestchoice_price") @db.Decimal(12, 2) // = rate1 monthly
  installmentFinancePrice    Decimal @map("installment_finance_price") @db.Decimal(12, 2)    // = rate2 monthly

  // NEW (all nullable, fallback to SystemSetting)
  rate1DownPayment  Decimal? @map("rate1_down_payment") @db.Decimal(12, 2)
  rate1TermMonths   Int?     @map("rate1_term_months")
  rate2DownPayment  Decimal? @map("rate2_down_payment") @db.Decimal(12, 2)
  rate2TermMonths   Int?     @map("rate2_term_months")
}
```

### Defaults via existing `SystemConfig` (no new table)

ระบบมี `SystemConfig` (key/value) อยู่แล้ว — ใช้ key เหล่านี้:

| Key | Default | Type |
|---|---|---|
| `sticker.rate1.defaultDown` | `"0"` | Decimal as string |
| `sticker.rate1.defaultTerm` | `"24"` | Int as string |
| `sticker.rate2.defaultDown` | `"0"` | Decimal as string |
| `sticker.rate2.defaultTerm` | `"12"` | Int as string |

Seed via migration data step (insert if not exists). Service reads via `SettingsService.findAll()` filter ด้วย key prefix.

## API Endpoints

### Existing (extend)
- `GET /sticker-templates/product/:productId/data` — extend response shape:
  ```ts
  interface StickerData {
    productId: string;
    brand: string;
    model: string;
    color: string | null;
    storage: string | null;
    batteryHealth: number | null;
    warrantyExpireDate: string | null;  // ISO date or null
    imei: string | null;
    cashPrice: number | null;
    rate1: { downPayment: number; monthlyPrice: number; termMonths: number } | null;
    rate2: { downPayment: number; monthlyPrice: number; termMonths: number } | null;
    shopLogoUrl: string | null;
  }
  ```
  Logic: lookup `PricingTemplate` by `(brand, model, storage, category, hasWarranty)`. Lookup `StickerSetting` singleton for fallbacks. Lookup SHOP `CompanyInfo` for logoUrl. Compose response.

### New
- `GET /sticker-templates/products/data?ids=id1,id2,id3` — batch endpoint, returns `StickerData[]` for bulk print
- Sticker defaults read/write **via existing `/settings` endpoints** (no new endpoint) — keys ขึ้นต้น `sticker.*`

### Deprecated
- `StickerTemplate` CRUD endpoints (`POST /sticker-templates`, `PATCH /sticker-templates/:id`, etc.) — **เก็บไว้ in DB schema สำหรับ future** แต่ไม่ wire UI. ลบออก controller ได้เพราะไม่มี UI consume

## Frontend Changes

### 1. `/stickers` redesign (StickerPrintPage.tsx)
- Input: array of product IDs (จาก URL query `?productIds=id1,id2,id3` หรือ paste manual)
- Quantity input ต่อสินค้า (default 1)
- Add/remove สินค้าจาก list
- Preview ทุกชิ้นเรียงต่อกัน
- ปุ่ม "พิมพ์" → `window.print()` + `@page` CSS 50×30mm + `page-break-after: always`
- Hide chrome (sidebar, header) ผ่าน `print:hidden`

### 2. `/stock` integration
- หา bulk select toolbar ใน StockPage
- เพิ่มปุ่ม **"พิมพ์สติกเกอร์"** (icon: `Printer` from lucide)
- คลิก → `navigate('/stickers?productIds=' + selectedIds.join(','))`

### 3. `/settings/pricing-templates` extend
- Form สร้าง/แก้ PricingTemplate — เพิ่ม 4 inputs:
  - "ดาวน์เรทที่ 1 (เว้นว่าง = ใช้ default)" `rate1DownPayment`
  - "จำนวนเดือนเรทที่ 1 (เว้นว่าง = ใช้ default)" `rate1TermMonths`
  - "ดาวน์เรทที่ 2..." `rate2DownPayment`
  - "จำนวนเดือนเรทที่ 2..." `rate2TermMonths`
- Placeholder แสดงค่า default จาก StickerSetting

### 4. Settings page — เพิ่ม section "สติกเกอร์ติดเครื่อง"
- ใน `/settings` หน้า index — เพิ่ม section ใหม่ที่ใช้ pattern เดียวกับ `SystemSettings.tsx` / `GeneralSettings.tsx`
- 4 inputs:
  - "ดาวน์เรทที่ 1 default" → key `sticker.rate1.defaultDown`
  - "จำนวนเดือนเรทที่ 1 default" → key `sticker.rate1.defaultTerm`
  - "ดาวน์เรทที่ 2 default" → key `sticker.rate2.defaultDown`
  - "จำนวนเดือนเรทที่ 2 default" → key `sticker.rate2.defaultTerm`
- Save ผ่าน existing `PATCH /settings` (batch update รับ `items: { key, value }[]`)
- จำกัดสิทธิ์ที่ frontend: section แสดงเฉพาะ OWNER role

## Print CSS

```css
@media print {
  @page {
    size: 50mm 30mm;
    margin: 0;
  }
  body { margin: 0; padding: 0; }
  .sticker {
    width: 50mm;
    height: 30mm;
    page-break-after: always;
    overflow: hidden;
  }
  .print\\:hidden { display: none !important; }
}
```

## Out of Scope (DEFER)

| Feature | เหตุผล |
|---|---|
| Template Designer UI (toggle ฟิลด์, custom layout, drag-drop) | size + layout fixed; ไม่จำเป็น v1 |
| บาร์โค้ด (Code128/QR) | owner ตัดสินใจไม่เอา |
| A4 sheet grid printing | ใช้ thermal printer เท่านั้น |
| Print queue / history | thermal printer พิมพ์ instant |
| Multi-language toggle | UI ภาษาไทยอย่างเดียว |
| StickerTemplate UI (CRUD templates) | size+layout fixed; เก็บ model ไว้สำหรับ future แต่ไม่ wire UI |

## Acceptance Criteria

1. เปิด `/stock` → เลือกสินค้า 3 ตัว → กดปุ่ม "พิมพ์สติกเกอร์" → `/stickers` เปิดพร้อมข้อมูลครบ 3 ดวง
2. กดพิมพ์ → thermal printer ออกสติกเกอร์ 3 ดวง ขนาด 50×30mm ตรง layout
3. สินค้าที่ไม่มี battery/warranty/IMEI → บรรทัดนั้น ๆ หายไป ไม่ค้าง "null" หรือ "-"
4. สินค้าที่ไม่มี PricingTemplate match → แสดงรุ่น/สเปค/IMEI/logo แต่ราคา+เรท ซ่อน
5. PricingTemplate ที่ override rate1/rate2 fields → preview แสดงค่า override
6. PricingTemplate ที่ไม่ override → preview แสดงค่าจาก StickerSetting
7. แก้ StickerSetting → preview ของสินค้าที่ไม่ override อัปเดตทันที
8. หน้า `/settings/sticker-defaults` แก้ได้เฉพาะ OWNER
9. Type check ผ่าน, lint ผ่าน

## Testing Plan

- API unit tests:
  - `StickersService.getStickerData()` covers: full data / missing battery / missing warranty / missing IMEI / no PricingTemplate match / PricingTemplate with override / PricingTemplate without override
  - `StickerSettingsService` CRUD
- E2E (smoke):
  - Stock → bulk select → Print sticker → page renders correctly
  - Settings → sticker defaults → save → preview reflects change

## Implementation Order

1. Migration: PricingTemplate add 4 cols + seed `SystemConfig` keys
2. Backend: extend `getStickerData`, batch endpoint
3. Backend: extend PricingTemplate DTO + service for 4 new optional fields
4. Frontend: `/stickers` redesign with print CSS
5. Frontend: `/stock` bulk action button
6. Frontend: `/settings` page — add sticker defaults section
7. Frontend: `/settings/pricing-templates` form — add 4 fields
8. Tests + type check + manual print test

## Open Questions (resolved during impl, document choice)

- Strategy เมื่อ PricingTemplate ไม่ match: **decision = ซ่อนราคา+เรท ทั้งหมด** (ไม่ guess จาก costPrice)
- IMEI dual-SIM (เครื่องที่มี 2 IMEI): **decision = แสดงเฉพาะ `Product.imeiSerial` หลัก** (ไม่ split)
- Battery health % สำหรับเครื่องใหม่ (ไม่มี data): **decision = ซ่อนบรรทัด** ไม่แสดง 100%
