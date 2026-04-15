# Warranty System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ระบบประกัน 2 ชั้น — ประกันศูนย์ (เครื่องใหม่ + มือสองบางเครื่อง) + ประกันร้าน 60 วัน (มือสองทุกเครื่อง) พร้อมแจ้งเตือนก่อนหมด

**Architecture:** เพิ่ม shopWarrantyDays ใน Product, shopWarrantyStartDate/EndDate ใน Contract, auto-set เมื่อขายมือสอง, cron แจ้งเตือน 7 วันก่อนหมด, แสดง 2 ชั้นใน Customer360

**Tech Stack:** NestJS, Prisma, @Cron, React

**Spec:** `docs/superpowers/specs/2026-04-15-warranty-system-design.md`

---

## Task 1: DB Migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Add fields to Product**

```prisma
shopWarrantyDays    Int?        @map("shop_warranty_days") // 60 default for used, null for new
```

- [ ] **Step 2: Add fields to Contract**

```prisma
shopWarrantyStartDate  DateTime?  @map("shop_warranty_start_date")
shopWarrantyEndDate    DateTime?  @map("shop_warranty_end_date")
```

- [ ] **Step 3: Run migration + commit**

```bash
cd apps/api && npx prisma db push --accept-data-loss
npx prisma generate
./tools/check-types.sh api
git commit -m "feat(api): add warranty fields to Product and Contract"
```

---

## Task 2: Warranty Service

**Files:**
- Create: `apps/api/src/modules/warranty/warranty.service.ts`
- Create: `apps/api/src/modules/warranty/warranty.module.ts`

- [ ] **Step 1: Create warranty.service.ts**

Methods:
- `getWarrantyStatus(contractId)` — return both manufacturer + shop warranty status
- `setShopWarranty(contractId)` — auto-set shop warranty when selling used phone
- `getExpiringWarranties(daysAhead)` — find contracts with warranty expiring in N days

Logic for `setShopWarranty`:
1. Get contract with product
2. Check if product is used (category or condition check)
3. If used → set shopWarrantyStartDate = contract startDate, shopWarrantyEndDate = startDate + shopWarrantyDays (from SystemConfig, default 60)
4. If new → skip (manufacturer warranty only)

Logic for `getWarrantyStatus`:
```typescript
return {
  manufacturer: {
    expireDate: product.warrantyExpireDate,
    expired: product.warrantyExpireDate ? isPast(product.warrantyExpireDate) : true,
    daysRemaining: product.warrantyExpireDate ? differenceInDays(product.warrantyExpireDate, new Date()) : 0,
  },
  shop: contract.shopWarrantyEndDate ? {
    startDate: contract.shopWarrantyStartDate,
    endDate: contract.shopWarrantyEndDate,
    expired: isPast(contract.shopWarrantyEndDate),
    daysRemaining: differenceInDays(contract.shopWarrantyEndDate, new Date()),
  } : null,
};
```

- [ ] **Step 2: Create module + register in app.module**

- [ ] **Step 3: Type check + commit**

```bash
./tools/check-types.sh api
git commit -m "feat(api): add WarrantyService — 2-tier warranty status + auto-set"
```

---

## Task 3: Auto-set Shop Warranty on Contract Create

**Files:**
- Modify: `apps/api/src/modules/contracts/contracts.service.ts`

- [ ] **Step 1: Hook warranty into contract creation**

After contract is created/activated, call `warrantyService.setShopWarranty(contractId)`.

Use `@Optional()` injection so contracts module doesn't hard-depend on warranty.

Fire-and-forget — warranty setup failure shouldn't block contract creation.

- [ ] **Step 2: Type check + commit**

```bash
./tools/check-types.sh api
git commit -m "feat(api): auto-set shop warranty on contract creation for used phones"
```

---

## Task 4: Warranty Expiry Notification Cron

**Files:**
- Create: `apps/api/src/modules/warranty/warranty.cron.ts`

- [ ] **Step 1: Create cron**

Daily at 09:00 Bangkok time — check warranties expiring in 7 days, send LINE notification.

```typescript
@Cron('0 9 * * *', { timeZone: 'Asia/Bangkok' })
async checkExpiringWarranties() {
  // Find manufacturer warranties expiring in 7 days
  // Find shop warranties expiring in 7 days
  // Send LINE notification to each customer
}
```

Notification messages:
- ศูนย์: "ประกันศูนย์ของ {productName} จะหมดในอีก {days} วัน ({expireDate})"
- ร้าน: "ประกันร้านของ {productName} จะหมดในอีก {days} วัน ({expireDate})"

- [ ] **Step 2: Register in module + commit**

```bash
./tools/check-types.sh api
git commit -m "feat(api): add warranty expiry notification cron — 7 days before"
```

---

## Task 5: Update Customer360 Panel — 2-tier Warranty Display

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx`

- [ ] **Step 1: Update warranty section**

Replace single warranty display with 2-tier:

For each contract/product, show:
```
📱 iPhone 15 (มือสอง)
   ✅ ศูนย์: ถึง 15 ส.ค. 2026 (เหลือ 120 วัน)
   ✅ ร้าน: ถึง 14 มิ.ย. 2026 (เหลือ 58 วัน)

📱 iPhone 16 Pro (ใหม่)
   ✅ ศูนย์: ถึง 15 เม.ย. 2027 (เหลือ 365 วัน)
```

Use existing data: `product.warrantyExpireDate` (manufacturer) + `contract.shopWarrantyEndDate` (shop).

- [ ] **Step 2: Type check + commit + push**

```bash
./tools/check-types.sh all
git commit -m "feat(web): show 2-tier warranty (manufacturer + shop) in Customer360"
git push
```

---

## Verification

1. **TypeScript**: `./tools/check-types.sh all` — 0 errors
2. **Contract create**: สร้างสัญญาเครื่องมือสอง → shopWarrantyEndDate ถูก set อัตโนมัติ (startDate + 60 วัน)
3. **Contract create (ใหม่)**: สร้างสัญญาเครื่องใหม่ → shopWarranty เป็น null
4. **Customer360**: เห็นประกัน 2 ชั้น (ศูนย์ + ร้าน) ในแชท
5. **Cron**: แจ้งเตือน LINE 7 วันก่อนหมดประกัน
