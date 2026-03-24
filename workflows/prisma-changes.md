# Workflow: แก้ไข Prisma Schema

## Objective
เพิ่ม/แก้ไข Prisma model, enum, หรือ relation อย่างปลอดภัย

## Required Inputs
- รายละเอียดการเปลี่ยนแปลง (เพิ่ม model, เพิ่ม field, แก้ relation)
- ชื่อ migration ที่สื่อความหมาย

## Reference
- Schema: `apps/api/prisma/schema.prisma`
- Migrations: `apps/api/prisma/migrations/`
- Prisma Service: `apps/api/src/prisma/prisma.service.ts`

## Steps

### 1. ตรวจสอบก่อนแก้ไข
- อ่าน schema ปัจจุบันเพื่อเข้าใจ structure
- ตรวจว่าไม่ซ้ำกับ model/field ที่มีอยู่
- ตรวจ relations ที่จะกระทบ

### 2. แก้ไข Schema (`apps/api/prisma/schema.prisma`)

#### เพิ่ม Model ใหม่
```prisma
model Warranty {
  id          String    @id @default(uuid())
  contractId  String
  contract    Contract  @relation(fields: [contractId], references: [id])
  startDate   DateTime
  endDate     DateTime
  status      WarrantyStatus @default(ACTIVE)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?
}
```

#### เพิ่ม Enum ใหม่
```prisma
enum WarrantyStatus {
  ACTIVE
  EXPIRED
  CLAIMED
  VOIDED
}
```

### 3. Patterns ของโปรเจค
- **ID**: `@id @default(uuid())` — ใช้ UUID เสมอ
- **Timestamps**: `createdAt`, `updatedAt`, `deletedAt` (soft delete)
- **Soft delete**: ใช้ `deletedAt DateTime?` ไม่ hard delete
- **Money fields**: ใช้ `Decimal` ไม่ใช่ `Float` — `@db.Decimal(12, 2)`
- **Relations**: ตั้งชื่อ `@relation("RelationName")` เมื่อมีหลาย relation ไปยัง model เดียวกัน
- **Indexes**: เพิ่ม `@@index([fieldName])` สำหรับ fields ที่ query บ่อย
- **Enums**: ประกาศไว้ด้านบนของ schema file

### 4. Generate Prisma Client
```bash
cd apps/api && npx prisma generate
```
- สร้าง TypeScript types จาก schema ใหม่
- ต้องรันก่อน migration

### 5. สร้าง Migration
```bash
cd apps/api && npx prisma migrate dev --name <descriptive_name>
```
- ชื่อ migration ต้องสื่อความหมาย เช่น `add_warranty_model`, `add_phone_to_customer`
- ตรวจ migration SQL ที่ถูกสร้างใน `prisma/migrations/`

### 6. ตรวจสอบ Migration SQL
- เปิดไฟล์ `.sql` ที่ถูกสร้าง
- ตรวจว่า SQL ถูกต้องตามที่คาดหวัง
- ระวัง: DROP COLUMN, data loss, breaking changes

### 7. ทดสอบ
```bash
cd apps/api && npx tsc --noEmit
```

## Edge Cases
- **Breaking changes**: ถ้าลบ field/model ที่มี data อยู่ → ต้องทำ data migration ก่อน
- **Required field ใหม่**: ต้อง `@default()` หรือทำ 2-step migration (add optional → backfill → make required)
- **Rename field**: Prisma จะ DROP + CREATE ไม่ใช่ RENAME → ใช้ `@map("old_name")` แทน
- **Production**: ใช้ `prisma migrate deploy` ไม่ใช่ `migrate dev`
- **Seed data**: ถ้ามี seed ใหม่ → แก้ `prisma/seed.ts`

## Output
- Schema ที่ update แล้ว
- Migration file ใหม่ใน `prisma/migrations/`
- Prisma Client ที่ generate ใหม่
- TypeScript compile ผ่าน
