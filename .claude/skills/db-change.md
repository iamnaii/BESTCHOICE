---
name: db-change
description: แก้ไข Prisma Schema + Migration อย่างปลอดภัย
user_invocable: true
---

# Skill: แก้ไข Prisma Schema

เพิ่ม/แก้ไข Prisma model, enum, หรือ relation อย่างปลอดภัย

## ขั้นตอน

### 1. อ่าน Workflow
อ่าน `workflows/prisma-changes.md` ก่อนเริ่มงาน

### 2. รับ Input
ถาม user:
- ประเภทการเปลี่ยนแปลง (เพิ่ม model / เพิ่ม field / แก้ relation / เพิ่ม enum)
- รายละเอียด fields และ types
- ชื่อ migration ที่สื่อความหมาย

### 3. ตรวจสอบ Schema ปัจจุบัน
- อ่าน `apps/api/prisma/schema.prisma`
- ตรวจว่าไม่ซ้ำกับ model/field ที่มีอยู่
- ตรวจ relations ที่จะกระทบ

### 4. แก้ไข Schema
แก้ไข `apps/api/prisma/schema.prisma` ตาม patterns ของโปรเจค:

- **ID**: `id String @id @default(uuid())`
- **Timestamps**: `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`, `deletedAt DateTime?`
- **Soft delete**: ใช้ `deletedAt DateTime?` เสมอ ไม่ hard delete
- **Money**: ใช้ `Decimal` → `@db.Decimal(12, 2)` ไม่ใช่ Float
- **Relations**: ตั้งชื่อ `@relation("RelationName")` เมื่อมีหลาย relation ไปยัง model เดียวกัน
- **Indexes**: `@@index([fieldName])` สำหรับ fields ที่ query บ่อย
- **Enums**: ประกาศไว้ด้านบนของ schema file

### 5. Generate + Migrate
```bash
cd apps/api && npx prisma generate
cd apps/api && npx prisma migrate dev --name <descriptive_name>
```

ชื่อ migration ต้องสื่อความหมาย เช่น:
- `add_warranty_model`
- `add_phone_field_to_customer`
- `add_status_enum`

### 6. ตรวจ Migration SQL
- เปิดไฟล์ `.sql` ที่สร้างใน `apps/api/prisma/migrations/`
- ตรวจว่า SQL ถูกต้อง
- ระวัง: DROP COLUMN, data loss, breaking changes

### 7. Edge Cases
- **Required field ใหม่**: ต้องมี `@default()` หรือทำ 2-step migration (add optional → backfill → make required)
- **Rename field**: Prisma จะ DROP + CREATE → ใช้ `@map("old_name")` แทน
- **Production**: ใช้ `prisma migrate deploy` ไม่ใช่ `migrate dev`

### 8. Verify
```bash
./tools/check-types.sh api
```
