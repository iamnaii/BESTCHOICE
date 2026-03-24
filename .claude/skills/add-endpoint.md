---
name: add-endpoint
description: เพิ่ม API Endpoint ใน Module ที่มีอยู่
user_invocable: true
---

# Skill: เพิ่ม API Endpoint

เพิ่ม route ใหม่ใน NestJS module ที่มีอยู่แล้ว โดยไม่ต้องสร้าง module ใหม่

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
