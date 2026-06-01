# Unified Contact Party Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มชั้น `Contact` (party master) เหนือ Customer/Supplier/TradeIn/ExternalFinanceCompany เพื่อให้ 1 คู่สัญญา = 1 record (ระบุด้วย taxId/บัตรปชช.), มีได้หลาย role, และมีหน้า `/contacts` รวมค้นหา/ดูทุกประเภทที่เดียว

**Architecture:** Business-Partner pattern — เพิ่ม model `Contact` + field `contactId` ชี้กลับจาก model เดิม โดยไม่แก้ FK เดิม. Service กลาง `findOrCreateByNaturalKey()` ผูก role ตอนสร้าง entity ใหม่. Backfill CLI สร้าง Contact จากข้อมูลที่มีอยู่ (dedup ด้วย taxId/nationalIdHash, ไม่ auto-merge เมื่อไม่ชัวร์).

**Tech Stack:** NestJS + Prisma + PostgreSQL (api), React + Vite + react-query + shadcn/ui (web), Jest (api tests), Vitest (web tests), tsx (backfill CLI)

**Spec:** `docs/superpowers/specs/2026-06-01-unified-contact-party-master-design.md`

---

## File Structure

**Backend (`apps/api`)**
- `prisma/schema.prisma` — add `model Contact`, enum `ContactRole`, `contactId` fields on Customer/Supplier/TradeIn/ExternalFinanceCompany
- `prisma/migrations/<ts>_add_contact_party_master/migration.sql` — generated
- `src/modules/contacts/contacts.module.ts`
- `src/modules/contacts/contacts.controller.ts` — `GET /contacts`, `GET /contacts/:id`, `POST /contacts/merge`
- `src/modules/contacts/contacts.service.ts` — list/detail/merge
- `src/modules/contacts/contact-resolver.service.ts` — `findOrCreateByNaturalKey()` + `contactCode` generator
- `src/modules/contacts/dto/list-contacts.dto.ts`, `dto/merge-contacts.dto.ts`
- `src/modules/contacts/__tests__/*.spec.ts`
- `scripts/backfill-contacts.ts` — one-time backfill
- `package.json` — add `backfill:contacts` script
- `src/app.module.ts` — register ContactsModule

**Frontend (`apps/web`)**
- `src/lib/api/contacts.ts` — api client + types + query keys
- `src/pages/ContactsPage.tsx` — list page (PEAK-style)
- `src/pages/ContactDetailPage.tsx` — party detail with roles
- `src/App.tsx` — routes `/contacts`, `/contacts/:id`
- `src/config/menu.ts` — add menu entries
- `src/pages/__tests__/ContactsPage.test.tsx`

---

## PHASE 1 — Contact model + natural-key resolver (backend foundation)

### Task 1: Add Contact schema

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Add the enum and model**

เพิ่มที่ส่วนบนของ schema (กลุ่ม enum) และวาง model ใกล้ๆ model Customer:

```prisma
enum ContactRole {
  CUSTOMER
  SUPPLIER
  TRADE_IN_SELLER
  FINANCE_COMPANY
}

model Contact {
  id              String        @id @default(uuid())
  contactCode     String        @unique @map("contact_code") // P-00001 (internal)
  peakContactCode String?       @map("peak_contact_code")    // C00790 (PEAK mapping, owner-filled)
  name            String
  taxId           String?       @map("tax_id")               // นิติบุคคล — natural key
  nationalIdHash  String?       @map("national_id_hash")     // บุคคล — natural key (hashPII)
  phone           String?
  email           String?
  address         String?
  lineId          String?       @map("line_id")
  roles           ContactRole[]
  isActive        Boolean       @default(true) @map("is_active")
  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")
  deletedAt       DateTime?     @map("deleted_at")

  customers              Customer[]
  suppliers              Supplier[]
  tradeInsAsSeller       TradeIn[]                 @relation("TradeInSeller")
  externalFinanceCompany ExternalFinanceCompany[]

  @@unique([taxId])
  @@index([nationalIdHash])
  @@index([deletedAt])
  @@map("contacts")
}
```

- [ ] **Step 2: Add `contactId` reference fields on existing models**

ใน `model Customer` เพิ่ม:
```prisma
  contactId String?  @map("contact_id")
  contact   Contact? @relation(fields: [contactId], references: [id])
```
ใน `model Supplier` เพิ่ม (เหมือนกัน):
```prisma
  contactId String?  @map("contact_id")
  contact   Contact? @relation(fields: [contactId], references: [id])
```
ใน `model TradeIn` เพิ่ม:
```prisma
  sellerContactId String?  @map("seller_contact_id")
  sellerContact   Contact? @relation("TradeInSeller", fields: [sellerContactId], references: [id])
```
ใน `model ExternalFinanceCompany` เพิ่ม:
```prisma
  contactId String?  @map("contact_id")
  contact   Contact? @relation(fields: [contactId], references: [id])
```
เพิ่ม `@@index([contactId])` (และ `@@index([sellerContactId])` บน TradeIn) ในแต่ละ model

- [ ] **Step 3: Generate migration (do NOT use migrate dev on prod)**

Run: `cd apps/api && npx prisma migrate dev --name add_contact_party_master`
Expected: migration สร้างที่ `prisma/migrations/<ts>_add_contact_party_master/` + Prisma Client regenerated. `contactId` ทุก field เป็น nullable (ปลอดภัยกับ table ที่มีข้อมูล — ตาม database.md)

- [ ] **Step 4: Verify types compile**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(contacts): add Contact party-master schema + nullable contactId refs"
```

---

### Task 2: contactCode generator (advisory-lock per-day, mirrors DocNumberService)

**Files:**
- Create: `apps/api/src/modules/contacts/contact-resolver.service.ts`
- Test: `apps/api/src/modules/contacts/__tests__/contact-resolver.service.spec.ts`

- [ ] **Step 1: Write the failing test for code generation**

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContactResolverService } from '../contact-resolver.service';

describe('ContactResolverService.nextContactCode', () => {
  let svc: ContactResolverService;
  let prisma: { $executeRawUnsafe: jest.Mock; contact: { findFirst: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      contact: { findFirst: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        ContactResolverService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = mod.get(ContactResolverService);
  });

  it('starts at P-00001 when no contacts exist', async () => {
    prisma.contact.findFirst.mockResolvedValue(null);
    const code = await svc.nextContactCode(prisma as any);
    expect(code).toBe('P-00001');
    expect(prisma.$executeRawUnsafe).toHaveBeenCalled(); // advisory lock taken
  });

  it('increments from the last code', async () => {
    prisma.contact.findFirst.mockResolvedValue({ contactCode: 'P-00042' });
    const code = await svc.nextContactCode(prisma as any);
    expect(code).toBe('P-00043');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest contact-resolver --silent`
Expected: FAIL — cannot find module `../contact-resolver.service`

- [ ] **Step 3: Implement the generator**

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class ContactResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sequential internal code P-NNNNN, serialized via a global advisory lock. */
  async nextContactCode(tx: Tx): Promise<string> {
    const lockKey = this.hashLockKey('contact:code');
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);
    const last = await tx.contact.findFirst({
      where: { contactCode: { startsWith: 'P-' } },
      orderBy: { contactCode: 'desc' },
      select: { contactCode: true },
    });
    const lastSeq = last ? parseInt(last.contactCode.split('-')[1], 10) || 0 : 0;
    return `P-${String(lastSeq + 1).padStart(5, '0')}`;
  }

  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return h;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest contact-resolver --silent`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/contacts
git commit -m "feat(contacts): contactCode generator with advisory lock"
```

---

### Task 3: findOrCreateByNaturalKey

**Files:**
- Modify: `apps/api/src/modules/contacts/contact-resolver.service.ts`
- Test: `apps/api/src/modules/contacts/__tests__/contact-resolver.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

เพิ่ม describe block ในไฟล์ test เดิม:
```typescript
describe('ContactResolverService.findOrCreateByNaturalKey', () => {
  let svc: ContactResolverService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      contact: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [ContactResolverService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    svc = mod.get(ContactResolverService);
  });

  it('creates a new Contact when no natural-key match', async () => {
    prisma.contact.findFirst
      .mockResolvedValueOnce(null) // natural-key lookup
      .mockResolvedValueOnce(null); // nextContactCode lookup
    prisma.contact.create.mockResolvedValue({ id: 'c1', roles: ['CUSTOMER'] });
    const res = await svc.findOrCreateByNaturalKey(prisma, {
      name: 'สมชาย', taxId: null, nationalIdHash: 'h1', role: 'CUSTOMER',
    });
    expect(prisma.contact.create).toHaveBeenCalled();
    expect(res.id).toBe('c1');
  });

  it('adds the role to an existing Contact matched by nationalIdHash', async () => {
    prisma.contact.findFirst.mockResolvedValueOnce({ id: 'c1', roles: ['CUSTOMER'] });
    prisma.contact.update.mockResolvedValue({ id: 'c1', roles: ['CUSTOMER', 'TRADE_IN_SELLER'] });
    const res = await svc.findOrCreateByNaturalKey(prisma, {
      name: 'สมชาย', taxId: null, nationalIdHash: 'h1', role: 'TRADE_IN_SELLER',
    });
    expect(prisma.contact.create).not.toHaveBeenCalled();
    expect(prisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' } }),
    );
    expect(res.roles).toContain('TRADE_IN_SELLER');
  });

  it('does NOT duplicate a role already present', async () => {
    prisma.contact.findFirst.mockResolvedValueOnce({ id: 'c1', roles: ['CUSTOMER'] });
    const res = await svc.findOrCreateByNaturalKey(prisma, {
      name: 'สมชาย', taxId: null, nationalIdHash: 'h1', role: 'CUSTOMER',
    });
    expect(prisma.contact.update).not.toHaveBeenCalled();
    expect(res.id).toBe('c1');
  });

  it('creates a new Contact (no merge) when no natural key is available', async () => {
    prisma.contact.findFirst.mockResolvedValueOnce(null); // nextContactCode only
    prisma.contact.create.mockResolvedValue({ id: 'c2', roles: ['TRADE_IN_SELLER'] });
    const res = await svc.findOrCreateByNaturalKey(prisma, {
      name: 'คนเดินเข้า', taxId: null, nationalIdHash: null, role: 'TRADE_IN_SELLER',
    });
    // no natural key → never attempt a match, always create (safe no-auto-merge)
    expect(prisma.contact.create).toHaveBeenCalled();
    expect(res.id).toBe('c2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest contact-resolver --silent`
Expected: FAIL — `findOrCreateByNaturalKey is not a function`

- [ ] **Step 3: Implement findOrCreateByNaturalKey**

เพิ่ม method ใน ContactResolverService:
```typescript
import { ContactRole } from '@prisma/client';

export interface ResolveContactInput {
  name: string;
  taxId?: string | null;
  nationalIdHash?: string | null;
  phone?: string | null;
  email?: string | null;
  role: ContactRole;
}

// ...inside class ContactResolverService:

/**
 * Find the party master for these natural keys, or create one.
 * Matching priority: taxId, then nationalIdHash. When NEITHER key is
 * present we never match — always create a fresh Contact (safe
 * no-auto-merge policy for keyless walk-ins / trade-in sellers).
 * If a match is found, the role is appended (idempotent).
 */
async findOrCreateByNaturalKey(tx: Tx, input: ResolveContactInput) {
  const orClauses: Prisma.ContactWhereInput[] = [];
  if (input.taxId) orClauses.push({ taxId: input.taxId });
  if (input.nationalIdHash) orClauses.push({ nationalIdHash: input.nationalIdHash });

  if (orClauses.length > 0) {
    const existing = await tx.contact.findFirst({
      where: { deletedAt: null, OR: orClauses },
    });
    if (existing) {
      if (!existing.roles.includes(input.role)) {
        return tx.contact.update({
          where: { id: existing.id },
          data: { roles: { set: [...existing.roles, input.role] } },
        });
      }
      return existing;
    }
  }

  const contactCode = await this.nextContactCode(tx);
  return tx.contact.create({
    data: {
      contactCode,
      name: input.name,
      taxId: input.taxId ?? null,
      nationalIdHash: input.nationalIdHash ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      roles: [input.role],
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest contact-resolver --silent`
Expected: PASS (all tests in file)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/contacts
git commit -m "feat(contacts): findOrCreateByNaturalKey resolver (safe no-auto-merge)"
```

---

## PHASE 2 — Read API (list / detail / merge)

### Task 4: ListContactsDto

**Files:**
- Create: `apps/api/src/modules/contacts/dto/list-contacts.dto.ts`

- [ ] **Step 1: Write the DTO (no test needed — pure declarative)**

```typescript
import { IsBooleanString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ContactRole } from '@prisma/client';

export class ListContactsDto {
  @IsOptional() @IsString()
  search?: string;

  @IsOptional() @IsEnum(ContactRole)
  role?: ContactRole;

  @IsOptional() @IsBooleanString()
  isActive?: string; // 'true' | 'false'

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit?: number = 50;
}
```

- [ ] **Step 2: Verify types compile**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/contacts/dto/list-contacts.dto.ts
git commit -m "feat(contacts): ListContactsDto"
```

---

### Task 5: ContactsService.list

**Files:**
- Create: `apps/api/src/modules/contacts/contacts.service.ts`
- Test: `apps/api/src/modules/contacts/__tests__/contacts.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContactsService } from '../contacts.service';

describe('ContactsService.list', () => {
  let svc: ContactsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { contact: { findMany: jest.fn(), count: jest.fn() } };
    const mod = await Test.createTestingModule({
      providers: [ContactsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    svc = mod.get(ContactsService);
  });

  it('returns paginated shape and filters soft-deleted', async () => {
    prisma.contact.findMany.mockResolvedValue([{ id: 'c1', name: 'A' }]);
    prisma.contact.count.mockResolvedValue(1);
    const res = await svc.list({ page: 1, limit: 50 });
    expect(res).toEqual({ data: [{ id: 'c1', name: 'A' }], total: 1, page: 1, limit: 50 });
    const where = prisma.contact.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
  });

  it('filters by role via hasSome', async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    prisma.contact.count.mockResolvedValue(0);
    await svc.list({ role: 'SUPPLIER' as any, page: 1, limit: 50 });
    const where = prisma.contact.findMany.mock.calls[0][0].where;
    expect(where.roles).toEqual({ has: 'SUPPLIER' });
  });

  it('searches name / phone / taxId / contactCode (case-insensitive)', async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    prisma.contact.count.mockResolvedValue(0);
    await svc.list({ search: 'apple', page: 1, limit: 50 });
    const where = prisma.contact.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { name: { contains: 'apple', mode: 'insensitive' } },
        { contactCode: { contains: 'apple', mode: 'insensitive' } },
      ]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest contacts.service --silent`
Expected: FAIL — cannot find module `../contacts.service`

- [ ] **Step 3: Implement ContactsService.list**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListContactsDto } from './dto/list-contacts.dto';

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: ListContactsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;
    const where: Prisma.ContactWhereInput = { deletedAt: null };

    if (dto.role) where.roles = { has: dto.role };
    if (dto.isActive !== undefined) where.isActive = dto.isActive === 'true';
    if (dto.search) {
      where.OR = [
        { name: { contains: dto.search, mode: 'insensitive' } },
        { phone: { contains: dto.search, mode: 'insensitive' } },
        { taxId: { contains: dto.search, mode: 'insensitive' } },
        { contactCode: { contains: dto.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        orderBy: { contactCode: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.contact.count({ where }),
    ]);
    return { data, total, page, limit };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest contacts.service --silent`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/contacts
git commit -m "feat(contacts): ContactsService.list with search + role filter"
```

---

### Task 6: ContactsService.findOne (party detail with role links)

**Files:**
- Modify: `apps/api/src/modules/contacts/contacts.service.ts`
- Test: `apps/api/src/modules/contacts/__tests__/contacts.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe('ContactsService.findOne', () => {
  let svc: ContactsService;
  let prisma: any;
  beforeEach(async () => {
    prisma = { contact: { findFirst: jest.fn() } };
    const mod = await Test.createTestingModule({
      providers: [ContactsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    svc = mod.get(ContactsService);
  });

  it('returns the contact with linked role records', async () => {
    prisma.contact.findFirst.mockResolvedValue({
      id: 'c1', name: 'สมชาย', roles: ['CUSTOMER', 'TRADE_IN_SELLER'],
      customers: [{ id: 'cus1' }], suppliers: [], tradeInsAsSeller: [{ id: 't1' }],
      externalFinanceCompany: [],
    });
    const res = await svc.findOne('c1');
    expect(res.customers).toHaveLength(1);
    expect(res.tradeInsAsSeller).toHaveLength(1);
  });

  it('throws NotFound when missing or soft-deleted', async () => {
    prisma.contact.findFirst.mockResolvedValue(null);
    await expect(svc.findOne('nope')).rejects.toThrow('ไม่พบผู้ติดต่อ');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest contacts.service --silent`
Expected: FAIL — `svc.findOne is not a function`

- [ ] **Step 3: Implement findOne**

เพิ่มใน ContactsService:
```typescript
async findOne(id: string) {
  const contact = await this.prisma.contact.findFirst({
    where: { id, deletedAt: null },
    include: {
      customers: { where: { deletedAt: null }, select: { id: true, name: true } },
      suppliers: { where: { deletedAt: null }, select: { id: true, name: true } },
      tradeInsAsSeller: { select: { id: true, createdAt: true } },
      externalFinanceCompany: { where: { deletedAt: null }, select: { id: true, name: true } },
    },
  });
  if (!contact) throw new NotFoundException('ไม่พบผู้ติดต่อ');
  return contact;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest contacts.service --silent`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/contacts
git commit -m "feat(contacts): ContactsService.findOne with role links"
```

---

### Task 7: merge (OWNER only) — combine duplicate contacts

**Files:**
- Create: `apps/api/src/modules/contacts/dto/merge-contacts.dto.ts`
- Modify: `apps/api/src/modules/contacts/contacts.service.ts`
- Test: `apps/api/src/modules/contacts/__tests__/contacts.service.spec.ts`

- [ ] **Step 1: Write the DTO**

```typescript
import { IsUUID } from 'class-validator';

export class MergeContactsDto {
  @IsUUID()
  primaryId!: string; // record ที่จะเก็บไว้

  @IsUUID()
  duplicateId!: string; // record ที่จะถูกยุบเข้า primary
}
```

- [ ] **Step 2: Write the failing test**

```typescript
describe('ContactsService.merge', () => {
  let svc: ContactsService;
  let prisma: any;
  beforeEach(async () => {
    const tx = {
      contact: { findMany: jest.fn(), update: jest.fn() },
      customer: { updateMany: jest.fn() },
      supplier: { updateMany: jest.fn() },
      tradeIn: { updateMany: jest.fn() },
      externalFinanceCompany: { updateMany: jest.fn() },
    };
    prisma = { $transaction: jest.fn(async (cb: any) => cb(tx)), _tx: tx };
    const mod = await Test.createTestingModule({
      providers: [ContactsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    svc = mod.get(ContactsService);
  });

  it('repoints all role records to primary, unions roles, soft-deletes duplicate', async () => {
    prisma._tx.contact.findMany.mockResolvedValue([
      { id: 'p1', roles: ['CUSTOMER'] },
      { id: 'd1', roles: ['SUPPLIER'] },
    ]);
    await svc.merge({ primaryId: 'p1', duplicateId: 'd1' });
    expect(prisma._tx.customer.updateMany).toHaveBeenCalledWith({
      where: { contactId: 'd1' }, data: { contactId: 'p1' },
    });
    expect(prisma._tx.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' } }),
    );
    expect(prisma._tx.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it('rejects merging a contact into itself', async () => {
    await expect(svc.merge({ primaryId: 'x', duplicateId: 'x' }))
      .rejects.toThrow('ไม่สามารถรวมผู้ติดต่อกับตัวเองได้');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && npx jest contacts.service --silent`
Expected: FAIL — `svc.merge is not a function`

- [ ] **Step 4: Implement merge**

เพิ่ม import `BadRequestException` + method:
```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ContactRole } from '@prisma/client';
import { MergeContactsDto } from './dto/merge-contacts.dto';

// ...inside class:
async merge(dto: MergeContactsDto) {
  if (dto.primaryId === dto.duplicateId) {
    throw new BadRequestException('ไม่สามารถรวมผู้ติดต่อกับตัวเองได้');
  }
  return this.prisma.$transaction(async (tx) => {
    const both = await tx.contact.findMany({
      where: { id: { in: [dto.primaryId, dto.duplicateId] }, deletedAt: null },
    });
    const primary = both.find((c) => c.id === dto.primaryId);
    const duplicate = both.find((c) => c.id === dto.duplicateId);
    if (!primary || !duplicate) throw new NotFoundException('ไม่พบผู้ติดต่อที่จะรวม');

    const repoint = { where: { contactId: dto.duplicateId }, data: { contactId: dto.primaryId } };
    await tx.customer.updateMany(repoint);
    await tx.supplier.updateMany(repoint);
    await tx.tradeIn.updateMany({
      where: { sellerContactId: dto.duplicateId }, data: { sellerContactId: dto.primaryId },
    });
    await tx.externalFinanceCompany.updateMany(repoint);

    const unionRoles = Array.from(
      new Set<ContactRole>([...primary.roles, ...duplicate.roles]),
    );
    await tx.contact.update({ where: { id: dto.primaryId }, data: { roles: { set: unionRoles } } });
    await tx.contact.update({ where: { id: dto.duplicateId }, data: { deletedAt: new Date() } });
    return { primaryId: dto.primaryId, mergedRoles: unionRoles };
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && npx jest contacts.service --silent`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/contacts
git commit -m "feat(contacts): merge duplicate contacts (repoint roles + soft-delete)"
```

---

### Task 8: Controller + module wiring

**Files:**
- Create: `apps/api/src/modules/contacts/contacts.controller.ts`
- Create: `apps/api/src/modules/contacts/contacts.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/modules/contacts/__tests__/contacts.controller.spec.ts`

- [ ] **Step 1: Write the failing controller test**

```typescript
import { Test } from '@nestjs/testing';
import { ContactsController } from '../contacts.controller';
import { ContactsService } from '../contacts.service';

describe('ContactsController', () => {
  let ctrl: ContactsController;
  const service = { list: jest.fn(), findOne: jest.fn(), merge: jest.fn() };

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ContactsController],
      providers: [{ provide: ContactsService, useValue: service }],
    }).compile();
    ctrl = mod.get(ContactsController);
  });

  it('GET /contacts delegates to service.list', async () => {
    service.list.mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 });
    const res = await ctrl.list({ page: 1, limit: 50 } as any);
    expect(res.total).toBe(0);
    expect(service.list).toHaveBeenCalled();
  });

  it('GET /contacts/:id delegates to service.findOne', async () => {
    service.findOne.mockResolvedValue({ id: 'c1' });
    expect(await ctrl.findOne('c1')).toEqual({ id: 'c1' });
  });

  it('POST /contacts/merge delegates to service.merge', async () => {
    service.merge.mockResolvedValue({ primaryId: 'p1' });
    expect(await ctrl.merge({ primaryId: 'p1', duplicateId: 'd1' })).toEqual({ primaryId: 'p1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest contacts.controller --silent`
Expected: FAIL — cannot find module `../contacts.controller`

- [ ] **Step 3: Implement controller**

```typescript
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ContactsService } from './contacts.service';
import { ListContactsDto } from './dto/list-contacts.dto';
import { MergeContactsDto } from './dto/merge-contacts.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES')
  list(@Query() dto: ListContactsDto) {
    return this.contacts.list(dto);
  }

  @Get(':id')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES')
  findOne(@Param('id') id: string) {
    return this.contacts.findOne(id);
  }

  @Post('merge')
  @Roles('OWNER')
  merge(@Body() dto: MergeContactsDto) {
    return this.contacts.merge(dto);
  }
}
```

> NB: verify the exact import paths for `JwtAuthGuard`, `RolesGuard`, and `Roles` by opening `apps/api/src/modules/customers/customers.controller.ts` and copying its import lines verbatim — paths must match that file.

- [ ] **Step 4: Implement module + register**

`contacts.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ContactResolverService } from './contact-resolver.service';

@Module({
  imports: [PrismaModule],
  controllers: [ContactsController],
  providers: [ContactsService, ContactResolverService],
  exports: [ContactResolverService],
})
export class ContactsModule {}
```
> NB: confirm `PrismaModule` import path matches how `customers.module.ts` imports Prisma (some modules import `PrismaService` directly instead of a module). Mirror that file.

ใน `app.module.ts` เพิ่ม `import { ContactsModule } from './modules/contacts/contacts.module';` และใส่ `ContactsModule` ใน `imports: [...]`

- [ ] **Step 5: Run controller test + type check**

Run: `cd apps/api && npx jest contacts.controller --silent && cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api`
Expected: PASS + 0 type errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/contacts apps/api/src/app.module.ts
git commit -m "feat(contacts): controller + module wiring (RolesGuard, merge=OWNER)"
```

---

## PHASE 3 — Wire resolver into create flows

### Task 9: Link Contact on Supplier create

**Files:**
- Modify: `apps/api/src/modules/suppliers/suppliers.service.ts` (open it first to find the `create` method + its transaction)
- Modify: `apps/api/src/modules/suppliers/suppliers.module.ts` (import ContactsModule)
- Test: `apps/api/src/modules/suppliers/__tests__/suppliers.service.spec.ts` (or existing spec file)

- [ ] **Step 1: Write the failing test**

เพิ่ม test ที่ยืนยันว่า create เรียก resolver และเซ็ต contactId:
```typescript
it('links a Contact (role SUPPLIER) on create', async () => {
  // arrange: mock prisma.supplier.create + ContactResolverService.findOrCreateByNaturalKey
  resolver.findOrCreateByNaturalKey.mockResolvedValue({ id: 'c1' });
  prisma.supplier.create.mockResolvedValue({ id: 's1', contactId: 'c1' });
  const res = await service.create({ name: 'Apple', phone: '02', taxId: '0105...' } as any);
  expect(resolver.findOrCreateByNaturalKey).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ role: 'SUPPLIER', taxId: '0105...', name: 'Apple' }),
  );
  expect(res.contactId).toBe('c1');
});
```
> Adapt the mock shape to the actual `suppliers.service.spec.ts` setup (read the file's existing `beforeEach`). Inject `ContactResolverService` as a mock provider.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest suppliers.service --silent`
Expected: FAIL — resolver not called / contactId undefined

- [ ] **Step 3: Implement — wrap create in a transaction that resolves the Contact first**

ใน `SuppliersService.create()`: inject `ContactResolverService` ผ่าน constructor, ห่อด้วย `$transaction`, เรียก resolver ก่อนสร้าง supplier:
```typescript
return this.prisma.$transaction(async (tx) => {
  const contact = await this.contactResolver.findOrCreateByNaturalKey(tx, {
    name: dto.name,
    taxId: dto.taxId ?? null,
    nationalIdHash: null, // suppliers keyed by taxId
    phone: dto.phone ?? null,
    role: 'SUPPLIER',
  });
  return tx.supplier.create({ data: { ...supplierData, contactId: contact.id } });
});
```
และใน `suppliers.module.ts` เพิ่ม `imports: [ContactsModule]`

- [ ] **Step 4: Run test + type check**

Run: `cd apps/api && npx jest suppliers --silent && cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api`
Expected: PASS + 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/suppliers
git commit -m "feat(contacts): link Contact (SUPPLIER role) on supplier create"
```

---

### Task 10: Link Contact on Customer create

**Files:**
- Modify: `apps/api/src/modules/customers/customers.service.ts` (find `create`; it already computes `nationalIdHash` via `CustomerPiiService`)
- Modify: `apps/api/src/modules/customers/customers.module.ts`
- Test: `apps/api/src/modules/customers/customers.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('links a Contact (role CUSTOMER) keyed by nationalIdHash on create', async () => {
  resolver.findOrCreateByNaturalKey.mockResolvedValue({ id: 'c1' });
  // existing create mocks...
  const res = await service.create({ name: 'สมชาย', phone: '08', nationalId: '1101...' } as any, userCtx);
  expect(resolver.findOrCreateByNaturalKey).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ role: 'CUSTOMER', name: 'สมชาย' }),
  );
  expect(res.contactId).toBe('c1');
});
```
> Read `customers.service.spec.ts` beforeEach and add `ContactResolverService` as a mock provider; reuse existing customer-create mock scaffolding.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest customers.service --silent`
Expected: FAIL

- [ ] **Step 3: Implement — resolve Contact inside the existing create transaction**

`CustomersService` ใช้ `CustomerPiiService.hash(nationalId)` ได้ `nationalIdHash` อยู่แล้ว. ในตำแหน่งที่สร้าง customer (ภายใน transaction ที่มีอยู่ หรือห่อใหม่ถ้ายังไม่มี):
```typescript
const nationalIdHash = this.pii.hash(dto.nationalId); // null when no id / no salt
const contact = await this.contactResolver.findOrCreateByNaturalKey(tx, {
  name: dto.name,
  taxId: null,
  nationalIdHash,
  phone: dto.phone ?? null,
  role: 'CUSTOMER',
});
// then include contactId: contact.id in the customer create data
```
เพิ่ม `imports: [ContactsModule]` ใน `customers.module.ts` และ inject `ContactResolverService`

- [ ] **Step 4: Run test + type check**

Run: `cd apps/api && npx jest customers --silent && cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api`
Expected: PASS + 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/customers
git commit -m "feat(contacts): link Contact (CUSTOMER role) on customer create"
```

---

### Task 11: Link Contact on TradeIn create (TRADE_IN_SELLER, keyless → always create)

**Files:**
- Modify: `apps/api/src/modules/trade-in/trade-in.service.ts` (find where TradeIn is created with `sellerName`/`sellerPhone`)
- Modify: `apps/api/src/modules/trade-in/trade-in.module.ts`
- Test: `apps/api/src/modules/trade-in/__tests__/trade-in.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('creates a Contact (TRADE_IN_SELLER) and sets sellerContactId on create', async () => {
  resolver.findOrCreateByNaturalKey.mockResolvedValue({ id: 'c9' });
  // existing tradeIn create mocks...
  const res = await service.create({ sellerName: 'นายขาย', sellerPhone: '081' } as any);
  expect(resolver.findOrCreateByNaturalKey).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ role: 'TRADE_IN_SELLER', name: 'นายขาย', nationalIdHash: null }),
  );
  expect(res.sellerContactId).toBe('c9');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest trade-in.service --silent`
Expected: FAIL

- [ ] **Step 3: Implement**

ในจุดสร้าง TradeIn (ภายใน transaction):
```typescript
const contact = await this.contactResolver.findOrCreateByNaturalKey(tx, {
  name: dto.sellerName ?? 'ไม่ระบุชื่อ',
  taxId: null,
  nationalIdHash: null, // keyless → resolver always creates a fresh Contact (no auto-merge)
  phone: dto.sellerPhone ?? null,
  role: 'TRADE_IN_SELLER',
});
// include sellerContactId: contact.id in tradeIn create data
```
เพิ่ม `imports: [ContactsModule]` ใน `trade-in.module.ts` + inject resolver

- [ ] **Step 4: Run test + type check**

Run: `cd apps/api && npx jest trade-in --silent && cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api`
Expected: PASS + 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/trade-in
git commit -m "feat(contacts): link Contact (TRADE_IN_SELLER) on trade-in create"
```

---

### Task 12: Link Contact on ExternalFinanceCompany create

**Files:**
- Modify: `apps/api/src/modules/external-finance/external-finance.service.ts` (find company create)
- Modify: `apps/api/src/modules/external-finance/external-finance.module.ts`
- Test: `apps/api/src/modules/external-finance/external-finance.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('links a Contact (FINANCE_COMPANY) on company create', async () => {
  resolver.findOrCreateByNaturalKey.mockResolvedValue({ id: 'cf1' });
  const res = await service.createCompany({ name: 'GFINN', taxId: '0105...' } as any);
  expect(resolver.findOrCreateByNaturalKey).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ role: 'FINANCE_COMPANY', name: 'GFINN' }),
  );
  expect(res.contactId).toBe('cf1');
});
```
> Match the actual create-company method name in `external-finance.service.ts` (could be `create` / `createCompany`). Read the file first.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest external-finance.service --silent`
Expected: FAIL

- [ ] **Step 3: Implement** (same pattern, role `FINANCE_COMPANY`, keyed by `taxId`)

- [ ] **Step 4: Run test + type check**

Run: `cd apps/api && npx jest external-finance --silent && cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api`
Expected: PASS + 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/external-finance
git commit -m "feat(contacts): link Contact (FINANCE_COMPANY) on company create"
```

---

## PHASE 4 — Backfill CLI

### Task 13: backfill-contacts script

**Files:**
- Create: `apps/api/scripts/backfill-contacts.ts`
- Modify: `apps/api/package.json` (add script)
- Test: `apps/api/src/modules/contacts/__tests__/backfill-contacts.spec.ts` (extract the per-entity logic into a tested pure function)

- [ ] **Step 1: Write the failing test for the dedup decision (pure function)**

```typescript
import { resolveBackfillAction } from '../../../scripts/backfill-contacts';

describe('resolveBackfillAction', () => {
  it('matches an existing contact by taxId', () => {
    const existing = [{ id: 'c1', taxId: '0105', nationalIdHash: null }];
    expect(resolveBackfillAction(existing, { taxId: '0105', nationalIdHash: null }))
      .toEqual({ kind: 'attach', contactId: 'c1' });
  });
  it('matches by nationalIdHash', () => {
    const existing = [{ id: 'c2', taxId: null, nationalIdHash: 'h1' }];
    expect(resolveBackfillAction(existing, { taxId: null, nationalIdHash: 'h1' }))
      .toEqual({ kind: 'attach', contactId: 'c2' });
  });
  it('creates new when no key present (no auto-merge)', () => {
    const existing = [{ id: 'c3', taxId: null, nationalIdHash: null, phone: '081' }];
    expect(resolveBackfillAction(existing, { taxId: null, nationalIdHash: null, phone: '081' }))
      .toEqual({ kind: 'create' });
  });
  it('creates new when keys do not match any existing', () => {
    const existing = [{ id: 'c1', taxId: '0105', nationalIdHash: null }];
    expect(resolveBackfillAction(existing, { taxId: '9999', nationalIdHash: null }))
      .toEqual({ kind: 'create' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest backfill-contacts --silent`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement the script with the pure helper exported**

```typescript
import { PrismaClient } from '@prisma/client';

export interface BackfillCandidate { taxId: string | null; nationalIdHash: string | null; phone?: string | null; }
export type BackfillAction = { kind: 'attach'; contactId: string } | { kind: 'create' };

/** Pure dedup decision. Only taxId / nationalIdHash count as identity.
 * Phone/name are NEVER used to auto-merge (safe no-auto-merge policy). */
export function resolveBackfillAction(
  existing: Array<{ id: string; taxId: string | null; nationalIdHash: string | null }>,
  c: BackfillCandidate,
): BackfillAction {
  if (c.taxId) {
    const m = existing.find((e) => e.taxId && e.taxId === c.taxId);
    if (m) return { kind: 'attach', contactId: m.id };
  }
  if (c.nationalIdHash) {
    const m = existing.find((e) => e.nationalIdHash && e.nationalIdHash === c.nationalIdHash);
    if (m) return { kind: 'attach', contactId: m.id };
  }
  return { kind: 'create' };
}

// main(): guarded by EXPECTED_DB_NAME + CONFIRM_BACKFILL (mirror backfill:encrypt-pii guards),
// order: Supplier → Customer → TradeIn → ExternalFinanceCompany. For each entity:
//   - skip rows that already have contactId/sellerContactId (idempotent re-run)
//   - load existing contacts once into memory, decide via resolveBackfillAction,
//     create or attach, then set the FK. New contacts get a P-NNNNN code.
// Print a summary: created vs attached counts per entity.
if (require.main === module) {
  // ...wire main() here using a fresh PrismaClient; commit-time fill.
}
```
> The `main()` body is operational glue (read entities, loop, write FK) — implement it following the structure in the comment and the guard pattern from `apps/api/src/cli/encrypt-customer-pii.cli.ts`. The tested contract is `resolveBackfillAction`.

- [ ] **Step 4: Add package.json script**

```json
"backfill:contacts": "tsx scripts/backfill-contacts.ts",
"backfill:contacts:help": "echo 'Usage: CONFIRM_BACKFILL=YES_I_AM_SURE EXPECTED_DB_NAME=<db> PII_HASH_SALT=<>=32chars> npm run backfill:contacts'",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && npx jest backfill-contacts --silent`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/scripts/backfill-contacts.ts apps/api/package.json apps/api/src/modules/contacts/__tests__/backfill-contacts.spec.ts
git commit -m "feat(contacts): backfill CLI with safe no-auto-merge dedup"
```

---

## PHASE 5 — Frontend

### Task 14: API client + types

**Files:**
- Create: `apps/web/src/lib/api/contacts.ts`

- [ ] **Step 1: Write the client**

```typescript
import api from '@/lib/api';

export type ContactRole = 'CUSTOMER' | 'SUPPLIER' | 'TRADE_IN_SELLER' | 'FINANCE_COMPANY';

export interface Contact {
  id: string;
  contactCode: string;
  peakContactCode: string | null;
  name: string;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  roles: ContactRole[];
  isActive: boolean;
}

export interface ContactListResult {
  data: Contact[];
  total: number;
  page: number;
  limit: number;
}

export const contactKeys = {
  all: ['contacts'] as const,
  list: (params: Record<string, unknown>) => [...contactKeys.all, 'list', params] as const,
  detail: (id: string) => [...contactKeys.all, 'detail', id] as const,
};

export const contactsApi = {
  list: (params: { search?: string; role?: ContactRole | 'ALL'; isActive?: boolean; page?: number; limit?: number }) => {
    const query: Record<string, unknown> = { page: params.page ?? 1, limit: params.limit ?? 50 };
    if (params.search) query.search = params.search;
    if (params.role && params.role !== 'ALL') query.role = params.role;
    if (params.isActive !== undefined) query.isActive = String(params.isActive);
    return api.get<ContactListResult>('/contacts', { params: query }).then((r) => r.data);
  },
  detail: (id: string) => api.get<Contact & Record<string, unknown>>(`/contacts/${id}`).then((r) => r.data),
  merge: (primaryId: string, duplicateId: string) =>
    api.post('/contacts/merge', { primaryId, duplicateId }).then((r) => r.data),
};
```

- [ ] **Step 2: Verify types compile**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api/contacts.ts
git commit -m "feat(contacts): web api client + types"
```

---

### Task 15: ContactsPage (PEAK-style list)

**Files:**
- Create: `apps/web/src/pages/ContactsPage.tsx`
- Test: `apps/web/src/pages/__tests__/ContactsPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import ContactsPage from '../ContactsPage';
import { contactsApi } from '@/lib/api/contacts';

vi.mock('@/lib/api/contacts', async (orig) => {
  const actual = await orig();
  return { ...actual, contactsApi: { ...actual.contactsApi, list: vi.fn() } };
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

it('renders contacts returned by the api', async () => {
  (contactsApi.list as any).mockResolvedValue({
    data: [{ id: 'c1', contactCode: 'P-00001', name: 'นราธิป', roles: ['CUSTOMER'], isActive: true, taxId: null, phone: null, email: null, peakContactCode: null }],
    total: 1, page: 1, limit: 50,
  });
  wrap(<ContactsPage />);
  await waitFor(() => expect(screen.getByText('นราธิป')).toBeInTheDocument());
  expect(screen.getByText('P-00001')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run ContactsPage --silent`
Expected: FAIL — cannot find module `../ContactsPage`

- [ ] **Step 3: Implement ContactsPage**

สร้างหน้าใช้ react-query + useDebounce + QueryBoundary + DataTable + Badge ตาม pattern `CustomersPage.tsx`:
- state: `search`, `role` (ALL|CUSTOMER|SUPPLIER|TRADE_IN_SELLER|FINANCE_COMPANY), `isActive`, `page`
- left group filter (buttons) แมป role; right: search input (`useDebounce`) + DataTable columns: contactCode | name | roles (Badge ต่อ role, label ไทย: ลูกค้า/ผู้ขาย/คนขายมือสอง/ไฟแนนซ์) | actions
- `useQuery({ queryKey: contactKeys.list({search,role,isActive,page}), queryFn: () => contactsApi.list(...) })`
- row click → `navigate(\`/contacts/\${id}\`)`
- ปุ่ม "เพิ่มผู้ติดต่อ" = dropdown → navigate ไป `/customers` (เพิ่มลูกค้า) / `/suppliers` (เพิ่มผู้ขาย) / `/trade-in` (รับซื้อมือสอง)
- ใช้ semantic tokens เท่านั้น (ตาม frontend.md — ห้าม bg-white/text-gray-*)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run ContactsPage --silent`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ContactsPage.tsx apps/web/src/pages/__tests__/ContactsPage.test.tsx
git commit -m "feat(contacts): ContactsPage list (PEAK-style, group filter + search)"
```

---

### Task 16: ContactDetailPage

**Files:**
- Create: `apps/web/src/pages/ContactDetailPage.tsx`

- [ ] **Step 1: Implement detail page**

ใช้ `useParams` + `useQuery(contactKeys.detail(id), () => contactsApi.detail(id))` + QueryBoundary + PageHeader.
แสดง: contactCode, name, taxId, phone, role badges, isActive. แล้วลิสต์ลิงก์ไปหน้าจริงต่อ role:
- customers[] → ลิงก์ `/customers/{id}`
- suppliers[] → ลิงก์ `/suppliers/{id}`
- tradeInsAsSeller[] → ลิงก์ `/trade-in` (หรือหน้ารายการรับซื้อถ้ามี route detail)
- externalFinanceCompany[] → ลิงก์ `/external-finance-companies/{id}`

- [ ] **Step 2: Verify types + smoke render**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/ContactDetailPage.tsx
git commit -m "feat(contacts): ContactDetailPage with role-linked records"
```

---

### Task 17: Routes + side menu

**Files:**
- Modify: `apps/web/src/App.tsx` (add lazy routes inside ProtectedRoute/MainLayout area)
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 1: Add lazy-loaded routes**

ใน `App.tsx` เพิ่ม (ตาม pattern lazy import ของหน้าอื่น):
```tsx
const ContactsPage = lazy(() => import('./pages/ContactsPage'));
const ContactDetailPage = lazy(() => import('./pages/ContactDetailPage'));
// ...in routes:
<Route path="/contacts" element={<ContactsPage />} />
<Route path="/contacts/:id" element={<ContactDetailPage />} />
```

- [ ] **Step 2: Add menu entries for each role config**

ใน `config/menu.ts` เพิ่มรายการ `{ label: 'สมุดผู้ติดต่อ', path: '/contacts', icon: Users }` (หรือ icon `Contact` จาก lucide-react ถ้ามี) เข้าในกลุ่มที่เหมาะของ **ทุก role config** ที่มี (SALES_CONFIG, BRANCH_MANAGER_CONFIG, FINANCE_MANAGER, ACCOUNTANT, OWNER). วางในกลุ่มที่มี "ลูกค้า" อยู่ เพื่อให้อยู่ใกล้กัน.
> Read the existing role config objects in `menu.ts` to place the entry in the matching group array for each role.

- [ ] **Step 3: Verify types + build**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/config/menu.ts
git commit -m "feat(contacts): wire /contacts routes + side menu for all roles"
```

---

## PHASE 6 — Final verification

### Task 18: Full type check + test suite + run backfill on dev

**Files:** none (verification only)

- [ ] **Step 1: Full type check**

Run: `./tools/check-types.sh all`
Expected: 0 errors

- [ ] **Step 2: Full API + web test suites**

Run: `cd apps/api && npx jest --silent` then `cd apps/web && npx vitest run --silent`
Expected: all green (including new contacts specs)

- [ ] **Step 3: Run backfill against the dev DB and eyeball results**

Run: `cd apps/api && CONFIRM_BACKFILL=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice_dev PII_HASH_SALT=<dev salt> npm run backfill:contacts`
Expected: prints created/attached counts per entity; re-running prints 0 created (idempotent)

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run dev servers, log in, open `/contacts`: verify all four groups populate, search works, clicking a row opens the party detail with links back to the real customer/supplier pages.

- [ ] **Step 5: Commit any fixes, then push branch**

```bash
git push -u origin feat/contact-party-master
```

---

## Self-Review Notes (author check)

- **Spec coverage:** Contact model + roles (Task 1) ✓; natural key taxId/nationalId (Task 3) ✓; backfill safe no-auto-merge (Task 13) ✓; list+filter+search+detail+merge (Tasks 5-8) ✓; create-flow linking for all 4 entities (Tasks 9-12) ✓; frontend page + menu + roles (Tasks 14-17) ✓; access control via RolesGuard + merge=OWNER (Task 8) ✓.
- **Branch-level row filtering** (SALES/BM see only their branch's contacts) from spec §5 is NOT yet enforced in Task 5's `list`. Decision: ship v1 with role-gated access (any of the 5 roles can read the directory) and add branch-level row filtering as a fast-follow once `branch-access.util.ts` semantics for cross-entity contacts are confirmed — flagged here so it is not silently dropped. Add a follow-up task if the owner requires strict branch isolation at launch.
- **Audit strings** (`CONTACT_CREATED`, `CONTACTS_MERGED`) ride the existing global AuditInterceptor on mutating endpoints; merge explicitly logs via interceptor. No separate task needed unless a custom payload is required.
- **Placeholder scan:** backfill `main()` glue is intentionally described not coded (operational, not contract); the tested contract `resolveBackfillAction` is fully specified. All other code steps contain complete code.
- **Type consistency:** `findOrCreateByNaturalKey(tx, ResolveContactInput{role})` used identically in Tasks 9-12; `ContactRole` enum values consistent across schema, DTO, service, and web client.
