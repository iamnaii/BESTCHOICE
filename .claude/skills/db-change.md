---
name: db-change
description: แก้ไข Prisma Schema + Migration อย่างปลอดภัย — ใช้เมื่อต้องเพิ่ม/แก้ model, field, enum, หรือ relation
user_invocable: true
---

# Skill: แก้ไข Prisma Schema

เพิ่ม/แก้ไข Prisma model, enum, หรือ relation อย่างปลอดภัย

## เมื่อไหร่ควรใช้ / ไม่ควรใช้

| สถานการณ์ | ใช้ skill นี้? | ใช้อะไรแทน |
|---|---|---|
| เพิ่ม/แก้ model, field, enum, relation | ✅ ใช้เลย | — |
| สร้าง feature ครบ DB+API+UI | ❌ | `/create-feature` (มี db step ในตัว) |
| Reset dev database | ❌ | `./tools/db-reset.sh` โดยตรง |

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

ชื่อ migration ต้องสื่อความหมาย:
- ✅ `add_warranty_model`, `add_phone_field_to_customer`, `add_status_enum`
- ❌ `update1`, `fix`, `schema_change`

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

## Common Mistakes

| ผิดบ่อย | วิธีถูก |
|---|---|
| ลืม `deletedAt DateTime?` | ทุก model ต้องมี soft delete field |
| ใช้ `Float` สำหรับเงิน | ใช้ `Decimal @db.Decimal(12, 2)` |
| เพิ่ม required field บน table ที่มีข้อมูล | ต้องมี `@default()` หรือ 2-step migration |
| Rename field โดยตรง | Prisma จะ DROP+CREATE → ใช้ `@map("old_name")` |
| ชื่อ migration ไม่สื่อความหมาย | ตั้งชื่อ descriptive เช่น `add_warranty_model` |
| ลืม `@@index` สำหรับ FK ที่ query บ่อย | เพิ่ม index เสมอ (ดู v3 hardening — 6 missing FK indexes) |

## Rollback / Recovery
1. **Migration ผิด**: `cd apps/api && npx prisma migrate resolve --rolled-back <migration_name>`
2. ลบ folder migration ที่ผิดใน `apps/api/prisma/migrations/`
3. แก้ schema กลับ → `npx prisma generate`
4. รัน `./tools/check-types.sh api`
