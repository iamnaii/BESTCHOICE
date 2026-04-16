---
name: add-endpoint
description: เพิ่ม API Endpoint ใน Module ที่มีอยู่ — ใช้เมื่อ module มีแล้วแต่ต้องการเพิ่ม route ใหม่
user_invocable: true
---

# Skill: เพิ่ม API Endpoint

เพิ่ม route ใหม่ใน NestJS module ที่มีอยู่แล้ว โดยไม่ต้องสร้าง module ใหม่

## เมื่อไหร่ควรใช้ / ไม่ควรใช้

| สถานการณ์ | ใช้ skill นี้? | ใช้อะไรแทน |
|---|---|---|
| เพิ่ม route ใหม่ใน module ที่มีอยู่ | ✅ ใช้เลย | — |
| สร้าง module ใหม่ทั้ง module | ❌ | `/create-module` |
| ต้องการทั้ง API + หน้า frontend | ❌ | `/create-feature` |

## ขั้นตอน

### 1. อ่าน Workflow
อ่าน `workflows/add-api-endpoint.md` ก่อนเริ่มงาน

### 2. รับ Input
ถาม user:
- Module ที่จะเพิ่ม endpoint
- HTTP method (GET / POST / PATCH / DELETE)
- Route path
- Request/Response format
- Roles ที่เข้าถึงได้

### 3. ตรวจสอบ Module
- อ่าน controller + service ของ module เป้าหมาย (`apps/api/src/modules/<module>/`)
- ตรวจว่า endpoint ที่ต้องการไม่มีอยู่แล้ว
- เข้าใจ patterns ที่ module นั้นใช้

### 4. สร้าง DTO (ถ้าจำเป็น)
- เพิ่มใน `dto/` directory ของ module
- ใช้ class-validator decorators
- Thai validation messages (เช่น `{ message: 'กรุณาระบุ...' }`)

### 5. เพิ่ม Method ใน Service
- เพิ่ม business logic ใน `<module>.service.ts`
- ใช้ PrismaService สำหรับ database queries
- Soft delete: `where: { deletedAt: null }`
- Error handling: `NotFoundException`, `BadRequestException`, `ConflictException`

### 6. เพิ่ม Route ใน Controller
- เพิ่มใน `<module>.controller.ts`
- เลือก decorator ที่เหมาะสม:
  - `@Get()`, `@Post()`, `@Patch()`, `@Delete()`
  - `@Roles('OWNER', 'BRANCH_MANAGER')` สำหรับ restricted access
  - `@Param()` สำหรับ URL path params
  - `@Query()` สำหรับ URL query params
  - `@Body()` สำหรับ request body
  - `@UseInterceptors(FileInterceptor('file'))` สำหรับ file upload

### 7. Verify
```bash
./tools/check-types.sh api
```

## Common Mistakes

| ผิดบ่อย | วิธีถูก |
|---|---|
| ลืม `@Roles()` บน method ใหม่ | ทุก method ต้องมี `@Roles(...)` ระบุ roles |
| Route path ซ้ำกับ endpoint ที่มี | ตรวจ controller ก่อนเพิ่ม — NestJS จะ override |
| เพิ่ม field required ใน DTO ที่ใช้ร่วมกัน | สร้าง DTO แยกสำหรับ endpoint ใหม่ ถ้า shape ต่างจากเดิม |
| ลืม soft delete filter ใน query ใหม่ | ทุก `findMany`/`findFirst` ต้อง `where: { deletedAt: null }` |

## Rollback
1. ลบ method ใน controller + service
2. ลบ DTO ที่สร้างใหม่ (ถ้ามี)
3. รัน `./tools/check-types.sh api`
