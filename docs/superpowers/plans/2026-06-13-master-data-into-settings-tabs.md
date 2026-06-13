# Move "ข้อมูลหลัก" into /settings Tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ย้ายการเข้าถึง สมุดผู้ติดต่อ (`/contacts`) และ พนักงาน (`/employees`) ให้ไปอยู่เป็นแท็บใน /settings โดย gate การมองเห็นตาม role และไม่ตัดสิทธิ์ฝ่ายการเงิน/บัญชี

**Architecture:** แตก "เนื้อหา" ของสองหน้าออกเป็น component ใช้ร่วม (`ContactsTab`, `EmployeesTab`) — หน้า standalone เดิมเหลือ wrapper บางๆ; SettingsPage เปลี่ยนเป็น tab registry แบบ role-aware (เปิดให้ OWNER/FM/ACC, gate รายแท็บ); เมนู sidebar ชี้ `/settings#contacts|#employees`; ปรับ active-matcher ของ sidebar ให้รองรับ hash

**Tech Stack:** React 18 + TypeScript + Vite + Radix Tabs + react-router + @tanstack/react-query + vitest/@testing-library

**Spec:** `docs/superpowers/specs/2026-06-13-master-data-into-settings-tabs-design.md`

**สมมุติฐาน git:** ทำงานบน feature branch (เช่น `feat/master-data-into-settings`). รัน command ทั้งหมดจาก `apps/web` เว้นแต่ระบุอื่น

---

## File Structure

| ไฟล์ | รับผิดชอบ |
|---|---|
| `apps/web/src/pages/SettingsPage/tabs/ContactsTab.tsx` | **ใหม่** — เนื้อหาสมุดผู้ติดต่อ (header inline + filter + table + create modal), ไม่มี PageHeader/useDocumentTitle |
| `apps/web/src/pages/SettingsPage/tabs/EmployeesTab.tsx` | **ใหม่** — เนื้อหาพนักงาน, ไม่มี useDocumentTitle |
| `apps/web/src/pages/ContactsPage.tsx` | wrapper: useDocumentTitle + `<ContactsTab/>` |
| `apps/web/src/pages/EmployeesPage.tsx` | wrapper: useDocumentTitle + `<EmployeesTab/>` |
| `apps/web/src/pages/SettingsPage/index.tsx` | tab registry role-aware + guard 3 role + เพิ่ม 2 แท็บ |
| `apps/web/src/pages/SettingsPage/__tests__/SettingsPage.test.tsx` | **ใหม่** — ทดสอบการมองเห็นแท็บต่อ role + redirect + hash fallback |
| `apps/web/src/config/menu.ts` | 3 กลุ่ม "ข้อมูลหลัก" → path `/settings#contacts|#employees` |
| `apps/web/src/components/layout/Sidebar.tsx` | active-matcher 3 จุด รองรับ path ที่มี hash |

---

## Task 1: แตก ContactsTab ออกจาก ContactsPage

**Files:**
- Create: `apps/web/src/pages/SettingsPage/tabs/ContactsTab.tsx`
- Modify: `apps/web/src/pages/ContactsPage.tsx` (เขียนใหม่ทั้งไฟล์)
- Test (regression): `apps/web/src/pages/__tests__/ContactsPage.test.tsx` (มีอยู่แล้ว)

- [ ] **Step 1: สร้าง `ContactsTab.tsx`** — คัดลอกเนื้อหา ContactsPage เดิม ตัด `useDocumentTitle`/`PageHeader` ออก แล้วแทนหัวข้อด้วย header inline:

```tsx
import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/useDebounce';
import { Plus, ChevronDown, Search } from 'lucide-react';
import DataTable, { type Column } from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { contactKeys, contactsApi, type Contact, type ContactRole } from '@/lib/api/contacts';
import CreateContactModal from '@/components/contacts/CreateContactModal';

const ROLE_LABELS: Record<ContactRole, string> = {
  CUSTOMER: 'ลูกค้า',
  SUPPLIER: 'ผู้จัดจำหน่าย',
  TRADE_IN_SELLER: 'คนขายมือสอง',
  FINANCE_COMPANY: 'ไฟแนนซ์',
};

const ROLE_BADGE_VARIANT: Record<ContactRole, 'primary' | 'info' | 'warning' | 'secondary'> = {
  CUSTOMER: 'primary',
  SUPPLIER: 'info',
  TRADE_IN_SELLER: 'warning',
  FINANCE_COMPANY: 'secondary',
};

type GroupFilter = 'ALL' | ContactRole;

const GROUP_FILTERS: { value: GroupFilter; label: string }[] = [
  { value: 'ALL', label: 'ทั้งหมด' },
  { value: 'CUSTOMER', label: 'ลูกค้า' },
  { value: 'SUPPLIER', label: 'ผู้จัดจำหน่าย' },
  { value: 'TRADE_IN_SELLER', label: 'คนขายมือสอง' },
  { value: 'FINANCE_COMPANY', label: 'ไฟแนนซ์' },
];

export function ContactsTab() {
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [role, setRole] = useState<GroupFilter>('ALL');
  const [page, setPage] = useState(1);
  const [createRole, setCreateRole] = useState<'CUSTOMER' | 'SUPPLIER' | null>(null);
  const debouncedSearch = useDebounce(search);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, role]);

  const { data: result, isLoading, isError, error, refetch } = useQuery({
    queryKey: contactKeys.list({ search: debouncedSearch, role, page }),
    queryFn: () => contactsApi.list({ search: debouncedSearch, role, page, limit: 50 }),
  });

  const contacts = result?.data ?? [];
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.limit)) : 1;

  const columns = useMemo<Column<Contact>[]>(
    () => [
      {
        key: 'contactCode',
        label: 'เลขที่',
        render: (c) => (
          <span className="font-mono text-xs text-muted-foreground">{c.contactCode}</span>
        ),
      },
      {
        key: 'name',
        label: 'ชื่อ',
        render: (c) => (
          <span className="text-sm font-semibold text-foreground leading-snug">{c.name}</span>
        ),
      },
      {
        key: 'roles',
        label: 'กลุ่ม',
        render: (c) => (
          <div className="flex flex-wrap gap-1">
            {c.roles.map((r) => (
              <Badge key={r} variant={ROLE_BADGE_VARIANT[r]} appearance="light" size="sm">
                {ROLE_LABELS[r]}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        key: 'phone',
        label: 'เบอร์โทร',
        hideable: true,
        render: (c) => (
          <span className="text-sm text-foreground tabular-nums">{c.phone || '—'}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div>
      {/* header inline (แทน PageHeader) — แสดงทั้งใน standalone และในแท็บ settings */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-foreground leading-snug">สมุดผู้ติดต่อ</h1>
          <p className="text-sm text-muted-foreground leading-snug">ทั้งหมด {result?.total ?? 0} ราย</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
              <Plus className="size-4" />
              เพิ่มผู้ติดต่อ
              <ChevronDown className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => setCreateRole('CUSTOMER')}>เพิ่มลูกค้า</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCreateRole('SUPPLIER')}>เพิ่มผู้จัดจำหน่าย</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/trade-in')}>รับซื้อมือสอง</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="bg-card rounded-xl border border-border/50 p-4 mb-5 shadow-sm">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {GROUP_FILTERS.map((g) => (
            <button
              key={g.value}
              onClick={() => setRole(g.value)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors leading-snug ${
                role === g.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-input text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="ค้นหาชื่อ, เลขที่, เบอร์โทร..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-input rounded-lg text-sm outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-ring transition-colors bg-background"
          />
        </div>
      </div>

      <QueryBoundary
        isLoading={isLoading && !result}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดสมุดผู้ติดต่อได้"
      >
        <DataTable
          columns={columns}
          data={contacts}
          isLoading={isLoading}
          emptyMessage="ไม่พบผู้ติดต่อ"
          onRowClick={(c) => navigate(`/contacts/${c.id}`)}
          pagination={
            result
              ? { page: result.page, totalPages, total: result.total, onPageChange: setPage }
              : undefined
          }
        />
      </QueryBoundary>

      {createRole && (
        <CreateContactModal
          open
          onOpenChange={(open) => {
            if (!open) setCreateRole(null);
          }}
          role={createRole}
          onCreated={(r) => navigate(`/contacts/${r.contactId}`)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: เขียน `ContactsPage.tsx` ใหม่เป็น wrapper บางๆ**

```tsx
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ContactsTab } from '@/pages/SettingsPage/tabs/ContactsTab';

export default function ContactsPage() {
  useDocumentTitle('สมุดผู้ติดต่อ');
  return <ContactsTab />;
}
```

- [ ] **Step 3: รัน regression test เดิม + tsc**

Run: `npx vitest run src/pages/__tests__/ContactsPage.test.tsx && npx tsc --noEmit`
Expected: PASS, tsc exit 0 (ContactsPage standalone ยังทำงานผ่าน ContactsTab)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/SettingsPage/tabs/ContactsTab.tsx apps/web/src/pages/ContactsPage.tsx
git commit -m "refactor(web): extract ContactsTab body, ContactsPage becomes wrapper"
```

---

## Task 2: แตก EmployeesTab ออกจาก EmployeesPage

**Files:**
- Create: `apps/web/src/pages/SettingsPage/tabs/EmployeesTab.tsx`
- Modify: `apps/web/src/pages/EmployeesPage.tsx` (เขียนใหม่ทั้งไฟล์)

- [ ] **Step 1: สร้าง `EmployeesTab.tsx`** — ย้ายเนื้อหา EmployeesPage เดิม ตัด `useDocumentTitle` (header h1 อยู่ใน body เดิมอยู่แล้ว):

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, Users } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import QueryBoundary from '@/components/QueryBoundary';
import DataTable, { type Column } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { employeeKeys, employeesApi, type Employee } from '@/lib/api/employees';
import ProvisionEmployeeDialog from '@/components/employees/ProvisionEmployeeDialog';
import EditEmployeeDialog from '@/components/employees/EditEmployeeDialog';

const EMPLOYMENT_LABELS: Record<string, string> = {
  MONTHLY: 'รายเดือน',
  DAILY: 'รายวัน',
  CONTRACT: 'สัญญาจ้าง',
};

export function EmployeesTab() {
  const { user } = useAuth();
  const canManage = ['OWNER', 'ACCOUNTANT'].includes(user?.role ?? '');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);
  const [page, setPage] = useState(1);
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: employeeKeys.list({ search: debounced || undefined, page }),
    queryFn: () => employeesApi.list({ search: debounced || undefined, page }),
  });

  const columns: Column<Employee>[] = [
    { key: 'employeeId', label: 'รหัส', render: (e) => e.user.employeeId || '—' },
    {
      key: 'name',
      label: 'ชื่อ',
      render: (e) => (
        <div className="leading-snug">
          <div className="text-foreground">{e.user.name}</div>
          {e.user.nickname && <div className="text-xs text-muted-foreground">{e.user.nickname}</div>}
        </div>
      ),
    },
    { key: 'position', label: 'ตำแหน่ง', render: (e) => e.position || '—' },
    {
      key: 'employmentType',
      label: 'ประเภทจ้าง',
      render: (e) => EMPLOYMENT_LABELS[e.employmentType] ?? e.employmentType,
    },
    { key: 'nationalId', label: 'เลขบัตร', render: (e) => e.user.nationalId || '—' },
    {
      key: 'status',
      label: 'สถานะ',
      render: (e) =>
        e.resignedDate ? (
          <Badge variant="secondary" appearance="light" size="sm">ลาออก</Badge>
        ) : (
          <Badge variant="primary" appearance="light" size="sm">ทำงาน</Badge>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground leading-snug flex items-center gap-2">
          <Users className="size-5" /> พนักงาน
        </h1>
        {canManage && (
          <Button onClick={() => setProvisionOpen(true)}>
            <UserPlus className="size-4" /> เพิ่มพนักงาน
          </Button>
        )}
      </div>

      <Input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        placeholder="ค้นหาด้วยชื่อ / ชื่อเล่น / รหัสพนักงาน"
        className="max-w-sm"
      />

      <QueryBoundary
        isLoading={isLoading && !data}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดรายชื่อพนักงานได้"
      >
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          isLoading={isLoading}
          emptyMessage="ไม่พบพนักงาน"
          onRowClick={canManage ? (e) => setEditId(e.id) : undefined}
          pagination={
            data
              ? {
                  page: data.page,
                  totalPages: Math.max(1, Math.ceil(data.total / data.limit)),
                  total: data.total,
                  onPageChange: setPage,
                }
              : undefined
          }
        />
      </QueryBoundary>

      {canManage && (
        <>
          <ProvisionEmployeeDialog open={provisionOpen} onOpenChange={setProvisionOpen} />
          <EditEmployeeDialog id={editId} onClose={() => setEditId(null)} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: เขียน `EmployeesPage.tsx` ใหม่เป็น wrapper**

```tsx
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { EmployeesTab } from '@/pages/SettingsPage/tabs/EmployeesTab';

export default function EmployeesPage() {
  useDocumentTitle('พนักงาน');
  return <EmployeesTab />;
}
```

- [ ] **Step 3: tsc**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/SettingsPage/tabs/EmployeesTab.tsx apps/web/src/pages/EmployeesPage.tsx
git commit -m "refactor(web): extract EmployeesTab body, EmployeesPage becomes wrapper"
```

---

## Task 3: SettingsPage role-aware tab registry + เพิ่ม 2 แท็บ

**Files:**
- Modify: `apps/web/src/pages/SettingsPage/index.tsx` (เขียนใหม่ทั้งไฟล์)
- Test: `apps/web/src/pages/SettingsPage/__tests__/SettingsPage.test.tsx` (ใหม่)

- [ ] **Step 1: เขียน failing test** `__tests__/SettingsPage.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import SettingsPage from '../index';

let mockRole = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockRole } }),
}));
// stub tab bodies (avoid data fetching); only the active tab mounts.
vi.mock('../tabs/ContactsTab', () => ({ ContactsTab: () => <div>contacts-body</div> }));
vi.mock('../tabs/EmployeesTab', () => ({ EmployeesTab: () => <div>employees-body</div> }));

function renderAt(hash = '') {
  window.location.hash = hash;
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

describe('SettingsPage — role-gated tabs', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('OWNER เห็นแท็บ master-data + config', () => {
    mockRole = 'OWNER';
    renderAt();
    expect(screen.getByRole('tab', { name: 'ผู้ติดต่อ' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'พนักงาน' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'บริษัท' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'PDPA' })).toBeTruthy();
  });

  it('FINANCE_MANAGER เห็นเฉพาะ ผู้ติดต่อ', () => {
    mockRole = 'FINANCE_MANAGER';
    renderAt();
    expect(screen.getByRole('tab', { name: 'ผู้ติดต่อ' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'พนักงาน' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'บริษัท' })).toBeNull();
  });

  it('ACCOUNTANT เห็น ผู้ติดต่อ + พนักงาน (ไม่เห็น config)', () => {
    mockRole = 'ACCOUNTANT';
    renderAt();
    expect(screen.getByRole('tab', { name: 'ผู้ติดต่อ' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'พนักงาน' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'บริษัท' })).toBeNull();
  });

  it('role ที่ไม่อนุญาต (SALES) ถูก redirect (ไม่เห็นแท็บ)', () => {
    mockRole = 'SALES';
    renderAt();
    expect(screen.queryByRole('tab', { name: 'ผู้ติดต่อ' })).toBeNull();
  });

  it('hash ที่ไม่มีสิทธิ์ (FM เปิด #vat) → ตกไปแท็บแรกที่เห็น (ผู้ติดต่อ)', () => {
    mockRole = 'FINANCE_MANAGER';
    renderAt('#vat');
    expect(screen.getByText('contacts-body')).toBeTruthy();
  });
});
```

- [ ] **Step 2: รัน test ให้ fail**

Run: `npx vitest run src/pages/SettingsPage/__tests__/SettingsPage.test.tsx`
Expected: FAIL (ยังเป็น OWNER-only, ไม่มีแท็บ ผู้ติดต่อ/พนักงาน, FM ถูก redirect ทั้งหมด)

- [ ] **Step 3: เขียน `SettingsPage/index.tsx` ใหม่**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ContactsTab } from './tabs/ContactsTab';
import { EmployeesTab } from './tabs/EmployeesTab';
import { CompanyTab } from './tabs/CompanyTab';
import { VatTab } from './tabs/VatTab';
import { PeriodsTab } from './tabs/PeriodsTab';
import { AttachmentTab } from './tabs/AttachmentTab';
import { UsersTab } from './tabs/UsersTab';
import { OffsiteBackupTab } from './tabs/OffsiteBackupTab';
import { PeakMappingTab } from './tabs/PeakMappingTab';
import { PdpaTab } from './tabs/PdpaTab';
import { InternalControlTab } from './tabs/InternalControlTab';

type SettingsRole = 'OWNER' | 'FINANCE_MANAGER' | 'ACCOUNTANT';
const ALLOWED_ROLES: SettingsRole[] = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'];

interface TabDef {
  id: string;
  label: string;
  roles: SettingsRole[];
  render: () => React.ReactNode;
}

// master-data ขึ้นก่อน แล้วตามด้วย config (OWNER เท่านั้น)
const TABS: TabDef[] = [
  { id: 'contacts', label: 'ผู้ติดต่อ', roles: ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'], render: () => <ContactsTab /> },
  { id: 'employees', label: 'พนักงาน', roles: ['OWNER', 'ACCOUNTANT'], render: () => <EmployeesTab /> },
  { id: 'company', label: 'บริษัท', roles: ['OWNER'], render: () => <CompanyTab /> },
  { id: 'vat', label: 'VAT', roles: ['OWNER'], render: () => <VatTab /> },
  { id: 'periods', label: 'งวดบัญชี', roles: ['OWNER'], render: () => <PeriodsTab /> },
  { id: 'attachment', label: 'เอกสารแนบ', roles: ['OWNER'], render: () => <AttachmentTab /> },
  { id: 'users', label: 'ผู้ใช้งาน', roles: ['OWNER'], render: () => <UsersTab /> },
  { id: 'internal-control', label: 'ระบบควบคุม', roles: ['OWNER'], render: () => <InternalControlTab /> },
  { id: 'offsite-backup', label: 'สำรองข้อมูล', roles: ['OWNER'], render: () => <OffsiteBackupTab /> },
  { id: 'peak-mapping', label: 'PEAK', roles: ['OWNER'], render: () => <PeakMappingTab /> },
  { id: 'pdpa', label: 'PDPA', roles: ['OWNER'], render: () => <PdpaTab /> },
];

function readHash(): string {
  return typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
}

export default function SettingsPage() {
  useDocumentTitle('ตั้งค่าระบบ');
  const { user } = useAuth();
  const role = (user?.role ?? '') as SettingsRole;

  const visibleTabs = useMemo(() => TABS.filter((t) => t.roles.includes(role)), [role]);
  const visibleIds = useMemo(() => visibleTabs.map((t) => t.id), [visibleTabs]);
  const idsKey = visibleIds.join(',');

  const [activeTab, setActiveTab] = useState<string>(() => {
    const h = readHash();
    const initialIds = TABS.filter((t) => t.roles.includes(role)).map((t) => t.id);
    return initialIds.includes(h) ? h : (initialIds[0] ?? '');
  });

  // keep activeTab valid for the current role + sync hash
  useEffect(() => {
    const current = visibleIds.includes(activeTab) ? activeTab : (visibleIds[0] ?? '');
    if (current && current !== activeTab) setActiveTab(current);
    if (current && window.location.hash.slice(1) !== current) {
      window.history.replaceState(null, '', `#${current}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, idsKey]);

  // react to back/forward
  useEffect(() => {
    const handler = () => {
      const h = readHash();
      setActiveTab(visibleIds.includes(h) ? h : (visibleIds[0] ?? ''));
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // guard ออก *หลัง* hook ทั้งหมด (กัน rules-of-hooks) — role อื่นเด้ง /
  if (user && !ALLOWED_ROLES.includes(role)) {
    return <Navigate to="/" replace />;
  }

  return (
    <div>
      <PageHeader title="ตั้งค่าระบบ" subtitle="กำหนดพารามิเตอร์การทำงานของระบบ" />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v)}>
        <TabsList className="grid grid-cols-2 md:grid-flow-col md:auto-cols-fr mb-4">
          {visibleTabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {visibleTabs.map((t) => (
          <TabsContent key={t.id} value={t.id}>
            {t.render()}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 4: รัน test ให้ผ่าน**

Run: `npx vitest run src/pages/SettingsPage/__tests__/SettingsPage.test.tsx`
Expected: PASS (5 เคส)

- [ ] **Step 5: tsc**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/SettingsPage/index.tsx apps/web/src/pages/SettingsPage/__tests__/SettingsPage.test.tsx
git commit -m "feat(web): role-gated settings tabs + add contacts/employees tabs"
```

---

## Task 4: เปลี่ยนลิงก์เมนู "ข้อมูลหลัก" → /settings#...

**Files:**
- Modify: `apps/web/src/config/menu.ts` (3 กลุ่ม)

- [ ] **Step 1: แก้กลุ่ม OWNER (`owner-fin-master`)**

แทนที่:
```ts
      items: [
        { label: 'สมุดผู้ติดต่อ', path: '/contacts', icon: BookUser },
        { label: 'พนักงาน', path: '/employees', icon: Users },
      ],
```
ในบล็อก `key: 'owner-fin-master'` ด้วย:
```ts
      items: [
        { label: 'สมุดผู้ติดต่อ', path: '/settings#contacts', icon: BookUser },
        { label: 'พนักงาน', path: '/settings#employees', icon: Users },
      ],
```

- [ ] **Step 2: แก้กลุ่ม ACCOUNTANT (`acc-fin-master`)** — items เดิมเหมือน OWNER (สมุดผู้ติดต่อ + พนักงาน) เปลี่ยน path เหมือน Step 1 (ในบล็อก `key: 'acc-fin-master'`):
```ts
      items: [
        { label: 'สมุดผู้ติดต่อ', path: '/settings#contacts', icon: BookUser },
        { label: 'พนักงาน', path: '/settings#employees', icon: Users },
      ],
```

- [ ] **Step 3: แก้กลุ่ม FINANCE_MANAGER (`fm-fin-master`)** — มีแค่สมุดผู้ติดต่อ (ในบล็อก `key: 'fm-fin-master'`):

แทนที่:
```ts
      items: [
        { label: 'สมุดผู้ติดต่อ', path: '/contacts', icon: BookUser },
      ],
```
ด้วย:
```ts
      items: [
        { label: 'สมุดผู้ติดต่อ', path: '/settings#contacts', icon: BookUser },
      ],
```

- [ ] **Step 4: tsc**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/config/menu.ts
git commit -m "feat(web): point 'ข้อมูลหลัก' menu items at /settings tabs"
```

---

## Task 5: ทำให้ sidebar highlight ถูกเมื่อ path มี hash

> 3 matcher ใน 2 component (CollapsedSidebar: `isSectionActive`, `isItemActive`; ExpandedSidebar: `matchPath`)
> ใช้ helper กลางตัวเดียว เพิ่ม branch สำหรับ path ที่มี `#` โดยไม่แตะ logic เดิมของ path ปกติ

**Files:**
- Modify: `apps/web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: เพิ่ม helper ระดับโมดูล** — วางใกล้ส่วน import/บนสุดของไฟล์ (นอก component):

```ts
// path ที่มี hash (เช่น '/settings#contacts') ต้อง match ทั้ง pathname + hash
function hashAwareActive(path: string, pathname: string, hash: string): boolean {
  if (path.includes('#')) return path === pathname + hash;
  return path === pathname || (path.length > 1 && pathname.startsWith(path + '/'));
}
```

- [ ] **Step 2: CollapsedSidebar** — เปลี่ยน `const { pathname } = useLocation();` (บรรทัด ~153) เป็น:
```ts
  const { pathname, hash } = useLocation();
```
แล้วแทน `isSectionActive` + `isItemActive` ด้วย:
```ts
  const isSectionActive = useCallback(
    (section: MenuSection): boolean =>
      section.items.some(
        (item) =>
          hashAwareActive(item.path, pathname, hash) ||
          (item.children ?? []).some((child) => hashAwareActive(child.path, pathname, hash)),
      ),
    [pathname, hash],
  );

  const isItemActive = useCallback(
    (path: string): boolean => hashAwareActive(path, pathname, hash),
    [pathname, hash],
  );
```

- [ ] **Step 3: ExpandedSidebar** — เปลี่ยน `const { pathname } = useLocation();` (บรรทัด ~436) เป็น:
```ts
  const { pathname, hash } = useLocation();
```
แล้วแทน `matchPath` ด้วย:
```ts
  const matchPath = useCallback(
    (path: string): boolean =>
      path.includes('#')
        ? path === pathname + hash
        : path === pathname || (path.length > 1 && pathname.startsWith(path)),
    [pathname, hash],
  );
```

- [ ] **Step 4: tsc**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/Sidebar.tsx
git commit -m "fix(web): sidebar active-state matches hash paths (/settings#contacts)"
```

---

## Task 6: Regression รวม + ตรวจด้วยตา

- [ ] **Step 1: รัน web suite ทั้งหมด**

Run: `npx vitest run`
Expected: PASS ทั้งหมด (baseline เดิม 649 + 5 เคสใหม่ของ SettingsPage = 654; ตัวเลขอาจต่างถ้ามี test อื่นเพิ่ม) ไม่มี fail

- [ ] **Step 2: tsc รอบสุดท้าย**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: ตรวจด้วยตา (manual)** — รัน `npm run dev` แล้ว:
  - ล็อกอิน OWNER → /settings เห็น 11 แท็บ (ผู้ติดต่อ, พนักงาน, บริษัท … PDPA); คลิกเมนู "ข้อมูลหลัก → สมุดผู้ติดต่อ" → เด้งเข้าแท็บ `#contacts` + เมนูถูก highlight
  - ล็อกอิน ฝ่ายบัญชี (ACCOUNTANT) → /settings เห็นเฉพาะ ผู้ติดต่อ + พนักงาน
  - ล็อกอิน ฝ่ายการเงิน (FINANCE_MANAGER) → /settings เห็นเฉพาะ ผู้ติดต่อ
  - เปิด `/contacts` ตรง → ยังแสดงรายการได้; เข้า `/contacts/:id` แล้วกดปุ่มกลับ → กลับ `/contacts` ปกติ
  - เปิด `/settings#vat` ด้วย FM → เด้งไปแท็บผู้ติดต่อ

- [ ] **Step 4: Commit (ถ้ามีแก้เพิ่มจาก manual)** — ไม่มีแก้ก็ข้าม

---

## Self-Review (ผู้เขียนแผนตรวจเอง)

- **Spec coverage:** ทุกข้อในสเปคมี task รองรับ — แท็บ+role gating (T3), แยก body กันโค้ดซ้ำ (T1,T2), เมนู (T4), route เดิมคงไว้ (ไม่แตะ App.tsx routes = คงอยู่; ยืนยัน manual T6/S3), sidebar hash (T5), ทดสอบ (T3 unit + T6 regression). ✓
- **Placeholder scan:** ไม่มี TODO/TBD; โค้ดครบทุก step. ✓
- **Type consistency:** `ContactsTab`/`EmployeesTab` named export ใช้ตรงกันทั้ง wrapper + SettingsPage + test mock; `TabDef.roles: SettingsRole[]`; `hashAwareActive(path,pathname,hash)` signature ตรงกันทั้ง 3 จุดเรียก. ✓
- **หมายเหตุ:** TabsList ใช้ `md:grid-flow-col md:auto-cols-fr` (แทน `md:grid-cols-9` เดิม) เพื่อรองรับจำนวนแท็บที่ผันตาม role (1/2/11)
