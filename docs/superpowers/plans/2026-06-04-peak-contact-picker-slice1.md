# PEAK-style Contact Picker — Slice 1 (ช่องผู้ขาย) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้ช่องเลือกผู้ขาย (เริ่มที่ฟอร์มรายจ่าย) ค้นเจอผู้ติดต่อ **ทุก role** แบบ PEAK และพอเลือกผู้ติดต่อที่ยังไม่เป็นผู้ขาย ระบบสร้างแถว `Supplier` + เติม role ให้เงียบๆ

**Architecture:** ต่อยอด party master (`Contact`) ที่มีอยู่แล้ว — เพิ่ม endpoint `POST /contacts/:id/ensure-role` ที่ provision แถวลูก (`Supplier`) ภายใน `$transaction` ผ่าน `ContactResolverService` แล้ว audit; ฝั่ง web สร้างคอมโพเนนต์กลาง `ContactCombobox` (server-side search ทุก role + badge + เรียก ensure-role ตอนเลือก) แล้วเสียบแทนไส้ใน `VendorCombobox`

**Tech Stack:** NestJS + Prisma (apps/api, jest), React + Vite + @tanstack/react-query + shadcn/ui (apps/web, vitest + @testing-library)

**Spec:** [2026-06-04-peak-style-contact-picker-design.md](../specs/2026-06-04-peak-style-contact-picker-design.md)

---

## File Structure

**Backend (apps/api)**
- Create `src/modules/contacts/dto/ensure-role.dto.ts` — validate body `{ role }`
- Modify `src/modules/contacts/contact-resolver.service.ts` — add `ensureRole(tx, contactId, role)` (core provisioning)
- Modify `src/modules/contacts/contacts.service.ts` — add `ensureRole(id, role, actor)` (transaction + audit), inject resolver
- Modify `src/modules/contacts/contacts.controller.ts` — add `POST :id/ensure-role`
- Create `src/modules/contacts/__tests__/contact-resolver.ensure-role.spec.ts`
- Create `src/modules/contacts/__tests__/contacts.service.ensure-role.spec.ts`
- Create `src/modules/contacts/__tests__/contacts.controller.ensure-role.spec.ts`

**Frontend (apps/web)**
- Modify `src/lib/api/contacts.ts` — add `contactsApi.ensureRole` + `EnsureRoleResult` type
- Create `src/components/contacts/ContactCombobox.tsx` — reusable picker (server search, badges, ensure-role on pick, optional one-off typed name)
- Create `src/components/contacts/ContactCombobox.test.tsx`
- Modify `src/components/expense-form-v4/VendorCombobox.tsx` — become a thin wrapper over `ContactCombobox`

---

## Task 1: `ContactResolverService.ensureRole` — provisioning core

**Files:**
- Modify: `apps/api/src/modules/contacts/contact-resolver.service.ts`
- Test: `apps/api/src/modules/contacts/__tests__/contact-resolver.ensure-role.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/contacts/__tests__/contact-resolver.ensure-role.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContactResolverService } from '../contact-resolver.service';

describe('ContactResolverService.ensureRole', () => {
  let svc: ContactResolverService;
  let tx: {
    contact: { findFirst: jest.Mock; update: jest.Mock };
    supplier: { findFirst: jest.Mock; create: jest.Mock };
  };

  beforeEach(async () => {
    tx = {
      contact: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      supplier: { findFirst: jest.fn(), create: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        ContactResolverService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();
    svc = mod.get(ContactResolverService);
  });

  it('returns the existing supplier id without creating (idempotent)', async () => {
    tx.contact.findFirst.mockResolvedValue({
      id: 'c1', name: 'ABC', phone: '0812345678', roles: ['SUPPLIER'],
    });
    tx.supplier.findFirst.mockResolvedValue({ id: 'sup1' });

    const result = await svc.ensureRole(tx as any, 'c1', 'SUPPLIER');

    expect(result).toEqual({
      contactId: 'c1', role: 'SUPPLIER', supplierId: 'sup1', provisioned: false,
    });
    expect(tx.supplier.create).not.toHaveBeenCalled();
    expect(tx.contact.update).not.toHaveBeenCalled();
  });

  it('creates a Supplier with blank-phone fallback and adds the role', async () => {
    tx.contact.findFirst.mockResolvedValue({
      id: 'c2', name: 'NoPhone Co', phone: null, roles: ['CUSTOMER'],
    });
    tx.supplier.findFirst.mockResolvedValue(null);
    tx.supplier.create.mockResolvedValue({ id: 'sup2' });

    const result = await svc.ensureRole(tx as any, 'c2', 'SUPPLIER');

    expect(tx.supplier.create).toHaveBeenCalledWith({
      data: { name: 'NoPhone Co', phone: '', contactId: 'c2' },
      select: { id: true },
    });
    expect(tx.contact.update).toHaveBeenCalledWith({
      where: { id: 'c2' },
      data: { roles: { set: ['CUSTOMER', 'SUPPLIER'] } },
    });
    expect(result).toEqual({
      contactId: 'c2', role: 'SUPPLIER', supplierId: 'sup2', provisioned: true,
    });
  });

  it('adds the role when a supplier row already exists but role is missing', async () => {
    tx.contact.findFirst.mockResolvedValue({
      id: 'c3', name: 'ABC', phone: '02', roles: ['CUSTOMER'],
    });
    tx.supplier.findFirst.mockResolvedValue({ id: 'sup3' });

    const result = await svc.ensureRole(tx as any, 'c3', 'SUPPLIER');

    expect(tx.supplier.create).not.toHaveBeenCalled();
    expect(tx.contact.update).toHaveBeenCalledWith({
      where: { id: 'c3' },
      data: { roles: { set: ['CUSTOMER', 'SUPPLIER'] } },
    });
    expect(result.provisioned).toBe(true);
    expect(result.supplierId).toBe('sup3');
  });

  it('throws NotFound when the contact does not exist', async () => {
    tx.contact.findFirst.mockResolvedValue(null);
    await expect(svc.ensureRole(tx as any, 'missing', 'SUPPLIER')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects CUSTOMER provisioning in this phase', async () => {
    await expect(svc.ensureRole(tx as any, 'c1', 'CUSTOMER' as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx jest --runInBand src/modules/contacts/__tests__/contact-resolver.ensure-role.spec.ts`
Expected: FAIL — `svc.ensureRole is not a function`

- [ ] **Step 3: Implement `ensureRole`**

In `apps/api/src/modules/contacts/contact-resolver.service.ts`, change the imports on line 1 and add the method + result type.

Replace line 1:
```typescript
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
```

Add this interface just below the existing `ResolveContactInput` interface (after line 14):
```typescript
export interface EnsureRoleResult {
  contactId: string;
  role: ContactRole;
  supplierId?: string;
  customerId?: string;
  /** true when a child row was created and/or the role was newly added */
  provisioned: boolean;
}
```

Add this method inside the `ContactResolverService` class (e.g. after `findOrCreateByNaturalKey`, before `hashLockKey`):
```typescript
  /**
   * Ensure a contact can be used in a `role` context: provision the child row
   * (Supplier) if missing and append the role. Idempotent. SUPPLIER only in this
   * phase — CUSTOMER auto-provisioning is deferred (PII/encryption on Customer).
   */
  async ensureRole(
    tx: Tx,
    contactId: string,
    role: ContactRole,
  ): Promise<EnsureRoleResult> {
    if (role !== 'SUPPLIER') {
      throw new BadRequestException('ยังไม่รองรับการสร้างบทบาทนี้อัตโนมัติในเฟสนี้');
    }

    const contact = await tx.contact.findFirst({
      where: { id: contactId, deletedAt: null },
    });
    if (!contact) throw new NotFoundException('ไม่พบผู้ติดต่อ');

    let provisioned = false;

    const existing = await tx.supplier.findFirst({
      where: { contactId, deletedAt: null },
      select: { id: true },
    });
    let supplierId: string;
    if (existing) {
      supplierId = existing.id;
    } else {
      const created = await tx.supplier.create({
        data: { name: contact.name, phone: contact.phone ?? '', contactId },
        select: { id: true },
      });
      supplierId = created.id;
      provisioned = true;
    }

    if (!contact.roles.includes(role)) {
      await tx.contact.update({
        where: { id: contactId },
        data: { roles: { set: [...contact.roles, role] } },
      });
      provisioned = true;
    }

    return { contactId, role, supplierId, provisioned };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && npx jest --runInBand src/modules/contacts/__tests__/contact-resolver.ensure-role.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/contacts/contact-resolver.service.ts apps/api/src/modules/contacts/__tests__/contact-resolver.ensure-role.spec.ts
git commit -m "feat(contacts): ContactResolverService.ensureRole provisions Supplier + role (SUPPLIER)"
```

---

## Task 2: `EnsureRoleDto`

**Files:**
- Create: `apps/api/src/modules/contacts/dto/ensure-role.dto.ts`

- [ ] **Step 1: Create the DTO**

```typescript
import { IsIn } from 'class-validator';

// Accepts SUPPLIER | CUSTOMER for forward-compat; the service implements
// SUPPLIER provisioning in this phase and rejects CUSTOMER.
export class EnsureRoleDto {
  @IsIn(['SUPPLIER', 'CUSTOMER'], { message: 'role ต้องเป็น SUPPLIER หรือ CUSTOMER' })
  role!: 'SUPPLIER' | 'CUSTOMER';
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: no new errors referencing `ensure-role.dto.ts`

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/contacts/dto/ensure-role.dto.ts
git commit -m "feat(contacts): add EnsureRoleDto"
```

---

## Task 3: `ContactsService.ensureRole` — transaction + audit

**Files:**
- Modify: `apps/api/src/modules/contacts/contacts.service.ts`
- Test: `apps/api/src/modules/contacts/__tests__/contacts.service.ensure-role.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/contacts/__tests__/contacts.service.ensure-role.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ContactResolverService } from '../contact-resolver.service';
import { ContactsService } from '../contacts.service';

describe('ContactsService.ensureRole', () => {
  let svc: ContactsService;
  let resolver: { ensureRole: jest.Mock };
  let audit: { log: jest.Mock };
  let prisma: { $transaction: jest.Mock };

  beforeEach(async () => {
    resolver = { ensureRole: jest.fn() };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    // run the callback with a dummy tx
    prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})) };

    const mod = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: ContactResolverService, useValue: resolver },
      ],
    }).compile();
    svc = mod.get(ContactsService);
  });

  it('audits CONTACT_ROLE_ADDED when a role was provisioned', async () => {
    resolver.ensureRole.mockResolvedValue({
      contactId: 'c1', role: 'SUPPLIER', supplierId: 'sup1', provisioned: true,
    });

    const result = await svc.ensureRole('c1', 'SUPPLIER', { userId: 'u1', ipAddress: '127.0.0.1' });

    expect(resolver.ensureRole).toHaveBeenCalledWith({}, 'c1', 'SUPPLIER');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        action: 'CONTACT_ROLE_ADDED',
        entity: 'contact',
        entityId: 'c1',
        newValue: { role: 'SUPPLIER', supplierId: 'sup1', customerId: undefined },
        ipAddress: '127.0.0.1',
      }),
    );
    expect(result.supplierId).toBe('sup1');
  });

  it('does NOT audit when nothing was provisioned (idempotent hit)', async () => {
    resolver.ensureRole.mockResolvedValue({
      contactId: 'c1', role: 'SUPPLIER', supplierId: 'sup1', provisioned: false,
    });

    await svc.ensureRole('c1', 'SUPPLIER', { userId: 'u1' });

    expect(audit.log).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx jest --runInBand src/modules/contacts/__tests__/contacts.service.ensure-role.spec.ts`
Expected: FAIL — `svc.ensureRole is not a function` (or DI error before the method exists)

- [ ] **Step 3: Implement the method + inject the resolver**

In `apps/api/src/modules/contacts/contacts.service.ts`:

Add the import near the other relative imports at the top:
```typescript
import { ContactResolverService } from './contact-resolver.service';
```

Add `contactResolver` to the constructor (keep the existing `prisma` and `audit` params):
```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly contactResolver: ContactResolverService,
  ) {}
```

Add this method to the class (e.g. just before the closing brace, after `merge`):
```typescript
  async ensureRole(
    id: string,
    role: 'SUPPLIER' | 'CUSTOMER',
    actor: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const result = await this.prisma.$transaction((tx) =>
      this.contactResolver.ensureRole(tx, id, role),
    );

    if (result.provisioned) {
      await this.audit.log({
        userId: actor.userId,
        action: 'CONTACT_ROLE_ADDED',
        entity: 'contact',
        entityId: id,
        newValue: {
          role: result.role,
          supplierId: result.supplierId,
          customerId: result.customerId,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    }

    return result;
  }
```

> Note: `ContactResolverService` is already registered in `contacts.module.ts` providers, so DI resolves without module changes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && npx jest --runInBand src/modules/contacts/__tests__/contacts.service.ensure-role.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/contacts/contacts.service.ts apps/api/src/modules/contacts/__tests__/contacts.service.ensure-role.spec.ts
git commit -m "feat(contacts): ContactsService.ensureRole wraps provisioning in tx + audits CONTACT_ROLE_ADDED"
```

---

## Task 4: Controller endpoint `POST /contacts/:id/ensure-role`

**Files:**
- Modify: `apps/api/src/modules/contacts/contacts.controller.ts`
- Test: `apps/api/src/modules/contacts/__tests__/contacts.controller.ensure-role.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/contacts/__tests__/contacts.controller.ensure-role.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ContactsController } from '../contacts.controller';
import { ContactsService } from '../contacts.service';

describe('ContactsController.ensureRole', () => {
  let controller: ContactsController;
  let service: { ensureRole: jest.Mock };

  beforeEach(async () => {
    service = { ensureRole: jest.fn().mockResolvedValue({ supplierId: 'sup1', provisioned: true }) };
    const mod = await Test.createTestingModule({
      controllers: [ContactsController],
      providers: [{ provide: ContactsService, useValue: service }],
    }).compile();
    controller = mod.get(ContactsController);
  });

  it('passes id, role and actor to the service', async () => {
    const req = {
      user: { id: 'u1', role: 'OWNER' },
      ip: '10.0.0.1',
      headers: { 'user-agent': 'jest' },
    } as any;

    const result = await controller.ensureRole('c1', { role: 'SUPPLIER' }, req);

    expect(service.ensureRole).toHaveBeenCalledWith('c1', 'SUPPLIER', {
      userId: 'u1',
      ipAddress: '10.0.0.1',
      userAgent: 'jest',
    });
    expect(result).toEqual({ supplierId: 'sup1', provisioned: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx jest --runInBand src/modules/contacts/__tests__/contacts.controller.ensure-role.spec.ts`
Expected: FAIL — `controller.ensureRole is not a function`

- [ ] **Step 3: Add the endpoint**

In `apps/api/src/modules/contacts/contacts.controller.ts`:

Add the DTO import below the existing imports:
```typescript
import { EnsureRoleDto } from './dto/ensure-role.dto';
```

Add this method inside the `ContactsController` class (after `merge`):
```typescript
  @Post(':id/ensure-role')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES')
  ensureRole(@Param('id') id: string, @Body() dto: EnsureRoleDto, @Req() req: AuthRequest) {
    return this.contacts.ensureRole(id, dto.role, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && npx jest --runInBand src/modules/contacts/__tests__/contacts.controller.ensure-role.spec.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Run the whole contacts suite + typecheck**

Run: `cd apps/api && npx jest --runInBand src/modules/contacts && npx tsc --noEmit -p tsconfig.json`
Expected: all contacts specs PASS, 0 type errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/contacts/contacts.controller.ts apps/api/src/modules/contacts/__tests__/contacts.controller.ensure-role.spec.ts
git commit -m "feat(contacts): POST /contacts/:id/ensure-role endpoint"
```

---

## Task 5: Web API client `contactsApi.ensureRole`

**Files:**
- Modify: `apps/web/src/lib/api/contacts.ts`

- [ ] **Step 1: Add the type + method**

In `apps/web/src/lib/api/contacts.ts`, add this exported interface near the other interfaces (e.g. after `ContactListResult`):
```typescript
export interface EnsureRoleResult {
  contactId: string;
  role: ContactRole;
  supplierId?: string;
  customerId?: string;
  provisioned: boolean;
}
```

Add this method to the `contactsApi` object (after `merge`):
```typescript
  ensureRole: (id: string, role: 'SUPPLIER' | 'CUSTOMER') =>
    api.post<EnsureRoleResult>(`/contacts/${id}/ensure-role`, { role }).then((r) => r.data),
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: no new errors in `contacts.ts`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api/contacts.ts
git commit -m "feat(web): contactsApi.ensureRole client"
```

---

## Task 6: `ContactCombobox` component

**Files:**
- Create: `apps/web/src/components/contacts/ContactCombobox.tsx`
- Test: `apps/web/src/components/contacts/ContactCombobox.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/contacts/ContactCombobox.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContactCombobox } from './ContactCombobox';

const listMock = vi.fn();
const ensureRoleMock = vi.fn();
vi.mock('@/lib/api/contacts', () => ({
  contactsApi: {
    list: (...a: unknown[]) => listMock(...a),
    ensureRole: (...a: unknown[]) => ensureRoleMock(...a),
  },
}));

function renderCombo(onSelect = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ContactCombobox roleNeeded="SUPPLIER" value="" onSelect={onSelect} />
    </QueryClientProvider>,
  );
  return onSelect;
}

beforeEach(() => {
  listMock.mockReset();
  ensureRoleMock.mockReset();
});

describe('ContactCombobox', () => {
  it('searches all contacts (no role filter) and provisions the role on pick', async () => {
    listMock.mockResolvedValue({
      data: [{ id: 'c1', name: 'ABC Co', taxId: '0105500000001', roles: ['CUSTOMER'] }],
      total: 1, page: 1, limit: 20,
    });
    ensureRoleMock.mockResolvedValue({
      contactId: 'c1', role: 'SUPPLIER', supplierId: 'sup1', provisioned: true,
    });
    const onSelect = renderCombo();

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.type(screen.getByPlaceholderText(/ค้นหา/), 'ABC');

    const item = await screen.findByText('ABC Co');
    await userEvent.click(item);

    // list was called WITHOUT a role filter
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(listMock.mock.calls.some(([arg]) => (arg as { role?: string }).role === undefined)).toBe(
      true,
    );
    await waitFor(() => expect(ensureRoleMock).toHaveBeenCalledWith('c1', 'SUPPLIER'));
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({
        contactId: 'c1',
        childId: 'sup1',
        name: 'ABC Co',
        taxId: '0105500000001',
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/components/contacts/ContactCombobox.test.tsx`
Expected: FAIL — cannot resolve `./ContactCombobox`

- [ ] **Step 3: Implement the component**

Create `apps/web/src/components/contacts/ContactCombobox.tsx`:

```tsx
// Reusable PEAK-style contact picker. Searches the party master (สมุดผู้ติดต่อ)
// across ALL roles (server-side, debounced). On pick it calls ensure-role so the
// chosen contact is provisioned into the field's role (e.g. a customer-only
// contact becomes a Supplier) and returns the child id to the parent.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import { contactsApi, type Contact, type ContactRole } from '@/lib/api/contacts';

const ROLE_LABELS: Record<ContactRole, string> = {
  CUSTOMER: 'ลูกค้า',
  SUPPLIER: 'ผู้ขาย',
  TRADE_IN_SELLER: 'คนขายมือสอง',
  FINANCE_COMPANY: 'ไฟแนนซ์',
};

export interface ContactPickResult {
  contactId: string;
  childId: string;
  name: string;
  taxId: string;
}

interface Props {
  roleNeeded: 'SUPPLIER' | 'CUSTOMER';
  value: string;
  onSelect: (result: ContactPickResult) => void;
  /** When provided, a typed name with no exact match can be committed as a one-off. */
  onTypeName?: (name: string) => void;
  invalid?: boolean;
  placeholder?: string;
}

export function ContactCombobox({
  roleNeeded,
  value,
  onSelect,
  onTypeName,
  invalid,
  placeholder = 'เลือกผู้ติดต่อ หรือพิมพ์ชื่อ',
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(false);
  const debounced = useDebounce(search);

  const query = useQuery({
    queryKey: ['contact-combobox', debounced],
    queryFn: () => contactsApi.list({ search: debounced || undefined, isActive: true, limit: 20 }),
    staleTime: 60 * 1000,
  });
  const contacts = query.data?.data ?? [];

  const hasExactMatch =
    !!search.trim() && contacts.some((c) => c.name.toLowerCase() === search.trim().toLowerCase());

  const commitTyped = (name: string) => {
    const n = name.trim();
    if (!n || !onTypeName) return;
    onTypeName(n);
    setOpen(false);
    setSearch('');
  };

  const handleSelect = async (c: Contact) => {
    setPending(true);
    try {
      const res = await contactsApi.ensureRole(c.id, roleNeeded);
      const childId = res.supplierId ?? res.customerId ?? '';
      onSelect({ contactId: c.id, childId, name: c.name, taxId: c.taxId ?? '' });
      setOpen(false);
      setSearch('');
    } finally {
      setPending(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground')}
        >
          <span className="truncate leading-snug" title={value || undefined}>
            {value || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="ค้นหาผู้ติดต่อ / เลขภาษี..."
            value={search}
            onValueChange={setSearch}
            onKeyDown={(e) => {
              if (onTypeName && e.key === 'Enter' && search.trim() && !hasExactMatch) {
                e.preventDefault();
                e.stopPropagation();
                commitTyped(search);
              }
            }}
          />
          <CommandList>
            {query.isLoading || pending ? (
              <CommandEmpty>{pending ? 'กำลังเพิ่ม...' : 'กำลังโหลด...'}</CommandEmpty>
            ) : (
              <>
                {contacts.length > 0 && (
                  <CommandGroup heading="สมุดผู้ติดต่อ">
                    {contacts.map((c) => (
                      <CommandItem key={c.id} value={c.id} onSelect={() => void handleSelect(c)}>
                        <Check
                          className={cn(
                            'mr-2 size-4 shrink-0',
                            value === c.name ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <span className="flex-1 truncate leading-snug">{c.name}</span>
                        <span className="ml-2 flex shrink-0 gap-1">
                          {c.roles.map((r) => (
                            <Badge key={r} variant="secondary" className="text-2xs">
                              {ROLE_LABELS[r]}
                            </Badge>
                          ))}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {contacts.length === 0 && !search.trim() && (
                  <CommandEmpty className="px-3 py-6 text-center leading-snug">
                    พิมพ์เพื่อค้นหาผู้ติดต่อ
                  </CommandEmpty>
                )}
                {onTypeName && search.trim() && !hasExactMatch && (
                  <CommandGroup heading="ใช้ครั้งเดียว (ไม่บันทึกในสมุด)">
                    <CommandItem value={`__typed__${search}`} onSelect={() => commitTyped(search)}>
                      <Plus className="mr-2 size-4 shrink-0" />
                      <span className="truncate leading-snug">ใช้ชื่อ “{search.trim()}”</span>
                    </CommandItem>
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/components/contacts/ContactCombobox.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/contacts/ContactCombobox.tsx apps/web/src/components/contacts/ContactCombobox.test.tsx
git commit -m "feat(web): ContactCombobox — PEAK-style all-role picker with ensure-role provisioning"
```

---

## Task 7: Wire `ContactCombobox` into `VendorCombobox`

**Files:**
- Modify: `apps/web/src/components/expense-form-v4/VendorCombobox.tsx`

- [ ] **Step 1: Replace the body with a thin wrapper**

Replace the ENTIRE contents of `apps/web/src/components/expense-form-v4/VendorCombobox.tsx` with:

```tsx
// Expense form V4 — vendor picker.
// Thin wrapper over the shared ContactCombobox (searches the contact book across
// ALL roles; picking a contact provisions the SUPPLIER role via ensure-role). A
// typed name that matches no contact is still committed as a one-off vendor,
// preserving the legacy free-text flow. The expense stores vendorName/vendorTaxId
// as before — no FK — so this slice only adds the party-master link side effect.
import { contactsApi } from '@/lib/api/contacts';
import { ContactCombobox, type ContactPickResult } from '@/components/contacts/ContactCombobox';

interface Props {
  value: string;
  onSelectSupplier: (s: { name: string; taxId: string; whtFormType?: 'PND3' | 'PND53' }) => void;
  onTypeName: (name: string) => void;
  invalid?: boolean;
}

export function VendorCombobox({ value, onSelectSupplier, onTypeName, invalid }: Props) {
  // On pick: ensure-role already ran inside ContactCombobox (a Supplier row now
  // exists). Read the supplier link's type to map JURISTIC→PND53 / INDIVIDUAL→PND3
  // so "ประเภทผู้ขาย" auto-fills; fall back to the list values if detail fails.
  const handleSelect = async ({ contactId, name, taxId }: ContactPickResult) => {
    let whtFormType: 'PND3' | 'PND53' | undefined;
    let resolvedTaxId = taxId;
    try {
      const detail = await contactsApi.detail(contactId);
      const link = detail.suppliers?.[0];
      if (link) {
        whtFormType = link.type === 'JURISTIC' ? 'PND53' : 'PND3';
        if (link.taxId) resolvedTaxId = link.taxId;
      }
    } catch {
      // keep the list values when the detail lookup fails
    }
    onSelectSupplier({ name, taxId: resolvedTaxId, whtFormType });
  };

  return (
    <ContactCombobox
      roleNeeded="SUPPLIER"
      value={value}
      invalid={invalid}
      placeholder="เลือกผู้ขาย หรือพิมพ์ชื่อ"
      onSelect={handleSelect}
      onTypeName={onTypeName}
    />
  );
}
```

- [ ] **Step 2: Verify the expense form still typechecks**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: 0 errors (the `Props` interface is unchanged, so callers of `VendorCombobox` are unaffected)

- [ ] **Step 3: Run the web test suite for the touched areas**

Run: `cd apps/web && npx vitest run src/components/contacts src/components/expense-form-v4`
Expected: PASS (ContactCombobox test passes; no regressions in expense-form-v4 tests)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/expense-form-v4/VendorCombobox.tsx
git commit -m "feat(web): VendorCombobox uses ContactCombobox (all-role search + supplier provisioning)"
```

---

## Task 8: Full verification

- [ ] **Step 1: Typecheck the whole monorepo**

Run: `./tools/check-types.sh all`
Expected: 0 TypeScript errors

- [ ] **Step 2: Run the full contacts API suite**

Run: `cd apps/api && npx jest --runInBand src/modules/contacts`
Expected: all PASS (existing specs + the 3 new ensure-role specs)

- [ ] **Step 3: Run the web component tests**

Run: `cd apps/web && npx vitest run src/components/contacts`
Expected: PASS

- [ ] **Step 4: Manual smoke (requires `npm run dev`)**

1. Log in as `admin@bestchoice.com / admin1234`
2. Open a contact that is **customer-only** in `/contacts` (note its name; `roles` shows ลูกค้า only)
3. Go to the expense form (รายจ่าย), open the "ผู้ขาย" picker
4. Search that contact's name → it now appears (with a ลูกค้า badge) and is selectable
5. Pick it → the name autofills; re-open `/contacts` detail → it now also has a ผู้ขาย role
6. Confirm an audit row `CONTACT_ROLE_ADDED` exists in `/audit-logs`

- [ ] **Step 5: Final commit (if any doc/notes updated)**

```bash
git add -A
git commit -m "chore(contacts): slice 1 verification notes" --allow-empty
```

---

## Out of scope for this slice (see spec §5 Rollout)

- Migrating the PurchaseOrder supplier `<select>`, RepairCenterCombobox, CustomerSelectStep, CustomerPickerStep, CounterpartyPicker
- `CUSTOMER` auto-provisioning (endpoint currently rejects it)
- "ข้อมูลไม่ครบ" badge on auto-provisioned rows with blank phone (spec §3 — follow-up)
- Storing a vendor FK (`expenseSupplierId`) on ExpenseDocument
