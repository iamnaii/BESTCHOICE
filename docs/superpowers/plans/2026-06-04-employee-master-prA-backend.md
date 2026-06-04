# Employee Master — PR-A (Backend Master) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the backend of the Employee Master — an `EmployeeProfile` (1:1 with `User`) plus an `employees` NestJS module (CRUD + a PII-safe `pickable` endpoint) that later PRs (frontend, payroll link) build on.

**Architecture:** New `EmployeeProfile` table keyed by `userId @unique` holds payroll/employment data (position, employmentType, baseSalary, ssoEligible, bank, taxIdOverride, resignedDate). Identity/PII (`name`, `nationalId`, `startDate`…) stays on the existing `User`. `nationalId` is returned only via OWNER/ACCOUNTANT endpoints (masked in list, full in detail) and **never** via `pickable`. This PR does NOT touch payroll (that is PR-C).

**Tech Stack:** NestJS + Prisma + PostgreSQL. Jest (run `--runInBand`). class-validator (Thai messages). Pattern reference: `apps/api/src/modules/contacts/`.

**Spec:** `docs/superpowers/specs/2026-06-04-employee-master-design.md` (§2 data model, §4.1 API, §6 testing). Scope of THIS plan = PR-A only.

**Branch:** `feat/employee-master` (already created off main).

---

## File Structure (PR-A)

- Modify: `apps/api/prisma/schema.prisma` — add `EmploymentType` enum, `EmployeeProfile` model, `User.employeeProfile` back-relation
- Create: `apps/api/prisma/migrations/<ts>_add_employee_profile/migration.sql` (generated)
- Create: `apps/api/src/modules/employees/dto/create-employee.dto.ts`
- Create: `apps/api/src/modules/employees/dto/update-employee.dto.ts`
- Create: `apps/api/src/modules/employees/dto/list-employees.dto.ts`
- Create: `apps/api/src/modules/employees/employees.service.ts`
- Create: `apps/api/src/modules/employees/employees.controller.ts`
- Create: `apps/api/src/modules/employees/employees.module.ts`
- Create: `apps/api/src/modules/employees/employees.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` — register `EmployeesModule`

**Audit actions:** `EMPLOYEE_PROFILE_CREATED` / `EMPLOYEE_PROFILE_UPDATED` / `EMPLOYEE_PROFILE_DELETED` (entity `employee_profile`).

---

## Task 1: Schema + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create (generated): `apps/api/prisma/migrations/<ts>_add_employee_profile/migration.sql`

- [ ] **Step 1: Add the enum + model to `schema.prisma`** (place enum near the other enums at top; model near `User`)

```prisma
enum EmploymentType {
  MONTHLY
  DAILY
  CONTRACT
}

model EmployeeProfile {
  id             String         @id @default(uuid())
  userId         String         @unique @map("user_id")
  user           User           @relation(fields: [userId], references: [id])
  position       String?
  employmentType EmploymentType @default(MONTHLY) @map("employment_type")
  baseSalary     Decimal?       @map("base_salary") @db.Decimal(12, 2)
  ssoEligible    Boolean        @default(true) @map("sso_eligible")
  bankName       String?        @map("bank_name")
  bankAccountNo  String?        @map("bank_account_no")
  taxIdOverride  String?        @map("tax_id_override")
  note           String?
  resignedDate   DateTime?      @map("resigned_date")
  createdAt      DateTime       @default(now()) @map("created_at")
  updatedAt      DateTime       @updatedAt @map("updated_at")
  deletedAt      DateTime?      @map("deleted_at")

  @@index([deletedAt])
  @@map("employee_profiles")
}
```

- [ ] **Step 2: Add the back-relation on `User`** — inside `model User { ... }` add one line alongside the other relations:

```prisma
  employeeProfile EmployeeProfile?
```

- [ ] **Step 3: Generate the migration**

Run (from `apps/api`): `npm run prisma:migrate -- --name add_employee_profile`
Expected: a new folder `apps/api/prisma/migrations/<timestamp>_add_employee_profile/` with `migration.sql` creating the `EmploymentType` enum + `employee_profiles` table + unique index on `user_id`; Prisma Client regenerates. No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(employees): EmployeeProfile schema + migration"
```

---

## Task 2: DTOs

**Files:**
- Create: `apps/api/src/modules/employees/dto/create-employee.dto.ts`
- Create: `apps/api/src/modules/employees/dto/update-employee.dto.ts`
- Create: `apps/api/src/modules/employees/dto/list-employees.dto.ts`

- [ ] **Step 1: Create `create-employee.dto.ts`**

```typescript
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { EmploymentType } from '@prisma/client';

export class CreateEmployeeDto {
  @IsUUID(undefined, { message: 'กรุณาเลือกผู้ใช้ (พนักงาน)' })
  userId!: string;

  @IsOptional()
  @IsString()
  position?: string;

  @IsOptional()
  @IsEnum(EmploymentType, { message: 'ประเภทการจ้างไม่ถูกต้อง' })
  employmentType?: EmploymentType;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'ฐานเงินเดือนต้องเป็นตัวเลข' })
  @Min(0, { message: 'ฐานเงินเดือนต้องไม่ติดลบ' })
  baseSalary?: number;

  @IsOptional()
  @IsBoolean()
  ssoEligible?: boolean;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  bankAccountNo?: string;

  @IsOptional()
  @IsString()
  taxIdOverride?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
```

- [ ] **Step 2: Create `update-employee.dto.ts`** (every field optional; resignedDate added)

```typescript
import { IsDateString, IsOptional } from 'class-validator';
import { CreateEmployeeDto } from './create-employee.dto';

// Update = all of Create's fields optional, minus userId (cannot reassign the
// owning user), plus resignedDate.
export class UpdateEmployeeDto implements Partial<Omit<CreateEmployeeDto, 'userId'>> {
  position?: string;
  employmentType?: CreateEmployeeDto['employmentType'];
  baseSalary?: number;
  ssoEligible?: boolean;
  bankName?: string;
  bankAccountNo?: string;
  taxIdOverride?: string;
  note?: string;

  @IsOptional()
  @IsDateString({}, { message: 'วันที่ลาออกไม่ถูกต้อง' })
  resignedDate?: string;
}
```

> Note: validators on the inherited fields come from a hand-written body here for clarity. If the repo uses `@nestjs/mapped-types` `PartialType` elsewhere, prefer `extends PartialType(OmitType(CreateEmployeeDto, ['userId']))` + add `resignedDate`. Check `apps/api/src/modules/*/dto` for an existing `PartialType` usage before choosing; mirror it.

- [ ] **Step 3: Create `list-employees.dto.ts`**

```typescript
import { IsBooleanString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListEmployeesDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsBooleanString()
  isActive?: string; // 'true' | 'false' — by EmployeeProfile.deletedAt + resigned

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/employees/dto
git commit -m "feat(employees): DTOs (create/update/list) with Thai validation"
```

---

## Task 3: Service — `provision` (create) with audit + P2002

**Files:**
- Create: `apps/api/src/modules/employees/employees.service.ts`
- Create: `apps/api/src/modules/employees/employees.service.spec.ts`

- [ ] **Step 1: Write the failing test** (`employees.service.spec.ts`)

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('EmployeesService', () => {
  let service: EmployeesService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findFirst: jest.fn() },
      employeeProfile: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
    };
    audit = { log: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(EmployeesService);
  });

  describe('provision', () => {
    it('rejects when the user does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.provision({ userId: 'u-x' })).rejects.toThrow(NotFoundException);
    });

    it('creates a profile + writes EMPLOYEE_PROFILE_CREATED audit', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u-1', name: 'สมชาย' });
      prisma.employeeProfile.create.mockResolvedValue({ id: 'e-1', userId: 'u-1' });
      const res = await service.provision({ userId: 'u-1', position: 'ช่าง' }, { userId: 'admin' });
      expect(prisma.employeeProfile.create).toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EMPLOYEE_PROFILE_CREATED', entity: 'employee_profile', entityId: 'e-1' }),
      );
      expect(res.id).toBe('e-1');
    });

    it('maps a duplicate (P2002) to ConflictException', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u-1' });
      prisma.employeeProfile.create.mockRejectedValue({ code: 'P2002' });
      await expect(service.provision({ userId: 'u-1' })).rejects.toThrow(ConflictException);
    });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run (from `apps/api`): `npm test -- --runInBand src/modules/employees/employees.service.spec.ts`
Expected: FAIL — `Cannot find module './employees.service'`.

- [ ] **Step 3: Write minimal `employees.service.ts`**

```typescript
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';

type Actor = { userId?: string; ipAddress?: string; userAgent?: string };

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async provision(dto: CreateEmployeeDto, actor?: Actor) {
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้ที่จะตั้งเป็นพนักงาน');

    try {
      const profile = await this.prisma.employeeProfile.create({
        data: {
          userId: dto.userId,
          position: dto.position,
          employmentType: dto.employmentType,
          baseSalary: dto.baseSalary != null ? new Prisma.Decimal(dto.baseSalary) : null,
          ssoEligible: dto.ssoEligible,
          bankName: dto.bankName,
          bankAccountNo: dto.bankAccountNo,
          taxIdOverride: dto.taxIdOverride,
          note: dto.note,
        },
      });
      await this.audit.log({
        userId: actor?.userId,
        action: 'EMPLOYEE_PROFILE_CREATED',
        entity: 'employee_profile',
        entityId: profile.id,
        newValue: { userId: dto.userId, position: dto.position },
        ipAddress: actor?.ipAddress,
        userAgent: actor?.userAgent,
      });
      return profile;
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ConflictException('พนักงานคนนี้มีทะเบียนแล้ว');
      }
      throw e;
    }
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test -- --runInBand src/modules/employees/employees.service.spec.ts`
Expected: PASS (3 tests in `provision`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/employees/employees.service.ts apps/api/src/modules/employees/employees.service.spec.ts
git commit -m "feat(employees): service.provision with audit + P2002 conflict"
```

---

## Task 4: Service — `list` (masked nationalId) + `findOne` (full)

**Files:**
- Modify: `apps/api/src/modules/employees/employees.service.ts`
- Modify: `apps/api/src/modules/employees/employees.service.spec.ts`

- [ ] **Step 1: Add the failing tests** (append inside the top-level `describe`)

```typescript
  describe('list', () => {
    it('filters out soft-deleted, masks nationalId, returns paginated shape', async () => {
      prisma.employeeProfile.findMany.mockResolvedValue([
        { id: 'e-1', position: 'ช่าง', employmentType: 'MONTHLY', deletedAt: null,
          user: { id: 'u-1', name: 'สมชาย', nickname: 'ชาย', employeeId: 'EMP-001',
            nationalId: '1100700000001', branchId: 'b1', isActive: true } },
      ]);
      prisma.employeeProfile.count.mockResolvedValue(1);
      const res = await service.list({ page: 1, limit: 50 });
      expect(prisma.employeeProfile.findMany.mock.calls[0][0].where.deletedAt).toBeNull();
      expect(res).toEqual(expect.objectContaining({ total: 1, page: 1, limit: 50 }));
      // masked: only last 4 visible
      expect(res.data[0].nationalId).toBe('•••••••••0001');
    });
  });

  describe('findOne', () => {
    it('throws NotFound when missing', async () => {
      prisma.employeeProfile.findFirst.mockResolvedValue(null);
      await expect(service.findOne('e-x')).rejects.toThrow(NotFoundException);
    });
    it('returns full nationalId on detail', async () => {
      prisma.employeeProfile.findFirst.mockResolvedValue({
        id: 'e-1', deletedAt: null,
        user: { id: 'u-1', name: 'สมชาย', nationalId: '1100700000001' },
      });
      const res = await service.findOne('e-1');
      expect(res.user.nationalId).toBe('1100700000001');
    });
  });
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- --runInBand src/modules/employees/employees.service.spec.ts`
Expected: FAIL — `service.list is not a function`.

- [ ] **Step 3: Implement `list` + `findOne` + a mask helper** (add to the service class; add `ListEmployeesDto` import)

```typescript
  // add import at top:
  // import { ListEmployeesDto } from './dto/list-employees.dto';

  private maskNationalId(v: string | null): string | null {
    if (!v) return v;
    return '•••••••••' + v.slice(-4);
  }

  private userSelect = {
    id: true, name: true, nickname: true, employeeId: true,
    nationalId: true, startDate: true, branchId: true, isActive: true,
  };

  async list(dto: ListEmployeesDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;
    const where: Prisma.EmployeeProfileWhereInput = { deletedAt: null };
    if (dto.isActive === 'true') where.resignedDate = null;
    if (dto.search) {
      where.user = {
        OR: [
          { name: { contains: dto.search, mode: 'insensitive' } },
          { nickname: { contains: dto.search, mode: 'insensitive' } },
          { employeeId: { contains: dto.search, mode: 'insensitive' } },
        ],
      };
    }
    const [rows, total] = await Promise.all([
      this.prisma.employeeProfile.findMany({
        where,
        include: { user: { select: this.userSelect } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.employeeProfile.count({ where }),
    ]);
    const data = rows.map((r) => ({
      ...r,
      nationalId: this.maskNationalId(r.user.nationalId),
      user: { ...r.user, nationalId: this.maskNationalId(r.user.nationalId) },
    }));
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const profile = await this.prisma.employeeProfile.findFirst({
      where: { id, deletedAt: null },
      include: { user: { select: this.userSelect } },
    });
    if (!profile) throw new NotFoundException('ไม่พบทะเบียนพนักงาน');
    return profile; // full nationalId — endpoint is OWNER/ACCOUNTANT only
  }
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- --runInBand src/modules/employees/employees.service.spec.ts`
Expected: PASS (list + findOne tests green).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/employees/employees.service.ts apps/api/src/modules/employees/employees.service.spec.ts
git commit -m "feat(employees): list (masked nationalId) + findOne (full)"
```

---

## Task 5: Service — `update` + `remove` (soft-delete) with audit

**Files:** modify service + spec.

- [ ] **Step 1: Add failing tests**

```typescript
  describe('update', () => {
    it('updates fields + audits EMPLOYEE_PROFILE_UPDATED', async () => {
      prisma.employeeProfile.findFirst.mockResolvedValue({ id: 'e-1', deletedAt: null,
        user: { id: 'u-1', name: 'สมชาย', nationalId: '1100700000001' } });
      prisma.employeeProfile.update.mockResolvedValue({ id: 'e-1', position: 'หัวหน้า' });
      await service.update('e-1', { position: 'หัวหน้า' }, { userId: 'admin' });
      expect(prisma.employeeProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'e-1' } }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EMPLOYEE_PROFILE_UPDATED', entityId: 'e-1' }),
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes + audits EMPLOYEE_PROFILE_DELETED', async () => {
      prisma.employeeProfile.findFirst.mockResolvedValue({ id: 'e-1', deletedAt: null,
        user: { id: 'u-1', name: 'สมชาย', nationalId: '1100700000001' } });
      prisma.employeeProfile.update.mockResolvedValue({ id: 'e-1', deletedAt: new Date() });
      await service.remove('e-1', { userId: 'admin' });
      const call = prisma.employeeProfile.update.mock.calls.at(-1)[0];
      expect(call.data.deletedAt).toBeInstanceOf(Date);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EMPLOYEE_PROFILE_DELETED', entityId: 'e-1' }),
      );
    });
  });
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- --runInBand src/modules/employees/employees.service.spec.ts`
Expected: FAIL — `service.update is not a function`.

- [ ] **Step 3: Implement** (add `UpdateEmployeeDto` import; reuse `findOne`)

```typescript
  // import { UpdateEmployeeDto } from './dto/update-employee.dto';

  async update(id: string, dto: UpdateEmployeeDto, actor?: Actor) {
    await this.findOne(id); // 404 if missing/deleted
    const profile = await this.prisma.employeeProfile.update({
      where: { id },
      data: {
        position: dto.position,
        employmentType: dto.employmentType,
        baseSalary: dto.baseSalary != null ? new Prisma.Decimal(dto.baseSalary) : undefined,
        ssoEligible: dto.ssoEligible,
        bankName: dto.bankName,
        bankAccountNo: dto.bankAccountNo,
        taxIdOverride: dto.taxIdOverride,
        note: dto.note,
        resignedDate: dto.resignedDate ? new Date(dto.resignedDate) : undefined,
      },
    });
    await this.audit.log({
      userId: actor?.userId,
      action: 'EMPLOYEE_PROFILE_UPDATED',
      entity: 'employee_profile',
      entityId: id,
      newValue: dto as Record<string, unknown>,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });
    return profile;
  }

  async remove(id: string, actor?: Actor) {
    await this.findOne(id);
    const profile = await this.prisma.employeeProfile.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      userId: actor?.userId,
      action: 'EMPLOYEE_PROFILE_DELETED',
      entity: 'employee_profile',
      entityId: id,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });
    return profile;
  }
```

- [ ] **Step 4: Run, verify pass** — `npm test -- --runInBand src/modules/employees/employees.service.spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/employees/employees.service.ts apps/api/src/modules/employees/employees.service.spec.ts
git commit -m "feat(employees): update + soft-delete with audit"
```

---

## Task 6: Service — `pickable` (no PII, resigned filter)

**Files:** modify service + spec.

- [ ] **Step 1: Add failing tests**

```typescript
  describe('pickable', () => {
    it('returns active employees WITHOUT nationalId, excludes resigned/deleted', async () => {
      prisma.employeeProfile.findMany.mockResolvedValue([
        { id: 'e-1', baseSalary: '15000', ssoEligible: true,
          user: { id: 'u-1', name: 'สมชาย', nickname: 'ชาย', employeeId: 'EMP-001' } },
      ]);
      const res = await service.pickable('สม');
      const where = prisma.employeeProfile.findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();
      // resigned filter present
      expect(where.OR ?? where.resignedDate).toBeDefined();
      // response shape carries NO nationalId
      expect(res[0]).toEqual(
        expect.objectContaining({ userId: 'u-1', name: 'สมชาย', baseSalary: '15000', ssoEligible: true }),
      );
      expect(JSON.stringify(res)).not.toContain('nationalId');
    });
  });
```

- [ ] **Step 2: Run, verify fail** — `service.pickable is not a function`.

- [ ] **Step 3: Implement**

```typescript
  async pickable(search?: string) {
    const where: Prisma.EmployeeProfileWhereInput = {
      deletedAt: null,
      OR: [{ resignedDate: null }, { resignedDate: { gt: new Date() } }],
      user: { is: { isActive: true, deletedAt: null } },
    };
    if (search) {
      where.user = {
        is: {
          isActive: true,
          deletedAt: null,
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { nickname: { contains: search, mode: 'insensitive' } },
            { employeeId: { contains: search, mode: 'insensitive' } },
          ],
        },
      };
    }
    const rows = await this.prisma.employeeProfile.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, nickname: true, employeeId: true } },
      },
      orderBy: { user: { name: 'asc' } },
      take: 20,
    });
    // Explicit projection — NEVER include nationalId here (PII).
    return rows.map((r) => ({
      userId: r.user.id,
      employeeId: r.user.employeeId,
      name: r.user.name,
      nickname: r.user.nickname,
      baseSalary: r.baseSalary, // Decimal → string in JSON; FE parseFloat
      ssoEligible: r.ssoEligible,
    }));
  }
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/employees/employees.service.ts apps/api/src/modules/employees/employees.service.spec.ts
git commit -m "feat(employees): pickable endpoint (PII-safe, resigned filter)"
```

---

## Task 7: Controller + module + registration

**Files:**
- Create: `apps/api/src/modules/employees/employees.controller.ts`
- Create: `apps/api/src/modules/employees/employees.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create `employees.controller.ts`**

```typescript
import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { ListEmployeesDto } from './dto/list-employees.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

type AuthRequest = Request & { user?: { id: string; role: string } };
const actorOf = (req: AuthRequest) => ({
  userId: req.user?.id,
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'] as string | undefined,
});

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @Roles('OWNER', 'ACCOUNTANT')
  list(@Query() dto: ListEmployeesDto) {
    return this.employees.list(dto);
  }

  @Get('pickable')
  @Roles('OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER')
  pickable(@Query('search') search?: string) {
    return this.employees.pickable(search);
  }

  @Get(':id')
  @Roles('OWNER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.employees.findOne(id);
  }

  @Post()
  @Roles('OWNER', 'ACCOUNTANT')
  provision(@Body() dto: CreateEmployeeDto, @Req() req: AuthRequest) {
    return this.employees.provision(dto, actorOf(req));
  }

  @Patch(':id')
  @Roles('OWNER', 'ACCOUNTANT')
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto, @Req() req: AuthRequest) {
    return this.employees.update(id, dto, actorOf(req));
  }

  @Delete(':id')
  @Roles('OWNER', 'ACCOUNTANT')
  remove(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.employees.remove(id, actorOf(req));
  }
}
```

> Route ordering: `@Get('pickable')` is declared BEFORE `@Get(':id')` so `/employees/pickable` is not captured by the `:id` param route.

- [ ] **Step 2: Create `employees.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

// PrismaModule + AuditModule are @Global() — no explicit import needed here
// (mirrors contacts.module.ts).
@Module({
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
```

> Before running, verify `AuditModule` is `@Global()` (grep `@Global` in `apps/api/src/modules/audit/audit.module.ts`). If it is NOT global, add `imports: [AuditModule]` to this module.

- [ ] **Step 3: Register in `app.module.ts`**

Add the import near the other module imports, and add `EmployeesModule` to the `imports` array:

```typescript
import { EmployeesModule } from './modules/employees/employees.module';
// ... in @Module({ imports: [ ... , EmployeesModule, ... ] })
```

- [ ] **Step 4: Typecheck**

Run (from repo root): `./tools/check-types.sh api`
Expected: `API: OK` / passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/employees apps/api/src/app.module.ts
git commit -m "feat(employees): controller + module + app registration"
```

---

## Task 8: Full suite + open PR

- [ ] **Step 1: Run the employees suite + a quick broad sanity check**

Run (from `apps/api`): `npm test -- --runInBand src/modules/employees`
Expected: all green.

- [ ] **Step 2: Typecheck whole API**

Run: `./tools/check-types.sh api` → OK.

- [ ] **Step 3: Push + open PR (leave merge to owner, per project workflow)**

```bash
git push -u origin feat/employee-master
gh pr create --base main --head feat/employee-master \
  --title "feat(employees): Employee Master backend — EmployeeProfile + employees module (PR-A)" \
  --body "Implements PR-A of the Employee Master spec (docs/superpowers/specs/2026-06-04-employee-master-design.md): EmployeeProfile (1:1 User) + employees module (CRUD + PII-safe pickable). No payroll changes (PR-C). nationalId never returned by pickable; masked in list, full in OWNER/ACCOUNTANT detail. Tests: employees.service.spec --runInBand green; api tsc OK."
```

> After this PR merges, write the PR-B plan (frontend master page + EmployeeCombobox).

---

## Self-Review checklist (done while writing)

- **Spec coverage (PR-A scope):** EmployeeProfile model ✅ (Task 1); enum ✅; migration ✅; module CRUD ✅ (Tasks 3-7); pickable no-nationalId + resigned filter ✅ (Task 6); masked list / full detail ✅ (Task 4); RBAC OWNER/ACC (+FM pickable) ✅ (Task 7); audit create/update/delete ✅; P2002 conflict ✅. Payroll link, frontend, backfill = OUT of PR-A (PR-C/B/D).
- **Placeholders:** none — every step has real code + exact commands.
- **Type consistency:** service methods `provision/list/findOne/update/remove/pickable` match controller calls; DTO field names match service `data:` keys; `userSelect`/`maskNationalId` reused consistently.
- **Assumptions verified (2026-06-04):** ✅ `AuditModule` is `@Global()` (audit.module.ts:8) — no import needed. ✅ `AuditService.log(entry)` takes `{ userId?, action, entity, entityId?, oldValue?, newValue?, ipAddress?, userAgent? }` (audit.service.ts:58 + AuditEntry interface) — matches the plan's calls exactly. NB: `log()` early-returns when `userId` is falsy (audit.service.ts:60), so always pass a real actor.userId in runtime callers (the controller does via `actorOf(req)`).
- **Still verify at execution:** whether the repo prefers `PartialType` (from `@nestjs/mapped-types`) for UpdateDto — grep `PartialType` in `apps/api/src/modules/*/dto`; if common, refactor `UpdateEmployeeDto` to `PartialType(OmitType(CreateEmployeeDto, ['userId']))` + `resignedDate`.
