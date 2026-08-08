# Repossessions Page Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้หน้า `/repossessions` กลับมาใช้งานได้จริงบน prod — ตัด create modal ที่ตายแล้วออก (ชี้ไปหน้ารับชำระซึ่งเป็นเส้นทางยึดเครื่องตัวจริง), แก้ปุ่มที่ fail 100% (พร้อมขาย, จัดการ), ปิดช่องโหว่ BM เห็นข้ามสาขา, และแก้ idempotency ของ shop-collect settlement ที่กลืนเงินโอนซ้ำยอดเท่ากัน

**Architecture:** หน้า `/repossessions` เปลี่ยนบทบาทเป็น "หน้าจัดการหลังยึด" (list + ใบลดหนี้ + รับโอนหน้าร้าน + สถานะซ่อม/ขาย) — การ**สร้าง**การยึดคืนมีทางเดียวคือ `RepossessionOverlay` ใน RecordPaymentWizard (`/payments`) ซึ่งมี strict-mode/collectedByShop/backdate ครบอยู่แล้ว. ฝั่ง API เพิ่ม branch scoping ระดับ service (แพทเทิร์น `getBranchScope` ที่ BranchGuard มอบหมายให้ service ทำ), แก้ status state machine ให้ self-transition เป็น no-op, และเปลี่ยน idempotency ของ settlement จาก `(contractId, amount)` เป็น client `requestId`

**Tech Stack:** NestJS + Prisma (apps/api), React 18 + Vite + react-query + shadcn/Tailwind (apps/web), jest (unit, mocked Prisma), vitest (integration, DB จริง)

## Global Constraints

- Error/UI messages เป็น**ภาษาไทย**เสมอ (`{ message: 'กรุณา...' }`)
- เงินใช้ `Prisma.Decimal` เท่านั้น — ห้าม `Number()` บนผลรวม
- ทุก Prisma query ต้องกรอง `deletedAt: null`
- FE: data fetching ผ่าน `useQuery`/`useMutation` + `api` จาก `@/lib/api` เท่านั้น, toast จาก `sonner`, ห้าม hardcoded hex/gray — ใช้ design tokens (`bg-primary`, `text-muted-foreground`, ฯลฯ)
- Prettier: semi true, singleQuote true, printWidth 100, tabWidth 2
- ทำงานบน branch `fix/repossessions-page-rework-2026-08` (แตกจาก main ล่าสุด)
- **จบแต่ละ Phase: รัน tests + dispatch `code-reviewer` subagent + STOP รอเจ้าของ approve ก่อนขึ้น Phase ถัดไป** (ข้อตกลง review ต่อ phase ของโปรเจคนี้)
- Type check: `./tools/check-types.sh api` / `./tools/check-types.sh web` (รันผ่าน Bash tool)
- Unit tests API: `cd apps/api && npx jest src/modules/repossessions --silent` (baseline ปัจจุบัน: 2 suites / 50 tests ผ่านหมด)

## Out of scope (จงใจไม่ทำในแผนนี้ — รอ CPA/เจ้าของตัดสิน แยกเป็นงานอื่น)

1. **กำไร/ขาดทุนบนจอ vs ledger คนละเลข** (ส่วนลด/ราคากลาง/เงินคืนอยู่แค่บนจอ — JP5 book GL plug จากราคาตี) — ต้องถาม CPA ว่าจะ book ส่วนลดเป็น 52-1106 แบบ JP4 หรือยอมรับสองเลข
2. **customerRefund ไม่มี JE** — ต้องออกแบบบัญชี (ตั้งหนี้สิน + ขาจ่ายเงิน) กับ CPA
3. **ใบลดหนี้ลงวันที่ now แม้ JE backdate** — กระทบงวด ภ.พ.30, ต้องถาม CPA เรื่องวันที่เอกสาร
4. **Resale JE ตอน SOLD** — deferred Phase A.5 (SHOP-side) ตามแผนเดิมอยู่แล้ว
5. Pagination เกิน 200 แถว — volume ปัจจุบันยังไม่ถึง
6. UX ปุ่ม "รับโอนหน้าร้าน": โชว์ทุกแถว + prefill = ราคาตี (ไม่ใช่ยอด 11-2107 คงเหลือจริง) + error message พิมพ์ contract UUID ดิบ — server guard คุ้มครบแล้ว (ห้าม over-settle) จึงเป็นแค่ความสับสน; ถ้าจะทำต้อง expose ยอด 11-2107 ต่อสัญญาใน findAll ก่อน — แยกเป็นงาน UX รอบหน้า

---

# Phase 1 — Backend: security + correctness

### Task 1: Branch scoping ใน RepossessionsService

BM (BRANCH_MANAGER) ต้องเห็น/แก้เฉพาะการยึดคืนของสาขาตัวเอง — ปัจจุบัน service ไม่ scope เลย (BranchGuard ปล่อยผ่าน request ที่ไม่มี branchId แล้ว delegate ให้ service ตาม comment ใน `branch.guard.ts:47-48`)

**Files:**
- Modify: `apps/api/src/modules/repossessions/repossessions.service.ts` (findAll:44, findOne:258, update:572, markReadyForSale:689)
- Modify: `apps/api/src/modules/repossessions/repossessions.controller.ts` (ทุก handler)
- Test: `apps/api/src/modules/repossessions/repossessions.service.spec.ts`

**Interfaces:**
- Consumes: `getBranchScope(user)` จาก `apps/api/src/modules/auth/branch-access.util.ts` — คืน `{ all: true }` สำหรับ OWNER/FM/ACC, `{ branchId: string | null }` สำหรับ role อื่น
- Produces: signature ใหม่ที่ Task อื่นๆ ในไฟล์นี้อ้างอิง:
  - `findAll(filters, user?: RequestUser)`
  - `findOne(id: string, user?: RequestUser)`
  - `update(id: string, dto: UpdateRepossessionDto, user?: RequestUser)` (แทน `userId?: string` เดิม)
  - `markReadyForSale(id: string, resellPrice: number, user?: RequestUser)`
  - `type RequestUser = { id: string; role?: string; branchId?: string | null }` (export จาก service)

- [ ] **Step 1: เขียน failing tests (เพิ่มใน describe ใหม่ ท้ายไฟล์ spec, ใช้ mock `prisma` ตัวเดิมจาก beforeEach — มี stub ของ receipt.findMany/notificationLog.findMany สำหรับ CN-attach อยู่แล้ว)**

```ts
describe('branch scoping', () => {
  it('findAll: BRANCH_MANAGER ถูกบังคับ filter สาขาตัวเอง แม้ client ส่ง branchId อื่นมา', async () => {
    prisma.repossession.findMany.mockResolvedValue([]);
    prisma.repossession.count.mockResolvedValue(0);
    await service.findAll(
      { branchId: 'branch-OTHER' },
      { id: 'u1', role: 'BRANCH_MANAGER', branchId: 'branch-A' },
    );
    expect(prisma.repossession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contract: { branchId: 'branch-A' } }),
      }),
    );
  });

  it('findAll: BM ที่ไม่มี branchId → คืนหน้าว่าง ไม่ query DB', async () => {
    const res = await service.findAll({}, { id: 'u1', role: 'BRANCH_MANAGER', branchId: null });
    expect(res).toEqual({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    expect(prisma.repossession.findMany).not.toHaveBeenCalled();
  });

  it('findAll: OWNER (cross-branch) ใช้ branchId จาก query param ได้ตามเดิม', async () => {
    prisma.repossession.findMany.mockResolvedValue([]);
    prisma.repossession.count.mockResolvedValue(0);
    await service.findAll({ branchId: 'branch-B' }, { id: 'u1', role: 'OWNER', branchId: null });
    expect(prisma.repossession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contract: { branchId: 'branch-B' } }),
      }),
    );
  });

  it('findOne: BM ข้ามสาขา → NotFoundException (ไม่ leak ว่ามีอยู่)', async () => {
    prisma.repossession.findUnique.mockResolvedValue(
      makeRepossession({
        contract: {
          branchId: 'branch-1',
          contractNumber: 'BC-202601-0001',
          customer: { name: 'สมชาย ใจดี' },
          branch: { id: 'branch-1', name: 'ลาดพร้าว' },
          payments: [],
        },
      }),
    );
    await expect(
      service.findOne('repo-1', { id: 'u1', role: 'BRANCH_MANAGER', branchId: 'branch-2' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('findOne: BM สาขาเดียวกัน → ผ่าน', async () => {
    prisma.repossession.findUnique.mockResolvedValue(
      makeRepossession({
        contract: {
          branchId: 'branch-1',
          contractNumber: 'BC-202601-0001',
          customer: { name: 'สมชาย ใจดี' },
          branch: { id: 'branch-1', name: 'ลาดพร้าว' },
          payments: [],
        },
      }),
    );
    await expect(
      service.findOne('repo-1', { id: 'u1', role: 'BRANCH_MANAGER', branchId: 'branch-1' }),
    ).resolves.toBeTruthy();
  });
});
```

- [ ] **Step 2: รันให้ fail**

Run: `cd apps/api && npx jest src/modules/repossessions/repossessions.service.spec.ts -t "branch scoping" --silent`
Expected: FAIL (findAll ยังไม่รับ user param — where ไม่มี contract.branchId / findOne ไม่ throw)

- [ ] **Step 3: Implement ใน service**

เพิ่ม import + type ที่หัวไฟล์ `repossessions.service.ts`:

```ts
import { getBranchScope } from '../auth/branch-access.util';

/** Authenticated request user — service-level branch scoping (BranchGuard delegates to us). */
export type RequestUser = { id: string; role?: string; branchId?: string | null };
```

`findAll` — เปลี่ยน signature เป็น `findAll(filters: {...}, user?: RequestUser)` และแทนที่ block `if (filters.branchId) {...}` เดิมด้วย:

```ts
    const scope = getBranchScope(user);
    if (!scope.all) {
      // Branch-scoped role (BM) — บังคับสาขาตัวเอง ไม่สน branchId จาก client
      if (!scope.branchId) {
        return { data: [], total: 0, page: 1, limit: filters.limit || 20, totalPages: 0 };
      }
      where.contract = { branchId: scope.branchId };
    } else if (filters.branchId) {
      where.contract = { branchId: filters.branchId };
    }
```

`findOne` — เปลี่ยน signature เป็น `findOne(id: string, user?: RequestUser)` และหลัง `if (!repo) throw ...` เพิ่ม:

```ts
    const scope = getBranchScope(user);
    if (user && !scope.all) {
      // ตอบ 404 เดียวกับ "ไม่มีอยู่" — ไม่ยืนยันว่ามี record ของสาขาอื่น
      if (!scope.branchId || repo.contract.branchId !== scope.branchId) {
        throw new NotFoundException('ไม่พบข้อมูลการยึดคืน');
      }
    }
```

`update` — เปลี่ยน signature `update(id: string, dto: UpdateRepossessionDto, user?: RequestUser)`; บรรทัดแรกเปลี่ยนเป็น `const repo = await this.findOne(id, user);` และแทน `userId` ที่ใช้ใน SOLD block ด้วย `user?.id`

`markReadyForSale` — เปลี่ยน signature `markReadyForSale(id: string, resellPrice: number, user?: RequestUser)`; บรรทัดแรก `const repo = await this.findOne(id, user);`

`repossessions.controller.ts` — ทุก handler ส่ง user เข้า service (import type จาก service):

```ts
import { RepossessionsService, RequestUser } from './repossessions.service';
```

```ts
  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findAll(
    @CurrentUser() user: RequestUser,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.repossessionsService.findAll(
      {
        status,
        branchId,
        page: page ? parseInt(page) : undefined,
        limit: limit ? parseInt(limit) : undefined,
      },
      user,
    );
  }
```

```ts
  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.repossessionsService.findOne(id, user);
  }
```

```ts
  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRepossessionDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.repossessionsService.update(id, dto, user);
  }
```

```ts
  @Post(':id/ready-for-sale')
  @Roles('OWNER', 'BRANCH_MANAGER')
  markReadyForSale(
    @Param('id') id: string,
    @Body() dto: ReadyForSaleDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.repossessionsService.markReadyForSale(id, dto.resellPrice, user);
  }
```

หมายเหตุ: `@Post() create` เดิมส่ง `user.id` — เปลี่ยน type annotation เป็น `RequestUser` ได้แต่ยังส่ง `user.id` เข้า `create(dto, userId)` ตามเดิม (create เป็น OWNER-only, cross-branch อยู่แล้ว — ไม่ต้อง scope)

- [ ] **Step 4: รัน tests ทั้ง module ให้ผ่าน (รวมของเดิม 50 ตัว — ของเดิมบางตัวเรียก `service.update(id, dto, 'user-1')` ด้วย string จะ type-error: แก้ callsite ใน spec เป็น `{ id: 'user-1', role: 'OWNER' }`)**

Run: `cd apps/api && npx jest src/modules/repossessions --silent`
Expected: PASS ทั้งหมด (50 + 5 ใหม่)

- [ ] **Step 5: Type check + commit**

Run: `./tools/check-types.sh api`
Expected: 0 errors

```bash
git add apps/api/src/modules/repossessions/
git commit -m "fix(repossessions): branch scoping ระดับ service — BM เห็น/แก้เฉพาะสาขาตัวเอง (audit 2026-08-07 ข้อ 6)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Self-transition = no-op + ห้ามแก้ตัวเลขเงินหลัง SOLD

ฟอร์ม "จัดการ" ส่งสถานะปัจจุบันติดมาเสมอ → server ต้องไม่ตีความเป็น transition; และเครื่องที่ SOLD แล้ว repairCost/resellPrice ถูกใช้รายงานกำไรไปแล้ว ห้ามแก้ (แก้ได้เฉพาะ notes)

**Files:**
- Modify: `apps/api/src/modules/repossessions/repossessions.service.ts` (update method, ~line 572-590)
- Test: `apps/api/src/modules/repossessions/repossessions.service.spec.ts`

**Interfaces:**
- Consumes: `update(id, dto, user?)` signature จาก Task 1
- Produces: behavior — `dto.status === repo.status` ไม่ validate transition และไม่ set `data.status`; SOLD + (repairCost|resellPrice) → `BadRequestException`

- [ ] **Step 1: เขียน failing tests**

```ts
describe('update self-transition & SOLD lock', () => {
  const owner = { id: 'user-1', role: 'OWNER' as const };

  it('status เดิม (REPOSSESSED→REPOSSESSED) + แก้ค่าซ่อม → ไม่ throw, ไม่ส่ง status ใน data', async () => {
    prisma.repossession.findUnique.mockResolvedValue(makeRepossession({ status: 'REPOSSESSED' }));
    prisma.repossession.update.mockResolvedValue(makeRepossession());
    await service.update('repo-1', { repairCost: 500, status: 'REPOSSESSED' }, owner);
    expect(prisma.repossession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ status: expect.anything() }),
      }),
    );
  });

  it('SOLD + แก้ repairCost → BadRequestException ภาษาไทย', async () => {
    prisma.repossession.findUnique.mockResolvedValue(makeRepossession({ status: 'SOLD' }));
    await expect(
      service.update('repo-1', { repairCost: 999, status: 'SOLD' }, owner),
    ).rejects.toThrow(BadRequestException);
  });

  it('SOLD + แก้เฉพาะ notes → สำเร็จ', async () => {
    prisma.repossession.findUnique.mockResolvedValue(makeRepossession({ status: 'SOLD' }));
    prisma.repossession.update.mockResolvedValue(makeRepossession({ status: 'SOLD' }));
    await expect(
      service.update('repo-1', { notes: 'ขายผ่าน Facebook', status: 'SOLD' }, owner),
    ).resolves.toBeTruthy();
  });

  it('transition ผิด (REPOSSESSED→SOLD) ยัง reject เหมือนเดิม', async () => {
    prisma.repossession.findUnique.mockResolvedValue(makeRepossession({ status: 'REPOSSESSED' }));
    await expect(
      service.update('repo-1', { status: 'SOLD' }, owner),
    ).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: รันให้ fail**

Run: `cd apps/api && npx jest src/modules/repossessions/repossessions.service.spec.ts -t "self-transition" --silent`
Expected: FAIL (self-transition throw "ไม่สามารถเปลี่ยนสถานะจาก REPOSSESSED เป็น REPOSSESSED")

- [ ] **Step 3: Implement — ใน `update()` หลังสร้าง `data` และก่อน `if (dto.status)`**

```ts
    // เครื่องที่ขายแล้ว: repairCost/resellPrice ถูกใช้คำนวณกำไรในรายงานไปแล้ว —
    // แก้ย้อนหลังโดยไม่มี JE = ตัวเลขรายงานเปลี่ยนเงียบๆ ไม่มี audit trail
    if (repo.status === 'SOLD' && (dto.repairCost !== undefined || dto.resellPrice !== undefined)) {
      throw new BadRequestException(
        'เครื่องที่ขายแล้วแก้ไขค่าซ่อม/ราคาขายไม่ได้ (แก้ไขได้เฉพาะหมายเหตุ)',
      );
    }

    // ฟอร์มหน้าเว็บส่งสถานะปัจจุบันติดมาด้วยเสมอ — สถานะเดิมไม่ใช่การเปลี่ยนสถานะ
    const statusChanged = dto.status !== undefined && dto.status !== repo.status;
```

แล้วเปลี่ยน `if (dto.status) {` เป็น `if (statusChanged) {` (ทั้ง block ภายในคงเดิม — `dto.status` ภายใน block ยังเป็น string เพราะ statusChanged การันตี)

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/api && npx jest src/modules/repossessions --silent`
Expected: PASS ทั้งหมด

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/repossessions/
git commit -m "fix(repossessions): สถานะเดิม = no-op (ฟอร์มจัดการไม่ 400) + ล็อคตัวเลขเงินหลัง SOLD

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: กรอง deletedAt ใน create()/JP5 + @Min(0) บน DTO เงิน

`create()` โหลด payments โดยไม่กรอง soft-delete (preview กรอง) → ยอดปิด/parity เพี้ยนได้; JP5 template query PAID payments ก็ไม่กรอง; DTO เงินรับค่าติดลบได้ → JE debit ติดลบ

**Files:**
- Modify: `apps/api/src/modules/repossessions/repossessions.service.ts:312` (create's contract.findUnique)
- Modify: `apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.ts:142-145`
- Modify: `apps/api/src/modules/repossessions/dto/create-repossession.dto.ts`
- Test: `apps/api/src/modules/repossessions/repossessions.service.spec.ts`

**Interfaces:**
- Consumes: —
- Produces: create() include shape ใหม่ (spec ของเดิมที่ mock `contract.findUnique` ไม่ต้องแก้ เพราะ mock ไม่สน argument)

- [ ] **Step 1: เขียน failing test**

```ts
it('create() โหลด payments เฉพาะ deletedAt:null (เหมือน previewCalculation)', async () => {
  // ทุกงวด PAID → outstandingBalance = 0 → ข้าม JP5/CN path ทั้งชุด — test นี้
  // สนแค่ shape ของ include จึงไม่ต้องพึ่ง mock ของ jp5/creditNoteService เลย
  const allPaid = makeContract({ status: 'TERMINATED' }).payments.map((p) => ({
    ...p,
    status: 'PAID',
    amountPaid: p.amountDue,
  }));
  prisma.contract.findUnique.mockResolvedValue(
    makeContract({ status: 'TERMINATED', payments: allPaid }),
  );
  prisma.systemConfig.findUnique.mockResolvedValue(null);
  prisma.repossession.create.mockResolvedValue(makeRepossession());
  prisma.contract.update.mockResolvedValue({});
  prisma.product.update.mockResolvedValue({});
  prisma.auditLog.create.mockResolvedValue({});
  await service.create(
    {
      contractId: 'contract-1',
      repossessedDate: '2026-08-07',
      conditionGrade: 'B',
      appraisalPrice: 5000,
    },
    'user-1',
  );
  expect(prisma.contract.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({
      include: expect.objectContaining({
        payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
      }),
    }),
  );
});
```

(mock `systemConfig`/`product`/`auditLog` มีอยู่แล้วใน beforeEach ของ spec — เคส create เดิมใช้อยู่; ถ้าตัวไหนขาดให้เพิ่มใน beforeEach ตาม pattern เดิม ไม่ใช่ในตัว test)

- [ ] **Step 2: รันให้ fail**

Run: `cd apps/api && npx jest src/modules/repossessions/repossessions.service.spec.ts -t "deletedAt" --silent`
Expected: FAIL (include เดิมคือ `payments: true`)

- [ ] **Step 3: Implement**

`repossessions.service.ts` create() (~line 310-313):

```ts
      const contract = await tx.contract.findUnique({
        where: { id: dto.contractId },
        include: {
          product: true,
          // mirror previewCalculation — แถว soft-deleted ห้ามเข้าสูตรยอดปิด/JP5 gate
          payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
        },
      });
```

`repossession-jp5.template.ts` (~line 142-145):

```ts
    const paidPayments = await client.payment.findMany({
      // deletedAt:null — แถว PAID ที่ถูก soft-delete ไม่ใช่หลักฐานว่ารับเงินจริง
      // (convention เดียวกับ compute-cn-breakdown I1 fix)
      where: { contractId: c.id, status: 'PAID', deletedAt: null },
      select: { installmentNo: true },
    });
```

`create-repossession.dto.ts` — เพิ่ม `Min, Max` เข้า import จาก class-validator แล้วแก้ field เงิน:

```ts
  @IsNumber({}, { message: 'กรุณาระบุราคาประเมิน' })
  @Min(0, { message: 'ราคาประเมินต้องไม่ติดลบ' })
  appraisalPrice: number;

  @IsNumber({}, { message: 'กรุณาระบุค่าซ่อม' })
  @Min(0, { message: 'ค่าซ่อมต้องไม่ติดลบ' })
  @IsOptional()
  repairCost?: number;

  @IsNumber({}, { message: 'กรุณาระบุราคาขายต่อ' })
  @Min(0, { message: 'ราคาขายต่อต้องไม่ติดลบ' })
  @IsOptional()
  resellPrice?: number;
```

```ts
  @IsNumber({}, { message: 'ราคากลางต้องเป็นตัวเลข' })
  @Min(0, { message: 'ราคากลางต้องไม่ติดลบ' })
  @IsOptional()
  marketValue?: number;

  @IsNumber({}, { message: 'ส่วนลดต้องเป็นตัวเลข' })
  @Min(0, { message: 'ส่วนลดต้องไม่ติดลบ' })
  @Max(100, { message: 'ส่วนลดต้องไม่เกิน 100%' })
  @IsOptional()
  discountPct?: number;
```

และใน `UpdateRepossessionDto`:

```ts
  @IsNumber()
  @Min(0, { message: 'ค่าซ่อมต้องไม่ติดลบ' })
  @IsOptional()
  repairCost?: number;

  @IsNumber()
  @Min(0, { message: 'ราคาขายต่อต้องไม่ติดลบ' })
  @IsOptional()
  resellPrice?: number;
```

- [ ] **Step 4: รันให้ผ่าน + type check**

Run: `cd apps/api && npx jest src/modules/repossessions --silent` แล้ว `./tools/check-types.sh api`
Expected: PASS / 0 errors
(JP5 template เปลี่ยนแค่ where clause — spec DB-backed ของ template รันใน CI vitest ตามปกติ ไม่ต้องรัน local ถ้าไม่มี DB)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/repossessions/ apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.ts
git commit -m "fix(repossessions): กรอง deletedAt ใน create()+JP5 paid query + @Min(0) DTO เงิน กัน JE ติดลบ

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: update(READY_FOR_SALE) ใช้ราคาประเมินเป็น costPrice (mirror markReadyForSale)

ปัจจุบัน update() ตั้ง `product.costPrice = resellPrice` (ราคาขาย!) ขัดกับ markReadyForSale ที่ใช้ appraisalPrice — ทำ margin ตอนขายจริงเป็น ~0

**Files:**
- Modify: `apps/api/src/modules/repossessions/repossessions.service.ts` (~line 624-631, READY_FOR_SALE branch ใน update)
- Test: `apps/api/src/modules/repossessions/repossessions.service.spec.ts` (มี test costPrice เดิมอยู่ — แก้ expectation)

**Interfaces:**
- Consumes: `update(id, dto, user?)` จาก Task 1
- Produces: costPrice = `repo.appraisalPrice` ก่อนเสมอ, fallback `dto.resellPrice` เมื่อ appraisal เป็น 0/null

- [ ] **Step 1: เขียน/แก้ test**

หา test เดิมใน spec ที่ assert costPrice ของ READY_FOR_SALE (grep `READY_FOR_SALE` ใน spec) แล้วแก้ + เพิ่ม:

```ts
it('READY_FOR_SALE ตั้ง costPrice = ราคาประเมิน ไม่ใช่ราคาขายต่อ (R-007/TAS 2)', async () => {
  prisma.repossession.findUnique.mockResolvedValue(
    makeRepossession({ status: 'REPOSSESSED', appraisalPrice: decimal(3000) }),
  );
  prisma.repossession.update.mockResolvedValue(makeRepossession({ status: 'READY_FOR_SALE' }));
  prisma.product.update.mockResolvedValue({});
  await service.update(
    'repo-1',
    { status: 'READY_FOR_SALE', resellPrice: 5500 },
    { id: 'user-1', role: 'OWNER' },
  );
  expect(prisma.product.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ costPrice: new Prisma.Decimal(3000) }),
    }),
  );
});
```

- [ ] **Step 2: รันให้ fail**

Run: `cd apps/api && npx jest src/modules/repossessions/repossessions.service.spec.ts -t "costPrice" --silent`
Expected: FAIL (โค้ดเดิมได้ 5500)

- [ ] **Step 3: Implement — แทน block เดิมใน update()**

```ts
          if (dto.status === 'READY_FOR_SALE') {
            // R-007/TAS 2: fair value ณ วันยึด = ราคาประเมิน (mirror markReadyForSale) —
            // ใช้ราคาขายต่อเป็น costPrice จะทำให้ margin ตอนขายจริงเป็นศูนย์
            const appraisal = new Prisma.Decimal(repo.appraisalPrice ?? 0);
            const fallback =
              dto.resellPrice != null ? new Prisma.Decimal(dto.resellPrice) : new Prisma.Decimal(0);
            const costBasis = appraisal.greaterThan(0) ? appraisal : fallback;
            if (costBasis.greaterThan(0)) {
              productUpdateData.costPrice = costBasis;
            }
          }
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/api && npx jest src/modules/repossessions --silent`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/repossessions/
git commit -m "fix(repossessions): READY_FOR_SALE ใช้ราคาประเมินเป็น costPrice (mirror markReadyForSale, R-007)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### ✋ Phase 1 Gate

- [ ] รัน `cd apps/api && npx jest src/modules/repossessions --silent` + `./tools/check-types.sh api` — ทุกอย่างเขียว
- [ ] Dispatch `code-reviewer` subagent review diff ของ Phase 1 — แก้ Critical/Warning ก่อนไปต่อ
- [ ] **STOP — สรุปผล Phase 1 ให้เจ้าของ review + approve ก่อนเริ่ม Phase 2**

---

# Phase 2 — Frontend: หน้า /repossessions ใหม่

### Task 5: ตัด create modal legacy + CTA ชี้หน้ารับชำระ

**Files:**
- Modify: `apps/web/src/pages/RepossessionsPage.tsx` (ลบ ~line 75-108 states/queries, 129-160 createMutation+preview, 229-244 handleCreate, 501-775 modal JSX)

**Interfaces:**
- Consumes: route `/payments` (RecordPaymentWizard → RepossessionOverlay คือทางยึดเครื่องจริง)
- Produces: หน้า list-only — Task 6/7 ทำงานต่อบนไฟล์นี้

- [ ] **Step 1: ลบของที่ตายแล้วออกทั้งชุด**

ลบออกจาก `RepossessionsPage.tsx`:
- state: `isCreateModalOpen`, `createForm`
- query: `overdueContracts` (contracts-for-repo), `previewData` (repossession-preview)
- mutation: `createMutation`, function `handleCreate`
- JSX ทั้ง block `{isCreateModalOpen && (...)}` (create modal เต็มจอ)
- import ที่เลิกใช้: `ThaiDateInput`, `Check`, `X` (ตรวจด้วย type check อีกรอบ — ใช้เฉพาะใน modal)

- [ ] **Step 2: เปลี่ยน PageHeader**

```tsx
import { Link } from 'react-router-dom';
```

```tsx
      <PageHeader
        title="ยึดคืน & ขายต่อ"
        subtitle="จัดการเครื่องที่ยึดคืนแล้ว — การยึดเครื่องทำผ่านหน้ารับชำระ (เลือกสัญญา → ยึดเครื่อง)"
        action={
          <Link
            to="/payments"
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            ยึดเครื่อง — ไปหน้ารับชำระ
          </Link>
        }
      />
```

- [ ] **Step 3: Verify**

Run: `./tools/check-types.sh web`
Expected: 0 errors
Run: `cd apps/web && npx eslint src/pages/RepossessionsPage.tsx`
Expected: no unused-import errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/RepossessionsPage.tsx
git commit -m "feat(repossessions): ตัด create modal legacy (ตายเพราะ strict mode + ลง KBank ผิด) — ชี้ไปหน้ารับชำระ

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: ปุ่ม "พร้อมขาย" ถามราคาขายต่อก่อนยิง

**Files:**
- Modify: `apps/web/src/pages/RepossessionsPage.tsx`

**Interfaces:**
- Consumes: `POST /repossessions/:id/ready-for-sale` body `{ resellPrice: number }` (ReadyForSaleDto)
- Produces: modal state `readyForSaleRepo` ที่ Task 7 ใช้ตอน role-gate ปุ่ม

- [ ] **Step 1: แทน mutation เดิม + เพิ่ม state**

```tsx
  const [readyForSaleRepo, setReadyForSaleRepo] = useState<Repossession | null>(null);
  const [readyForSalePrice, setReadyForSalePrice] = useState('');

  const readyForSaleMutation = useMutation({
    mutationFn: async ({ id, resellPrice }: { id: string; resellPrice: number }) =>
      api.post(`/repossessions/${id}/ready-for-sale`, { resellPrice }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
      toast.success('เปลี่ยนสถานะเป็น พร้อมขาย แล้ว');
      setReadyForSaleRepo(null);
      setReadyForSalePrice('');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
```

- [ ] **Step 2: เปลี่ยนปุ่มในคอลัมน์ actions (แทน setConfirmDialog เดิม)**

```tsx
          {(r.status === 'REPOSSESSED' || r.status === 'UNDER_REPAIR') && (
            <button
              onClick={() => {
                setReadyForSaleRepo(r);
                setReadyForSalePrice(r.resellPrice ? String(Number(r.resellPrice)) : '');
              }}
              className="text-success hover:text-success/80 text-sm font-medium"
            >
              พร้อมขาย
            </button>
          )}
```

(ถ้า `confirmDialog` state + `ConfirmDialog` ไม่มีผู้ใช้อื่นเหลือ — ลบ state, import และ JSX ท้ายไฟล์ออกด้วย)

- [ ] **Step 3: เพิ่ม Modal (วางถัดจาก settlement Modal)**

```tsx
      {/* พร้อมขาย Modal — ต้องระบุราคาขายต่อ (endpoint บังคับ + ย้ายเครื่องกลับคลังหลัก) */}
      <Modal
        isOpen={!!readyForSaleRepo}
        onClose={() => setReadyForSaleRepo(null)}
        title="เปลี่ยนสถานะเป็น พร้อมขาย"
      >
        {readyForSaleRepo && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              readyForSaleMutation.mutate({
                id: readyForSaleRepo.id,
                resellPrice: Number(readyForSalePrice),
              });
            }}
            className="space-y-4"
          >
            <div className="bg-muted rounded-lg p-3 text-sm space-y-0.5">
              <div><strong>สินค้า:</strong> {readyForSaleRepo.product.brand} {readyForSaleRepo.product.model}</div>
              <div><strong>ราคาตี:</strong> {Number(readyForSaleRepo.appraisalPrice).toLocaleString()} บาท</div>
              <div className="text-xs text-muted-foreground leading-snug pt-1">
                เครื่องจะย้ายกลับคลังหลักและตั้งราคาขาย Refurbished ตามที่ระบุ
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                ราคาขายต่อ (บาท) <span className="text-destructive">*</span>
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={readyForSalePrice}
                onChange={(e) => setReadyForSalePrice(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-hidden focus:ring-2 focus:ring-ring/20"
                placeholder="0.00"
                required
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setReadyForSaleRepo(null)}
                className="px-5 py-2.5 text-sm border border-border rounded-lg hover:bg-accent transition-colors"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={readyForSaleMutation.isPending || !(Number(readyForSalePrice) > 0)}
                className="px-6 py-2.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg disabled:opacity-50 font-semibold transition-colors"
              >
                {readyForSaleMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยัน พร้อมขาย'}
              </button>
            </div>
          </form>
        )}
      </Modal>
```

- [ ] **Step 4: Verify + commit**

Run: `./tools/check-types.sh web`
Expected: 0 errors

```bash
git add apps/web/src/pages/RepossessionsPage.tsx
git commit -m "fix(repossessions): ปุ่มพร้อมขายถามราคาขายต่อก่อนยิง (เดิม fail 100% เพราะไม่ส่ง body)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Role gating บนหน้า + gate P&L query

**Files:**
- Modify: `apps/web/src/pages/RepossessionsPage.tsx`

**Interfaces:**
- Consumes: API roles จริง — PATCH + ready-for-sale = `OWNER, BRANCH_MANAGER`; GET profit-loss = `OWNER, FINANCE_MANAGER, ACCOUNTANT`; settlement = `OWNER, FINANCE_MANAGER, ACCOUNTANT` (canSettle เดิมถูกแล้ว)
- Produces: ตัวแปร `canManage`, `canViewPl`

- [ ] **Step 1: เพิ่ม role flags ใต้ `canSettle` (line ~65)**

```tsx
  // PATCH /repossessions/:id + POST :id/ready-for-sale = OWNER/BRANCH_MANAGER เท่านั้น
  const canManage = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');
  // GET /repossessions/profit-loss = OWNER/FM/ACC — gate query กัน 403 เงียบๆ + retry รัวๆ
  const canViewPl = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(user?.role ?? '');
```

- [ ] **Step 2: Gate ปุ่ม + query**

- ปุ่ม "พร้อมขาย" (จาก Task 6) และ "จัดการ": ห่อเงื่อนไข `{canManage && (...)}`
- profitLoss query: เพิ่ม `enabled: canViewPl`

```tsx
  const { data: profitLoss } = useQuery({
    queryKey: ['repossessions-pl'],
    queryFn: async () => (await api.get('/repossessions/profit-loss')).data,
    enabled: canViewPl,
  });
```

- [ ] **Step 3: Verify + commit**

Run: `./tools/check-types.sh web`
Expected: 0 errors

```bash
git add apps/web/src/pages/RepossessionsPage.tsx
git commit -m "fix(repossessions): ซ่อนปุ่มตามสิทธิ์ API จริง (FM ไม่เจอ 403 ตอน submit) + gate P&L query

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: เปิดหน้าให้ ACCOUNTANT (route + เมนู)

ACC คือ persona ที่กด "รับโอนหน้าร้าน" + ส่งใบลดหนี้ (API อนุญาตครบ: GET list/PL, settlement, send-line) แต่เข้าหน้าไม่ได้ — หน้าเว็บมี `canSettle` รวม ACC อยู่แล้ว

**Files:**
- Modify: `apps/web/src/App.tsx:743`
- Modify: `apps/web/src/config/menu.ts` (ACCOUNTANT_CONFIG, section `acc-daily` items ~line 395-401)

**Interfaces:**
- Consumes: `canSettle`/`canManage`/`canViewPl` จาก Task 7 (ACC: settle ได้, manage ไม่ได้, PL เห็น)
- Produces: —

- [ ] **Step 1: App.tsx — เพิ่ม ACCOUNTANT**

```tsx
          <Route
            path="/repossessions"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <RepossessionsPage />
              </ProtectedRoute>
            }
          />
```

- [ ] **Step 2: menu.ts — เพิ่มใน `acc-daily` items หลัง 'จัดการจดหมาย'** (icon `Lock` มี import อยู่แล้ว — FM/OWNER ใช้)

```ts
        { label: 'ยึดคืนเครื่อง', path: '/repossessions', icon: Lock },
```

- [ ] **Step 3: Verify + commit**

Run: `./tools/check-types.sh web`
Expected: 0 errors

```bash
git add apps/web/src/App.tsx apps/web/src/config/menu.ts
git commit -m "feat(repossessions): เปิดหน้าให้ ACCOUNTANT (persona รับโอนหน้าร้าน/ใบลดหนี้ — API อนุญาตอยู่แล้ว)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### ✋ Phase 2 Gate

- [ ] `./tools/check-types.sh all` เขียว + `cd apps/web && npm run test` (vitest 129 baseline ไม่แตก)
- [ ] Smoke ด้วยตา: dev server → /repossessions ในบทบาท OWNER (ทุกปุ่ม), FINANCE_MANAGER (ไม่เห็นปุ่มจัดการ/พร้อมขาย เห็นรับโอน), ACCOUNTANT (เข้าได้จากเมนู)
- [ ] Dispatch `code-reviewer` subagent review diff Phase 2
- [ ] **STOP — สรุปผล Phase 2 ให้เจ้าของ review + approve ก่อนเริ่ม Phase 3**

---

# Phase 3 — Settlement idempotency (requestId)

### Task 9: shop-collect settlement กันยิงซ้ำด้วย requestId แทน (contractId, amount)

ปัจจุบันโอนจากหน้าร้าน 2 ครั้งยอดเท่ากัน (เช่น งวดละ 2,500 สองรอบ) → ครั้งที่ 2 โดน idempotency กลืนเงียบๆ แต่ UI toast สำเร็จ = เงินจริงไม่ถูกบันทึก. แก้เป็น client สร้าง `requestId` (UUID) ต่อการกดหนึ่งครั้ง — retry เดิมซ้ำได้ปลอดภัย, ตั้งใจโอนซ้ำยอดเท่ากันผ่านได้

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/shop-collect-settlement.template.ts`
- Modify: `apps/api/src/modules/contracts/dto/contract.dto.ts` (ShopCollectSettlementDto, line 175-190)
- Modify: `apps/api/src/modules/contracts/contract-payment.service.ts` (shopCollectSettlement, line 545-556)
- Modify: `apps/web/src/pages/RepossessionsPage.tsx`, `apps/web/src/components/contract/ContractEarlyPayoff.tsx`, `apps/web/src/pages/PaymentsPage/components/RepossessionOverlay.tsx` (ผู้เรียก endpoint ทั้ง 3 จุด)
- Test: `apps/api/src/modules/contracts/shop-collect-settlement.integration.spec.ts` (vitest DB-backed)

**Interfaces:**
- Consumes: `ShopCollectSettlementTemplate.execute(input, outerTx?)` เดิม
- Produces: `ShopCollectSettlementInput.requestId?: string`; `ShopCollectSettlementDto.requestId?: string` (UUID v4, optional — backward compatible: ไม่ส่ง = พฤติกรรมเดิม)

- [ ] **Step 1: เขียน failing integration tests (ต่อท้าย describe เดิม — ใช้ helper seed + `svc: ContractPaymentService` ที่ไฟล์มีอยู่แล้ว, ทำตามแบบ test "partial settlement" ~line 366)**

```ts
  it('requestId ต่างกัน ยอดเท่ากัน → post 2 JE (โอนซ้ำยอดเท่ากันโดยตั้งใจต้องไม่หาย)', async () => {
    // seed contract ที่มี Dr 11-2107 = 5000 ตามแบบเคส partial เดิมในไฟล์นี้
    await svc.shopCollectSettlement(cPartial2.id, userId, {
      depositAccountCode: '11-1201',
      amount: 2500,
      requestId: '11111111-1111-4111-8111-111111111111',
    });
    await svc.shopCollectSettlement(cPartial2.id, userId, {
      depositAccountCode: '11-1201',
      amount: 2500,
      requestId: '22222222-2222-4222-8222-222222222222',
    });
    const jes = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'shop-collect-settlement' } } as any,
          { metadata: { path: ['contractId'], equals: cPartial2.id } } as any,
        ],
        deletedAt: null,
      },
    });
    expect(jes).toHaveLength(2);
  });

  it('requestId เดิมซ้ำ → JE เดียว (retry ปลอดภัย)', async () => {
    const requestId = '33333333-3333-4333-8333-333333333333';
    const r1 = await svc.shopCollectSettlement(cRetry.id, userId, {
      depositAccountCode: '11-1201',
      amount: 1000,
      requestId,
    });
    const r2 = await svc.shopCollectSettlement(cRetry.id, userId, {
      depositAccountCode: '11-1201',
      amount: 1000,
      requestId,
    });
    // ทั้งสองครั้งสำเร็จ; JE ใน DB มีใบเดียว
    const jes = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'shop-collect-settlement' } } as any,
          { metadata: { path: ['contractId'], equals: cRetry.id } } as any,
        ],
        deletedAt: null,
      },
    });
    expect(jes).toHaveLength(1);
  });
```

(seed contract `cPartial2`/`cRetry` ใหม่ด้วย helper เดียวกับที่เคสเดิมใช้ — ห้าม reuse contract ของเคสอื่นเพราะยอด 11-2107 จะปนกัน; service signature คือ `shopCollectSettlement(id, userId, dto)`)

- [ ] **Step 2: รันให้ fail (ต้องมี local DB — `docker compose up -d` ตาม Local Dev Setup; ถ้าไม่มี DB ให้ข้ามการรัน local และพึ่ง CI vitest step แต่ต้องเขียน test ก่อนโค้ดอยู่ดี)**

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/contracts/shop-collect-settlement.integration.spec.ts`
Expected: FAIL — เคสแรกได้ 1 JE (ครั้งที่สองโดน (contractId, amount) dedupe กลืน)

- [ ] **Step 3: Implement template**

`shop-collect-settlement.template.ts`:

Input interface เพิ่ม field:

```ts
export interface ShopCollectSettlementInput {
  contractId: string;
  /** Cash/bank account that receives the remittance from the shop (must be in CASH_ACCOUNT_CODES). */
  depositAccountCode: string;
  /** Amount to settle — must be ≤ outstanding 11-2107 balance + 0.01 tolerance. */
  amount: number | Decimal;
  postedById?: string;
  /**
   * Client-generated UUID ต่อการกดยืนยันหนึ่งครั้ง — dedupe เฉพาะ retry ของคำขอเดิม
   * โดยไม่กลืนการโอนซ้ำยอดเท่ากันที่ตั้งใจ. ไม่ส่ง = fallback dedupe แบบเก่า
   * (contractId+amount) เพื่อ backward compat กับ caller เดิม.
   */
  requestId?: string;
}
```

หลัง validate depositAccountCode (ก่อนคำนวณ outstanding — เพื่อให้ retry หลังยอดถูกล้างหมดแล้วยังคืน success แบบ idempotent แทนที่จะชน outstanding guard):

```ts
    const client = outerTx ?? this.prisma;

    // ── requestId idempotency (เช็คก่อน guard อื่นทั้งหมด) ─────────────────────
    if (input.requestId) {
      const dupe = await client.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'shop-collect-settlement' } } as Prisma.JournalEntryWhereInput,
            { metadata: { path: ['requestId'], equals: input.requestId } } as Prisma.JournalEntryWhereInput,
          ],
          deletedAt: null,
        },
      });
      if (dupe) {
        this.logger.log(
          `[SCS] duplicate requestId ${input.requestId} — JE ${dupe.entryNumber} already posted, skipping`,
        );
        return { entryNo: dupe.entryNumber };
      }
    }
```

Legacy check เดิม (contractId+amount) — ห่อเงื่อนไข ใช้เฉพาะเมื่อไม่มี requestId:

```ts
    // ── Legacy idempotency (เฉพาะ caller เก่าที่ไม่ส่ง requestId) ─────────────
    if (!input.requestId) {
      const existing = await client.journalEntry.findFirst({
        // ...where เดิมทุกประการ...
      });
      if (existing) {
        // ...log + return เดิม...
      }
    }
```

metadata ของ JE ที่ post:

```ts
        metadata: {
          tag: 'SCS',
          flow: 'shop-collect-settlement',
          contractId,
          amount: amount.toFixed(2),
          depositAccountCode,
          ...(input.requestId ? { requestId: input.requestId } : {}),
          idempotencyKey: input.requestId
            ? `${contractId}:${input.requestId}`
            : `${contractId}:${amount.toFixed(2)}`,
        },
```

(DB-level partial unique index `journal_entries_idempotency_idx` บน flow+idempotencyKey คุ้ม race ซ้ำชั้นที่สองให้อัตโนมัติ)

- [ ] **Step 4: DTO + service**

`contract.dto.ts` — เพิ่ม `IsUUID` เข้า import class-validator แล้วเพิ่มใน `ShopCollectSettlementDto`:

```ts
  /** ไอดีคำขอจากหน้าจอ — กัน retry ซ้ำโดยไม่กลืนการโอนซ้ำยอดเท่ากันที่ตั้งใจ */
  @IsUUID(4, { message: 'requestId ไม่ถูกต้อง' })
  @IsOptional()
  requestId?: string;
```

`contract-payment.service.ts` shopCollectSettlement — ส่งต่อ:

```ts
        await this.shopCollectSettlementTemplate.execute(
          {
            contractId: id,
            depositAccountCode: dto.depositAccountCode,
            amount: dto.amount,
            postedById: userId,
            requestId: dto.requestId,
          },
          tx,
        );
```

- [ ] **Step 5: FE — 3 callers ส่ง requestId (สร้างใหม่ตอนเปิด dialog, ไม่ใช่ตอน submit — ให้ retry จาก error เดิมใช้ id เดิม)**

`RepossessionsPage.tsx`:

```tsx
  const [settlementRequestId, setSettlementRequestId] = useState('');
```

ใน `openSettlement`:

```tsx
  const openSettlement = (repo: Repossession) => {
    setSettlementRepo(repo);
    setSettlementAmount(String(Number(repo.appraisalPrice)));
    setSettlementAccountCode('11-1201');
    setSettlementRequestId(crypto.randomUUID());
  };
```

ใน mutation body:

```tsx
      api.post(`/contracts/${settlementRepo!.contract.id}/shop-collect-settlement`, {
        depositAccountCode: settlementAccountCode,
        amount: Number(settlementAmount),
        requestId: settlementRequestId,
      }),
```

`ContractEarlyPayoff.tsx` และ `RepossessionOverlay.tsx` — pattern เดียวกัน: เพิ่ม state `settlementRequestId`, set `crypto.randomUUID()` ตรงจุดที่เปิด settlement dialog (`setSettlementOpen(true)` / จุดเปิด dialog ของแต่ละไฟล์), แล้วแนบ `requestId: settlementRequestId` ใน POST body ของ settlementMutation (line ~164 และ ~185 ตามลำดับ)

- [ ] **Step 6: รัน tests ให้ผ่าน + type check**

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/contracts/shop-collect-settlement.integration.spec.ts`
Expected: PASS ทุกเคส (เดิม + 2 ใหม่)
Run: `./tools/check-types.sh all`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/shop-collect-settlement.template.ts apps/api/src/modules/contracts/ apps/web/src/pages/RepossessionsPage.tsx apps/web/src/components/contract/ContractEarlyPayoff.tsx apps/web/src/pages/PaymentsPage/components/RepossessionOverlay.tsx
git commit -m "fix(journal): shop-collect settlement idempotency ด้วย requestId — โอนซ้ำยอดเท่ากันไม่ถูกกลืนเงียบ

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### ✋ Phase 3 Gate + Ship

- [ ] `cd apps/api && npx jest src/modules/repossessions --silent` + integration spec + `./tools/check-types.sh all` — เขียวหมด
- [ ] Dispatch `code-reviewer` subagent review diff Phase 3
- [ ] **STOP — สรุปทั้ง 3 phases ให้เจ้าของ approve**
- [ ] `/pre-deploy` checklist → เปิด PR จาก `fix/repossessions-page-rework-2026-08` → merge (CI auto-deploy main)
