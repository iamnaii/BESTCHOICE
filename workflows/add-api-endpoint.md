# Workflow: เพิ่ม API Endpoint ใน Module ที่มีอยู่

## Objective
เพิ่ม route ใหม่ใน controller/service ที่มีอยู่แล้ว โดยไม่ต้องสร้าง module ใหม่

## Required Inputs
- Module ที่จะเพิ่ม endpoint
- HTTP method + path
- Request/Response format
- Roles ที่เข้าถึงได้

## Steps

### 1. ตรวจสอบ Module ที่มีอยู่
- อ่าน controller + service ของ module นั้น
- ตรวจว่า endpoint ที่ต้องการไม่มีอยู่แล้ว
- เข้าใจ patterns ที่ module นั้นใช้

### 2. สร้าง DTO (ถ้าจำเป็น)
- เพิ่มใน `dto/` directory ของ module
- ใช้ `class-validator` decorators
- Thai validation messages

### 3. เพิ่ม Method ใน Service
```typescript
async newMethod(params: NewDto): Promise<ReturnType> {
  // Prisma query
  // Business logic
  // Error handling
}
```

### 4. เพิ่ม Route ใน Controller
```typescript
@Post('new-path')
@Roles('OWNER', 'BRANCH_MANAGER')
async newEndpoint(@Body() dto: NewDto, @Req() req) {
  return this.service.newMethod(dto);
}
```
- เลือก HTTP method ที่เหมาะสม (GET/POST/PATCH/DELETE)
- เพิ่ม `@Roles()` ถ้าต้อง restrict access
- ใช้ `@Param()`, `@Query()`, `@Body()` ตามกรณี

### 5. ทดสอบ
```bash
cd apps/api && npx tsc --noEmit
```
- Test endpoint ด้วย curl หรือ Playwright

## Patterns
- **Pagination**: `@Query('page') page = 1, @Query('limit') limit = 50`
- **Search**: `@Query('search') search?: string`
- **File upload**: `@UseInterceptors(FileInterceptor('file'))` + `@UploadedFile()`
- **Response format**: return object directly (NestJS จะ serialize เป็น JSON)
- **Error**: throw `NotFoundException`, `BadRequestException`, `ConflictException`

## Output
- Endpoint ใหม่ทำงานได้
- TypeScript compile ผ่าน
- ไม่กระทบ endpoints เดิม
