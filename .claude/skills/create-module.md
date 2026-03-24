---
name: create-module
description: สร้าง NestJS API Module (controller, service, DTO)
user_invocable: true
---

# Skill: สร้าง NestJS API Module

สร้าง backend module ครบชุดตาม pattern ของโปรเจค BESTCHOICE

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

### 5. ปรับ Generated Files
ดู `apps/api/src/modules/customers/` เป็น reference แล้วปรับ:

**dto/<name>.dto.ts**:
- เปลี่ยน placeholder เป็น fields จริง
- เพิ่ม class-validator decorators (`@IsString`, `@IsOptional`, `@Length`, etc.)
- ใช้ Thai validation messages (เช่น `{ message: 'กรุณาระบุชื่อ' }`)
- แยก CreateDto / UpdateDto (UpdateDto ทุก field เป็น optional)

**<name>.service.ts**:
- เปลี่ยน `/* MODEL */` เป็น Prisma model name จริง
- เพิ่ม soft delete pattern: `where: { deletedAt: null }`
- Pagination: `page=1, limit=50` default
- Throw `NotFoundException`, `ConflictException` ตามกรณี

**<name>.controller.ts**:
- ปรับ `@Roles()` ตาม user requirements
- `@UseGuards(JwtAuthGuard, RolesGuard)` บน class

### 6. Register Module
เพิ่ม import + register ใน `apps/api/src/app.module.ts`

### 7. Verify
```bash
./tools/check-types.sh api
```
