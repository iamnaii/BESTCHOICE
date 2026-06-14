# รวมผู้ใช้ + พนักงาน เข้าเป็น /users — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** รวมการจัดการบัญชีล็อกอิน (`/users`) กับโปรไฟล์ HR/เงินเดือน (`/settings#employees` + standalone `/employees`) ให้เป็นหน้าเดียว OWNER-only ที่ `/users` พร้อมหน้ารายละเอียด `/users/:id` แบบ 3 แท็บ และปุ่มบันทึกเดียวแบบ atomic

**Architecture:** คง data model เดิม (`User` 1:optional `EmployeeProfile`). เพิ่ม backend endpoint รวมที่ wrap User-update + EmployeeProfile-upsert ใน `$transaction` เดียว. Frontend เพิ่มหน้า `UserDetailPage` (3 แท็บ) แทน modal/dialog เดิม แล้วถอด UI พนักงานเก่า (settings tab, standalone route, dialogs, menu) ออก. คง `/employees/pickable` + `lib/api/employees.ts` ไว้เพราะ `EmployeeCombobox` ใช้

**Tech Stack:** NestJS + Prisma + jest (API), React 18 + Vite + react-router + TanStack Query + vitest (Web). อ้างอิง spec: `docs/superpowers/specs/2026-06-14-users-employees-merge-design.md`

**คำสั่งทดสอบ:**
- API หนึ่งไฟล์: `cd apps/api && npx jest src/modules/users/__tests__/<file> --runInBand`
- Web หนึ่งไฟล์: `cd apps/web && npx vitest run src/pages/UsersPage/__tests__/<file>`
- Types: `./tools/check-types.sh all`

> ⚠️ รัน API service specs ด้วย `--runInBand` เสมอ (multi-suite parallel-DB flaky — ดู memory)

---

## โครงสร้างไฟล์

**Backend (สร้าง/แก้):**
- `apps/api/src/modules/users/dto/employee-profile-input.dto.ts` — สร้าง: nested DTO ของบล็อก employee
- `apps/api/src/modules/users/dto/update-user-profile.dto.ts` — สร้าง: `UpdateUserDto` + `employee`
- `apps/api/src/modules/users/dto/create-user.dto.ts` — แก้: + `employee?`
- `apps/api/src/modules/employees/employees.service.ts` — แก้: + `upsertProfileTx()`
- `apps/api/src/modules/employees/employees.controller.ts` — แก้: roles → OWNER (คง pickable)
- `apps/api/src/modules/users/users.service.ts` — แก้: + `findOneFull`, `updateFull`, join employeeProfile ใน list, create รับ employee
- `apps/api/src/modules/users/users.controller.ts` — แก้: + `GET :id`, `PUT :id/profile`, ส่ง actor
- `apps/api/src/modules/users/users.module.ts` — แก้: import EmployeesModule (เพื่อ inject EmployeesService)

**Frontend (สร้าง/แก้/ลบ):**
- `apps/web/src/lib/api/users.ts` — สร้าง: client + types หน้า detail
- `apps/web/src/pages/UsersPage/UserDetailPage.tsx` — สร้าง: หน้า 3 แท็บ
- `apps/web/src/pages/UsersPage/components/PersonalFields.tsx` — สร้าง: ฟิลด์บุคคล + avatar + card reader (แยกจาก UserForm)
- `apps/web/src/pages/UsersPage/index.tsx` — แก้: row→detail, ปุ่ม→/users/new
- `apps/web/src/pages/UsersPage/components/UserTable.tsx` — แก้: + คอลัมน์ HR, row click → navigate
- `apps/web/src/pages/UsersPage/types.ts` — แก้: + `employeeProfile` บน `User`
- `apps/web/src/App.tsx` — แก้: + route `/users/:id`,`/users/new`; − route `/employees`
- `apps/web/src/pages/SettingsPage/index.tsx` — แก้: − แท็บ employees
- `apps/web/src/config/menu.ts` — แก้: − "พนักงาน"; rename "ผู้ใช้"→"ผู้ใช้ / พนักงาน"
- ลบ: `apps/web/src/pages/EmployeesPage.tsx`, `apps/web/src/pages/SettingsPage/tabs/EmployeesTab.tsx`, `apps/web/src/components/employees/ProvisionEmployeeDialog.tsx`, `apps/web/src/components/employees/EditEmployeeDialog.tsx`
- ลบ/แก้ test: `apps/web/src/pages/__tests__/EmployeesPage.test.tsx`, `apps/web/src/pages/SettingsPage/__tests__/SettingsPage.test.tsx`

---

# PHASE A — Backend

## Task 1: DTO บล็อก employee + DTO รวม

**Files:**
- Create: `apps/api/src/modules/users/dto/employee-profile-input.dto.ts`
- Create: `apps/api/src/modules/users/dto/update-user-profile.dto.ts`
- Modify: `apps/api/src/modules/users/dto/create-user.dto.ts`

- [ ] **Step 1: สร้าง `employee-profile-input.dto.ts`**

```ts
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min, IsDateString } from 'class-validator';
import { EmploymentType } from '@prisma/client';

export class EmployeeProfileInputDto {
  @IsOptional() @IsString()
  position?: string;

  @IsOptional() @IsEnum(EmploymentType, { message: 'ประเภทการจ้างไม่ถูกต้อง' })
  employmentType?: EmploymentType;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'ฐานเงินเดือนต้องเป็นตัวเลข' })
  @Min(0, { message: 'ฐานเงินเดือนต้องไม่ติดลบ' })
  baseSalary?: number;

  @IsOptional() @IsBoolean()
  ssoEligible?: boolean;

  @IsOptional() @IsString()
  bankName?: string;

  @IsOptional() @IsString()
  bankAccountNo?: string;

  // null = ยกเลิกสถานะลาออก (กลับมาทำงาน); undefined = ไม่แตะ
  @IsOptional() @IsDateString()
  resignedDate?: string | null;
}
```

- [ ] **Step 2: สร้าง `update-user-profile.dto.ts`**

```ts
import { IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateUserDto } from './update-user.dto';
import { EmployeeProfileInputDto } from './employee-profile-input.dto';

export class UpdateUserProfileDto extends UpdateUserDto {
  // null/undefined = ไม่แตะโปรไฟล์ HR; object = upsert (create ถ้ายังไม่มี / update ถ้ามี)
  @IsOptional()
  @ValidateNested()
  @Type(() => EmployeeProfileInputDto)
  employee?: EmployeeProfileInputDto | null;
}
```

- [ ] **Step 3: แก้ `create-user.dto.ts` — เพิ่มบล็อก employee (ต่อท้าย ก่อนปิด class)**

เพิ่ม import ด้านบน:
```ts
import { ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { EmployeeProfileInputDto } from './employee-profile-input.dto';
```
เพิ่ม field ก่อน `}` ปิด class:
```ts
  @IsOptional()
  @ValidateNested()
  @Type(() => EmployeeProfileInputDto)
  employee?: EmployeeProfileInputDto;
```

- [ ] **Step 4: ตรวจ types**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/users/dto
git commit -m "feat(users): add combined user+employee DTOs"
```

---

## Task 2: EmployeesService.upsertProfileTx (tx-aware)

ฟังก์ชันนี้ทำ create-or-update `EmployeeProfile` โดยรับ Prisma transaction client เพื่อให้รวมใน tx เดียวกับ user update ได้ — คง audit + แปลง Decimal เหมือน `provision`/`update` เดิม

**Files:**
- Modify: `apps/api/src/modules/employees/employees.service.ts`
- Test: `apps/api/src/modules/employees/__tests__/employees-upsert-tx.spec.ts`

- [ ] **Step 1: เขียน test ที่ fail ก่อน**

```ts
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { EmployeesService } from '../employees.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

describe('EmployeesService.upsertProfileTx', () => {
  let svc: EmployeesService;
  const tx = {
    employeeProfile: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as Prisma.TransactionClient;
  const audit = { log: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: PrismaService, useValue: {} },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    svc = mod.get(EmployeesService);
  });

  it('creates a profile when none exists', async () => {
    (tx.employeeProfile.findFirst as jest.Mock).mockResolvedValue(null);
    (tx.employeeProfile.create as jest.Mock).mockResolvedValue({ id: 'p1' });

    await svc.upsertProfileTx(tx, 'u1', { position: 'sales', baseSalary: 25000 }, { userId: 'owner' });

    expect(tx.employeeProfile.create).toHaveBeenCalledTimes(1);
    const arg = (tx.employeeProfile.create as jest.Mock).mock.calls[0][0];
    expect(arg.data.userId).toBe('u1');
    expect(arg.data.baseSalary).toBeInstanceOf(Prisma.Decimal);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EMPLOYEE_PROFILE_CREATED', entity: 'employee_profile' }),
    );
  });

  it('updates the existing profile', async () => {
    (tx.employeeProfile.findFirst as jest.Mock).mockResolvedValue({ id: 'p1' });
    (tx.employeeProfile.update as jest.Mock).mockResolvedValue({ id: 'p1' });

    await svc.upsertProfileTx(tx, 'u1', { position: 'cashier' }, { userId: 'owner' });

    expect(tx.employeeProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' } }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EMPLOYEE_PROFILE_UPDATED' }),
    );
  });
});
```

- [ ] **Step 2: รัน test ให้ fail**

Run: `cd apps/api && npx jest src/modules/employees/__tests__/employees-upsert-tx.spec.ts --runInBand`
Expected: FAIL — `svc.upsertProfileTx is not a function`

- [ ] **Step 3: เพิ่ม method ใน `employees.service.ts`** (ใส่หลัง `remove()` ก่อน `pickable()`)

```ts
  /**
   * Create-or-update an EmployeeProfile inside an EXTERNAL transaction so the
   * caller (UsersService.updateFull / create) can bundle it with the User
   * write atomically. Mirrors provision()/update() field handling + audit.
   */
  async upsertProfileTx(
    tx: Prisma.TransactionClient,
    userId: string,
    dto: {
      position?: string;
      employmentType?: Prisma.EmployeeProfileCreateInput['employmentType'];
      baseSalary?: number;
      ssoEligible?: boolean;
      bankName?: string;
      bankAccountNo?: string;
      resignedDate?: string | null;
    },
    actor?: Actor,
  ) {
    const existing = await tx.employeeProfile.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });

    const baseSalary =
      dto.baseSalary != null ? new Prisma.Decimal(dto.baseSalary) : undefined;
    const resignedDate =
      dto.resignedDate === undefined
        ? undefined
        : dto.resignedDate
          ? new Date(dto.resignedDate)
          : null;

    if (existing) {
      const profile = await tx.employeeProfile.update({
        where: { id: existing.id },
        data: {
          position: dto.position,
          employmentType: dto.employmentType,
          baseSalary,
          ssoEligible: dto.ssoEligible,
          bankName: dto.bankName,
          bankAccountNo: dto.bankAccountNo,
          resignedDate,
        },
      });
      await this.audit.log({
        userId: actor?.userId,
        action: 'EMPLOYEE_PROFILE_UPDATED',
        entity: 'employee_profile',
        entityId: existing.id,
        newValue: dto as Record<string, unknown>,
        ipAddress: actor?.ipAddress,
        userAgent: actor?.userAgent,
      });
      return profile;
    }

    const profile = await tx.employeeProfile.create({
      data: {
        userId,
        position: dto.position,
        employmentType: dto.employmentType,
        baseSalary: baseSalary ?? null,
        ssoEligible: dto.ssoEligible,
        bankName: dto.bankName,
        bankAccountNo: dto.bankAccountNo,
        resignedDate: resignedDate ?? null,
      },
    });
    await this.audit.log({
      userId: actor?.userId,
      action: 'EMPLOYEE_PROFILE_CREATED',
      entity: 'employee_profile',
      entityId: profile.id,
      newValue: { userId, position: dto.position },
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });
    return profile;
  }
```

- [ ] **Step 4: รัน test ให้ผ่าน**

Run: `cd apps/api && npx jest src/modules/employees/__tests__/employees-upsert-tx.spec.ts --runInBand`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/employees
git commit -m "feat(employees): tx-aware upsertProfileTx for combined save"
```

---

## Task 3: UsersService — findOneFull, updateFull, list join, create+employee

**Files:**
- Modify: `apps/api/src/modules/users/users.service.ts`
- Modify: `apps/api/src/modules/users/users.module.ts`
- Test: `apps/api/src/modules/users/__tests__/users-update-full.spec.ts`

- [ ] **Step 1: ให้ UsersModule import EmployeesModule** (`users.module.ts`)

เพิ่ม import + ใส่ใน `imports: [...]`:
```ts
import { EmployeesModule } from '../employees/employees.module';
// @Module({ imports: [EmployeesModule, ...], ... })
```
(`EmployeesModule` มี `exports: [EmployeesService]` อยู่แล้ว — verified — จึง inject ข้ามโมดูลได้)

- [ ] **Step 2: เขียน test ที่ fail ก่อน**

```ts
import { Test } from '@nestjs/testing';
import { UsersService } from '../users.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { EmployeesService } from '../../employees/employees.service';

describe('UsersService.updateFull', () => {
  let svc: UsersService;
  const userUpdate = jest.fn().mockResolvedValue({ id: 'u1', isActive: false });
  const userFindUnique = jest.fn();
  const refreshUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
  const upsertProfileTx = jest.fn().mockResolvedValue({ id: 'p1' });

  const prisma = {
    user: { findUnique: userFindUnique },
    $transaction: jest.fn(async (cb: any) =>
      cb({
        user: { update: userUpdate },
        refreshToken: { updateMany: refreshUpdateMany },
      }),
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: EmployeesService, useValue: { upsertProfileTx } },
      ],
    }).compile();
    svc = mod.get(UsersService);
  });

  it('updates user + upserts employee in one transaction', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', isActive: true });
    await svc.updateFull('u1', { name: 'A', employee: { position: 'sales' } }, { userId: 'owner' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(upsertProfileTx).toHaveBeenCalledWith(
      expect.anything(), 'u1', { position: 'sales' }, expect.objectContaining({ userId: 'owner' }),
    );
  });

  it('revokes refresh tokens on deactivate (true→false)', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', isActive: true });
    await svc.updateFull('u1', { isActive: false }, { userId: 'owner' });
    expect(refreshUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
    );
  });

  it('does NOT touch employee profile when employee is null', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', isActive: true });
    await svc.updateFull('u1', { name: 'A', employee: null }, { userId: 'owner' });
    expect(upsertProfileTx).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: รัน test ให้ fail**

Run: `cd apps/api && npx jest src/modules/users/__tests__/users-update-full.spec.ts --runInBand`
Expected: FAIL — `svc.updateFull is not a function`

- [ ] **Step 4: แก้ `users.service.ts`**

4a. เพิ่ม import + inject EmployeesService:
```ts
import { EmployeesService } from '../employees/employees.service';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
// type actor (วางใกล้บนไฟล์):
type Actor = { userId?: string; ipAddress?: string; userAgent?: string };
```
แก้ constructor:
```ts
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private employees: EmployeesService,
  ) {}
```

4b. ใน `findAll` เพิ่ม employeeProfile ใน `select` (หลัง `branch: {...}`):
```ts
      employeeProfile: {
        select: { id: true, position: true, employmentType: true, resignedDate: true },
      },
```

4c. เพิ่ม `findOneFull` (ใส่หลัง `findAll`):
```ts
  async findOneFull(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null, email: { notIn: SYSTEM_USER_EMAILS } },
      select: {
        id: true, email: true, name: true, role: true, branchId: true,
        isActive: true, employeeId: true, nickname: true, phone: true,
        lineId: true, address: true, avatarUrl: true, startDate: true,
        nationalId: true, birthDate: true, lastLoginAt: true, createdAt: true,
        branch: { select: { id: true, name: true } },
        employeeProfile: {
          select: {
            id: true, position: true, employmentType: true, baseSalary: true,
            ssoEligible: true, bankName: true, bankAccountNo: true, resignedDate: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้งาน');
    return user; // full nationalId — OWNER-only endpoint
  }
```

4d. เพิ่ม `updateFull` (ใส่หลัง `update`). หมายเหตุ: คงพฤติกรรม revoke-token + ใช้ `$transaction`:
```ts
  async updateFull(id: string, dto: UpdateUserProfileDto, actor?: Actor) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้งาน');

    const isNowBeingDeactivated = dto.isActive === false && user.isActive === true;

    const data: Prisma.UserUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.role !== undefined) data.role = dto.role as UserRole;
    if (dto.branchId !== undefined) data.branchId = dto.branchId || null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.password) data.password = await bcrypt.hash(dto.password, 10);
    if (dto.employeeId !== undefined) data.employeeId = dto.employeeId || null;
    if (dto.nickname !== undefined) data.nickname = dto.nickname || null;
    if (dto.phone !== undefined) data.phone = dto.phone || null;
    if (dto.lineId !== undefined) data.lineId = dto.lineId || null;
    if (dto.address !== undefined) data.address = dto.address || null;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl || null;
    if (dto.startDate !== undefined) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.nationalId !== undefined) data.nationalId = dto.nationalId || null;
    if (dto.birthDate !== undefined) data.birthDate = dto.birthDate ? new Date(dto.birthDate) : null;
    if (dto.defaultCashAccountCode !== undefined)
      data.defaultCashAccountCode = dto.defaultCashAccountCode || null;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data });

      if (dto.employee) {
        await this.employees.upsertProfileTx(tx, id, dto.employee, actor);
      }

      if (isNowBeingDeactivated) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });

    await this.audit.log({
      userId: actor?.userId,
      action: 'USER_PROFILE_UPDATED',
      entity: 'user',
      entityId: id,
      newValue: { ...dto, password: dto.password ? '***' : undefined },
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });

    return this.findOneFull(id);
  }
```

4e. แก้ `create` ให้รับ `dto.employee` (provision พร้อมสร้าง). เปลี่ยน body ของ `create` ให้ wrap ใน `$transaction` และคืน findOneFull:
```ts
  async create(dto: CreateUserDto, actor?: Actor) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing && !existing.deletedAt) throw new ConflictException('อีเมลนี้ถูกใช้แล้ว');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const created = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: dto.email,
          password: hashedPassword,
          name: dto.name,
          role: dto.role as UserRole,
          branchId: dto.branchId || null,
          employeeId: dto.employeeId || null,
          nickname: dto.nickname || null,
          phone: dto.phone || null,
          lineId: dto.lineId || null,
          address: dto.address || null,
          avatarUrl: dto.avatarUrl || null,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          nationalId: dto.nationalId || null,
          birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
        },
        select: { id: true },
      });
      if (dto.employee) {
        await this.employees.upsertProfileTx(tx, u.id, dto.employee, actor);
      }
      return u;
    });
    return this.findOneFull(created.id);
  }
```
อัปเดต import: `import { CreateUserDto } from './dto/create-user.dto';` (มีอยู่แล้ว) — `CreateUserDto` ตอนนี้มี `employee?`

- [ ] **Step 5: รัน test ให้ผ่าน**

Run: `cd apps/api && npx jest src/modules/users/__tests__/users-update-full.spec.ts --runInBand`
Expected: PASS (3 tests)

- [ ] **Step 6: ตรวจ types**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/users
git commit -m "feat(users): findOneFull + atomic updateFull/create with employee profile"
```

---

## Task 4: UsersController — GET :id + PUT :id/profile + actor

**Files:**
- Modify: `apps/api/src/modules/users/users.controller.ts`

- [ ] **Step 1: เพิ่ม endpoints + ส่ง actor**

เพิ่ม imports:
```ts
import { Req } from '@nestjs/common';
import type { Request } from 'express';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
```
เพิ่ม helper ใต้ class declaration (บนสุดของ controller body):
```ts
  private actorOf(req: Request & { user?: { id: string } }) {
    return {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    };
  }
```
เพิ่ม `GET :id` **ก่อน** `@Patch(':id')` (วางใต้ `reverse-overrides` ตามคอมเมนต์เดิมเรื่องลำดับ route):
```ts
  @Get(':id')
  @Roles('OWNER')
  findOne(@Param('id') id: string) {
    return this.usersService.findOneFull(id);
  }
```
เพิ่ม `PUT :id/profile` (วางใกล้ `@Patch(':id')`):
```ts
  @Put(':id/profile')
  @Roles('OWNER')
  updateFull(
    @Param('id') id: string,
    @Body() dto: UpdateUserProfileDto,
    @Req() req: Request & { user?: { id: string } },
  ) {
    return this.usersService.updateFull(id, dto, this.actorOf(req));
  }
```
แก้ `create` ให้ส่ง actor:
```ts
  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateUserDto, @Req() req: Request & { user?: { id: string } }) {
    return this.usersService.create(dto, this.actorOf(req));
  }
```

- [ ] **Step 2: ตรวจ types**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/users/users.controller.ts
git commit -m "feat(users): GET /users/:id + PUT /users/:id/profile endpoints"
```

---

## Task 5: ปรับสิทธิ์ /employees → OWNER (คง pickable)

**Files:**
- Modify: `apps/api/src/modules/employees/employees.controller.ts`
- Test: `apps/api/src/modules/employees/__tests__/employees-roles.spec.ts`

- [ ] **Step 1: เขียน test metadata ที่ fail ก่อน**

```ts
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { EmployeesController } from '../employees.controller';

const rolesOf = (fn: any) => Reflect.getMetadata(ROLES_KEY, fn) as string[];

describe('EmployeesController roles', () => {
  const p = EmployeesController.prototype;
  it('management endpoints are OWNER-only', () => {
    for (const m of [p.list, p.findOne, p.provision, p.update, p.remove, p.provisionable]) {
      expect(rolesOf(m)).toEqual(['OWNER']);
    }
  });
  it('pickable stays broad for dropdown consumers', () => {
    expect(rolesOf(p.pickable)).toEqual(['OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER']);
  });
});
```

> verified: `roles.decorator.ts` export `ROLES_KEY = 'roles'` — import ใช้ได้ตามโค้ดข้างบน

- [ ] **Step 2: รัน test ให้ fail**

Run: `cd apps/api && npx jest src/modules/employees/__tests__/employees-roles.spec.ts --runInBand`
Expected: FAIL — list/findOne/... ยังเป็น `['OWNER','ACCOUNTANT']`

- [ ] **Step 3: แก้ `employees.controller.ts`** — เปลี่ยน `@Roles('OWNER', 'ACCOUNTANT')` เป็น `@Roles('OWNER')` บน `list`, `findOne`, `provisionable`, `provision`, `update`, `remove`. **ห้ามแตะ** `pickable` (`@Roles('OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER')`)

- [ ] **Step 4: รัน test ให้ผ่าน**

Run: `cd apps/api && npx jest src/modules/employees/__tests__/employees-roles.spec.ts --runInBand`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/employees/employees.controller.ts apps/api/src/modules/employees/__tests__/employees-roles.spec.ts
git commit -m "feat(employees): restrict management endpoints to OWNER (keep pickable)"
```

---

# PHASE B — Frontend

## Task 6: users API client + types

**Files:**
- Create: `apps/web/src/lib/api/users.ts`
- Modify: `apps/web/src/pages/UsersPage/types.ts`

- [ ] **Step 1: เพิ่ม `employeeProfile` บน `User` ใน `types.ts`** (หลัง `branch:` field)

```ts
  employeeProfile: {
    id: string;
    position: string | null;
    employmentType: 'MONTHLY' | 'DAILY' | 'CONTRACT';
    resignedDate: string | null;
  } | null;
```

- [ ] **Step 2: สร้าง `lib/api/users.ts`**

```ts
import api from '@/lib/api';

export type EmploymentType = 'MONTHLY' | 'DAILY' | 'CONTRACT';

export interface EmployeeProfileDetail {
  id: string;
  position: string | null;
  employmentType: EmploymentType;
  baseSalary: string | null; // Prisma Decimal → JSON string
  ssoEligible: boolean;
  bankName: string | null;
  bankAccountNo: string | null;
  resignedDate: string | null;
}

export interface UserDetail {
  id: string;
  email: string;
  name: string;
  role: string;
  branchId: string | null;
  isActive: boolean;
  employeeId: string | null;
  nickname: string | null;
  phone: string | null;
  lineId: string | null;
  address: string | null;
  avatarUrl: string | null;
  startDate: string | null;
  nationalId: string | null;
  birthDate: string | null;
  branch: { id: string; name: string } | null;
  employeeProfile: EmployeeProfileDetail | null;
}

export interface EmployeeProfileInput {
  position?: string;
  employmentType?: EmploymentType;
  baseSalary?: number;
  ssoEligible?: boolean;
  bankName?: string;
  bankAccountNo?: string;
  resignedDate?: string | null;
}

// ส่งเฉพาะ user fields + employee block (combined save)
export type SaveUserProfileBody = Record<string, unknown> & {
  employee?: EmployeeProfileInput | null;
};

export const userKeys = {
  all: ['users'] as const,
  detail: (id: string) => ['users', 'detail', id] as const,
};

export const usersApi = {
  detail: (id: string) => api.get<UserDetail>(`/users/${id}`).then((r) => r.data),
  create: (body: SaveUserProfileBody) => api.post<UserDetail>('/users', body).then((r) => r.data),
  saveProfile: (id: string, body: SaveUserProfileBody) =>
    api.put<UserDetail>(`/users/${id}/profile`, body).then((r) => r.data),
};
```

- [ ] **Step 3: ตรวจ types**

Run: `./tools/check-types.sh web`
Expected: 0 errors (อาจมี error ใน UserTable.tsx/อื่น ๆ ที่ใช้ User โดยยังไม่ได้ map employeeProfile — จะแก้ Task 9; ถ้า error เฉพาะเรื่องนี้ ข้ามไปได้ชั่วคราว แต่ถ้าทำตามลำดับ commit จะค่อยเขียว)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api/users.ts apps/web/src/pages/UsersPage/types.ts
git commit -m "feat(web): users api client + UserDetail types"
```

---

## Task 7: แยกฟิลด์บุคคล + avatar + card reader เป็น PersonalFields

ดึง markup ฟิลด์บุคคล/avatar/card-reader จาก `UserForm.tsx` มาเป็น component ใช้ซ้ำในหน้า detail (controlled ผ่าน props)

**Files:**
- Create: `apps/web/src/pages/UsersPage/components/PersonalFields.tsx`

- [ ] **Step 1: สร้าง `PersonalFields.tsx`** (คัด logic avatar + card reader จาก `UserForm.tsx:31-85,123-258,308-342`)

```tsx
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Camera, X, CreditCard } from 'lucide-react';
import { compressImageForOcr } from '@/lib/compressImage';
import { checkCardReaderStatus, readSmartCard } from '@/lib/cardReader';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { inputClass, labelClass } from '../types';

export interface PersonalForm {
  name: string;
  nickname: string;
  employeeId: string;
  startDate: string;
  nationalId: string;
  birthDate: string;
  phone: string;
  lineId: string;
  address: string;
  avatarUrl: string;
}

interface Props {
  form: PersonalForm;
  setForm: <K extends keyof PersonalForm>(key: K, value: PersonalForm[K]) => void;
  setMany: (patch: Partial<PersonalForm>) => void;
}

export default function PersonalFields({ form, setForm, setMany }: Props) {
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [isReadingCard, setIsReadingCard] = useState(false);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageForOcr(file, 200, 0.8);
      setForm('avatarUrl', compressed);
    } catch {
      toast.error('ไม่สามารถอ่านรูปภาพได้');
    }
    e.target.value = '';
  };

  const handleReadCard = async () => {
    setIsReadingCard(true);
    try {
      const status = await checkCardReaderStatus();
      if (!status) return toast.error('ไม่พบเครื่องอ่านบัตร กรุณาตรวจสอบว่าเปิดโปรแกรมอ่านบัตรแล้ว');
      if (status.status === 'no_reader') return toast.error('ไม่พบเครื่องอ่านบัตร กรุณาเสียบเครื่องอ่านบัตร');
      if (status.status === 'waiting') return toast.error('กรุณาเสียบบัตรประชาชนก่อน');
      const card = await readSmartCard();
      setMany({
        name: `${card.prefix}${card.firstName} ${card.lastName}`,
        nationalId: card.nationalId,
        birthDate: card.birthDate,
        address: card.address,
      });
      toast.success('อ่านบัตรประชาชนสำเร็จ');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'อ่านบัตรไม่สำเร็จ');
    } finally {
      setIsReadingCard(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="relative">
            {form.avatarUrl ? (
              <img src={form.avatarUrl} alt="รูปโปรไฟล์" className="size-16 rounded-full object-cover" />
            ) : (
              <div className="size-16 rounded-full bg-muted flex items-center justify-center">
                <Camera className="size-6 text-muted-foreground" />
              </div>
            )}
            <input ref={avatarInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
          </div>
          <div className="flex flex-col gap-1">
            <button type="button" onClick={() => avatarInputRef.current?.click()} className="text-sm text-primary hover:text-primary/80 font-medium">
              {form.avatarUrl ? 'เปลี่ยนรูป' : 'อัพโหลดรูปโปรไฟล์'}
            </button>
            {form.avatarUrl && (
              <button type="button" onClick={() => setForm('avatarUrl', '')} className="text-sm text-destructive hover:text-destructive/80 flex items-center gap-1">
                <X className="size-3" /> ลบรูป
              </button>
            )}
          </div>
        </div>
        <button type="button" onClick={handleReadCard} disabled={isReadingCard} className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-input rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
          <CreditCard className="size-4" />
          {isReadingCard ? 'กำลังอ่าน...' : 'อ่านบัตรประชาชน'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div><label className={labelClass}>ชื่อ-นามสกุล *</label>
          <input className={inputClass} value={form.name} onChange={(e) => setForm('name', e.target.value)} required /></div>
        <div><label className={labelClass}>ชื่อเล่น</label>
          <input className={inputClass} value={form.nickname} onChange={(e) => setForm('nickname', e.target.value)} placeholder="เช่น นุ๊ก, เอ" /></div>
        <div><label className={labelClass}>รหัสพนักงาน</label>
          <input className={inputClass} value={form.employeeId} onChange={(e) => setForm('employeeId', e.target.value)} placeholder="EMP-001" /></div>
        <div><label className={labelClass}>วันเริ่มงาน</label>
          <ThaiDateInput className={inputClass} value={form.startDate} onChange={(e) => setForm('startDate', e.target.value)} /></div>
        <div><label className={labelClass}>เลขบัตรประชาชน</label>
          <input className={inputClass} value={form.nationalId} onChange={(e) => setForm('nationalId', e.target.value)} maxLength={13} pattern="\d{13}" placeholder="x-xxxx-xxxxx-xx-x" /></div>
        <div><label className={labelClass}>วันเกิด</label>
          <ThaiDateInput className={inputClass} value={form.birthDate} onChange={(e) => setForm('birthDate', e.target.value)} /></div>
        <div><label className={labelClass}>เบอร์โทรศัพท์</label>
          <input className={inputClass} type="tel" value={form.phone} onChange={(e) => setForm('phone', e.target.value)} pattern="0[0-9]{9}" placeholder="0xx-xxx-xxxx" /></div>
        <div><label className={labelClass}>LINE ID</label>
          <input className={inputClass} value={form.lineId} onChange={(e) => setForm('lineId', e.target.value)} /></div>
        <div className="col-span-2"><label className={labelClass}>ที่อยู่</label>
          <textarea className={inputClass} rows={2} value={form.address} onChange={(e) => setForm('address', e.target.value)} /></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: ตรวจ types**

Run: `./tools/check-types.sh web`
Expected: 0 errors (component ยังไม่ถูกใช้)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/UsersPage/components/PersonalFields.tsx
git commit -m "feat(web): extract PersonalFields (avatar + card reader) component"
```

---

## Task 8: UserDetailPage (3 แท็บ + บันทึกเดียว) + routes

**Files:**
- Create: `apps/web/src/pages/UsersPage/UserDetailPage.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: สร้าง `UserDetailPage.tsx`**

```tsx
import { useMemo, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useUiFlags } from '@/hooks/useUiFlags';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import QueryBoundary from '@/components/QueryBoundary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ChevronLeft } from 'lucide-react';
import { usersApi, userKeys, type EmploymentType } from '@/lib/api/users';
import { roleLabels, inputClass, labelClass } from './types';
import PersonalFields, { type PersonalForm } from './components/PersonalFields';

const EMPLOYMENT: { value: EmploymentType; label: string }[] = [
  { value: 'MONTHLY', label: 'รายเดือน' },
  { value: 'DAILY', label: 'รายวัน' },
  { value: 'CONTRACT', label: 'สัญญาจ้าง' },
];

const emptyPersonal: PersonalForm = {
  name: '', nickname: '', employeeId: '', startDate: '', nationalId: '',
  birthDate: '', phone: '', lineId: '', address: '', avatarUrl: '',
};
const emptyHr = {
  enabled: false, position: '', employmentType: 'MONTHLY' as EmploymentType,
  baseSalary: '', ssoEligible: true, bankName: '', bankAccountNo: '', resignedDate: '',
};

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  useDocumentTitle(isNew ? 'เพิ่มผู้ใช้' : 'รายละเอียดผู้ใช้');
  const { viewerRoleEnabled } = useUiFlags();

  const [tab, setTab] = useState('account');
  const [account, setAccount] = useState({ email: '', password: '', role: 'SALES', branchId: '', isActive: true });
  const [personal, setPersonal] = useState<PersonalForm>(emptyPersonal);
  const [hr, setHr] = useState(emptyHr);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
  });

  const detail = useQuery({
    queryKey: userKeys.detail(id ?? ''),
    queryFn: () => usersApi.detail(id!),
    enabled: !isNew && !!id,
  });

  useEffect(() => {
    const u = detail.data;
    if (!u) return;
    setAccount({ email: u.email, password: '', role: u.role, branchId: u.branchId ?? '', isActive: u.isActive });
    setPersonal({
      name: u.name, nickname: u.nickname ?? '', employeeId: u.employeeId ?? '',
      startDate: u.startDate ? u.startDate.slice(0, 10) : '', nationalId: u.nationalId ?? '',
      birthDate: u.birthDate ? u.birthDate.slice(0, 10) : '', phone: u.phone ?? '',
      lineId: u.lineId ?? '', address: u.address ?? '', avatarUrl: u.avatarUrl ?? '',
    });
    const e = u.employeeProfile;
    setHr({
      enabled: !!e, position: e?.position ?? '', employmentType: e?.employmentType ?? 'MONTHLY',
      baseSalary: e?.baseSalary ?? '', ssoEligible: e?.ssoEligible ?? true,
      bankName: e?.bankName ?? '', bankAccountNo: e?.bankAccountNo ?? '',
      resignedDate: e?.resignedDate ? e.resignedDate.slice(0, 10) : '',
    });
  }, [detail.data]);

  const availableRoles = useMemo(
    () => Object.entries(roleLabels).filter(([k]) => k !== 'VIEWER' || viewerRoleEnabled || account.role === 'VIEWER'),
    [viewerRoleEnabled, account.role],
  );

  function buildBody() {
    const body: Record<string, unknown> = {
      name: personal.name,
      role: account.role,
      branchId: account.branchId || null,
      isActive: account.isActive,
      employeeId: personal.employeeId || null,
      nickname: personal.nickname || null,
      phone: personal.phone || null,
      lineId: personal.lineId || null,
      address: personal.address || null,
      avatarUrl: personal.avatarUrl || null,
      startDate: personal.startDate || null,
      nationalId: personal.nationalId || null,
      birthDate: personal.birthDate || null,
    };
    if (account.password) body.password = account.password;
    if (isNew) { body.email = account.email; body.password = account.password; }
    if (hr.enabled) {
      body.employee = {
        position: hr.position.trim() || undefined,
        employmentType: hr.employmentType,
        baseSalary: hr.baseSalary ? parseFloat(hr.baseSalary) : undefined,
        ssoEligible: hr.ssoEligible,
        bankName: hr.bankName.trim() || undefined,
        bankAccountNo: hr.bankAccountNo.trim() || undefined,
        resignedDate: hr.resignedDate ? new Date(hr.resignedDate).toISOString() : null,
      };
    }
    return body;
  }

  const save = useMutation({
    mutationFn: () => (isNew ? usersApi.create(buildBody()) : usersApi.saveProfile(id!, buildBody())),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(isNew ? 'เพิ่มผู้ใช้สำเร็จ' : 'บันทึกสำเร็จ');
      navigate(`/users/${saved.id}`, { replace: true });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const removeFromPayroll = useMutation({
    mutationFn: () => api.delete(`/employees/${detail.data?.employeeProfile?.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.detail(id ?? '') });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('นำพนักงานออกจากระบบจ่ายแล้ว');
      setConfirmRemove(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const u = detail.data;
  const titleName = isNew ? 'เพิ่มผู้ใช้ใหม่' : u?.name ?? '';

  return (
    <QueryBoundary isLoading={!isNew && detail.isLoading} isError={detail.isError} error={detail.error} onRetry={detail.refetch} errorTitle="ไม่สามารถโหลดข้อมูลผู้ใช้ได้">
      <div className="pb-24">
        <button onClick={() => navigate('/users')} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 mb-4">
          <ChevronLeft className="size-4" /> กลับไปรายการผู้ใช้
        </button>

        <div className="flex items-center gap-4 mb-5">
          <div className="size-14 rounded-full bg-primary/10 text-primary grid place-items-center text-xl font-bold">
            {(titleName || '?').charAt(0)}
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground leading-snug">
              {titleName} {personal.nickname && <span className="text-sm font-normal text-muted-foreground">({personal.nickname})</span>}
            </h1>
            {!isNew && (
              <div className="flex items-center gap-2 flex-wrap mt-1">
                {personal.employeeId && <span className="text-sm text-muted-foreground">{personal.employeeId}</span>}
                <Badge variant={account.isActive ? 'primary' : 'secondary'} appearance="light" size="sm">
                  {account.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}
                </Badge>
                {hr.enabled && (
                  <Badge variant={hr.resignedDate ? 'secondary' : 'primary'} appearance="light" size="sm">
                    {hr.resignedDate ? 'ลาออก' : 'เป็นพนักงาน'}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-5">
            <TabsTrigger value="account">บัญชี / สิทธิ์</TabsTrigger>
            <TabsTrigger value="personal">ข้อมูลบุคคล</TabsTrigger>
            <TabsTrigger value="hr">HR / เงินเดือน</TabsTrigger>
          </TabsList>

          {/* ACCOUNT */}
          <TabsContent value="account">
            <div className="bg-card rounded-xl border border-border/50 shadow-sm p-6 grid md:grid-cols-2 gap-5">
              <div>
                <label className={labelClass}>อีเมล (เข้าสู่ระบบ) {isNew && '*'}</label>
                <input className={inputClass} type="email" value={account.email} disabled={!isNew} required={isNew}
                  onChange={(e) => setAccount({ ...account, email: e.target.value })} />
                {!isNew && <p className="text-[11px] text-muted-foreground mt-1">แก้ไม่ได้หลังสร้างบัญชี</p>}
              </div>
              <div>
                <label className={labelClass}>{isNew ? 'รหัสผ่าน *' : 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)'}</label>
                <input className={inputClass} type="password" minLength={6} required={isNew}
                  value={account.password} onChange={(e) => setAccount({ ...account, password: e.target.value })} />
              </div>
              <div>
                <label className={labelClass}>บทบาท (สิทธิ์ระบบ) *</label>
                <select className={inputClass} value={account.role} onChange={(e) => setAccount({ ...account, role: e.target.value })}>
                  {availableRoles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>สาขา</label>
                <select className={inputClass} value={account.branchId} onChange={(e) => setAccount({ ...account, branchId: e.target.value })}>
                  <option value="">ไม่ระบุ (ทุกสาขา)</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              {!isNew && (
                <label className="md:col-span-2 flex items-center justify-between rounded-lg border border-border p-3">
                  <span>
                    <span className="block text-sm font-medium text-foreground">สถานะการใช้งาน</span>
                    <span className="block text-[11px] text-muted-foreground">ปิดใช้งาน = ล็อกอินไม่ได้ + เพิกถอน session ทันที</span>
                  </span>
                  <input type="checkbox" className="size-5 accent-emerald-600" checked={account.isActive}
                    onChange={(e) => setAccount({ ...account, isActive: e.target.checked })} />
                </label>
              )}
            </div>
          </TabsContent>

          {/* PERSONAL */}
          <TabsContent value="personal">
            <div className="bg-card rounded-xl border border-border/50 shadow-sm p-6">
              <PersonalFields
                form={personal}
                setForm={(k, v) => setPersonal((p) => ({ ...p, [k]: v }))}
                setMany={(patch) => setPersonal((p) => ({ ...p, ...patch }))}
              />
            </div>
          </TabsContent>

          {/* HR */}
          <TabsContent value="hr">
            <div className="bg-card rounded-xl border border-border/50 shadow-sm p-6">
              {!hr.enabled ? (
                <div className="text-center py-10 border border-dashed border-border rounded-xl">
                  <div className="font-medium text-foreground leading-snug">ยังไม่ได้ตั้งเป็นพนักงาน</div>
                  <p className="text-sm text-muted-foreground mt-1 mb-4">ผู้ใช้คนนี้ยังไม่มีข้อมูล HR / เงินเดือน</p>
                  <Button onClick={() => setHr({ ...hr, enabled: true })}>+ เพิ่มข้อมูล HR / เงินเดือน</Button>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-5">
                  <div><label className={labelClass}>ตำแหน่งงาน</label>
                    <input className={inputClass} value={hr.position} onChange={(e) => setHr({ ...hr, position: e.target.value })} placeholder="เช่น พนักงานขาย" /></div>
                  <div><label className={labelClass}>ประเภทการจ้าง</label>
                    <select className={inputClass} value={hr.employmentType} onChange={(e) => setHr({ ...hr, employmentType: e.target.value as EmploymentType })}>
                      {EMPLOYMENT.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select></div>
                  <div><label className={labelClass}>ฐานเงินเดือน (บาท)</label>
                    <input className={inputClass} type="number" step="0.01" value={hr.baseSalary} onChange={(e) => setHr({ ...hr, baseSalary: e.target.value })} placeholder="0.00" /></div>
                  <div><label className={labelClass}>วันที่ลาออก</label>
                    <input className={inputClass} type="date" value={hr.resignedDate} onChange={(e) => setHr({ ...hr, resignedDate: e.target.value })} /></div>
                  <div><label className={labelClass}>ธนาคาร</label>
                    <input className={inputClass} value={hr.bankName} onChange={(e) => setHr({ ...hr, bankName: e.target.value })} /></div>
                  <div><label className={labelClass}>เลขบัญชี</label>
                    <input className={inputClass} value={hr.bankAccountNo} onChange={(e) => setHr({ ...hr, bankAccountNo: e.target.value })} /></div>
                  <label className="md:col-span-2 flex items-center gap-2 text-sm rounded-lg border border-border p-3">
                    <input type="checkbox" className="size-4 accent-emerald-600" checked={hr.ssoEligible} onChange={(e) => setHr({ ...hr, ssoEligible: e.target.checked })} />
                    เข้าประกันสังคม (หัก 5% / นายจ้างสมทบ 5%)
                  </label>
                  {!isNew && detail.data?.employeeProfile && (
                    <div className="md:col-span-2 pt-2 border-t border-border">
                      <button type="button" onClick={() => setConfirmRemove(true)} className="text-sm text-destructive hover:underline">
                        นำออกจากระบบจ่าย (เก็บประวัติ payroll เดิม)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* sticky save bar */}
      <div className="fixed bottom-0 inset-x-0 md:left-[var(--sidebar-w,15rem)] bg-background/95 backdrop-blur border-t border-border px-6 py-3 flex items-center justify-end gap-3 z-40">
        <span className="text-xs text-muted-foreground mr-auto hidden sm:block">บันทึกครั้งเดียว → อัปเดต บัญชี + บุคคล + HR พร้อมกัน</span>
        <Button variant="outline" onClick={() => navigate('/users')}>ยกเลิก</Button>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'กำลังบันทึก...' : 'บันทึก'}</Button>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="นำพนักงานออกจากระบบจ่าย"
        description={`นำ ${u?.name ?? ''} ออกจากทะเบียนพนักงาน payroll? (ประวัติ payroll เดิมยังอยู่)`}
        confirmLabel="นำออก"
        variant="destructive"
        loading={removeFromPayroll.isPending}
        onConfirm={() => removeFromPayroll.mutate()}
      />
    </QueryBoundary>
  );
}
```

> หมายเหตุ: `md:left-[var(--sidebar-w,15rem)]` — ถ้าโปรเจคไม่มีตัวแปร sidebar width ให้ใช้ค่าคงที่ที่ตรงกับ `MainLayout` (เปิด `apps/web/src/components/.../MainLayout` ดูความกว้าง sidebar แล้วใส่ เช่น `md:left-60`)

- [ ] **Step 2: เพิ่ม routes ใน `App.tsx`**

เพิ่ม lazy import ใกล้ import หน้าอื่น:
```ts
const UserDetailPage = lazy(() => import('@/pages/UsersPage/UserDetailPage'));
```
เพิ่ม 2 route (วางก่อน/หลัง route `/users` เดิม — `/users/new` ต้องมาก่อน `/users/:id`):
```tsx
          <Route path="/users/new" element={<ProtectedRoute roles={['OWNER']}><UserDetailPage /></ProtectedRoute>} />
          <Route path="/users/:id" element={<ProtectedRoute roles={['OWNER']}><UserDetailPage /></ProtectedRoute>} />
```

- [ ] **Step 3: ตรวจ types**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/UsersPage/UserDetailPage.tsx apps/web/src/App.tsx
git commit -m "feat(web): UserDetailPage with 3 tabs + single atomic save"
```

---

## Task 9: UsersPage list — row→detail, +คอลัมน์ HR, ปุ่ม→/users/new

**Files:**
- Modify: `apps/web/src/pages/UsersPage/components/UserTable.tsx`
- Modify: `apps/web/src/pages/UsersPage/index.tsx`

- [ ] **Step 1: UserTable — เปลี่ยน label role + เพิ่มคอลัมน์ HR**

1a. เปลี่ยน label คอลัมน์ role (บรรทัด ~136) จาก `label: 'ตำแหน่ง'` เป็น `label: 'บทบาท (สิทธิ์)'`

1b. เพิ่มคอลัมน์ใหม่ "ตำแหน่งงาน" + "พนักงาน" หลังคอลัมน์ role (วางต่อจาก object คอลัมน์ `role`):
```tsx
    {
      key: 'position',
      label: 'ตำแหน่งงาน',
      hideable: true,
      render: (u: User) => u.employeeProfile?.position || <Empty />,
    },
    {
      key: 'employee',
      label: 'พนักงาน',
      render: (u: User) => {
        if (!u.employeeProfile) return <span className="text-xs text-muted-foreground/60">ไม่ใช่พนักงาน</span>;
        const resigned = !!u.employeeProfile.resignedDate;
        return (
          <Badge variant={resigned ? 'secondary' : 'primary'} appearance="light" size="sm">
            {resigned ? 'ลาออก' : 'ทำงาน'}
          </Badge>
        );
      },
    },
```

- [ ] **Step 2: index.tsx — เปลี่ยน openEdit/openCreate เป็น navigate**

2a. เพิ่ม import:
```ts
import { useNavigate } from 'react-router';
```
2b. ใน component เพิ่ม `const navigate = useNavigate();`

2c. แทน `openCreate`:
```ts
  const openCreate = () => navigate('/users/new');
```
2d. แทน `openEdit` ทั้งฟังก์ชัน (ลบ form/modal state ที่เกี่ยวข้อง):
```ts
  const openEdit = (u: User) => navigate(`/users/${u.id}`);
```
2e. ลบการใช้งาน `UserForm` modal: ลบ `{isModalOpen && (<UserForm ... />)}` block, ลบ state `isModalOpen`, `editingUser`, `form`, `setForm`, `saveMutation`, `handleSubmit`, `closeModal`, และ import `UserForm`. **คง** `toggleActiveMutation`, `handleToggleActive`, `handleBulkDeactivate`, invites, summary cards

- [ ] **Step 3: index.tsx — เพิ่มการ์ดสรุป "พนักงาน"**

ในบล็อกการ์ดสรุป เพิ่มการ์ดที่ 4 (กริดเปลี่ยนเป็น `md:grid-cols-4`):
```tsx
          <Card className="rounded-xl border border-border/50 shadow-sm overflow-hidden">
            <div className="flex h-full">
              <div className="w-1 shrink-0 bg-sky-400" />
              <CardContent className="p-5 flex-1">
                <div className="text-2xl font-bold tabular-nums text-foreground">
                  {users.filter((u) => u.employeeProfile).length}
                </div>
                <div className="text-xs text-muted-foreground">พนักงาน (มีโปรไฟล์ HR)</div>
              </CardContent>
            </div>
          </Card>
```

- [ ] **Step 4: ตรวจ types**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 5: เขียน vitest สั้น ๆ ยืนยัน list คลิกแล้ว navigate**

Test: `apps/web/src/pages/UsersPage/__tests__/UserTable.test.tsx`
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi } from 'vitest';
import { UserTable } from '../components/UserTable';

const baseUser = {
  id: 'u1', email: 'a@b.com', name: 'สมชาย', role: 'SALES', branchId: null, isActive: true,
  employeeId: 'EMP-001', nickname: null, phone: null, lineId: null, address: null,
  avatarUrl: null, startDate: null, nationalId: null, birthDate: null, lastLoginAt: null,
  createdAt: '2026-01-01', branch: null,
  employeeProfile: { id: 'p1', position: 'พนักงานขาย', employmentType: 'MONTHLY' as const, resignedDate: null },
};

it('shows HR position + employee badge', () => {
  render(
    <MemoryRouter>
      <UserTable users={[baseUser]} branches={[]} isLoading={false} isError={false} error={null}
        onRetry={() => {}} onEdit={vi.fn()} onToggleActive={() => {}} onBulkDeactivate={() => {}} />
    </MemoryRouter>,
  );
  expect(screen.getByText('พนักงานขาย')).toBeInTheDocument();
  expect(screen.getByText('ทำงาน')).toBeInTheDocument();
});
```
Run: `cd apps/web && npx vitest run src/pages/UsersPage/__tests__/UserTable.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/UsersPage
git commit -m "feat(web): users list — navigate to detail + HR column/badge"
```

---

# PHASE C — Cleanup

## Task 10: ถอดแท็บ employees ออกจาก SettingsPage

**Files:**
- Modify: `apps/web/src/pages/SettingsPage/index.tsx`
- Delete: `apps/web/src/pages/SettingsPage/tabs/EmployeesTab.tsx`

- [ ] **Step 1:** ลบ import `EmployeesTab` (บรรทัด 8) และลบ object แท็บ employees (บรรทัด 32) จาก `TABS`

- [ ] **Step 2:** ลบไฟล์
```bash
rm apps/web/src/pages/SettingsPage/tabs/EmployeesTab.tsx
```

- [ ] **Step 3: ตรวจ types**

Run: `./tools/check-types.sh web`
Expected: 0 errors (ถ้า error → ยังมีที่อ้าง EmployeesTab — ดู SettingsPage.test.tsx จะแก้ Task 13)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/SettingsPage/index.tsx
git rm apps/web/src/pages/SettingsPage/tabs/EmployeesTab.tsx
git commit -m "chore(settings): remove employees tab (moved to /users)"
```

---

## Task 11: ลบ standalone /employees + EmployeesPage + dialogs

**Files:**
- Modify: `apps/web/src/App.tsx`
- Delete: `apps/web/src/pages/EmployeesPage.tsx`, `apps/web/src/components/employees/ProvisionEmployeeDialog.tsx`, `apps/web/src/components/employees/EditEmployeeDialog.tsx`

- [ ] **Step 1:** ลบ route `/employees` (App.tsx:487) + lazy import ของ `EmployeesPage`

- [ ] **Step 2:** ลบไฟล์
```bash
rm apps/web/src/pages/EmployeesPage.tsx \
   apps/web/src/components/employees/ProvisionEmployeeDialog.tsx \
   apps/web/src/components/employees/EditEmployeeDialog.tsx
```

- [ ] **Step 3: ยืนยันไม่มี import ค้าง**

Run: `cd apps/web/src && grep -rn "EmployeesPage\|ProvisionEmployeeDialog\|EditEmployeeDialog" . || echo CLEAN`
Expected: `CLEAN` (ยกเว้น test ที่จะลบใน Task 13)

- [ ] **Step 4: ตรวจ types**

Run: `./tools/check-types.sh web`
Expected: 0 errors (ถ้า error เหลือเฉพาะ test files → ไป Task 13)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx
git rm apps/web/src/pages/EmployeesPage.tsx apps/web/src/components/employees/ProvisionEmployeeDialog.tsx apps/web/src/components/employees/EditEmployeeDialog.tsx
git commit -m "chore: remove standalone /employees route + provision/edit dialogs"
```

---

## Task 12: เก็บกวาด menu.ts

**Files:**
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 1:** ลบรายการ "พนักงาน" ที่ชี้ `/settings#employees` ทั้ง 3 จุด:
  - OWNER (`owner-fin-master`, ~บรรทัด 570)
  - ACCOUNTANT (`acc-fin-master`, ~บรรทัด 401)
  - ACCOUNTANT bottomNav settings (~บรรทัด 978)

- [ ] **Step 2:** เปลี่ยน label "ผู้ใช้" → "ผู้ใช้ / พนักงาน" ทั้ง 2 จุดที่ `path: '/users'` (OWNER sidebar ~744, OWNER bottomNav ~912) — path คงเดิม

- [ ] **Step 3: ยืนยันไม่เหลือ `/settings#employees`**

Run: `cd apps/web/src && grep -rn "settings#employees" . || echo CLEAN`
Expected: `CLEAN`

- [ ] **Step 4: ตรวจ types + Commit**

Run: `./tools/check-types.sh web` → 0
```bash
git add apps/web/src/config/menu.ts
git commit -m "chore(menu): drop พนักงาน entries, rename ผู้ใช้ → ผู้ใช้ / พนักงาน"
```

---

## Task 13: แก้/ลบ tests ที่ล้าสมัย

**Files:**
- Delete: `apps/web/src/pages/__tests__/EmployeesPage.test.tsx`
- Modify: `apps/web/src/pages/SettingsPage/__tests__/SettingsPage.test.tsx`

- [ ] **Step 1:** ลบ test เก่าของ EmployeesPage
```bash
rm apps/web/src/pages/__tests__/EmployeesPage.test.tsx
```

- [ ] **Step 2:** เปิด `SettingsPage.test.tsx` — ลบ/แก้ assertion ที่อ้างแท็บ `employees` (เช่น "OWNER เห็น 11 แท็บ" → 10; ACC เห็น `[contacts, employees]` → `[contacts]`). คงเทสต์อื่นไว้

- [ ] **Step 3: รัน web suite ที่กระทบ**

Run: `cd apps/web && npx vitest run src/pages/SettingsPage src/pages/UsersPage`
Expected: PASS ทั้งหมด

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages
git rm apps/web/src/pages/__tests__/EmployeesPage.test.tsx
git commit -m "test: update for users/employees merge (drop employees-tab assertions)"
```

---

## Task 14: Verification รวม (manual + full type check)

- [ ] **Step 1: type check ทั้งโปรเจค**

Run: `./tools/check-types.sh all`
Expected: 0 errors

- [ ] **Step 2: API tests ที่เกี่ยวข้อง**

Run: `cd apps/api && npx jest src/modules/users src/modules/employees --runInBand`
Expected: PASS

- [ ] **Step 3: Web tests ที่เกี่ยวข้อง**

Run: `cd apps/web && npx vitest run src/pages/UsersPage src/pages/SettingsPage`
Expected: PASS

- [ ] **Step 4: Manual smoke (รัน `npm run dev`, login admin@bestchoice.com)**
  - `/users` → เห็นคอลัมน์ "บทบาท(สิทธิ์)" + "ตำแหน่งงาน" + badge พนักงาน, การ์ด "พนักงาน N คน"
  - คลิกแถว → `/users/:id`, สลับ 3 แท็บได้
  - คนที่ไม่มี HR → แท็บ HR เห็น empty state; กด "เพิ่มข้อมูล HR" → กรอก → บันทึก → กลายเป็นพนักงาน (เช็คในตาราง)
  - แก้ role + เงินเดือนพร้อมกัน → กดบันทึกครั้งเดียว → สำเร็จทั้งคู่
  - "+ เพิ่มผู้ใช้" → `/users/new` → กรอก email+password+HR → บันทึก → redirect `/users/:id`
  - ปิดใช้งาน user → ยืนยัน session ถูกตัด (login ใหม่ด้วย user นั้นไม่ได้)
  - `/settings` → ไม่มีแท็บ "พนักงาน"; เมนู sidebar ไม่มี "พนักงาน"
  - EmployeeCombobox (ฟอร์ม payroll/expense) → dropdown พนักงานยังทำงาน (regression pickable)

- [ ] **Step 5: finishing — ใช้ skill `superpowers:finishing-a-development-branch`** เพื่อสรุป merge/PR

---

## Self-review notes (ผู้เขียนแผนตรวจแล้ว)

- **Spec coverage:** ครบทุกหัวข้อ spec — backend (GET:id ✓ Task4, PUT profile ✓ Task3-4, list join ✓ Task3, roles ✓ Task5), frontend (UserDetailPage ✓ Task8, list ✓ Task9, HR empty/provision ✓ Task8), cleanup (tab/route/dialogs/menu/tests ✓ Task10-13), behavior preserve (token revoke ✓ Task3, audit ✓ Task2-3, isActive↔resignedDate แยก ✓ Task8)
- **คง pickable + lib/api/employees.ts** (EmployeeCombobox) — ไม่ถูกลบ ✓
- **ชื่อ method สอดคล้อง:** `upsertProfileTx` (Task2) ถูกเรียกชื่อเดียวกันใน Task3; `findOneFull`/`updateFull` ใช้ตรงกัน controller↔service
- **Verified ก่อนเขียนแผน:** `ROLES_KEY='roles'` export ✓; `EmployeesModule` export `EmployeesService` แล้ว ✓
- **จุดเดียวที่ต้องเช็คตอนทำจริง:** ความกว้าง sidebar สำหรับ sticky bar ใน Task8 (ดู MainLayout)
