# ระบบประกันสินค้า

> ประกัน 2 ชั้น: ประกันศูนย์ (ตาม brand) + ประกันร้าน (มือสอง 60 วัน)

## Problem

ไม่มีระบบติดตามประกันสินค้า — พนักงานไม่รู้ว่าเครื่องไหนยังมีประกัน ลูกค้าถามมาต้องไปเช็คเอง

## Business Rules

### ประกันศูนย์ (Manufacturer Warranty)
- **เครื่องใหม่**: ประกัน 1 ปีจาก brand (Apple, Samsung, etc.)
- **มือสอง**: เหลือเท่าไหร่ก็ใส่ตามนั้น (อาจหมดแล้ว)
- ใส่ตอนรับเข้าสต็อก/ตรวจสภาพ
- ใช้ field ที่มีอยู่: `Product.warrantyExpireDate`

### ประกันร้าน (Shop Warranty)
- **มือสองทุกเครื่อง**: ประกันร้าน 60 วัน นับจากวันขาย
- **เครื่องใหม่**: ไม่มีประกันร้าน (มีประกันศูนย์แล้ว)
- เริ่มอัตโนมัติเมื่อสร้างสัญญา/ขาย
- OWNER ตั้งจำนวนวันได้ (default 60)

### ลูกค้า 1 เครื่องอาจมี 2 ประกันพร้อมกัน
- ใช้ประกันศูนย์ก่อน (ครอบคลุมมากกว่า)
- ศูนย์หมด → ยังมีประกันร้าน

## Database Changes

### เพิ่ม field ใน Product

```prisma
// ประกันศูนย์ (ใช้ field เดิมที่มีอยู่)
warrantyExpired      Boolean?   @map("warranty_expired")
warrantyExpireDate   DateTime?  @map("warranty_expire_date")

// ประกันร้าน (NEW)
shopWarrantyDays     Int?       @map("shop_warranty_days")  // 60 default, null = ไม่มี
```

### เพิ่ม field ใน Contract

```prisma
// ประกันร้านเริ่ม-หมด (คำนวณจาก startDate + shopWarrantyDays)
shopWarrantyStartDate  DateTime?  @map("shop_warranty_start_date")
shopWarrantyEndDate    DateTime?  @map("shop_warranty_end_date")
```

### Settings

```
warranty.shopWarrantyDays = 60  // OWNER ตั้งค่าได้ ผ่าน SystemConfig
```

## Auto-calculate ประกันร้าน

เมื่อสร้างสัญญา/ขายเครื่องมือสอง:
1. ดูว่า product เป็นมือสอง (category = USED หรือ hasWarranty flag)
2. ถ้ามือสอง → `shopWarrantyStartDate = contract.startDate`
3. `shopWarrantyEndDate = startDate + shopWarrantyDays` (default 60)
4. เครื่องใหม่ → ไม่ตั้งประกันร้าน

## แจ้งเตือนก่อนหมดประกัน

Cron ทุกวัน:
- ตรวจทุกสัญญา active
- ประกันศูนย์เหลือ 7 วัน → แจ้ง LINE ลูกค้า
- ประกันร้านเหลือ 7 วัน → แจ้ง LINE ลูกค้า

## แสดงใน Customer360 Panel

```
── การรับประกัน ──
📱 iPhone 15 (มือสอง)
   ✅ ศูนย์: ถึง 15 ส.ค. 2026 (เหลือ 120 วัน)
   ✅ ร้าน: ถึง 14 มิ.ย. 2026 (เหลือ 58 วัน)

📱 Samsung A55 (มือสอง)
   ❌ ศูนย์: หมดแล้ว
   ✅ ร้าน: ถึง 10 พ.ค. 2026 (เหลือ 23 วัน)

📱 iPhone 16 Pro (ใหม่)
   ✅ ศูนย์: ถึง 15 เม.ย. 2027 (เหลือ 365 วัน)
```

## แสดงในหน้าอื่น

### หน้าสัญญา (Contract Detail)
- แสดงประกันศูนย์ + ประกันร้าน ของสินค้าในสัญญา

### หน้าสต็อก (Product Detail)
- แสดง/แก้ไข warrantyExpireDate (ประกันศูนย์)
- แสดง shopWarrantyDays

### หน้า Settings
- OWNER ตั้ง `warranty.shopWarrantyDays` (default 60)
- ตั้งจำนวนวันแจ้งเตือนก่อนหมด (default 7)

## Implementation

### New Files

| File | Purpose |
|------|---------|
| `apps/api/src/modules/warranty/warranty.service.ts` | Calculate warranty status, auto-set shop warranty |
| `apps/api/src/modules/warranty/warranty.cron.ts` | Daily check + LINE notify before expiry |
| `apps/api/src/modules/warranty/warranty.module.ts` | Module registration |

### Files to Modify

| File | Change |
|------|--------|
| `apps/api/prisma/schema.prisma` | Add shopWarrantyDays to Product, shopWarrantyStartDate/EndDate to Contract |
| `apps/api/src/modules/contracts/contracts.service.ts` | Auto-set shop warranty on contract create |
| `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx` | Update warranty display (2 tiers) |
| `apps/web/src/config/menu.ts` | (ไม่ต้องเพิ่มหน้าใหม่ — settings อยู่ใน Integration Hub) |
