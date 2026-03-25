# Backend Rules (NestJS + Prisma)

## Module Structure
- Pattern: controller → service → PrismaService
- **ห้ามเรียก PrismaService จาก controller โดยตรง** — ต้องผ่าน service เสมอ
- Reference module: `apps/api/src/modules/customers/`

## DTOs (Data Transfer Objects)
- แยก `CreateDto` และ `UpdateDto` เสมอ
- `UpdateDto` ทุก field เป็น optional (ใช้ `@IsOptional()`)
- ใช้ class-validator decorators สำหรับ validation
- Error messages เป็น**ภาษาไทย** เช่น `{ message: 'กรุณาระบุชื่อลูกค้า' }`

## Error Handling
- ใช้ NestJS built-in exceptions:
  - `NotFoundException` — ไม่พบข้อมูล
  - `BadRequestException` — input ไม่ถูกต้อง
  - `ConflictException` — ข้อมูลซ้ำ
  - `ForbiddenException` — ไม่มีสิทธิ์

## Pagination
- Default: `page = 1`, `limit = 50`
- Response shape: `{ data, total, page, limit }`
- รับ query params: `?page=1&limit=50`

## Soft Delete Queries
- ทุก query ต้อง include `where: { deletedAt: null }`
- Delete operation = `update({ data: { deletedAt: new Date() } })`

## Module Registration
- Module ใหม่ต้อง import ใน `apps/api/src/app.module.ts`
- ใช้ `./tools/generate-module.sh <name>` เพื่อ scaffold module ใหม่

## File Uploads
- ใช้ `@UseInterceptors(FileInterceptor('file'))` กับ S3 storage
- S3 config: `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION`
