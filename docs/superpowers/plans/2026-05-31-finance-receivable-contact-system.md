# Finance Receivable Contact System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a PEAK-style contact directory + activity-log system on top of `FinanceReceivable` / `ExternalFinanceCompany` so finance staff can register multiple contacts per finance company and track every call/follow-up against each receivable.

**Architecture:** 2 new Prisma models (`FinanceCompanyContact`, `FinanceReceivableContactLog`) + 4 new fields on existing `ExternalFinanceCompany` + 4 new fields on `FinanceReceivable` (FK + KPI denorm). NestJS modules follow the existing controller→service→PrismaService pattern. React frontend uses TanStack Query + shadcn/ui drawer/dialog. Single promise per log, CALL channel only (enum extensible). Lazy FK resolution at contact-log create — upserts `ExternalFinanceCompany` if receivable is pre-backfill.

**Tech Stack:** NestJS + Prisma + PostgreSQL (backend), React 18 + Vite + TanStack Query + shadcn/ui + Tailwind (frontend), Jest (unit), Playwright (E2E).

**Spec:** [`docs/superpowers/specs/2026-05-31-finance-receivable-contact-system-design.md`](../specs/2026-05-31-finance-receivable-contact-system-design.md)

---

## File Structure

### Backend (`apps/api/src/`)

**New files:**
- `modules/finance-company-contacts/finance-company-contacts.module.ts` — module wiring
- `modules/finance-company-contacts/finance-company-contacts.controller.ts` — REST endpoints (contacts CRUD + setPrimary)
- `modules/finance-company-contacts/finance-company-contacts.service.ts` — business logic
- `modules/finance-company-contacts/finance-company-contacts.service.spec.ts` — Jest tests
- `modules/finance-company-contacts/dto/finance-company-contact.dto.ts` — class-validator DTOs

- `modules/finance-receivable-contact-logs/finance-receivable-contact-logs.module.ts`
- `modules/finance-receivable-contact-logs/finance-receivable-contact-logs.controller.ts`
- `modules/finance-receivable-contact-logs/finance-receivable-contact-logs.service.ts`
- `modules/finance-receivable-contact-logs/finance-receivable-contact-logs.service.spec.ts`
- `modules/finance-receivable-contact-logs/dto/finance-receivable-contact-log.dto.ts`
- `modules/finance-receivable-contact-logs/crons/broken-promise-finance.cron.ts`
- `modules/finance-receivable-contact-logs/crons/broken-promise-finance.cron.spec.ts`
- `modules/finance-receivable-contact-logs/finance-company-name-normalizer.util.ts`
- `modules/finance-receivable-contact-logs/finance-company-name-normalizer.util.spec.ts`

- `scripts/backfill-external-finance-fk.ts` — one-time data migration

**Modified files:**
- `prisma/schema.prisma` — schema additions (see Task 1)
- `prisma/migrations/<ts>_finance_receivable_contact_system/migration.sql` — auto + raw SQL append
- `modules/external-finance/external-finance.service.ts` — accept new master fields in upsert
- `modules/external-finance/dto/external-finance-company.dto.ts` — new optional fields
- `modules/finance-receivable/finance-receivable.service.ts` — `recordReceive` sets `promisedKeptAt`; query includes new fields
- `modules/finance-receivable/finance-receivable.controller.ts` — new GET sub-routes for logs
- `modules/sales/sales.service.ts` — resolve FK at FinanceReceivable creation (lines 626 + 715)
- `app.module.ts` — register 2 new modules
- `package.json` (apps/api) — add `backfill:external-finance` script

### Frontend (`apps/web/src/`)

**New files:**
- `pages/FinanceReceivablePage/FinanceReceivableDetailDrawer.tsx` — bottom drawer for a single receivable
- `pages/FinanceReceivablePage/FinanceContactLogDialog.tsx` — log-creation modal
- `pages/FinanceReceivablePage/ContactTimeline.tsx` — log timeline list component
- `pages/ExternalFinanceCompanyDetailPage.tsx` — 4-tab company detail page
- `pages/ExternalFinanceCompanyDetailPage/CompanyInfoTab.tsx`
- `pages/ExternalFinanceCompanyDetailPage/ContactsTab.tsx`
- `pages/ExternalFinanceCompanyDetailPage/ReceivablesTab.tsx`
- `pages/ExternalFinanceCompanyDetailPage/AllContactLogsTab.tsx`
- `lib/api/finance-contacts.ts` — typed API wrappers + React Query keys

**Modified files:**
- `pages/FinanceReceivablePage.tsx` — add columns "ติดต่อล่าสุด"/"นัดล่าสุด", row click → drawer, filter "มีนัดเลยกำหนด"
- `App.tsx` — register `/external-finance-companies/:id` route (lazy-loaded)

### E2E (`apps/web/e2e/`)

**New files:**
- `finance-receivable-contact.spec.ts` — Playwright E2E covering log create + primary swap + filter

---

## Task 1: Prisma schema additions

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_finance_receivable_contact_system/migration.sql` (auto-generated, then append raw SQL)

- [ ] **Step 1: Add new enums and `FinanceCompanyContact` model**

Append to `apps/api/prisma/schema.prisma` (after `ExternalFinanceCommission` model — search for `model ExternalFinanceCommission`):

```prisma
enum FinanceContactChannel {
  CALL
  EMAIL
  LINE
  MEETING
  OTHER
}

enum FinanceContactResult {
  ANSWERED
  NO_ANSWER
  PROMISED
  DISPUTED
  REQUESTED_DOCS
  OTHER
}

model FinanceCompanyContact {
  id                       String   @id @default(uuid())
  externalFinanceCompanyId String   @map("external_finance_company_id")
  name                     String
  position                 String?
  department               String?
  phone                    String?
  email                    String?
  lineId                   String?  @map("line_id")
  notes                    String?
  isPrimary                Boolean  @default(false) @map("is_primary")
  isActive                 Boolean  @default(true)  @map("is_active")
  createdAt                DateTime @default(now()) @map("created_at")
  updatedAt                DateTime @updatedAt      @map("updated_at")
  deletedAt                DateTime?                @map("deleted_at")

  company     ExternalFinanceCompany        @relation(fields: [externalFinanceCompanyId], references: [id])
  contactLogs FinanceReceivableContactLog[]

  @@index([externalFinanceCompanyId, isActive])
  @@map("finance_company_contacts")
}

model FinanceReceivableContactLog {
  id                       String                @id @default(uuid())
  financeReceivableId      String                @map("finance_receivable_id")
  externalFinanceCompanyId String                @map("external_finance_company_id")
  financeCompanyContactId  String?               @map("finance_company_contact_id")
  contactedById            String                @map("contacted_by_id")
  contactedAt              DateTime              @default(now()) @map("contacted_at")
  channel                  FinanceContactChannel @default(CALL)
  result                   FinanceContactResult
  notes                    String?
  promisedDate             DateTime?             @map("promised_date")
  promisedAmount           Decimal?              @map("promised_amount") @db.Decimal(12, 2)
  promisedBrokenAt         DateTime?             @map("promised_broken_at")
  promisedKeptAt           DateTime?             @map("promised_kept_at")
  createdAt                DateTime              @default(now()) @map("created_at")
  updatedAt                DateTime              @updatedAt      @map("updated_at")
  deletedAt                DateTime?             @map("deleted_at")

  receivable  FinanceReceivable      @relation(fields: [financeReceivableId], references: [id])
  company     ExternalFinanceCompany @relation(fields: [externalFinanceCompanyId], references: [id])
  contact     FinanceCompanyContact? @relation(fields: [financeCompanyContactId], references: [id])
  contactedBy User                   @relation("FinanceContactLogger", fields: [contactedById], references: [id])

  @@index([financeReceivableId, contactedAt])
  @@index([externalFinanceCompanyId, contactedAt])
  @@index([promisedDate, promisedBrokenAt, promisedKeptAt])
  @@map("finance_receivable_contact_logs")
}
```

- [ ] **Step 2: Extend `ExternalFinanceCompany` model**

Find the existing `model ExternalFinanceCompany {` block and add these fields plus relations (do not remove existing fields):

```prisma
  // ── new master fields (PEAK-style, focused) ──
  taxId          String?  @map("tax_id")
  email          String?
  lineOaId       String?  @map("line_oa_id")
  creditTermDays Int?     @map("credit_term_days")

  // ── new relations ──
  contacts    FinanceCompanyContact[]
  receivables FinanceReceivable[]
  contactLogs FinanceReceivableContactLog[]
```

- [ ] **Step 3: Extend `FinanceReceivable` model**

Find the existing `model FinanceReceivable {` block and add these fields + relations + index:

```prisma
  // ── new (Phase 1 nullable, Phase 3 → required) ──
  externalFinanceCompanyId String? @map("external_finance_company_id")
  lastContactedAt          DateTime? @map("last_contacted_at")
  lastPromisedDate         DateTime? @map("last_promised_date")
  contactAttemptCount      Int       @default(0) @map("contact_attempt_count")

  company     ExternalFinanceCompany?       @relation(fields: [externalFinanceCompanyId], references: [id])
  contactLogs FinanceReceivableContactLog[]

  @@index([externalFinanceCompanyId, status])
  @@index([lastContactedAt])
```

- [ ] **Step 4: Add reverse relation on `User`**

Find `model User {` and inside the relations section append:

```prisma
  financeContactLogs FinanceReceivableContactLog[] @relation("FinanceContactLogger")
```

- [ ] **Step 5: Generate Prisma migration**

Run from `apps/api`:
```bash
cd apps/api && npx prisma migrate dev --name finance_receivable_contact_system --create-only
```

Expected: a new folder `apps/api/prisma/migrations/<ts>_finance_receivable_contact_system/migration.sql` is created. Do NOT apply yet.

- [ ] **Step 6: Append raw SQL for partial unique index**

Open the generated `migration.sql` and append at the bottom:

```sql
-- Partial unique index: at most one primary contact per company (excluding soft-deleted rows)
CREATE UNIQUE INDEX uniq_primary_per_company
  ON finance_company_contacts (external_finance_company_id)
  WHERE is_primary = true AND deleted_at IS NULL;
```

- [ ] **Step 7: Apply migration**

Run from `apps/api`:
```bash
cd apps/api && npx prisma migrate dev
```

Expected: migration applied. `npx prisma generate` runs automatically.

- [ ] **Step 8: Verify schema compiles**

Run from repo root:
```bash
./tools/check-types.sh api
```

Expected: 0 TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(schema): add finance contact + activity log tables"
```

---

## Task 2: Name normalizer utility

**Files:**
- Create: `apps/api/src/modules/finance-receivable-contact-logs/finance-company-name-normalizer.util.ts`
- Test: `apps/api/src/modules/finance-receivable-contact-logs/finance-company-name-normalizer.util.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// finance-company-name-normalizer.util.spec.ts
import { normalizeFinanceCompanyName } from './finance-company-name-normalizer.util';

describe('normalizeFinanceCompanyName', () => {
  it('trims whitespace', () => {
    expect(normalizeFinanceCompanyName('  เคทีซี  ')).toBe('เคทีซี');
  });

  it('lowercases ASCII letters', () => {
    expect(normalizeFinanceCompanyName('KTC Finance')).toBe('ktc finance');
  });

  it('collapses multiple internal spaces to single space', () => {
    expect(normalizeFinanceCompanyName('กสิกร   ไทย')).toBe('กสิกร ไทย');
  });

  it('strips spaces around parentheses', () => {
    expect(normalizeFinanceCompanyName('กสิกร (KK)')).toBe('กสิกร(kk)');
  });

  it('returns empty string for null / empty input', () => {
    expect(normalizeFinanceCompanyName('')).toBe('');
    expect(normalizeFinanceCompanyName(null as unknown as string)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd apps/api && npx jest finance-company-name-normalizer.util.spec
```

Expected: FAIL with "Cannot find module './finance-company-name-normalizer.util'".

- [ ] **Step 3: Implement the normalizer**

```typescript
// finance-company-name-normalizer.util.ts
export function normalizeFinanceCompanyName(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)\s*/g, ')');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd apps/api && npx jest finance-company-name-normalizer.util.spec
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/finance-receivable-contact-logs/finance-company-name-normalizer.util.ts apps/api/src/modules/finance-receivable-contact-logs/finance-company-name-normalizer.util.spec.ts
git commit -m "feat(finance-contact): add finance company name normalizer"
```

---

## Task 3: ExternalFinanceCompany DTO + service accepting new master fields

**Files:**
- Modify: `apps/api/src/modules/external-finance/dto/external-finance-company.dto.ts`
- Modify: `apps/api/src/modules/external-finance/external-finance.service.ts`

- [ ] **Step 1: Extend DTO**

Open `apps/api/src/modules/external-finance/dto/external-finance-company.dto.ts` and add these optional fields to `CreateExternalFinanceCompanyDto` (above the closing `}`):

```typescript
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'เลขผู้เสียภาษีต้องไม่เกิน 20 ตัวอักษร' })
  taxId?: string;

  @IsOptional()
  @IsEmail({}, { message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lineOaId?: string;

  @IsOptional()
  @IsNumber({}, { message: 'เครดิตเทอมต้องเป็นตัวเลข' })
  @Min(0)
  creditTermDays?: number;
```

Add to the top imports if missing:
```typescript
import { IsEmail, MaxLength } from 'class-validator';
```

- [ ] **Step 2: Pass new fields through service**

Open `apps/api/src/modules/external-finance/external-finance.service.ts`. In `create()` add the 4 new fields to the `data:` object. In `update()` (search for it; if `Object.assign(...)` or spread pattern is used, this is already covered by virtue of `PartialType`).

Example of `create()` update:
```typescript
return this.prisma.externalFinanceCompany.create({
  data: {
    name: dto.name,
    contactPerson: dto.contactPerson,
    contactPhone: dto.contactPhone,
    defaultCommissionRate: dto.defaultCommissionRate,
    bankAccountInfo: dto.bankAccountInfo as Prisma.InputJsonValue | undefined,
    notes: dto.notes,
    isActive: dto.isActive,
    taxId: dto.taxId,
    email: dto.email,
    lineOaId: dto.lineOaId,
    creditTermDays: dto.creditTermDays,
  },
});
```

- [ ] **Step 3: Run type check**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/external-finance/
git commit -m "feat(external-finance): accept taxId/email/lineOaId/creditTermDays"
```

---

## Task 4: FinanceCompanyContact DTOs

**Files:**
- Create: `apps/api/src/modules/finance-company-contacts/dto/finance-company-contact.dto.ts`

- [ ] **Step 1: Create the DTO file**

```typescript
// apps/api/src/modules/finance-company-contacts/dto/finance-company-contact.dto.ts
import {
  IsString,
  IsOptional,
  IsEmail,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateFinanceCompanyContactDto {
  @IsString({ message: 'กรุณาระบุชื่อผู้ติดต่อ' })
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  position?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lineId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateFinanceCompanyContactDto extends PartialType(
  CreateFinanceCompanyContactDto,
) {}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/modules/finance-company-contacts/dto/
git commit -m "feat(finance-contact): add contact DTOs"
```

---

## Task 5: FinanceCompanyContactsService — CRUD + setPrimary

**Files:**
- Create: `apps/api/src/modules/finance-company-contacts/finance-company-contacts.service.ts`
- Test: `apps/api/src/modules/finance-company-contacts/finance-company-contacts.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// finance-company-contacts.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FinanceCompanyContactsService } from './finance-company-contacts.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('FinanceCompanyContactsService', () => {
  let service: FinanceCompanyContactsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      financeCompanyContact: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
      },
      externalFinanceCompany: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (fn) => fn(prisma)),
      $queryRaw: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceCompanyContactsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(FinanceCompanyContactsService);
  });

  describe('list', () => {
    it('returns contacts sorted with primary first then by name', async () => {
      await service.list('co-1');
      const call = prisma.financeCompanyContact.findMany.mock.calls[0][0];
      expect(call.where.externalFinanceCompanyId).toBe('co-1');
      expect(call.where.deletedAt).toBeNull();
      expect(call.orderBy).toEqual([{ isPrimary: 'desc' }, { isActive: 'desc' }, { name: 'asc' }]);
    });
  });

  describe('create', () => {
    it('rejects when company not found', async () => {
      prisma.externalFinanceCompany.findFirst.mockResolvedValue(null);
      await expect(
        service.create('co-1', { name: 'John' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates contact when company exists', async () => {
      prisma.externalFinanceCompany.findFirst.mockResolvedValue({ id: 'co-1' });
      prisma.financeCompanyContact.create.mockResolvedValue({ id: 'c-1' });
      await service.create('co-1', { name: 'John' });
      expect(prisma.financeCompanyContact.create).toHaveBeenCalled();
    });
  });

  describe('setPrimary', () => {
    it('clears other primaries before promoting', async () => {
      prisma.financeCompanyContact.findFirst.mockResolvedValue({
        id: 'c-2', externalFinanceCompanyId: 'co-1', deletedAt: null,
      });

      await service.setPrimary('co-1', 'c-2');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.$queryRaw).toHaveBeenCalled(); // FOR UPDATE lock
      expect(prisma.financeCompanyContact.updateMany).toHaveBeenCalledWith({
        where: { externalFinanceCompanyId: 'co-1', isPrimary: true, deletedAt: null },
        data: { isPrimary: false },
      });
      expect(prisma.financeCompanyContact.update).toHaveBeenCalledWith({
        where: { id: 'c-2' },
        data: { isPrimary: true },
      });
    });

    it('throws NotFound when contact does not belong to company', async () => {
      prisma.financeCompanyContact.findFirst.mockResolvedValue(null);
      await expect(service.setPrimary('co-1', 'c-2')).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('rejects primary delete when other active contacts exist', async () => {
      prisma.financeCompanyContact.findFirst.mockResolvedValue({
        id: 'c-1', isPrimary: true, externalFinanceCompanyId: 'co-1', deletedAt: null,
      });
      prisma.financeCompanyContact.count.mockResolvedValue(1); // 1 other active contact

      await expect(service.softDelete('co-1', 'c-1')).rejects.toThrow(BadRequestException);
    });

    it('allows primary delete when no other active contacts', async () => {
      prisma.financeCompanyContact.findFirst.mockResolvedValue({
        id: 'c-1', isPrimary: true, externalFinanceCompanyId: 'co-1', deletedAt: null,
      });
      prisma.financeCompanyContact.count.mockResolvedValue(0);
      prisma.financeCompanyContact.update.mockResolvedValue({});

      await service.softDelete('co-1', 'c-1');
      expect(prisma.financeCompanyContact.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx jest finance-company-contacts.service.spec
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```typescript
// apps/api/src/modules/finance-company-contacts/finance-company-contacts.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateFinanceCompanyContactDto,
  UpdateFinanceCompanyContactDto,
} from './dto/finance-company-contact.dto';

@Injectable()
export class FinanceCompanyContactsService {
  constructor(private prisma: PrismaService) {}

  async list(companyId: string) {
    return this.prisma.financeCompanyContact.findMany({
      where: { externalFinanceCompanyId: companyId, deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async create(companyId: string, dto: CreateFinanceCompanyContactDto) {
    const company = await this.prisma.externalFinanceCompany.findFirst({
      where: { id: companyId, deletedAt: null },
    });
    if (!company) throw new NotFoundException('ไม่พบบริษัทไฟแนนซ์');

    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.financeCompanyContact.updateMany({
          where: { externalFinanceCompanyId: companyId, isPrimary: true, deletedAt: null },
          data: { isPrimary: false },
        });
      }
      return tx.financeCompanyContact.create({
        data: {
          externalFinanceCompanyId: companyId,
          name: dto.name,
          position: dto.position,
          department: dto.department,
          phone: dto.phone,
          email: dto.email,
          lineId: dto.lineId,
          notes: dto.notes,
          isPrimary: dto.isPrimary ?? false,
        },
      });
    });
  }

  async update(companyId: string, contactId: string, dto: UpdateFinanceCompanyContactDto) {
    const existing = await this.prisma.financeCompanyContact.findFirst({
      where: { id: contactId, externalFinanceCompanyId: companyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('ไม่พบผู้ติดต่อ');

    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary === true && !existing.isPrimary) {
        await tx.financeCompanyContact.updateMany({
          where: { externalFinanceCompanyId: companyId, isPrimary: true, deletedAt: null },
          data: { isPrimary: false },
        });
      }
      return tx.financeCompanyContact.update({
        where: { id: contactId },
        data: dto,
      });
    });
  }

  async setPrimary(companyId: string, contactId: string) {
    const contact = await this.prisma.financeCompanyContact.findFirst({
      where: { id: contactId, externalFinanceCompanyId: companyId, deletedAt: null },
    });
    if (!contact) throw new NotFoundException('ไม่พบผู้ติดต่อ');

    return this.prisma.$transaction(async (tx) => {
      // Row-lock the company to serialise concurrent setPrimary calls
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM external_finance_companies WHERE id = ${companyId} FOR UPDATE`,
      );
      await tx.financeCompanyContact.updateMany({
        where: { externalFinanceCompanyId: companyId, isPrimary: true, deletedAt: null },
        data: { isPrimary: false },
      });
      return tx.financeCompanyContact.update({
        where: { id: contactId },
        data: { isPrimary: true },
      });
    });
  }

  async softDelete(companyId: string, contactId: string) {
    const contact = await this.prisma.financeCompanyContact.findFirst({
      where: { id: contactId, externalFinanceCompanyId: companyId, deletedAt: null },
    });
    if (!contact) throw new NotFoundException('ไม่พบผู้ติดต่อ');

    if (contact.isPrimary) {
      const others = await this.prisma.financeCompanyContact.count({
        where: {
          externalFinanceCompanyId: companyId,
          deletedAt: null,
          isActive: true,
          NOT: { id: contactId },
        },
      });
      if (others > 0) {
        throw new BadRequestException(
          'ไม่สามารถลบผู้ติดต่อหลักได้ — กรุณาตั้งผู้ติดต่อหลักคนใหม่ก่อน',
        );
      }
    }

    return this.prisma.financeCompanyContact.update({
      where: { id: contactId },
      data: { deletedAt: new Date() },
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx jest finance-company-contacts.service.spec
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/finance-company-contacts/finance-company-contacts.service.ts apps/api/src/modules/finance-company-contacts/finance-company-contacts.service.spec.ts
git commit -m "feat(finance-contact): contacts service with primary swap + delete guard"
```

---

## Task 6: FinanceCompanyContactsController + module + wire into AppModule

**Files:**
- Create: `apps/api/src/modules/finance-company-contacts/finance-company-contacts.controller.ts`
- Create: `apps/api/src/modules/finance-company-contacts/finance-company-contacts.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write the controller**

```typescript
// apps/api/src/modules/finance-company-contacts/finance-company-contacts.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FinanceCompanyContactsService } from './finance-company-contacts.service';
import {
  CreateFinanceCompanyContactDto,
  UpdateFinanceCompanyContactDto,
} from './dto/finance-company-contact.dto';

@ApiTags('Finance Contacts')
@ApiBearerAuth('JWT')
@Controller('external-finance/companies/:companyId/contacts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanceCompanyContactsController {
  constructor(private readonly service: FinanceCompanyContactsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list(@Param('companyId') companyId: string) {
    return this.service.list(companyId);
  }

  @Post()
  @Roles('OWNER', 'FINANCE_MANAGER')
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateFinanceCompanyContactDto,
  ) {
    return this.service.create(companyId, dto);
  }

  @Patch(':contactId')
  @Roles('OWNER', 'FINANCE_MANAGER')
  update(
    @Param('companyId') companyId: string,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateFinanceCompanyContactDto,
  ) {
    return this.service.update(companyId, contactId, dto);
  }

  @Post(':contactId/set-primary')
  @Roles('OWNER', 'FINANCE_MANAGER')
  setPrimary(
    @Param('companyId') companyId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.service.setPrimary(companyId, contactId);
  }

  @Delete(':contactId')
  @Roles('OWNER', 'FINANCE_MANAGER')
  remove(
    @Param('companyId') companyId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.service.softDelete(companyId, contactId);
  }
}
```

- [ ] **Step 2: Write the module**

```typescript
// apps/api/src/modules/finance-company-contacts/finance-company-contacts.module.ts
import { Module } from '@nestjs/common';
import { FinanceCompanyContactsController } from './finance-company-contacts.controller';
import { FinanceCompanyContactsService } from './finance-company-contacts.service';

@Module({
  controllers: [FinanceCompanyContactsController],
  providers: [FinanceCompanyContactsService],
  exports: [FinanceCompanyContactsService],
})
export class FinanceCompanyContactsModule {}
```

- [ ] **Step 3: Register module in AppModule**

Open `apps/api/src/app.module.ts`, locate the imports list, and add:
```typescript
import { FinanceCompanyContactsModule } from './modules/finance-company-contacts/finance-company-contacts.module';
```
Add `FinanceCompanyContactsModule` to the `imports: [...]` array next to `FinanceReceivableModule`.

- [ ] **Step 4: Type check**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/finance-company-contacts/finance-company-contacts.controller.ts apps/api/src/modules/finance-company-contacts/finance-company-contacts.module.ts apps/api/src/app.module.ts
git commit -m "feat(finance-contact): controller + module wiring"
```

---

## Task 7: ContactLog DTO

**Files:**
- Create: `apps/api/src/modules/finance-receivable-contact-logs/dto/finance-receivable-contact-log.dto.ts`

- [ ] **Step 1: Create the DTO file**

```typescript
// apps/api/src/modules/finance-receivable-contact-logs/dto/finance-receivable-contact-log.dto.ts
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { FinanceContactChannel, FinanceContactResult } from '@prisma/client';

export class CreateFinanceContactLogDto {
  @IsOptional()
  @IsUUID('4', { message: 'financeCompanyContactId ต้องเป็น UUID' })
  financeCompanyContactId?: string;

  @IsOptional()
  @IsEnum(FinanceContactChannel, { message: 'channel ไม่ถูกต้อง' })
  channel?: FinanceContactChannel;

  @IsEnum(FinanceContactResult, { message: 'result ไม่ถูกต้อง' })
  result!: FinanceContactResult;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsDateString({}, { message: 'contactedAt ต้องเป็นวันที่ ISO' })
  contactedAt?: string;

  @IsOptional()
  @IsDateString({}, { message: 'promisedDate ต้องเป็นวันที่ ISO' })
  promisedDate?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'promisedAmount ต้องเป็นตัวเลข' })
  @IsPositive({ message: 'promisedAmount ต้องมากกว่า 0' })
  promisedAmount?: number;
}

export class UpdateFinanceContactLogDto extends PartialType(
  CreateFinanceContactLogDto,
) {}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/modules/finance-receivable-contact-logs/dto/
git commit -m "feat(finance-contact-log): add DTOs"
```

---

## Task 8: ContactLog service — record (with lazy FK resolve + KPI denorm)

**Files:**
- Create: `apps/api/src/modules/finance-receivable-contact-logs/finance-receivable-contact-logs.service.ts`
- Test: `apps/api/src/modules/finance-receivable-contact-logs/finance-receivable-contact-logs.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// finance-receivable-contact-logs.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { FinanceReceivableContactLogsService } from './finance-receivable-contact-logs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceContactResult, FinanceContactChannel } from '@prisma/client';

describe('FinanceReceivableContactLogsService — record', () => {
  let service: FinanceReceivableContactLogsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      financeReceivable: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      externalFinanceCompany: {
        upsert: jest.fn(),
      },
      financeReceivableContactLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (fn) => fn(prisma)),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceReceivableContactLogsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = mod.get(FinanceReceivableContactLogsService);
  });

  it('throws NotFound when receivable does not exist', async () => {
    prisma.financeReceivable.findFirst.mockResolvedValue(null);
    await expect(
      service.record('rec-1', 'user-1', {
        result: FinanceContactResult.ANSWERED,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('lazy-upserts ExternalFinanceCompany when FK is null', async () => {
    prisma.financeReceivable.findFirst.mockResolvedValue({
      id: 'rec-1',
      externalFinanceCompanyId: null,
      financeCompany: 'KTC Finance',
      contactAttemptCount: 0,
      lastPromisedDate: null,
    });
    prisma.externalFinanceCompany.upsert.mockResolvedValue({ id: 'co-new' });
    prisma.financeReceivableContactLog.create.mockResolvedValue({ id: 'log-1' });
    prisma.financeReceivable.update.mockResolvedValue({});

    await service.record('rec-1', 'user-1', {
      result: FinanceContactResult.ANSWERED,
    });

    expect(prisma.externalFinanceCompany.upsert).toHaveBeenCalled();
    const created = prisma.financeReceivableContactLog.create.mock.calls[0][0].data;
    expect(created.externalFinanceCompanyId).toBe('co-new');
  });

  it('updates KPI denorm: lastContactedAt + contactAttemptCount + lastPromisedDate when PROMISED', async () => {
    prisma.financeReceivable.findFirst.mockResolvedValue({
      id: 'rec-1',
      externalFinanceCompanyId: 'co-1',
      financeCompany: 'KTC',
      contactAttemptCount: 2,
      lastPromisedDate: null,
    });
    prisma.financeReceivableContactLog.create.mockResolvedValue({ id: 'log-1' });
    prisma.financeReceivable.update.mockResolvedValue({});

    await service.record('rec-1', 'user-1', {
      result: FinanceContactResult.PROMISED,
      promisedDate: '2026-06-15',
      promisedAmount: 12000,
    });

    const updateArg = prisma.financeReceivable.update.mock.calls[0][0];
    expect(updateArg.where.id).toBe('rec-1');
    expect(updateArg.data.contactAttemptCount).toBe(3);
    expect(updateArg.data.lastContactedAt).toBeInstanceOf(Date);
    expect(updateArg.data.lastPromisedDate).toBeInstanceOf(Date);
  });

  it('does not overwrite lastPromisedDate when result is not PROMISED', async () => {
    const existing = new Date('2026-06-01');
    prisma.financeReceivable.findFirst.mockResolvedValue({
      id: 'rec-1',
      externalFinanceCompanyId: 'co-1',
      financeCompany: 'KTC',
      contactAttemptCount: 1,
      lastPromisedDate: existing,
    });
    prisma.financeReceivableContactLog.create.mockResolvedValue({ id: 'log-1' });

    await service.record('rec-1', 'user-1', {
      result: FinanceContactResult.NO_ANSWER,
    });

    const updateArg = prisma.financeReceivable.update.mock.calls[0][0];
    expect(updateArg.data.lastPromisedDate).toEqual(existing);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx jest finance-receivable-contact-logs.service.spec
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service (record method first; other methods stubbed)**

```typescript
// apps/api/src/modules/finance-receivable-contact-logs/finance-receivable-contact-logs.service.ts
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { FinanceContactResult, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateFinanceContactLogDto,
  UpdateFinanceContactLogDto,
} from './dto/finance-receivable-contact-log.dto';
import { normalizeFinanceCompanyName } from './finance-company-name-normalizer.util';

@Injectable()
export class FinanceReceivableContactLogsService {
  constructor(private prisma: PrismaService) {}

  async record(
    receivableId: string,
    userId: string,
    dto: CreateFinanceContactLogDto,
  ) {
    const receivable = await this.prisma.financeReceivable.findFirst({
      where: { id: receivableId, deletedAt: null },
      select: {
        id: true,
        externalFinanceCompanyId: true,
        financeCompany: true,
        contactAttemptCount: true,
        lastPromisedDate: true,
      },
    });
    if (!receivable) throw new NotFoundException('ไม่พบรายการเงินรับจากไฟแนนซ์');

    return this.prisma.$transaction(async (tx) => {
      let companyId = receivable.externalFinanceCompanyId;

      // D6: lazy resolve — upsert ExternalFinanceCompany if receivable has no FK yet
      if (!companyId) {
        const normalized = normalizeFinanceCompanyName(receivable.financeCompany);
        const company = await tx.externalFinanceCompany.upsert({
          where: { name: receivable.financeCompany },
          create: {
            name: receivable.financeCompany,
            isActive: true,
          },
          update: {},
        });
        companyId = company.id;
        await tx.financeReceivable.update({
          where: { id: receivableId },
          data: { externalFinanceCompanyId: companyId },
        });
        // suppress unused-var warning for `normalized` until backfill script reuses it
        void normalized;
      }

      const contactedAt = dto.contactedAt ? new Date(dto.contactedAt) : new Date();
      const log = await tx.financeReceivableContactLog.create({
        data: {
          financeReceivableId: receivableId,
          externalFinanceCompanyId: companyId!,
          financeCompanyContactId: dto.financeCompanyContactId,
          contactedById: userId,
          contactedAt,
          channel: dto.channel ?? 'CALL',
          result: dto.result,
          notes: dto.notes,
          promisedDate: dto.promisedDate ? new Date(dto.promisedDate) : null,
          promisedAmount: dto.promisedAmount ?? null,
        },
      });

      // KPI denorm update
      const nextLastPromised =
        dto.result === FinanceContactResult.PROMISED && dto.promisedDate
          ? new Date(dto.promisedDate)
          : receivable.lastPromisedDate;

      await tx.financeReceivable.update({
        where: { id: receivableId },
        data: {
          lastContactedAt: contactedAt,
          lastPromisedDate: nextLastPromised,
          contactAttemptCount: { increment: 1 },
        },
      });

      return log;
    });
  }

  // stubs — implemented in Task 9
  async list(_receivableId: string) {
    return [];
  }
  async update(
    _receivableId: string,
    _logId: string,
    _userId: string,
    _userRole: string,
    _dto: UpdateFinanceContactLogDto,
  ) {
    throw new ForbiddenException('Not implemented');
  }
  async softDelete(_receivableId: string, _logId: string) {
    throw new ForbiddenException('Not implemented');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx jest finance-receivable-contact-logs.service.spec
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/finance-receivable-contact-logs/
git commit -m "feat(finance-contact-log): record with lazy FK resolve + KPI denorm"
```

---

## Task 9: ContactLog service — list / update / softDelete + aggregation

**Files:**
- Modify: `apps/api/src/modules/finance-receivable-contact-logs/finance-receivable-contact-logs.service.ts`
- Modify: `apps/api/src/modules/finance-receivable-contact-logs/finance-receivable-contact-logs.service.spec.ts`

- [ ] **Step 1: Add failing tests for list / update / softDelete / summary**

Append to the existing `.spec.ts`:

```typescript
describe('FinanceReceivableContactLogsService — list/update/delete', () => {
  let service: FinanceReceivableContactLogsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      financeReceivableContactLog: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      financeReceivable: { findFirst: jest.fn(), update: jest.fn() },
      externalFinanceCompany: { findFirst: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        FinanceReceivableContactLogsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(FinanceReceivableContactLogsService);
  });

  it('list returns logs ordered newest first with contact + user joined', async () => {
    prisma.financeReceivableContactLog.findMany.mockResolvedValue([]);
    await service.list('rec-1');
    const arg = prisma.financeReceivableContactLog.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ financeReceivableId: 'rec-1', deletedAt: null });
    expect(arg.orderBy).toEqual({ contactedAt: 'desc' });
    expect(arg.include).toMatchObject({
      contact: { select: expect.any(Object) },
      contactedBy: { select: expect.any(Object) },
    });
  });

  it('update rejects when user is not author + not OWNER/FINANCE_MANAGER', async () => {
    prisma.financeReceivableContactLog.findFirst.mockResolvedValue({
      id: 'log-1',
      contactedById: 'other-user',
      createdAt: new Date(),
    });
    await expect(
      service.update('rec-1', 'log-1', 'user-1', 'ACCOUNTANT', { notes: 'x' }),
    ).rejects.toThrow(/แก้ไขได้เฉพาะเจ้าของ/);
  });

  it('update rejects when own log but past 24h window', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    prisma.financeReceivableContactLog.findFirst.mockResolvedValue({
      id: 'log-1',
      contactedById: 'user-1',
      createdAt: old,
    });
    await expect(
      service.update('rec-1', 'log-1', 'user-1', 'ACCOUNTANT', { notes: 'x' }),
    ).rejects.toThrow(/24/);
  });

  it('update allows OWNER any time', async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    prisma.financeReceivableContactLog.findFirst.mockResolvedValue({
      id: 'log-1',
      contactedById: 'someone',
      createdAt: old,
    });
    prisma.financeReceivableContactLog.update.mockResolvedValue({});
    await expect(
      service.update('rec-1', 'log-1', 'owner-1', 'OWNER', { notes: 'x' }),
    ).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx jest finance-receivable-contact-logs.service.spec
```

Expected: 4 new tests FAIL.

- [ ] **Step 3: Replace stubs with real implementations**

Replace the stub methods at the bottom of `finance-receivable-contact-logs.service.ts` with:

```typescript
  async list(receivableId: string) {
    return this.prisma.financeReceivableContactLog.findMany({
      where: { financeReceivableId: receivableId, deletedAt: null },
      orderBy: { contactedAt: 'desc' },
      include: {
        contact: { select: { id: true, name: true, position: true, phone: true } },
        contactedBy: { select: { id: true, name: true } },
      },
    });
  }

  async update(
    receivableId: string,
    logId: string,
    userId: string,
    userRole: string,
    dto: UpdateFinanceContactLogDto,
  ) {
    const log = await this.prisma.financeReceivableContactLog.findFirst({
      where: { id: logId, financeReceivableId: receivableId, deletedAt: null },
    });
    if (!log) throw new NotFoundException('ไม่พบบันทึกการติดต่อ');

    const isPrivileged = userRole === 'OWNER' || userRole === 'FINANCE_MANAGER';
    if (!isPrivileged) {
      if (log.contactedById !== userId) {
        throw new ForbiddenException('แก้ไขได้เฉพาะเจ้าของ log');
      }
      const ageMs = Date.now() - new Date(log.createdAt).getTime();
      if (ageMs > 24 * 60 * 60 * 1000) {
        throw new ForbiddenException('เกิน 24 ชั่วโมง ไม่สามารถแก้ไขได้');
      }
    }

    return this.prisma.financeReceivableContactLog.update({
      where: { id: logId },
      data: {
        notes: dto.notes,
        result: dto.result,
        channel: dto.channel,
        financeCompanyContactId: dto.financeCompanyContactId,
        promisedDate: dto.promisedDate ? new Date(dto.promisedDate) : undefined,
        promisedAmount: dto.promisedAmount,
        contactedAt: dto.contactedAt ? new Date(dto.contactedAt) : undefined,
      },
    });
  }

  async softDelete(receivableId: string, logId: string) {
    const log = await this.prisma.financeReceivableContactLog.findFirst({
      where: { id: logId, financeReceivableId: receivableId, deletedAt: null },
    });
    if (!log) throw new NotFoundException('ไม่พบบันทึกการติดต่อ');

    await this.prisma.financeReceivableContactLog.update({
      where: { id: logId },
      data: { deletedAt: new Date() },
    });

    // Recompute KPI from remaining logs
    const remaining = await this.prisma.financeReceivableContactLog.findMany({
      where: { financeReceivableId: receivableId, deletedAt: null },
      orderBy: { contactedAt: 'desc' },
      take: 100,
    });
    const lastContactedAt = remaining[0]?.contactedAt ?? null;
    const lastPromised = remaining.find(
      (l) => l.result === 'PROMISED' && l.promisedDate,
    );
    await this.prisma.financeReceivable.update({
      where: { id: receivableId },
      data: {
        lastContactedAt,
        lastPromisedDate: lastPromised?.promisedDate ?? null,
        contactAttemptCount: remaining.length,
      },
    });
    return { ok: true };
  }

  async companyContactSummary(companyId: string) {
    const [receivableCount, totalOutstandingAgg, lastLog, brokenCount, keptCount] =
      await Promise.all([
        this.prisma.financeReceivable.count({
          where: { externalFinanceCompanyId: companyId, deletedAt: null },
        }),
        this.prisma.financeReceivable.aggregate({
          where: {
            externalFinanceCompanyId: companyId,
            deletedAt: null,
            status: { in: ['PENDING', 'OVERDUE', 'DISPUTED', 'PARTIALLY_RECEIVED'] },
          },
          _sum: { netExpectedAmount: true, receivedAmount: true },
        }),
        this.prisma.financeReceivableContactLog.findFirst({
          where: { externalFinanceCompanyId: companyId, deletedAt: null },
          orderBy: { contactedAt: 'desc' },
          select: { contactedAt: true },
        }),
        this.prisma.financeReceivableContactLog.count({
          where: {
            externalFinanceCompanyId: companyId,
            deletedAt: null,
            promisedBrokenAt: { not: null },
          },
        }),
        this.prisma.financeReceivableContactLog.count({
          where: {
            externalFinanceCompanyId: companyId,
            deletedAt: null,
            promisedKeptAt: { not: null },
          },
        }),
      ]);

    return {
      receivableCount,
      totalOutstanding: totalOutstandingAgg._sum.netExpectedAmount ?? 0,
      lastContactedAt: lastLog?.contactedAt ?? null,
      brokenPromiseCount: brokenCount,
      keptPromiseCount: keptCount,
    };
  }

  async companyContactLogs(companyId: string, page = 1, limit = 20) {
    const safeLimit = Math.min(100, Math.max(1, limit));
    const safePage = Math.max(1, page);
    const [data, total] = await Promise.all([
      this.prisma.financeReceivableContactLog.findMany({
        where: { externalFinanceCompanyId: companyId, deletedAt: null },
        orderBy: { contactedAt: 'desc' },
        include: {
          receivable: { select: { id: true, financeRefNumber: true, expectedAmount: true } },
          contact: { select: { id: true, name: true, position: true } },
          contactedBy: { select: { id: true, name: true } },
        },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.financeReceivableContactLog.count({
        where: { externalFinanceCompanyId: companyId, deletedAt: null },
      }),
    ]);
    return { data, total, page: safePage, limit: safeLimit };
  }
```

- [ ] **Step 4: Run tests**

```bash
cd apps/api && npx jest finance-receivable-contact-logs.service.spec
```

Expected: all tests PASS (including new 4).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/finance-receivable-contact-logs/finance-receivable-contact-logs.service.ts apps/api/src/modules/finance-receivable-contact-logs/finance-receivable-contact-logs.service.spec.ts
git commit -m "feat(finance-contact-log): list/update/delete + aggregation"
```

---

## Task 10: ContactLog controller + module + wire to AppModule

**Files:**
- Create: `apps/api/src/modules/finance-receivable-contact-logs/finance-receivable-contact-logs.controller.ts`
- Create: `apps/api/src/modules/finance-receivable-contact-logs/finance-receivable-contact-logs.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write controller**

```typescript
// apps/api/src/modules/finance-receivable-contact-logs/finance-receivable-contact-logs.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FinanceReceivableContactLogsService } from './finance-receivable-contact-logs.service';
import {
  CreateFinanceContactLogDto,
  UpdateFinanceContactLogDto,
} from './dto/finance-receivable-contact-log.dto';

@ApiTags('Finance Contact Logs')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class FinanceReceivableContactLogsController {
  constructor(private readonly service: FinanceReceivableContactLogsService) {}

  @Get('finance-receivable/:receivableId/contact-logs')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list(@Param('receivableId') receivableId: string) {
    return this.service.list(receivableId);
  }

  @Post('finance-receivable/:receivableId/contact-logs')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  record(
    @Param('receivableId') receivableId: string,
    @Body() dto: CreateFinanceContactLogDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.service.record(receivableId, req.user.id, dto);
  }

  @Patch('finance-receivable/:receivableId/contact-logs/:logId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  update(
    @Param('receivableId') receivableId: string,
    @Param('logId') logId: string,
    @Body() dto: UpdateFinanceContactLogDto,
    @Request() req: { user: { id: string; role: string } },
  ) {
    return this.service.update(receivableId, logId, req.user.id, req.user.role, dto);
  }

  @Delete('finance-receivable/:receivableId/contact-logs/:logId')
  @Roles('OWNER', 'FINANCE_MANAGER')
  remove(
    @Param('receivableId') receivableId: string,
    @Param('logId') logId: string,
  ) {
    return this.service.softDelete(receivableId, logId);
  }

  @Get('external-finance/companies/:companyId/contact-summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  summary(@Param('companyId') companyId: string) {
    return this.service.companyContactSummary(companyId);
  }

  @Get('external-finance/companies/:companyId/contact-logs')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  companyLogs(
    @Param('companyId') companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.companyContactLogs(
      companyId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }
}
```

- [ ] **Step 2: Write the module**

```typescript
// apps/api/src/modules/finance-receivable-contact-logs/finance-receivable-contact-logs.module.ts
import { Module } from '@nestjs/common';
import { FinanceReceivableContactLogsController } from './finance-receivable-contact-logs.controller';
import { FinanceReceivableContactLogsService } from './finance-receivable-contact-logs.service';

@Module({
  controllers: [FinanceReceivableContactLogsController],
  providers: [FinanceReceivableContactLogsService],
  exports: [FinanceReceivableContactLogsService],
})
export class FinanceReceivableContactLogsModule {}
```

- [ ] **Step 3: Register in AppModule**

In `apps/api/src/app.module.ts`:
```typescript
import { FinanceReceivableContactLogsModule } from './modules/finance-receivable-contact-logs/finance-receivable-contact-logs.module';
```
Add `FinanceReceivableContactLogsModule` to the `imports` array.

- [ ] **Step 4: Type check**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/finance-receivable-contact-logs/finance-receivable-contact-logs.controller.ts apps/api/src/modules/finance-receivable-contact-logs/finance-receivable-contact-logs.module.ts apps/api/src/app.module.ts
git commit -m "feat(finance-contact-log): controller + module wiring"
```

---

## Task 11: broken-promise-finance.cron.ts

**Files:**
- Create: `apps/api/src/modules/finance-receivable-contact-logs/crons/broken-promise-finance.cron.ts`
- Test: `apps/api/src/modules/finance-receivable-contact-logs/crons/broken-promise-finance.cron.spec.ts`
- Modify: `apps/api/src/modules/finance-receivable-contact-logs/finance-receivable-contact-logs.module.ts` (register provider)

- [ ] **Step 1: Write the failing test**

```typescript
// broken-promise-finance.cron.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { BrokenPromiseFinanceCron } from './broken-promise-finance.cron';
import { PrismaService } from '../../../prisma/prisma.service';

describe('BrokenPromiseFinanceCron', () => {
  let cron: BrokenPromiseFinanceCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = { $executeRaw: jest.fn().mockResolvedValue(7) };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        BrokenPromiseFinanceCron,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    cron = mod.get(BrokenPromiseFinanceCron);
  });

  it('marks broken promises and returns the affected count', async () => {
    const result = await cron.handleCron();
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(result).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest broken-promise-finance.cron.spec
```

Expected: FAIL.

- [ ] **Step 3: Implement the cron**

```typescript
// apps/api/src/modules/finance-receivable-contact-logs/crons/broken-promise-finance.cron.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class BrokenPromiseFinanceCron {
  private readonly logger = new Logger(BrokenPromiseFinanceCron.name);

  constructor(private prisma: PrismaService) {}

  // Daily at 02:00 Asia/Bangkok
  @Cron('0 2 * * *', { timeZone: 'Asia/Bangkok' })
  async handleCron(): Promise<number> {
    const affected = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE finance_receivable_contact_logs
      SET promised_broken_at = now()
      WHERE promised_date < CURRENT_DATE
        AND promised_broken_at IS NULL
        AND promised_kept_at IS NULL
        AND result = 'PROMISED'
        AND deleted_at IS NULL
        AND finance_receivable_id IN (
          SELECT id FROM finance_receivables
          WHERE status NOT IN ('RECEIVED', 'PARTIALLY_RECEIVED')
            AND deleted_at IS NULL
        )
    `);
    this.logger.log(`broken-promise-finance: marked ${affected} logs as broken`);
    return Number(affected);
  }
}
```

- [ ] **Step 4: Register provider in module**

Open `apps/api/src/modules/finance-receivable-contact-logs/finance-receivable-contact-logs.module.ts` and add cron to providers:

```typescript
import { BrokenPromiseFinanceCron } from './crons/broken-promise-finance.cron';
// ...
@Module({
  controllers: [FinanceReceivableContactLogsController],
  providers: [FinanceReceivableContactLogsService, BrokenPromiseFinanceCron],
  exports: [FinanceReceivableContactLogsService],
})
```

- [ ] **Step 5: Run tests**

```bash
cd apps/api && npx jest broken-promise-finance.cron.spec
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/finance-receivable-contact-logs/crons/ apps/api/src/modules/finance-receivable-contact-logs/finance-receivable-contact-logs.module.ts
git commit -m "feat(finance-contact-log): broken-promise daily cron"
```

---

## Task 12: Wire `promisedKeptAt` into `FinanceReceivableService.recordReceive`

**Files:**
- Modify: `apps/api/src/modules/finance-receivable/finance-receivable.service.ts`
- Modify: `apps/api/src/modules/finance-receivable/finance-receivable.service.spec.ts`

- [ ] **Step 1: Add failing test**

Append to `finance-receivable.service.spec.ts`:

```typescript
describe('recordReceive — promisedKeptAt hook', () => {
  it('marks open PROMISED logs as kept when payment is received on/before promised date', async () => {
    const today = new Date('2026-05-31');
    prisma.financeReceivable.findFirst.mockResolvedValue({
      id: 'rec-1',
      status: 'PENDING',
      netExpectedAmount: 10000,
      receivedAmount: 0,
      deletedAt: null,
    });
    prisma.financeReceivable.update.mockResolvedValue({ id: 'rec-1' });
    prisma.financeReceivableContactLog = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    prisma.$transaction = jest.fn().mockImplementation(async (fn) => fn(prisma));

    await service.recordReceive(
      'rec-1',
      { receivedAmount: 10000, receivedDate: today.toISOString() },
      'user-1',
    );

    expect(prisma.financeReceivableContactLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          financeReceivableId: 'rec-1',
          result: 'PROMISED',
          promisedKeptAt: null,
          promisedBrokenAt: null,
          promisedDate: { gte: expect.any(Date) },
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest finance-receivable.service.spec
```

Expected: the new test FAILS.

- [ ] **Step 3: Modify `recordReceive` to mark `promisedKeptAt`**

Open `apps/api/src/modules/finance-receivable/finance-receivable.service.ts` and locate `recordReceive`. After the `this.prisma.financeReceivable.update(...)` call, wrap the whole logic in `$transaction` if not already, then add the promise-kept hook. Example diff:

```typescript
async recordReceive(id: string, dto: RecordReceiveDto, recordedById: string) {
  const record = await this.prisma.financeReceivable.findFirst({
    where: { id, deletedAt: null },
  });
  if (!record) throw new NotFoundException('ไม่พบรายการเงินรับจากไฟแนนซ์');

  const receivedDate = new Date(dto.receivedDate);

  return this.prisma.$transaction(async (tx) => {
    const updated = await tx.financeReceivable.update({
      where: { id },
      data: {
        receivedAmount: dto.receivedAmount,
        receivedDate,
        bankRef: dto.bankRef,
        note: dto.note,
        recordedById,
        status:
          dto.receivedAmount >= Number(record.netExpectedAmount)
            ? 'RECEIVED'
            : 'PARTIALLY_RECEIVED',
      },
    });

    // mark open PROMISED logs as kept if receivedDate <= promisedDate
    await tx.financeReceivableContactLog.updateMany({
      where: {
        financeReceivableId: id,
        deletedAt: null,
        result: 'PROMISED',
        promisedKeptAt: null,
        promisedBrokenAt: null,
        promisedDate: { gte: receivedDate },
      },
      data: { promisedKeptAt: receivedDate },
    });

    return updated;
  });
}
```

> If the existing `recordReceive` has additional logic (journal, audit), preserve it inside the transaction — wrap only, don't rewrite.

- [ ] **Step 4: Run tests**

```bash
cd apps/api && npx jest finance-receivable.service.spec
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/finance-receivable/
git commit -m "feat(finance-receivable): mark promisedKeptAt on receive"
```

---

## Task 13: Update `sales.service.ts` to resolve FK at FinanceReceivable creation

**Files:**
- Modify: `apps/api/src/modules/sales/sales.service.ts` (lines ~626 and ~715)

- [ ] **Step 1: Add helper at the top of the class (after `constructor`)**

```typescript
  private async resolveExternalFinanceCompanyId(
    tx: Prisma.TransactionClient,
    name: string,
  ): Promise<string> {
    const company = await tx.externalFinanceCompany.upsert({
      where: { name },
      create: { name, isActive: true },
      update: {},
    });
    return company.id;
  }
```

If `Prisma` isn't already imported, add to imports:
```typescript
import { Prisma } from '@prisma/client';
```

- [ ] **Step 2: Update the BESTCHOICE FINANCE creation (around line 626)**

Replace:
```typescript
      await tx.financeReceivable.create({
        data: {
          saleId: sale.id,
          branchId: dto.branchId,
          financeCompany: 'BESTCHOICE FINANCE',
          expectedAmount: calc.principal + calc.storeCommission,
          ...
```

With:
```typescript
      const bcFinanceId = await this.resolveExternalFinanceCompanyId(tx, 'BESTCHOICE FINANCE');
      await tx.financeReceivable.create({
        data: {
          saleId: sale.id,
          branchId: dto.branchId,
          financeCompany: 'BESTCHOICE FINANCE',
          externalFinanceCompanyId: bcFinanceId,
          expectedAmount: calc.principal + calc.storeCommission,
          ...
```

- [ ] **Step 3: Update the external finance creation (around line 715)**

Replace:
```typescript
      await tx.financeReceivable.create({
        data: {
          saleId: sale.id,
          branchId: dto.branchId,
          financeCompany: dto.financeCompany!,
          ...
```

With:
```typescript
      const extFinanceId = await this.resolveExternalFinanceCompanyId(tx, dto.financeCompany!);
      await tx.financeReceivable.create({
        data: {
          saleId: sale.id,
          branchId: dto.branchId,
          financeCompany: dto.financeCompany!,
          externalFinanceCompanyId: extFinanceId,
          ...
```

- [ ] **Step 4: Type check**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 5: Run existing sales tests**

```bash
cd apps/api && npx jest sales.service.spec
```

Expected: existing tests PASS (no behaviour change beyond extra field write).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/sales/sales.service.ts
git commit -m "feat(sales): resolve external-finance FK on FinanceReceivable create"
```

---

## Task 14: Update `FinanceReceivableService.findAll` + `findOne` to include new fields

**Files:**
- Modify: `apps/api/src/modules/finance-receivable/finance-receivable.service.ts`

- [ ] **Step 1: Expand `findAll` include**

Locate the `include:` block in `findAll`. Add `lastContactedAt`, `lastPromisedDate`, `contactAttemptCount` to the implicit field selection (they come automatically since no `select:` is used; just verify they exist on the returned shape).

Add `externalFinanceCompanyId` to the `where` filter when caller passes a new `companyId` query string. Add this to the destructured filter argument:

```typescript
async findAll(filters: {
  // ... existing fields
  externalFinanceCompanyId?: string;
  brokenPromiseOnly?: boolean;
}) {
  const { externalFinanceCompanyId, brokenPromiseOnly, ...rest } = filters;
  // ... existing logic
  if (externalFinanceCompanyId) where.externalFinanceCompanyId = externalFinanceCompanyId;
  if (brokenPromiseOnly) {
    where.contactLogs = {
      some: {
        promisedBrokenAt: { not: null },
        promisedKeptAt: null,
        deletedAt: null,
      },
    };
  }
  // ... rest
}
```

- [ ] **Step 2: Expose query params in controller**

Open `apps/api/src/modules/finance-receivable/finance-receivable.controller.ts`. Add to `findAll(...)` signature:

```typescript
    @Query('externalFinanceCompanyId') externalFinanceCompanyId?: string,
    @Query('brokenPromiseOnly') brokenPromiseOnly?: string,
```

And pass to service:
```typescript
    return this.service.findAll({
      // ... existing
      externalFinanceCompanyId,
      brokenPromiseOnly: brokenPromiseOnly === 'true',
    });
```

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/finance-receivable/
git commit -m "feat(finance-receivable): support externalFinanceCompanyId + brokenPromiseOnly filter"
```

---

## Task 15: Backfill script

**Files:**
- Create: `apps/api/scripts/backfill-external-finance-fk.ts`
- Modify: `apps/api/package.json` (add npm script)

- [ ] **Step 1: Write the script**

```typescript
// apps/api/scripts/backfill-external-finance-fk.ts
import { PrismaClient } from '@prisma/client';
import { normalizeFinanceCompanyName } from '../src/modules/finance-receivable-contact-logs/finance-company-name-normalizer.util';

const prisma = new PrismaClient();

interface Report {
  receivablesMatched: number;
  receivablesNewCompany: number;
  contactsMigrated: number;
  contactsSkipped: number;
}

async function main(): Promise<Report> {
  const report: Report = {
    receivablesMatched: 0,
    receivablesNewCompany: 0,
    contactsMigrated: 0,
    contactsSkipped: 0,
  };

  // Step 1: index existing ExternalFinanceCompany by normalized name
  const allCompanies = await prisma.externalFinanceCompany.findMany({
    where: { deletedAt: null },
  });
  const byNormName = new Map<string, string>();
  for (const c of allCompanies) {
    byNormName.set(normalizeFinanceCompanyName(c.name), c.id);
  }

  // Step 2: resolve FK on every receivable that lacks one
  const orphans = await prisma.financeReceivable.findMany({
    where: { externalFinanceCompanyId: null, deletedAt: null },
    select: { id: true, financeCompany: true },
  });

  for (const r of orphans) {
    const norm = normalizeFinanceCompanyName(r.financeCompany);
    let companyId = byNormName.get(norm);
    if (!companyId) {
      const created = await prisma.externalFinanceCompany.create({
        data: { name: r.financeCompany, isActive: true },
      });
      companyId = created.id;
      byNormName.set(norm, companyId);
      report.receivablesNewCompany += 1;
    } else {
      report.receivablesMatched += 1;
    }
    await prisma.financeReceivable.update({
      where: { id: r.id },
      data: { externalFinanceCompanyId: companyId },
    });
  }

  // Step 3: migrate contactPerson/contactPhone → FinanceCompanyContact (idempotent)
  const legacy = await prisma.externalFinanceCompany.findMany({
    where: { deletedAt: null, contactPerson: { not: null } },
  });
  for (const co of legacy) {
    const existingPrimary = await prisma.financeCompanyContact.findFirst({
      where: { externalFinanceCompanyId: co.id, isPrimary: true, deletedAt: null },
    });
    if (existingPrimary) {
      report.contactsSkipped += 1;
      continue;
    }
    await prisma.financeCompanyContact.create({
      data: {
        externalFinanceCompanyId: co.id,
        name: co.contactPerson!,
        phone: co.contactPhone,
        isPrimary: true,
        isActive: true,
      },
    });
    report.contactsMigrated += 1;
  }

  return report;
}

main()
  .then((report) => {
    console.log('Backfill report:', JSON.stringify(report, null, 2));
    return prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 2: Add npm script**

Open `apps/api/package.json`. Inside `"scripts": {...}` add:
```json
    "backfill:external-finance": "tsx scripts/backfill-external-finance-fk.ts",
```

(If `tsx` is not already a devDependency, use `ts-node` instead — check the existing `package.json` for how other one-off scripts run.)

- [ ] **Step 3: Dry-run against dev DB**

```bash
cd apps/api && npm run backfill:external-finance
```

Expected: report printed showing counts. Exit code 0.

- [ ] **Step 4: Verify rerun is idempotent**

```bash
cd apps/api && npm run backfill:external-finance
```

Expected: report shows `receivablesMatched=0`, `receivablesNewCompany=0`, all `contactsMigrated=0`, all `contactsSkipped` (since primary already exists).

- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts/ apps/api/package.json
git commit -m "feat(scripts): backfill external-finance FK + primary contact"
```

---

## Task 16: Frontend — typed API wrappers + query keys

**Files:**
- Create: `apps/web/src/lib/api/finance-contacts.ts`

- [ ] **Step 1: Create the file**

```typescript
// apps/web/src/lib/api/finance-contacts.ts
import api from '@/lib/api';

export interface FinanceCompanyContact {
  id: string;
  name: string;
  position: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  lineId: string | null;
  notes: string | null;
  isPrimary: boolean;
  isActive: boolean;
}

export interface FinanceContactLog {
  id: string;
  contactedAt: string;
  channel: 'CALL' | 'EMAIL' | 'LINE' | 'MEETING' | 'OTHER';
  result: 'ANSWERED' | 'NO_ANSWER' | 'PROMISED' | 'DISPUTED' | 'REQUESTED_DOCS' | 'OTHER';
  notes: string | null;
  promisedDate: string | null;
  promisedAmount: string | null;
  promisedBrokenAt: string | null;
  promisedKeptAt: string | null;
  contact: { id: string; name: string; position: string | null; phone: string | null } | null;
  contactedBy: { id: string; name: string };
}

export interface CompanyContactSummary {
  receivableCount: number;
  totalOutstanding: number;
  lastContactedAt: string | null;
  brokenPromiseCount: number;
  keptPromiseCount: number;
}

export const financeContactKeys = {
  all: ['finance-contacts'] as const,
  companyContacts: (companyId: string) =>
    [...financeContactKeys.all, 'company', companyId, 'contacts'] as const,
  receivableLogs: (receivableId: string) =>
    [...financeContactKeys.all, 'receivable', receivableId, 'logs'] as const,
  companySummary: (companyId: string) =>
    [...financeContactKeys.all, 'company', companyId, 'summary'] as const,
  companyLogs: (companyId: string, page: number) =>
    [...financeContactKeys.all, 'company', companyId, 'logs', page] as const,
};

export const financeContactApi = {
  listContacts: (companyId: string) =>
    api.get<FinanceCompanyContact[]>(`/external-finance/companies/${companyId}/contacts`).then((r) => r.data),
  createContact: (companyId: string, payload: Partial<FinanceCompanyContact>) =>
    api.post(`/external-finance/companies/${companyId}/contacts`, payload).then((r) => r.data),
  updateContact: (companyId: string, contactId: string, payload: Partial<FinanceCompanyContact>) =>
    api.patch(`/external-finance/companies/${companyId}/contacts/${contactId}`, payload).then((r) => r.data),
  deleteContact: (companyId: string, contactId: string) =>
    api.delete(`/external-finance/companies/${companyId}/contacts/${contactId}`).then((r) => r.data),
  setPrimary: (companyId: string, contactId: string) =>
    api.post(`/external-finance/companies/${companyId}/contacts/${contactId}/set-primary`).then((r) => r.data),

  listLogs: (receivableId: string) =>
    api.get<FinanceContactLog[]>(`/finance-receivable/${receivableId}/contact-logs`).then((r) => r.data),
  recordLog: (
    receivableId: string,
    payload: {
      financeCompanyContactId?: string;
      result: FinanceContactLog['result'];
      channel?: FinanceContactLog['channel'];
      notes?: string;
      promisedDate?: string;
      promisedAmount?: number;
    },
  ) => api.post(`/finance-receivable/${receivableId}/contact-logs`, payload).then((r) => r.data),

  companySummary: (companyId: string) =>
    api.get<CompanyContactSummary>(`/external-finance/companies/${companyId}/contact-summary`).then((r) => r.data),
  companyLogs: (companyId: string, page = 1, limit = 20) =>
    api
      .get(`/external-finance/companies/${companyId}/contact-logs`, { params: { page, limit } })
      .then((r) => r.data),
};
```

- [ ] **Step 2: Type check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api/finance-contacts.ts
git commit -m "feat(web): finance contacts API wrappers + query keys"
```

---

## Task 17: FinanceContactLogDialog component

**Files:**
- Create: `apps/web/src/pages/FinanceReceivablePage/FinanceContactLogDialog.tsx`

- [ ] **Step 1: Create the dialog**

```tsx
// apps/web/src/pages/FinanceReceivablePage/FinanceContactLogDialog.tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import {
  financeContactApi,
  financeContactKeys,
  FinanceContactLog,
} from '@/lib/api/finance-contacts';
import { getErrorMessage } from '@/lib/api';

interface Props {
  receivableId: string;
  companyId: string;
  outstanding: number;
  open: boolean;
  onClose: () => void;
}

const RESULT_OPTIONS: Array<{ value: FinanceContactLog['result']; label: string; tone: string }> = [
  { value: 'ANSWERED', label: 'รับสาย', tone: 'bg-emerald-100 text-emerald-700' },
  { value: 'NO_ANSWER', label: 'ไม่รับ', tone: 'bg-muted text-muted-foreground' },
  { value: 'PROMISED', label: 'รับปาก', tone: 'bg-amber-100 text-amber-700' },
  { value: 'DISPUTED', label: 'โต้แย้ง', tone: 'bg-red-100 text-red-700' },
  { value: 'REQUESTED_DOCS', label: 'ขอเอกสาร', tone: 'bg-blue-100 text-blue-700' },
  { value: 'OTHER', label: 'อื่นๆ', tone: 'bg-secondary text-secondary-foreground' },
];

export default function FinanceContactLogDialog({
  receivableId,
  companyId,
  outstanding,
  open,
  onClose,
}: Props) {
  const qc = useQueryClient();
  const [contactId, setContactId] = useState<string | undefined>();
  const [result, setResult] = useState<FinanceContactLog['result']>('ANSWERED');
  const [notes, setNotes] = useState('');
  const [promisedDate, setPromisedDate] = useState('');
  const [promisedAmount, setPromisedAmount] = useState<string>(String(outstanding));

  const { data: contacts } = useQuery({
    queryKey: financeContactKeys.companyContacts(companyId),
    queryFn: () => financeContactApi.listContacts(companyId),
    enabled: open && !!companyId,
  });

  const submit = useMutation({
    mutationFn: () =>
      financeContactApi.recordLog(receivableId, {
        financeCompanyContactId: contactId,
        result,
        notes: notes.trim() || undefined,
        promisedDate: result === 'PROMISED' ? promisedDate : undefined,
        promisedAmount: result === 'PROMISED' ? Number(promisedAmount) : undefined,
      }),
    onSuccess: () => {
      toast.success('บันทึกการติดต่อสำเร็จ');
      qc.invalidateQueries({ queryKey: financeContactKeys.receivableLogs(receivableId) });
      qc.invalidateQueries({ queryKey: ['finance-receivable'] });
      onClose();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="บันทึกการติดต่อไฟแนนซ์">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">ผู้ติดต่อ</label>
          <select
            className="w-full px-3 py-2 border border-input rounded-lg bg-background"
            value={contactId ?? ''}
            onChange={(e) => setContactId(e.target.value || undefined)}
          >
            <option value="">— ไม่ระบุ —</option>
            {contacts?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.position ? ` (${c.position})` : ''}{c.isPrimary ? ' ★ ตัวหลัก' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">ผลการติดต่อ</label>
          <div className="flex flex-wrap gap-2">
            {RESULT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setResult(opt.value)}
                className={`px-3 py-1.5 rounded-full text-sm border ${
                  result === opt.value
                    ? `${opt.tone} border-current font-medium`
                    : 'border-border text-muted-foreground hover:bg-accent'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {result === 'PROMISED' && (
          <div className="space-y-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div>
              <label className="block text-sm font-medium mb-1">วันที่นัดโอน</label>
              <ThaiDateInput value={promisedDate} onChange={setPromisedDate} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">ยอดที่นัด (บาท)</label>
              <input
                type="number"
                className="w-full px-3 py-2 border border-input rounded-lg bg-background"
                value={promisedAmount}
                onChange={(e) => setPromisedAmount(e.target.value)}
                min={0}
                step={0.01}
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-2">โน้ต</label>
          <textarea
            className="w-full px-3 py-2 border border-input rounded-lg bg-background"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="รายละเอียดการคุย…"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={submit.isPending || (result === 'PROMISED' && !promisedDate)}
          >
            {submit.isPending ? 'กำลังบันทึก…' : 'บันทึก'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Type check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/FinanceReceivablePage/FinanceContactLogDialog.tsx
git commit -m "feat(web): FinanceContactLogDialog component"
```

---

## Task 18: ContactTimeline + FinanceReceivableDetailDrawer

**Files:**
- Create: `apps/web/src/pages/FinanceReceivablePage/ContactTimeline.tsx`
- Create: `apps/web/src/pages/FinanceReceivablePage/FinanceReceivableDetailDrawer.tsx`

- [ ] **Step 1: Create the timeline component**

```tsx
// apps/web/src/pages/FinanceReceivablePage/ContactTimeline.tsx
import { Badge } from '@/components/ui/badge';
import { FinanceContactLog } from '@/lib/api/finance-contacts';
import { formatDateShortThai } from '@/utils/formatters';

const RESULT_LABEL: Record<FinanceContactLog['result'], string> = {
  ANSWERED: 'รับสาย',
  NO_ANSWER: 'ไม่รับ',
  PROMISED: 'รับปาก',
  DISPUTED: 'โต้แย้ง',
  REQUESTED_DOCS: 'ขอเอกสาร',
  OTHER: 'อื่นๆ',
};

const RESULT_TONE: Record<FinanceContactLog['result'], string> = {
  ANSWERED: 'bg-emerald-100 text-emerald-700',
  NO_ANSWER: 'bg-muted text-muted-foreground',
  PROMISED: 'bg-amber-100 text-amber-700',
  DISPUTED: 'bg-red-100 text-red-700',
  REQUESTED_DOCS: 'bg-blue-100 text-blue-700',
  OTHER: 'bg-secondary text-secondary-foreground',
};

export default function ContactTimeline({ logs }: { logs: FinanceContactLog[] }) {
  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">ยังไม่มีบันทึกการติดต่อ</p>;
  }

  return (
    <ol className="relative border-l border-border ml-3 space-y-4">
      {logs.map((log) => {
        const promiseBroken = !!log.promisedBrokenAt;
        const promiseKept = !!log.promisedKeptAt;
        return (
          <li key={log.id} className="ml-4">
            <span className="absolute -left-1.5 mt-1.5 w-3 h-3 bg-primary rounded-full" />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{log.contactedBy.name}</span>
              <span className="text-muted-foreground">{formatDateShortThai(log.contactedAt)}</span>
              {log.contact && (
                <Badge variant="secondary">
                  คุย: {log.contact.name}{log.contact.position ? ` (${log.contact.position})` : ''}
                </Badge>
              )}
              <span className={`px-2 py-0.5 rounded text-xs ${RESULT_TONE[log.result]}`}>
                {RESULT_LABEL[log.result]}
              </span>
            </div>
            {log.notes && <p className="mt-1 text-sm text-foreground/80">{log.notes}</p>}
            {log.promisedDate && (
              <div
                className={`mt-2 inline-block px-3 py-1.5 rounded-lg text-sm ${
                  promiseBroken
                    ? 'bg-red-50 text-red-700 border border-red-200'
                    : promiseKept
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}
              >
                {promiseKept ? '✓ นัดสำเร็จ ' : promiseBroken ? '✗ ผิดนัด ' : '⏳ นัดไว้ '}
                {formatDateShortThai(log.promisedDate)}
                {log.promisedAmount && ` • ${Number(log.promisedAmount).toLocaleString('th-TH')} บาท`}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 2: Create the drawer**

```tsx
// apps/web/src/pages/FinanceReceivablePage/FinanceReceivableDetailDrawer.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Phone } from 'lucide-react';
import {
  financeContactApi,
  financeContactKeys,
} from '@/lib/api/finance-contacts';
import { formatDateShortThai } from '@/utils/formatters';
import ContactTimeline from './ContactTimeline';
import FinanceContactLogDialog from './FinanceContactLogDialog';

interface Receivable {
  id: string;
  expectedAmount: string;
  netExpectedAmount: string;
  receivedAmount: string | null;
  status: string;
  externalFinanceCompanyId: string | null;
  financeCompany: string;
  lastContactedAt: string | null;
  lastPromisedDate: string | null;
  contactAttemptCount: number;
}

interface Props {
  receivable: Receivable | null;
  onClose: () => void;
}

export default function FinanceReceivableDetailDrawer({ receivable, onClose }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: logs = [] } = useQuery({
    queryKey: receivable ? financeContactKeys.receivableLogs(receivable.id) : ['noop'],
    queryFn: () => financeContactApi.listLogs(receivable!.id),
    enabled: !!receivable,
  });

  if (!receivable) return null;
  const outstanding = Number(receivable.netExpectedAmount) - Number(receivable.receivedAmount ?? 0);

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>รายการเงินรับจากไฟแนนซ์</SheetTitle>
          </SheetHeader>

          <div className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <span className="text-sm text-muted-foreground">{receivable.financeCompany}</span>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">ยอดที่คาดว่าจะรับ</span>
                  <span className="font-medium">
                    {Number(receivable.netExpectedAmount).toLocaleString('th-TH', {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                </div>
                {receivable.externalFinanceCompanyId && (
                  <Link
                    to={`/external-finance-companies/${receivable.externalFinanceCompanyId}`}
                    className="text-sm text-primary hover:underline"
                  >
                    ดูข้อมูลบริษัทไฟแนนซ์ →
                  </Link>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <span className="text-sm font-medium">KPI การติดตาม</span>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-muted-foreground">ติดต่อล่าสุด</div>
                  <div className="font-medium">
                    {receivable.lastContactedAt ? formatDateShortThai(receivable.lastContactedAt) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">นัดล่าสุด</div>
                  <div className="font-medium">
                    {receivable.lastPromisedDate ? formatDateShortThai(receivable.lastPromisedDate) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">จำนวนครั้ง</div>
                  <div className="font-medium">{receivable.contactAttemptCount}</div>
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center justify-between">
              <h3 className="font-medium">ประวัติการติดต่อ</h3>
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                <Phone className="w-4 h-4 mr-1" /> บันทึกการติดต่อ
              </Button>
            </div>
            <ContactTimeline logs={logs} />
          </div>
        </SheetContent>
      </Sheet>

      {dialogOpen && receivable.externalFinanceCompanyId && (
        <FinanceContactLogDialog
          receivableId={receivable.id}
          companyId={receivable.externalFinanceCompanyId}
          outstanding={outstanding > 0 ? outstanding : 0}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/FinanceReceivablePage/
git commit -m "feat(web): contact timeline + receivable detail drawer"
```

---

## Task 19: Update `FinanceReceivablePage.tsx` — wire columns + row click + filter

**Files:**
- Modify: `apps/web/src/pages/FinanceReceivablePage.tsx`

- [ ] **Step 1: Extend the `FinanceReceivable` interface**

At the top of the file, append fields to the existing interface:

```typescript
interface FinanceReceivable {
  // ... existing
  externalFinanceCompanyId: string | null;
  lastContactedAt: string | null;
  lastPromisedDate: string | null;
  contactAttemptCount: number;
}
```

- [ ] **Step 2: Add state + handler for drawer**

Inside the main page component, near other `useState`:

```typescript
const [selectedReceivable, setSelectedReceivable] = useState<FinanceReceivable | null>(null);
const [brokenPromiseOnly, setBrokenPromiseOnly] = useState(false);
```

Add import:
```typescript
import FinanceReceivableDetailDrawer from './FinanceReceivablePage/FinanceReceivableDetailDrawer';
```

- [ ] **Step 3: Pass `brokenPromiseOnly` to the query string**

Locate the existing receivables `useQuery`'s `queryFn`. Add `brokenPromiseOnly` to the URLSearchParams when true:

```typescript
if (brokenPromiseOnly) params.set('brokenPromiseOnly', 'true');
```

And include `brokenPromiseOnly` in the `queryKey` array.

- [ ] **Step 4: Add the new columns + row click**

Locate the columns array for the main receivables table. After the existing "บริษัทไฟแนนซ์" column, add:

```tsx
{
  key: 'lastContactedAt',
  label: 'ติดต่อล่าสุด',
  render: (row: FinanceReceivable) =>
    row.lastContactedAt ? formatDateShortThai(row.lastContactedAt) : '—',
},
{
  key: 'lastPromisedDate',
  label: 'นัดล่าสุด',
  render: (row: FinanceReceivable) => {
    if (!row.lastPromisedDate) return '—';
    const overdue = new Date(row.lastPromisedDate) < new Date() && row.status !== 'RECEIVED';
    return (
      <span className={overdue ? 'text-red-600 font-medium' : ''}>
        {formatDateShortThai(row.lastPromisedDate)}
      </span>
    );
  },
},
```

In the DataTable props, add `onRowClick={(row) => setSelectedReceivable(row)}` (if DataTable doesn't support `onRowClick`, wrap each row with a clickable element — check existing pattern in `CustomersPage.tsx`).

- [ ] **Step 5: Render drawer and broken-promise filter**

Above the DataTable, add the filter toggle:

```tsx
<label className="flex items-center gap-2 text-sm">
  <input
    type="checkbox"
    checked={brokenPromiseOnly}
    onChange={(e) => setBrokenPromiseOnly(e.target.checked)}
  />
  มีนัดเลยกำหนด
</label>
```

At the bottom of the component, before the closing fragment:

```tsx
<FinanceReceivableDetailDrawer
  receivable={selectedReceivable}
  onClose={() => setSelectedReceivable(null)}
/>
```

- [ ] **Step 6: Type check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/FinanceReceivablePage.tsx
git commit -m "feat(web): FinanceReceivablePage row click + KPI columns + broken filter"
```

---

## Task 20: ExternalFinanceCompanyDetailPage — 4 tabs

**Files:**
- Create: `apps/web/src/pages/ExternalFinanceCompanyDetailPage.tsx`
- Modify: `apps/web/src/App.tsx` (register route)

- [ ] **Step 1: Create the page with 4 tabs (skeleton — each tab can be a section, not a separate file, given the small size)**

```tsx
// apps/web/src/pages/ExternalFinanceCompanyDetailPage.tsx
import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  financeContactApi,
  financeContactKeys,
  FinanceCompanyContact,
} from '@/lib/api/finance-contacts';
import { formatDateShortThai } from '@/utils/formatters';
import QueryBoundary from '@/components/QueryBoundary';

interface CompanyMaster {
  id: string;
  name: string;
  taxId: string | null;
  email: string | null;
  lineOaId: string | null;
  creditTermDays: number | null;
  defaultCommissionRate: string | null;
  notes: string | null;
}

export default function ExternalFinanceCompanyDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const company = useQuery({
    queryKey: ['external-finance-company', id],
    queryFn: () => api.get<CompanyMaster>(`/external-finance/companies/${id}`).then((r) => r.data),
  });
  const summary = useQuery({
    queryKey: financeContactKeys.companySummary(id),
    queryFn: () => financeContactApi.companySummary(id),
  });

  return (
    <div className="space-y-4">
      <QueryBoundary query={company}>
        <PageHeader
          title={company.data?.name ?? '...'}
          subtitle={company.data?.taxId ? `เลขผู้เสียภาษี: ${company.data.taxId}` : undefined}
        />
        <Card>
          <CardContent className="grid grid-cols-4 gap-4 pt-6">
            <Kpi label="บัญชีค้างรับ" value={summary.data?.receivableCount ?? 0} />
            <Kpi
              label="ยอดค้างรวม"
              value={Number(summary.data?.totalOutstanding ?? 0).toLocaleString('th-TH', {
                minimumFractionDigits: 2,
              })}
            />
            <Kpi
              label="ติดต่อล่าสุด"
              value={summary.data?.lastContactedAt ? formatDateShortThai(summary.data.lastContactedAt) : '—'}
            />
            <Kpi
              label="ผิดนัด / นัดสำเร็จ"
              value={`${summary.data?.brokenPromiseCount ?? 0} / ${summary.data?.keptPromiseCount ?? 0}`}
            />
          </CardContent>
        </Card>

        <Tabs defaultValue="info">
          <TabsList>
            <TabsTrigger value="info">ข้อมูลกิจการ</TabsTrigger>
            <TabsTrigger value="contacts">ผู้ติดต่อ</TabsTrigger>
            <TabsTrigger value="receivables">บัญชีค้างรับ</TabsTrigger>
            <TabsTrigger value="logs">ประวัติติดต่อ</TabsTrigger>
          </TabsList>
          <TabsContent value="info">
            <CompanyInfoTab company={company.data} />
          </TabsContent>
          <TabsContent value="contacts">
            <ContactsTab companyId={id} />
          </TabsContent>
          <TabsContent value="receivables">
            <ReceivablesTab companyId={id} />
          </TabsContent>
          <TabsContent value="logs">
            <AllContactLogsTab companyId={id} />
          </TabsContent>
        </Tabs>
      </QueryBoundary>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function CompanyInfoTab({ company }: { company: CompanyMaster | undefined }) {
  if (!company) return null;
  return (
    <Card>
      <CardContent className="pt-6 grid grid-cols-2 gap-4 text-sm">
        <Field label="ชื่อบริษัท" value={company.name} />
        <Field label="เลขผู้เสียภาษี" value={company.taxId} />
        <Field label="อีเมล" value={company.email} />
        <Field label="LINE OA" value={company.lineOaId} />
        <Field
          label="เครดิตเทอม"
          value={company.creditTermDays != null ? `${company.creditTermDays} วัน` : null}
        />
        <Field
          label="คอมมิชชั่นปกติ"
          value={company.defaultCommissionRate ? `${Number(company.defaultCommissionRate) * 100}%` : null}
        />
        <Field label="หมายเหตุ" value={company.notes} fullWidth />
      </CardContent>
    </Card>
  );
}

function Field({ label, value, fullWidth }: { label: string; value: string | null; fullWidth?: boolean }) {
  return (
    <div className={fullWidth ? 'col-span-2' : ''}>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium">{value || '—'}</div>
    </div>
  );
}

function ContactsTab({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const contacts = useQuery({
    queryKey: financeContactKeys.companyContacts(companyId),
    queryFn: () => financeContactApi.listContacts(companyId),
  });

  const setPrimary = useMutation({
    mutationFn: (contactId: string) => financeContactApi.setPrimary(companyId, contactId),
    onSuccess: () => {
      toast.success('ตั้งผู้ติดต่อหลักสำเร็จ');
      qc.invalidateQueries({ queryKey: financeContactKeys.companyContacts(companyId) });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (contactId: string) => financeContactApi.deleteContact(companyId, contactId),
    onSuccess: () => {
      toast.success('ลบผู้ติดต่อสำเร็จ');
      qc.invalidateQueries({ queryKey: financeContactKeys.companyContacts(companyId) });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <QueryBoundary query={contacts}>
      <div className="space-y-2 mt-4">
        {(contacts.data ?? []).map((c: FinanceCompanyContact) => (
          <Card key={c.id}>
            <CardContent className="flex items-center justify-between pt-6">
              <div>
                <div className="font-medium flex items-center gap-2">
                  {c.name}
                  {c.isPrimary && <Badge>ตัวหลัก</Badge>}
                </div>
                <div className="text-sm text-muted-foreground">
                  {c.position}{c.phone ? ` • ${c.phone}` : ''}{c.email ? ` • ${c.email}` : ''}
                </div>
              </div>
              <div className="flex gap-2">
                {!c.isPrimary && (
                  <Button size="sm" variant="outline" onClick={() => setPrimary.mutate(c.id)}>
                    ตั้งเป็นหลัก
                  </Button>
                )}
                <Button size="sm" variant="destructive" onClick={() => remove.mutate(c.id)}>
                  ลบ
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {contacts.data?.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">ยังไม่มีผู้ติดต่อ</p>
        )}
      </div>
    </QueryBoundary>
  );
}

function ReceivablesTab({ companyId }: { companyId: string }) {
  const list = useQuery({
    queryKey: ['finance-receivable-by-company', companyId],
    queryFn: () =>
      api
        .get(`/finance-receivable?externalFinanceCompanyId=${companyId}&limit=50`)
        .then((r) => r.data),
  });
  return (
    <QueryBoundary query={list}>
      <ol className="space-y-2 mt-4">
        {(list.data?.data ?? []).map((r: { id: string; financeRefNumber: string | null; status: string; expectedDate: string; expectedAmount: string }) => (
          <li key={r.id} className="p-3 border border-border rounded-lg flex justify-between text-sm">
            <span>{r.financeRefNumber ?? r.id.slice(0, 8)}</span>
            <span>{r.status}</span>
            <span>{formatDateShortThai(r.expectedDate)}</span>
            <span>{Number(r.expectedAmount).toLocaleString('th-TH')}</span>
          </li>
        ))}
      </ol>
    </QueryBoundary>
  );
}

function AllContactLogsTab({ companyId }: { companyId: string }) {
  const [page, setPage] = useState(1);
  const logs = useQuery({
    queryKey: financeContactKeys.companyLogs(companyId, page),
    queryFn: () => financeContactApi.companyLogs(companyId, page),
  });
  return (
    <QueryBoundary query={logs}>
      <ol className="space-y-2 mt-4">
        {(logs.data?.data ?? []).map((l: { id: string; contactedAt: string; result: string; notes: string | null; contactedBy: { name: string } }) => (
          <li key={l.id} className="p-3 border border-border rounded-lg text-sm">
            <div className="flex gap-2">
              <span className="font-medium">{l.contactedBy.name}</span>
              <span className="text-muted-foreground">{formatDateShortThai(l.contactedAt)}</span>
              <Badge variant="secondary">{l.result}</Badge>
            </div>
            {l.notes && <p className="mt-1 text-muted-foreground">{l.notes}</p>}
          </li>
        ))}
      </ol>
      <div className="flex justify-end gap-2 mt-3">
        <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
          ก่อนหน้า
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={(logs.data?.data?.length ?? 0) < 20}
          onClick={() => setPage(page + 1)}
        >
          ถัดไป
        </Button>
      </div>
    </QueryBoundary>
  );
}
```

- [ ] **Step 2: Register route in App.tsx**

In `apps/web/src/App.tsx`, add lazy import near other page imports:
```typescript
const ExternalFinanceCompanyDetailPage = lazy(() => import('@/pages/ExternalFinanceCompanyDetailPage'));
```

Add route inside the `ProtectedRoute` block (similar to `FinancePortfolioPage` placement):
```tsx
<Route
  path="/external-finance-companies/:id"
  element={
    <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
      <MainLayout>
        <ExternalFinanceCompanyDetailPage />
      </MainLayout>
    </ProtectedRoute>
  }
/>
```

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ExternalFinanceCompanyDetailPage.tsx apps/web/src/App.tsx
git commit -m "feat(web): ExternalFinanceCompanyDetailPage with 4 tabs"
```

---

## Task 21: E2E test — log contact + verify timeline + KPI column

**Files:**
- Create: `apps/web/e2e/finance-receivable-contact.spec.ts`

- [ ] **Step 1: Write the E2E test**

```typescript
// apps/web/e2e/finance-receivable-contact.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Finance Receivable contact log', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'finance@bestchoice.com');
    await page.fill('input[name="password"]', 'admin1234');
    await page.click('button[type="submit"]');
    await page.waitForURL('/');
  });

  test('record a contact log and see it in timeline + last contacted column', async ({ page }) => {
    await page.goto('/finance-receivable');
    await page.waitForSelector('table');

    // Click first row to open drawer
    const firstRow = page.locator('tbody tr').first();
    await firstRow.click();

    // Drawer opens
    await expect(page.getByText('ประวัติการติดต่อ')).toBeVisible();

    // Open dialog
    await page.getByRole('button', { name: /บันทึกการติดต่อ/ }).click();

    // Pick result = ANSWERED
    await page.getByRole('button', { name: 'รับสาย' }).click();

    // Add note
    await page.getByPlaceholder('รายละเอียดการคุย…').fill('E2E test note');

    // Submit
    await page.getByRole('button', { name: 'บันทึก', exact: true }).click();

    // Toast appears
    await expect(page.getByText('บันทึกการติดต่อสำเร็จ')).toBeVisible();

    // Timeline shows new entry
    await expect(page.getByText('E2E test note')).toBeVisible();
  });

  test('broken-promise filter limits the list', async ({ page }) => {
    await page.goto('/finance-receivable');
    await page.waitForSelector('table');

    const initialCount = await page.locator('tbody tr').count();

    await page.getByLabel('มีนัดเลยกำหนด').check();
    await page.waitForLoadState('networkidle');

    const filteredCount = await page.locator('tbody tr').count();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
  });
});
```

- [ ] **Step 2: Run the E2E test**

```bash
cd apps/web && npx playwright test e2e/finance-receivable-contact.spec.ts
```

Expected: both tests PASS. If they fail due to no rows in dev data, seed at least one external-finance FinanceReceivable first.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/finance-receivable-contact.spec.ts
git commit -m "test(e2e): finance receivable contact log + broken-promise filter"
```

---

## Task 22: Full pre-deploy check

- [ ] **Step 1: Run full type + lint + test suite**

```bash
./tools/run-tests.sh
```

Expected: 0 type errors, 0 lint errors, all unit tests PASS, all E2E specs PASS.

- [ ] **Step 2: Run backfill on dev DB (production rehearsal)**

```bash
cd apps/api && npm run backfill:external-finance
```

Expected: report with non-negative counts, exit 0. Run twice to verify idempotency (second run should show 0 new + skip counts on contacts).

- [ ] **Step 3: Smoke test the UI**

```bash
npm run dev
```

Manually verify:
1. Log in as `finance@bestchoice.com`
2. Visit `/finance-receivable` — new columns visible
3. Click a row — drawer opens
4. Click "บันทึกการติดต่อ" — dialog opens, contacts dropdown populated, primary marked
5. Submit a PROMISED log with date in past — refresh → log shows in timeline; cron will mark it broken next 02:00 BKK (verify SQL manually or wait)
6. Visit `/external-finance-companies/<id>` — 4 tabs render, contacts tab supports add/edit/setPrimary

- [ ] **Step 4: Final commit if any fixes needed**

If the smoke test surfaces minor issues, fix + commit:
```bash
git add <files>
git commit -m "fix(finance-contact): <description>"
```

---

## Spec coverage check

- [x] Schema additions (§5.1-5.4) → Task 1
- [x] Partial unique index (§5.2) → Task 1 step 6
- [x] DTOs (§6.4) → Tasks 4 + 7
- [x] Contact CRUD + setPrimary (§6.1) → Tasks 5 + 6
- [x] Contact log CRUD (§6.2) → Tasks 8 + 9 + 10
- [x] Aggregation endpoints (§6.3) → Task 9 + 10
- [x] Service guarantees: lazy resolve, KPI denorm, primaryKept (§6.5) → Tasks 8 + 12
- [x] broken-promise-finance cron (§7.1) → Task 11
- [x] UI drawer/dialog/timeline (§8.1-8.2) → Tasks 17-18
- [x] ExternalFinanceCompanyDetailPage 4 tabs (§8.3) → Task 20
- [x] FinanceReceivablePage columns + row click + filter (§8.4) → Task 19
- [x] Roles enforcement (§9) → embedded in controllers Tasks 6 + 10
- [x] Migration 3 phases: schema, sale workflow, backfill (§10) → Tasks 1, 13, 15
- [x] Tests: unit/integration/E2E (§11) → embedded in each task + Task 21
- [x] Name normalizer + idempotent guard → Tasks 2 + 15

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-31-finance-receivable-contact-system.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for a 22-task plan to avoid context bloat and catch issues early.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Good if you want tighter control.

Which approach?
