# Workflow: สร้าง NestJS API Module ใหม่

## Objective
สร้าง feature module ครบชุด (module, controller, service, dto) ตาม pattern ของโปรเจค

## Required Inputs
- ชื่อ module (เช่น `warranties`)
- Prisma model ที่เกี่ยวข้อง (ต้องมีอยู่ใน schema แล้ว)
- Roles ที่เข้าถึงได้
- CRUD operations ที่ต้องการ

## Reference
ใช้ `apps/api/src/modules/customers/` เป็น template:
- `customers.module.ts` — Module definition
- `customers.controller.ts` — HTTP endpoints with guards
- `customers.service.ts` — Business logic + Prisma queries
- `dto/customer.dto.ts` — Validation DTOs

## Steps

### 1. ตรวจสอบก่อนสร้าง
- ค้นหาว่ามี module ที่ทำงานคล้ายกันอยู่แล้วหรือไม่
- ตรวจว่า Prisma model มีอยู่ใน `apps/api/prisma/schema.prisma`
- ถ้ายังไม่มี model → ทำ `workflows/prisma-changes.md` ก่อน

### 2. สร้าง DTO (`dto/<name>.dto.ts`)
```typescript
import { IsString, IsOptional, Length } from 'class-validator';

export class CreateXxxDto {
  @IsString({ message: 'กรุณาระบุ...' })
  field: string;
}

export class UpdateXxxDto {
  @IsOptional()
  @IsString()
  field?: string;
}
```
- ใช้ `class-validator` decorators
- Thai language validation messages
- แยก Create/Update DTOs

### 3. สร้าง Service (`<name>.service.ts`)
```typescript
@Injectable()
export class XxxService {
  constructor(private prisma: PrismaService) {}

  async findAll(params: { search?: string; page?: number; limit?: number }) {
    // Prisma findMany with pagination
  }

  async findOne(id: string) {
    // findUnique + NotFoundException
  }

  async create(dto: CreateXxxDto, userId: string) {
    // prisma.create
  }

  async update(id: string, dto: UpdateXxxDto) {
    // prisma.update
  }

  async remove(id: string) {
    // Soft delete: update deletedAt
  }
}
```
- Inject `PrismaService` via constructor
- ใช้ soft delete (`deletedAt`) ไม่ใช่ hard delete
- Throw `NotFoundException`, `ConflictException` ตามกรณี

### 4. สร้าง Controller (`<name>.controller.ts`)
```typescript
@Controller('<name>')
@UseGuards(JwtAuthGuard, RolesGuard)
export class XxxController {
  constructor(private readonly xxxService: XxxService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER')
  findAll(@Query('search') search?: string, @Query('page') page?: number) {}

  @Get(':id')
  findOne(@Param('id') id: string) {}

  @Post()
  create(@Body() dto: CreateXxxDto, @Req() req) {}

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateXxxDto) {}

  @Delete(':id')
  @Roles('OWNER')
  remove(@Param('id') id: string) {}
}
```
- `@UseGuards(JwtAuthGuard, RolesGuard)` บน class
- `@Roles()` บน method ที่ต้อง restrict
- Pagination: default page=1, limit=50

### 5. สร้าง Module (`<name>.module.ts`)
```typescript
@Module({
  controllers: [XxxController],
  providers: [XxxService],
  exports: [XxxService],
})
export class XxxModule {}
```

### 6. Register ใน AppModule
- เพิ่ม import ใน `apps/api/src/app.module.ts`
- เพิ่มใน `imports` array

### 7. ทดสอบ
- `cd apps/api && npx tsc --noEmit` — ตรวจ TypeScript
- ทดสอบ API endpoints ด้วย curl

## Edge Cases
- **ชื่อซ้ำ**: ตรวจว่าไม่มี module ชื่อเดียวกัน
- **Relations**: ถ้า model มี relation กับ model อื่น ต้อง import module ที่เกี่ยวข้อง
- **File upload**: ถ้ามี file upload ต้องใช้ `@UseInterceptors(FileInterceptor)` + StorageService
- **Audit**: AuditInterceptor จะ log ให้อัตโนมัติ (global interceptor)

## Output
- `apps/api/src/modules/<name>/` directory ครบชุด
- Module registered ใน app.module.ts
- TypeScript compile ผ่าน
