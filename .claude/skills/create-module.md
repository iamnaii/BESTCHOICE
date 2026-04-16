---
name: create-module
description: สร้าง NestJS API Module (controller, service, DTO) — ใช้เมื่อมี Prisma model แล้วและต้องการ API แต่ไม่ต้องการหน้า frontend
user_invocable: true
---

# Skill: สร้าง NestJS API Module

สร้าง backend module ครบชุดตาม pattern ของโปรเจค BESTCHOICE

## เมื่อไหร่ควรใช้ / ไม่ควรใช้

| สถานการณ์ | ใช้ skill นี้? | ใช้อะไรแทน |
|---|---|---|
| ต้องการ API module ใหม่ (มี model แล้ว) | ✅ ใช้เลย | — |
| ต้องการ feature ครบ DB+API+UI | ❌ | `/create-feature` |
| เพิ่ม endpoint ใน module ที่มีอยู่ | ❌ | `/add-endpoint` |
| ยังไม่มี Prisma model | ❌ | `/db-change` ก่อน แล้วค่อยกลับมา |

## ขั้นตอน

### 1. อ่าน Workflow
อ่าน `workflows/create-api-module.md` ก่อนเริ่มงาน

### 2. รับ Input
ถาม user:
- ชื่อ module (kebab-case เช่น `warranties`, `purchase-orders`)
- Prisma model ที่เกี่ยวข้อง
- Roles ที่เข้าถึงได้ (OWNER, BRANCH_MANAGER, SALES, ACCOUNTANT)
- CRUD operations ที่ต้องการ

### 3. ตรวจสอบก่อนสร้าง
- ค้นหา module ที่ชื่อซ้ำหรือทำงานคล้ายกัน ใน `apps/api/src/modules/`
- ตรวจว่า Prisma model มีอยู่ใน `apps/api/prisma/schema.prisma`
- ถ้ายังไม่มี model → แจ้ง user ให้ใช้ `/db-change` ก่อน

### 4. Scaffold Module
```bash
./tools/generate-module.sh <module-name>
```

### 5a. ปรับ DTO
ดู `apps/api/src/modules/customers/dto/` เป็น reference:
- เปลี่ยน placeholder เป็น fields จริง
- เพิ่ม class-validator decorators (`@IsString`, `@IsOptional`, `@Length`, etc.)
- ใช้ Thai validation messages (เช่น `{ message: 'กรุณาระบุชื่อ' }`)
- แยก CreateDto / UpdateDto (UpdateDto ทุก field เป็น optional)

### 5b. ปรับ Service
ดู `apps/api/src/modules/customers/customers.service.ts` เป็น reference:
- เปลี่ยน `/* MODEL */` เป็น Prisma model name จริง
- เพิ่ม soft delete pattern: `where: { deletedAt: null }`
- Pagination: `page=1, limit=50` default
- Throw `NotFoundException`, `ConflictException` ตามกรณี

### 5c. ปรับ Controller
ดู `apps/api/src/modules/customers/customers.controller.ts` เป็น reference:
- ปรับ `@Roles()` ตาม user requirements
- `@UseGuards(JwtAuthGuard, RolesGuard)` บน class level

### 6. Register Module
เพิ่ม import + register ใน `apps/api/src/app.module.ts`

### 7. Verify
```bash
./tools/check-types.sh api
```

### 8. ทดสอบ CRUD (optional)
ถ้า dev server รันอยู่ ทดสอบ endpoints:
```bash
# Health check
curl -s http://localhost:3000/api/<module-name> | head -c 200
```

## Common Mistakes

| ผิดบ่อย | วิธีถูก |
|---|---|
| ตั้งชื่อ module เป็น PascalCase | ใช้ **kebab-case** สำหรับ directory (เช่น `purchase-orders`) |
| ลืม `@UseGuards(JwtAuthGuard, RolesGuard)` | ต้องมีที่ **class level** ของ controller |
| ลืม `where: { deletedAt: null }` | **ทุก query** ต้อง filter soft delete |
| ลืม register ใน `app.module.ts` | API จะไม่รู้จัก module → 404 |
| เรียก PrismaService จาก controller โดยตรง | **ห้าม** — ต้องผ่าน service เสมอ |

## Rollback
ถ้าต้องย้อนกลับ:
1. ลบ folder `apps/api/src/modules/<name>/`
2. ลบ import จาก `apps/api/src/app.module.ts`
3. รัน `./tools/check-types.sh api` เพื่อยืนยัน
